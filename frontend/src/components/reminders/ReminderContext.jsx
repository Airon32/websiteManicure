/* eslint-disable react/prop-types */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import {
  SETTING_KEYS,
  buildClientDetail,
  hoursAgoLabel,
  isCanonicalOwner,
  resolveClientIndicator
} from '../../utils/reminders';
import {
  buildDemoEvents,
  loadBrowserStore,
  seedDemoEvents
} from '../../utils/reminderMock';

const ReminderContext = createContext(null);

function settingValueFromApi(list, key) {
  const found = (list || []).find(item => item.key === key);
  return found ? found.value : undefined;
}

export function ReminderProvider({
  appointments = [],
  professionals = [],
  settingsData = [],
  user,
  children
}) {
  const store = useMemo(() => loadBrowserStore(), []);
  const [settings, setSettings] = useState(() => store.getSettings(settingsData));
  const [eventsById, setEventsById] = useState({});
  const [phonesById, setPhonesById] = useState({});
  const [source, setSource] = useState('mock');

  useEffect(() => {
    setSettings(store.getSettings(settingsData));
  }, [settingsData, store]);

  useEffect(() => {
    seedDemoEvents(store, appointments);
    const nextEvents = {};
    appointments.forEach((appointment, index) => {
      if (!appointment?.id) return;
      const id = String(appointment.id);
      const existing = store.getEvents(id);
      if (existing.length) {
        nextEvents[id] = existing;
        return;
      }
      const demo = buildDemoEvents(appointment, index);
      store.setEvents(id, demo);
      nextEvents[id] = demo;
    });
    setEventsById(nextEvents);
  }, [appointments, store]);

  useEffect(() => {
    const next = {};
    for (const person of professionals) {
      if (!person) continue;
      const id = String(person.id);
      next[id] = store.getPhone(id, person.whatsapp_phone);
    }
    setPhonesById(next);
  }, [professionals, store]);

  const getEvents = useCallback(appointmentId => {
    const id = String(appointmentId);
    return eventsById[id] || store.getEvents(id) || [];
  }, [eventsById, store]);

  const refreshEvents = useCallback(async appointment => {
    if (!appointment?.id) return [];
    const id = String(appointment.id);
    try {
      const response = await api.get(`/api/appointments/${id}/message-events`);
      const data = response.data?.data || response.data || [];
      if (Array.isArray(data)) {
        store.setEvents(id, data);
        setEventsById(prev => ({ ...prev, [id]: data }));
        setSource('api');
        return data;
      }
    } catch {
      const fallback = store.getEvents(id);
      setEventsById(prev => ({ ...prev, [id]: fallback }));
      setSource('mock');
      return fallback;
    }
    return store.getEvents(id);
  }, [store]);

  const getClientSummary = useCallback(appointment => {
    return resolveClientIndicator(appointment, getEvents(appointment?.id));
  }, [getEvents]);

  const getClientDetail = useCallback(appointment => {
    return buildClientDetail(appointment, getEvents(appointment?.id), settings);
  }, [getEvents, settings]);

  const saveSetting = useCallback(async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    store.putSetting(key, value);
    try {
      await api.put('/api/settings', { key, value: String(value) });
      setSource('api');
      return { ok: true, source: 'api' };
    } catch {
      setSource('mock');
      return { ok: true, source: 'mock' };
    }
  }, [store]);

  const savePhone = useCallback(async (professionalId, phone) => {
    const id = String(professionalId);
    store.putPhone(id, phone);
    setPhonesById(prev => ({ ...prev, [id]: phone }));
    try {
      await api.put(`/api/professionals/${id}`, { whatsapp_phone: phone || null });
      setSource('api');
      return { ok: true, source: 'api' };
    } catch {
      setSource('mock');
      return { ok: true, source: 'mock' };
    }
  }, [store]);

  const sendManualReminder = useCallback(async (appointment, { confirm = false, retry = false } = {}) => {
    try {
      const response = await api.post(`/api/appointments/${appointment.id}/reminders`, { confirm, retry });
      const payload = response.data || {};
      if (payload.needs_confirm) {
        return {
          ok: false,
          needs_confirm: true,
          sent_at: payload.sent_at,
          hoursLabel: hoursAgoLabel(payload.sent_at)
        };
      }
      if (payload.data) {
        store.upsertEvent(appointment.id, payload.data);
        setEventsById(prev => ({
          ...prev,
          [String(appointment.id)]: store.getEvents(appointment.id)
        }));
      } else {
        await refreshEvents(appointment);
      }
      setSource('api');
      return { ok: true, source: 'api', data: payload.data };
    } catch (error) {
      const status = error.response?.status;
      const payload = error.response?.data || {};
      if (payload.needs_confirm || status === 409 && payload.needs_confirm !== false && /automatico|automático/i.test(String(payload.error || ''))) {
        return {
          ok: false,
          needs_confirm: true,
          sent_at: payload.sent_at,
          hoursLabel: hoursAgoLabel(payload.sent_at)
        };
      }
      if (status === 503) {
        return { ok: false, status: 503, error: payload.error || 'Canal de envio indisponível.' };
      }
      if (status && status !== 404) {
        return { ok: false, status, error: payload.error || 'Não foi possível enviar o lembrete.' };
      }
      const mockResult = store.sendManual({ appointment, user, confirm, retry });
      setEventsById(prev => ({
        ...prev,
        [String(appointment.id)]: store.getEvents(appointment.id)
      }));
      setSource('mock');
      if (mockResult.needs_confirm) {
        return {
          ...mockResult,
          hoursLabel: hoursAgoLabel(mockResult.sent_at)
        };
      }
      return mockResult;
    }
  }, [refreshEvents, store, user]);

  const owners = useMemo(
    () => (professionals || []).filter(isCanonicalOwner),
    [professionals]
  );

  const value = useMemo(() => ({
    settings,
    source,
    eventsById,
    phonesById,
    owners,
    getEvents,
    getClientSummary,
    getClientDetail,
    saveSetting,
    savePhone,
    sendManualReminder,
    refreshEvents,
    settingValueFromApi: key => settingValueFromApi(settingsData, key),
    keys: SETTING_KEYS
  }), [
    settings,
    source,
    eventsById,
    phonesById,
    owners,
    getEvents,
    getClientSummary,
    getClientDetail,
    saveSetting,
    savePhone,
    sendManualReminder,
    refreshEvents,
    settingsData
  ]);

  return (
    <ReminderContext.Provider value={value}>
      {children}
    </ReminderContext.Provider>
  );
}

export function useReminders() {
  return useContext(ReminderContext);
}

export function useClientReminderSummary(appointment) {
  const ctx = useContext(ReminderContext);
  if (!ctx || !appointment) return null;
  return ctx.getClientSummary(appointment);
}
