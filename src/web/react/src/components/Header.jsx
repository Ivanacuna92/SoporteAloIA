import React from 'react';
import icono from '../assets/icono.jpeg';

function Header({ currentView, onViewChange, user, onLogout }) {
  return (
    <header className="sticky top-0 z-50 bg-white px-6 py-3" style={{
      borderBottom: '1px solid #E8EBED',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
    }}>
      <div className="flex justify-between items-center relative">
        {/* Logo */}
        <div className="flex items-center">
          <img src={icono} alt="Stori" className="h-8" />
        </div>

        {/* Navegación - Centrada absolutamente */}
        <nav className="absolute left-1/2 transform -translate-x-1/2 flex gap-1">
          {user?.role === 'admin' && (
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: currentView === 'dashboard' ? '#FD6144' : 'transparent',
                color: currentView === 'dashboard' ? 'white' : '#6B7280'
              }}
              onMouseEnter={(e) => {
                if (currentView !== 'dashboard') {
                  e.target.style.background = '#F3F4F6';
                  e.target.style.color = '#374151';
                }
              }}
              onMouseLeave={(e) => {
                if (currentView !== 'dashboard') {
                  e.target.style.background = 'transparent';
                  e.target.style.color = '#6B7280';
                }
              }}
              onClick={() => onViewChange('dashboard')}
            >
              Dashboard
            </button>
          )}
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
            style={{
              background: currentView === 'reports' ? '#FD6144' : 'transparent',
              color: currentView === 'reports' ? 'white' : '#6B7280'
            }}
            onMouseEnter={(e) => {
              if (currentView !== 'reports') {
                e.target.style.background = '#F3F4F6';
                e.target.style.color = '#374151';
              }
            }}
            onMouseLeave={(e) => {
              if (currentView !== 'reports') {
                e.target.style.background = 'transparent';
                e.target.style.color = '#6B7280';
              }
            }}
            onClick={() => onViewChange('reports')}
          >
            Reportes
          </button>
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
            style={{
              background: currentView === 'contacts' ? '#FD6144' : 'transparent',
              color: currentView === 'contacts' ? 'white' : '#6B7280'
            }}
            onMouseEnter={(e) => {
              if (currentView !== 'contacts') {
                e.target.style.background = '#F3F4F6';
                e.target.style.color = '#374151';
              }
            }}
            onMouseLeave={(e) => {
              if (currentView !== 'contacts') {
                e.target.style.background = 'transparent';
                e.target.style.color = '#6B7280';
              }
            }}
            onClick={() => onViewChange('contacts')}
          >
            Contactos
          </button>
          {user?.role === 'admin' && (
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: currentView === 'users' ? '#FD6144' : 'transparent',
                color: currentView === 'users' ? 'white' : '#6B7280'
              }}
              onMouseEnter={(e) => {
                if (currentView !== 'users') {
                  e.target.style.background = '#F3F4F6';
                  e.target.style.color = '#374151';
                }
              }}
              onMouseLeave={(e) => {
                if (currentView !== 'users') {
                  e.target.style.background = 'transparent';
                  e.target.style.color = '#6B7280';
                }
              }}
              onClick={() => onViewChange('users')}
            >
              Usuarios
            </button>
          )}
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
            style={{
              background: currentView === 'session' ? '#FD6144' : 'transparent',
              color: currentView === 'session' ? 'white' : '#6B7280'
            }}
            onMouseEnter={(e) => {
              if (currentView !== 'session') {
                e.target.style.background = '#F3F4F6';
                e.target.style.color = '#374151';
              }
            }}
            onMouseLeave={(e) => {
              if (currentView !== 'session') {
                e.target.style.background = 'transparent';
                e.target.style.color = '#6B7280';
              }
            }}
            onClick={() => onViewChange('session')}
          >
            Mi Sesión
          </button>
        </nav>

        {/* Usuario y logout */}
        {user && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{
              background: '#F3F4F6'
            }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{
                background: 'linear-gradient(135deg, #FD6144 0%, #FD3244 100%)'
              }}>
                {user.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="text-xs">
                <div className="font-semibold text-gray-800">{user.name}</div>
                <div className="text-[10px] text-gray-500">{user.role === 'admin' ? 'Admin' : 'Soporte'}</div>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#EF4444'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#EF4444';
                e.target.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                e.target.style.color = '#EF4444';
              }}
            >
              Salir
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;