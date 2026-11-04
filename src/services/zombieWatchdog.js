// Watchdog: detecta cuando Baileys dice "connected" pero deja de recibir
// mensajes. Si pasa, reinicia la instancia del user afectado.
//
// Idea: cada tick (5 min), por cada instancia conectada:
//   - Leer last_message_at MAX de los chats asignados a ese user.
//   - Si last_message_at < NOW() - STALE_THRESHOLD y hay >=5 chats
//     con actividad en los últimos 7 días, asumir zombie y restart.
//
// Threshold conservador: 60 min sin recibir nada en ningún chat activo.
const database = require('./database');

const TICK_MS = 5 * 60 * 1000;
const STALE_MINUTES = 60;
const MIN_ACTIVE_CHATS = 5; // Para evitar restart en cuentas con poca actividad

async function checkOnce() {
    try {
        const instanceManager = global.whatsappInstanceManager;
        if (!instanceManager) return;
        const instances = instanceManager.getInstances();
        for (const inst of instances) {
            if (inst.status !== 'connected') continue;
            try {
                const [rows] = await Promise.all([
                    database.query(
                        `SELECT
                            MAX(last_message_at) AS last_any,
                            SUM(CASE WHEN last_message_at > NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS active_recent
                         FROM client_assignments
                         WHERE support_user_id = ? AND is_archived = 0`,
                        [inst.userId]
                    )
                ]);
                const r = rows[0] || {};
                const activeRecent = Number(r.active_recent || 0);
                const lastAny = r.last_any ? new Date(r.last_any) : null;
                if (!lastAny || activeRecent < MIN_ACTIVE_CHATS) continue;
                const idleMinutes = (Date.now() - lastAny.getTime()) / 60000;
                if (idleMinutes >= STALE_MINUTES) {
                    console.log(`🧟 [watchdog] user ${inst.userId} zombie detectado: idle ${idleMinutes.toFixed(0)} min, ${activeRecent} chats activos — reiniciando instancia...`);
                    try {
                        await instanceManager.stopInstance(inst.userId);
                        setTimeout(() => {
                            instanceManager.startInstance(inst.userId, inst.instanceName).catch(e => {
                                console.error(`🧟 [watchdog] fallo al reiniciar user ${inst.userId}:`, e.message);
                            });
                        }, 2000);
                    } catch (e) {
                        console.error(`🧟 [watchdog] stop user ${inst.userId} falló:`, e.message);
                    }
                }
            } catch (e) {
                console.error(`🧟 [watchdog] error check user ${inst.userId}:`, e.message);
            }
        }
    } catch (e) {
        console.error('🧟 [watchdog] tick falló:', e.message);
    }
}

function start() {
    setInterval(checkOnce, TICK_MS);
    console.log(`🧟 Zombie watchdog activo (tick ${TICK_MS / 1000}s, umbral ${STALE_MINUTES} min)`);
}

module.exports = { start, checkOnce };
