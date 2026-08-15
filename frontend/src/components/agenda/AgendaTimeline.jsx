import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, eachDayOfInterval, format, isSameDay, startOfToday, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CheckCircle, ChevronLeft, ChevronRight, Clock, Lock, MessageCircle, Plus, Unlock } from 'lucide-react';
import { buildEffectiveSchedule } from '../../utils/schedule';
import {
  buildHalfHourSlots,
  getTimelineBounds,
  layoutOverlaps,
  minuteToPixels,
  parseAppointmentDuration,
  parseBlockDescription,
  parseBlockNote,
  PIXELS_PER_30_MINUTES,
  timeToMinutes
} from '../../utils/timelineLayout';

export const isPartner = professional => {
  const identity = `${professional?.name || ''} ${professional?.specialty || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return identity.includes('socio') || identity.includes('socia');
};

const appointmentDate = date => format(date, 'yyyy-MM-dd');

function formatMinutesToTimeString(minutes) {
  const total = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

const statusClasses = appointment => {
  if (parseBlockNote(appointment.notes).isBlock) {
    return 'border-amber-400 bg-amber-500/20 text-amber-100 shadow-amber-500/10 hover:border-amber-300';
  }
  if (appointment.status === 'concluído') {
    return 'border-purple-400 bg-purple-500/20 text-purple-100 shadow-purple-500/10 hover:border-purple-300';
  }
  if (appointment.status === 'confirmado') {
    return 'border-emerald-400 bg-emerald-500/20 text-emerald-100 shadow-emerald-500/10 hover:border-emerald-300';
  }
  return 'border-primary bg-primary/25 text-white shadow-primary/20 hover:border-pink-300';
};

function AppointmentCard({ item, startMinute, onCancel, onConfirm, onComplete, onSelect }) {
  const { appointment, start, duration, lane, laneCount } = item;
  const block = parseBlockNote(appointment.notes, duration);
  const isBlock = block.isBlock;
  const endTime = formatMinutesToTimeString(start + duration);
  const blockLabel = parseBlockDescription(appointment);
  const clientLabel = isBlock ? blockLabel : (appointment.client_name || 'Cliente sem nome');
  const serviceLabel = isBlock ? 'Horário Bloqueado / Pausa' : (appointment.service_name || 'Serviço');
  const cleanPhone = (appointment.client_phone || '').replace(/\D/g, '');

  const top = minuteToPixels(start, startMinute);
  const height = Math.max(minuteToPixels(duration, 0) - 4, 34);

  const cardStyle = {
    top: `${top + 2}px`,
    height: `${height}px`,
    left: `calc(${(lane / laneCount) * 100}% + 4px)`,
    width: `calc(${100 / laneCount}% - 8px)`
  };

  const selectAppointment = event => {
    event.stopPropagation();
    onSelect?.(appointment);
  };

  return (
    <div
      className={`group absolute z-20 overflow-hidden rounded-xl border-l-4 p-2 shadow-lg backdrop-blur-md transition-all hover:z-40 hover:scale-[1.01] hover:shadow-2xl cursor-pointer ${statusClasses(
        appointment
      )}`}
      style={cardStyle}
      draggable={!isBlock}
      role="button"
      tabIndex={0}
      onClick={selectAppointment}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(appointment);
        }
      }}
      onDragStart={event => {
        if (isBlock) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('appId', String(appointment.id));
      }}
      aria-label={`${isBlock ? 'Bloqueio' : 'Agendamento'} de ${clientLabel}, ${appointment.time} até ${endTime}`}
    >
      <div className="flex h-full min-w-0 flex-col justify-between gap-1">
        <div className="min-w-0">
          <div className="mb-1 flex items-start justify-between gap-1">
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black tracking-wide ${
                isBlock
                  ? 'border-amber-300/40 bg-amber-400/20 text-amber-200'
                  : 'border-white/20 bg-background/80 text-primary shadow-sm'
              }`}
            >
              {isBlock && <Lock size={10} aria-hidden="true" />}
              {appointment.time}–{endTime}
            </span>

            {!isBlock && appointment.status === 'confirmado' && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-300 border border-emerald-500/30">
                <CheckCircle size={10} className="shrink-0" aria-label="Confirmado" />
                <span className="hidden sm:inline">Confirmado</span>
              </span>
            )}
            {!isBlock && appointment.status === 'concluído' && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[8px] font-black uppercase text-purple-300 border border-purple-500/30">
                <span>🟢</span>
                <span className="hidden sm:inline">Pago</span>
              </span>
            )}
          </div>

          <p className="truncate text-[11px] font-black uppercase leading-tight text-foreground">{clientLabel}</p>
          <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-wide text-muted">{serviceLabel}</p>
        </div>

        <div className="flex items-center justify-between gap-1 border-t border-white/10 pt-1 text-[9px] font-bold">
          <span className={isBlock ? 'text-amber-200 font-bold' : 'text-primary font-black'}>
            {isBlock ? (
              `${duration} min`
            ) : (
              `R$ ${Number(appointment.service_price || 0).toFixed(0)} · ${duration} min`
            )}
          </span>

          <div className="flex items-center gap-1">
            {isBlock ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-amber-200 hover:bg-amber-400/25 border border-amber-400/30 transition-colors"
                title="Desbloquear horário"
                onClick={event => {
                  event.stopPropagation();
                  onCancel?.(appointment.id);
                }}
              >
                <Unlock size={11} aria-hidden="true" />
                <span className="text-[9px] font-bold">Desbloquear</span>
              </button>
            ) : (
              <>
                {cleanPhone && (
                  <a
                    href={`https://wa.me/55${cleanPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={event => event.stopPropagation()}
                    className="rounded-lg p-1 text-emerald-400 hover:bg-emerald-400/20 transition-colors"
                    title="WhatsApp"
                  >
                    <MessageCircle size={12} aria-hidden="true" />
                  </a>
                )}
                {appointment.status === 'agendado' && onConfirm && (
                  <button
                    type="button"
                    className="rounded-lg p-1 text-emerald-300 hover:bg-emerald-400/20 transition-colors"
                    title="Confirmar presença"
                    onClick={event => {
                      event.stopPropagation();
                      onConfirm(appointment.id);
                    }}
                  >
                    <CheckCircle size={12} aria-hidden="true" />
                  </button>
                )}
                {appointment.status !== 'concluído' && onComplete && (
                  <button
                    type="button"
                    className="rounded-lg p-1 text-purple-300 hover:bg-purple-400/20 transition-colors"
                    title="Marcar como Concluído/Pago"
                    onClick={event => {
                      event.stopPropagation();
                      onComplete(appointment.id);
                    }}
                  >
                    <CheckCircle size={12} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfessionalHeader({ professional, appointments }) {
  const revenue = appointments.reduce((total, appointment) => total + (Number(appointment.service_price) || 0), 0);
  const activeCount = appointments.filter(a => !parseBlockNote(a.notes).isBlock).length;
  const blocksCount = appointments.filter(a => parseBlockNote(a.notes).isBlock).length;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-pink-500 to-primary-dark text-xs font-black text-white shadow-lg glow-primary">
        {professional.avatar || professional.name?.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black uppercase tracking-wide text-foreground">{professional.name}</p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[9px] font-bold uppercase text-primary">{professional.specialty || 'Profissional'}</span>
          <span className="shrink-0 text-[9px] font-black text-emerald-400">
            R$ {revenue.toFixed(0)} · {activeCount} agend.{blocksCount > 0 ? ` (${blocksCount} bloq.)` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function DayHeader({ day, appointments }) {
  const today = isSameDay(day, startOfToday());
  const revenue = appointments.reduce((total, appointment) => total + (Number(appointment.service_price) || 0), 0);
  const activeCount = appointments.filter(a => !parseBlockNote(a.notes).isBlock).length;

  return (
    <div className="flex items-center justify-between gap-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-xs font-black transition-all ${
          today
            ? 'border-primary bg-primary text-white shadow-lg glow-primary'
            : 'border-border/60 bg-card text-muted'
        }`}
      >
        {format(day, 'dd')}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-black uppercase tracking-wider text-muted">{format(day, 'EEEE', { locale: ptBR })}</p>
        <p className="text-xs font-black uppercase text-foreground">{format(day, 'MMMM', { locale: ptBR })}</p>
      </div>
      <div className="text-right shrink-0">
        <span className="block text-[9px] font-bold text-primary">{activeCount} agend.</span>
        <span className="block text-[9px] font-black text-emerald-400">R$ {revenue.toFixed(0)}</span>
      </div>
    </div>
  );
}

function ScheduleOverlay({ schedule, startMinute, endMinute }) {
  if (!schedule) return null;

  const scheduleStart = timeToMinutes(schedule.workStart);
  const scheduleEnd = timeToMinutes(schedule.workEnd);
  if (scheduleStart === null || scheduleEnd === null || scheduleEnd <= scheduleStart) return null;

  const beforeHeight = Math.max(0, Math.min(endMinute, scheduleStart) - startMinute) * (PIXELS_PER_30_MINUTES / 30);
  const afterTop = Math.max(startMinute, Math.min(endMinute, scheduleEnd));
  const afterHeight = Math.max(0, endMinute - afterTop) * (PIXELS_PER_30_MINUTES / 30);

  return (
    <>
      {beforeHeight > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-black/25 backdrop-blur-[1px]"
          style={{ height: `${beforeHeight}px` }}
          aria-hidden="true"
        />
      )}
      {afterHeight > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 bg-black/25 backdrop-blur-[1px]"
          style={{ top: `${minuteToPixels(afterTop, startMinute)}px`, height: `${afterHeight}px` }}
          aria-hidden="true"
        />
      )}
    </>
  );
}

