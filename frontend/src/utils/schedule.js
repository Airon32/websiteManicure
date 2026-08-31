export const DEFAULT_WORK_START = '09:00';
export const DEFAULT_WORK_END = '18:00';
export const DEFAULT_SLOT_INTERVAL = '30';
export const DEFAULT_WORK_DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
export const DAY_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

export function getProfessionalSettingKey(professionalId, suffix) {
  return `professional_${professionalId}_${suffix}`;
}

export function getSettingValue(settings, key) {
  return settings.find(setting => setting.key === key)?.value;
}

/** Missing setting: manicures on, sócio/sócia off until someone toggles. */
export function parseAgendaVisible(value) {
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  return null;
}

export function withAgendaVisibility(professionals = [], settings = []) {
  return (Array.isArray(professionals) ? professionals : []).map(professional => ({
    ...professional,
    agenda_visible: parseAgendaVisible(
      professional.agenda_visible ??
        getSettingValue(settings, getProfessionalSettingKey(professional.id, 'agenda_visible'))
    )
  }));
}

export function parseWorkDays(value) {
  if (!value) return [...DEFAULT_WORK_DAYS];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_WORK_DAYS];
  } catch {
    return [...DEFAULT_WORK_DAYS];
  }
}

export function normalizeClock(value) {
  if (value == null || value === '' || Number.isNaN(value)) return '';
  const match = String(value).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return '';
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
}

export function resolveWorkClock(...candidates) {
  for (const value of candidates) {
    const clock = normalizeClock(value);
    if (clock) return clock;
  }
  return '';
}

function isEditorDayOff(entry) {
  if (entry == null || entry === false || entry === '') return true;
  if (typeof entry !== 'object' || Array.isArray(entry)) return true;
  if (entry.off === true || entry.folga === true) return true;
  return !normalizeClock(entry.start) && !normalizeClock(entry.end);
}

export function toEditorDaySchedule(entry) {
  if (isEditorDayOff(entry)) {
    return { start: '', end: '', off: true };
  }
  return {
    start: normalizeClock(entry.start),
    end: normalizeClock(entry.end),
    off: false
  };
}

export function toEditorWeekSchedule(parsed = {}) {
  return Object.fromEntries(DAY_KEYS.map(day => [day, toEditorDaySchedule(parsed[day])]));
}

export function toApiWeekSchedule(editor = {}) {
  return Object.fromEntries(DAY_KEYS.map(day => {
    const entry = editor[day];
    if (isEditorDayOff(entry)) return [day, null];
    return [day, { start: normalizeClock(entry.start), end: normalizeClock(entry.end) }];
  }));
}

export function hasOpenScheduleDay(schedule = {}) {
  return DAY_KEYS.some(day => schedule[day]);
}

function dateParts(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      weekDay: value.getDay()
    };
  }

  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const localDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(localDate.getTime())) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    weekDay: localDate.getDay()
  };
}

function normalizeScheduleWindow(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const start = normalizeClock(entry.start);
  const end = normalizeClock(entry.end);
  if (!start || !end) return null;

  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  if ((endHour * 60) + endMinute <= (startHour * 60) + startMinute) return null;
  return { start, end };
}

/**
 * Resolves the exact opening window for a calendar date. Date exceptions have
 * priority, followed by the per-day week schedule and finally the legacy flat
 * hours. A null result means the professional is off on that date.
 */
export function getScheduleWindowForDate(scheduleInfo = {}, date) {
  const parts = dateParts(date);
  if (!parts) return null;

  const dateKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const exceptions = scheduleInfo?.exceptions;
  if (exceptions && Object.prototype.hasOwnProperty.call(exceptions, dateKey)) {
    return normalizeScheduleWindow(exceptions[dateKey]);
  }

  const dayKey = DAY_KEYS[parts.weekDay];
  const perDaySchedule = scheduleInfo?.schedule;
  if (perDaySchedule && Object.prototype.hasOwnProperty.call(perDaySchedule, dayKey)) {
    return normalizeScheduleWindow(perDaySchedule[dayKey]);
  }

  const rawWorkDays = scheduleInfo?.work_days ?? scheduleInfo?.workDays;
  const workDays = Array.isArray(rawWorkDays) ? rawWorkDays : parseWorkDays(rawWorkDays);
  if (!workDays.includes(dayKey)) return null;

  return normalizeScheduleWindow({
    start: scheduleInfo?.work_start ?? scheduleInfo?.workStart ?? DEFAULT_WORK_START,
    end: scheduleInfo?.work_end ?? scheduleInfo?.workEnd ?? DEFAULT_WORK_END
  });
}

