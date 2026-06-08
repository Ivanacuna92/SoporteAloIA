import React, { useState, useEffect, useRef } from 'react';
import { io as socketIO } from 'socket.io-client';
import { sendMyMessage, sendMyImage, sendMyDocument, sendMyAudio, sendMyVideo, forwardMyMessage, deleteMyMessage, editMyMessage, toggleHumanMode, endConversation, deleteConversation, leaveGroup, sendMessageAdvanced, getGroupParticipants, getMyContacts, getMessageReceipts, sendSticker, saveStickerFavorite, getStickerFavorites, deleteStickerFavorite, sendStickerFromUrl, getMuteStates, toggleMute, archiveContact } from '../services/api';
// Paleta de colores para participantes en grupos (light / dark)
const PARTICIPANT_COLORS_LIGHT = [
  '#00A19C', '#E67E22', '#8E44AD', '#2980B9', '#D35400', '#1ABC9C',
  '#C0392B', '#2C3E50', '#F39C12', '#16A085', '#7D3C98', '#2471A3',
];
const PARTICIPANT_COLORS_DARK = [
  '#5CE0DB', '#F5A623', '#C39BD3', '#5DADE2', '#F0803C', '#76D7C4',
  '#F1948A', '#85C1E9', '#F7DC6F', '#73C6B6', '#BB8FCE', '#7FB3D8',
];
const PARTICIPANT_COLORS = PARTICIPANT_COLORS_LIGHT;


// Equipo AloIA - LIDs, números de teléfono y nombres
const VIP_IDS = new Set([
  '123428921188585@lid', '5218118650283@s.whatsapp.net',  // Ivan Acuña
  '138770661814487@lid', '5215532220893@s.whatsapp.net',  // Luis Martinez - Aloia
  '46034080235640@lid', '5217711757809@s.whatsapp.net',   // Max
  '271588113051833@lid',                                   // Uli
  '81935242121386@lid', '239711385850062@lid',             // Erick (ambos LIDs)
  '231911171604702@lid',                                   // Juan Carlos
]);
const VIP_PHONES = ['8118650283', '5532220893', '7711956440', '7711757809', '7714144641'];
const VIP_NAMES = new Set(['Ivan Acuña', 'Luis Martinez - Aloia', 'Max', 'Uli', 'Erick', 'Juan Carlos']);
const ALOIA_AVATAR_URL = '/alo.png';

function isVipParticipant(participant, userName) {
  if (participant && VIP_IDS.has(participant)) return true;
  if (userName && VIP_NAMES.has(userName)) return true;
  if (!participant) return false;
  const clean = participant.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');
  return VIP_PHONES.some(num => clean.includes(num));
}

const participantColorCache = {};

function getParticipantColorIndex(name) {
  if (!name) return 0;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % PARTICIPANT_COLORS_LIGHT.length;
}

function getParticipantColor(name, isDark) {
  const palette = isDark ? PARTICIPANT_COLORS_DARK : PARTICIPANT_COLORS_LIGHT;
  const index = getParticipantColorIndex(name);
  return palette[index];
}



// Resolver menciones @numero/@lid a nombres reales
function resolveMentionText(text, messages, participants) {
  if (!text) return text;
  return text.replace(/@(\d{5,})(?:@(?:lid|s\.whatsapp\.net))?/g, (match, id) => {
    if (participants && participants.length > 0) {
      const participant = participants.find(p => {
        const cleanId = p.id.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');
        return cleanId === id || p.id.includes(id);
      });
      if (participant && participant.name) return `@${participant.name}`;
    }
    if (messages) {
      const found = messages.find(m => {
        if (!m.participant) return false;
        const cleanP = m.participant.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');
        return cleanP === id || m.participant.includes(id);
      });
      if (found && (found.userName || found.pushName)) return `@${found.userName || found.pushName}`;
    }
    return match;
  });
}

function resolveMentions(text, messages, participants, isOwnBubble) {
  if (!text) return text;
  const resolved = resolveMentionText(text, messages, participants);
  // Formatear markdown estilo WhatsApp y menciones
  return formatWhatsAppText(resolved, isOwnBubble);
}

