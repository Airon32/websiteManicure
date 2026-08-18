/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Info,
  RotateCcw,
  Save,
  Users
} from 'lucide-react';
import {
  ALLOWED_PLACEHOLDERS,
  DEFAULT_TEMPLATES,
  LEAD_HOUR_CATALOG,
  SETTING_KEYS,
  TEMPLATE_CHAR_LIMIT,
  TEMPLATE_SETTING_KEY,
  canEnableTeamToggle,
  canonicalizeTemplateText,
  getStaffDestination,
  getVisibleLeadHourOptions,
  insertPlaceholder,
  isCanonicalOwner,
  isReminderToggleActive,
  normalizeStaffWhatsAppInput,
  renderTemplatePreview,
  validateTemplate
} from '../../utils/reminders';
import { useReminders } from './ReminderContext';

function PinkToggle({ checked, disabled, onToggle, label, id }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-11 w-14 shrink-0 rounded-full border transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        checked ? 'bg-primary border-primary' : 'bg-border/80 border-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 left-1 h-9 w-9 rounded-full bg-white shadow transition-transform duration-300 ${
          checked ? 'translate-x-3' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function StatusBadge({ active }) {
  return (
    <span
      className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider border ${
        active
          ? 'bg-primary/20 text-primary border-primary/40'
          : 'bg-muted/20 text-muted border-border/50'
      }`}
    >
      {active ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function LeadHoursSelect({ value, onChange, catalog = LEAD_HOUR_CATALOG }) {
  const visible = getVisibleLeadHourOptions(catalog);
  return (
    <div>
      <label htmlFor="reminder-lead-hours" className="block text-sm font-medium text-muted mb-2">
        Antecedência
      </label>
      <select
        id="reminder-lead-hours"
        className="input-field max-w-xs"
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      >
        {visible.map(option => (
          <option key={String(option.value)} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted mt-1">
        O envio pode ocorrer alguns minutos antes ou depois da antecedência configurada.
      </p>
    </div>
  );
}

function DestinationRow({ person, destination, onSavePhone }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const save = async () => {
    const next = draft.trim();
    const normalized = next ? normalizeStaffWhatsAppInput(next) : null;
    if (next && !normalized) {
      setSuccess('');
      setError('Informe um WhatsApp válido, por exemplo (11) 99999-9999 ou +5511999999999.');
      return;
    }
    setError('');
    setSuccess('');
    const result = await onSavePhone(person.id, normalized);
    if (!result?.ok) {
      setError(result?.error || 'Não foi possível salvar o contato.');
      return;
    }
    setDraft('');
    setEditing(false);
    setSuccess(normalized ? 'WhatsApp salvo com sucesso.' : 'WhatsApp profissional removido.');
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border/60 bg-background/40">
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{person.name}</p>
        <p className={`text-xs mt-0.5 ${destination.configured ? 'text-muted font-mono' : 'text-amber-400'}`}>
          {destination.label}
        </p>
      </div>
      {editing ? (
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <input
            type="tel"
            className="input-field text-sm min-h-[44px]"
            placeholder="+5511999999999"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            aria-label={`WhatsApp privado de ${person.name}`}
          />
          <button type="button" className="btn-primary min-h-[44px] px-4 text-[11px]" onClick={save}>
            Salvar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-outline min-h-[44px] px-4 text-[11px]"
          onClick={() => {
            setEditing(true);
            setSuccess('');
            setError('');
          }}
        >
          Configurar contato
        </button>
      )}
      {error && <p className="text-xs text-red-400 w-full">{error}</p>}
      {success && !error && <p className="text-xs text-emerald-400 w-full">{success}</p>}
    </div>
  );
}

function TemplateEditor({ type, title, settings, onSave }) {
  const key = TEMPLATE_SETTING_KEY[type];
  const textareaRef = useRef(null);
  const incoming = settings[key] || DEFAULT_TEMPLATES[type];
  const lastIncoming = useRef(incoming);
  const [draft, setDraft] = useState(incoming);
  const [savedFlash, setSavedFlash] = useState(false);
  const validation = validateTemplate(draft, type);
  const preview = renderTemplatePreview(draft);

  useEffect(() => {
    if (incoming === lastIncoming.current) return;
    lastIncoming.current = incoming;
    setDraft(incoming);
  }, [incoming]);

  const insert = name => {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? draft.length;
    const end = node?.selectionEnd ?? draft.length;
    const next = insertPlaceholder(draft, name, start, end);
    setDraft(next.text);
    requestAnimationFrame(() => {
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h4 className="text-sm font-bold text-foreground">{title}</h4>
        <span className="text-[11px] text-muted font-mono">
          {draft.length}/{TEMPLATE_CHAR_LIMIT}
        </span>
      </div>

      <p className="text-[11px] text-muted">
        Placeholders permitidos:{' '}
        {ALLOWED_PLACEHOLDERS.map(name => (
          <code key={name} className="bg-primary/10 text-primary px-1 py-0.5 rounded mr-1">
            {`{${name}}`}
          </code>
        ))}
        {' '}Aceita também {`{serviço}`}, {`{Profissional}`} e {`{horario}`}; o envio usa a forma canônica sem acento.
      </p>

      <div className="flex flex-wrap gap-2">
        {ALLOWED_PLACEHOLDERS.map(name => (
          <button
            key={name}
            type="button"
            className="min-h-[44px] px-3 rounded-xl border border-primary/30 text-primary text-[11px] font-bold uppercase tracking-wider hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => insert(name)}
          >
            Inserir variável {`{${name}}`}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        className="input-field w-full min-h-40 resize-y"
        value={draft}
        maxLength={TEMPLATE_CHAR_LIMIT}
        onChange={event => setDraft(event.target.value)}
        aria-invalid={!validation.valid}
        aria-describedby={`template-errors-${type}`}
      />

      {!validation.valid && (
        <ul id={`template-errors-${type}`} className="space-y-1">
          {validation.errors.map(error => (
            <li key={error} className="text-xs text-red-400">{error}</li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border border-primary/20 bg-background/50 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-2">Preview interno (dados fictícios)</p>
        <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-sans">{preview}</pre>
      </div>

      <p className="text-[11px] text-muted">
        Este texto é copy/preview do painel. A produção envia o template Meta. No Meta, a variável do serviço precisa ser {`{{servico}}`} (sem cedilha). Botões de Confirmar e Preciso remarcar são do sistema e não entram aqui.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          className="btn-secondary min-h-[44px]"
          onClick={() => setDraft(DEFAULT_TEMPLATES[type])}
        >
          <RotateCcw size={14} /> Restaurar padrão
        </button>
        <button
          type="button"
          className="btn-primary min-h-[44px]"
          disabled={!validation.valid}
          onClick={async () => {
            if (!validation.valid) return;
            await onSave(key, canonicalizeTemplateText(draft));
            setSavedFlash(true);
            window.setTimeout(() => setSavedFlash(false), 1600);
          }}
        >
          <Save size={14} /> Salvar
        </button>
        {savedFlash && <span className="text-xs text-emerald-400 self-center">Template salvo.</span>}
      </div>
    </div>
  );
}

export default function ReminderSettings({ professionals = [] }) {
  const reminders = useReminders();
  const [templateTab, setTemplateTab] = useState('owner');
  const [clientVariant, setClientVariant] = useState('client_pending');
  const [feedback, setFeedback] = useState('');

  const settings = reminders?.settings || {};
  const destinations = useMemo(() => reminders?.destinations || {}, [reminders]);
  const channelReady = Boolean(reminders?.channelReady);
  const owners = (professionals || []).filter(isCanonicalOwner);
  const activeTeam = (professionals || []).filter(person => String(person.status || 'ativo') === 'ativo');

  const ownerDestination = useMemo(() => {
    const owner = owners[0];
    if (!owner) return { configured: false, label: 'Destino não configurado', person: null };
    const presented = destinations[String(owner.id)] || owner;
    return { ...getStaffDestination({
      whatsapp_phone_set: presented.set ?? presented.whatsapp_phone_set,
      whatsapp_phone_masked: presented.masked ?? presented.whatsapp_phone_masked
    }), person: owner };
  }, [owners, destinations]);

  const professionalDestinations = useMemo(() => {
    return activeTeam.map(person => {
      const presented = destinations[String(person.id)] || person;
      return {
        person,
        ...getStaffDestination({
          whatsapp_phone_set: presented.set ?? presented.whatsapp_phone_set,
          whatsapp_phone_masked: presented.masked ?? presented.whatsapp_phone_masked
        })
      };
    });
  }, [activeTeam, destinations]);

  const hasProfessionalDestination = professionalDestinations.some(item => item.configured);
  const clientAuto = Boolean(settings[SETTING_KEYS.clientAuto]);
  const notifyOwner = Boolean(settings[SETTING_KEYS.notifyOwner]);
  const notifyProfessional = Boolean(settings[SETTING_KEYS.notifyProfessional]);
  const clientActive = isReminderToggleActive(clientAuto, channelReady);
  const ownerActive = isReminderToggleActive(notifyOwner, channelReady);
  const professionalActive = isReminderToggleActive(notifyProfessional, channelReady);

  if (!reminders) return null;

  const toggleOrBlock = async (key, next, allowed, blockedMessage) => {
    if (next && !allowed) {
      setFeedback(blockedMessage);
      return;
    }
    setFeedback('');
    const result = await reminders.saveSetting(key, next);
    if (!result?.ok) setFeedback(result?.error || 'Não foi possível salvar.');
  };

  return (
    <div className="fade-in-up duration-500 space-y-8">
      <header className="glass-card p-5 md:p-6 border border-primary/20">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Bell size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-xl font-serif text-foreground">Lembretes e notificações</h3>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Configure quem recebe avisos de agendamento e o lembrete automático da cliente. O envio real acontece no servidor; esta tela não dispara o cron.
            </p>
          </div>
        </div>
        {!channelReady && (
          <p className="mt-4 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            Canal WhatsApp (Meta) indisponível. Um toggle ligado não fica Ativo e nenhum envio é fingido até o canal estar pronto.
          </p>
        )}
      </header>

      {feedback && (
        <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-3" role="status">
          {feedback}
        </p>
      )}

      <section className="glass-card p-5 md:p-6 border border-primary/20">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bell size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-serif text-foreground">Cliente</h3>
            <p className="text-xs text-muted">Lembrete automático no WhatsApp, independente dos avisos da equipe.</p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-primary/20 bg-background/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-foreground font-medium">Lembrete automático para cliente</p>
              <StatusBadge active={clientActive} />
            </div>
            <p className="text-xs text-muted mt-1">
              Desligar o automático não esconde o envio manual no card ou no detalhe da agenda.
              {!channelReady && clientAuto ? ' Toggle ligado, mas o canal Meta ainda não está pronto — status Inativo.' : ''}
            </p>
          </div>
          <PinkToggle
            checked={clientAuto}
            label="Lembrete automático para cliente"
            onToggle={() => reminders.saveSetting(SETTING_KEYS.clientAuto, !clientAuto)}
          />
        </div>

        <div className="mt-5">
          <LeadHoursSelect
            value={Number(settings[SETTING_KEYS.leadHours] || 24)}
            onChange={value => reminders.saveSetting(SETTING_KEYS.leadHours, value)}
          />
        </div>
      </section>

      <section className="glass-card p-5 md:p-6 border border-primary/20">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-serif text-foreground">Equipe</h3>
            <p className="text-xs text-muted">Avisos de novo agendamento. Cada toggle é independente e exige destino válido. Se a proprietária também for a profissional, o segundo aviso só é omitido depois que o primeiro sair de verdade.</p>
          </div>
        </div>

        {owners.length === 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 text-xs">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              Nenhuma proprietária configurada (role=owner ou is_owner). Avisos da proprietária não serão enviados. O WhatsApp público do salão não é usado como destino.
            </span>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-primary/20 bg-background/50">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-foreground font-medium">Avisar proprietária</p>
                <StatusBadge active={ownerActive} />
              </div>
              <p className={`text-xs mt-1 ${ownerDestination.configured ? 'text-muted font-mono' : 'text-amber-400'}`}>
                {ownerDestination.label}
              </p>
            </div>
            <PinkToggle
              checked={notifyOwner}
              disabled={!notifyOwner && !canEnableTeamToggle(ownerDestination.configured)}
              label="Avisar proprietária"
              onToggle={() => toggleOrBlock(
                SETTING_KEYS.notifyOwner,
                !notifyOwner,
                canEnableTeamToggle(ownerDestination.configured),
                'Destino não configurado. Configure o WhatsApp privado da proprietária para ativar.'
              )}
            />
          </div>

          <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-primary/20 bg-background/50">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-foreground font-medium">Avisar profissional</p>
                <StatusBadge active={professionalActive} />
              </div>
              <p className={`text-xs mt-1 ${hasProfessionalDestination ? 'text-muted' : 'text-amber-400'}`}>
                {hasProfessionalDestination
                  ? `${professionalDestinations.filter(item => item.configured).length} destino(s) configurado(s)`
                  : 'Destino não configurado'}
              </p>
            </div>
            <PinkToggle
              checked={notifyProfessional}
              disabled={!notifyProfessional && !canEnableTeamToggle(hasProfessionalDestination)}
              label="Avisar profissional"
              onToggle={() => toggleOrBlock(
                SETTING_KEYS.notifyProfessional,
                !notifyProfessional,
                canEnableTeamToggle(hasProfessionalDestination),
                'Destino não configurado. Informe o WhatsApp privado de pelo menos um profissional.'
              )}
            />
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Contatos privados da equipe</p>
          {activeTeam.length === 0 && (
            <p className="text-xs text-muted">Nenhum profissional ativo para configurar destino.</p>
          )}
          {activeTeam.map(person => {
            const presented = destinations[String(person.id)] || {};
            const destination = getStaffDestination({
              whatsapp_phone_set: presented.set ?? presented.whatsapp_phone_set,
              whatsapp_phone_masked: presented.masked ?? presented.whatsapp_phone_masked
            });
            return (
              <DestinationRow
                key={person.id}
                person={person}
                destination={destination}
                onSavePhone={reminders.savePhone}
              />
            );
          })}
        </div>
      </section>

      <section className="glass-card p-5 md:p-6 border border-primary/20">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Info size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-serif text-foreground">Templates</h3>
            <p className="text-xs text-muted">Três textos de referência no painel. Em produção o WhatsApp usa o template aprovado na Meta; este copy não é o payload final.</p>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-5" role="tablist" aria-label="Templates de lembrete">
          {[
            { id: 'owner', label: 'Proprietária' },
            { id: 'professional', label: 'Profissional' },
            { id: 'client', label: 'Cliente' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={templateTab === tab.id}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                templateTab === tab.id
                  ? 'bg-primary text-white border-primary'
                  : 'bg-background/50 text-muted border-primary/20 hover:text-foreground'
              }`}
              onClick={() => setTemplateTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {templateTab === 'owner' && (
          <TemplateEditor key="owner" type="owner" title="Template da proprietária" settings={settings} onSave={reminders.saveSetting} />
        )}
        {templateTab === 'professional' && (
          <TemplateEditor key="professional" type="professional" title="Template do profissional" settings={settings} onSave={reminders.saveSetting} />
        )}
        {templateTab === 'client' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                className={`min-h-[44px] px-3 rounded-xl text-[11px] font-bold border ${
                  clientVariant === 'client_pending' ? 'bg-primary/20 text-primary border-primary/40' : 'border-border text-muted'
                }`}
                onClick={() => setClientVariant('client_pending')}
              >
                Cliente pendente
              </button>
              <button
                type="button"
                className={`min-h-[44px] px-3 rounded-xl text-[11px] font-bold border ${
                  clientVariant === 'client_confirmed' ? 'bg-primary/20 text-primary border-primary/40' : 'border-border text-muted'
                }`}
                onClick={() => setClientVariant('client_confirmed')}
              >
                Cliente confirmada
              </button>
            </div>
            <TemplateEditor
              key={clientVariant}
              type={clientVariant}
              title={clientVariant === 'client_pending' ? 'Template da cliente (pendente)' : 'Template da cliente (confirmada)'}
              settings={settings}
              onSave={reminders.saveSetting}
            />
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted flex items-center gap-2">
        <CheckCircle size={12} className="text-primary" />
        Alterações de toggle e template são salvas por item. O job 24h continua no backend.
      </p>
    </div>
  );
}
