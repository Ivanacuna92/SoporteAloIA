import React from 'react';

/**
 * Sidebar vertical de 72px con navegación icónica.
 * Recibe currentView/onViewChange para futura conectividad con vistas.
 */
function AppSidebar({ currentView = 'contacts', onViewChange, darkMode, onToggleDarkMode, onLogout }) {
  const navItems = [
    { id: 'contacts', icon: 'ti-message-2', title: 'Conversaciones' },
    { id: 'inbox',    icon: 'ti-inbox',     title: 'Bandeja de entrada (sin leer)' },
    { id: 'archived', icon: 'ti-archive',   title: 'Archivados' },
    { id: 'stats',    icon: 'ti-chart-pie', title: 'Estadísticas' },
  ];

  const handleClick = (id) => {
    if (onViewChange) onViewChange(id);
  };

  return (
    <aside
      className="hidden md:flex flex-col items-center flex-shrink-0 rounded-[22px] glass-surface"
      style={{ width: 72, padding: '18px 0' }}
    >
      {/* Logo */}
      <div
        className="rounded-[13px] flex items-center justify-center mb-[22px] flex-shrink-0"
        style={{
          width: 42,
          height: 42,
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
        }}
      >
        <i className="ti ti-headset" style={{ fontSize: 22, color: '#fff' }} />
      </div>

      {/* Nav principal */}
      <nav className="flex flex-col gap-2 w-full px-3">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleClick(item.id)}
              title={item.title}
              aria-label={item.title}
              className="w-full rounded-[13px] flex items-center justify-center transition-all"
              style={{
                height: 46,
                background: isActive ? 'var(--bg-active)' : 'transparent',
                border: isActive ? '1px solid var(--border-active)' : '1px solid transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                boxShadow: isActive ? '0 0 22px rgba(99,102,241,0.20)' : 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <i className={`ti ${item.icon}`} style={{ fontSize: 20 }} />
            </button>
          );
        })}
      </nav>

      {/* Bottom: theme toggle + settings + logout */}
      <div className="mt-auto flex flex-col gap-2 w-full px-3">
        <button
          onClick={onToggleDarkMode}
          title="Cambiar tema claro/oscuro"
          aria-label="Cambiar tema"
          className="w-full rounded-[13px] flex items-center justify-center transition-all"
          style={{
            height: 46,
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.borderColor = 'var(--border-active)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          <i className={`ti ${darkMode ? 'ti-sun' : 'ti-moon'}`} style={{ fontSize: 20 }} />
        </button>

        <button
          onClick={onLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          className="w-full rounded-[13px] flex items-center justify-center transition-all"
          style={{
            height: 46,
            background: 'transparent',
            border: '1px solid transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <i className="ti ti-logout" style={{ fontSize: 20 }} />
        </button>
      </div>
    </aside>
  );
}

export default AppSidebar;
