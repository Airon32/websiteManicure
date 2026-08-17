/* eslint-disable react/prop-types */
/* eslint-disable react-refresh/only-export-components */
import { AlertTriangle, Bell, BellOff, Check, Clock, MousePointer2 } from 'lucide-react';
import { INDICATOR_LABELS } from '../../utils/reminders';
import { useClientReminderSummary } from './ReminderContext';

const SIZE = {
  sm: 12,
  md: 16
};

function IndicatorGlyph({ kind, size = 'sm' }) {
  const px = SIZE[size] || SIZE.sm;
  if (kind === 'auto') return <Check size={px} strokeWidth={2.6} aria-hidden="true" />;
  if (kind === 'manual') {
    return (
      <span className="relative inline-flex h-[1em] w-[1.15em] items-center justify-center">
        <MousePointer2 size={px - 1} className="absolute -left-0.5" strokeWidth={2.4} aria-hidden="true" />
        <Check size={px - 3} className="absolute -right-0.5 top-0" strokeWidth={2.8} aria-hidden="true" />
      </span>
    );
  }
  if (kind === 'failed') return <AlertTriangle size={px} strokeWidth={2.4} aria-hidden="true" />;
  if (kind === 'suppressed') return <BellOff size={px} strokeWidth={2.4} aria-hidden="true" />;
  return <Clock size={px} strokeWidth={2.4} aria-hidden="true" />;
}

export function reminderIndicatorClass(kind) {
  if (kind === 'auto') return 'text-emerald-300 border-emerald-400/40 bg-emerald-500/15';
  if (kind === 'manual') return 'text-primary border-primary/40 bg-primary/15';
  if (kind === 'failed') return 'text-amber-300 border-amber-400/40 bg-amber-500/15';
  if (kind === 'suppressed') return 'text-muted border-border/70 bg-background/40';
  return 'text-primary/80 border-primary/30 bg-transparent';
}

export default function ReminderIndicator({
  appointment,
  summary,
  size = 'sm',
  className = ''
}) {
  const fromContext = useClientReminderSummary(appointment);
  const resolved = summary || fromContext;
  if (!appointment || appointment.notes?.includes('BLOCK:')) return null;
  if (!resolved) return null;

  const label = `Lembrete da cliente: ${resolved.label || INDICATOR_LABELS[resolved.key] || 'Pendente'}`;
  const outlined = resolved.key === 'pending';

  return (
    <span
      className={`inline-flex items-center justify-center gap-0.5 rounded-full border min-h-[22px] min-w-[22px] px-1 ${reminderIndicatorClass(resolved.key)} ${className}`}
      title={label}
      aria-label={label}
    >
      <Bell size={size === 'md' ? 13 : 11} className={outlined ? 'opacity-80' : 'opacity-90'} aria-hidden="true" />
      <IndicatorGlyph kind={resolved.key} size={size} />
    </span>
  );
}
