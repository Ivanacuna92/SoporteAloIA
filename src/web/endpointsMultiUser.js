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
                        // Campos de medios
                        hasMedia: log.hasMedia || false,
                        mediaType: log.mediaType,
                        mediaUrl: log.mediaUrl,
                        mediaMimetype: log.mediaMimetype,
                        mediaFilename: log.mediaFilename,
                        mediaCaption: log.mediaCaption,
                        // Campo de mensaje reenviado
                        isForwarded: log.isForwarded || false,
                        // Campos de mensaje citado
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
                            userName: lastMsg.userName, // Agregar nombre del usuario
                            role: lastMsg.role // Agregar rol para identificar si es cliente
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

            // Registrar el mensaje (isGroup siempre true)
            const logger = require('../services/logger');
            await logger.log('soporte', message, phone, req.user.name, true, req.user.id);

            console.log('✅ [SEND-MESSAGE] Mensaje registrado en logs');

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

            // Guardar archivo localmente para poder mostrarlo en el chat
            const ext = req.file.mimetype.split('/')[1] || 'jpg';
            const filename = `${phone}_${Date.now()}.${ext}`;
            const mediaDir = path.join(process.cwd(), 'data', 'media', 'images');
            await fs.mkdir(mediaDir, { recursive: true });
            await fs.writeFile(path.join(mediaDir, filename), req.file.buffer);
            const mediaUrl = `/media/images/${filename}`;

            // Registrar el mensaje
            const logger = require('../services/logger');
            const mediaInfo = {
                has_media: true,
                media_type: 'image',
                media_url: mediaUrl,
                media_mimetype: req.file.mimetype,
                media_filename: req.file.originalname,
                media_caption: caption || ''
            };
            // log(role, message, userId, userName, isGroup, response, supportUserId, messageId, mediaInfo, isForwarded)
            await logger.log('soporte', caption || '', phone, req.user.name, true, null, req.user.id, null, mediaInfo, false);

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

            // Guardar archivo localmente para poder mostrarlo en el chat
            const filename = `${phone}_${Date.now()}_${req.file.originalname}`;
            const mediaDir = path.join(process.cwd(), 'data', 'media', 'documents');
            await fs.mkdir(mediaDir, { recursive: true });
            await fs.writeFile(path.join(mediaDir, filename), req.file.buffer);
            const mediaUrl = `/media/documents/${filename}`;

            // Registrar el mensaje
            const logger = require('../services/logger');
            const mediaInfo = {
                has_media: true,
                media_type: 'document',
                media_url: mediaUrl,
                media_mimetype: req.file.mimetype,
                media_filename: req.file.originalname,
                media_caption: caption || ''
            };
            // log(role, message, userId, userName, isGroup, response, supportUserId, messageId, mediaInfo, isForwarded)
            await logger.log('soporte', caption || '', phone, req.user.name, true, null, req.user.id, null, mediaInfo, false);

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

            // Guardar archivo localmente para poder mostrarlo en el chat
            const ext = req.file.mimetype.split('/')[1] || 'mp3';
            const filename = `${phone}_${Date.now()}.${ext}`;
            const mediaDir = path.join(process.cwd(), 'data', 'media', 'audios');
            await fs.mkdir(mediaDir, { recursive: true });
            await fs.writeFile(path.join(mediaDir, filename), req.file.buffer);
            const mediaUrl = `/media/audios/${filename}`;

            // Registrar el mensaje
            const logger = require('../services/logger');
            const mediaInfo = {
                has_media: true,
                media_type: 'audio',
                media_url: mediaUrl,
                media_mimetype: req.file.mimetype,
                media_filename: req.file.originalname,
                media_caption: null
            };
            // log(role, message, userId, userName, isGroup, response, supportUserId, messageId, mediaInfo, isForwarded)
            await logger.log('soporte', '', phone, req.user.name, true, null, req.user.id, null, mediaInfo, false);

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

            // Guardar archivo localmente para poder mostrarlo en el chat
            const ext = req.file.mimetype.split('/')[1] || 'mp4';
            const filename = `${phone}_${Date.now()}.${ext}`;
            const mediaDir = path.join(process.cwd(), 'data', 'media', 'videos');
            await fs.mkdir(mediaDir, { recursive: true });
            await fs.writeFile(path.join(mediaDir, filename), req.file.buffer);
            const mediaUrl = `/media/videos/${filename}`;

            // Registrar el mensaje
            const logger = require('../services/logger');
            const mediaInfo = {
                has_media: true,
                media_type: 'video',
                media_url: mediaUrl,
                media_mimetype: req.file.mimetype,
                media_filename: req.file.originalname,
                media_caption: caption || ''
            };
            // log(role, message, userId, userName, isGroup, response, supportUserId, messageId, mediaInfo, isForwarded)
            await logger.log('soporte', caption || '', phone, req.user.name, true, null, req.user.id, null, mediaInfo, false);

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

            // Registrar el mensaje
            const logger = require('../services/logger');
            await logger.log('soporte', '[Mensaje reenviado]', phone, req.user.name, true, req.user.id);

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
            const { phone, message, quotedMessageId, quotedRemoteJid, quotedParticipant, mentions } = req.body;

            if (!phone || !message) {
                return res.status(400).json({
                    error: 'Phone y message son requeridos'
                });
            }

            const instanceManager = global.whatsappInstanceManager;
            const chatId = `${phone}@g.us`;

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

            // Registrar el mensaje
            const logger = require('../services/logger');
            await logger.log('soporte', message, phone, req.user.name, true, req.user.id);

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
};