export function buildEffectiveSchedule(settings, professionalId = null) {
  const workStart = professionalId
    ? getSettingValue(settings, getProfessionalSettingKey(professionalId, 'work_start')) || getSettingValue(settings, 'work_start') || DEFAULT_WORK_START
    : getSettingValue(settings, 'work_start') || DEFAULT_WORK_START;

  const workEnd = professionalId
    ? getSettingValue(settings, getProfessionalSettingKey(professionalId, 'work_end')) || getSettingValue(settings, 'work_end') || DEFAULT_WORK_END
    : getSettingValue(settings, 'work_end') || DEFAULT_WORK_END;

  const slotInterval = professionalId
    ? getSettingValue(settings, getProfessionalSettingKey(professionalId, 'slot_interval')) || getSettingValue(settings, 'slot_interval') || DEFAULT_SLOT_INTERVAL
    : getSettingValue(settings, 'slot_interval') || DEFAULT_SLOT_INTERVAL;

  const workDaysValue = professionalId
    ? getSettingValue(settings, getProfessionalSettingKey(professionalId, 'work_days')) || getSettingValue(settings, 'work_days')
    : getSettingValue(settings, 'work_days');

  const isPublicAgendaValue = professionalId
    ? getSettingValue(settings, getProfessionalSettingKey(professionalId, 'is_public_agenda')) || getSettingValue(settings, 'is_public_agenda')
    : getSettingValue(settings, 'is_public_agenda');

  const isPublicAgenda = isPublicAgendaValue === 'true' || isPublicAgendaValue === true;
  const agendaVisibleValue = professionalId
    ? getSettingValue(settings, getProfessionalSettingKey(professionalId, 'agenda_visible'))
    : getSettingValue(settings, 'agenda_visible');

  return {
    workStart,
    workEnd,
    slotInterval: String(slotInterval),
    workDays: parseWorkDays(workDaysValue),
    is_public_agenda: isPublicAgenda,
    agenda_visible: parseAgendaVisible(agendaVisibleValue)
  };
}

export function buildTimeSlots(workStart, workEnd, slotInterval, includeOutsideHours = false, existingAppointments = []) {
  const slotsSet = new Set();
  const interval = Number(slotInterval) || Number(DEFAULT_SLOT_INTERVAL);

  let startTotal, endTotal;
  if (includeOutsideHours) {
    startTotal = 6 * 60;
    endTotal = 23 * 60 + 59;
  } else {
    const [startHour, startMinute] = String(workStart || DEFAULT_WORK_START).split(':').map(Number);
    const [endHour, endMinute] = String(workEnd || DEFAULT_WORK_END).split(':').map(Number);
    startTotal = startHour * 60 + startMinute;
    endTotal = endHour * 60 + endMinute;
  }

  for (let current = startTotal; current < endTotal; current += interval) {
    const hour = Math.floor(current / 60);
    const minute = current % 60;
    slotsSet.add(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  if (Array.isArray(existingAppointments) && existingAppointments.length > 0) {
    existingAppointments.forEach(a => {
      if (a && a.time && a.status !== 'cancelado') {
        const [h, m] = String(a.time).split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          let duration = Number(a.service_duration || a.duration) || 30;
          if (a.notes?.startsWith('MULTI_SERVICES:')) {
            try {
              const marker = a.notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
              const multiData = JSON.parse(marker.replace('MULTI_SERVICES:', ''));
              duration = multiData.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
            } catch {
              // Keep the service duration fallback when legacy metadata is malformed.
            }
          } else if (a.notes?.startsWith('BLOCK:')) {
            duration = Number.parseInt(a.notes.split(':')[1], 10) || duration;
          }
          const endTotalM = h * 60 + m + duration;
          if (includeOutsideHours || (endTotalM >= startTotal && endTotalM < endTotal)) {
            const endH = Math.floor(endTotalM / 60);
            const endM = endTotalM % 60;
            if (endH < 24) {
              slotsSet.add(`${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`);
            }
          }
        }
      }
    });
  }

  return Array.from(slotsSet).sort((a, b) => a.localeCompare(b));
}
