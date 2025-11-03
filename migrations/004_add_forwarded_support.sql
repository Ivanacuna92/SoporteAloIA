-- Agregar soporte para detectar mensajes reenviados en la tabla conversation_logs

-- Agregar columna para indicar si el mensaje fue reenviado
ALTER TABLE conversation_logs
ADD COLUMN is_forwarded BOOLEAN DEFAULT FALSE AFTER media_caption;

-- Agregar índice para búsquedas de mensajes reenviados
ALTER TABLE conversation_logs
ADD INDEX idx_is_forwarded (is_forwarded);

-- Verificar que la columna se creó correctamente
SHOW COLUMNS FROM conversation_logs;
