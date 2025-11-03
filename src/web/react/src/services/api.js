const API_BASE = '/api';

// Configuración para incluir cookies en todas las requests
const fetchWithCredentials = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Incluir cookies
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return response;
};

// ===== FUNCIONES DE AUTENTICACIÓN =====

export async function login(email, password) {
  const response = await fetchWithCredentials(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Error al iniciar sesión');
  }
  
  return response.json();
}

export async function logout() {
  const response = await fetchWithCredentials(`${API_BASE}/auth/logout`, {
    method: 'POST'
  });
  
  if (!response.ok) {
    throw new Error('Error al cerrar sesión');
  }
  
  return response.json();
}

export async function checkAuth() {
  const response = await fetchWithCredentials(`${API_BASE}/auth/me`);
  
  if (!response.ok) {
    if (response.status === 401) {
      return null; // No autenticado
    }
    throw new Error('Error verificando autenticación');
  }
  
  return response.json();
}

// ===== FUNCIONES EXISTENTES (actualizadas para usar fetchWithCredentials) =====

export async function fetchStats(date) {
  const url = date ? `${API_BASE}/stats/${date}` : `${API_BASE}/stats`;
  const response = await fetchWithCredentials(url);
  if (!response.ok) throw new Error('Error fetching stats');
  return response.json();
}

export async function fetchDates() {
  const response = await fetchWithCredentials(`${API_BASE}/dates`);
  if (!response.ok) throw new Error('Error fetching dates');
  return response.json();
}

export async function fetchContacts() {
  try {
    const logsResponse = await fetchWithCredentials(`${API_BASE}/logs/`);
    if (!logsResponse.ok) {
      if (logsResponse.status === 401) {
        window.location.href = '/';
        return [];
      }
      throw new Error('Error fetching logs');
    }
    const logs = await logsResponse.json();
    
    const humanStatesResponse = await fetchWithCredentials(`${API_BASE}/human-states`);
    const humanStates = humanStatesResponse.ok ? await humanStatesResponse.json() : {};
    
    const processedContacts = processContactsFromLogs(logs, humanStates);
    
    return processedContacts;
  } catch (error) {
    // Error silencioso
    throw error;
  }
}

export async function toggleHumanMode(phone, isHumanMode, mode = null) {
  const body = mode ? { phone, mode } : { phone, isHumanMode };
  
  const response = await fetchWithCredentials(`${API_BASE}/human-states`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error('Error actualizando modo');
  }
  
  return response.json();
}

export async function sendMessage(phone, message, isGroup = false) {
  // Formatear el phone con el sufijo correcto si no lo tiene
  let formattedPhone = phone;
  if (!phone.includes('@')) {
    formattedPhone = isGroup ? `${phone}@g.us` : `${phone}@s.whatsapp.net`;
  }

  const response = await fetchWithCredentials(`${API_BASE}/send-message`, {
    method: 'POST',
    body: JSON.stringify({ phone: formattedPhone, message })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || 'Error enviando mensaje');
  }

  return response.json();
}

export async function endConversation(phone) {
  const response = await fetchWithCredentials(`${API_BASE}/end-conversation`, {
    method: 'POST',
    body: JSON.stringify({ phone })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || 'Error finalizando conversación');
  }

  return response.json();
}

export async function deleteConversation(phone) {
  const response = await fetchWithCredentials(`${API_BASE}/delete-conversation`, {
    method: 'POST',
    body: JSON.stringify({ phone })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || 'Error eliminando conversación');
  }

  return response.json();
}

export async function leaveGroup(phone) {
  const response = await fetchWithCredentials(`${API_BASE}/leave-group`, {
    method: 'POST',
    body: JSON.stringify({ phone })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || 'Error saliendo del grupo');
  }

  return response.json();
}

