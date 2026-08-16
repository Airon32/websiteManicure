import { useEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay, startOfToday } from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR/index.js';
import { CheckCircle, ChevronLeft, ChevronRight, Clock, Lock, MessageCircle, Plus, Unlock } from 'lucide-react';
import {
  appointmentDate,
  formatViewTitle,
  getWeekDays,
  isCurrentPeriod,
  stepDate,
  VIEW_MODES
} from '../../utils/agendaMultiview';
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
import AgendaMonthView from './AgendaMonthView';
import AgendaWeekView from './AgendaWeekView';
import ViewModeSelector from './ViewModeSelector';

export const isPartner = professional => {
  const identity = `${professional?.name || ''} ${professional?.specialty || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return identity.includes('socio') || identity.includes('socia');
};

function formatMinutesToTimeString(minutes) {
  const total = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export const statusClasses = appointment => {
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
  const serviceLabel = isBlock ? 'Pausa / Horário Fechado' : (appointment.service_name || 'Serviço');
  const isPhoneProtected =
    !appointment.client_phone ||
    String(appointment.client_phone).includes('Telefone protegido') ||
    String(appointment.client_phone).includes('🔒');
  const cleanPhone = isPhoneProtected ? '' : (appointment.client_phone || '').replace(/\D/g, '');

  const top = minuteToPixels(start, startMinute);
  const height = Math.max(minuteToPixels(duration, 0) - 4, 30);

  const cardStyle = {
    top: `${top + 2}px`,
    height: `${height}px`,
    left: `calc(${(lane / laneCount) * 100}% + 2px)`,
    width: `calc(${100 / laneCount}% - 4px)`
  };

  const selectAppointment = event => {
    event.stopPropagation();
    onSelect?.(appointment);
  };

  return (
    <div
      className={`group absolute z-20 overflow-hidden rounded-lg border-l-4 p-1.5 md:p-2 shadow-md backdrop-blur-md transition-all hover:z-40 hover:scale-[1.01] hover:shadow-xl cursor-pointer ${statusClasses(
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
      <div className="flex h-full min-w-0 flex-col justify-between gap-0.5">
        <div className="min-w-0">
          {/* Header row of the card: Time span + Status indicator */}
          <div className="flex items-center justify-between gap-1 leading-none mb-0.5">
            <span
              className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] md:text-[9.5px] font-black tracking-tight ${
                isBlock
                  ? 'border border-amber-300/40 bg-amber-400/20 text-amber-200'
                  : 'bg-background/80 text-primary border border-primary/20'
              }`}
            >
              {isBlock && <Lock size={9} className="shrink-0" aria-hidden="true" />}
              {appointment.time}–{endTime}
            </span>

            {!isBlock && appointment.status === 'confirmado' && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-black text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 px-1 py-0.2 rounded">
                <CheckCircle size={9} className="shrink-0" />
                <span className="hidden sm:inline">Confirmado</span>
              </span>
            )}
            {!isBlock && appointment.status === 'concluído' && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-black text-purple-300 bg-purple-500/20 border border-purple-500/30 px-1 py-0.2 rounded">
                <span>✓</span>
                <span className="hidden sm:inline">Pago</span>
              </span>
            )}
            {!isBlock && appointment.status !== 'confirmado' && appointment.status !== 'concluído' && (
              <span className="text-[8.5px] font-bold text-muted truncate">
                R$ {Number(appointment.service_price || 0).toFixed(0)}
              </span>
            )}
          </div>

          {/* Client Name */}
          <p className="truncate text-[10.5px] md:text-[11.5px] font-black uppercase leading-tight text-white">
            {clientLabel}
          </p>

          {/* Service Name */}
          <p className="truncate text-[8.5px] md:text-[9.5px] font-medium leading-tight text-muted">
            {serviceLabel}
          </p>
        </div>

        {/* Footer actions when card height allows (e.g. >= 56px) */}
        {height >= 56 && (
          <div className="flex items-center justify-between gap-1 border-t border-white/10 pt-0.5 text-[8.5px] font-bold">
            <span className={isBlock ? 'text-amber-200 font-bold' : 'text-primary font-bold'}>
              {duration}m
            </span>

            <div className="flex items-center gap-0.5">
              {isBlock ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-amber-200 hover:bg-amber-400/25 border border-amber-400/30 transition-colors"
                  title="Desbloquear horário"
                  onClick={event => {
                    event.stopPropagation();
                    onCancel?.(appointment.id);
                  }}
                >
                  <Unlock size={10} aria-hidden="true" />
                  <span className="text-[8.5px] font-bold">Desbloquear</span>
                </button>
              ) : (
                <>
                  {cleanPhone && (
                    <a
                      href={`https://wa.me/55${cleanPhone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={event => event.stopPropagation()}
                      className="rounded p-0.5 text-emerald-400 hover:bg-emerald-400/20 transition-colors"
                      title="WhatsApp"
                    >
                      <MessageCircle size={11} aria-hidden="true" />
                    </a>
                  )}
                  {appointment.status === 'agendado' && onConfirm && (
                    <button
                      type="button"
                      className="rounded p-0.5 text-emerald-300 hover:bg-emerald-400/20 transition-colors"
                      title="Confirmar presença"
                      onClick={event => {
                        event.stopPropagation();
                        onConfirm(appointment.id);
                      }}
                    >
                      <CheckCircle size={11} aria-hidden="true" />
                    </button>
                  )}
                  {appointment.status !== 'concluído' && onComplete && (
                    <button
                      type="button"
                      className="rounded p-0.5 text-purple-300 hover:bg-purple-400/20 transition-colors"
                      title="Marcar como Concluído/Pago"
                      onClick={event => {
                        event.stopPropagation();
                        onComplete(appointment.id);
                      }}
                    >
                      <CheckCircle size={11} aria-hidden="true" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfessionalHeader({ professional, appointments }) {
  const revenue = appointments.reduce((total, appointment) => total + (Number(appointment.service_price) || 0), 0);
  const activeCount = appointments.filter(a => !parseBlockNote(a.notes).isBlock).length;
  const blocksCount = appointments.filter(a => parseBlockNote(a.notes).isBlock).length;

  return (
    <div className="flex min-w-0 items-center gap-1.5 md:gap-2 px-1 md:px-2 py-1.5">
      <span className="flex h-6 w-6 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary via-pink-500 to-pink-700 text-[9px] md:text-[10px] font-black text-white shadow-sm">
        {professional.avatar || professional.name?.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] md:text-xs font-black uppercase tracking-wider text-foreground">
          {professional.name}
        </p>
        <p className="truncate text-[8.5px] md:text-[9.5px] font-bold text-muted">
          <span className="text-primary font-black">{activeCount} agend.</span>
          {blocksCount > 0 && <span className="text-amber-400/90 ml-1">({blocksCount} bloq.)</span>}
          {revenue > 0 && <span className="text-emerald-400 ml-1 hidden sm:inline">· R$ {revenue.toFixed(0)}</span>}
        </p>
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
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-black/30 backdrop-blur-[1px]"
          style={{ height: `${beforeHeight}px` }}
          aria-hidden="true"
        />
      )}
      {afterHeight > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 bg-black/30 backdrop-blur-[1px]"
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
  const [viewMode, setViewMode] = useState(VIEW_MODES.DAY);
  const [selectedProfessionalFilter, setSelectedProfessionalFilter] = useState('all');
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

  const weekDays = useMemo(() => getWeekDays(selectedDate, 0), [selectedDate]);

  const columnAppointments = professionalId =>
    appointments.filter(
      appointment =>
        appointment.date === appointmentDate(selectedDate) &&
        String(appointment.professional_id) === String(professionalId)
    );

  const appointmentsInView = useMemo(
    () =>
      appointments.filter(
        appointment =>
          appointment.date === appointmentDate(selectedDate) &&
          visibleProfessionals.some(p => String(p.id) === String(appointment.professional_id))
      ),
    [appointments, selectedDate, visibleProfessionals]
  );

  const bounds = useMemo(
    () => getTimelineBounds({ appointments: appointmentsInView, workStart, workEnd }),
    [appointmentsInView, workStart, workEnd]
  );

  const slots = useMemo(() => buildHalfHourSlots(bounds.start, bounds.end), [bounds]);
  const gridHeight = minuteToPixels(bounds.end, bounds.start);

  const scheduleForProfessional = professional => {
    if (!professional) return null;
    const schedule = buildEffectiveSchedule(settings, professional.id);
    return {
      workStart: professional.work_start || schedule.workStart,
      workEnd: professional.work_end || schedule.workEnd
    };
  };

  const moveDate = direction => {
    setSelectedDate(stepDate(selectedDate, direction, viewMode));
  };

  const isCurrent = isCurrentPeriod(selectedDate, viewMode, now);

  // Determinar estrutura de grid para o Modo DIA
  // 1 profissional (Agenda Pessoal): 100% da largura útil
  // 2 profissionais: grid-cols-2
  // > 2 profissionais: min-w-max com scroll horizontal
  const isSingleProfessional = visibleProfessionals.length === 1;
  const isTwoProfessionals = visibleProfessionals.length === 2;

  const headerGridClass = isSingleProfessional
    ? 'w-full flex-1 flex flex-col'
    : isTwoProfessionals
    ? 'grid grid-cols-2 flex-1'
    : 'flex min-w-max md:grid md:grid-flow-col md:auto-cols-fr flex-1';

  const bodyGridClass = isSingleProfessional
    ? 'w-full flex-1 flex flex-col'
    : isTwoProfessionals
    ? 'grid grid-cols-2 flex-1'
    : 'flex min-w-max md:grid md:grid-flow-col md:auto-cols-fr flex-1';

  const columnWidthClass = isSingleProfessional
    ? 'w-full flex-1'
    : isTwoProfessionals
    ? 'min-w-0'
    : 'min-w-[150px] md:min-w-0';

  return (
    <section
      className="glass-panel mb-0 flex flex-1 h-[calc(100dvh-5.5rem)] lg:h-[calc(100vh-6.5rem)] flex-col overflow-hidden border-border/50 bg-background/90 p-0 shadow-2xl"
      aria-label="Agenda"
    >
      {/* 1. Header & Navigation Control Strip */}
      <div className="relative z-30 shrink-0 border-b border-border/50 bg-card/80 backdrop-blur-xl px-2 py-1.5 md:px-4 md:py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          {/* Stepper: Date / Week / Month Navigation */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => moveDate(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card text-muted hover:text-primary transition-colors shadow-sm"
              title={`Voltar ${viewMode === VIEW_MODES.WEEK ? 'semana' : viewMode === VIEW_MODES.MONTH ? 'mês' : 'dia'}`}
              aria-label="Anterior"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <div className="px-2">
              <span className="text-xs md:text-sm font-black uppercase tracking-wider text-foreground">
                {formatViewTitle(viewMode, selectedDate)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => moveDate(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card text-muted hover:text-primary transition-colors shadow-sm"
              title={`Avançar ${viewMode === VIEW_MODES.WEEK ? 'semana' : viewMode === VIEW_MODES.MONTH ? 'mês' : 'dia'}`}
              aria-label="Próximo"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>

            {/* Quick "Hoje" Button */}
            {!isCurrent && (
              <button
                type="button"
                onClick={() => setSelectedDate(startOfToday())}
                className="h-7 ml-1 rounded-lg border border-primary/30 bg-primary/15 px-2.5 text-[10px] font-black uppercase text-primary hover:bg-primary/25 transition-colors shadow-sm"
              >
                Hoje
              </button>
            )}
          </div>

          {/* Right Controls: View Mode Selector + Total stats */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ViewModeSelector
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
            />

            {viewMode === VIEW_MODES.DAY && (
              <span className="text-[10px] font-bold text-muted hidden sm:inline">
                Total: <strong className="text-foreground">{appointmentsInView.length}</strong> agend.
              </span>
            )}
          </div>
        </div>

        {/* 7-Day Compact Weekday Strip (Exibido apenas no Modo DIA para alternância rápida de dia) */}
        {viewMode === VIEW_MODES.DAY && (
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map(day => {
              const isSelected = isSameDay(day, selectedDate);
              const isToday = isSameDay(day, startOfToday());
              return (
                <button
                  key={appointmentDate(day)}
                  type="button"
                  onClick={() => setSelectedDate(day)}
                  className={`flex flex-col items-center justify-center rounded-lg border py-1 transition-all ${
                    isSelected
                      ? 'border-primary bg-primary text-white shadow-md glow-primary'
                      : 'border-border/40 bg-card/40 text-muted hover:text-foreground hover:bg-card/70'
                  }`}
                >
                  <span className="text-[8px] md:text-[9px] uppercase font-bold opacity-80 leading-none">
                    {format(day, 'EEE', { locale: ptBR })}
                  </span>
                  <span className="text-[11px] md:text-xs font-black leading-tight mt-0.5">
                    {format(day, 'dd')}
                  </span>
                  {isToday && !isSelected && (
                    <span className="h-1 w-1 rounded-full bg-primary mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Main Content Area according to Active View Mode */}
      {viewMode === VIEW_MODES.DAY && (
        <div
          ref={gridScrollContainerRef}
          id="view-mode-panel-dia"
          role="tabpanel"
          className="relative flex-1 overflow-auto no-scrollbar flex flex-col"
        >
          <div className={`flex flex-col ${isSingleProfessional || isTwoProfessionals ? 'w-full' : 'min-w-max'}`}>
            {/* Sticky Header Row: HORA + Professionals */}
            <div className="sticky top-0 z-40 flex border-b border-border/50 bg-card/95 backdrop-blur-2xl">
              {/* Top-Left Corner (HORA): Sticky in both X and Y */}
              <div className="sticky left-0 z-50 flex w-12 md:w-16 shrink-0 items-center justify-center border-r border-border/50 bg-background/95 text-[9px] md:text-[10px] font-black uppercase tracking-wider text-primary">
                <Clock size={11} className="mr-0.5" /> HORA
              </div>

              {/* Professional Column Headers */}
              <div className={headerGridClass}>
                {visibleProfessionals.map(professional => {
                  const columnItems = columnAppointments(professional.id);
                  return (
                    <div
                      key={professional.id}
                      className={`border-r border-border/50 bg-card/50 ${columnWidthClass}`}
                    >
                      <ProfessionalHeader
                        professional={professional}
                        appointments={columnItems}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Grid Body: Time Axis + Professional Columns */}
            <div className="flex relative flex-1">
              {/* Sticky Time Axis Column on Left */}
              <div className="sticky left-0 z-30 w-12 md:w-16 shrink-0 border-r border-border/50 bg-background/95">
                {slots.map(slot => (
                  <div
                    key={slot.minute}
                    className="flex items-start justify-center border-b border-border/40 bg-background/90 pt-2"
                    style={{ height: `${PIXELS_PER_30_MINUTES}px` }}
                  >
                    <span className="text-[9.5px] md:text-[10.5px] font-bold text-muted">
                      {slot.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Professional Columns Grid */}
              <div
                className={`relative ${bodyGridClass}`}
                style={{ height: `${gridHeight}px` }}
              >
                {visibleProfessionals.map(professional => {
                  const columnItems = columnAppointments(professional.id);
                  const layout = layoutOverlaps(columnItems);
                  const isColToday = isSameDay(selectedDate, now);
                  const nowMinutes = now.getHours() * 60 + now.getMinutes();
                  const showLive = isColToday && nowMinutes >= bounds.start && nowMinutes <= bounds.end;

                  const dropTime = event => {
                    event.preventDefault();
                    const appointmentId = event.dataTransfer.getData('appId');
                    if (appointmentId) {
                      onDropAppt?.(
                        appointmentId,
                        event.currentTarget.dataset.time,
                        professional,
                        'dia'
                      );
                    }
                  };

                  const quickAdd = event => {
                    onQuickAdd?.(professional.id, appointmentDate(selectedDate), event.currentTarget.dataset.time);
                  };

                  return (
                    <div
                      key={professional.id}
                      id={`agenda-col-${professional.id}`}
                      className={`relative border-r border-border/40 bg-grid-pattern ${columnWidthClass}`}
                      style={{ height: `${gridHeight}px`, backgroundSize: `100% ${PIXELS_PER_30_MINUTES}px` }}
                    >
                      {/* Schedule overlay for non-working hours */}
                      <ScheduleOverlay
                        schedule={scheduleForProfessional(professional)}
                        startMinute={bounds.start}
                        endMinute={bounds.end}
                      />

                      {/* Empty Slot Interactive Buttons */}
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
                          aria-label={`Agendar ${slot.label} com ${professional.name}`}
                        >
                          <span className="pointer-events-none absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded border border-primary/30 bg-primary/20 px-1.5 py-0.5 text-[8.5px] font-black text-primary group-hover:flex shadow-sm">
                            <Plus size={9} aria-hidden="true" /> {slot.label}
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
                          <span className="-ml-1 h-3 w-3 shrink-0 rounded-full border-2 border-white bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)] animate-pulse" />
                          <span className="h-0.5 flex-1 bg-gradient-to-r from-red-500 via-pink-500 to-transparent" />
                          <span className="mr-1 rounded bg-red-500 px-1.5 py-0.2 text-[7.5px] font-black uppercase tracking-wider text-white shadow-md">
                            {format(now, 'HH:mm')}
                          </span>
                        </div>
                      )}

                      {/* Appointments inside this professional column */}
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
        </div>
      )}

      {/* Mode SEMANA */}
      {viewMode === VIEW_MODES.WEEK && (
        <AgendaWeekView
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          onSelectDay={day => {
            setSelectedDate(day);
            setViewMode(VIEW_MODES.DAY);
          }}
          appointments={appointments}
          visibleProfessionals={visibleProfessionals}
          selectedProfessionalId={selectedProfessionalFilter}
          onSelectProfessionalId={setSelectedProfessionalFilter}
          isAdmin={isAdmin}
          workStart={workStart}
          workEnd={workEnd}
          settings={settings}
          now={now}
          onCancel={onCancel}
          onComplete={onComplete}
          onConfirm={onConfirm}
          onSelectAppt={onSelectAppt}
          onDropAppt={onDropAppt}
          onQuickAdd={onQuickAdd}
        />
      )}

      {/* Mode MÊS */}
      {viewMode === VIEW_MODES.MONTH && (
        <AgendaMonthView
          selectedDate={selectedDate}
          onDayClick={day => {
            setSelectedDate(day);
            setViewMode(VIEW_MODES.DAY);
          }}
          appointments={appointments}
          visibleProfessionals={visibleProfessionals}
          selectedProfessionalId={selectedProfessionalFilter}
          onSelectProfessionalId={setSelectedProfessionalFilter}
          isAdmin={isAdmin}
          onQuickAdd={onQuickAdd}
        />
      )}
    </section>
  );
}
