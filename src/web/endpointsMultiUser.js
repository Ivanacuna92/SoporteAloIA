// Endpoints para gestión multi-usuario y multi-instancia
// Este archivo contiene todos los endpoints necesarios para el sistema multi-usuario

const authService = require('../services/authService');
const database = require('../services/database');
const pushService = require('../services/pushService');
const aiSuggestionService = require('../services/aiSuggestionService');
const docsProjectService = require('../services/docsProjectService');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

// Configurar multer para almacenamiento en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Normaliza un teléfono para WhatsApp. Para números de 10 dígitos (formato
// local MX) prefija '521'. Para 11+ dígitos asume que ya trae lada país.
function normalizeMxPhone(raw) {
    const digits = String(raw || '').replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `521${digits}`;
    return digits;
}

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
        const _t0 = Date.now();
        const _reqId = Math.random().toString(36).slice(2, 8);
        try {
            const userId = req.user.id;
            console.log(`[MC ${_reqId}] START user=${userId}`);

            // Obtener asignaciones del usuario
            const assignments = await database.findAll(
                'client_assignments',
                'support_user_id = ?',
                [userId],
                'last_message_at DESC'
            );
            console.log(`[MC ${_reqId}] assignments=${assignments.length} in ${Date.now()-_t0}ms`);

            // Precargar tags de todos los chats del usuario en una sola query y
            // armar un index por chat_phone para pegarlos en la respuesta sin
            // un fetch extra por chat.
            const tagsByPhone = {};
            const projectByPhone = {};
            if (assignments.length > 0) {
                const phones = assignments.map((a) => a.client_phone);
                const placeholders = phones.map(() => '?').join(',');
                const tagRows = await database.query(
                    `SELECT a.chat_phone, t.id, t.name, t.color
                     FROM chat_tag_assignments a
                     JOIN chat_tags t ON t.id = a.tag_id
                     WHERE a.chat_phone IN (${placeholders})
                     ORDER BY t.id`,
                    phones
                );
                for (const r of tagRows) {
                    (tagsByPhone[r.chat_phone] = tagsByPhone[r.chat_phone] || [])
                        .push({ id: r.id, name: r.name, color: r.color });
                }
                // Links a proyectos de documentacion-aloia (N-a-M, una sola query)
                try {
                    const linkRows = await database.query(
                        `SELECT chat_phone, project_slug FROM chat_project_links WHERE chat_phone IN (${placeholders}) ORDER BY project_slug`,
                        phones
                    );
                    for (const r of linkRows) {
                        (projectByPhone[r.chat_phone] = projectByPhone[r.chat_phone] || []).push(r.project_slug);
                    }
                } catch {}
            }

            // Obtener logs para cada cliente asignado
            const logger = require('../services/logger');
            const humanModeManager = require('../services/humanModeManager');

            // Límite de mensajes por contacto para acelerar la lista.
            // ChatPanel muestra INITIAL_MESSAGES=50 al abrir un chat.
            const CONTACT_LIST_MSG_LIMIT = 50;

            const contacts = await Promise.all(
                assignments.map(async (assignment) => {
                    const [logs, counts, rawMode] = await Promise.all([
                        logger.getLogsByClientPhone(assignment.client_phone, CONTACT_LIST_MSG_LIMIT),
                        logger.getMessageCountsByClientPhone(assignment.client_phone),
                        humanModeManager.getMode(assignment.client_phone)
                    ]);

                    // Agrupar mensajes (solo los últimos CONTACT_LIST_MSG_LIMIT)
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

                    const mode = rawMode === 'support' ? 'support' : 'human';
                    const isHumanMode = mode === 'human';

                    // messages viene en ASC → el último elemento es el más reciente
                    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

                    return {
                        phone: assignment.client_phone,
                        name: assignment.group_name || assignment.client_phone,
                        isGroup: assignment.is_group || false,
                        groupName: assignment.group_name,
                        groupPicture: assignment.group_picture,
                        isArchived: Boolean(assignment.is_archived),
                        botLeftGroupAt: assignment.bot_left_group_at || null,
                        tags: tagsByPhone[assignment.client_phone] || [],
                        projectSlugs: projectByPhone[assignment.client_phone] || [],
                        messages: messages.reverse(), // DESC (más reciente primero) — el frontend reversea de nuevo
                        totalMessages: counts.total,
                        userMessages: counts.userMessages,
                        botMessages: counts.botMessages,
                        lastActivity: assignment.last_message_at,
                        isHumanMode,
                        mode,
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

            console.log(`[MC ${_reqId}] DONE contacts=${contacts.length} total=${Date.now()-_t0}ms`);
            res.json(contacts);
        } catch (error) {
            console.error(`[MC ${_reqId}] ERROR after ${Date.now()-_t0}ms:`, error);
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

    // Paginación hacia atrás: mensajes anteriores a `before` (ISO timestamp).
    app.get('/api/my-contacts/:phone/messages', requireAuth, async (req, res) => {
        try {
            const phone = req.params.phone;
            const before = req.query.before;
            const limit = Math.min(Number(req.query.limit) || 50, 200);

            if (!before) {
                return res.status(400).json({ error: 'before es requerido (ISO timestamp)' });
            }

            // Validar que el contacto está asignado al usuario actual.
            const assignment = await database.findOne(
                'client_assignments',
                'support_user_id = ? AND client_phone = ?',
                [req.user.id, phone]
            );
            if (!assignment) {
                return res.status(404).json({ error: 'Contacto no asignado al usuario' });
            }

            const logger = require('../services/logger');
            const logs = await logger.getLogsByClientPhone(phone, limit, before);

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

            res.json({ messages, hasMore: messages.length === limit });
        } catch (error) {
            console.error('Error obteniendo mensajes anteriores:', error);
            res.status(500).json({ error: 'Error obteniendo mensajes' });
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

            const sendResult = await instanceManager.sendMessage(req.user.id, chatId, message);

            console.log('✅ [SEND-MESSAGE] Mensaje enviado exitosamente');

            // Registrar directamente al enviar. El evento fromMe de Baileys no se
            // está disparando de forma confiable, así que escribimos el log aquí.
            // El handler de messages.upsert tiene check de duplicado por message_id.
            try {
                const logger = require('../services/logger');
                const user = await database.findOne('support_users', 'id = ?', [req.user.id]);
                const userName = user ? user.name : 'Soporte';
                const messageId = sendResult?.key?.id || null;
                await logger.log('soporte', message, phone, userName, true, null, req.user.id, messageId);
                if (global.io) {
                    global.io.emit('new-message', { phone, userName, message });
                }
            } catch (logErr) {
                console.error('[send-message] fallo registrando en DB:', logErr.message);
            }

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
                    'SELECT participant_jid, display_name, custom_name, phone_jid FROM group_participants WHERE group_jid = ?',
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
                    // custom_name (alias puesto a mano desde el panel) siempre gana
                    if (cachedMap[p.id]?.custom_name) {
                        p.customName = cachedMap[p.id].custom_name;
                        p.name = cachedMap[p.id].custom_name;
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

    // ===== ENDPOINTS DE DOCS PROJECTS =====

    // Lista de proyectos disponibles en el mirror de documentacion-aloia
    app.get('/api/my-instance/doc-projects', requireAuth, async (req, res) => {
        try {
            const projects = await docsProjectService.listProjects();
            res.json(projects);
        } catch (e) {
            res.status(500).json({ error: 'Error listando proyectos', details: e.message });
        }
    });

    // Proyectos vinculados al chat (0..N). Devuelve siempre un array de slugs.
    app.get('/api/my-instance/chat-project/:chatPhone', requireAuth, async (req, res) => {
        try {
            const rows = await database.query(
                'SELECT project_slug FROM chat_project_links WHERE chat_phone = ? ORDER BY project_slug',
                [req.params.chatPhone]
            );
            res.json({ chatPhone: req.params.chatPhone, projectSlugs: rows.map(r => r.project_slug) });
        } catch (e) {
            res.status(500).json({ error: 'Error obteniendo links', details: e.message });
        }
    });

    // Agregar un proyecto al chat (idempotente)
    app.post('/api/my-instance/chat-project/add', requireAuth, async (req, res) => {
        try {
            const { chatPhone, projectSlug } = req.body || {};
            if (!chatPhone || !projectSlug) return res.status(400).json({ error: 'chatPhone y projectSlug requeridos' });
            if (!(await docsProjectService.projectExists(projectSlug))) {
                return res.status(400).json({ error: 'Proyecto no existe en el mirror' });
            }
            await database.query(
                'INSERT IGNORE INTO chat_project_links (chat_phone, project_slug) VALUES (?, ?)',
                [chatPhone, projectSlug]
            );
            const rows = await database.query(
                'SELECT project_slug FROM chat_project_links WHERE chat_phone = ? ORDER BY project_slug',
                [chatPhone]
            );
            res.json({ ok: true, chatPhone, projectSlugs: rows.map(r => r.project_slug) });
        } catch (e) {
            res.status(500).json({ error: 'Error agregando proyecto', details: e.message });
        }
    });

    // Quitar un proyecto del chat
    app.post('/api/my-instance/chat-project/remove', requireAuth, async (req, res) => {
        try {
            const { chatPhone, projectSlug } = req.body || {};
            if (!chatPhone || !projectSlug) return res.status(400).json({ error: 'chatPhone y projectSlug requeridos' });
            await database.query(
                'DELETE FROM chat_project_links WHERE chat_phone = ? AND project_slug = ?',
                [chatPhone, projectSlug]
            );
            const rows = await database.query(
                'SELECT project_slug FROM chat_project_links WHERE chat_phone = ? ORDER BY project_slug',
                [chatPhone]
            );
            res.json({ ok: true, chatPhone, projectSlugs: rows.map(r => r.project_slug) });
        } catch (e) {
            res.status(500).json({ error: 'Error quitando proyecto', details: e.message });
        }
    });

    // Toggle de sugerencias IA por chat
    app.get('/api/my-instance/ai-settings/:chatPhone', requireAuth, async (req, res) => {
        try {
            const row = await database.findOne('chat_ai_settings', 'chat_phone = ?', [req.params.chatPhone]);
            res.json({ aiEnabled: row ? row.ai_enabled !== 0 : true });
        } catch (e) {
            res.status(500).json({ error: 'Error leyendo settings', details: e.message });
        }
    });
    app.post('/api/my-instance/ai-settings', requireAuth, async (req, res) => {
        try {
            const { chatPhone, aiEnabled } = req.body || {};
            if (!chatPhone) return res.status(400).json({ error: 'chatPhone requerido' });
            await database.query(
                `INSERT INTO chat_ai_settings (chat_phone, ai_enabled) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE ai_enabled = VALUES(ai_enabled)`,
                [chatPhone, aiEnabled ? 1 : 0]
            );
            res.json({ ok: true, chatPhone, aiEnabled: !!aiEnabled });
        } catch (e) {
            res.status(500).json({ error: 'Error guardando settings', details: e.message });
        }
    });

    // ===== ENDPOINTS DE SUGERENCIAS IA =====

    // Pending de un chat (si existe)
    app.get('/api/my-instance/ai-suggestions/:chatPhone', requireAuth, async (req, res) => {
        try {
            const pending = await aiSuggestionService.getPendingForChat(req.params.chatPhone);
            res.json(pending ? {
                id: pending.id,
                option1: pending.option1,
                option2: pending.option2,
                expiresAt: pending.expires_at,
                triggerMessageId: pending.trigger_message_id,
                createdAt: pending.created_at
            } : null);
        } catch (e) {
            res.status(500).json({ error: 'Error obteniendo sugerencia', details: e.message });
        }
    });

    // Enviar la opcion elegida (1 o 2)
    app.post('/api/my-instance/ai-suggestions/:id/send', requireAuth, async (req, res) => {
        try {
            const choice = req.body?.choice === 2 ? 2 : 1;
            const result = await aiSuggestionService.sendOption(parseInt(req.params.id, 10), choice);
            res.json(result);
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Descartar
    app.post('/api/my-instance/ai-suggestions/:id/dismiss', requireAuth, async (req, res) => {
        try {
            const result = await aiSuggestionService.dismiss(parseInt(req.params.id, 10));
            res.json(result);
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Fijar / limpiar el nombre personalizado de un participante
    app.post('/api/my-instance/group-participant/custom-name', requireAuth, async (req, res) => {
        try {
            const { groupId, participantJid, customName } = req.body || {};
            if (!groupId || !participantJid) {
                return res.status(400).json({ error: 'groupId y participantJid son requeridos' });
            }
            const groupJid = groupId.includes('@') ? groupId : `${groupId}@g.us`;
            const trimmed = typeof customName === 'string' ? customName.trim() : null;
            const value = trimmed ? trimmed.substring(0, 255) : null;

            const existing = await database.findOne(
                'group_participants',
                'group_jid = ? AND participant_jid = ?',
                [groupJid, participantJid]
            );
            if (existing) {
                await database.query(
                    'UPDATE group_participants SET custom_name = ? WHERE group_jid = ? AND participant_jid = ?',
                    [value, groupJid, participantJid]
                );
            } else {
                await database.query(
                    `INSERT INTO group_participants (group_jid, participant_jid, custom_name)
                     VALUES (?, ?, ?)`,
                    [groupJid, participantJid, value]
                );
            }
            res.json({ ok: true, customName: value });
        } catch (error) {
            console.error('Error guardando custom_name:', error);
            res.status(500).json({ error: 'Error guardando nombre', details: error.message });
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

    // ===== WEB PUSH NOTIFICATIONS =====

    app.get('/api/push/vapid-public-key', requireAuth, (req, res) => {
        const key = pushService.getPublicKey();
        if (!key) return res.status(503).json({ error: 'Push no configurado' });
        res.json({ publicKey: key });
    });

    app.post('/api/push/subscribe', requireAuth, async (req, res) => {
        try {
            const subscription = req.body?.subscription;
            if (!subscription?.endpoint) {
                return res.status(400).json({ error: 'Suscripción inválida' });
            }
            await pushService.saveSubscription(req.user.id, subscription);
            res.json({ success: true });
        } catch (error) {
            console.error('Error guardando suscripción push:', error);
            res.status(500).json({ error: 'Error guardando suscripción' });
        }
    });

    app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
        try {
            const endpoint = req.body?.endpoint;
            if (!endpoint) return res.status(400).json({ error: 'endpoint requerido' });
            await pushService.removeSubscription(endpoint);
            res.json({ success: true });
        } catch (error) {
            console.error('Error eliminando suscripción push:', error);
            res.status(500).json({ error: 'Error eliminando suscripción' });
        }
    });

    // ─── Etiquetas de personas Aloia ──────────────────────────────────
    // Catálogo fijo seeded en migración 007. El PUT reemplaza el set completo
    // de etiquetas de un chat con el array que llega — más simple que exponer
    // add/remove por separado y el payload es chico.

    app.get('/api/chat-tags', requireAuth, async (req, res) => {
        try {
            const tags = await database.query('SELECT id, name, color, phone FROM chat_tags ORDER BY id');
            res.json(tags);
        } catch (err) {
            console.error('Error listando chat_tags:', err);
            res.status(500).json({ error: 'Error listando etiquetas' });
        }
    });

    // Debug temporal: inspecciona el formato real del sock.user.id y de los
    // participantes de UN grupo para entender por qué el matching falla.
    app.get('/api/chat-tags/debug-membership/:phone', requireAuth, async (req, res) => {
        try {
            const mgr = global.whatsappInstanceManager;
            const instanceData = mgr.instances.get(req.user.id);
            const sock = instanceData.sock;
            const meta = await sock.groupMetadata(`${req.params.phone}@g.us`);
            res.json({
                botUser: sock.user,
                subject: meta?.subject,
                participantsCount: meta?.participants?.length,
                participantsSample: (meta?.participants || []).slice(0, 6),
            });
        } catch (err) {
            res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 3) });
        }
    });

    // Backfill: para cada grupo, consulta a WhatsApp si el bot sigue siendo
    // miembro. Modo dry-run por defecto (sólo reporta, no modifica DB) para
    // evitar marcar en falso. Pasar ?commit=1 para persistir.
    //
    // Compara el ID del bot contra participants en varias formas (ID, LID,
    // sólo dígitos) porque Baileys devuelve el JID de los participantes en
    // formato variable según si el grupo usa LID o no.
    app.post('/api/chat-tags/backfill-bot-membership', requireAuth, async (req, res) => {
        try {
            const mgr = global.whatsappInstanceManager;
            if (!mgr) return res.status(500).json({ error: 'instance manager no disponible' });
            const instanceData = mgr.instances.get(req.user.id);
            if (!instanceData?.sock) return res.status(400).json({ error: 'instancia no conectada' });
            const sock = instanceData.sock;
            const commit = req.query.commit === '1' || req.body?.commit === true;

            // IDs del bot en todas las variantes para hacer match robusto.
            const botUser = sock.user || {};
            const toDigits = (s) => String(s || '').split(':')[0].split('@')[0];
            const botCandidates = new Set([
                botUser.id, botUser.lid,
                toDigits(botUser.id), toDigits(botUser.lid),
            ].filter(Boolean));

            const groups = await database.query(
                `SELECT id, client_phone, group_name FROM client_assignments
                 WHERE support_user_id = ? AND is_group = 1 AND bot_left_group_at IS NULL`,
                [req.user.id]
            );
            const report = [];
            let marked = 0;
            for (const g of groups) {
                const jid = `${g.client_phone}@g.us`;
                try {
                    const meta = await sock.groupMetadata(jid);
                    const participants = meta?.participants || [];
                    const stillIn = participants.some((p) => {
                        const candidates = [p.id, p.lid, p.jid, p.phoneNumber,
                            toDigits(p.id), toDigits(p.lid), toDigits(p.jid), toDigits(p.phoneNumber)]
                            .filter(Boolean);
                        return candidates.some((c) => botCandidates.has(c));
                    });
                    report.push({ group: g.group_name, participants: participants.length, stillIn });
                    if (!stillIn && commit) {
                        await database.query(
                            'UPDATE client_assignments SET bot_left_group_at = NOW() WHERE id = ?',
                            [g.id]
                        );
                        marked++;
                    }
                } catch (e) {
                    const msg = e?.message || String(e);
                    report.push({ group: g.group_name, error: msg });
                    // En error NO marcamos — podría ser transitorio.
                }
            }
            res.json({
                commit,
                botCandidates: [...botCandidates],
                scanned: groups.length,
                markedIfCommit: report.filter(r => r.stillIn === false).length,
                marked,
                report,
            });
        } catch (err) {
            console.error('Error backfill bot membership:', err);
            res.status(500).json({ error: err.message || 'Error en backfill' });
        }
    });

    // Dispara un aviso de prueba al teléfono registrado de una persona.
    // Reutiliza instanceManager.sendMessage para pasar por el mismo sock del bot.
    app.post('/api/chat-tags/:id/test-notify', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const rows = await database.query('SELECT id, name, phone FROM chat_tags WHERE id = ?', [id]);
            const tag = rows[0];
            if (!tag) return res.status(404).json({ error: 'Etiqueta no encontrada' });
            const digits = normalizeMxPhone(tag.phone);
            if (!digits) return res.status(400).json({ error: 'Esta persona no tiene teléfono registrado' });
            const jid = `${digits}@s.whatsapp.net`;
            const body = `🔔 *Aviso de prueba Aloia*\nHola ${tag.name}, este es un mensaje de prueba desde la plataforma de soporte. Si lo recibes, las notificaciones automáticas al asignarte un chat ya están funcionando correctamente.`;
            const mgr = global.whatsappInstanceManager;
            if (!mgr) return res.status(500).json({ error: 'instance manager no disponible' });
            await mgr.sendMessage(req.user.id, jid, body);
            res.json({ ok: true, sentTo: jid });
        } catch (err) {
            console.error('Error en test-notify:', err);
            res.status(500).json({ error: err.message || 'Error enviando prueba' });
        }
    });

    // Actualiza el teléfono WhatsApp personal de una persona del catálogo.
    // Se usa para que el bot le reenvíe notificaciones cuando llega un mensaje
    // a un chat etiquetado con esa persona (ver whatsappInstanceManager).
    app.put('/api/chat-tags/:id', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
            // Dejamos sólo dígitos; el usuario puede escribir con +, espacios o guiones.
            const raw = String(req.body?.phone ?? '').trim();
            const phone = raw ? raw.replace(/[^0-9]/g, '') : null;
            if (phone && (phone.length < 8 || phone.length > 20)) {
                return res.status(400).json({ error: 'Teléfono inválido (sólo dígitos, 8–20)' });
            }
            await database.query('UPDATE chat_tags SET phone = ? WHERE id = ?', [phone, id]);
            const rows = await database.query('SELECT id, name, color, phone FROM chat_tags WHERE id = ?', [id]);
            res.json(rows[0] || null);
        } catch (err) {
            console.error('Error actualizando teléfono de etiqueta:', err);
            res.status(500).json({ error: 'Error actualizando teléfono' });
        }
    });

    app.get('/api/chat-tag-assignments/:phone', requireAuth, async (req, res) => {
        try {
            const rows = await database.query(
                'SELECT t.id, t.name, t.color FROM chat_tag_assignments a JOIN chat_tags t ON t.id = a.tag_id WHERE a.chat_phone = ? ORDER BY t.id',
                [req.params.phone]
            );
            res.json(rows);
        } catch (err) {
            console.error('Error leyendo tags del chat:', err);
            res.status(500).json({ error: 'Error leyendo etiquetas' });
        }
    });

    app.put('/api/chat-tag-assignments/:phone', requireAuth, async (req, res) => {
        try {
            const phone = req.params.phone;
            const incoming = Array.isArray(req.body?.tagIds) ? req.body.tagIds : [];
            const tagIds = [...new Set(incoming.map((n) => parseInt(n, 10)).filter(Boolean))];
            await database.query('DELETE FROM chat_tag_assignments WHERE chat_phone = ?', [phone]);
            for (const tagId of tagIds) {
                await database.query(
                    'INSERT INTO chat_tag_assignments (chat_phone, tag_id, assigned_by) VALUES (?, ?, ?)',
                    [phone, tagId, req.user?.id || null]
                );
            }
            // Si quedaron etiquetas y el chat estaba archivado, lo rescatamos a
            // la bandeja principal — para que el responsable lo vea de inmediato.
            // Si quitan todas las etiquetas, NO lo re-archivamos (no destructivo).
            let unarchived = false;
            if (tagIds.length > 0) {
                const assignment = await database.query(
                    'SELECT id, is_archived FROM client_assignments WHERE client_phone = ? LIMIT 1',
                    [phone]
                );
                if (assignment[0]?.is_archived) {
                    await database.query(
                        'UPDATE client_assignments SET is_archived = 0 WHERE client_phone = ?',
                        [phone]
                    );
                    unarchived = true;
                }
            }
            // Dispara refresh de la lista en todos los clientes. ContactsList
            // ya escucha 'new-message' y vuelve a cargar la lista; reutilizamos
            // ese canal para no agregar un evento nuevo que el frontend tendría
            // que suscribir aparte.
            if (global.io) {
                global.io.emit('new-message', { phone, reason: 'tags-updated' });
            }
            const rows = await database.query(
                'SELECT t.id, t.name, t.color FROM chat_tag_assignments a JOIN chat_tags t ON t.id = a.tag_id WHERE a.chat_phone = ? ORDER BY t.id',
                [phone]
            );
            res.json({ tags: rows, unarchived });
        } catch (err) {
            console.error('Error guardando tags del chat:', err);
            res.status(500).json({ error: 'Error guardando etiquetas' });
        }
    });
};
