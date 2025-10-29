# Instrucciones para Habilitar Visualización de Imágenes

## 🎯 Pasos a Seguir

### 1. Ejecutar el código SQL en phpMyAdmin

1. Accede a **phpMyAdmin**
2. Selecciona tu base de datos (el nombre está en tu archivo `.env` como `DB_NAME`)
3. Ve a la pestaña **SQL**
4. Copia y pega el siguiente código SQL:

```sql
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

-- 3. Verificar que las columnas se crearon correctamente
SHOW COLUMNS FROM conversation_logs;
```

5. Haz clic en **Ejecutar** o **Go**
6. Deberías ver un mensaje de éxito confirmando que las columnas se agregaron

### 2. Verificar que los directorios se crearon

Los directorios para almacenar los medios ya fueron creados automáticamente en:
```
/data/media/
  ├── images/      (para imágenes)
  ├── videos/      (para videos)
  ├── documents/   (para documentos)
  ├── audio/       (para audios)
  └── stickers/    (para stickers)
```

### 3. Reiniciar el servidor

Después de ejecutar el SQL, reinicia el servidor de Node.js:

```bash
npm run dev
```

O si está en producción:

```bash
npm start
```

## ✅ Características Implementadas

### 📎 Tipos de medios soportados:

1. **Imágenes** (JPG, PNG, WebP, etc.)
   - Se muestran inline en el chat
   - Clickeables para abrir en tamaño completo

2. **Videos** (MP4, AVI, etc.)
   - Reproductor integrado con controles
   - Se pueden reproducir directamente en el chat

3. **Documentos** (PDF, DOC, XLS, etc.)
   - Icono de documento
   - Botón de descarga
   - Muestra el nombre del archivo

4. **Audios** (OGG, MP3, etc.)
   - Reproductor de audio inline
   - Controles de reproducción

5. **Stickers**
   - Se muestran como imágenes pequeñas
   - Formato WebP

### 🎨 Interfaz de Usuario

- **Mensajes de clientes con imágenes**: Aparecen en burbujas blancas con la imagen/video/documento
- **Indicador visual**: Emoji 📎 en los logs de consola cuando hay medios
- **Responsive**: Las imágenes se ajustan automáticamente al tamaño del contenedor
- **Interactivo**: Click en imágenes para ver en tamaño completo

### 📊 Base de Datos

Se agregaron los siguientes campos a la tabla `conversation_logs`:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `has_media` | BOOLEAN | Indica si el mensaje tiene medios adjuntos |
| `media_type` | VARCHAR(50) | Tipo de medio (image, video, audio, document, sticker) |
| `media_url` | TEXT | URL relativa del archivo guardado |
| `media_mimetype` | VARCHAR(100) | Tipo MIME del archivo |
| `media_filename` | VARCHAR(255) | Nombre del archivo original |
| `media_caption` | TEXT | Caption/descripción del medio (si existe) |

## 🔍 Verificación

Para verificar que todo funciona correctamente:

1. Envía una imagen a un grupo donde esté el bot
2. Ve al panel web en http://localhost:3001
3. Abre la conversación del grupo
4. Deberías ver la imagen en el chat
5. En la consola del servidor deberías ver: `📎 Medio guardado: image - [nombre_archivo].jpg`

## 🐛 Solución de Problemas

### No se muestran las imágenes:

1. **Verifica que el SQL se ejecutó correctamente**:
   ```sql
   SHOW COLUMNS FROM conversation_logs;
   ```
   Deberías ver las columnas `has_media`, `media_type`, etc.

2. **Verifica que los directorios existen**:
   ```bash
   ls -la data/media/
   ```

3. **Verifica permisos de escritura**:
   ```bash
   chmod -R 755 data/media/
   ```

4. **Revisa los logs del servidor** para ver si hay errores al descargar medios

### Las imágenes se descargan pero no se muestran:

1. Verifica que el servidor web esté sirviendo correctamente la carpeta `/media`:
   - Abre http://localhost:3001/media/ en el navegador
   - Deberías ver un listado de carpetas (images, videos, etc.)

2. Revisa la consola del navegador (F12) para ver errores de carga de recursos

## 📝 Notas Técnicas

- Los archivos se guardan con un nombre único: `{userId}_{timestamp}.{extension}`
- Las imágenes se almacenan en `data/media/images/`
- Los videos en `data/media/videos/`
- Los documentos en `data/media/documents/`
- La URL se genera como `/media/{type}s/{filename}` para servirse vía Express

## 🎉 ¡Listo!

Ahora podrás visualizar todos los mensajes que contengan imágenes, videos, documentos, audios y stickers directamente en el panel web del dashboard.
