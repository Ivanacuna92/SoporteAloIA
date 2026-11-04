// Qwen3-Omni: ojos + oidos del sistema. SOLO se usa cuando hay media.
// No genera respuestas al cliente — eso lo hace DeepSeek con la descripcion
// que este servicio devuelve como texto plano.
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const MODEL = process.env.QWEN_MODEL || 'qwen3-omni-flash';
const BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const API_KEY = process.env.QWEN_API_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://soporte-aloia.aloia.dev';

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

async function callQwenChat(messages, { max_tokens = 400, temperature = 0.3 } = {}) {
    if (!API_KEY) throw new Error('QWEN_API_KEY no configurada');
    const res = await axios.post(`${BASE_URL}/chat/completions`, {
        model: MODEL,
        messages,
        max_tokens,
        temperature,
    }, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });
    const content = res.data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Respuesta vacía de Qwen');
    return content.trim();
}

/**
 * Describe en texto plano un media de WhatsApp.
 * Imagen/sticker -> describe que se ve (OCR si hay texto).
 * Audio -> transcribe + nota de tono/urgencia.
 * Video -> describe lo que pasa + transcribe el audio del video.
 * Documento -> describe el filename y mimetype (Qwen no procesa archivos).
 *
 * Devuelve string listo para incrustar en el prompt de DeepSeek.
 * Si no hay media o Qwen falla, devuelve null.
 */
async function describeMedia(mediaInfo) {
    if (!mediaInfo?.has_media || !mediaInfo.media_url) return null;
    if (!API_KEY) return null;

    const type = mediaInfo.media_type;
    const mime = mediaInfo.media_mimetype || '';

    // Documento: no pasa por Qwen
    if (type === 'document') {
        return `[Cliente envió un documento: "${mediaInfo.media_filename || 'archivo'}" (${mime || 'tipo desconocido'})]`;
    }

    // Construir prompt multimodal
    const parts = [];
    try {
        if (type === 'image' || type === 'sticker') {
            const b64 = await readAsBase64(mediaInfo.media_url);
            const mimeOut = mime || (type === 'sticker' ? 'image/webp' : 'image/jpeg');
            parts.push({ type: 'image_url', image_url: { url: `data:${mimeOut};base64,${b64}` } });
            parts.push({ type: 'text', text: 'Describe en espanol, en 2-4 oraciones, que se ve en esta imagen. Si tiene texto visible (screenshot, mensaje, documento fotografiado), transcribelo completo. Si es un screenshot de error de software, incluye el mensaje de error exacto. Si es una foto, describe los elementos relevantes.' });
        } else if (type === 'audio') {
            const b64 = await readAsBase64(mediaInfo.media_url);
            parts.push({ type: 'input_audio', input_audio: { data: b64, format: guessAudioFormat(mime) } });
            parts.push({ type: 'text', text: 'Transcribe este audio al espanol literalmente, palabra por palabra. Despues en una linea separada anade "Tono: " con una nota breve del estado emocional (ej. calmado, urgente, molesto, confundido).' });
        } else if (type === 'video') {
            parts.push({ type: 'video_url', video_url: { url: `${PUBLIC_BASE_URL}${mediaInfo.media_url}` } });
            parts.push({ type: 'text', text: 'Describe en espanol que pasa en este video (2-4 oraciones). Si hay voz/audio, transcribe lo que se dice. Si hay texto en pantalla, transcribelo.' });
        } else {
            return null;
        }
    } catch (e) {
        console.warn(`[qwen] no pude leer media (${mediaInfo.media_url}):`, e.message);
        return `[Cliente envió un ${type} pero no se pudo procesar]`;
    }

    let raw;
    try {
        raw = await callQwenChat(
            [{ role: 'user', content: parts }],
            { max_tokens: 400, temperature: 0.3 }
        );
    } catch (e) {
        console.error('[qwen] describeMedia fallo:', e.response?.data?.error?.message || e.message);
        return `[Cliente envió un ${type} pero no se pudo analizar: ${e.message}]`;
    }

    const caption = (mediaInfo.media_caption || '').trim();
    const captionLine = caption ? ` Caption que el cliente puso: "${caption}".` : '';
    return `[El cliente envió un ${type}. Descripción detallada: ${raw}${captionLine}]`;
}

module.exports = {
    describeMedia,
    MODEL,
};
