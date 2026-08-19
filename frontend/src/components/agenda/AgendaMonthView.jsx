import { useMemo } from 'react';
import { isSameDay, isSameMonth, startOfToday } from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR/index.js';
import { safeFormat } from '../../utils/agendaMultiview';
import { CheckCircle, Lock, Users } from 'lucide-react';
import ReminderIndicator from '../reminders/ReminderIndicator';
import {
  appointmentDate,
  calculateDayMetrics,
  getMonthMatrix,
  normalizeDate
} from '../../utils/agendaMultiview';
import { parseBlockDescription, parseBlockNote } from '../../utils/timelineLayout';

const WEEK_DAYS_HEADER = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function AgendaMonthView({
  selectedDate,
  onDayClick,
  appointments = [],
  visibleProfessionals = [],
  selectedProfessionalId = 'all',
  onSelectProfessionalId,
  isAdmin = false
}) {
  const weeks = useMemo(() => getMonthMatrix(selectedDate, 0), [selectedDate]);

  // Filtrar appointments pelo profissional selecionado
  const filteredAppointments = useMemo(() => {
    return (appointments || []).filter(app => {
      if (!app || !app.date) return false;
      if (selectedProfessionalId !== 'all') {
        return String(app.professional_id) === String(selectedProfessionalId);
      }
      return visibleProfessionals.some(p => String(p.id) === String(app.professional_id));
    });
  }, [appointments, selectedProfessionalId, visibleProfessionals]);

  // Mapa de appointments por data
  const appointmentsByDate = useMemo(() => {
    const map = new Map();
    filteredAppointments.forEach(app => {
      if (!app || !app.date) return;
      const normDate = normalizeDate(app.date);
      if (!map.has(normDate)) {
        map.set(normDate, []);
      }
      map.get(normDate).push(app);
    });
    return map;
  }, [filteredAppointments]);

  const today = startOfToday();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" id="view-mode-panel-mes" role="tabpanel">
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

      {/* Month Matrix Grid */}
      <div className="flex-1 flex flex-col min-h-0 overflow-auto no-scrollbar">
        {/* Weekday Header Row */}
        <div className="grid grid-cols-7 border-b border-border/50 bg-card/90 backdrop-blur-md sticky-ios top-0 z-20">
          {WEEK_DAYS_HEADER.map(dayName => (
            <div
              key={dayName}
              className="py-2 text-center text-[10px] md:text-xs font-black uppercase tracking-wider text-primary border-r border-border/40 last:border-r-0"
            >
              {dayName}
            </div>
          ))}
        </div>

        {/* Weeks Matrix */}
        <div className="flex-1 grid grid-rows-5 md:grid-rows-6 min-h-[480px] md:min-h-[560px]">
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="grid grid-cols-7 border-b border-border/40">
              {week.map(day => {
                const dayStr = appointmentDate(day);
                const dayAppts = appointmentsByDate.get(dayStr) || [];
                const metrics = calculateDayMetrics(dayAppts);
                const isCurrentMonthDay = isSameMonth(day, selectedDate);
                const isToday = isSameDay(day, today);
                const isSelected = isSameDay(day, selectedDate);

                return (
                  <button
                    key={dayStr}
                    type="button"
                    onClick={() => onDayClick?.(day)}
                    className={`group relative flex flex-col justify-between border-r border-border/40 p-1 md:p-2 text-left transition-all hover:bg-white/[0.04] focus:outline-none focus:ring-1 focus:ring-primary ${
                      !isCurrentMonthDay
                        ? 'opacity-25 bg-background/50'
                        : isSelected
                        ? 'bg-primary/10 border-primary/40 shadow-inner'
                        : dayAppts.length > 0
                        ? 'bg-card/40'
                        : 'bg-card/20'
                    }`}
                    title={`Clique para abrir o dia ${safeFormat(day, 'dd/MM/yyyy')}`}
                  >
                    {/* Top Row of Cell: Day Number & Status Dots */}
                    <div className="flex items-start justify-between gap-1 w-full">
                      <span
                        className={`inline-flex h-5 w-5 md:h-6 md:w-6 items-center justify-center rounded-full text-[10px] md:text-[11px] font-black ${
                          isToday
                            ? 'bg-primary text-white shadow-sm glow-primary ring-2 ring-primary/40'
                            : isSelected
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : isCurrentMonthDay
                            ? 'text-foreground'
                            : 'text-muted'
                        }`}
                      >
                        {safeFormat(day, 'd')}
                      </span>

                      {/* Status Dots */}
                      {dayAppts.length > 0 && (
                        <div className="flex items-center gap-0.5">
                          {metrics.statuses.confirmed && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]" title="Confirmado" />
                          )}
                          {metrics.statuses.completed && (
                            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_4px_rgba(192,132,252,0.8)]" title="Concluído/Pago" />
                          )}
                          {metrics.statuses.scheduled && (
                            <span className="h-1.5 w-1.5 rounded-full bg-pink-400 shadow-[0_0_4px_rgba(244,114,182,0.8)]" title="Agendado" />
                          )}
                          {metrics.statuses.blocked && (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]" title="Bloqueio" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Middle: Compact Metrics Badges */}
                    <div className="flex-1 my-1 flex flex-col justify-center gap-0.5 min-w-0">
                      {metrics.activeCount > 0 && (
                        <div className="inline-flex items-center gap-1 rounded bg-primary/20 border border-primary/30 px-1 py-0.2 text-[8px] md:text-[9.5px] font-black text-primary truncate max-w-full">
                          <span className="h-1 w-1 rounded-full bg-primary shrink-0" />
                          <span className="truncate">{metrics.activeCount} agend.</span>
                        </div>
                      )}

                      {metrics.blocksCount > 0 && (
                        <div className="inline-flex items-center gap-1 rounded bg-amber-500/20 border border-amber-500/30 px-1 py-0.2 text-[8px] md:text-[9px] font-bold text-amber-300 truncate max-w-full">
                          <Lock size={8} className="shrink-0" />
                          <span className="truncate">{metrics.blocksCount} bloq.</span>
                        </div>
                      )}

                      {/* Desktop Preview of First 1-2 Client Appointments */}
                      <div className="hidden lg:flex flex-col gap-0.5 mt-0.5">
                        {dayAppts.slice(0, 2).map(app => {
                          const isBlock = parseBlockNote(app.notes).isBlock;
                          const label = isBlock ? parseBlockDescription(app) : app.client_name;
                          return (
                            <div
                              key={app.id}
                              className={`truncate text-[8px] font-bold px-1 py-0.2 rounded flex items-center gap-0.5 ${
                                isBlock
                                  ? 'bg-amber-500/10 text-amber-200'
                                  : app.status === 'confirmado'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : app.status === 'concluído'
                                  ? 'bg-purple-500/15 text-purple-300'
                                  : 'bg-white/5 text-muted'
                              }`}
                            >
                              {!isBlock && <ReminderIndicator appointment={app} />}
                              <span className="truncate">{app.time} {label}</span>
                            </div>
                          );
                        })}
                        {dayAppts.length > 2 && (
                          <span className="text-[7.5px] text-muted font-bold px-0.5">
                            +{dayAppts.length - 2} mais
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom: Revenue Indicator (if present and > 0) */}
                    <div className="flex items-center justify-between text-[7.5px] md:text-[8.5px] font-bold pt-0.5 border-t border-white/5">
                      {metrics.revenue > 0 ? (
                        <span className="text-emerald-400 truncate">
                          R$ {metrics.revenue.toFixed(0)}
                        </span>
                      ) : (
                        <span className="text-muted/40 text-[7px] hidden sm:inline">
                          {isCurrentMonthDay && dayAppts.length === 0 ? 'Sem agend.' : ''}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
