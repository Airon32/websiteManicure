import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from '../router';
import { CheckCircle, AlertTriangle, Calendar, Clock, User, Scissors, ExternalLink, Download, ArrowRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import api from '../api';
import { buildGoogleCalendarUrl, downloadIcsFile } from '../utils/bookingExtras';

function ConfirmAppointment() {
  const location = useLocation();
  const navigate = useNavigate();
  const id = decodeURIComponent(location.pathname.split('/').pop() || '');
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState('fetching'); // 'fetching', 'pending', 'loading', 'success', 'already_confirmed', 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [apptInfo, setApptInfo] = useState(null);

  useEffect(() => {
    let active = true;
    const fetchInfo = async () => {
      try {
        const res = await api.get(`/api/appointments/${id}/confirm-info?token=${encodeURIComponent(token)}`);
        if (!active) return;
        const data = res.data.data;
        setApptInfo(data);
        if (data.status === 'confirmado') {
          setStatus('already_confirmed');
        } else if (data.status === 'cancelado') {
          setErrorMessage('Este agendamento foi cancelado.');
          setStatus('error');
        } else {
          setStatus('pending');
        }
      } catch (err) {
        if (!active) return;
        console.error('Erro ao buscar informações:', err);
        // Fallback: permitir tentar confirmar direto se não conseguir buscar info
        setStatus('pending');
      }
    };
    fetchInfo();
    return () => { active = false; };
  }, [id, token]);

  const handleConfirm = async () => {
    setStatus('loading');
    setErrorMessage('');
    try {
      await api.post(`/api/appointments/${id}/confirm`, { token });
      setStatus('success');
      setApptInfo(prev => prev ? { ...prev, status: 'confirmado' } : prev);
    } catch (err) {
      setErrorMessage(err.response?.data?.error || 'Não conseguimos confirmar automaticamente.');
      setStatus('error');
    }
  };

  const formattedDate = useMemo(() => {
    if (!apptInfo?.date) return '';
    try {
      return format(parseISO(apptInfo.date), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    } catch {
      return apptInfo.date;
    }
  }, [apptInfo?.date]);

  const handleOpenGoogle = () => {
    if (!apptInfo) return;
    window.open(buildGoogleCalendarUrl({
      id: apptInfo.id,
      service_name: apptInfo.service_name,
      date: apptInfo.date,
      time: apptInfo.time,
      service_duration: apptInfo.service_duration,
      professional_name: apptInfo.professional_name
    }), '_blank', 'noopener,noreferrer');
  };

  const handleDownloadIcs = () => {
    if (!apptInfo) return;
    downloadIcsFile({
      id: apptInfo.id,
      service_name: apptInfo.service_name,
      date: apptInfo.date,
      time: apptInfo.time,
      service_duration: apptInfo.service_duration,
      professional_name: apptInfo.professional_name
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="glass-card max-w-lg w-full p-6 sm:p-8 text-center fade-in-up duration-500 border border-primary/20 shadow-2xl shadow-primary/10 rounded-3xl relative overflow-hidden">
        
        {status === 'fetching' && (
          <div className="flex flex-col items-center py-8">
            <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
            <p className="text-muted text-sm font-serif">Carregando dados do agendamento...</p>
          </div>
        )}

        {(status === 'pending' || status === 'loading') && (
          <div className="flex flex-col items-center">
            <div className={`w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6 shadow-inner ${status === 'loading' ? 'animate-pulse' : ''}`}>
              <Calendar size={40} className="text-primary" />
            </div>
            
            <span className="text-[10px] font-black uppercase tracking-[0.2em] bg-amber-500/10 text-amber-600 px-3 py-1 rounded-full border border-amber-500/20 mb-3">
              ⏳ Confirmação Pendente
            </span>

            <h1 className="text-2xl sm:text-3xl font-serif text-foreground mb-2">Confirme seu Horário</h1>
            <p className="text-muted text-sm mb-6">
              Olá{apptInfo?.client_name ? `, ${apptInfo.client_name}` : ''}! Por favor, confirme sua presença para garantirmos a sua vaga.
            </p>

            {apptInfo && (
              <div className="w-full bg-card/60 border border-border/60 rounded-2xl p-4 text-left mb-6 space-y-3 shadow-sm">
                <div className="flex items-center gap-3 text-sm">
                  <Scissors size={18} className="text-primary shrink-0" />
                  <span className="font-semibold text-foreground">{apptInfo.service_name}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <User size={18} className="text-primary shrink-0" />
                  <span className="text-muted">Profissional: <strong className="text-foreground">{apptInfo.professional_name}</strong></span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Calendar size={18} className="text-primary shrink-0" />
                  <span className="text-muted capitalize">{formattedDate}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Clock size={18} className="text-primary shrink-0" />
                  <span className="text-muted">Horário: <strong className="text-foreground">{apptInfo.time}</strong></span>
                </div>
              </div>
            )}

            <button 
              onClick={handleConfirm} 
              disabled={status === 'loading'}
              className="btn-primary w-full py-4 text-base font-bold shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {status === 'loading' ? (
                <>Confirmando...</>
              ) : (
                <><CheckCircle size={20} /> Sim, Confirmo Minha Presença!</>
              )}
            </button>
          </div>
        )}

        {(status === 'success' || status === 'already_confirmed') && (
          <div className="flex flex-col items-center scale-in-center py-4">
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4 shadow-inner">
              <CheckCircle size={44} className="text-emerald-500" />
            </div>

            <span className="text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-500/10 text-emerald-600 px-3 py-1 rounded-full border border-emerald-500/20 mb-3">
              ✅ Presença Confirmada
            </span>

            <h1 className="text-2xl sm:text-3xl font-serif text-foreground mb-2">
              {status === 'already_confirmed' ? 'Presença Já Confirmada!' : 'Presença Confirmada!'}
            </h1>
            <p className="text-muted text-sm mb-6 max-w-sm">
              {status === 'already_confirmed'
                ? 'Sua presença já estava confirmada no nosso sistema. Esperamos você!'
                : 'Muito obrigado! Seu horário foi garantido com sucesso em nossa agenda. Esperamos você no salão!'}
            </p>

            {apptInfo && (
              <div className="w-full bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 text-left mb-6 space-y-2">
                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Resumo do Horário:</p>
                <p className="text-sm font-semibold text-foreground">{apptInfo.service_name}</p>
                <p className="text-xs text-muted">Com {apptInfo.professional_name} • {apptInfo.date} às {apptInfo.time}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mb-6">
              <button 
                type="button" 
                onClick={handleOpenGoogle} 
                className="py-3 px-4 rounded-xl bg-primary/10 text-xs font-bold text-primary hover:bg-primary hover:text-white transition-colors flex items-center justify-center gap-2 border border-primary/20"
              >
                <ExternalLink size={15} /> Add ao Google Agenda
              </button>
              <button 
                type="button" 
                onClick={handleDownloadIcs} 
                className="py-3 px-4 rounded-xl bg-card border border-border text-xs font-bold text-foreground hover:bg-muted/20 transition-colors flex items-center justify-center gap-2"
              >
                <Download size={15} /> Baixar Arquivo .ics
              </button>
            </div>

            <button
              onClick={() => navigate('/meu-perfil')}
              className="w-full py-3.5 rounded-xl border border-primary/30 text-xs font-bold text-primary hover:bg-primary/5 transition-colors uppercase tracking-widest flex items-center justify-center gap-2"
            >
              Ver Meus Agendamentos <ArrowRight size={16} />
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center scale-in-center py-4">
            <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>
            <h1 className="text-2xl font-serif text-foreground mb-2">Ops! Algo deu errado.</h1>
            <p className="text-muted text-sm mb-6">{errorMessage || 'O link pode ter expirado ou o agendamento não foi localizado.'}</p>
            <div className="flex flex-col gap-3 w-full">
              <button onClick={() => setStatus('pending')} className="btn-secondary w-full py-3">
                Tentar Novamente
              </button>
              <button onClick={() => navigate('/')} className="text-xs text-primary font-bold hover:underline py-2">
                Ir para o Início
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfirmAppointment;
