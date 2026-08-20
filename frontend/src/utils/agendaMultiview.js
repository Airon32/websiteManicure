import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks
} from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR/index.js';
import { parseBlockNote } from './timelineLayout.js';

export const VIEW_MODES = {
  DAY: 'dia',
  WEEK: 'semana',
  MONTH: 'mes'
};

export const SALON_TIME_ZONE = 'America/Sao_Paulo';

const salonDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SALON_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const salonTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SALON_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

function readParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const map = {};
  parts.forEach(part => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function salonOffsetMs(date) {
  const wall = readParts(date, SALON_TIME_ZONE);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - date.getTime();
}

/** Interpreta YYYY-MM-DD HH:mm como horário de parede em America/Sao_Paulo. */
export function salonLocalToDate(ymd, hm = '12:00') {
  const dateMatch = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(hm || '12:00').match(/^(\d{1,2}):([0-5]\d)/);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23) return null;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = new Date(utcGuess - salonOffsetMs(new Date(utcGuess)));
  const second = new Date(utcGuess - salonOffsetMs(first));
  return isValid(second) ? second : null;
}

export function salonCalendarDate(value = new Date()) {
  if (value instanceof Date) {
    return isValid(value) ? salonDateFormatter.format(value) : '';
  }
  return normalizeDate(value);
}

export function salonClock(value = new Date()) {
  const valid = value instanceof Date && isValid(value) ? value : toValidDate(value);
  if (!valid) return '';
  try {
    return salonTimeFormatter.format(valid).replace('24:', '00:');
  } catch {
    return '';
  }
}

export const toValidDate = value => {
  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return isValid(fromNumber) ? fromNumber : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const datePart = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!datePart) return null;
    if (trimmed.includes('T') || trimmed.endsWith('Z')) {
      const instant = new Date(trimmed);
      return isValid(instant) ? instant : salonLocalToDate(datePart, '12:00');
    }
    return salonLocalToDate(datePart, '12:00');
  }
  return null;
};

export const appointmentDate = date => {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return date.trim();
  }
  const valid = toValidDate(date);
  if (!valid) return '';
  try {
    return salonDateFormatter.format(valid);
  } catch {
    return '';
  }
};

/**
 * Normaliza data para formato YYYY-MM-DD, aceitando ISO com T, Date ou apenas data.
 * Timestamps com fuso viram o dia civil em America/Sao_Paulo.
 * YYYY-MM-DD puro (data de agenda) permanece intacto — Safari trata date-only como UTC.
 */
export const normalizeDate = dateInput => {
  if (dateInput instanceof Date) return appointmentDate(dateInput);
  if (dateInput == null || dateInput === '') return '';
  const str = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (str.includes('T') || str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str)) {
    const instant = new Date(str);
    if (isValid(instant)) return salonDateFormatter.format(instant);
  }
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

/**
 * Safe format wrapper que valida Date antes de chamar date-fns
 */
export const safeFormat = (date, formatStr, options = {}) => {
  const valid = toValidDate(date);
  if (!valid) return '';
  try {
    return format(valid, formatStr, options);
  } catch {
    return '';
  }
};

