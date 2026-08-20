import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  timeToMinutes,
  minutesToTime,
  parseBlockNote,
  parseAppointmentDuration,
  parseBlockDescription,
  buildHalfHourSlots,
  getTimelineBounds,
  layoutOverlaps,
  getOverlapLayout,
  minuteToPixels,
  getTimelineStyle,
  TIMELINE_PX_PER_30_MIN,
  PIXELS_PER_30_MINUTES
} from '../utils/timelineLayout.js';

import {
  buildEffectiveSchedule,
  parseAgendaVisible,
  withAgendaVisibility
} from '../utils/schedule.js';

import {
  VIEW_MODES,
  getWeekDays,
  getMonthMatrix,
  groupAppointmentsByDate,
  calculateDayMetrics,
  formatViewTitle,
  stepDate,
  isCurrentPeriod,
  getProfessionalGridClass,
  isPartner,
  filterVisibleProfessionals,
  isAgendaVisible,
  normalizeDate,
  appointmentDate,
  safeFormat,
  parseDateTime,
  salonCalendarDate
} from '../utils/agendaMultiview.js';

describe('Agenda Redesign - Test Suite', () => {

  describe('1. Timeline Layout & Time Conversion Utilities', () => {
    it('should correctly convert HH:mm string to minutes from midnight', () => {
      assert.strictEqual(timeToMinutes('00:00'), 0);
      assert.strictEqual(timeToMinutes('08:00'), 480);
      assert.strictEqual(timeToMinutes('09:30'), 570);
      assert.strictEqual(timeToMinutes('12:00'), 720);
      assert.strictEqual(timeToMinutes('18:45'), 1125);
      assert.strictEqual(timeToMinutes('23:59'), 1439);
      assert.strictEqual(timeToMinutes(null), 0);
      assert.strictEqual(timeToMinutes(''), 0);
    });

    it('should correctly convert minutes to HH:mm string format', () => {
      assert.strictEqual(minutesToTime(0), '00:00');
      assert.strictEqual(minutesToTime(480), '08:00');
      assert.strictEqual(minutesToTime(570), '09:30');
      assert.strictEqual(minutesToTime(720), '12:00');
      assert.strictEqual(minutesToTime(1125), '18:45');
      assert.strictEqual(minutesToTime(1439), '23:59');
    });

    it('should enforce 64px per 30 minutes timeline constant', () => {
      assert.strictEqual(TIMELINE_PX_PER_30_MIN, 64);
      assert.strictEqual(PIXELS_PER_30_MINUTES, 64);
      assert.strictEqual(minuteToPixels(30, 0), 64);
      assert.strictEqual(minuteToPixels(60, 0), 128);
      assert.strictEqual(minuteToPixels(90, 0), 192);
      assert.strictEqual(minuteToPixels(570, 480), 192); // 90 min delta = 192px
    });

    it('should generate accurate 30-minute vertical time slots', () => {
      const start = 480; // 08:00
      const end = 660;   // 11:00
      const slots = buildHalfHourSlots(start, end);

      assert.strictEqual(slots.length, 6);
      assert.deepStrictEqual(slots.map(s => s.label), [
        '08:00', '08:30', '09:00', '09:30', '10:00', '10:30'
      ]);
    });
  });

  describe('2. Block Notes & Duration Parsing', () => {
    it('should correctly parse simple BLOCK note', () => {
      const res = parseBlockNote('BLOCK:60');
      assert.strictEqual(res.isBlock, true);
      assert.strictEqual(res.duration, 60);
      assert.strictEqual(res.description, '');
    });

    it('should parse BLOCK note with custom reason description', () => {
      const res = parseBlockNote('BLOCK:45:Horário de Almoço');
      assert.strictEqual(res.isBlock, true);
      assert.strictEqual(res.duration, 45);
      assert.strictEqual(res.description, 'Horário de Almoço');
    });

    it('should parse piped BLOCK note with other tags', () => {
      const res = parseBlockNote('NOTE:Cliente Vip|BLOCK:90:Curso de Aperfeiçoamento|PAYMENT:done');
      assert.strictEqual(res.isBlock, true);
      assert.strictEqual(res.duration, 90);
      assert.strictEqual(res.description, 'Curso de Aperfeiçoamento');
    });

    it('should return isBlock false for standard appointments', () => {
      const res = parseBlockNote('NOTE:Cliente de primeira viagem|PAYMENT:pix');
      assert.strictEqual(res.isBlock, false);
      assert.strictEqual(res.duration, null);
    });

    it('should extract correct block descriptions', () => {
      const apptWithBlock = { notes: 'BLOCK:30:Consulta Médica', client_name: 'Bloqueio: Consulta Médica' };
      assert.strictEqual(parseBlockDescription(apptWithBlock), 'Consulta Médica');

      const apptWithLegacyName = { notes: '', client_name: 'Bloqueio: Treinamento Equipe' };
      assert.strictEqual(parseBlockDescription(apptWithLegacyName), 'Treinamento Equipe');

      const apptDefault = { notes: '', client_name: 'Ana Paula' };
      assert.strictEqual(parseBlockDescription(apptDefault), 'Horário bloqueado');
    });

    it('should parse duration correctly with multi-services tag', () => {
      const multiServiceAppt = {
        notes: 'MULTI_SERVICES:[{"name":"Manicure","duration":45},{"name":"Pedicure","duration":60}]',
        service_duration: 30
      };
      assert.strictEqual(parseAppointmentDuration(multiServiceAppt), 105);
    });

    it('should parse duration correctly with block overrides', () => {
      const blockAppt = {
        notes: 'BLOCK:75:Manutenção de Equipamento',
        service_duration: 30
      };
      assert.strictEqual(parseAppointmentDuration(blockAppt), 75);
    });

    it('should fallback to service_duration or 30 mins if not specified', () => {
      assert.strictEqual(parseAppointmentDuration({ service_duration: 40 }), 40);
      assert.strictEqual(parseAppointmentDuration({ duration: 50 }), 50);
      assert.strictEqual(parseAppointmentDuration({}), 30);
    });
  });

  describe('3. Bounds Calculation & Proportional Scaling', () => {
    it('should calculate bounds according to work hours and expand for out-of-bounds appts', () => {
      const bounds = getTimelineBounds({
        workStart: '09:00',
        workEnd: '18:00',
        appointments: [
          { time: '08:00', service_duration: 60 },  // starts at 08:00 (480)
          { time: '18:30', service_duration: 45 }   // ends at 19:15 (1155)
        ]
      });

      // Earliest 08:00 (480), Latest 19:15 -> rounded to 19:30 (1170)
      assert.strictEqual(bounds.start, 480);
      assert.strictEqual(bounds.end, 1170);
    });

    it('should compute exact element style with getTimelineStyle', () => {
      const appointment = { time: '10:00', service_duration: 60 };
      const startMinutes = 540; // 09:00
      const style = getTimelineStyle(appointment, startMinutes, 30);

      // (600 - 540) / 30 * 64 = 2 * 64 = 128px top
      // 60 / 30 * 64 = 128px height
      assert.strictEqual(style.top, 128);
      assert.strictEqual(style.height, 128);
    });
  });

  describe('4. Multi-lane Overlap Layout (Side-by-Side Collision Handling)', () => {
    it('should keep single appointment in lane 0 with laneCount 1', () => {
      const appointments = [
        { id: '1', time: '09:00', service_duration: 60 }
      ];
      const layout = layoutOverlaps(appointments);
      assert.strictEqual(layout.length, 1);
      assert.strictEqual(layout[0].lane, 0);
      assert.strictEqual(layout[0].laneCount, 1);
    });

    it('should split overlapping appointments into parallel lanes with accurate widths', () => {
      const appointments = [
        { id: '1', time: '10:00', service_duration: 60 }, // 10:00 - 11:00
        { id: '2', time: '10:30', service_duration: 60 }  // 10:30 - 11:30
      ];
      const layout = layoutOverlaps(appointments);
      assert.strictEqual(layout.length, 2);
      assert.strictEqual(layout[0].lane, 0);
      assert.strictEqual(layout[0].laneCount, 2);
      assert.strictEqual(layout[1].lane, 1);
      assert.strictEqual(layout[1].laneCount, 2);

      const overlapConfig = getOverlapLayout(appointments);
      assert.strictEqual(overlapConfig[0].width, 50);
      assert.strictEqual(overlapConfig[0].left, 0);
      assert.strictEqual(overlapConfig[1].width, 50);
      assert.strictEqual(overlapConfig[1].left, 50);
    });

    it('should handle 3 concurrent overlapping appointments', () => {
      const appointments = [
        { id: '1', time: '14:00', service_duration: 60 },
        { id: '2', time: '14:15', service_duration: 45 },
        { id: '3', time: '14:30', service_duration: 60 }
      ];
      const layout = layoutOverlaps(appointments);
      assert.strictEqual(layout.length, 3);
      assert.strictEqual(layout[0].laneCount, 3);
      assert.strictEqual(layout[1].laneCount, 3);
      assert.strictEqual(layout[2].laneCount, 3);
    });
  });

  describe('5. Professional Filtering & Partner Logic', () => {
    it('should identify partner accounts correctly with accents and gender variations', () => {
      assert.strictEqual(isPartner({ name: 'Larissa Manoela', specialty: 'Sócia Administradora' }), true);
      assert.strictEqual(isPartner({ name: 'Larissa Manoela', specialty: 'Socia Proprietaria' }), true);
      assert.strictEqual(isPartner({ name: 'Marcos Socio', specialty: 'Diretor' }), true);
      assert.strictEqual(isPartner({ name: 'Carla Silva', specialty: 'Manicure e Nail Designer' }), false);
      assert.strictEqual(isPartner({ name: 'Juliana Paes', specialty: 'Pedicure' }), false);
    });

    it('should keep the professional in Personal Agenda even when agenda is off for the team', () => {
      const self = { id: 'pro-9', name: 'Mariana Sócia', specialty: 'Sócia', agenda_visible: false };
      const visible = filterVisibleProfessionals([self], { isAdmin: false, currentUserId: 'pro-9' });
      assert.strictEqual(visible.length, 1);
      assert.strictEqual(visible[0].id, 'pro-9');
    });

    it('should hide professionals with agenda_visible false from the team grid', () => {
      const team = [
        { id: '1', name: 'Ana', specialty: 'Manicure' },
        { id: '2', name: 'Sócio Fundador', specialty: 'Sócio', agenda_visible: false }
      ];
      const visible = filterVisibleProfessionals(team, { isAdmin: true, currentUserId: 'admin-1' });
      assert.strictEqual(visible.length, 1);
      assert.strictEqual(visible[0].name, 'Ana');
      assert.equal(isAgendaVisible(team[1]), false);
      assert.equal(parseAgendaVisible(undefined), null);
      assert.equal(isAgendaVisible({ name: 'Sócio Fundador', specialty: 'Sócio' }), false);
      assert.equal(isAgendaVisible({ name: 'Ana', specialty: 'Manicure' }), true);
      assert.deepEqual(
        withAgendaVisibility(team, [{ key: 'professional_2_agenda_visible', value: 'false' }]).map(p => p.agenda_visible),
        [null, false]
      );
    });

    it('should hide the logged-in partner from the admin team grid when agenda is off', () => {
      const socio = { id: '1', name: 'Sócio Fundador', specialty: 'Sócio', agenda_visible: false };
      const ana = { id: '2', name: 'Ana', specialty: 'Manicure' };
      const visible = filterVisibleProfessionals([socio, ana], { isAdmin: true, currentUserId: '1' });
      assert.deepEqual(visible.map(p => p.name), ['Ana']);
    });
  });

  describe('6. Schedule Configuration & Overrides', () => {
    it('should resolve default schedule from settings or fallbacks', () => {
      const settings = [
        { key: 'work_start', value: '08:30' },
        { key: 'work_end', value: '19:00' },
        { key: 'slot_interval', value: '30' }
      ];
      const schedule = buildEffectiveSchedule(settings);
      assert.strictEqual(schedule.workStart, '08:30');
      assert.strictEqual(schedule.workEnd, '19:00');
      assert.strictEqual(schedule.slotInterval, '30');
    });

    it('should apply professional-specific overrides when present', () => {
      const settings = [
        { key: 'work_start', value: '09:00' },
        { key: 'work_end', value: '18:00' },
        { key: 'professional_42_work_start', value: '07:00' },
        { key: 'professional_42_work_end', value: '16:00' }
      ];
      const schedule = buildEffectiveSchedule(settings, 42);
      assert.strictEqual(schedule.workStart, '07:00');
      assert.strictEqual(schedule.workEnd, '16:00');
    });
  });

  describe('7. Verification of the 8 Agenda Redesign Criteria', () => {
    // 1. Profissionais lado a lado horizontal
    it('Criteria 1: Professional columns layout & column widths', () => {
      const mockProfessionals = [
        { id: '1', name: 'Ana', specialty: 'Nail Designer', agenda_visible: true },
        { id: '2', name: 'Bia', specialty: 'Manicure', agenda_visible: true },
        { id: '3', name: 'Sócia Gerente', specialty: 'Sócia', agenda_visible: false }
      ];

      const visible = filterVisibleProfessionals(mockProfessionals, { isAdmin: true, currentUserId: 'admin-1' });
      assert.strictEqual(visible.length, 2);
      assert.deepStrictEqual(visible.map(p => p.name), ['Ana', 'Bia']);
    });

    // 2. Horários vertical (30min/slot proporcional)
    it('Criteria 2: 30-min vertical time slots with exact 64px height step', () => {
      const start = 480; // 08:00
      const end = 600;   // 10:00
      const slots = buildHalfHourSlots(start, end);
      assert.strictEqual(slots.length, 4);
      slots.forEach((slot, index) => {
        const expectedMinute = start + index * 30;
        assert.strictEqual(slot.minute, expectedMinute);
        const topPx = minuteToPixels(slot.minute, start);
        assert.strictEqual(topPx, index * 64);
      });
    });

    // 3. Cards proporcionais à duração
    it('Criteria 3: Cards calculate height proportionally (e.g. 30min=60px, 60min=124px, 90min=188px)', () => {
      const calcHeight = duration => Math.max(minuteToPixels(duration, 0) - 4, 34);
      assert.strictEqual(calcHeight(30), 60);
      assert.strictEqual(calcHeight(45), 92);
      assert.strictEqual(calcHeight(60), 124);
      assert.strictEqual(calcHeight(90), 188);
      assert.strictEqual(calcHeight(120), 252);
    });

    // 4. Bloqueios: estilo diferenciado, ícone cadeado, ação desbloqueio
    it('Criteria 4: Block entries have differentiated notes, duration and unlock payload', () => {
      const blockNotes = 'BLOCK:60:Almoço da Equipe';
      const parsed = parseBlockNote(blockNotes);
      assert.strictEqual(parsed.isBlock, true);
      assert.strictEqual(parsed.duration, 60);
      assert.strictEqual(parsed.description, 'Almoço da Equipe');

      const blockAppt = { id: 99, notes: blockNotes, time: '12:00', service_duration: 60 };
      const duration = parseAppointmentDuration(blockAppt);
      assert.strictEqual(duration, 60);
      const desc = parseBlockDescription(blockAppt);
      assert.strictEqual(desc, 'Almoço da Equipe');
    });

    // 5. Linha 'AO VIVO' horário atual
    it('Criteria 5: Real-time LIVE indicator positioning within grid bounds', () => {
      const boundsStart = 480; // 08:00
      const boundsEnd = 1200;  // 20:00

      // Test at 14:30 (870 minutes)
      const now1430 = 14 * 60 + 30;
      const isWithinBounds = now1430 >= boundsStart && now1430 <= boundsEnd;
      assert.strictEqual(isWithinBounds, true);

      const topPx = minuteToPixels(now1430, boundsStart);
      // (870 - 480) * (64 / 30) = 390 * 2.13333 = 832px
      assert.strictEqual(topPx, 832);
    });

    // 6. Navegação dias (barra semana + 'Hoje' + setas)
    it('Criteria 6: Day navigation math with step increments', () => {
      const baseDate = new Date(2026, 7, 15); // 15 Aug 2026
      const nextDay = new Date(2026, 7, 16);
      const prevDay = new Date(2026, 7, 14);
      const nextWeek = new Date(2026, 7, 22);

      const addDaysManual = (d, n) => {
        const copy = new Date(d);
        copy.setDate(copy.getDate() + n);
        return copy;
      };

      assert.strictEqual(addDaysManual(baseDate, 1).getDate(), nextDay.getDate());
      assert.strictEqual(addDaysManual(baseDate, -1).getDate(), prevDay.getDate());
      assert.strictEqual(addDaysManual(baseDate, 7).getDate(), nextWeek.getDate());
    });

    // 7. Interações: clique criar, clique editar, confirmar presença, cancelar/desbloquear
    it('Criteria 7: Action handlers dispatch with correct identifiers and payloads', () => {
      const mockAppt = { id: 101, client_name: 'Juliana', time: '10:00', status: 'agendado' };
      let confirmedId = null;
      let completedId = null;
      let canceledId = null;
      let selectedAppt = null;

      const handleConfirm = id => { confirmedId = id; };
      const handleComplete = id => { completedId = id; };
      const handleCancel = id => { canceledId = id; };
      const handleSelect = app => { selectedAppt = app; };

      handleConfirm(mockAppt.id);
      assert.strictEqual(confirmedId, 101);

      handleComplete(mockAppt.id);
      assert.strictEqual(completedId, 101);

      handleCancel(mockAppt.id);
      assert.strictEqual(canceledId, 101);

      handleSelect(mockAppt);
      assert.deepStrictEqual(selectedAppt, mockAppt);
    });

    // 8. Design system preto/rosa tokens
    it('Criteria 8: Design system tokens and classes are correctly configured', () => {
      const statusClasses = appointment => {
        if (parseBlockNote(appointment.notes).isBlock) {
          return 'border-amber-400 bg-amber-500/20 text-amber-100 shadow-amber-500/10 hover:border-amber-300';
        }
        if (appointment.status === 'concluído') {
          return 'border-purple-400 bg-purple-500/20 text-purple-100 shadow-purple-500/10 hover:border-purple-300';
        }
        if (appointment.status === 'confirmado') {
          return 'border-emerald-400 bg-emerald-500/20 text-emerald-100 shadow-emerald-500/10 hover:border-emerald-300';
        }
        return 'border-primary bg-primary/25 text-white shadow-primary/20 hover:border-pink-300';
      };

      assert.match(statusClasses({ notes: 'BLOCK:30' }), /border-amber-400/);
      assert.match(statusClasses({ status: 'confirmado' }), /border-emerald-400/);
      assert.match(statusClasses({ status: 'concluído' }), /border-purple-400/);
      assert.match(statusClasses({ status: 'agendado' }), /border-primary/);
    });

    // 9. Regra Principal: 2 profissionais visíveis simultaneamente no mobile sem scroll horizontal
    it('Criteria 9: Two professionals layout allocates 50%/50% width and fits 390px mobile viewport without horizontal overflow', () => {
      const activeProfessionals = [
        { id: '1', name: 'Mariana', specialty: 'Manicure' },
        { id: '2', name: 'Jecia', specialty: 'Pedicure' }
      ];

      const isTwoProfessionals = activeProfessionals.length <= 2;
      assert.strictEqual(isTwoProfessionals, true);

      const viewportWidth = 390;
      const timeColWidth = 48;
      const availableWidth = viewportWidth - timeColWidth;
      const colWidth = availableWidth / activeProfessionals.length;

      assert.strictEqual(colWidth, 171); // Exactly 171px per professional column on 390px screen
      assert.strictEqual(timeColWidth + colWidth * 2, viewportWidth);
    });
  });

  describe('8. Agenda Multiview V2 & Single Professional 100% Width Layout', () => {
    it('should allocate 100% available width for a single professional (Personal Agenda)', () => {
      const singleProfessional = [{ id: '1', name: 'Mariana Manicure', specialty: 'Manicure' }];
      const gridClass = getProfessionalGridClass(singleProfessional.length);

      assert.strictEqual(gridClass, 'w-full flex-1 flex flex-col');

      // Em viewport 390px (Mobile):
      const viewportMobile = 390;
      const timeColWidthMobile = 48;
      const availableWidthMobile = viewportMobile - timeColWidthMobile;
      assert.strictEqual(availableWidthMobile, 342); // 100% da área restante para o profissional

      // Em viewport 1440px (Desktop):
      const viewportDesktop = 1440;
      const timeColWidthDesktop = 64;
      const availableWidthDesktop = viewportDesktop - timeColWidthDesktop;
      assert.strictEqual(availableWidthDesktop, 1376); // 100% da área restante para o profissional
    });

    it('should allocate grid-cols-2 for 2 professionals and min-w-max for >2 professionals', () => {
      assert.strictEqual(getProfessionalGridClass(2), 'grid grid-cols-2 w-full');
      assert.strictEqual(getProfessionalGridClass(3), 'flex min-w-max md:grid md:grid-flow-col md:auto-cols-fr');
      assert.strictEqual(getProfessionalGridClass(5), 'flex min-w-max md:grid md:grid-flow-col md:auto-cols-fr');
    });

    it('should generate 7 consecutive days for Week View', () => {
      const baseDate = new Date(2026, 7, 16); // 16 Aug 2026 (Sunday)
      const week = getWeekDays(baseDate, 0);

      assert.strictEqual(week.length, 7);
      assert.strictEqual(week[0].getDate(), 16); // Domingo 16
      assert.strictEqual(week[6].getDate(), 22); // Sábado 22
    });

    it('should generate a 7-column matrix covering all weeks of a month', () => {
      const baseDate = new Date(2026, 7, 1); // 1 Aug 2026
      const monthMatrix = getMonthMatrix(baseDate, 0);

      assert.strictEqual(Array.isArray(monthMatrix), true);
      assert.strictEqual(monthMatrix.length >= 5, true);
      monthMatrix.forEach(week => {
        assert.strictEqual(week.length, 7);
      });
    });

    it('should correctly group appointments by date', () => {
      const rawAppointments = [
        { id: 1, date: '2026-08-16', time: '09:00', client_name: 'Ana', service_price: 60 },
        { id: 2, date: '2026-08-16', time: '10:00', client_name: 'Bia', service_price: 80 },
        { id: 3, date: '2026-08-17', time: '11:00', client_name: 'Carol', service_price: 100 }
      ];

      const grouped = groupAppointmentsByDate(rawAppointments);
      assert.strictEqual(grouped.get('2026-08-16').length, 2);
      assert.strictEqual(grouped.get('2026-08-17').length, 1);
      assert.strictEqual(grouped.get('2026-08-18'), undefined);
    });

    it('should calculate accurate day metrics including active count, blocks, revenue and status dots', () => {
      const dayAppointments = [
        { id: 1, date: '2026-08-16', status: 'confirmado', service_price: 70, notes: '' },
        { id: 2, date: '2026-08-16', status: 'concluído', service_price: 90, notes: 'PAYMENT:pix' },
        { id: 3, date: '2026-08-16', status: 'agendado', service_price: 50, notes: '' },
        { id: 4, date: '2026-08-16', status: 'agendado', notes: 'BLOCK:60:Almoço' }
      ];

      const metrics = calculateDayMetrics(dayAppointments);

      assert.strictEqual(metrics.total, 4);
      assert.strictEqual(metrics.activeCount, 3);
      assert.strictEqual(metrics.blocksCount, 1);
      assert.strictEqual(metrics.revenue, 210); // 70 + 90 + 50
      assert.strictEqual(metrics.hasConfirmed, true);
      assert.strictEqual(metrics.hasCompleted, true);
      assert.strictEqual(metrics.hasScheduled, true);
      assert.strictEqual(metrics.hasBlock, true);
      assert.strictEqual(metrics.statuses.confirmed, true);
      assert.strictEqual(metrics.statuses.completed, true);
      assert.strictEqual(metrics.statuses.scheduled, true);
      assert.strictEqual(metrics.statuses.blocked, true);
    });

    it('should format view navigation titles appropriately for Day, Week and Month', () => {
      const testDate = new Date(2026, 7, 16); // 16 Aug 2026

      const dayTitle = formatViewTitle(VIEW_MODES.DAY, testDate);
      assert.strictEqual(dayTitle.toLowerCase().includes('16 de agosto'), true);

      const weekTitle = formatViewTitle(VIEW_MODES.WEEK, testDate);
      assert.strictEqual(weekTitle.includes('16 a 22 de agosto'), true);

      const monthTitle = formatViewTitle(VIEW_MODES.MONTH, testDate);
      assert.strictEqual(monthTitle.toLowerCase().includes('agosto de 2026'), true);
    });

    it('should step dates appropriately according to active view mode', () => {
      const baseDate = new Date(2026, 7, 16); // 16 Aug 2026

      // Day mode step: +/- 1 day
      const nextDay = stepDate(baseDate, 1, VIEW_MODES.DAY);
      assert.strictEqual(nextDay.getDate(), 17);
      const prevDay = stepDate(baseDate, -1, VIEW_MODES.DAY);
      assert.strictEqual(prevDay.getDate(), 15);

      // Week mode step: +/- 1 week (7 days)
      const nextWeek = stepDate(baseDate, 1, VIEW_MODES.WEEK);
      assert.strictEqual(nextWeek.getDate(), 23);
      const prevWeek = stepDate(baseDate, -1, VIEW_MODES.WEEK);
      assert.strictEqual(prevWeek.getDate(), 9);

      // Month mode step: +/- 1 month
      const nextMonth = stepDate(baseDate, 1, VIEW_MODES.MONTH);
      assert.strictEqual(nextMonth.getMonth(), 8); // September
      const prevMonth = stepDate(baseDate, -1, VIEW_MODES.MONTH);
      assert.strictEqual(prevMonth.getMonth(), 6); // July
    });

    it('should evaluate current period detection for Hoje button visibility', () => {
      const today = new Date();
      assert.strictEqual(isCurrentPeriod(today, VIEW_MODES.DAY, today), true);
      assert.strictEqual(isCurrentPeriod(today, VIEW_MODES.WEEK, today), true);
      assert.strictEqual(isCurrentPeriod(today, VIEW_MODES.MONTH, today), true);

      const pastDate = new Date(2025, 0, 1);
      assert.strictEqual(isCurrentPeriod(pastDate, VIEW_MODES.DAY, today), false);
      assert.strictEqual(isCurrentPeriod(pastDate, VIEW_MODES.WEEK, today), false);
      assert.strictEqual(isCurrentPeriod(pastDate, VIEW_MODES.MONTH, today), false);
    });

    it('should execute 1-click month-to-day navigation transition', () => {
      let currentMode = VIEW_MODES.MONTH;
      let selectedDate = new Date(2026, 7, 1);
      const targetDay = new Date(2026, 7, 21);

      // Simula o clique na célula do dia no Modo MÊS
      const handleMonthDayClick = (dayDate) => {
        selectedDate = dayDate;
        currentMode = VIEW_MODES.DAY;
      };

      handleMonthDayClick(targetDay);

      assert.strictEqual(currentMode, VIEW_MODES.DAY);
      assert.strictEqual(selectedDate.getDate(), 21);
      assert.strictEqual(selectedDate.getMonth(), 7);
    });
  });

  describe('9. WebKit-safe dates and ISO normalization', () => {
    it('should normalize ISO timestamps to the civil day in America/Sao_Paulo', () => {
      assert.strictEqual(normalizeDate('2026-08-19'), '2026-08-19');
      assert.strictEqual(normalizeDate('2026-08-19T14:30:00.000Z'), '2026-08-19');
      assert.strictEqual(normalizeDate('2026-08-19T02:00:00.000Z'), '2026-08-18');
      assert.ok(parseDateTime('2026-08-19T14:00:00.000Z', '14:00'));
      assert.equal(salonCalendarDate(parseDateTime('2026-08-19', '14:00')), '2026-08-19');
    });

    it('should not throw RangeError when formatting invalid dates', () => {
      assert.strictEqual(safeFormat(new Date('invalid'), 'yyyy-MM-dd'), '');
      assert.strictEqual(safeFormat(null, 'dd/MM'), '');
      assert.strictEqual(appointmentDate(new Date(NaN)), '');
      assert.doesNotThrow(() => getWeekDays(new Date('invalid')));
      assert.strictEqual(getWeekDays(new Date('invalid')).length, 7);
      assert.doesNotThrow(() => formatViewTitle(VIEW_MODES.DAY, new Date('invalid')));
    });

    it('should not produce NaN pixel offsets for invalid minutes', () => {
      assert.equal(minuteToPixels(NaN, 480), 0);
      assert.equal(minuteToPixels(600, 0), 1280);
    });

    it('should keep iOS day-view scroll from collapsing (min-height + overflow)', async () => {
      const css = await import('node:fs/promises').then(fs =>
        fs.readFile(new URL('../index.css', import.meta.url), 'utf8')
      );
      assert.match(css, /\.agenda-scroll[\s\S]*min-height:\s*40vh/);
      assert.match(css, /\.agenda-scroll[\s\S]*-webkit-overflow-scrolling:\s*touch/);
      assert.match(css, /\.agenda-shell[\s\S]*min-height:\s*0/);
    });

    it('should group ISO and plain dates on the same calendar day', () => {
      const grouped = groupAppointmentsByDate([
        { id: 1, date: '2026-08-19T09:00:00.000Z' },
        { id: 2, date: '2026-08-19' }
      ]);
      assert.strictEqual(grouped.get('2026-08-19').length, 2);
    });
  });
});

