const axios = require('axios');
const config = require('../config/config');
const database = require('./database');
const logger = require('./logger');
const qwen = require('./qwenMultimodalService');
const docsProjectService = require('./docsProjectService');

const SUGGESTION_TTL_MINUTES = 5;
const CONTEXT_WINDOW = 25;

// Números excluidos — mensajes de estos participantes no disparan sugerencias.
// Comparamos contra el participant JID normalizado a solo-dígitos.
const EXCLUDED_NUMBERS = new Set([
    '5532220893', // Luis Alberto
    '8118650283', // Iván
    // Variantes con prefijo país / 521
    '525532220893',
    '5215532220893',
    '528118650283',
    '5218118650283',
]);

function normalizeDigits(s) {
    return (s || '').replace(/\D/g, '');
}

function isExcludedParticipant(participantJid) {
    if (!participantJid) return false;
    const digits = normalizeDigits(participantJid.split('@')[0]);
    if (!digits) return false;
    if (EXCLUDED_NUMBERS.has(digits)) return true;
    // Tolerar match por sufijo (cuando el JID viene con 521 pero whitelist sin él, o viceversa)
    for (const n of EXCLUDED_NUMBERS) {
        if (digits.endsWith(n) || n.endsWith(digits)) return true;
    }
    return false;
}

