import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOpenScheduleDay,
  getScheduleWindowForDate,
  normalizeClock,
  resolveWorkClock,
  toApiWeekSchedule,
  toEditorWeekSchedule
} from '../utils/schedule.js';

test('Folga no editor vira null na API e volta como off no editor', () => {
  const editor = {
    dom: { start: '', end: '', off: true },
    seg: { start: '', end: '', off: true },
    ter: { start: '', end: '', off: true },
    qua: { start: '', end: '', off: true },
    qui: { start: '', end: '', off: true },
    sex: { start: '07:00:00', end: '20:00', off: false },
    sab: { start: '', end: '', off: true }
  };

  const api = toApiWeekSchedule(editor);
  assert.equal(api.dom, null);
  assert.deepEqual(api.sex, { start: '07:00', end: '20:00' });
  assert.equal(hasOpenScheduleDay(api), true);

  const roundTrip = toEditorWeekSchedule(api);
  assert.equal(roundTrip.dom.off, true);
  assert.equal(roundTrip.sex.off, false);
  assert.equal(roundTrip.sex.start, '07:00');
  assert.equal(roundTrip.sex.end, '20:00');
});

test('normalizeClock aceita HH:MM:SS e rejeita texto solto', () => {
  assert.equal(normalizeClock('7:00'), '07:00');
  assert.equal(normalizeClock('07:00:00'), '07:00');
  assert.equal(normalizeClock('9h'), '');
});

test('resolveWorkClock ignora undefined, vazio e NaN e usa o primeiro horário válido', () => {
  assert.equal(resolveWorkClock(undefined, '', NaN, '09:00', '18:00'), '09:00');
  assert.equal(resolveWorkClock('7:30'), '07:30');
  assert.equal(resolveWorkClock(null, '18:00'), '18:00');
});

test('resolve o expediente específico do domingo em vez do envelope semanal', () => {
  const professional = {
    work_start: '08:00',
    work_end: '20:00',
    work_days: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex'],
    schedule: {
      dom: { start: '12:00', end: '17:00' },
      seg: { start: '08:00', end: '20:00' },
      ter: { start: '08:00', end: '20:00' },
      qua: { start: '08:00', end: '20:00' },
      qui: { start: '08:00', end: '20:00' },
      sex: { start: '08:00', end: '20:00' },
      sab: null
    }
  };

  assert.deepEqual(getScheduleWindowForDate(professional, '2026-09-06'), { start: '12:00', end: '17:00' });
  assert.equal(getScheduleWindowForDate(professional, '2026-09-05'), null);
});

test('exceção de data prevalece sobre o expediente semanal', () => {
  const professional = {
    work_start: '09:00',
    work_end: '18:00',
    work_days: ['seg'],
    exceptions: {
      '2026-09-07': { start: '13:00:00', end: '16:00:00' },
      '2026-09-14': null
    }
  };

  assert.deepEqual(getScheduleWindowForDate(professional, '2026-09-07'), { start: '13:00', end: '16:00' });
  assert.equal(getScheduleWindowForDate(professional, '2026-09-14'), null);
});

test('agenda visível por padrão e sócio some até ligar', async () => {
  const { parseAgendaVisible, withAgendaVisibility } = await import('../utils/schedule.js');
  const { isAgendaVisible } = await import('../utils/agendaMultiview.js');
  assert.equal(parseAgendaVisible(undefined), null);
  assert.equal(parseAgendaVisible('true'), true);
  assert.equal(parseAgendaVisible('false'), false);
  const tagged = withAgendaVisibility(
    [{ id: 4, name: 'Sócio Fundador' }],
    [{ key: 'professional_4_agenda_visible', value: 'false' }]
  );
  assert.equal(tagged[0].agenda_visible, false);
  assert.equal(isAgendaVisible({ name: 'Sócio Fundador' }), false);
  assert.equal(isAgendaVisible({ name: 'Sócio Fundador', agenda_visible: true }), true);
});
