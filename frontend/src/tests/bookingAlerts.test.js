import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findUnseenAppointments,
  formatBookingAlert,
  isAlertableAppointment,
  writeSeenIds,
  readSeenIds
} from '../utils/bookingAlerts.js';

test('bloqueio de agenda não gera aviso', () => {
  assert.equal(isAlertableAppointment({ id: 1, status: 'agendado', notes: 'BLOCK:almoco' }), false);
  assert.equal(isAlertableAppointment({ id: 2, status: 'agendado', notes: '' }), true);
  assert.equal(isAlertableAppointment({ id: 3, status: 'cancelado' }), false);
});

test('findUnseenAppointments ignora ids já vistos', () => {
  const rows = [
    { id: 10, status: 'agendado', client_name: 'Ana', notes: '' },
    { id: 11, status: 'agendado', client_name: 'Bia', notes: 'BLOCK:x' },
    { id: 12, status: 'agendado', client_name: 'Cris', notes: '' }
  ];
  const fresh = findUnseenAppointments(rows, ['10']);
  assert.deepEqual(fresh.map(item => item.id), [12]);
});

test('formatBookingAlert monta texto sem vazar telefone', () => {
  const alert = formatBookingAlert({
    client_name: 'Cíntia',
    client_phone: '+5511999999999',
    service_name: 'Depilação',
    date: '2026-08-19',
    time: '10:00:00'
  });
  assert.equal(alert.title, 'Novo agendamento');
  assert.match(alert.body, /Cíntia/);
  assert.match(alert.body, /Depilação/);
  assert.match(alert.body, /10:00/);
  assert.doesNotMatch(alert.body, /9999/);
});

test('writeSeenIds persiste no localStorage', () => {
  const store = {};
  globalThis.localStorage = {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); }
  };
  writeSeenIds(7, ['1', '2']);
  assert.deepEqual(readSeenIds(7), ['1', '2']);
});