function processContactsFromLogs(logs, humanStates) {
  const contacts = {};
  
  const filteredLogs = logs.filter(log => {
    // Filtrar mensajes del sistema innecesarios
    if (log.type === 'SYSTEM' && log.message && 
        (log.message.includes('Modo HUMANO activo') || 
         log.message.includes('Modo SOPORTE activo') ||
         log.message.includes('Mensaje ignorado') ||
         log.message.includes('Conversación reiniciada por inactividad'))) {
      return false;
    }
    // Incluir mensajes con tipo USER, BOT, HUMAN, SYSTEM o CLIENTE (conversión legacy)
    return log.type === 'USER' || log.type === 'BOT' || log.type === 'HUMAN' || log.type === 'SYSTEM' || log.type === 'CLIENTE';
  });
  
  filteredLogs.forEach(log => {
    const phone = log.userId || 'Sin número';

    if (!contacts[phone]) {
      // Determinar el modo actual del contacto
      let mode = 'ai';
      let isHumanMode = false;

      if (humanStates[phone] === 'support') {
        mode = 'support';
        isHumanMode = false;
      } else if (humanStates[phone] === 'human' || humanStates[phone] === true) {
        mode = 'human';
        isHumanMode = true;
      }

      // Convertir isGroup a booleano (puede venir como 0/1 de la BD)
      const isGroupChat = Boolean(log.isGroup);

      contacts[phone] = {
        phone: phone,
        messages: [],
        totalMessages: 0,
        userMessages: 0,
        botMessages: 0,
        firstContact: log.timestamp,
        lastActivity: log.timestamp,
        lastMessage: null,
        isHumanMode: isHumanMode,
        mode: mode,
        isGroup: isGroupChat,
        groupName: isGroupChat ? log.userName : null,
        leftGroup: false // Inicialmente no ha salido
      };
    }

    // Actualizar isGroup y groupName si este log indica que es un grupo
    if (log.isGroup && !contacts[phone].isGroup) {
      contacts[phone].isGroup = true;
      contacts[phone].groupName = log.userName;
    }

    // Detectar si el bot salió del grupo
    if (log.type === 'SYSTEM' && log.message && log.message.includes('Bot salió del grupo')) {
      contacts[phone].leftGroup = true;
    }

    // Los mensajes BOT se mantienen como BOT
    // Solo marcar como SYSTEM los que realmente son del sistema (no de conversación)
    let processedLog = {...log};

    contacts[phone].messages.push(processedLog);
    contacts[phone].totalMessages++;
    contacts[phone].lastActivity = log.timestamp;

    if (log.type === 'USER' || log.type === 'CLIENTE') {
      contacts[phone].userMessages++;
    } else if (log.type === 'BOT' || log.type === 'HUMAN') {
      contacts[phone].botMessages++;
    }

    // Actualizar lastMessage solo si este mensaje es más reciente
    if (log.type === 'USER' || log.type === 'CLIENTE' || log.type === 'BOT' || log.type === 'HUMAN') {
      const messageTimestamp = new Date(log.timestamp);
      const lastMessageTimestamp = contacts[phone].lastMessage ? new Date(contacts[phone].lastMessage.time) : null;

      if (!lastMessageTimestamp || messageTimestamp >= lastMessageTimestamp) {
        contacts[phone].lastMessage = {
          text: log.message,
          time: log.timestamp,
          type: log.type === 'USER' || log.type === 'CLIENTE' ? 'user' : log.type.toLowerCase()
        };
      }
    }
  });
  
  return Object.values(contacts)
    .filter(contact => contact.phone !== 'Sin número')
    .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}

// Obtener reportes de conversaciones
export async function getReports(date) {
  const url = date 
    ? `${API_BASE}/reports/${date}`
    : `${API_BASE}/reports`;
    
  const response = await fetchWithCredentials(url);
  
  if (!response.ok) {
    throw new Error('Error al obtener reportes');
  }
  
  return response.json();
}

// Actualizar estado de venta
export async function updateSaleStatus(conversationId, data) {
  const response = await fetchWithCredentials(`${API_BASE}/reports/sale-status`, {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      ...data
    })
  });
  
  if (!response.ok) {
    throw new Error('Error al actualizar estado de venta');
  }
  
  return response.json();
}

// Obtener estadísticas de ventas
export async function getSalesStats(date) {
  const url = date 
    ? `${API_BASE}/sales-stats/${date}`
    : `${API_BASE}/sales-stats`;
    
  const response = await fetchWithCredentials(url);
  
  if (!response.ok) {
    throw new Error('Error al obtener estadísticas de ventas');
  }
  
  return response.json();
}

// Analizar conversación con IA
export async function analyzeConversation(messages) {
  const response = await fetchWithCredentials(`${API_BASE}/analyze-conversation`, {
    method: 'POST',
    body: JSON.stringify({ messages })
  });
  
  if (!response.ok) {
    throw new Error('Error al analizar conversación');
  }
  
  return response.json();
}

// ===== FUNCIONES DE GESTIÓN DE CSV =====

export async function uploadCSV(formData) {
  const response = await fetch(`${API_BASE}/csv/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    const error = new Error(errorData.error || 'Error al cargar archivo CSV');
    error.response = { data: errorData };
    throw error;
  }
  
  return response.json();
}

export async function getUploadedCSVs() {
  const response = await fetchWithCredentials(`${API_BASE}/csv/list`);
  
  if (!response.ok) {
    throw new Error('Error al obtener archivos CSV');
  }
  
  return response.json();
}

export async function deleteCSV(filename) {
  const response = await fetchWithCredentials(`${API_BASE}/csv/delete/${filename}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Error al eliminar archivo CSV');
  }

  return response.json();
}

// ===== FUNCIONES DE WHATSAPP =====

export async function checkWhatsAppStatus() {
  try {
    const response = await fetchWithCredentials(`${API_BASE}/qr`);

    if (!response.ok) {
      return { connected: false, error: true };
    }

    const data = await response.json();
    // Si hay QR, no está conectado. Si no hay QR, está conectado.
    return { connected: !data.qr, error: false };
  } catch (error) {
    return { connected: false, error: true };
  }
}

// ===== FUNCIONES DE CONFIGURACIÓN DEL SISTEMA =====

