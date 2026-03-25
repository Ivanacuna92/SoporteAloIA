import React, { useState, useEffect, useRef } from 'react';
import ContactsList from './components/ContactsList';
import ChatPanel from './components/ChatPanel';
import Dashboard from './components/Dashboard';
import Reports from './components/Reports';
import QRDisplay from './components/QRDisplay';
import UserAdmin from './components/UserAdmin';
import MySession from './components/MySession';
import Login from './components/Login';
import { checkAuth, login, logout } from './services/api';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [currentView, setCurrentView] = useState(() => {
    return localStorage.getItem('currentView') || 'contacts';
  });
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const deferredPromptRef = useRef(null);

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode);
    // Update theme-color meta tag
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', darkMode ? '#0f172a' : '#FAFBFC');
  }, [darkMode]);

  // PWA install prompt
  useEffect(() => {
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) return;

    const handler = (e) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const matchMedia = window.matchMedia('(display-mode: standalone)');
    if (matchMedia.matches || window.navigator.standalone) {
      setShowInstallBanner(false);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPromptRef.current) return;
    deferredPromptRef.current.prompt();
    const { outcome } = await deferredPromptRef.current.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
    }
    deferredPromptRef.current = null;
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const authResult = await checkAuth();
      if (authResult && authResult.user) {
        setUser(authResult.user);
        localStorage.setItem('currentUser', JSON.stringify(authResult.user));
        setLoading(false);
        return;
      }
    } catch (error) {
    }

    try {
      const loginResult = await login('admin@soporteAloIA.com', 'SoporteAloIA*2025');
      if (loginResult && loginResult.user) {
        setUser(loginResult.user);
        localStorage.setItem('currentUser', JSON.stringify(loginResult.user));
        const defaultView = 'contacts';
        setCurrentView(defaultView);
      }
    } catch (error) {
      console.error('Auto-login falló:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    localStorage.setItem('currentUser', JSON.stringify(userData));
    const defaultView = 'contacts';
    setCurrentView(defaultView);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
    } finally {
      setUser(null);
      setSelectedContact(null);
      setContacts([]);
      localStorage.removeItem('currentUser');
      checkAuthStatus();
    }
  };

  useEffect(() => {
    localStorage.setItem('currentView', currentView);
  }, [currentView]);

  React.useEffect(() => {
    const handleShowChat = (event) => {
      const contact = event.detail;
      const formattedContact = {
        ...contact,
        phone: contact.phone || 'Sin número',
        messages: contact.messages || [],
        totalMessages: contact.totalMessages || 0,
        userMessages: contact.userMessages || 0,
        botMessages: contact.botMessages || 0,
        firstContact: contact.firstContact || new Date().toISOString(),
        lastActivity: contact.lastActivity || new Date().toISOString(),
        isHumanMode: contact.isHumanMode || false,
        mode: contact.mode || 'ai'
      };
      setSelectedContact(formattedContact);
      setContacts(prev => {
        const existing = prev.find(c => c.phone === formattedContact.phone);
        if (existing) {
          return prev.map(c => c.phone === formattedContact.phone ? formattedContact : c);
        } else {
          return [formattedContact, ...prev];
        }
      });
      setCurrentView('contacts');
    };
    window.addEventListener('showChat', handleShowChat);
    return () => window.removeEventListener('showChat', handleShowChat);
  }, []);

  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === 'Escape' && selectedContact) {
        setSelectedContact(null);
      }
    };
    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [selectedContact]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }}></div>
          <span style={{ color: 'var(--text-secondary)' }}>Iniciando sesión...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden max-w-[100vw]" style={{ background: 'var(--bg-primary)' }}>
      {/* PWA install banner */}
      {showInstallBanner && (
        <>
          <div className="fixed inset-0 z-40" onClick={dismissInstallBanner} style={{
            background: 'var(--overlay-bg)',
            animation: 'fadeIn 0.3s ease'
          }} />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl px-6 pt-6 pb-8" style={{
            background: 'var(--bg-secondary)',
            boxShadow: '0 -8px 40px var(--shadow-lg)',
            animation: 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--border-primary)' }} />

            <div className="flex flex-col items-center text-center">
              <img src="/aloia-icon.png" alt="AloIA" className="w-16 h-16 mb-4" />
              <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Soporte AloIA</h3>
              <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>Agrega la app a tu pantalla de inicio para un acceso mas rapido</p>

              <button
                onClick={handleInstallClick}
                className="w-full py-3 rounded-full text-sm font-semibold text-white transition-all mb-3"
                style={{ background: 'var(--brand-primary)' }}
                onMouseEnter={(e) => e.target.style.background = 'var(--brand-primary-dark)'}
                onMouseLeave={(e) => e.target.style.background = 'var(--brand-primary)'}
              >
                Instalar App
              </button>
              <button
                onClick={dismissInstallBanner}
                className="w-full py-3 rounded-full text-sm font-medium transition-all"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
              >
                Ahora no
              </button>
            </div>
          </div>
        </>
      )}
      <div className="flex flex-1 overflow-hidden max-w-full">
          <div className={`${selectedContact ? 'hidden md:flex' : 'flex'} flex-shrink-0 w-full md:w-auto max-w-full`}>
            <ContactsList
              contacts={contacts}
              setContacts={setContacts}
              selectedContact={selectedContact}
              onSelectContact={setSelectedContact}
            />
          </div>
          <div className={`${selectedContact ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 max-w-full`}>
            <ChatPanel
              contact={selectedContact}
              onUpdateContact={(updatedContact) => {
                setSelectedContact(updatedContact);
                setContacts(prev => prev.map(c =>
                  c.phone === updatedContact.phone ? updatedContact : c
                ));
              }}
              onClose={() => setSelectedContact(null)}
            />
          </div>
      </div>
    </div>
  );
}

export default App;
