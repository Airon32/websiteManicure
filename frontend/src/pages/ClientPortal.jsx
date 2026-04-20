import React, { useState, useEffect, useMemo } from 'react';
import { format, addDays, startOfToday, parseISO, isAfter, endOfWeek, isWithinInterval } from 'date-fns';
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
import { useNavigate, useLocation } from 'react-router-dom';
import FadeContent from '../components/FadeContent';
import { buildEffectiveSchedule, buildTimeSlots } from '../utils/schedule';

export default function ClientPortal() {
  const [step, setStep] = useState(0);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [allSettings, setAllSettings] = useState([]);
  const [businessName, setBusinessName] = useState('Ateliê Pink');
  const [whatsappTemplate, setWhatsappTemplate] = useState('Olá! Gostaria de confirmar meu agendamento.\n\n*Serviço:* {servico}\n*Profissional:* {profissional}\n*Data:* {data}\n*Horário:* {hora}\n*Nome:* {cliente}');
  const [selectedService, setSelectedService] = useState(null);
  const [selectedPro, setSelectedPro] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [clientData, setClientData] = useState(() => {
    const saved = localStorage.getItem('client_portal_data');
    return saved ? JSON.parse(saved) : { name: '', phone: '', email: '' };
  });
  
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [loginPhone, setLoginPhone] = useState(() => {
    const saved = localStorage.getItem('client_portal_data');
    return saved ? JSON.parse(saved).phone : '';
  });
  const [loginName, setLoginName] = useState('');
  const [myAppointments, setMyAppointments] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
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
  const nextDays = Array.from({ length: maxAdvanceDays }).map((_, i) => addDays(today, i))
    .filter(date => workDays.includes(dayNameMap[date.getDay()]));
  const groupedDays = nextDays.reduce((acc, date) => {
    const month = format(date, 'MMMM yyyy', { locale: ptBR });
    if (!acc[month]) acc[month] = [];
    acc[month].push(date);
    return acc;
  }, {});

  // Gerar horários dinamicamente a partir das configurações
  const timeSlots = useMemo(() => buildTimeSlots(workStart, workEnd, slotInterval), [workStart, workEnd, slotInterval]);

  useEffect(() => {
    api.get('/api/services').then(res => setServices(res.data.data)).catch(console.error);
    api.get('/api/professionals').then(res => setProfessionals(res.data.data)).catch(console.error);
    api.get('/api/settings').then(res => {
      const settings = res.data.data;
      setAllSettings(settings);
      const bName = settings.find(s => s.key === 'business_name');
      if(bName) setBusinessName(bName.value);
      const wMsg = settings.find(s => s.key === 'whatsapp_message');
      if(wMsg) setWhatsappTemplate(wMsg.value);
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
    }).catch(console.error);

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


  const loadMyAppointments = (phone, name = "") => {
    setLoadingHistory(true);
    const cleanPhone = phone ? phone.replace(/\D/g, "") : "";
    
    // Tenta a rota principal
    api.get(`/api/appointments?client_phone=${cleanPhone}`)
      .then(res => {
         const list = res.data.data;
         setMyAppointments(list);
         if (list.length > 0 && !clientData.name) {
             const foundName = list[0].client_name;
             setClientData(prev => ({...prev, name: foundName, phone: cleanPhone }));
             setLoginName(foundName);
             localStorage.setItem('client_portal_data', JSON.stringify({name: foundName, phone: cleanPhone}));
         }
      })
      .catch(err => {
          console.error('Erro ao carregar histórico:', err);
          // Fallback final
          api.get(`/api/clients/appointments?phone=${cleanPhone}`)
            .then(res => setMyAppointments(res.data.data.appointments))
            .catch(console.error);
      })
      .finally(() => setLoadingHistory(false));
  };

  useEffect(() => {
     if (showAccountModal && (clientData.phone || clientData.name)) {
        loadMyAppointments(clientData.phone, clientData.name);
     }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAccountModal]);

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  const [confirmError, setConfirmError] = useState(null);

  const handleConfirm = () => {
    const payload = {
      client_name: clientData.name,
      client_phone: clientData.phone,
      service_id: selectedService.id,
      professional_id: selectedPro.id,
      date: format(selectedDate, 'yyyy-MM-dd'),
      time: selectedTime,
      notes: ''
    };
    
    localStorage.setItem('client_portal_data', JSON.stringify(clientData));
    setConfirmError(null);
    
    // Mostramos feedback de carregamento no botão (opcional se quiser gerenciar estado de loading)
    api.post('/api/appointments', payload).then(() => {
      // Pequeno delay para garantir que o banco processou antes de dar o OK visual final
      setTimeout(() => {
        if (step === 3) setStep(5);
        else handleNext();
      }, 800);
    }).catch(err => {
      const errorMsg = err.response?.data?.error || 'Ops! Não foi possível confirmar seu agendamento. Por favor, tente novamente.';
      setConfirmError(errorMsg);
      console.error('Erro ao confirmar agendamento:', err);
    });
  };

  const navigate = useNavigate();
  const location = useLocation();

  // Efeito para lidar com o estado de remarcação
  useEffect(() => {
    if (location.state && location.state.reschedule) {
      const { serviceId, professionalId } = location.state;
      if (services.length > 0) {
        const s = services.find(srv => srv.id === serviceId);
        if (s) setSelectedService(s);
      }
      if (professionals.length > 0) {
        const p = professionals.find(pro => pro.id === professionalId);
        if (p) setSelectedPro(p);
      }
      setStep(2); // Vai direto para a escolha da data
    }
  }, [location.state, services, professionals]);

  const timeToMinutes = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  const [busyAppointments, setBusyAppointments] = useState([]);
  useEffect(() => {
    if (selectedDate && selectedPro) {
      const dStr = format(selectedDate, 'yyyy-MM-dd');
      api.get(`/api/appointments?date=${dStr}&professional_id=${selectedPro.id}`)
        .then(res => setBusyAppointments(res.data.data))
        .catch(console.error);
    }
  }, [selectedDate, selectedPro]);

  const filteredTimeSlots = useMemo(() => {
    return timeSlots.filter(slot => {
      // Se não escolheu serviço ou profissional, não filtra por conflito ainda
      if (!selectedService || !selectedPro) return true;
      
      const slotStart = timeToMinutes(slot);
      const serviceDuration = Number(selectedService.duration) || 30;
      const slotEnd = slotStart + serviceDuration;
      const scheduleEnd = timeToMinutes(workEnd);

      if (slotEnd > scheduleEnd) return false;
      
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
  }, [timeSlots, busyAppointments, selectedService, selectedPro, workEnd]);

  const handleWhatsApp = () => {
    let msg = whatsappTemplate
      .replace(/{cliente}/g, clientData.name)
      .replace(/{servico}/g, selectedService?.name || '')
      .replace(/{profissional}/g, selectedPro?.name || '')
      .replace(/{data}/g, selectedDate ? format(selectedDate, "dd/MM/yyyy") : '')
      .replace(/{hora}/g, selectedTime || '');
      
    window.open(`https://wa.me/${whatsappNumber || '5511999999999'}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-background">
      {/* Background Orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-primary-light/30 dark:bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-primary-light/20 dark:bg-primary/5 rounded-full blur-[150px] pointer-events-none"></div>

      {/* Auth / Minha Conta Modal */}
      {showAccountModal && (
         <div className="fixed inset-0 bg-background/80 backdrop-blur z-50 flex items-center justify-center p-4">
            <div className="bg-card w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-border">
               <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
                  <h3 className="text-xl font-serif text-foreground">Minha Conta</h3>
                  <button onClick={() => setShowAccountModal(false)} className="text-muted hover:text-foreground fade-in transition-colors"><X size={20}/></button>
               </div>
               <div className="p-6">
                 {!clientData.phone ? (
                    <div>
                       <p className="text-muted mb-4">Insira seu número de WhatsApp para acessar seus agendamentos ou preencher seus dados automaticamente.</p>
                       <input type="text" className="input-field mb-4" placeholder="(11) 99999-9999" value={loginPhone} onChange={e=>setLoginPhone(e.target.value)} />
                       {loginPhone.length > 8 && !clientData.name && (
                          <input type="text" className="input-field mb-4 animate-in fade-in" placeholder="Seu Nome Completo" value={loginName} onChange={e=>setLoginName(e.target.value)} />
                       )}
                       <button 
                         className="btn-primary w-full"
                         onClick={() => {
                            if(loginPhone) {
                               const newData = { name: loginName || clientData.name, phone: loginPhone };
                               // Sincroniza com o backend para garantir que apareça na "Base de Clientes"
                               api.post('/api/clients', newData).catch(console.error);
                               
                               setClientData(newData);
                               localStorage.setItem('client_portal_data', JSON.stringify(newData));
                               loadMyAppointments(loginPhone, loginName);
                            }
                         }}
                       >
                         Acessar Conta
                       </button>
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
                               <button className="text-xs underline text-muted hover:text-foreground" onClick={() => { setClientData({name:'', phone:'', email:''}); setLoginPhone(''); setLoginName(''); setMyAppointments([]); localStorage.removeItem('client_portal_data'); }}>Sair</button>
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
                                  .sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`))
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
                                        <p className="text-[10px] text-muted uppercase font-bold tracking-widest mt-1">{format(parseISO(app.date), "dd MMM", {locale: ptBR})}</p>
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
                                             R$ {app.service_price?.toFixed(2) || '0.00'}
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

      <header className="py-6 px-10 border-b border-border/50 relative z-10 flex justify-between items-center bg-background/80 backdrop-blur">
        <h1 className="text-2xl font-serif text-foreground tracking-widest flex items-center gap-3">
          <span className="w-8 h-8 rounded bg-primary text-white flex items-center justify-center font-bold">{businessName.charAt(0).toUpperCase()}</span>
          {businessName}
        </h1>
        <div className="flex items-center gap-4 md:gap-6">
          <button onClick={() => setIsDark(!isDark)} className="text-muted hover:text-foreground transition-colors">
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button onClick={() => setShowAccountModal(true)} className="flex items-center gap-2 text-sm font-medium text-foreground bg-primary/10 hover:bg-primary/20 px-3 md:px-4 py-2 rounded-full transition-colors border border-primary/20">
             <User size={16} /> <span className="hidden sm:inline">{clientData.phone ? 'Minha Conta' : 'Entrar'}</span>
          </button>
          <button onClick={() => window.location.href='/admin'} className="text-muted hover:text-foreground text-sm transition-colors font-medium">Equipe</button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 relative z-10">
        
        {step === 0 && (
          <div className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-20 py-10 lg:py-20 animate-in fade-in duration-1000">
            
            {/* Left Column: Content */}
            <div className="flex-1 text-center lg:text-left">
              <span className="inline-block px-4 py-1.5 bg-primary/10 text-primary text-xs font-bold uppercase tracking-[0.2em] rounded-full mb-6">Experience Premium Excellence</span>
              <h2 className="text-5xl md:text-7xl xl:text-8xl font-serif text-foreground mb-8 leading-[1.1]">
                Sua Beleza, <br/>
                <span className="text-primary italic relative">
                  Redefinida
                  <svg className="absolute -bottom-2 left-0 w-full h-3 text-primary/30" viewBox="0 0 100 10" preserveAspectRatio="none">
                    <path d="M0 5 Q 25 0, 50 5 T 100 5" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </span>
              </h2>
              <p className="text-lg md:text-xl text-muted mb-12 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Especialistas em nail art e estética avançada. Agende uma experiência exclusiva no {businessName} e descubra o padrão ouro em autocuidado.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center gap-6 justify-center lg:justify-start">
                <button onClick={() => { if(clientData.phone) setShowAccountModal(true); handleNext(); }} className="btn-primary text-lg px-10 py-5 flex items-center gap-3 shadow-2xl shadow-primary/40 hover:-translate-y-1 transition-all group">
                  Agendar Agora <ChevronRight size={22} className="group-hover:translate-x-1 transition-transform" />
                </button>
                <div className="flex -space-x-3">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="w-10 h-10 rounded-full border-2 border-background bg-muted">
                      <img src={`/assets/images/gallery/nail${i}.jpg`} alt="Client" className="w-full h-full object-cover rounded-full" />
                    </div>
                  ))}
                  <div className="w-10 h-10 rounded-full border-2 border-background bg-primary-light flex items-center justify-center text-[10px] font-bold text-primary">+500</div>
                </div>
              </div>
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

          </div>
        )}

        {step > 0 && (
          <div className="w-full max-w-4xl fade-in-up">
            <div className="glass-card p-6 md:p-10">
              
              <div className="flex items-center justify-between gap-2 mb-10 text-[10px] md:text-sm font-bold uppercase tracking-[0.15em] text-muted/60 border-b border-border/50 pb-6 overflow-x-auto no-scrollbar">
                <div className={`flex items-center gap-2 ${step >= 1 ? "text-primary" : ""}`}>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${step >= 1 ? "border-primary bg-primary/10" : "border-border"}`}>1</span>
                  <span>Serviço</span>
                </div>
                <div className="h-px w-4 md:w-8 bg-border"></div>
                <div className={`flex items-center gap-2 ${step >= 2 ? "text-primary" : ""}`}>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${step >= 2 ? "border-primary bg-primary/10" : "border-border"}`}>2</span>
                  <span>Profissional</span>
                </div>
                <div className="h-px w-4 md:w-8 bg-border"></div>
                <div className={`flex items-center gap-2 ${step >= 3 ? "text-primary" : ""}`}>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${step >= 3 ? "border-primary bg-primary/10" : "border-border"}`}>3</span>
                  <span>Data/Hora</span>
                </div>
              </div>

              {step === 1 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h3 className="text-xl md:text-3xl font-serif text-foreground mb-8 text-center lg:text-left">Qual serviço deseja realizar?</h3>
                  
                  <div className="space-y-10">
                    {Object.entries(
                      services.reduce((acc, s) => {
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
                          {catServices.map(s => (
                            <div 
                              key={s.id} 
                              className={`p-5 rounded-2xl border cursor-pointer transition-all relative overflow-hidden group ${selectedService?.id === s.id ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'border-border bg-background/50 hover:border-primary/30'}`}
                              onClick={() => setSelectedService(s)}
                            >
                              {selectedService?.id === s.id && (
                                <div className="absolute top-2 right-2 text-primary animate-in zoom-in duration-300">
                                  <CheckCircle2 size={24} />
                                </div>
                              )}
                              <div className="flex justify-between items-start mb-2 pr-8">
                                <h4 className="text-lg font-serif font-medium text-foreground">{s.name}</h4>
                                <span className="text-xl font-bold text-primary">R$ {s.price?.toFixed(2) || '0.00'}</span>
                              </div>
                              <p className="text-sm text-muted mb-4 italic line-clamp-2">
                                {s.description}
                              </p>
                              <div className="text-muted flex items-center gap-2 text-xs font-medium uppercase tracking-wider">
                                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                                  <Clock size={12} />
                                </div>
                                {s.duration} minutos
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h3 className="text-2xl font-serif text-foreground mb-6">Escolha a Profissional</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {professionals.map(p => (
                      <div 
                        key={p.id} 
                        className={`p-6 rounded-xl border text-center cursor-pointer transition-all ${selectedPro?.id === p.id ? 'border-primary bg-primary/10' : 'border-border bg-background/50 hover:border-muted'}`}
                        onClick={() => setSelectedPro(p)}
                      >
                        <div className="w-16 h-16 rounded-full bg-border text-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">
                          {p.avatar}
                        </div>
                        <h4 className="text-lg font-medium text-foreground">{p.name}</h4>
                        <p className="text-muted text-sm">{p.specialty}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 grid md:grid-cols-2 gap-10">
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
                                className={`aspect-[4/5] p-2 rounded-xl border flex flex-col items-center justify-center transition-all ${selectedDate?.getTime() === d.getTime() ? 'border-primary bg-primary text-white shadow-lg shadow-primary/30 scale-105' : 'border-border bg-background/50 text-muted hover:border-primary/50 hover:text-foreground'}`}
                                onClick={() => setSelectedDate(d)}
                              >
                                <span className="text-[10px] uppercase font-bold mb-1 opacity-70">{format(d, 'eee', {locale: ptBR})}</span>
                                <span className="text-lg md:text-xl font-bold">{format(d, 'dd')}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg md:text-xl font-serif text-foreground mb-6">⏰ Escolha seu Horário</h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 md:gap-3">
                       {filteredTimeSlots.length > 0 ? (
                         filteredTimeSlots.map(t => (
                           <button 
                             key={t}
                             className={`py-3 md:py-4 px-2 rounded-xl border font-bold transition-all text-sm md:text-base ${selectedTime === t ? 'border-primary bg-primary text-white shadow-lg shadow-primary/30' : 'border-border bg-background/50 text-muted hover:border-primary/30 hover:text-foreground'}`}
                             onClick={() => setSelectedTime(t)}
                           >
                             {t}
                           </button>
                         ))
                       ) : (
                         <div className="col-span-full py-10 text-center opacity-40">
                            <Clock size={32} className="mx-auto mb-2" />
                            <p className="text-sm">Nenhum horário disponível para este dia.</p>
                         </div>
                       )}
                    </div>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-md mx-auto">
                   <h3 className="text-2xl font-serif text-foreground mb-6 text-center">Seus Dados</h3>
                   <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-muted mb-1">Nome Completo</label>
                        <input type="text" className="input-field" value={clientData.name} onChange={(e) => setClientData({...clientData, name: e.target.value})} placeholder="Ex: Maria Clara" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-muted mb-1">Telefone / WhatsApp</label>
                        <input type="text" className="input-field" value={clientData.phone} onChange={(e) => setClientData({...clientData, phone: e.target.value})} placeholder="(11) 99999-9999" />
                      </div>
                   </div>
                </div>
              )}

              {step === 5 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-center py-10">
                    <div className="relative inline-block mb-6">
                      <CheckCircle2 size={64} className="text-green-500" />
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-background rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-ping"></div>
                      </div>
                    </div>
                    <h3 className="text-3xl font-serif text-foreground mb-2">Agendamento Realizado!</h3>
                    <p className="text-muted mb-8 max-w-sm mx-auto">
                      Estamos processando sua reserva. Seu horário aparecerá no histórico em alguns segundos.
                    </p>
                    
                    <div className="glass-card p-6 mb-8 inline-block text-left text-foreground border-primary/30 bg-primary/5">
                       <p className="mb-2"><strong className="text-muted">Serviço:</strong> {selectedService.name}</p>
                       <p className="mb-2"><strong className="text-muted">Profissional:</strong> {selectedPro.name}</p>
                       <p className="mb-2"><strong className="text-muted">Data:</strong> {format(selectedDate, "dd 'de' MMMM, yyyy", {locale: ptBR})}</p>
                       <p><strong className="text-muted">Horário:</strong> {selectedTime}</p>
                    </div>

                     <div className="flex flex-col gap-3 items-center">
                       <button onClick={handleWhatsApp} className="btn-primary w-full max-w-sm flex justify-center items-center gap-2 py-4">
                         Receber no WhatsApp
                       </button>
                       <button onClick={() => setStep(0)} className="text-muted hover:text-foreground text-sm font-medium transition-colors border-b border-transparent hover:border-muted">
                         Voltar para o Início
                       </button>
                     </div>
                 </div>
              )}

               {/* Alerta de Erro no Agendamento */}
               {confirmError && (
                 <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
                   <X size={20} className="text-red-500 shrink-0" />
                   <p className="text-sm text-red-500 font-medium">{confirmError}</p>
                   <button onClick={() => setConfirmError(null)} className="ml-auto text-red-400 hover:text-red-600 shrink-0"><X size={16} /></button>
                 </div>
               )}

               {/* Controles */}
              {step > 0 && step < 5 && (
                 <div className="flex justify-between items-center mt-10 pt-6 border-t border-border border-dashed">
                   <button onClick={handleBack} className="text-muted hover:text-foreground flex items-center gap-2 transition-colors">
                                          <ArrowLeft size={18} /> Voltar
                   </button>
                   <button 
                     onClick={() => {
                        if (step === 3 && clientData.name && clientData.phone) {
                            handleConfirm();
                        } else {
                            if (step === 4) handleConfirm();
                            else handleNext();
                        }
                     }} 
                     disabled={(step === 1 && !selectedService) || (step === 2 && !selectedPro) || (step === 3 && (!selectedDate || !selectedTime)) || (step === 4 && (!clientData.name || !clientData.phone))} 
                     className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                   >
                     {(step === 4 || (step === 3 && clientData.name && clientData.phone)) ? 'Confirmar Agendamento' : 'Próximo Passo'} <ChevronRight size={18} />
                   </button>
                 </div>
              )}

            </div>
          </div>
        )}

      </main>
    </div>
  );
}
