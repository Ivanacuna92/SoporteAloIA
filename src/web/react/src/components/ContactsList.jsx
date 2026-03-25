import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { getMyContacts } from '../services/api';
import notificationSound from '../assets/notification.mp3';
import alexisSound from '../assets/alexis.mp3';

function ContactsList({ contacts, setContacts, selectedContact, onSelectContact }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [localContacts, setLocalContacts] = useState(contacts);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'unread'
  const [lastReadMessages, setLastReadMessages] = useState(() => {
    const saved = localStorage.getItem('lastReadMessages');
    return saved ? JSON.parse(saved) : {};
  });
  const audioRef = useRef(null);
  const alexisAudioRef = useRef(null);
  const previousTotalMessages = useRef(0);
  const selectedContactRef = useRef(selectedContact);
  const loadingRef = useRef(false);
  const loadContactsRef = useRef(null);

  useEffect(() => {
    selectedContactRef.current = selectedContact;
  }, [selectedContact]);

  useEffect(() => {
    localStorage.setItem('lastReadMessages', JSON.stringify(lastReadMessages));
  }, [lastReadMessages]);

  const loadContacts = async () => {
    if (loadingRef.current) {
      if (loadingRef._ts && Date.now() - loadingRef._ts > 15000) {
        loadingRef.current = false;
      } else {
        return;
      }
    }
    loadingRef.current = true;
    loadingRef._ts = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const data = await getMyContacts(controller.signal);
      clearTimeout(timeout);

      // PRIMERO actualizar estado - antes de cualquier otra lógica
      setLocalContacts(data);
      setContacts(data);

      // Notificaciones y sonido DESPUÉS (envuelto en try-catch por si falla en móvil)
      const currentTotalMessages = data.reduce((sum, contact) => sum + contact.messages.length, 0);
      try {
        if (previousTotalMessages.current > 0 && currentTotalMessages > previousTotalMessages.current) {
          const contactWithNewMessages = data.find((newContact, index) => {
            const oldTotalMessages = contacts[index]?.messages?.length || 0;
            return newContact.messages.length > oldTotalMessages;
          });

          if (contactWithNewMessages) {
            const lastMessage = contactWithNewMessages.messages[contactWithNewMessages.messages.length - 1];
            const contactName = contactWithNewMessages.isGroup
              ? (contactWithNewMessages.groupName || contactWithNewMessages.phone)
              : contactWithNewMessages.phone;

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

            if ('Notification' in window && Notification.permission === 'granted') {
              try {
                const notification = new Notification(`💬 ${contactName}`, {
                  body: messagePreview,
                  icon: contactWithNewMessages.groupPicture || '/favicon.ico',
                  badge: '/favicon.ico',
                  tag: contactWithNewMessages.phone,
                  requireInteraction: false,
                  silent: false
                });
                notification.onclick = () => {
                  window.focus();
                  onSelectContact(contactWithNewMessages);
                  notification.close();
                };
                setTimeout(() => notification.close(), 5000);
              } catch (e) { /* Notification no soportada en este contexto */ }
            }

            const isCosasAloianas = contactName && contactName.toLowerCase().includes('cosas aloianas');
            const soundRef = isCosasAloianas ? alexisAudioRef : audioRef;
            if (soundRef.current) {
              soundRef.current.play().catch(() => {});
            }
          }
        }
      } catch (e) { /* notificación/sonido falló, no importa */ }
      previousTotalMessages.current = currentTotalMessages;

      const currentSelected = selectedContactRef.current;
      if (currentSelected) {
        const updatedContact = data.find(c => c.phone === currentSelected.phone);
        if (updatedContact) {
          const hasChanges =
            updatedContact.messages.length !== currentSelected.messages.length ||
            updatedContact.mode !== currentSelected.mode ||
            JSON.stringify(updatedContact.messages.map(m => m.message + (m.isEdited ? '1' : '0') + (m.status || ''))) !==
            JSON.stringify(currentSelected.messages.map(m => m.message + (m.isEdited ? '1' : '0') + (m.status || '')));

          if (hasChanges) {
            onSelectContact(updatedContact);
            setLastReadMessages(prev => ({
              ...prev,
              [updatedContact.phone]: updatedContact.messages.length
            }));
          }
        }
      }

      setLoading(false);
    } catch (error) {
      setLoading(false);
    } finally {
      loadingRef.current = false;
    }
  };

  // Guardar referencia estable a loadContacts
  loadContactsRef.current = loadContacts;

  // Polling + Socket + Visibility handlers
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const poll = () => loadContactsRef.current?.();

    poll();
    const interval = setInterval(poll, 5000);

    // WebSocket
    let socket;
    try {
      socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity, transports: ['polling'] });
      socket.on('new-message', poll);
    } catch (e) { /* ignore */ }

    // Volver de background
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        poll();
        if (socket && !socket.connected) socket.connect();
      }
    };
    const onFocus = () => {
      poll();
      if (socket && !socket.connected) socket.connect();
    };
    const onTouch = () => poll();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    window.addEventListener('touchstart', onTouch, { passive: true, once: false });

    return () => {
      clearInterval(interval);
      if (socket) socket.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      window.removeEventListener('touchstart', onTouch);
    };
  }, []);

  const handleSelectContact = (contact) => {
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

  const totalUnread = localContacts.reduce((sum, c) => sum + getUnreadCount(c), 0);

  const markAllAsRead = () => {
    const updated = {};
    localContacts.forEach(c => {
      updated[c.phone] = c.messages.length;
    });
    setLastReadMessages(prev => ({ ...prev, ...updated }));
  };

  const filteredContacts = localContacts
    .filter(contact => {
      if (activeFilter === 'unread' && getUnreadCount(contact) === 0) return false;

      const searchLower = searchTerm.toLowerCase();
      if (!searchLower) return true;

      const contactName = contact.isGroup ? (contact.groupName || contact.phone) : contact.phone;
      if (contactName.toLowerCase().includes(searchLower)) {
        return true;
      }

      if (contact.messages && contact.messages.length > 0) {
        return contact.messages.some(msg =>
          msg.message && msg.message.toLowerCase().includes(searchLower)
        );
      }

      return false;
    })
    .sort((a, b) => {
      if (a.mode === 'support' && b.mode !== 'support') return -1;
      if (a.mode !== 'support' && b.mode === 'support') return 1;

      const unreadA = getUnreadCount(a);
      const unreadB = getUnreadCount(b);
      if (unreadA > 0 && unreadB === 0) return -1;
      if (unreadA === 0 && unreadB > 0) return 1;

      return new Date(b.lastActivity) - new Date(a.lastActivity);
    });

  if (loading) {
    return <div className="w-full md:w-96 flex items-center justify-center" style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-primary)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>Cargando contactos...</span>
    </div>;
  }

  return (
    <div className="w-full md:w-96 flex flex-col overflow-hidden max-w-full" style={{
      background: 'var(--bg-primary)',
      borderRight: '1px solid var(--border-primary)'
    }}>
      <audio ref={audioRef} src={notificationSound} preload="auto" />
      <audio ref={alexisAudioRef} src={alexisSound} preload="auto" />

      {/* Header */}
      <div className="p-4 md:p-6 pb-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Conversaciones</h2>
          <button
            onClick={() => {
              const isDark = document.documentElement.classList.toggle('dark');
              localStorage.setItem('darkMode', isDark);
              const meta = document.querySelector('meta[name="theme-color"]');
              if (meta) meta.setAttribute('content', isDark ? '#0f172a' : '#FAFBFC');
            }}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)'
            }}
          >
            <svg className="w-4 h-4 hidden dark:block" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd"/>
            </svg>
            <svg className="w-4 h-4 block dark:hidden" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
            </svg>
          </button>
        </div>

        <div className="relative w-full">
          <svg className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar contacto o mensaje..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl transition-all focus:outline-none text-sm box-border"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid transparent',
              color: 'var(--text-primary)',
            }}
            onFocus={(e) => {
              e.target.style.background = 'var(--bg-secondary)';
              e.target.style.border = '1px solid var(--brand-primary)';
              e.target.style.boxShadow = '0 0 0 3px var(--focus-ring)';
            }}
            onBlur={(e) => {
              e.target.style.background = 'var(--bg-tertiary)';
              e.target.style.border = '1px solid transparent';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Tabs de filtro */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => setActiveFilter('all')}
            className="px-3 py-1 rounded-full text-xs font-medium transition-all"
            style={{
              background: activeFilter === 'all' ? 'var(--brand-primary)' : 'var(--bg-tertiary)',
              color: activeFilter === 'all' ? 'white' : 'var(--text-secondary)',
            }}
          >
            Todos
          </button>
          <button
            onClick={() => setActiveFilter('unread')}
            className="px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5"
            style={{
              background: activeFilter === 'unread' ? 'var(--brand-primary)' : 'var(--bg-tertiary)',
              color: activeFilter === 'unread' ? 'white' : 'var(--text-secondary)',
            }}
          >
            No leídos
            {totalUnread > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold" style={{
                background: activeFilter === 'unread' ? 'white' : 'var(--brand-primary)',
                color: activeFilter === 'unread' ? 'var(--brand-primary)' : 'white',
              }}>
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>
          {totalUnread > 0 && (
            <button
              onClick={markAllAsRead}
              className="ml-auto text-xs font-medium transition-all hover:underline"
              style={{ color: 'var(--brand-primary)' }}
            >
              Marcar leídos
            </button>
          )}
        </div>
      </div>

      {/* Lista de contactos */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-3">
        {filteredContacts.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--text-tertiary)' }}>No hay contactos</div>
        ) : (
          filteredContacts.map(contact => (
            <div
              key={contact.phone}
              className="mb-1 rounded-xl cursor-pointer transition-all duration-200 w-full"
              style={{
                background: selectedContact?.phone === contact.phone
                  ? 'var(--bg-selected)'
                  : 'transparent',
                boxShadow: selectedContact?.phone === contact.phone
                  ? '0 2px 8px var(--shadow-md)'
                  : 'none',
                border: selectedContact?.phone === contact.phone
                  ? '1px solid var(--border-primary)'
                  : '1px solid transparent'
              }}
              onMouseEnter={(e) => {
                if (selectedContact?.phone !== contact.phone) {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.boxShadow = '0 2px 6px var(--shadow-sm)';
                  e.currentTarget.style.border = '1px solid var(--border-primary)';
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
                {/* Avatar */}
                <div className="relative mr-3 flex-shrink-0" style={contact.isGroup && contact.groupPicture ? { backgroundColor: '#ffffff', borderRadius: '9999px', width: 'fit-content' } : undefined}>
                  {contact.isGroup && contact.groupPicture ? (
                    <img
                      src={contact.groupPicture}
                      alt={contact.groupName || 'Grupo'}
                      className="w-12 h-12 rounded-full object-cover"
                      style={{
                        opacity: contact.leftGroup ? 0.6 : 1,
                        border: '2px solid var(--bg-secondary)'
                      }}
                      onError={(e) => {
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
                        : contact.mode === 'support'
                        ? 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)'
                        : 'linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-primary-dark) 100%)',
                      opacity: contact.leftGroup ? 0.6 : 1,
                      display: contact.isGroup && contact.groupPicture ? 'none' : 'flex'
                    }}
                  >
                    {contact.isGroup
                      ? (contact.groupName || 'G').charAt(0).toUpperCase()
                      : contact.phone.slice(-2)
                    }
                  </div>
                  {!contact.leftGroup && (contact.mode === 'support' || getUnreadCount(contact) > 0) && (
                    <div
                      className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
                      style={{
                        background: contact.mode === 'support' ? '#F97316' : 'var(--brand-primary)',
                        borderColor: selectedContact?.phone === contact.phone ? 'var(--bg-secondary)' : 'var(--bg-primary)'
                      }}
                    ></div>
                  )}
                </div>

                {/* Info del contacto */}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between mb-0.5 gap-2">
                    <span className="text-sm truncate flex-1" style={{
                      color: contact.leftGroup ? 'var(--text-tertiary)' : 'var(--text-primary)',
                      fontWeight: contact.leftGroup ? 400 : getUnreadCount(contact) > 0 ? 700 : 600
                    }}>
                      {contact.isGroup ? (contact.groupName || contact.phone) : contact.phone}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {contact.leftGroup ? (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-secondary)'
                        }}>
                          Inactivo
                        </span>
                      ) : (
                        <>
                          {getUnreadCount(contact) > 0 && (
                            <span className="flex-shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{
                              background: 'var(--brand-primary)',
                              boxShadow: '0 2px 4px rgba(0, 161, 156, 0.3)'
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
                  <p className="text-xs truncate w-full overflow-hidden" style={{
                    color: contact.leftGroup ? 'var(--text-tertiary)' : getUnreadCount(contact) > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: getUnreadCount(contact) > 0 ? 500 : 400,
                    fontStyle: contact.leftGroup ? 'italic' : 'normal'
                  }}>
                    {contact.leftGroup ? 'Ya no eres miembro' :
                     contact.lastMessage ?
                       (contact.isGroup && contact.lastMessage.role === 'cliente' && contact.lastMessage.userName ?
                         `${contact.lastMessage.userName}: ${contact.lastMessage.text || (contact.lastMessage.mediaType === 'sticker' ? '🎭 Sticker' : contact.lastMessage.mediaType === 'image' ? '📷 Imagen' : contact.lastMessage.mediaType === 'video' ? '🎥 Video' : contact.lastMessage.mediaType === 'audio' ? '🎵 Audio' : contact.lastMessage.mediaType === 'document' ? '📎 Documento' : '')}` :
                         contact.lastMessage.text || (contact.lastMessage.mediaType === 'sticker' ? '🎭 Sticker' : contact.lastMessage.mediaType === 'image' ? '📷 Imagen' : contact.lastMessage.mediaType === 'video' ? '🎥 Video' : contact.lastMessage.mediaType === 'audio' ? '🎵 Audio' : contact.lastMessage.mediaType === 'document' ? '📎 Documento' : '')
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
