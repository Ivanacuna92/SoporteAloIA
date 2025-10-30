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
                getMessage: async () => ({ conversation: 'No disponible' }),
                defaultQueryTimeoutMs: undefined,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                qrTimeout: undefined,
                markOnlineOnConnect: false,
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
                await this.handleMessagesUpdate(supportUserId, updates);
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

                let status = null;

                if (update.update.status === 4) {
                    status = 'read';
                } else if (update.update.status === 2) {
                    status = 'delivered';
                } else if (update.update.status === 1) {
                    status = 'sent';
                }

                if (status && messageId) {
                    await logger.updateMessageStatus(messageId, status);
                    console.log(`✅ Estado actualizado (Usuario ${supportUserId}): ${messageId} -> ${status}`);
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

            const instanceData = this.instances.get(supportUserId);
            if (!instanceData || !instanceData.sock) return;

            // Ignorar mensajes propios
            if (msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');

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

            // Procesar menciones (reemplazar números por nombres)
            const mentionedJids = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentionedJids.length > 0 && conversation) {
                console.log(`📝 Procesando ${mentionedJids.length} menciones en el mensaje`);

                for (const jid of mentionedJids) {
                    const phoneNumber = jid.replace('@s.whatsapp.net', '');
                    try {
                        // Intentar obtener el nombre del contacto mencionado
                        const mentionedName = await this.getContactName(instanceData.sock, jid, from);

                        if (mentionedName) {
                            // Crear regex más flexible para reemplazar menciones
                            // Buscar: @número_completo o @últimos_dígitos
                            const fullNumberPattern = new RegExp(`@${phoneNumber.replace(/\+/g, '\\+')}`, 'g');
                            const shortNumberPattern = new RegExp(`@${phoneNumber.slice(-10)}`, 'g'); // Últimos 10 dígitos

                            // Intentar reemplazar con el patrón completo primero
                            let replaced = false;
                            if (conversation.includes(`@${phoneNumber}`)) {
                                conversation = conversation.replace(fullNumberPattern, `@${mentionedName}`);
                                replaced = true;
                                console.log(`✅ Reemplazado @${phoneNumber} por @${mentionedName}`);
                            }

                            // Si no funcionó, intentar con los últimos 10 dígitos
                            if (!replaced && conversation.includes(`@${phoneNumber.slice(-10)}`)) {
                                conversation = conversation.replace(shortNumberPattern, `@${mentionedName}`);
                                console.log(`✅ Reemplazado @${phoneNumber.slice(-10)} por @${mentionedName}`);
                            }
                        } else {
                            console.log(`⚠️  No se pudo obtener nombre para ${phoneNumber}`);
                        }
                    } catch (error) {
                        console.log(`❌ Error obteniendo nombre para ${phoneNumber}:`, error.message);
                    }
                }

                console.log(`📝 Mensaje final con menciones procesadas: ${conversation}`);
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
            await logger.log('cliente', messageText, groupId, userName, true, null, supportUserId, null, mediaInfo);

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

            // Identificar tipo de medio
            if (msg.message.imageMessage) {
                mediaMessage = msg.message.imageMessage;
                mediaType = 'image';
                mimetype = mediaMessage.mimetype || 'image/jpeg';
                filename = `${userId}_${Date.now()}.${mimetype.split('/')[1]}`;
            } else if (msg.message.videoMessage) {
                mediaMessage = msg.message.videoMessage;
                mediaType = 'video';
                mimetype = mediaMessage.mimetype || 'video/mp4';
                filename = `${userId}_${Date.now()}.${mimetype.split('/')[1]}`;
            } else if (msg.message.documentMessage) {
                mediaMessage = msg.message.documentMessage;
                mediaType = 'document';
                mimetype = mediaMessage.mimetype || 'application/octet-stream';
                filename = mediaMessage.fileName || `${userId}_${Date.now()}.${mimetype.split('/')[1]}`;
            } else if (msg.message.audioMessage) {
                mediaMessage = msg.message.audioMessage;
                mediaType = 'audio';
                mimetype = mediaMessage.mimetype || 'audio/ogg';
                filename = `${userId}_${Date.now()}.${mimetype.split('/')[1]}`;
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
    async sendMessage(supportUserId, to, message) {
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

        const result = await instanceData.sock.sendMessage(chatId, { text: message });

        console.log('✅ [INSTANCE-MANAGER] Mensaje enviado exitosamente');
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
            // Método 1: Obtener metadata del grupo y buscar en participantes
            try {
                const groupMetadata = await sock.groupMetadata(groupJid);
                const participant = groupMetadata.participants.find(p => p.id === jid);

                // Si el participante tiene un pushName guardado, usarlo
                if (participant?.notify) {
                    console.log(`📛 Nombre encontrado en grupo: ${participant.notify}`);
                    return participant.notify;
                }
            } catch (groupError) {
                console.log('No se pudo obtener metadata del grupo:', groupError.message);
            }

            // Método 2: Verificar si está en WhatsApp y obtener notify
            try {
                const contactInfo = await sock.onWhatsApp(jid);
                if (contactInfo && contactInfo[0]?.notify) {
                    console.log(`📛 Nombre encontrado en WhatsApp: ${contactInfo[0].notify}`);
                    return contactInfo[0].notify;
                }
            } catch (waError) {
                console.log('No se pudo verificar en WhatsApp:', waError.message);
            }

            // Método 3: Intentar obtener del store de contactos del socket
            try {
                const contact = await sock.store?.contacts?.[jid];
                if (contact?.name || contact?.notify) {
                    const name = contact.name || contact.notify;
                    console.log(`📛 Nombre encontrado en store: ${name}`);
                    return name;
                }
            } catch (storeError) {
                console.log('No se pudo obtener del store:', storeError.message);
            }

            // Fallback: usar últimos dígitos del número
            const phoneNumber = jid.replace('@s.whatsapp.net', '');
            const fallbackName = phoneNumber.slice(-4);
            console.log(`📛 Usando fallback (últimos 4 dígitos): ${fallbackName}`);
            return fallbackName;

        } catch (error) {
            console.log('❌ Error general obteniendo nombre de contacto:', error.message);
            // Último fallback
            const phoneNumber = jid.replace('@s.whatsapp.net', '');
            return phoneNumber.slice(-4);
        }
    }
}

module.exports = new WhatsAppInstanceManager();
