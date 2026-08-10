const test = require('node:test');
const assert = require('node:assert/strict');

const DAY_NAME_MAP = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

function timeToMinutes(t) {
    if (!t) return 0;
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function validateAppointmentAgainstSchedule({ date, time, duration, schedule, ignoreExpedientLimit = false }) {
    if (ignoreExpedientLimit) {
        return { valid: true };
    }

    const appointmentDate = new Date(`${date}T00:00:00`);
    const dayKey = DAY_NAME_MAP[appointmentDate.getDay()];

    if (!schedule.work_days.includes(dayKey)) {
        return { valid: false, error: 'Este profissional não atende no dia selecionado.' };
    }

    const startMinutes = timeToMinutes(schedule.work_start);
    const endMinutes = timeToMinutes(schedule.work_end);
    const appointmentStart = timeToMinutes(time);
    const appointmentEnd = appointmentStart + duration;

    if (appointmentStart < startMinutes || appointmentEnd > endMinutes) {
        return { valid: false, error: 'O horário escolhido está fora do expediente configurado para este profissional.' };
    }

    return { valid: true };
}

function checkConflict(existingAppointments, newStart, totalDuration) {
    return (existingAppointments || []).some(appointment => {
        const existingStart = timeToMinutes(appointment.time);
        const existingDuration = Number(appointment.duration) || 30;
        return newStart < existingStart + existingDuration && newStart + totalDuration > existingStart;
    });
}

test('Validação de Agendamentos e Agendamentos Sequenciais (Back-to-Back)', async (t) => {
    const schedule = {
        work_start: '09:00',
        work_end: '18:00',
        slot_interval: 30,
        work_days: ['seg', 'ter', 'qua', 'qui', 'sex', 'sab']
    };

    const validDate = '2026-08-10';

    await t.test('permite agendamento dentro do expediente normal', () => {
        const res = validateAppointmentAgainstSchedule({
            date: validDate,
            time: '10:00',
            duration: 60,
            schedule,
            ignoreExpedientLimit: false
        });
        assert.equal(res.valid, true);
    });

    await t.test('bloqueia cliente tentando agendar às 19:00 (fora do expediente)', () => {
        const res = validateAppointmentAgainstSchedule({
            date: validDate,
            time: '19:00',
            duration: 90,
            schedule,
            ignoreExpedientLimit: false
        });
        assert.equal(res.valid, false);
        assert.equal(res.error, 'O horário escolhido está fora do expediente configurado para este profissional.');
    });

    await t.test('permite profissional agendar às 19:00 (19h às 20:30) com ignoreExpedientLimit=true', () => {
        const res = validateAppointmentAgainstSchedule({
            date: validDate,
            time: '19:00',
            duration: 90,
            schedule,
            ignoreExpedientLimit: true
        });
        assert.equal(res.valid, true);
    });

    await t.test('permite agendamento sequencial de 07:00-08:00 e 08:00-09:00 sem conflito', () => {
        const existing = [{ time: '07:00', duration: 60 }];
        const newStart = timeToMinutes('08:00');
        const duration = 60;
        const hasConflict = checkConflict(existing, newStart, duration);
        assert.equal(hasConflict, false);
    });

    await t.test('permite agendamento sequencial de 12:00-13:20 e 13:20-14:40 sem conflito', () => {
        const existing = [{ time: '12:00', duration: 80 }]; // 12:00 até 13:20
        const newStart = timeToMinutes('13:20'); // 800 min
        const duration = 80;
        const hasConflict = checkConflict(existing, newStart, duration);
        assert.equal(hasConflict, false);
    });

    await t.test('detecta conflito verdadeiro quando há sobreposição (12:00-13:20 e 13:00-14:00)', () => {
        const existing = [{ time: '12:00', duration: 80 }];
        const newStart = timeToMinutes('13:00');
        const duration = 60;
        const hasConflict = checkConflict(existing, newStart, duration);
        assert.equal(hasConflict, true);
    });
});
