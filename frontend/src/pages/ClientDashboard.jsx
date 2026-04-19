import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { format, parseISO, isAfter, startOfToday, addDays, isBefore, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  Calendar, 
  Clock, 
  User, 
  Scissors, 
  Trash2, 
  ChevronLeft, 
  AlertCircle,
  RefreshCw,
  PlusCircle,
  CheckCircle2,
  XCircle,
  History,
  LayoutGrid,
  Filter,
  AlertTriangle,
  CheckCircle,
  Info,
  X
} from 'lucide-react';

const ClientDashboard = () => {
  const navigate = useNavigate();
  const [clientData, setClientData] = useState(() => {
    const saved = localStorage.getItem('client_portal_data');
    return saved ? JSON.parse(saved) : null;
  });
  
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const [message, setMessage] = useState(null);
  
  // Premium Modal State
  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    type: 'confirm',
    onConfirm: () => {},
    onCancel: () => setModal(prev => ({ ...prev, isOpen: false }))
  });

  const openModal = (config) => {
    setModal({
      ...modal,
      isOpen: true,
      title: config.title || 'Confirmação',
      message: config.message || '',
      confirmText: config.confirmText || 'Confirmar',
      cancelText: config.cancelText || 'Cancelar',
      type: config.type || 'confirm',
      onConfirm: () => {
        if (config.onConfirm) config.onConfirm();
        setModal(prev => ({ ...prev, isOpen: false }));
      },
      onCancel: () => {
        if (config.onCancel) config.onCancel();
        setModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };
  
  // Novos estados para filtros e abas
  const [activeTab, setActiveTab] = useState('upcoming'); // 'upcoming' ou 'history'
  const [viewMode, setViewMode] = useState('20days'); // '20days', 'all', 'custom'
  const [startDate, setStartDate] = useState(format(startOfToday(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(addDays(startOfToday(), 20), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!clientData || !clientData.phone) {
      navigate('/');
      return;
    }
    fetchAppointments();
  }, [clientData, navigate]);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const cleanPhone = clientData.phone.replace(/\D/g, "");
      
      // Carrega TODOS os agendamentos para filtrar no frontend
      const res = await api.get(`/api/appointments?client_phone=${cleanPhone}`);
      setAppointments(res.data.data);
      setMessage(null);
    } catch (err) {
      console.error('Erro ao buscar agendamentos:', err);
      setMessage({ 
        type: 'error', 
        text: 'Não foi possível carregar seus agendamentos.' 
      });
    } finally {
      setLoading(false);
    }
  };

  // Lógica de filtragem calculada
  const filteredAppointments = useMemo(() => {
    const today = startOfToday();
    
    return appointments.filter(app => {
      const todayStr = format(startOfToday(), 'yyyy-MM-dd');
      
      // Filtro de Aba
      if (activeTab === 'upcoming') {
        const isFuture = app.date >= todayStr && app.status !== 'cancelado';
        if (!isFuture) return false;
        
        // Filtro de Modo de Visualização (dentro de Próximos)
        if (viewMode === '20days') {
          const limitDateStr = format(addDays(startOfToday(), 20), 'yyyy-MM-dd');
          return app.date <= limitDateStr;
        }
        if (viewMode === 'custom') {
          return app.date >= startDate && app.date <= endDate;
        }
        return true; // Mode 'all'
      } else {
        // Aba Histórico (passados ou cancelados)
        return app.date < todayStr || app.status === 'cancelado';
      }
    }).sort((a, b) => {
      // Ordenação: próximos (crescente), histórico (decrescente)
      const dateA = new Date(`${a.date}T${a.time}`);
      const dateB = new Date(`${b.date}T${b.time}`);
      return activeTab === 'upcoming' ? dateA - dateB : dateB - dateA;
    });
  }, [appointments, activeTab, viewMode, startDate, endDate]);

  const handleCancel = (id) => {
    openModal({
      title: 'Desmarcar Horário',
      message: 'Tem certeza que deseja desmarcar este horário? Esta ação tornará a vaga disponível para outras clientes.',
      type: 'confirm',
      confirmText: 'Sim, Desmarcar',
      onConfirm: async () => {
        try {
          setCancellingId(id);
          await api.post(`/api/appointments/${id}/cancel`);
          setMessage({ type: 'success', text: 'Agendamento desmarcado com sucesso.' });
          fetchAppointments();
        } catch (err) {
          console.error('Erro ao cancelar:', err);
          openModal({ title: 'Erro', message: 'Erro ao desmarcar. Tente novamente mais tarde.', type: 'error', confirmText: 'Fechar' });
        } finally {
          setCancellingId(null);
        }
      }
    });
  };

  const handleReschedule = (app) => {
    navigate('/', { 
      state: { 
        reschedule: true, 
        serviceId: app.service_id, 
        professionalId: app.professional_id 
      } 
    });
  };

  const getStatusBadge = (app) => {
    const isPast = !isAfter(parseISO(`${app.date}T${app.time}`), new Date());
    if (app.status === 'cancelado') return <span className="status-badge bg-red-100 text-red-600 border-red-200">Cancelado</span>;
    if (isPast) return <span className="status-badge bg-gray-100 text-gray-500 border-gray-200">Concluído</span>;
    return <span className="status-badge bg-green-100 text-green-600 border-green-200">Confirmado</span>;
  };

  if (!clientData) return null;

  return (
    <div className="min-h-screen bg-background pb-20">
      
      {/* Premium Modal */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-md animate-in fade-in duration-300" onClick={modal.onCancel}></div>
          <div className="relative bg-card border border-border shadow-2xl rounded-[2.5rem] p-10 max-w-sm w-full animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <div className="flex flex-col items-center text-center">
              <div className={`mb-8 p-5 rounded-3xl ${
                modal.type === 'confirm' ? 'bg-amber-100 text-amber-600' : 
                modal.type === 'error' ? 'bg-red-100 text-red-600' : 
                modal.type === 'success' ? 'bg-green-100 text-green-600' : 'bg-pink-100 text-pink-600'
              }`}>
                {modal.type === 'confirm' && <AlertTriangle size={36} />}
                {modal.type === 'error' && <X size={36} />}
                {modal.type === 'success' && <CheckCircle size={36} />}
                {modal.type === 'info' && <Info size={36} />}
              </div>
              
              <h3 className="text-2xl font-serif text-foreground mb-3">{modal.title}</h3>
              <p className="text-muted text-sm mb-10 leading-relaxed px-2">{modal.message}</p>
              
              <div className="flex flex-col gap-3 w-full">
                <button 
                  onClick={modal.onConfirm}
                  className={`w-full py-4 px-6 rounded-2xl text-white text-sm font-black uppercase tracking-widest shadow-lg transition-all hover:scale-[1.02] active:scale-95 ${
                    modal.type === 'error' ? 'bg-red-500 shadow-red-500/20' : 
                    modal.type === 'success' ? 'bg-green-500 shadow-green-500/20' : 
                    'bg-primary shadow-primary/20'
                  }`}
                >
                  {modal.confirmText}
                </button>
                {modal.type === 'confirm' && (
                  <button 
                    onClick={modal.onCancel}
                    className="w-full py-4 px-6 rounded-2xl border border-border text-xs font-bold text-muted hover:bg-muted/10 transition-colors uppercase tracking-widest"
                  >
                    {modal.cancelText}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/50 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button 
            onClick={() => navigate('/')}
            className="p-2 -ml-2 rounded-full hover:bg-muted/20 text-muted transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-serif text-foreground">Portal da Cliente</h1>
          <div className="w-10"></div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-8">
        {/* Perfil Header */}
        <div className="bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 rounded-3xl p-8 mb-10 shadow-sm relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-white text-3xl font-serif shadow-lg shadow-primary/30">
                {clientData.name?.charAt(0) || <User size={32} />}
              </div>
              <div>
                <p className="text-primary font-bold uppercase tracking-widest text-xs mb-1">Bem-vinda de volta</p>
                <h2 className="text-3xl font-serif text-foreground">{clientData.name}</h2>
                <p className="text-muted text-sm mt-1">{clientData.phone}</p>
              </div>
            </div>
            <button 
              onClick={() => navigate('/')}
              className="btn-primary flex items-center gap-2 px-6"
            >
              <PlusCircle size={18} />
              Novo Agendamento
            </button>
          </div>
          <Scissors className="absolute -bottom-6 -right-6 text-primary/5 w-48 h-48 rotate-12" />
        </div>

        {message && (
          <div className={`mb-8 p-4 rounded-2xl border flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${
            message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="text-sm font-medium">{message.text}</span>
            <button onClick={() => setMessage(null)} className="ml-auto opacity-50 hover:opacity-100"><XCircle size={18}/></button>
          </div>
        )}

        {/* Sistema de Abas */}
        <div className="flex bg-muted/10 p-1.5 rounded-2xl mb-10 border border-border/40 max-w-sm glass-card">
          <button 
            onClick={() => setActiveTab('upcoming')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
              activeTab === 'upcoming' 
                ? 'bg-white text-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20 scale-[1.02]' 
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Calendar size={18} />
            Próximos
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
              activeTab === 'history' 
                ? 'bg-white text-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20 scale-[1.02]' 
                : 'text-muted hover:text-foreground'
            }`}
          >
            <History size={18} />
            Histórico
          </button>
        </div>

        {/* Filtros para Próximos */}
        {activeTab === 'upcoming' && (
          <div className="glass-filter-card rounded-[2rem] p-8 mb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
              <div className="space-y-1">
                <div className="flex items-center gap-3 text-primary">
                  <span className="p-2 rounded-lg bg-primary/10"><Filter size={20} /></span>
                  <h3 className="text-xl font-serif text-foreground tracking-tight">O que quer ver hoje?</h3>
                </div>
                <p className="text-xs text-muted font-medium ml-12">Personalize sua visualização</p>
              </div>
              
              <div className="flex flex-wrap gap-3">
                {[
                  { id: '20days', label: 'Próximos 20 dias' },
                  { id: 'all', label: 'Ver Tudo' },
                  { id: 'custom', label: 'Período Especial' }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setViewMode(mode.id)}
                    className={`px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider border transition-all duration-300 mode-button ${
                      viewMode === mode.id 
                        ? 'mode-button-active shadow-md' 
                        : 'border-border/60 text-muted hover:border-primary/40 hover:text-foreground hover:bg-white/5'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {viewMode === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-10 pt-8 border-t border-border/30 animate-in zoom-in-95 fade-in duration-500">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-primary/60 tracking-[0.2em] ml-2 block">Data de Início</label>
                  <div className="relative group">
                    <input 
                      type="date" 
                      value={startDate} 
                      onChange={(e) => setStartDate(e.target.value)}
                      className="input-field pr-10"
                    />
                    <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-muted/40 group-focus-within:text-primary transition-colors" size={16} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-primary/60 tracking-[0.2em] ml-2 block">Até Quando?</label>
                  <div className="relative group">
                    <input 
                      type="date" 
                      value={endDate} 
                      onChange={(e) => setEndDate(e.target.value)}
                      className="input-field pr-10"
                    />
                    <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-muted/40 group-focus-within:text-primary transition-colors" size={16} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <section>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-serif text-foreground">
              {activeTab === 'upcoming' ? 'Agendamentos Ativos' : 'Histórico de Atendimentos'}
            </h3>
            <button onClick={fetchAppointments} className="p-2 text-muted hover:text-primary transition-colors">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {loading ? (
            <div className="py-20 text-center">
              <div className="w-12 h-12 border-4 border-primary/10 border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-muted text-sm font-serif">Sincronizando com a agenda...</p>
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="text-center py-24 bg-muted/5 border-2 border-dashed border-border/50 rounded-3xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
              <Calendar size={64} className="mx-auto text-muted/30 mb-4 animate-bounce duration-[3000ms]" />
              <p className="text-xl font-serif text-muted mb-2 px-6">Nenhum agendamento encontrado.</p>
              <p className="text-sm text-muted/60 mb-8 max-w-xs mx-auto px-6">
                Se você acabou de agendar, aguarde alguns segundos e clique em atualizar. Novos dados podem levar um momento para sincronizar.
              </p>
              {activeTab === 'upcoming' && (
                <button 
                  onClick={() => navigate('/')}
                  className="btn-primary px-8 py-3 rounded-2xl shadow-xl shadow-primary/10 hover:shadow-primary/20 transition-all hover:scale-105 active:scale-95"
                >
                  Novo Agendamento
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredAppointments.map((app) => (
                <div 
                  key={app.id} 
                  className={`bg-background border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group relative overflow-hidden ${
                    app.status === 'cancelado' ? 'border-red-50 bg-red-50/5' : 'border-border/50 hover:border-primary/30'
                  }`}
                >
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      {getStatusBadge(app)}
                      <h4 className="text-xl font-serif text-foreground mt-3 group-hover:text-primary transition-colors">
                        {app.service_name}
                      </h4>
                      <p className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] mt-1 opacity-70">
                        {app.category || 'Geral'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-foreground">{app.time}</p>
                      <p className="text-[10px] text-muted uppercase font-bold tracking-widest mt-1">
                        {format(parseISO(app.date), "dd 'DE' MMMM", { locale: ptBR })}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 mb-8">
                    {app.description && (
                      <p className="text-xs text-muted/80 italic line-clamp-2 border-l-2 border-primary/20 pl-3 py-1">
                        "{app.description}"
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-muted">
                      <div className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center text-primary font-bold text-xs shadow-inner">
                        {app.professional_name?.charAt(0)}
                      </div>
                      <span className="text-sm font-medium">Profissional: <span className="text-foreground">{app.professional_name}</span></span>
                    </div>
                    <div className="flex items-center gap-3 text-muted">
                      <div className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center shadow-inner">
                        <Clock size={14} className="text-primary" />
                      </div>
                      <span className="text-sm font-medium">Tempo: <span className="text-foreground">{app.service_duration} min</span></span>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-6 border-t border-border/40 relative">
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent"></div>
                    <button 
                      onClick={() => handleReschedule(app)}
                      className="flex-1 py-3 px-4 rounded-xl border border-border text-xs font-bold text-foreground hover:bg-primary/5 hover:border-primary/20 transition-all active:scale-95"
                    >
                      Remarcar
                    </button>
                    {app.status !== 'cancelado' && activeTab === 'upcoming' && (
                       <button 
                        onClick={() => handleCancel(app.id)}
                        disabled={cancellingId === app.id}
                        className="p-3 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 transition-all disabled:opacity-50 active:scale-95"
                        title="Desmarcar"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <style jsx="true">{`
        .status-badge {
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding: 4px 10px;
          border-radius: 8px;
          border: 1px solid;
        }
        .glass-filter-card {
           background: rgba(255, 255, 255, 0.03);
           backdrop-filter: blur(20px);
           border: 1px solid rgba(255, 255, 255, 0.05);
           box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.05);
        }
        .mode-button {
          position: relative;
          transition: all 0.3s;
        }
        .mode-button-active {
          background: linear-gradient(135deg, rgba(255, 182, 193, 0.2) 0%, rgba(255, 105, 180, 0.2) 100%);
          border-color: rgba(255, 105, 180, 0.5);
          color: #FF69B4 !important;
        }
      `}</style>
    </div>
  );
};

export default ClientDashboard;