async function callDeepSeek(messages, { max_tokens = 400, temperature = 0.6 } = {}) {
    const res = await axios.post(config.deepseekApiUrl, {
        model: 'deepseek-chat',
        messages,
        max_tokens,
        temperature,
        response_format: { type: 'json_object' }
    }, {
        headers: {
            'Authorization': `Bearer ${config.deepseekApiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 25000
    });
    return res.data.choices[0].message.content;
}

async function generateOptionsDeepSeek({ messageText, mediaDescription, contextMsgs, projectContext, projectSlugs }) {
    const projectBlock = projectContext
        ? `\n\nDOCUMENTACION TECNICA DEL PROYECTO "${(projectSlugs || []).join(', ') || 'activo'}" (usa esto como fuente de verdad; si contradice tu conocimiento general, gana la doc):\n${projectContext}\n`
        : '';

    const systemPrompt = `Eres un agente humano del equipo de SOPORTE de Aloia. Estas monitoreando un grupo de WhatsApp con multiples participantes (clientes, lideres, equipo).

PASO 0 — ¿Debes responder tu?
Antes de pensar en que decir, decide si el soporte de Aloia realmente debe responder al mensaje. Devuelve OPCIONES VACIAS ({"option1":"","option2":""}) en TODOS estos casos:
- El mensaje es un agradecimiento, "gracias", "👍", emoji sueltos, reacciones.
- El mensaje es un broadcast de otro miembro del equipo (ej. "equipo, mañana junta a las 10", "les comparto el rol de guardias", "les recuerdo califiquen los leads").
- El mensaje es chat interno entre otros participantes que no te menciona ni te pide nada (coordinacion, chismecito, confirmaciones tipo "va", "ok", "recibido", "gracias por la info").
- El mensaje es un status update informativo que no pide accion de soporte.
- El mensaje esta dirigido a OTRO participante por nombre, no al soporte.
- No hay pregunta, ni problema tecnico, ni solicitud concreta que requiera a Aloia.

Responde SOLO si el mensaje es claramente una pregunta, un problema, una queja, una solicitud tecnica o emocional dirigida al soporte. Mejor callar que meter ruido al grupo.

PASO 1 — Si decides responder, estas reglas aplican:
1. ENTIENDE EL HILO COMPLETO, no solo el ultimo mensaje. Lee toda la conversacion y detecta lo que realmente necesita el cliente.
2. Si el cliente lleva varios mensajes esperando sin respuesta util, RECONOCE la demora o la frustracion antes de responder al asunto tecnico.
3. Si hay descripcion de media abajo (imagen, audio, video analizado), usala como si tu la hubieras visto/escuchado directo.
4. Responde al problema real del hilo, no solo al ultimo renglon.
5. Dos opciones DISTINTAS en tono y enfoque (ej. una empatica, otra resolutiva). Max 2 oraciones cada una. Naturales, como un humano.
6. Si tienes documentacion tecnica del proyecto abajo, USALA — nombres de archivos, URLs, flags, endpoints concretos. No inventes detalles tecnicos.${projectBlock}

Devuelve SOLO JSON valido, sin markdown ni texto adicional:
{"option1":"...","option2":"..."}`;

    const history = (contextMsgs || []).map(m => {
        const who = m.role === 'cliente' ? `Cliente (${m.userName || 'anonimo'})` : `Agente (${m.userName || 'soporte'})`;
        let body = m.message || '';
        if (!body && m.hasMedia) body = `[${m.mediaType || 'archivo'}]`;
        return `${who}: ${body}`;
    }).join('\n') || '(sin historial previo)';

    const parts = [
        `Hilo completo (cronologico, mas abajo = mas reciente):\n${history}`,
        `\nUltimo mensaje del cliente al que vas a responder (recuerda: considera TODO el hilo, no solo esto):`
    ];
    if (messageText && messageText.trim()) {
        parts.push(`Texto: "${messageText.trim()}"`);
    }
    if (mediaDescription) {
        parts.push(mediaDescription);
    }
    if (!messageText && !mediaDescription) {
        parts.push('(mensaje vacio sin texto ni media)');
    }

    const raw = await callDeepSeek([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: parts.join('\n') }
    ], { max_tokens: 400, temperature: 0.6 });

    try {
        const obj = JSON.parse(raw);
        return {
            option1: typeof obj.option1 === 'string' ? obj.option1.trim() : '',
            option2: typeof obj.option2 === 'string' ? obj.option2.trim() : ''
        };
    } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
            try {
                const obj = JSON.parse(m[0]);
                return {
                    option1: typeof obj.option1 === 'string' ? obj.option1.trim() : '',
                    option2: typeof obj.option2 === 'string' ? obj.option2.trim() : ''
                };
            } catch {}
        }
        return { option1: '', option2: '' };
    }
}

async function supersedePending(chatPhone) {
    await database.query(
        `UPDATE ai_suggestions SET status = 'superseded', resolved_at = NOW()
         WHERE chat_phone = ? AND status = 'pending'`,
        [chatPhone]
    );
}

async function cancelPending(chatPhone, reason = 'cancelled') {
    await database.query(
        `UPDATE ai_suggestions SET status = ?, resolved_at = NOW()
         WHERE chat_phone = ? AND status = 'pending'`,
        [reason, chatPhone]
    );
}

async function getPendingForChat(chatPhone) {
    const rows = await database.query(
        `SELECT id, chat_phone, support_user_id, trigger_message_id, trigger_participant,
                option1, option2, status, created_at, expires_at
         FROM ai_suggestions WHERE chat_phone = ? AND status = 'pending'
         ORDER BY id DESC LIMIT 1`,
        [chatPhone]
    );
    return rows[0] || null;
}

async function getSuggestionById(id) {
    const rows = await database.query(`SELECT * FROM ai_suggestions WHERE id = ?`, [id]);
    return rows[0] || null;
}

/**
 * Genera 2 sugerencias para un mensaje entrante del cliente.
 * Retorna la fila insertada o null si no se genero (excluido, sin texto, fallo API).
 */
async function generateSuggestions({ supportUserId, chatPhone, triggerMessageId, participantJid, messageText, mediaInfo }) {
    const hasText = messageText && messageText.trim().length >= 2;
    const hasMedia = !!mediaInfo?.has_media;
    if (!hasText && !hasMedia) return null;
    if (isExcludedParticipant(participantJid)) return null;
    if (!config.deepseekApiKey) {
        console.log('[ai-suggestions] DEEPSEEK_API_KEY ausente — skip');
        return null;
    }

    // Toggle por chat: si el operador apago la IA para este chat, respetar
    try {
        const settings = await database.findOne('chat_ai_settings', 'chat_phone = ?', [chatPhone]);
        if (settings && settings.ai_enabled === 0) {
            console.log(`[ai-suggestions] chat ${chatPhone} tiene IA apagada — skip`);
            return null;
        }
    } catch {}

    // Supersede la pending anterior (si existe) ANTES de pedir a la API
    await supersedePending(chatPhone);

    // Traer contexto reciente desde logs
    let contextMsgs = [];
    try {
        contextMsgs = await logger.getLogsByClientPhone(chatPhone, CONTEXT_WINDOW);
    } catch (e) {
        console.log('[ai-suggestions] error leyendo contexto:', e.message);
    }

    // Resolver links chat ↔ proyectos de la doc y cargar contextos si aplica.
    // Un chat puede tener varios proyectos (ej. grupo "esac" cubre
    // esac-chats, esac-sears, esac-inbursa, esac-stori).
    let projectContext = null;
    let projectSlugs = [];
    try {
        const links = await database.query(
            'SELECT project_slug FROM chat_project_links WHERE chat_phone = ? ORDER BY project_slug',
            [chatPhone]
        );
        projectSlugs = links.map(l => l.project_slug);
        if (projectSlugs.length) {
            // Repartir el presupuesto total entre N proyectos
            const totalCap = 30000;
            const perProject = Math.floor(totalCap / projectSlugs.length);
            const chunks = [];
            for (const slug of projectSlugs) {
                const ctx = await docsProjectService.getProjectContext(slug, { maxTotalChars: perProject, maxPerFile: Math.min(4000, Math.floor(perProject / 5)) });
                if (ctx) {
                    chunks.push(`\n### PROYECTO: ${slug}\n${ctx}`);
                }
            }
            if (chunks.length) {
                projectContext = chunks.join('\n');
                console.log(`[ai-suggestions] usando docs de ${projectSlugs.length} proyecto(s): ${projectSlugs.join(', ')} (${projectContext.length} chars)`);
            }
        }
    } catch (e) {
        console.log('[ai-suggestions] no pude cargar contexto doc:', e.message);
    }

    // Si hay media, Qwen lo describe/transcribe a texto plano antes de pasar a DeepSeek
    let mediaDescription = null;
    if (hasMedia) {
        try {
            mediaDescription = await qwen.describeMedia(mediaInfo);
            if (mediaDescription) console.log(`[ai-suggestions] Qwen describio ${mediaInfo.media_type}: "${mediaDescription.substring(0, 80)}..."`);
        } catch (e) {
            console.log('[ai-suggestions] Qwen describeMedia fallo:', e.message);
        }
    }

    // DeepSeek es el cerebro — genera las 2 opciones con todo el contexto
    let option1 = '', option2 = '';
    try {
        const res = await generateOptionsDeepSeek({
            messageText,
            mediaDescription,
            contextMsgs,
            projectContext,
            projectSlugs
        });
        option1 = res.option1;
        option2 = res.option2;
    } catch (e) {
        console.error('[ai-suggestions] DeepSeek fallo:', e.response?.data?.error?.message || e.message);
        return null;
    }
    if (!option1 && !option2) return null;

    const expiresAt = new Date(Date.now() + SUGGESTION_TTL_MINUTES * 60 * 1000);
    const result = await database.query(
        `INSERT INTO ai_suggestions
         (chat_phone, support_user_id, trigger_message_id, trigger_participant,
          context_json, option1, option2, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            chatPhone,
            supportUserId,
            triggerMessageId || null,
            participantJid || null,
            JSON.stringify({ messageText, contextSize: contextMsgs.length }),
            option1, option2, expiresAt
        ]
    );
    const row = await getSuggestionById(result.insertId);

    // Socket push al panel
    if (global.io) {
        global.io.emit('ai-suggestion:new', {
            chatPhone,
            suggestion: {
                id: row.id, option1: row.option1, option2: row.option2,
                expiresAt: row.expires_at, triggerMessageId: row.trigger_message_id
            }
        });
    }
    console.log(`[ai-suggestions] +#${row.id} para ${chatPhone}: "${option1.substring(0, 40)}..." / "${option2.substring(0, 40)}..."`);
    return row;
}

