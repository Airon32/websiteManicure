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

export const appointmentDate = date => format(date, 'yyyy-MM-dd');

/**
 * Obtém os 7 dias da semana para uma data base (iniciando em Domingo por padrão ou Segunda).
 * weekStartsOn: 0 (Domingo) ou 1 (Segunda). Na Mary Esmalteria, padrão 0 para 7 colunas completas.
 */
export function getWeekDays(baseDate, weekStartsOn = 0) {
  const start = startOfWeek(baseDate, { weekStartsOn });
  return eachDayOfInterval({ start, end: addDays(start, 6) });
}

/**
 * Obtém a matriz de dias para a visualização de calendário mensal (grade 7 colunas).
 * Retorna array de semanas (cada uma com 7 dias), preenchendo os dias antes e depois do mês.
 */
export function getMonthMatrix(baseDate, weekStartsOn = 0) {
  const monthStart = startOfMonth(baseDate);
  const monthEnd = endOfMonth(baseDate);
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
    const dateStr = app.date;
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
  if (viewMode === VIEW_MODES.WEEK) {
    const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
    const end = addDays(start, 6);
    const startMonth = format(start, 'MMM', { locale: ptBR });
    const endMonth = format(end, 'MMM', { locale: ptBR });

    if (startMonth === endMonth) {
      return `${format(start, 'dd')} a ${format(end, 'dd')} de ${format(end, 'MMMM, yyyy', { locale: ptBR })}`;
    }
    return `${format(start, "dd 'de' MMM", { locale: ptBR })} – ${format(end, "dd 'de' MMM, yyyy", { locale: ptBR })}`;
  }

  if (viewMode === VIEW_MODES.MONTH) {
    return format(selectedDate, "MMMM 'de' yyyy", { locale: ptBR });
  }

  // Padrão: Modo DIA
  return format(selectedDate, "dd 'de' MMMM, yyyy", { locale: ptBR });
}

/**
 * Calcula a navegação de data anterior / posterior de acordo com o modo de visão
 */
export function stepDate(currentDate, direction, viewMode) {
  if (viewMode === VIEW_MODES.WEEK) {
    return direction > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1);
  }
  if (viewMode === VIEW_MODES.MONTH) {
    return direction > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
  }
  return direction > 0 ? addDays(currentDate, 1) : subDays(currentDate, 1);
}

/**
 * Avalia se a data atual está no período ativo do modo de visão
 */
export function isCurrentPeriod(selectedDate, viewMode, now = new Date()) {
  if (viewMode === VIEW_MODES.WEEK) {
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 0 });
    const selectedWeekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return isSameDay(currentWeekStart, selectedWeekStart);
  }
  if (viewMode === VIEW_MODES.MONTH) {
    return isSameMonth(selectedDate, now);
  }
  return isSameDay(selectedDate, now);
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