// Formatear texto con markdown estilo WhatsApp: *bold*, _italic_, ~strikethrough~, ```monospace```, y menciones
function formatWhatsAppText(text, isOwnBubble) {
  if (!text) return text;

  // Partir por bloques de código primero (```)
  const codeBlocks = text.split(/(```[\s\S]*?```)/g);

  const result = codeBlocks.map((block, blockIdx) => {
    if (block.startsWith('```') && block.endsWith('```')) {
      const code = block.slice(3, -3);
      return (
        <code key={`cb${blockIdx}`} style={{
          backgroundColor: isOwnBubble ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)',
          borderRadius: '4px',
          padding: '2px 5px',
          fontFamily: 'monospace',
          fontSize: '0.85em'
        }}>{code}</code>
      );
    }

    // Procesar inline: URLs, *bold*, _italic_, ~strike~, `mono`, @menciones
    const regex = /(https?:\/\/[^\s]+|\*[^*]+\*|_[^_]+_|~[^~]+~|`[^`]+`|@\S+)/g;
    const parts = block.split(regex);

    return parts.map((part, i) => {
      const key = `${blockIdx}-${i}`;
      // URL
      if (/^https?:\/\//.test(part)) {
        return (
          <a key={key} href={part} target="_blank" rel="noopener noreferrer" style={{
            color: 'var(--brand-primary)',
            textDecoration: 'underline',
            wordBreak: 'break-all'
          }}>{part}</a>
        );
      }
      // Bold
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return <strong key={key}>{part.slice(1, -1)}</strong>;
      }
      // Italic
      if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      // Strikethrough
      if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
        return <s key={key}>{part.slice(1, -1)}</s>;
      }
      // Inline code
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={key} style={{
            backgroundColor: isOwnBubble ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)',
            borderRadius: '3px',
            padding: '1px 4px',
            fontFamily: 'monospace',
            fontSize: '0.85em'
          }}>{part.slice(1, -1)}</code>
        );
      }
      // Mención
      if (part.startsWith('@') && part.length > 1) {
        return (
          <span key={key} style={{
            color: 'var(--brand-primary)',
            fontWeight: 600
          }}>{part}</span>
        );
      }
      return part;
    });
  });

  return result;
}

// Etiqueta de fecha estilo WhatsApp
function getDateLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (isSameDay(date, today)) return 'Hoy';
  if (isSameDay(date, yesterday)) return 'Ayer';
  const diffDays = Math.floor((today - date) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return date.toLocaleDateString('es-ES', { weekday: 'long' }).replace(/^\w/, c => c.toUpperCase());
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}
function isDifferentDay(ts1, ts2) {
  if (!ts1 || !ts2) return true;
  const d1 = new Date(ts1), d2 = new Date(ts2);
  return d1.getFullYear() !== d2.getFullYear() || d1.getMonth() !== d2.getMonth() || d1.getDate() !== d2.getDate();
}

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
      <div className={`flex items-center gap-2 p-2 rounded-xl ${isClient ? 'bg-black/5 dark:bg-white/5' : 'bg-black/5 dark:bg-white/5'}`} style={{ minWidth: '200px' }}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isClient ? 'bg-black/10 dark:bg-white/10' : 'bg-black/10 dark:bg-white/10'}`}>
          <svg className="w-5 h-5 opacity-50" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" clipRule="evenodd"/>
          </svg>
        </div>
        <span className="text-xs opacity-70">Audio no disponible</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 p-2 rounded-xl ${isClient ? 'bg-black/5 dark:bg-white/5' : 'bg-black/5 dark:bg-white/5'}`} style={{ minWidth: '220px' }}>
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
          className={`h-1.5 rounded-full cursor-pointer ${isClient ? 'bg-black/10 dark:bg-white/10' : 'bg-black/10 dark:bg-white/10'}`}
          onClick={handleSeek}
        >
          <div
            className={`h-full rounded-full transition-all ${isClient ? 'bg-navetec-primary' : 'bg-[var(--brand-primary)]'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className={`flex justify-between text-xs mt-1 ${isClient ? 'text-gray-500 dark:text-gray-400' : 'text-[var(--msg-own-secondary)]'}`}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// Normaliza texto que está en puras mayúsculas a formato oración
function normalizeUppercase(text) {
  if (!text || typeof text !== 'string') return text;
  const letters = text.replace(/[^a-záéíóúñA-ZÁÉÍÓÚÑ]/g, '');
  if (letters.length <= 3) return text;
  if (letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return text.toLowerCase().replace(/(^|\.\s*|!\s*|\?\s*)([a-záéíóúñ])/g, (match, sep, char) => sep + char.toUpperCase()) + ' 🥹';
  }
  return text;
}

const INITIAL_MESSAGES = 50;

function ChatPanel({ contact, onUpdateContact, onClose }) {
  const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains('dark'));

  // Escuchar cambios de tema
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const [message, setMessage] = useState('');
  const msgPhone = contact?.phone;
  const allMessages = React.useMemo(() => contact?.messages?.slice().reverse() || [], [contact?.messages, msgPhone]);
  const [visibleCount, setVisibleCount] = useState(INITIAL_MESSAGES);
  const reversedMessages = React.useMemo(() => allMessages.slice(-visibleCount), [allMessages, visibleCount]);
  const hasMore = allMessages.length > visibleCount;

  // Reset visible count cuando cambia de contacto
  useEffect(() => { setVisibleCount(INITIAL_MESSAGES); }, [msgPhone]);

  const [sending, setSending] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [endingConversation, setEndingConversation] = useState(false);
  const [supportHandledContacts, setSupportHandledContacts] = useState(new Set());
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [togglingMute, setTogglingMute] = useState(false);
  const [contactInfoModal, setContactInfoModal] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLeaveGroupModal, setShowLeaveGroupModal] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [archivingContact, setArchivingContact] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [messageMenuOpen, setMessageMenuOpen] = useState(null); // ID del mensaje con menú abierto
  const [menuClosing, setMenuClosing] = useState(null); // ID del menú que se está cerrando
  const longPressTimer = useRef(null);

  const closeMessageMenu = (callback) => {
    setMenuClosing(messageMenuOpen);
    setTimeout(() => {
      setMessageMenuOpen(null);
      setMenuClosing(null);
      if (callback) callback();
    }, 150);
  };
  const [showCaptionModal, setShowCaptionModal] = useState(false);
  const [captionData, setCaptionData] = useState({ file: null, type: null, caption: '' });
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [receiptModal, setReceiptModal] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [showStickerCollection, setShowStickerCollection] = useState(false);
  const [stickerFavorites, setStickerFavorites] = useState([]);
  const [stickerFavoritesLoading, setStickerFavoritesLoading] = useState(false);
  const [sendingStickerFav, setSendingStickerFav] = useState(null);
  const [reactionPicker, setReactionPicker] = useState(null); // messageId del picker abierto
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const [messageReactions, setMessageReactions] = useState({}); // { messageId: [{ emoji, participant }] }
  const [emojiModal, setEmojiModal] = useState(null); // msg para el modal de emoji personalizado
  const [emojiInput, setEmojiInput] = useState('');
  const emojiInputRef = useRef(null);

  const handleReaction = async (emoji, msg) => {
    console.log('🔥 handleReaction llamado:', emoji, 'msgId:', msg.messageId, 'type:', msg.type, 'participant:', msg.participant);
    try {
      const key = { remoteJid: `${contact.phone}@g.us`, id: msg.messageId, fromMe: msg.type !== 'received' };
      if (msg.participant) key.participant = msg.participant;
      console.log('🔥 Enviando reacción con key:', JSON.stringify(key));
      await sendMessageAdvanced(contact.phone, '', { reaction: { text: emoji, key } });
      console.log('✅ Reacción enviada OK');
    } catch (e) {
      console.error('❌ Error reaccionando:', e.message);
    }
    setReactionPicker(null);
    setMessageMenuOpen(null);
  };

  const handleReceiptClick = async (messageId) => {
    if (!messageId || receiptLoading || !contact?.isGroup) return;
    setReceiptLoading(true);
    try {
      const data = await getMessageReceipts(messageId);
      setReceiptModal(data);
    } catch (err) {
      console.log('Error loading receipts:', err.message);
    }
    setReceiptLoading(false);
  };
  // Funciones de stickers favoritos
  const loadStickerFavorites = async () => {
    setStickerFavoritesLoading(true);
    try {
      const data = await getStickerFavorites();
      setStickerFavorites(data.stickers || []);
    } catch (err) {
      console.log('Error loading sticker favorites:', err.message);
    }
    setStickerFavoritesLoading(false);
  };

  const handleSaveStickerFavorite = async (stickerUrl) => {
    try {
      await saveStickerFavorite(stickerUrl);
    } catch (err) {
      if (err.message.includes('ya está')) {
        setErrorMessage('Este sticker ya está en tus favoritos');
      } else {
        setErrorMessage('Error guardando sticker: ' + err.message);
      }
      setShowErrorModal(true);
    }
  };

  const handleDeleteStickerFavorite = async (id) => {
    try {
      await deleteStickerFavorite(id);
      setStickerFavorites(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      setErrorMessage('Error eliminando sticker: ' + err.message);
      setShowErrorModal(true);
    }
  };

  const handleSendStickerFavorite = async (stickerUrl) => {
    if (!contact || sendingStickerFav) return;
    setSendingStickerFav(stickerUrl);
    try {
      await sendStickerFromUrl(contact.phone, stickerUrl);
      setShowStickerCollection(false);
    } catch (err) {
      setErrorMessage('Error enviando sticker: ' + err.message);
      setShowErrorModal(true);
    }
    setSendingStickerFav(null);
  };

  const openStickerCollection = () => {
    setShowStickerCollection(true);
    loadStickerFavorites();
  };

  const [forwardData, setForwardData] = useState({ messageKey: null, targetPhone: '' });
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [quotedMessage, setQuotedMessage] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [groupParticipants, setGroupParticipants] = useState([]);
  const [pendingMentions, setPendingMentions] = useState([]); // JIDs de personas mencionadas
  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const optionsMenuRef = useRef(null);
  const attachMenuRef = useRef(null);
  const attachBtnRef = useRef(null);
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

  // Cargar participantes del grupo para menciones
  useEffect(() => {
    if (contact?.isGroup && contact?.phone) {
      getGroupParticipants(contact.phone)
        .then(participants => setGroupParticipants(participants))
        .catch(err => console.log('No se pudieron cargar participantes:', err.message));
    } else {
      setGroupParticipants([]);
    }
  }, [contact?.phone, contact?.isGroup]);

  // Cargar estado de silenciamiento del contacto actual
  useEffect(() => {
    if (!contact?.phone) { setIsMuted(false); return; }
    getMuteStates()
      .then(states => setIsMuted(!!states[contact.phone]))
      .catch(() => setIsMuted(false));
  }, [contact?.phone]);

  const handleToggleMute = async () => {
    if (!contact?.phone || togglingMute) return;
    const next = !isMuted;
    setTogglingMute(true);
    setIsMuted(next);
    try {
      await toggleMute(contact.phone, next);
      window.dispatchEvent(new Event('mute-changed'));
    } catch (e) {
      setIsMuted(!next);
    } finally {
      setTogglingMute(false);
    }
  };

  const cleanJidToPhone = (jid) => {
    if (!jid) return null;
    if (jid.endsWith('@s.whatsapp.net')) return jid.replace('@s.whatsapp.net', '');
    if (jid.endsWith('@g.us')) return jid.replace('@g.us', '');
    if (jid.endsWith('@lid')) return null; // LID interno, no es teléfono
    return jid;
  };

  const openMemberInfo = (msg) => {
    if (!msg) return;
    const participant = msg.participant || null;
    // 1) Si el propio mensaje ya trae el teléfono real (participantPn), usarlo
    let phone = cleanJidToPhone(msg.participantPn) || cleanJidToPhone(participant);
    // 2) Resolver lid→teléfono vía groupParticipants (p.phone viene de groupMetadata.jid)
    if (!phone && participant && groupParticipants?.length) {
      const match = groupParticipants.find(p => p.id === participant || p.lid === participant);
      if (match) phone = match.phone || cleanJidToPhone(match.id);
    }
    setContactInfoModal({
      name: msg.userName || 'Usuario',
      phone: phone || null,
      rawId: participant || null,
      isGroupMember: true
    });
  };

  const openContactInfo = () => {
    if (!contact) return;
    setContactInfoModal({
      name: contact.isGroup ? (contact.groupName || contact.phone) : contact.phone,
      phone: contact.isGroup ? null : contact.phone,
      rawId: contact.phone,
      isGroupMember: false,
      isGroup: contact.isGroup
    });
  };

  // Cerrar menú al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(event.target)) {
        setShowOptionsMenu(false);
      }
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target) &&
          attachBtnRef.current && !attachBtnRef.current.contains(event.target)) {
        setShowAttachMenu(false);
      }
      // El cierre del messageMenu se maneja en el onClick del scroll container
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll automático cuando se abre menú de acciones para que no se corte
  useEffect(() => {
    if (messageMenuOpen !== null) {
      setTimeout(() => {
        const capsules = document.querySelector('[data-menu-capsules]');
        if (capsules) {
          capsules.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);
    }
  }, [messageMenuOpen]);

  // Cargar reacciones persistidas al cambiar de contacto
  useEffect(() => {
    if (!contact?.phone) return;
    const loadReactions = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/my-contacts/${contact.phone}/reactions`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setMessageReactions(data);
        }
      } catch (e) {
        console.log('Error cargando reacciones:', e.message);
      }
    };
    loadReactions();
  }, [contact?.phone]);

  // Escuchar reacciones en tiempo real
  useEffect(() => {
    if (!contact?.phone) return;
    let socket;
    try {
      socket = socketIO({ reconnection: true, transports: ['polling'] });
      socket.on('reaction', (data) => {
        if (data.phone === contact?.phone) {
          setMessageReactions(prev => {
            const existing = prev[data.messageId] || [];
            // Si es emoji vacío, es quitar reacción
            if (!data.emoji) {
              return { ...prev, [data.messageId]: existing.filter(r => r.participant !== data.participant) };
            }
            // Actualizar o agregar
            const filtered = existing.filter(r => r.participant !== data.participant);
            return { ...prev, [data.messageId]: [...filtered, { emoji: data.emoji, participant: data.participant }] };
          });
        }
      });
    } catch (e) {}
    return () => { if (socket) socket.disconnect(); };
  }, [contact?.phone]);

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

  // Participantes filtrados para el dropdown de menciones
  const filteredParticipants = groupParticipants.filter(p => {
    if (!mentionSearch) return true;
    const name = (p.name || '').toLowerCase();
    const phone = p.id.split('@')[0];
    return name.includes(mentionSearch) || phone.includes(mentionSearch);
  }).slice(0, 15);

  // Insertar mención en el textarea
  const insertMention = (participant) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = message.substring(0, cursorPos);
    const textAfter = message.substring(cursorPos);

    // Encontrar dónde empieza el @ actual
    const mentionStart = textBefore.lastIndexOf('@');
    const displayName = participant.name || participant.id.split('@')[0];
    const newText = textBefore.substring(0, mentionStart) + `@${displayName} ` + textAfter;

    setMessage(newText);
    setShowMentions(false);

    // Agregar JID a las menciones pendientes
    if (!pendingMentions.includes(participant.id)) {
      setPendingMentions(prev => [...prev, participant.id]);
    }

    // Restaurar foco en el textarea
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = mentionStart + displayName.length + 2; // +2 por @ y espacio
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleSend = async () => {
    if (!message.trim() || !contact || sending) return;

    setSending(true);
    try {
      // Editar mensaje existente
      if (editingMessage) {
        const messageKey = {
          remoteJid: `${contact.phone}@g.us`,
          id: editingMessage.messageId,
          fromMe: true
        };
        await editMyMessage(messageKey, message);
        // Actualizar localmente
        if (onUpdateContact) {
          const updatedMessages = contact.messages.map(m =>
            m.messageId === editingMessage.messageId ? { ...m, message, isEdited: true } : m
          );
          onUpdateContact({ ...contact, messages: updatedMessages });
        }
        setEditingMessage(null);
        setMessage('');
        setSending(false);
        return;
      }

      const hasMentions = pendingMentions.length > 0;
      const hasQuote = !!quotedMessage;

      if (hasQuote || hasMentions) {
        const options = {};
        if (hasQuote) {
          options.quotedMessageId = quotedMessage.messageId;
          options.quotedRemoteJid = `${contact.phone}@g.us`;
          options.quotedParticipant = quotedMessage.participant;
        }
        if (hasMentions) {
          options.mentions = pendingMentions;
        }

        await sendMessageAdvanced(contact.phone, message, options);
        setQuotedMessage(null);
        setPendingMentions([]);
      } else {
        await sendMyMessage(contact.phone, message);
      }

      setMessage('');

      // Resetear altura del textarea después de enviar
      setTimeout(() => {
        const textarea = document.querySelector('textarea[placeholder*="Ctrl+Enter"]');
        if (textarea) {
          textarea.style.height = '44px';
        }
      }, 0);

      // El mensaje aparecerá automáticamente cuando el servidor actualice los contactos (cada 5 segundos)
      // No es necesario agregarlo manualmente aquí para evitar duplicación
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
      // Para audio y sticker, enviar directamente
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
      } else if (type === 'sticker') {
        await sendSticker(contact.phone, file);
      }

      // El mensaje con archivo aparecerá automáticamente cuando el servidor actualice los contactos
      // No agregarlo manualmente para evitar duplicación

      // Enviado - no mostrar modal, el mensaje aparecerá en el chat
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
    } else if (type === 'sticker') {
      input.accept = 'image/webp,image/png';
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
      // Actualizar localmente - quitar el mensaje de la vista
      if (contact && onUpdateContact) {
        const updatedMessages = contact.messages.map(m =>
          m.messageId === messageKey.id
            ? { ...m, message: 'Se elimino este mensaje', hasMedia: false, mediaUrl: null, mediaType: null, hasQuotedMsg: false, quotedMsg: null }
            : m
        );
        onUpdateContact({ ...contact, messages: updatedMessages });
      }
    } catch (error) {
      setErrorMessage('Error eliminando mensaje: ' + error.message);
      setShowErrorModal(true);
    }
  };

  const [forwardContacts, setForwardContacts] = useState([]);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardSelected, setForwardSelected] = useState([]);
  const [forwardNote, setForwardNote] = useState('');
  const [forwardSending, setForwardSending] = useState(false);
  const [forwardOrigMsg, setForwardOrigMsg] = useState(null);

  const handleForwardMessage = async (messageKey, msg) => {
    setForwardData({ messageKey, targetPhone: '' });
    setForwardSearch('');
    setForwardSelected([]);
    setForwardNote('');
    setForwardOrigMsg(msg || null);
    setShowForwardModal(true);
    try {
      const contacts = await getMyContacts();
      setForwardContacts(contacts.filter(c => c.phone !== contact?.phone));
    } catch (e) {
      setForwardContacts([]);
    }
  };

  const toggleForwardSelect = (phone) => {
    setForwardSelected(prev =>
      prev.includes(phone) ? prev.filter(p => p !== phone) : [...prev, phone]
    );
  };

  const confirmForwardMessage = async () => {
    if (forwardSelected.length === 0) return;
    setForwardSending(true);
    try {
      for (const phone of forwardSelected) {
        if (forwardNote.trim()) {
          await sendMyMessage(phone, forwardNote.trim());
        }
        await forwardMyMessage(phone, forwardData.messageKey);
      }
      setShowForwardModal(false);
      setSuccessMessage(`Reenviado a ${forwardSelected.length} grupo(s)`);
      setShowSuccessModal(true);
    } catch (error) {
      setShowForwardModal(false);
      setErrorMessage('Error reenviando: ' + error.message);
      setShowErrorModal(true);
    } finally {
      setForwardSending(false);
    }
  };

  const handleReplyMessage = (msg) => {
    console.log('🔍 DEBUG handleReplyMessage - msg:', msg);
    console.log('🔍 messageId:', msg.messageId);
    console.log('🔍 participant:', msg.participant);
    console.log('🔍 sender:', msg.sender);

    setMessageMenuOpen(null);
    setQuotedMessage({
      messageId: msg.messageId,
      message: msg.message,
      userName: msg.userName,
      participant: msg.participant || msg.sender
    });

    console.log('✅ QuotedMessage set:', {
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

      // El mensaje de sistema aparecerá automáticamente cuando el servidor actualice los contactos
      // No agregarlo manualmente para evitar duplicación

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
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center" style={{ padding: '40px' }}>
          <div
            className="mx-auto flex items-center justify-center"
            style={{
              width: 72,
              height: 72,
              borderRadius: 22,
              background: 'var(--bg-active)',
              border: '1px solid var(--border-active)',
              marginBottom: 18,
            }}
          >
            <i className="ti ti-messages" style={{ fontSize: 32, color: 'var(--accent)' }} />
          </div>
          <h3 style={{
            fontFamily: 'Sora, sans-serif',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.2px',
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}>
            Selecciona una conversación
          </h3>
          <p style={{
            fontFamily: 'Sora, sans-serif',
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}>
            Elige un grupo o contacto de la lista para comenzar
          </p>
        </div>
      </div>
    );
  }


  // Solo hay modo humano y soporte (sin IA)
  const isSupport = contact.mode === 'support';
  const modeColor = isSupport ? 'var(--brand-primary)' : '#3B82F6';
  const modeLabel = isSupport ? 'Soporte' : 'Humano';

  return (
    <div className="flex-1 flex flex-col max-w-full relative overflow-hidden">
      {/* Header con blur - absolute encima del scroll */}
      <div className="absolute top-0 left-0 right-0 px-3 md:px-6 py-3 md:py-4 flex items-center justify-between" style={{
        background: isDarkMode ? 'rgba(11, 20, 26, 0.45)' : 'rgba(255, 255, 255, 0.4)',
        backdropFilter: 'blur(24px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
        zIndex: 20
      }}>
        <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
          {/* Botón atrás para móviles */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-all flex-shrink-0"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#E5E7EB';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'var(--bg-tertiary)';
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="relative flex-shrink-0">
            {contact.isGroup && contact.groupPicture ? (
              <img
                src={contact.groupPicture}
                alt={contact.groupName || 'Grupo'}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 13,
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
              className="flex items-center justify-center"
              style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                background: contact.leftGroup
                  ? 'rgba(107,114,128,0.18)'
                  : 'var(--bg-active)',
                color: contact.leftGroup ? 'var(--text-tertiary)' : 'var(--accent)',
                opacity: contact.leftGroup ? 0.6 : 1,
                display: contact.isGroup && contact.groupPicture ? 'none' : 'flex',
              }}
            >
              {contact.isGroup ? (
                <i className="ti ti-users-group" style={{ fontSize: 20 }} />
              ) : isSupport ? (
                <i className="ti ti-headset" style={{ fontSize: 20 }} />
              ) : (
                <span style={{ fontSize: 14, fontWeight: 700 }}>{contact.phone.slice(-2)}</span>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={openContactInfo} title="Ver información del contacto">
            <div style={{
              fontFamily: 'Sora, sans-serif',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '-0.2px',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {contact.isGroup ? (contact.groupName || contact.phone) : contact.phone}
            </div>
            <div style={{
              fontFamily: 'Sora, sans-serif',
              fontSize: 12,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 2,
            }}>
              {!contact.leftGroup && (
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: isSupport ? modeColor : '#22c55e',
                  flexShrink: 0,
                }} />
              )}
              {contact.leftGroup ? 'Ya no eres miembro' : `${contact.messages?.length || 0} mensajes`}
            </div>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          {/* Botón de silenciar/desilenciar */}
          <button
            onClick={handleToggleMute}
            disabled={togglingMute}
            title={isMuted ? 'Quitar silencio' : 'Silenciar notificaciones'}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
            style={{
              background: isMuted ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
              color: isMuted ? '#EF4444' : 'var(--text-secondary)',
              opacity: togglingMute ? 0.6 : 1,
              cursor: togglingMute ? 'wait' : 'pointer'
            }}
            onMouseEnter={(e) => {
              if (!isMuted) e.currentTarget.style.background = 'rgba(107, 114, 128, 0.1)';
            }}
            onMouseLeave={(e) => {
              if (!isMuted) e.currentTarget.style.background = 'transparent';
            }}
          >
            {isMuted ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341M15 17H9m6 0a3 3 0 01-6 0m0 0H4l1.405-1.405M3 3l18 18" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341M15 17H9m6 0a3 3 0 01-6 0m0 0H4l1.405-1.405A2.032 2.032 0 006 14.158V11a6.002 6.002 0 014-5.659V5" />
              </svg>
            )}
          </button>

          {/* Botón de archivar/desarchivar */}
          <button
            onClick={async () => {
              if (archivingContact) return;
              setArchivingContact(true);
              const nextArchived = !contact.isArchived;
              try {
                await archiveContact(contact.phone, nextArchived);
                onUpdateContact({ ...contact, isArchived: nextArchived });
              } catch (error) {
                setErrorMessage(
                  (nextArchived ? 'Error archivando: ' : 'Error desarchivando: ') + error.message
                );
                setShowErrorModal(true);
              } finally {
                setArchivingContact(false);
              }
            }}
            disabled={archivingContact}
            title={contact.isArchived
              ? (contact.isGroup ? 'Desarchivar grupo' : 'Desarchivar conversación')
              : (contact.isGroup ? 'Archivar grupo' : 'Archivar conversación')}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
            style={{
              background: contact.isArchived ? 'rgba(253, 97, 68, 0.1)' : 'transparent',
              color: contact.isArchived ? 'var(--brand-primary)' : 'var(--text-secondary)',
              opacity: archivingContact ? 0.6 : 1,
              cursor: archivingContact ? 'wait' : 'pointer'
            }}
            onMouseEnter={(e) => {
              if (!contact.isArchived) e.currentTarget.style.background = 'rgba(107, 114, 128, 0.1)';
            }}
            onMouseLeave={(e) => {
              if (!contact.isArchived) e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </button>

          {/* Botón de menú de opciones (3 puntos) */}
          <div className="relative" ref={optionsMenuRef}>
            <button
              onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
              style={{
                background: showOptionsMenu ? 'rgba(92, 25, 227, 0.1)' : 'transparent',
                color: showOptionsMenu ? 'var(--brand-primary)' : 'var(--text-secondary)'
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
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                boxShadow: '0 10px 25px var(--shadow-md)'
              }}>
                <div className="py-1">
                  <button
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowDeleteModal(true);
                    }}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-all"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'var(--bg-tertiary)';
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

                  <button
                    onClick={async () => {
                      if (archivingContact) return;
                      setShowOptionsMenu(false);
                      setArchivingContact(true);
                      const nextArchived = !contact.isArchived;
                      try {
                        await archiveContact(contact.phone, nextArchived);
                        onUpdateContact({ ...contact, isArchived: nextArchived });
                      } catch (error) {
                        setErrorMessage(
                          (nextArchived ? 'Error archivando: ' : 'Error desarchivando: ') + error.message
                        );
                        setShowErrorModal(true);
                      } finally {
                        setArchivingContact(false);
                      }
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                    <span>
                      {contact.isArchived
                        ? (contact.isGroup ? 'Desarchivar grupo' : 'Desarchivar conversación')
                        : (contact.isGroup ? 'Archivar grupo' : 'Archivar conversación')}
                    </span>
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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-6 pb-3 md:pb-6 space-y-2 md:space-y-3" style={{
          paddingTop: '75px',
          background: isDarkMode ? '#0b141a' : '#edf7f6',
        }}
        onClick={(e) => {
          if (messageMenuOpen !== null && !e.target.closest('[data-menu-capsules]') && !e.target.closest('[data-msg-dots]')) {
            closeMessageMenu();
          }
        }}>
        {hasMore && (
          <div className="flex justify-center pt-2 pb-3">
            <button
              onClick={() => {
                const container = messagesContainerRef.current;
                const prevScrollHeight = container?.scrollHeight || 0;
                setVisibleCount(prev => prev + 50);
                requestAnimationFrame(() => {
                  if (container) {
                    const newScrollHeight = container.scrollHeight;
                    container.scrollTop = newScrollHeight - prevScrollHeight;
                  }
                });
              }}
              className="flex items-center gap-2 text-xs px-5 py-2 rounded-full transition-all hover:scale-105 active:scale-95 shadow-md"
              style={{ background: isDarkMode ? '#1e3a3a' : '#00A19C', color: '#fff' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
              Cargar anteriores
            </button>
          </div>
        )}
        {reversedMessages.map((msg, index) => {
          const prevMsg = index > 0 ? reversedMessages[index - 1] : null;
          const showDateSep = isDifferentDay(prevMsg?.timestamp, msg.timestamp);
          const dateSeparator = showDateSep ? (
            <div className="flex justify-center my-3">
              <div className="px-3 py-1 rounded-lg text-[11px] font-medium shadow-sm" style={{
                backgroundColor: 'var(--bg-secondary, #e2e8f0)',
                color: 'var(--text-secondary, #64748b)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)'
              }}>{getDateLabel(msg.timestamp)}</div>
            </div>
          ) : null;

          const isClient = msg.type === 'USER' || msg.type === 'CLIENTE' || msg.role === 'cliente';
          const isBotOrSupport = msg.type === 'BOT' || msg.type === 'SOPORTE' || msg.role === 'bot' || msg.role === 'soporte';
          const isHumanOrBot = msg.type === 'HUMAN' || msg.type === 'BOT' || isBotOrSupport;
          const isSystem = msg.type === 'SYSTEM' || (msg.type === 'BOT' && msg.message?.includes('⏰') && msg.message?.includes('sesión'));

          // Determinar el color según el tipo de mensaje específico
          const isMessageFromSupport = msg.type === 'SOPORTE' || msg.role === 'soporte' || (msg.type === 'HUMAN' && contact.mode === 'support');
          const isMessageFromHuman = msg.type === 'HUMAN' && contact.mode !== 'support';

          if (isSystem) {
            return (
              <React.Fragment key={index}>{dateSeparator}
              <div className="flex justify-center my-4">
                <div className="bg-white dark:bg-slate-800 px-4 py-2.5 rounded-xl max-w-md text-center shadow-sm" style={{
                  border: '1px solid var(--border-primary)'
                }}>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold">
                      Sistema
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">•</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {new Date(msg.timestamp).toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                    {msg.message}
                  </div>
                </div>
              </div>
              </React.Fragment>
            );
          }

          const pName = msg.userName || msg.pushName || 'Usuario';
          const pColor = getParticipantColor(pName, isDarkMode);
          // Check if previous message is from same participant (to hide avatar)
          const sameSender = prevMsg && (prevMsg.userName || prevMsg.pushName || '') === (msg.userName || msg.pushName || '') && prevMsg.type === msg.type;

          return (
            <React.Fragment key={index}>
            {dateSeparator}
            <div
              className={`flex ${isClient ? 'justify-start' : 'justify-end'} group w-full max-w-full relative`}
            >
              {/* Avatar para mensajes de clientes */}
              {isClient && (
                <div className="flex-shrink-0 mr-2 self-start" style={{ width: '28px', marginTop: '2px' }}>
                  {!sameSender ? (
                    contact.isGroup && isVipParticipant(msg.participant, msg.userName) ? (
                      <img src={ALOIA_AVATAR_URL} alt="AloIA" className="w-7 h-7 rounded-full object-cover" style={{ backgroundColor: 'white' }} />
                    ) : msg.participantPic ? (
                      <img src={msg.participantPic} alt={pName} className="w-7 h-7 rounded-full object-cover" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                    ) : (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: pColor }}>
                        {pName.charAt(0).toUpperCase()}
                      </div>
                    )
                  ) : <div className="w-7 h-7" />}
                  {/* Fallback oculto para cuando la img falla */}
                  {!sameSender && msg.participantPic && (
                    <div className="w-7 h-7 rounded-full items-center justify-center text-white text-xs font-bold" style={{ background: pColor, display: 'none' }}>
                      {pName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              )}
              {/* Botón 3 puntos - IZQUIERDA para mis mensajes */}
              {!isClient && (msg.messageId || msg.status) && (
                <div
                  data-msg-dots
                  className={`flex-shrink-0 self-center mr-1 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all ${messageMenuOpen === index ? 'opacity-100 bg-black/10 dark:bg-white/10' : 'opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10'}`}
                  onClick={(e) => { e.stopPropagation(); setMessageMenuOpen(messageMenuOpen === index ? null : index); }}
                >
                  <svg className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </div>
              )}
              <div className={`max-w-[85%] md:max-w-xs lg:max-w-md px-3 py-2 relative ${
                isClient ? '' : ''
              }`}
              onTouchStart={(e) => {
                if (msg.messageId || msg.status) {
                  longPressTimer.current = setTimeout(() => {
                    if (navigator.vibrate) navigator.vibrate(30);
                    setMessageMenuOpen(index);
                  }, 500);
                }
              }}
              onTouchEnd={() => { clearTimeout(longPressTimer.current); }}
              onTouchMove={() => { clearTimeout(longPressTimer.current); }}
              onContextMenu={(e) => {
                if (msg.messageId || msg.status) {
                  e.preventDefault();
                  setMessageMenuOpen(index);
                }
              }}
              style={{
                borderRadius: isClient
                  ? (!sameSender ? '0 12px 12px 12px' : '12px 12px 12px 12px')
                  : (!sameSender ? '12px 0 12px 12px' : '12px 12px 12px 12px'),
                backgroundColor: isClient ? 'var(--msg-client-bg)' : (isMessageFromHuman ? 'rgba(59, 130, 246, 0.12)' : 'var(--msg-own-bg)'),
                color: isClient ? 'var(--text-primary)' : 'var(--msg-own-text)',
                border: isClient ? '1px solid var(--msg-client-border)' : 'none',
                boxShadow: messageMenuOpen === index
                  ? '0 0 0 2px rgba(0, 161, 156, 0.5), 0 4px 16px rgba(0,0,0,0.12)'
                  : (isClient ? '0 2px 8px var(--msg-client-shadow)' : '0 1px 3px rgba(0,0,0,0.08)'),
                transition: 'box-shadow 0.2s ease',
              }}>
                {/* Piquito estilo WhatsApp */}
                {isClient && !sameSender && messageMenuOpen !== index && (
                  <div style={{
                    position: 'absolute', top: 0, left: -8, width: 8, height: 13,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: 0, height: 0,
                      borderTop: '0 solid transparent',
                      borderRight: '8px solid var(--msg-client-bg)',
                      borderBottom: '13px solid transparent',
                    }} />
                  </div>
                )}
                {!isClient && !sameSender && messageMenuOpen !== index && (
                  <div style={{
                    position: 'absolute', top: 0, right: -8, width: 8, height: 13,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: 0, height: 0,
                      borderTop: '0 solid transparent',
                      borderLeft: `8px solid ${isMessageFromHuman ? 'rgba(59, 130, 246, 0.12)' : 'var(--msg-own-bg)'}`,
                      borderBottom: '13px solid transparent',
                    }} />
                  </div>
                )}
                {/* Indicador de mensaje reenviado */}
                {msg.isForwarded && (
                  <div className={`text-[10px] font-medium mb-1 flex items-center gap-1 ${isClient ? 'text-gray-500 dark:text-gray-400' : 'text-[var(--msg-own-secondary)]'}`}>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span>Reenviado</span>
                  </div>
                )}

                {/* Mostrar nombre del usuario solo si es un grupo */}
                {contact.isGroup && isClient && (
                  <div
                    key={`name-${index}-${isDarkMode}`}
                    onClick={(e) => { e.stopPropagation(); openMemberInfo(msg); }}
                    title="Ver información del miembro"
                    className="text-xs font-semibold mb-1 cursor-pointer hover:underline"
                    style={
                      isVipParticipant(msg.participant, msg.userName) ? {
                        background: isDarkMode
                          ? 'linear-gradient(90deg, #FF6B81, #FF8C5A, #C08AFF)'
                          : 'linear-gradient(90deg, #DC143C, #FF4500, #8B00FF)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                      } : {
                        color: getParticipantColor(msg.userName || 'Usuario', isDarkMode)
                      }
                    }>
                    {msg.userName || 'Usuario'}
                  </div>
                )}
                {isClient && (
                <div className={`text-[10px] font-semibold mb-1 ${contact.isGroup && isClient ? 'hidden' : ''} text-gray-500 dark:text-gray-400`}>
                  {msg.userName || 'Cliente'}
                </div>
                )}
                <div className="text-sm leading-relaxed break-words overflow-hidden">
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
                          <div className={`flex items-center gap-2 p-3 rounded-lg ${isClient ? 'bg-black/5 dark:bg-white/5' : 'bg-black/5 dark:bg-white/5'}`}>
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
                          <div className={`flex items-center gap-2 p-3 rounded-lg ${isClient ? 'bg-black/5 dark:bg-white/5' : 'bg-black/5 dark:bg-white/5'}`}>
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
                      {msg.mediaType === 'document' && (() => {
                        const fname = (msg.mediaFilename || 'archivo').toLowerCase();
                        const ext = fname.split('.').pop();
                        const docStyles = {
                          pdf: { color: '#E53E3E', bg: '#FEE2E2', label: 'PDF', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM9 17H7v-5h2c1.1 0 2 .9 2 2s-.9 2-2 2H9v1zm4-2c0 1.1-.9 2-2 2h-1v-4h1c1.1 0 2 .9 2 2z' },
                          doc: { color: '#2B6CB0', bg: '#BEE3F8', label: 'DOC', icon: null },
                          docx: { color: '#2B6CB0', bg: '#BEE3F8', label: 'DOCX', icon: null },
                          xls: { color: '#276749', bg: '#C6F6D5', label: 'XLS', icon: null },
                          xlsx: { color: '#276749', bg: '#C6F6D5', label: 'XLSX', icon: null },
                          csv: { color: '#276749', bg: '#C6F6D5', label: 'CSV', icon: null },
                          ppt: { color: '#C05621', bg: '#FEEBC8', label: 'PPT', icon: null },
                          pptx: { color: '#C05621', bg: '#FEEBC8', label: 'PPTX', icon: null },
                          zip: { color: '#6B46C1', bg: '#E9D8FD', label: 'ZIP', icon: null },
                          rar: { color: '#6B46C1', bg: '#E9D8FD', label: 'RAR', icon: null },
                          txt: { color: '#4A5568', bg: '#E2E8F0', label: 'TXT', icon: null },
                          md: { color: '#4A5568', bg: '#E2E8F0', label: 'MD', icon: null },
                          json: { color: '#D69E2E', bg: '#FEFCBF', label: 'JSON', icon: null },
                          js: { color: '#D69E2E', bg: '#FEFCBF', label: 'JS', icon: null },
                          html: { color: '#E53E3E', bg: '#FEE2E2', label: 'HTML', icon: null },
                          css: { color: '#3182CE', bg: '#BEE3F8', label: 'CSS', icon: null },
                          apk: { color: '#38A169', bg: '#C6F6D5', label: 'APK', icon: null },
                        };
                        const style = docStyles[ext] || { color: '#718096', bg: '#EDF2F7', label: ext?.toUpperCase() || 'DOC', icon: null };
                        return (
                          <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
                            <div className="w-10 h-12 rounded-lg flex flex-col items-center justify-center flex-shrink-0 relative" style={{ background: style.bg }}>
                              <svg className="w-6 h-6" fill={style.color} viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/>
                              </svg>
                              <span className="text-[7px] font-black mt-[-2px]" style={{ color: style.color }}>{style.label}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{msg.mediaFilename || 'Documento'}</p>
                              <a
                                href={msg.mediaUrl}
                                download={msg.mediaFilename}
                                className="text-xs font-medium hover:opacity-80"
                                style={{ color: style.color }}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Descargar
                              </a>
                            </div>
                          </div>
                        );
                      })()}
                      {msg.mediaType === 'sticker' && (
                        <div className="relative group/sticker inline-block">
                          <img
                            src={msg.mediaUrl}
                            alt="Sticker"
                            className="w-auto max-h-32 object-contain"
                            style={{ maxWidth: '150px' }}
                          />
                          {msg.mediaUrl && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveStickerFavorite(msg.mediaUrl); }}
                              className="absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover/sticker:opacity-100 transition-opacity"
                              style={{
                                background: isDarkMode ? 'rgba(30,41,59,0.85)' : 'rgba(255,255,255,0.85)',
                                backdropFilter: 'blur(4px)',
                                border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                              }}
                              title="Guardar en favoritos"
                            >
                              <svg className="w-4 h-4" fill="none" stroke={isDarkMode ? '#facc15' : '#eab308'} strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Mostrar mensaje citado si existe */}
                  {msg.hasQuotedMsg && msg.quotedMsg && (() => {
                    const quotedName = msg.quotedMsg.participant
                      ? (() => {
                          const pid = msg.quotedMsg.participant.split('@')[0];
                          const found = contact.messages?.find(m => m.participant && m.participant.includes(pid) && (m.userName || m.pushName));
                          return found ? (found.userName || found.pushName) : pid;
                        })()
                      : 'Usuario';
                    const quotedColor = getParticipantColor(quotedName, isDarkMode);
                    return (
                      <div className="mb-2 p-2 rounded-lg border-l-4 cursor-pointer hover:opacity-90"
                        style={{
                          borderLeftColor: quotedColor,
                          backgroundColor: `color-mix(in srgb, ${quotedColor} ${isDarkMode ? '15%' : '12%'}, ${isDarkMode ? '#1e293b' : '#f8fffe'})`,
                        }}
                      >
                        <div className="text-[10px] font-bold mb-1" style={{ color: quotedColor }}>
                          {quotedName}
                        </div>
                        <div className="text-xs truncate" style={{ whiteSpace: 'pre-wrap', color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                          {resolveMentions(msg.quotedMsg.body, contact.messages, groupParticipants, !isClient) || '[Mensaje sin texto]'}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Mostrar texto del mensaje (solo si existe) - normaliza mayúsculas de clientes */}
                  {msg.message && msg.message.trim() !== '' && (
                    msg.message === 'Se elimino este mensaje' ? (
                      <span style={{ whiteSpace: 'pre-wrap', fontStyle: 'italic', opacity: 0.5 }}>Se elimino este mensaje</span>
                    ) : isClient || isHumanOrBot ? (
                      <span style={{ whiteSpace: 'pre-wrap' }}>
                        {isClient ? resolveMentions(normalizeUppercase(msg.message), contact.messages, groupParticipants, false) : resolveMentions(msg.message, contact.messages, groupParticipants, true)}
                      </span>
                    ) : (
                      <span style={{ whiteSpace: 'pre-wrap' }}>{resolveMentions(msg.message, contact.messages, groupParticipants, !isClient)}</span>
                    )
                  )}
                  {/* Spacer invisible para reservar espacio del timestamp */}
                  <span style={{ display: 'inline-block', width: msg.isEdited ? (msg.status ? '115px' : '100px') : (msg.status ? '75px' : '55px'), height: '1px' }}>&nbsp;</span>
                  {/* Timestamp absolute en esquina inferior derecha */}
                  <span className={`absolute bottom-1 right-2 inline-flex items-center gap-1 text-[11px] ${isClient ? 'text-gray-500 dark:text-gray-400' : 'text-[var(--msg-own-secondary)]'}`} style={{ lineHeight: 1, whiteSpace: 'nowrap' }}>
                    {msg.isEdited && <span style={{ fontStyle: 'italic' }}>editado</span>}
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    {!isClient && msg.status && (
                      <span className={`flex items-center ml-0.5 ${contact?.isGroup && msg.messageId ? 'cursor-pointer hover:opacity-60' : ''}`}
                        onClick={contact?.isGroup && msg.messageId ? (e) => { e.stopPropagation(); handleReceiptClick(msg.messageId); } : undefined}>
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
                  </span>
                </div>

              </div>
              {/* Botón 3 puntos - DERECHA solo para mensajes del cliente */}
              {isClient && (msg.messageId || msg.status) && (
                <div
                  data-msg-dots
                  className={`flex-shrink-0 self-center ml-1 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all ${messageMenuOpen === index ? 'opacity-100 bg-black/10 dark:bg-white/10' : 'opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10'}`}
                  onClick={(e) => { e.stopPropagation(); setMessageMenuOpen(messageMenuOpen === index ? null : index); }}
                >
                  <svg className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </div>
              )}
            </div>
            {/* Reacciones del mensaje - debajo de la burbuja, sueltas */}
            {msg.messageId && messageReactions[msg.messageId]?.length > 0 && (
              <div className={`flex ${isClient ? '' : 'justify-end'} -mt-1 mb-1 ${isClient ? 'pl-10' : ''}`}>
                <div className="flex gap-1">
                  {Object.entries(messageReactions[msg.messageId].reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {})).map(([emoji, count]) => (
                    <span key={emoji} className="text-sm">{emoji}{count > 1 ? <span className="text-[10px] ml-0.5" style={{ color: 'var(--text-secondary)' }}>{count}</span> : ''}</span>
                  ))}
                </div>
              </div>
            )}
            {/* Cápsulas de acciones debajo de la burbuja */}
            {(messageMenuOpen === index || menuClosing === index) && (msg.messageId || msg.status) && (
              <div data-menu-capsules className={`mt-1 relative z-20 ${isClient ? 'pl-10' : ''}`}
                style={menuClosing === index ? { animation: 'capsuleFade 0.15s ease forwards' } : undefined}>
                {/* Reacciones rápidas en píldora */}
                {msg.messageId && (
                  <div className={`flex mb-4 md:mb-2.5 ${isClient ? '' : 'justify-end'}`}>
                    <div className="flex gap-0.5 px-2 py-1 rounded-full shadow-md" style={{
                      background: isDarkMode ? '#1e2a35' : '#ffffff',
                      opacity: 0, animation: 'capsulePop 0.2s ease forwards',
                    }}>
                      {QUICK_REACTIONS.map(emoji => (
                        <button key={emoji} onClick={() => handleReaction(emoji, msg)} className="w-8 h-8 rounded-full flex items-center justify-center hover:scale-125 active:scale-90 transition-transform text-lg">
                          {emoji}
                        </button>
                      ))}
                      <button onClick={() => { setEmojiModal(msg); setEmojiInput(''); setTimeout(() => emojiInputRef.current?.focus(), 100); }} className="w-8 h-8 rounded-full flex items-center justify-center hover:scale-110 active:scale-90 transition-transform text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
                        +
                      </button>
                    </div>
                  </div>
                )}
                <div className={`flex flex-wrap gap-1.5 ${isClient ? '' : 'justify-end'}`}>
                <div onClick={() => closeMessageMenu(() => handleReplyMessage(msg))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-md cursor-pointer hover:brightness-110 active:scale-95 transition-all"
                  style={{ backgroundColor: '#10B981', color: '#fff', opacity: 0, animation: 'capsulePop 0.25s ease forwards', animationDelay: '0.03s' }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                  <span className="text-xs font-semibold">Responder</span>
                </div>
                {msg.messageId && (
                  <div onClick={() => closeMessageMenu(() => handleForwardMessage({ remoteJid: `${contact.phone}@g.us`, id: msg.messageId, fromMe: !isClient }, msg))}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-md cursor-pointer hover:brightness-110 active:scale-95 transition-all"
                    style={{ backgroundColor: '#8B5CF6', color: '#fff', opacity: 0, animation: 'capsulePop 0.25s ease forwards', animationDelay: '0.08s' }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    <span className="text-xs font-semibold">Reenviar</span>
                  </div>
                )}
                {!isClient && msg.messageId && msg.message && msg.message !== 'Se elimino este mensaje' && (
                  <div onClick={() => closeMessageMenu(() => { setEditingMessage({ messageId: msg.messageId, message: msg.message }); setMessage(msg.message); textareaRef.current?.focus(); })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-md cursor-pointer hover:brightness-110 active:scale-95 transition-all"
                    style={{ backgroundColor: '#3B82F6', color: '#fff', opacity: 0, animation: 'capsulePop 0.25s ease forwards', animationDelay: '0.13s' }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    <span className="text-xs font-semibold">Editar</span>
                  </div>
                )}
                {!isClient && msg.messageId && (
                  <div onClick={() => closeMessageMenu(() => handleDeleteMessage({ remoteJid: `${contact.phone}@g.us`, id: msg.messageId, fromMe: true }))}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-md cursor-pointer hover:brightness-110 active:scale-95 transition-all"
                    style={{ backgroundColor: '#EF4444', color: '#fff', opacity: 0, animation: 'capsulePop 0.25s ease forwards', animationDelay: '0.18s' }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    <span className="text-xs font-semibold">Eliminar</span>
                  </div>
                )}
                </div>
              </div>
            )}
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input de mensaje o mensaje de grupo abandonado */}
      {contact.leftGroup ? (
        <div className="px-2 md:px-4 py-2 md:py-3 flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
          <div className="text-center py-2 px-4 bg-white dark:bg-slate-800 rounded-full" style={{ border: '1.5px solid var(--border-secondary)' }}>
            <p className="text-xs md:text-sm font-medium text-gray-400 dark:text-gray-500">Ya no puedes enviar mensajes a este grupo</p>
          </div>
        </div>
      ) : (
        <div style={{ background: isDarkMode ? '#0b141a' : '#edf7f6' }}>
          {/* Indicador de edicion */}
          {editingMessage && (
            <div className="px-3 md:px-5 py-2 flex items-center justify-between mx-2 md:mx-4 rounded-t-xl" style={{
              background: 'rgba(59, 130, 246, 0.08)',
              borderBottom: 'none'
            }}>
              <div className="flex items-center gap-3 flex-1">
                <div className="w-1 h-10 rounded-full" style={{ background: '#3B82F6' }}></div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Editando mensaje</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{editingMessage.message}</div>
                </div>
              </div>
              <button
                onClick={() => { setEditingMessage(null); setMessage(''); }}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-gray-200"
                style={{ color: 'var(--text-secondary)' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Panel de stickers inline */}
          {showStickerCollection && (
            <div className="mx-2 md:mx-4 mb-1 rounded-2xl overflow-hidden" style={{
              background: isDarkMode ? '#1e2a35' : '#ffffff',
              boxShadow: isDarkMode ? '0 2px 12px rgba(0,0,0,0.3)' : '0 2px 12px rgba(0,0,0,0.08)',
              maxHeight: '300px',
            }}>
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Stickers</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)', color: 'var(--text-secondary)' }}>{stickerFavorites.length}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleAttachClick('sticker')} className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 dark:hover:bg-slate-600" title="Cargar sticker">
                    <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  </button>
                  <button onClick={() => setShowStickerCollection(false)} className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 dark:hover:bg-slate-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" style={{ color: 'var(--text-secondary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>
              </div>
              <div className="px-4 pb-4 pt-1 overflow-y-auto" style={{ maxHeight: '240px' }}>
                {stickerFavoritesLoading ? (
                  <div className="flex items-center justify-center py-6"><div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div></div>
                ) : stickerFavorites.length === 0 ? (
                  <div className="text-center py-4"><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Sin stickers. Usa + para agregar o guarda desde el chat.</p></div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                    {stickerFavorites.map((sticker) => (
                      <div key={sticker.id} className="relative group/fav rounded-lg p-2 transition-all cursor-pointer hover:scale-105 active:scale-95" style={{ background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }}>
                        <img src={sticker.sticker_url} alt="" className="w-full h-auto object-contain mx-auto" style={{ maxHeight: '60px' }} onClick={() => handleSendStickerFavorite(sticker.sticker_url)} />
                        {sendingStickerFav === sticker.sticker_url && (
                          <div className="absolute inset-0 rounded-lg flex items-center justify-center" style={{ background: isDarkMode ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)' }}>
                            <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteStickerFavorite(sticker.id); }} className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover/fav:opacity-100 transition-opacity" style={{ background: '#EF4444' }}>
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Indicador de mensaje citado */}
          {quotedMessage && (
            <div className="mx-2 md:mx-4 px-3 py-2 flex items-center justify-between rounded-xl" style={{
              background: isDarkMode ? '#1e2a35' : '#ffffff',
              boxShadow: isDarkMode ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
            }}>
              <div className="flex items-center gap-3 flex-1">
                <div className="w-1 h-10 rounded-full" style={{ background: '#00A19C' }}></div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold mb-0.5" style={{ color: '#00A19C' }}>
                    Respondiendo a {quotedMessage.userName || 'Usuario'}
                  </div>
                  <div className="text-xs truncate" style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                    {quotedMessage.message || '[Mensaje sin texto]'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setQuotedMessage(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:bg-gray-200 dark:hover:bg-slate-600 flex-shrink-0"
                style={{ color: 'var(--text-secondary)' }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Menú de adjuntar - fuera de la píldora, posición fixed */}
          {showAttachMenu && (
            <div ref={attachMenuRef} className="fixed bottom-16 left-3 md:left-auto md:bottom-20 w-48 rounded-2xl shadow-lg z-50" style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              boxShadow: '0 10px 25px var(--shadow-md)'
            }}>
              <div className="py-1">
                <button onClick={() => handleAttachClick('image')} className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-all hover:bg-gray-50 dark:hover:bg-slate-700" style={{ color: 'var(--text-secondary)' }}>
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  <span>Imagen</span>
                </button>
                <button onClick={() => handleAttachClick('video')} className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-all hover:bg-gray-50 dark:hover:bg-slate-700" style={{ color: 'var(--text-secondary)' }}>
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  <span>Video</span>
                </button>
                <button onClick={() => handleAttachClick('document')} className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-all hover:bg-gray-50 dark:hover:bg-slate-700" style={{ color: 'var(--text-secondary)' }}>
                  <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  <span>Documento</span>
                </button>
                <button onClick={() => handleAttachClick('audio')} className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-all hover:bg-gray-50 dark:hover:bg-slate-700" style={{ color: 'var(--text-secondary)' }}>
                  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  <span>Audio</span>
                </button>
                <button onClick={() => { setShowAttachMenu(false); openStickerCollection(); }} className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-all hover:bg-gray-50 dark:hover:bg-slate-700" style={{ color: 'var(--text-secondary)' }}>
                  <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>Stickers</span>
                </button>
              </div>
            </div>
          )}

          <div className="px-2 md:px-4 py-2 md:py-3 flex items-end gap-2 relative flex-shrink-0" style={{
            background: isDarkMode ? '#0b141a' : '#edf7f6',
          }}>
            {/* Píldora del input */}
            <div className="flex items-center flex-1 min-w-0 rounded-full pl-3 pr-2" style={{
              background: isDarkMode ? '#1e2a35' : '#ffffff',
              minHeight: '42px',
              boxShadow: isDarkMode
                ? '0 2px 8px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)'
                : '0 2px 8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
            }}>
              {/* Botón de adjuntar */}
              <button
                ref={attachBtnRef}
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                disabled={sendingMedia}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-50 flex-shrink-0 mr-1"
                style={{
                  color: showAttachMenu ? 'var(--brand-primary)' : 'var(--text-tertiary)',
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ transform: 'rotate(45deg)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>

              <div className="flex-1 min-w-0 relative flex items-center">
                {/* Dropdown de menciones */}
                {showMentions && filteredParticipants.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                    {filteredParticipants.map((p, i) => (
                      <button
                        key={p.id}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                          i === mentionIndex
                            ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'
                            : 'hover:bg-gray-50 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-200'
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertMention(p);
                        }}
                        onMouseEnter={() => setMentionIndex(i)}
                      >
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: getParticipantColor(p.name || p.id, isDarkMode) }}>
                          {(p.name || p.id.split('@')[0]).charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{p.name || p.id.split('@')[0]}</div>
                          {p.name && <div className="text-xs text-gray-400 truncate">{p.id.split('@')[0]}</div>}
                        </div>
                        {p.admin && (
                          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 flex-shrink-0">
                            {p.admin === 'superadmin' ? 'Creador' : 'Admin'}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMessage(val);

                    // Detectar si estamos escribiendo una mención
                    if (contact?.isGroup && groupParticipants.length > 0) {
                      const cursorPos = e.target.selectionStart;
                      const textBeforeCursor = val.substring(0, cursorPos);
                      const mentionMatch = textBeforeCursor.match(/@([^\s@]*)$/);
                      if (mentionMatch) {
                        setMentionSearch(mentionMatch[1].toLowerCase());
                        setShowMentions(true);
                        setMentionIndex(0);
                      } else {
                        setShowMentions(false);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (showMentions && filteredParticipants.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMentionIndex(prev => (prev + 1) % filteredParticipants.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setMentionIndex(prev => (prev - 1 + filteredParticipants.length) % filteredParticipants.length);
                        return;
                      }
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        insertMention(filteredParticipants[mentionIndex]);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setShowMentions(false);
                        return;
                      }
                    }
                    if ((e.ctrlKey || e.shiftKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Mensaje"
                  disabled={sending || sendingMedia}
                  rows={1}
                  className="w-full py-2.5 focus:outline-none text-sm transition-all disabled:opacity-50 resize-none bg-transparent"
                  style={{
                    minHeight: '40px',
                    maxHeight: '100px',
                    overflowY: 'hidden',
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#CBD5E0 transparent'
                  }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    const newHeight = Math.min(e.target.scrollHeight, 100);
                    e.target.style.height = newHeight + 'px';
                    if (e.target.scrollHeight > 100) {
                      e.target.style.overflowY = 'auto';
                    } else {
                      e.target.style.overflowY = 'hidden';
                    }
                  }}
                />
              </div>
            </div>

            {/* Botón enviar con gradient indigo */}
            <button
              onClick={handleSend}
              disabled={sending || sendingMedia}
              aria-label="Enviar mensaje"
              className="flex items-center justify-center transition-all flex-shrink-0"
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                background: 'linear-gradient(135deg, var(--accent), var(--brand-primary-dark))',
                border: 'none',
                color: '#fff',
                cursor: sending || sendingMedia ? 'wait' : 'pointer',
                opacity: sending || sendingMedia ? 0.7 : 1,
                boxShadow: '0 6px 20px rgba(99,102,241,0.25)',
              }}
              onMouseEnter={(e) => { if (!sending && !sendingMedia) { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'scale(1.04)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = sending || sendingMedia ? '0.7' : '1'; e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {sending || sendingMedia ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <i className="ti ti-send-2" style={{ fontSize: 18 }} />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Modal de soporte activado */}
      {showSupportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px var(--shadow-lg)'
          }}>
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #00A19C 0%, #00827E 100%)',
                boxShadow: '0 8px 20px rgba(249, 115, 22, 0.3)'
              }}>
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800 dark:text-gray-100">
              Cliente Solicita Soporte
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
              El cliente ha solicitado atención personalizada. Puedes tomar el control de la conversación.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(249, 115, 22, 0.08)',
              border: '1px solid rgba(249, 115, 22, 0.2)'
            }}>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <strong className="text-orange-600">Cliente:</strong> {contact.phone}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                <strong className="text-orange-600">Estado:</strong> Esperando respuesta
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSupportModal(false)}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)'
                }}
                onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                onMouseLeave={(e) => e.target.style.background = 'var(--bg-tertiary)'}
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

                    // El mensaje de presentación aparecerá automáticamente cuando el servidor actualice los contactos
                    // No agregarlo manualmente para evitar duplicación
                  } catch (error) {
                    setErrorMessage('Error al tomar control: ' + (error.message || 'Error desconocido'));
                    setShowErrorModal(true);
                  }
                }}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: 'var(--brand-primary)' }}
                onMouseEnter={(e) => e.target.style.background = 'var(--brand-primary-dark)'}
                onMouseLeave={(e) => e.target.style.background = 'var(--brand-primary)'}
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px var(--shadow-lg)'
          }}>
            <h3 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">
              Finalizar Conversación
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              ¿Estás seguro de que deseas finalizar esta conversación? Se enviará un mensaje de cierre al cliente y la sesión cambiará a modo IA.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)'
            }}>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Se enviará al cliente: <strong>"⏰ Tu sesión de conversación ha finalizado. Puedes escribirme nuevamente para iniciar una nueva conversación."</strong>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndModal(false)}
                disabled={endingConversation}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)'
                }}
                onMouseEnter={(e) => !endingConversation && (e.target.style.background = '#E5E7EB')}
                onMouseLeave={(e) => !endingConversation && (e.target.style.background = 'var(--bg-tertiary)')}
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

      {/* Modal info de contacto / miembro */}
      {contactInfoModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setContactInfoModal(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()} style={{ boxShadow: '0 20px 50px var(--shadow-lg)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {contactInfoModal.isGroupMember ? 'Miembro del grupo' : (contactInfoModal.isGroup ? 'Información del grupo' : 'Información del contacto')}
              </h3>
              <button onClick={() => setContactInfoModal(null)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>Nombre</div>
                <div className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>{contactInfoModal.name || 'Sin nombre'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>Número</div>
                {contactInfoModal.phone ? (
                  <div className="flex items-center gap-2">
                    <span className="text-base font-mono" style={{ color: 'var(--text-primary)' }}>{contactInfoModal.phone}</span>
                    <button
                      onClick={() => { navigator.clipboard?.writeText(contactInfoModal.phone); }}
                      title="Copiar"
                      className="p-1.5 rounded-lg transition-all"
                      style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="text-sm italic" style={{ color: 'var(--text-tertiary)' }}>
                    No disponible {contactInfoModal.rawId?.endsWith('@lid') ? '(identificador interno de WhatsApp)' : ''}
                  </div>
                )}
              </div>
              {contactInfoModal.rawId && contactInfoModal.rawId !== contactInfoModal.phone && (
                <div>
                  <div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>ID interno</div>
                  <div className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{contactInfoModal.rawId}</div>
                </div>
              )}
            </div>
            <button
              onClick={() => setContactInfoModal(null)}
              className="mt-6 w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Modal eliminar conversación */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px var(--shadow-lg)'
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
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800 dark:text-gray-100">
              Eliminar Conversación
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
              ¿Estás seguro de que deseas eliminar esta conversación? Esta acción no se puede deshacer.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <strong className="text-red-600">Atención:</strong> Se eliminará todo el historial de mensajes con este contacto.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deletingConversation}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)'
                }}
                onMouseEnter={(e) => !deletingConversation && (e.target.style.background = '#E5E7EB')}
                onMouseLeave={(e) => !deletingConversation && (e.target.style.background = 'var(--bg-tertiary)')}
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px var(--shadow-lg)'
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
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800 dark:text-gray-100">
              Salir del Grupo
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
              ¿Estás seguro de que deseas salir de este grupo? El bot dejará de recibir mensajes de este grupo.
            </p>
            <div className="rounded-xl p-4 mb-6" style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)'
            }}>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <strong className="text-amber-600">Atención:</strong> Esta acción hará que el bot abandone el grupo "{contact.groupName || contact.phone}".
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveGroupModal(false)}
                disabled={leavingGroup}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)'
                }}
                onMouseEnter={(e) => !leavingGroup && (e.target.style.background = '#E5E7EB')}
                onMouseLeave={(e) => !leavingGroup && (e.target.style.background = 'var(--bg-tertiary)')}
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
                style={{ background: 'var(--brand-primary)' }}
                onMouseEnter={(e) => e.target.style.background = 'var(--brand-primary-dark)'}
                onMouseLeave={(e) => e.target.style.background = 'var(--brand-primary)'}
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

      {/* Modal para enviar media - estilo WhatsApp */}
      {showCaptionModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#1a1a1a', display: 'flex', flexDirection: 'column', zIndex: 9999 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', background: '#2a2a2a' }}>
            <button
              onClick={() => { setShowCaptionModal(false); setCaptionData({ file: null, type: null, caption: '' }); }}
              style={{ width: '36px', height: '36px', borderRadius: '50%', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
            >
              ✕
            </button>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', marginLeft: '12px' }}>
              {captionData.file ? captionData.file.name : 'Enviar archivo'}
            </span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 40px', overflow: 'hidden' }}>
            {captionData.type === 'image' && captionData.file && (
              <img src={URL.createObjectURL(captionData.file)} alt="Preview" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', borderRadius: '8px' }} />
            )}
            {captionData.type === 'video' && captionData.file && (
              <video src={URL.createObjectURL(captionData.file)} controls style={{ maxHeight: '100%', maxWidth: '100%', borderRadius: '8px' }} />
            )}
            {captionData.type === 'document' && captionData.file && (
              <div style={{ background: '#2a2a2a', borderRadius: '16px', padding: '40px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <svg style={{ width: '72px', height: '72px', color: 'rgba(255,255,255,0.4)' }} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/></svg>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '15px', fontWeight: 500 }}>{captionData.file.name}</span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '13px' }}>{(captionData.file.size / 1024).toFixed(1)} KB</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', background: '#2a2a2a' }}>
            <div style={{ flex: 1, background: '#3a3a3a', borderRadius: '24px', padding: '10px 18px' }}>
              <textarea
                value={captionData.caption}
                onChange={(e) => setCaptionData({...captionData, caption: e.target.value})}
                placeholder="Agrega un mensaje..."
                style={{ width: '100%', background: 'transparent', color: '#fff', border: 'none', outline: 'none', resize: 'none', fontSize: '14px', lineHeight: '1.4', minHeight: '24px', maxHeight: '120px', fontFamily: 'inherit', display: 'block' }}
                autoFocus
                onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); setShowCaptionModal(false); sendMediaFile(captionData.file, captionData.type, captionData.caption); setCaptionData({ file: null, type: null, caption: '' }); } }}
              />
            </div>
            <button
              onClick={() => { setShowCaptionModal(false); sendMediaFile(captionData.file, captionData.type, captionData.caption); setCaptionData({ file: null, type: null, caption: '' }); }}
              style={{ width: '48px', height: '48px', borderRadius: '50%', border: 'none', background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--brand-primary-dark)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--brand-primary)'; }}
            >
              <svg style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Overlay eliminado - se usa handleClickOutside en su lugar */}
      {false && (
        <div />
      )}

      {/* Bottom sheet menú contextual de mensaje - DESHABILITADO, ahora usa circulitos flotantes */}
      {false && (() => {
        const menuMsg = reversedMessages[messageMenuOpen];
        if (!menuMsg) return null;
        const isMenuClient = menuMsg.type === 'received';
        return (
          <>
            <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setMessageMenuOpen(null)} style={{ animation: 'fadeIn 0.2s ease' }} />
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-800 rounded-t-2xl px-4 pt-4 pb-6" style={{
              boxShadow: '0 -4px 20px var(--shadow-lg)',
              animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-4" />
              {menuMsg.messageId ? (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => { setMessageMenuOpen(null); handleReplyMessage(menuMsg); }}
                    className="w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 active:bg-gray-100 dark:active:bg-slate-700 transition-all"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#F0FDFA' }}>
                      <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Responder</span>
                  </button>
                  <button
                    onClick={() => {
                      setMessageMenuOpen(null);
                      const messageKey = {
                        remoteJid: `${contact.phone}@g.us`,
                        id: menuMsg.messageId,
                        fromMe: !isMenuClient
                      };
                      handleForwardMessage(messageKey, menuMsg);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 active:bg-gray-100 dark:active:bg-slate-700 transition-all"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#F0FDFA' }}>
                      <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Reenviar</span>
                  </button>
                  {!isMenuClient && menuMsg?.message && menuMsg.message !== 'Se elimino este mensaje' && (
                    <button
                      onClick={() => {
                        setMessageMenuOpen(null);
                        setEditingMessage({ messageId: menuMsg.messageId, message: menuMsg.message });
                        setMessage(menuMsg.message);
                        textareaRef.current?.focus();
                      }}
                      className="w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 active:bg-gray-100 dark:active:bg-slate-700 transition-all"
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#EFF6FF' }}>
                        <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Editar</span>
                    </button>
                  )}
                  {!isMenuClient && (
                    <button
                      onClick={() => {
                        setMessageMenuOpen(null);
                        const messageKey = {
                          remoteJid: `${contact.phone}@g.us`,
                          id: menuMsg.messageId,
                          fromMe: true
                        };
                        handleDeleteMessage(messageKey);
                      }}
                      className="w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 active:bg-red-50 dark:active:bg-slate-700 transition-all"
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#FEF2F2' }}>
                        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-red-500">Eliminar</span>
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-2">No disponible para este mensaje</p>
              )}
            </div>
          </>
        );
      })()}

      {/* Modal para reenviar mensaje */}
      {showForwardModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-md">
          <div className="rounded-2xl p-6 max-w-md w-full mx-4 flex flex-col border border-white/20 dark:border-white/10" style={{
            background: isDarkMode ? 'rgba(30, 41, 59, 0.85)' : 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
            maxHeight: '80vh'
          }}>
            <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-100">
              Reenviar mensaje
            </h3>
            {/* Preview del mensaje a reenviar */}
            {forwardOrigMsg && (
              <div className="mb-3 px-3 py-2 rounded-lg text-xs overflow-y-auto" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', maxHeight: '120px' }}>
                {forwardOrigMsg.hasMedia && forwardOrigMsg.mediaUrl && forwardOrigMsg.mediaType === 'image' && (
                  <img src={forwardOrigMsg.mediaUrl} alt="" className="w-full max-h-16 object-cover rounded mb-1" />
                )}
                {forwardOrigMsg.hasMedia && forwardOrigMsg.mediaType && forwardOrigMsg.mediaType !== 'image' && (
                  <span>{forwardOrigMsg.mediaType === 'video' ? '🎥' : forwardOrigMsg.mediaType === 'audio' ? '🎵' : '📎'} </span>
                )}
                {forwardOrigMsg.message || '[Media]'}
              </div>
            )}
            {/* Mensaje opcional */}
            <input
              type="text"
              value={forwardNote}
              onChange={(e) => setForwardNote(e.target.value)}
              placeholder="Agregar mensaje (opcional)..."
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:border-[#00A19C] text-sm mb-2"
            />
            {/* Buscador */}
            <input
              type="text"
              value={forwardSearch}
              onChange={(e) => setForwardSearch(e.target.value)}
              placeholder="Buscar grupo..."
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:border-[#00A19C] text-sm mb-2"
              autoFocus
            />
            {/* Seleccionados */}
            {forwardSelected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {forwardSelected.map(phone => {
                  const c = forwardContacts.find(fc => fc.phone === phone);
                  return (
                    <span key={phone} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-white cursor-pointer"
                      style={{ background: 'var(--brand-primary)' }}
                      onClick={() => toggleForwardSelect(phone)}>
                      {c?.groupName || phone}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </span>
                  );
                })}
              </div>
            )}
            {/* Lista de grupos */}
            <div className="flex-1 overflow-y-auto space-y-0.5 mb-3" style={{ minHeight: '150px' }}>
              {forwardContacts.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">Cargando...</div>
              ) : (
                forwardContacts
                  .filter(c => {
                    const q = forwardSearch.toLowerCase();
                    if (!q) return true;
                    return (c.groupName || '').toLowerCase().includes(q) || c.phone.includes(q);
                  })
                  .map(c => {
                    const isSelected = forwardSelected.includes(c.phone);
                    return (
                      <div
                        key={c.phone}
                        onClick={() => toggleForwardSelect(c.phone)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${isSelected ? 'ring-2 ring-[#00A19C]' : 'hover:bg-gray-100 dark:hover:bg-slate-700'}`}
                        style={isSelected ? { background: 'rgba(0, 161, 156, 0.08)' } : undefined}
                      >
                        {/* Checkbox */}
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? 'border-[#00A19C] bg-[#00A19C]' : 'border-gray-300 dark:border-gray-500'}`}>
                          {isSelected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </div>
                        {c.groupPicture ? (
                          <img src={c.groupPicture} alt="" className="w-10 h-10 rounded-full object-cover" style={{ backgroundColor: '#fff' }} />
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: 'linear-gradient(135deg, #00A19C, #00827E)' }}>
                            {(c.groupName || c.phone).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {c.groupName || c.phone}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
            {/* Botones */}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowForwardModal(false); setForwardData({ messageKey: null, targetPhone: '' }); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmForwardMessage}
                disabled={forwardSelected.length === 0 || forwardSending}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-40"
                style={{ background: 'var(--brand-primary)' }}
              >
                {forwardSending ? 'Enviando...' : `Reenviar${forwardSelected.length > 0 ? ` (${forwardSelected.length})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de info de mensaje (receipts) */}
      {receiptModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-md" onClick={() => setReceiptModal(null)}>
          <div className="rounded-2xl p-6 max-w-sm w-full mx-4 border border-white/20 dark:border-white/10" style={{
            background: isDarkMode ? 'rgba(30, 41, 59, 0.85)' : 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
            maxHeight: '70vh'
          }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Info del mensaje</h3>
              <button onClick={() => setReceiptModal(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {receiptModal.receipts?.length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>Sin info de entrega aún</div>
            ) : (
              <div className="overflow-y-auto space-y-4" style={{ maxHeight: '50vh' }}>
                {/* Leído por */}
                {receiptModal.summary?.read > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                        <path d="M19.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-0.5-0.5 1.414-1.414 7.086-7.086a1 1 0 011.414 0z"/>
                      </svg>
                      <span className="text-xs font-semibold text-blue-500">Leído por ({receiptModal.summary.read})</span>
                    </div>
                    {receiptModal.receipts.filter(r => r.status === 'read').map((r, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 px-1">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
                          {(r.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</div>
                          {r.phone && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.phone}</div>}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {r.timestamp ? new Date(r.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Entregado a */}
                {receiptModal.summary?.delivered > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                        <path d="M19.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-0.5-0.5 1.414-1.414 7.086-7.086a1 1 0 011.414 0z"/>
                      </svg>
                      <span className="text-xs font-semibold text-gray-400">Entregado a ({receiptModal.summary.delivered})</span>
                    </div>
                    {receiptModal.receipts.filter(r => r.status === 'delivered').map((r, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 px-1">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #9CA3AF, #6B7280)' }}>
                          {(r.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</div>
                          {r.phone && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.phone}</div>}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {r.timestamp ? new Date(r.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Panel de stickers (movido inline arriba del input) */}
      {false && (
        <>
          <div className="mx-2 md:mx-4 mb-1 rounded-2xl overflow-hidden" style={{
            background: isDarkMode ? '#1e2a35' : '#ffffff',
            boxShadow: isDarkMode ? '0 -4px 20px rgba(0,0,0,0.3)' : '0 -4px 20px rgba(0,0,0,0.08)',
            maxHeight: '280px',
          }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Stickers</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)', color: 'var(--text-secondary)' }}>{stickerFavorites.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleAttachClick('sticker')} className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 dark:hover:bg-slate-600" title="Cargar sticker">
                  <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button onClick={() => setShowStickerCollection(false)} className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 dark:hover:bg-slate-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" style={{ color: 'var(--text-secondary)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Sticker grid */}
            <div className="px-3 pb-3 overflow-y-auto" style={{ maxHeight: '230px' }}>
              {stickerFavoritesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : stickerFavorites.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Sin stickers. Usa + para agregar o guarda desde el chat.</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {stickerFavorites.map((sticker) => (
                    <div key={sticker.id} className="relative group/fav rounded-lg p-1.5 transition-all cursor-pointer hover:scale-105 active:scale-95" style={{
                      background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                    }}>
                      <img
                        src={sticker.sticker_url}
                        alt={sticker.name || 'Sticker'}
                        className="w-full h-auto object-contain mx-auto"
                        style={{ maxHeight: '60px' }}
                        onClick={() => handleSendStickerFavorite(sticker.sticker_url)}
                      />
                      {/* Indicador de envío */}
                      {sendingStickerFav === sticker.sticker_url && (
                        <div className="absolute inset-0 rounded-xl flex items-center justify-center" style={{ background: isDarkMode ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)' }}>
                          <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      )}
                      {/* Botón eliminar */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteStickerFavorite(sticker.id); }}
                        className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover/fav:opacity-100 transition-opacity"
                        style={{
                          background: '#EF4444',
                          boxShadow: '0 2px 6px rgba(239,68,68,0.4)',
                        }}
                        title="Eliminar de favoritos"
                      >
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal de error */}
      {showErrorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px var(--shadow-lg)'
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
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800 dark:text-gray-100">
              Error
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 text-center">
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px var(--shadow-lg)'
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
            <h3 className="text-xl font-semibold mb-2 text-center text-gray-800 dark:text-gray-100">
              Éxito
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 text-center">
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
      {/* Modal de emoji personalizado */}
      {emojiModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setEmojiModal(null)}>
          <div className="rounded-2xl shadow-2xl p-5 w-72" style={{ background: isDarkMode ? '#1e2a35' : '#ffffff' }} onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Escribe un emoji</p>
            <input
              ref={emojiInputRef}
              type="text"
              value={emojiInput}
              onChange={e => setEmojiInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && emojiInput.trim()) {
                  handleReaction(emojiInput.trim(), emojiModal);
                  setEmojiModal(null);
                }
              }}
              placeholder="😎"
              className="w-full px-3 py-2 rounded-lg text-center text-2xl outline-none"
              style={{ background: isDarkMode ? '#0b141a' : '#f0f2f5', color: 'var(--text-primary)', border: '1px solid ' + (isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)') }}
              maxLength={4}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEmojiModal(null)} className="flex-1 py-2 rounded-lg text-sm font-medium" style={{ background: isDarkMode ? '#2a3942' : '#e9edef', color: 'var(--text-secondary)' }}>
                Cancelar
              </button>
              <button onClick={() => { if (emojiInput.trim()) { handleReaction(emojiInput.trim(), emojiModal); setEmojiModal(null); } }} className="flex-1 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#00A19C' }}>
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatPanel;