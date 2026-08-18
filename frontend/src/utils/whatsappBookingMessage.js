import { foldPlaceholderName } from './reminders.js';

export const DEFAULT_CLIENT_BOOKING_WHATSAPP = [
  'Olá! Sou {cliente}.',
  'Acabei de fazer um agendamento pelo site.',
  '',
  'Serviço: {servico}',
  'Dia: {data}',
  'Horário: {hora}',
  'Profissional: {profissional}',
  '',
  'Poderia confirmar, por favor?'
].join('\n');

const INVERTED_TEMPLATE = /mensagem automatica|lembrar do seu agendamento|lembramos do seu hor[aá]rio/i;

export function isInvertedBookingWhatsappTemplate(text) {
  return INVERTED_TEMPLATE.test(String(text || ''));
}

export function resolveClientBookingWhatsappTemplate(stored) {
  const raw = String(stored || '').trim();
  if (!raw || isInvertedBookingWhatsappTemplate(raw)) return DEFAULT_CLIENT_BOOKING_WHATSAPP;
  return String(stored);
}

export function fillClientBookingWhatsappMessage(template, vars = {}) {
  const source = resolveClientBookingWhatsappTemplate(template);
  return source.replace(/\{([^\s{}]+)\}/g, (match, name) => {
    const key = foldPlaceholderName(name);
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const value = vars[key];
    if (value == null || String(value).trim() === '') return match;
    return String(value);
  });
}
