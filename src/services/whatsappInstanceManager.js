const makeWASocket = require('baileys').default;
const { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const database = require('./database');
const logger = require('./logger');
const aiService = require('./aiService');
const sessionManager = require('./sessionManager');
const promptLoader = require('./promptLoader');
const humanModeManager = require('./humanModeManager');
const followUpService = require('./followUpService');
const systemConfigService = require('./systemConfigService');
const path = require('path');
const fs = require('fs').promises;

class WhatsAppInstanceManager {
    constructor() {
        this.instances = new Map(); // Map<supportUserId, instanceData>
        this._profilePicCache = new Map(); // Map<jid, { url, ts }>
        this._profilePicTableReady = false;
        this._msgCache = new Map(); // Cache de WAMessages para forward - Map<messageId, WAMessage>
        this._reactionsTableReady = false;
    }

    // Crear tabla de reacciones si no existe
    async _ensureReactionsTable() {
        if (this._reactionsTableReady) return;
        try {
            await database.query(`
                CREATE TABLE IF NOT EXISTS message_reactions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    message_id VARCHAR(255) NOT NULL,
                    phone VARCHAR(100) NOT NULL,
                    emoji VARCHAR(20) NOT NULL,
                    participant VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_reaction (message_id, participant)
                )
            `);
            this._reactionsTableReady = true;
        } catch (e) {
            console.error('Error creando tabla message_reactions:', e.message);
        }
    }

    // Crear tabla de fotos de perfil si no existe
    async _ensureProfilePicTable() {
        if (this._profilePicTableReady) return;
        try {
            await database.query(`
                CREATE TABLE IF NOT EXISTS participant_profiles (
                    jid VARCHAR(100) PRIMARY KEY,
                    display_name VARCHAR(255),
                    profile_picture VARCHAR(512),
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_updated (updated_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            this._profilePicTableReady = true;
        } catch (e) {
            console.error('Error creando tabla participant_profiles:', e.message);
        }
    }

    // Obtener foto de perfil de un participante (con cache de 24h)
    async getParticipantProfilePic(sock, jid, displayName) {
        if (!jid) return null;
        await this._ensureProfilePicTable();

        // Cache en memoria (5 min)
        const cached = this._profilePicCache.get(jid);
        if (cached && (Date.now() - cached.ts) < 5 * 60 * 1000) {
            return cached.url;
        }

        // Buscar en BD (cache de 24h)
        try {
            const [rows] = await database.query(
                'SELECT profile_picture, updated_at FROM participant_profiles WHERE jid = ?', [jid]
            );
            if (rows && rows.length > 0 && rows[0].profile_picture) {
                const age = Date.now() - new Date(rows[0].updated_at).getTime();
                if (age < 24 * 60 * 60 * 1000) {
                    this._profilePicCache.set(jid, { url: rows[0].profile_picture, ts: Date.now() });
                    return rows[0].profile_picture;
                }
            }
        } catch (e) { /* continuar a descargar */ }

        // Descargar de WhatsApp
        try {
            const picUrl = await this.downloadAndSaveProfilePicture(sock, jid, 'participant');
            if (picUrl) {
                await database.query(
                    `INSERT INTO participant_profiles (jid, display_name, profile_picture) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE profile_picture = VALUES(profile_picture), display_name = VALUES(display_name)`,
                    [jid, displayName || null, picUrl]
                );
                this._profilePicCache.set(jid, { url: picUrl, ts: Date.now() });
                return picUrl;
            }
        } catch (e) {
            // Sin foto disponible
        }

        // Guardar null para no reintentar por 24h
        try {
            await database.query(
                `INSERT INTO participant_profiles (jid, display_name, profile_picture) VALUES (?, ?, NULL)
                 ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), updated_at = NOW()`,
                [jid, displayName || null]
            );
        } catch (e) { /* ignorar */ }
        this._profilePicCache.set(jid, { url: null, ts: Date.now() });
        return null;
    }

    // Obtener todas las instancias activas
    getInstances() {
        return Array.from(this.instances.entries()).map(([userId, data]) => ({
            userId,
            status: data.status,
            qr: data.qr,
            phone: data.phone,
            instanceName: data.instanceName
        }));
    }

    // Obtener instancia específica
    getInstance(supportUserId) {
        return this.instances.get(supportUserId);
    }

    // Crear/iniciar instancia para un usuario
    async startInstance(supportUserId, instanceName) {
        try {
            console.log(`🚀 Iniciando instancia de WhatsApp para usuario ${supportUserId}...`);

            // Verificar si ya existe una instancia activa
            if (this.instances.has(supportUserId)) {
                const existing = this.instances.get(supportUserId);
                if (existing.status === 'connected') {
                    console.log(`✅ Instancia ya conectada para usuario ${supportUserId}`);
                    return existing;
                }
                // Si existe pero no está conectada, la cerramos primero
                await this.stopInstance(supportUserId);
            }

            // Crear directorio de autenticación específico para este usuario
            const authPath = path.join(process.cwd(), 'auth_baileys', `user_${supportUserId}`);
            await fs.mkdir(authPath, { recursive: true });

            // Configurar autenticación multi-archivo
            const { state, saveCreds } = await useMultiFileAuthState(authPath);

            // Obtener versión más reciente de Baileys
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`Usando versión de WhatsApp Web: ${version.join('.')} (última: ${isLatest})`);

            // Crear socket de WhatsApp
            const sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ['Chrome (Linux)', '', ''],
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                getMessage: async (key) => {
                    try {
                        const db = require('./database');
                        const rows = await db.query(
                            'SELECT message FROM conversation_logs WHERE message_id = ? LIMIT 1',
                            [key.id]
                        );
                        if (rows && rows.length > 0 && rows[0].message) {
                            return { conversation: rows[0].message };
                        }
                    } catch (e) {}
                    return { conversation: '' };
                },
                defaultQueryTimeoutMs: undefined,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                qrTimeout: undefined,
                markOnlineOnConnect: true,
                msgRetryCounterCache: new Map(),
                retryRequestDelayMs: 250,
                maxMsgRetryCount: 5
            });

            // Datos de la instancia
            const instanceData = {
                sock,
                supportUserId,
                instanceName,
                status: 'disconnected',
                qr: null,
                phone: null,
                reconnectAttempts: 0,
                maxReconnectAttempts: 3,
                isReconnecting: false
            };

            this.instances.set(supportUserId, instanceData);

            // Guardar credenciales cuando se actualicen
            sock.ev.on('creds.update', saveCreds);

            // Manejar actualizaciones de conexión
            sock.ev.on('connection.update', async (update) => {
                await this.handleConnectionUpdate(supportUserId, update, authPath);
            });

            // Manejar actualizaciones de estado de mensajes
            sock.ev.on('messages.update', async (updates) => {
                console.log('📊 [MSG-UPDATE] Recibido:', updates.length, 'updates');
                await this.handleMessagesUpdate(supportUserId, updates);
            });

            // Recibos de lectura/entrega (importante para grupos)
            sock.ev.on('message-receipt.update', async (updates) => {
                console.log('📬 [RECEIPT-HANDLER] Recibidos:', updates.length, 'receipts');
                for (const update of updates) {
                    try {
                        const messageId = update.key.id;
                        const receipt = update.receipt;
                        const remoteJid = update.key.remoteJid;
                        const userJid = receipt.userJid;
                        // En Baileys 6, el receipt NO tiene .type
                        // Tiene .readTimestamp (leído) o .receiptTimestamp (entregado)
                        let receiptType = receipt.readTimestamp ? 'read' : 'delivered';
                        console.log('📬 [RECEIPT]', messageId, 'user:', userJid, 'status:', receiptType, 'data:', JSON.stringify(receipt));

                        // Guardar receipt individual en BD
                        if (userJid && remoteJid?.endsWith('@g.us')) {
                            const ts = receipt.readTimestamp || receipt.receiptTimestamp;
                            const receiptTs = ts ? new Date(ts * 1000) : new Date();
                            try {
                                await database.query(
                                    `INSERT INTO message_receipts (message_id, group_jid, participant_jid, receipt_type, receipt_timestamp)
                                     VALUES (?, ?, ?, ?, ?)
                                     ON DUPLICATE KEY UPDATE receipt_timestamp = VALUES(receipt_timestamp)`,
                                    [messageId, remoteJid, userJid, receiptType, receiptTs]
                                );
                                if (receiptType === 'read') {
                                    await database.query(
                                        `INSERT IGNORE INTO message_receipts (message_id, group_jid, participant_jid, receipt_type, receipt_timestamp)
                                         VALUES (?, ?, ?, 'delivered', ?)`,
                                        [messageId, remoteJid, userJid, receiptTs]
                                    );
                                }
                            } catch (e) {}
                        }

                        // Determinar status agregado para conversation_logs
                        let status = receiptType;
                        if (receiptType === 'delivered') {
                            // Si ya estaba en delivered y llega otro receipt, podría ser read
                            try {
                                const existing = await database.query('SELECT status FROM conversation_logs WHERE message_id = ? LIMIT 1', [messageId]);
                                if (existing.length > 0 && existing[0].status === 'delivered') {
                                    // Revisar si hay algun receipt de tipo read en la tabla
                                    const readReceipts = await database.query(
                                        'SELECT COUNT(*) as cnt FROM message_receipts WHERE message_id = ? AND receipt_type = ?',
                                        [messageId, 'read']
                                    );
                                    if (readReceipts[0]?.cnt > 0) status = 'read';
                                }
                            } catch (e) {}
                        }

                        if (status && messageId) {
                            await logger.updateMessageStatus(messageId, status);
                            const groupId = remoteJid?.replace('@g.us', '');
                            if (global.io && groupId) {
                                global.io.emit('new-message', { phone: groupId, statusUpdate: true });
                            }
                        }
                    } catch (e) {
                        console.log('Error procesando receipt:', e.message);
                    }
                }
            });

            // Manejar mensajes entrantes
            sock.ev.on('messages.upsert', async (m) => {
                await this.handleIncomingMessage(supportUserId, m);
            });

            // Actualizar BD
            await this.updateInstanceInDB(supportUserId, {
                instance_name: instanceName,
                status: 'disconnected'
            });

            return instanceData;
        } catch (error) {
            console.error(`Error iniciando instancia para usuario ${supportUserId}:`, error);
            throw error;
        }
    }

    // Manejar actualización de conexión
    async handleConnectionUpdate(supportUserId, update, authPath) {
        const { connection, lastDisconnect, qr } = update;
        const instanceData = this.instances.get(supportUserId);

        if (!instanceData) return;

        if (qr) {
            console.log(`📱 QR generado para usuario ${supportUserId}`);
            instanceData.qr = qr;
            instanceData.status = 'qr_ready';

            qrcode.generate(qr, { small: true });

            // Actualizar en BD
            await this.updateInstanceInDB(supportUserId, {
                qr_code: qr,
                status: 'qr_ready',
                last_qr_generated: new Date()
            });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`❌ Conexión cerrada para usuario ${supportUserId}. Código: ${statusCode}`);

            instanceData.status = 'disconnected';
            instanceData.qr = null;

            await this.updateInstanceInDB(supportUserId, {
                status: 'disconnected',
                qr_code: null
            });

            if (statusCode === 405 || statusCode === 401 || statusCode === 403) {
                instanceData.reconnectAttempts++;

                if (instanceData.reconnectAttempts > instanceData.maxReconnectAttempts) {
                    console.log(`❌ Máximo de intentos alcanzado para usuario ${supportUserId}`);
                    instanceData.isReconnecting = false;
                    return;
                }

                console.log(`🔄 Limpiando sesión para usuario ${supportUserId}...`);
                await this.clearSession(authPath);

                instanceData.isReconnecting = false;
                setTimeout(() => this.startInstance(supportUserId, instanceData.instanceName), 5000);
            } else if (shouldReconnect && statusCode !== DisconnectReason.loggedOut) {
                instanceData.reconnectAttempts = 0;
                instanceData.isReconnecting = false;
                setTimeout(() => this.startInstance(supportUserId, instanceData.instanceName), 5000);
            }
        } else if (connection === 'open') {
            console.log(`✅ WhatsApp conectado para usuario ${supportUserId}`);

            // Registrar listener de receipts al conectar
            if (!instanceData._receiptListenerAdded) {
                instanceData._receiptListenerAdded = true;
                instanceData.sock.ev.on('message-receipt.update', async (updates) => {
                    console.log('📬 [RECEIPT-HANDLER] Recibidos:', updates.length);
                    for (const update of updates) {
                        try {
                            const messageId = update.key.id;
                            const receipt = update.receipt;
                            const remoteJid = update.key.remoteJid;
                            const userJid = receipt.userJid;
                            const receiptType = receipt.readTimestamp ? 'read' : 'delivered';
                            const ts = receipt.readTimestamp || receipt.receiptTimestamp;
                            const receiptTs = ts ? new Date(ts * 1000) : new Date();

                            console.log('📬 [RECEIPT]', messageId, userJid, receiptType);

                            // Guardar receipt individual
                            if (userJid && remoteJid?.endsWith('@g.us')) {
                                try {
                                    await database.query(
                                        `INSERT INTO message_receipts (message_id, group_jid, participant_jid, receipt_type, receipt_timestamp)
                                         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE receipt_timestamp = VALUES(receipt_timestamp)`,
                                        [messageId, remoteJid, userJid, receiptType, receiptTs]
                                    );
                                    if (receiptType === 'read') {
                                        await database.query(
                                            `INSERT IGNORE INTO message_receipts (message_id, group_jid, participant_jid, receipt_type, receipt_timestamp)
                                             VALUES (?, ?, ?, 'delivered', ?)`,
                                            [messageId, remoteJid, userJid, receiptTs]
                                        );
                                    }
                                } catch (e) {}
                            }

                            // Actualizar status agregado
                            await logger.updateMessageStatus(messageId, receiptType);
                            const groupId = remoteJid?.replace('@g.us', '');
                            if (global.io && groupId) {
                                global.io.emit('new-message', { phone: groupId, statusUpdate: true });
                            }
                        } catch (e) {
                            console.log('Error receipt:', e.message);
                        }
                    }
                });
                console.log('✅ Receipt listener registrado');
            }

            instanceData.status = 'connected';
            instanceData.qr = null;
            instanceData.reconnectAttempts = 0;
            instanceData.isReconnecting = false;

            // Obtener número de teléfono
            const phoneNumber = instanceData.sock.user?.id?.split(':')[0] || null;
            instanceData.phone = phoneNumber;

            await this.updateInstanceInDB(supportUserId, {
                status: 'connected',
                qr_code: null,
                phone_number: phoneNumber,
                connected_at: new Date(),
                last_activity: new Date()
            });

            await logger.log('SYSTEM', `Bot iniciado para usuario ${supportUserId}`, supportUserId, instanceData.instanceName);
        }
    }

    // Manejar actualizaciones de estado de mensajes
    async handleMessagesUpdate(supportUserId, updates) {
        for (const update of updates) {
            try {
                const messageId = update.key.id;
                const userId = update.key.remoteJid?.replace('@s.whatsapp.net', '');

                console.log('📊 [MSG-UPDATE]', messageId, 'update:', JSON.stringify(update.update).substring(0, 200));

                let status = null;
                const s = update.update.status;

                if (s === 4 || s === 'READ' || s === 'read') {
                    status = 'read';
                } else if (s === 3 || s === 2 || s === 'DELIVERY_ACK' || s === 'delivered') {
                    status = 'delivered';
                } else if (s === 1 || s === 'SERVER_ACK' || s === 'sent') {
                    status = 'sent';
                }

                if (status && messageId) {
                    await logger.updateMessageStatus(messageId, status);
                    const groupId = update.key.remoteJid?.replace('@g.us', '');
                    if (global.io && groupId) {
                        global.io.emit('new-message', { phone: groupId, statusUpdate: true });
                    }
                }

                // Detectar mensaje editado
                const editedMsg = update.update?.message?.editedMessage?.message;
                if (editedMsg && messageId) {
                    const newText = editedMsg.conversation ||
                                   editedMsg.extendedTextMessage?.text || '';
                    if (newText) {
                        try {
                            await database.query(
                                'UPDATE conversation_logs SET message = ?, is_edited = 1 WHERE message_id = ?',
                                [newText, messageId]
                            );
                            const groupId = update.key.remoteJid?.replace('@g.us', '');
                            if (global.io) {
                                global.io.emit('new-message', { phone: groupId, edited: true });
                            }
                        } catch (e) {
                            console.log('Error actualizando mensaje editado:', e.message);
                        }
                    }
                }
            } catch (error) {
                console.error('Error actualizando estado de mensaje:', error);
            }
        }
    }

    // Manejar mensaje entrante
    async handleIncomingMessage(supportUserId, m) {
        try {
            const msg = m.messages[0];
            if (!msg.message) return;

            // Detectar reacciones
            if (msg.message.reactionMessage) {
                const reaction = msg.message.reactionMessage;
                const targetId = reaction.key?.id;
                const emoji = reaction.text || '';
                const from = msg.key.remoteJid;
                const groupId = from?.replace('@g.us', '');
                const participant = msg.key.participant || msg.key.remoteJid;

                // Persistir reacción en DB
                try {
                    await this._ensureReactionsTable();
                    if (emoji) {
                        await database.query(
                            `INSERT INTO message_reactions (message_id, phone, emoji, participant)
                             VALUES (?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE emoji = VALUES(emoji)`,
                            [targetId, groupId, emoji, participant]
                        );
                    } else {
                        await database.query(
                            `DELETE FROM message_reactions WHERE message_id = ? AND participant = ?`,
                            [targetId, participant]
                        );
                    }
                } catch (e) {
                    console.error('Error guardando reacción en DB:', e.message);
                }

                if (global.io && groupId) {
                    global.io.emit('reaction', {
                        phone: groupId,
                        messageId: targetId,
                        emoji: emoji,
                        participant: participant,
                        fromMe: msg.key.fromMe
                    });
                }
                return; // Las reacciones no se loguean como mensajes
            }

            // Cachear WAMessage para forward nativo
            if (msg.key.id) {
                this._msgCache.set(msg.key.id, msg);
                // Limitar cache a 500 mensajes
                if (this._msgCache.size > 500) {
                    const firstKey = this._msgCache.keys().next().value;
                    this._msgCache.delete(firstKey);
                }
            }

            const instanceData = this.instances.get(supportUserId);
            if (!instanceData || !instanceData.sock) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');

            // Si es un mensaje propio (fromMe), registrarlo como mensaje de soporte
            if (msg.key.fromMe) {
                // Solo procesar mensajes de grupos
                if (!isGroup) {
                    console.log('📛 Mensaje propio en chat privado ignorado - Solo grupos');
                    return;
                }

                // Extraer el texto del mensaje
                const conversation = msg.message.conversation ||
                                   msg.message.extendedTextMessage?.text ||
                                   msg.message.imageMessage?.caption ||
                                   msg.message.videoMessage?.caption ||
                                   msg.message.documentMessage?.caption ||
                                   '';

                // Detectar si el mensaje tiene medios
                const hasMedia = !!(
                    msg.message.imageMessage ||
                    msg.message.videoMessage ||
                    msg.message.documentMessage ||
                    msg.message.audioMessage ||
                    msg.message.stickerMessage
                );

                // Si no hay conversación ni medios, ignorar
                if (!conversation && !hasMedia) return;

                const groupId = from.replace('@g.us', '');
                const messageId = msg.key.id;

                // Procesar medios si existen
                let mediaInfo = null;
                if (hasMedia) {
                    mediaInfo = await this.downloadAndSaveMedia(msg, groupId);
                }

                // Verificar que el grupo esté asignado a este usuario
                const existingAssignment = await this.getClientAssignment(groupId);
                if (!existingAssignment || existingAssignment.support_user_id !== supportUserId) {
                    console.log(`⏭️  Mensaje propio ignorado: Grupo ${groupId} no asignado o asignado a otro usuario`);
                    return;
                }

                // Obtener nombre del usuario de soporte
                const user = await database.findOne('support_users', 'id = ?', [supportUserId]);
                const userName = user ? user.name : 'Soporte';

                // Detectar si es respuesta a otro mensaje
                const contextInfo = msg.message.extendedTextMessage?.contextInfo ||
                                   msg.message.imageMessage?.contextInfo ||
                                   msg.message.videoMessage?.contextInfo ||
                                   msg.message.documentMessage?.contextInfo ||
                                   msg.message.audioMessage?.contextInfo || {};
                let quotedMsgInfo = null;
                if (contextInfo.quotedMessage) {
                    const quotedBody = contextInfo.quotedMessage.conversation ||
                                      contextInfo.quotedMessage.extendedTextMessage?.text ||
                                      '[Mensaje sin texto]';
                    quotedMsgInfo = {
                        body: quotedBody,
                        participant: contextInfo.participant || null,
                        messageId: contextInfo.stanzaId || null
                    };
                }

                // Detectar si es reenviado
                const isForwarded = !!(contextInfo.isForwarded || contextInfo.forwardingScore > 0);

                // Registrar mensaje como enviado por soporte
                await logger.log('soporte', conversation || '', groupId, userName, true, null, supportUserId, messageId, mediaInfo, isForwarded, null, quotedMsgInfo);

                // Emitir evento en tiempo real
                if (global.io) {
                    global.io.emit('new-message', { phone: groupId, userName, message: conversation || '' });
                }

                console.log(`✅ Mensaje propio registrado para grupo ${groupId}`);
                return;
            }

            // Solo aceptar mensajes de grupos - Ignorar mensajes privados/directos
            if (!isGroup) {
                console.log('📛 Mensaje privado ignorado - Solo se responde en grupos');
                return;
            }

            // Extraer el texto del mensaje
            let conversation = msg.message.conversation ||
                               msg.message.extendedTextMessage?.text ||
                               msg.message.imageMessage?.caption ||
                               msg.message.videoMessage?.caption ||
                               msg.message.documentMessage?.caption ||
                               '';

            // Procesar menciones - Capturar información de usuarios mencionados
            const mentionedJids = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            let mentionsInfo = [];

            // Detectar si es mensaje reenviado
            const contextInfo = msg.message.extendedTextMessage?.contextInfo ||
                               msg.message.imageMessage?.contextInfo ||
                               msg.message.videoMessage?.contextInfo ||
                               msg.message.documentMessage?.contextInfo || {};

            const isForwarded = contextInfo.isForwarded || contextInfo.forwardingScore > 0 || false;
            const forwardingScore = contextInfo.forwardingScore || 0;

            // Detectar si es respuesta a otro mensaje (quoted message)
            let quotedMsgInfo = null;
            if (contextInfo.quotedMessage) {
                const quotedBody = contextInfo.quotedMessage.conversation ||
                                  contextInfo.quotedMessage.extendedTextMessage?.text ||
                                  contextInfo.quotedMessage.imageMessage?.caption ||
                                  contextInfo.quotedMessage.videoMessage?.caption ||
                                  '[Mensaje sin texto]';

                quotedMsgInfo = {
                    body: quotedBody,
                    participant: contextInfo.participant || null,
                    messageId: contextInfo.stanzaId || null
                };
                console.log('💬 Mensaje es respuesta a:', quotedBody.substring(0, 50));
            }

            // DEBUG: Imprimir estructura completa del mensaje para análisis
            if (mentionedJids.length > 0 || isForwarded) {
                console.log('\n========== DEBUG MENSAJE ==========');
                console.log('📝 Texto visible:', conversation);
                console.log('🔄 Es reenviado:', isForwarded);
                console.log('🔄 Forwarding score:', forwardingScore);
                if (mentionedJids.length > 0) {
                    console.log('📝 MentionedJids:', mentionedJids);
                    console.log('📝 ContextInfo completo:', JSON.stringify(contextInfo, null, 2));
                }
                console.log('===================================\n');
            }

            if (mentionedJids.length > 0) {
                console.log(`📝 Procesando ${mentionedJids.length} menciones en el mensaje`);

                for (const jid of mentionedJids) {
                    const phoneNumber = jid.replace('@s.whatsapp.net', '');
                    try {
                        // Obtener el nombre del contacto mencionado
                        const mentionedName = await this.getContactName(instanceData.sock, jid, from);

                        if (mentionedName) {
                            mentionsInfo.push({
                                jid: jid,
                                phoneNumber: phoneNumber,
                                name: mentionedName
                            });
                            console.log(`✅ Mención detectada - JID: ${jid}, Teléfono: ${phoneNumber}, Nombre: ${mentionedName}`);
                        }
                    } catch (error) {
                        console.log(`❌ Error obteniendo info de mención ${phoneNumber}:`, error.message);
                    }
                }

                // Reemplazar menciones en el texto
                if (conversation && mentionsInfo.length > 0) {
                    // Clonar lista de menciones para ir consumiéndolas en orden
                    const remainingMentions = [...mentionsInfo];

                    for (const mention of mentionsInfo) {
                        let replaced = false;

                        // Estrategia 1: Buscar @numero completo
                        const fullNumberPattern = new RegExp(`@${mention.phoneNumber.replace(/[+]/g, '\\+')}`, 'g');
                        if (conversation.includes(`@${mention.phoneNumber}`)) {
                            conversation = conversation.replace(fullNumberPattern, `@${mention.name}`);
                            replaced = true;
                            console.log(`✅ Reemplazo exitoso (número completo): @${mention.phoneNumber} → @${mention.name}`);
                        }

                        // Estrategia 2: Buscar @ultimos10digitos
                        if (!replaced && mention.phoneNumber.length >= 10) {
                            const last10 = mention.phoneNumber.slice(-10);
                            if (conversation.includes(`@${last10}`)) {
                                conversation = conversation.replace(new RegExp(`@${last10}`, 'g'), `@${mention.name}`);
                                replaced = true;
                                console.log(`✅ Reemplazo exitoso (últimos 10): @${last10} → @${mention.name}`);
                            }
                        }

                        // Estrategia 3: Buscar @numero parcial
                        if (!replaced) {
                            const matches = [...conversation.matchAll(/@(\d+)/g)];
                            for (const match of matches) {
                                const foundNumber = match[1];
                                if (mention.phoneNumber.includes(foundNumber) || foundNumber.includes(mention.phoneNumber)) {
                                    conversation = conversation.replace(`@${foundNumber}`, `@${mention.name}`);
                                    replaced = true;
                                    console.log(`✅ Reemplazo exitoso (match parcial): @${foundNumber} → @${mention.name}`);
                                    break;
                                }
                            }
                        }

                        if (replaced) {
                            remainingMentions.shift();
                        }
                    }

                    // Estrategia 4: Reemplazar @@lid secuencialmente con las menciones restantes
                    // WhatsApp con LIDs envía el texto como "@@lid" literal para cada mención
                    for (const mention of remainingMentions) {
                        if (conversation.includes('@@lid')) {
                            conversation = conversation.replace('@@lid', `@${mention.name}`);
                            console.log(`✅ Reemplazo exitoso (@@lid): @@lid → @${mention.name}`);
                        } else {
                            console.log(`⚠️  No se pudo reemplazar mención de ${mention.name} en el texto`);
                        }
                    }

                    // Si aún quedan @@lid sin resolver, limpiarlos
                    if (conversation.includes('@@lid')) {
                        conversation = conversation.replace(/@@lid/g, '@usuario');
                        console.log(`⚠️  Quedaron @@lid sin resolver, reemplazados con @usuario`);
                    }
                }

                console.log(`📝 Mensaje final procesado: "${conversation}"`);
            }

            // Detectar si el mensaje tiene medios
            const hasMedia = !!(
                msg.message.imageMessage ||
                msg.message.videoMessage ||
                msg.message.documentMessage ||
                msg.message.audioMessage ||
                msg.message.stickerMessage
            );

            // Si no hay conversación ni medios, ignorar
            if (!conversation && !hasMedia) return;

            // Para grupos: obtener ID del grupo y del participante
            const groupId = from.replace('@g.us', '');
            const participantId = msg.key.participant ? msg.key.participant.replace('@s.whatsapp.net', '') : '';

            // Obtener nombre del grupo (intentar desde el mensaje o usar el ID)
            let groupName = groupId;
            let groupPicture = null;
            try {
                const groupMetadata = await instanceData.sock.groupMetadata(from);
                groupName = groupMetadata.subject || groupId;

                // Cachear participantes del grupo
                try {
                    for (const p of groupMetadata.participants) {
                        const pJid = p.lid || p.id;
                        const phoneJid = p.id.endsWith('@s.whatsapp.net') ? p.id : (p.lid ? p.id : null);
                        await database.query(
                            `INSERT INTO group_participants (group_jid, participant_jid, phone_jid, display_name, admin_role)
                             VALUES (?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE phone_jid = COALESCE(VALUES(phone_jid), phone_jid),
                                                      display_name = COALESCE(VALUES(display_name), display_name),
                                                      admin_role = VALUES(admin_role)`,
                            [from, pJid, phoneJid, p.notify || p.verifiedName || null, p.admin || null]
                        );
                        // También guardar mapeo inverso si tiene LID y phone
                        if (p.lid && p.id.endsWith('@s.whatsapp.net')) {
                            await database.query(
                                `INSERT INTO group_participants (group_jid, participant_jid, phone_jid, display_name, admin_role)
                                 VALUES (?, ?, ?, ?, ?)
                                 ON DUPLICATE KEY UPDATE phone_jid = COALESCE(VALUES(phone_jid), phone_jid),
                                                          display_name = COALESCE(VALUES(display_name), display_name)`,
                                [from, p.lid, p.id, p.notify || p.verifiedName || null, p.admin || null]
                            );
                        }
                    }
                } catch (e) {}

                // Descargar y guardar imagen de perfil del grupo localmente
                try {
                    groupPicture = await this.downloadAndSaveProfilePicture(instanceData.sock, from, 'group');
                } catch (picError) {
                    console.log('No se pudo descargar imagen del grupo');
                }
            } catch (error) {
                console.log('No se pudo obtener metadata del grupo, usando ID');
            }

            const userName = msg.pushName || participantId || 'Usuario desconocido';

            // Actualizar cache de participante con nombre
            if (msg.key.participant && userName !== 'Usuario desconocido') {
                try {
                    await database.query(
                        `INSERT INTO group_participants (group_jid, participant_jid, display_name)
                         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE display_name = COALESCE(VALUES(display_name), display_name)`,
                        [from, msg.key.participant, userName]
                    );
                } catch (e) {}
            }

            // Obtener foto de perfil del participante (async, no bloquea)
            let participantPic = null;
            const participantJid = msg.key.participant || null;
            if (participantJid) {
                try {
                    participantPic = await this.getParticipantProfilePic(instanceData.sock, participantJid, userName);
                } catch (e) { /* silenciar */ }
            }

            // VERIFICAR SI EL GRUPO ESTÁ ASIGNADO A OTRO USUARIO DE SOPORTE
            const existingAssignment = await this.getClientAssignment(groupId);

            if (existingAssignment && existingAssignment.support_user_id !== supportUserId) {
                // Este grupo está asignado a otro usuario de soporte, ignorar el mensaje
                console.log(`⏭️  Mensaje ignorado: Grupo ${groupId} está asignado a usuario ${existingAssignment.support_user_id}, no a ${supportUserId}`);
                return;
            }

            // Procesar medios si existen
            let mediaInfo = null;
            if (hasMedia) {
                mediaInfo = await this.downloadAndSaveMedia(msg, groupId);
            }

            // Mensaje a guardar (solo el caption/texto si existe, vacío si es solo media)
            const messageText = conversation || '';

            // Log del mensaje con información del grupo y medios
            // Extraer messageId y participant para poder responder a este mensaje
            const messageId = msg.key.id;
            const participant = msg.key.participant || null;
            await logger.log('cliente', messageText, groupId, userName, true, null, supportUserId, messageId, mediaInfo, isForwarded, participant, quotedMsgInfo);

            // Emitir evento en tiempo real via WebSocket
            if (global.io) {
                global.io.emit('new-message', {
                    phone: groupId,
                    groupName,
                    userName,
                    message: messageText,
                    participant,
                    participantPic,
                    messageId,
                    timestamp: new Date().toISOString(),
                    hasMedia: !!mediaInfo?.has_media,
                    mediaType: mediaInfo?.media_type || null
                });
            }

            // Asignar grupo a este usuario de soporte si no está asignado
            await this.assignClientToUser(groupId, supportUserId, true, groupName, groupPicture);

            // YA NO HAY IA - Solo registrar el mensaje entrante
            // Los humanos responderán manualmente desde el panel
            const mediaEmoji = hasMedia ? '📎 ' : '';
            await logger.log('SYSTEM', `${mediaEmoji}Mensaje recibido en grupo ${groupName} de ${userName} (${participantId}) - Esperando respuesta humana`, supportUserId);

            // Cancelar seguimiento si existe
            if (followUpService.hasActiveFollowUp(groupId)) {
                await followUpService.cancelFollowUp(groupId, 'Cliente respondió');
            }

        } catch (error) {
            console.error(`Error procesando mensaje (Usuario ${supportUserId}):`, error);
        }
    }

    // Descargar y guardar medios
    async downloadAndSaveMedia(msg, userId) {
        try {
            let mediaMessage = null;
            let mediaType = null;
            let mimetype = null;
            let filename = null;

            // Helper para extraer extensión limpia del mimetype (ej: "audio/ogg; codecs=opus" -> "ogg")
            const getExtFromMime = (mime) => {
                const part = mime.split('/')[1] || '';
                return part.split(';')[0].trim(); // Remover parámetros como "; codecs=opus"
            };

            // Identificar tipo de medio
            if (msg.message.imageMessage) {
                mediaMessage = msg.message.imageMessage;
                mediaType = 'image';
                mimetype = mediaMessage.mimetype || 'image/jpeg';
                filename = `${userId}_${Date.now()}.${getExtFromMime(mimetype)}`;
            } else if (msg.message.videoMessage) {
                mediaMessage = msg.message.videoMessage;
                mediaType = 'video';
                mimetype = mediaMessage.mimetype || 'video/mp4';
                filename = `${userId}_${Date.now()}.${getExtFromMime(mimetype)}`;
            } else if (msg.message.documentMessage) {
                mediaMessage = msg.message.documentMessage;
                mediaType = 'document';
                mimetype = mediaMessage.mimetype || 'application/octet-stream';
                filename = mediaMessage.fileName || `${userId}_${Date.now()}.${getExtFromMime(mimetype)}`;
            } else if (msg.message.audioMessage) {
                mediaMessage = msg.message.audioMessage;
                mediaType = 'audio';
                mimetype = mediaMessage.mimetype || 'audio/ogg';
                // Para audios de WhatsApp, usar .ogg como extensión por defecto
                const ext = getExtFromMime(mimetype) || 'ogg';
                filename = `${userId}_${Date.now()}.${ext}`;
            } else if (msg.message.stickerMessage) {
                mediaMessage = msg.message.stickerMessage;
                mediaType = 'sticker';
                mimetype = mediaMessage.mimetype || 'image/webp';
                filename = `${userId}_${Date.now()}.webp`;
            }

            if (!mediaMessage) {
                return null;
            }

            // Descargar el medio
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                    logger: pino({ level: 'silent' })
                }
            );

            // Determinar directorio según tipo
            const mediaDir = path.join(process.cwd(), 'data', 'media', `${mediaType}s`);
            await fs.mkdir(mediaDir, { recursive: true });

            // Guardar archivo
            const filePath = path.join(mediaDir, filename);
            await fs.writeFile(filePath, buffer);

            // Generar URL relativa para el frontend
            const mediaUrl = `/media/${mediaType}s/${filename}`;

            console.log(`📎 Medio guardado: ${mediaType} - ${filename}`);

            return {
                has_media: true,
                media_type: mediaType,
                media_url: mediaUrl,
                media_mimetype: mimetype,
                media_filename: filename,
                media_caption: msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || null
            };

        } catch (error) {
            console.error('Error descargando medio:', error);
            return null;
        }
    }

    // Descargar y guardar foto de perfil
    async downloadAndSaveProfilePicture(sock, jid, type = 'group') {
        try {
            // Intentar obtener la URL de la foto de perfil
            const profilePicUrl = await sock.profilePictureUrl(jid, 'image');

            if (!profilePicUrl) {
                console.log(`No hay foto de perfil disponible para ${jid}`);
                return null;
            }

            // Descargar la imagen
            const https = require('https');
            const imageBuffer = await new Promise((resolve, reject) => {
                https.get(profilePicUrl, (response) => {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => resolve(Buffer.concat(chunks)));
                    response.on('error', reject);
                }).on('error', reject);
            });

            // Crear directorio para fotos de perfil
            const profilePicsDir = path.join(process.cwd(), 'data', 'media', 'profile_pictures');
            await fs.mkdir(profilePicsDir, { recursive: true });

            // Generar nombre de archivo único
            const cleanJid = jid.replace('@g.us', '').replace('@s.whatsapp.net', '');
            const filename = `${type}_${cleanJid}_${Date.now()}.jpg`;
            const filePath = path.join(profilePicsDir, filename);

            // Guardar archivo
            await fs.writeFile(filePath, imageBuffer);

            // Generar URL relativa para el frontend
            const profilePicUrl_local = `/media/profile_pictures/${filename}`;

            console.log(`📸 Foto de perfil guardada: ${type} - ${filename}`);

            return profilePicUrl_local;
        } catch (error) {
            // Es normal que algunos usuarios/grupos no tengan foto de perfil
            console.log(`No se pudo obtener foto de perfil para ${jid}: ${error.message}`);
            return null;
        }
    }

    // Procesar mensaje y generar respuesta
    async processMessage(supportUserId, userId, userMessage, chatId) {
        await sessionManager.addMessage(userId, 'user', userMessage, chatId);

        const isGroup = chatId.endsWith('@g.us');
        const systemPrompt = promptLoader.getPrompt(isGroup);

        const messages = [
            { role: 'system', content: systemPrompt },
            ...(await sessionManager.getMessages(userId, chatId))
        ];

        const aiResponse = await aiService.generateResponse(messages);

        if (aiResponse.includes('{{ACTIVAR_SOPORTE}}')) {
            const cleanResponse = aiResponse.replace('{{ACTIVAR_SOPORTE}}', '').trim();
            await humanModeManager.setMode(userId, 'support');
            await sessionManager.updateSessionMode(userId, chatId, 'support');
            await sessionManager.addMessage(userId, 'assistant', cleanResponse, chatId);
            await logger.log('SYSTEM', `Modo SOPORTE activado automáticamente para ${userId}`, supportUserId);
            return cleanResponse;
        }

        await sessionManager.addMessage(userId, 'assistant', aiResponse, chatId);
        return aiResponse;
    }

    // Obtener asignación de cliente (si existe)
    async getClientAssignment(clientPhone) {
        try {
            return await database.findOne(
                'client_assignments',
                'client_phone = ?',
                [clientPhone]
            );
        } catch (error) {
            console.error('Error obteniendo asignación de cliente:', error);
            return null;
        }
    }

    // Asignar cliente a usuario de soporte
    async assignClientToUser(clientPhone, supportUserId, isGroup = false, groupName = null, groupPicture = null) {
        try {
            // Verificar si el cliente ya está asignado a CUALQUIER usuario
            const existingAssignment = await this.getClientAssignment(clientPhone);

            if (existingAssignment) {
                // Solo actualizar last_message_at si es el mismo usuario
                if (existingAssignment.support_user_id === supportUserId) {
                    const updateData = { last_message_at: new Date() };

                    // SIEMPRE actualizar la imagen si viene una nueva (las URLs locales cambian)
                    if (groupPicture) {
                        updateData.group_picture = groupPicture;
                        console.log(`📸 Actualizando foto de perfil para ${clientPhone}: ${groupPicture}`);
                    }

                    await database.update(
                        'client_assignments',
                        updateData,
                        'id = ?',
                        [existingAssignment.id]
                    );
                    console.log(`✅ Actualizada última actividad para cliente ${clientPhone} (Usuario ${supportUserId})`);
                } else {
                    // Cliente asignado a otro usuario, no hacer nada
                    console.log(`⚠️  Cliente ${clientPhone} ya está asignado a usuario ${existingAssignment.support_user_id}`);
                }
            } else {
                // Cliente nuevo, crear asignación
                await database.insert('client_assignments', {
                    client_phone: clientPhone,
                    support_user_id: supportUserId,
                    is_group: isGroup,
                    group_name: groupName,
                    group_picture: groupPicture,
                    last_message_at: new Date()
                });
                console.log(`✅ Cliente ${clientPhone} asignado a usuario ${supportUserId}`);
                if (groupPicture) {
                    console.log(`📸 Foto de perfil guardada: ${groupPicture}`);
                }
            }
        } catch (error) {
            console.error('Error asignando cliente a usuario:', error);
        }
    }

    // Detener instancia
    async stopInstance(supportUserId) {
        try {
            const instanceData = this.instances.get(supportUserId);
            if (!instanceData) return;

            console.log(`🛑 Deteniendo instancia para usuario ${supportUserId}...`);

            if (instanceData.sock) {
                instanceData.sock.end();
            }

            this.instances.delete(supportUserId);

            await this.updateInstanceInDB(supportUserId, {
                status: 'disconnected',
                qr_code: null
            });
        } catch (error) {
            console.error(`Error deteniendo instancia ${supportUserId}:`, error);
        }
    }

    // Limpiar sesión
    async clearSession(authPath) {
        try {
            await fs.rm(authPath, { recursive: true, force: true });
            console.log('Sesión eliminada correctamente');
        } catch (err) {
            console.log('No había sesión previa o ya fue eliminada');
        }
    }

    // Logout de instancia
    async logoutInstance(supportUserId) {
        try {
            const instanceData = this.instances.get(supportUserId);
            if (!instanceData) return false;

            console.log(`🚪 Cerrando sesión de WhatsApp para usuario ${supportUserId}...`);

            if (instanceData.sock) {
                try {
                    await instanceData.sock.logout();
                } catch (err) {
                    console.log('Error al hacer logout:', err.message);
                }
            }

            const authPath = path.join(process.cwd(), 'auth_baileys', `user_${supportUserId}`);
            await this.clearSession(authPath);

            await this.updateInstanceInDB(supportUserId, {
                status: 'disconnected',
                qr_code: null,
                phone_number: null
            });

            // Reiniciar instancia
            setTimeout(() => this.startInstance(supportUserId, instanceData.instanceName), 2000);
            return true;
        } catch (error) {
            console.error(`Error al cerrar sesión ${supportUserId}:`, error);
            return false;
        }
    }

    // Actualizar datos de instancia en BD
    async updateInstanceInDB(supportUserId, data) {
        try {
            const existing = await database.findOne(
                'whatsapp_instances',
                'support_user_id = ?',
                [supportUserId]
            );

            if (existing) {
                await database.update(
                    'whatsapp_instances',
                    data,
                    'support_user_id = ?',
                    [supportUserId]
                );
            } else {
                await database.insert('whatsapp_instances', {
                    support_user_id: supportUserId,
                    ...data
                });
            }
        } catch (error) {
            console.error('Error actualizando instancia en BD:', error);
        }
    }

    // Enviar mensaje desde una instancia específica
    async sendMessage(supportUserId, to, message, options = {}) {
        console.log('📤 [INSTANCE-MANAGER] sendMessage - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData) {
            console.log('❌ [INSTANCE-MANAGER] No se encontró instancia para usuario:', supportUserId);
            console.log('📋 [INSTANCE-MANAGER] Instancias disponibles:', Array.from(this.instances.keys()));
            throw new Error('Instancia no disponible');
        }

        if (!instanceData.sock) {
            console.log('❌ [INSTANCE-MANAGER] Instancia sin sock para usuario:', supportUserId);
            throw new Error('Instancia no disponible');
        }

        console.log('📤 [INSTANCE-MANAGER] Estado de instancia:', instanceData.status);

        if (instanceData.status !== 'connected') {
            console.log('❌ [INSTANCE-MANAGER] WhatsApp no conectado. Estado:', instanceData.status);
            throw new Error('WhatsApp no está conectado');
        }

        // El chatId ya debe venir formateado desde el endpoint, pero por si acaso
        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('📤 [INSTANCE-MANAGER] ChatId final:', chatId);
        console.log('📤 [INSTANCE-MANAGER] Enviando mensaje...');

        // Construir el objeto del mensaje
        const messagePayload = { text: message };
        const sendOptions = {};

        // Agregar quoted message si se especifica (responder a un mensaje)
        if (options.quotedMessageId && options.quotedRemoteJid) {
            // Buscar el mensaje original en la BD para obtener texto y rol
            let quotedText = '';
            let isFromMe = false;
            try {
                const database = require('./database');
                const origMsg = await database.query(
                    'SELECT message, role FROM conversation_logs WHERE message_id = ? LIMIT 1',
                    [options.quotedMessageId]
                );
                if (origMsg.length > 0) {
                    quotedText = origMsg[0].message || '';
                    isFromMe = origMsg[0].role === 'soporte' || origMsg[0].role === 'bot';
                }
            } catch (e) {
                console.log('No se pudo obtener mensaje original:', e.message);
            }

            const quotedKey = {
                remoteJid: options.quotedRemoteJid,
                id: options.quotedMessageId,
                fromMe: isFromMe
            };

            if (options.quotedParticipant) {
                quotedKey.participant = options.quotedParticipant;
            }

            // quoted va como tercer parámetro de sendMessage, no dentro del content
            sendOptions.quoted = {
                key: quotedKey,
                message: {
                    conversation: quotedText
                }
            };
            console.log('💬 Respondiendo a mensaje:', options.quotedMessageId, '| fromMe:', isFromMe);
        }

        // Agregar menciones si se especifican
        if (options.mentions && options.mentions.length > 0) {
            messagePayload.mentions = options.mentions;
        }

        const result = await instanceData.sock.sendMessage(chatId, messagePayload, sendOptions);

        console.log('✅ [INSTANCE-MANAGER] Mensaje enviado exitosamente');
        return result;
    }

    // Reaccionar a un mensaje
    async reactToMessage(supportUserId, messageKey, emoji) {
        console.log('😀 [INSTANCE-MANAGER] reactToMessage - userId:', supportUserId);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        console.log('😀 [INSTANCE-MANAGER] Enviando reacción:', emoji);

        const result = await instanceData.sock.sendMessage(messageKey.remoteJid, {
            react: {
                text: emoji, // El emoji como string (ej: '👍', '❤️', '')
                key: messageKey
            }
        });

        console.log('✅ [INSTANCE-MANAGER] Reacción enviada exitosamente');
        return result;
    }

    // Editar mensaje (nota: solo funciona para mensajes enviados recientemente)
    async editMessage(supportUserId, messageKey, newText) {
        console.log('✏️ [INSTANCE-MANAGER] editMessage - userId:', supportUserId);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        console.log('✏️ [INSTANCE-MANAGER] Editando mensaje...');

        const result = await instanceData.sock.sendMessage(messageKey.remoteJid, {
            text: newText,
            edit: messageKey
        });

        console.log('✅ [INSTANCE-MANAGER] Mensaje editado exitosamente');
        return result;
    }

    // Enviar ubicación
    async sendLocation(supportUserId, to, latitude, longitude, name = '', address = '') {
        console.log('📍 [INSTANCE-MANAGER] sendLocation - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('📍 [INSTANCE-MANAGER] Enviando ubicación...');

        const result = await instanceData.sock.sendMessage(chatId, {
            location: {
                degreesLatitude: latitude,
                degreesLongitude: longitude,
                name: name,
                address: address
            }
        });

        console.log('✅ [INSTANCE-MANAGER] Ubicación enviada exitosamente');
        return result;
    }

    // Enviar contacto
    async sendContact(supportUserId, to, contactName, contactNumber) {
        console.log('👤 [INSTANCE-MANAGER] sendContact - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('👤 [INSTANCE-MANAGER] Enviando contacto...');

        const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nTEL;type=CELL;type=VOICE;waid=${contactNumber}:${contactNumber}\nEND:VCARD`;

        const result = await instanceData.sock.sendMessage(chatId, {
            contacts: {
                displayName: contactName,
                contacts: [{ vcard }]
            }
        });

        console.log('✅ [INSTANCE-MANAGER] Contacto enviado exitosamente');
        return result;
    }

    // Enviar sticker
    async sendSticker(supportUserId, to, stickerBuffer) {
        console.log('🎨 [INSTANCE-MANAGER] sendSticker - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('🎨 [INSTANCE-MANAGER] Enviando sticker...');

        // Convertir a WebP 512x512 si no lo es
        let webpBuffer = stickerBuffer;
        try {
            const sharp = require('sharp');
            webpBuffer = await sharp(stickerBuffer)
                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp({ quality: 80 })
                .toBuffer();
        } catch (e) {
            console.log('No se pudo convertir a WebP, enviando tal cual:', e.message);
        }

        const result = await instanceData.sock.sendMessage(chatId, {
            sticker: webpBuffer
        });

        console.log('✅ [INSTANCE-MANAGER] Sticker enviado exitosamente');
        return result;
    }

    // Marcar chat como leído
    async markAsRead(supportUserId, messageKey) {
        console.log('✅ [INSTANCE-MANAGER] markAsRead - userId:', supportUserId);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        console.log('✅ [INSTANCE-MANAGER] Marcando como leído...');

        await instanceData.sock.readMessages([messageKey]);

        console.log('✅ [INSTANCE-MANAGER] Marcado como leído exitosamente');
    }

    // Cambiar estado de "escribiendo..."
    async sendPresenceUpdate(supportUserId, to, state = 'composing') {
        console.log('💬 [INSTANCE-MANAGER] sendPresenceUpdate - userId:', supportUserId, 'state:', state);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;

        // Estados posibles: 'composing' (escribiendo), 'recording' (grabando), 'paused' (pausado)
        await instanceData.sock.sendPresenceUpdate(state, chatId);

        console.log('✅ [INSTANCE-MANAGER] Estado de presencia actualizado');
    }

    // Enviar imagen con caption
    async sendImage(supportUserId, to, imageBuffer, caption = '') {
        console.log('📤 [INSTANCE-MANAGER] sendImage - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('📤 [INSTANCE-MANAGER] Enviando imagen...');

        const result = await instanceData.sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: caption
        });

        console.log('✅ [INSTANCE-MANAGER] Imagen enviada exitosamente');
        return result;
    }

    // Enviar documento
    async sendDocument(supportUserId, to, documentBuffer, filename, mimetype, caption = '') {
        console.log('📤 [INSTANCE-MANAGER] sendDocument - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('📤 [INSTANCE-MANAGER] Enviando documento...');

        const result = await instanceData.sock.sendMessage(chatId, {
            document: documentBuffer,
            fileName: filename,
            mimetype: mimetype,
            caption: caption
        });

        console.log('✅ [INSTANCE-MANAGER] Documento enviado exitosamente');
        return result;
    }

    // Enviar audio
    async sendAudio(supportUserId, to, audioBuffer, ptt = false) {
        console.log('📤 [INSTANCE-MANAGER] sendAudio - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('📤 [INSTANCE-MANAGER] Enviando audio...');

        const result = await instanceData.sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mp4',
            ptt: ptt // Push-to-talk (nota de voz)
        });

        console.log('✅ [INSTANCE-MANAGER] Audio enviado exitosamente');
        return result;
    }

    // Enviar video
    async sendVideo(supportUserId, to, videoBuffer, caption = '') {
        console.log('📤 [INSTANCE-MANAGER] sendVideo - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('📤 [INSTANCE-MANAGER] Enviando video...');

        const result = await instanceData.sock.sendMessage(chatId, {
            video: videoBuffer,
            caption: caption
        });

        console.log('✅ [INSTANCE-MANAGER] Video enviado exitosamente');
        return result;
    }

    // Reenviar mensaje
    async forwardMessage(supportUserId, to, messageKey) {
        console.log('📤 [INSTANCE-MANAGER] forwardMessage - userId:', supportUserId, 'to:', to);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        const chatId = to.includes('@') ? to : `${to}@g.us`;
        console.log('📤 [INSTANCE-MANAGER] Reenviando mensaje...');

        // Buscar WAMessage en cache para forward nativo
        const cachedMsg = this._msgCache.get(messageKey.id);
        if (cachedMsg) {
            const result = await instanceData.sock.sendMessage(chatId, { forward: cachedMsg });
            console.log('✅ [INSTANCE-MANAGER] Forward nativo OK');
            return result;
        }

        // No está en cache - construir WAMessage fake para forward nativo
        const database = require('./database');
        const rows = await database.query(
            'SELECT message, has_media, media_type, media_url, media_mimetype, media_filename, participant FROM conversation_logs WHERE message_id = ? LIMIT 1',
            [messageKey.id]
        );

        if (!rows || rows.length === 0) {
            throw new Error('No se encontró el mensaje original');
        }

        const origMsg = rows[0];

        // Construir WAMessage para forward nativo
        const fakeWAMsg = {
            key: {
                remoteJid: messageKey.remoteJid,
                fromMe: messageKey.fromMe,
                id: messageKey.id,
                participant: origMsg.participant || undefined
            },
            message: {}
        };

        if (origMsg.has_media && origMsg.media_url) {
            const fs = require('fs');
            const path = require('path');
            const mediaPath = origMsg.media_url.startsWith('/') ? origMsg.media_url.slice(1) : origMsg.media_url;
            const filePath = path.join(process.cwd(), 'data', mediaPath);
            console.log('📤 [FORWARD] Path archivo:', filePath, 'Existe:', require('fs').existsSync(filePath));

            if (fs.existsSync(filePath)) {
                const buffer = fs.readFileSync(filePath);
                const caption = origMsg.message || '';

                // Enviar media directamente (no se puede hacer forward nativo sin protobuf original)
                let mediaContent;
                if (origMsg.media_type === 'image') {
                    mediaContent = { image: buffer, caption, mimetype: origMsg.media_mimetype || 'image/jpeg', contextInfo: { isForwarded: true } };
                } else if (origMsg.media_type === 'video') {
                    mediaContent = { video: buffer, caption, mimetype: origMsg.media_mimetype || 'video/mp4', contextInfo: { isForwarded: true } };
                } else if (origMsg.media_type === 'audio') {
                    mediaContent = { audio: buffer, mimetype: origMsg.media_mimetype || 'audio/mpeg', ptt: false, contextInfo: { isForwarded: true } };
                } else if (origMsg.media_type === 'document') {
                    mediaContent = { document: buffer, caption, mimetype: origMsg.media_mimetype || 'application/octet-stream', fileName: origMsg.media_filename || 'archivo', contextInfo: { isForwarded: true } };
                }
                if (mediaContent) {
                    const result = await instanceData.sock.sendMessage(chatId, mediaContent);
                    console.log('✅ [INSTANCE-MANAGER] Media reenviada con flag isForwarded');
                    return result;
                }
            }
        }

        // Texto: enviar con contextInfo.isForwarded
        const result = await instanceData.sock.sendMessage(chatId, {
            text: origMsg.message || '[Mensaje sin texto]',
            contextInfo: { isForwarded: true }
        });
        console.log('✅ [INSTANCE-MANAGER] Texto reenviado con flag isForwarded');
        return result;
    }

    // Eliminar mensaje
    async deleteMessage(supportUserId, messageKey) {
        console.log('🗑️ [INSTANCE-MANAGER] deleteMessage - userId:', supportUserId);

        const instanceData = this.instances.get(supportUserId);

        if (!instanceData || !instanceData.sock) {
            throw new Error('Instancia no disponible');
        }

        if (instanceData.status !== 'connected') {
            throw new Error('WhatsApp no está conectado');
        }

        console.log('🗑️ [INSTANCE-MANAGER] Eliminando mensaje...');

        const result = await instanceData.sock.sendMessage(messageKey.remoteJid, {
            delete: messageKey
        });

        // Marcar mensaje como eliminado en la BD
        try {
            await database.query(
                'UPDATE conversation_logs SET message = ?, has_media = 0, media_url = NULL, media_type = NULL, media_mimetype = NULL, media_filename = NULL, media_caption = NULL, has_quoted_msg = 0, quoted_msg_body = NULL, quoted_msg_participant = NULL, quoted_msg_id = NULL WHERE message_id = ?',
                ['Se elimino este mensaje', messageKey.id]
            );
        } catch (e) {
            console.log('Error marcando mensaje eliminado en BD:', e.message);
        }

        // Notificar al frontend
        if (global.io) {
            global.io.emit('new-message', { phone: messageKey.remoteJid.replace('@g.us', ''), deleted: true });
        }

        console.log('✅ [INSTANCE-MANAGER] Mensaje eliminado exitosamente');
        return result;
    }

    // Editar un mensaje enviado
    async editMessage(supportUserId, messageKey, newText) {
        const instanceData = this.instances.get(supportUserId);
        if (!instanceData || !instanceData.sock) throw new Error('Instancia no disponible');
        if (instanceData.status !== 'connected') throw new Error('WhatsApp no esta conectado');

        const result = await instanceData.sock.sendMessage(messageKey.remoteJid, {
            text: newText,
            edit: messageKey
        });

        try {
            await database.query(
                'UPDATE conversation_logs SET message = ?, is_edited = 1 WHERE message_id = ?',
                [newText, messageKey.id]
            );
        } catch (e) {
            console.log('Error actualizando mensaje editado en BD:', e.message);
        }

        if (global.io) {
            global.io.emit('new-message', { phone: messageKey.remoteJid.replace('@g.us', ''), edited: true });
        }

        return result;
    }

    // Obtener estado de instancia desde BD
    async getInstanceFromDB(supportUserId) {
        return await database.findOne(
            'whatsapp_instances',
            'support_user_id = ?',
            [supportUserId]
        );
    }

    // Obtener nombre de contacto mencionado
    async getContactName(sock, jid, groupJid) {
        try {
            const isLid = jid.endsWith('@lid');

            // Método 1: Obtener metadata del grupo y buscar en participantes
            try {
                const groupMetadata = await sock.groupMetadata(groupJid);
                // Buscar por ID exacto
                let participant = groupMetadata.participants.find(p => p.id === jid);

                // Si es LID, buscar también por el lid field o comparar sin sufijo
                if (!participant && isLid) {
                    const lidNumber = jid.replace('@lid', '');
                    participant = groupMetadata.participants.find(p =>
                        p.id.replace('@lid', '').replace('@s.whatsapp.net', '') === lidNumber ||
                        p.lid === jid
                    );
                }

                if (participant?.notify) {
                    console.log(`📛 Nombre encontrado en grupo: ${participant.notify}`);
                    return participant.notify;
                }
                // Si encontramos al participante pero sin notify, intentar con su verifiedName
                if (participant?.verifiedName) {
                    console.log(`📛 Nombre verificado encontrado: ${participant.verifiedName}`);
                    return participant.verifiedName;
                }
            } catch (groupError) {
                console.log('No se pudo obtener metadata del grupo:', groupError.message);
            }

            // Método 2: Buscar en logs de la BD (muy útil para LIDs)
            try {
                const database = require('./database');
                const groupId = groupJid.replace('@g.us', '');
                const logs = await database.query(
                    'SELECT user_name FROM conversation_logs WHERE participant = ? AND user_name IS NOT NULL AND user_name != ? LIMIT 1',
                    [jid, 'Usuario desconocido']
                );
                if (logs.length > 0 && logs[0].user_name) {
                    console.log(`📛 Nombre encontrado en logs DB: ${logs[0].user_name}`);
                    return logs[0].user_name;
                }
            } catch (dbError) {
                console.log('No se pudo buscar en DB:', dbError.message);
            }

            // Método 3: Verificar si está en WhatsApp (solo funciona con @s.whatsapp.net, no LIDs)
            if (!isLid) {
                try {
                    const contactInfo = await sock.onWhatsApp(jid);
                    if (contactInfo && contactInfo[0]?.notify) {
                        console.log(`📛 Nombre encontrado en WhatsApp: ${contactInfo[0].notify}`);
                        return contactInfo[0].notify;
                    }
                } catch (waError) {
                    console.log('No se pudo verificar en WhatsApp:', waError.message);
                }
            }

            // Método 4: Intentar obtener del store de contactos del socket
            try {
                const contact = sock.store?.contacts?.[jid];
                if (contact?.name || contact?.notify) {
                    const name = contact.name || contact.notify;
                    console.log(`📛 Nombre encontrado en store: ${name}`);
                    return name;
                }
            } catch (storeError) {
                console.log('No se pudo obtener del store:', storeError.message);
            }

            // Fallback: usar últimos dígitos del número/lid
            const cleanId = jid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const fallbackName = cleanId.slice(-4);
            console.log(`📛 Usando fallback (últimos 4 dígitos): ${fallbackName}`);
            return fallbackName;

        } catch (error) {
            console.log('❌ Error general obteniendo nombre de contacto:', error.message);
            const cleanId = jid.replace('@s.whatsapp.net', '').replace('@lid', '');
            return cleanId.slice(-4);
        }
    }
}

module.exports = new WhatsAppInstanceManager();
