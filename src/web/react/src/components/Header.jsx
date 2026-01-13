import React, { useState } from 'react';
import icono from '../assets/icono.jpeg';

function Header({ currentView, onViewChange, user, onLogout }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white px-4 md:px-6 py-3" style={{
      borderBottom: '1px solid #E8EBED',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
    }}>
      <div className="flex justify-between items-center relative">
        {/* Logo */}
        <div className="flex items-center">
          <img src={icono} alt="Stori" className="h-7 md:h-8" />
        </div>

        {/* Navegación - Desktop centrada, Mobile oculta */}
        <nav className="hidden md:flex absolute left-1/2 transform -translate-x-1/2 gap-1">
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

        {/* Usuario y logout - Desktop */}
        {user && (
          <div className="hidden md:flex items-center gap-3">
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

        {/* Botón hamburguesa - Mobile */}
        {user && (
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg transition-all"
            style={{
              background: mobileMenuOpen ? '#FD6144' : '#F3F4F6',
              color: mobileMenuOpen ? 'white' : '#6B7280'
            }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* Menú móvil desplegable */}
      {mobileMenuOpen && user && (
        <div className="md:hidden mt-3 py-2 space-y-1">
          {user?.role === 'admin' && (
            <button
              className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all"
              style={{
                background: currentView === 'dashboard' ? '#FD6144' : 'transparent',
                color: currentView === 'dashboard' ? 'white' : '#6B7280'
              }}
              onClick={() => {
                onViewChange('dashboard');
                setMobileMenuOpen(false);
              }}
            >
              Dashboard
            </button>
          )}
          <button
            className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all"
            style={{
              background: currentView === 'reports' ? '#FD6144' : 'transparent',
              color: currentView === 'reports' ? 'white' : '#6B7280'
            }}
            onClick={() => {
              onViewChange('reports');
              setMobileMenuOpen(false);
            }}
          >
            Reportes
          </button>
          <button
            className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all"
            style={{
              background: currentView === 'contacts' ? '#FD6144' : 'transparent',
              color: currentView === 'contacts' ? 'white' : '#6B7280'
            }}
            onClick={() => {
              onViewChange('contacts');
              setMobileMenuOpen(false);
            }}
          >
            Contactos
          </button>
          {user?.role === 'admin' && (
            <button
              className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all"
              style={{
                background: currentView === 'users' ? '#FD6144' : 'transparent',
                color: currentView === 'users' ? 'white' : '#6B7280'
              }}
              onClick={() => {
                onViewChange('users');
                setMobileMenuOpen(false);
              }}
            >
              Usuarios
            </button>
          )}
          <button
            className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all"
            style={{
              background: currentView === 'session' ? '#FD6144' : 'transparent',
              color: currentView === 'session' ? 'white' : '#6B7280'
            }}
            onClick={() => {
              onViewChange('session');
              setMobileMenuOpen(false);
            }}
          >
            Mi Sesión
          </button>

          {/* Separador */}
          <div className="my-2 border-t" style={{ borderColor: '#E8EBED' }}></div>

          {/* Info de usuario */}
          <div className="px-4 py-2 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{
              background: 'linear-gradient(135deg, #FD6144 0%, #FD3244 100%)'
            }}>
              {user.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="text-xs flex-1">
              <div className="font-semibold text-gray-800">{user.name}</div>
              <div className="text-[10px] text-gray-500">{user.role === 'admin' ? 'Admin' : 'Soporte'}</div>
            </div>
          </div>

          {/* Botón logout */}
          <button
            onClick={() => {
              onLogout();
              setMobileMenuOpen(false);
            }}
            className="w-full px-4 py-3 text-sm font-medium rounded-lg transition-all"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#EF4444'
            }}
          >
            Cerrar Sesión
          </button>
        </div>
      )}
    </header>
  );
}

export default Header;