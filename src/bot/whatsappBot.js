// Baileys 7.x es ESM-only; cargar lazy via dynamic import desde CJS.
let _baileysPromise = null;
const loadBaileys = () => (_baileysPromise ||= import('baileys'));
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const config = require('../config/config');
const logger = require('../services/logger');
const aiService = require('../services/aiService');
const sessionManager = require('../services/sessionManager');
const promptLoader = require('../services/promptLoader');
const humanModeManager = require('../services/humanModeManager');
const followUpService = require('../services/followUpService');

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.currentQR = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.isReconnecting = false;
    }

    async start() {
        if (this.isReconnecting) {
            console.log('Ya hay un intento de reconexión en progreso...');
            return;
        }
        
        this.isReconnecting = true;
        console.log('Iniciando bot de WhatsApp con Baileys...');
        config.validateApiKey();
        
        try {
            const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = await loadBaileys();
            // Configurar autenticación multi-archivo
            const { state, saveCreds } = await useMultiFileAuthState('./auth_baileys');

            // Obtener versión más reciente de Baileys
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`Usando versión de WhatsApp Web: ${version.join('.')} (última: ${isLatest})`);
            
            // Store no es necesario en baileys v6
            
            // Crear socket de WhatsApp con configuración mejorada para producción
            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ['Chrome (Linux)', '', ''],
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                getMessage: async () => {
                    return { conversation: 'No disponible' };
                },
                defaultQueryTimeoutMs: undefined,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                qrTimeout: undefined,
                markOnlineOnConnect: false,
                msgRetryCounterCache: new Map(),
                retryRequestDelayMs: 250,
                maxMsgRetryCount: 5
            });
            
        
        // Guardar credenciales cuando se actualicen
        this.sock.ev.on('creds.update', saveCreds);
        
        // Manejar actualizaciones de conexión
        this.sock.ev.on('connection.update', async (update) => {
            const { DisconnectReason } = await loadBaileys();
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('Escanea este código QR con WhatsApp:');
                console.log('O visita: http://tu-servidor:4242/qr');
                this.currentQR = qr;
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('Conexión cerrada debido a', lastDisconnect?.error, ', reconectando:', shouldReconnect);
                
                // Si es error 405 o 401, limpiar sesión y reiniciar con límite
                if (statusCode === 405 || statusCode === 401 || statusCode === 403) {
                    this.reconnectAttempts++;
                    
                    if (this.reconnectAttempts > this.maxReconnectAttempts) {
                        console.log('❌ Máximo de intentos de reconexión alcanzado. Por favor usa el botón de reiniciar sesión en /qr');
                        this.isReconnecting = false;
                        return;
                    }
                    
                    console.log(`Error ${statusCode} detectado. Intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}. Limpiando sesión...`);
                    this.clearSession();
                    
                    this.isReconnecting = false;
                    setTimeout(() => this.start(), 5000);
                } else if (shouldReconnect && statusCode !== DisconnectReason.loggedOut) {
                    this.reconnectAttempts = 0;
                    this.isReconnecting = false;
                    setTimeout(() => this.start(), 5000);
                } else {
                    this.isReconnecting = false;
                }
            } else if (connection === 'open') {
                console.log('¡Bot de WhatsApp conectado y listo!');
                this.currentQR = null;
                this.reconnectAttempts = 0;
                this.isReconnecting = false;
                logger.log('SYSTEM', 'Bot iniciado correctamente con Baileys');
                sessionManager.startCleanupTimer(this.sock);
                followUpService.startFollowUpTimer(this.sock);
            }
        });
        
        } catch (error) {
            console.error('Error iniciando bot:', error);
            this.isReconnecting = false;
            
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`Reintentando en 5 segundos... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.start(), 5000);
            }
        }
        
        // Manejar actualizaciones de estado de mensajes
        this.sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                try {
                    const messageId = update.key.id;
                    const userId = update.key.remoteJid?.replace('@s.whatsapp.net', '');

                    // Log para debugging
                    console.log('📱 Update recibido:', JSON.stringify(update, null, 2));

                    // Determinar el estado según el update
                    let status = null;

                    // Status codes de WhatsApp:
                    // 1 = sent (enviado al servidor)
                    // 2 = delivered (entregado al dispositivo)
                    // 3 = played (mensaje de voz reproducido o estado intermedio)
                    // 4 = read (leído - checks azules)

                    if (update.update.status === 4) {
                        status = 'read'; // Mensaje leído (checks azules)
                        console.log('🔵 LEÍDO detectado - Status 4');
                    } else if (update.update.status === 2) {
                        status = 'delivered'; // Mensaje entregado (double check gris)
                        console.log('⚪ ENTREGADO detectado - Status 2');
                    } else if (update.update.status === 1) {
                        status = 'sent'; // Mensaje enviado (single check)
                        console.log('⚪ ENVIADO detectado - Status 1');
                    }
                    // Ignorar status 3 (estado intermedio/voz reproducida)

                    if (status && messageId) {
                        await logger.updateMessageStatus(messageId, status);
                        console.log(`✅ Estado actualizado: ${messageId} -> ${status} (Usuario: ${userId})`);
                    }
                } catch (error) {
                    console.error('Error actualizando estado de mensaje:', error);
                }
            }
        });

        // Manejar mensajes entrantes
        this.sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message) return;
                
                // Log para debugging
                console.log('Mensaje recibido - fromMe:', msg.key.fromMe, 'remoteJid:', msg.key.remoteJid);
                
                // Ignorar mensajes propios
                if (msg.key.fromMe) {
                    console.log('Ignorando mensaje propio');
                    return;
                }
                
                // Obtener el número del remitente
                const from = msg.key.remoteJid;
                const isGroup = from.endsWith('@g.us');

                // Solo responder en grupos - Ignorar mensajes privados/directos
                if (!isGroup) {
                    console.log('📛 Mensaje privado ignorado - Solo se responde en grupos');
                    return;
                }

                // Obtener el texto del mensaje
                const conversation = msg.message.conversation ||
                                   msg.message.extendedTextMessage?.text ||
                                   '';

                // Ignorar mensajes sin texto
                if (!conversation || conversation.trim() === '') {
                    console.log('Mensaje ignorado - Sin contenido de texto');
                    return;
                }

                // Para grupos: obtener ID del grupo y del participante
                const groupId = from.replace('@g.us', '');
                const participantId = msg.key.participant ? msg.key.participant.replace('@s.whatsapp.net', '') : '';
                const userName = msg.pushName || participantId || groupId;

                await logger.log('cliente', conversation, groupId, userName, true);

                // YA NO HAY IA - Solo registrar el mensaje entrante
                // Los humanos responderán manualmente desde el panel
                await logger.log('SYSTEM', `Mensaje recibido en grupo ${groupId} de ${userName} (${participantId}) - Esperando respuesta humana`);

                // Cancelar seguimiento si existe
                if (followUpService.hasActiveFollowUp(groupId)) {
                    await followUpService.cancelFollowUp(groupId, 'Cliente respondió');
                }
                
            } catch (error) {
                await this.handleError(error, m.messages[0]);
            }
        });
    }
    
    async processMessage(userId, userMessage, chatId) {
        // Agregar mensaje del usuario a la sesión
        await sessionManager.addMessage(userId, 'user', userMessage, chatId);

        // Solo chats individuales (grupos están desactivados)
        const systemPrompt = promptLoader.getPrompt(false);

        // Preparar mensajes para la IA
        const messages = [
            { role: 'system', content: systemPrompt },
            ...(await sessionManager.getMessages(userId, chatId))
        ];

        // Generar respuesta con IA
        const aiResponse = await aiService.generateResponse(messages);

        // Verificar si la respuesta contiene el marcador de activar soporte
        if (aiResponse.includes('{{ACTIVAR_SOPORTE}}')) {
            // Remover el marcador de la respuesta
            const cleanResponse = aiResponse.replace('{{ACTIVAR_SOPORTE}}', '').trim();

            // Activar modo soporte
            await humanModeManager.setMode(userId, 'support');
            await sessionManager.updateSessionMode(userId, chatId, 'support');

            // Agregar respuesta limpia a la sesión
            await sessionManager.addMessage(userId, 'assistant', cleanResponse, chatId);

            // Registrar en logs
            await logger.log('SYSTEM', `Modo SOPORTE activado automáticamente para ${userId}`);

            return cleanResponse;
        }

        // Agregar respuesta de IA a la sesión
        await sessionManager.addMessage(userId, 'assistant', aiResponse, chatId);

        return aiResponse;
    }
    
    async handleError(error, message) {
        console.error('Error procesando mensaje:', error);
        
        const from = message.key.remoteJid;
        const userId = from.replace('@s.whatsapp.net', '');
        
        let errorMessage = 'Lo siento, ocurrió un error. Inténtalo de nuevo.';
        
        if (error.message.includes('autenticación') || error.message.includes('API key')) {
            errorMessage = 'Error de configuración del bot. Por favor, contacta al administrador.';
        }
        
        try {
            await this.sock.sendMessage(from, { text: errorMessage });
            logger.log('ERROR', error.message, userId);
        } catch (sendError) {
            console.error('Error enviando mensaje de error:', sendError);
        }
    }
    
    async stop() {
        console.log('Cerrando bot...');
        if (this.sock) {
            this.sock.end();
        }
    }
    
    async clearSession() {
        const fs = require('fs').promises;
        const path = require('path');
        const authPath = path.join(process.cwd(), 'auth_baileys');
        
        try {
            await fs.rm(authPath, { recursive: true, force: true });
            console.log('Sesión eliminada correctamente');
        } catch (err) {
            console.log('No había sesión previa o ya fue eliminada');
        }
    }
    
    async logout() {
        console.log('Cerrando sesión de WhatsApp...');
        try {
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (err) {
                    console.log('Error al hacer logout:', err.message);
                }
            }
            
            await this.clearSession();
            
            // Reiniciar el bot para generar nuevo QR
            setTimeout(() => this.start(), 2000);
            return true;
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
            return false;
        }
    }
}

module.exports = WhatsAppBot;