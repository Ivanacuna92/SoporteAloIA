const webpush = require('web-push');
const database = require('./database');

class PushService {
    constructor() {
        this.configured = false;
        this._configure();
    }

    _configure() {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        const subject = process.env.VAPID_SUBJECT || 'mailto:soporte@aloia.ai';

        if (!publicKey || !privateKey) {
            console.warn('⚠️  Web Push deshabilitado: falta VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en .env');
            return;
        }

        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.configured = true;
        console.log('🔔 Web Push configurado');
    }

    getPublicKey() {
        return process.env.VAPID_PUBLIC_KEY || null;
    }

    async saveSubscription(userId, subscription) {
        if (!subscription || !subscription.endpoint) {
            throw new Error('Suscripción inválida');
        }
        await database.query(
            `INSERT INTO push_subscriptions (user_id, endpoint, subscription_json)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                subscription_json = VALUES(subscription_json),
                updated_at = CURRENT_TIMESTAMP`,
            [userId, subscription.endpoint, JSON.stringify(subscription)]
        );
    }

    async removeSubscription(endpoint) {
        if (!endpoint) return;
        await database.delete('push_subscriptions', 'endpoint = ?', [endpoint]);
    }

    async sendToUser(userId, payload) {
        if (!this.configured) return;

        const rows = await database.findAll(
            'push_subscriptions',
            'user_id = ?',
            [userId]
        );

        if (rows.length === 0) return;

        const payloadStr = JSON.stringify(payload);

        await Promise.all(rows.map(async (row) => {
            try {
                const sub = JSON.parse(row.subscription_json);
                await webpush.sendNotification(sub, payloadStr, { TTL: 60 });
            } catch (err) {
                const status = err.statusCode;
                if (status === 404 || status === 410) {
                    // Suscripción caducada o desregistrada — limpiar
                    await this.removeSubscription(row.endpoint).catch(() => {});
                } else {
                    console.error('Push error:', status, err.body || err.message);
                }
            }
        }));
    }
}

module.exports = new PushService();
