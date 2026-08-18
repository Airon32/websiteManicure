export const ALLOWED_PLACEHOLDERS = [
  'cliente',
  'profissional',
  'servico',
  'data',
  'hora',
  'estabelecimento'
];

export const PLACEHOLDER_TOKEN = /\{([^\s{}]+)\}/g;
const PLACEHOLDER_ALIASES = Object.freeze({ horario: 'hora' });

export const SETTING_KEYS = {
  notifyOwner: 'reminder_notify_owner',
  notifyProfessional: 'reminder_notify_professional',
  clientAuto: 'reminder_client_auto',
  leadHours: 'reminder_lead_hours',
  templateOwner: 'reminder_template_owner',
  templateProfessional: 'reminder_template_professional',
  templateClientPending: 'reminder_template_client_pending',
  templateClientConfirmed: 'reminder_template_client_confirmed'
};

export const TEMPLATE_TYPES = {
  owner: 'owner',
  professional: 'professional',
  client_pending: 'client_pending',
  client_confirmed: 'client_confirmed'
};

export const REQUIRED_PLACEHOLDERS = {
  owner: [...ALLOWED_PLACEHOLDERS],
  professional: ALLOWED_PLACEHOLDERS.filter(name => name !== 'profissional'),
  client_pending: [...ALLOWED_PLACEHOLDERS],
  client_confirmed: [...ALLOWED_PLACEHOLDERS]
};

export const FORBIDDEN_PLACEHOLDERS = {
  owner: [],
  professional: ['profissional'],
  client_pending: [],
  client_confirmed: []
};

export const TEMPLATE_SETTING_KEY = {
  owner: SETTING_KEYS.templateOwner,
  professional: SETTING_KEYS.templateProfessional,
  client_pending: SETTING_KEYS.templateClientPending,
  client_confirmed: SETTING_KEYS.templateClientConfirmed
};

export const LEAD_HOUR_CATALOG = [
  { value: 12, label: '12 horas', enabled: false },
  { value: 24, label: '24 horas', enabled: true },
  { value: 48, label: '48 horas', enabled: false },
  { value: 'custom', label: 'Personalizado', enabled: false }
];

export const TEMPLATE_CHAR_LIMIT = 1024;

export const PREVIEW_FIXTURE = {
  cliente: 'Ana Souza',
  profissional: 'Jécia',
  servico: 'Alongamento em gel',
  data: '20/08/2026',
  hora: '14:30',
  estabelecimento: 'Mary Esmalteria'
};

export const DEFAULT_TEMPLATES = {
  owner: [
    'Novo agendamento na {estabelecimento}',
    '',
    'Cliente: {cliente}',
    'Profissional: {profissional}',
    'Serviço: {servico}',
    'Data: {data}',
    'Horário: {hora}'
  ].join('\n'),
  professional: [
    'Você tem um novo horário.',
    '',
    'Cliente: {cliente}',
    'Serviço: {servico}',
    'Data: {data}',
    'Horário: {hora}',
    'Local: {estabelecimento}'
  ].join('\n'),
  client_pending: [
    'Olá, {cliente}! Lembrete do seu horário na {estabelecimento}.',
    '',
    'Profissional: {profissional}',
    'Serviço: {servico}',
    'Data: {data}',
    'Horário: {hora}',
    '',
    'Por favor, confirme seu horario.'
  ].join('\n'),
  client_confirmed: [
    'Olá, {cliente}! Lembrete do seu horário na {estabelecimento}.',
    '',
    'Profissional: {profissional}',
    'Serviço: {servico}',
    'Data: {data}',
    'Horário: {hora}',
    '',
    'Seu horario ja esta confirmado. Se precisar alterar, avise a gente.'
  ].join('\n')
};

export const DEFAULT_REMINDER_SETTINGS = {
  [SETTING_KEYS.notifyOwner]: false,
  [SETTING_KEYS.notifyProfessional]: false,
  [SETTING_KEYS.clientAuto]: false,
  [SETTING_KEYS.leadHours]: 24,
  [SETTING_KEYS.templateOwner]: DEFAULT_TEMPLATES.owner,
  [SETTING_KEYS.templateProfessional]: DEFAULT_TEMPLATES.professional,
  [SETTING_KEYS.templateClientPending]: DEFAULT_TEMPLATES.client_pending,
  [SETTING_KEYS.templateClientConfirmed]: DEFAULT_TEMPLATES.client_confirmed
};

export const INDICATOR_LABELS = {
  pending: 'Pendente',
  auto: 'Auto',
  manual: 'Manual',
  failed: 'Falha',
  suppressed: 'Suprimido/Não aplicável'
};

