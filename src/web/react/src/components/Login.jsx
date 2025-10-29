import React, { useState } from 'react';
import { login } from '../services/api';
import { ToastContainer } from './Toast';
import { useToast } from '../hooks/useToast';
import logoIcon from '../assets/icono.jpeg';

function Login({ onLoginSuccess }) {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toasts, removeToast, toast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await login(formData.email, formData.password);
      if (result.success) {
        toast.success('¡Inicio de sesión exitoso! Redirigiendo...');
        setTimeout(() => {
          onLoginSuccess(result.user);
        }, 1000);
      }
    } catch (error) {
      toast.error(error.message || 'Error en las credenciales');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const togglePassword = () => {
    setShowPassword(!showPassword);
  };

  return (
    <>
      <style>{`
        @keyframes fadeInUp {
          0% {
            opacity: 0;
            transform: translateY(30px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes gradientWave {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        @keyframes floatOrbs {
          0%, 100% {
            transform: translateX(0px) translateY(0px) scale(1);
            opacity: 0.6;
          }
          50% {
            transform: translateX(10px) translateY(-15px) scale(1.05);
            opacity: 0.8;
          }
        }

        @keyframes shimmer {
          0%, 100% {
            opacity: 0.1;
            transform: translateX(-50%);
          }
          50% {
            opacity: 0.3;
            transform: translateX(50%);
          }
        }

        @keyframes toast-in {
          from {
            transform: translateX(100%) scale(0.8);
            opacity: 0;
          }
          to {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
        }

        @keyframes toast-out {
          from {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
          to {
            transform: translateX(100%) scale(0.9);
            opacity: 0;
          }
        }

        .animate-toast-in {
          animation: toast-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .animate-toast-out {
          animation: toast-out 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .login-body {
          background: #FAFBFC;
          min-height: 100vh;
          overflow: hidden;
          position: relative;
        }

        .login-body::before {
          content: '';
          position: absolute;
          top: -20%;
          left: 30%;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(92, 25, 227, 0.03) 0%, transparent 50%);
          filter: blur(80px);
          pointer-events: none;
        }

        .login-body::after {
          content: '';
          position: absolute;
          bottom: -10%;
          right: 20%;
          width: 350px;
          height: 350px;
          background: radial-gradient(circle, rgba(92, 25, 227, 0.02) 0%, transparent 60%);
          filter: blur(100px);
          pointer-events: none;
        }

        .card-subtle {
          background: #ffffff;
          border: 1px solid #E8EBED;
        }

        .login-container {
          animation: fadeInUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
          position: relative;
          z-index: 10;
        }

        /* Mobile immersive background */
        @media (max-width: 767px) {
          .login-body {
            background: #FAFBFC;
            min-height: 100vh;
            position: relative;
            padding: 2rem 1.5rem;
            overflow: hidden;
          }

          .login-body::before {
            content: '';
            position: fixed;
            top: -20%;
            left: -20%;
            width: 140%;
            height: 140%;
            background:
              radial-gradient(circle at 30% 20%, rgba(253, 97, 68, 0.04) 0%, transparent 50%),
              radial-gradient(circle at 70% 80%, rgba(253, 97, 68, 0.03) 0%, transparent 60%);
            pointer-events: none;
            animation: floatOrbs 30s ease-in-out infinite;
          }

          .login-body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background:
              linear-gradient(45deg, transparent 45%, rgba(253, 97, 68, 0.01) 50%, transparent 55%);
            pointer-events: none;
          }

          .login-container {
            max-width: 100% !important;
            width: 100% !important;
            margin: 0 !important;
            background: none !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            min-height: 100vh !important;
          }

          .card-subtle {
            background: none !important;
            backdrop-filter: none !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
          }

          .mobile-content-padding {
            padding: 2.5rem 2rem 2.5rem 2rem !important;
          }

          .mobile-input-large {
            padding: 1.2rem !important;
            font-size: 1.1rem !important;
            background: #ffffff !important;
            border: 1px solid #E8EBED !important;
            color: #374151 !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04) !important;
            border-radius: 12px !important;
          }

          .mobile-input-large::placeholder {
            color: #9CA3AF !important;
          }

          .mobile-input-large:focus {
            background: #ffffff !important;
            border-color: #FD6144 !important;
            box-shadow: 0 0 0 3px rgba(253, 97, 68, 0.08) !important;
            outline: none !important;
          }

          .mobile-button-large {
            padding: 1.2rem !important;
            font-size: 1.1rem !important;
            font-weight: 500 !important;
            background: #FD6144 !important;
            border: none !important;
            color: white !important;
            box-shadow: 0 4px 12px rgba(253, 97, 68, 0.2) !important;
            border-radius: 12px !important;
            transition: all 0.2s ease !important;
          }

          .mobile-button-large:hover {
            background: #FD3244 !important;
            transform: translateY(-1px) !important;
            box-shadow: 0 6px 16px rgba(253, 97, 68, 0.3) !important;
          }

          .mobile-text-dark {
            color: #333 !important;
          }

          .mobile-label-dark {
            color: #666 !important;
            font-weight: 500 !important;
          }

          .mobile-logo-large {
            width: 8rem !important;
            height: 5rem !important;
          }

          .mobile-title-large {
            font-size: 2.5rem !important;
            margin-bottom: 0.5rem !important;
          }

          .mobile-subtitle-large {
            font-size: 1.125rem !important;
            margin-bottom: 2rem !important;
          }
        }
      `}</style>

      <div className="login-body min-h-screen flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm mx-auto card-subtle rounded-2xl p-8 md:p-8 mobile-content-padding shadow-[0_4px_20px_rgba(0,0,0,0.08)] login-container">
          <div className="mobile-content">
            <div className="flex flex-col items-center mb-8 md:mb-8 space-y-3">
              <div className="w-15 h-15 rounded-md flex items-center justify-center">
                <img
                  src={logoIcon}
                  alt="Stori CRM"
                  className="w-24 h-16 md:w-24 md:h-16 mobile-logo-large object-contain"
                />
              </div>
              <h1 className="text-3xl md:text-3xl mobile-title-large font-semibold text-gray-900 md:text-gray-900 mobile-text-dark">
                Bienvenido
              </h1>
              <p className="text-gray-500 text-sm md:text-sm mobile-subtitle-large md:text-gray-500 mobile-text-dark">
                Gestion de Conversaciones
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 md:space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 md:text-gray-600 mobile-label-dark mb-2">
                  Usuario o correo electrónico
                </label>
                <input
                  type="text"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 md:px-4 md:py-2.5 mobile-input-large border border-gray-200 rounded-xl focus:outline-none text-sm md:text-sm placeholder-gray-400 transition-all"
                  style={{
                    borderColor: '#E8EBED'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#FD6144';
                    e.target.style.boxShadow = '0 0 0 3px rgba(253, 97, 68, 0.08)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#E8EBED';
                    e.target.style.boxShadow = 'none';
                  }}
                  placeholder="admin o usuario@dominio.com"
                  required
                  disabled={loading}
                />
              </div>

              <div className="relative">
                <label className="block text-xs font-medium text-gray-600 md:text-gray-600 mobile-label-dark mb-2">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 md:px-4 md:py-2.5 mobile-input-large pr-10 border border-gray-200 rounded-xl focus:outline-none text-sm md:text-sm placeholder-gray-400 transition-all"
                    style={{
                      borderColor: '#E8EBED'
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#FD6144';
                      e.target.style.boxShadow = '0 0 0 3px rgba(253, 97, 68, 0.08)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = '#E8EBED';
                      e.target.style.boxShadow = 'none';
                    }}
                    placeholder="••••••••"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={togglePassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 md:text-gray-400 mobile-text-dark transition-colors"
                    style={{
                      color: showPassword ? '#FD6144' : '#9CA3AF'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#FD6144';
                    }}
                    onMouseLeave={(e) => {
                      if (!showPassword) {
                        e.currentTarget.style.color = '#9CA3AF';
                      }
                    }}
                    aria-label="Mostrar u ocultar contraseña"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 transition-colors duration-200"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full text-white py-3 md:py-3 mobile-button-large rounded-xl transition-all text-sm md:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: '#FD6144'
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.target.style.background = '#FD3244';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.target.style.background = '#FD6144';
                  }
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Iniciando sesión...
                  </span>
                ) : (
                  'Iniciar sesión'
                )}
              </button>
            </form>

          </div>
        </div>

        {/* Credenciales de ejemplo */}
        <div className="w-full max-w-sm mx-auto text-center mt-6 text-xs text-gray-500">
          <p>
            <span className="font-medium text-gray-600">Admin:</span> admin@soporteAloIA.com
          </p>
          <p>
            <span className="font-medium text-gray-600">Contraseña:</span> SoporteAloIA*2025
          </p>
        </div>

        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </>
  );
}

export default Login;