export async function getAIConfig() {
  try {
    const response = await fetchWithCredentials(`${API_BASE}/system-config`);

    if (!response.ok) {
      return { groupsAIEnabled: true, individualAIEnabled: true }; // Default values
    }

    const data = await response.json();
    return {
      groupsAIEnabled: data.groups_ai_enabled?.value === 'true',
      individualAIEnabled: data.individual_ai_enabled?.value === 'true'
    };
  } catch (error) {
    return { groupsAIEnabled: true, individualAIEnabled: true }; // Default values
  }
}

// ===== FUNCIONES DE GESTIÓN DE USUARIOS (MULTI-USER) =====

// Obtener todos los usuarios (solo admin)
export async function getUsers() {
  const response = await fetchWithCredentials(`${API_BASE}/users`);

  if (!response.ok) {
    throw new Error('Error al obtener usuarios');
  }

  return response.json();
}

// Crear nuevo usuario (solo admin)
export async function createUser(userData) {
  const response = await fetchWithCredentials(`${API_BASE}/users`, {
    method: 'POST',
    body: JSON.stringify(userData)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al crear usuario');
  }

  return response.json();
}

// Actualizar usuario (solo admin)
export async function updateUser(id, userData) {
  const response = await fetchWithCredentials(`${API_BASE}/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(userData)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al actualizar usuario');
  }

  return response.json();
}

// Eliminar usuario (solo admin)
export async function deleteUser(id) {
  const response = await fetchWithCredentials(`${API_BASE}/users/${id}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al eliminar usuario');
  }

  return response.json();
}

// ===== FUNCIONES DE GESTIÓN DE INSTANCIAS DE WHATSAPP =====

// Obtener QR de mi instancia
export async function getMyQR() {
  const response = await fetchWithCredentials(`${API_BASE}/my-instance/qr`);

  if (!response.ok) {
    throw new Error('Error al obtener código QR');
  }

  return response.json();
}

// Obtener estado de mi instancia
export async function getMyStatus() {
  const response = await fetchWithCredentials(`${API_BASE}/my-instance/status`);

  if (!response.ok) {
    throw new Error('Error al obtener estado de instancia');
  }

  return response.json();
}

// Reiniciar mi sesión de WhatsApp
export async function resetMySession() {
  const response = await fetchWithCredentials(`${API_BASE}/my-instance/logout`, {
    method: 'POST'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Error al reiniciar sesión');
  }

  return response.json();
}

// Obtener todas las instancias (solo admin)
export async function getInstances() {
  const response = await fetchWithCredentials(`${API_BASE}/instances`);

  if (!response.ok) {
    throw new Error('Error al obtener instancias');
  }

  return response.json();
}

// ===== FUNCIONES DE CONTACTOS FILTRADOS POR USUARIO =====

// Obtener mis contactos asignados
export async function getMyContacts() {
  try {
    const response = await fetchWithCredentials(`${API_BASE}/my-contacts`);

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/';
        return [];
      }
      throw new Error('Error al obtener contactos');
    }

    const contacts = await response.json();
    return contacts;
  } catch (error) {
    throw error;
  }
}

// Enviar mensaje desde mi instancia (sin parámetro isGroup, grupos desactivados)
export async function sendMyMessage(phone, message) {
  const response = await fetchWithCredentials(`${API_BASE}/my-instance/send-message`, {
    method: 'POST',
    body: JSON.stringify({ phone, message }) // Solo phone y message
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Error enviando mensaje');
  }

  return response.json();
}

// Enviar imagen desde mi instancia
export async function sendMyImage(phone, imageFile, caption = '') {
  const formData = new FormData();
  formData.append('phone', phone);
  formData.append('image', imageFile);
  if (caption) formData.append('caption', caption);

  const response = await fetch(`${API_BASE}/my-instance/send-image`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Error enviando imagen');
  }

  return response.json();
}

// Enviar documento desde mi instancia
export async function sendMyDocument(phone, documentFile, caption = '') {
  const formData = new FormData();
  formData.append('phone', phone);
  formData.append('document', documentFile);
  if (caption) formData.append('caption', caption);

  const response = await fetch(`${API_BASE}/my-instance/send-document`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Error enviando documento');
  }

  return response.json();
}

// Enviar audio desde mi instancia
export async function sendMyAudio(phone, audioFile, ptt = false) {
  const formData = new FormData();
  formData.append('phone', phone);
  formData.append('audio', audioFile);
  formData.append('ptt', ptt.toString());

  const response = await fetch(`${API_BASE}/my-instance/send-audio`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Error enviando audio');
  }

  return response.json();
}

// Reenviar mensaje desde mi instancia
export async function forwardMyMessage(phone, messageKey) {
  const response = await fetchWithCredentials(`${API_BASE}/my-instance/forward-message`, {
    method: 'POST',
    body: JSON.stringify({ phone, messageKey })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Error reenviando mensaje');
  }

  return response.json();
}

// Eliminar mensaje desde mi instancia
export async function deleteMyMessage(messageKey) {
  const response = await fetchWithCredentials(`${API_BASE}/my-instance/delete-message`, {
    method: 'POST',
    body: JSON.stringify({ messageKey })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Error eliminando mensaje');
  }

  return response.json();
}