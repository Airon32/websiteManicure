import { useMemo } from 'react';
import { isSameDay, startOfToday } from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR/index.js';
import { safeFormat } from '../../utils/agendaMultiview';
import { CheckCircle, Clock, Lock, MessageCircle, Plus, Unlock, Users } from 'lucide-react';
import ReminderIndicator from '../reminders/ReminderIndicator';
import {
  appointmentDate,
  calculateDayMetrics,
  getWeekDays,
  normalizeDate
} from '../../utils/agendaMultiview';
import { buildEffectiveSchedule, DEFAULT_WORK_END, DEFAULT_WORK_START, resolveWorkClock } from '../../utils/schedule';
import {
  buildHalfHourSlots,
  getTimelineBounds,
  layoutOverlaps,
  minuteToPixels,
  parseBlockDescription,
  parseBlockNote,
  PIXELS_PER_30_MINUTES,
  timeToMinutes
} from '../../utils/timelineLayout';
import { statusClasses } from './AgendaTimeline';

function formatMinutesToTimeString(minutes) {
  const total = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function WeekAppointmentCard({ item, startMinute, onCancel, onConfirm, onComplete, onSelect }) {
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
  const height = Math.max(minuteToPixels(duration, 0) - 3, 28);

  const cardStyle = {
    top: `${top + 1}px`,
    height: `${height}px`,
    left: `calc(${(lane / laneCount) * 100}% + 1.5px)`,
    width: `calc(${100 / laneCount}% - 3px)`
  };

  const selectAppointment = event => {
    event.stopPropagation();
    onSelect?.(appointment);
  };

  return (
    <div
      className={`group absolute z-20 overflow-hidden rounded-md border-l-4 p-1 shadow-md backdrop-blur-md transition-all hover:z-40 hover:scale-[1.01] hover:shadow-xl cursor-pointer ${statusClasses(
        appointment
      )}`}
      style={cardStyle}
      draggable={false}
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
          <div className="flex items-center justify-between gap-1 leading-none mb-0.5">
            <span
              className={`inline-flex items-center gap-0.5 rounded px-1 py-0.2 text-[8px] md:text-[8.5px] font-black tracking-tight ${
                isBlock
                  ? 'border border-amber-300/40 bg-amber-400/20 text-amber-200'
                  : 'bg-background/80 text-primary border border-primary/20'
              }`}
            >
              {isBlock && <Lock size={8} className="shrink-0" aria-hidden="true" />}
              {appointment.time}–{endTime}
            </span>

            {!isBlock && <ReminderIndicator appointment={appointment} />}
            {!isBlock && appointment.status === 'confirmado' && (
              <span className="inline-flex items-center gap-0.5 text-[7.5px] font-black text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 px-1 py-0.2 rounded">
                <CheckCircle size={8} className="shrink-0" />
              </span>
            )}
            {!isBlock && appointment.status === 'concluído' && (
              <span className="inline-flex items-center text-[7.5px] font-black text-purple-300 bg-purple-500/20 border border-purple-500/30 px-1 py-0.2 rounded">
                <span>✓</span>
              </span>
            )}
          </div>

          <p className="truncate text-[9.5px] md:text-[10.5px] font-black uppercase leading-tight text-white">
            {clientLabel}
          </p>

          <p className="truncate text-[8px] md:text-[8.5px] font-medium leading-tight text-muted">
            {serviceLabel}
          </p>
        </div>

        {height >= 52 && (
          <div className="flex items-center justify-between gap-1 border-t border-white/10 pt-0.5 text-[8px] font-bold">
            <span className={isBlock ? 'text-amber-200 font-bold' : 'text-primary font-bold'}>
              {duration}m
            </span>

            <div className="flex items-center gap-0.5">
              {isBlock ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.2 text-amber-200 hover:bg-amber-400/25 border border-amber-400/30 transition-colors"
                  title="Desbloquear horário"
                  onClick={event => {
                    event.stopPropagation();
                    onCancel?.(appointment.id);
                  }}
                >
                  <Unlock size={9} aria-hidden="true" />
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
                      <MessageCircle size={10} aria-hidden="true" />
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
                      <CheckCircle size={10} aria-hidden="true" />
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
                      <CheckCircle size={10} aria-hidden="true" />
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

function WeekScheduleOverlay({ schedule, startMinute, endMinute }) {
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
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-black/25"
          style={{ height: `${beforeHeight}px` }}
          aria-hidden="true"
        />
      )}
      {afterHeight > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 bg-black/25"
          style={{ top: `${minuteToPixels(afterTop, startMinute)}px`, height: `${afterHeight}px` }}
          aria-hidden="true"
        />
      )}
    </>
  );
}

export default function AgendaWeekView({
  selectedDate,
  setSelectedDate,
  onSelectDay,
  appointments = [],
  visibleProfessionals = [],
  selectedProfessionalId = 'all',
  onSelectProfessionalId,
  isAdmin = false,
  workStart = '08:00',
  workEnd = '20:00',
  settings = [],
  now = new Date(),
  onCancel,
  onComplete,
  onConfirm,
  onSelectAppt,
  onDropAppt,
  onQuickAdd
}) {
  const weekDays = useMemo(() => getWeekDays(selectedDate, 0), [selectedDate]);

  // Filtrar appointments da semana e pelo profissional selecionado
  const filteredAppointments = useMemo(() => {
    const weekDates = new Set(weekDays.map(d => appointmentDate(d)));
    return (appointments || []).filter(app => {
      if (!app || !app.date || !weekDates.has(normalizeDate(app.date))) return false;
      if (selectedProfessionalId !== 'all') {
        return String(app.professional_id) === String(selectedProfessionalId);
      }
      return visibleProfessionals.some(p => String(p.id) === String(app.professional_id));
    });
  }, [appointments, weekDays, selectedProfessionalId, visibleProfessionals]);

  const bounds = useMemo(
    () => getTimelineBounds({ appointments: filteredAppointments, workStart, workEnd }),
    [filteredAppointments, workStart, workEnd]
  );

  const slots = useMemo(() => buildHalfHourSlots(bounds.start, bounds.end), [bounds]);
  const gridHeight = minuteToPixels(bounds.end, bounds.start);

  const activeProfessional = useMemo(() => {
    if (selectedProfessionalId !== 'all') {
      return visibleProfessionals.find(p => String(p.id) === String(selectedProfessionalId));
    }
    if (visibleProfessionals.length === 1) {
      return visibleProfessionals[0];
    }
    return null;
  }, [selectedProfessionalId, visibleProfessionals]);

  const scheduleForProfessional = professional => {
    if (!professional) return null;
    const schedule = buildEffectiveSchedule(settings, professional.id);
    return {
      workStart: resolveWorkClock(professional.work_start, schedule.workStart, workStart, DEFAULT_WORK_START) || DEFAULT_WORK_START,
      workEnd: resolveWorkClock(professional.work_end, schedule.workEnd, workEnd, DEFAULT_WORK_END) || DEFAULT_WORK_END
    };
  };

  const currentSchedule = activeProfessional ? scheduleForProfessional(activeProfessional) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" id="view-mode-panel-semana" role="tabpanel">
      {/* Professional Filter Bar (Only if Admin has multiple visible professionals) */}
      {isAdmin && visibleProfessionals.length > 1 && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-2 md:px-4 py-1.5 bg-card/60 border-b border-border/40 backdrop-blur-md">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-muted flex items-center gap-1 mr-1">
              <Users size={12} /> Profissional:
            </span>
            <button
              type="button"
              onClick={() => onSelectProfessionalId?.('all')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                selectedProfessionalId === 'all'
                  ? 'bg-primary text-white shadow-sm glow-primary'
                  : 'bg-card text-muted hover:text-foreground border border-border/50'
              }`}
            >
              Todos ({visibleProfessionals.length})
            </button>
            {visibleProfessionals.map(pro => {
              const isSelected = String(selectedProfessionalId) === String(pro.id);
              return (
                <button
                  key={pro.id}
                  type="button"
                  onClick={() => onSelectProfessionalId?.(pro.id)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                    isSelected
                      ? 'bg-primary text-white shadow-sm glow-primary'
                      : 'bg-card text-muted hover:text-foreground border border-border/50'
                  }`}
                >
                  <span className="h-3.5 w-3.5 rounded-full bg-white/20 flex items-center justify-center text-[8px] font-black">
                    {pro.avatar || pro.name?.slice(0, 1)}
                  </span>
                  <span>{pro.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Week Grid Container */}
      <div className="agenda-scroll relative no-scrollbar flex flex-col">
        <div className="flex flex-col w-full min-w-0">
          {/* Sticky Header Row: Time Axis Corner + 7 Weekday Headers */}
          <div className="sticky-ios top-0 z-40 flex border-b border-border/50 bg-card min-w-0">
            {/* Sticky Time Axis Column Header (HORA) */}
            <div className="sticky-ios left-0 z-50 flex w-12 md:w-16 shrink-0 items-center justify-center border-r border-border/50 bg-background/95 text-[9px] md:text-[10px] font-black uppercase tracking-wider text-primary">
              <Clock size={11} className="mr-0.5" /> HORA
            </div>

            {/* 7 Weekday Headers */}
            <div className="flex-1 grid grid-cols-7 min-w-0">
              {weekDays.map(day => {
                const dayStr = appointmentDate(day);
                const dayAppts = filteredAppointments.filter(a => normalizeDate(a.date) === dayStr);
                const metrics = calculateDayMetrics(dayAppts);
                const isToday = isSameDay(day, startOfToday());
                const isSelected = isSameDay(day, selectedDate);

                return (
                  <button
                    key={dayStr}
                    type="button"
                    onClick={() => {
                      setSelectedDate?.(day);
                      onSelectDay?.(day);
                    }}
                    className={`flex flex-col items-center justify-center border-r border-border/50 px-1 py-1.5 transition-colors text-left group ${
                      isSelected
                        ? 'bg-primary/15 hover:bg-primary/25'
                        : isToday
                        ? 'bg-card/90 hover:bg-card'
                        : 'bg-card/50 hover:bg-card/80'
                    }`}
                    title={`Ver dia ${safeFormat(day, 'dd/MM')} em detalhe`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] md:text-[10px] font-black uppercase text-muted group-hover:text-foreground">
                        {safeFormat(day, 'EEE', { locale: ptBR })}
                      </span>
                      <span
                        className={`inline-flex h-5 w-5 md:h-6 md:w-6 items-center justify-center rounded-full text-[10px] md:text-[11px] font-black ${
                          isToday
                            ? 'bg-primary text-white shadow-sm glow-primary'
                            : isSelected
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : 'text-foreground'
                        }`}
                      >
                        {safeFormat(day, 'dd')}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 mt-0.5 text-[8px] md:text-[9px] font-bold truncate">
                      {metrics.activeCount > 0 && (
                        <span className="text-primary font-black">{metrics.activeCount} agend.</span>
                      )}
                      {metrics.blocksCount > 0 && (
                        <span className="text-amber-400">({metrics.blocksCount} bloq.)</span>
                      )}
                      {metrics.activeCount === 0 && metrics.blocksCount === 0 && (
                        <span className="text-muted/60">Livre</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid Body: Time Axis + 7 Day Columns */}
          <div className="flex relative flex-1">
            {/* Sticky Time Axis Column on Left */}
            <div className="sticky-ios left-0 z-30 w-12 md:w-16 shrink-0 border-r border-border/50 bg-background/95">
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

            {/* 7 Day Columns Grid */}
            <div
              className="flex-1 grid grid-cols-7 relative min-w-0"
              style={{ height: `${gridHeight}px` }}
            >
              {weekDays.map(day => {
                const dayStr = appointmentDate(day);
                const dayItems = filteredAppointments.filter(a => normalizeDate(a.date) === dayStr);
                const layout = layoutOverlaps(dayItems);
                const isColToday = isSameDay(day, now);
                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                const showLive = isColToday && nowMinutes >= bounds.start && nowMinutes <= bounds.end;

                const dropTime = event => {
                  event.preventDefault();
                  const appointmentId = event.dataTransfer.getData('appId');
                  if (appointmentId) {
                    const prof = activeProfessional || visibleProfessionals[0];
                    onDropAppt?.(
                      appointmentId,
                      event.currentTarget.dataset.time,
                      prof,
                      'semana',
                      dayStr
                    );
                  }
                };

                const quickAdd = event => {
                  const targetProfId = activeProfessional?.id || visibleProfessionals[0]?.id;
                  onQuickAdd?.(targetProfId, dayStr, event.currentTarget.dataset.time);
                };

                return (
                  <div
                    key={dayStr}
                    id={`agenda-week-col-${dayStr}`}
                    className="relative border-r border-border/40 bg-grid-pattern min-w-0"
                    style={{ height: `${gridHeight}px`, backgroundSize: `100% ${PIXELS_PER_30_MINUTES}px` }}
                  >
                    {/* Schedule overlay for non-working hours */}
                    {currentSchedule && (
                      <WeekScheduleOverlay
                        schedule={currentSchedule}
                        startMinute={bounds.start}
                        endMinute={bounds.end}
                      />
                    )}

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
                        aria-label={`Agendar ${slot.label} em ${safeFormat(day, 'dd/MM')}`}
                      >
                        <span className="pointer-events-none absolute right-1 top-1 hidden items-center gap-0.5 rounded border border-primary/30 bg-primary/20 px-1 py-0.2 text-[8px] font-black text-primary group-hover:flex shadow-sm">
                          <Plus size={8} aria-hidden="true" /> {slot.label}
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
                        <span className="-ml-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)] animate-pulse" />
                        <span className="h-0.5 flex-1 bg-gradient-to-r from-red-500 via-pink-500 to-transparent" />
                        <span className="mr-0.5 rounded bg-red-500 px-1 py-0.2 text-[7px] font-black uppercase text-white shadow-md">
                          {safeFormat(now, 'HH:mm')}
                        </span>
                      </div>
                    )}

                    {/* Appointments inside this day column */}
                    {layout.map(item => (
                      <WeekAppointmentCard
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
    </div>
  );
}
