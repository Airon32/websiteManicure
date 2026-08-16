import { Calendar, CalendarDays, CalendarRange } from 'lucide-react';
import { VIEW_MODES } from '../../utils/agendaMultiview';

export default function ViewModeSelector({
  viewMode = VIEW_MODES.DAY,
  onChangeViewMode,
  className = ''
}) {
  const modes = [
    { id: VIEW_MODES.DAY, label: 'Dia', icon: Calendar },
    { id: VIEW_MODES.WEEK, label: 'Semana', icon: CalendarDays },
    { id: VIEW_MODES.MONTH, label: 'Mês', icon: CalendarRange }
  ];

  return (
    <div
      role="tablist"
      aria-label="Modo de visualização da agenda"
      className={`inline-flex items-center p-1 rounded-xl bg-card/90 border border-border/70 backdrop-blur-md shadow-inner ${className}`}
    >
      {modes.map(mode => {
        const isActive = viewMode === mode.id;
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            id={`view-mode-tab-${mode.id}`}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`view-mode-panel-${mode.id}`}
            onClick={() => onChangeViewMode?.(mode.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-black uppercase tracking-wider transition-all select-none ${
              isActive
                ? 'bg-primary text-white shadow-md shadow-primary/30 glow-primary'
                : 'text-muted hover:text-foreground hover:bg-white/5'
            }`}
          >
            <Icon size={13} className="shrink-0" aria-hidden="true" />
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}
