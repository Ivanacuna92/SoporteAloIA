import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { getMyContacts, getMuteStates } from '../services/api';
import notificationSound from '../assets/notification.mp3';
import alexisSound from '../assets/alexis.mp3';

function ContactsList({ contacts, setContacts, selectedContact, onSelectContact }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [localContacts, setLocalContacts] = useState(contacts);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'unread' | 'archived'
  const [lastReadMessages, setLastReadMessages] = useState(() => {
    const saved = localStorage.getItem('lastReadMessages');
    return saved ? JSON.parse(saved) : {};
  });
  const audioRef = useRef(null);
  const alexisAudioRef = useRef(null);
  const previousTotalMessages = useRef(0);
  const [muteStates, setMuteStates] = useState({});
  const muteStatesRef = useRef({});
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

          if (contactWithNewMessages && !muteStatesRef.current[contactWithNewMessages.phone]) {
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

    const refreshMuteStates = async () => {
      try {
        const m = await getMuteStates();
        muteStatesRef.current = m || {};
        setMuteStates(m || {});
      } catch (e) { /* ignore */ }
    };
    refreshMuteStates();
    const muteInterval = setInterval(refreshMuteStates, 15000);
    const onMuteChange = () => refreshMuteStates();
    window.addEventListener('mute-changed', onMuteChange);

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
      clearInterval(muteInterval);
      if (socket) socket.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('mute-changed', onMuteChange);
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

  const totalUnread = localContacts.reduce((sum, c) => sum + (c.isArchived ? 0 : getUnreadCount(c)), 0);
  const archivedCount = localContacts.filter(c => c.isArchived).length;

  const markAllAsRead = () => {
    const updated = {};
    localContacts.forEach(c => {
      updated[c.phone] = c.messages.length;
    });
    setLastReadMessages(prev => ({ ...prev, ...updated }));
  };

  const filteredContacts = localContacts
    .filter(contact => {
      if (activeFilter === 'archived') {
        if (!contact.isArchived) return false;
      } else {
        if (contact.isArchived) return false;
        if (activeFilter === 'unread' && getUnreadCount(contact) === 0) return false;
      }

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
    return <div className="w-full md:w-[300px] flex items-center justify-center">
      <span style={{ color: 'var(--text-secondary)', fontFamily: 'Sora, sans-serif', fontSize: 13 }}>Cargando contactos...</span>
    </div>;
  }

  return (
    <div className="w-full md:w-[300px] flex flex-col overflow-hidden max-w-full">
      <audio ref={audioRef} src={notificationSound} preload="auto" />
      <audio ref={alexisAudioRef} src={alexisSound} preload="auto" />

      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: '22px 20px 14px' }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>
          Soporte
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            title="Filtrar"
            aria-label="Filtrar"
            className="rounded-[9px] flex items-center justify-center transition-all"
            style={{ width: 32, height: 32, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <i className="ti ti-adjustments-horizontal" style={{ fontSize: 18 }} />
          </button>
          <button
            type="button"
            title="Nuevo chat"
            aria-label="Nuevo chat"
            className="rounded-[9px] flex items-center justify-center transition-all"
            style={{ width: 32, height: 32, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <i className="ti ti-edit" style={{ fontSize: 18 }} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '0 16px 14px' }}>
        <div
          className="flex items-center gap-2 rounded-[12px] transition-colors"
          style={{
            background: 'var(--bg-input)',
            padding: '10px 14px',
            border: '1px solid transparent',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border-active)'; }}
        >
          <i className="ti ti-search" style={{ fontSize: 16, color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Buscar grupo o contacto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full focus:outline-none"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'Sora, sans-serif',
              fontSize: 13,
            }}
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-[6px]" style={{ padding: '0 16px 14px', flexWrap: 'wrap' }}>
        {[
          { id: 'all',      label: 'Todos',      count: null },
          { id: 'unread',   label: 'No leídos',  count: totalUnread > 0 ? totalUnread : null },
          { id: 'archived', label: 'Archivados', count: archivedCount > 0 ? archivedCount : null, icon: 'ti-archive' },
        ].map((p) => {
          const isActive = activeFilter === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setActiveFilter(p.id)}
              className="flex items-center gap-1.5 transition-all"
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'Sora, sans-serif',
                cursor: 'pointer',
                background: isActive ? 'var(--bg-active)' : 'transparent',
                border: `1px solid ${isActive ? 'var(--border-active)' : 'var(--border)'}`,
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              {p.icon && <i className={`ti ${p.icon}`} style={{ fontSize: 13 }} />}
              {p.label}
              {p.count !== null && (
                <span
                  style={{
                    background: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 999,
                    lineHeight: 1.4,
                  }}
                >
                  {p.count > 99 ? '99+' : p.count}
                </span>
              )}
            </button>
          );
        })}
        {totalUnread > 0 && (
          <button
            onClick={markAllAsRead}
            className="ml-auto transition-all"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--accent)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '5px 4px',
              fontFamily: 'Sora, sans-serif',
            }}
            onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            Marcar leídos
          </button>
        )}
      </div>

      {/* Lista de contactos */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: '6px 10px' }}>
        {filteredContacts.length === 0 ? (
          <div className="text-center text-sm" style={{ padding: '48px 0', color: 'var(--text-tertiary)' }}>
            {activeFilter === 'archived'
              ? 'No hay conversaciones archivadas'
              : activeFilter === 'unread'
              ? 'No tienes mensajes sin leer'
              : 'No hay contactos'}
          </div>
        ) : (
          filteredContacts.map(contact => {
            const isSelected = selectedContact?.phone === contact.phone;
            return (
            <div
              key={contact.phone}
              className="cursor-pointer transition-all duration-200 w-full"
              style={{
                marginBottom: 4,
                padding: '13px 12px',
                borderRadius: 16,
                background: isSelected ? 'var(--bg-active)' : 'transparent',
                border: `1px solid ${isSelected ? 'var(--border-active)' : 'transparent'}`,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'transparent';
              }}
              onClick={() => handleSelectContact(contact)}
            >
              <div className="flex items-center w-full min-w-0" style={{ gap: 10 }}>
                {/* Avatar (rounded square) */}
                <div className="relative flex-shrink-0">
                  {contact.isGroup && contact.groupPicture ? (
                    <img
                      src={contact.groupPicture}
                      alt={contact.groupName || 'Grupo'}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        objectFit: 'cover',
                        opacity: contact.leftGroup ? 0.6 : 1,
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className="flex items-center justify-center font-semibold"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      fontSize: 12,
                      background: contact.leftGroup
                        ? 'rgba(107,114,128,0.18)'
                        : contact.mode === 'support'
                        ? 'rgba(245,158,11,0.18)'
                        : 'var(--bg-active)',
                      color: contact.leftGroup
                        ? 'var(--text-tertiary)'
                        : contact.mode === 'support'
                        ? '#f59e0b'
                        : 'var(--accent)',
                      opacity: contact.leftGroup ? 0.6 : 1,
                      display: contact.isGroup && contact.groupPicture ? 'none' : 'flex',
                    }}
                  >
                    {contact.isGroup
                      ? (contact.groupName || 'G').slice(0, 2).toUpperCase()
                      : contact.phone.slice(-2)
                    }
                  </div>
                  {!contact.leftGroup && (contact.mode === 'support' || getUnreadCount(contact) > 0) && (
                    <div
                      className="absolute bottom-0 right-0 rounded-full"
                      style={{
                        width: 10,
                        height: 10,
                        background: contact.mode === 'support' ? '#f59e0b' : 'var(--accent)',
                        border: '2px solid var(--bg-base)',
                      }}
                    />
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
                          {muteStates[contact.phone] && (
                            <svg title="Silenciado" className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341M15 17H9m6 0a3 3 0 01-6 0m0 0H4l1.405-1.405M3 3l18 18" />
                            </svg>
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
            );
          })
        )}
      </div>
    </div>
  );
}

export default ContactsList;
