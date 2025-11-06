# Nuevas Funcionalidades Avanzadas de WhatsApp

Este documento describe todas las funcionalidades avanzadas implementadas usando Baileys, similares a WhatsApp Web.

## 📋 Tabla de Contenidos

1. [Formateo de Mensajes](#formateo-de-mensajes)
2. [Responder a Mensajes (Reply/Quote)](#responder-a-mensajes)
3. [Menciones (@)](#menciones)
4. [Reacciones](#reacciones)
5. [Edición de Mensajes](#edición-de-mensajes)
6. [Eliminación de Mensajes](#eliminación-de-mensajes)
7. [Estados de Presencia](#estados-de-presencia)
8. [Ubicaciones](#ubicaciones)
9. [Compartir Contactos](#compartir-contactos)
10. [Stickers](#stickers)
11. [Marcar como Leído](#marcar-como-leído)

---

## 📝 Formateo de Mensajes

WhatsApp soporta formateo de texto usando caracteres especiales:

### Estilos Disponibles

- **Negrita**: Envuelve el texto con asteriscos `*texto*`
  ```
  Ejemplo: *Este texto está en negrita*
  ```

- **Cursiva**: Envuelve el texto con guiones bajos `_texto_`
  ```
  Ejemplo: _Este texto está en cursiva_
  ```

- **Monospace**: Envuelve el texto con tres tildes invertidas ` ```texto``` `
  ```
  Ejemplo: ```Este es código```
  ```

- **Tachado**: Envuelve el texto con virgulillas `~texto~`
  ```
  Ejemplo: ~Este texto está tachado~
  ```

### Saltos de Línea

Simplemente usa `\n` en tu texto para crear saltos de línea:
```javascript
const mensaje = "Primera línea\nSegunda línea\nTercera línea";
```

### Ejemplo Completo

```javascript
const mensaje = "*Hola*! Soy un mensaje con _formato_.\n\n" +
                "Puedo tener:\n" +
                "• *Negritas*\n" +
                "• _Cursivas_\n" +
                "• ~Tachado~\n" +
                "• ```Código```";
```

---

## 💬 Responder a Mensajes (Reply/Quote)

### Endpoint
`POST /api/my-instance/send-message-advanced`

### Parámetros
```javascript
{
  phone: "123456789",           // ID del grupo (sin @g.us)
  message: "Esta es mi respuesta",
  quotedMessageId: "ABC123",    // ID del mensaje original
  quotedRemoteJid: "123456789@g.us",  // JID del chat
  quotedParticipant: "987654321@s.whatsapp.net"  // JID del participante (opcional, para grupos)
}
```

### Ejemplo de Uso en React
```javascript
const replyToMessage = async (messageKey, text) => {
  await fetch('/api/my-instance/send-message-advanced', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: currentChat.phone,
      message: text,
      quotedMessageId: messageKey.id,
      quotedRemoteJid: messageKey.remoteJid,
      quotedParticipant: messageKey.participant
    })
  });
};
```

---

## 📝 Menciones (@)

### Endpoint
`POST /api/my-instance/send-message-advanced`

### Parámetros
```javascript
{
  phone: "123456789",
  message: "Hola @Usuario1 y @Usuario2, ¿cómo están?",
  mentions: [
    "1234567890@s.whatsapp.net",
    "0987654321@s.whatsapp.net"
  ]
}
```

### Cómo Funciona

1. En el mensaje, incluye el nombre del usuario con @
2. En el array `mentions`, proporciona los JIDs completos de WhatsApp de los usuarios mencionados
3. WhatsApp automáticamente resaltará las menciones

### Ejemplo de Uso
```javascript
const mentionUsers = async (userJids, text) => {
  await fetch('/api/my-instance/send-message-advanced', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: currentChat.phone,
      message: text,
      mentions: userJids
    })
  });
};
```

**Nota**: Los JIDs de WhatsApp siguen el formato `[número]@s.whatsapp.net` para usuarios individuales.

---

## 😀 Reacciones

### Endpoint
`POST /api/my-instance/react-message`

### Parámetros
```javascript
{
  messageKey: {
    remoteJid: "123456789@g.us",
    id: "ABC123",
    participant: "987654321@s.whatsapp.net"  // Para grupos
  },
  emoji: "👍"  // Cualquier emoji, o cadena vacía "" para quitar reacción
}
```

### Emojis Comunes
- ❤️ Corazón
- 👍 Like
- 😂 Risa
- 😮 Sorpresa
- 😢 Triste
- 🙏 Agradecimiento

### Quitar Reacción
Para quitar una reacción, envía una cadena vacía como emoji:
```javascript
{ messageKey: {...}, emoji: "" }
```

### Ejemplo de Uso
```javascript
const reactToMessage = async (messageKey, emoji) => {
  await fetch('/api/my-instance/react-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageKey: messageKey,
      emoji: emoji
    })
  });
};
```

---

## ✏️ Edición de Mensajes

### Endpoint
`POST /api/my-instance/edit-message`

### Parámetros
```javascript
{
  messageKey: {
    remoteJid: "123456789@g.us",
    id: "ABC123",
    fromMe: true  // Debe ser un mensaje enviado por ti
  },
  newText: "Texto corregido"
}
```

### Limitaciones
- Solo puedes editar mensajes que **TÚ** enviaste
- WhatsApp tiene un límite de tiempo para editar mensajes (aproximadamente 15 minutos)
- Los mensajes editados muestran un indicador "editado" en WhatsApp

### Ejemplo de Uso
```javascript
const editMessage = async (messageKey, newText) => {
  await fetch('/api/my-instance/edit-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageKey: messageKey,
      newText: newText
    })
  });
};
```

---

## 🗑️ Eliminación de Mensajes

### Endpoint
`POST /api/my-instance/delete-message`

### Parámetros
```javascript
{
  messageKey: {
    remoteJid: "123456789@g.us",
    id: "ABC123",
    fromMe: true  // Solo puedes eliminar tus propios mensajes
  }
}
```

### Limitaciones
- Solo puedes eliminar mensajes que **TÚ** enviaste
- WhatsApp tiene un límite de tiempo para eliminar mensajes (aproximadamente 1 hora)
- La eliminación es para todos (no solo para ti)

### Ejemplo de Uso
```javascript
const deleteMessage = async (messageKey) => {
  await fetch('/api/my-instance/delete-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageKey: messageKey
    })
  });
};
```

---

## 💬 Estados de Presencia

### Endpoint
`POST /api/my-instance/presence`

### Estados Disponibles
- `composing`: Escribiendo...
- `recording`: Grabando audio...
- `paused`: Sin actividad

### Parámetros
```javascript
{
  phone: "123456789",
  state: "composing"
}
```

### Ejemplo de Uso
```javascript
// Mostrar "escribiendo..." mientras el usuario escribe
const showTyping = async (phone) => {
  await fetch('/api/my-instance/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: phone,
      state: 'composing'
    })
  });
};

// Detener el indicador
const stopTyping = async (phone) => {
  await fetch('/api/my-instance/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: phone,
      state: 'paused'
    })
  });
};

// Usar en un campo de texto
<input
  onFocus={() => showTyping(currentChat.phone)}
  onBlur={() => stopTyping(currentChat.phone)}
/>
```

---

## 📍 Ubicaciones

### Endpoint
`POST /api/my-instance/send-location`

### Parámetros
```javascript
{
  phone: "123456789",
  latitude: 19.4326,
  longitude: -99.1332,
  name: "Ciudad de México",        // Opcional
  address: "Centro Histórico"      // Opcional
}
```

### Ejemplo de Uso
```javascript
const sendLocation = async (lat, lng, name, address) => {
  await fetch('/api/my-instance/send-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: currentChat.phone,
      latitude: lat,
      longitude: lng,
      name: name,
      address: address
    })
  });
};

// Usar con geolocalización del navegador
navigator.geolocation.getCurrentPosition(async (position) => {
  await sendLocation(
    position.coords.latitude,
    position.coords.longitude,
    "Mi ubicación",
    ""
  );
});
```

---

## 👤 Compartir Contactos

### Endpoint
`POST /api/my-instance/send-contact`

### Parámetros
```javascript
{
  phone: "123456789",
  contactName: "Juan Pérez",
  contactNumber: "+521234567890"
}
```

### Ejemplo de Uso
```javascript
const shareContact = async (name, number) => {
  await fetch('/api/my-instance/send-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: currentChat.phone,
      contactName: name,
      contactNumber: number
    })
  });
};
```

---

## 🎨 Stickers

### Endpoint
`POST /api/my-instance/send-sticker`

### Formato
Tipo: `multipart/form-data`

### Parámetros
```javascript
FormData {
  phone: "123456789",
  sticker: [File]  // Imagen en formato WebP (recomendado) o PNG/JPEG
}
```

### Requisitos de la Imagen
- Formato recomendado: WebP
- Tamaño: 512x512 píxeles (recomendado)
- Peso máximo: 100KB (recomendado)

### Ejemplo de Uso
```javascript
const sendSticker = async (imageFile) => {
  const formData = new FormData();
  formData.append('phone', currentChat.phone);
  formData.append('sticker', imageFile);

  await fetch('/api/my-instance/send-sticker', {
    method: 'POST',
    body: formData
  });
};

// En un input de archivo
<input
  type="file"
  accept="image/*"
  onChange={(e) => sendSticker(e.target.files[0])}
/>
```

**Nota**: Si envías PNG/JPEG, Baileys intentará convertirlo a WebP automáticamente, pero es mejor pre-procesarlo.

---

## ✅ Marcar como Leído

### Endpoint
`POST /api/my-instance/mark-read`

### Parámetros
```javascript
{
  messageKey: {
    remoteJid: "123456789@g.us",
    id: "ABC123",
    participant: "987654321@s.whatsapp.net"  // Para grupos
  }
}
```

### Ejemplo de Uso
```javascript
const markAsRead = async (messageKey) => {
  await fetch('/api/my-instance/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageKey: messageKey
    })
  });
};

// Marcar automáticamente cuando se abre un chat
useEffect(() => {
  if (currentChat && currentChat.messages.length > 0) {
    const lastMessage = currentChat.messages[0];
    if (lastMessage.key) {
      markAsRead(lastMessage.key);
    }
  }
}, [currentChat]);
```

---

## 🔧 Funcionalidades del Backend (WhatsAppInstanceManager)

Todas estas funcionalidades están implementadas en `src/services/whatsappInstanceManager.js`:

### Métodos Disponibles

```javascript
// Enviar mensaje con opciones
sendMessage(supportUserId, to, message, options)

// Reaccionar a mensaje
reactToMessage(supportUserId, messageKey, emoji)

// Editar mensaje
editMessage(supportUserId, messageKey, newText)

// Enviar ubicación
sendLocation(supportUserId, to, latitude, longitude, name, address)

// Enviar contacto
sendContact(supportUserId, to, contactName, contactNumber)

// Enviar sticker
sendSticker(supportUserId, to, stickerBuffer)

// Marcar como leído
markAsRead(supportUserId, messageKey)

// Actualizar presencia
sendPresenceUpdate(supportUserId, to, state)

// Eliminar mensaje
deleteMessage(supportUserId, messageKey)
```

### Opciones del Método sendMessage

```javascript
const options = {
  // Para responder a un mensaje
  quotedMessageId: "ABC123",
  quotedRemoteJid: "123456789@g.us",
  quotedParticipant: "987654321@s.whatsapp.net",

  // Para mencionar usuarios
  mentions: ["1234567890@s.whatsapp.net", "0987654321@s.whatsapp.net"]
};

await instanceManager.sendMessage(userId, chatId, "Hola @todos", options);
```

---

## 📱 Implementación en el Frontend React

Para implementar estas funcionalidades en tu React dashboard, necesitarás:

### 1. Crear Botones en la UI

Ejemplo de barra de herramientas en el chat:

```jsx
<div className="chat-toolbar">
  <button onClick={() => handleReaction('❤️')}>❤️</button>
  <button onClick={() => handleReaction('👍')}>👍</button>
  <button onClick={() => handleReaction('😂')}>😂</button>
  <button onClick={() => handleEdit()}>✏️ Editar</button>
  <button onClick={() => handleDelete()}>🗑️ Eliminar</button>
  <button onClick={() => handleReply()}>💬 Responder</button>
  <button onClick={() => handleLocation()}>📍 Ubicación</button>
  <button onClick={() => handleContact()}>👤 Contacto</button>
</div>
```

### 2. Crear Funciones de Manejo

```javascript
const handleReaction = async (emoji) => {
  if (!selectedMessage) return;

  await fetch('/api/my-instance/react-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      messageKey: selectedMessage.key,
      emoji: emoji
    })
  });
};

const handleReply = () => {
  setQuotedMessage(selectedMessage);
  // El input de mensaje debe mostrar "Respondiendo a..."
};

const handleMention = (user) => {
  const currentText = messageInput;
  setMessageInput(currentText + `@${user.name} `);
  // Agregar el JID a la lista de menciones
  setMentions([...mentions, user.jid]);
};
```

### 3. Detectar el Estado de Escritura

```jsx
<textarea
  value={messageInput}
  onChange={(e) => {
    setMessageInput(e.target.value);
    // Mostrar "escribiendo..."
    sendPresence('composing');

    // Detener después de 2 segundos de inactividad
    clearTimeout(typingTimeout);
    setTypingTimeout(setTimeout(() => {
      sendPresence('paused');
    }, 2000));
  }}
  onFocus={() => sendPresence('composing')}
  onBlur={() => sendPresence('paused')}
/>
```

### 4. Formateo de Texto con Botones

```jsx
const applyFormat = (format) => {
  const textarea = textareaRef.current;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = messageInput.substring(start, end);

  let formattedText;
  switch(format) {
    case 'bold':
      formattedText = `*${selectedText}*`;
      break;
    case 'italic':
      formattedText = `_${selectedText}_`;
      break;
    case 'monospace':
      formattedText = ` \`\`\`${selectedText}\`\`\` `;
      break;
    case 'strikethrough':
      formattedText = `~${selectedText}~`;
      break;
  }

  const newText = messageInput.substring(0, start) +
                  formattedText +
                  messageInput.substring(end);
  setMessageInput(newText);
};

<div className="format-toolbar">
  <button onClick={() => applyFormat('bold')}>B</button>
  <button onClick={() => applyFormat('italic')}>I</button>
  <button onClick={() => applyFormat('monospace')}>{ }</button>
  <button onClick={() => applyFormat('strikethrough')}>S</button>
</div>
```

---

## 🔑 MessageKey Structure

La estructura de `messageKey` que Baileys utiliza:

```javascript
{
  remoteJid: "123456789@g.us",      // ID del chat
  id: "3EB0XXXXX",                   // ID único del mensaje
  fromMe: true,                      // Si es tu mensaje
  participant: "987654321@s.whatsapp.net"  // Participante en grupos
}
```

Este `messageKey` lo recibes en los eventos de mensajes y lo necesitas para:
- Reaccionar
- Editar
- Eliminar
- Responder
- Marcar como leído

---

## 💡 Tips y Mejores Prácticas

### 1. Validaciones
- Siempre valida que el mensaje sea tuyo antes de intentar editar/eliminar
- Verifica que el `messageKey` exista antes de realizar operaciones

### 2. UX
- Muestra indicadores visuales de "escribiendo..." para mejor experiencia
- Confirma eliminaciones con un modal/diálogo
- Muestra el mensaje original cuando se responde a uno

### 3. Performance
- No envíes estados de presencia muy frecuentemente (usa debounce)
- Cachea los JIDs de los participantes del grupo para menciones

### 4. Manejo de Errores
```javascript
try {
  await sendMessage(...);
} catch (error) {
  if (error.message.includes('time limit')) {
    alert('No puedes editar/eliminar este mensaje (límite de tiempo excedido)');
  } else if (error.message.includes('not from you')) {
    alert('Solo puedes editar/eliminar tus propios mensajes');
  }
}
```

---

## 📚 Recursos Adicionales

- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys)
- [WhatsApp Message Formatting](https://faq.whatsapp.com/539178204879377)
- WhatsApp Web API Reference (no oficial)

---

## 🐛 Debugging

Para ver los mensajes completos con sus keys en la consola:

```javascript
// En el handler de mensajes
console.log('Mensaje recibido:', JSON.stringify(msg, null, 2));
```

Esto te mostrará la estructura completa del mensaje, incluyendo el `messageKey` que necesitas para las operaciones.

---

**Nota**: Todas estas funcionalidades ya están implementadas en el backend. Solo necesitas crear la UI en React para usarlas.
