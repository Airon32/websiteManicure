import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOpenScheduleDay,
  normalizeClock,
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
