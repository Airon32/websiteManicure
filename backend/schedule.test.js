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
        const existingStart = Number(timeToMinutes(appointment.time));
        let existingDuration = 30;

        if (appointment.notes?.startsWith('MULTI_SERVICES:')) {
            try {
                const marker = appointment.notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
                const multiData = JSON.parse(marker.replace('MULTI_SERVICES:', ''));
                existingDuration = multiData.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
            } catch {}
        } else if (appointment.notes?.startsWith('BLOCK:')) {
            existingDuration = Number.parseInt(appointment.notes.split(':')[1], 10) || 30;
        } else if (appointment.duration) {
            existingDuration = Number(appointment.duration);
        }

        existingDuration = Number(existingDuration) || 30;
        const existingEnd = existingStart + existingDuration;
        const newEnd = Number(newStart) + Number(totalDuration);

        return newStart < existingEnd && newEnd > existingStart;
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
        const existing = [{ time: '12:00', duration: 80 }];
        const newStart = timeToMinutes('13:20');
        const duration = 80;
        const hasConflict = checkConflict(existing, newStart, duration);
        assert.equal(hasConflict, false);
    });

    await t.test('permite agendar atendimento às 12:00 logo após um bloqueio de 07:00-12:00 (300 min) sem falso conflito', () => {
        const existing = [{ time: '07:00', notes: 'BLOCK:300|dentista' }];
        const newStart = timeToMinutes('12:00'); // 720 min
        const duration = 80; // 12:00 - 13:20
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
