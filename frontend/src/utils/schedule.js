export const DEFAULT_WORK_START = '09:00';
export const DEFAULT_WORK_END = '18:00';
export const DEFAULT_SLOT_INTERVAL = '30';
export const DEFAULT_WORK_DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

export function getProfessionalSettingKey(professionalId, suffix) {
  return `professional_${professionalId}_${suffix}`;
}

export function getSettingValue(settings, key) {
  return settings.find(setting => setting.key === key)?.value;
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

  const isPublicAgenda = professionalId
    ? getSettingValue(settings, getProfessionalSettingKey(professionalId, 'is_public_agenda')) === 'true'
    : false;

  return {
    workStart,
    workEnd,
    slotInterval: String(slotInterval),
    workDays: parseWorkDays(workDaysValue),
    is_public_agenda: isPublicAgenda
  };
}

export function buildTimeSlots(workStart, workEnd, slotInterval) {
  const slots = [];
  const [startHour, startMinute] = String(workStart || DEFAULT_WORK_START).split(':').map(Number);
  const [endHour, endMinute] = String(workEnd || DEFAULT_WORK_END).split(':').map(Number);
  const interval = Number(slotInterval) || Number(DEFAULT_SLOT_INTERVAL);

  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  for (let current = startTotal; current < endTotal; current += interval) {
    const hour = Math.floor(current / 60);
    const minute = current % 60;
    slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  return slots;
}
