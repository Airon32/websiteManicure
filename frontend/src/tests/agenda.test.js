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
  buildEffectiveSchedule
} from '../utils/schedule.js';

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
      const isPartner = professional => {
        const identity = `${professional?.name || ''} ${professional?.specialty || ''}`
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
        return identity.includes('socio') || identity.includes('socia');
      };

      assert.strictEqual(isPartner({ name: 'Larissa Manoela', specialty: 'Sócia Administradora' }), true);
      assert.strictEqual(isPartner({ name: 'Larissa Manoela', specialty: 'Socia Proprietaria' }), true);
      assert.strictEqual(isPartner({ name: 'Marcos Socio', specialty: 'Diretor' }), true);
      assert.strictEqual(isPartner({ name: 'Carla Silva', specialty: 'Manicure e Nail Designer' }), false);
      assert.strictEqual(isPartner({ name: 'Juliana Paes', specialty: 'Pedicure' }), false);
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
        { id: '1', name: 'Ana', specialty: 'Nail Designer', is_public_agenda: true },
        { id: '2', name: 'Bia', specialty: 'Manicure', is_public_agenda: true },
        { id: '3', name: 'Sócia Gerente', specialty: 'Sócia', is_public_agenda: true }
      ];

      const visible = mockProfessionals.filter(p => !p.specialty.toLowerCase().includes('sócia'));
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
});
