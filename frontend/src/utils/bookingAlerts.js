const SEEN_PREFIX = 'mary-seen-appointments-';
const SEEN_CAP = 400;

export function seenStorageKey(userId) {
  return `${SEEN_PREFIX}${String(userId || 'staff')}`;
}

export function isAlertableAppointment(appointment) {
  if (!appointment || appointment.id == null) return false;
  const notes = String(appointment.notes || '');
  if (notes.includes('BLOCK:')) return false;
  const status = String(appointment.status || '');
  return status === 'agendado' || status === 'confirmado' || status === 'remarcacao_solicitada';
}

export function readSeenIds(userId) {
  try {
    const raw = localStorage.getItem(seenStorageKey(userId));
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function writeSeenIds(userId, ids) {
  const unique = [...new Set((ids || []).map(String))];
  const trimmed = unique.slice(-SEEN_CAP);
  localStorage.setItem(seenStorageKey(userId), JSON.stringify(trimmed));
  return trimmed;
}

export function findUnseenAppointments(appointments, seenIds) {
  const seen = new Set((seenIds || []).map(String));
  return (appointments || []).filter(item => isAlertableAppointment(item) && !seen.has(String(item.id)));
}

export function formatBookingAlert(appointment) {
  const name = String(appointment?.client_name || 'Cliente').trim() || 'Cliente';
  const date = String(appointment?.date || '').slice(0, 10);
  const time = String(appointment?.time || '').slice(0, 5);
  const service = String(appointment?.service_name || 'serviço').trim() || 'serviço';
  const when = [date, time].filter(Boolean).join(' ');
  return {
    title: 'Novo agendamento',
    body: `${name} marcou ${service}${when ? ` em ${when}` : ''}.`
  };
}

export function canUseBrowserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function enableBrowserNotifications() {
  if (!canUseBrowserNotifications()) {
    return { ok: false, permission: 'unsupported' };
  }
  if (Notification.permission === 'granted') {
    return { ok: true, permission: 'granted' };
  }
  const permission = await Notification.requestPermission();
  return { ok: permission === 'granted', permission };
}

export function showBrowserNotification(title, body) {
  if (!canUseBrowserNotifications() || Notification.permission !== 'granted') return false;
  try {
    new Notification(title, { body, silent: false });
    return true;
  } catch {
    return false;
  }
}