export const isPartner = professional => {
  const identity = `${professional?.name || ''} ${professional?.specialty || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return identity.includes('socio') || identity.includes('socia');
};

/** Column / public booking. Explicit false hides. Sócio defaults off. */
export function isAgendaVisible(professional) {
  const value = professional?.agenda_visible;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  return !isPartner(professional);
}

/**
 * Grade da equipe (admin): o interruptor vale para todas, inclusive a conta logada.
 * Agenda pessoal: a profissional logada ainda vê a própria coluna.
 */
export function filterVisibleProfessionals(professionals = [], { isAdmin = false, currentUserId } = {}) {
  const list = Array.isArray(professionals) ? professionals : [];
  return list.filter(professional => {
    const isSelf = String(professional.id) === String(currentUserId);
    if (!isAgendaVisible(professional)) {
      return isSelf && !isAdmin;
    }
    if (isAdmin || isSelf) return true;
    return Boolean(professional.is_public_agenda);
  });
}

/**
 * Parse date string safely, normalizing ISO formats
 * Returns Date object or null if invalid
 */
export const parseDateTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const normDate = normalizeDate(dateStr);
  const timeMatch = String(timeStr).trim().match(/^(\d{1,2}):([0-5]\d)/);
  if (!normDate || !timeMatch) return null;
  const clock = `${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}`;
  return salonLocalToDate(normDate, clock);
};

/**
 * Obtém os 7 dias da semana para uma data base (iniciando em Domingo por padrão ou Segunda).
 * weekStartsOn: 0 (Domingo) ou 1 (Segunda). Na Mary Esmalteria, padrão 0 para 7 colunas completas.
 */
export function getWeekDays(baseDate, weekStartsOn = 0) {
  const safe = toValidDate(baseDate) || new Date();
  try {
    const start = startOfWeek(safe, { weekStartsOn });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  } catch {
    return [];
  }
}

/**
 * Obtém a matriz de dias para a visualização de calendário mensal (grade 7 colunas).
 * Retorna array de semanas (cada uma com 7 dias), preenchendo os dias antes e depois do mês.
 */
export function getMonthMatrix(baseDate, weekStartsOn = 0) {
  const safe = toValidDate(baseDate) || new Date();
  const monthStart = startOfMonth(safe);
  const monthEnd = endOfMonth(safe);
  const startDate = startOfWeek(monthStart, { weekStartsOn });
  const endDate = endOfWeek(monthEnd, { weekStartsOn });

  const allDays = eachDayOfInterval({ start: startDate, end: endDate });
  const weeks = [];
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7));
  }
  return weeks;
}

/**
 * Agrupa appointments por data (YYYY-MM-DD)
 */
export function groupAppointmentsByDate(appointments = []) {
  const map = new Map();
  (appointments || []).forEach(app => {
    if (!app || !app.date) return;
    const dateStr = normalizeDate(app.date);
    if (!dateStr) return;
    if (!map.has(dateStr)) {
      map.set(dateStr, []);
    }
    map.get(dateStr).push(app);
  });
  return map;
}

/**
 * Calcula métricas de um conjunto de agendamentos de um dia
 */
export function calculateDayMetrics(dayAppointments = []) {
  let activeCount = 0;
  let blocksCount = 0;
  let revenue = 0;
  let hasConfirmed = false;
  let hasCompleted = false;
  let hasScheduled = false;
  let hasBlock = false;

  (dayAppointments || []).forEach(app => {
    if (!app) return;
    const isBlock = parseBlockNote(app.notes).isBlock;
    if (isBlock) {
      blocksCount += 1;
      hasBlock = true;
    } else {
      activeCount += 1;
      revenue += Number(app.service_price) || 0;
      if (app.status === 'confirmado') hasConfirmed = true;
      else if (app.status === 'concluído') hasCompleted = true;
      else if (app.status === 'agendado') hasScheduled = true;
    }
  });

  return {
    total: dayAppointments.length,
    activeCount,
    blocksCount,
    revenue,
    hasConfirmed,
    hasCompleted,
    hasScheduled,
    hasBlock,
    statuses: {
      confirmed: hasConfirmed,
      completed: hasCompleted,
      scheduled: hasScheduled,
      blocked: hasBlock
    }
  };
}

/**
 * Formata o título descritivo do cabeçalho de navegação conforme o modo ativo
 */
export function formatViewTitle(viewMode, selectedDate) {
  const safe = toValidDate(selectedDate) || new Date();
  if (viewMode === VIEW_MODES.WEEK) {
    const start = startOfWeek(safe, { weekStartsOn: 0 });
    const end = addDays(start, 6);
    const startMonth = safeFormat(start, 'MMM', { locale: ptBR });
    const endMonth = safeFormat(end, 'MMM', { locale: ptBR });

    if (startMonth === endMonth) {
      return `${safeFormat(start, 'dd')} a ${safeFormat(end, 'dd')} de ${safeFormat(end, 'MMMM, yyyy', { locale: ptBR })}`;
    }
    return `${safeFormat(start, "dd 'de' MMM", { locale: ptBR })} – ${safeFormat(end, "dd 'de' MMM, yyyy", { locale: ptBR })}`;
  }

  if (viewMode === VIEW_MODES.MONTH) {
    return safeFormat(safe, "MMMM 'de' yyyy", { locale: ptBR });
  }

  // Padrão: Modo DIA
  return safeFormat(safe, "dd 'de' MMMM, yyyy", { locale: ptBR });
}

/**
 * Calcula a navegação de data anterior / posterior de acordo com o modo de visão
 */
export function stepDate(currentDate, direction, viewMode) {
  const safe = toValidDate(currentDate) || new Date();
  if (viewMode === VIEW_MODES.WEEK) {
    return direction > 0 ? addWeeks(safe, 1) : subWeeks(safe, 1);
  }
  if (viewMode === VIEW_MODES.MONTH) {
    return direction > 0 ? addMonths(safe, 1) : subMonths(safe, 1);
  }
  return direction > 0 ? addDays(safe, 1) : subDays(safe, 1);
}

/**
 * Avalia se a data atual está no período ativo do modo de visão
 */
export function isCurrentPeriod(selectedDate, viewMode, now = new Date()) {
  const safeSelected = toValidDate(selectedDate);
  const safeNow = toValidDate(now) || new Date();
  if (!safeSelected) return false;
  try {
    if (viewMode === VIEW_MODES.WEEK) {
      const currentWeekStart = startOfWeek(safeNow, { weekStartsOn: 0 });
      const selectedWeekStart = startOfWeek(safeSelected, { weekStartsOn: 0 });
      return isSameDay(currentWeekStart, selectedWeekStart);
    }
    if (viewMode === VIEW_MODES.MONTH) {
      return isSameMonth(safeSelected, safeNow);
    }
    return isSameDay(safeSelected, safeNow);
  } catch {
    return false;
  }
}

/**
 * Calcula a classe de layout para a grade de profissionais no Modo DIA
 */
export function getProfessionalGridClass(professionalsCount) {
  if (professionalsCount === 1) {
    return 'w-full flex-1 flex flex-col';
  }
  if (professionalsCount === 2) {
    return 'grid grid-cols-2 w-full';
  }
  return 'flex min-w-max md:grid md:grid-flow-col md:auto-cols-fr';
}
