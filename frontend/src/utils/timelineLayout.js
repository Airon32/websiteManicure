export const TIMELINE_PX_PER_30_MIN = 64;
export const PIXELS_PER_30_MINUTES = TIMELINE_PX_PER_30_MIN;

export function timeToMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function minutesToTime(totalMinutes) {
  const safeMinutes = Math.max(0, Math.min(24 * 60 - 1, Number(totalMinutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseBlockNote(notes, fallbackDuration = 30) {
  const value = typeof notes === 'string' ? notes : '';
  const blockPart = value.split('|').find(part => part.trim().startsWith('BLOCK:'));
  if (!blockPart) {
    return { isBlock: false, duration: null, description: '' };
  }

  const match = blockPart.trim().match(/^BLOCK:(\d+)(?:[:|](.*))?$/);
  const parsedDuration = Number(match?.[1]);
  return {
    isBlock: true,
    duration: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : fallbackDuration,
    description: (match?.[2] || '').trim()
  };
}

export function parseAppointmentDuration(appointment) {
  const notes = String(appointment?.notes || '');
  const block = parseBlockNote(notes, Number(appointment?.service_duration || appointment?.duration) || 30);
  if (block.isBlock) {
    return block.duration;
  }
  if (notes.includes('MULTI_SERVICES:')) {
    try {
      const marker = notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
      if (marker) {
        const services = JSON.parse(marker.replace('MULTI_SERVICES:', ''));
        const total = services.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
        if (total > 0) return total;
      }
    } catch {
      // fallback below
    }
  }
  return Number(appointment?.service_duration || appointment?.duration) || 30;
}

export function parseBlockDescription(appointment) {
  const block = parseBlockNote(appointment?.notes);
  if (block.isBlock && block.description) {
    return block.description;
  }
  const clientName = String(appointment?.client_name || '');
  if (clientName.toLowerCase().startsWith('bloqueio:')) {
    return clientName.replace(/^bloqueio:\s*/i, '').trim() || 'Horário bloqueado';
  }
  return 'Horário bloqueado';
}

export function appointmentDuration(appointment) {
  return parseAppointmentDuration(appointment);
}

export function buildHalfHourSlots(start, end) {
  const slots = [];
  for (let minute = start; minute < end; minute += 30) {
    slots.push({ minute, label: minutesToTime(minute) });
  }
  return slots;
}

export function getTimelineBounds({ workStart = '09:00', workEnd = '18:00', appointments = [] } = {}) {
  let earliest = timeToMinutes(workStart || '09:00');
  let latest = timeToMinutes(workEnd || '18:00');

  (appointments || []).forEach(appointment => {
    if (!appointment?.time) return;
    const start = timeToMinutes(appointment.time);
    const end = Math.min(24 * 60, start + parseAppointmentDuration(appointment));
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
  });

  const start = Math.max(0, Math.floor(earliest / 30) * 30);
  const end = Math.min(24 * 60, Math.max(start + 30, Math.ceil(latest / 30) * 30));
  return { start, end };
}

export function calculateTimelineBounds({ workStart = '09:00', workEnd = '18:00', appointments = [] } = {}) {
  const bounds = getTimelineBounds({ workStart, workEnd, appointments });
  return { startMinutes: bounds.start, endMinutes: bounds.end };
}

export function layoutOverlaps(appointments = []) {
  const entries = appointments
    .filter(appointment => appointment?.time)
    .map(appointment => {
      const start = timeToMinutes(appointment.time);
      const duration = Math.max(1, Math.min(24 * 60 - start, parseAppointmentDuration(appointment)));
      return { appointment, start, end: start + duration, duration };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || String(a.appointment.id).localeCompare(String(b.appointment.id)));

  const result = [];
  let cluster = [];
  let clusterEnd = -1;

  const placeCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds = [];
    const placed = cluster.map(item => {
      let lane = laneEnds.findIndex(laneEnd => laneEnd <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      return { ...item, lane };
    });
    placed.forEach(item => result.push({ ...item, laneCount: laneEnds.length }));
    cluster = [];
    clusterEnd = -1;
  };

  entries.forEach(item => {
    if (cluster.length > 0 && item.start >= clusterEnd) {
      placeCluster();
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  });
  placeCluster();
  return result;
}

export function getOverlapLayout(appointments) {
  const overlaps = layoutOverlaps(appointments);
  return overlaps.map(item => ({
    id: item.appointment.id,
    start: item.start,
    end: item.end,
    column: item.lane,
    width: 100 / item.laneCount,
    left: (item.lane * 100) / item.laneCount
  }));
}

export function minuteToPixels(minute, startMinute = 0) {
  return (minute - startMinute) * (PIXELS_PER_30_MINUTES / 30);
}

export function getTimelineStyle(appointment, startMinutes, interval = 30) {
  const duration = parseAppointmentDuration(appointment);
  const pxPerInterval = TIMELINE_PX_PER_30_MIN * (Number(interval) / 30);
  return {
    top: ((timeToMinutes(appointment.time) - startMinutes) / Number(interval || 30)) * pxPerInterval,
    height: Math.max(34, (duration / Number(interval || 30)) * pxPerInterval)
  };
}
