import React, { useEffect, useState, useRef } from 'react';
import { getMyContacts } from '../services/api';
import notificationSound from '../assets/notification.mp3';

function ContactsList({ contacts, setContacts, selectedContact, onSelectContact }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'unread' | 'archived'
  const [lastReadMessages, setLastReadMessages] = useState(() => {
    // Cargar del localStorage al iniciar
    const saved = localStorage.getItem('lastReadMessages');
    return saved ? JSON.parse(saved) : {};
  });
  const audioRef = useRef(null);
  const previousTotalMessages = useRef(0);

  useEffect(() => {
    // Pedir permiso para notificaciones al cargar
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    loadContacts();
    const interval = setInterval(loadContacts, 5000); // Actualizar cada 5 segundos (balance entre rendimiento y UX)
    return () => clearInterval(interval);
  }, [selectedContact]);

  // Guardar en localStorage cada vez que cambie
  useEffect(() => {
    localStorage.setItem('lastReadMessages', JSON.stringify(lastReadMessages));
  }, [lastReadMessages]);

  const loadContacts = async () => {
    try {
      const data = await getMyContacts();

      // Calcular total de mensajes actuales
      const currentTotalMessages = data.reduce((sum, contact) => sum + contact.messages.length, 0);

      // Detectar nuevos mensajes y mostrar notificación
      if (previousTotalMessages.current > 0 && currentTotalMessages > previousTotalMessages.current) {
        // Encontrar el contacto con mensajes nuevos
        const contactWithNewMessages = data.find((newContact, index) => {
          const oldTotalMessages = contacts[index]?.messages?.length || 0;
          return newContact.messages.length > oldTotalMessages;
        });

        if (contactWithNewMessages) {
          const lastMessage = contactWithNewMessages.messages[contactWithNewMessages.messages.length - 1];
          const contactName = contactWithNewMessages.isGroup
            ? (contactWithNewMessages.groupName || contactWithNewMessages.phone)
            : contactWithNewMessages.phone;

          // Obtener preview del mensaje
          let messagePreview = '';
          if (lastMessage.message) {
            messagePreview = lastMessage.message.length > 50
              ? lastMessage.message.substring(0, 50) + '...'
              : lastMessage.message;
          } else if (lastMessage.hasMedia) {
            messagePreview = `📎 ${lastMessage.mediaType === 'image' ? 'Imagen' :
                                   lastMessage.mediaType === 'video' ? 'Video' :
                                   lastMessage.mediaType === 'audio' ? 'Audio' :
                                   lastMessage.mediaType === 'document' ? 'Documento' : 'Archivo'}`;
          } else {
            messagePreview = 'Nuevo mensaje';
          }

          // Mostrar notificación del sistema
          if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(`💬 ${contactName}`, {
              body: messagePreview,
              icon: contactWithNewMessages.groupPicture || '/favicon.ico',
              badge: '/favicon.ico',
              tag: contactWithNewMessages.phone, // Para no duplicar notificaciones del mismo contacto
              requireInteraction: false,
              silent: false // El sonido lo reproducimos nosotros
            });

            // Hacer que al hacer clic en la notificación, se abra/enfoque la ventana y seleccione el contacto
            notification.onclick = () => {
              window.focus();
              onSelectContact(contactWithNewMessages);
              notification.close();
            };

            // Auto-cerrar después de 5 segundos
            setTimeout(() => notification.close(), 5000);
          }

          // Reproducir sonido de notificación
          if (audioRef.current) {
            audioRef.current.play().catch(error => {
              console.log('Error reproduciendo sonido:', error);
            });
          }
        }
      }

      // Actualizar el contador de mensajes
      previousTotalMessages.current = currentTotalMessages;

      // Actualizar solo si hay cambios reales
      setContacts(prevContacts => {
        // Si no hay contactos previos, actualizar
        if (prevContacts.length === 0) return data;

        // Comparar si hay cambios reales
        const hasChanges = data.some(newContact => {
          const oldContact = prevContacts.find(c => c.phone === newContact.phone);
          if (!oldContact) return true; // Contacto nuevo

          // Verificar si hay cambios en mensajes o estado
          return (
            oldContact.messages.length !== newContact.messages.length ||
            oldContact.mode !== newContact.mode ||
            oldContact.isHumanMode !== newContact.isHumanMode
          );
        });

        // Solo actualizar si hay cambios
        return hasChanges ? data : prevContacts;
      });

      // Si hay un contacto seleccionado, actualizar sus mensajes solo si hay cambios
      if (selectedContact) {
        const updatedContact = data.find(c => c.phone === selectedContact.phone);
        if (updatedContact) {
          // Detectar cambios en cantidad de mensajes
          const hasNewMessages =
            updatedContact.messages.length !== selectedContact.messages.length ||
            (updatedContact.messages.length > 0 && selectedContact.messages.length > 0 &&
             updatedContact.messages[updatedContact.messages.length - 1].timestamp !==
             selectedContact.messages[selectedContact.messages.length - 1].timestamp);

          // Detectar cambios en estados de mensajes (checks)
          const hasStatusChanges = updatedContact.messages.some((newMsg) => {
            // Buscar el mensaje correspondiente por messageId
            const oldMsg = selectedContact.messages.find(
              m => m.messageId && m.messageId === newMsg.messageId
            );
            // Si existe y el estado cambió, retornar true
            return oldMsg && oldMsg.status !== newMsg.status;
          });

          if (hasNewMessages || hasStatusChanges) {
            onSelectContact(updatedContact);

            // Marcar los nuevos mensajes como leídos automáticamente si estamos viendo este chat
            setLastReadMessages(prev => ({
              ...prev,
              [updatedContact.phone]: updatedContact.messages.length
            }));
          }
        }
      }

      setLoading(false);
    } catch (error) {
      // Error silencioso
      setLoading(false);
    }
  };

  const handleSelectContact = (contact) => {
    // Marcar mensajes como leídos
    setLastReadMessages(prev => ({
      ...prev,
      [contact.phone]: contact.messages.length
    }));
    onSelectContact(contact);
  };

  const getUnreadCount = (contact) => {
    const lastRead = lastReadMessages[contact.phone] || 0;
    const unreadCount = contact.messages.length - lastRead;
    return unreadCount > 0 ? unreadCount : 0;
  };

  const markAllAsRead = () => {
    const updated = { ...lastReadMessages };
    contacts.forEach(c => {
      updated[c.phone] = c.messages.length;
    });
    setLastReadMessages(updated);
  };

  const archivedCount = contacts.filter(c => c.isArchived).length;
  const unreadCount = contacts.filter(c => !c.isArchived && getUnreadCount(c) > 0).length;

  const filteredContacts = contacts
    .filter(contact => {
      // Filtro por tab
      if (activeTab === 'archived') {
        if (!contact.isArchived) return false;
      } else {
        if (contact.isArchived) return false;
        if (activeTab === 'unread' && getUnreadCount(contact) === 0) return false;
      }

      const searchLower = searchTerm.toLowerCase();
      if (!searchLower) return true;

      // Buscar en el número de teléfono o nombre de grupo
      const contactName = contact.isGroup ? (contact.groupName || contact.phone) : contact.phone;
      if (contactName.toLowerCase().includes(searchLower)) {
        return true;
      }

      // Buscar en los mensajes de la conversación
      if (contact.messages && contact.messages.length > 0) {
        return contact.messages.some(msg =>
          msg.message && msg.message.toLowerCase().includes(searchLower)
        );
      }

      return false;
    })
    .sort((a, b) => {
      // Primero los de soporte (prioridad máxima)
      if (a.mode === 'support' && b.mode !== 'support') return -1;
      if (a.mode !== 'support' && b.mode === 'support') return 1;

      // Luego los que tienen mensajes no leídos
      const unreadA = getUnreadCount(a);
      const unreadB = getUnreadCount(b);
      if (unreadA > 0 && unreadB === 0) return -1;
      if (unreadA === 0 && unreadB > 0) return 1;

      // Finalmente por última actividad
      return new Date(b.lastActivity) - new Date(a.lastActivity);
    });

  if (loading) {
    return <div className="w-full md:w-96 bg-white border-r border-gray-200 flex items-center justify-center">
      <span className="text-gray-500">Cargando contactos...</span>
    </div>;
  }

  return (
    <div className="w-full md:w-96 flex flex-col overflow-hidden" style={{
      background: '#FAFBFC',
      borderRight: '1px solid #E8EBED'
    }}>
      {/* Audio de notificación oculto */}
      <audio ref={audioRef} src={notificationSound} preload="auto" />

      {/* Header estilo moderno */}
      <div className="p-4 md:p-6 pb-4 flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Conversaciones</h2>

        <div className="relative w-full">
          <svg className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar contacto o mensaje..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl transition-all focus:outline-none text-sm box-border"
            style={{
              background: '#F3F4F6',
              border: '1px solid transparent',
            }}
            onFocus={(e) => {
              e.target.style.background = '#ffffff';
              e.target.style.border = '1px solid #FD6144';
              e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
            }}
            onBlur={(e) => {
              e.target.style.background = '#F3F4F6';
              e.target.style.border = '1px solid transparent';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Tabs de filtro: Todos / No leídos / Archivados + Marcar todos como leídos */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            onClick={() => setActiveTab('all')}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-all"
            style={{
              background: activeTab === 'all' ? '#FD6144' : '#F3F4F6',
              color: activeTab === 'all' ? '#ffffff' : '#6B7280'
            }}
          >
            Todos
          </button>
          <button
            onClick={() => setActiveTab('unread')}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-all flex items-center gap-1.5"
            style={{
              background: activeTab === 'unread' ? '#FD6144' : '#F3F4F6',
              color: activeTab === 'unread' ? '#ffffff' : '#6B7280'
            }}
          >
            No leídos
            {unreadCount > 0 && (
              <span className="px-1.5 rounded-full text-[10px] font-bold" style={{
                background: activeTab === 'unread' ? 'rgba(255,255,255,0.25)' : '#FD6144',
                color: '#ffffff'
              }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('archived')}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-all flex items-center gap-1.5"
            style={{
              background: activeTab === 'archived' ? '#FD6144' : '#F3F4F6',
              color: activeTab === 'archived' ? '#ffffff' : '#6B7280'
            }}
            title="Conversaciones archivadas"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            Archivados
            {archivedCount > 0 && (
              <span className="px-1.5 rounded-full text-[10px] font-bold" style={{
                background: activeTab === 'archived' ? 'rgba(255,255,255,0.25)' : '#9CA3AF',
                color: '#ffffff'
              }}>
                {archivedCount}
              </span>
            )}
          </button>
          <button
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
            className="ml-auto text-xs px-3 py-1.5 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'transparent',
              color: '#6B7280',
              border: '1px solid #E5E7EB'
            }}
            onMouseEnter={(e) => {
              if (unreadCount > 0) e.currentTarget.style.background = '#F3F4F6';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            title="Marcar todos los chats como leídos"
          >
            Marcar leídos
          </button>
        </div>
      </div>

      {/* Lista de contactos */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 md:px-3">
        {filteredContacts.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            {activeTab === 'archived'
              ? 'No hay conversaciones archivadas'
              : activeTab === 'unread'
              ? 'No tienes mensajes sin leer'
              : 'No hay contactos'}
          </div>
        ) : (
          filteredContacts.map(contact => (
            <div
              key={contact.phone}
              className="mb-1 rounded-xl cursor-pointer transition-all duration-200 w-full"
              style={{
                background: selectedContact?.phone === contact.phone
                  ? 'rgba(92, 25, 227, 0.08)'
                  : 'transparent',
                boxShadow: selectedContact?.phone === contact.phone
                  ? '0 2px 8px rgba(92, 25, 227, 0.15)'
                  : 'none',
                border: selectedContact?.phone === contact.phone
                  ? '1px solid rgba(92, 25, 227, 0.2)'
                  : '1px solid transparent'
              }}
              onMouseEnter={(e) => {
                if (selectedContact?.phone !== contact.phone) {
                  e.currentTarget.style.background = '#ffffff';
                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.04)';
                  e.currentTarget.style.border = '1px solid #E8EBED';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedContact?.phone !== contact.phone) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.border = '1px solid transparent';
                }
              }}
              onClick={() => handleSelectContact(contact)}
            >
              <div className="flex items-center p-3 w-full min-w-0">
                {/* Avatar moderno */}
                <div className="relative mr-3 flex-shrink-0">
                  {contact.isGroup && contact.groupPicture ? (
                    <img
                      src={contact.groupPicture}
                      alt={contact.groupName || 'Grupo'}
                      className="w-12 h-12 rounded-full object-cover"
                      style={{
                        opacity: contact.leftGroup ? 0.6 : 1,
                        border: '2px solid #ffffff'
                      }}
                      onError={(e) => {
                        // Si la imagen falla, ocultar el elemento y mostrar el fallback
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{
                      background: contact.leftGroup
                        ? 'linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%)'
                        : contact.isGroup
                        ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
                        : contact.mode === 'support'
                        ? 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)'
                        : 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
                      opacity: contact.leftGroup ? 0.6 : 1,
                      display: contact.isGroup && contact.groupPicture ? 'none' : 'flex'
                    }}
                  >
                    {contact.isGroup ? (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
                      </svg>
                    ) : contact.mode === 'support' ? (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd"/>
                      </svg>
                    ) : (
                      contact.phone.slice(-2)
                    )}
                  </div>
                  {/* Indicador de estado */}
                  {!contact.leftGroup && (
                    <div
                      className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
                      style={{
                        background: contact.mode === 'support'
                          ? '#F97316'
                          : contact.isHumanMode
                            ? '#3B82F6'
                            : '#FD6144',
                        borderColor: selectedContact?.phone === contact.phone ? '#ffffff' : '#FAFBFC'
                      }}
                    ></div>
                  )}
                </div>

                {/* Info del contacto */}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between mb-0.5 gap-2">
                    <span className={`text-sm truncate flex-1 ${contact.leftGroup ? 'text-gray-400' : getUnreadCount(contact) > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
                      {contact.isGroup ? (contact.groupName || contact.phone) : contact.phone}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {contact.leftGroup ? (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                          background: 'rgba(107, 114, 128, 0.1)',
                          color: '#6B7280'
                        }}>
                          Inactivo
                        </span>
                      ) : (
                        <>
                          {getUnreadCount(contact) > 0 && (
                            <span className="min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{
                              background: '#FD6144',
                              boxShadow: '0 2px 4px rgba(92, 25, 227, 0.3)'
                            }}>
                              {getUnreadCount(contact) > 99 ? '99+' : getUnreadCount(contact)}
                            </span>
                          )}
                          {contact.mode === 'support' && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                              background: 'rgba(249, 115, 22, 0.1)',
                              color: '#EA580C'
                            }}>
                              Soporte
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <p className={`text-xs truncate w-full overflow-hidden ${contact.leftGroup ? 'text-gray-400 italic' : getUnreadCount(contact) > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                    {contact.leftGroup ? 'Ya no eres miembro' :
                     contact.lastMessage ?
                       // Si es un grupo y es mensaje de cliente, mostrar nombre del usuario
                       (contact.isGroup && contact.lastMessage.role === 'cliente' && contact.lastMessage.userName ?
                         `${contact.lastMessage.userName}: ${contact.lastMessage.text}` :
                         contact.lastMessage.text
                       ) :
                       'Sin mensajes'
                    }
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ContactsList;
