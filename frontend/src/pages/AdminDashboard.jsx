import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../api';
import { useNavigate } from '../router';
import { Calendar as CalendarIcon, Users, Settings, Scissors, LayoutDashboard, Search, Bell, LogOut, Trash2, Plus, X, User, Sun, Moon, Briefcase, DollarSign, Activity, ChevronLeft, ChevronRight, Menu, AlertTriangle, CheckCircle, Info, Edit2, Lock, Unlock, Clock, MessageCircle, Tag, Copy, FileText, Send, Printer } from 'lucide-react';
import { format, parseISO, startOfToday, addDays, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, subMonths, addMonths, isSameMonth, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { buildEffectiveSchedule, buildTimeSlots, getProfessionalSettingKey } from '../utils/schedule';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);

const safeParseISO = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  try {
    const cleanStr = dateStr.split('T')[0];
    const parsed = parseISO(cleanStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
};

const safeFormatDate = (dateStr, formatStr = 'dd/MM', options = {}) => {
  const parsed = safeParseISO(dateStr);
  if (!parsed) return dateStr || '--/--';
  try {
    return format(parsed, formatStr, options);
  } catch {
    return dateStr || '--/--';
  }
};

const timeToMinutes = (t) => {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const defaultPublicProfile = {
  address: '',
  mapsUrl: '',
  instagramUrl: '',
  openingNote: '',
  payments: '',
  parking: '',
  googleReviewsUrl: '',
  googleRating: '',
  googleReviewCount: '',
  cancellationPolicy: 'Cancelamentos e remarcações podem ser solicitados pelo painel da cliente ou pelo WhatsApp. Condições específicas são informadas na confirmação.',
  privacyContact: '',
  heroEyebrow: 'Cuidado especializado para suas unhas',
  heroSubtitle: ''
};

function TimelineView({ selectedDate, setSelectedDate, appointments, professionals, currentUser, isAdmin, onCancel, onComplete, onConfirm, onSelectAppt, onDropAppt, onQuickAdd, workStart, workEnd, slotInterval }) {
  const [timelineMode, setTimelineMode] = useState('dia'); // 'dia' ou 'semana'
  const [selectedProfId, setSelectedProfId] = useState('all');
  const [mobileProfessionalId, setMobileProfessionalId] = useState(() => String(currentUser?.id || ''));
  const [isMobileTimeline, setIsMobileTimeline] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const syncViewport = event => setIsMobileTimeline(event.matches);
    setIsMobileTimeline(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', syncViewport);
    return () => mediaQuery.removeEventListener?.('change', syncViewport);
  }, []);

  const calculateEndTime = (startTime, duration) => {
    if (!startTime) return '';
    const [h, m] = startTime.split(':').map(Number);
    const totalM = h * 60 + m + (Number(duration) || 30);
    const endH = Math.floor(totalM / 60).toString().padStart(2, '0');
    const endM = (totalM % 60).toString().padStart(2, '0');
    return `${endH}:${endM}`;
  };

  const { effectiveStart, effectiveEnd } = useMemo(() => {
    let minMinutes = timeToMinutes(workStart || '09:00');
    let maxMinutes = timeToMinutes(workEnd || '18:00');

    (appointments || []).forEach(a => {
      if (a.time) {
        const appStart = timeToMinutes(a.time);
        if (appStart < minMinutes) minMinutes = appStart;

        let duration = Number(a.service_duration || a.duration) || 30;
        if (a.notes?.startsWith('MULTI_SERVICES:')) {
          try {
            const marker = a.notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
            const multiData = JSON.parse(marker.replace('MULTI_SERVICES:', ''));
            duration = multiData.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
          } catch {}
        } else if (a.notes?.startsWith('BLOCK:')) {
          duration = Number.parseInt(a.notes.split(':')[1], 10) || duration;
        }
        const appEnd = appStart + duration;
        if (appEnd > maxMinutes) maxMinutes = appEnd;
      }
    });

    const interval = Number(slotInterval) || 30;
    const roundedMax = Math.min(24 * 60, Math.ceil(maxMinutes / interval) * interval);

    const startH = Math.floor(minMinutes / 60);
    const startM = minMinutes % 60;
    const endH = Math.floor(roundedMax / 60);
    const endM = roundedMax % 60;

    return {
      effectiveStart: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
      effectiveEnd: `${String(Math.min(23, endH)).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
    };
  }, [workStart, workEnd, slotInterval, appointments]);

  const timeSlots = buildTimeSlots(effectiveStart, effectiveEnd, slotInterval);
  const currentWeekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: addDays(currentWeekStart, 6) });
  
  const visibleProfessionals = useMemo(() => professionals.filter(p => {
    const isSocio = p.specialty?.toLowerCase().includes('sócio') || p.specialty?.toLowerCase().includes('socio') || p.name?.toLowerCase().includes('sócio') || p.name?.toLowerCase().includes('socio');
    if (isSocio) return false;
    return isAdmin || String(p.id) === String(currentUser.id) || p.is_public_agenda;
  }), [professionals, isAdmin, currentUser.id]);

  useEffect(() => {
    if (visibleProfessionals.length === 0) return;
    const currentSelectionExists = visibleProfessionals.some(professional => String(professional.id) === mobileProfessionalId);
    if (!currentSelectionExists) {
      const ownProfile = visibleProfessionals.find(professional => String(professional.id) === String(currentUser.id));
      setMobileProfessionalId(String((ownProfile || visibleProfessionals[0]).id));
    }
  }, [visibleProfessionals, currentUser.id, mobileProfessionalId]);

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const isToday = isSameDay(selectedDate, now);
  const currentTimeTop = (() => {
    if (!timeSlots || timeSlots.length === 0) return -1;
    const totalMin = now.getHours() * 60 + now.getMinutes();
    const firstSlot = timeSlots[0] || workStart || '08:00';
    const [startH, startM] = firstSlot.split(':').map(Number);
    const dayStartMin = startH * 60 + startM;
    const SLOT_HEIGHT = 64;
    return ((totalMin - dayStartMin) / Number(slotInterval || 30)) * SLOT_HEIGHT;
  })();

  const columns = timelineMode === 'dia'
    ? (isMobileTimeline
        ? visibleProfessionals.filter(professional => String(professional.id) === mobileProfessionalId)
        : visibleProfessionals)
    : weekDays;

  return (
    <div className="glass-panel p-0 overflow-hidden border-border/50 shadow-2xl flex flex-col h-[calc(100dvh-8.5rem)] md:h-fit md:min-h-[75vh] mb-0 md:mb-20 bg-background/80">
      
      {/* NAVBAR DE CONTROLE DE DIAS & MODO - PREMIUM REDESIGN */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-2.5 p-3 md:p-5 bg-card/60 border-b border-border/50 relative z-30 shrink-0">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="grid grid-cols-2 bg-background/60 p-1 rounded-2xl border border-border/60 flex-1 md:flex-none">
            <button 
              onClick={() => setTimelineMode('dia')} 
              className={`px-3 md:px-6 py-2.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider transition-all ${timelineMode === 'dia' ? 'bg-primary text-white shadow-lg glow-primary' : 'text-muted hover:text-foreground'}`}
            >
              <span className="md:hidden">Profissional</span>
              <span className="hidden md:inline">Visão por Profissional (Dia)</span>
            </button>
            <button 
              onClick={() => setTimelineMode('semana')} 
              className={`px-3 md:px-6 py-2.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider transition-all ${timelineMode === 'semana' ? 'bg-primary text-white shadow-lg glow-primary' : 'text-muted hover:text-foreground'}`}
            >
              <span className="md:hidden">Semana</span>
              <span className="hidden md:inline">Visão Semanal</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 w-full md:hidden">
          <button
            onClick={() => setSelectedDate(addDays(selectedDate, timelineMode === 'semana' ? -7 : -1))}
            className="h-11 rounded-xl bg-card border border-border/60 text-muted hover:text-primary transition-colors shadow-sm flex items-center justify-center"
            title="Anterior"
          >
            <ChevronLeft size={18}/>
          </button>
          <button
            onClick={() => setSelectedDate(startOfToday())}
            className="h-11 min-w-0 rounded-xl bg-primary/10 border border-primary/20 px-3 text-primary shadow-sm"
            title="Voltar para hoje"
          >
            <span className="block truncate text-xs font-black uppercase tracking-wider">{format(selectedDate, "EEE, dd 'de' MMMM", { locale: ptBR })}</span>
            <span className="block text-[9px] font-bold uppercase tracking-widest text-muted">{isSameDay(selectedDate, startOfToday()) ? 'Hoje' : 'Toque para voltar para hoje'}</span>
          </button>
          <button
            onClick={() => setSelectedDate(addDays(selectedDate, timelineMode === 'semana' ? 7 : 1))}
            className="h-11 rounded-xl bg-card border border-border/60 text-muted hover:text-primary transition-colors shadow-sm flex items-center justify-center"
            title="Próximo"
          >
            <ChevronRight size={18}/>
          </button>
        </div>

        <div className="hidden md:flex items-center justify-between w-full md:w-auto gap-3">
          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => setSelectedDate(addDays(selectedDate, timelineMode === 'semana' ? -7 : -1))} 
              className="p-2.5 rounded-2xl bg-card border border-border/60 text-muted hover:text-primary transition-colors shadow-sm"
              title="Anterior"
            >
              <ChevronLeft size={16}/>
            </button>
            <button 
              onClick={() => setSelectedDate(startOfToday())} 
              className="px-4 py-2.5 rounded-2xl bg-card border border-border/60 text-xs font-black uppercase tracking-wider text-foreground hover:bg-primary/10 transition-colors shadow-sm"
            >
              Hoje ({format(startOfToday(), 'dd/MM')})
            </button>
            <button 
              onClick={() => setSelectedDate(addDays(selectedDate, timelineMode === 'semana' ? 7 : 1))} 
              className="p-2.5 rounded-2xl bg-card border border-border/60 text-muted hover:text-primary transition-colors shadow-sm"
              title="Próximo"
            >
              <ChevronRight size={16}/>
            </button>
          </div>

          <div className="bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider">
            📅 {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}
          </div>
        </div>

        {timelineMode === 'semana' && isAdmin && (
          <div className="w-full md:w-64">
            <select 
              className="input-field py-2 text-xs font-bold uppercase tracking-wider" 
              value={selectedProfId} 
              onChange={e => setSelectedProfId(e.target.value)}
            >
              <option value="all">Toda a Equipe</option>
              {professionals.filter(p => !(p.specialty?.toLowerCase().includes('sócio') || p.specialty?.toLowerCase().includes('socio'))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {timelineMode === 'dia' && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar w-full px-3 py-3 md:py-2 bg-card/30 border-b border-border/40">
          {weekDays.map(d => (
            <button 
              key={d.toISOString()} 
              onClick={() => setSelectedDate(d)}
              className={`px-3 md:px-4 py-2 rounded-xl md:rounded-2xl border transition-all whitespace-nowrap shrink-0 flex flex-col items-center min-w-[68px] md:min-w-[64px] ${isSameDay(d, selectedDate) ? 'bg-primary text-white border-primary font-black md:scale-105 shadow-md glow-primary' : 'border-border/50 bg-card/40 text-muted font-bold hover:text-foreground'}`}
            >
              <span className="opacity-70 uppercase text-[9px] mb-0.5">{format(d, 'EEE', {locale: ptBR})}</span>
              <span className="text-xs font-black">{format(d, 'dd/MM')}</span>
            </button>
          ))}
        </div>
      )}

      {timelineMode === 'dia' && visibleProfessionals.length > 1 && (
        <div className="md:hidden shrink-0 border-b border-border/40 bg-background/70 px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted">Agenda de</span>
            <span className="truncate text-[10px] font-black uppercase tracking-wider text-primary">
              {visibleProfessionals.find(professional => String(professional.id) === mobileProfessionalId)?.name}
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {visibleProfessionals.map(professional => {
              const isSelected = String(professional.id) === mobileProfessionalId;
              return (
                <button
                  key={professional.id}
                  type="button"
                  onClick={() => setMobileProfessionalId(String(professional.id))}
                  className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 transition-all ${isSelected ? 'border-primary bg-primary text-white shadow-md shadow-primary/20' : 'border-border/60 bg-card/70 text-muted'}`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-black ${isSelected ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'}`}>
                    {professional.avatar || professional.name?.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="max-w-[120px] truncate text-[10px] font-black uppercase tracking-wide">{professional.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Grid com Sticky Header e Sticky Column */}
      <div className="flex-1 overflow-auto relative no-scrollbar snap-x snap-mandatory md:snap-none">
        <div className="inline-flex flex-col min-w-full">
          
          {/* Header de Colunas (Profissionais / Dias) */}
          <div className="flex sticky top-0 z-40 bg-card/95 backdrop-blur-2xl border-b border-border/50">
            <div className="w-14 md:w-20 flex-shrink-0 border-r border-border/50 bg-background/95 flex items-center justify-center text-[9px] md:text-[10px] font-black text-primary uppercase tracking-widest sticky left-0 z-50">
              Hora
            </div>
            {columns.map((col, idx) => {
              const isDia = timelineMode === 'dia';
              const key = isDia ? col.id : col.toISOString();
              
              const colApps = appointments.filter(a => {
                if (isDia) {
                  return a.date === format(selectedDate, 'yyyy-MM-dd') && String(a.professional_id) === String(col.id);
                } else {
                  if (a.date !== format(col, 'yyyy-MM-dd')) return false;
                  const profTarget = !isAdmin ? currentUser.id : selectedProfId;
                  if (profTarget !== 'all' && String(a.professional_id) !== String(profTarget)) return false;
                  if (profTarget === 'all' && !visibleProfessionals.some(p => String(p.id) === String(a.professional_id))) return false;
                  return true;
                }
              });

              const colRevenue = colApps.reduce((acc, a) => acc + Number(a.service_price || 0), 0);

              return (
                <div key={key} className="min-w-[calc(100vw-3.5rem)] md:min-w-[240px] md:flex-1 snap-start border-r border-border/50 py-3 px-3 md:py-3.5 md:px-4 flex items-center justify-between gap-3 bg-card/40">
                  {isDia ? (
                    <div className="flex items-center gap-3 w-full">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary via-pink-500 to-primary-dark text-white flex items-center justify-center font-black text-xs shadow-md shrink-0">
                        {col.avatar}
                      </div>
                      <div className="overflow-hidden min-w-0 flex-1">
                        <p className="text-xs font-black text-foreground truncate uppercase tracking-wide">{col.name}</p>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-[9px] text-primary font-bold uppercase truncate">{col.specialty}</span>
                          <span className="text-[9px] text-emerald-500 font-black shrink-0">R$ {colRevenue.toFixed(0)} • {colApps.length}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={`text-left w-full flex items-center justify-between gap-3 ${isSameDay(col, startOfToday()) ? 'text-primary' : 'text-foreground'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-2xl flex items-center justify-center font-black text-xs border-2 ${isSameDay(col, startOfToday()) ? 'bg-primary text-white border-primary shadow-md glow-primary' : 'bg-card border-border/60 text-muted'}`}>
                          {format(col, 'dd')}
                        </div>
                        <div>
                          <p className="text-[9px] uppercase font-black tracking-wider opacity-70">{format(col, 'EEE', {locale: ptBR})}</p>
                          <p className="text-xs font-black uppercase">{format(col, 'MMM', {locale: ptBR})}</p>
                        </div>
                      </div>
                      <span className="text-[9px] text-primary font-bold">{colApps.length} agend.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Corpo da Grid */}
          <div className="flex relative">
            {/* Coluna de Horas Sticky */}
            <div className="w-14 md:w-20 flex-shrink-0 border-r border-border/50 bg-background/95 sticky left-0 z-30">
              {timeSlots.map(slot => (
                <div key={slot} className="h-16 border-b border-border/40 flex items-start justify-center pt-2.5 bg-background/90">
                  <span className="text-[10px] font-black text-foreground tracking-tighter bg-primary/10 px-1.5 py-0.5 rounded-lg border border-primary/20 shadow-sm">{slot}</span>
                </div>
              ))}
            </div>

            {/* Grid de Agendamentos */}
            <div className="flex flex-1 relative">
               {/* Linha do Tempo Atual em Tempo Real */}
               {((timelineMode === 'dia' && isToday) || (timelineMode === 'semana' && weekDays.some(d => isSameDay(d, now)))) && currentTimeTop >= 0 && (
                <div 
                  className="absolute left-0 right-0 z-30 pointer-events-none flex items-center"
                  style={{ top: `${currentTimeTop}px` }}
                >
                  <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.9)] -ml-[6px] z-40 border-2 border-white animate-pulse"></div>
                  <div className="flex-1 h-[2px] bg-gradient-to-r from-red-500 via-pink-500 to-transparent"></div>
                  <span className="text-[9px] bg-red-500 text-white font-black px-1.5 py-0.5 rounded-full mr-2 shadow-sm uppercase tracking-wider">Ao Vivo</span>
                </div>
              )}

              {columns.map((col, idx) => {
                const isDia = timelineMode === 'dia';
                const key = isDia ? col.id : col.toISOString();
                
                const colApps = appointments.filter(a => {
                  if (isDia) {
                    return a.date === format(selectedDate, 'yyyy-MM-dd') && String(a.professional_id) === String(col.id);
                  } else {
                    if (a.date !== format(col, 'yyyy-MM-dd')) return false;
                    const profTarget = !isAdmin ? currentUser.id : selectedProfId;
                    if (profTarget !== 'all' && String(a.professional_id) !== String(profTarget)) return false;
                    if (profTarget === 'all' && !visibleProfessionals.some(p => String(p.id) === String(a.professional_id))) return false;
                    return true;
                  }
                });

                const sortedApps = [...colApps].sort((a,b) => a.time.localeCompare(b.time));
                
                return (
                  <div key={key} className="min-w-[calc(100vw-3.5rem)] md:min-w-[240px] md:flex-1 snap-start border-r border-border/50 relative bg-grid-pattern opacity-90" style={{ backgroundSize: '100% 64px' }}>
                    {timeSlots.map(slot => (
                      <div 
                        key={slot} 
                        className="h-16 border-b border-border/30 group hover:bg-primary/5 transition-colors relative cursor-pointer"
                        onClick={() => {
                          if (onQuickAdd) {
                            const profId = isDia ? col.id : (selectedProfId !== 'all' ? selectedProfId : col.id);
                            const targetDate = isDia ? selectedDate : col;
                            onQuickAdd(profId, format(targetDate, 'yyyy-MM-dd'), slot);
                          }
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const appId = e.dataTransfer.getData('appId');
                          if (appId && onDropAppt) onDropAppt(appId, slot, col, timelineMode);
                        }}
                      >
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-2 text-[9px] font-black text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Plus size={10} /> Agendar {slot}
                        </span>
                      </div>
                    ))}
                    
                    {sortedApps.map(app => {
                      const [h, m] = app.time.split(':').map(Number);
                      const startMin = h * 60 + m;
                      const firstSlot = timeSlots[0] || workStart || '08:00';
                      const [dh, dm] = firstSlot.split(':').map(Number);
                      const dayStartMin = dh * 60 + dm;
                      const SLOT_HEIGHT = 64; 
                      
                      const top = ((startMin - dayStartMin) / Number(slotInterval || 30)) * SLOT_HEIGHT;
                      const durationMin = Number(app.service_duration) || 30;
                      const height = (durationMin / Number(slotInterval || 30)) * SLOT_HEIGHT;
                      const isBlock = app.notes?.startsWith('BLOCK:');

                      const totalOverlaps = sortedApps.filter(a => a.time === app.time).length;
                      const overlappingIndex = sortedApps.filter(a => a.time === app.time).findIndex(a => a.id === app.id);
                      
                      const widthCalc = totalOverlaps > 1 ? `calc(${100 / totalOverlaps}% - 12px)` : 'auto';
                      const leftCalc = totalOverlaps > 1 ? `calc(${(100 / totalOverlaps) * overlappingIndex}% + 6px)` : '6px';
                      const rightCalc = totalOverlaps > 1 ? 'auto' : '6px';

                      const endTimeStr = calculateEndTime(app.time, durationMin);
                      const cleanPhone = (app.client_phone || '').replace(/\D/g, '');

                      return (
                        <div 
                          key={app.id}
                          draggable={!isBlock}
                          onDragStart={(e) => { if (!isBlock) e.dataTransfer.setData('appId', app.id); }}
                          onClick={(e) => { e.stopPropagation(); if (onSelectAppt) onSelectAppt(app); }}
                          className={`absolute rounded-2xl p-2.5 shadow-xl border-l-4 transition-all hover:scale-[1.02] hover:z-50 cursor-pointer overflow-hidden backdrop-blur-md group ${
                            isBlock 
                            ? 'bg-amber-500/20 border-amber-500 text-amber-200 shadow-amber-500/10' 
                            : app.status === 'concluído'
                            ? 'bg-purple-500/20 border-purple-500 text-purple-200 shadow-purple-500/10' 
                            : app.status === 'confirmado'
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200 shadow-emerald-500/10' 
                            : 'bg-primary/25 border-primary text-white shadow-primary/20'
                          }`}
                          style={{ top: `${top + 2}px`, height: `${Math.max(height - 4, 34)}px`, width: widthCalc, left: leftCalc, right: rightCalc }}
                        >
                          <div className="flex flex-col h-full relative justify-between">
                            <div>
                              <div className="flex justify-between items-start gap-1 mb-1">
                                <span className={`text-[9px] font-black uppercase rounded-lg px-2 py-0.5 tracking-wider shadow-sm ${
                                  isBlock 
                                    ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40 flex items-center gap-1' 
                                    : 'bg-background/80 text-primary border border-primary/30'
                                }`}>
                                  {isBlock && <Lock size={10} />}
                                  {app.time} - {endTimeStr}
                                </span>
                                {!isBlock && app.status === 'confirmado' && (
                                  <span className="badge-confirmed !py-0.5 !px-2 !text-[8px]">✅ Confirmado</span>
                                )}
                                {!isBlock && app.status === 'concluído' && (
                                  <span className="badge-completed !py-0.5 !px-2 !text-[8px]">🟢 Pago</span>
                                )}
                              </div>
                              <p className="text-[11px] md:text-xs font-black uppercase tracking-tight truncate leading-tight mb-0.5 text-foreground">
                                {isBlock ? (app.client_name || 'Agenda Fechada') : app.client_name}
                              </p>
                              <p className="text-[9px] text-muted font-bold truncate uppercase">
                                {isBlock ? '⏳ Pausa / Horário Fechado' : app.service_name}
                              </p>
                            </div>

                            <div className="flex items-center justify-between pt-1 border-t border-white/10 text-[9px] font-bold">
                              <span className="text-primary font-black">
                                {isBlock ? `${durationMin}m de pausa` : `R$ ${Number(app.service_price || 0).toFixed(0)} • ${durationMin}m`}
                              </span>
                              
                              <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                                {isBlock ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); if (onCancel) onCancel(app.id); }}
                                    className="p-1 text-amber-300 hover:bg-amber-500/30 rounded-lg transition-colors flex items-center gap-1 font-bold"
                                    title="Desbloquear Horário"
                                  >
                                    <Unlock size={12} /> Desbloquear
                                  </button>
                                ) : (
                                  <>
                                    {cleanPhone && (
                                      <a 
                                        href={`https://wa.me/55${cleanPhone}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors"
                                        title="WhatsApp"
                                      >
                                        <MessageCircle size={12} />
                                      </a>
                                    )}
                                    {app.status === 'agendado' && onConfirm && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); onConfirm(app.id); }}
                                        className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors"
                                        title="Confirmar Presença"
                                      >
                                        <CheckCircle size={12} />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [settingsData, setSettingsData] = useState([]);
  const [financialStats, setFinancialStats] = useState(null);
  const [selectedAppointment, setSelectedAppointment] = useState(null);

  const [selectedCalendarDate, setSelectedCalendarDate] = useState(startOfToday());
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(startOfToday()));

  const handlePrevMonth = () => {
    setCurrentMonth(previousMonth => subMonths(previousMonth, 1));
  }

  const handleNextMonth = () => {
    setCurrentMonth(previousMonth => addMonths(previousMonth, 1));
  }

  const startDate = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
  const endDate = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', specialty: '', avatar: '', username: '', password: '' });

  const [showAddAppt, setShowAddAppt] = useState(false);
  const [newAppt, setNewAppt] = useState({ client_name: '', client_phone: '', service_ids: [], professional_id: '', date: format(new Date(), 'yyyy-MM-dd'), time: '' });
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);
  const [noShowCount, setNoShowCount] = useState(0);

  useEffect(() => {
    if (newAppt.client_phone && newAppt.client_phone.length >= 8) {
      const cancelCount = appointments.filter(a => a.client_phone === newAppt.client_phone && a.status === 'cancelado').length;
      setNoShowCount(cancelCount);
    } else {
      setNoShowCount(0);
    }
  }, [newAppt.client_phone, appointments]);

  const [showEditAppt, setShowEditAppt] = useState(false);
  const [editAppt, setEditAppt] = useState(null);

  const [showBlockModal, setShowBlockModal] = useState(false);
  const [newBlock, setNewBlock] = useState({ professional_id: '', date: format(new Date(), 'yyyy-MM-dd'), time: '12:00', endTime: '13:00', duration: '60', description: '' });

  const handleOpenBlockModal = (profId = null, timeStr = '12:00', dateStr = '') => {
    const startTime = timeStr || '12:00';
    const [h, m] = (startTime || '12:00').split(':').map(Number);
    let endH = h + 1;
    let endTime = `${Math.min(23, endH).toString().padStart(2, '0')}:${(m || 0).toString().padStart(2, '0')}`;
    if (endH >= 24) endTime = '23:59';

    const defaultProf = profId ? String(profId) : (user?.role === 'admin' ? String(professionals[0]?.id || '') : String(user?.id || ''));

    setNewBlock({
      professional_id: defaultProf,
      date: dateStr || format(new Date(), 'yyyy-MM-dd'),
      time: startTime,
      endTime: endTime,
      duration: '60',
      description: ''
    });
    setShowBlockModal(true);
  };

  const handleAddBlock = async (e) => {
    e.preventDefault();
    try {
      const profId = user.role === 'admin' ? String(newBlock.professional_id) : String(user.id);
      if (!profId) {
          openModal({ title: 'Atenção', message: 'Por favor, selecione um profissional.', type: 'info', confirmText: 'OK' });
          return;
      }
      
      const startTime = newBlock.time || '12:00';
      const endTime = newBlock.endTime || '13:00';
      
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      const calculatedDuration = endMins - startMins;

      if (calculatedDuration <= 0) {
        openModal({ title: 'Horário Inválido', message: 'O horário de término deve ser posterior ao horário de início.', type: 'error', confirmText: 'Corrigir' });
        return;
      }
      
      const payload = {
          professional_id: profId,
          date: newBlock.date,
          time: startTime,
          duration: calculatedDuration,
          description: newBlock.description
      };
      
      await api.post('/api/appointments/block', payload);
      setShowBlockModal(false);
      openModal({ title: 'Sucesso', message: `Agenda fechada das ${startTime} às ${endTime} (${calculatedDuration} min)!`, type: 'success', confirmText: 'OK' });
      await loadData(user);
    } catch (err) {
      console.error(err);
      openModal({ title: 'Erro ao Bloquear', message: err.response?.data?.error || 'Erro ao fechar horário.', type: 'error', confirmText: 'Voltar' });
    }
  };

  // Add/Edit Service State
  const [showAddService, setShowAddService] = useState(false);
  const [newService, setNewService] = useState({ name: '', duration: '', price: '', category: '', description: '' });
  const [editingService, setEditingService] = useState(null);

  const [businessName, setBusinessName] = useState('Mary Esmalteria');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [publicProfile, setPublicProfile] = useState(defaultPublicProfile);

  // Configurações Avançadas
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [slotInterval, setSlotInterval] = useState('30');
  const [workDays, setWorkDays] = useState(['seg','ter','qua','qui','sex','sab']);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [allowOnlineBooking, setAllowOnlineBooking] = useState(true);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' ou 'timeline'
  const [isPublicAgenda, setIsPublicAgenda] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifModal, setShowNotifModal] = useState(false);

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
  const [clientSearch, setClientSearch] = useState('');
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
      return nextUser;
    });
  };

  const loadData = async (loggedUser) => {
    try {
      const appQuery = loggedUser.role === 'admin' ? '' : `?professional_id=${loggedUser.id}`;
      const baseRequests = [
        api.get(`/api/appointments${appQuery}`),
        api.get('/api/clients'),
        api.get('/api/services'),
        api.get('/api/settings')
      ];

      const requests = loggedUser.role === 'admin'
        ? [...baseRequests, api.get('/api/professionals')]
        : [...baseRequests, api.get(`/api/professionals/${loggedUser.id}`)];

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
        setProfessionals([currentProfile]);
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
        setIsPublicAgenda(professionalSchedule.is_public_agenda || false);

      }

      const bName = incomingSettings.find(s => s.key === 'business_name');
      if (bName) setBusinessName(bName.value);
      const wMsg = incomingSettings.find(s => s.key === 'whatsapp_message');
      if (wMsg) setWhatsappMessage(wMsg.value);
      const profileSetting = incomingSettings.find(s => s.key === 'public_profile');
      if (profileSetting?.value) {
        try {
          const parsedProfile = JSON.parse(profileSetting.value);
          if (parsedProfile && typeof parsedProfile === 'object' && !Array.isArray(parsedProfile)) {
            setPublicProfile({ ...defaultPublicProfile, ...parsedProfile });
          }
        } catch {
          setPublicProfile(defaultPublicProfile);
        }
      }

      // Configurações avançadas
      const wn = incomingSettings.find(s => s.key === 'whatsapp_number');
      if (wn) setWhatsappNumber(wn.value);
      const ao = incomingSettings.find(s => s.key === 'allow_online_booking');
      if (ao) setAllowOnlineBooking(ao.value === 'true');
      const mad = incomingSettings.find(s => s.key === 'max_advance_days');
      if (mad) setMaxAdvanceDays(mad.value);
    } catch (err) {
      console.error("Erro ao carregar os dados:", err);
      if (err.response?.status === 401) navigate('/login', { replace: true });
    }
  };

  useEffect(() => {
    let active = true;
    api.get('/api/session')
      .then(response => {
        const loggedUser = response.data.data;
        if (!active || loggedUser?.type !== 'staff') return;
        setUser(loggedUser);
        loadData(loggedUser);
      })
      .catch(() => {
        if (active) navigate('/login', { replace: true });
      });
    return () => { active = false; };
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await api.post('/api/logout');
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (newStaff.password.trim().length < 8) {
      openModal({ title: 'Senha muito curta', message: 'Use pelo menos 8 caracteres na senha da profissional.', type: 'error', confirmText: 'Corrigir' });
      return;
    }
    try {
      const trimmedStaff = {
        name: newStaff.name.trim(),
        specialty: newStaff.specialty.trim(),
        avatar: newStaff.avatar.trim(),
        username: newStaff.username.trim(),
        password: newStaff.password.trim(),
        status: 'ativo'
      };
      await api.post('/api/professionals', trimmedStaff);
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
    api.put(`/api/clients/${selectedClient.id}`, selectedClient)
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
        api.delete(`/api/clients/${id}`)
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

    const filtered = clients.filter(c => {
      const nameSearch = (newAppt.client_name || '').toLowerCase().trim();
      const nameMatch = nameSearch && (c.name || '').toLowerCase().split(' ').some(word => word.startsWith(nameSearch));
      const phoneMatch = newAppt.client_phone && c.phone && c.phone.includes(newAppt.client_phone);
      return nameMatch || phoneMatch;
    }).slice(0, 5);

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
          await api.delete(`/api/professionals/${id}`);
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
      await api.post('/api/services', newService);
      setShowAddService(false);
      setNewService({ name: '', duration: '', price: '', category: '', description: '' });
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
          await api.delete(`/api/services/${id}`);
          setServices(services.filter(s => s.id !== id));
        } catch (err) { 
          openModal({ title: 'Erro', message: 'Erro ao excluir serviço.', type: 'error', confirmText: 'Entendido' });
        }
      }
    });
  };

  const handleUpdateService = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!editingService) return;
    try {
      await api.put(`/api/services/${editingService.id}`, editingService);
      openModal({ 
        title: 'Serviço Atualizado', 
        message: 'O serviço foi atualizado com sucesso! Todos os agendamentos marcados que incluem este serviço foram atualizados com o novo valor.', 
        type: 'success',
        confirmText: 'Entendido'
      });
      setEditingService(null);
      loadData(user);
    } catch (err) {
      console.error(err);
      openModal({ 
        title: 'Erro ao Editar Serviço', 
        message: err.response?.data?.error || 'Não foi possível atualizar o serviço.', 
        type: 'error',
        confirmText: 'Voltar'
      });
    }
  };

  const handleAddAppt = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    try {
      if (newAppt.service_ids.length === 0) {
        openModal({ title: 'Atenção', message: 'Por favor, selecione pelo menos um serviço.', type: 'info' });
        return;
      }

      let payload = { 
        ...newAppt,
        service_id: newAppt.service_ids[0],
        allow_outside_hours: allowOutsideHours
      };
      if (user.role !== 'admin') payload.professional_id = user.id;

      await api.post('/api/appointments', payload);
      setShowAddAppt(false);
      setNewAppt({ client_name: '', client_phone: '', service_ids: [], professional_id: '', date: format(new Date(), 'yyyy-MM-dd'), time: '' });
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

  const fetchFinancialStats = async () => {
    if (user?.role === 'admin') {
      try {
        const res = await api.get('/api/financial/stats');
        setFinancialStats(res.data.data);
      } catch (err) {
        console.error("Erro ao carregar dados financeiros", err);
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'staff') {
      fetchFinancialStats();
    }
  }, [activeTab, user]);

  const handleConfirmAppt = (id) => {
    openModal({
      title: 'Confirmar Presença',
      message: 'Deseja marcar este agendamento como Presença Confirmada?',
      type: 'confirm',
      confirmText: 'Confirmar Presença',
      onConfirm: async () => {
        try {
          await api.post(`/api/appointments/${id}/confirm`);
          setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'confirmado' } : a));
          openModal({ title: 'Sucesso', message: 'Presença confirmada com sucesso!', type: 'success' });
        } catch (err) {
          openModal({ title: 'Erro', message: err.response?.data?.error || 'Erro ao confirmar agendamento.', type: 'error' });
        }
      }
    });
  };

  const handleCompleteAppt = (id) => {
    openModal({
      title: 'Confirmar Conclusão',
      message: 'Deseja marcar este agendamento como Concluído/Pago? Ele será contabilizado no financeiro.',
      type: 'confirm',
      confirmText: 'Concluir',
      onConfirm: async () => {
        try {
          await api.post(`/api/appointments/${id}/complete`);
          setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'concluído' } : a));
          openModal({ title: 'Sucesso', message: 'Agendamento concluído com sucesso!', type: 'success' });
          if (activeTab === 'staff') fetchFinancialStats();
        } catch (err) {
          openModal({ title: 'Erro', message: 'Erro ao concluir agendamento.', type: 'error' });
        }
      }
    });
  };

  const handleEditApptSubmit = async (e) => {
    e.preventDefault();
    if (!editAppt) return;
    try {
      const payload = {
        date: editAppt.date,
        time: editAppt.time,
        professional_id: editAppt.professional_id,
        allow_outside_hours: allowOutsideHours
      };
      
      const response = await api.put(`/api/appointments/${editAppt.id}`, payload);
      const updatedAppointment = response.data?.data || payload;
      const prof = professionals.find(p => String(p.id) === String(updatedAppointment.professional_id));
      setAppointments(prev => prev.map(a => a.id === editAppt.id ? { ...a, ...updatedAppointment, professional_name: prof ? prof.name : a.professional_name } : a));
      setShowEditAppt(false);
      setEditAppt(null);
      setAllowOutsideHours(false);
      openModal({ title: 'Sucesso', message: 'Agendamento atualizado com sucesso.', type: 'success' });
    } catch (err) {
      console.error(err);
      openModal({ title: 'Erro', message: err.response?.data?.error || 'Falha ao editar o agendamento.', type: 'error' });
    }
  };

  const getAppServices = (app) => {
    if (!app) return [];
    if (app.notes && app.notes.startsWith('BLOCK:')) {
      return [{ name: app.service_name || 'Agenda Fechada', price: 0 }];
    }
    if (app.notes && app.notes.includes('MULTI_SERVICES:')) {
      try {
        const parts = app.notes.split('|');
        const jsonPart = parts.find(p => p.startsWith('MULTI_SERVICES:')).replace('MULTI_SERVICES:', '');
        const baseServices = JSON.parse(jsonPart);
        
        // Adicionar cobranças extras se existirem
        const extraCharges = parts.filter(p => p.startsWith('CHARGE:')).map(p => {
          const [_, val, mot] = p.split(':');
          return { name: `Extra: ${mot}`, price: val };
        });
        
        return [...baseServices, ...extraCharges];
      } catch (e) {
        return [{ name: app.service_name, price: app.service_price }];
      }
    }
    // Caso seja agendamento simples mas com cobranças extras
    if (app.notes && app.notes.includes('CHARGE:')) {
      const parts = app.notes.split('|');
      const extraCharges = parts.filter(p => p.startsWith('CHARGE:')).map(p => {
        const [_, val, mot] = p.split(':');
        return { name: `Extra: ${mot}`, price: val };
      });
      return [{ name: app.service_name, price: app.service_price }, ...extraCharges];
    }
    return [{ name: app.service_name, price: app.service_price }];
  };

  const calculateEndTime = (startTime, duration) => {
    if (!startTime) return '';
    const [h, m] = startTime.split(':').map(Number);
    const totalM = h * 60 + m + (Number(duration) || 30);
    const endH = Math.floor(totalM / 60).toString().padStart(2, '0');
    const endM = (totalM % 60).toString().padStart(2, '0');
    return `${endH}:${endM}`;
  };

  const getAppPaymentMethod = (notes) => {
    if (!notes) return 'Não definido';
    const match = notes.split('|').find(p => p.startsWith('PAYMENT:'));
    return match ? match.replace('PAYMENT:', '') : 'Não definido';
  };

  const updateAppPaymentMethod = async (id, currentNotes, newPaymentMethod) => {
    let parts = (currentNotes || '').split('|').filter(p => !p.startsWith('PAYMENT:'));
    if (newPaymentMethod !== 'Não definido') parts.push(`PAYMENT:${newPaymentMethod}`);
    const newNotes = parts.join('|');
    try {
      const response = await api.put(`/api/appointments/${id}`, { notes: newNotes });
      const savedNotes = response.data.data?.notes ?? newNotes;
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, notes: savedNotes } : a));
      if (selectedAppointment && selectedAppointment.id === id) {
        setSelectedAppointment(prev => ({ ...prev, notes: savedNotes }));
      }
    } catch (err) {
      console.error(err);
      openModal({ title: 'Erro', message: 'Erro ao atualizar pagamento.', type: 'error' });
    }
  };



  const handleWhatsAppAction = (app, isReminder) => {
    if (!app || !app.client_phone) return;
    const cleanPhone = app.client_phone.replace(/\D/g, "");
    let msg = '';
    if (isReminder) {
      const confirmLink = `${window.location.origin}/confirmar/${app.id}?token=${encodeURIComponent(app.confirmation_token || '')}`;
      msg = `Olá ${app.client_name}! Passando para lembrar do seu agendamento de *${app.service_name}* no dia ${safeFormatDate(app.date, 'dd/MM')} às ${app.time}.\n\nPara confirmar sua presença, clique no link abaixo:\n${confirmLink}\n\nAté breve!`;
    } else {
      msg = `Olá ${app.client_name}, tudo bem? Aqui é da ${businessName}.`;
    }
    window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  };

  const handleGenerateReceipt = (app) => {
    if (!app) return;
    const srvs = getAppServices(app);
    const total = srvs.reduce((acc, s) => acc + (Number(s.price) || 0), 0);
    const servicesHtml = srvs.map(s => `
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span>${escapeHtml(s.name)}</span>
        <span>R$ ${Number(s.price || 0).toFixed(2)}</span>
      </div>
    `).join('');

    const receiptHtml = `
      <html>
        <head>
          <title>Recibo - ${escapeHtml(app.client_name)}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; background: #fff; }
            .card { border: 1px solid #eee; padding: 30px; max-width: 400px; margin: 0 auto; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .logo { text-align: center; color: #d946ef; font-size: 24px; font-weight: 800; margin-bottom: 5px; }
            .subtitle { text-align: center; font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 30px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
            .label { color: #666; }
            .value { font-weight: 600; color: #111; }
            .divider { border-top: 1px dashed #eee; margin: 20px 0; }
            .total-row { display: flex; justify-content: space-between; font-size: 20px; font-weight: 900; color: #d946ef; margin-top: 20px; }
            .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #999; }
            @media print { body { padding: 0; } .card { box-shadow: none; border: none; } }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="logo">Mary Esmalteria</div>
            <div class="subtitle">Comprovante de Serviço</div>
            <div class="row"><span class="label">Cliente</span><span class="value">${escapeHtml(app.client_name)}</span></div>
            <div class="row"><span class="label">Data</span><span class="value">${safeFormatDate(app.date, 'dd/MM/yyyy')}</span></div>
            <div class="row"><span class="label">Profissional</span><span class="value">${escapeHtml(app.professional_name || 'Equipe')}</span></div>
            <div class="divider"></div>
            ${servicesHtml}
            <div class="total-row"><span>TOTAL</span><span>R$ ${total.toFixed(2)}</span></div>
            <div class="footer">Obrigado pela confiança! <br/> Volte sempre.</div>
          </div>
        </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (!win) return;
    win.opener = null;
    win.document.write(receiptHtml);
    win.document.close();
    window.setTimeout(() => win.print(), 250);
  };

  const handleAddCharge = async (app) => {
    const val = prompt("Qual o valor da cobrança extra? (Ex: 15.00)");
    if (!val || isNaN(val)) return;
    const motivo = prompt("Qual o motivo da cobrança?");
    if (!motivo) return;

    const extraTag = `CHARGE:${val}:${motivo}`;
    const newNotes = app.notes ? `${app.notes}|${extraTag}` : extraTag;
    
    try {
      const response = await api.put(`/api/appointments/${app.id}`, { notes: newNotes });
      const savedNotes = response.data.data?.notes ?? newNotes;
      setAppointments(prev => prev.map(a => a.id === app.id ? { ...a, notes: savedNotes } : a));
      if (selectedAppointment && selectedAppointment.id === app.id) {
        setSelectedAppointment(prev => ({ ...prev, notes: savedNotes }));
      }
      openModal({ title: 'Sucesso', message: 'Cobrança adicionada!', type: 'success' });
    } catch (err) {
      openModal({ title: 'Erro', message: 'Falha ao adicionar cobrança.', type: 'error' });
    }
  };

  const handleDropAppt = async (appId, newTime, colData, timelineMode) => {
    const appToMove = appointments.find(a => String(a.id) === String(appId));
    if (!appToMove) return;

    let payload = { time: newTime };
    if (timelineMode === 'dia') {
      payload.professional_id = colData.id;
    } else {
      payload.date = format(colData, 'yyyy-MM-dd');
    }

    setAppointments(prev => prev.map(a => String(a.id) === String(appId) ? { ...a, ...payload } : a));

    try {
      await api.put(`/api/appointments/${appId}`, payload);
    } catch (err) {
      console.error(err);
      openModal({ title: 'Erro', message: 'Erro ao mover agendamento.', type: 'error' });
      loadData(user);
    }
  };

  const handleCancelAppt = (id) => {
    const target = appointments.find(a => String(a.id) === String(id));
    const isBlock = target?.notes?.startsWith('BLOCK:');

    openModal({
      title: isBlock ? 'Confirmar Desbloqueio' : 'Confirmar Cancelamento',
      message: isBlock
        ? 'Deseja realmente desbloquear este horário? Ele voltará a ficar disponível na agenda.'
        : 'Deseja realmente desmarcar este cliente? O horário ficará disponível novamente.',
      type: 'confirm',
      confirmText: isBlock ? 'Desbloquear' : 'Desmarcar',
      onConfirm: async () => {
        try {
          await api.post(`/api/appointments/${id}/cancel`);
          setAppointments(prev => prev.filter(a => String(a.id) !== String(id)));
          if (selectedAppointment && String(selectedAppointment.id) === String(id)) {
            setSelectedAppointment(null);
          }
        } catch (err) {
          console.error('Erro ao desmarcar/desbloquear:', err);
          openModal({ 
            title: 'Falha no Servidor', 
            message: isBlock ? 'Erro ao desbloquear o horário.' : 'Erro ao desmarcar o agendamento.', 
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
        api.put('/api/settings', { key: 'business_name', value: businessName }),
        api.put('/api/settings', { key: 'whatsapp_message', value: whatsappMessage }),
        api.put('/api/settings', { key: 'work_start', value: workStart }),
        api.put('/api/settings', { key: 'work_end', value: workEnd }),
        api.put('/api/settings', { key: 'slot_interval', value: slotInterval }),
        api.put('/api/settings', { key: 'work_days', value: JSON.stringify(workDays) }),
        api.put('/api/settings', { key: 'whatsapp_number', value: whatsappNumber }),
        api.put('/api/settings', { key: 'allow_online_booking', value: String(allowOnlineBooking) }),
        api.put('/api/settings', { key: 'max_advance_days', value: maxAdvanceDays }),
        api.put('/api/settings', { key: 'public_profile', value: JSON.stringify(publicProfile) }),
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

    if (profileForm.password && profileForm.password.length < 8) {
      openModal({
        title: 'Senha muito curta',
        message: 'A nova senha precisa ter pelo menos 8 caracteres.',
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
        { key: getProfessionalSettingKey(user.id, 'work_days'), value: JSON.stringify(workDays) },
        { key: getProfessionalSettingKey(user.id, 'is_public_agenda'), value: String(isPublicAgenda) }

      ];

      const [res] = await Promise.all([
        api.put(`/api/professionals/${user.id}`, payload),
        ...scheduleUpdates.map(entry => api.put('/api/settings', entry))
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
  // Exclui cancelados de todas as visões da UI
  const activeAppointments = appointments.filter(a => a.status !== 'cancelado');
  const appointmentTimeSlots = buildTimeSlots(
    appointmentSchedule.workStart,
    appointmentSchedule.workEnd,
    appointmentSchedule.slotInterval,
    allowOutsideHours,
    activeAppointments.filter(a => a.date === newAppt.date)
  );
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
    const isActive = activeTab === id;
    return (
      <button
        onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
        className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 relative group font-bold text-xs uppercase tracking-wider ${
          isActive 
            ? 'bg-gradient-to-r from-primary to-primary-hover text-white shadow-lg shadow-primary/25 scale-[1.02]' 
            : 'text-muted hover:text-foreground hover:bg-card/80'
        }`}
      >
        <Icon size={18} className={isActive ? 'text-white' : 'text-primary/70 group-hover:text-primary transition-colors'} />
        <span>{label}</span>
        {isActive && <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
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
          className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-md transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - PREMIUM REDESIGN */}
      <aside className={`fixed inset-y-0 left-0 lg:static w-72 border-r border-border/50 bg-card/90 backdrop-blur-2xl flex flex-col z-50 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary via-pink-500 to-primary-dark flex items-center justify-center text-white font-black shadow-lg glow-primary">M</div>
            <div>
              <span className="text-foreground font-serif tracking-widest text-xl font-black italic">MARY</span>
              <span className="block text-[9px] font-black uppercase text-primary tracking-[0.2em]">Painel Profissional</span>
            </div>
          </div>
          <button className="lg:hidden text-muted hover:text-foreground p-2 rounded-xl bg-background/50 border border-border/40" onClick={() => setIsMobileMenuOpen(false)}>
            <X size={20} />
          </button>
        </div>

        {/* User Card */}
        <div className="p-5 border-b border-border/40 bg-background/40 backdrop-blur-md flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 border border-primary/30 text-primary flex items-center justify-center font-black shadow-md shrink-0">{user.avatar}</div>
          <div className="overflow-hidden min-w-0">
            <div className="text-foreground font-black uppercase text-xs truncate tracking-wide">{user.name}</div>
            <div className="inline-flex items-center gap-1 mt-0.5 text-[9px] bg-primary/10 text-primary font-black uppercase px-2 py-0.5 rounded-full border border-primary/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {user.role}
            </div>
          </div>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" id="dashboard" />
          <SidebarItem icon={CalendarIcon} label="Super Agenda" id="agenda" />
          <SidebarItem icon={Users} label="Clientes" id="clients" />
          <SidebarItem icon={Scissors} label="Serviços" id="catalog" adminOnly={true} />
          <SidebarItem icon={Briefcase} label="Gestão & RH" id="staff" adminOnly={true} />
          <SidebarItem icon={Activity} label="Desempenho" id="stats" adminOnly={true} />
          <SidebarItem icon={Settings} label="Configurações" id="settings" />
        </nav>
        
        <div className="p-4 border-t border-border/40">
          <button onClick={handleLogout} className="text-muted hover:text-red-500 flex items-center justify-center gap-2.5 w-full p-3.5 rounded-2xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-all font-black uppercase text-[10px] tracking-wider">
            <LogOut size={15} /> Encerrar Sessão
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-y-auto relative bg-background w-full pb-24 lg:pb-0">
        <header className="min-h-16 md:h-20 border-b border-border/40 flex items-center justify-between gap-2 px-3 py-2 md:px-8 md:py-0 bg-background/80 backdrop-blur-2xl sticky top-0 z-40">
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
            <button className="lg:hidden h-10 w-10 shrink-0 text-muted hover:text-primary rounded-xl bg-card/60 border border-border/50 transition-all flex items-center justify-center" onClick={() => setIsMobileMenuOpen(true)}>
              <Menu size={19} />
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-base md:text-xl font-serif font-black text-foreground uppercase tracking-wide md:tracking-wider">
                <span className="md:hidden">{activeTab === 'agenda' ? 'Agenda' : getPageTitle()}</span>
                <span className="hidden md:inline">{getPageTitle()}</span>
              </h2>
              <p className="text-[10px] text-muted hidden sm:block">Painel de Agendamentos & Controle do Estabelecimento</p>
            </div>
          </div>
          
          <div className="flex shrink-0 items-center gap-1.5 md:gap-3">
            <button onClick={() => setIsDark(!isDark)} className="h-10 w-10 md:h-auto md:w-auto text-muted hover:text-primary transition-all md:p-3 rounded-xl md:rounded-2xl bg-card/60 border border-border/50 flex items-center justify-center" title="Alternar Tema">
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            <div className="flex items-center gap-1.5 md:gap-2">
              <button onClick={() => { handleOpenBlockModal(null, '12:00', format(selectedCalendarDate || new Date(), 'yyyy-MM-dd')); setShowAddAppt(false); setActiveTab('agenda'); setIsMobileMenuOpen(false); }} className="h-10 w-10 md:h-auto md:w-auto md:p-3 rounded-xl md:rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500 hover:text-white transition-all shadow-md flex items-center justify-center" title="Bloquear Horário">
                <Lock size={16} />
              </button>
              <button onClick={() => { setShowAddAppt(!showAddAppt); setActiveTab('agenda'); setIsMobileMenuOpen(false); }} className="btn-primary h-10 !py-0 !px-3 md:h-auto md:!py-2.5 md:!px-5 glow-primary whitespace-nowrap">
                {showAddAppt ? <X size={17} /> : <Plus size={17} />}
                <span className="ml-0.5 md:ml-1 uppercase font-black tracking-wider text-[10px] md:text-xs">Marcar</span>
              </button>
            </div>
          </div>
        </header>

        <div className={`${activeTab === 'agenda' ? 'p-0 md:p-4' : 'p-4 md:p-8'}`}>

          {showAddAppt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md p-2 md:p-4 animate-in fade-in duration-300">
              <div className="bg-card border border-primary/20 rounded-xl md:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="flex justify-between items-center p-4 md:p-6 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent shrink-0">
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20">
                      <Plus size={20} />
                    </div>
                    <div>
                      <h3 className="text-base md:text-xl font-serif text-foreground">Novo Agendamento</h3>
                      <p className="text-[10px] text-muted">Preencha os dados abaixo</p>
                    </div>
                  </div>
                  <button onClick={() => setShowAddAppt(false)} className="text-muted hover:text-foreground hover:bg-muted/20 p-1.5 md:p-2 rounded-full transition-colors"><X size={18} /></button>
                </div>
                
                <form onSubmit={handleAddAppt} className="flex flex-col flex-1 overflow-hidden relative">
                  {/* Área Rolável */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 pb-28 md:pb-32">
                    <div className="flex flex-col md:flex-row gap-6">
                      
                      {/* Esquerda: Cliente e Serviços */}
                      <div className="flex-1 space-y-4 md:space-y-6">
                        {noShowCount >= 2 && (
                          <div className="bg-red-500/10 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start gap-3 fade-in-up">
                            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
                            <div>
                              <p className="text-sm text-red-500 font-bold mb-1">ALERTA DE HISTÓRICO (ANTI-CALOTE)</p>
                              <p className="text-xs text-red-500/80 font-medium">
                                Este cliente possui <strong>{noShowCount} cancelamentos</strong> registrados. Sugerimos solicitar um sinal via PIX para confirmar este horário.
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        </div>

                        {/* Campos de Data/Hora (No mobile, movemos para cima dos serviços para melhor fluxo) */}
                        <div className="grid grid-cols-1 md:hidden gap-4 bg-muted/5 p-4 rounded-xl border border-border/30">
                           {isAdmin && (
                            <div>
                              <label className="text-[10px] font-bold text-primary uppercase tracking-widest block mb-1">Profissional</label>
                              <select className="input-field w-full text-sm" value={newAppt.professional_id} onChange={e => setNewAppt({ ...newAppt, professional_id: e.target.value })} required>
                                <option value="" disabled>Selecione</option>
                                {professionals.filter(p => !(p.specialty?.toLowerCase().includes('sócio') || p.specialty?.toLowerCase().includes('socio') || p.name?.toLowerCase().includes('sócio') || p.name?.toLowerCase().includes('socio'))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-bold text-primary uppercase tracking-widest block mb-1">Data</label>
                              <input type="date" className="input-field w-full text-sm" value={newAppt.date} onChange={e => setNewAppt({ ...newAppt, date: e.target.value })} required />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-primary uppercase tracking-widest block mb-1">Horário</label>
                              <select className="input-field w-full text-sm" value={newAppt.time} onChange={e => setNewAppt({ ...newAppt, time: e.target.value })} required>
                                <option value="" disabled>Selecione</option>
                                {appointmentTimeSlots.map(t => {
                                  const duration = services
                                    .filter(s => newAppt.service_ids.includes(s.id))
                                    .reduce((acc, curr) => acc + (Number(curr.duration) || 30), 0);
                                  return <option key={t} value={t}>{t} - {calculateEndTime(t, duration)}</option>
                                })}
                              </select>
                              <label className="flex items-center gap-1.5 cursor-pointer mt-2 text-[10px] font-bold text-primary/90 hover:text-primary transition-colors select-none">
                                <input 
                                  type="checkbox" 
                                  checked={allowOutsideHours} 
                                  onChange={e => setAllowOutsideHours(e.target.checked)} 
                                  className="rounded text-primary focus:ring-primary h-3.5 w-3.5 border-border bg-background cursor-pointer"
                                />
                                <span>Marcar fora do expediente (ex: 19h)</span>
                              </label>
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="text-sm font-bold text-primary uppercase tracking-widest mb-3 md:mb-4">Serviços</p>
                          <div className="space-y-4 md:space-y-6">
                            {Object.entries(
                              services.reduce((acc, s) => {
                                const cat = s.category || 'Geral';
                                if (!acc[cat]) acc[cat] = [];
                                acc[cat].push(s);
                                return acc;
                              }, {})
                            ).map(([category, catServices]) => (
                              <div key={category} className="bg-muted/5 p-3 md:p-4 rounded-xl md:rounded-2xl border border-border/30 hover:border-primary/20 transition-colors">
                                <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                                  <div className="w-1 h-4 md:w-1.5 md:h-6 bg-primary rounded-full"></div>
                                  <h4 className="text-[10px] md:text-xs font-black uppercase text-foreground tracking-tighter">{category}</h4>
                                  <div className="h-px flex-1 bg-border/40"></div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {catServices.map(s => {
                                    const isSelected = newAppt.service_ids.includes(s.id);
                                    return (
                                      <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => {
                                          if (isSelected) {
                                            setNewAppt(prev => ({ ...prev, service_ids: prev.service_ids.filter(id => id !== s.id) }));
                                          } else {
                                            setNewAppt(prev => ({ ...prev, service_ids: [...prev.service_ids, s.id] }));
                                          }
                                        }}
                                        className={`px-3 md:px-4 py-2 rounded-xl text-[10px] md:text-xs font-bold border transition-all duration-300 ${isSelected ? 'bg-primary text-white border-primary shadow-[0_5px_15px_rgba(236,72,153,0.3)] scale-105' : 'bg-background text-muted border-border hover:border-primary/50 hover:text-foreground'}`}
                                      >
                                        <span className="flex items-center gap-1.5 md:gap-2">
                                          {s.name}
                                          <span className={`px-1.5 py-0.5 rounded-md text-[9px] md:text-[10px] ${isSelected ? 'bg-white/20' : 'bg-muted/10'}`}>R$ {s.price}</span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Direita: Data, Horário e Resumo (Escondido no mobile, mostrado no Desktop) */}
                      <div className="hidden md:flex w-full md:w-80 bg-muted/5 p-4 md:p-6 flex-col gap-4 md:gap-6 shrink-0 rounded-2xl border border-border/30 h-fit">
                        <div className="space-y-4">
                          {isAdmin && (
                            <div>
                              <label className="text-[10px] md:text-xs font-bold text-primary uppercase tracking-widest block mb-1">Profissional</label>
                              <select className="input-field w-full" value={newAppt.professional_id} onChange={e => setNewAppt({ ...newAppt, professional_id: e.target.value })} required>
                                <option value="" disabled>Selecione</option>
                                {professionals.filter(p => !(p.specialty?.toLowerCase().includes('sócio') || p.specialty?.toLowerCase().includes('socio') || p.name?.toLowerCase().includes('sócio') || p.name?.toLowerCase().includes('socio'))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="text-[10px] md:text-xs font-bold text-primary uppercase tracking-widest block mb-1">Data</label>
                            <input type="date" className="input-field w-full" value={newAppt.date} onChange={e => setNewAppt({ ...newAppt, date: e.target.value })} required />
                          </div>
                          <div>
                            <label className="text-[10px] md:text-xs font-bold text-primary uppercase tracking-widest block mb-1">Horário</label>
                            <select className="input-field w-full" value={newAppt.time} onChange={e => setNewAppt({ ...newAppt, time: e.target.value })} required>
                              <option value="" disabled>Selecione</option>
                              {appointmentTimeSlots.map(t => {
                                const duration = services
                                  .filter(s => newAppt.service_ids.includes(s.id))
                                  .reduce((acc, curr) => acc + (Number(curr.duration) || 30), 0);
                                return <option key={t} value={t}>{t} - {calculateEndTime(t, duration)}</option>
                              })}
                            </select>
                            <label className="flex items-center gap-2 cursor-pointer mt-2.5 text-xs font-bold text-primary/90 hover:text-primary transition-colors select-none">
                              <input 
                                type="checkbox" 
                                checked={allowOutsideHours} 
                                onChange={e => setAllowOutsideHours(e.target.checked)} 
                                className="rounded text-primary focus:ring-primary h-4 w-4 border-border bg-background cursor-pointer"
                              />
                              <span>Marcar fora do expediente (ex: 19h às 20:30)</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer Fixo: Resumo e Botão Marcar */}
                  <div className="absolute bottom-0 left-0 right-0 bg-card/95 backdrop-blur-xl border-t border-primary/20 p-4 md:p-6 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] z-20">
                    <div className="flex justify-between items-center w-full max-w-4xl mx-auto gap-4">
                      <div className="flex-shrink-0">
                        <p className="text-[9px] md:text-[10px] text-primary font-black uppercase tracking-widest mb-0.5">Total</p>
                        <p className="text-lg md:text-2xl font-serif font-bold text-foreground">
                          R$ {services.filter(s => newAppt.service_ids.includes(s.id)).reduce((acc, curr) => acc + (Number(curr.price) || 0), 0).toFixed(2)}
                        </p>
                        <p className="text-[9px] text-muted hidden md:block">
                          {services.filter(s => newAppt.service_ids.includes(s.id)).length} serviço(s) selecionado(s)
                        </p>
                      </div>
                      
                      <button type="submit" className="flex-1 md:flex-none md:px-10 py-3 md:py-4 rounded-xl md:rounded-2xl bg-gradient-to-r from-primary to-pink-500 text-white text-[12px] md:text-sm font-black uppercase tracking-wider flex justify-center items-center gap-2 shadow-[0_10px_20px_rgba(236,72,153,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all">
                        <CheckCircle size={18} /> Marcar<span className="hidden md:inline"> na Agenda</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="fade-in-up duration-500 space-y-6 md:space-y-8">
              
              {/* Pill de Resumo de Confirmações */}
              <div className="glass-panel p-4 md:p-6 flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-primary">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                    <Activity size={20} />
                  </div>
                  <div>
                    <h3 className="text-base md:text-lg font-serif text-foreground">Resumo Operacional de Hoje</h3>
                    <p className="text-xs text-muted">Acompanhe confirmações e atendimentos em tempo real</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="badge-pending">
                    ⏳ {activeAppointments.filter(a => a.date === format(startOfToday(), 'yyyy-MM-dd') && a.status === 'agendado' && !a.notes?.startsWith('BLOCK:')).length} Aguardando Confirmação
                  </span>
                  <span className="badge-confirmed">
                    ✅ {activeAppointments.filter(a => a.date === format(startOfToday(), 'yyyy-MM-dd') && a.status === 'confirmado' && !a.notes?.startsWith('BLOCK:')).length} Presença Confirmada
                  </span>
                  <span className="badge-completed">
                    🟢 {activeAppointments.filter(a => a.date === format(startOfToday(), 'yyyy-MM-dd') && a.status === 'concluído' && !a.notes?.startsWith('BLOCK:')).length} Atendidos / Concluídos
                  </span>
                </div>
              </div>

              {isAdmin ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                    <div className="glass-card p-6 flex flex-col justify-between group relative overflow-hidden">
                      <div className="flex justify-between items-start mb-4">
                        <p className="text-primary/70 text-[10px] font-black uppercase tracking-[0.2em]">Agendamentos</p>
                        <div className="p-3 rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-all shadow-md">
                           <Activity size={20} />
                        </div>
                      </div>
                      <p className="text-3xl md:text-4xl font-black text-foreground flex items-baseline gap-2">
                        {appointments.length} <span className="text-xs font-bold text-muted uppercase">Total</span>
                      </p>
                    </div>

                    <div className="glass-card p-6 flex flex-col justify-between border-l-4 border-l-emerald-500 group relative overflow-hidden">
                      <div className="flex justify-between items-start mb-4">
                        <p className="text-emerald-500/80 text-[10px] font-black uppercase tracking-[0.2em]">Faturamento Estimado</p>
                        <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-all shadow-md">
                           <DollarSign size={20} />
                        </div>
                      </div>
                      <p className="text-3xl md:text-4xl font-black text-emerald-500 flex items-baseline gap-1 tracking-tight">
                        <span className="text-sm md:text-lg font-bold">R$</span> {totalRevenue.toFixed(2)}
                      </p>
                    </div>

                    <div className="glass-card p-6 lg:col-span-2 flex flex-col justify-between relative overflow-hidden">
                       <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full pointer-events-none"></div>
                       <p className="text-primary/70 text-[10px] font-black uppercase tracking-[0.2em] mb-4">Equipe & Serviços</p>
                       <div className="flex items-center gap-8 md:gap-12">
                          <div className="flex flex-col">
                             <span className="text-3xl md:text-4xl font-black text-foreground">{professionals.length}</span>
                             <span className="text-[10px] font-black text-primary uppercase tracking-widest mt-1">Profissionais</span>
                          </div>
                          <div className="w-px h-10 bg-border/60"></div>
                          <div className="flex flex-col">
                             <span className="text-3xl md:text-4xl font-black text-foreground">{services.length}</span>
                             <span className="text-[10px] font-black text-primary uppercase tracking-widest mt-1">Serviços no Menu</span>
                          </div>
                       </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
                    <div className="lg:col-span-2 glass-card p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-serif text-foreground">Próximos em Atendimento</h3>
                        <span className="text-xs text-muted font-bold uppercase tracking-wider">Próximos 10 dias</span>
                      </div>

                      {(() => {
                        const now = new Date();
                        const currentDateStr = format(now, 'yyyy-MM-dd');
                        const currentTimeStr = format(now, 'HH:mm');
                        const limitDayStr = format(addDays(now, 10), 'yyyy-MM-dd');

                        const getTimeStamp = (item) => {
                          if (!item || !item.date) return 0;
                          const t = item.time || '00:00';
                          const d = new Date(`${item.date}T${t}`);
                          return isNaN(d.getTime()) ? 0 : d.getTime();
                        };

                        const upcomingList = (activeAppointments || [])
                          .filter(app => {
                            if (!app || !app.date) return false;
                            if (app.status === 'cancelado' || app.status === 'concluído' || app.notes?.startsWith('BLOCK:')) return false;
                            const appTime = app.time || '00:00';
                            if (app.date < currentDateStr) return false;
                            if (app.date === currentDateStr && appTime < currentTimeStr) return false;
                            return app.date <= limitDayStr;
                          })
                          .sort((a, b) => getTimeStamp(a) - getTimeStamp(b));

                        return (
                          <>
                            {/* Desktop Table View */}
                            <div className="hidden md:block overflow-x-auto">
                              <table className="w-full text-left border-collapse min-w-full">
                                <thead>
                                  <tr className="border-b border-border/50 text-muted text-xs uppercase font-bold tracking-wider">
                                    <th className="py-3 px-2">Data/Hora</th>
                                    <th className="py-3 px-2">Status</th>
                                    <th className="py-3 px-2">Cliente</th>
                                    <th className="py-3 px-2">Serviço</th>
                                    <th className="py-3 px-2">Profissional</th>
                                    <th className="py-3 px-2 text-right">Ação</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {upcomingList.slice(0, 10).map(app => (
                                    <tr key={app.id} className="border-b border-border/40 text-foreground last:border-0 hover:bg-card/40 transition-colors">
                                      <td className="py-3.5 px-2 font-medium text-xs">
                                        {safeFormatDate(app.date, 'dd/MM')} às <strong className="text-primary">{app.time}</strong>
                                      </td>
                                      <td className="py-3.5 px-2">
                                        {app.status === 'confirmado' ? (
                                          <span className="badge-confirmed">✅ Confirmado</span>
                                        ) : (
                                          <span className="badge-pending">⏳ Pendente</span>
                                        )}
                                      </td>
                                      <td className="py-3.5 px-2 font-semibold text-sm">{app.client_name}</td>
                                      <td className="py-3.5 px-2 text-xs text-muted">{app.service_name || '-'}</td>
                                      <td className="py-3.5 px-2 text-xs">{app.professional_name || '-'}</td>
                                      <td className="py-3.5 px-2 text-right">
                                        <button 
                                          onClick={() => handleWhatsAppAction(app, true)}
                                          className="text-emerald-500 hover:bg-emerald-500/10 p-2 rounded-lg transition-colors"
                                          title="Lembrete WhatsApp"
                                        >
                                          <Send size={15} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                  {upcomingList.length === 0 && (
                                    <tr><td colSpan="6" className="text-center py-8 text-muted italic text-sm">Nenhum agendamento futuro para os próximos 10 dias.</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>

                            {/* Mobile Card View */}
                            <div className="md:hidden space-y-3">
                              {upcomingList.slice(0, 8).map(app => (
                                <div key={app.id} onClick={() => setSelectedAppointment(app)} className="p-4 rounded-2xl bg-card border border-border/60 flex flex-col gap-2 relative shadow-sm">
                                  <div className="flex justify-between items-start">
                                    <div>
                                      {app.status === 'confirmado' ? (
                                        <span className="badge-confirmed">✅ Confirmado</span>
                                      ) : (
                                        <span className="badge-pending">⏳ Pendente</span>
                                      )}
                                      <h4 className="font-bold text-foreground text-sm mt-2">{app.client_name}</h4>
                                      <p className="text-xs text-muted">{app.service_name}</p>
                                    </div>
                                    <div className="text-right">
                                      <span className="text-sm font-black text-primary">{app.time}</span>
                                      <p className="text-[10px] text-muted font-bold uppercase">{safeFormatDate(app.date, 'dd/MM')}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                                    <span className="text-muted text-[11px]">Profissional: <strong className="text-foreground">{app.professional_name}</strong></span>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleWhatsAppAction(app, true); }}
                                      className="text-emerald-500 font-bold text-[11px] bg-emerald-500/10 px-2.5 py-1 rounded-lg flex items-center gap-1"
                                    >
                                      <Send size={12} /> WhatsApp
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {upcomingList.length === 0 && (
                                <p className="text-center py-6 text-muted text-xs italic">Nenhum agendamento futuro nos próximos 10 dias.</p>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    <div className="glass-card p-6 border-l-4 border-l-primary flex flex-col">
                      <h3 className="text-xl font-serif text-foreground mb-6">Ranking Financeiro</h3>
                      <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                        {revenuePerProfessional.map((pro, idx) => (
                          <div key={pro.id} className="flex items-center gap-3 bg-card/60 border border-border/50 p-3.5 rounded-2xl">
                            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                              {idx + 1}º
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-foreground font-bold text-xs truncate">{pro.name}</h4>
                              <p className="text-[10px] text-muted">{pro.totalApps} agendamentos</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-primary font-black text-sm">R$ {pro.revenue.toFixed(2)}</p>
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
                            {(activeAppointments || []).filter(a => a && a.date === format(startOfToday(), 'yyyy-MM-dd')).length} <span className="text-sm font-sans font-medium text-muted">Apt.</span>
                          </p>
                        </div>
                        <div className="glass-card p-6 flex flex-col justify-between">
                          <p className="text-muted text-sm mb-2 uppercase tracking-wider font-semibold">Esta Semana</p>
                          <p className="text-3xl font-serif text-primary">
                            {(activeAppointments || []).filter(a => {
                              const d = safeParseISO(a?.date);
                              if (!d) return false;
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
                              {(activeAppointments || []).filter(a => {
                                const d = safeParseISO(a?.date);
                                if (!d) return false;
                                return d >= startOfWeek(startOfToday(), { weekStartsOn: 0 }) && d <= endOfWeek(startOfToday(), { weekStartsOn: 0 });
                              })
                                .sort((a, b) => {
                                  const tA = a.time || '00:00';
                                  const tB = b.time || '00:00';
                                  const dA = new Date(`${a.date}T${tA}`);
                                  const dB = new Date(`${b.date}T${tB}`);
                                  return (isNaN(dA.getTime()) ? 0 : dA.getTime()) - (isNaN(dB.getTime()) ? 0 : dB.getTime());
                                })
                                .map(app => (
                                  <tr key={app.id} className="border-b border-border/50 text-foreground last:border-0 hover:bg-border/20">
                                    <td className="py-4 px-2">
                                      <span className="font-medium mr-2">{safeFormatDate(app.date, 'dd/MM')}</span>
                                      <span className="text-primary">{app.time} - {calculateEndTime(app.time, app.service_duration)}</span>
                                    </td>
                                    <td className="py-4 px-2 font-medium">{app.client_name}</td>
                                    <td className="py-4 px-2 text-muted">{app.service_name || '-'}</td>
                                    <td className="py-4 px-2 text-right">
                                      {app.status === 'concluído' ? (
                                        <span className="text-green-500 flex items-center justify-end gap-1 text-xs font-bold uppercase tracking-wider"><CheckCircle size={14}/> Pago</span>
                                      ) : (
                                        <div className="flex justify-end gap-1">
                                          <button onClick={() => handleCompleteAppt(app.id)} className="text-green-500 hover:bg-green-500/10 p-2 rounded transition-colors" title="Concluir/Pago">
                                            <CheckCircle size={16} />
                                          </button>
                                          <button onClick={() => handleCancelAppt(app.id)} className="text-red-500 hover:bg-red-500/10 p-2 rounded transition-colors" title="Desmarcar">
                                            <Trash2 size={16} />
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              {(activeAppointments || []).filter(a => {
                                const d = safeParseISO(a?.date);
                                if (!d) return false;
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
                      <div className="flex justify-center mb-6 md:mb-10">
                        <div className="bg-card/50 backdrop-blur-md border border-white/5 p-1 rounded-xl md:rounded-[1.5rem] flex gap-1 md:gap-2 shadow-2xl">
                          <button 
                            onClick={() => setViewMode('calendar')}
                            className={`px-5 py-2 md:px-8 md:py-3 rounded-lg md:rounded-[1.1rem] text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${viewMode === 'calendar' ? 'bg-primary text-white shadow-lg glow-primary' : 'text-muted hover:text-foreground'}`}
                          >
                            Calendário
                          </button>
                          <button 
                            onClick={() => setViewMode('timeline')}
                            className={`px-5 py-2 md:px-8 md:py-3 rounded-lg md:rounded-[1.1rem] text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${viewMode === 'timeline' ? 'bg-primary text-white shadow-lg glow-primary' : 'text-muted hover:text-foreground'}`}
                          >
                            Timeline
                          </button>
                        </div>
                      </div>

                      {viewMode === 'calendar' ? (
                        <div className="flex flex-col xl:flex-row gap-8 items-start">


                        <div className="glass-card p-4 md:p-6 flex-2 xl:w-2/3 w-full">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                             <h3 className="text-xl md:text-2xl font-serif text-foreground">Navegador de Datas</h3>
                             <div className="flex items-center gap-2 bg-background border border-border/50 rounded-lg p-1 w-fit">
                                <button onClick={handlePrevMonth} className="p-1.5 md:p-2 text-muted hover:text-foreground transition-colors"><ChevronLeft size={18} /></button>
                                <span className="font-medium text-foreground min-w-[100px] md:min-w-[120px] text-center capitalize text-sm md:text-base">{format(currentMonth, 'MMMM yyyy', {locale: ptBR})}</span>
                                <button onClick={handleNextMonth} className="p-1.5 md:p-2 text-muted hover:text-foreground transition-colors"><ChevronRight size={18} /></button>
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

                        <div className="glass-card p-6 flex-1 xl:w-1/3 w-full border-primary/20 shadow-[0_0_40px_rgba(244,114,182,0.06)] relative overflow-hidden flex flex-col">
                          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full pointer-events-none"></div>
                          <div className="flex items-center justify-between mb-4 pb-4 border-b border-border/50 relative z-10">
                            <div>
                              <h3 className="text-xl font-serif text-foreground">Agenda do Dia</h3>
                              <p className="text-xs text-muted">Controle de atendimento diário</p>
                            </div>
                            <div className="bg-primary text-white font-black text-xs px-3 py-1.5 rounded-xl shadow-md">
                              {format(selectedCalendarDate, 'dd/MM/yyyy')}
                            </div>
                          </div>

                          {/* Resumo do Dia Selecionado */}
                          <div className="flex items-center justify-between bg-card/80 p-3.5 rounded-2xl border border-border/60 text-xs font-bold mb-4 relative z-10">
                            <span className="text-muted">Total: <strong className="text-foreground">{selectedDayAppointments.length} agend.</strong></span>
                            <span className="text-emerald-500 font-black text-sm">
                              R$ {selectedDayAppointments.reduce((sum, a) => sum + Number(a.service_price || 0), 0).toFixed(2)}
                            </span>
                          </div>

                          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1 relative z-10 custom-scrollbar">
                            {selectedDayAppointments.length === 0 ? (
                              <div className="text-center py-12 text-muted">
                                <CalendarIcon className="mx-auto mb-3 opacity-20 text-primary" size={48} />
                                <p className="text-sm font-medium">Livre. Nenhum atendimento para esta data.</p>
                              </div>
                            ) : (
                              selectedDayAppointments.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00')).map(app => {
                                const cleanPhone = (app.client_phone || '').replace(/\D/g, '');
                                const durationMin = Number(app.service_duration) || 30;
                                const endTime = (st, dur) => {
                                  const [h, m] = (st || '00:00').split(':').map(Number);
                                  const tot = (h || 0) * 60 + (m || 0) + dur;
                                  return `${Math.floor(tot/60).toString().padStart(2,'0')}:${(tot%60).toString().padStart(2,'0')}`;
                                };
                                const isBlock = app.notes?.startsWith('BLOCK:');

                                if (isBlock) {
                                  return (
                                    <div key={app.id} onClick={() => setSelectedAppointment(app)} className="p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 flex flex-col gap-2 hover:border-amber-500 transition-all group relative shadow-sm cursor-pointer">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <div className="bg-amber-500/20 border border-amber-500/40 text-amber-300 font-black text-xs px-2.5 py-1 rounded-xl shrink-0 flex items-center gap-1">
                                            <Lock size={12} /> {app.time} - {endTime(app.time, durationMin)}
                                          </div>
                                          <span className="badge-pending !bg-amber-500/20 !text-amber-300 !border-amber-500/30">🔒 Fechado ({durationMin}m)</span>
                                        </div>
                                      </div>

                                      <div>
                                        <h4 className="text-foreground font-black text-sm">{app.client_name || 'Bloqueio de Agenda'}</h4>
                                        <p className="text-xs text-amber-400/80 font-bold">⏳ Pausa de Atendimento</p>
                                        {isAdmin && <p className="text-[11px] text-amber-400 font-bold mt-1 flex items-center gap-1"><User size={12} /> {app.professional_name}</p>}
                                      </div>

                                      <div className="flex items-center justify-end pt-2 border-t border-amber-500/20 text-xs">
                                        <button onClick={(e) => { e.stopPropagation(); handleCancelAppt(app.id); }} className="text-amber-300 hover:bg-amber-500/20 px-3 py-1.5 rounded-xl font-bold transition-colors flex items-center gap-1" title="Desbloquear Horário">
                                          <Unlock size={14} /> Desbloquear
                                        </button>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div key={app.id} onClick={() => setSelectedAppointment(app)} className="p-4 rounded-2xl border border-border/60 bg-card/80 flex flex-col gap-2 hover:border-primary/50 transition-all group relative shadow-sm cursor-pointer">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <div className="bg-primary/10 border border-primary/20 text-primary font-black text-xs px-2.5 py-1 rounded-xl shrink-0">
                                          {app.time} - {endTime(app.time, durationMin)}
                                        </div>
                                        {app.status === 'concluído' ? (
                                          <span className="badge-completed">🟢 Pago</span>
                                        ) : app.status === 'confirmado' ? (
                                          <span className="badge-confirmed">✅ Confirmado</span>
                                        ) : (
                                          <span className="badge-pending">⏳ Pendente</span>
                                        )}
                                      </div>
                                      <span className="text-sm font-black text-primary">R$ {Number(app.service_price || 0).toFixed(0)}</span>
                                    </div>

                                    <div>
                                      <h4 className="text-foreground font-black text-sm">{app.client_name}</h4>
                                      <p className="text-xs text-muted">{app.service_name}</p>
                                      {isAdmin && <p className="text-[11px] text-primary/80 font-bold mt-1 flex items-center gap-1"><User size={12} /> {app.professional_name}</p>}
                                    </div>

                                    <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                                      {cleanPhone ? (
                                        <a 
                                          href={`https://wa.me/55${cleanPhone}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="text-emerald-500 font-bold text-[11px] hover:underline flex items-center gap-1"
                                        >
                                          <MessageCircle size={13} /> {app.client_phone}
                                        </a>
                                      ) : <span />}

                                      <div className="flex items-center gap-1">
                                        {app.status === 'agendado' && (
                                          <button onClick={(e) => { e.stopPropagation(); handleConfirmAppt(app.id); }} className="text-emerald-500 hover:bg-emerald-500/10 p-1.5 rounded-lg transition-colors" title="Confirmar Presença">
                                            <CheckCircle size={16} />
                                          </button>
                                        )}
                                        {app.status !== 'concluído' && (
                                          <button onClick={(e) => { e.stopPropagation(); handleCompleteAppt(app.id); }} className="text-purple-400 hover:bg-purple-500/10 p-1.5 rounded-lg transition-colors" title="Concluir/Pago">
                                            <CheckCircle size={16} />
                                          </button>
                                        )}
                                        <button onClick={(e) => { e.stopPropagation(); handleCancelAppt(app.id); }} className="text-red-500 hover:bg-red-500/10 p-1.5 rounded-lg transition-colors" title="Desmarcar">
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <TimelineView 
                        selectedDate={selectedCalendarDate} 
                        setSelectedDate={setSelectedCalendarDate}
                        appointments={activeAppointments}
                        professionals={professionals}
                        currentUser={user}
                        isAdmin={isAdmin}
                        onCancel={handleCancelAppt}
                        onComplete={handleCompleteAppt}
                        onConfirm={handleConfirmAppt}
                        onSelectAppt={(app) => setSelectedAppointment(app)}
                        onDropAppt={handleDropAppt}
                        onQuickAdd={(profId, dateStr, timeStr) => {
                          const isOutside = timeToMinutes(timeStr) < timeToMinutes(workStart) || timeToMinutes(timeStr) >= timeToMinutes(workEnd);
                          setAllowOutsideHours(isOutside);
                          setNewAppt(prev => ({ ...prev, professional_id: profId, date: dateStr, time: timeStr }));
                          setShowAddAppt(true);
                        }}
                        workStart={workStart}
                        workEnd={workEnd}
                        slotInterval={slotInterval}
                      />
                    )}
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
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                              <input className="input-field" placeholder="Nome do Serviço" required value={newService.name} onChange={e => setNewService({ ...newService, name: e.target.value })} />
                              <select className="input-field" required value={newService.category} onChange={e => setNewService({ ...newService, category: e.target.value })}>
                                <option value="">Tipo / Categoria</option>
                                <option value="Manicure">Manicure</option>
                                <option value="Pedicure">Pedicure</option>
                                <option value="Depilação">Depilação</option>
                                <option value="Sobrancelha">Sobrancelha</option>
                                <option value="Cabelo">Cabelo</option>
                                <option value="Geral">Outros / Geral</option>
                              </select>
                              <input className="input-field" placeholder="Duração (Minutos)" type="number" required value={newService.duration} onChange={e => setNewService({ ...newService, duration: e.target.value })} />
                              <input className="input-field" placeholder="Preço (Ex: 120.50)" type="number" step="0.01" required value={newService.price} onChange={e => setNewService({ ...newService, price: e.target.value })} />
                            </div>
                            <div className="mb-4">
                              <textarea 
                                className="input-field w-full h-20 resize-none" 
                                placeholder="Descrição do serviço (opcional)..." 
                                value={newService.description} 
                                onChange={e => setNewService({ ...newService, description: e.target.value })}
                              />
                            </div>
                            <button type="submit" className="bg-green-500 hover:bg-green-600 text-white font-semibold px-6 py-2 rounded-lg transition-colors shadow-lg shadow-green-500/20">Publicar Serviço Agora</button>
                          </form>
                        )}

                        <div className="space-y-10">
                          {Object.entries(
                            services.reduce((acc, srv) => {
                              const cat = srv.category || 'Geral';
                              if (!acc[cat]) acc[cat] = [];
                              acc[cat].push(srv);
                              return acc;
                            }, {})
                          ).map(([category, catServices]) => (
                            <div key={category} className="space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-border/50"></div>
                                <h4 className="text-sm font-bold uppercase tracking-widest text-primary bg-primary/5 px-3 py-1 rounded-full border border-primary/10">
                                  {category}
                                </h4>
                                <div className="h-px flex-1 bg-border/50"></div>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {catServices.map(srv => (
                                  <div key={srv.id} className="p-6 rounded-xl border border-border bg-background flex flex-col hover:border-primary/50 transition-colors shadow-sm relative group overflow-hidden">
                                    <div className="absolute right-0 top-0 w-16 h-16 bg-primary/5 rounded-bl-full pointer-events-none"></div>
                                    <div className="flex justify-between items-start mb-1 pr-8">
                                      <h4 className="text-xl font-serif text-foreground">{srv.name}</h4>
                                    </div>
                                    <p className="text-xs font-medium text-primary mb-2 flex items-center gap-1">
                                      <Scissors size={12} /> {srv.category || 'Geral'}
                                    </p>
                                    <p className="text-xs text-muted mb-3 line-clamp-2 italic">
                                      {srv.description || 'Sem descrição cadastrada.'}
                                    </p>
                                    <p className="text-sm text-muted mb-4">{srv.duration} minutos</p>
                                    <p className="text-2xl font-bold text-primary mt-auto">R$ {Number(srv.price).toFixed(2)}</p>

                                    <div className="absolute top-4 right-4 flex flex-col gap-2 z-20">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteService(srv.id); }}
                                        className="text-red-500 bg-red-500/10 hover:bg-red-500/20 p-2 rounded transition-colors shadow-sm"
                                        title="Apagar Serviço"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingService({...srv}); }}
                                        className="text-primary bg-primary/10 hover:bg-primary/20 p-2 rounded transition-colors shadow-sm"
                                        title="Editar Serviço"
                                      >
                                        <Scissors size={16} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          
                          {services.length === 0 && (
                            <div className="text-center py-20 text-muted italic">
                              Nenhum serviço disponível no catálogo.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'staff' && isAdmin && (
                    <div className="fade-in-up duration-500">

                      {/* GESTÃO FINANCEIRA INICIO */}
                      <div className="glass-card p-6 mb-8 border-primary/20 shadow-[0_0_40px_rgba(244,114,182,0.06)] relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 rounded-bl-full pointer-events-none"></div>
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-2xl font-serif text-foreground flex items-center gap-2">
                            <DollarSign className="text-green-500" />
                            Controle Financeiro
                          </h3>
                        </div>

                        {financialStats ? (
                          <div className="space-y-6 relative z-10">
                            {/* Cards de Resumo */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="p-5 rounded-xl border border-border bg-background shadow-sm hover:border-green-500/50 transition-colors">
                                <p className="text-sm font-semibold uppercase text-muted tracking-wide mb-1">Hoje</p>
                                <p className="text-3xl font-bold text-foreground">R$ {financialStats.today.toFixed(2).replace('.', ',')}</p>
                              </div>
                              <div className="p-5 rounded-xl border border-border bg-background shadow-sm hover:border-green-500/50 transition-colors">
                                <p className="text-sm font-semibold uppercase text-muted tracking-wide mb-1">Esta Semana</p>
                                <p className="text-3xl font-bold text-foreground">R$ {financialStats.week.toFixed(2).replace('.', ',')}</p>
                              </div>
                              <div className="p-5 rounded-xl border border-green-500/30 bg-green-500/5 shadow-sm hover:border-green-500/60 transition-colors relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-16 h-16 bg-green-500/10 rounded-bl-full"></div>
                                <p className="text-sm font-semibold uppercase text-green-700 dark:text-green-400/80 tracking-wide mb-1">Este Mês</p>
                                <p className="text-3xl font-bold text-green-600 dark:text-green-400">R$ {financialStats.month.toFixed(2).replace('.', ',')}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              {/* Histórico Mensal */}
                              <div className="p-5 rounded-xl border border-border bg-background shadow-sm">
                                <h4 className="text-sm font-bold uppercase tracking-widest text-muted mb-4">Histórico de Faturamento</h4>
                                <div className="h-[250px] w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={[...financialStats.history].slice(0, 6).reverse()}>
                                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }} />
                                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }} tickFormatter={(value) => `R$${value}`} />
                                      <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'var(--tw-colors-background)' }} formatter={(value) => [`R$ ${value.toFixed(2).replace('.', ',')}`, 'Faturamento']} />
                                      <Bar dataKey="total" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={40} />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>

                              {/* Ranking Profissionais */}
                              <div className="p-5 rounded-xl border border-border bg-background shadow-sm flex flex-col">
                                <h4 className="text-sm font-bold uppercase tracking-widest text-muted mb-4">Desempenho por Profissional (Mês)</h4>
                                <div className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                  {financialStats.professionals.length > 0 ? financialStats.professionals.map((prof, idx) => (
                                    <div key={idx} className="flex justify-between items-center p-3 rounded-lg border border-border/50 hover:bg-border/20 transition-colors">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">{prof.name.slice(0, 2).toUpperCase()}</div>
                                        <span className="font-medium text-foreground">{prof.name}</span>
                                      </div>
                                      <span className="font-bold text-foreground">R$ {prof.total.toFixed(2).replace('.', ',')}</span>
                                    </div>
                                  )) : (
                                    <p className="text-sm text-muted text-center py-8 italic border border-dashed border-border rounded-lg">Nenhum faturamento registrado pela equipe neste mês.</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="py-20 text-center text-muted animate-pulse font-medium">Analisando dados financeiros...</div>
                        )}
                      </div>
                      {/* GESTÃO FINANCEIRA FIM */}

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
                                  <p className="text-xs text-primary font-bold mt-1">Login: {pro.username}</p>
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
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                        <div>
                          <h3 className="text-xl md:text-2xl font-serif text-foreground">Base de Clientes</h3>
                          <p className="text-xs text-muted">Gerencie o histórico e contato dos seus clientes</p>
                        </div>
                        <div className="relative w-full sm:w-72">
                          <input 
                            type="text" 
                            className="input-field pl-10 py-2.5 text-xs" 
                            placeholder="Buscar por nome ou telefone..."
                            value={clientSearch}
                            onChange={e => setClientSearch(e.target.value)}
                          />
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        </div>
                      </div>

                      {/* Desktop View */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[500px]">
                          <thead>
                            <tr className="border-b border-border/50 text-muted text-xs uppercase font-bold tracking-wider">
                              <th className="py-3 px-4">Nome</th>
                              <th className="py-3 px-4">Telefone / WhatsApp</th>
                              <th className="py-3 px-4 text-right">Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clients
                              .filter(c => {
                                if (!clientSearch.trim()) return true;
                                const q = clientSearch.toLowerCase();
                                return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
                              })
                              .map(client => {
                                const cleanPhone = (client.phone || '').replace(/\D/g, '');
                                return (
                                  <tr key={client.id} className="border-b border-border/30 text-foreground hover:bg-card/40 transition-colors">
                                    <td className="py-4 px-4 font-semibold text-sm">{client.name}</td>
                                    <td className="py-4 px-4 text-sm text-muted">
                                      <a href={`https://wa.me/55${cleanPhone}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-emerald-500 hover:underline">
                                        <MessageCircle size={14} /> {client.phone}
                                      </a>
                                    </td>
                                    <td className="py-2 px-4 text-right space-x-2">
                                      <button 
                                        onClick={() => { setSelectedClient(client); setShowEditClientModal(true); }}
                                        className="p-2 text-primary hover:bg-primary/10 rounded-xl transition-colors"
                                        title="Editar Cliente"
                                      >
                                        <Edit2 size={16} />
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteClient(client.id)}
                                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                                        title="Excluir da Base"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            {clients.length === 0 && (
                              <tr><td colSpan="3" className="text-center py-10 text-muted italic">Nenhum cliente cadastrado ainda.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile View */}
                      <div className="md:hidden space-y-3">
                        {clients
                          .filter(c => {
                            if (!clientSearch.trim()) return true;
                            const q = clientSearch.toLowerCase();
                            return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
                          })
                          .map(client => {
                            const cleanPhone = (client.phone || '').replace(/\D/g, '');
                            return (
                              <div key={client.id} className="p-4 rounded-2xl bg-card border border-border/60 flex items-center justify-between gap-3 shadow-sm">
                                <div className="min-w-0">
                                  <h4 className="font-bold text-foreground text-sm truncate">{client.name}</h4>
                                  <a href={`https://wa.me/55${cleanPhone}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:underline mt-1 font-medium">
                                    <MessageCircle size={13} /> {client.phone}
                                  </a>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button 
                                    onClick={() => { setSelectedClient(client); setShowEditClientModal(true); }}
                                    className="p-2.5 text-primary hover:bg-primary/10 rounded-xl transition-colors"
                                    title="Editar Cliente"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteClient(client.id)}
                                    className="p-2.5 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                                    title="Excluir"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        {clients.length === 0 && (
                          <p className="text-center py-8 text-muted italic text-xs">Nenhum cliente cadastrado.</p>
                        )}
                      </div>
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

                      {/* Informações exibidas no portal público */}
                      <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-fuchsia-500/10 flex items-center justify-center"><Info size={20} className="text-fuchsia-500" /></div>
                          <div>
                            <h3 className="text-xl font-serif text-foreground">Portal Público</h3>
                            <p className="text-xs text-muted">Conteúdo que ajuda a cliente a decidir antes de agendar</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div>
                            <label htmlFor="public-hero-eyebrow" className="block text-sm font-medium text-muted mb-2">Chamada curta do início</label>
                            <input id="public-hero-eyebrow" type="text" className="input-field" maxLength="80" value={publicProfile.heroEyebrow} onChange={e => setPublicProfile(prev => ({ ...prev, heroEyebrow: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-opening-note" className="block text-sm font-medium text-muted mb-2">Resumo do funcionamento</label>
                            <input id="public-opening-note" type="text" className="input-field" maxLength="120" placeholder="Ex.: Terça a sábado, das 9h às 18h" value={publicProfile.openingNote} onChange={e => setPublicProfile(prev => ({ ...prev, openingNote: e.target.value }))} />
                          </div>
                          <div className="md:col-span-2">
                            <label htmlFor="public-hero-subtitle" className="block text-sm font-medium text-muted mb-2">Texto principal de apresentação</label>
                            <textarea id="public-hero-subtitle" className="input-field min-h-24 resize-y" maxLength="240" placeholder="Conte em uma frase por que a experiência do seu espaço é especial." value={publicProfile.heroSubtitle} onChange={e => setPublicProfile(prev => ({ ...prev, heroSubtitle: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-address" className="block text-sm font-medium text-muted mb-2">Endereço para clientes</label>
                            <input id="public-address" type="text" className="input-field" maxLength="200" placeholder="Rua, número, bairro e cidade" value={publicProfile.address} onChange={e => setPublicProfile(prev => ({ ...prev, address: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-maps-url" className="block text-sm font-medium text-muted mb-2">Link do Google Maps</label>
                            <input id="public-maps-url" type="url" className="input-field" placeholder="https://maps.google.com/..." value={publicProfile.mapsUrl} onChange={e => setPublicProfile(prev => ({ ...prev, mapsUrl: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-payments" className="block text-sm font-medium text-muted mb-2">Formas de pagamento</label>
                            <input id="public-payments" type="text" className="input-field" maxLength="140" placeholder="Ex.: PIX, dinheiro e cartões" value={publicProfile.payments} onChange={e => setPublicProfile(prev => ({ ...prev, payments: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-parking" className="block text-sm font-medium text-muted mb-2">Estacionamento e acesso</label>
                            <input id="public-parking" type="text" className="input-field" maxLength="140" placeholder="Ex.: Estacionamento próximo" value={publicProfile.parking} onChange={e => setPublicProfile(prev => ({ ...prev, parking: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-instagram" className="block text-sm font-medium text-muted mb-2">Instagram</label>
                            <input id="public-instagram" type="url" className="input-field" placeholder="https://instagram.com/..." value={publicProfile.instagramUrl} onChange={e => setPublicProfile(prev => ({ ...prev, instagramUrl: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-google-reviews" className="block text-sm font-medium text-muted mb-2">Link das avaliações do Google</label>
                            <input id="public-google-reviews" type="url" className="input-field" placeholder="https://g.page/r/..." value={publicProfile.googleReviewsUrl} onChange={e => setPublicProfile(prev => ({ ...prev, googleReviewsUrl: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-google-rating" className="block text-sm font-medium text-muted mb-2">Nota atual no Google</label>
                            <input id="public-google-rating" type="number" min="1" max="5" step="0.1" className="input-field" placeholder="Ex.: 4.9" value={publicProfile.googleRating} onChange={e => setPublicProfile(prev => ({ ...prev, googleRating: e.target.value }))} />
                          </div>
                          <div>
                            <label htmlFor="public-google-count" className="block text-sm font-medium text-muted mb-2">Quantidade de avaliações</label>
                            <input id="public-google-count" type="number" min="0" step="1" className="input-field" placeholder="Ex.: 127" value={publicProfile.googleReviewCount} onChange={e => setPublicProfile(prev => ({ ...prev, googleReviewCount: e.target.value }))} />
                          </div>
                          <div className="md:col-span-2">
                            <label htmlFor="public-cancellation" className="block text-sm font-medium text-muted mb-2">Política de cancelamento e atraso</label>
                            <textarea id="public-cancellation" className="input-field min-h-28 resize-y" maxLength="600" value={publicProfile.cancellationPolicy} onChange={e => setPublicProfile(prev => ({ ...prev, cancellationPolicy: e.target.value }))} />
                          </div>
                          <div className="md:col-span-2">
                            <label htmlFor="public-privacy-contact" className="block text-sm font-medium text-muted mb-2">Contato para privacidade</label>
                            <input id="public-privacy-contact" type="text" className="input-field" maxLength="160" placeholder="WhatsApp ou e-mail para solicitações sobre dados pessoais" value={publicProfile.privacyContact} onChange={e => setPublicProfile(prev => ({ ...prev, privacyContact: e.target.value }))} />
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

                        <div className="flex items-center justify-between p-5 bg-primary/5 border border-primary/20 rounded-2xl mb-8">
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${isPublicAgenda ? 'bg-primary/20 text-primary' : 'bg-muted/20 text-muted'}`}>
                              <Users size={24} />
                            </div>
                            <div>
                              <h4 className="text-lg font-bold text-foreground">Agenda Pública</h4>
                              <p className="text-xs text-muted">Permitir que colegas profissionais vejam seus horários no painel da equipe.</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => setIsPublicAgenda(!isPublicAgenda)}
                            className={`w-14 h-7 rounded-full transition-all relative flex items-center px-1 ${isPublicAgenda ? 'bg-primary shadow-lg shadow-primary/20' : 'bg-muted/40'}`}
                          >
                            <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-all transform ${isPublicAgenda ? 'translate-x-7' : 'translate-x-0'}`}></div>
                          </button>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 fade-in-up">
          <div className="bg-card w-full max-w-md rounded-[2.5rem] border border-amber-500/30 shadow-2xl p-6 relative overflow-hidden">
            <button 
              onClick={() => setShowBlockModal(false)}
              className="absolute right-5 top-5 text-muted hover:text-foreground transition-colors p-1"
            >
              <X size={20} />
            </button>
            
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-md">
                <Lock size={22} />
              </div>
              <div>
                <h2 className="text-xl font-serif font-black text-foreground">Fechar Horário</h2>
                <p className="text-xs text-muted">Bloqueie sua agenda para pausas ou faltas</p>
              </div>
            </div>

            <form onSubmit={handleAddBlock} className="space-y-4 mt-5">
              {isAdmin && (
                <div>
                  <label className="text-xs font-bold text-muted mb-1 block uppercase tracking-wider">Profissional</label>
                  <select 
                    className="input-field w-full text-xs font-bold uppercase tracking-wider" 
                    value={newBlock.professional_id} 
                    onChange={e => setNewBlock({ ...newBlock, professional_id: e.target.value })} 
                    required
                  >
                    <option value="" disabled>Selecione o Profissional</option>
                    {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              
              <div>
                <label className="text-xs font-bold text-muted mb-1 block uppercase tracking-wider">Data do Bloqueio</label>
                <input 
                  type="date" 
                  className="input-field w-full text-xs font-bold" 
                  value={newBlock.date} 
                  onChange={e => setNewBlock({ ...newBlock, date: e.target.value })} 
                  required 
                />
              </div>

              {/* Escolha Livre de Horário de Início e Término */}
              <div className="grid grid-cols-2 gap-3 bg-card border border-amber-500/30 p-3.5 rounded-2xl">
                <div>
                  <label className="text-[11px] font-black text-amber-400 mb-1 block uppercase tracking-wider">De (Início)</label>
                  <select 
                    className="input-field w-full text-xs font-bold bg-background text-foreground" 
                    value={newBlock.time || '12:00'} 
                    onChange={e => {
                      const startTime = e.target.value;
                      const [h, m] = startTime.split(':').map(Number);
                      const endH = Math.min(23, h + 1).toString().padStart(2, '0');
                      const endTime = `${endH}:${m.toString().padStart(2, '0')}`;
                      setNewBlock({ ...newBlock, time: startTime, endTime: newBlock.endTime > startTime ? newBlock.endTime : endTime });
                    }} 
                    required
                  >
                    {['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30','23:00'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-black text-amber-400 mb-1 block uppercase tracking-wider">Até (Término)</label>
                  <select 
                    className="input-field w-full text-xs font-bold bg-background text-foreground" 
                    value={newBlock.endTime || '13:00'} 
                    onChange={e => setNewBlock({ ...newBlock, endTime: e.target.value })} 
                    required
                  >
                    {['06:30','07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30','23:59'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Badge de Duração Calculada */}
              {(() => {
                const [sh, sm] = (newBlock.time || '12:00').split(':').map(Number);
                const [eh, em] = (newBlock.endTime || '13:00').split(':').map(Number);
                const diff = (eh * 60 + em) - (sh * 60 + sm);
                const isValid = diff > 0;
                return (
                  <div className={`p-2.5 rounded-xl border text-xs font-bold text-center flex items-center justify-center gap-2 transition-all ${isValid ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                    <Clock size={14} />
                    {isValid ? (
                      <span>Duração da Pausa: <strong>{diff >= 60 ? `${Math.floor(diff/60)}h ${diff%60 > 0 ? `${diff%60}m` : ''}` : `${diff} minutos`}</strong> (das {newBlock.time} às {newBlock.endTime})</span>
                    ) : (
                      <span>Horário de término deve ser após {newBlock.time}</span>
                    )}
                  </div>
                );
              })()}

              <div>
                <label className="text-xs font-bold text-muted mb-1.5 block uppercase tracking-wider">Motivo / Descrição</label>
                
                {/* Atalhos Rápidos */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { label: 'Almoço (1h)', start: '12:00', end: '13:00', desc: 'Horário de Almoço' },
                    { label: 'Médico', start: '14:00', end: '15:30', desc: 'Consulta Médica' },
                    { label: 'Pausa (30m)', start: '15:00', end: '15:30', desc: 'Pausa Rápida' },
                    { label: 'Dia Inteiro / Folga', start: workStart || '09:00', end: workEnd || '18:00', desc: 'Folga / Agenda Fechada' }
                  ].map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setNewBlock({ ...newBlock, time: preset.start, endTime: preset.end, description: preset.desc })}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-xl border transition-all ${newBlock.description === preset.desc ? 'bg-amber-500/30 border-amber-500 text-amber-300' : 'bg-card border-border/60 text-muted hover:text-foreground'}`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <input 
                  type="text" 
                  className="input-field w-full text-xs font-bold" 
                  placeholder="Ex: Horário de Almoço, Médico, Folga, etc." 
                  value={newBlock.description} 
                  onChange={e => setNewBlock({ ...newBlock, description: e.target.value })} 
                />
              </div>

              <div className="pt-3 flex gap-3">
                <button type="button" onClick={() => setShowBlockModal(false)} className="btn-secondary flex-1 text-xs font-bold uppercase tracking-wider py-3">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-2xl transition-all font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2">
                  <Lock size={15} /> Bloquear Agenda
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EDITAR SERVIÇO (POP-UP) */}
      {editingService && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setEditingService(null)}>
          <div className="bg-card border border-primary/30 rounded-[2.5rem] w-full max-w-lg shadow-[0_30px_60px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 relative p-6 md:p-8" onClick={e => e.stopPropagation()}>
            
            <button 
              onClick={() => setEditingService(null)} 
              className="absolute right-6 top-6 text-muted hover:text-foreground transition-colors p-1 rounded-xl hover:bg-muted/10"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3.5 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-primary/20 text-primary border border-primary/30 flex items-center justify-center shadow-lg glow-primary shrink-0">
                <Scissors size={24} />
              </div>
              <div>
                <h3 className="text-xl font-serif font-black text-foreground">Editar Serviço</h3>
                <p className="text-xs text-muted">Altere o preço ou detalhes. Os agendamentos marcados serão sincronizados.</p>
              </div>
            </div>

            <form onSubmit={handleUpdateService} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted uppercase tracking-wider block">Nome do Serviço</label>
                <input 
                  className="input-field w-full text-xs font-bold" 
                  placeholder="Ex: Manicure Tradicional" 
                  type="text" 
                  required 
                  value={editingService.name || ''} 
                  onChange={e => setEditingService({ ...editingService, name: e.target.value })} 
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted uppercase tracking-wider block">Categoria</label>
                  <select 
                    className="input-field w-full text-xs font-bold" 
                    value={editingService.category || ''} 
                    onChange={e => setEditingService({ ...editingService, category: e.target.value })}
                  >
                    <option value="Manicure">Manicure</option>
                    <option value="Pedicure">Pedicure</option>
                    <option value="Depilação">Depilação</option>
                    <option value="Sobrancelha">Sobrancelha</option>
                    <option value="Cílios">Cílios</option>
                    <option value="Cabelo">Cabelo</option>
                    <option value="Alongamento">Alongamento</option>
                    <option value="Geral">Geral</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted uppercase tracking-wider block">Duração (Min)</label>
                  <input 
                    className="input-field w-full text-xs font-bold" 
                    placeholder="Ex: 40" 
                    type="number" 
                    required 
                    value={editingService.duration || ''} 
                    onChange={e => setEditingService({ ...editingService, duration: e.target.value })} 
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-primary uppercase tracking-wider block font-black">Preço (R$)</label>
                  <input 
                    className="input-field w-full text-xs font-black text-emerald-400 border-emerald-500/40 bg-emerald-500/10" 
                    placeholder="Ex: 50.00" 
                    type="number" 
                    step="0.01" 
                    required 
                    value={editingService.price || ''} 
                    onChange={e => setEditingService({ ...editingService, price: e.target.value })} 
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted uppercase tracking-wider block">Descrição Completa</label>
                <textarea 
                  className="input-field w-full h-24 resize-none text-xs font-medium" 
                  placeholder="Descreva o que está incluso neste serviço..." 
                  value={editingService.description || ''} 
                  onChange={e => setEditingService({ ...editingService, description: e.target.value })}
                />
              </div>

              <div className="pt-3 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setEditingService(null)} 
                  className="btn-secondary flex-1 text-xs font-bold uppercase tracking-wider py-3.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-3.5 bg-primary hover:bg-primary-dark text-white rounded-2xl transition-all font-black text-xs uppercase tracking-wider shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                >
                  <CheckCircle size={16} /> Salvar & Sincronizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedAppointment && (
        selectedAppointment.notes?.startsWith('BLOCK:') ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setSelectedAppointment(null)}>
            <div className="bg-card border border-amber-500/40 rounded-[2.5rem] w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 relative p-6 space-y-5" onClick={e => e.stopPropagation()}>
              
              <button 
                onClick={() => setSelectedAppointment(null)}
                className="absolute right-5 top-5 text-muted hover:text-foreground transition-colors p-1"
              >
                <X size={20} />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center shadow-md">
                  <Lock size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-black text-foreground">Horário Fechado</h2>
                  <p className="text-xs text-amber-400 font-bold">Bloqueio de Agenda / Pausa</p>
                </div>
              </div>

              <div className="space-y-3 bg-card/60 p-4 rounded-2xl border border-border/50 text-xs">
                <div className="flex justify-between items-center pb-2 border-b border-border/40">
                  <span className="text-muted font-bold uppercase tracking-wider text-[10px]">Profissional</span>
                  <span className="font-black text-foreground">{selectedAppointment.professional_name || 'Equipe'}</span>
                </div>

                <div className="flex justify-between items-center pb-2 border-b border-border/40">
                  <span className="text-muted font-bold uppercase tracking-wider text-[10px]">Data</span>
                  <span className="font-black text-foreground">{safeFormatDate(selectedAppointment.date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
                </div>

                <div className="flex justify-between items-center pb-2 border-b border-border/40">
                  <span className="text-muted font-bold uppercase tracking-wider text-[10px]">Horário</span>
                  <span className="font-black text-amber-400">{selectedAppointment.time} - {calculateEndTime(selectedAppointment.time, selectedAppointment.service_duration)} ({Number(selectedAppointment.service_duration) || 30} min)</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-muted font-bold uppercase tracking-wider text-[10px]">Motivo</span>
                  <span className="font-black text-foreground">{selectedAppointment.client_name?.replace(/^Bloqueio:\s*/, '') || 'Bloqueio de Agenda'}</span>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button 
                  onClick={() => handleCancelAppt(selectedAppointment.id)} 
                  className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black rounded-2xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 text-xs uppercase tracking-wider transition-all"
                >
                  <Unlock size={16} /> Desbloquear Horário (Remover Pausa)
                </button>
                
                <button 
                  onClick={() => setSelectedAppointment(null)} 
                  className="w-full py-3 text-center font-bold text-muted hover:text-foreground text-xs uppercase tracking-wider"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setSelectedAppointment(null)}>
            <div className="bg-card border border-primary/20 rounded-[2.5rem] w-full max-w-md shadow-[0_30px_60px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
              
              <div className="grid grid-cols-4 gap-1 p-4 bg-gradient-to-br from-muted/20 to-transparent border-b border-border/50">
                <button onClick={() => handleWhatsAppAction(selectedAppointment, false)} className="flex flex-col items-center gap-1 text-green-500 hover:text-green-600 transition-colors p-2 rounded-2xl hover:bg-green-500/10">
                  <MessageCircle size={20} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Whats</span>
                </button>
                <button onClick={() => handleWhatsAppAction(selectedAppointment, true)} className="flex flex-col items-center gap-1 text-primary hover:text-primary-dark transition-colors p-2 rounded-2xl hover:bg-primary/10">
                  <Send size={20} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Lembrete</span>
                </button>
                <button onClick={() => {
                  const currentTime = timeToMinutes(selectedAppointment.time);
                  setAllowOutsideHours(currentTime < timeToMinutes(workStart) || currentTime >= timeToMinutes(workEnd));
                  setEditAppt({
                    id: selectedAppointment.id,
                    client_name: selectedAppointment.client_name,
                    date: selectedAppointment.date,
                    time: selectedAppointment.time,
                    professional_id: String(selectedAppointment.professional_id),
                    service_name: selectedAppointment.service_name 
                  });
                  setSelectedAppointment(null);
                  setShowEditAppt(true);
                }} className="flex flex-col items-center gap-1 text-blue-500 hover:text-blue-600 transition-colors p-2 rounded-2xl hover:bg-blue-500/10">
                  <Edit2 size={20} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Editar</span>
                </button>
                <button onClick={() => { setSelectedAppointment(null); handleCancelAppt(selectedAppointment.id); }} className="flex flex-col items-center gap-1 text-red-500 hover:text-red-600 transition-colors p-2 rounded-2xl hover:bg-red-500/10">
                  <Trash2 size={20} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Apagar</span>
                </button>
              </div>

              {/* Body List */}
              <div className="flex-1 overflow-y-auto p-2">
                
                <div className="flex items-center gap-4 p-3 hover:bg-muted/10 rounded-xl transition-colors border-b border-border/50">
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
                    <CalendarIcon size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-foreground">{selectedAppointment.time} - {calculateEndTime(selectedAppointment.time, selectedAppointment.service_duration)}</p>
                    <p className="text-xs text-muted capitalize">{safeFormatDate(selectedAppointment?.date, "EEEE, dd 'de' MMMM 'de' yyyy", {locale: ptBR})}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-3 hover:bg-muted/10 rounded-xl transition-colors border-b border-border/50">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <User size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-foreground">{selectedAppointment.client_name}</p>
                    <p className="text-xs text-primary font-medium">{selectedAppointment.client_phone}</p>
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(selectedAppointment.client_phone)} className="p-2 text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="Copiar Telefone">
                    <Copy size={16} />
                  </button>
                </div>

                <div className="flex items-center gap-4 p-3 hover:bg-muted/10 rounded-xl transition-colors border-b border-border/50">
                  <div className="w-10 h-10 rounded-full bg-pink-500/10 text-pink-500 flex items-center justify-center shrink-0">
                    <Briefcase size={18} />
                  </div>
                  <div className="flex-1">
                    {getAppServices(selectedAppointment).map((srv, idx) => (
                      <div key={idx} className="flex justify-between items-center mb-1 last:mb-0">
                        <p className="text-sm font-bold text-foreground">{srv.name}</p>
                        <p className="text-xs text-muted font-medium">R$ {Number(srv.price||0).toFixed(2).replace('.', ',')}</p>
                      </div>
                    ))}
                    {getAppServices(selectedAppointment).length > 1 && (
                      <div className="mt-2 pt-2 border-t border-border flex justify-between items-center">
                        <p className="text-xs font-bold uppercase text-primary">Total da Venda</p>
                        <p className="text-sm font-black text-primary">R$ {getAppServices(selectedAppointment).reduce((acc, srv) => acc + Number(srv.price||0), 0).toFixed(2).replace('.', ',')}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 p-3 bg-muted/5 rounded-xl transition-colors border-b border-border/50">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center shrink-0">
                    <DollarSign size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted font-medium mb-1">Forma de pagamento</p>
                    <select 
                      className="w-full bg-transparent border-none text-sm font-bold text-foreground focus:ring-0 p-0 cursor-pointer"
                      value={getAppPaymentMethod(selectedAppointment.notes)}
                      onChange={(e) => updateAppPaymentMethod(selectedAppointment.id, selectedAppointment.notes, e.target.value)}
                    >
                      <option value="Não definido">Não definido</option>
                      <option value="Dinheiro">Dinheiro</option>
                      <option value="PIX">PIX</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-3 hover:bg-muted/10 rounded-xl transition-colors border-b border-border/50">
                  <div className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
                    <FileText size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted font-medium mb-1">Observação</p>
                    <p className="text-sm text-foreground">
                      {(() => {
                        const notes = selectedAppointment.notes || '';
                        const parts = notes
                          .split('|')
                          .filter(p => !p.startsWith('BLOCK:') && !p.startsWith('PAYMENT:') && !p.startsWith('MULTI_SERVICES:'))
                          .map(p => p.replace(/^NOTE:/, ''));
                        return parts.join(' | ') || '-';
                      })()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-3 hover:bg-muted/10 rounded-xl transition-colors">
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                    <Tag size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted font-medium mb-1">Situação / Status</p>
                    <p className={`text-sm font-bold ${
                      selectedAppointment.status === 'concluído' ? 'text-green-500' :
                      selectedAppointment.status === 'confirmado' ? 'text-emerald-400' : 'text-amber-500'
                    } uppercase`}>
                      {selectedAppointment.status === 'concluído' ? 'Pago / Concluído' :
                       selectedAppointment.status === 'confirmado' ? '✅ Presença Confirmada' : '⏳ Aguardando Confirmação'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedAppointment.status === 'agendado' && (
                      <button onClick={() => { handleConfirmAppt(selectedAppointment.id); setSelectedAppointment(null); }} className="text-xs font-bold bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors">
                        CONFIRMAR PRESENÇA
                      </button>
                    )}
                    {selectedAppointment.status !== 'concluído' && (
                      <button onClick={() => { handleCompleteAppt(selectedAppointment.id); setSelectedAppointment(null); }} className="text-xs font-bold bg-green-500/10 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-500 hover:text-white transition-colors">
                        CONCLUIR
                      </button>
                    )}
                  </div>
                </div>

              </div>

              {/* Footer Actions */}
              <div className="p-4 border-t border-border flex justify-between items-center bg-muted/10">
                <button 
                  onClick={() => handleAddCharge(selectedAppointment)}
                  className="text-xs font-bold text-purple-600 uppercase tracking-wide px-4 py-2 hover:bg-purple-500/10 rounded-lg transition-colors"
                >
                  Adicionar Cobrança
                </button>
                <button 
                  onClick={() => handleGenerateReceipt(selectedAppointment)}
                  className="text-xs font-bold text-purple-600 flex items-center gap-2 uppercase tracking-wide px-4 py-2 hover:bg-purple-500/10 rounded-lg transition-colors"
                >
                  <Printer size={16} />
                  Gerar Recibo
                </button>
              </div>

              <button onClick={() => setSelectedAppointment(null)} className="w-full py-4 text-center font-bold text-muted hover:text-foreground border-t border-border bg-background transition-colors uppercase tracking-widest text-xs">
                Fechar
              </button>

            </div>
          </div>
        )
      )}

      {showEditAppt && editAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-background rounded-2xl w-full max-w-md shadow-2xl p-6 relative border border-border scale-in-center">
            <button 
              onClick={() => { setShowEditAppt(false); setEditAppt(null); }}
              className="absolute top-4 right-4 text-muted hover:text-foreground hover:bg-muted/20 p-2 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
            
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-purple-500/20 text-purple-500 flex items-center justify-center">
                <Edit2 size={20} />
              </div>
              <h2 className="text-xl font-serif text-foreground">Editar Agendamento</h2>
            </div>
            
            <p className="text-sm text-muted mb-6">
              Edite as informações de {editAppt.client_name}
            </p>

            <form onSubmit={handleEditApptSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-muted mb-1 block">Data</label>
                <input type="date" className="input-field w-full" value={editAppt.date} onChange={e => setEditAppt({ ...editAppt, date: e.target.value })} min={format(startOfToday(), 'yyyy-MM-dd')} required />
              </div>

              <div>
                <label className="text-sm text-muted mb-1 block">Horário</label>
                <select className="input-field w-full" value={editAppt.time} onChange={e => setEditAppt({ ...editAppt, time: e.target.value })} required>
                  <option value="" disabled>Selecione um horário</option>
                  {buildTimeSlots(workStart, workEnd, slotInterval, allowOutsideHours || (editAppt.time && (timeToMinutes(editAppt.time) < timeToMinutes(workStart) || timeToMinutes(editAppt.time) >= timeToMinutes(workEnd))), activeAppointments.filter(a => a.date === editAppt.date)).map(t => {
                    const appOrig = appointments.find(a => a.id === editAppt.id);
                    const duration = appOrig ? appOrig.service_duration : 30;
                    return <option key={t} value={t}>{t} - {calculateEndTime(t, duration)}</option>
                  })}
                </select>
                <label className="flex items-center gap-2 cursor-pointer mt-2 text-xs font-bold text-primary/90 hover:text-primary transition-colors select-none">
                  <input 
                    type="checkbox" 
                    checked={allowOutsideHours} 
                    onChange={e => setAllowOutsideHours(e.target.checked)} 
                    className="rounded text-primary focus:ring-primary h-4 w-4 border-border bg-background cursor-pointer"
                  />
                  <span>Permitir horário fora do expediente</span>
                </label>
              </div>

              <div>
                <label className="text-sm text-muted mb-1 block">Profissional</label>
                <select className="input-field w-full" value={editAppt.professional_id} onChange={e => setEditAppt({ ...editAppt, professional_id: e.target.value })} required>
                  <option value="" disabled>Selecione um Profissional</option>
                  {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => { setShowEditAppt(false); setEditAppt(null); }} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1">Salvar Alterações</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar - NATIVE APP FEEL */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-2xl border-t border-border/60 px-2 py-2 flex justify-around items-center pb-safe shadow-[0_-10px_25px_rgba(0,0,0,0.2)]">
        <button
          onClick={() => setActiveTab('agenda')}
          className={`flex flex-col items-center gap-1 p-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
            activeTab === 'agenda' ? 'text-primary font-black scale-105' : 'text-muted hover:text-foreground'
          }`}
        >
          <CalendarIcon size={20} className={activeTab === 'agenda' ? 'text-primary' : ''} />
          <span>Agenda</span>
        </button>

        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 p-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
            activeTab === 'dashboard' ? 'text-primary font-black scale-105' : 'text-muted hover:text-foreground'
          }`}
        >
          <LayoutDashboard size={20} className={activeTab === 'dashboard' ? 'text-primary' : ''} />
          <span>Painel</span>
        </button>

        <button
          onClick={() => setActiveTab('clients')}
          className={`flex flex-col items-center gap-1 p-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
            activeTab === 'clients' ? 'text-primary font-black scale-105' : 'text-muted hover:text-foreground'
          }`}
        >
          <Users size={20} className={activeTab === 'clients' ? 'text-primary' : ''} />
          <span>Clientes</span>
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab('catalog')}
            className={`flex flex-col items-center gap-1 p-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
              activeTab === 'catalog' ? 'text-primary font-black scale-105' : 'text-muted hover:text-foreground'
            }`}
          >
            <Scissors size={20} className={activeTab === 'catalog' ? 'text-primary' : ''} />
            <span>Serviços</span>
          </button>
        )}

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 p-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
            activeTab === 'settings' ? 'text-primary font-black scale-105' : 'text-muted hover:text-foreground'
          }`}
        >
          <Settings size={20} className={activeTab === 'settings' ? 'text-primary' : ''} />
          <span>Ajustes</span>
        </button>
      </nav>

    </div>
  );
}
