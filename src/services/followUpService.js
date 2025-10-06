const database = require('./database');
const logger = require('./logger');
const aiService = require('./aiService');
const config = require('../config/config');

class FollowUpService {
    constructor() {
        this.followUps = new Map(); // userId -> { nextFollowUp, attempts, chatId }
        this.checkInterval = 60 * 60 * 1000; // Revisar cada hora
        this.followUpInterval = 24 * 60 * 60 * 1000; // 24 horas
        this.maxAttempts = 3; // Máximo 3 seguimientos
    }

    /**
     * Inicia un seguimiento para un usuario que dejó de responder
     */
    async startFollowUp(userId, chatId) {
        const now = Date.now();
        const nextFollowUp = now + this.followUpInterval;

        this.followUps.set(userId, {
            nextFollowUp,
            attempts: 0,
            chatId,
            startedAt: now
        });

        console.log(`🚀 Seguimiento iniciado para ${userId} - próximo mensaje en ${this.followUpInterval / 60000} minutos`);

        // Guardar en BD
        try {
            await database.query(
                `INSERT INTO follow_ups (user_id, next_follow_up, attempts, chat_id, started_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 next_follow_up = ?, attempts = ?, chat_id = ?, started_at = ?`,
                [userId, new Date(nextFollowUp), 0, chatId, new Date(now),
                 new Date(nextFollowUp), 0, chatId, new Date(now)]
            );

            await logger.log('SYSTEM', `Seguimiento iniciado - próximo mensaje en ${this.followUpInterval / 60000} min`, userId);
        } catch (error) {
            console.error('Error guardando seguimiento en BD:', error);
        }
    }

    /**
     * Cancela un seguimiento activo
     */
    async cancelFollowUp(userId, reason = 'Usuario respondió') {
        if (this.followUps.has(userId)) {
            this.followUps.delete(userId);

            try {
                await database.query('DELETE FROM follow_ups WHERE user_id = ?', [userId]);
                await logger.log('SYSTEM', `Seguimiento cancelado: ${reason}`, userId);
            } catch (error) {
                console.error('Error eliminando seguimiento de BD:', error);
            }
        }
    }

    /**
     * Verifica si un usuario tiene seguimiento activo
     */
    hasActiveFollowUp(userId) {
        return this.followUps.has(userId);
    }

    /**
     * Analiza el mensaje del usuario para determinar si debe detenerse el seguimiento
     */
    async analyzeUserResponse(userId, userMessage, conversationHistory) {
        try {
            // Crear prompt especial para análisis
            const analysisPrompt = [
                {
                    role: 'system',
                    content: `Eres un analizador de conversaciones. Debes determinar si el cliente:
1. ACEPTÓ el trato/propuesta (mostró interés genuino, quiere agendar, acepta reunión, etc.)
2. RECHAZÓ el trato/propuesta (no le interesa, dice no explícitamente, ya encontró alternativa, etc.)
3. Está FRUSTRADO/ENOJADO (molesto por insistencia, usa lenguaje agresivo, pide que dejen de escribir, etc.)

Responde ÚNICAMENTE con una de estas palabras: ACEPTADO, RECHAZADO, FRUSTRADO, CONTINUAR`
                },
                {
                    role: 'user',
                    content: `Contexto de conversación reciente:\n${conversationHistory.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n')}\n\nÚltimo mensaje del cliente:\n${userMessage}\n\n¿Qué indica este mensaje?`
                }
            ];

            const analysis = await aiService.generateResponse(analysisPrompt);
            const status = analysis.trim().toUpperCase();

            // Detener seguimiento según análisis
            if (status === 'ACEPTADO') {
                await this.cancelFollowUp(userId, 'Cliente aceptó el trato');
                return 'ACCEPTED';
            } else if (status === 'RECHAZADO') {
                await this.cancelFollowUp(userId, 'Cliente rechazó el trato');
                return 'REJECTED';
            } else if (status === 'FRUSTRADO') {
                await this.cancelFollowUp(userId, 'Cliente muestra frustración');
                return 'FRUSTRATED';
            }

            return 'CONTINUE';
        } catch (error) {
            console.error('Error analizando respuesta del usuario:', error);
            return 'CONTINUE';
        }
    }

    /**
     * Genera mensaje de seguimiento apropiado según el número de intento
     */
    getFollowUpMessage(attempts) {
        const messages = [
            // Primer seguimiento (24h)
            `Hola de nuevo 👋

Vi que quedamos en pausa

¿Sigues interesado en multiplicar tu capacidad de atención?

Si no es buen momento, avísame y te contacto después`,

            // Segundo seguimiento (48h)
            `Hola otra vez

Entiendo que estás ocupado

Solo te recuerdo que cada día sin esto siguen perdiendo leads

¿Te sirve una llamada de 20 min esta semana?`,

            // Tercer y último seguimiento (72h)
            `Último mensaje

No quiero saturarte, pero quería darte una última oportunidad

Si no te interesa, está bien - avísame y no te molesto más

¿Qué dices?`
        ];

        return messages[Math.min(attempts, messages.length - 1)];
    }

    /**
     * Procesa seguimientos pendientes
     */
    async processFollowUps(sock) {
        const now = Date.now();

        console.log(`🔍 Revisando seguimientos pendientes... (${this.followUps.size} activos)`);

        if (this.followUps.size > 0) {
            for (const [userId, followUp] of this.followUps.entries()) {
                const timeRemaining = followUp.nextFollowUp - now;
                const minutesRemaining = Math.floor(timeRemaining / 60000);
                console.log(`  - Usuario ${userId}: ${minutesRemaining} minutos restantes, intento ${followUp.attempts}/${this.maxAttempts}`);
            }
        }

        for (const [userId, followUp] of this.followUps.entries()) {
            // Verificar si es momento de enviar seguimiento
            if (now >= followUp.nextFollowUp) {
                console.log(`⏰ Es momento de enviar seguimiento a ${userId}`);

                // Verificar si alcanzó máximo de intentos
                if (followUp.attempts >= this.maxAttempts) {
                    await this.cancelFollowUp(userId, 'Máximo de intentos alcanzado');

                    // Enviar mensaje final de despedida
                    try {
                        const finalMessage = `Gracias por tu tiempo

Quedo disponible si en el futuro necesitas multiplicar tu capacidad de atención

¡Éxito! 👍`;

                        await sock.sendMessage(followUp.chatId, { text: finalMessage });
                        await logger.log('BOT', finalMessage, userId);
                    } catch (error) {
                        console.error('Error enviando mensaje final:', error);
                    }
                    continue;
                }

                // Enviar mensaje de seguimiento
                try {
                    const followUpMessage = this.getFollowUpMessage(followUp.attempts);
                    console.log(`📨 Enviando mensaje de seguimiento (intento ${followUp.attempts + 1}/${this.maxAttempts}) a ${userId}`);

                    // Verificar si el socket está conectado
                    if (!sock || !sock.user) {
                        console.log('⚠️ Bot desconectado, postponiendo seguimiento...');
                        // Postponer 5 minutos
                        followUp.nextFollowUp = now + (5 * 60 * 1000);
                        this.followUps.set(userId, followUp);
                        continue;
                    }

                    await sock.sendMessage(followUp.chatId, { text: followUpMessage });
                    await logger.log('BOT', followUpMessage, userId);

                    // Actualizar seguimiento
                    followUp.attempts++;
                    followUp.nextFollowUp = now + this.followUpInterval;
                    this.followUps.set(userId, followUp);

                    console.log(`✅ Seguimiento enviado. Próximo mensaje en ${this.followUpInterval / 60000} minutos`);

                    // Actualizar en BD
                    await database.query(
                        `UPDATE follow_ups
                         SET next_follow_up = ?, attempts = ?
                         WHERE user_id = ?`,
                        [new Date(followUp.nextFollowUp), followUp.attempts, userId]
                    );

                    await logger.log('SYSTEM', `Seguimiento enviado (intento ${followUp.attempts}/${this.maxAttempts})`, userId);
                } catch (error) {
                    console.error('❌ Error enviando seguimiento:', error.message || error);

                    // Si hay error de conexión, postponer el seguimiento
                    if (error.message && error.message.includes('Connection Closed')) {
                        console.log('⚠️ Conexión cerrada, reintentando en 5 minutos...');
                        followUp.nextFollowUp = now + (5 * 60 * 1000);
                        this.followUps.set(userId, followUp);
                    }
                }
            }
        }
    }

    /**
     * Carga seguimientos desde BD al iniciar
     */
    async loadFollowUpsFromDB() {
        try {
            const results = await database.query('SELECT * FROM follow_ups WHERE attempts < ?', [this.maxAttempts]);

            for (const row of results) {
                this.followUps.set(row.user_id, {
                    nextFollowUp: new Date(row.next_follow_up).getTime(),
                    attempts: row.attempts,
                    chatId: row.chat_id,
                    startedAt: new Date(row.started_at).getTime()
                });
            }

            console.log(`✅ ${results.length} seguimientos cargados desde BD`);
        } catch (error) {
            console.error('Error cargando seguimientos desde BD:', error);
        }
    }

    /**
     * Inicia el timer para procesar seguimientos
     */
    startFollowUpTimer(sock) {
        // Cargar seguimientos existentes
        this.loadFollowUpsFromDB();

        // Procesar cada hora
        setInterval(() => {
            this.processFollowUps(sock);
        }, this.checkInterval);

        console.log('✅ Servicio de seguimiento iniciado');
    }

}

module.exports = new FollowUpService();
