const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const MODEL = process.env.QWEN_MODEL || 'qwen3-omni-flash';
const BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const API_KEY = process.env.QWEN_API_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://soporte-aloia.aloia.dev';

// Los media (/media/...) se sirven desde /home/container/data/media/...
const DATA_ROOT = path.join(__dirname, '../../data');

function mediaUrlToLocalPath(mediaUrl) {
    if (!mediaUrl) return null;
    const clean = mediaUrl.replace(/^\/+/, '');
    return path.join(DATA_ROOT, clean);
}

async function readAsBase64(mediaUrl) {
    const local = mediaUrlToLocalPath(mediaUrl);
    if (!local) throw new Error('mediaUrl vacio');
    const buf = await fs.readFile(local);
    return buf.toString('base64');
}

function guessAudioFormat(mimetype) {
    const m = (mimetype || '').toLowerCase();
    if (m.includes('ogg') || m.includes('opus')) return 'ogg';
    if (m.includes('mp3') || m.includes('mpeg')) return 'mp3';
    if (m.includes('wav')) return 'wav';
    if (m.includes('m4a') || m.includes('aac')) return 'm4a';
    return 'ogg';
}

/**
 * Construye el array content (OpenAI-style) con media + texto para una turn user.
 * mediaInfo: { has_media, media_type, media_url, media_mimetype, media_filename, media_caption }
 */
async function buildMediaContentParts(messageText, mediaInfo) {
    const parts = [];
    if (mediaInfo?.has_media && mediaInfo.media_url) {
        const type = mediaInfo.media_type;
        const mime = mediaInfo.media_mimetype || '';

        try {
            if (type === 'image' || type === 'sticker') {
                const b64 = await readAsBase64(mediaInfo.media_url);
                const mimeOut = mime || (type === 'sticker' ? 'image/webp' : 'image/jpeg');
                parts.push({ type: 'image_url', image_url: { url: `data:${mimeOut};base64,${b64}` } });
            } else if (type === 'audio') {
                const b64 = await readAsBase64(mediaInfo.media_url);
                parts.push({ type: 'input_audio', input_audio: { data: b64, format: guessAudioFormat(mime) } });
            } else if (type === 'video') {
                // Video por URL publica (Cloudflare lo sirve)
                parts.push({ type: 'video_url', video_url: { url: `${PUBLIC_BASE_URL}${mediaInfo.media_url}` } });
            } else if (type === 'document') {
                // Documentos: solo pasamos nombre + tipo como texto (Qwen no come docs directo).
                parts.push({ type: 'text', text: `[Cliente envió documento: ${mediaInfo.media_filename || 'archivo'} (${mime || 'desconocido'})]` });
            }
        } catch (e) {
            console.warn(`[qwen] no pude leer media (${mediaInfo.media_url}):`, e.message);
            parts.push({ type: 'text', text: `[Cliente envió ${type || 'archivo'} pero no se pudo cargar]` });
        }
    }

    // Texto del cliente (puede ser texto puro, caption de imagen/video, o vacío)
    const textLine = messageText || mediaInfo?.media_caption || '';
    if (textLine.trim()) {
        parts.push({ type: 'text', text: `Mensaje del cliente: "${textLine.trim()}"` });
    } else if (mediaInfo?.has_media) {
        parts.push({ type: 'text', text: `(Sin caption — solo el ${mediaInfo.media_type})` });
    }

    return parts;
}

async function callQwenChat(messages, { max_tokens = 400, temperature = 0.6, response_format = null } = {}) {
    if (!API_KEY) throw new Error('QWEN_API_KEY no configurada');
    const body = {
        model: MODEL,
        messages,
        max_tokens,
        temperature,
    };
    if (response_format) body.response_format = response_format;

    const res = await axios.post(`${BASE_URL}/chat/completions`, body, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });
    const content = res.data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Respuesta vacía de Qwen');
    return content;
}

/**
 * Genera 2 opciones de respuesta considerando media + contexto conversacional.
 * contextMsgs: array de logs previos (ordenados cronológicamente).
 */
async function generateTwoOptions({ messageText, mediaInfo, contextMsgs, projectContext, projectSlug }) {
    const projectBlock = projectContext
        ? `\n\nDOCUMENTACION TECNICA DEL PROYECTO "${projectSlug || 'activo'}" (usa esto como fuente de verdad para responder preguntas tecnicas; si contradice tu conocimiento general, gana la doc):\n${projectContext}\n`
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
3. Si viene media (imagen/audio/video), analizala a fondo — screenshot de error, audio pidiendo algo, video de un problema. Usa lo que veas/escuches.
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

    const userParts = [
        { type: 'text', text: `Hilo completo (cronologico, mas abajo = mas reciente):\n${history}\n\nUltimo mensaje del cliente al que vas a responder (recuerda: tu respuesta debe considerar TODO el hilo de arriba, no solo esto):` },
        ...(await buildMediaContentParts(messageText, mediaInfo)),
    ];

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userParts }
    ];

    const raw = await callQwenChat(messages, {
        max_tokens: 400,
        temperature: 0.6,
        response_format: { type: 'json_object' }
    });
    try {
        const obj = JSON.parse(raw);
        return {
            option1: typeof obj.option1 === 'string' ? obj.option1.trim() : '',
            option2: typeof obj.option2 === 'string' ? obj.option2.trim() : ''
        };
    } catch {
        // Qwen a veces incluye prefijo tipo ```json ... ```
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

/**
 * Para auto-send: elegir 1 o 2 entre opciones ya redactadas.
 */
async function chooseBestOption({ option1, option2 }) {
    try {
        const raw = await callQwenChat([
            { role: 'system', content: 'Elige la mejor respuesta entre dos ya redactadas para un cliente. Devuelve SOLO JSON: {"choice":1} o {"choice":2}.' },
            { role: 'user', content: `Opcion 1: ${option1}\nOpcion 2: ${option2}` }
        ], { max_tokens: 20, temperature: 0.2, response_format: { type: 'json_object' } });
        const obj = JSON.parse(raw);
        return obj.choice === 2 ? 2 : 1;
    } catch {
        return 1;
    }
}

module.exports = {
    generateTwoOptions,
    chooseBestOption,
    callQwenChat,
    MODEL,
};
