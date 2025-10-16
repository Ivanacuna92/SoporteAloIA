import React, { useState, useEffect } from 'react';
import Toast from './Toast';

function UserAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    role: 'support'
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/users', {
        credentials: 'include'
      });
      const data = await response.json();

      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      showToast('Error cargando usuarios', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showToast('Usuario creado exitosamente', 'success');
        setShowCreateModal(false);
        resetForm();
        loadUsers();
      } else {
        showToast(data.error || 'Error creando usuario', 'error');
      }
    } catch (error) {
      showToast('Error creando usuario', 'error');
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          role: formData.role,
          active: formData.active
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showToast('Usuario actualizado exitosamente', 'success');
        setShowEditModal(false);
        loadUsers();
      } else {
        showToast(data.error || 'Error actualizando usuario', 'error');
      }
    } catch (error) {
      showToast('Error actualizando usuario', 'error');
    }
  };

  const handleDeleteUser = async () => {
    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showToast('Usuario eliminado exitosamente', 'success');
        setShowDeleteModal(false);
        setSelectedUser(null);
        loadUsers();
      } else {
        showToast(data.error || 'Error eliminando usuario', 'error');
      }
    } catch (error) {
      showToast('Error eliminando usuario', 'error');
    }
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setFormData({
      name: user.name,
      role: user.role,
      active: user.active
    });
    setShowEditModal(true);
  };

  const openDeleteModal = (user) => {
    setSelectedUser(user);
    setShowDeleteModal(true);
  };

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      name: '',
      role: 'support'
    });
  };

  const showToast = (message, type) => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#FAFBFC' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto" style={{ background: '#FAFBFC', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Gestión de Usuarios</h2>
          <p className="text-sm text-gray-500 mt-1">Administra los usuarios de soporte del sistema</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowCreateModal(true);
          }}
          className="px-6 py-3 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: '#FD6144' }}
          onMouseEnter={(e) => e.target.style.background = '#FD3244'}
          onMouseLeave={(e) => e.target.style.background = '#FD6144'}
        >
          + Crear Usuario
        </button>
      </div>

      {/* Tabla de usuarios */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{
        border: '1px solid #E8EBED',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
      }}>
        <table className="w-full">
          <thead style={{ background: '#F9FAFB' }}>
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Nombre</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Email</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Rol</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Estado</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Último Login</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: '#E8EBED' }}>
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{
                      background: user.active ? 'linear-gradient(135deg, #FD6144 0%, #FD3244 100%)' : '#9CA3AF'
                    }}>
                      {user.name?.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-gray-800">{user.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    user.role === 'admin'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {user.role === 'admin' ? 'Admin' : 'Soporte'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    user.active
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {user.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {user.last_login
                    ? new Date(user.last_login).toLocaleDateString('es-ES')
                    : 'Nunca'
                  }
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(user)}
                      className="px-3 py-2 rounded-lg text-xs font-medium transition-all"
                      style={{ background: '#F3F4F6', color: '#374151' }}
                      onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                      onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
                    >
                      Editar
                    </button>
                    {user.email !== 'admin@whatspanel.com' && (
                      <button
                        onClick={() => openDeleteModal(user)}
                        className="px-3 py-2 rounded-lg text-xs font-medium transition-all"
                        style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444' }}
                        onMouseEnter={(e) => {
                          e.target.style.background = '#EF4444';
                          e.target.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                          e.target.style.color = '#EF4444';
                        }}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Crear Usuario */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-6 text-gray-800">Crear Nuevo Usuario</h3>
            <form onSubmit={handleCreateUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-600"
                    style={{ borderColor: '#E8EBED' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-600"
                    style={{ borderColor: '#E8EBED' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña</label>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-600"
                    style={{ borderColor: '#E8EBED' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rol</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-600"
                    style={{ borderColor: '#E8EBED' }}
                  >
                    <option value="support">Soporte</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                  style={{ background: '#F3F4F6', color: '#6B7280' }}
                  onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                  onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                  style={{ background: '#FD6144' }}
                  onMouseEnter={(e) => e.target.style.background = '#FD3244'}
                  onMouseLeave={(e) => e.target.style.background = '#FD6144'}
                >
                  Crear Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Usuario */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-6 text-gray-800">Editar Usuario</h3>
            <form onSubmit={handleUpdateUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-600"
                    style={{ borderColor: '#E8EBED' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rol</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-600"
                    style={{ borderColor: '#E8EBED' }}
                    disabled={selectedUser.email === 'admin@whatspanel.com'}
                  >
                    <option value="support">Soporte</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="w-5 h-5 rounded"
                    disabled={selectedUser.email === 'admin@whatspanel.com'}
                  />
                  <label className="text-sm font-medium text-gray-700">Usuario activo</label>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                  style={{ background: '#F3F4F6', color: '#6B7280' }}
                  onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                  onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                  style={{ background: '#FD6144' }}
                  onMouseEnter={(e) => e.target.style.background = '#FD3244'}
                  onMouseLeave={(e) => e.target.style.background = '#FD6144'}
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Eliminar Usuario */}
      {showDeleteModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4" style={{
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 className="text-xl font-semibold mb-4 text-gray-800">Eliminar Usuario</h3>
            <p className="text-sm text-gray-600 mb-6">
              ¿Estás seguro de que deseas eliminar al usuario <strong>{selectedUser.name}</strong>?
              Esta acción no se puede deshacer y se eliminará su instancia de WhatsApp.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                style={{ background: '#F3F4F6', color: '#6B7280' }}
                onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteUser}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: '#EF4444' }}
                onMouseEnter={(e) => e.target.style.background = '#DC2626'}
                onMouseLeave={(e) => e.target.style.background = '#EF4444'}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

export default UserAdmin;
