// Endpoints para gestión multi-usuario y multi-instancia
// Este archivo contiene todos los endpoints necesarios para el sistema multi-usuario

const authService = require('../services/authService');
const database = require('../services/database');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

// Configurar multer para almacenamiento en memoria
const upload = multer({ storage: multer.memoryStorage() });

module.exports = function(app, requireAuth, requireAdmin) {

    // ===== ENDPOINTS DE GESTIÓN DE USUARIOS (SOLO ADMIN) =====

    // Obtener todos los usuarios
    app.get('/api/users', requireAdmin, async (req, res) => {
        try {
            const users = await authService.getAllUsers(req.user.id);
            res.json({ success: true, users });
        } catch (error) {
            console.error('Error obteniendo usuarios:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Crear nuevo usuario
    app.post('/api/users', requireAdmin, async (req, res) => {
        try {
            const { email, password, name, role } = req.body;

            if (!email || !password || !name) {
                return res.status(400).json({
                    error: 'Email, password y nombre son requeridos'
                });
            }

            const newUser = await authService.createUser(
                email,
                password,
                name,
                role || 'support',
                req.user.id
            );

            // Iniciar instancia de WhatsApp para el nuevo usuario
            const instanceManager = global.whatsappInstanceManager;
            await instanceManager.startInstance(newUser.id, newUser.name);

            res.json({
                success: true,
                user: newUser,
                message: 'Usuario creado exitosamente'
            });
        } catch (error) {
            console.error('Error creando usuario:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Actualizar usuario
    app.put('/api/users/:id', requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { name, role, active } = req.body;

            const updateData = {};
            if (name !== undefined) updateData.name = name;
            if (role !== undefined) updateData.role = role;
            if (active !== undefined) updateData.active = active;

            await database.update('support_users', updateData, 'id = ?', [id]);

            // Si se desactivó el usuario, detener su instancia
            if (active === false) {
                const instanceManager = global.whatsappInstanceManager;
                await instanceManager.stopInstance(parseInt(id));
            }
            // Si se activó, iniciar su instancia
            else if (active === true) {
                const user = await database.findOne('support_users', 'id = ?', [id]);
                const instanceManager = global.whatsappInstanceManager;
                await instanceManager.startInstance(parseInt(id), user.name);
            }

            res.json({
                success: true,
                message: 'Usuario actualizado exitosamente'
            });
        } catch (error) {
            console.error('Error actualizando usuario:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Eliminar usuario
    app.delete('/api/users/:id', requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;

            // No permitir eliminar al admin principal
            const user = await database.findOne('support_users', 'id = ?', [id]);
            if (user && user.email === 'admin@whatspanel.com') {
                return res.status(403).json({
                    error: 'No se puede eliminar el usuario admin principal'
                });
            }

            // Detener instancia del usuario
            const instanceManager = global.whatsappInstanceManager;
            await instanceManager.stopInstance(parseInt(id));

            // Eliminar usuario (cascade eliminará sesiones y asignaciones)
            await database.delete('support_users', 'id = ?', [id]);

            res.json({
                success: true,
                message: 'Usuario eliminado exitosamente'
            });
        } catch (error) {
            console.error('Error eliminando usuario:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ===== ENDPOINTS DE GESTIÓN DE INSTANCIAS DE WHATSAPP =====

    // Obtener QR de la instancia del usuario actual
    app.get('/api/my-instance/qr', requireAuth, async (req, res) => {
        try {
            const instanceManager = global.whatsappInstanceManager;
            const instance = instanceManager.getInstance(req.user.id);

            if (!instance) {
                return res.json({
                    qr: null,
                    status: 'not_found',
                    message: 'No hay instancia iniciada para este usuario'
                });
            }

            res.json({
                qr: instance.qr,
                status: instance.status,
                phone: instance.phone,
                message: instance.status === 'connected'
                    ? 'WhatsApp conectado'
                    : instance.qr
                        ? 'Escanea el código QR'
                        : 'Esperando código QR...'
            });
        } catch (error) {
            console.error('Error obteniendo QR:', error);
            res.status(500).json({ error: 'Error obteniendo código QR' });
        }
    });

    // Obtener estado de la instancia del usuario
    app.get('/api/my-instance/status', requireAuth, async (req, res) => {
        try {
            const instanceManager = global.whatsappInstanceManager;
            const instance = instanceManager.getInstance(req.user.id);

            if (!instance) {
                return res.json({
                    status: 'not_found',
                    connected: false
                });
            }

            res.json({
                status: instance.status,
                connected: instance.status === 'connected',
                phone: instance.phone,
                instanceName: instance.instanceName
            });
        } catch (error) {
            console.error('Error obteniendo estado:', error);
            res.status(500).json({ error: 'Error obteniendo estado' });
        }
    });

    // Cerrar sesión de WhatsApp del usuario actual
    app.post('/api/my-instance/logout', requireAuth, async (req, res) => {
        try {
            const instanceManager = global.whatsappInstanceManager;
            const result = await instanceManager.logoutInstance(req.user.id);

            if (result) {
                res.json({
                    success: true,
                    message: 'Sesión cerrada. Nuevo QR disponible en 2 segundos.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Error al cerrar sesión'
                });
            }
        } catch (error) {
            console.error('Error en logout:', error);
            res.status(500).json({
                success: false,
                error: 'Error al procesar logout'
            });
        }
    });

    // Obtener todas las instancias (solo admin)
    app.get('/api/instances', requireAdmin, async (req, res) => {
        try {
            const instanceManager = global.whatsappInstanceManager;
            const instances = instanceManager.getInstances();

            // Obtener información adicional de usuarios
            const instancesWithUsers = await Promise.all(
                instances.map(async (inst) => {
                    const user = await database.findOne('support_users', 'id = ?', [inst.userId]);
                    return {
                        ...inst,
                        user: user ? {
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role
                        } : null
                    };
                })
            );

            res.json({ success: true, instances: instancesWithUsers });
        } catch (error) {
            console.error('Error obteniendo instancias:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ===== ENDPOINTS DE CONTACTOS FILTRADOS POR USUARIO =====

    // Obtener contactos del usuario actual
    app.get('/api/my-contacts', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;

            // Obtener asignaciones del usuario
            const assignments = await database.findAll(
                'client_assignments',
                'support_user_id = ?',
                [userId],
                'last_message_at DESC'
            );

            // Obtener logs para cada cliente asignado
            const logger = require('../services/logger');
            const humanModeManager = require('../services/humanModeManager');

            const contacts = await Promise.all(
                assignments.map(async (assignment) => {
                    const logs = await logger.getLogsByClientPhone(assignment.client_phone);

                    // Agrupar mensajes
                    const messages = logs.map(log => ({
                        type: log.type || log.role?.toUpperCase(),
                        message: log.message,
                        timestamp: log.timestamp,
                        role: log.role,
                        status: log.status,
                        messageId: log.messageId,
                        userName: log.userName,
                        participant: log.participant,
                        participantPic: log.participantPic || null,
                        // Campos de medios
                        hasMedia: log.hasMedia || false,
                        mediaType: log.mediaType,
                        mediaUrl: log.mediaUrl,
                        mediaMimetype: log.mediaMimetype,
                        mediaFilename: log.mediaFilename,
                        mediaCaption: log.mediaCaption,
                        isForwarded: log.isForwarded || false,
                        isEdited: log.isEdited || false,
                        hasQuotedMsg: log.hasQuotedMsg || false,
                        quotedMsg: log.quotedMsg || null
                    }));

                    // Obtener modo actual (solo humano o soporte, sin IA) - DEBE SER AWAIT
                    const rawMode = await humanModeManager.getMode(assignment.client_phone);
                    const mode = rawMode === 'support' ? 'support' : 'human'; // Solo 2 modos posibles
                    const isHumanMode = mode === 'human';

                    // Los mensajes vienen en orden ASC (más antiguo primero), entonces el último índice es el mensaje más reciente
                    // IMPORTANTE: Guardar ANTES del reverse()
                    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

                    return {
                        phone: assignment.client_phone,
                        name: assignment.group_name || assignment.client_phone,
                        isGroup: assignment.is_group || false, // Ahora puede ser grupo
                        groupName: assignment.group_name,
                        groupPicture: assignment.group_picture, // URL de la imagen del grupo
                        isArchived: Boolean(assignment.is_archived),
                        messages: messages.reverse(), // Orden cronológico
                        totalMessages: messages.length,
                        userMessages: messages.filter(m => m.type === 'USER' || m.role === 'cliente').length,
                        botMessages: messages.filter(m => m.type === 'BOT' || m.role === 'bot').length,
                        lastActivity: assignment.last_message_at,
                        isHumanMode,
                        mode, // Siempre 'human' o 'support'
                        lastMessage: lastMsg ? {
                            text: lastMsg.message,
                            timestamp: lastMsg.timestamp,
                            userName: lastMsg.userName,
                            role: lastMsg.role,
                            mediaType: lastMsg.mediaType || null
                        } : null
                    };
                })
            );

            res.json(contacts);
        } catch (error) {
            console.error('Error obteniendo contactos del usuario:', error);
            res.status(500).json({ error: 'Error obteniendo contactos' });
        }
    });

    // Endpoint ligero: solo cuenta de mensajes de un contacto (para polling rápido)
    app.get('/api/my-contacts/:phone/message-count', requireAuth, async (req, res) => {
        try {
            const result = await database.query(
                'SELECT COUNT(*) as count FROM conversation_logs WHERE user_id = ?',
                [req.params.phone]
            );
            res.json({ count: result[0]?.count || 0 });
        } catch (error) {
            res.status(500).json({ error: 'Error' });
        }
    });

    // Enviar mensaje desde la instancia del usuario actual
    app.post('/api/my-instance/send-message', requireAuth, async (req, res) => {
        try {
            console.log('📨 [SEND-MESSAGE] Inicio - Usuario:', req.user.id, req.user.email);
            console.log('📨 [SEND-MESSAGE] Body recibido:', JSON.stringify(req.body));

            const { phone, message } = req.body;

            if (!phone || !message) {
                console.log('❌ [SEND-MESSAGE] Falta phone o message');
                return res.status(400).json({
                    error: 'Phone and message are required'
                });
            }

            console.log('📨 [SEND-MESSAGE] Phone:', phone, 'Message length:', message.length);

            const instanceManager = global.whatsappInstanceManager;
            // Solo grupos (terminan en @g.us)
            const chatId = `${phone}@g.us`;

            console.log('📨 [SEND-MESSAGE] ChatId formateado:', chatId);
            console.log('📨 [SEND-MESSAGE] Llamando instanceManager.sendMessage...');

            await instanceManager.sendMessage(req.user.id, chatId, message);

            console.log('✅ [SEND-MESSAGE] Mensaje enviado exitosamente');

            // NO registrar aquí - el instance manager lo hará cuando WhatsApp confirme (fromMe event)
            // Esto evita mensajes duplicados

            res.json({
                success: true,
                message: 'Mensaje enviado correctamente'
            });
        } catch (error) {
            console.error('❌ [SEND-MESSAGE] Error:', error.message);
            console.error('❌ [SEND-MESSAGE] Stack:', error.stack);
            res.status(500).json({
                error: 'Error enviando mensaje',
                details: error.message
            });
        }
    });

    // Enviar imagen
    app.post('/api/my-instance/send-image', requireAuth, upload.single('image'), async (req, res) => {
        try {
            const { phone, caption } = req.body;

            if (!phone || !req.file) {
                return res.status(400).json({
                    error: 'Phone e imagen son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendImage(req.user.id, chatId, req.file.buffer, caption || '');

            // NO registrar aquí - el instance manager lo hará cuando WhatsApp confirme (fromMe event)
            // Esto evita mensajes duplicados

            res.json({
                success: true,
                message: 'Imagen enviada correctamente'
            });
        } catch (error) {
            console.error('Error enviando imagen:', error);
            res.status(500).json({
                error: 'Error enviando imagen',
                details: error.message
            });
        }
    });

    // Enviar documento
    app.post('/api/my-instance/send-document', requireAuth, upload.single('document'), async (req, res) => {
        try {
            const { phone, caption } = req.body;

            if (!phone || !req.file) {
                return res.status(400).json({
                    error: 'Phone y documento son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendDocument(
                req.user.id,
                chatId,
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype,
                caption || ''
            );

            // NO registrar aquí - el instance manager lo hará cuando WhatsApp confirme (fromMe event)
            // Esto evita mensajes duplicados

            res.json({
                success: true,
                message: 'Documento enviado correctamente'
            });
        } catch (error) {
            console.error('Error enviando documento:', error);
            res.status(500).json({
                error: 'Error enviando documento',
                details: error.message
            });
        }
    });

    // Enviar audio
    app.post('/api/my-instance/send-audio', requireAuth, upload.single('audio'), async (req, res) => {
        try {
            const { phone, ptt } = req.body;

            if (!phone || !req.file) {
                return res.status(400).json({
                    error: 'Phone y audio son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendAudio(req.user.id, chatId, req.file.buffer, ptt === 'true');

            // NO registrar aquí - el instance manager lo hará cuando WhatsApp confirme (fromMe event)
            // Esto evita mensajes duplicados

            res.json({
                success: true,
                message: 'Audio enviado correctamente'
            });
        } catch (error) {
            console.error('Error enviando audio:', error);
            res.status(500).json({
                error: 'Error enviando audio',
                details: error.message
            });
        }
    });

    // Enviar video
    app.post('/api/my-instance/send-video', requireAuth, upload.single('video'), async (req, res) => {
        try {
            const { phone, caption } = req.body;

            if (!phone || !req.file) {
                return res.status(400).json({
                    error: 'Phone y video son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendVideo(req.user.id, chatId, req.file.buffer, caption || '');

            // NO registrar aquí - el instance manager lo hará cuando WhatsApp confirme (fromMe event)
            // Esto evita mensajes duplicados

            res.json({
                success: true,
                message: 'Video enviado correctamente'
            });
        } catch (error) {
            console.error('Error enviando video:', error);
            res.status(500).json({
                error: 'Error enviando video',
                details: error.message
            });
        }
    });

    // Reenviar mensaje
    app.post('/api/my-instance/forward-message', requireAuth, async (req, res) => {
        try {
            const { phone, messageKey } = req.body;

            if (!phone || !messageKey) {
                return res.status(400).json({
                    error: 'Phone y messageKey son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.forwardMessage(req.user.id, chatId, messageKey);

            // NO registrar aquí - el instance manager lo hará cuando WhatsApp confirme (fromMe event)

            res.json({
                success: true,
                message: 'Mensaje reenviado correctamente'
            });
        } catch (error) {
            console.error('Error reenviando mensaje:', error);
            res.status(500).json({
                error: 'Error reenviando mensaje',
                details: error.message
            });
        }
    });

    // Eliminar mensaje
    app.post('/api/my-instance/delete-message', requireAuth, async (req, res) => {
        try {
            const { messageKey } = req.body;

            if (!messageKey) {
                return res.status(400).json({
                    error: 'messageKey es requerido'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            await instanceManager.deleteMessage(req.user.id, messageKey);

            res.json({
                success: true,
                message: 'Mensaje eliminado correctamente'
            });
        } catch (error) {
            console.error('Error eliminando mensaje:', error);
            res.status(500).json({
                error: 'Error eliminando mensaje',
                details: error.message
            });
        }
    });

    // Verificar estado de conexión de WhatsApp
    app.get('/api/whatsapp-status', requireAuth, async (req, res) => {
        try {
            const instanceManager = global.whatsappInstanceManager;
            const instance = instanceManager.getInstance(req.user.id);

            res.json({
                connected: instance?.status === 'connected',
                status: instance?.status || 'not_found'
            });
        } catch (error) {
            console.error('Error verificando estado:', error);
            res.status(500).json({ connected: false });
        }
    });

    // Obtener configuración de AI
    app.get('/api/ai-config', requireAuth, async (req, res) => {
        try {
            const systemConfigService = require('../services/systemConfigService');
            const groupsAIEnabled = await systemConfigService.isGroupsAIEnabled();
            const individualAIEnabled = await systemConfigService.isIndividualAIEnabled();

            res.json({
                groupsAIEnabled,
                individualAIEnabled
            });
        } catch (error) {
            console.error('Error obteniendo configuración de AI:', error);
            res.status(500).json({ error: 'Error obteniendo configuración' });
        }
    });

    // ===== ENDPOINTS DE FUNCIONALIDADES AVANZADAS =====

    // Reaccionar a un mensaje
    app.post('/api/my-instance/react-message', requireAuth, async (req, res) => {
        try {
            const { messageKey, emoji } = req.body;

            if (!messageKey || emoji === undefined) {
                return res.status(400).json({
                    error: 'messageKey y emoji son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            await instanceManager.reactToMessage(req.user.id, messageKey, emoji);

            res.json({
                success: true,
                message: 'Reacción enviada correctamente'
            });
        } catch (error) {
            console.error('Error enviando reacción:', error);
            res.status(500).json({
                error: 'Error enviando reacción',
                details: error.message
            });
        }
    });

    // Editar un mensaje
    app.post('/api/my-instance/edit-message', requireAuth, async (req, res) => {
        try {
            const { messageKey, newText } = req.body;

            if (!messageKey || !newText) {
                return res.status(400).json({
                    error: 'messageKey y newText son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            await instanceManager.editMessage(req.user.id, messageKey, newText);

            res.json({
                success: true,
                message: 'Mensaje editado correctamente'
            });
        } catch (error) {
            console.error('Error editando mensaje:', error);
            res.status(500).json({
                error: 'Error editando mensaje',
                details: error.message
            });
        }
    });

    // Enviar ubicación
    app.post('/api/my-instance/send-location', requireAuth, async (req, res) => {
        try {
            const { phone, latitude, longitude, name, address } = req.body;

            if (!phone || latitude === undefined || longitude === undefined) {
                return res.status(400).json({
                    error: 'Phone, latitude y longitude son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendLocation(
                req.user.id,
                chatId,
                latitude,
                longitude,
                name || '',
                address || ''
            );

            // Registrar el mensaje
            const logger = require('../services/logger');
            await logger.log('soporte', `[Ubicación: ${name || 'Sin nombre'}]`, phone, req.user.name, true, req.user.id);

            res.json({
                success: true,
                message: 'Ubicación enviada correctamente'
            });
        } catch (error) {
            console.error('Error enviando ubicación:', error);
            res.status(500).json({
                error: 'Error enviando ubicación',
                details: error.message
            });
        }
    });

    // Enviar contacto
    app.post('/api/my-instance/send-contact', requireAuth, async (req, res) => {
        try {
            const { phone, contactName, contactNumber } = req.body;

            if (!phone || !contactName || !contactNumber) {
                return res.status(400).json({
                    error: 'Phone, contactName y contactNumber son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendContact(req.user.id, chatId, contactName, contactNumber);

            // Registrar el mensaje
            const logger = require('../services/logger');
            await logger.log('soporte', `[Contacto: ${contactName}]`, phone, req.user.name, true, req.user.id);

            res.json({
                success: true,
                message: 'Contacto enviado correctamente'
            });
        } catch (error) {
            console.error('Error enviando contacto:', error);
            res.status(500).json({
                error: 'Error enviando contacto',
                details: error.message
            });
        }
    });

    // Enviar sticker
    app.post('/api/my-instance/send-sticker', requireAuth, upload.single('sticker'), async (req, res) => {
        try {
            const { phone } = req.body;

            if (!phone || !req.file) {
                return res.status(400).json({
                    error: 'Phone y sticker son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendSticker(req.user.id, chatId, req.file.buffer);

            // Registrar el mensaje
            const logger = require('../services/logger');
            await logger.log('soporte', '[Sticker]', phone, req.user.name, true, req.user.id);

            res.json({
                success: true,
                message: 'Sticker enviado correctamente'
            });
        } catch (error) {
            console.error('Error enviando sticker:', error);
            res.status(500).json({
                error: 'Error enviando sticker',
                details: error.message
            });
        }
    });

    // Obtener reacciones de un chat
    app.get('/api/my-contacts/:phone/reactions', requireAuth, async (req, res) => {
        try {
            const { phone } = req.params;
            const database = require('../services/database');
            const rows = await database.query(
                'SELECT message_id, emoji, participant FROM message_reactions WHERE phone = ?',
                [phone]
            );
            const reactions = {};
            for (const row of rows) {
                if (!reactions[row.message_id]) reactions[row.message_id] = [];
                reactions[row.message_id].push({ emoji: row.emoji, participant: row.participant });
            }
            res.json(reactions);
        } catch (error) {
            console.error('Error obteniendo reacciones:', error);
            res.json({});
        }
    });

    // Marcar chat como leído
    app.post('/api/my-instance/mark-read', requireAuth, async (req, res) => {
        try {
            const { messageKey } = req.body;

            if (!messageKey) {
                return res.status(400).json({
                    error: 'messageKey es requerido'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            await instanceManager.markAsRead(req.user.id, messageKey);

            res.json({
                success: true,
                message: 'Chat marcado como leído'
            });
        } catch (error) {
            console.error('Error marcando como leído:', error);
            res.status(500).json({
                error: 'Error marcando como leído',
                details: error.message
            });
        }
    });

    // Actualizar estado de presencia (escribiendo, grabando, etc.)
    app.post('/api/my-instance/presence', requireAuth, async (req, res) => {
        try {
            const { phone, state } = req.body;

            if (!phone || !state) {
                return res.status(400).json({
                    error: 'Phone y state son requeridos'
                });
            }

            // Validar estados permitidos
            const validStates = ['composing', 'recording', 'paused'];
            if (!validStates.includes(state)) {
                return res.status(400).json({
                    error: `State debe ser uno de: ${validStates.join(', ')}`
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendPresenceUpdate(req.user.id, chatId, state);

            res.json({
                success: true,
                message: 'Estado de presencia actualizado'
            });
        } catch (error) {
            console.error('Error actualizando presencia:', error);
            res.status(500).json({
                error: 'Error actualizando presencia',
                details: error.message
            });
        }
    });

    // Enviar mensaje con opciones avanzadas (menciones, responder a mensaje)
    app.post('/api/my-instance/send-message-advanced', requireAuth, async (req, res) => {
        try {
            const { phone, message, quotedMessageId, quotedRemoteJid, quotedParticipant, mentions, reaction } = req.body;

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            // Manejar reacciones
            if (reaction) {
                console.log('🔥 [REACTION] Recibida petición de reacción:', JSON.stringify(reaction));
                const instanceData = instanceManager.getInstance(req.user.id);
                if (!instanceData || !instanceData.sock) throw new Error('Instancia no disponible');
                await instanceData.sock.sendMessage(chatId, { react: { text: reaction.text, key: reaction.key } });
                console.log('✅ [REACTION] Reacción enviada exitosamente');
                return res.json({ success: true, message: 'Reacción enviada' });
            }

            if (!phone || !message) {
                return res.status(400).json({
                    error: 'Phone y message son requeridos'
                });
            }

            const options = {};

            // Agregar quoted message si se especifica
            if (quotedMessageId && quotedRemoteJid) {
                options.quotedMessageId = quotedMessageId;
                options.quotedRemoteJid = quotedRemoteJid;
                if (quotedParticipant) {
                    options.quotedParticipant = quotedParticipant;
                }
            }

            // Agregar menciones si se especifican
            if (mentions && Array.isArray(mentions)) {
                options.mentions = mentions;
            }

            await instanceManager.sendMessage(req.user.id, chatId, message, options);

            // NO registrar aquí - el instance manager lo hará cuando WhatsApp confirme (fromMe event)
            // Esto evita mensajes duplicados

            res.json({
                success: true,
                message: 'Mensaje enviado correctamente'
            });
        } catch (error) {
            console.error('Error enviando mensaje avanzado:', error);
            res.status(500).json({
                error: 'Error enviando mensaje',
                details: error.message
            });
        }
    });

    // Editar un mensaje
    app.post('/api/my-instance/edit-message', requireAuth, async (req, res) => {
        try {
            const { messageKey, newText } = req.body;
            if (!messageKey || !newText) {
                return res.status(400).json({ error: 'messageKey y newText son requeridos' });
            }
            const instanceManager = global.whatsappInstanceManager;
            await instanceManager.editMessage(req.user.id, messageKey, newText);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Error editando mensaje', details: error.message });
        }
    });

    // Obtener participantes de un grupo
    app.get('/api/my-instance/group-participants/:groupId', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const { groupId } = req.params;
            const instanceManager = global.whatsappInstanceManager;
            const instanceData = instanceManager.getInstance(userId);

            if (!instanceData || !instanceData.sock) {
                return res.status(400).json({ error: 'No hay instancia de WhatsApp activa' });
            }

            const groupJid = groupId.includes('@') ? groupId : `${groupId}@g.us`;
            const groupMetadata = await instanceData.sock.groupMetadata(groupJid);
            const myJid = instanceData.sock.user?.id;
            const myLid = instanceData.sock.user?.lid;

            const participants = groupMetadata.participants
                .filter(p => {
                    // Excluir al bot/soporte propio
                    if (myJid && p.id === myJid) return false;
                    if (myLid && p.lid === myLid) return false;
                    if (myJid && p.id.split(':')[0] === myJid.split(':')[0]) return false;
                    return true;
                })
                .map(p => ({
                    id: p.id,
                    lid: p.lid || null,
                    phone: p.jid ? p.jid.replace('@s.whatsapp.net', '') : (p.id.endsWith('@s.whatsapp.net') ? p.id.replace('@s.whatsapp.net', '') : null),
                    name: p.notify || null,
                    admin: p.admin || null
                }));

            // Cachear participantes en BD (usa p.jid si existe para mapear LID→teléfono real)
            try {
                for (const p of groupMetadata.participants) {
                    const pJid = p.id; // clave primaria en cache
                    const phoneJid = (p.jid && p.jid.endsWith('@s.whatsapp.net'))
                        ? p.jid
                        : (p.id.endsWith('@s.whatsapp.net') ? p.id : null);
                    await database.query(
                        `INSERT INTO group_participants (group_jid, participant_jid, phone_jid, display_name, admin_role)
                         VALUES (?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE phone_jid = COALESCE(VALUES(phone_jid), phone_jid),
                                                  display_name = COALESCE(VALUES(display_name), display_name),
                                                  admin_role = VALUES(admin_role)`,
                        [groupJid, pJid, phoneJid, p.notify || p.verifiedName || null, p.admin || null]
                    );
                    // Si el LID difiere del id principal, también guardar mapeo por LID
                    if (p.lid && p.lid !== p.id) {
                        await database.query(
                            `INSERT INTO group_participants (group_jid, participant_jid, phone_jid, display_name, admin_role)
                             VALUES (?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE phone_jid = COALESCE(VALUES(phone_jid), phone_jid),
                                                      display_name = COALESCE(VALUES(display_name), display_name)`,
                            [groupJid, p.lid, phoneJid, p.notify || p.verifiedName || null, p.admin || null]
                        );
                    }
                }
            } catch (e) {
                console.log('Error cacheando participantes:', e.message);
            }

            // Intentar enriquecer nombres desde los mensajes del log
            const logger = require('../services/logger');
            const logs = await logger.getLogsByClientPhone(groupId);
            const nameMap = {};
            for (const log of logs) {
                if (log.participant && log.userName && log.userName !== 'Usuario desconocido') {
                    nameMap[log.participant] = log.userName;
                }
            }

            // Enriquecer con cache de group_participants
            try {
                const cached = await database.query(
                    'SELECT participant_jid, display_name, phone_jid FROM group_participants WHERE group_jid = ?',
                    [groupJid]
                );
                const cachedMap = {};
                for (const cp of cached) {
                    cachedMap[cp.participant_jid] = cp;
                }
                for (const p of participants) {
                    if (!p.name && nameMap[p.id]) {
                        p.name = nameMap[p.id];
                    }
                    if (!p.name && cachedMap[p.id]?.display_name) {
                        p.name = cachedMap[p.id].display_name;
                    }
                    // Sólo usar el teléfono cacheado si es un JID real (@s.whatsapp.net), nunca un @lid
                    if (!p.phone && cachedMap[p.id]?.phone_jid && cachedMap[p.id].phone_jid.endsWith('@s.whatsapp.net')) {
                        p.phone = cachedMap[p.id].phone_jid.replace('@s.whatsapp.net', '');
                    }
                }
            } catch (e) {
                for (const p of participants) {
                    if (!p.name && nameMap[p.id]) p.name = nameMap[p.id];
                }
            }

            res.json(participants);
        } catch (error) {
            console.error('Error obteniendo participantes del grupo:', error);
            res.status(500).json({ error: 'Error obteniendo participantes', details: error.message });
        }
    });

    // ===== ENDPOINTS DE STICKERS FAVORITOS =====

    // Guardar sticker como favorito
    app.post('/api/my-instance/sticker-favorites', requireAuth, async (req, res) => {
        try {
            const { sticker_url, name } = req.body;

            if (!sticker_url) {
                return res.status(400).json({ error: 'sticker_url es requerido' });
            }

            // Verificar que no exista ya para este usuario
            const existing = await database.findOne(
                'sticker_favorites',
                'user_id = ? AND sticker_url = ?',
                [req.user.id, sticker_url]
            );

            if (existing) {
                return res.status(409).json({ error: 'Este sticker ya está en tus favoritos' });
            }

            await database.insert('sticker_favorites', {
                user_id: req.user.id,
                sticker_url: sticker_url,
                name: name || null
            });

            res.json({ success: true, message: 'Sticker guardado en favoritos' });
        } catch (error) {
            console.error('Error guardando sticker favorito:', error);
            res.status(500).json({ error: 'Error guardando sticker favorito' });
        }
    });

    // Listar stickers favoritos del usuario
    app.get('/api/my-instance/sticker-favorites', requireAuth, async (req, res) => {
        try {
            const stickers = await database.findAll(
                'sticker_favorites',
                'user_id = ?',
                [req.user.id],
                'created_at DESC'
            );

            res.json({ success: true, stickers });
        } catch (error) {
            console.error('Error obteniendo stickers favoritos:', error);
            res.status(500).json({ error: 'Error obteniendo stickers favoritos' });
        }
    });

    // Eliminar sticker favorito
    app.delete('/api/my-instance/sticker-favorites/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;

            // Verificar que pertenece al usuario
            const sticker = await database.findOne(
                'sticker_favorites',
                'id = ? AND user_id = ?',
                [id, req.user.id]
            );

            if (!sticker) {
                return res.status(404).json({ error: 'Sticker no encontrado' });
            }

            await database.delete('sticker_favorites', 'id = ?', [id]);

            res.json({ success: true, message: 'Sticker eliminado de favoritos' });
        } catch (error) {
            console.error('Error eliminando sticker favorito:', error);
            res.status(500).json({ error: 'Error eliminando sticker favorito' });
        }
    });

    // Enviar sticker favorito desde URL (archivo ya almacenado)
    app.post('/api/my-instance/send-sticker-url', requireAuth, async (req, res) => {
        try {
            const { phone, sticker_url } = req.body;

            if (!phone || !sticker_url) {
                return res.status(400).json({ error: 'Phone y sticker_url son requeridos' });
            }

            // Leer el archivo del sticker desde el path
            const cleanUrl = sticker_url.replace(/^\//, '');
            const stickerPath = path.join('/home/container/data', cleanUrl);
            console.log('📤 [STICKER-URL] Path:', stickerPath);
            const stickerBuffer = await fs.readFile(stickerPath);

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

            await instanceManager.sendSticker(req.user.id, chatId, stickerBuffer);

            res.json({ success: true, message: 'Sticker enviado correctamente' });
        } catch (error) {
            console.error('Error enviando sticker desde URL:', error);
            res.status(500).json({
                error: 'Error enviando sticker',
                details: error.message
            });
        }
    });

    // Obtener receipts de un mensaje
    app.get('/api/my-instance/message-receipts/:messageId', requireAuth, async (req, res) => {
        try {
            const { messageId } = req.params;
            const receipts = await database.query(`
                SELECT mr.participant_jid, mr.receipt_type, mr.receipt_timestamp,
                       gp.display_name, gp.phone_jid
                FROM message_receipts mr
                LEFT JOIN group_participants gp
                    ON mr.participant_jid = gp.participant_jid AND mr.group_jid = gp.group_jid
                WHERE mr.message_id = ?
                ORDER BY mr.receipt_type DESC, mr.receipt_timestamp ASC
            `, [messageId]);

            // Buscar nombres también en conversation_logs como fallback
            const nameMap = {};
            try {
                const logs = await database.query(
                    `SELECT DISTINCT participant, user_name FROM conversation_logs
                     WHERE participant IS NOT NULL AND user_name IS NOT NULL AND user_name != 'Usuario desconocido'`
                );
                for (const log of logs) {
                    if (log.participant) nameMap[log.participant] = log.user_name;
                }
            } catch (e) {}

            const participantMap = {};
            for (const r of receipts) {
                const key = r.participant_jid;
                if (!participantMap[key] || r.receipt_type === 'read') {
                    const name = r.display_name || nameMap[r.participant_jid] || r.phone_jid?.split('@')[0] || r.participant_jid.split('@')[0];
                    participantMap[key] = {
                        jid: r.participant_jid,
                        name: name,
                        phone: r.phone_jid?.replace('@s.whatsapp.net', '') || null,
                        status: r.receipt_type,
                        timestamp: r.receipt_timestamp
                    };
                }
            }

            const result = Object.values(participantMap);
            res.json({
                success: true,
                receipts: result,
                summary: {
                    read: result.filter(r => r.status === 'read').length,
                    delivered: result.filter(r => r.status === 'delivered').length,
                    total: result.length
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Error obteniendo receipts', details: error.message });
        }
    });

    // Archivar / desarchivar una conversacion (grupo o cliente) del usuario actual
    app.post('/api/my-instance/archive-contact', requireAuth, async (req, res) => {
        try {
            const { phone, archived } = req.body;

            if (!phone) {
                return res.status(400).json({ error: 'phone es requerido' });
            }

            const cleanPhone = String(phone).replace('@s.whatsapp.net', '').replace('@g.us', '');
            const isArchived = archived ? 1 : 0;

            const result = await database.query(
                `UPDATE client_assignments
                 SET is_archived = ?
                 WHERE support_user_id = ? AND client_phone = ?`,
                [isArchived, req.user.id, cleanPhone]
            );

            if (!result || result.affectedRows === 0) {
                return res.status(404).json({
                    error: 'Conversacion no encontrada para este usuario'
                });
            }

            res.json({
                success: true,
                phone: cleanPhone,
                isArchived: Boolean(isArchived)
            });
        } catch (error) {
            console.error('Error archivando contacto:', error);
            res.status(500).json({
                error: 'Error archivando contacto',
                details: error.message
            });
        }
    });
};
