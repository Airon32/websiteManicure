import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CLIENT_BOOKING_WHATSAPP,
  fillClientBookingWhatsappMessage,
  isInvertedBookingWhatsappTemplate,
  resolveClientBookingWhatsappTemplate
} from '../utils/whatsappBookingMessage.js';

test('template invertido de lembrete para a cliente é recusado', () => {
  const stored = [
    'Olá Cliente Novo tudo bem?',
    'Essa é uma mensagem automatica apenas para lembrar do seu agendamento',
    'Sendo o Serviço : {serviço} dia 18/08/2026 as 17:00 com a profissional Mariana'
  ].join('\n');
  assert.equal(isInvertedBookingWhatsappTemplate(stored), true);
  assert.equal(resolveClientBookingWhatsappTemplate(stored), DEFAULT_CLIENT_BOOKING_WHATSAPP);
});

test('mensagem da cliente avisa a profissional com serviço, dia, hora e manicure', () => {
  const text = fillClientBookingWhatsappMessage(DEFAULT_CLIENT_BOOKING_WHATSAPP, {
    cliente: 'Cíntia',
    servico: 'Abdômen',
    data: '18/08/2026',
    hora: '17:00',
    profissional: 'Mariana'
  });
  assert.match(text, /Sou Cíntia/);
  assert.match(text, /Abdômen/);
  assert.match(text, /18\/08\/2026/);
  assert.match(text, /17:00/);
  assert.match(text, /Mariana/);
  assert.doesNotMatch(text, /lembrar do seu agendamento/);
  assert.doesNotMatch(text, /\{serviço\}/);
  assert.doesNotMatch(text, /\{servico\}/);
});

test('{serviço} com cedilha é preenchido no texto da cliente', () => {
  const text = fillClientBookingWhatsappMessage('Fiz {serviço} com {Profissional} às {horario}', {
    servico: 'Depilação',
    profissional: 'Mariana',
    hora: '17:00'
  });
  assert.equal(text, 'Fiz Depilação com Mariana às 17:00');
});
