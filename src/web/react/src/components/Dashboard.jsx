import React, { useState, useEffect } from 'react';
import { fetchStats, fetchDates } from '../services/api';

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDates();
    loadStats();
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
  }, [selectedDate]);

  const loadDates = async () => {
    try {
      const dates = await fetchDates();
      setAvailableDates(Array.isArray(dates) ? dates : []);
      if (dates.length > 0 && !selectedDate) {
        setSelectedDate(dates[0]);
      }
    } catch (error) {
      console.error('Error cargando fechas:', error);
    }
  };

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await fetchStats(selectedDate);
      setStats(data);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-600">Cargando estadísticas...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto" style={{ background: '#FAFBFC', minHeight: '100vh' }}>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-semibold text-gray-800">Panel de Control</h2>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="px-4 py-2 rounded-xl border bg-white text-gray-700 focus:outline-none transition-all text-sm"
          style={{ borderColor: '#E8EBED' }}
          onFocus={(e) => {
            e.target.style.borderColor = '#FD6144';
            e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#E8EBED';
            e.target.style.boxShadow = 'none';
          }}
        >
          <option value="">Hoy</option>
          {availableDates.map(date => (
            <option key={date} value={date}>{date}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard
          title="Total Mensajes"
          value={stats?.totalMessages || 0}
        />
        <StatCard
          title="Chats Individuales"
          value={stats?.uniqueIndividuals || 0}
          subtitle="contactos"
        />
        <StatCard
          title="Grupos"
          value={stats?.uniqueGroups || 0}
          subtitle="grupos"
        />
        <StatCard
          title="Recibidos"
          value={stats?.userMessages || 0}
        />
        <StatCard
          title="Respuestas Bot"
          value={stats?.botMessages || 0}
        />
        <StatCard
          title="Promedio"
          value={`${stats?.averageResponseLength || 0} chars`}
        />
      </div>

      <div className="bg-white rounded-2xl p-6 mb-8" style={{
        border: '1px solid #E8EBED',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
      }}>
        <h3 className="text-lg font-semibold text-gray-800 mb-6">Actividad por Hora</h3>
        <div className="flex items-end h-48 gap-1">
          {Object.entries(stats?.messagesByHour || {}).map(([hour, count]) => (
            <div key={hour} className="flex-1 flex flex-col items-center">
              <div
                className="w-full transition-all cursor-pointer rounded-t"
                style={{
                  height: `${(count / Math.max(...Object.values(stats?.messagesByHour || {1: 1}))) * 100}%`,
                  background: '#FD6144'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = '#FD3244';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = '#FD6144';
                }}
              >
                <span className="text-white text-xs font-medium flex justify-center pt-1">{count}</span>
              </div>
              <span className="text-xs text-gray-600 mt-1">{hour}h</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InsightCard
          title="HORA PICO"
          value={getPeakHour(stats?.messagesByHour)}
        />
        <InsightCard
          title="TASA DE RESPUESTA"
          value={`${calculateResponseRate(stats)}%`}
        />
        <InsightCard
          title="MENSAJES POR USUARIO"
          value={calculateMessagesPerUser(stats)}
        />
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle }) {
  return (
    <div
      className="bg-white rounded-xl p-6 transition-all cursor-pointer"
      style={{
        border: '1px solid #E8EBED',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#FD6144';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(92, 25, 227, 0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#E8EBED';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.04)';
      }}
    >
      <h3 className="text-xs text-gray-600 font-medium mb-2">{title}</h3>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-semibold text-gray-800">{value}</p>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
    </div>
  );
}

function InsightCard({ title, value }) {
  return (
    <div
      className="rounded-xl text-white p-6 transition-all cursor-pointer"
      style={{
        background: '#FD6144',
        boxShadow: '0 4px 12px rgba(92, 25, 227, 0.2)'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#FD3244';
        e.currentTarget.style.boxShadow = '0 6px 16px rgba(92, 25, 227, 0.3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#FD6144';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(92, 25, 227, 0.2)';
      }}
    >
      <h4 className="text-xs font-medium mb-2 opacity-80">{title}</h4>
      <p className="text-3xl font-semibold">{value}</p>
    </div>
  );
}

function getPeakHour(messagesByHour) {
  if (!messagesByHour || Object.keys(messagesByHour).length === 0) return 'N/A';
  const peak = Object.entries(messagesByHour).reduce((a, b) => 
    messagesByHour[a[0]] > messagesByHour[b[0]] ? a : b
  );
  return `${peak[0]}:00`;
}

function calculateResponseRate(stats) {
  if (!stats || !stats.userMessages) return 0;
  return Math.round((stats.botMessages / stats.userMessages) * 100);
}

function calculateMessagesPerUser(stats) {
  if (!stats || !stats.uniqueUsers) return 0;
  return (stats.totalMessages / stats.uniqueUsers).toFixed(1);
}

export default Dashboard;