import React, { useState, useEffect, useMemo } from 'react';
import { format, addDays, startOfToday, parseISO, isAfter, endOfWeek, isWithinInterval } from 'date-fns';
import { parseDateTime, appointmentDate, safeFormat } from '../utils/agendaMultiview';

const safeFormatDate = (dateStr, formatStr = 'dd/MM', options = {}) => {
  if (!dateStr || typeof dateStr !== 'string') return '--';
  try {
    const clean = dateStr.split('T')[0];
    const parsed = parseISO(clean);
    if (isNaN(parsed.getTime())) return dateStr;
    return format(parsed, formatStr, options);
  } catch {
    return dateStr;
  }
};
import { ptBR } from 'date-fns/locale';
import { 
  Calendar, 
  Clock, 
  User, 
  Scissors, 
  ChevronRight, 
  Check, 
  CheckCircle2,
  X, 
  Menu,
  Star,
  Sparkles,
  Search,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Moon,
  Sun
} from 'lucide-react';
import api from '../api';
import { useNavigate, useLocation } from '../router';
import FadeContent from '../components/FadeContent';
import PublicExperienceSections from '../components/PublicExperienceSections';
import { buildEffectiveSchedule, buildTimeSlots } from '../utils/schedule';
import { buildGoogleCalendarUrl, buildMapUrl, downloadIcsFile } from '../utils/bookingExtras';
import {
  DEFAULT_CLIENT_BOOKING_WHATSAPP,
  fillClientBookingWhatsappMessage,
  resolveClientBookingWhatsappTemplate
} from '../utils/whatsappBookingMessage';

const emptyClientData = { name: '', phone: '', email: '' };
const publicDayLabels = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' };

function normalizePublicProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return {};
  const next = { ...profile };
  for (const field of ['mapsUrl', 'instagramUrl', 'googleReviewsUrl']) {
    try {
      const candidate = new URL(String(profile[field] || ''));
      next[field] = candidate.protocol === 'https:' ? candidate.toString() : '';
    } catch {
      next[field] = '';
    }
  }
  return next;
}

function readSavedClientData() {
  try {
    const saved = localStorage.getItem('client_portal_data');
    return saved ? { ...emptyClientData, ...JSON.parse(saved) } : emptyClientData;
  } catch {
    return emptyClientData;
  }
}

function shiftTime(time, minutes) {
  const [hours, currentMinutes] = String(time || '00:00').split(':').map(Number);
  const shifted = Math.min(23 * 60 + 59, Math.max(0, (hours * 60) + currentMinutes + minutes));
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
}