export default function AgendaTimeline({
  selectedDate,
  setSelectedDate,
  appointments = [],
  professionals = [],
  settings = [],
  currentUser,
  isAdmin,
  onCancel,
  onComplete,
  onConfirm,
  onSelectAppt,
  onDropAppt,
  onQuickAdd,
  workStart,
  workEnd
}) {
  const [timelineMode, setTimelineMode] = useState('dia'); // 'dia' | 'semana'
  const [selectedProfessionalId, setSelectedProfessionalId] = useState('all');
  const [activeScrollProId, setActiveScrollProId] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const gridScrollContainerRef = useRef(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleProfessionals = useMemo(
    () =>
      professionals.filter(
        professional =>
          !isPartner(professional) &&
          (isAdmin || String(professional.id) === String(currentUser?.id) || professional.is_public_agenda)
      ),
    [professionals, isAdmin, currentUser?.id]
  );

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [selectedDate]);

  const columns = useMemo(() => {
    if (timelineMode === 'dia') {
      return visibleProfessionals.map(professional => ({
        id: String(professional.id),
        kind: 'professional',
        professional
      }));
    }

    return weekDays.map(day => ({
      id: appointmentDate(day),
      kind: 'day',
      day
    }));
  }, [timelineMode, visibleProfessionals, weekDays]);

  const activeProfessionalId = isAdmin ? selectedProfessionalId : String(currentUser?.id || '');

  const columnAppointments = column =>
    appointments.filter(appointment => {
      if (column.kind === 'professional') {
        return (
          appointment.date === appointmentDate(selectedDate) &&
          String(appointment.professional_id) === column.id
        );
      }

      return (
        appointment.date === column.id &&
        (activeProfessionalId === 'all' || String(appointment.professional_id) === activeProfessionalId)
      );
    });

  const appointmentsInView = useMemo(
    () => columns.flatMap(column => columnAppointments(column)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, appointments, selectedDate, activeProfessionalId]
  );

  const bounds = useMemo(
    () => getTimelineBounds({ appointments: appointmentsInView, workStart, workEnd }),
    [appointmentsInView, workStart, workEnd]
  );

  const slots = useMemo(() => buildHalfHourSlots(bounds.start, bounds.end), [bounds]);
  const gridHeight = minuteToPixels(bounds.end, bounds.start);

  const scheduleForColumn = column => {
    const professional =
      column.kind === 'professional'
        ? column.professional
        : visibleProfessionals.find(candidate => String(candidate.id) === activeProfessionalId);
    if (!professional) return null;

    const schedule = buildEffectiveSchedule(settings, professional.id);
    return {
      workStart: professional.work_start || schedule.workStart,
      workEnd: professional.work_end || schedule.workEnd
    };
  };

  const moveDate = direction =>
    setSelectedDate(addDays(selectedDate, timelineMode === 'semana' ? direction * 7 : direction));

  const selectedDayIsToday = isSameDay(selectedDate, now);

  const scrollToProfessional = profId => {
    setActiveScrollProId(profId);
    const element = document.getElementById(`agenda-col-${profId}`);
    if (element && gridScrollContainerRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  };

  return (
    <section
      className="glass-panel mb-0 flex h-[calc(100dvh-8.5rem)] min-h-[38rem] flex-col overflow-hidden border-border/50 bg-background/80 p-0 shadow-2xl md:mb-20 md:h-auto md:min-h-[75vh]"
      aria-label="Agenda"
    >
      {/* Top Controls Bar */}
      <div className="relative z-30 flex shrink-0 flex-col gap-3 border-b border-border/50 bg-card/60 p-3 backdrop-blur-xl md:flex-row md:items-center md:justify-between md:p-5">
        {/* Mode Toggle: Profissionais vs Semana */}
        <div className="grid grid-cols-2 rounded-2xl border border-border/60 bg-background/60 p-1">
          <button
            type="button"
            onClick={() => setTimelineMode('dia')}
            className={`rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-wider transition-all md:px-6 md:text-xs ${
              timelineMode === 'dia'
                ? 'bg-primary text-white shadow-lg glow-primary'
                : 'text-muted hover:text-foreground'
            }`}
          >
            Profissionais
          </button>
          <button
            type="button"
            onClick={() => setTimelineMode('semana')}
            className={`rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-wider transition-all md:px-6 md:text-xs ${
              timelineMode === 'semana'
                ? 'bg-primary text-white shadow-lg glow-primary'
                : 'text-muted hover:text-foreground'
            }`}
          >
            Semana
          </button>
        </div>

        {/* Date Stepper Controls */}
        <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 md:flex md:w-auto">
          <button
            type="button"
            onClick={() => moveDate(-1)}
            className="flex h-11 items-center justify-center rounded-xl border border-border/60 bg-card text-muted hover:text-primary transition-colors shadow-sm"
            title="Anterior"
            aria-label="Período anterior"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(startOfToday())}
            className="h-11 min-w-0 rounded-xl border border-primary/20 bg-primary/10 px-4 text-primary shadow-sm hover:bg-primary/20 transition-colors"
            title="Voltar para hoje"
          >
            <span className="block truncate text-xs font-black uppercase tracking-wider">
              {format(selectedDate, "EEE, dd 'de' MMMM", { locale: ptBR })}
            </span>
            <span className="block text-[9px] font-bold uppercase tracking-widest text-muted">
              {selectedDayIsToday ? 'Hoje' : 'Ir para hoje'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => moveDate(1)}
            className="flex h-11 items-center justify-center rounded-xl border border-border/60 bg-card text-muted hover:text-primary transition-colors shadow-sm"
            title="Próximo"
            aria-label="Próximo período"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Week View: Professional Filter Dropdown (Admin) */}
        {timelineMode === 'semana' && isAdmin && (
          <select
            className="input-field h-11 py-1 text-xs font-bold uppercase md:w-60"
            value={selectedProfessionalId}
            onChange={event => setSelectedProfessionalId(event.target.value)}
            aria-label="Profissional na visão semanal"
          >
            <option value="all">Toda a equipe</option>
            {visibleProfessionals.map(professional => (
              <option key={professional.id} value={professional.id}>
                {professional.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Week Day Strip (in Day Mode) */}
      {timelineMode === 'dia' && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-border/40 bg-card/30 px-3 py-2 no-scrollbar">
          {weekDays.map(day => {
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, startOfToday());
            return (
              <button
                key={appointmentDate(day)}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={`flex min-w-[68px] md:min-w-[72px] shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-[10px] font-black transition-all ${
                  isSelected
                    ? 'border-primary bg-primary text-white shadow-md glow-primary scale-105'
                    : 'border-border/50 bg-card/40 text-muted hover:text-foreground'
                }`}
              >
                <span className="opacity-70 text-[9px] uppercase">{format(day, 'EEE', { locale: ptBR })}</span>
                <span className="text-xs">{format(day, 'dd/MM')}</span>
                {isToday && !isSelected && <span className="h-1 w-1 rounded-full bg-primary mt-0.5" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile Quick-Jump Chips for Professionals */}
      {timelineMode === 'dia' && visibleProfessionals.length > 1 && (
        <div className="shrink-0 border-b border-border/40 bg-background/70 px-3 py-2.5 md:hidden">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted">Equipe de Atendimento</span>
            <span className="text-[9px] font-bold text-muted">Arraste para o lado 👉</span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {visibleProfessionals.map(professional => {
              const isTargeted = activeScrollProId === String(professional.id);
              return (
                <button
                  key={professional.id}
                  type="button"
                  onClick={() => scrollToProfessional(String(professional.id))}
                  className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-wide transition-all ${
                    isTargeted
                      ? 'border-primary bg-primary text-white shadow-md glow-primary'
                      : 'border-border/60 bg-card/70 text-muted hover:text-foreground'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-lg text-[9px] font-black ${
                      isTargeted ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {professional.avatar || professional.name?.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="max-w-[120px] truncate">{professional.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scrollable 2D Timeline Grid */}
      <div
        ref={gridScrollContainerRef}
        className="relative flex-1 overflow-auto no-scrollbar snap-x snap-mandatory md:snap-none"
      >
        <div className="flex min-w-max flex-col">
          {/* Sticky Header Row */}
          <div className="sticky top-0 z-40 flex border-b border-border/50 bg-card/95 backdrop-blur-2xl">
            {/* Top-Left Corner (Hora) Sticky in both X and Y */}
            <div className="sticky left-0 z-50 flex w-16 md:w-20 shrink-0 items-center justify-center border-r border-border/50 bg-background/95 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary">
              <Clock size={12} className="mr-1" /> Hora
            </div>

            {columns.map(column => {
              const columnItems = columnAppointments(column);
              return (
                <div
                  key={column.id}
                  id={`agenda-col-header-${column.id}`}
                  className="min-w-[calc(100vw-4.5rem)] md:min-w-[280px] md:flex-1 snap-start border-r border-border/50 bg-card/40 px-3 py-3 md:px-4 md:py-3.5"
                >
                  {column.kind === 'professional' ? (
                    <ProfessionalHeader professional={column.professional} appointments={columnItems} />
                  ) : (
                    <DayHeader day={column.day} appointments={columnItems} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Grid Body */}
          <div className="flex relative">
            {/* Sticky Time Axis Column on the Left */}
            <div className="sticky left-0 z-30 w-16 md:w-20 shrink-0 border-r border-border/50 bg-background/95">
              {slots.map(slot => (
                <div
                  key={slot.minute}
                  className="flex items-start justify-center border-b border-border/40 bg-background/90 pt-2"
                  style={{ height: `${PIXELS_PER_30_MINUTES}px` }}
                >
                  <span className="rounded-lg border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] md:text-[10px] font-black text-foreground shadow-sm">
                    {slot.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Columns (Professionals or Days) */}
            {columns.map(column => {
              const columnItems = columnAppointments(column);
              const layout = layoutOverlaps(columnItems);
              const dateForColumn = column.kind === 'professional' ? selectedDate : column.day;
              const isColToday = isSameDay(dateForColumn, now);
              const nowMinutes = now.getHours() * 60 + now.getMinutes();
              const showLive = isColToday && nowMinutes >= bounds.start && nowMinutes <= bounds.end;

              const dropTime = event => {
                event.preventDefault();
                const appointmentId = event.dataTransfer.getData('appId');
                if (appointmentId) {
                  onDropAppt?.(
                    appointmentId,
                    event.currentTarget.dataset.time,
                    column.kind === 'professional' ? column.professional : column.day,
                    timelineMode
                  );
                }
              };

              const quickAdd = event => {
                const professionalId =
                  column.kind === 'professional' ? column.professional.id : activeProfessionalId;
                if (!professionalId || professionalId === 'all') return;
                onQuickAdd?.(professionalId, appointmentDate(dateForColumn), event.currentTarget.dataset.time);
              };

              return (
                <div
                  key={column.id}
                  id={`agenda-col-${column.id}`}
                  className="relative min-w-[calc(100vw-4.5rem)] md:min-w-[280px] md:flex-1 snap-start border-r border-border/50 bg-grid-pattern"
                  style={{ height: `${gridHeight}px`, backgroundSize: `100% ${PIXELS_PER_30_MINUTES}px` }}
                >
                  {/* Schedule overlay (hours before work_start and after work_end) */}
                  <ScheduleOverlay
                    schedule={scheduleForColumn(column)}
                    startMinute={bounds.start}
                    endMinute={bounds.end}
                  />

                  {/* Empty Slot Buttons for quick booking */}
                  {slots.map(slot => (
                    <button
                      key={slot.minute}
                      type="button"
                      data-time={slot.label}
                      className="group relative z-10 block w-full border-b border-border/20 text-left transition-colors hover:bg-primary/10"
                      style={{ height: `${PIXELS_PER_30_MINUTES}px` }}
                      onClick={quickAdd}
                      onDragOver={event => event.preventDefault()}
                      onDrop={dropTime}
                      aria-label={`Agendar às ${slot.label}`}
                    >
                      <span className="pointer-events-none absolute right-2 top-2 hidden items-center gap-1 rounded-full border border-primary/30 bg-primary/20 px-2 py-0.5 text-[9px] font-black text-primary group-hover:flex shadow-sm">
                        <Plus size={10} aria-hidden="true" /> Agendar {slot.label}
                      </span>
                    </button>
                  ))}

                  {/* Live Real-time Indicator Line */}
                  {showLive && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
                      style={{ top: `${minuteToPixels(nowMinutes, bounds.start)}px` }}
                      aria-label="Ao vivo"
                    >
                      <span className="-ml-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.9)] animate-pulse" />
                      <span className="h-0.5 flex-1 bg-gradient-to-r from-red-500 via-pink-500 to-transparent" />
                      <span className="mr-2 rounded-full bg-red-500 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-white shadow-md">
                        Ao Vivo {format(now, 'HH:mm')}
                      </span>
                    </div>
                  )}

                  {/* Cards for this column */}
                  {layout.map(item => (
                    <AppointmentCard
                      key={item.appointment.id}
                      item={item}
                      startMinute={bounds.start}
                      onCancel={onCancel}
                      onComplete={onComplete}
                      onConfirm={onConfirm}
                      onSelect={onSelectAppt}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
