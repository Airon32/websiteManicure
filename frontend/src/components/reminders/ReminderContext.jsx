/* eslint-disable react/prop-types */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import {
  SETTING_KEYS,
  buildClientDetail,
  hoursAgoLabel,
  interpretManualSendFailure,
  isCanonicalOwner,
  resolveClientIndicator,
  settingsFromList,
  stripRawWhatsappPhone
} from '../../utils/reminders';
import {
  buildDemoEvents,
  loadBrowserStore
} from '../../utils/reminderMock';

const ReminderContext = createContext(null);

function staffDestinationFromPayload(payload = {}) {
  const safe = stripRawWhatsappPhone(payload);
  return {
    set: Boolean(safe.whatsapp_phone_set),
    masked: safe.whatsapp_phone_masked || '',
    role: safe.role,
    is_owner: safe.is_owner
  };
}

export function ReminderProvider({
  appointments = [],
  professionals = [],
  settingsData = [],
  channelReady = false,
  user,
  allowDemoEvents = false,
  children
}) {
  const store = useMemo(() => loadBrowserStore(), []);
  const [settings, setSettings] = useState(() => settingsFromList(settingsData));
  const [eventsById, setEventsById] = useState({});
  const [destinations, setDestinations] = useState({});
  const [source, setSource] = useState('api');

  useEffect(() => {
    setSettings(settingsFromList(settingsData));
  }, [settingsData]);

  useEffect(() => {
    if (!allowDemoEvents) return;
    const nextEvents = {};
    appointments.forEach((appointment, index) => {
      if (!appointment?.id) return;
      nextEvents[String(appointment.id)] = buildDemoEvents(appointment, index);
    });
    setEventsById(nextEvents);
  }, [allowDemoEvents, appointments]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const entries = await Promise.all((professionals || []).map(async person => {
        const id = String(person.id);
        const local = staffDestinationFromPayload(person);
        if (local.set || person.whatsapp_phone_masked) {
          return [id, local];
        }
        try {
          const response = await api.get(`/api/professionals/${id}`);
          return [id, staffDestinationFromPayload(response.data?.data || {})];
        } catch {
          return [id, local];
        }
      }));
      if (cancelled) return;
      const next = {};
      for (const [id, value] of entries) next[id] = value;
      setDestinations(next);
    };
    hydrate();
    return () => { cancelled = true; };
  }, [professionals]);

  useEffect(() => {
    if (allowDemoEvents) return;
    let cancelled = false;
    const eligible = (appointments || [])
      .filter(item => item?.id && !String(item.notes || '').includes('BLOCK:'))
      .slice(0, 40);

    Promise.allSettled(eligible.map(async appointment => {
      const id = String(appointment.id);
      const response = await api.get(`/api/appointments/${id}/message-events`);
      const data = response.data?.data || [];
      return [id, Array.isArray(data) ? data : []];
    })).then(results => {
      if (cancelled) return;
      const next = {};
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const [id, events] = result.value;
        next[id] = events;
      }
      setEventsById(prev => ({ ...prev, ...next }));
      setSource('api');
    });

    return () => { cancelled = true; };
  }, [allowDemoEvents, appointments]);

  const getEvents = useCallback(appointmentId => {
    return eventsById[String(appointmentId)] || [];
  }, [eventsById]);

  const refreshEvents = useCallback(async appointment => {
    if (!appointment?.id) return [];
    const id = String(appointment.id);
    try {
      const response = await api.get(`/api/appointments/${id}/message-events`);
      const data = Array.isArray(response.data?.data) ? response.data.data : [];
      setEventsById(prev => ({ ...prev, [id]: data }));
      setSource('api');
      return data;
    } catch (error) {
      const status = error.response?.status;
      if (allowDemoEvents && (!status || status === 404)) {
        return eventsById[id] || [];
      }
      setEventsById(prev => ({ ...prev, [id]: prev[id] || [] }));
      return [];
    }
  }, [allowDemoEvents, eventsById]);

  const getClientSummary = useCallback(appointment => {
    return resolveClientIndicator(appointment, getEvents(appointment?.id));
  }, [getEvents]);

  const getClientDetail = useCallback(appointment => {
    return buildClientDetail(appointment, getEvents(appointment?.id), settings);
  }, [getEvents, settings]);

  const saveSetting = useCallback(async (key, value) => {
    const previous = settings[key];
    setSettings(prev => ({ ...prev, [key]: value }));
    try {
      await api.put('/api/settings', { key, value: String(value) });
      setSource('api');
      return { ok: true, source: 'api' };
    } catch (error) {
      setSettings(prev => ({ ...prev, [key]: previous }));
      const status = error.response?.status;
      if (allowDemoEvents && (!status || status === 404)) {
        store.putSetting(key, value);
        setSettings(prev => ({ ...prev, [key]: value }));
        return { ok: true, source: 'mock' };
      }
      return { ok: false, error: error.response?.data?.error || 'Não foi possível salvar a configuração.' };
    }
  }, [allowDemoEvents, settings, store]);

  const savePhone = useCallback(async (professionalId, phone) => {
    const id = String(professionalId);
    try {
      const response = await api.put(`/api/professionals/${id}/whatsapp_phone`, {
        whatsapp_phone: phone ? phone : null
      });
      const presented = staffDestinationFromPayload(response.data?.data || {});
      setDestinations(prev => ({ ...prev, [id]: presented }));
      setSource('api');
      return { ok: true, source: 'api', destination: presented };
    } catch (error) {
      const status = error.response?.status;
      if (allowDemoEvents && (!status || status === 404)) {
        const presented = {
          set: Boolean(phone),
          masked: phone ? `+${String(phone).replace(/\D/g, '').slice(0, 4)}****${String(phone).slice(-4)}` : ''
        };
        setDestinations(prev => ({ ...prev, [id]: presented }));
        return { ok: true, source: 'mock', destination: presented };
      }
      return { ok: false, error: error.response?.data?.error || 'Não foi possível salvar o WhatsApp privado.' };
    }
  }, [allowDemoEvents]);

  const sendManualReminder = useCallback(async (appointment, { confirm = false, retry = false } = {}) => {
    try {
      const response = await api.post(`/api/appointments/${appointment.id}/reminders`, { confirm, retry });
      const payload = response.data || {};
      await refreshEvents(appointment);
      setSource('api');
      return { ok: true, source: 'api', data: payload.data, suppressed: payload.suppressed };
    } catch (error) {
      const interpreted = interpretManualSendFailure(error);
      if (interpreted.needs_confirm) {
        return {
          ...interpreted,
          hoursLabel: hoursAgoLabel(interpreted.sent_at)
        };
      }
      if (interpreted.status === 503) {
        return interpreted;
      }
      if (allowDemoEvents && (!interpreted.status || interpreted.status === 404)) {
        const mockResult = store.sendManual({ appointment, user, confirm, retry });
        setEventsById(prev => ({
          ...prev,
          [String(appointment.id)]: store.getEvents(appointment.id)
        }));
        if (mockResult.needs_confirm) {
          return { ...mockResult, hoursLabel: hoursAgoLabel(mockResult.sent_at) };
        }
        return mockResult;
      }
      return interpreted;
    }
  }, [allowDemoEvents, refreshEvents, store, user]);

  const owners = useMemo(
    () => (professionals || []).map(stripRawWhatsappPhone).filter(isCanonicalOwner),
    [professionals]
  );

  const value = useMemo(() => ({
    settings,
    source,
    channelReady: Boolean(channelReady),
    eventsById,
    destinations,
    owners,
    getEvents,
    getClientSummary,
    getClientDetail,
    saveSetting,
    savePhone,
    sendManualReminder,
    refreshEvents,
    keys: SETTING_KEYS
  }), [
    settings,
    source,
    channelReady,
    eventsById,
    destinations,
    owners,
    getEvents,
    getClientSummary,
    getClientDetail,
    saveSetting,
    savePhone,
    sendManualReminder,
    refreshEvents
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
