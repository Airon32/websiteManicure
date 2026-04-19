import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, Users, Settings, Scissors, LayoutDashboard, Search, Bell, LogOut, Trash2, Plus, X, User, Sun, Moon, Briefcase, DollarSign, Activity, ChevronLeft, ChevronRight, Menu, AlertTriangle, CheckCircle, Info, Edit2, Lock } from 'lucide-react';
import { format, parseISO, startOfToday, addDays, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, subMonths, addMonths, subYears, addYears, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { buildEffectiveSchedule, buildTimeSlots, getProfessionalSettingKey } from '../utils/schedule';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [, setSettingsData] = useState([]);

  const [selectedCalendarDate, setSelectedCalendarDate] = useState(startOfToday());
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(startOfToday()));

  const minMonth = startOfMonth(subYears(startOfToday(), 1));
  const maxMonth = startOfMonth(addYears(startOfToday(), 1));

  const handlePrevMonth = () => {
    const prev = subMonths(currentMonth, 1);
    if (prev >= minMonth) setCurrentMonth(prev);
  }

  const handleNextMonth = () => {
    const next = addMonths(currentMonth, 1);
    if (next <= maxMonth) setCurrentMonth(next);
  }

  const startDate = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
  const endDate = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', specialty: '', avatar: '', username: '', password: '' });

  const [showAddAppt, setShowAddAppt] = useState(false);
  const [newAppt, setNewAppt] = useState({ client_name: '', client_phone: '', service_id: '', professional_id: '', date: format(new Date(), 'yyyy-MM-dd'), time: '' });

  const [showBlockModal, setShowBlockModal] = useState(false);
  const [newBlock, setNewBlock] = useState({ professional_id: '', date: format(new Date(), 'yyyy-MM-dd'), time: '', duration: '30', description: '' });

  // Add Service State
  const [showAddService, setShowAddService] = useState(false);
  const [newService, setNewService] = useState({ name: '', duration: '', price: '' });

  const [businessName, setBusinessName] = useState('Ateliê Pink');
  const [whatsappMessage, setWhatsappMessage] = useState('');

  // Configurações Avançadas
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [slotInterval, setSlotInterval] = useState('30');
  const [workDays, setWorkDays] = useState(['seg','ter','qua','qui','sex','sab']);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [allowOnlineBooking, setAllowOnlineBooking] = useState(true);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState('60');
  const [profileForm, setProfileForm] = useState({
    name: '',
    specialty: '',
    avatar: '',
    username: '',
    password: '',
    confirmPassword: ''
  });

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

  // Clients State
  const [filteredClients, setFilteredClients] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);

  // Premium Modal State
  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    type: 'confirm', // 'confirm', 'success', 'error', 'info'
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

  const syncUserSession = (updates, fallbackUser = null) => {
    setUser(prev => {
      const nextUser = { ...(prev || fallbackUser || {}), ...updates };
      sessionStorage.setItem('user', JSON.stringify(nextUser));
      return nextUser;
    });
  };

  const loadData = async (loggedUser) => {
    try {
      const appQuery = loggedUser.role === 'admin' ? '' : `?professional_id=${loggedUser.id}`;
      const baseRequests = [
        axios.get(`http://localhost:3001/api/appointments${appQuery}`),
        axios.get('http://localhost:3001/api/clients'),
        axios.get('http://localhost:3001/api/services'),
        axios.get('http://localhost:3001/api/settings')
      ];

      const requests = loggedUser.role === 'admin'
        ? [...baseRequests, axios.get('http://localhost:3001/api/professionals')]
        : [...baseRequests, axios.get(`http://localhost:3001/api/professionals/${loggedUser.id}`)];

      const [appRes, cliRes, srvRes, setRes, profileRes] = await Promise.all(requests);
      const incomingSettings = setRes.data.data;

      setSettingsData(incomingSettings);

      setAppointments(appRes.data.data);
      setClients(cliRes.data.data);
      setServices(srvRes.data.data);

      if (loggedUser.role === 'admin') {
        setProfessionals(profileRes.data.data);
        const globalSchedule = buildEffectiveSchedule(incomingSettings);
        setWorkStart(globalSchedule.workStart);
        setWorkEnd(globalSchedule.workEnd);
        setSlotInterval(globalSchedule.slotInterval);
        setWorkDays(globalSchedule.workDays);
      } else {
        const currentProfile = profileRes.data.data;
        const professionalSchedule = buildEffectiveSchedule(incomingSettings, loggedUser.id);
        setProfessionals([]);
        setProfileForm(prev => ({
          ...prev,
          name: currentProfile.name || '',
          specialty: currentProfile.specialty || '',
          avatar: currentProfile.avatar || '',
          username: currentProfile.username || '',
          password: '',
          confirmPassword: ''
        }));
        syncUserSession({
          name: currentProfile.name,
          avatar: currentProfile.avatar,
          specialty: currentProfile.specialty,
          username: currentProfile.username
        }, loggedUser);
        setWorkStart(professionalSchedule.workStart);
        setWorkEnd(professionalSchedule.workEnd);
        setSlotInterval(professionalSchedule.slotInterval);
        setWorkDays(professionalSchedule.workDays);
      }

      const bName = incomingSettings.find(s => s.key === 'business_name');
      if (bName) setBusinessName(bName.value);
      const wMsg = incomingSettings.find(s => s.key === 'whatsapp_message');
      if (wMsg) setWhatsappMessage(wMsg.value);

      // Configurações avançadas
      const wn = incomingSettings.find(s => s.key === 'whatsapp_number');
      if (wn) setWhatsappNumber(wn.value);
      const ao = incomingSettings.find(s => s.key === 'allow_online_booking');
      if (ao) setAllowOnlineBooking(ao.value === 'true');
      const mad = incomingSettings.find(s => s.key === 'max_advance_days');
      if (mad) setMaxAdvanceDays(mad.value);
    } catch (err) {
      console.error("Erro ao carregar os dados:", err);
    }
  };

  useEffect(() => {
    const rawUser = sessionStorage.getItem('user');
    if (!rawUser) {
      navigate('/login');
      return;
    }
    const loggedUser = JSON.parse(rawUser);
    setUser(loggedUser);
    loadData(loggedUser);
  }, [navigate]);

  const handleLogout = () => {
    sessionStorage.removeItem('user');
    navigate('/login');
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:3001/api/professionals', newStaff);
      setShowAddStaff(false);
      setNewStaff({ name: '', specialty: '', avatar: '', username: '', password: '' });
      loadData(user);
    } catch (err) { 
      const errorMsg = err.response?.data?.error || err.message || 'Erro desconhecido ao adicionar profissional.';
      openModal({ title: 'Erro no Cadastro', message: errorMsg, type: 'error', confirmText: 'Entendido' });
    }
  };

  const handleEditClient = (e) => {
    e.preventDefault();
    axios.put(`http://localhost:3001/api/clients/${selectedClient.id}`, selectedClient)
      .then(() => {
        setClients(prev => prev.map(c => c.id === selectedClient.id ? selectedClient : c));
        setShowEditClientModal(false);
        openModal({ title: 'Sucesso', message: 'Cliente atualizado com sucesso.', type: 'success' });
      })
      .catch(err => openModal({ title: 'Erro', message: err.response?.data?.error || 'Erro ao editar cliente.', type: 'error' }));
  };

  const handleDeleteClient = (id) => {
    openModal({
      title: 'Excluir Cliente',
      message: 'Tem certeza que deseja remover este cliente? Isso não afetará os agendamentos já realizados.',
      type: 'confirm',
      onConfirm: () => {
        axios.delete(`http://localhost:3001/api/clients/${id}`)
          .then(() => {
            setClients(prev => prev.filter(c => c.id !== id));
            openModal({ title: 'Sucesso', message: 'Cliente removido da base.', type: 'success' });
          })
          .catch(console.error);
      }
    });
  };

  // Logic for Autocomplete
  useEffect(() => {
    if (!newAppt.client_name && !newAppt.client_phone) {
      setFilteredClients([]);
      setShowSuggestions(false);
      return;
    }

    const filtered = clients.filter(c => 
      (c.name || '').toLowerCase().includes((newAppt.client_name || '').toLowerCase()) ||
      (c.phone && c.phone.includes(newAppt.client_phone))
    ).slice(0, 5);

    setFilteredClients(filtered);
    setShowSuggestions(filtered.length > 0);
  }, [newAppt.client_name, newAppt.client_phone, clients]);

  const selectSuggestedClient = (client) => {
    setNewAppt({ ...newAppt, client_name: client.name, client_phone: client.phone });
    setShowSuggestions(false);
  };

  const handleDeleteStaff = (id) => {
    openModal({
      title: 'Demitir Profissional',
      message: 'Deseja realmente demitir este profissional? Esta ação não pode ser desfeita.',
      type: 'confirm',
      confirmText: 'Demitir',
      onConfirm: async () => {
        try {
          await axios.delete(`http://localhost:3001/api/professionals/${id}`);
          setProfessionals(professionals.filter(p => p.id !== id));
          openModal({ title: 'Sucesso', message: 'Profissional removido com sucesso.', type: 'success' });
        } catch (err) { 
          const errorMsg = err.response?.data?.error || err.message || 'Erro ao processar exclusão.';
          openModal({ title: 'Erro na Exclusão', message: `Não foi possível remover o profissional: ${errorMsg}`, type: 'error', confirmText: 'Entendido' });
        }
      }
    });
  };

  const handleAddService = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:3001/api/services', newService);
      setShowAddService(false);
      setNewService({ name: '', duration: '', price: '' });
      loadData(user);
    } catch (err) { 
      openModal({ title: 'Falha no Catálogo', message: 'Erro ao registrar serviço. Verifique a conexão.', type: 'error', confirmText: 'Tentar Novamente' });
    }
  };

  const handleDeleteService = (id) => {
    openModal({
      title: 'Retirar Serviço',
      message: 'Deseja retirar este serviço do seu sistema e app? Clientes não poderão mais agendá-lo.',
      type: 'confirm',
      confirmText: 'Excluir',
      onConfirm: async () => {
        try {
          await axios.delete(`http://localhost:3001/api/services/${id}`);
          setServices(services.filter(s => s.id !== id));
        } catch (err) { 
          openModal({ title: 'Erro', message: 'Erro ao excluir serviço.', type: 'error', confirmText: 'Entendido' });
        }
      }
    });
  };

  const handleAddAppt = async (e) => {
    e.preventDefault();
    try {
      let payload = { ...newAppt };
      if (user.role !== 'admin') payload.professional_id = user.id;

      await axios.post('http://localhost:3001/api/appointments', payload);
      setShowAddAppt(false);
      setNewAppt({ client_name: '', client_phone: '', service_id: '', professional_id: '', date: format(new Date(), 'yyyy-MM-dd'), time: '' });
      loadData(user);
    } catch (err) { 
      openModal({ 
        title: 'Conflito de Agenda', 
        message: err.response?.data?.error || 'Não foi possível registrar o agendamento devido a um conflito de horários ou erro no sistema.', 
        type: 'error', 
        confirmText: 'Fechar' 
      });
    }
  };

  const handleAddBlock = async (e) => {
    e.preventDefault();
    try {
      if (!newBlock.professional_id && user.role === 'admin') {
          openModal({ title: 'Atenção', message: 'Por favor, selecione um profissional.', type: 'info', confirmText: 'OK' });
          return;
      }
      
      const payload = {
          ...newBlock,
          professional_id: user.role === 'admin' ? newBlock.professional_id : user.id
      };
      
      const response = await axios.post('http://localhost:3001/api/appointments/block', payload);
      setAppointments([response.data.data, ...appointments]);
      setShowBlockModal(false);
      setNewBlock({ professional_id: '', date: format(new Date(), 'yyyy-MM-dd'), time: '', duration: '30', description: '' });
      openModal({ title: 'Sucesso', message: 'Horário fechado com sucesso!', type: 'success', confirmText: 'OK' });
      loadData(user);
    } catch (err) {
      console.error(err);
      openModal({ title: 'Erro', message: err.response?.data?.error || 'Erro ao fechar horário.', type: 'error', confirmText: 'Voltar' });
    }
  };

  const handleCancelAppt = (id) => {
    openModal({
      title: 'Confirmar Cancelamento',
      message: 'Deseja realmente desmarcar este cliente? O horário ficará disponível novamente.',
      type: 'confirm',
      confirmText: 'Desmarcar',
      onConfirm: async () => {
        try {
          await axios.post(`http://localhost:3001/api/appointments/${id}/cancel`);
          setAppointments(prev => prev.filter(a => a.id !== id));
        } catch (err) {
          console.error('Erro ao desmarcar:', err);
          openModal({ 
            title: 'Falha no Servidor', 
            message: 'Erro ao desmarcar o agendamento. Tente reiniciar o servidor.', 
            type: 'error', 
            confirmText: 'Entendido' 
          });
        }
      }
    });
  };

  const handleSaveSettings = async () => {
    try {
      await Promise.all([
        axios.put('http://localhost:3001/api/settings', { key: 'business_name', value: businessName }),
        axios.put('http://localhost:3001/api/settings', { key: 'whatsapp_message', value: whatsappMessage }),
        axios.put('http://localhost:3001/api/settings', { key: 'work_start', value: workStart }),
        axios.put('http://localhost:3001/api/settings', { key: 'work_end', value: workEnd }),
        axios.put('http://localhost:3001/api/settings', { key: 'slot_interval', value: slotInterval }),
        axios.put('http://localhost:3001/api/settings', { key: 'work_days', value: JSON.stringify(workDays) }),
        axios.put('http://localhost:3001/api/settings', { key: 'whatsapp_number', value: whatsappNumber }),
        axios.put('http://localhost:3001/api/settings', { key: 'allow_online_booking', value: String(allowOnlineBooking) }),
        axios.put('http://localhost:3001/api/settings', { key: 'max_advance_days', value: maxAdvanceDays }),
      ]);
      openModal({ title: 'Sucesso!', message: 'Todas as configurações foram salvas com sucesso!', type: 'success', confirmText: 'Ótimo' });
    } catch (err) { 
      openModal({ title: 'Erro crítico', message: 'Erro ao salvar configuração no banco de dados.', type: 'error', confirmText: 'Fechar' });
    }
  };

  const handleProfileFormChange = (field, value) => {
    setProfileForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveProfessionalSettings = async () => {
    const trimmedName = profileForm.name.trim();
    const trimmedSpecialty = profileForm.specialty.trim();
    const trimmedAvatar = profileForm.avatar.trim().slice(0, 2).toUpperCase();
    const trimmedUsername = profileForm.username.trim();
    const [startHour, startMinute] = workStart.split(':').map(Number);
    const [endHour, endMinute] = workEnd.split(':').map(Number);
    const workStartMinutes = startHour * 60 + startMinute;
    const workEndMinutes = endHour * 60 + endMinute;

    if (!trimmedName || !trimmedSpecialty || !trimmedAvatar || !trimmedUsername) {
      openModal({
        title: 'Campos obrigatórios',
        message: 'Preencha nome, especialidade, iniciais e usuário antes de salvar.',
        type: 'error',
        confirmText: 'Entendido'
      });
      return;
    }

    if (profileForm.password && profileForm.password !== profileForm.confirmPassword) {
      openModal({
        title: 'Senhas diferentes',
        message: 'A nova senha e a confirmação precisam ser iguais.',
        type: 'error',
        confirmText: 'Corrigir'
      });
      return;
    }

    if (workDays.length === 0) {
      openModal({
        title: 'Dias obrigatórios',
        message: 'Selecione pelo menos um dia de atendimento para o seu expediente.',
        type: 'error',
        confirmText: 'Corrigir'
      });
      return;
    }

    if (workEndMinutes <= workStartMinutes) {
      openModal({
        title: 'Expediente inválido',
        message: 'O fim do expediente precisa ser depois do início.',
        type: 'error',
        confirmText: 'Corrigir'
      });
      return;
    }

    try {
      const payload = {
        name: trimmedName,
        specialty: trimmedSpecialty,
        avatar: trimmedAvatar,
        username: trimmedUsername
      };

      if (profileForm.password) payload.password = profileForm.password;

      const scheduleUpdates = [
        { key: getProfessionalSettingKey(user.id, 'work_start'), value: workStart },
        { key: getProfessionalSettingKey(user.id, 'work_end'), value: workEnd },
        { key: getProfessionalSettingKey(user.id, 'slot_interval'), value: String(slotInterval) },
        { key: getProfessionalSettingKey(user.id, 'work_days'), value: JSON.stringify(workDays) }
      ];

      const [res] = await Promise.all([
        axios.put(`http://localhost:3001/api/professionals/${user.id}`, payload),
        ...scheduleUpdates.map(entry => axios.put('http://localhost:3001/api/settings', entry))
      ]);
      const updatedProfile = res.data.data;

      setProfileForm(prev => ({
        ...prev,
        name: updatedProfile.name || '',
        specialty: updatedProfile.specialty || '',
        avatar: updatedProfile.avatar || '',
        username: updatedProfile.username || '',
        password: '',
        confirmPassword: ''
      }));

      syncUserSession({
        name: updatedProfile.name,
        avatar: updatedProfile.avatar,
        specialty: updatedProfile.specialty,
        username: updatedProfile.username
      });

      setSettingsData(prev => {
        const next = [...prev];

        for (const entry of scheduleUpdates) {
          const existingIndex = next.findIndex(setting => setting.key === entry.key);
          if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], value: entry.value };
          else next.push(entry);
        }

        return next;
      });

      openModal({
        title: 'Perfil atualizado',
        message: 'Suas configurações e o seu expediente foram salvos com sucesso.',
        type: 'success',
        confirmText: 'Perfeito'
      });
    } catch (err) {
      openModal({
        title: 'Não foi possível salvar',
        message: err.response?.data?.error || 'Erro ao atualizar suas configurações.',
        type: 'error',
        confirmText: 'Fechar'
      });
    }
  };

  const toggleWorkDay = (day) => {
    setWorkDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  if (!user) return <div className="min-h-screen bg-background flex items-center justify-center text-foreground">Carregando...</div>;

  const isAdmin = user.role === 'admin';
  const dayOptions = [
    { k: 'dom', l: 'Dom' },
    { k: 'seg', l: 'Seg' },
    { k: 'ter', l: 'Ter' },
    { k: 'qua', l: 'Qua' },
    { k: 'qui', l: 'Qui' },
    { k: 'sex', l: 'Sex' },
    { k: 'sab', l: 'Sáb' }
  ];
  const selectedProfessionalForAppointment = isAdmin
    ? professionals.find(professional => String(professional.id) === String(newAppt.professional_id))
    : null;
  const appointmentSchedule = selectedProfessionalForAppointment
    ? {
        workStart: selectedProfessionalForAppointment.work_start || workStart,
        workEnd: selectedProfessionalForAppointment.work_end || workEnd,
        slotInterval: String(selectedProfessionalForAppointment.slot_interval || slotInterval)
      }
    : {
        workStart,
        workEnd,
        slotInterval: String(slotInterval)
      };
  const appointmentTimeSlots = buildTimeSlots(
    appointmentSchedule.workStart,
    appointmentSchedule.workEnd,
    appointmentSchedule.slotInterval
  );
  // Exclui cancelados de todas as visões da UI
  const activeAppointments = appointments.filter(a => a.status !== 'cancelado');
  const selectedDayStr = format(selectedCalendarDate, 'yyyy-MM-dd');
  const selectedDayAppointments = activeAppointments.filter(app => app.date === selectedDayStr);

  // Cálculo Financeiro — usa service_price já enriquecido pelo backend
  const totalRevenue = activeAppointments.reduce((sum, app) => sum + (app.service_price || 0), 0);

  const revenuePerProfessional = professionals.map(pro => {
    const apps = activeAppointments.filter(a => a.professional_id === pro.id);
    const sum = apps.reduce((total, app) => total + (app.service_price || 0), 0);
    return { ...pro, totalApps: apps.length, revenue: sum };
  }).sort((a, b) => b.revenue - a.revenue);

  const getPageTitle = () => {
    switch (activeTab) {
      case 'dashboard': return 'Dashboard Financeiro & Geral';
      case 'agenda': return 'Super Calendário & Horários';
      case 'clients': return 'Base de Clientes';
      case 'catalog': return 'Catálogo de Serviços';
      case 'staff': return 'Gestão de Staff & RH';
      case 'settings': return isAdmin ? 'Configurações Globais' : 'Minhas Configurações';
      default: return activeTab;
    }
  };

  const SidebarItem = ({ icon: Icon, label, id, adminOnly }) => {
    if (adminOnly && !isAdmin) return null;
    return (
      <button
        onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === id ? 'bg-primary text-white font-medium shadow shadow-primary/20' : 'text-muted hover:text-foreground hover:bg-border/50'}`}
      >
        <Icon size={20} /> {label}
      </button>
    );
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans transition-colors duration-300">

      {/* Premium Confirm/Alert Modal */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-md animate-in fade-in duration-300" onClick={modal.onCancel}></div>
          <div className="relative bg-card border border-border shadow-2xl rounded-[2rem] p-8 max-w-sm w-full animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <div className="flex flex-col items-center text-center">
              <div className={`mb-6 p-4 rounded-2xl ${
                modal.type === 'confirm' ? 'bg-amber-100 text-amber-600' : 
                modal.type === 'error' ? 'bg-red-100 text-red-600' : 
                modal.type === 'success' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
              }`}>
                {modal.type === 'confirm' && <AlertTriangle size={32} />}
                {modal.type === 'error' && <X size={32} />}
                {modal.type === 'success' && <CheckCircle size={32} />}
                {modal.type === 'info' && <Info size={32} />}
              </div>
              
              <h3 className="text-2xl font-serif text-foreground mb-2">{modal.title}</h3>
              <p className="text-muted text-sm mb-8 leading-relaxed">{modal.message}</p>
              
              <div className="flex gap-3 w-full">
                {modal.type === 'confirm' && (
                  <button 
                    onClick={modal.onCancel}
                    className="flex-1 py-3 px-4 rounded-xl border border-border text-sm font-bold text-muted hover:bg-border/50 transition-colors"
                  >
                    {modal.cancelText}
                  </button>
                )}
                <button 
                  onClick={modal.onConfirm}
                  className={`flex-1 py-3 px-4 rounded-xl text-white text-sm font-bold shadow-lg transition-all hover:scale-105 active:scale-95 ${
                    modal.type === 'error' ? 'bg-red-500 shadow-red-500/20' : 
                    modal.type === 'success' ? 'bg-green-500 shadow-green-500/20' : 
                    'bg-primary shadow-primary/20'
                  }`}
                >
                  {modal.confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 lg:static w-64 border-r border-border bg-card flex flex-col z-50 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold">G</div>
            <span className="text-foreground font-serif tracking-wider text-xl">Gestão</span>
          </div>
          <button className="lg:hidden text-muted hover:text-foreground" onClick={() => setIsMobileMenuOpen(false)}>
            <X size={24} />
          </button>
        </div>

        {/* User Card */}
        <div className="p-4 border-b border-border bg-background/50 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-light/50 text-primary flex items-center justify-center font-bold">{user.avatar}</div>
          <div className="overflow-hidden">
            <div className="text-foreground font-medium truncate">{user.name}</div>
            <div className="text-xs text-primary uppercase font-semibold">{user.role}</div>
          </div>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" id="dashboard" />
          <SidebarItem icon={CalendarIcon} label="Super Agenda" id="agenda" />
          <SidebarItem icon={Users} label="Base de Clientes" id="clients" />
          <SidebarItem icon={Scissors} label="Catálogo de Serviços" id="catalog" adminOnly={true} />
          <SidebarItem icon={Briefcase} label="Gestão & RH" id="staff" adminOnly={true} />
          <SidebarItem icon={Activity} label="Desempenho" id="stats" adminOnly={true} />
          <SidebarItem icon={Settings} label="Configurações" id="settings" />
        </nav>
        <div className="p-4 border-t border-border text-center">
          <button onClick={handleLogout} className="text-muted hover:text-red-400 flex items-center justify-center gap-2 w-full p-2 transition-colors">
            <LogOut size={16} /> Encerrar Sessão
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-y-auto relative bg-background w-full">
        <header className="h-16 border-b border-border flex items-center justify-between px-4 lg:px-8 bg-background/80 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button className="lg:hidden text-muted hover:text-foreground p-1" onClick={() => setIsMobileMenuOpen(true)}>
              <Menu size={24} />
            </button>
            <h2 className="text-lg lg:text-xl font-serif text-foreground truncate max-w-[150px] sm:max-w-xs">{getPageTitle()}</h2>
          </div>
          <div className="flex items-center gap-2 lg:gap-4 truncate">
            <button onClick={() => setIsDark(!isDark)} className="text-muted hover:text-foreground transition-colors p-2 rounded-full hover:bg-border/50">
              {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button onClick={() => { setShowBlockModal(true); setShowAddAppt(false); setActiveTab('agenda'); setIsMobileMenuOpen(false); }} className="btn-secondary py-1.5 px-3 lg:px-4 text-sm flex items-center gap-2 border border-border">
              <Lock size={16} /> <span className="hidden sm:inline">Fechar Horário</span>
            </button>
            <button onClick={() => { setShowAddAppt(!showAddAppt); setActiveTab('agenda'); setIsMobileMenuOpen(false); }} className="btn-primary py-1.5 px-3 lg:px-4 text-sm flex items-center gap-2">
              {showAddAppt ? <X size={16} /> : <Plus size={16} />} <span className="hidden sm:inline">Marcar Cliente</span>
            </button>
            <button className="text-muted hover:text-foreground"><Bell size={20} /></button>
          </div>
        </header>

        <div className="p-8">

          {showAddAppt && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 mb-8 slide-in-from-top-4 animate-in duration-300">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-serif text-foreground">Novo Agendamento Presencial/Telefone</h3>
                <button onClick={() => setShowAddAppt(false)} className="text-muted hover:text-foreground"><X size={20} /></button>
              </div>
              <form onSubmit={handleAddAppt} className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
                <div className="relative">
                  <input 
                    className="input-field w-full" 
                    placeholder="Nome do Cliente" 
                    value={newAppt.client_name} 
                    onChange={e => setNewAppt({ ...newAppt, client_name: e.target.value })} 
                    onFocus={() => setShowSuggestions(filteredClients.length > 0)}
                    required 
                  />
                  {showSuggestions && (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-border shadow-xl rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                      {filteredClients.map(c => (
                        <div 
                          key={c.id} 
                          className="p-3 hover:bg-primary/10 cursor-pointer flex justify-between items-center transition-colors border-b border-border last:border-0"
                          onClick={() => selectSuggestedClient(c)}
                        >
                          <div>
                            <p className="text-foreground font-medium text-sm">{c.name}</p>
                            <p className="text-muted text-xs">{c.phone}</p>
                          </div>
                          <Plus size={14} className="text-primary" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <input className="input-field" placeholder="Telefone" value={newAppt.client_phone} onChange={e => setNewAppt({ ...newAppt, client_phone: e.target.value })} required />
                <select className="input-field" value={newAppt.service_id} onChange={e => setNewAppt({ ...newAppt, service_id: e.target.value })} required>
                  <option value="" disabled>Qual o Serviço?</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} (R$ {s.price})</option>)}
                </select>
                {isAdmin && (
                  <select className="input-field" value={newAppt.professional_id} onChange={e => setNewAppt({ ...newAppt, professional_id: e.target.value })} required>
                    <option value="" disabled>Profissional Designado</option>
                    {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <input type="date" className="input-field" value={newAppt.date} onChange={e => setNewAppt({ ...newAppt, date: e.target.value })} min={format(subYears(startOfToday(), 1), 'yyyy-MM-dd')} max={format(addYears(startOfToday(), 1), 'yyyy-MM-dd')} required />
                <select className="input-field" value={newAppt.time} onChange={e => setNewAppt({ ...newAppt, time: e.target.value })} required>
                  <option value="" disabled>Horário</option>
                  {appointmentTimeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="md:col-span-3 flex justify-end mt-4">
                  <button type="submit" className="btn-primary">Marcar na Agenda</button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="fade-in-up duration-500">
              {isAdmin ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="glass-card p-6 flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <p className="text-muted text-sm mb-1">Total de Fluxo</p>
                        <Activity size={18} className="text-primary" />
                      </div>
                      <p className="text-3xl items-baseline gap-2 font-serif text-foreground flex">{appointments.length} <span className="text-sm font-sans font-medium text-muted">Apt.</span></p>
                    </div>
                    <div className="glass-card p-6 flex flex-col justify-between border-t-4 border-t-primary">
                      <div className="flex justify-between items-start">
                        <p className="text-muted text-sm mb-1">Receita Real Bruta</p>
                        <DollarSign size={18} className="text-primary" />
                      </div>
                      <p className="text-3xl font-serif text-primary">R$ {totalRevenue.toFixed(2)}</p>
                    </div>
                    <div className="glass-card p-6 md:col-span-2">
                      <p className="text-muted text-sm mb-4">Métricas de Equipe Activa</p>
                      <div className="flex flex-wrap gap-4 md:gap-8">
                        <div>
                          <p className="text-2xl font-serif text-foreground">{professionals.length} <span className="text-sm text-primary font-sans font-semibold block sm:inline">Profissionais</span></p>
                        </div>
                        <div>
                          <p className="text-2xl font-serif text-foreground">{services.length} <span className="text-sm text-primary font-sans font-semibold block sm:inline">Servicos</span></p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                    <div className="lg:col-span-2 glass-card p-6">
                      <h3 className="text-xl font-serif text-foreground mb-6">Próximos em Atendimento</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-full">
                          <thead>
                            <tr className="border-b border-border/50 text-muted text-sm">
                              <th className="py-3 font-medium">Data/Hora</th>
                              <th className="py-3 font-medium">Cliente</th>
                              <th className="py-3 font-medium">Serviço</th>
                              <th className="py-3 font-medium">Profissional</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeAppointments
                              .filter(app => {
                                const todayStr = format(startOfToday(), 'yyyy-MM-dd');
                                const limitDayStr = format(addDays(startOfToday(), 10), 'yyyy-MM-dd');
                                return app.date >= todayStr && app.date <= limitDayStr;
                              })
                              .sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`))
                              .slice(0, 10) // Mostra até 10 agendamentos no dashboard
                              .map(app => (
                                <tr key={app.id} className="border-b border-border/50 text-foreground last:border-0 hover:bg-border/20">
                                  <td className="py-4 px-2">{format(parseISO(app.date), 'dd/MM')} às {app.time}</td>
                                  <td className="py-4 px-2 font-medium">{app.client_name}</td>
                                  <td className="py-4 px-2 text-muted">{app.service_name || '-'}</td>
                                  <td className="py-4 px-2">{app.professional_name || '-'}</td>
                                </tr>
                              ))}
                            {activeAppointments.filter(app => {
                                const todayStr = format(startOfToday(), 'yyyy-MM-dd');
                                const limitDayStr = format(addDays(startOfToday(), 10), 'yyyy-MM-dd');
                                return app.date >= todayStr && app.date <= limitDayStr;
                              }).length === 0 && (
                                <tr><td colSpan="4" className="text-center py-8 text-muted italic">Nenhum agendamento para os próximos 10 dias.</td></tr>
                              )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="glass-card p-6 border-l-4 border-l-primary">
                      <h3 className="text-xl font-serif text-foreground mb-6">Ranking Financeiro</h3>
                      <div className="space-y-4">
                        {revenuePerProfessional.map((pro, idx) => (
                          <div key={pro.id} className="flex items-center gap-4 bg-background border border-border/50 p-4 rounded-xl">
                            <div className="w-8 h-8 rounded-full bg-primary-light/30 text-primary flex items-center justify-center font-bold text-sm">
                              {idx + 1}
                            </div>
                            <div className="flex-1">
                              <h4 className="text-foreground font-medium text-sm">{pro.name}</h4>
                              <p className="text-xs text-muted">{pro.totalApps} agendamentos</p>
                            </div>
                            <div className="text-right">
                              <p className="text-primary font-bold">R${pro.revenue.toFixed(2)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
                ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="glass-card p-6 border-l-4 border-l-primary flex flex-col justify-between">
                          <h3 className="text-2xl font-serif text-foreground mb-1">Olá, {user.name}!</h3>
                          <p className="text-sm text-muted">Bem-vindo(a) ao seu painel.</p>
                        </div>
                        <div className="glass-card p-6 flex flex-col justify-between">
                          <p className="text-muted text-sm mb-2 uppercase tracking-wider font-semibold">Hoje</p>
                          <p className="text-3xl font-serif text-foreground">
                            {activeAppointments.filter(a => a.date === format(startOfToday(), 'yyyy-MM-dd')).length} <span className="text-sm font-sans font-medium text-muted">Apt.</span>
                          </p>
                        </div>
                        <div className="glass-card p-6 flex flex-col justify-between">
                          <p className="text-muted text-sm mb-2 uppercase tracking-wider font-semibold">Esta Semana</p>
                          <p className="text-3xl font-serif text-primary">
                            {activeAppointments.filter(a => {
                              const d = parseISO(a.date + 'T00:00:00'); // Força interpretação local para intervalo
                              return d >= startOfWeek(startOfToday(), { weekStartsOn: 0 }) && d <= endOfWeek(startOfToday(), { weekStartsOn: 0 });
                            }).length} <span className="text-sm font-sans font-medium text-muted">Apt.</span>
                          </p>
                        </div>
                      </div>

                      <div className="glass-card p-6 border-t-4 border-t-primary">
                        <h3 className="text-xl font-serif text-foreground mb-6 flex justify-between items-center">
                          Sua Agenda da Semana
                          <span className="text-sm font-sans font-normal text-muted bg-muted/20 px-3 py-1 rounded-full">
                            {format(startOfWeek(startOfToday(), { weekStartsOn: 0 }), 'dd/MM')} a {format(endOfWeek(startOfToday(), { weekStartsOn: 0 }), 'dd/MM')}
                          </span>
                        </h3>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-border/50 text-muted text-sm">
                                <th className="py-3 font-medium">Data/Hora</th>
                                <th className="py-3 font-medium">Cliente</th>
                                <th className="py-3 font-medium">Serviço</th>
                                <th className="py-3 font-medium text-right shrink-0">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeAppointments.filter(a => {
                                const d = parseISO(a.date);
                                return d >= startOfWeek(startOfToday(), { weekStartsOn: 0 }) && d <= endOfWeek(startOfToday(), { weekStartsOn: 0 });
                              })
                                .sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`))
                                .map(app => (
                                  <tr key={app.id} className="border-b border-border/50 text-foreground last:border-0 hover:bg-border/20">
                                    <td className="py-4 px-2">
                                      <span className="font-medium mr-2">{format(parseISO(app.date), 'dd/MM')}</span>
                                      <span className="text-primary">{app.time}</span>
                                    </td>
                                    <td className="py-4 px-2 font-medium">{app.client_name}</td>
                                    <td className="py-4 px-2 text-muted">{app.service_name || '-'}</td>
                                    <td className="py-4 px-2 text-right">
                                      <button onClick={() => handleCancelAppt(app.id)} className="text-red-500 hover:bg-red-500/10 p-2 rounded transition-colors" title="Desmarcar">
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              {activeAppointments.filter(a => {
                                const d = parseISO(a.date);
                                return d >= startOfWeek(startOfToday(), { weekStartsOn: 0 }) && d <= endOfWeek(startOfToday(), { weekStartsOn: 0 });
                              }).length === 0 && (
                                  <tr><td colSpan="4" className="text-center py-8 text-muted">Livre! Nenhum agendamento para esta semana.</td></tr>
                                )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
               )}
                  </div>
                )}


                {activeTab === 'agenda' && (
                    <div className="fade-in-up duration-500">
                      <div className="flex flex-col xl:flex-row gap-8 items-start">

                        <div className="glass-card p-4 md:p-6 flex-2 xl:w-2/3 w-full">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                             <h3 className="text-xl md:text-2xl font-serif text-foreground">Navegador de Datas</h3>
                             <div className="flex items-center gap-2 bg-background border border-border/50 rounded-lg p-1 w-fit">
                                <button onClick={handlePrevMonth} disabled={currentMonth <= minMonth} className="p-1.5 md:p-2 text-muted hover:text-foreground disabled:opacity-30 transition-colors"><ChevronLeft size={18} /></button>
                                <span className="font-medium text-foreground min-w-[100px] md:min-w-[120px] text-center capitalize text-sm md:text-base">{format(currentMonth, 'MMMM yyyy', {locale: ptBR})}</span>
                                <button onClick={handleNextMonth} disabled={currentMonth >= maxMonth} className="p-1.5 md:p-2 text-muted hover:text-foreground disabled:opacity-30 transition-colors"><ChevronRight size={18} /></button>
                             </div>
                          </div>

                          <div className="grid grid-cols-7 gap-1 md:gap-3 mb-2 text-center text-[10px] md:text-xs font-semibold text-muted uppercase tracking-wider">
                            <div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
                          </div>

                          <div className="grid grid-cols-7 gap-2 md:gap-3">
                            {calendarDays.map((d, i) => {
                              const isSelected = isSameDay(d, selectedCalendarDate);
                              const isCurrentMonth = isSameMonth(d, currentMonth);
                              const dayStr = format(d, 'yyyy-MM-dd');
                              const dayApps = activeAppointments.filter(a => a.date === dayStr);
                              const isToday = isSameDay(d, startOfToday());

                              return (
                                <button
                                  key={i}
                                  onClick={() => setSelectedCalendarDate(d)}
                                  className={`aspect-square p-1 md:p-2 rounded-xl border flex flex-col items-center justify-center transition-all ${!isCurrentMonth ? 'opacity-30 hover:opacity-70 bg-transparent' : ''} ${isSelected ? 'border-primary bg-primary text-white scale-105 shadow-lg shadow-primary/30' : 'border-border bg-background/50 text-muted hover:border-primary/50 hover:text-foreground'}`}
                                >
                                  <span className={`text-base md:text-xl font-bold ${isToday && !isSelected ? 'text-primary' : ''}`}>{format(d, 'd')}</span>
                                  <div className="mt-1 min-h-[4px] md:min-h-[12px] flex flex-wrap justify-center gap-0.5 md:gap-1">
                                    {dayApps.length > 0 && (
                                      <>
                                        {dayApps.slice(0, 3).map((_, idx) => (
                                          <div key={idx} className={`w-1 h-1 md:w-1.5 md:h-1.5 rounded-full ${isSelected ? 'bg-white/80' : 'bg-primary'}`}></div>
                                        ))}
                                        {dayApps.length > 3 && <div className={`text-[8px] md:text-[9px] leading-none font-bold ${isSelected ? 'text-white/80' : 'text-primary'}`}>+</div>}
                                      </>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="glass-card p-6 flex-1 xl:w-1/3 w-full border-primary/20 shadow-[0_0_40px_rgba(244,114,182,0.06)] relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full pointer-events-none"></div>
                          <div className="flex items-center justify-between mb-6 pb-4 border-b border-border/50 relative z-10">
                            <h3 className="text-xl font-serif text-foreground">Agenda do Dia</h3>
                            <div className="bg-primary text-white font-bold px-3 py-1 rounded-lg">
                              {format(selectedCalendarDate, 'dd/MM/yyyy')}
                            </div>
                          </div>

                          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 relative z-10">
                            {selectedDayAppointments.length === 0 ? (
                              <div className="text-center py-10 text-muted">
                                <CalendarIcon className="mx-auto mb-4 opacity-20 text-primary" size={48} />
                                <p>Livre. Nenhum atendimento para esta data.</p>
                              </div>
                            ) : (
                              selectedDayAppointments.sort((a, b) => a.time.localeCompare(b.time)).map(app => (
                                <div key={app.id} className="p-4 rounded-xl border border-border bg-background flex gap-4 hover:border-primary/50 transition-colors group relative shadow-sm hover:shadow-md">
                                  <div className="flex flex-col items-center justify-center bg-card border border-border/50 rounded-lg px-3 py-2">
                                    <span className="text-primary font-bold">{app.time}</span>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="text-foreground font-medium">{app.client_name}</h4>
                                    <p className="text-sm text-muted">{app.service_name}</p>
                                    {isAdmin && <p className="text-xs text-primary mt-1 font-medium flex items-center gap-1"><User size={10} /> {app.professional_name}</p>}
                                  </div>
                                  <button onClick={() => handleCancelAppt(app.id)} className="absolute top-4 right-4 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/10 p-2 rounded" title="Desmarcar">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'catalog' && isAdmin && (
                    <div className="fade-in-up duration-500">
                      <div className="glass-card p-6 mb-8">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-2xl font-serif text-foreground">Catálogo de Serviços Disponíveis</h3>
                          <button onClick={() => setShowAddService(!showAddService)} className="btn-primary py-2 text-sm flex items-center gap-2">
                            {showAddService ? <X size={16} /> : <Plus size={16} />} {showAddService ? 'Cancelar' : 'Novo Serviço'}
                          </button>
                        </div>

                        {showAddService && (
                          <form onSubmit={handleAddService} className="bg-card border border-primary/30 rounded-xl p-6 mb-6 slide-in-from-top-4 animate-in duration-300">
                            <h4 className="text-foreground mb-4 font-medium">Injetar Novo Serviço no Web App</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                              <input className="input-field" placeholder="Nome do Serviço" required value={newService.name} onChange={e => setNewService({ ...newService, name: e.target.value })} />
                              <input className="input-field" placeholder="Duração (Minutos)" type="number" required value={newService.duration} onChange={e => setNewService({ ...newService, duration: e.target.value })} />
                              <input className="input-field" placeholder="Preço (Ex: 120.50)" type="number" step="0.01" required value={newService.price} onChange={e => setNewService({ ...newService, price: e.target.value })} />
                            </div>
                            <button type="submit" className="bg-green-500 hover:bg-green-600 text-white font-semibold px-6 py-2 rounded-lg transition-colors shadow-lg shadow-green-500/20">Publicar Serviço Agora</button>
                          </form>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {services.map(srv => (
                            <div key={srv.id} className="p-6 rounded-xl border border-border bg-background flex flex-col hover:border-primary/50 transition-colors shadow-sm relative group overflow-hidden">
                              <div className="absolute right-0 top-0 w-16 h-16 bg-primary/5 rounded-bl-full pointer-events-none"></div>
                              <h4 className="text-xl font-serif text-foreground mb-1 pr-8">{srv.name}</h4>
                              <p className="text-sm text-muted mb-4">{srv.duration} minutos para conclusão</p>
                              <p className="text-2xl font-bold text-primary mt-auto">R$ {srv.price.toFixed(2)}</p>

                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteService(srv.id); }}
                                className="absolute top-4 right-4 text-red-500 bg-red-500/10 hover:bg-red-500/20 p-2 rounded transition-colors z-20 shadow-sm"
                                title="Apagar Serviço"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'staff' && isAdmin && (
                    <div className="fade-in-up duration-500">
                      <div className="glass-card p-6 mb-8">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-2xl font-serif text-foreground">Gestão Integrada de RH</h3>
                          <button onClick={() => setShowAddStaff(!showAddStaff)} className="btn-primary py-2 text-sm flex items-center gap-2">
                            {showAddStaff ? <X size={16} /> : <Plus size={16} />} {showAddStaff ? 'Cancelar' : 'Novo Membro'}
                          </button>
                        </div>

                        {showAddStaff && (
                          <form onSubmit={handleAddStaff} className="bg-card border border-primary/30 rounded-xl p-6 mb-6 slide-in-from-top-4 animate-in duration-300">
                            <h4 className="text-foreground mb-4 font-medium">Criar Conta de Acesso para Profissional</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              <input className="input-field" placeholder="Nome Completo" required value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })} />
                              <input className="input-field" placeholder="Especialidade (Ex: Designer)" required value={newStaff.specialty} onChange={e => setNewStaff({ ...newStaff, specialty: e.target.value })} />
                              <input className="input-field" placeholder="Iniciais (Ex: AB)" required maxLength={2} value={newStaff.avatar} onChange={e => setNewStaff({ ...newStaff, avatar: e.target.value })} />
                            </div>
                            <h4 className="text-foreground mb-4 mt-6 font-medium">Credenciais de Login</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                              <input className="input-field" placeholder="Nome de Usuário" required value={newStaff.username} onChange={e => setNewStaff({ ...newStaff, username: e.target.value })} />
                              <input className="input-field" placeholder="Senha" type="password" required value={newStaff.password} onChange={e => setNewStaff({ ...newStaff, password: e.target.value })} />
                            </div>
                            <button type="submit" className="bg-green-500 hover:bg-green-600 text-white font-semibold px-6 py-2 rounded-lg transition-colors shadow-lg shadow-green-500/20">Salvar e Conceder Acesso</button>
                          </form>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {professionals.map(pro => (
                            <div key={pro.id} className="p-4 rounded-xl border border-border bg-background flex flex-col hover:border-primary/50 transition-colors shadow-sm">
                              <div className="flex items-center gap-4 mb-4">
                                <div className="w-12 h-12 rounded-full bg-primary-light/50 text-primary flex items-center justify-center font-bold text-lg">
                                  {pro.avatar}
                                </div>
                                <div className="flex-1">
                                  <h4 className="text-lg font-medium text-foreground">{pro.name}</h4>
                                  <p className="text-sm text-muted">{pro.specialty}</p>
                                </div>
                              </div>
                              <div className="mt-auto border-t border-border pt-4 flex justify-between items-center">
                                <span className="text-xs text-muted">Login: <span className="text-foreground font-medium">{pro.username}</span></span>
                                <button onClick={() => handleDeleteStaff(pro.id)} className="text-red-500 hover:bg-red-500/10 p-2 rounded transition-colors" title="Demitir Profissional">
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'stats' && isAdmin && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-2xl font-serif text-foreground">Desempenho da Equipe</h3>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        {professionals.map(p => {
                          const todayStr = format(startOfToday(), 'yyyy-MM-dd');
                          const now = new Date();
                          const activeProApps = activeAppointments.filter(a => a.professional_id === p.id);
                          const pastApps = activeProApps.filter(a => a.date < todayStr || (a.date === todayStr && a.time < format(now, 'HH:mm')));
                          const futureApps = activeProApps.filter(a => a.date > todayStr || (a.date === todayStr && a.time >= format(now, 'HH:mm')));

                          const pastRevenue = pastApps.reduce((acc, a) => acc + (a.service_price || 0), 0);
                          const futureRevenue = futureApps.reduce((acc, a) => acc + (a.service_price || 0), 0);

                          return (
                            <div key={p.id} className="glass-card p-6 border-l-4 border-l-primary flex flex-col gap-4">
                              <div className="flex items-center gap-4 border-b border-border/50 pb-4">
                                <div className="w-14 h-14 rounded-xl bg-muted/20 flex items-center justify-center text-2xl font-bold">{p.avatar}</div>
                                <div>
                                  <h4 className="text-xl font-bold text-foreground">{p.name}</h4>
                                  <p className="text-sm text-muted">{p.specialty}</p>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-background/50 border border-border">
                                  <p className="text-xs font-semibold uppercase text-muted tracking-wide mb-1">Realizado</p>
                                  <p className="text-2xl font-bold text-foreground mb-1">{pastApps.length} <span className="text-xs font-normal text-muted">Apt.</span></p>
                                  <p className="text-primary font-semibold">R$ {pastRevenue.toFixed(2)}</p>
                                </div>
                                <div className="p-4 rounded-xl bg-background/50 border border-border">
                                  <p className="text-xs font-semibold uppercase text-muted tracking-wide mb-1">A Realizar</p>
                                  <p className="text-2xl font-bold text-foreground mb-1">{futureApps.length} <span className="text-xs font-normal text-muted">Apt.</span></p>
                                  <p className="text-primary font-semibold">R$ {futureRevenue.toFixed(2)}</p>
                                </div>
                              </div>

                              <div className="mt-2 pt-4 border-t border-border/50 flex justify-between items-center text-sm">
                                <span className="text-muted">Total Cativado:</span>
                                <span className="font-bold text-foreground text-lg">R$ {(pastRevenue + futureRevenue).toFixed(2)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                   {activeTab === 'clients' && (
                    <div className="fade-in-up duration-500 glass-card p-6">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-2xl font-serif text-foreground">Base de Clientes</h3>
                      </div>
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-border/50 text-muted text-sm capitalize">
                            <th className="py-3 px-4 font-medium">Nome</th>
                            <th className="py-3 px-4 font-medium">Telefone</th>
                            <th className="py-3 px-4 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clients.map(client => (
                            <tr key={client.id} className="border-b border-border/30 text-foreground hover:bg-border/20 transition-colors">
                              <td className="py-4 px-4 font-medium">{client.name}</td>
                              <td className="py-4 px-4 text-muted">{client.phone}</td>
                              <td className="py-2 px-4 text-right space-x-2">
                                <button 
                                  onClick={() => { setSelectedClient(client); setShowEditClientModal(true); }}
                                  className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                  title="Editar Cliente"
                                >
                                   <Edit2 size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteClient(client.id)}
                                  className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                  title="Excluir da Base"
                                >
                                   <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {clients.length === 0 && (
                            <tr><td colSpan="3" className="text-center py-10 text-muted italic">Nenhum cliente cadastrado ainda.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Modal de Edição de Cliente */}
                  {showEditClientModal && selectedClient && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                      <div className="glass-card p-8 max-w-md w-full slide-in-from-bottom-4 animate-in duration-300">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-2xl font-serif text-foreground">Editar Cliente</h3>
                          <button onClick={() => setShowEditClientModal(false)} className="text-muted hover:text-foreground"><X size={24} /></button>
                        </div>
                        <form onSubmit={handleEditClient} className="space-y-4">
                          <div>
                            <label className="text-sm font-medium text-muted mb-1 block">Nome Completo</label>
                            <input 
                              className="input-field w-full" 
                              value={selectedClient.name} 
                              onChange={e => setSelectedClient({...selectedClient, name: e.target.value})}
                              required 
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-muted mb-1 block">Telefone / WhatsApp</label>
                            <input 
                              className="input-field w-full" 
                              value={selectedClient.phone} 
                              onChange={e => setSelectedClient({...selectedClient, phone: e.target.value})}
                              required 
                            />
                          </div>
                          <div className="pt-6 flex gap-3">
                            <button 
                              type="button"
                              onClick={() => setShowEditClientModal(false)}
                              className="flex-1 py-3 rounded-xl border border-border text-muted font-bold hover:bg-border/50 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button 
                              type="submit"
                              className="flex-1 py-3 rounded-xl bg-primary text-white font-bold shadow-lg shadow-primary/20 transition-transform active:scale-95"
                            >
                              Salvar Alterações
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {activeTab === 'settings' && isAdmin && (
                    <div className="fade-in-up duration-500 space-y-8">

                      {/* Seção 1: Identidade */}
                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Briefcase size={20} className="text-primary" /></div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Identidade do Negócio</h3>
                            <p className="text-xs text-muted">Informações básicas do seu estabelecimento</p>
                          </div>
                        </div>
                        <div className="space-y-5">
                          <div>
                            <label className="block text-sm font-medium text-muted mb-2">Nome do Estabelecimento</label>
                            <input type="text" className="input-field max-w-md" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-muted mb-2">Número do WhatsApp (com DDD)</label>
                            <input type="text" className="input-field max-w-md" placeholder="5511999999999" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} />
                            <p className="text-xs text-muted mt-1">Formato internacional sem +. Ex: 5511999999999</p>
                          </div>
                        </div>
                      </div>

                      {/* Seção 2: Horário de Funcionamento */}
                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><CalendarIcon size={20} className="text-green-500" /></div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Horário de Funcionamento</h3>
                            <p className="text-xs text-muted">Defina o expediente e os dias de trabalho</p>
                          </div>
                        </div>
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-muted mb-2">Início do Expediente</label>
                              <input type="time" className="input-field" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-muted mb-2">Fim do Expediente</label>
                              <input type="time" className="input-field" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-muted mb-2">Intervalo (minutos)</label>
                              <select className="input-field" value={slotInterval} onChange={(e) => setSlotInterval(e.target.value)}>
                                <option value="15">15 min</option>
                                <option value="30">30 min</option>
                                <option value="45">45 min</option>
                                <option value="60">60 min</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-muted mb-3">Dias de Funcionamento</label>
                            <div className="flex flex-wrap gap-2">
                              {dayOptions.map(d => (
                                <button
                                  key={d.k}
                                  type="button"
                                  onClick={() => toggleWorkDay(d.k)}
                                  className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                    workDays.includes(d.k)
                                      ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-105'
                                      : 'bg-background border border-border text-muted hover:border-primary/50'
                                  }`}
                                >
                                  {d.l}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Seção 3: Agendamento Online */}
                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Activity size={20} className="text-blue-500" /></div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Agendamento Online</h3>
                            <p className="text-xs text-muted">Controle de visibilidade do portal do cliente</p>
                          </div>
                        </div>
                        <div className="space-y-5">
                          <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-background/50">
                            <div>
                              <p className="text-foreground font-medium">Permitir Agendamento Online</p>
                              <p className="text-xs text-muted">Quando desativado, clientes não conseguem agendar pelo site.</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAllowOnlineBooking(!allowOnlineBooking)}
                              className={`relative w-14 h-8 rounded-full transition-colors duration-300 ${
                                allowOnlineBooking ? 'bg-primary' : 'bg-border'
                              }`}
                            >
                              <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform duration-300 ${
                                allowOnlineBooking ? 'translate-x-6' : 'translate-x-0'
                              }`} />
                            </button>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-muted mb-2">Agenda Visível Antecipada (dias)</label>
                            <select className="input-field max-w-xs" value={maxAdvanceDays} onChange={(e) => setMaxAdvanceDays(e.target.value)}>
                              <option value="7">7 dias</option>
                              <option value="14">14 dias</option>
                              <option value="30">30 dias</option>
                              <option value="60">60 dias</option>
                              <option value="90">90 dias</option>
                            </select>
                            <p className="text-xs text-muted mt-1">Até quantos dias no futuro o cliente pode agendar.</p>
                          </div>
                        </div>
                      </div>

                      {/* Seção 4: Mensagem WhatsApp */}
                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center"><CheckCircle size={20} className="text-emerald-500" /></div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Modelo de Mensagem</h3>
                            <p className="text-xs text-muted">Personalize a mensagem de confirmação do WhatsApp</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted mb-3">Tags suportadas: <code className="bg-primary/10 text-primary px-1 py-0.5 rounded break-words mr-1">{"{cliente}"}</code> <code className="bg-primary/10 text-primary px-1 py-0.5 rounded break-words mr-1">{"{servico}"}</code> <code className="bg-primary/10 text-primary px-1 py-0.5 rounded break-words mr-1">{"{profissional}"}</code> <code className="bg-primary/10 text-primary px-1 py-0.5 rounded break-words mr-1">{"{data}"}</code> <code className="bg-primary/10 text-primary px-1 py-0.5 rounded break-words">{"{hora}"}</code></p>
                          <textarea className="input-field w-full h-40 resize-y" value={whatsappMessage} onChange={(e) => setWhatsappMessage(e.target.value)} placeholder="Sua mensagem de WhatsApp..." />
                        </div>
                      </div>

                      {/* Botão Salvar Global */}
                      <div className="flex justify-end">
                        <button onClick={handleSaveSettings} className="btn-primary px-8 py-3 text-base flex items-center gap-2 shadow-xl shadow-primary/20">
                          <CheckCircle size={18} /> Salvar Todas as Configurações
                        </button>
                      </div>

                    </div>
                  )}

                  {activeTab === 'settings' && !isAdmin && (
                    <div className="fade-in-up duration-500 space-y-8">
                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <User size={20} className="text-primary" />
                          </div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Perfil Profissional</h3>
                            <p className="text-xs text-muted">Atualize os dados que aparecem no seu painel.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-muted mb-2">Nome Completo</label>
                            <input
                              type="text"
                              className="input-field"
                              value={profileForm.name}
                              onChange={(e) => handleProfileFormChange('name', e.target.value)}
                              placeholder="Seu nome profissional"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-muted mb-2">Especialidade</label>
                            <input
                              type="text"
                              className="input-field"
                              value={profileForm.specialty}
                              onChange={(e) => handleProfileFormChange('specialty', e.target.value)}
                              placeholder="Ex: Designer, Manicure..."
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-muted mb-2">Iniciais / Avatar</label>
                            <input
                              type="text"
                              maxLength={2}
                              className="input-field uppercase"
                              value={profileForm.avatar}
                              onChange={(e) => handleProfileFormChange('avatar', e.target.value.toUpperCase())}
                              placeholder="Ex: TT"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                            <Lock size={20} className="text-blue-500" />
                          </div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Acesso e Segurança</h3>
                            <p className="text-xs text-muted">Gerencie usuário e senha de acesso ao painel.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-muted mb-2">Usuário</label>
                            <input
                              type="text"
                              className="input-field"
                              value={profileForm.username}
                              onChange={(e) => handleProfileFormChange('username', e.target.value)}
                              placeholder="Seu usuário de login"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-muted mb-2">Nova Senha</label>
                            <input
                              type="password"
                              className="input-field"
                              value={profileForm.password}
                              onChange={(e) => handleProfileFormChange('password', e.target.value)}
                              placeholder="Deixe em branco para manter"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-muted mb-2">Confirmar Nova Senha</label>
                            <input
                              type="password"
                              className="input-field"
                              value={profileForm.confirmPassword}
                              onChange={(e) => handleProfileFormChange('confirmPassword', e.target.value)}
                              placeholder="Repita a nova senha"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <CalendarIcon size={20} className="text-primary" />
                          </div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Meu Expediente</h3>
                            <p className="text-xs text-muted">Defina os horários e dias em que você atende.</p>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-muted mb-2">Início do Expediente</label>
                              <input
                                type="time"
                                className="input-field"
                                value={workStart}
                                onChange={(e) => setWorkStart(e.target.value)}
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-muted mb-2">Fim do Expediente</label>
                              <input
                                type="time"
                                className="input-field"
                                value={workEnd}
                                onChange={(e) => setWorkEnd(e.target.value)}
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-muted mb-2">Intervalo entre horários</label>
                              <select
                                className="input-field"
                                value={slotInterval}
                                onChange={(e) => setSlotInterval(e.target.value)}
                              >
                                <option value="15">15 min</option>
                                <option value="30">30 min</option>
                                <option value="45">45 min</option>
                                <option value="60">60 min</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-muted mb-3">Dias de atendimento</label>
                            <div className="flex flex-wrap gap-2">
                              {dayOptions.map(day => (
                                <button
                                  key={day.k}
                                  type="button"
                                  onClick={() => toggleWorkDay(day.k)}
                                  className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                    workDays.includes(day.k)
                                      ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-105'
                                      : 'bg-background border border-border text-muted hover:border-primary/50'
                                  }`}
                                >
                                  {day.l}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                            <Settings size={20} className="text-emerald-500" />
                          </div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Resumo da Operação</h3>
                            <p className="text-xs text-muted">Referência rápida das configurações globais do negócio.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="rounded-xl border border-border bg-background/50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Estabelecimento</p>
                            <p className="text-foreground font-medium">{businessName || 'Não definido'}</p>
                          </div>

                          <div className="rounded-xl border border-border bg-background/50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Expediente Atual</p>
                            <p className="text-foreground font-medium">{workStart} às {workEnd}</p>
                            <p className="text-xs text-muted mt-1">Intervalos de {slotInterval} min</p>
                          </div>

                          <div className="rounded-xl border border-border bg-background/50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Agendamento Online</p>
                            <p className="text-foreground font-medium">{allowOnlineBooking ? 'Ativo' : 'Desativado'}</p>
                            <p className="text-xs text-muted mt-1">Janela de {maxAdvanceDays} dias</p>
                          </div>
                        </div>

                        <div className="mt-5">
                          <p className="text-sm font-medium text-muted mb-3">Dias de funcionamento</p>
                          <div className="flex flex-wrap gap-2">
                            {dayOptions.map(day => (
                              <span
                                key={day.k}
                                className={`px-4 py-2 rounded-xl text-sm font-bold ${
                                  workDays.includes(day.k)
                                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                    : 'bg-background border border-border text-muted'
                                }`}
                              >
                                {day.l}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          onClick={handleSaveProfessionalSettings}
                          className="btn-primary px-8 py-3 text-base flex items-center gap-2 shadow-xl shadow-primary/20"
                        >
                          <CheckCircle size={18} /> Salvar Minhas Configurações
                        </button>
                      </div>
                    </div>
                  )}

                </div>
            </main>

      {/* MODAL FECHAR HORÁRIO */}
      {showBlockModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in-up">
          <div className="bg-background w-full max-w-md rounded-2xl border border-border shadow-2xl p-6 relative">
            <button 
              onClick={() => setShowBlockModal(false)}
              className="absolute right-4 top-4 text-muted hover:text-foreground transition-colors"
            >
              <X size={24} />
            </button>
            
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-orange-500/20 text-orange-500 flex items-center justify-center">
                <Lock size={20} />
              </div>
              <h2 className="text-xl font-serif text-foreground">Fechar Horário</h2>
            </div>
            
            <p className="text-sm text-muted mb-6">
              Bloqueie temporariamente a agenda para almoço, pausas ou indisponibilidades.
            </p>

            <form onSubmit={handleAddBlock} className="space-y-4">
              {isAdmin && (
                <div>
                  <label className="text-sm text-muted mb-1 block">Profissional</label>
                  <select className="input-field w-full" value={newBlock.professional_id} onChange={e => setNewBlock({ ...newBlock, professional_id: e.target.value })} required>
                    <option value="" disabled>Selecione um Profissional</option>
                    {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted mb-1 block">Data</label>
                  <input type="date" className="input-field w-full" value={newBlock.date} onChange={e => setNewBlock({ ...newBlock, date: e.target.value })} min={format(startOfToday(), 'yyyy-MM-dd')} required />
                </div>
                <div>
                  <label className="text-sm text-muted mb-1 block">Horário de Início</label>
                  <select className="input-field w-full" value={newBlock.time} onChange={e => setNewBlock({ ...newBlock, time: e.target.value })} required>
                    <option value="" disabled>Ex: 12:00</option>
                    {appointmentTimeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm text-muted mb-1 block">Duração (Tempo Fora)</label>
                <select className="input-field w-full" value={newBlock.duration} onChange={e => setNewBlock({ ...newBlock, duration: e.target.value })} required>
                  <option value="15">15 minutos</option>
                  <option value="30">30 minutos</option>
                  <option value="45">45 minutos</option>
                  <option value="60">1 hora</option>
                  <option value="90">1 hora e meia</option>
                  <option value="120">2 horas</option>
                  <option value="240">4 horas (Meio Turno)</option>
                  <option value="480">8 horas (Turno Completo)</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-muted mb-1 block">Descrição / Motivo (Opcional)</label>
                <input 
                  type="text" 
                  className="input-field w-full" 
                  placeholder="Ex: Horário de Almoço, Médico, etc." 
                  value={newBlock.description} 
                  onChange={e => setNewBlock({ ...newBlock, description: e.target.value })} 
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowBlockModal(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors font-medium">Bloquear</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
        );
}
