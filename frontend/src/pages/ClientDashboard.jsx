import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from '../router';
import api from '../api';
import { isAfter, startOfToday, addDays } from 'date-fns';
import { parseDateTime, appointmentDate, normalizeDate, toValidDate, safeFormat, salonClock } from '../utils/agendaMultiview';
import { ptBR } from 'date-fns/locale';

const safeFormatDate = (dateStr, formatStr = 'dd/MM', options = {}) => {
  const valid = toValidDate(dateStr);
  if (!valid) return typeof dateStr === 'string' && dateStr ? dateStr : '--';
  return safeFormat(valid, formatStr, options) || '--';
};
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
  X,
  LogOut,
  MapPin,
  Download,
  ExternalLink
} from 'lucide-react';
import { buildGoogleCalendarUrl, buildMapUrl, downloadIcsFile } from '../utils/bookingExtras';

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

const ClientDashboard = () => {
  const navigate = useNavigate();
  const [clientData, setClientData] = useState(null);
  const [businessInfo, setBusinessInfo] = useState({ businessName: 'Mary Esmalteria', address: '', mapsUrl: '' });
  
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
  const [startDate, setStartDate] = useState(appointmentDate(startOfToday()));
  const [endDate, setEndDate] = useState(appointmentDate(addDays(startOfToday(), 20)));

  useEffect(() => {
    let active = true;
    api.get('/api/session')
      .then(response => {
        const session = response.data.data;
        if (!active || session?.type !== 'client') {
          navigate('/', { replace: true });
          return;
        }
        const nextClient = { name: session.name, phone: session.phone };
        setClientData(nextClient);
        try { localStorage.removeItem('client_portal_data'); } catch {}
        fetchAppointments();
      })
      .catch(() => {
        if (active) navigate('/', { replace: true });
      });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    api.get('/api/settings').then(response => {
      const settings = response.data.data || [];
      const findValue = key => settings.find(item => item.key === key)?.value || '';
      let profile = {};
      try {
        profile = JSON.parse(findValue('public_profile') || '{}');
      } catch {
        profile = {};
      }
      setBusinessInfo({
        businessName: findValue('business_name') || 'Mary Esmalteria',
        address: profile.address || '',
        mapsUrl: safeHttpsUrl(profile.mapsUrl)
      });
    }).catch(() => {});
  }, []);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/clients/my-history?type=all');
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

  const handleLogout = async () => {
    try {
      await api.post('/api/logout');
    } finally {
      localStorage.removeItem('client_portal_data');
      navigate('/', { replace: true });
    }
  };

  // Lógica de filtragem calculada
  const filteredAppointments = useMemo(() => {
    const now = new Date();
    const currentDateStr = appointmentDate(now);
    const currentTimeStr = salonClock(now);
    
    return appointments.filter(app => {
      const appDate = normalizeDate(app.date);
      // Filtro de Aba
      if (activeTab === 'upcoming') {
        if (app.status === 'cancelado' || app.status === 'concluído') return false;
        if (appDate < currentDateStr) return false;
        if (appDate === currentDateStr && app.time < currentTimeStr) return false;
        
        // Filtro de Modo de Visualização (dentro de Próximos)
        if (viewMode === '20days') {
          const limitDateStr = appointmentDate(addDays(now, 20));
          return appDate <= limitDateStr;
        }
        if (viewMode === 'custom') {
          return appDate >= startDate && appDate <= endDate;
        }
        return true; // Mode 'all'
      } else {
        // Aba Histórico (passados ou cancelados ou concluídos)
        const isPastDate = appDate < currentDateStr;
        const isPastTimeToday = appDate === currentDateStr && app.time < currentTimeStr;
        return isPastDate || isPastTimeToday || app.status === 'cancelado' || app.status === 'concluído';
      }
    }).sort((a, b) => {
      // Ordenação: próximos (crescente), histórico (decrescente)
      const dateA = parseDateTime(a.date, a.time)?.getTime() || 0;
      const dateB = parseDateTime(b.date, b.time)?.getTime() || 0;
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
        appointmentId: app.id,
        serviceId: app.service_id, 
        professionalId: app.professional_id 
      } 
    });
  };

  const bookingWithBusiness = app => ({
    ...app,
    businessName: businessInfo.businessName,
    location: businessInfo.address,
    bookingUrl: `${window.location.origin}/meu-perfil`
  });

  const handleOpenCalendar = app => {
    try {
      window.open(buildGoogleCalendarUrl(bookingWithBusiness(app)), '_blank', 'noopener,noreferrer');
    } catch {
      setMessage({ type: 'error', text: 'Não foi possível abrir o calendário agora.' });
    }
  };

  const handleDownloadCalendar = app => {
    try {
      downloadIcsFile(bookingWithBusiness(app));
    } catch {
      setMessage({ type: 'error', text: 'Não foi possível baixar o compromisso agora.' });
    }
  };

  const handleConfirmPresence = async (id) => {
    try {
      await api.post(`/api/appointments/${id}/confirm`);
      setMessage({ type: 'success', text: 'Sua presença foi confirmada com sucesso! Esperamos você no salão.' });
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'confirmado' } : a));
    } catch (err) {
      console.error('Erro ao confirmar presença:', err);
      setMessage({ type: 'error', text: err.response?.data?.error || 'Não foi possível confirmar sua presença no momento.' });
    }
  };

  const getStatusBadge = (app) => {
    const isPast = !isAfter(parseDateTime(normalizeDate(app.date), app.time) || new Date(0), new Date());
    if (app.status === 'cancelado') return <span className="status-badge bg-red-100 text-red-600 border-red-200">Cancelado</span>;
    if (app.status === 'concluído' || isPast) return <span className="status-badge bg-purple-100 text-purple-700 border-purple-200">Concluído</span>;
    if (app.status === 'confirmado') return <span className="status-badge bg-emerald-100 text-emerald-700 border-emerald-300">✅ Presença Confirmada</span>;
    return <span className="status-badge bg-amber-100 text-amber-700 border-amber-300">⏳ Aguardando Confirmação</span>;
  };

  if (!clientData) return (
    <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-live="polite">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted">Abrindo seus agendamentos com segurança...</p>
      </div>
    </div>
  );

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
            aria-label="Voltar ao início"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-serif text-foreground">Portal da Cliente</h1>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 p-2 sm:px-3 rounded-xl text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
            aria-label="Sair da conta"
          >
            <LogOut size={18} /> <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider">Sair</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-8">
        {/* Perfil Header */}
        <div className="bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 rounded-3xl p-6 md:p-8 mb-10 shadow-sm relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5 w-full">
              <div className="w-16 h-16 md:w-20 md:h-20 shrink-0 rounded-full bg-primary flex items-center justify-center text-white text-2xl md:text-3xl font-serif shadow-lg shadow-primary/30">
                {clientData.name?.charAt(0) || <User size={32} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-primary font-bold uppercase tracking-widest text-[10px] md:text-xs mb-1">Bem-vinda de volta</p>
                <h2 className="text-2xl md:text-3xl font-serif text-foreground break-words leading-tight">{clientData.name}</h2>
                <p className="text-muted text-xs md:text-sm mt-1">{clientData.phone}</p>
              </div>
            </div>
            <button 
              onClick={() => navigate('/')}
              className="btn-primary flex items-center justify-center gap-2 px-6 py-3 md:py-4 w-full md:w-auto shrink-0 shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95"
            >
              <PlusCircle size={18} />
              <span className="font-bold text-sm uppercase tracking-wider">Novo Agendamento</span>
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
          <div className="glass-filter-card rounded-[2rem] p-6 md:p-8 mb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 md:gap-8">
              <div className="space-y-1">
                <div className="flex items-center gap-3 text-primary">
                  <span className="p-2 rounded-lg bg-primary/10 shrink-0"><Filter size={20} /></span>
                  <h3 className="text-lg md:text-xl font-serif text-foreground tracking-tight leading-tight">O que quer ver hoje?</h3>
                </div>
                <p className="text-[10px] md:text-xs text-muted font-medium ml-11 md:ml-12">Personalize sua visualização</p>
              </div>
              
              <div className="flex flex-wrap gap-2 md:gap-3 w-full lg:w-auto">
                {[
                  { id: '20days', label: 'Próximos 20 dias' },
                  { id: 'all', label: 'Ver Tudo' },
                  { id: 'custom', label: 'Período Especial' }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setViewMode(mode.id)}
                    className={`flex-1 sm:flex-none px-4 py-3 md:px-5 md:py-2.5 rounded-xl md:rounded-2xl text-[10px] md:text-[11px] font-black uppercase tracking-wider border transition-all duration-300 mode-button ${
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
                <div className="flex justify-center mt-6">
                  <button 
                    onClick={() => navigate('/')}
                    className="btn-primary flex items-center justify-center gap-2 px-8 py-4 rounded-2xl shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95"
                  >
                    <PlusCircle size={18} />
                    <span className="font-bold text-sm uppercase tracking-wider">Novo Agendamento</span>
                  </button>
                </div>
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
                        {safeFormatDate(app.date, "dd 'DE' MMMM", { locale: ptBR })}
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

                  {app.status === 'agendado' && activeTab === 'upcoming' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmPresence(app.id)}
                      className="w-full py-3.5 px-4 mb-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20 hover:scale-[1.01] active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={18} /> Confirmar Minha Presença
                    </button>
                  )}

                  {app.status !== 'cancelado' && activeTab === 'upcoming' && (
                    <div className="grid grid-cols-2 gap-2 mb-5" aria-label="Ações rápidas do agendamento">
                      <button type="button" onClick={() => handleOpenCalendar(app)} className="min-h-11 rounded-xl bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary hover:text-white transition-colors flex items-center justify-center gap-2">
                        <ExternalLink size={15} /> Google Agenda
                      </button>
                      <button type="button" onClick={() => handleDownloadCalendar(app)} className="min-h-11 rounded-xl bg-muted/15 px-3 text-xs font-bold text-foreground hover:bg-muted/25 transition-colors flex items-center justify-center gap-2">
                        <Download size={15} /> Baixar .ics
                      </button>
                      {(businessInfo.mapsUrl || businessInfo.address) && (
                        <a href={businessInfo.mapsUrl || buildMapUrl(businessInfo.address)} target="_blank" rel="noopener noreferrer" className="col-span-2 min-h-11 rounded-xl border border-border px-3 text-xs font-bold text-foreground hover:border-primary/40 hover:text-primary transition-colors flex items-center justify-center gap-2">
                          <MapPin size={15} /> Abrir localização
                        </a>
                      )}
                    </div>
                  )}

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
