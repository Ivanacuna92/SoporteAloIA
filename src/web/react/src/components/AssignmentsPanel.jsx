import React, { useEffect, useMemo, useState } from 'react';
import { getMyContacts, getChatTags, setChatTags, updateChatTagPhone, testNotifyChatTag } from '../services/api';

/**
 * Panel de asignación de chats a personas del equipo Aloia.
 * UX:
 *   - Columna izquierda: lista de personas (Max, Ulises, Juan, Christian).
 *   - Columna derecha: todos los chats disponibles. Para la persona seleccionada,
 *     se muestra un checkbox por chat — marcado = chat asignado a esa persona.
 *   - Un cambio dispara PUT /api/chat-tag-assignments/:phone con el set resultante
 *     para el chat afectado (mantiene las demás personas intactas).
 *
 * Los chats y las etiquetas son los mismos que ya existen en la plataforma; esta
 * vista sólo cambia la cara con la que se gestionan.
 */
function AssignmentsPanel() {
  const [tags, setTags] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [selectedTagId, setSelectedTagId] = useState(null);
  const [search, setSearch] = useState('');
  const [savingPhone, setSavingPhone] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [t, c] = await Promise.all([getChatTags(), getMyContacts()]);
        setTags(t);
        setContacts(c);
        if (t.length > 0) setSelectedTagId(t[0].id);
      } catch (err) {
        console.error('Error cargando asignaciones:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedTag = useMemo(
    () => tags.find((t) => t.id === selectedTagId) || null,
    [tags, selectedTagId]
  );

  const filteredContacts = useMemo(() => {
    // Siempre fuera: chats de los que el bot fue removido del grupo. No tiene
    // sentido asignar personas a un chat donde ya no podemos recibir ni mandar
    // mensajes. is_archived se ignora adrede — un chat archivado con bot
    // adentro sigue siendo asignable.
    const base = contacts.filter((c) => !c.botLeftGroupAt);
    const s = search.trim().toLowerCase();
    if (!s) return base;
    return base.filter((c) =>
      (c.groupName || c.name || c.phone || '').toLowerCase().includes(s)
    );
  }, [contacts, search]);

  const countsByTag = useMemo(() => {
    const map = {};
    for (const c of contacts) {
      for (const t of c.tags || []) {
        map[t.id] = (map[t.id] || 0) + 1;
      }
    }
    return map;
  }, [contacts]);

  const toggleAssignment = async (contact, tagId) => {
    const currentIds = (contact.tags || []).map((t) => t.id);
    const nextIds = currentIds.includes(tagId)
      ? currentIds.filter((id) => id !== tagId)
      : [...currentIds, tagId];
    setSavingPhone(contact.phone);
    try {
      const resp = await setChatTags(contact.phone, nextIds);
      const newTags = resp?.tags || [];
      setContacts((prev) =>
        prev.map((c) =>
          c.phone === contact.phone
            // Si el backend desarchivó el chat (por tener ahora al menos una
            // etiqueta), reflejamos isArchived=false para que al salir de este
            // panel el chat ya aparezca en la bandeja principal.
            ? { ...c, tags: newTags, isArchived: resp?.unarchived ? false : c.isArchived }
            : c
        )
      );
    } catch (err) {
      console.error('Error guardando:', err);
    } finally {
      setSavingPhone(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full" style={{ color: 'var(--text-secondary)' }}>
        Cargando…
      </div>
    );
  }

  return (
    <div className="flex w-full h-full" style={{ gap: 12 }}>
      {/* Columna de personas */}
      <aside
        className="flex-shrink-0 rounded-[18px] glass-surface p-3"
        style={{ width: 240, display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', padding: '4px 8px 8px' }}>
          Equipo Aloia
        </div>
        <div className="flex flex-col gap-2" style={{ overflowY: 'auto', paddingRight: 2 }}>
          {tags.map((t) => (
            <TeamMemberCard
              key={t.id}
              tag={t}
              isActive={t.id === selectedTagId}
              count={countsByTag[t.id] || 0}
              onSelect={() => setSelectedTagId(t.id)}
              onPhoneSaved={(updated) => {
                setTags((prev) => prev.map((x) => (x.id === updated.id ? { ...x, phone: updated.phone } : x)));
              }}
            />
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '12px 8px 2px', lineHeight: 1.4 }}>
          Cuando llegue un mensaje nuevo en un chat etiquetado, se enviará aviso al WhatsApp personal de cada persona asignada.
        </p>
      </aside>

      {/* Columna derecha: lista de chats */}
      <section className="flex-1 min-w-0 rounded-[18px] glass-surface p-3" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between mb-3" style={{ padding: '2px 4px' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {selectedTag ? `Chats asignados a ${selectedTag.name}` : 'Selecciona una persona'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Marca o desmarca los chats que esta persona debe atender. Un chat puede tener varias personas.
            </div>
          </div>
          <input
            type="search"
            placeholder="Buscar chat…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              width: 220,
            }}
          />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!selectedTag ? null : filteredContacts.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', padding: 12, fontSize: 13 }}>
              No hay chats que coincidan con la búsqueda.
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: 4 }}>
              {filteredContacts.map((c) => {
                const checked = (c.tags || []).some((t) => t.id === selectedTagId);
                const otherTags = (c.tags || []).filter((t) => t.id !== selectedTagId);
                return (
                  <label
                    key={c.phone}
                    className="flex items-center rounded-[12px] px-3 py-2 transition-all"
                    style={{
                      background: checked ? 'var(--bg-active)' : 'transparent',
                      border: checked ? '1px solid var(--border-active)' : '1px solid transparent',
                      cursor: savingPhone === c.phone ? 'wait' : 'pointer',
                      gap: 10,
                    }}
                    onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={savingPhone === c.phone}
                      onChange={() => toggleAssignment(c, selectedTagId)}
                      style={{ accentColor: selectedTag.color, width: 16, height: 16 }}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate"
                        style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}
                      >
                        {c.isGroup ? (c.groupName || c.phone) : c.phone}
                      </div>
                      {otherTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {otherTags.map((t) => (
                            <span
                              key={t.id}
                              style={{
                                fontSize: 10,
                                padding: '1px 6px',
                                borderRadius: 999,
                                background: `${t.color}22`,
                                color: t.color,
                                border: `1px solid ${t.color}55`,
                                fontWeight: 600,
                              }}
                            >
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// Tarjeta por persona del Team Aloia: botón de selección arriba, input de
// teléfono abajo. El input se guarda al salir del foco o al presionar Enter;
// mantener el flujo auto-save evita un botón extra para una sola propiedad.
function TeamMemberCard({ tag, isActive, count, onSelect, onPhoneSaved }) {
  const [phone, setPhone] = useState(tag.phone || '');
  const [savedPhone, setSavedPhone] = useState(tag.phone || '');
  const [status, setStatus] = useState(null); // 'saving' | 'ok' | 'err'

  useEffect(() => {
    setPhone(tag.phone || '');
    setSavedPhone(tag.phone || '');
  }, [tag.phone]);

  const commit = async () => {
    const normalized = phone.replace(/[^0-9]/g, '');
    if (normalized === savedPhone) return;
    setStatus('saving');
    try {
      const updated = await updateChatTagPhone(tag.id, normalized || null);
      setSavedPhone(updated?.phone || '');
      setPhone(updated?.phone || '');
      onPhoneSaved && onPhoneSaved(updated);
      setStatus('ok');
      setTimeout(() => setStatus(null), 1200);
    } catch (err) {
      console.error(err);
      setStatus('err');
      setTimeout(() => setStatus(null), 2000);
    }
  };

  const borderColor = status === 'err' ? '#EF4444' : status === 'ok' ? '#10B981' : 'var(--border)';

  return (
    <div
      className="rounded-[12px] p-2"
      style={{
        background: isActive ? 'var(--bg-active)' : 'transparent',
        border: isActive ? '1px solid var(--border-active)' : '1px solid transparent',
      }}
    >
      <button
        onClick={onSelect}
        className="w-full flex items-center justify-between px-1 py-1"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 14,
        }}
      >
        <span className="flex items-center gap-2">
          <span style={{ width: 10, height: 10, borderRadius: 999, background: tag.color, display: 'inline-block' }} />
          {tag.name}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            background: count > 0 ? `${tag.color}22` : 'var(--bg-tertiary)',
            color: count > 0 ? tag.color : 'var(--text-tertiary)',
            fontWeight: 600,
          }}
        >
          {count}
        </span>
      </button>
      <div className="flex items-center gap-1 mt-1" style={{ padding: '0 2px' }}>
        <i className="ti ti-brand-whatsapp" style={{ fontSize: 14, color: 'var(--text-tertiary)' }} />
        <input
          type="tel"
          inputMode="numeric"
          placeholder="7712038628 (lada opcional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '4px 8px',
            borderRadius: 8,
            border: `1px solid ${borderColor}`,
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: 12,
          }}
        />
        {status === 'saving' && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>…</span>}
      </div>
      {savedPhone && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            try {
              setStatus('saving');
              await testNotifyChatTag(tag.id);
              setStatus('ok');
              setTimeout(() => setStatus(null), 1500);
            } catch (err) {
              console.error(err);
              setStatus('err');
              setTimeout(() => setStatus(null), 2000);
            }
          }}
          style={{
            marginTop: 6,
            width: '100%',
            padding: '4px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 11,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Enviar prueba
        </button>
      )}
    </div>
  );
}

export default AssignmentsPanel;
