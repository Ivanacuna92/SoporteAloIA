const database = require('./database');

class Logger {
    constructor() {
        this.logQueue = []; // Cola para logs en caso de error de BD
        this.isProcessingQueue = false;
    }

    async log(role, message, userId = null, userName = null, isGroup = false, response = null, supportUserId = null, messageId = null, mediaInfo = null, isForwarded = false, participant = null, quotedMsgInfo = null) {
        const timestamp = new Date();
        const logEntry = {
            timestamp: timestamp.toISOString(),
            role, // 'cliente', 'bot', 'soporte'
            userId,
            userName,
            isGroup,
            message,
            response,
            supportUserId,
            messageId,
            status: messageId ? 'sent' : null, // Si hay messageId, el mensaje fue enviado
            participant, // JID del participante que envió el mensaje (para grupos)
            // Información de medios
            has_media: mediaInfo?.has_media || false,
            media_type: mediaInfo?.media_type || null,
            media_url: mediaInfo?.media_url || null,
            media_mimetype: mediaInfo?.media_mimetype || null,
            media_filename: mediaInfo?.media_filename || null,
            media_caption: mediaInfo?.media_caption || null,
            // Información de mensaje reenviado
            is_forwarded: isForwarded || false,
            // Información de mensaje citado (reply)
            has_quoted_msg: quotedMsgInfo ? true : false,
            quoted_msg_body: quotedMsgInfo?.body || null,
            quoted_msg_participant: quotedMsgInfo?.participant || null,
            quoted_msg_id: quotedMsgInfo?.messageId || null
        };

        // Solo guardar en BD y mostrar en consola
        const insertedId = await this.saveToDB(logEntry);
        const mediaIndicator = mediaInfo?.has_media ? ` 📎[${mediaInfo.media_type}]` : '';
        const forwardIndicator = isForwarded ? ' 🔄[reenviado]' : '';
        this.printToConsole(logEntry.timestamp, role, message + mediaIndicator + forwardIndicator, userId, isGroup);

        return insertedId;
    }

    async saveToDB(logEntry) {
        // Solo guardar en BD si hay un userId válido (logs de conversaciones)
        if (!logEntry.userId) {
            return null; // Skip logs de sistema sin usuario
        }

        try {
            const result = await database.insert('conversation_logs', {
                timestamp: new Date(logEntry.timestamp),
                user_id: logEntry.userId,
                user_name: logEntry.userName,
                is_group: logEntry.isGroup || false,
                message: logEntry.message,
                message_id: logEntry.messageId || null,
                status: logEntry.status || null,
                response: logEntry.response || null,
                role: logEntry.role,
                support_user_id: logEntry.supportUserId || null,
                session_id: null,
                participant: logEntry.participant || null,
                // Campos de medios - convertir undefined a null
                has_media: logEntry.has_media || false,
                media_type: logEntry.media_type || null,
                media_url: logEntry.media_url || null,
                media_mimetype: logEntry.media_mimetype || null,
                media_filename: logEntry.media_filename || null,
                media_caption: logEntry.media_caption || null,
                // Campo de mensaje reenviado
                is_forwarded: logEntry.is_forwarded || false,
                // Campos de mensaje citado
                has_quoted_msg: logEntry.has_quoted_msg || false,
                quoted_msg_body: logEntry.quoted_msg_body || null,
                quoted_msg_participant: logEntry.quoted_msg_participant || null,
                quoted_msg_id: logEntry.quoted_msg_id || null
            });
            return result.insertId;
        } catch (error) {
            console.error('Error guardando log en BD:', error);
            // Agregar a cola para reintento posterior
            this.logQueue.push(logEntry);
            this.processLogQueue();
            return null;
        }
    }

    async processLogQueue() {
        if (this.isProcessingQueue || this.logQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        
        while (this.logQueue.length > 0) {
            const logEntry = this.logQueue.shift();
            
            // Skip logs sin userId
            if (!logEntry.userId) {
                continue;
            }
            
            try {
                await database.insert('conversation_logs', {
                    timestamp: new Date(logEntry.timestamp),
                    user_id: logEntry.userId,
                    user_name: logEntry.userName,
                    is_group: logEntry.isGroup || false,
                    message: logEntry.message,
                    response: logEntry.response,
                    role: logEntry.role,
                    support_user_id: logEntry.supportUserId,
                    session_id: null
                });
            } catch (error) {
                console.error('Error procesando cola de logs:', error);
                // Volver a agregar a la cola si falla
                this.logQueue.unshift(logEntry);
                break;
            }
        }
        
        this.isProcessingQueue = false;
    }


    printToConsole(timestamp, type, message, userId, isGroup = false) {
        const userInfo = userId ? ` (${isGroup ? 'Grupo' : 'Usuario'}: ${userId})` : '';
        const time = timestamp.split('T')[1].split('.')[0]; // Solo hora:minuto:segundo

        // Colores ANSI para terminal con fondos para mejor contraste
        const colors = {
            SYSTEM: '\x1b[46m\x1b[30m',    // Fondo Cyan, texto negro
            USER: '\x1b[42m\x1b[30m',      // Fondo Verde, texto negro
            BOT: '\x1b[43m\x1b[30m',       // Fondo Amarillo, texto negro
            ERROR: '\x1b[41m\x1b[37m',     // Fondo Rojo, texto blanco
            HUMAN: '\x1b[45m\x1b[37m',     // Fondo Magenta, texto blanco
            RESET: '\x1b[0m'                // Reset
        };

        const color = colors[type] || colors.RESET;
        const groupIcon = isGroup ? '👥 ' : '';
        console.log(`${color} [${time}] ${type} ${colors.RESET} ${groupIcon}${message}${userInfo}`);
    }

    async getLogs(date = null, limit = 1000, offset = 0) {
        try {
            // Solo obtener de BD
            let query = 'SELECT * FROM conversation_logs';
            let params = [];
            
            if (date) {
                query += ' WHERE DATE(timestamp) = ?';
                params.push(date);
            }
            
            query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            
            const dbLogs = await database.query(query, params);
            
            return dbLogs.map(log => {
                // Convertir roles a tipos esperados por el frontend
                let type = 'BOT';
                if (log.role === 'cliente') {
                    type = 'USER';
                } else if (log.role === 'bot') {
                    type = 'BOT';
                } else if (log.role === 'soporte' || log.role === 'HUMAN') {
                    type = 'HUMAN';
                } else if (log.role) {
                    type = log.role.toUpperCase();
                }

                return {
                    timestamp: log.timestamp.toISOString(),
                    type: type,
                    role: log.role,
                    userId: log.user_id,
                    userName: log.user_name,
                    isGroup: log.is_group || false,
                    message: log.message,
                    messageId: log.message_id,
                    status: log.status,
                    response: log.response,
                    supportUserId: log.support_user_id,
                    // Campos de medios
                    hasMedia: log.has_media || false,
                    mediaType: log.media_type,
                    mediaUrl: log.media_url,
                    mediaMimetype: log.media_mimetype,
                    mediaFilename: log.media_filename,
                    mediaCaption: log.media_caption,
                    // Campo de mensaje reenviado
                    isForwarded: log.is_forwarded || false
                };
            });
        } catch (error) {
            console.error('Error obteniendo logs de BD:', error);
            return [];
        }
    }

    async getAvailableDates() {
        try {
            // Solo obtener fechas de la BD
            const dates = await database.query(
                'SELECT DISTINCT DATE(timestamp) as date FROM conversation_logs ORDER BY date DESC'
            );
            
            return dates.map(row => row.date.toISOString().split('T')[0]);
        } catch (error) {
            console.error('Error obteniendo fechas de BD:', error);
            return [];
        }
    }

    async getStats(date = null) {
        try {
            let query = `
                SELECT
                    COUNT(*) as total_messages,
                    COUNT(DISTINCT user_id) as unique_users,
                    SUM(CASE WHEN is_human_response = 1 THEN 1 ELSE 0 END) as human_responses,
                    SUM(CASE WHEN is_human_response = 0 THEN 1 ELSE 0 END) as ai_responses
                FROM conversation_logs
            `;
            let params = [];

            if (date) {
                query += ' WHERE DATE(timestamp) = ?';
                params.push(date);
            }

            const stats = await database.query(query, params);
            return stats[0] || {
                total_messages: 0,
                unique_users: 0,
                human_responses: 0,
                ai_responses: 0
            };
        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            return {
                total_messages: 0,
                unique_users: 0,
                human_responses: 0,
                ai_responses: 0
            };
        }
    }

    async updateMessageStatus(messageId, status) {
        if (!messageId || !status) {
            return false;
        }

        try {
            await database.query(
                'UPDATE conversation_logs SET status = ? WHERE message_id = ?',
                [status, messageId]
            );
            return true;
        } catch (error) {
            console.error('Error actualizando estado de mensaje:', error);
            return false;
        }
    }

    async deleteConversation(userId) {
        if (!userId) {
            return false;
        }

        try {
            await database.query(
                'DELETE FROM conversation_logs WHERE user_id = ?',
                [userId]
            );
            console.log(`✅ Conversación eliminada para usuario: ${userId}`);
            return true;
        } catch (error) {
            console.error('Error eliminando conversación:', error);
            return false;
        }
    }

    async getLogsByClientPhone(clientPhone) {
        if (!clientPhone) {
            return [];
        }

        try {
            const logs = await database.query(
                'SELECT * FROM conversation_logs WHERE user_id = ? ORDER BY timestamp ASC',
                [clientPhone]
            );

            return logs.map(log => ({
                timestamp: log.timestamp.toISOString(),
                type: log.role === 'cliente' ? 'USER' : log.role === 'bot' ? 'BOT' : log.role === 'soporte' ? 'HUMAN' : log.role?.toUpperCase(),
                role: log.role,
                userId: log.user_id,
                userName: log.user_name,
                isGroup: log.is_group || false,
                message: log.message,
                messageId: log.message_id,
                status: log.status,
                response: log.response,
                supportUserId: log.support_user_id,
                participant: log.participant,
                // Campos de medios
                hasMedia: log.has_media || false,
                mediaType: log.media_type,
                mediaUrl: log.media_url,
                mediaMimetype: log.media_mimetype,
                mediaFilename: log.media_filename,
                mediaCaption: log.media_caption,
                // Campo de mensaje reenviado
                isForwarded: log.is_forwarded || false,
                // Campos de mensaje citado
                hasQuotedMsg: log.has_quoted_msg || false,
                quotedMsg: log.has_quoted_msg ? {
                    body: log.quoted_msg_body,
                    participant: log.quoted_msg_participant,
                    messageId: log.quoted_msg_id
                } : null
            }));
        } catch (error) {
            console.error('Error obteniendo logs por teléfono de cliente:', error);
            return [];
        }
    }

}

module.exports = new Logger();