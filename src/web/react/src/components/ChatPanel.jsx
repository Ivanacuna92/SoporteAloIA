import React, { useState, useEffect, useRef } from 'react';
import {
  sendMyMessage, sendMyImage, sendMyDocument, sendMyAudio, forwardMyMessage, deleteMyMessage,
  toggleHumanMode, endConversation, deleteConversation, leaveGroup,
  reactToMessage, editMessage, sendLocation, sendContact, sendSticker, sendPresence,
  sendMessageAdvanced
} from '../services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function ChatPanel({ contact, onUpdateContact }) {
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
  const [quotedMessage, setQuotedMessage] = useState(null); // Para responder mensajes
  const [editingMessage, setEditingMessage] = useState(null); // Para editar mensajes
  const [showReactionPicker, setShowReactionPicker] = useState(null); // Para mostrar emojis
  const [showFormatMenu, setShowFormatMenu] = useState(false); // Para formateo de texto
  const [showLocationModal, setShowLocationModal] = useState(false); // Modal de ubicación
  const [showContactModal, setShowContactModal] = useState(false); // Modal de contacto
  const [locationData, setLocationData] = useState({ latitude: '', longitude: '', name: '', address: '' });
  const [contactData, setContactData] = useState({ name: '', number: '' });
  const [typingTimeout, setTypingTimeout] = useState(null); // Para indicador de escritura
  const [showMentionMenu, setShowMentionMenu] = useState(false); // Para mostrar menú de menciones
  const [mentionSearch, setMentionSearch] = useState(''); // Búsqueda de menciones
  const [selectedMentions, setSelectedMentions] = useState([]); // JIDs de usuarios mencionados
  const [mentionPosition, setMentionPosition] = useState(0); // Posición del @ en el texto
  const [groupParticipants, setGroupParticipants] = useState([]); // Participantes del grupo
  const messagesEndRef = useRef(null);
  const optionsMenuRef = useRef(null);
  const attachMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageMenuRef = useRef(null);
  const textareaRef = useRef(null);
  const formatMenuRef = useRef(null);
  const reactionPickerRef = useRef(null);
  const mentionMenuRef = useRef(null);

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
      if (formatMenuRef.current && !formatMenuRef.current.contains(event.target)) {
        setShowFormatMenu(false);
      }
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(event.target)) {
        setShowReactionPicker(null);
      }
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(event.target)) {
        setShowMentionMenu(false);
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
  
  // Extraer participantes únicos del grupo
  useEffect(() => {
    if (contact?.isGroup && contact?.messages) {
      const participants = new Map();

      console.log('🔍 [MENCIONES] Extrayendo participantes del grupo...');
      console.log('🔍 [MENCIONES] Total mensajes:', contact.messages.length);

      contact.messages.forEach((msg, index) => {
        // Solo mensajes de usuarios (no del bot/soporte)
        if ((msg.type === 'USER' || msg.type === 'CLIENTE') && msg.userName) {
          console.log(`🔍 [MENCIONES] Mensaje ${index}:`, {
            type: msg.type,
            userName: msg.userName,
            participant: msg.participant,
            hasParticipant: !!msg.participant
          });

          // Si tiene participant, usarlo. Si no, generar uno basado en el número
          const participantJid = msg.participant || `${msg.userName}@s.whatsapp.net`;

          participants.set(participantJid, {
            jid: participantJid,
            name: msg.userName
          });
        }
      });

      const participantsList = Array.from(participants.values());
      console.log('✅ [MENCIONES] Participantes extraídos:', participantsList.length, participantsList);
      setGroupParticipants(participantsList);
    }
  }, [contact?.messages, contact?.isGroup]);

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

    // Si estamos editando, usar la función de edición
    if (editingMessage) {
      await confirmEdit();
      return;
    }

    setSending(true);
    try {
      // Preparar opciones para el mensaje
      const options = {};

      // Si hay mensaje citado, agregar reply
      if (quotedMessage) {
        options.quotedMessageId = quotedMessage.messageId;
        options.quotedRemoteJid = `${contact.phone}@g.us`;
        if (quotedMessage.participant) {
          options.quotedParticipant = quotedMessage.participant;
        }
      }

      // Si hay menciones, agregarlas
      if (selectedMentions.length > 0) {
        options.mentions = selectedMentions;
      }

      // Enviar mensaje con opciones avanzadas si hay reply o menciones
      if (Object.keys(options).length > 0) {
        await sendMessageAdvanced(contact.phone, message, options);
      } else {
        // Enviar mensaje normal
        await sendMyMessage(contact.phone, message);
      }

      // Limpiar estados
      setMessage('');
      setQuotedMessage(null);
      setSelectedMentions([]);

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

    // Si es imagen o documento, mostrar modal para caption
    if (type === 'image' || type === 'document') {
      setCaptionData({ file, type, caption: '' });
      setShowCaptionModal(true);
    } else {
      // Para audio, enviar directamente
      await sendMediaFile(file, type, '');
    }
  };

  const sendMediaFile = async (file, type, caption) => {
    setSendingMedia(true);

    try {
      if (type === 'image') {
        await sendMyImage(contact.phone, file, caption);
      } else if (type === 'document') {
        await sendMyDocument(contact.phone, file, caption);
      } else if (type === 'audio') {
        await sendMyAudio(contact.phone, file, false);
      }

      // Agregar mensaje visual al chat
      const newMessage = {
        type: 'HUMAN',
        message: caption || `[${type === 'image' ? 'Imagen' : type === 'document' ? 'Documento' : 'Audio'}]`,
        timestamp: new Date().toISOString(),
        hasMedia: true,
        mediaType: type
      };

      onUpdateContact({
        ...contact,
        messages: [...(contact.messages || []), newMessage]
      });

      setSuccessMessage(`${type === 'image' ? 'Imagen' : type === 'document' ? 'Documento' : 'Audio'} enviado exitosamente`);
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage(`Error enviando ${type}: ${error.message}`);
      setShowErrorModal(true);
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
    console.log('🗑️ [DELETE] Intentando eliminar mensaje:', messageKey);
    try {
      await deleteMyMessage(messageKey);
      console.log('✅ [DELETE] Mensaje eliminado exitosamente');
      setSuccessMessage('Mensaje eliminado exitosamente');
      setShowSuccessModal(true);
      // Recargar para ver los cambios
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      console.error('❌ [DELETE] Error eliminando mensaje:', error);
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

  // ===== NUEVAS FUNCIONES AVANZADAS =====

  // Reaccionar a mensaje
  const handleReaction = async (messageKey, emoji) => {
    try {
      await reactToMessage(messageKey, emoji);
      setShowReactionPicker(null);
      setSuccessMessage('Reacción enviada');
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage('Error enviando reacción: ' + error.message);
      setShowErrorModal(true);
    }
  };

  // Responder a mensaje
  const handleReplyMessage = (msg, index) => {
    setQuotedMessage({ ...msg, index });
    setMessageMenuOpen(null);
  };

  // Cancelar respuesta
  const cancelReply = () => {
    setQuotedMessage(null);
  };

  // Editar mensaje
  const handleEditMessage = (msg, index) => {
    setEditingMessage({ ...msg, index });
    setMessage(msg.message || '');
    setMessageMenuOpen(null);
  };

  // Cancelar edición
  const cancelEdit = () => {
    setEditingMessage(null);
    setMessage('');
  };

  // Confirmar edición
  const confirmEdit = async () => {
    if (!message.trim() || !editingMessage) return;

    try {
      const messageKey = {
        remoteJid: `${contact.phone}@g.us`,
        id: editingMessage.messageId,
        fromMe: true
      };

      await editMessage(messageKey, message);
      setSuccessMessage('Mensaje editado exitosamente');
      setShowSuccessModal(true);
      setEditingMessage(null);
      setMessage('');

      // Recargar para ver los cambios
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      setErrorMessage('Error editando mensaje: ' + error.message);
      setShowErrorModal(true);
    }
  };

  // Aplicar formato al texto
  const applyFormat = (format) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = message.substring(start, end);

    if (!selectedText) {
      setErrorMessage('Selecciona texto para aplicar formato');
      setShowErrorModal(true);
      return;
    }

    let formattedText;
    switch(format) {
      case 'bold':
        formattedText = `*${selectedText}*`;
        break;
      case 'italic':
        formattedText = `_${selectedText}_`;
        break;
      case 'monospace':
        formattedText = `\`\`\`${selectedText}\`\`\``;
        break;
      case 'strikethrough':
        formattedText = `~${selectedText}~`;
        break;
      default:
        return;
    }

    const newText = message.substring(0, start) + formattedText + message.substring(end);
    setMessage(newText);
    setShowFormatMenu(false);

    // Restaurar el foco y la posición del cursor
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + formattedText.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // Enviar ubicación
  const handleSendLocation = async () => {
    if (!locationData.latitude || !locationData.longitude) {
      setErrorMessage('Debes ingresar latitud y longitud');
      setShowErrorModal(true);
      return;
    }

    try {
      await sendLocation(
        contact.phone,
        parseFloat(locationData.latitude),
        parseFloat(locationData.longitude),
        locationData.name,
        locationData.address
      );

      setShowLocationModal(false);
      setLocationData({ latitude: '', longitude: '', name: '', address: '' });
      setSuccessMessage('Ubicación enviada exitosamente');
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage('Error enviando ubicación: ' + error.message);
      setShowErrorModal(true);
    }
  };

  // Usar ubicación actual del navegador
  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setErrorMessage('Tu navegador no soporta geolocalización');
      setShowErrorModal(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationData({
          ...locationData,
          latitude: position.coords.latitude.toString(),
          longitude: position.coords.longitude.toString(),
          name: locationData.name || 'Mi ubicación'
        });
      },
      (error) => {
        setErrorMessage('Error obteniendo ubicación: ' + error.message);
        setShowErrorModal(true);
      }
    );
  };

  // Enviar contacto
  const handleSendContact = async () => {
    if (!contactData.name || !contactData.number) {
      setErrorMessage('Debes ingresar nombre y número');
      setShowErrorModal(true);
      return;
    }

    try {
      await sendContact(contact.phone, contactData.name, contactData.number);
      setShowContactModal(false);
      setContactData({ name: '', number: '' });
      setSuccessMessage('Contacto enviado exitosamente');
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage('Error enviando contacto: ' + error.message);
      setShowErrorModal(true);
    }
  };

  // Enviar sticker
  const handleStickerClick = () => {
    setShowAttachMenu(false);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          setSendingMedia(true);
          await sendSticker(contact.phone, file);
          setSuccessMessage('Sticker enviado exitosamente');
          setShowSuccessModal(true);
        } catch (error) {
          setErrorMessage('Error enviando sticker: ' + error.message);
          setShowErrorModal(true);
        } finally {
          setSendingMedia(false);
        }
      }
    };
    input.click();
  };

  // Actualizar presencia (escribiendo...)
  const updatePresence = async (state) => {
    try {
      await sendPresence(contact.phone, state);
    } catch (error) {
      // Error silencioso, no es crítico
      console.error('Error actualizando presencia:', error);
    }
  };

  // ===== FUNCIONES DE MENCIONES =====

  // Detectar cuando se escribe "@" para mostrar menú de menciones
  const handleMessageChange = (e) => {
    const newMessage = e.target.value;
    setMessage(newMessage);

    // Actualizar presencia
    if (!typingTimeout) {
      updatePresence('composing');
    }
    clearTimeout(typingTimeout);
    setTypingTimeout(setTimeout(() => {
      updatePresence('paused');
      setTypingTimeout(null);
    }, 2000));

    // Detectar @ para menciones (solo en grupos)
    console.log('📝 [MENCIONES] Texto:', newMessage);
    console.log('📝 [MENCIONES] Es grupo:', contact?.isGroup);
    console.log('📝 [MENCIONES] Participantes:', groupParticipants.length);

    if (contact?.isGroup && groupParticipants.length > 0) {
      const cursorPos = e.target.selectionStart;
      const textBeforeCursor = newMessage.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');

      console.log('📝 [MENCIONES] Posición @:', lastAtIndex);

      if (lastAtIndex !== -1) {
        const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
        console.log('📝 [MENCIONES] Texto después de @:', textAfterAt);

        // Si no hay espacio después del @, mostrar menú
        if (!textAfterAt.includes(' ')) {
          console.log('✅ [MENCIONES] Mostrando menú!');
          setMentionSearch(textAfterAt.toLowerCase());
          setMentionPosition(lastAtIndex);
          setShowMentionMenu(true);
          return;
        }
      }
    } else {
      console.log('❌ [MENCIONES] No se puede mostrar menú:', {
        isGroup: contact?.isGroup,
        participantCount: groupParticipants.length
      });
    }

    setShowMentionMenu(false);
  };

  // Seleccionar una mención
  const selectMention = (participant) => {
    const beforeMention = message.substring(0, mentionPosition);
    const afterMention = message.substring(textareaRef.current.selectionStart);
    const newMessage = `${beforeMention}@${participant.name} ${afterMention}`;

    setMessage(newMessage);
    setShowMentionMenu(false);

    // Agregar JID a la lista de menciones si no está ya
    if (!selectedMentions.includes(participant.jid)) {
      setSelectedMentions([...selectedMentions, participant.jid]);
    }

    // Restaurar foco
    setTimeout(() => {
      textareaRef.current?.focus();
      const newCursorPos = mentionPosition + participant.name.length + 2; // +2 por @ y espacio
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // Filtrar participantes por búsqueda
  const filteredParticipants = groupParticipants.filter(p =>
    p.name.toLowerCase().includes(mentionSearch)
  );

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
    <div className="flex-1 flex flex-col" style={{ background: '#FAFBFC' }}>
      {/* Header moderno */}
      <div className="bg-white px-6 py-4 flex items-center justify-between" style={{
        borderBottom: '1px solid #E8EBED',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
      }}>
        <div className="flex items-center gap-4">
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
        <div className="flex items-center gap-2">
          {isSupport && (
            <button
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
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
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-all"
            style={{ background: '#EF4444' }}
            onMouseEnter={(e) => e.target.style.background = '#DC2626'}
            onMouseLeave={(e) => e.target.style.background = '#EF4444'}
            onClick={() => setShowEndModal(true)}
          >
            Finalizar Chat
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
      <div className="flex-1 overflow-y-auto p-6 space-y-3" style={{ background: '#FAFBFC' }}>
        {contact.messages?.slice().reverse().map((msg, index) => {
          const isClient = msg.type === 'USER' || msg.type === 'CLIENTE' || msg.role === 'cliente';
          const isBotOrSupport = msg.type === 'BOT' || msg.type === 'SOPORTE' || msg.role === 'bot' || msg.role === 'soporte';
          const isHumanOrBot = msg.type === 'HUMAN' || msg.type === 'BOT' || isBotOrSupport;
          const isSystem = msg.type === 'SYSTEM' || (msg.type === 'BOT' && msg.message?.includes('⏰') && msg.message?.includes('sesión'));

          // Determinar el color según el tipo de mensaje específico
          const isMessageFromSupport = msg.type === 'SOPORTE' || msg.role === 'soporte' || (msg.type === 'HUMAN' && contact.mode === 'support');
          const isMessageFromHuman = msg.type === 'HUMAN' && contact.mode !== 'support';
          const isMessageFromBot = msg.type === 'BOT';

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
              className={`flex ${isClient ? 'justify-start' : 'justify-end'} group`}
            >
              <div className={`max-w-xs lg:max-w-md px-3 py-2 relative ${
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
                      <div className="absolute left-0 top-8 w-44 rounded-lg shadow-lg z-50" style={{
                        background: 'white',
                        border: '1px solid #E8EBED',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                      }}>
                        <div className="py-1">
                          {msg.messageId ? (
                            <>
                              {/* Botón de reacciones */}
                              <button
                                onClick={() => {
                                  setMessageMenuOpen(null);
                                  setShowReactionPicker(index);
                                }}
                                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-100 transition-all"
                                style={{ color: '#6B7280' }}
                              >
                                <span>😀</span>
                                <span>Reaccionar</span>
                              </button>

                              {/* Botón de responder */}
                              <button
                                onClick={() => handleReplyMessage(msg, index)}
                                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-100 transition-all"
                                style={{ color: '#6B7280' }}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                                <span>Responder</span>
                              </button>

                              {/* Botón de editar (solo mensajes propios) */}
                              {!isClient && msg.message && (
                                <button
                                  onClick={() => handleEditMessage(msg, index)}
                                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-100 transition-all"
                                  style={{ color: '#6B7280' }}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  <span>Editar</span>
                                </button>
                              )}

                              {/* Botón de reenviar */}
                              <button
                                onClick={() => {
                                  setMessageMenuOpen(null);
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

                              {/* Botón de eliminar (solo mensajes propios) */}
                              {!isClient && (
                                <button
                                  onClick={() => {
                                    setMessageMenuOpen(null);
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

                    {/* Selector de reacciones */}
                    {showReactionPicker === index && (
                      <div className="absolute left-0 top-8 rounded-lg shadow-lg z-50 p-2" style={{
                        background: 'white',
                        border: '1px solid #E8EBED',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                      }} ref={reactionPickerRef}>
                        <div className="flex gap-1">
                          {['❤️', '👍', '😂', '😮', '😢', '🙏', '🔥', '👏'].map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => {
                                const messageKey = {
                                  remoteJid: `${contact.phone}@g.us`,
                                  id: msg.messageId,
                                  participant: msg.participant || undefined
                                };
                                handleReaction(messageKey, emoji);
                              }}
                              className="w-8 h-8 rounded-lg hover:bg-gray-100 transition-all flex items-center justify-center text-lg"
                            >
                              {emoji}
                            </button>
                          ))}
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
                <div className="text-sm leading-relaxed pr-16">
                  {/* Mostrar imagen/video/documento si existe */}
                  {msg.hasMedia && msg.mediaType && (
                    <div className="mb-2">
                      {msg.mediaType === 'image' && (
                        <img
                          src={msg.mediaUrl}
                          alt={msg.mediaCaption || 'Imagen'}
                          className="rounded-lg max-w-full max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => {
                            setSelectedMedia({ url: msg.mediaUrl, type: 'image', caption: msg.mediaCaption });
                            setShowMediaModal(true);
                          }}
                          style={{ maxWidth: '300px' }}
                        />
                      )}
                      {msg.mediaType === 'video' && (
                        <video
                          controls
                          className="rounded-lg max-w-full max-h-64 cursor-pointer"
                          style={{ maxWidth: '300px' }}
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
                      )}
                      {msg.mediaType === 'audio' && (
                        <audio controls className="w-full">
                          <source src={msg.mediaUrl} type={msg.mediaMimetype || 'audio/ogg'} />
                          Tu navegador no soporta audio
                        </audio>
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
                          className="max-w-full max-h-32 object-contain"
                          style={{ maxWidth: '150px' }}
                        />
                      )}
                    </div>
                  )}

                  {/* Mostrar texto del mensaje (solo si existe) */}
                  {msg.message && msg.message.trim() !== '' && (isClient || isHumanOrBot ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({children}) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                        ol: ({children}) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                        li: ({children}) => <li className="mb-1">{children}</li>,
                        code: ({inline, children}) =>
                          inline ?
                            <code className={`${isClient ? 'bg-gray-200 text-gray-900' : 'bg-white/20 text-white'} px-1.5 py-0.5 rounded text-xs`}>{children}</code> :
                            <pre className={`${isClient ? 'bg-gray-100 text-gray-900' : 'bg-white/10 text-white'} p-2 rounded overflow-x-auto my-2 text-xs`}><code>{children}</code></pre>,
                        strong: ({children}) => <strong className="font-semibold">{children}</strong>,
                        em: ({children}) => <em className="italic">{children}</em>,
                        a: ({href, children}) => <a href={href} className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer">{children}</a>,
                        h1: ({children}) => <h1 className="text-base font-bold mb-2">{children}</h1>,
                        h2: ({children}) => <h2 className="text-sm font-bold mb-2">{children}</h2>,
                        h3: ({children}) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                        blockquote: ({children}) => <blockquote className={`border-l-2 ${isClient ? 'border-gray-400' : 'border-white/40'} pl-2 my-2 italic`}>{children}</blockquote>
                      }}
                    >
                      {msg.message}
                    </ReactMarkdown>
                  ) : (
                    msg.message
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
        <div className="bg-white px-6 py-4 flex items-center justify-center" style={{
          borderTop: '1px solid #E8EBED',
          boxShadow: '0 -1px 3px rgba(0, 0, 0, 0.02)'
        }}>
          <div className="text-center py-2">
            <p className="text-sm font-medium text-gray-500">Ya no puedes enviar mensajes a este grupo</p>
          </div>
        </div>
      ) : (
        <div className="bg-white px-6 py-4 flex gap-3 relative" style={{
          borderTop: '1px solid #E8EBED',
          boxShadow: '0 -1px 3px rgba(0, 0, 0, 0.02)'
        }}>
          {/* Botón de adjuntar archivos */}
          <div className="relative" ref={attachMenuRef}>
            <button
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              disabled={sendingMedia}
              className="w-12 h-12 rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
              style={{
                background: showAttachMenu ? '#FD6144' : '#F3F4F6',
                color: showAttachMenu ? 'white' : '#6B7280'
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

                  <button
                    onClick={handleStickerClick}
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Enviar sticker</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowAttachMenu(false);
                      setShowLocationModal(true);
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Enviar ubicación</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowAttachMenu(false);
                      setShowContactModal(true);
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span>Compartir contacto</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-2">
            {/* Barra de respuesta/edición */}
            {(quotedMessage || editingMessage) && (
              <div className="px-4 py-2 rounded-xl flex items-center justify-between" style={{
                background: 'rgba(253, 97, 68, 0.1)',
                border: '1px solid rgba(253, 97, 68, 0.2)'
              }}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#FD6144] mb-1">
                    {editingMessage ? 'Editando mensaje' : 'Respondiendo a:'}
                  </p>
                  <p className="text-xs text-gray-600 truncate">
                    {(quotedMessage || editingMessage)?.message || '[Mensaje sin texto]'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (editingMessage) cancelEdit();
                    else cancelReply();
                  }}
                  className="ml-2 w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-200 transition-all"
                >
                  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Barra de formateo */}
            <div className="flex items-center gap-2">
              {/* Botón de formato */}
              <div className="relative" ref={formatMenuRef}>
                <button
                  onClick={() => setShowFormatMenu(!showFormatMenu)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
                  style={{
                    background: showFormatMenu ? '#FD6144' : '#F3F4F6',
                    color: showFormatMenu ? 'white' : '#6B7280'
                  }}
                  title="Formatear texto"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </button>

                {/* Menú de formato */}
                {showFormatMenu && (
                  <div className="absolute bottom-12 left-0 w-48 rounded-xl shadow-lg z-50" style={{
                    background: 'white',
                    border: '1px solid #E8EBED',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                  }}>
                    <div className="py-2">
                      <button
                        onClick={() => applyFormat('bold')}
                        className="w-full text-left px-4 py-2 text-sm flex items-center gap-3 hover:bg-gray-100"
                      >
                        <span className="font-bold">B</span>
                        <span>Negrita</span>
                      </button>
                      <button
                        onClick={() => applyFormat('italic')}
                        className="w-full text-left px-4 py-2 text-sm flex items-center gap-3 hover:bg-gray-100"
                      >
                        <span className="italic">I</span>
                        <span>Cursiva</span>
                      </button>
                      <button
                        onClick={() => applyFormat('strikethrough')}
                        className="w-full text-left px-4 py-2 text-sm flex items-center gap-3 hover:bg-gray-100"
                      >
                        <span className="line-through">S</span>
                        <span>Tachado</span>
                      </button>
                      <button
                        onClick={() => applyFormat('monospace')}
                        className="w-full text-left px-4 py-2 text-sm flex items-center gap-3 hover:bg-gray-100"
                      >
                        <span className="font-mono">{`</>`}</span>
                        <span>Monospace</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Textarea con soporte de menciones */}
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={handleMessageChange}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !showMentionMenu) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  onFocus={() => updatePresence('composing')}
                  onBlur={() => updatePresence('paused')}
                  placeholder={contact?.isGroup ? "Escribe un mensaje... (usa @ para mencionar)" : "Escribe un mensaje... (Shift+Enter para nueva línea)"}
                  disabled={sending || sendingMedia}
                  rows={1}
                  className="w-full px-4 py-3 rounded-xl focus:outline-none text-sm transition-all disabled:opacity-50 resize-none"
                  style={{
                    background: '#F3F4F6',
                    border: '1px solid transparent',
                    minHeight: '48px',
                    maxHeight: '120px'
                  }}
                  onInput={(e) => {
                    // Auto-resize
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                />

                {/* Menú de menciones */}
                {showMentionMenu && filteredParticipants.length > 0 && (
                  <div
                    ref={mentionMenuRef}
                    className="absolute bottom-full left-0 mb-2 w-64 max-h-48 overflow-y-auto rounded-xl shadow-lg z-50"
                    style={{
                      background: 'white',
                      border: '1px solid #E8EBED',
                      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    <div className="py-1">
                      {filteredParticipants.map((participant) => (
                        <button
                          key={participant.jid}
                          onClick={() => selectMention(participant)}
                          className="w-full text-left px-4 py-2 text-sm flex items-center gap-3 hover:bg-gray-100 transition-all"
                          style={{ color: '#6B7280' }}
                        >
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{
                            background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)'
                          }}>
                            {participant.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{participant.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleSend}
            disabled={sending || sendingMedia || !message.trim()}
            className="px-6 py-3 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: '#FD6144'
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
            {sending ? '...' : sendingMedia ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
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

      {/* Modal de ubicación */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-3 text-gray-800">
              Enviar Ubicación
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Ingresa las coordenadas de la ubicación que deseas compartir
            </p>
            <div className="space-y-3 mb-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={locationData.latitude}
                  onChange={(e) => setLocationData({...locationData, latitude: e.target.value})}
                  placeholder="Latitud (ej: 19.4326)"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm"
                />
                <input
                  type="text"
                  value={locationData.longitude}
                  onChange={(e) => setLocationData({...locationData, longitude: e.target.value})}
                  placeholder="Longitud (ej: -99.1332)"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm"
                />
              </div>
              <input
                type="text"
                value={locationData.name}
                onChange={(e) => setLocationData({...locationData, name: e.target.value})}
                placeholder="Nombre del lugar (opcional)"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm"
              />
              <input
                type="text"
                value={locationData.address}
                onChange={(e) => setLocationData({...locationData, address: e.target.value})}
                placeholder="Dirección (opcional)"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm"
              />
            </div>
            <button
              onClick={useCurrentLocation}
              className="w-full px-4 py-2 mb-4 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'rgba(253, 97, 68, 0.1)',
                color: '#FD6144'
              }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(253, 97, 68, 0.2)'}
              onMouseLeave={(e) => e.target.style.background = 'rgba(253, 97, 68, 0.1)'}
            >
              📍 Usar mi ubicación actual
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLocationModal(false);
                  setLocationData({ latitude: '', longitude: '', name: '', address: '' });
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
                onClick={handleSendLocation}
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

      {/* Modal de contacto */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-3 text-gray-800">
              Compartir Contacto
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Ingresa los datos del contacto que deseas compartir
            </p>
            <div className="space-y-3 mb-6">
              <input
                type="text"
                value={contactData.name}
                onChange={(e) => setContactData({...contactData, name: e.target.value})}
                placeholder="Nombre del contacto"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm"
                autoFocus
              />
              <input
                type="text"
                value={contactData.number}
                onChange={(e) => setContactData({...contactData, number: e.target.value})}
                placeholder="Número de teléfono (con código de país, ej: +521234567890)"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#FD6144] text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowContactModal(false);
                  setContactData({ name: '', number: '' });
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
                onClick={handleSendContact}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: '#FD6144' }}
                onMouseEnter={(e) => e.target.style.background = '#FD3244'}
                onMouseLeave={(e) => e.target.style.background = '#FD6144'}
              >
                Compartir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatPanel;