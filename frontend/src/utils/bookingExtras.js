const DEFAULT_LOCALE = 'pt-BR';
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_DURATION_MINUTES = 60;
const MAX_TEXT_LENGTH = 500;

function stripControlCharacters(value, preserveNewlines = false) {
  return Array.from(String(value)).filter((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === 127) return false;
    if (codePoint >= 32) return true;
    return preserveNewlines && character === '\n';
  }).join('');
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  if (value === null || value === undefined) return '';
  return stripControlCharacters(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanMultilineText(value, maxLength = 2000) {
  if (value === null || value === undefined) return '';
  return stripControlCharacters(String(value).replace(/\r\n?/g, '\n'), true)
    .trim()
    .slice(0, maxLength);
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const text = cleanText(value, 32);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) throw new TypeError('A data do agendamento deve usar o formato AAAA-MM-DD.');

  const [, year, month, day] = match;
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    probe.getUTCFullYear() !== Number(year)
    || probe.getUTCMonth() !== Number(month) - 1
    || probe.getUTCDate() !== Number(day)
  ) {
    throw new TypeError('A data do agendamento é inválida.');
  }
  return `${year}-${month}-${day}`;
}

function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(cleanText(value, 16));
  if (!match) throw new TypeError('O horário do agendamento deve usar o formato HH:mm.');

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new TypeError('O horário do agendamento é inválido.');
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeTimeZone(value) {
  const candidate = cleanText(value, 80) || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function toFiniteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeServices(booking) {
  const candidates = booking.services
    || booking.selectedServices
    || booking.service_names
    || booking.serviceNames;

  if (Array.isArray(candidates)) {
    return candidates
      .map((service) => {
        if (typeof service === 'string') return { name: cleanText(service, 120), duration: null, price: null };
        return {
          name: cleanText(service?.name || service?.service_name, 120),
          duration: toFiniteNumber(service?.duration || service?.service_duration),
          price: toFiniteNumber(service?.price ?? service?.service_price)
        };
      })
      .filter((service) => service.name);
  }

  const singleService = booking.service || booking.selectedService;
  const name = cleanText(
    booking.service_name
      || booking.serviceName
      || (typeof singleService === 'string' ? singleService : singleService?.name),
    120
  );

  return name ? [{
    name,
    duration: toFiniteNumber(singleService?.duration || booking.service_duration),
    price: toFiniteNumber(singleService?.price ?? booking.service_price)
  }] : [];
}

function addLocalMinutes(date, time, durationMinutes) {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  result.setUTCMinutes(result.getUTCMinutes() + durationMinutes);
  return {
    date: `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`,
    time: `${String(result.getUTCHours()).padStart(2, '0')}:${String(result.getUTCMinutes()).padStart(2, '0')}`
  };
}

function compactDateTime(date, time) {
  return `${date.replaceAll('-', '')}T${time.replace(':', '')}00`;
}

function safeHttpUrl(value) {
  const text = cleanText(value, 1000);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function escapeIcsText(value) {
  return cleanMultilineText(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldIcsLine(line) {
  const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
  if (!encoder || encoder.encode(line).length <= 75) return line;

  const chunks = [];
  let chunk = '';
  for (const character of line) {
    const candidate = `${chunk}${character}`;
    const limit = chunks.length === 0 ? 75 : 74;
    if (encoder.encode(candidate).length > limit && chunk) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.join('\r\n ');
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeUid(booking) {
  const fingerprint = [
    booking.appointmentId,
    booking.date,
    booking.time,
    booking.professionalName,
    booking.serviceNames.join('|'),
    booking.businessName
  ].join('::');
  return `${hashText(fingerprint)}@agenda.local`;
}

function formatIcsUtcStamp(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sanitizeFileName(value) {
  const base = cleanText(value, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base || 'agendamento'}.ics`;
}

/**
 * Accepts both the booking API shape and the current ClientPortal state shape.
 * It intentionally omits client name and phone from calendar descriptions.
 */
export function normalizeBookingData(booking = {}, options = {}) {
  const services = normalizeServices(booking);
  const date = normalizeDate(booking.date || booking.selectedDate);
  const time = normalizeTime(booking.time || booking.selectedTime);
  const configuredDuration = toFiniteNumber(
    booking.durationMinutes
      || booking.duration
      || booking.totalDuration
      || booking.service_duration
  );
  const servicesDuration = services.reduce((total, service) => total + (service.duration || 0), 0);
  const durationMinutes = Math.min(
    24 * 60,
    Math.max(5, Math.round(configuredDuration || servicesDuration || DEFAULT_DURATION_MINUTES))
  );
  const configuredPrice = toFiniteNumber(
    booking.totalPrice
      ?? booking.price
      ?? booking.service_price
  );
  const servicesPrice = services.some((service) => service.price !== null)
    ? services.reduce((total, service) => total + (service.price || 0), 0)
    : null;
  const end = addLocalMinutes(date, time, durationMinutes);

  return {
    appointmentId: cleanText(booking.appointmentId || booking.appointment_id || booking.id, 120),
    businessName: cleanText(booking.businessName || booking.business_name || options.businessName, 120),
    serviceNames: services.map((service) => service.name),
    professionalName: cleanText(
      booking.professionalName
        || booking.professional_name
        || booking.professional?.name
        || booking.selectedPro?.name,
      120
    ),
    date,
    time,
    endDate: end.date,
    endTime: end.time,
    durationMinutes,
    price: configuredPrice ?? servicesPrice,
    location: cleanText(booking.location || booking.address || options.location, 300),
    notes: cleanMultilineText(booking.publicNotes || options.publicNotes, 1000),
    bookingUrl: safeHttpUrl(booking.bookingUrl || booking.booking_url || options.bookingUrl),
    timeZone: normalizeTimeZone(booking.timeZone || booking.time_zone || options.timeZone),
    locale: cleanText(options.locale, 20) || DEFAULT_LOCALE,
    currency: cleanText(options.currency, 8) || 'BRL'
  };
}

export function formatBookingData(booking, options = {}) {
  const normalized = normalizeBookingData(booking, options);
  const dateForFormatting = new Date(`${normalized.date}T12:00:00Z`);
  const dateLabel = new Intl.DateTimeFormat(normalized.locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(dateForFormatting);
  const durationHours = Math.floor(normalized.durationMinutes / 60);
  const durationRemainder = normalized.durationMinutes % 60;
  const durationLabel = [
    durationHours ? `${durationHours}h` : '',
    durationRemainder ? `${durationRemainder}min` : ''
  ].filter(Boolean).join(' ');
  const priceLabel = normalized.price === null ? '' : new Intl.NumberFormat(normalized.locale, {
    style: 'currency',
    currency: normalized.currency
  }).format(normalized.price);

  return {
    ...normalized,
    serviceLabel: normalized.serviceNames.join(' + ') || 'Atendimento',
    dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    timeLabel: `${normalized.time}–${normalized.endTime}`,
    durationLabel,
    priceLabel
  };
}

export function buildMapUrl(address, { provider = 'google' } = {}) {
  const query = cleanText(address, 300);
  if (!query) return '';

  const encoded = encodeURIComponent(query);
  if (provider === 'apple') return `https://maps.apple.com/?q=${encoded}`;
  if (provider === 'waze') return `https://www.waze.com/ul?q=${encoded}&navigate=yes`;
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

export function buildGoogleCalendarUrl(booking, options = {}) {
  const event = formatBookingData(booking, options);
  const title = cleanText(options.title, 180)
    || `${event.serviceLabel}${event.businessName ? ` — ${event.businessName}` : ''}`;
  const details = [
    `Serviço: ${event.serviceLabel}`,
    event.professionalName ? `Profissional: ${event.professionalName}` : '',
    `Duração: ${event.durationLabel}`,
    event.priceLabel ? `Valor: ${event.priceLabel}` : '',
    event.notes,
    event.bookingUrl ? `Gerenciar agendamento: ${event.bookingUrl}` : ''
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${compactDateTime(event.date, event.time)}/${compactDateTime(event.endDate, event.endTime)}`,
    details,
    ctz: event.timeZone
  });
  if (event.location) params.set('location', event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcsContent(booking, options = {}) {
  const event = formatBookingData(booking, options);
  const title = cleanText(options.title, 180)
    || `${event.serviceLabel}${event.businessName ? ` — ${event.businessName}` : ''}`;
  const description = [
    `Serviço: ${event.serviceLabel}`,
    event.professionalName ? `Profissional: ${event.professionalName}` : '',
    `Duração: ${event.durationLabel}`,
    event.priceLabel ? `Valor: ${event.priceLabel}` : '',
    event.notes,
    event.bookingUrl ? `Gerenciar agendamento: ${event.bookingUrl}` : ''
  ].filter(Boolean).join('\n');
  const uid = cleanText(options.uid, 180).replace(/[^a-zA-Z0-9@._-]/g, '') || makeUid(event);
  const productId = cleanText(options.productId, 160) || '-//Agenda de Beleza//Agendamento//PT-BR';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `PRODID:${escapeIcsText(productId)}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtcStamp(options.generatedAt)}`,
    `DTSTART;TZID=${event.timeZone}:${compactDateTime(event.date, event.time)}`,
    `DTEND;TZID=${event.timeZone}:${compactDateTime(event.endDate, event.endTime)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : '',
    event.bookingUrl ? `URL:${event.bookingUrl}` : '',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

export function createIcsFile(booking, options = {}) {
  const event = formatBookingData(booking, options);
  const content = buildIcsContent(booking, options);
  const filename = sanitizeFileName(options.filename || `agendamento-${event.date}-${event.time}`);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  return { filename, blob, content };
}

export function downloadIcsFile(booking, options = {}) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('O download do calendário só pode ser iniciado no navegador.');
  }
  const file = createIcsFile(booking, options);
  const objectUrl = URL.createObjectURL(file.blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = file.filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return file.filename;
}
