import React, { useState, useEffect, useRef } from 'react';
import { sendMyMessage, sendMyImage, sendMyDocument, sendMyAudio, sendMyVideo, forwardMyMessage, deleteMyMessage, toggleHumanMode, endConversation, deleteConversation, leaveGroup, sendMessageAdvanced } from '../services/api';

// Componente de reproductor de audio personalizado estilo WhatsApp
function AudioPlayer({ src, isClient }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    audioRef.current.currentTime = percentage * duration;
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  if (!src) {
    return (
      <div className={`flex items-center gap-2 p-2 rounded-xl ${isClient ? 'bg-gray-100' : 'bg-white/20'}`} style={{ minWidth: '200px' }}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isClient ? 'bg-gray-300' : 'bg-white/30'}`}>
          <svg className="w-5 h-5 opacity-50" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" clipRule="evenodd"/>
          </svg>
        </div>
        <span className="text-xs opacity-70">Audio no disponible</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 p-2 rounded-xl ${isClient ? 'bg-gray-100' : 'bg-white/20'}`} style={{ minWidth: '220px' }}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        preload="metadata"
      />

      {/* Botón Play/Pause */}
      <button
        onClick={togglePlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          isClient
            ? 'bg-navetec-primary text-white hover:bg-navetec-secondary'
            : 'bg-white/30 hover:bg-white/40'
        }`}
      >
        {isPlaying ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
        ) : (
          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
          </svg>
        )}
      </button>

      {/* Barra de progreso y tiempo */}
      <div className="flex-1 min-w-0">
        <div
          className={`h-1.5 rounded-full cursor-pointer ${isClient ? 'bg-gray-300' : 'bg-white/30'}`}
          onClick={handleSeek}
        >
          <div
            className={`h-full rounded-full transition-all ${isClient ? 'bg-navetec-primary' : 'bg-white'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className={`flex justify-between text-xs mt-1 ${isClient ? 'text-gray-500' : 'text-white/70'}`}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ contact, onUpdateContact, onClose }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [endingConversation, setEndingConversation] = useState(false);
  const [supportHandledContacts, setSupportHandledContacts] = useState(new Set());
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLeaveGroupModal, setShowLeaveGroupModal] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [messageMenuOpen, setMessageMenuOpen] = useState(null); // ID del mensaje con menú abierto
  const [showCaptionModal, setShowCaptionModal] = useState(false);
  const [captionData, setCaptionData] = useState({ file: null, type: null, caption: '' });
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardData, setForwardData] = useState({ messageKey: null, targetPhone: '' });
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [quotedMessage, setQuotedMessage] = useState(null); // Mensaje que se está citando para responder
  const messagesEndRef = useRef(null);
  const optionsMenuRef = useRef(null);
  const attachMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageMenuRef = useRef(null);

  useEffect(() => {
    // Scroll automático e instantáneo al cambiar de contacto
    if (contact) {
      // Hacer scroll inmediato sin animación al abrir el chat
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 0);
    }
  }, [contact?.phone]); // Solo cuando cambia el contacto

  // Cerrar menú al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(event.target)) {
        setShowOptionsMenu(false);
      }
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target)) {
        setShowAttachMenu(false);
      }
      if (messageMenuRef.current && !messageMenuRef.current.contains(event.target)) {
        setMessageMenuOpen(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // Scroll suave cuando llegan nuevos mensajes
    if (contact?.messages && contact.messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [contact?.messages?.length]); // Solo cuando cambia la cantidad de mensajes
  
  useEffect(() => {
    // Mostrar modal solo si es modo soporte Y no hay mensajes HUMAN Y NO es un grupo
    if (contact?.mode === 'support' && contact?.phone && !contact?.isGroup) {
      // Verificar si ya hay mensajes de HUMAN en la conversación
      const hasHumanMessages = contact.messages?.some(msg => msg.type === 'HUMAN');

      // Solo mostrar si:
      // 1. No es un grupo
      // 2. No hay mensajes HUMAN (nadie ha tomado control)
      // 3. No se ha mostrado antes para este contacto en esta sesión
      if (!hasHumanMessages && !supportHandledContacts.has(contact.phone)) {
        setShowSupportModal(true);
        setSupportHandledContacts(prev => new Set([...prev, contact.phone]));
      } else if (hasHumanMessages) {
        // Si ya hay mensajes HUMAN, cerrar el modal si está abierto
        setShowSupportModal(false);
      }
    }
  }, [contact?.mode, contact?.phone, contact?.messages, contact?.isGroup]);

  const handleSend = async () => {
    if (!message.trim() || !contact || sending) return;

    // YA NO HAY VALIDACIÓN DE MODO - Siempre se puede enviar
    setSending(true);
    try {
      // Si hay un mensaje citado, usar sendMessageAdvanced
      if (quotedMessage) {
        const options = {
          quotedMessageId: quotedMessage.messageId,
          quotedRemoteJid: `${contact.phone}@g.us`,
          quotedParticipant: quotedMessage.participant
        };
        await sendMessageAdvanced(contact.phone, message, options);
        setQuotedMessage(null); // Limpiar mensaje citado después de enviar
      } else {
        await sendMyMessage(contact.phone, message); // Sin parámetro isGroup
      }

      setMessage('');

      // Resetear altura del textarea después de enviar
      setTimeout(() => {
        const textarea = document.querySelector('textarea[placeholder*="Ctrl+Enter"]');
        if (textarea) {
          textarea.style.height = '44px';
        }
      }, 0);

      const newMessage = {
        type: 'HUMAN',
        message: message,
        timestamp: new Date().toISOString()
      };

      onUpdateContact({
        ...contact,
        messages: [...(contact.messages || []), newMessage]
      });
    } catch (error) {
      setErrorMessage('Error enviando mensaje: ' + error.message);
      setShowErrorModal(true);
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = async (file, type) => {
    if (!file || !contact || sendingMedia) return;

    setShowAttachMenu(false);

    // Si es imagen, video o documento, mostrar modal para caption
    if (type === 'image' || type === 'video' || type === 'document') {
      setCaptionData({ file, type, caption: '' });
      setShowCaptionModal(true);
    } else {
      // Para audio, enviar directamente
      await sendMediaFile(file, type, '');
    }
  };

  const sendMediaFile = async (file, type, caption) => {
    setSendingMedia(true);

    // Crear URL local para preview inmediato
    const localUrl = URL.createObjectURL(file);

    try {
      if (type === 'image') {
        await sendMyImage(contact.phone, file, caption);
      } else if (type === 'video') {
        await sendMyVideo(contact.phone, file, caption);
      } else if (type === 'document') {
        await sendMyDocument(contact.phone, file, caption);
      } else if (type === 'audio') {
        await sendMyAudio(contact.phone, file, false);
      }

      // Agregar mensaje visual al chat con preview local
      const newMessage = {
        type: 'HUMAN',
        message: caption || '',
        timestamp: new Date().toISOString(),
        hasMedia: true,
        mediaType: type,
        mediaUrl: localUrl,
        mediaMimetype: file.type,
        mediaFilename: file.name
      };

      onUpdateContact({
        ...contact,
        messages: [...(contact.messages || []), newMessage]
      });

      const typeNames = {
        'image': 'Imagen',
        'video': 'Video',
        'document': 'Documento',
        'audio': 'Audio'
      };
      setSuccessMessage(`${typeNames[type] || 'Archivo'} enviado exitosamente`);
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage(`Error enviando ${type}: ${error.message}`);
      setShowErrorModal(true);
      // Liberar URL si hubo error
      URL.revokeObjectURL(localUrl);
    } finally {
      setSendingMedia(false);
    }
  };

  const handleAttachClick = (type) => {
    setShowAttachMenu(false);
    const input = document.createElement('input');
    input.type = 'file';

    if (type === 'image') {
      input.accept = 'image/*';
    } else if (type === 'video') {
      input.accept = 'video/*';
    } else if (type === 'document') {
      input.accept = '*/*';
    } else if (type === 'audio') {
      input.accept = 'audio/*';
    }

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        handleFileSelect(file, type);
      }
    };
    input.click();
  };

  const handleDeleteMessage = async (messageKey) => {
    try {
      await deleteMyMessage(messageKey);
      setSuccessMessage('Mensaje eliminado exitosamente');
      setShowSuccessModal(true);
      // Recargar para ver los cambios
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      setErrorMessage('Error eliminando mensaje: ' + error.message);
      setShowErrorModal(true);
    }
  };

  const handleForwardMessage = (messageKey) => {
    setForwardData({ messageKey, targetPhone: '' });
    setShowForwardModal(true);
  };

  const confirmForwardMessage = async () => {
    if (!forwardData.targetPhone.trim()) {
      setErrorMessage('Debes ingresar un número de teléfono');
      setShowErrorModal(true);
      return;
    }

    try {
      await forwardMyMessage(forwardData.targetPhone, forwardData.messageKey);
      setShowForwardModal(false);
      setSuccessMessage('Mensaje reenviado exitosamente');
      setShowSuccessModal(true);
    } catch (error) {
      setShowForwardModal(false);
      setErrorMessage('Error reenviando mensaje: ' + error.message);
      setShowErrorModal(true);
    }
  };

  const handleReplyMessage = (msg) => {
    setMessageMenuOpen(null);
    setQuotedMessage({
      messageId: msg.messageId,
      message: msg.message,
      userName: msg.userName,
      participant: msg.participant || msg.sender
    });
  };

  const handleEndConversation = async () => {
    setEndingConversation(true);
    
    try {
      await endConversation(contact.phone);
      
      // Agregar mensaje de sistema a la conversación
      const systemMessage = {
        type: 'SYSTEM',
        message: '⏰ Tu sesión de conversación ha finalizado. Puedes escribirme nuevamente para iniciar una nueva conversación.',
        timestamp: new Date().toISOString()
      };
      
      onUpdateContact({
        ...contact,
        messages: [...(contact.messages || []), systemMessage],
        isHumanMode: false
      });
      
      setShowEndModal(false);
      setEndingConversation(false);
    } catch (error) {
      setEndingConversation(false);
      setErrorMessage('Error finalizando conversación: ' + error.message);
      setShowErrorModal(true);
    }
  };

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#FAFBFC' }}>
        <div className="text-center">
          <div className="mb-4">
            <svg className="w-20 h-20 mx-auto text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">Selecciona un chat</h3>
          <p className="text-sm text-gray-500">Elige una conversación de la lista para comenzar</p>
        </div>
      </div>
    );
  }


  // Solo hay modo humano y soporte (sin IA)
  const isSupport = contact.mode === 'support';
  const modeColor = isSupport ? '#F97316' : '#3B82F6';
  const modeLabel = isSupport ? 'Soporte' : 'Humano';

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#FAFBFC' }}>
      {/* Header moderno */}
      <div className="bg-white px-3 md:px-6 py-3 md:py-4 flex items-center justify-between" style={{
        borderBottom: '1px solid #E8EBED',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
      }}>
        <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
          {/* Botón atrás para móviles */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-all flex-shrink-0"
              style={{
                background: '#F3F4F6',
                color: '#6B7280'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#E5E7EB';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#F3F4F6';
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="relative">
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
                  // Si la imagen falla, ocultar y mostrar el fallback
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{
              background: contact.leftGroup
                ? 'linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%)'
                : contact.isGroup
                ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
                : isSupport
                ? 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)'
                : 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
              opacity: contact.leftGroup ? 0.6 : 1,
              display: contact.isGroup && contact.groupPicture ? 'none' : 'flex'
            }}>
              {contact.isGroup ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
                </svg>
              ) : isSupport ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd"/>
                </svg>
              ) : (
                contact.phone.slice(-2)
              )}
            </div>
            {/* Indicador de modo */}
            {!contact.leftGroup && (
              <div
                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white"
                style={{ background: modeColor }}
              ></div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-800">
                {contact.isGroup ? (contact.groupName || contact.phone) : contact.phone}
              </h3>
              <span
                className="text-[10px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  background: isSupport
                    ? 'rgba(249, 115, 22, 0.1)'
                    : 'rgba(59, 130, 246, 0.1)',
                  color: modeColor
                }}
              >
                {modeLabel.toUpperCase()}
              </span>
            </div>
            <span className="text-xs text-gray-500">
              {contact.messages?.length || 0} mensajes
            </span>
          </div>
        </div>

        {/* Botones de acción - Solo finalizar chat */}
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          {isSupport && (
            <button
              className="px-2 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all whitespace-nowrap"
              style={{
                background: 'rgba(249, 115, 22, 0.1)',
                color: '#F97316',
                border: '1px solid transparent'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#F97316';
                e.target.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(249, 115, 22, 0.1)';
                e.target.style.color = '#F97316';
              }}
              onClick={async () => {
                // Cambiar de soporte a humano
                await toggleHumanMode(contact.phone, true, 'human');
                onUpdateContact({ ...contact, isHumanMode: true, mode: 'human' });
              }}
              title="Finalizar modo soporte"
            >
              Finalizar Soporte
            </button>
          )}
          <button
            className="px-2 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium text-white transition-all flex items-center gap-1 whitespace-nowrap"
            style={{ background: '#EF4444' }}
            onMouseEnter={(e) => e.target.style.background = '#DC2626'}
            onMouseLeave={(e) => e.target.style.background = '#EF4444'}
            onClick={() => setShowEndModal(true)}
          >
            <svg className="w-4 h-4 md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="hidden md:inline">Finalizar Chat</span>
            <span className="md:hidden">Finalizar</span>
          </button>

          {/* Botón de menú de opciones (3 puntos) */}
          <div className="relative" ref={optionsMenuRef}>
            <button
              onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
              style={{
                background: showOptionsMenu ? 'rgba(92, 25, 227, 0.1)' : 'transparent',
                color: showOptionsMenu ? '#FD6144' : '#6B7280'
              }}
              onMouseEnter={(e) => {
                if (!showOptionsMenu) {
                  e.target.style.background = 'rgba(107, 114, 128, 0.1)';
                }
              }}
              onMouseLeave={(e) => {
                if (!showOptionsMenu) {
                  e.target.style.background = 'transparent';
                }
              }}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
              </svg>
            </button>

            {/* Menú desplegable */}
            {showOptionsMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl shadow-lg z-50" style={{
                background: 'white',
                border: '1px solid #E8EBED',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
              }}>
                <div className="py-1">
                  <button
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowDeleteModal(true);
                    }}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-all"
                    style={{ color: '#6B7280' }}
                    onMouseEnter={(e) => {
                      e.target.style.background = '#F3F4F6';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'transparent';
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span>Eliminar conversación</span>
                  </button>

                  {contact.isGroup && !contact.leftGroup && (
                    <button
                      onClick={() => {
                        setShowOptionsMenu(false);
                        setShowLeaveGroupModal(true);
                      }}
                      className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-all"
                      style={{ color: '#EF4444' }}
                      onMouseEnter={(e) => {
                        e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'transparent';
                      }}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      <span>Salir del grupo</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Área de mensajes */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-6 space-y-2 md:space-y-3" style={{ background: '#FAFBFC' }}>
        {contact.messages?.slice().reverse().map((msg, index) => {
          const isClient = msg.type === 'USER' || msg.type === 'CLIENTE' || msg.role === 'cliente';
          const isBotOrSupport = msg.type === 'BOT' || msg.type === 'SOPORTE' || msg.role === 'bot' || msg.role === 'soporte';
          const isHumanOrBot = msg.type === 'HUMAN' || msg.type === 'BOT' || isBotOrSupport;
          const isSystem = msg.type === 'SYSTEM' || (msg.type === 'BOT' && msg.message?.includes('⏰') && msg.message?.includes('sesión'));

          // Determinar el color según el tipo de mensaje específico
          const isMessageFromSupport = msg.type === 'SOPORTE' || msg.role === 'soporte' || (msg.type === 'HUMAN' && contact.mode === 'support');
          const isMessageFromHuman = msg.type === 'HUMAN' && contact.mode !== 'support';

          if (isSystem) {
            return (
              <div key={index} className="flex justify-center my-4">
                <div className="bg-white px-4 py-2.5 rounded-xl max-w-md text-center shadow-sm" style={{
                  border: '1px solid #E8EBED'
                }}>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Sistema
                    </span>
                    <span className="text-xs text-gray-400">•</span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(msg.timestamp).toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 leading-relaxed">
                    {msg.message}
                  </div>
                </div>
              </div>
            );
          }
          
          return (
            <div
              key={index}
              className={`flex ${isClient ? 'justify-start' : 'justify-end'} group w-full`}
            >
              <div className={`max-w-[85%] md:max-w-xs lg:max-w-md px-3 py-2 relative ${
                isClient ? 'bg-white text-gray-900' : 'text-white'
              }`}
              style={isClient ? {
                borderRadius: '12px 12px 12px 2px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                border: '1px solid #E8EBED'
              } : {
                borderRadius: '12px 12px 2px 12px',
                backgroundColor: isMessageFromSupport ? '#F97316' : isMessageFromHuman ? '#3B82F6' : '#FD6144',
                boxShadow: isMessageFromSupport ? '0 2px 8px rgba(249, 115, 22, 0.2)' : isMessageFromHuman ? '0 2px 8px rgba(59, 130, 246, 0.2)' : '0 2px 8px rgba(92, 25, 227, 0.2)'
              }}>
                {/* Botón de menú contextual - Para mensajes propios Y de clientes que tengan messageId */}
                {(msg.messageId || msg.status) && (
                  <div className={`absolute ${isClient ? '-right-8' : '-left-8'} top-2 opacity-0 group-hover:opacity-100 transition-opacity`} ref={messageMenuOpen === index ? messageMenuRef : null}>
                    <button
                      onClick={() => setMessageMenuOpen(messageMenuOpen === index ? null : index)}
                      className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                      style={{
                        background: messageMenuOpen === index ? '#FD6144' : '#F3F4F6',
                        color: messageMenuOpen === index ? 'white' : '#6B7280'
                      }}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
                      </svg>
                    </button>

                    {/* Menú desplegable */}
                    {messageMenuOpen === index && (
                      <div className="absolute left-0 top-8 w-40 rounded-lg shadow-lg z-50" style={{
                        background: 'white',
                        border: '1px solid #E8EBED',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                      }}>
                        <div className="py-1">
                          {msg.messageId ? (
                            <>
                              <button
                                onClick={() => handleReplyMessage(msg)}
                                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-100 transition-all"
                                style={{ color: '#6B7280' }}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                                <span>Responder</span>
                              </button>
                              <button
                                onClick={() => {
                                  setMessageMenuOpen(null);
                                  // Crear messageKey desde el messageId
                                  const messageKey = {
                                    remoteJid: `${contact.phone}@g.us`,
                                    id: msg.messageId,
                                    fromMe: !isClient
                                  };
                                  handleForwardMessage(messageKey);
                                }}
                                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-100 transition-all"
                                style={{ color: '#6B7280' }}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                                <span>Reenviar</span>
                              </button>
                              {!isClient && (
                                <button
                                  onClick={() => {
                                    setMessageMenuOpen(null);
                                    // Crear messageKey desde el messageId
                                    const messageKey = {
                                      remoteJid: `${contact.phone}@g.us`,
                                      id: msg.messageId,
                                      fromMe: true
                                    };
                                    handleDeleteMessage(messageKey);
                                  }}
                                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-red-50 transition-all"
                                  style={{ color: '#EF4444' }}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  <span>Eliminar</span>
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="px-3 py-2 text-xs text-gray-400 text-center">
                              No disponible para este mensaje
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Indicador de mensaje reenviado */}
                {msg.isForwarded && (
                  <div className={`text-[10px] font-medium mb-1 flex items-center gap-1 ${isClient ? 'text-gray-500' : 'text-white/70'}`}>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span>Reenviado</span>
                  </div>
                )}

                {/* Mostrar nombre del usuario solo si es un grupo */}
                {contact.isGroup && isClient && (
                  <div className="text-xs font-semibold mb-1" style={{
                    color: isClient ? '#059669' : 'rgba(255, 255, 255, 0.9)'
                  }}>
                    {msg.userName || 'Usuario'}
                  </div>
                )}
                <div className={`text-[10px] font-semibold mb-1 ${contact.isGroup && isClient ? 'hidden' : ''} ${isClient ? 'text-gray-500' : 'text-white/80'}`}>
                  {isClient ? (msg.userName || 'Cliente') :
                   msg.role === 'soporte' || msg.type === 'SOPORTE' ? `Soporte${msg.userName ? ` - ${msg.userName}` : ''}` :
                   msg.type === 'HUMAN' ? (contact.mode === 'support' ? 'Soporte' : 'Humano') :
                   msg.type === 'BOT' ? 'Bot' : 'Sistema'}
                </div>
                <div className="text-sm leading-relaxed pr-16 break-words overflow-hidden">
                  {/* Mostrar imagen/video/documento si existe */}
                  {msg.hasMedia && msg.mediaType && (
                    <div className="mb-2">
                      {msg.mediaType === 'image' && (
                        msg.mediaUrl ? (
                          <img
                            src={msg.mediaUrl}
                            alt={msg.mediaCaption || 'Imagen'}
                            className="rounded-lg w-full max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => {
                              setSelectedMedia({ url: msg.mediaUrl, type: 'image', caption: msg.mediaCaption });
                              setShowMediaModal(true);
                            }}
                            style={{ maxWidth: '100%' }}
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling && (e.target.nextSibling.style.display = 'flex');
                            }}
                          />
                        ) : (
                          <div className={`flex items-center gap-2 p-3 rounded-lg ${isClient ? 'bg-gray-100' : 'bg-white/20'}`}>
                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd"/>
                            </svg>
                            <span className="text-xs opacity-70">Imagen enviada</span>
                          </div>
                        )
                      )}
                      {msg.mediaType === 'video' && (
                        msg.mediaUrl ? (
                          <video
                            controls
                            className="rounded-lg w-full max-h-64 cursor-pointer"
                            style={{ maxWidth: '100%' }}
                            onClick={(e) => {
                              if (e.target.paused) {
                                setSelectedMedia({ url: msg.mediaUrl, type: 'video', caption: msg.mediaCaption, mimetype: msg.mediaMimetype });
                                setShowMediaModal(true);
                              }
                            }}
                          >
                            <source src={msg.mediaUrl} type={msg.mediaMimetype || 'video/mp4'} />
                            Tu navegador no soporta video
                          </video>
                        ) : (
                          <div className={`flex items-center gap-2 p-3 rounded-lg ${isClient ? 'bg-gray-100' : 'bg-white/20'}`}>
                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/>
                            </svg>
                            <span className="text-xs opacity-70">Video enviado</span>
                          </div>
                        )
                      )}
                      {msg.mediaType === 'audio' && (
                        <AudioPlayer
                          src={msg.mediaUrl}
                          isClient={isClient}
                        />
                      )}
                      {msg.mediaType === 'document' && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg ${isClient ? 'bg-gray-100' : 'bg-white/20'}`}>
                          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/>
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{msg.mediaFilename || 'Documento'}</p>
                            <a
                              href={msg.mediaUrl}
                              download={msg.mediaFilename}
                              className="text-xs underline hover:opacity-80"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Descargar
                            </a>
                          </div>
                        </div>
                      )}
                      {msg.mediaType === 'sticker' && (
                        <img
                          src={msg.mediaUrl}
                          alt="Sticker"
                          className="w-auto max-h-32 object-contain"
                          style={{ maxWidth: '150px' }}
                        />
                      )}
                    </div>
                  )}

                  {/* Mostrar mensaje citado si existe */}
                  {msg.hasQuotedMsg && msg.quotedMsg && (
                    <div className={`mb-2 p-2 rounded-lg border-l-4 ${isClient ? 'bg-gray-100 border-gray-400' : 'bg-white/10 border-white/40'}`}>
                      <div className="text-[10px] font-semibold mb-1 opacity-80">
                        {msg.quotedMsg.participant ? msg.quotedMsg.participant.split('@')[0] : 'Usuario'}
                      </div>
                      <div className="text-xs opacity-70 truncate" style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.quotedMsg.body || '[Mensaje sin texto]'}
                      </div>
                    </div>
                  )}

                  {/* Mostrar texto del mensaje (solo si existe) */}
                  {msg.message && msg.message.trim() !== '' && (isClient || isHumanOrBot ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>
                      {msg.message}
                    </div>
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.message}</span>
                  ))}
                </div>
                <div className={`absolute bottom-1 right-2 text-[11px] flex items-center gap-1 ${isClient ? 'text-gray-500' : 'text-white/70'}`}>
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  {!isClient && msg.status && (
                    <span className="flex items-center ml-0.5">
                      {msg.status === 'sent' && (
                        <svg className="w-[15px] h-[15px]" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                        </svg>
                      )}
                      {msg.status === 'delivered' && (
                        <svg className="w-[15px] h-[15px]" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                          <path d="M19.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-0.5-0.5 1.414-1.414 7.086-7.086a1 1 0 011.414 0z"/>
                        </svg>
                      )}
                      {msg.status === 'read' && (
                        <svg className="w-[15px] h-[15px] text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                          <path d="M19.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-0.5-0.5 1.414-1.414 7.086-7.086a1 1 0 011.414 0z"/>
                        </svg>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input de mensaje o mensaje de grupo abandonado */}
      {contact.leftGroup ? (
        <div className="bg-white px-3 md:px-6 py-3 md:py-4 flex items-center justify-center" style={{
          borderTop: '1px solid #E8EBED',
          boxShadow: '0 -1px 3px rgba(0, 0, 0, 0.02)'
        }}>
          <div className="text-center py-2">
            <p className="text-xs md:text-sm font-medium text-gray-500">Ya no puedes enviar mensajes a este grupo</p>
          </div>
        </div>
      ) : (
        <>
          {/* Indicador de mensaje citado */}
          {quotedMessage && (
            <div className="bg-white px-3 md:px-6 py-3 flex items-center justify-between" style={{
              borderTop: '1px solid #E8EBED',
              background: 'rgba(253, 97, 68, 0.05)'
            }}>
              <div className="flex items-center gap-3 flex-1">
                <div className="w-1 h-10 rounded-full" style={{ background: '#FD6144' }}></div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    Respondiendo a {quotedMessage.userName || 'Usuario'}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {quotedMessage.message || '[Mensaje sin texto]'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setQuotedMessage(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-gray-200"
                style={{ color: '#6B7280' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <div className="bg-white px-3 md:px-6 py-3 md:py-4 flex items-end gap-2 md:gap-3 relative" style={{
            borderTop: quotedMessage ? 'none' : '1px solid #E8EBED',
            boxShadow: '0 -1px 3px rgba(0, 0, 0, 0.02)'
          }}>
            {/* Botón de adjuntar archivos */}
          <div className="relative" ref={attachMenuRef}>
            <button
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              disabled={sendingMedia}
              className="rounded-xl flex items-center justify-center transition-all disabled:opacity-50 flex-shrink-0"
              style={{
                background: showAttachMenu ? '#FD6144' : '#F3F4F6',
                color: showAttachMenu ? 'white' : '#6B7280',
                width: '44px',
                height: '44px'
              }}
              onMouseEnter={(e) => {
                if (!sendingMedia && !showAttachMenu) {
                  e.target.style.background = '#E5E7EB';
                }
              }}
              onMouseLeave={(e) => {
                if (!sendingMedia && !showAttachMenu) {
                  e.target.style.background = '#F3F4F6';
                }
              }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            {/* Menú de opciones de adjuntar */}
            {showAttachMenu && (
              <div className="absolute bottom-16 left-0 w-48 rounded-xl shadow-lg z-50" style={{
                background: 'white',
                border: '1px solid #E8EBED',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
              }}>
                <div className="py-2">
                  <button
                    onClick={() => handleAttachClick('image')}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-all"
                    style={{ color: '#6B7280' }}
                    onMouseEnter={(e) => {
                      e.target.style.background = '#F3F4F6';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'transparent';
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>Enviar imagen</span>
                  </button>

                  <button
                    onClick={() => handleAttachClick('video')}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-all"
                    style={{ color: '#6B7280' }}
                    onMouseEnter={(e) => {
                      e.target.style.background = '#F3F4F6';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'transparent';
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>Enviar video</span>
                  </button>

                  <button
                    onClick={() => handleAttachClick('document')}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-all"
                    style={{ color: '#6B7280' }}
                    onMouseEnter={(e) => {
                      e.target.style.background = '#F3F4F6';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'transparent';
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span>Enviar documento</span>
                  </button>

                  <button
                    onClick={() => handleAttachClick('audio')}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-all"
                    style={{ color: '#6B7280' }}
                    onMouseEnter={(e) => {
                      e.target.style.background = '#F3F4F6';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'transparent';
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    <span>Enviar audio</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl+Enter o Shift+Enter para enviar
              if ((e.ctrlKey || e.shiftKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Escribe un mensaje... (Ctrl+Enter para enviar)"
            disabled={sending || sendingMedia}
            rows={1}
            className="flex-1 px-4 py-3 rounded-xl focus:outline-none text-sm transition-all disabled:opacity-50 resize-none"
            style={{
              background: '#F3F4F6',
              border: '1px solid transparent',
              minHeight: '44px',
              maxHeight: '100px',
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: '#CBD5E0 transparent'
            }}
            onFocus={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#ffffff';
                e.target.style.border = '1px solid #FD6144';
                e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
              }
            }}
            onBlur={(e) => {
              e.target.style.background = '#F3F4F6';
              e.target.style.border = '1px solid transparent';
              e.target.style.boxShadow = 'none';
            }}
            onInput={(e) => {
              // Auto-ajustar altura del textarea según el contenido
              e.target.style.height = 'auto';
              const newHeight = Math.min(e.target.scrollHeight, 100);
              e.target.style.height = newHeight + 'px';

              // Si alcanzó el máximo, mostrar scroll
              if (e.target.scrollHeight > 100) {
                e.target.style.overflowY = 'auto';
              } else {
                e.target.style.overflowY = 'hidden';
              }
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || sendingMedia || !message.trim()}
            className="px-3 md:px-6 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
            style={{
              background: '#FD6144',
              minWidth: '70px',
              height: '44px'
            }}
            onMouseEnter={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#FD3244';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#FD6144';
              }
            }}
          >
            {sending ? '...' : sendingMedia ? 'Enviando...' : (
              <>
                <svg className="w-5 h-5 md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span className="hidden md:inline">Enviar</span>
              </>
            )}
          </button>
        </div>
        </>
      )}

      {/* Modal de soporte activado */}
      {showSupportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)',
                boxShadow: '0 8px 20px rgba(249, 115, 22, 0.3)'
              }}>
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800">
              Cliente Solicita Soporte
            </h3>
            <p className="text-sm text-gray-500 mb-6 text-center">
              El cliente ha solicitado atención personalizada. Puedes tomar el control de la conversación.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(249, 115, 22, 0.08)',
              border: '1px solid rgba(249, 115, 22, 0.2)'
            }}>
              <p className="text-sm text-gray-700">
                <strong className="text-orange-600">Cliente:</strong> {contact.phone}
              </p>
              <p className="text-sm text-gray-700 mt-1">
                <strong className="text-orange-600">Estado:</strong> Esperando respuesta
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSupportModal(false)}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: '#F3F4F6',
                  color: '#6B7280'
                }}
                onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  try {
                    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
                    const userName = currentUser.name || 'un especialista';

                    const presentationMessage = `Hola, te atiende ${userName}. 👋\n\nSerá un placer ayudarte con tu consulta. ¿En qué puedo asistirte hoy?`;

                    setShowSupportModal(false);

                    await sendMyMessage(contact.phone, presentationMessage); // Sin parámetro isGroup

                    const newMessage = {
                      type: 'HUMAN',
                      message: presentationMessage,
                      timestamp: new Date().toISOString()
                    };

                    onUpdateContact({
                      ...contact,
                      messages: [...(contact.messages || []), newMessage]
                    });
                  } catch (error) {
                    setErrorMessage('Error al tomar control: ' + (error.message || 'Error desconocido'));
                    setShowErrorModal(true);
                  }
                }}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: '#F97316' }}
                onMouseEnter={(e) => e.target.style.background = '#EA580C'}
                onMouseLeave={(e) => e.target.style.background = '#F97316'}
              >
                Tomar Control
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación finalizar */}
      {showEndModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-3 text-gray-800">
              Finalizar Conversación
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              ¿Estás seguro de que deseas finalizar esta conversación? Se enviará un mensaje de cierre al cliente y la sesión cambiará a modo IA.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)'
            }}>
              <p className="text-sm text-gray-700">
                Se enviará al cliente: <strong>"⏰ Tu sesión de conversación ha finalizado. Puedes escribirme nuevamente para iniciar una nueva conversación."</strong>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndModal(false)}
                disabled={endingConversation}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: '#F3F4F6',
                  color: '#6B7280'
                }}
                onMouseEnter={(e) => !endingConversation && (e.target.style.background = '#E5E7EB')}
                onMouseLeave={(e) => !endingConversation && (e.target.style.background = '#F3F4F6')}
              >
                Cancelar
              </button>
              <button
                onClick={handleEndConversation}
                disabled={endingConversation}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#EF4444' }}
                onMouseEnter={(e) => !endingConversation && (e.target.style.background = '#DC2626')}
                onMouseLeave={(e) => !endingConversation && (e.target.style.background = '#EF4444')}
              >
                {endingConversation ? 'Finalizando...' : 'Finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar conversación */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
                boxShadow: '0 8px 20px rgba(239, 68, 68, 0.3)'
              }}>
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800">
              Eliminar Conversación
            </h3>
            <p className="text-sm text-gray-500 mb-6 text-center">
              ¿Estás seguro de que deseas eliminar esta conversación? Esta acción no se puede deshacer.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              <p className="text-sm text-gray-700">
                <strong className="text-red-600">Atención:</strong> Se eliminará todo el historial de mensajes con este contacto.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deletingConversation}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: '#F3F4F6',
                  color: '#6B7280'
                }}
                onMouseEnter={(e) => !deletingConversation && (e.target.style.background = '#E5E7EB')}
                onMouseLeave={(e) => !deletingConversation && (e.target.style.background = '#F3F4F6')}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setDeletingConversation(true);
                  try {
                    await deleteConversation(contact.phone);
                    setShowDeleteModal(false);
                    setDeletingConversation(false);
                    // Recargar la página para actualizar la lista de contactos
                    window.location.reload();
                  } catch (error) {
                    setDeletingConversation(false);
                    setErrorMessage('Error eliminando conversación: ' + error.message);
                    setShowErrorModal(true);
                  }
                }}
                disabled={deletingConversation}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#EF4444' }}
                onMouseEnter={(e) => !deletingConversation && (e.target.style.background = '#DC2626')}
                onMouseLeave={(e) => !deletingConversation && (e.target.style.background = '#EF4444')}
              >
                {deletingConversation ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal salir del grupo */}
      {showLeaveGroupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                boxShadow: '0 8px 20px rgba(245, 158, 11, 0.3)'
              }}>
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800">
              Salir del Grupo
            </h3>
            <p className="text-sm text-gray-500 mb-6 text-center">
              ¿Estás seguro de que deseas salir de este grupo? El bot dejará de recibir mensajes de este grupo.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)'
            }}>
              <p className="text-sm text-gray-700">
                <strong className="text-amber-600">Atención:</strong> Esta acción hará que el bot abandone el grupo "{contact.groupName || contact.phone}".
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveGroupModal(false)}
                disabled={leavingGroup}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: '#F3F4F6',
                  color: '#6B7280'
                }}
                onMouseEnter={(e) => !leavingGroup && (e.target.style.background = '#E5E7EB')}
                onMouseLeave={(e) => !leavingGroup && (e.target.style.background = '#F3F4F6')}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setLeavingGroup(true);
                  try {
                    await leaveGroup(contact.phone);
                    setShowLeaveGroupModal(false);
                    setLeavingGroup(false);

                    // Marcar el contacto como "leftGroup"
                    onUpdateContact({
                      ...contact,
                      leftGroup: true
                    });
                  } catch (error) {
                    setLeavingGroup(false);
                    setErrorMessage('Error saliendo del grupo: ' + error.message);
                    setShowErrorModal(true);
                  }
                }}
                disabled={leavingGroup}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#F59E0B' }}
                onMouseEnter={(e) => !leavingGroup && (e.target.style.background = '#D97706')}
                onMouseLeave={(e) => !leavingGroup && (e.target.style.background = '#F59E0B')}
              >
                {leavingGroup ? 'Saliendo...' : 'Salir del Grupo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de vista ampliada de medios */}
      {showMediaModal && selectedMedia && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50"
          onClick={() => {
            setShowMediaModal(false);
            setSelectedMedia(null);
          }}
        >
          <div className="relative max-w-7xl max-h-screen p-4 w-full h-full flex flex-col items-center justify-center">
            {/* Botón cerrar */}
            <button
              onClick={() => {
                setShowMediaModal(false);
                setSelectedMedia(null);
              }}
              className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all z-10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Contenido del modal */}
            <div className="flex flex-col items-center justify-center max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
              {selectedMedia.type === 'image' && (
                <img
                  src={selectedMedia.url}
                  alt={selectedMedia.caption || 'Imagen'}
                  className="max-w-full max-h-[85vh] object-contain rounded-lg"
                  style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)' }}
                />
              )}
              {selectedMedia.type === 'video' && (
                <video
                  controls
                  autoPlay
                  className="max-w-full max-h-[85vh] rounded-lg"
                  style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)' }}
                >
                  <source src={selectedMedia.url} type={selectedMedia.mimetype || 'video/mp4'} />
                  Tu navegador no soporta video
                </video>
              )}

              {/* Caption si existe */}
              {selectedMedia.caption && (
                <div className="mt-4 px-6 py-3 rounded-xl max-w-2xl text-center" style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(10px)'
                }}>
                  <p className="text-white text-sm">{selectedMedia.caption}</p>
                </div>
              )}

              {/* Botón de descarga */}
              <a
                href={selectedMedia.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 px-6 py-2 rounded-xl text-white font-medium transition-all flex items-center gap-2"
                style={{ background: '#FD6144' }}
                onMouseEnter={(e) => e.target.style.background = '#FD3244'}
                onMouseLeave={(e) => e.target.style.background = '#FD6144'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Descargar
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal para ingresar caption */}
      {showCaptionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-3 text-gray-800">
              Agregar caption
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Ingresa un texto descriptivo para {captionData.type === 'image' ? 'la imagen' : 'el documento'} (opcional)
            </p>
            <input
              type="text"
              value={captionData.caption}
              onChange={(e) => setCaptionData({...captionData, caption: e.target.value})}
              placeholder="Escribe el caption aquí..."
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm mb-6"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCaptionModal(false);
                  setCaptionData({ file: null, type: null, caption: '' });
                }}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: '#F3F4F6',
                  color: '#6B7280'
                }}
                onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowCaptionModal(false);
                  sendMediaFile(captionData.file, captionData.type, captionData.caption);
                  setCaptionData({ file: null, type: null, caption: '' });
                }}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: '#FD6144' }}
                onMouseEnter={(e) => e.target.style.background = '#FD3244'}
                onMouseLeave={(e) => e.target.style.background = '#FD6144'}
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para reenviar mensaje */}
      {showForwardModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-3 text-gray-800">
              Reenviar mensaje
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Ingresa el número de teléfono del grupo destino (sin @g.us)
            </p>
            <input
              type="text"
              value={forwardData.targetPhone}
              onChange={(e) => setForwardData({...forwardData, targetPhone: e.target.value})}
              placeholder="Ej: 1234567890"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm mb-6"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowForwardModal(false);
                  setForwardData({ messageKey: null, targetPhone: '' });
                }}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: '#F3F4F6',
                  color: '#6B7280'
                }}
                onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
              >
                Cancelar
              </button>
              <button
                onClick={confirmForwardMessage}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: '#FD6144' }}
                onMouseEnter={(e) => e.target.style.background = '#FD3244'}
                onMouseLeave={(e) => e.target.style.background = '#FD6144'}
              >
                Reenviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de error */}
      {showErrorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
                boxShadow: '0 8px 20px rgba(239, 68, 68, 0.3)'
              }}>
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800">
              Error
            </h3>
            <p className="text-sm text-gray-600 mb-6 text-center">
              {errorMessage}
            </p>
            <button
              onClick={() => setShowErrorModal(false)}
              className="w-full px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: '#EF4444' }}
              onMouseEnter={(e) => e.target.style.background = '#DC2626'}
              onMouseLeave={(e) => e.target.style.background = '#EF4444'}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Modal de éxito */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                boxShadow: '0 8px 20px rgba(16, 185, 129, 0.3)'
              }}>
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800">
              Éxito
            </h3>
            <p className="text-sm text-gray-600 mb-6 text-center">
              {successMessage}
            </p>
            <button
              onClick={() => setShowSuccessModal(false)}
              className="w-full px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: '#10B981' }}
              onMouseEnter={(e) => e.target.style.background = '#059669'}
              onMouseLeave={(e) => e.target.style.background = '#10B981'}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatPanel;