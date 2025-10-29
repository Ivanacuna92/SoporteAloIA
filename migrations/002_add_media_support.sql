-- Agregar soporte para medios (imágenes, videos, documentos, etc.) en la tabla conversation_logs

-- 1. Agregar columnas para información de medios
ALTER TABLE conversation_logs
ADD COLUMN has_media BOOLEAN DEFAULT FALSE AFTER message,
ADD COLUMN media_type VARCHAR(50) NULL AFTER has_media,
ADD COLUMN media_url TEXT NULL AFTER media_type,
ADD COLUMN media_mimetype VARCHAR(100) NULL AFTER media_url,
ADD COLUMN media_filename VARCHAR(255) NULL AFTER media_mimetype,
ADD COLUMN media_caption TEXT NULL AFTER media_filename;

-- 2. Agregar índice para búsquedas de mensajes con medios
ALTER TABLE conversation_logs
ADD INDEX idx_has_media (has_media);

-- 3. Crear directorio para almacenar medios (nota: esto debe hacerse manualmente en el servidor)
-- CREAR CARPETA: /data/media/images/
-- CREAR CARPETA: /data/media/videos/
-- CREAR CARPETA: /data/media/documents/
-- CREAR CARPETA: /data/media/audio/
-- CREAR CARPETA: /data/media/stickers/

-- Verificar que las columnas se crearon correctamente
SHOW COLUMNS FROM conversation_logs;