export default function ClientPortal() {
  const [step, setStep] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [allSettings, setAllSettings] = useState([]);
  const [businessName, setBusinessName] = useState('Mary Esmalteria');
  const [publicProfile, setPublicProfile] = useState({});
  const [quickSlots, setQuickSlots] = useState([]);
  const [quickSlotsLoading, setQuickSlotsLoading] = useState(true);
  const [quickSlotIntent, setQuickSlotIntent] = useState(null);
  const [whatsappTemplate, setWhatsappTemplate] = useState(DEFAULT_CLIENT_BOOKING_WHATSAPP);
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedServices, setSelectedServices] = useState([]);
  const [selectedPro, setSelectedPro] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [clientData, setClientData] = useState(readSavedClientData);
  
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [loginPhone, setLoginPhone] = useState(() => readSavedClientData().phone || '');
  const [loginName, setLoginName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [accountStage, setAccountStage] = useState('phone');
  const [accountMessage, setAccountMessage] = useState('');
  const [myAppointments, setMyAppointments] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [clientAuthenticated, setClientAuthenticated] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [reschedulingAppointmentId, setReschedulingAppointmentId] = useState(null);
  const [rescheduleContactRequired, setRescheduleContactRequired] = useState(false);
  const [wasRescheduled, setWasRescheduled] = useState(false);
  const [busyAppointments, setBusyAppointments] = useState([]);
  
  // Theme Toggle
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  // Configurações dinâmicas carregadas do backend
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [slotInterval, setSlotInterval] = useState(30);
  const [workDays, setWorkDays] = useState(['seg','ter','qua','qui','sex','sab']);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [allowOnlineBooking, setAllowOnlineBooking] = useState(true);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(60);

  const today = startOfToday();
  const dayNameMap = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };
  const nextDays = Array.from({ length: maxAdvanceDays + 1 }).map((_, i) => addDays(today, i))
    .filter(date => workDays.includes(dayNameMap[date.getDay()]));
  const groupedDays = nextDays.reduce((acc, date) => {
    const month = safeFormat(date, 'MMMM yyyy', { locale: ptBR });
    if (!acc[month]) acc[month] = [];
    acc[month].push(date);
    return acc;
  }, {});

  // Gerar horários dinamicamente a partir das configurações e agendamentos existentes
  const timeSlots = useMemo(() => {
    const rangeStart = reschedulingAppointmentId ? shiftTime(workStart, -60) : workStart;
    const rangeEnd = reschedulingAppointmentId ? shiftTime(workEnd, 60) : workEnd;
    return buildTimeSlots(rangeStart, rangeEnd, slotInterval, false, busyAppointments);
  }, [workStart, workEnd, slotInterval, busyAppointments, reschedulingAppointmentId]);

  useEffect(() => {
    api.get('/api/services')
      .then(res => setServices(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setServices([]));
    api.get('/api/professionals')
      .then(res => setProfessionals(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setProfessionals([]));
    api.get('/api/settings').then(res => {
      const settings = Array.isArray(res.data?.data) ? res.data.data : [];
      setAllSettings(settings);
      const bName = settings.find(s => s.key === 'business_name');
      if(bName) setBusinessName(bName.value);
      const wMsg = settings.find(s => s.key === 'whatsapp_message');
      if(wMsg) setWhatsappTemplate(resolveClientBookingWhatsappTemplate(wMsg.value));
      const baseSchedule = buildEffectiveSchedule(settings);
      setWorkStart(baseSchedule.workStart);
      setWorkEnd(baseSchedule.workEnd);
      setSlotInterval(Number(baseSchedule.slotInterval));
      setWorkDays(baseSchedule.workDays);
      const wn = settings.find(s => s.key === 'whatsapp_number');
      if(wn) setWhatsappNumber(wn.value);
      const ao = settings.find(s => s.key === 'allow_online_booking');
      if(ao) setAllowOnlineBooking(ao.value === 'true');
      const mad = settings.find(s => s.key === 'max_advance_days');
      if(mad) setMaxAdvanceDays(Number(mad.value));
      const profileSetting = settings.find(s => s.key === 'public_profile');
      if (profileSetting?.value) {
        try {
          const parsedProfile = JSON.parse(profileSetting.value);
          setPublicProfile(normalizePublicProfile(parsedProfile));
        } catch {
          setPublicProfile({});
        }
      }
    }).catch(() => setAllSettings([]));

    api.get('/api/availability/next?limit=5')
      .then(response => setQuickSlots(response.data.data || []))
      .catch(() => setQuickSlots([]))
      .finally(() => setQuickSlotsLoading(false));

  }, []);

  useEffect(() => {
    let active = true;
    api.get('/api/session')
      .then(response => {
        const session = response.data.data;
        if (!active || session?.type !== 'client') return;
        const nextClient = { ...emptyClientData, name: session.name, phone: session.phone };
        setClientData(nextClient);
        setLoginName(session.name);
        setLoginPhone(session.phone);
        setClientAuthenticated(true);
        localStorage.setItem('client_portal_data', JSON.stringify(nextClient));
      })
      .catch(() => {
        if (active) setClientAuthenticated(false);
      });
    return () => { active = false; };
  }, []);

  // Quando o profissional muda, usa o horário DELE diretamente da API
  // O backend já calcula o expediente efetivo de cada profissional em GET /api/professionals
  useEffect(() => {
    if (!selectedPro) {
      // Sem profissional selecionado — usa configuração global
      if (allSettings.length === 0) return;
      const globalSchedule = buildEffectiveSchedule(allSettings);
      console.log('[Schedule] Global:', globalSchedule);
      setWorkStart(globalSchedule.workStart);
      setWorkEnd(globalSchedule.workEnd);
      setSlotInterval(Number(globalSchedule.slotInterval));
      setWorkDays(globalSchedule.workDays);
    } else {
      // Profissional selecionado — usa os dados dele vindos do backend
      console.log('[Schedule] Profissional selecionado:', selectedPro.name, {
        work_start: selectedPro.work_start,
        work_end: selectedPro.work_end,
        slot_interval: selectedPro.slot_interval,
        work_days: selectedPro.work_days
      });
      setWorkStart(selectedPro.work_start || '09:00');
      setWorkEnd(selectedPro.work_end || '18:00');
      setSlotInterval(Number(selectedPro.slot_interval) || 30);
      if (Array.isArray(selectedPro.work_days) && selectedPro.work_days.length > 0) {
        setWorkDays(selectedPro.work_days);
      } else {
        setWorkDays(['seg','ter','qua','qui','sex','sab']);
      }
    }
    setSelectedTime(null);
    setSelectedDate(null);
  }, [allSettings, selectedPro]);

  const totalDuration = useMemo(() => selectedServices.reduce((sum, s) => sum + (Number(s.duration) || 0), 0), [selectedServices]);
  const totalPrice = useMemo(() => selectedServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0), [selectedServices]);


  const loadMyAppointments = () => {
    setLoadingHistory(true);
    return api.get('/api/clients/my-history?type=all')
      .then(res => {
        setMyAppointments(res.data.data || []);
      })
      .catch(err => {
        if (err.response?.status === 401) setClientAuthenticated(false);
        setMyAppointments([]);
      })
      .finally(() => setLoadingHistory(false));
  };

  const activateClientSession = async (client) => {
    const nextClient = { ...emptyClientData, ...client };
    setClientData(nextClient);
    setLoginName(nextClient.name || '');
    setLoginPhone(nextClient.phone || loginPhone);
    setClientAuthenticated(true);
    setAccountStage('phone');
    setLoginCode('');
    setAccountMessage('');
    localStorage.setItem('client_portal_data', JSON.stringify(nextClient));
    await loadMyAppointments();
  };

  const handleRequestClientCode = async () => {
    if (accountLoading || loginPhone.replace(/\D/g, '').length < 10) return;
    setAccountError('');
    setAccountMessage('');
    setAccountLoading(true);
    try {
      await api.post('/api/client-auth/request-code', { phone: loginPhone });
      setAccountStage('code');
      setLoginCode('');
      setAccountMessage('Enviamos um código de 6 dígitos para o seu WhatsApp. Ele expira em poucos minutos.');
    } catch (err) {
      if (err.response?.data?.code === 'OTP_NOT_CONFIGURED') {
        setAccountStage('legacy');
        setAccountError('');
        setAccountMessage('Digite seu nome abaixo para acessar sua conta rapidamente.');
      } else {
        // Fallback direto em caso de falha de envio
        setAccountStage('legacy');
        setAccountError('');
        setAccountMessage('Identifique-se com seu nome para consultar seus agendamentos.');
      }
    } finally {
      setAccountLoading(false);
    }
  };

  const handleVerifyClientCode = async () => {
    if (accountLoading || !/^\d{6}$/.test(loginCode)) return;
    setAccountError('');
    setAccountLoading(true);
    try {
      const response = await api.post('/api/client-auth/verify-code', { phone: loginPhone, code: loginCode });
      await activateClientSession(response.data.data);
    } catch (err) {
      setAccountError(err.response?.data?.error || 'Código inválido ou expirado. Solicite um novo código.');
    } finally {
      setAccountLoading(false);
    }
  };

  const handleClientLogin = async () => {
    if (accountLoading || loginPhone.replace(/\D/g, '').length < 10) return;
    setAccountError('');
    setAccountLoading(true);
    try {
      const response = await api.post('/api/client/login', { name: loginName, phone: loginPhone });
      await activateClientSession(response.data.data);
    } catch (err) {
      setAccountError(err.response?.data?.error || 'Não foi possível acessar a conta agora. Confira seu WhatsApp.');
    } finally {
      setAccountLoading(false);
    }
  };

  const handleClientLogout = async () => {
    try {
      await api.post('/api/logout');
    } finally {
      setClientAuthenticated(false);
      setClientData(emptyClientData);
      setLoginPhone('');
      setLoginName('');
      setMyAppointments([]);
      setAccountError('');
      setAccountMessage('');
      setAccountStage('phone');
      setLoginCode('');
      localStorage.removeItem('client_portal_data');
    }
  };

  useEffect(() => {
     if (showAccountModal && clientAuthenticated) {
        loadMyAppointments();
     }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAccountModal, clientAuthenticated]);

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  const [confirmError, setConfirmError] = useState(null);

  const handleConfirm = async () => {
    if (bookingSubmitting) return;
    const isRescheduling = Boolean(reschedulingAppointmentId);
    const payload = {
      client_name: clientData.name,
      client_phone: clientData.phone,
      service_id: selectedServices[0]?.id,
      service_ids: selectedServices.map(s => s.id),
      professional_id: selectedPro.id,
      date: appointmentDate(selectedDate),
      time: selectedTime,
      notes: ''
    };
    
    localStorage.setItem('client_portal_data', JSON.stringify(clientData));
    setConfirmError(null);
    setRescheduleContactRequired(false);
    setBookingSubmitting(true);

    try {
      const response = isRescheduling
        ? await api.put(`/api/appointments/${reschedulingAppointmentId}/reschedule`, {
            date: payload.date,
            time: payload.time
          })
        : await api.post('/api/appointments', payload);

      if (isRescheduling) setReschedulingAppointmentId(null);
      if (response.data.client_authenticated && response.data.client) {
        const nextClient = { ...emptyClientData, ...response.data.client };
        setClientData(nextClient);
        setClientAuthenticated(true);
        setLoginName(nextClient.name);
        setLoginPhone(nextClient.phone);
        localStorage.setItem('client_portal_data', JSON.stringify(nextClient));
      }
      setWasRescheduled(isRescheduling);
      setStep(6);
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Ops! Não foi possível confirmar seu agendamento. Por favor, tente novamente.';
      setRescheduleContactRequired(err.response?.data?.code === 'CLIENT_RESCHEDULE_CONTACT_REQUIRED');
      setConfirmError(errorMsg);
    } finally {
      setBookingSubmitting(false);
    }
  };

  const navigate = useNavigate();
  const location = useLocation();

  const beginBooking = () => {
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePublicService = (service) => {
    setSelectedServices([service]);
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePublicProfessional = (professional) => {
    setSelectedPro(professional);
    setStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleQuickSlot = (slot) => {
    const professional = professionals.find(item => String(item.id) === String(slot.professional_id));
    setQuickSlotIntent(slot);
    if (professional) setSelectedPro(professional);
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Efeito para lidar com o estado de remarcação
  useEffect(() => {
    if (location.state && location.state.reschedule) {
      const { appointmentId, serviceId, professionalId } = location.state;
      setReschedulingAppointmentId(appointmentId || null);
      if (services.length > 0) {
        const s = services.find(srv => srv.id === serviceId);
        if (s) setSelectedServices([s]);
      }
      if (professionals.length > 0) {
        const p = professionals.find(pro => pro.id === professionalId);
        if (p) setSelectedPro(p);
      }
      setStep(3); // Remarcação: vai direto para a escolha de data e horário.
    }
  }, [location.state, services, professionals]);

  useEffect(() => {
    if (!quickSlotIntent || selectedServices.length === 0) return;
    const professional = professionals.find(item => String(item.id) === String(quickSlotIntent.professional_id));
    if (professional && String(selectedPro?.id) !== String(professional.id)) {
      setSelectedPro(professional);
      return;
    }
    if (!quickSlotIntent.date || !quickSlotIntent.time) {
      setQuickSlotIntent(null);
      return;
    }
    setSelectedDate(parseISO(quickSlotIntent.date));
    setSelectedTime(quickSlotIntent.time);
    setStep(3);
    setQuickSlotIntent(null);
  }, [quickSlotIntent, professionals, selectedPro, selectedServices]);

  const timeToMinutes = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  useEffect(() => {
    if (selectedDate && selectedPro) {
      const dStr = appointmentDate(selectedDate);
      const excludedAppointment = reschedulingAppointmentId
        ? `&exclude_appointment_id=${encodeURIComponent(reschedulingAppointmentId)}`
        : '';
      api.get(`/api/availability?date=${dStr}&professional_id=${selectedPro.id}${excludedAppointment}`)
        .then(res => setBusyAppointments(res.data.data))
        .catch(console.error);
    }
  }, [selectedDate, selectedPro, reschedulingAppointmentId]);

  const filteredTimeSlots = useMemo(() => {
    return timeSlots.filter(slot => {
      // Se não escolheu serviços ou profissional, não filtra por conflito ainda
      if (selectedServices.length === 0 || !selectedPro) return true;
      
      const slotStart = timeToMinutes(slot);
      const slotEnd = slotStart + totalDuration;
      const scheduleStart = timeToMinutes(workStart) - (reschedulingAppointmentId ? 60 : 0);
      const scheduleEnd = timeToMinutes(workEnd) + (reschedulingAppointmentId ? 60 : 0);

      if (selectedDate) {
        const slotDate = new Date(selectedDate);
        const [hours, minutes] = slot.split(':').map(Number);
        slotDate.setHours(hours, minutes, 0, 0);
        if (!isAfter(slotDate, new Date())) return false;
      }

      if (slotStart < scheduleStart || slotEnd > scheduleEnd) return false;
      
      // Regra de Ouro da Agenda: (InícioA < FimB) && (FimA > InícioB) -> CONFLITO
      const hasConflict = busyAppointments.some(app => {
        if (app.status === 'cancelado') return false;
        
        const exStart = timeToMinutes(app.time);
        const exDuration = Number(app.service_duration) || 30;
        const exEnd = exStart + exDuration;
        
        const isOverlapping = (slotStart < exEnd && slotEnd > exStart);
        return isOverlapping;
      });
      
      return !hasConflict;
    });
  }, [timeSlots, busyAppointments, selectedServices, totalDuration, selectedPro, selectedDate, workStart, workEnd, reschedulingAppointmentId]);

  const handleRescheduleSupport = () => {
    const digits = String(whatsappNumber || '').replace(/\D/g, '');
    if (digits.length < 10) {
      setConfirmError('O WhatsApp da equipe ainda não foi configurado. Entre em contato diretamente com a profissional responsável.');
      return;
    }
    const destination = digits.length <= 11 ? `55${digits}` : digits;
    const message = [
      'Olá! Preciso de ajuda para remarcar meu horário fora do limite disponível no site.',
      `Cliente: ${clientData.name || 'não informado'}`,
      `Profissional: ${selectedPro?.name || 'não informada'}`,
      `Data desejada: ${selectedDate ? safeFormat(selectedDate, 'dd/MM/yyyy') : 'não informada'}`,
      `Horário desejado: ${selectedTime || 'não informado'}`
    ].join('\n');
    window.open(`https://wa.me/${destination}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  const handleWhatsApp = () => {
    const digits = String(whatsappNumber || '').replace(/\D/g, '');
    if (digits.length < 10) {
      setConfirmError('O WhatsApp da equipe ainda não foi configurado. Seu agendamento continua confirmado.');
      return;
    }
    const destination = digits.length <= 11 ? `55${digits}` : digits;
    const msg = fillClientBookingWhatsappMessage(whatsappTemplate, {
      cliente: clientData.name,
      servico: selectedServices.map(s => s.name).join(' + '),
      profissional: selectedPro?.name || '',
      data: selectedDate ? safeFormat(selectedDate, 'dd/MM/yyyy') : '',
      hora: selectedTime || ''
    });
    window.open(`https://wa.me/${destination}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  };

  const calendarBooking = {
    selectedServices,
    selectedPro,
    selectedDate,
    selectedTime,
    totalDuration,
    totalPrice,
    businessName,
    location: publicProfile.address || ''
  };

  const handleGoogleCalendar = () => {
    try {
      const calendarUrl = buildGoogleCalendarUrl(calendarBooking);
      window.open(calendarUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setConfirmError('Não foi possível preparar o calendário agora.');
    }
  };

  const handleDownloadCalendar = () => {
    try {
      downloadIcsFile(calendarBooking);
    } catch {
      setConfirmError('Não foi possível baixar o compromisso agora.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-background text-foreground">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-primary-light/30 dark:bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-[-10%] w-[600px] h-[600px] bg-primary-light/20 dark:bg-primary/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Auth / Minha Conta Modal */}
      {showAccountModal && (
         <div className="fixed inset-0 bg-background/80 backdrop-blur z-50 flex items-center justify-center p-4">
            <div className="bg-card w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-border" role="dialog" aria-modal="true" aria-labelledby="client-account-title">
               <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
                  <h3 id="client-account-title" className="text-xl font-serif text-foreground">Minha Conta</h3>
                  <button onClick={() => setShowAccountModal(false)} className="text-muted hover:text-foreground fade-in transition-colors p-2 rounded-lg" aria-label="Fechar minha conta"><X size={20}/></button>
               </div>
               <div className="p-6">
                 {!clientAuthenticated ? (
                    <div>
                       <p className="text-muted mb-5">Acesse seus agendamentos rapidamente informando seu WhatsApp cadastrado.</p>
                       {accountError && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400" role="alert">{accountError}</div>}
                       {accountMessage && <div className="mb-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-sm text-green-700 dark:text-green-300" role="status">{accountMessage}</div>}
                       
                       <label htmlFor="client-account-phone" className="block text-sm font-semibold text-foreground mb-2">WhatsApp</label>
                       <input id="client-account-phone" type="tel" inputMode="tel" autoComplete="tel" className="input-field mb-4" placeholder="(11) 99999-9999" value={loginPhone} onChange={e=>setLoginPhone(e.target.value)} disabled={accountLoading} />

                       {accountStage === 'code' && (
                         <>
                           <label htmlFor="client-account-code" className="block text-sm font-semibold text-foreground mb-2">Código de 6 dígitos</label>
                           <input id="client-account-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength="6" className="input-field mb-5 text-center text-xl tracking-[0.35em]" placeholder="000000" value={loginCode} onChange={e => setLoginCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={accountLoading} />
                           <button className="btn-primary w-full" onClick={handleVerifyClientCode} disabled={accountLoading || !/^\d{6}$/.test(loginCode)}>
                             {accountLoading ? 'Validando...' : 'Confirmar e acessar'}
                           </button>
                           <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                             <button type="button" className="text-muted underline hover:text-foreground" onClick={() => { setAccountStage('phone'); setLoginCode(''); setAccountError(''); setAccountMessage(''); }}>Trocar número</button>
                             <button type="button" className="text-primary font-bold hover:underline" onClick={() => { setAccountStage('legacy'); setAccountError(''); setAccountMessage('Informe seu nome para acessar diretamente.'); }}>Entrar com Nome</button>
                           </div>
                         </>
                       )}

                       {accountStage === 'phone' && (
                         <div className="space-y-3">
                           <button className="btn-primary w-full" onClick={handleRequestClientCode} disabled={accountLoading || loginPhone.replace(/\D/g, '').length < 10}>
                             {accountLoading ? 'Acessando...' : 'Receber código no WhatsApp'}
                           </button>
                           <button type="button" className="w-full text-xs text-muted hover:text-primary transition-colors text-center block pt-1" onClick={() => { setAccountStage('legacy'); setAccountError(''); setAccountMessage(''); }}>
                             Prefere entrar diretamente com Nome e WhatsApp?
                           </button>
                         </div>
                       )}

                       {accountStage === 'legacy' && (
                         <>
                           <label htmlFor="client-account-name" className="block text-sm font-semibold text-foreground mb-2">Seu Nome Completo</label>
                           <input id="client-account-name" type="text" autoComplete="name" className="input-field mb-5" placeholder="Como no seu agendamento" value={loginName} onChange={e=>setLoginName(e.target.value)} disabled={accountLoading} />
                           <button className="btn-primary w-full" onClick={handleClientLogin} disabled={accountLoading || loginPhone.replace(/\D/g, '').length < 10}>
                             {accountLoading ? 'Acessando...' : 'Entrar na Minha Conta'}
                           </button>
                           <div className="mt-4 text-center">
                             <button type="button" className="text-xs text-muted underline hover:text-foreground" onClick={() => { setAccountStage('phone'); setAccountError(''); setAccountMessage(''); }}>
                               Voltar para opção de código
                             </button>
                           </div>
                         </>
                       )}

                       <p className="text-xs text-muted text-center mt-4">Primeira vez? Faça um agendamento ou informe seus dados para criar a conta automaticamente.</p>
                    </div>
                 ) : (
                    <div className="animate-in fade-in">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex flex-col gap-1">
                               <p className="text-sm text-primary font-semibold uppercase tracking-wider">Bem-vinda(o),</p>
                               <p className="text-2xl font-serif text-foreground leading-none">{clientData.name || clientData.phone}</p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                               <button 
                                 className="text-sm font-bold text-primary hover:bg-primary/5 px-3 py-1 rounded-lg transition-all flex items-center gap-1"
                                 onClick={() => { setShowAccountModal(false); navigate('/meu-perfil'); }}
                               >
                                 Gerenciar Conta <ExternalLink size={14} />
                               </button>
                               <button className="text-xs underline text-muted hover:text-foreground" onClick={handleClientLogout}>Sair com segurança</button>
                            </div>
                        </div>
                        
                        <div className="max-h-[350px] overflow-y-auto space-y-4 custom-scrollbar pr-3">
                            {loadingHistory ? (
                                <div className="py-20 text-center animate-pulse">
                                   <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
                                   <p className="text-sm text-muted">Buscando seus agendamentos...</p>
                                </div>
                            ) : myAppointments.filter(app => {
                                const appDate = parseISO(app.date);
                                const lastDayOfWeek = endOfWeek(today, { weekStartsOn: 0 }); // Domingo a Sábado
                                return app.status !== 'cancelado' && isWithinInterval(appDate, { start: today, end: lastDayOfWeek });
                            }).length === 0 ? (
                                <div className="text-center py-10 opacity-40 animate-in fade-in">
                                   <Calendar size={48} className="mx-auto mb-2" />
                                   <p className="text-sm">Nenhum agendamento para esta semana.</p>
                                </div>
                            ) : (
                                myAppointments
                                  .filter(app => {
                                      const appDate = parseISO(app.date);
                                      const lastDayOfWeek = endOfWeek(today, { weekStartsOn: 0 });
                                      return app.status !== 'cancelado' && isWithinInterval(appDate, { start: today, end: lastDayOfWeek });
                                  })
                                  .sort((a, b) => (parseDateTime(a.date, a.time)?.getTime() || 0) - (parseDateTime(b.date, b.time)?.getTime() || 0))
                                  .map(app => (
                                    <div key={app.id} className="group relative bg-muted/10 border border-border/50 rounded-2xl p-5 transition-all hover:border-primary/40 hover:bg-muted/20">
                                       <div className="flex justify-between items-start mb-4">
                                          <div>
                                             <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded">
                                                  Confirmado
                                                </span>
                                             </div>
                                             <h5 className="text-lg font-serif text-foreground">{app.service_name}</h5>
                                          </div>
                                          <div className="text-right">
                                             <p className="text-xl font-bold text-foreground">{app.time}</p>
                                        <p className="text-[10px] text-muted uppercase font-bold tracking-widest mt-1">{safeFormatDate(app.date, "dd MMM", {locale: ptBR})}</p>
                                          </div>
                                       </div>
                                       <div className="flex items-center justify-between pt-4 border-t border-border/30">
                                          <div className="flex items-center gap-2 text-sm text-muted">
                                             <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold">
                                                {app.professional_name?.charAt(0)}
                                             </div>
                                             <span className="font-medium">{app.professional_name}</span>
                                          </div>
                                          <div className="text-primary font-bold text-sm">
                                             R$ {Number(app.service_price || 0).toFixed(2)}
                                          </div>
                                       </div>
                                    </div>
                                ))
                            )}
                         </div>
                    </div>
                 )}
               </div>
            </div>
         </div>
      )}

      <header className="fixed top-0 left-0 right-0 py-3.5 md:py-5 px-4 md:px-10 border-b border-border/50 z-50 flex justify-between items-center bg-background/95 backdrop-blur-2xl shadow-sm transition-all">
        <h1 className="text-base md:text-2xl font-serif text-foreground tracking-wider md:tracking-widest flex items-center gap-2 md:gap-3 whitespace-nowrap">
          <img src="/assets/images/logo.png" alt="Mary Esmalteria" className="w-8 h-8 md:w-10 md:h-10 rounded-full object-contain" />
          {businessName}
        </h1>
        {step === 0 && (
          <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-muted" aria-label="Navegação principal">
            <a href="#servicos" className="hover:text-primary transition-colors">Serviços</a>
            <a href="#portfolio" className="hover:text-primary transition-colors">Portfólio</a>
            <a href="#localizacao" className="hover:text-primary transition-colors">Localização</a>
          </nav>
        )}
        <div className="flex items-center gap-2 md:gap-4">
          <button onClick={() => setIsDark(!isDark)} className="text-muted hover:text-foreground transition-colors p-2" aria-label={isDark ? 'Usar tema claro' : 'Usar tema escuro'}>
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button onClick={() => setShowAccountModal(true)} className="flex items-center gap-2 text-xs md:text-sm font-medium text-foreground bg-primary/10 hover:bg-primary/20 px-3 md:px-4 py-2 rounded-full transition-colors border border-primary/20" aria-label={clientAuthenticated ? 'Abrir minha conta' : 'Entrar na minha conta'}>
             <User size={16} /> <span className="hidden sm:inline">{clientAuthenticated ? 'Minha Conta' : 'Entrar'}</span>
          </button>
          {step === 0 && (
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-foreground hover:text-primary transition-colors rounded-lg border border-border/60 bg-muted/20"
              aria-label="Abrir menu mobile"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}
        </div>
      </header>

      {/* Menu Drawer Mobile Dropdown */}
      {step === 0 && mobileMenuOpen && (
        <div className="fixed top-[61px] left-0 right-0 z-40 bg-background/95 backdrop-blur-2xl border-b border-border/80 p-5 shadow-2xl lg:hidden animate-in slide-in-from-top duration-300">
          <nav className="flex flex-col gap-3 text-base font-semibold text-foreground">
            <a 
              href="#servicos" 
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-3 rounded-xl hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <span>Serviços & Valores</span>
              <ChevronRight size={18} className="text-primary" />
            </a>
            <a 
              href="#portfolio" 
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-3 rounded-xl hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <span>Portfólio de Trabalhos</span>
              <ChevronRight size={18} className="text-primary" />
            </a>
            <a 
              href="#localizacao" 
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-3 rounded-xl hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <span>Onde Estamos (Mapa)</span>
              <ChevronRight size={18} className="text-primary" />
            </a>
            <div className="pt-2 border-t border-border/60 flex flex-col gap-3">
              <button 
                onClick={() => {
                  setMobileMenuOpen(false);
                  beginBooking();
                }}
                className="w-full btn-primary py-3.5 text-base font-bold shadow-lg flex items-center justify-center gap-2"
              >
                <Sparkles size={18} /> Agendar Horário Agora
              </button>
            </div>
          </nav>
        </div>
      )}

      <main className={`flex-1 flex flex-col items-center relative z-10 w-full pt-20 md:pt-24 ${step === 0 ? '' : 'justify-center p-6'}`}>
        
        {step === 0 && (
          <>
          <section className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-20 px-6 py-12 lg:py-20 animate-in fade-in duration-1000" aria-labelledby="home-title">
            
            {/* Left Column: Content */}
            <div className="flex-1 text-center lg:text-left">
              <span className="inline-block px-4 py-1.5 bg-primary/10 text-primary text-xs font-bold uppercase tracking-[0.2em] rounded-full mb-6">{publicProfile.heroEyebrow || 'Cuidado especializado para suas unhas'}</span>
              <h2 id="home-title" className="text-5xl md:text-7xl xl:text-8xl font-serif text-foreground mb-8 leading-[1.1]">
                Sua Beleza, <br/>
                <span className="text-primary italic relative">
                  Redefinida
                  <span className="absolute -bottom-2 left-0 h-1 w-full rounded-full bg-gradient-to-r from-primary/20 via-primary/70 to-primary/20" aria-hidden="true" />
                </span>
              </h2>
              <p className="text-lg md:text-xl text-muted mb-12 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                {publicProfile.heroSubtitle || `Escolha seu serviço, profissional e horário antes de informar seus dados. Um agendamento simples, transparente e feito no seu ritmo.`}
              </p>
              
              <div className="flex flex-col sm:flex-row items-center gap-6 justify-center lg:justify-start">
                <button onClick={beginBooking} className="btn-primary text-lg px-10 py-5 flex items-center gap-3 shadow-2xl shadow-primary/40 hover:-translate-y-1 transition-all group">
                  Agendar Agora <ChevronRight size={22} className="group-hover:translate-x-1 transition-transform" />
                </button>
                <a href="#servicos" className="inline-flex min-h-12 items-center gap-2 text-sm font-bold text-foreground hover:text-primary transition-colors">Ver serviços e valores <ArrowRight size={18} /></a>
              </div>
              <p className="mt-6 text-sm text-muted flex items-center justify-center lg:justify-start gap-2"><CheckCircle2 size={17} className="text-green-500" /> Consulte tudo antes de informar seus dados</p>
            </div>

            {/* Right Column: Arsty Portrait Gallery */}
             <div className="flex-1 relative w-full max-w-[500px] lg:max-w-none">
                <div className="grid grid-cols-2 gap-4 h-[500px] md:h-[650px]">
                   <div className="space-y-4 pt-12">
                      <FadeContent blur={true} duration={1200} delay={0}>
                        <div className="h-[21.5rem] rounded-2xl overflow-hidden glass-card-no-blur border-none shadow-2xl group cursor-pointer">
                           <img src="/assets/images/gallery/nail1.jpg" alt="Work 1" className="w-full h-full object-cover hover:scale-110 transition-transform duration-700" />
                        </div>
                      </FadeContent>
                      <FadeContent blur={true} duration={1200} delay={200}>
                        <div className="h-[12.5rem] rounded-2xl overflow-hidden glass-card-no-blur border-none shadow-xl group cursor-pointer">
                           <img src="/assets/images/gallery/nail2.jpg" alt="Work 2" className="w-full h-full object-cover hover:scale-110 transition-transform duration-700" />
                        </div>
                      </FadeContent>
                   </div>
                   <div className="space-y-4">
                      <FadeContent blur={true} duration={1200} delay={400}>
                        <div className="h-[14.5rem] rounded-2xl overflow-hidden glass-card-no-blur border-none shadow-xl group cursor-pointer">
                           <img src="/assets/images/gallery/nail3.jpg" alt="Work 3" className="w-full h-full object-cover hover:scale-110 transition-transform duration-700" />
                        </div>
                      </FadeContent>
                      <FadeContent blur={true} duration={1200} delay={600}>
                        <div className="h-[19.5rem] rounded-2xl overflow-hidden glass-card-no-blur border-none shadow-2xl group cursor-pointer">
                           <img src="/assets/images/gallery/nail4.jpg" alt="Work 4" className="w-full h-full object-cover hover:scale-110 transition-transform duration-700" />
                        </div>
                      </FadeContent>
                   </div>
                </div>
               
               {/* Decorative Element */}
               <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-primary/20 rounded-full blur-3xl -z-10 animate-pulse"></div>
               <div className="absolute -top-6 -right-6 w-40 h-40 bg-primary-light/30 rounded-full blur-3xl -z-10"></div>
            </div>

          </section>
          <PublicExperienceSections
            profile={{
              ...publicProfile,
              openingNote: publicProfile.openingNote || `${workDays.map(day => publicDayLabels[day] || day).join(', ')} · ${workStart} às ${workEnd}`
            }}
            businessName={businessName}
            whatsappNumber={whatsappNumber}
            services={services}
            professionals={professionals.filter(professional => !(professional.specialty?.toLowerCase().includes('sócio') || professional.specialty?.toLowerCase().includes('socio')))}
            quickSlots={quickSlots}
            quickSlotsLoading={quickSlotsLoading}
            links={{ privacy: '/privacidade', staff: '/admin' }}
            onBook={beginBooking}
            onSelectService={handlePublicService}
            onSelectProfessional={handlePublicProfessional}
            onSelectQuickSlot={handleQuickSlot}
          />
          </>
        )}

        {step > 0 && (
          <div className="w-full max-w-4xl fade-in-up">
            <div className="glass-card p-6 md:p-10 mb-20 bg-card/80 backdrop-blur-xl border border-border shadow-2xl rounded-3xl">
              
              {/* Stepper Navigator */}
              <div className="flex items-center justify-between gap-2 mb-10 text-[10px] md:text-sm font-bold uppercase tracking-[0.15em] text-muted/60 border-b border-border/50 pb-6 overflow-x-auto no-scrollbar">
                <div className={`flex items-center gap-2 shrink-0 ${step === 1 ? "text-primary scale-105" : step > 1 ? "text-green-500" : ""}`}>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${step === 1 ? "border-primary bg-primary/10" : step > 1 ? "border-green-500 bg-green-500 text-white" : "border-border"}`}>
                    {step > 1 ? <Check size={14} /> : "1"}
                  </span>
                  <span>Serviço</span>
                </div>
                <div className="h-px w-4 md:w-8 bg-border shrink-0"></div>
                
                <div className={`flex items-center gap-2 shrink-0 ${step === 2 ? "text-primary scale-105" : step > 2 ? "text-green-500" : ""}`}>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${step === 2 ? "border-primary bg-primary/10" : step > 2 ? "border-green-500 bg-green-500 text-white" : "border-border"}`}>
                    {step > 2 ? <Check size={14} /> : "2"}
                  </span>
                  <span>Profissional</span>
                </div>
                <div className="h-px w-4 md:w-8 bg-border shrink-0"></div>
                
                <div className={`flex items-center gap-2 shrink-0 ${step === 3 ? "text-primary scale-105" : step > 3 ? "text-green-500" : ""}`}>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${step === 3 ? "border-primary bg-primary/10" : step > 3 ? "border-green-500 bg-green-500 text-white" : "border-border"}`}>
                    {step > 3 ? <Check size={14} /> : "3"}
                  </span>
                  <span>Data/Hora</span>
                </div>
                <div className="h-px w-4 md:w-8 bg-border shrink-0"></div>
                
                <div className={`flex items-center gap-2 shrink-0 ${step === 4 ? "text-primary scale-105" : step > 4 ? "text-green-500" : ""}`}>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${step === 4 ? "border-primary bg-primary/10" : step > 4 ? "border-green-500 bg-green-500 text-white" : "border-border"}`}>
                    {step > 4 ? <Check size={14} /> : "4"}
                  </span>
                  <span>Seus dados</span>
                </div>
              </div>

              {/* Step 4: Identification only after the client has explored the options */}
              {step === 4 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-sm mx-auto text-center">
                   <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-6">
                      <User size={32} />
                   </div>
                    <h3 className="text-2xl font-serif text-foreground mb-2">Revise e confirme</h3>
                    <p className="text-muted text-sm mb-8">Agora só precisamos dos seus dados para reservar o horário escolhido.</p>

                    <div className="mb-8 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-left">
                      <p className="text-xs font-black uppercase tracking-widest text-primary mb-3">Resumo do agendamento</p>
                      <div className="space-y-2 text-sm text-foreground">
                        <p><strong>Serviço:</strong> {selectedServices.map(service => service.name).join(' + ')}</p>
                        <p><strong>Profissional:</strong> {selectedPro?.name}</p>
                        <p><strong>Quando:</strong> {selectedDate ? safeFormat(selectedDate, "dd/MM/yyyy", { locale: ptBR }) : ''} às {selectedTime}</p>
                        <p><strong>Total:</strong> R$ {totalPrice.toFixed(2)} · {totalDuration} min</p>
                      </div>
                    </div>
                   
                   <div className="space-y-4 text-left">
                      <div>
                         <label htmlFor="booking-client-phone" className="text-[10px] uppercase font-black text-primary tracking-widest ml-2 mb-1 block">WhatsApp</label>
                         <input 
                           id="booking-client-phone"
                           type="tel" 
                           inputMode="tel"
                           autoComplete="tel"
                          className="input-field text-center text-lg tracking-widest w-full" 
                          placeholder="(00) 00000-0000"
                          value={clientData.phone}
                          onChange={(e) => setClientData(prev => ({...prev, phone: e.target.value}))}
                        />
                      </div>

                      {clientData.phone.replace(/\D/g, '').length >= 10 && (
                        <div className="animate-in fade-in zoom-in-95 duration-500">
                          <div className="space-y-1">
                            <label htmlFor="booking-client-name" className="text-[10px] uppercase font-black text-primary tracking-widest ml-2 mb-1 block">Seu Nome Completo</label>
                            <input 
                              id="booking-client-name"
                              type="text"
                              autoComplete="name"
                              className="input-field w-full" 
                              placeholder="Como podemos te chamar?"
                              value={clientData.name}
                              onChange={(e) => setClientData(prev => ({...prev, name: e.target.value}))}
                              disabled={clientAuthenticated}
                            />
                            {clientAuthenticated && <p className="text-xs text-muted px-2 pt-1">Dados confirmados pela sua sessão.</p>}
                          </div>
                        </div>
                      )}
                   </div>
                </div>
              )}

              {/* Step 1: Service Selection */}
              {step === 1 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <h3 className="text-2xl font-serif text-foreground">Escolha o Serviço</h3>
                    <div className="relative w-full md:w-64">
                      <input 
                        type="text" 
                        placeholder="Buscar serviço..." 
                        value={serviceSearch}
                        onChange={(e) => setServiceSearch(e.target.value)}
                        className="input-field w-full pl-10"
                      />
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/50" size={16} />
                    </div>
                  </div>
                  <div className="space-y-10 custom-scrollbar max-h-[500px] overflow-y-auto pr-2">
                    {Object.entries(
                      services.filter(s => {
                        if (!serviceSearch) return true;
                        const term = serviceSearch.toLowerCase().trim();
                        return s.name.toLowerCase().includes(term) || s.description?.toLowerCase().includes(term);
                      }).reduce((acc, s) => {
                        const cat = s.category || 'Geral';
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(s);
                        return acc;
                      }, {})
                    ).map(([category, catServices]) => (
                      <div key={category} className="space-y-4">
                        <div className="flex items-center gap-3">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-primary bg-primary/5 px-3 py-1 rounded-full border border-primary/10">
                            {category}
                          </h4>
                          <div className="h-px flex-1 bg-border/40"></div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {catServices.map(s => {
                            const isSelected = selectedServices.some(item => item.id === s.id);
                            return (
                              <button
                                type="button"
                                aria-pressed={isSelected}
                                 key={s.id} 
                                className={`w-full p-5 rounded-2xl border cursor-pointer transition-all relative overflow-hidden group text-left ${isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'border-border bg-background/50 hover:border-primary/30'}`}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedServices(prev => prev.filter(item => item.id !== s.id));
                                  } else {
                                    setSelectedServices(prev => [...prev, s]);
                                  }
                                }}
                              >
                                {isSelected && (
                                  <div className="absolute top-2 right-2 text-primary animate-in zoom-in duration-300">
                                    <CheckCircle2 size={24} />
                                  </div>
                                )}
                                <div className="flex justify-between items-start mb-2 pr-8">
                                  <h4 className="text-lg font-serif font-medium text-foreground leading-tight">{s.name}</h4>
                                  <span className="text-xl font-bold text-primary">R$ {Number(s.price).toFixed(2)}</span>
                                </div>
                                {s.description && (
                                  <p className="text-sm text-muted mb-4 italic line-clamp-2">
                                    {s.description}
                                  </p>
                                )}
                                <div className="text-muted flex items-center gap-2 text-xs font-medium uppercase tracking-wider">
                                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                                    <Clock size={12} />
                                  </div>
                                  {s.duration} minutos
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Professional Selection */}
              {step === 2 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h3 className="text-2xl font-serif text-foreground mb-6">Escolha o Profissional</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {professionals.filter(p => !(p.specialty?.toLowerCase().includes('sócio') || p.specialty?.toLowerCase().includes('socio') || p.name?.toLowerCase().includes('sócio') || p.name?.toLowerCase().includes('socio'))).map(pro => (
                      <button
                        type="button"
                        aria-pressed={selectedPro?.id === pro.id}
                         key={pro.id}
                        className={`w-full p-6 rounded-2xl border cursor-pointer transition-all relative group ${selectedPro?.id === pro.id ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'border-border bg-background/50 hover:border-primary/30'}`}
                        onClick={() => setSelectedPro(pro)}
                      >
                        <div className="flex flex-col items-center text-center">
                          <div className={`w-20 h-20 rounded-full mb-4 border-2 flex items-center justify-center text-2xl font-bold transition-all ${selectedPro?.id === pro.id ? 'border-primary bg-primary text-white scale-110 shadow-lg' : 'border-border bg-muted/20 text-muted'}`}>
                            {pro.avatar || pro.name.charAt(0)}
                          </div>
                          <h4 className="text-xl font-serif text-foreground mb-1">{pro.name}</h4>
                          <p className="text-[10px] text-primary font-bold uppercase tracking-widest">{pro.specialty}</p>
                          
                          {selectedPro?.id === pro.id && (
                            <div className="absolute top-4 right-4 text-primary animate-in zoom-in duration-300">
                              <CheckCircle2 size={24} />
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Date & Time Selection */}
              {step === 3 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 grid grid-cols-1 lg:grid-cols-2 gap-10">
                  <div>
                    <h3 className="text-lg md:text-xl font-serif text-foreground mb-6">📅 Selecione o Melhor Dia</h3>
                    <div className="space-y-6 max-h-[350px] overflow-y-auto pr-3 custom-scrollbar">
                      {Object.entries(groupedDays).map(([month, days]) => (
                        <div key={month} className="mb-6">
                          <h4 className="text-xs font-bold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                             <span className="w-1 h-1 rounded-full bg-primary"></span>
                             {month}
                          </h4>
                          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 md:gap-3">
                            {days.map((d, i) => (
                               <button 
                                 key={i} 
                                 type="button"
                                 aria-pressed={selectedDate?.getTime() === d.getTime()}
                                 aria-label={safeFormat(d, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                                className={`aspect-[4/5] p-2 rounded-xl border flex flex-col items-center justify-center transition-all ${selectedDate?.getTime() === d.getTime() ? 'border-primary bg-primary text-white shadow-lg shadow-primary/30 scale-105' : 'border-border bg-background/50 text-muted hover:border-primary/50 hover:text-foreground'}`}
                                onClick={() => setSelectedDate(d)}
                              >
                                <span className="text-[10px] uppercase font-bold mb-1 opacity-70">{safeFormat(d, 'eee', {locale: ptBR})}</span>
                                <span className="text-lg md:text-xl font-bold">{safeFormat(d, 'dd')}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg md:text-xl font-serif text-foreground mb-6">⏰ Escolha seu Horário</h3>
                    {reschedulingAppointmentId && (
                      <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted">
                        <p>Você pode remarcar até 1 hora antes ou depois do expediente, desde que o horário esteja livre.</p>
                        <button type="button" onClick={handleRescheduleSupport} className="mt-2 font-bold text-primary hover:underline">
                          Precisa de outro horário? Fale com a equipe pelo WhatsApp
                        </button>
                      </div>
                    )}
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 md:gap-3">
                       {filteredTimeSlots.length > 0 ? (
                         filteredTimeSlots.map(t => (
                           <button 
                             key={t}
                             type="button"
                             aria-pressed={selectedTime === t}
                             className={`py-3 md:py-4 px-2 rounded-xl border font-bold transition-all text-sm md:text-base ${selectedTime === t ? 'border-primary bg-primary text-white shadow-lg shadow-primary/30' : 'border-border bg-background/50 text-muted hover:border-primary/30 hover:text-foreground'}`}
                             onClick={() => setSelectedTime(t)}
                           >
                             {t}
                           </button>
                         ))
                       ) : (
                         <div className="col-span-full py-10 text-center opacity-40">
                            <Clock size={32} className="mx-auto mb-2" />
                            <p className="text-sm">Nenhum horário disponível.</p>
                         </div>
                       )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 6: Success Screen (Internal use 6 for post-booking) */}
              {step === 6 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-center py-10">
                    <div className="relative inline-block mb-6">
                      <CheckCircle2 size={64} className="text-green-500" />
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-background rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-ping"></div>
                      </div>
                    </div>
                    <h3 className="text-3xl font-serif text-foreground mb-2">{wasRescheduled ? 'Agendamento Remarcado!' : 'Agendamento Realizado!'}</h3>
                    <p className="text-muted mb-8 max-w-sm mx-auto">
                      {wasRescheduled
                        ? 'Seu novo horário foi salvo e o agendamento anterior foi atualizado com sucesso.'
                        : 'Sua reserva foi confirmada com sucesso em nossa base de dados.'}
                    </p>
                    
                    <div className="bg-primary/5 border border-primary/20 rounded-2xl p-8 mb-8 inline-block text-left text-foreground w-full">
                       <p className="mb-2"><strong className="text-muted uppercase text-[10px] tracking-widest mr-2">Serviços:</strong> {selectedServices.map(s => s.name).join(' + ')}</p>
                       <p className="mb-2"><strong className="text-muted uppercase text-[10px] tracking-widest mr-2">Total:</strong> R$ {totalPrice.toFixed(2)} ({totalDuration} min)</p>
                       <p className="mb-2"><strong className="text-muted uppercase text-[10px] tracking-widest mr-2">Profissional:</strong> {selectedPro?.name}</p>
                       <p className="mb-2"><strong className="text-muted uppercase text-[10px] tracking-widest mr-2">Data:</strong> {selectedDate ? safeFormat(selectedDate, "dd 'de' MMMM, yyyy", {locale: ptBR}) : ''}</p>
                       <p><strong className="text-muted uppercase text-[10px] tracking-widest mr-2">Horário:</strong> {selectedTime}</p>
                    </div>

                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl mx-auto">
                       <button onClick={handleWhatsApp} className="btn-primary w-full flex justify-center items-center gap-2 py-4 shadow-xl shadow-primary/30">
                         Avisar no WhatsApp
                       </button>
                       <button onClick={handleGoogleCalendar} className="btn-outline w-full flex justify-center items-center gap-2 py-4">
                         <Calendar size={18} /> Google Agenda
                       </button>
                       <button onClick={handleDownloadCalendar} className="btn-secondary w-full flex justify-center items-center gap-2 py-4">
                         <Calendar size={18} /> Baixar calendário
                       </button>
                       {(publicProfile.mapsUrl || publicProfile.address) && (
                         <a href={publicProfile.mapsUrl || buildMapUrl(publicProfile.address)} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full flex justify-center items-center gap-2 py-4">
                           <ExternalLink size={18} /> Abrir localização
                         </a>
                       )}
                     </div>
                     <div className="flex flex-col gap-3 items-center mt-5">
                       {clientAuthenticated && (
                         <button onClick={() => navigate('/meu-perfil')} className="text-primary hover:underline text-sm font-bold">Gerenciar meus agendamentos</button>
                       )}
                       <button onClick={() => setStep(0)} className="text-muted hover:text-foreground text-sm font-bold uppercase tracking-widest transition-colors mt-4">
                         Finalizar e Voltar
                       </button>
                     </div>
                  </div>
              )}

              {/* Error Alert */}
              {confirmError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
                  <X size={20} className="text-red-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-red-500 font-medium">{confirmError}</p>
                    {rescheduleContactRequired && (
                      <button type="button" onClick={handleRescheduleSupport} className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-700">
                        Pedir esse horário pelo WhatsApp
                      </button>
                    )}
                  </div>
                  <button onClick={() => { setConfirmError(null); setRescheduleContactRequired(false); }} className="ml-auto text-red-400 hover:text-red-600 shrink-0"><X size={16} /></button>
                </div>
              )}

              {/* Stepper Controls */}
              {step > 0 && step < 5 && (
                <div className="flex justify-between items-center mt-10 pt-6 border-t border-border border-dashed">
                  <button onClick={handleBack} className="text-muted hover:text-foreground flex items-center gap-2 transition-colors font-bold uppercase tracking-widest text-[10px]">
                    <ArrowLeft size={18} /> Voltar
                  </button>
                  <button 
                    onClick={() => {
                      if (step === 4) handleConfirm();
                      else handleNext();
                    }} 
                    disabled={
                      (step === 1 && selectedServices.length === 0) ||
                      (step === 2 && !selectedPro) ||
                      (step === 3 && (!selectedDate || !selectedTime)) ||
                      (step === 4 && (!clientData.name || clientData.phone.replace(/\D/g, '').length < 10 || bookingSubmitting))
                    } 
                    className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {step === 4
                      ? (bookingSubmitting ? 'Confirmando...' : (reschedulingAppointmentId ? 'Confirmar Remarcação' : 'Confirmar Agendamento'))
                      : 'Próximo Passo'} <ChevronRight size={18} />
                  </button>
                </div>
              )}

            </div>
          </div>
        )}

      </main>

      {/* Floating Bottom Action Bar para Celular */}
      {step === 0 && (
        <div className="fixed bottom-3 left-3 right-3 z-40 flex items-center gap-2 lg:hidden bg-zinc-950/95 backdrop-blur-xl p-2.5 rounded-2xl border border-border/80 shadow-2xl animate-in slide-in-from-bottom duration-500">
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              beginBooking();
            }}
            className="flex-1 btn-primary py-3.5 text-sm font-bold shadow-lg flex items-center justify-center gap-2 rounded-xl"
          >
            <Sparkles size={18} /> Agendar Horário 💖
          </button>
          <a
            href="https://wa.me/5511988853773"
            target="_blank"
            rel="noreferrer noopener"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs p-3.5 rounded-xl flex items-center justify-center gap-1 shadow-md transition-colors shrink-0"
            aria-label="Falar no WhatsApp"
          >
            WhatsApp 💬
          </a>
        </div>
      )}
    </div>
  );
}
