import {
  DEFAULT_REMINDER_SETTINGS,
  SETTING_KEYS,
  isClientReminderEligible,
  recentAutomaticNeedsConfirm,
  settingsFromList
} from './reminders.js';

export const MOCK_STORAGE_KEY = 'mary_reminder_mock_v1';

function emptyStore() {
  return {
    settings: {},
    events: {},
    phones: {},
    seeded: false
  };
}

export function createReminderStore(memory = emptyStore()) {
  let store = {
    ...emptyStore(),
    ...memory,
    settings: { ...(memory.settings || {}) },
    events: { ...(memory.events || {}) },
    phones: { ...(memory.phones || {}) }
  };

  const persist = () => store;

  const cloneEvents = appointmentId => [...(store.events[String(appointmentId)] || [])];

  return {
    read() {
      return store;
    },
    getSettings(apiSettingsList = []) {
      const fromApi = settingsFromList(apiSettingsList);
      return {
        ...DEFAULT_REMINDER_SETTINGS,
        ...fromApi,
        ...store.settings
      };
    },
    putSetting(key, value) {
      store.settings[key] = value;
      persist();
      return store.settings[key];
    },
    getPhone(professionalId, fallback) {
      const mockPhone = store.phones[String(professionalId)];
      return mockPhone || fallback || '';
    },
    putPhone(professionalId, phone) {
      store.phones[String(professionalId)] = phone;
      persist();
      return phone;
    },
    getEvents(appointmentId) {
      return cloneEvents(appointmentId);
    },
    setEvents(appointmentId, events) {
      store.events[String(appointmentId)] = events;
      persist();
      return cloneEvents(appointmentId);
    },
    upsertEvent(appointmentId, event) {
      const id = String(appointmentId);
      const current = cloneEvents(id);
      const index = current.findIndex(item => String(item.id) === String(event.id));
      if (index >= 0) current[index] = event;
      else current.push(event);
      store.events[id] = current;
      persist();
      return event;
    },
    sendManual({ appointment, user, confirm = false, retry = false }) {
      if (!appointment) {
        return { ok: false, status: 404, error: 'Agendamento não encontrado.' };
      }
      if (!isClientReminderEligible(appointment)) {
        return { ok: false, status: 409, error: 'Este agendamento não é elegível para lembrete da cliente.' };
      }

      const appointmentId = String(appointment.id);
      const events = cloneEvents(appointmentId);

      if (retry) {
        const failed = [...events].reverse().find(event => (
          event.type === 'CLIENT_REMINDER_MANUAL' || event.type === 'CLIENT_REMINDER_AUTOMATIC'
        ) && event.status === 'failed');
        if (!failed) {
          return { ok: false, status: 409, error: 'Não há falha para tentar novamente.' };
        }
        const updated = {
          ...failed,
          status: 'sent',
          error_code: null,
          sent_at: new Date().toISOString(),
          attempt_count: Number(failed.attempt_count || 0) + 1,
          provider_message_id: `mock-${failed.id}`
        };
        this.upsertEvent(appointmentId, updated);
        return { ok: true, source: 'mock', data: updated };
      }

      const autoRecent = recentAutomaticNeedsConfirm(events);
      if (autoRecent && !confirm) {
        return {
          ok: false,
          status: 409,
          needs_confirm: true,
          sent_at: autoRecent.sent_at || autoRecent.created_at,
          error: 'Um lembrete automatico foi enviado recentemente.'
        };
      }

      const now = new Date().toISOString();
      const event = {
        id: `mock-manual-${appointmentId}-${Date.now()}`,
        appointment_id: appointment.id,
        type: 'CLIENT_REMINDER_MANUAL',
        recipient_kind: 'client',
        recipient_professional_id: null,
        slot_date: appointment.date,
        slot_time: appointment.time,
        rule_key: 'client_manual',
        status: 'sent',
        suppress_reason: null,
        attempt_count: 1,
        next_attempt_at: null,
        error_code: null,
        provider_message_id: `mock-wa-${Date.now()}`,
        created_by_staff_id: user?.id != null ? String(user.id) : null,
        created_by_staff_name: user?.name || 'Equipe',
        created_at: now,
        sent_at: now
      };
      this.upsertEvent(appointmentId, event);
      return { ok: true, source: 'mock', data: event };
    }
  };
}