export const CLIENT_REMINDER_TYPES = ['CLIENT_REMINDER_MANUAL', 'CLIENT_REMINDER_AUTOMATIC'];
export const TEAM_NOTIFICATION_TYPES = ['BOOKING_OWNER_NOTIFICATION', 'BOOKING_PROFESSIONAL_NOTIFICATION'];

const DUMMY_PHONES = new Set([
  '00000000000',
  '11111111111',
  '99999999999',
  '+5500000000000',
  '5511999999999'
]);

export function getVisibleLeadHourOptions(catalog = LEAD_HOUR_CATALOG) {
  return catalog.filter(option => option.enabled);
}

export function foldPlaceholderName(name) {
  const folded = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return PLACEHOLDER_ALIASES[folded] || folded;
}

export function canonicalizeTemplateText(text) {
  return String(text || '').replace(PLACEHOLDER_TOKEN, (match, name) => {
    const canonical = foldPlaceholderName(name);
    return ALLOWED_PLACEHOLDERS.includes(canonical) ? `{${canonical}}` : match;
  });
}

export function extractPlaceholders(text) {
  const found = new Set();
  const pattern = /\{([^\s{}]+)\}/g;
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    found.add(foldPlaceholderName(match[1]));
  }
  return [...found];
}

export function validateTemplate(text, type) {
  const errors = [];
  const draft = String(text ?? '');
  if (!draft.trim()) {
    errors.push('O texto do template não pode ficar vazio.');
  }
  if (draft.length > TEMPLATE_CHAR_LIMIT) {
    errors.push(`O template ultrapassa ${TEMPLATE_CHAR_LIMIT} caracteres.`);
  }

  const used = extractPlaceholders(draft);
  const required = REQUIRED_PLACEHOLDERS[type] || [];
  const forbidden = FORBIDDEN_PLACEHOLDERS[type] || [];
  const allowed = new Set(ALLOWED_PLACEHOLDERS);

  for (const token of used) {
    if (!allowed.has(token)) {
      errors.push(`Placeholder não permitido: {${token}}. Use somente {${ALLOWED_PLACEHOLDERS.join('}, {')}}.`);
    }
    if (forbidden.includes(token)) {
      errors.push(`O template do profissional não usa {${token}}.`);
    }
  }

  for (const token of required) {
    if (!used.includes(token)) {
      errors.push(`Falta o placeholder obrigatório {${token}}.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    used
  };
}

export function renderTemplatePreview(text, fixture = PREVIEW_FIXTURE) {
  return String(text || '').replace(PLACEHOLDER_TOKEN, (match, name) => {
    const key = foldPlaceholderName(name);
    if (Object.prototype.hasOwnProperty.call(fixture, key)) return String(fixture[key]);
    return match;
  });
}

export function insertPlaceholder(text, placeholder, selectionStart = 0, selectionEnd = 0) {
  const token = `{${placeholder}}`;
  const source = String(text || '');
  const start = Math.max(0, Number(selectionStart) || 0);
  const end = Math.max(start, Number(selectionEnd) || 0);
  const next = `${source.slice(0, start)}${token}${source.slice(end)}`;
  const caret = start + token.length;
  return { text: next, selectionStart: caret, selectionEnd: caret };
}

export function isE164Phone(value) {
  return /^\+[1-9][0-9]{7,14}$/.test(String(value || '').trim());
}

export function normalizeStaffWhatsAppInput(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (isE164Phone(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  if (digits.length >= 8 && digits.length <= 15) {
    const candidate = `+${digits}`;
    return isE164Phone(candidate) ? candidate : null;
  }
  return null;
}

export function maskWhatsappPhone(value) {
  const phone = String(value || '').trim();
  if (!isE164Phone(phone)) return '';
  const last4 = phone.slice(-4);
  if (phone.startsWith('+55') && phone.length >= 12) {
    const area = phone.slice(3, 5);
    return `+55 ${area} *****-${last4}`;
  }
  const prefix = phone.slice(0, Math.min(3, phone.length - 4));
  return `${prefix} *****-${last4}`;
}

export function isCanonicalOwner(person) {
  if (!person) return false;
  const status = String(person.status || 'ativo').toLowerCase();
  if (status && status !== 'ativo') return false;
  return person.role === 'owner' || person.is_owner === true || person.is_owner === 'true';
}

export function isDummyClientPhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return true;
  if (raw.includes('Telefone protegido') || raw.includes('🔒')) return false;
  const digits = raw.replace(/\D/g, '');
  if (DUMMY_PHONES.has(raw) || DUMMY_PHONES.has(digits)) return true;
  return /^(0+|1+|9+)$/.test(digits);
}

export function isBlockAppointment(appointment) {
  return String(appointment?.notes || '').includes('BLOCK:');
}

export function isClientReminderEligible(appointment) {
  if (!appointment || isBlockAppointment(appointment)) return false;
  const status = String(appointment.status || '');
  if (['cancelado', 'concluído', 'remarcacao_solicitada'].includes(status)) return false;
  if (isDummyClientPhone(appointment.client_phone)) return false;
  return status === 'agendado' || status === 'confirmado';
}

export function parseBooleanSetting(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'on') return true;
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === '') return fallback;
  return fallback;
}

export function settingsFromList(list = []) {
  const map = { ...DEFAULT_REMINDER_SETTINGS };
  for (const item of list) {
    if (!item?.key || !(item.key in DEFAULT_REMINDER_SETTINGS)) continue;
    if (item.key === SETTING_KEYS.leadHours) {
      const hours = Number(item.value);
      map[item.key] = Number.isFinite(hours) && hours > 0 ? hours : 24;
      continue;
    }
    if (
      item.key === SETTING_KEYS.notifyOwner ||
      item.key === SETTING_KEYS.notifyProfessional ||
      item.key === SETTING_KEYS.clientAuto
    ) {
      map[item.key] = parseBooleanSetting(item.value, false);
      continue;
    }
    map[item.key] = item.value == null || item.value === '' ? DEFAULT_REMINDER_SETTINGS[item.key] : String(item.value);
  }
  return map;
}

export function getStaffDestination(person = {}) {
  if (person.whatsapp_phone_set && person.whatsapp_phone_masked) {
    return {
      configured: true,
      masked: String(person.whatsapp_phone_masked),
      label: String(person.whatsapp_phone_masked)
    };
  }
  return {
    configured: false,
    masked: '',
    label: 'Destino não configurado'
  };
}

export function getDestinationState(phone) {
  if (!isE164Phone(phone)) {
    return {
      configured: false,
      masked: '',
      label: 'Destino não configurado'
    };
  }
  return {
    configured: true,
    masked: maskWhatsappPhone(phone),
    label: maskWhatsappPhone(phone)
  };
}

export function isReminderToggleActive(enabled, channelReady) {
  return Boolean(enabled) && Boolean(channelReady);
}

export function stripRawWhatsappPhone(person) {
  if (!person || typeof person !== 'object') return person;
  const rest = { ...person };
  delete rest.whatsapp_phone;
  return rest;
}

export function interpretManualSendFailure(error) {
  const status = error?.response?.status;
  const payload = error?.response?.data || {};
  if (payload.needs_confirm === true || (status === 409 && payload.needs_confirm !== false && /6 horas|automatico|automático/i.test(String(payload.error || '')))) {
    return {
      ok: false,
      needs_confirm: true,
      status: 409,
      error: payload.error || 'Um lembrete automatico foi enviado recentemente.',
      sent_at: payload.sent_at || null
    };
  }
  if (status === 503) {
    return {
      ok: false,
      status: 503,
      error: payload.error || 'Canal de WhatsApp indisponível. O envio não foi fingido.'
    };
  }
  return {
    ok: false,
    status: status || 0,
    error: payload.error || error?.message || 'Não foi possível enviar o lembrete.'
  };
}

export function canEnableTeamToggle(destinationConfigured) {
  return Boolean(destinationConfigured);
}

export function formatLocalTimestamp(iso, timeZone = 'America/Sao_Paulo') {
  if (!iso) return 'Sem envio registrado';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Sem envio registrado';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

export function hoursAgoLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const hours = Math.max(0, diffMs / (60 * 60 * 1000));
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} min`;
  }
  const rounded = hours < 10 ? hours.toFixed(1).replace('.', ',') : String(Math.round(hours));
  return `${rounded}h`;
}

function sortEventsDesc(events = []) {
  return [...events].sort((a, b) => {
    const aTime = new Date(a.sent_at || a.created_at || 0).getTime();
    const bTime = new Date(b.sent_at || b.created_at || 0).getTime();
    return bTime - aTime;
  });
}

export function partitionEvents(events = []) {
  const list = Array.isArray(events) ? events : [];
  return {
    client: sortEventsDesc(list.filter(event => CLIENT_REMINDER_TYPES.includes(event.type))),
    team: sortEventsDesc(list.filter(event => TEAM_NOTIFICATION_TYPES.includes(event.type)))
  };
}

export function reminderTypeLabel(type) {
  if (type === 'CLIENT_REMINDER_MANUAL') return 'Manual';
  if (type === 'CLIENT_REMINDER_AUTOMATIC') return 'Automático';
  if (type === 'BOOKING_OWNER_NOTIFICATION') return 'Aviso da proprietária';
  if (type === 'BOOKING_PROFESSIONAL_NOTIFICATION') return 'Aviso do profissional';
  return type || '—';
}

export function reminderResultLabel(status) {
  if (status === 'sent') return 'Enviado';
  if (status === 'failed') return 'Falha';
  if (status === 'suppressed') return 'Suprimido';
  if (status === 'queued') return 'Na fila';
  return 'Sem envio registrado';
}

export function resolveClientIndicator(appointment, events = []) {
  if (!appointment) {
    return {
      key: 'suppressed',
      label: INDICATOR_LABELS.suppressed,
      hasHistory: false
    };
  }

  const { client } = partitionEvents(events);
  const latest = client[0] || null;
  const hasHistory = Boolean(latest);

  if (!isClientReminderEligible(appointment)) {
    return {
      key: 'suppressed',
      label: INDICATOR_LABELS.suppressed,
      hasHistory,
      latest
    };
  }

  if (!latest) {
    return {
      key: 'pending',
      label: INDICATOR_LABELS.pending,
      hasHistory: false,
      latest: null
    };
  }

  const sent = client.find(event => event.status === 'sent');
  if (sent?.type === 'CLIENT_REMINDER_MANUAL') {
    return { key: 'manual', label: INDICATOR_LABELS.manual, hasHistory: true, latest: sent };
  }
  if (sent?.type === 'CLIENT_REMINDER_AUTOMATIC') {
    return { key: 'auto', label: INDICATOR_LABELS.auto, hasHistory: true, latest: sent };
  }

  const failed = client.find(event => event.status === 'failed');
  if (failed) {
    return { key: 'failed', label: INDICATOR_LABELS.failed, hasHistory: true, latest: failed };
  }

  const queued = client.find(event => event.status === 'queued');
  if (queued) {
    return { key: 'pending', label: INDICATOR_LABELS.pending, hasHistory: true, latest: queued };
  }

  const suppressed = client.find(event => event.status === 'suppressed');
  if (suppressed) {
    return { key: 'suppressed', label: INDICATOR_LABELS.suppressed, hasHistory: true, latest: suppressed };
  }

  return { key: 'pending', label: INDICATOR_LABELS.pending, hasHistory: true, latest };
}

export function buildClientDetail(appointment, events = [], settings = DEFAULT_REMINDER_SETTINGS) {
  const indicator = resolveClientIndicator(appointment, events);
  const latest = indicator.latest;
  const leadHours = Number(settings[SETTING_KEYS.leadHours] || 24);

  if (!latest) {
    return {
      indicator,
      statusLabel: indicator.label,
      lastSentLabel: 'Sem envio registrado',
      typeLabel: '—',
      resultLabel: 'Sem envio registrado',
      leadHoursLabel: `${leadHours}h`,
      authorLabel: '—',
      reasonLabel: '',
      canSend: isClientReminderEligible(appointment),
      canRetry: false,
      showHistory: false
    };
  }

  return {
    indicator,
    statusLabel: indicator.label,
    lastSentLabel: formatLocalTimestamp(latest.sent_at || (latest.status === 'sent' ? latest.created_at : null)),
    typeLabel: reminderTypeLabel(latest.type),
    resultLabel: reminderResultLabel(latest.status),
    leadHoursLabel: `${leadHours}h`,
    authorLabel: latest.created_by_staff_name || latest.created_by_staff_id || 'Sistema',
    reasonLabel: latest.suppress_reason || latest.error_code || '',
    canSend: isClientReminderEligible(appointment),
    canRetry: latest.status === 'failed',
    showHistory: partitionEvents(events).client.length > 1
  };
}

export function recentAutomaticNeedsConfirm(events = [], windowMs = 6 * 60 * 60 * 1000) {
  const { client } = partitionEvents(events);
  const latestAuto = client.find(event => event.type === 'CLIENT_REMINDER_AUTOMATIC' && event.status === 'sent');
  if (!latestAuto) return null;
  const sentAt = new Date(latestAuto.sent_at || latestAuto.created_at).getTime();
  if (!Number.isFinite(sentAt)) return null;
  if (Date.now() - sentAt >= windowMs) return null;
  return latestAuto;
}