/**
 * Elegir cual de las 2 opciones mandar automaticamente.
 * Si DeepSeek falla, cae a option1.
 */
async function chooseAutoOption(suggestion) {
    try {
        const raw = await callDeepSeek([
            { role: 'system', content: 'Elige la mejor respuesta de soporte entre dos opciones ya redactadas. Devuelve SOLO JSON {"choice":1} o {"choice":2}.' },
            { role: 'user', content: `Opcion 1: ${suggestion.option1}\nOpcion 2: ${suggestion.option2}` }
        ], { max_tokens: 20, temperature: 0.2 });
        const obj = JSON.parse(raw);
        return obj.choice === 2 ? 2 : 1;
    } catch {
        return 1;
    }
}

/**
 * Ejecutar las sugerencias expiradas: elegir y enviar via instance manager.
 * Devuelve lista de ids procesados.
 */
async function processExpired() {
    const rows = await database.query(
        `SELECT * FROM ai_suggestions
         WHERE status = 'pending' AND expires_at <= NOW()
         ORDER BY id ASC LIMIT 50`
    );
    const processed = [];
    for (const row of rows) {
        try {
            const choice = await chooseAutoOption(row);
            const text = (choice === 2 ? row.option2 : row.option1) || row.option1 || row.option2;
            if (!text) continue;

            const instanceManager = global.whatsappInstanceManager;
            if (!instanceManager) { console.log('[ai-suggestions] instanceManager no disponible'); continue; }
            const chatJid = `${row.chat_phone}@g.us`;
            await instanceManager.sendMessage(row.support_user_id, chatJid, text);

            await database.query(
                `UPDATE ai_suggestions
                 SET status = 'auto-sent', chosen_text = ?, chosen_source = ?, resolved_at = NOW()
                 WHERE id = ?`,
                [text, `auto_option${choice}`, row.id]
            );
            console.log(`[ai-suggestions] auto-enviado #${row.id} opcion ${choice}`);
            if (global.io) global.io.emit('ai-suggestion:resolved', { chatPhone: row.chat_phone, id: row.id, status: 'auto-sent' });
            processed.push(row.id);
        } catch (e) {
            console.error(`[ai-suggestions] fallo auto-enviar #${row.id}:`, e.message);
            await database.query(
                `UPDATE ai_suggestions SET status = 'error', resolved_at = NOW() WHERE id = ?`,
                [row.id]
            );
        }
    }
    return processed;
}

/**
 * Enviar una opcion especifica (click de operador en chip 1 o 2).
 */
async function sendOption(id, choice) {
    const row = await getSuggestionById(id);
    if (!row || row.status !== 'pending') throw new Error('Sugerencia no disponible');
    const text = (choice === 2 ? row.option2 : row.option1);
    if (!text) throw new Error('Opcion vacia');

    const instanceManager = global.whatsappInstanceManager;
    const chatJid = `${row.chat_phone}@g.us`;
    await instanceManager.sendMessage(row.support_user_id, chatJid, text);

    await database.query(
        `UPDATE ai_suggestions SET status = 'user-sent', chosen_text = ?, chosen_source = ?, resolved_at = NOW()
         WHERE id = ?`,
        [text, `user_option${choice}`, id]
    );
    if (global.io) global.io.emit('ai-suggestion:resolved', { chatPhone: row.chat_phone, id, status: 'user-sent' });
    return { ok: true, sent: text };
}

async function dismiss(id) {
    const row = await getSuggestionById(id);
    if (!row || row.status !== 'pending') return { ok: true };
    await database.query(
        `UPDATE ai_suggestions SET status = 'dismissed', resolved_at = NOW() WHERE id = ?`,
        [id]
    );
    if (global.io) global.io.emit('ai-suggestion:resolved', { chatPhone: row.chat_phone, id, status: 'dismissed' });
    return { ok: true };
}

module.exports = {
    generateSuggestions,
    cancelPending,
    supersedePending,
    processExpired,
    sendOption,
    dismiss,
    getPendingForChat,
    getSuggestionById,
    isExcludedParticipant,
    EXCLUDED_NUMBERS,
    SUGGESTION_TTL_MINUTES,
};