export function loadBrowserStore() {
  if (typeof localStorage === 'undefined') return createReminderStore();
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : emptyStore();
    const store = createReminderStore(parsed);
    const wrapped = store;
    const originalPutSetting = wrapped.putSetting.bind(wrapped);
    const originalPutPhone = wrapped.putPhone.bind(wrapped);
    const originalUpsert = wrapped.upsertEvent.bind(wrapped);
    const originalSetEvents = wrapped.setEvents.bind(wrapped);
    const persist = () => {
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(wrapped.read()));
    };
    wrapped.putSetting = (key, value) => {
      const result = originalPutSetting(key, value);
      persist();
      return result;
    };
    wrapped.putPhone = (id, phone) => {
      const result = originalPutPhone(id, phone);
      persist();
      return result;
    };
    wrapped.upsertEvent = (id, event) => {
      const result = originalUpsert(id, event);
      persist();
      return result;
    };
    wrapped.setEvents = (id, events) => {
      const result = originalSetEvents(id, events);
      persist();
      return result;
    };
    return wrapped;
  } catch {
    return createReminderStore();
  }
}

export function buildDemoEvents(appointment, index = 0) {
  if (!appointment) return [];
  const appointmentId = appointment.id;
  const now = Date.now();
  const iso = offset => new Date(now - offset).toISOString();
  const base = {
    appointment_id: appointmentId,
    recipient_kind: 'client',
    recipient_professional_id: null,
    slot_date: appointment.date,
    slot_time: appointment.time,
    attempt_count: 1,
    next_attempt_at: null,
    created_by_staff_id: null,
    created_by_staff_name: 'Sistema'
  };

  if (!isClientReminderEligible(appointment)) {
    return [{
      ...base,
      id: `demo-suppressed-${appointmentId}`,
      type: 'CLIENT_REMINDER_AUTOMATIC',
      rule_key: 'client_auto_24h',
      status: 'suppressed',
      suppress_reason: isClientReminderEligible(appointment) ? null : 'NAO_ELEGIVEL',
      error_code: null,
      provider_message_id: null,
      created_at: iso(3600000),
      sent_at: null
    }];
  }

  const pattern = index % 5;
  if (pattern === 0) return [];
  if (pattern === 1) {
    return [{
      ...base,
      id: `demo-auto-${appointmentId}`,
      type: 'CLIENT_REMINDER_AUTOMATIC',
      rule_key: 'client_auto_24h',
      status: 'sent',
      suppress_reason: null,
      error_code: null,
      provider_message_id: `mock-auto-${appointmentId}`,
      created_at: iso(2 * 60 * 60 * 1000),
      sent_at: iso(2 * 60 * 60 * 1000)
    }];
  }
  if (pattern === 2) {
    return [{
      ...base,
      id: `demo-manual-${appointmentId}`,
      type: 'CLIENT_REMINDER_MANUAL',
      rule_key: 'client_manual',
      status: 'sent',
      suppress_reason: null,
      error_code: null,
      provider_message_id: `mock-manual-${appointmentId}`,
      created_by_staff_id: '1',
      created_by_staff_name: 'Mariana',
      created_at: iso(50 * 60 * 1000),
      sent_at: iso(50 * 60 * 1000)
    }];
  }
  if (pattern === 3) {
    return [{
      ...base,
      id: `demo-failed-${appointmentId}`,
      type: 'CLIENT_REMINDER_MANUAL',
      rule_key: 'client_manual',
      status: 'failed',
      suppress_reason: null,
      error_code: 'PROVIDER_ERROR',
      provider_message_id: null,
      created_by_staff_id: '1',
      created_by_staff_name: 'Equipe',
      attempt_count: 2,
      created_at: iso(20 * 60 * 1000),
      sent_at: null
    }];
  }
  return [{
    ...base,
    id: `demo-manual-old-${appointmentId}`,
    type: 'CLIENT_REMINDER_MANUAL',
    rule_key: 'client_manual',
    status: 'sent',
    suppress_reason: null,
    error_code: null,
    provider_message_id: `mock-old-${appointmentId}`,
    created_by_staff_id: '1',
    created_by_staff_name: 'Equipe',
    created_at: iso(8 * 60 * 60 * 1000),
    sent_at: iso(8 * 60 * 60 * 1000)
  }, {
    ...base,
    id: `demo-auto-suppressed-${appointmentId}`,
    type: 'CLIENT_REMINDER_AUTOMATIC',
    rule_key: 'client_auto_24h',
    status: 'suppressed',
    suppress_reason: 'MANUAL_NAS_6H',
    error_code: null,
    provider_message_id: null,
    created_at: iso(7 * 60 * 60 * 1000),
    sent_at: null
  }];
}

export function seedDemoEvents(store, appointments = []) {
  if (!appointments.length) return;
  const readable = store.read();
  appointments.forEach((appointment, index) => {
    if (!appointment?.id) return;
    if (store.getEvents(appointment.id).length > 0) return;
    store.setEvents(appointment.id, buildDemoEvents(appointment, index));
  });
  readable.seeded = true;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(store.read()));
  }
}

export function mergeReminderSettings(apiSettingsList, store) {
  return store.getSettings(apiSettingsList);
}

export { SETTING_KEYS };
