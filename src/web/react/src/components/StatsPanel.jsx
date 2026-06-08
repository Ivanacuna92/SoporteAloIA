import React, { useMemo } from 'react';

/**
 * Panel de estadísticas curiosas calculadas client-side desde los contactos.
 * Muestra KPIs principales + top chats con más mensajes + breakdown por tipo/modo.
 */
function StatsPanel({ contacts = [], lastReadMessages = {} }) {
  const stats = useMemo(() => computeStats(contacts, lastReadMessages), [contacts, lastReadMessages]);

  return (
    <div className="w-full md:w-[300px] flex flex-col overflow-hidden max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: '22px 20px 14px' }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>
          Estadísticas
        </span>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: '0 16px 18px' }}>
        {/* KPIs grid 2x2 */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <KpiCard icon="ti-messages"     label="Total chats"   value={stats.total}            accent="var(--accent)" />
          <KpiCard icon="ti-mail-opened"  label="Sin leer"      value={stats.unread}           accent="#22c55e" />
          <KpiCard icon="ti-archive"      label="Archivados"    value={stats.archived}         accent="#f59e0b" />
          <KpiCard icon="ti-users-group"  label="Grupos"        value={stats.groups}           accent="var(--accent2)" />
        </div>

        {/* Secundarios */}
        <SectionTitle>Actividad</SectionTitle>
        <ListRow icon="ti-message-circle-2" label="Mensajes totales" value={stats.totalMessages.toLocaleString('es-MX')} />
        <ListRow icon="ti-user"             label="Chats individuales" value={stats.individuals} />
        <ListRow icon="ti-headset"          label="En modo soporte" value={stats.support} accent="#f59e0b" />
        <ListRow icon="ti-volume-off"       label="Silenciados" value={stats.muted} />

        {/* Top 5 más mensajes */}
        <SectionTitle>Top 5 con más mensajes</SectionTitle>
        {stats.top5.length === 0 ? (
          <EmptyHint>Sin actividad todavía</EmptyHint>
        ) : (
          stats.top5.map((c, i) => (
            <TopChatRow key={c.phone} rank={i + 1} contact={c} />
          ))
        )}

        {/* Curiosidades */}
        <SectionTitle>Curiosidades</SectionTitle>
        {stats.busiest ? (
          <CuriosityRow
            icon="ti-flame"
            text="Chat más activo"
            value={chatLabel(stats.busiest)}
            sub={`${stats.busiest.messages?.length || 0} mensajes`}
          />
        ) : null}
        {stats.newest ? (
          <CuriosityRow
            icon="ti-sparkles"
            text="Última actividad"
            value={chatLabel(stats.newest)}
            sub={timeAgo(stats.newest.lastActivity)}
          />
        ) : null}
        <CuriosityRow
          icon="ti-percentage"
          text="Tasa de lectura"
          value={`${stats.readRate}%`}
          sub={`${stats.total - stats.unread} / ${stats.total} leídos`}
        />
      </div>
    </div>
  );
}

/* ─── helpers ─── */

function computeStats(contacts, lastReadMessages) {
  const total = contacts.length;
  const archived = contacts.filter(c => c.isArchived).length;
  const groups = contacts.filter(c => c.isGroup).length;
  const individuals = total - groups;
  const support = contacts.filter(c => c.mode === 'support').length;
  const totalMessages = contacts.reduce((s, c) => s + (c.messages?.length || 0), 0);

  const getUnread = (c) => {
    const total = c.messages?.length || 0;
    const read = lastReadMessages[c.phone] || 0;
    return Math.max(total - read, 0);
  };
  const unread = contacts.filter(c => !c.isArchived && getUnread(c) > 0).length;

  const muted = 0; // mute states viven en otro store; lo dejamos en 0 si no se pasa

  const top5 = [...contacts]
    .sort((a, b) => (b.messages?.length || 0) - (a.messages?.length || 0))
    .slice(0, 5);

  const busiest = top5[0] || null;

  const newest = [...contacts]
    .filter(c => c.lastActivity)
    .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))[0] || null;

  const readRate = total > 0 ? Math.round(((total - unread) / total) * 100) : 100;

  return { total, archived, groups, individuals, support, totalMessages, unread, muted, top5, busiest, newest, readRate };
}

function chatLabel(c) {
  if (!c) return '—';
  return c.isGroup ? (c.groupName || c.phone) : c.phone;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/* ─── building blocks ─── */

function KpiCard({ icon, label, value, accent }) {
  return (
    <div
      style={{
        padding: '14px 12px',
        borderRadius: 16,
        background: 'var(--bg-surface2)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <i className={`ti ${icon}`} style={{ fontSize: 16, color: accent }} />
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{value}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '-0.1px' }}>{label}</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '16px 4px 8px' }}>
      {children}
    </div>
  );
}

function ListRow({ icon, label, value, accent }) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: '10px 12px',
        borderRadius: 12,
        background: 'transparent',
        marginBottom: 2,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <i className={`ti ${icon}`} style={{ fontSize: 16, color: accent || 'var(--text-secondary)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function TopChatRow({ rank, contact }) {
  const total = contact.messages?.length || 0;
  return (
    <div
      className="flex items-center gap-3"
      style={{ padding: '10px 12px', borderRadius: 12, marginBottom: 4 }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0 mono"
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          background: rank === 1 ? 'rgba(245,158,11,0.18)' : 'var(--bg-active)',
          color: rank === 1 ? '#f59e0b' : 'var(--accent)',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {chatLabel(contact)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {contact.isGroup ? 'Grupo' : 'Individual'}
        </div>
      </div>
      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>
        {total.toLocaleString('es-MX')}
      </span>
    </div>
  );
}

function CuriosityRow({ icon, text, value, sub }) {
  return (
    <div
      style={{
        padding: '12px',
        borderRadius: 14,
        background: 'var(--bg-surface2)',
        border: '1px solid var(--border)',
        marginBottom: 6,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <i className={`ti ${icon}`} style={{ fontSize: 14, color: 'var(--accent)' }} />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600 }}>
          {text}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function EmptyHint({ children }) {
  return (
    <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
      {children}
    </div>
  );
}

export default StatsPanel;
