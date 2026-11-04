const axios = require('axios');
const config = require('../config/config');
const database = require('./database');
const logger = require('./logger');
const qwen = require('./qwenMultimodalService');

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
    if (!process.env.QWEN_API_KEY) {
        console.log('[ai-suggestions] QWEN_API_KEY ausente — skip');
        return null;
    }

    // Supersede la pending anterior (si existe) ANTES de pedir a la API
    await supersedePending(chatPhone);

    // Traer contexto reciente desde logs
    let contextMsgs = [];
    try {
        contextMsgs = await logger.getLogsByClientPhone(chatPhone, CONTEXT_WINDOW);
    } catch (e) {
        console.log('[ai-suggestions] error leyendo contexto:', e.message);
    }

    let option1 = '', option2 = '';
    try {
        const res = await qwen.generateTwoOptions({ messageText, mediaInfo, contextMsgs });
        option1 = res.option1;
        option2 = res.option2;
    } catch (e) {
        console.error('[ai-suggestions] Qwen fallo:', e.response?.data?.error?.message || e.message);
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
 * Si Qwen falla, cae a option1.
 */
async function chooseAutoOption(suggestion) {
    try {
        return await qwen.chooseBestOption({ option1: suggestion.option1, option2: suggestion.option2 });
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
