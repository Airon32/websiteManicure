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

export const toValidDate = value => {
  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }
  if (!value) return null;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return isValid(fromNumber) ? fromNumber : null;
  }
  if (typeof value === 'string') {
    const datePart = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || value.split('T')[0];
    const fromIso = new Date(`${datePart}T00:00:00`);
    return isValid(fromIso) ? fromIso : null;
  }
  return null;
};

export const appointmentDate = date => {
  const valid = toValidDate(date);
  if (!valid) return '';
  try {
    return format(valid, 'yyyy-MM-dd');
  } catch {
    return '';
  }
};

/**
 * Normaliza data para formato YYYY-MM-DD, aceitando ISO com T, Date ou apenas data
 */
export const normalizeDate = dateInput => {
  if (dateInput instanceof Date) return appointmentDate(dateInput);
  if (!dateInput) return '';
  const match = String(dateInput).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(dateInput).split('T')[0];
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

/**
 * Agenda pessoal (1 coluna / a própria profissional): nunca remover por isPartner.
 * Grade da equipe: oculta sócias, mas não deixa a lista vazia.
 */
export function filterVisibleProfessionals(professionals = [], { isAdmin = false, currentUserId } = {}) {
  const list = Array.isArray(professionals) ? professionals : [];
  const eligible = list.filter(
    professional =>
      isAdmin ||
      String(professional.id) === String(currentUserId) ||
      professional.is_public_agenda
  );

  if (eligible.length <= 1) return eligible;

  const withoutPartners = eligible.filter(
    professional =>
      String(professional.id) === String(currentUserId) || !isPartner(professional)
  );

  return withoutPartners.length > 0 ? withoutPartners : eligible;
}

/**
 * Parse date string safely, normalizing ISO formats
 * Returns Date object or null if invalid
 */
export const parseDateTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const normDate = normalizeDate(dateStr);
  const isoStr = `${normDate}T${timeStr}`;
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
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
