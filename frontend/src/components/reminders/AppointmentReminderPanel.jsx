/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, History, RefreshCw, Send, Users, X } from 'lucide-react';
import {
  formatLocalTimestamp,
  hoursAgoLabel,
  partitionEvents,
  reminderResultLabel,
  reminderTypeLabel
} from '../../utils/reminders';
import ReminderIndicator from './ReminderIndicator';
import { useReminders } from './ReminderContext';

function ConfirmAgainModal({ hoursLabel, onBack, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 bg-black/70" role="dialog" aria-modal="true" aria-labelledby="confirm-again-title">
      <div className="bg-card border border-primary/30 rounded-[1.75rem] w-full max-w-sm p-5 space-y-4">
        <h3 id="confirm-again-title" className="text-lg font-serif text-foreground">Enviar novamente?</h3>
        <p className="text-sm text-muted leading-relaxed">
          Um lembrete automatico foi enviado ha {hoursLabel || 'pouco tempo'}. Deseja enviar novamente?
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" className="btn-secondary min-h-[44px] flex-1" onClick={onBack}>Voltar</button>
          <button type="button" className="btn-primary min-h-[44px] flex-1" onClick={onConfirm}>Enviar mesmo assim</button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ title, events, onClose }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 bg-black/70" role="dialog" aria-modal="true">
      <div className="bg-card border border-primary/30 rounded-[1.75rem] w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <h3 className="text-base font-serif text-foreground">{title}</h3>
          <button type="button" className="min-h-[44px] min-w-[44px] text-muted hover:text-foreground" onClick={onClose} aria-label="Fechar histórico">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {events.map(event => (
            <article key={event.id} className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs space-y-1">
              <p className="font-bold text-foreground">{reminderTypeLabel(event.type)} · {reminderResultLabel(event.status)}</p>
              <p className="text-muted">{formatLocalTimestamp(event.sent_at || event.created_at)}</p>
              {event.created_by_staff_name && <p className="text-muted">Autor: {event.created_by_staff_name}</p>}
              {(event.suppress_reason || event.error_code) && (
                <p className="text-amber-300">{event.suppress_reason || event.error_code}</p>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AppointmentReminderPanel({ appointment }) {
  const reminders = useReminders();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const [historyKind, setHistoryKind] = useState(null);

  useEffect(() => {
    if (appointment?.id) reminders?.refreshEvents?.(appointment);
  }, [appointment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!appointment || appointment.notes?.includes('BLOCK:') || !reminders) return null;

  const detail = reminders.getClientDetail(appointment);
  const events = reminders.getEvents(appointment.id);
  const { client, team } = partitionEvents(events);

  const send = async ({ confirm = false, retry = false } = {}) => {
    setBusy(true);
    setMessage('');
    const result = await reminders.sendManualReminder(appointment, { confirm, retry });
    setBusy(false);
    if (result.needs_confirm) {
      setConfirmState({ hoursLabel: result.hoursLabel || hoursAgoLabel(result.sent_at) });
      return;
    }
    if (!result.ok) {
      setMessage(result.error || 'Não foi possível enviar o lembrete.');
      return;
    }
    setConfirmState(null);
    setMessage(retry ? 'Nova tentativa registrada.' : 'Lembrete enviado.');
  };

  return (
    <div className="p-3 space-y-4 border-t border-border/50">
      <section className="rounded-2xl border border-primary/20 bg-background/40 p-3 space-y-3" aria-labelledby="client-reminders-heading">
        <div className="flex items-center justify-between gap-2">
          <h3 id="client-reminders-heading" className="text-sm font-bold text-foreground flex items-center gap-2">
            <Bell size={14} className="text-primary" /> Lembretes da cliente
          </h3>
          <ReminderIndicator appointment={appointment} summary={detail.indicator} size="md" />
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-muted uppercase tracking-wider text-[10px] font-bold">Status</dt>
            <dd className="text-foreground font-semibold">{detail.statusLabel}</dd>
          </div>
          <div>
            <dt className="text-muted uppercase tracking-wider text-[10px] font-bold">Último envio (local)</dt>
            <dd className="text-foreground font-semibold">{detail.lastSentLabel}</dd>
          </div>
          <div>
            <dt className="text-muted uppercase tracking-wider text-[10px] font-bold">Tipo</dt>
            <dd className="text-foreground font-semibold">{detail.typeLabel}</dd>
          </div>
          <div>
            <dt className="text-muted uppercase tracking-wider text-[10px] font-bold">Resultado</dt>
            <dd className="text-foreground font-semibold">{detail.resultLabel}</dd>
          </div>
          <div>
            <dt className="text-muted uppercase tracking-wider text-[10px] font-bold">Antecedência</dt>
            <dd className="text-foreground font-semibold">{detail.leadHoursLabel}</dd>
          </div>
          <div>
            <dt className="text-muted uppercase tracking-wider text-[10px] font-bold">Autor</dt>
            <dd className="text-foreground font-semibold">{detail.authorLabel}</dd>
          </div>
        </dl>

        {detail.reasonLabel && (
          <p className="text-xs text-amber-300 flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            Motivo: {detail.reasonLabel}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          {detail.canSend && (
            <button
              type="button"
              className="btn-primary min-h-[44px] text-[11px]"
              disabled={busy}
              onClick={() => send()}
            >
              <Send size={14} /> Enviar lembrete
            </button>
          )}
          {detail.canRetry && (
            <button
              type="button"
              className="btn-outline min-h-[44px] text-[11px]"
              disabled={busy}
              onClick={() => send({ retry: true })}
            >
              <RefreshCw size={14} /> Tentar novamente
            </button>
          )}
          {detail.showHistory && (
            <button
              type="button"
              className="btn-secondary min-h-[44px] text-[11px]"
              onClick={() => setHistoryKind('client')}
            >
              <History size={14} /> Ver histórico
            </button>
          )}
        </div>
        {message && <p className="text-xs text-primary" role="status">{message}</p>}
      </section>

      <section className="rounded-2xl border border-border/60 bg-background/30 p-3 space-y-2" aria-labelledby="team-alerts-heading">
        <h3 id="team-alerts-heading" className="text-sm font-bold text-foreground flex items-center gap-2">
          <Users size={14} className="text-muted" /> Avisos da equipe
        </h3>
        <p className="text-[11px] text-muted">Esta seção não altera o sino da cliente.</p>
        {team.length === 0 ? (
          <p className="text-xs text-muted">Nenhum aviso de equipe registrado.</p>
        ) : (
          <ul className="space-y-2">
            {team.slice(0, 3).map(event => (
              <li key={event.id} className="text-xs text-foreground">
                {reminderTypeLabel(event.type)} · {reminderResultLabel(event.status)}
                {event.suppress_reason ? ` · ${event.suppress_reason}` : ''}
              </li>
            ))}
          </ul>
        )}
        {team.length > 1 && (
          <button type="button" className="btn-secondary min-h-[44px] text-[11px]" onClick={() => setHistoryKind('team')}>
            <History size={14} /> Ver histórico da equipe
          </button>
        )}
      </section>

      {confirmState && (
        <ConfirmAgainModal
          hoursLabel={confirmState.hoursLabel}
          onBack={() => setConfirmState(null)}
          onConfirm={() => send({ confirm: true })}
        />
      )}
      {historyKind === 'client' && (
        <HistoryModal title="Histórico da cliente" events={client} onClose={() => setHistoryKind(null)} />
      )}
      {historyKind === 'team' && (
        <HistoryModal title="Histórico da equipe" events={team} onClose={() => setHistoryKind(null)} />
      )}
    </div>
  );
}
