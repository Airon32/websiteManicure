const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_TEMPLATES,
    EVENT_TYPE,
    MAX_ATTEMPTS,
    RETRY_BACKOFF_MS,
    SETTING_KEYS,
    canonicalizeTemplateText,
    createReminderService,
    findReminderOwners,
    foldPlaceholderName,
    formatDateBR,
    isDummyPhone,
    isMissingWhatsappPhoneColumn,
    isReminderOwner,
    isWithinLeadWindow,
    maskE164,
    nextAttemptAt,
    normalizeE164,
    parametersFor,
    presentStaffWhatsApp,
    renderTemplate,
    resolveConfiguredFlow,
    serviceNameFromAppointment,
    staffWhatsAppWriteError,
    validateReminderTemplate,
    zonedLocalToUtcMs
} = require('./reminders');
const {
    createReminderWhatsAppSender,
    isReminderChannelReady,
    isReminderWhatsAppConfigured
} = require('./whatsapp');

function memorySupabase(seed = {}) {
    const tables = {
        professionals: [],
        settings: [],
        appointments: [],
        services: [],
        appointment_message_events: [],
        ...seed
    };
    let sequence = 1000;

    function from(table) {
        if (!tables[table]) tables[table] = [];
        const filters = [];
        let operation = { type: 'select' };
        const selected = () => tables[table].filter(row => filters.every(filter => {
            const value = row[filter.column];
            if (filter.op === 'eq') return String(value) === String(filter.value);
            if (filter.op === 'in') return filter.value.map(String).includes(String(value));
            if (filter.op === 'lte') return String(value) <= String(filter.value);
            if (filter.op === 'gte') return String(value) >= String(filter.value);
            return true;
        }));
        const run = () => {
            if (operation.type === 'insert') {
                const rows = operation.rows.map(row => {
                    const created = { id: row.id ?? ++sequence, ...row };
                    tables[table].push(created);
                    return { ...created };
                });
                return { data: rows, error: null };
            }
            if (operation.type === 'update') {
                const rows = selected();
                for (const row of rows) Object.assign(row, operation.patch);
                return { data: rows.map(row => ({ ...row })), error: null };
            }
            return { data: selected().map(row => ({ ...row })), error: null };
        };
        const builder = {
            select: () => builder,
            eq(column, value) { filters.push({ op: 'eq', column, value }); return builder; },
            in(column, value) { filters.push({ op: 'in', column, value }); return builder; },
            lte(column, value) { filters.push({ op: 'lte', column, value }); return builder; },
            gte(column, value) { filters.push({ op: 'gte', column, value }); return builder; },
            order: () => builder,
            insert(rows) { operation = { type: 'insert', rows: [].concat(rows) }; return builder; },
            update(patch) { operation = { type: 'update', patch }; return builder; },
            maybeSingle() { const { data, error } = run(); return Promise.resolve({ data: data[0] ?? null, error }); },
            single() { const { data, error } = run(); return Promise.resolve({ data: data[0] ?? null, error }); },
            then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); }
        };
        return builder;
    }

    return { from, tables };
}

test('OWNER is only role=owner or is_owner, never mari/id fallbacks', () => {
    assert.equal(isReminderOwner({ type: 'staff', role: 'owner' }), true);
    assert.equal(isReminderOwner({ type: 'staff', role: 'admin', is_owner: true }), true);
    assert.equal(isReminderOwner({ type: 'staff', role: 'admin', username: 'mari', id: '1' }), false);
    assert.equal(isReminderOwner({ type: 'staff', role: 'professional' }), false);
    assert.deepEqual(
        findReminderOwners([
            { id: 1, role: 'admin', username: 'mari', status: 'ativo' },
            { id: 9, role: 'owner', status: 'ativo', whatsapp_phone: '+5511999999999' }
        ]).map(person => person.id),
        [9]
    );
});

test('templates require the locked placeholders and reject HTML', () => {
    assert.equal(validateReminderTemplate('owner', DEFAULT_TEMPLATES.owner).valid, true);
    assert.equal(validateReminderTemplate('professional', DEFAULT_TEMPLATES.professional).valid, true);
    assert.equal(validateReminderTemplate('client_pending', DEFAULT_TEMPLATES.client_pending).valid, true);
    assert.equal(validateReminderTemplate('client_confirmed', DEFAULT_TEMPLATES.client_confirmed).valid, true);
    assert.equal(validateReminderTemplate('professional', DEFAULT_TEMPLATES.owner).valid, false);
    assert.equal(validateReminderTemplate('owner', 'Ola {cliente} <b>x</b> {profissional} {servico} {data} {hora} {estabelecimento}').valid, false);
    assert.equal(validateReminderTemplate('owner', 'Ola {cliente} {foo} {profissional} {servico} {data} {hora} {estabelecimento}').valid, false);
});

test('render escapes values and formats BR date / 24h time', () => {
    const text = renderTemplate(DEFAULT_TEMPLATES.owner, {
        cliente: '<script>Ana</script>',
        profissional: 'Jécia',
        servico: 'Manicure',
        data: formatDateBR('2026-08-18'),
        hora: '14:30',
        estabelecimento: 'Mary'
    });
    assert.match(text, /Ana/);
    assert.doesNotMatch(text, /<script>/);
    assert.match(text, /18\/08\/2026/);
    assert.match(text, /14:30/);
    assert.deepEqual(
        parametersFor('professional', { cliente: 'Ana', servico: 'Gel', data: '18/08/2026', hora: '14:30', estabelecimento: 'Mary' }),
        [
            { name: 'cliente', text: 'Ana' },
            { name: 'servico', text: 'Gel' },
            { name: 'data', text: '18/08/2026' },
            { name: 'hora', text: '14:30' },
            { name: 'estabelecimento', text: 'Mary' }
        ]
    );
});

test('lead window is 24h ± 20min in America/Sao_Paulo', () => {
    const date = '2026-08-18';
    const time = '15:00';
    const slot = zonedLocalToUtcMs(date, time, 'America/Sao_Paulo');
    const target = slot - 24 * 60 * 60 * 1000;
    assert.equal(isWithinLeadWindow({ date, time, nowMs: target, leadHours: 24 }), true);
    assert.equal(isWithinLeadWindow({ date, time, nowMs: target + 20 * 60 * 1000, leadHours: 24 }), true);
    assert.equal(isWithinLeadWindow({ date, time, nowMs: target - 20 * 60 * 1000, leadHours: 24 }), true);
    assert.equal(isWithinLeadWindow({ date, time, nowMs: target + 21 * 60 * 1000, leadHours: 24 }), false);
    assert.equal(isWithinLeadWindow({ date, time, nowMs: target - 21 * 60 * 1000, leadHours: 24 }), false);
});

test('dummy phones, E.164 mask and public professional payload never leak the number', () => {
    assert.equal(isDummyPhone('00000000000'), true);
    assert.equal(isDummyPhone('11987654321'), false);
    assert.equal(normalizeE164('11987654321'), '+5511987654321');
    assert.equal(normalizeE164('(11) 98765-4321'), '+5511987654321');
    assert.equal(normalizeE164('+55 11 98765-4321'), '+5511987654321');
    assert.equal(normalizeE164('5511987654321'), '+5511987654321');
    assert.equal(normalizeE164('+5511987654321'), '+5511987654321');
    assert.equal(normalizeE164('1199999'), null);
    assert.equal(isMissingWhatsappPhoneColumn({ code: 'PGRST204', message: "Could not find the 'whatsapp_phone' column of 'professionals' in the schema cache" }), true);
    assert.equal(staffWhatsAppWriteError({ code: 'PGRST204', message: "Could not find the 'whatsapp_phone' column of 'professionals' in the schema cache" }).status, 503);
    assert.equal(maskE164('+5511987654321'), '+5511****4321');
    const presented = presentStaffWhatsApp({ id: 2, name: 'Jécia', whatsapp_phone: '+5511999999999' });
    assert.equal(presented.whatsapp_phone, undefined);
    assert.equal(presented.whatsapp_phone_set, true);
    assert.equal(presented.whatsapp_phone_masked, '+5511****9999');
});

test('retry backoff is 5/15/45 minutes and never schedules after max attempts', () => {
    assert.deepEqual(RETRY_BACKOFF_MS, [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000]);
    const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
    assert.equal(nextAttemptAt(1, t0), new Date(t0 + 5 * 60 * 1000).toISOString());
    assert.equal(nextAttemptAt(2, t0), new Date(t0 + 15 * 60 * 1000).toISOString());
    assert.equal(nextAttemptAt(MAX_ATTEMPTS, t0), null);
});

test('Meta sender uses pre-approved template params, not panel text, unless session window is open', async () => {
    const calls = [];
    const send = createReminderWhatsAppSender({
        accessToken: 'token',
        phoneNumberId: '1234567890',
        graphApiVersion: 'v21.0',
        env: { WHATSAPP_REMINDER_TEMPLATE_OWNER: 'owner_booking' },
        fetchImpl: async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body) });
            return { ok: true, json: async () => ({ messages: [{ id: 'wamid.abc' }] }) };
        }
    });
    const result = await send({
        to: '+5511999999999',
        flow: 'owner',
        parameters: ['Ana', 'Jécia', 'Gel', '18/08/2026', '14:30', 'Mary'],
        renderedText: 'TEXTO DO PAINEL NAO DEVE IR',
        sessionWindowOpen: false
    });
    assert.equal(result.providerMessageId, 'wamid.abc');
    assert.equal(calls[0].body.type, 'template');
    assert.equal(calls[0].body.template.name, 'owner_booking');
    assert.equal(calls[0].body.text, undefined);
    assert.equal(JSON.stringify(calls[0].body).includes('TEXTO DO PAINEL'), false);
    assert.equal(calls[0].body.template.components[0].parameters[0].parameter_name, undefined);
    assert.equal(calls[0].body.template.components[0].parameters[0].text, 'Ana');

    await send({
        to: '+5511999999999',
        flow: 'owner',
        parameters: [{ name: 'servico', text: 'Depilação' }, { name: 'serviço', text: 'alongamento' }],
        renderedText: 'TEXTO DO PAINEL NAO DEVE IR',
        sessionWindowOpen: false
    });
    assert.equal(calls[1].body.template.components[0].parameters[0].parameter_name, 'servico');
    assert.equal(calls[1].body.template.components[0].parameters[0].text, 'Depilação');
    assert.equal(calls[1].body.template.components[0].parameters[1].parameter_name, 'servico');

    await send({
        to: '+5511999999999',
        flow: 'owner',
        parameters: [],
        renderedText: 'Janela aberta',
        sessionWindowOpen: true
    });
    assert.equal(calls[2].body.type, 'text');
    assert.equal(calls[2].body.text.body, 'Janela aberta');
});

test('Meta 131047/131026 become failed delivery codes and channel without template is not ready', async () => {
    const send = createReminderWhatsAppSender({
        accessToken: 'token',
        phoneNumberId: '1234567890',
        graphApiVersion: 'v21.0',
        env: { WHATSAPP_REMINDER_TEMPLATE_OWNER: 'owner_booking' },
        fetchImpl: async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: { code: 131047, message: 're-engagement' } })
        })
    });
    await assert.rejects(() => send({ to: '+5511999999999', flow: 'owner', parameters: ['x'] }), error => {
        assert.equal(error.code, '131047');
        return true;
    });
    assert.equal(isReminderWhatsAppConfigured({}), false);
    assert.equal(isReminderChannelReady({
        WHATSAPP_ACCESS_TOKEN: 't',
        WHATSAPP_PHONE_NUMBER_ID: '1',
        WHATSAPP_GRAPH_API_VERSION: 'v21.0'
    }), false);
});

test('booking notifies owner once and suppresses the professional when they are the same person', async () => {
    const db = memorySupabase({
        professionals: [
            { id: 4, name: 'Mariana', role: 'owner', is_owner: true, status: 'ativo', whatsapp_phone: '+5511911111111' }
        ],
        settings: [
            { key: SETTING_KEYS.notifyOwner, value: 'true' },
            { key: SETTING_KEYS.notifyProfessional, value: 'true' },
            { key: 'business_name', value: 'Mary' }
        ],
        services: [{ id: 11, name: 'Manicure' }],
        appointments: []
    });
    const deliveries = [];
    const service = createReminderService({
        supabase: db,
        sendMessage: async payload => {
            deliveries.push(payload);
            return { providerMessageId: 'wamid.1' };
        },
        env: {
            WHATSAPP_ACCESS_TOKEN: 't',
            WHATSAPP_PHONE_NUMBER_ID: '1',
            WHATSAPP_GRAPH_API_VERSION: 'v21.0',
            WHATSAPP_REMINDER_TEMPLATE_OWNER: 'owner_tpl',
            WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL: 'pro_tpl'
        }
    });
    const appointment = {
        id: 88,
        professional_id: 4,
        client_name: 'Ana',
        client_phone: '11987654321',
        date: '2026-08-20',
        time: '10:00',
        status: 'agendado',
        service_id: 11,
        notes: ''
    };
    const summary = await service.notifyNewBooking(appointment);
    assert.equal(summary.sent, 1);
    assert.equal(summary.suppressed, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].flow, 'owner');
    const events = db.tables.appointment_message_events;
    assert.equal(events.find(event => event.type === EVENT_TYPE.OWNER).status, 'sent');
    assert.equal(events.find(event => event.type === EVENT_TYPE.PROFESSIONAL).status, 'suppressed');
    assert.equal(events.find(event => event.type === EVENT_TYPE.PROFESSIONAL).suppress_reason, 'MESMO_DESTINATARIO');
    assert.equal(events.every(event => event.status !== 'sent' || event.provider_message_id), true);
});

test('failed provider result is never stored as sent and retries with backoff', async () => {
    const db = memorySupabase({
        professionals: [{ id: 4, name: 'Mariana', role: 'owner', is_owner: true, status: 'ativo', whatsapp_phone: '+5511911111111' }],
        settings: [
            { key: SETTING_KEYS.notifyOwner, value: 'true' },
            { key: 'business_name', value: 'Mary' }
        ],
        services: [{ id: 11, name: 'Manicure' }]
    });
    let nowMs = Date.UTC(2026, 7, 17, 12, 0, 0);
    const service = createReminderService({
        supabase: db,
        now: () => nowMs,
        sendMessage: async () => {
            const error = new Error('denied');
            error.code = '131026';
            error.metaCode = '131026';
            error.status = 400;
            throw error;
        },
        env: {
            WHATSAPP_ACCESS_TOKEN: 't',
            WHATSAPP_PHONE_NUMBER_ID: '1',
            WHATSAPP_GRAPH_API_VERSION: 'v21.0',
            WHATSAPP_REMINDER_TEMPLATE_OWNER: 'owner_tpl'
        }
    });
    const appointment = {
        id: 91,
        professional_id: 4,
        client_name: 'Ana',
        client_phone: '11987654321',
        date: '2026-08-20',
        time: '10:00',
        status: 'agendado',
        service_id: 11
    };
    await service.notifyNewBooking(appointment);
    const first = db.tables.appointment_message_events[0];
    assert.equal(first.status, 'failed');
    assert.equal(first.sent_at, null);
    assert.equal(first.error_code, '131026');
    assert.equal(first.attempt_count, 1);
    assert.equal(first.next_attempt_at, new Date(nowMs + 5 * 60 * 1000).toISOString());

    db.tables.appointments.push(appointment);
    nowMs += 5 * 60 * 1000;
    await service.runAutomaticJob();
    assert.equal(db.tables.appointment_message_events[0].attempt_count, 2);
    assert.equal(db.tables.appointment_message_events[0].status, 'failed');
    assert.equal(db.tables.appointment_message_events[0].next_attempt_at, new Date(nowMs + 15 * 60 * 1000).toISOString());
});

test('automatic reminder is suppressed when a manual one was sent in the last 6 hours', async () => {
    const appointment = {
        id: 70,
        professional_id: 8,
        client_name: 'Ana',
        client_phone: '11987654321',
        date: '2026-08-18',
        time: '15:00',
        status: 'agendado',
        service_id: 11
    };
    const slot = zonedLocalToUtcMs(appointment.date, appointment.time, 'America/Sao_Paulo');
    const nowMs = slot - 24 * 60 * 60 * 1000;
    const db = memorySupabase({
        professionals: [{ id: 8, name: 'Jécia', role: 'professional', status: 'ativo', whatsapp_phone: '+5511922222222' }],
        settings: [
            { key: SETTING_KEYS.clientAuto, value: 'true' },
            { key: SETTING_KEYS.leadHours, value: '24' },
            { key: 'business_name', value: 'Mary' }
        ],
        services: [{ id: 11, name: 'Manicure' }],
        appointments: [appointment],
        appointment_message_events: [{
            id: 1,
            appointment_id: 70,
            type: EVENT_TYPE.MANUAL,
            recipient_kind: 'client',
            slot_date: '2026-08-18',
            slot_time: '15:00',
            rule_key: 'client_manual',
            status: 'sent',
            sent_at: new Date(nowMs - 60 * 60 * 1000).toISOString(),
            attempt_count: 1,
            created_at: new Date(nowMs - 60 * 60 * 1000).toISOString()
        }]
    });
    const deliveries = [];
    const service = createReminderService({
        supabase: db,
        now: () => nowMs,
        sendMessage: async payload => {
            deliveries.push(payload);
            return { providerMessageId: 'wamid.2' };
        },
        env: {
            WHATSAPP_ACCESS_TOKEN: 't',
            WHATSAPP_PHONE_NUMBER_ID: '1',
            WHATSAPP_GRAPH_API_VERSION: 'v21.0',
            WHATSAPP_REMINDER_TEMPLATE_CLIENT_PENDING: 'pending_tpl',
            WHATSAPP_REMINDER_TEMPLATE_CLIENT_CONFIRMED: 'confirmed_tpl'
        }
    });
    const summary = await service.runAutomaticJob();
    assert.equal(summary.suppressed, 1);
    assert.equal(deliveries.length, 0);
    assert.equal(
        db.tables.appointment_message_events.find(event => event.type === EVENT_TYPE.AUTOMATIC).suppress_reason,
        'MANUAL_NAS_6H'
    );
});

test('manual reminder asks for confirmation if automatic was sent in the last 6 hours', async () => {
    const appointment = {
        id: 71,
        professional_id: 8,
        client_name: 'Ana',
        client_phone: '11987654321',
        date: '2026-08-18',
        time: '15:00',
        status: 'confirmado',
        service_id: 11
    };
    const nowMs = Date.now();
    const db = memorySupabase({
        professionals: [{ id: 8, name: 'Jécia', role: 'professional', status: 'ativo' }],
        settings: [{ key: 'business_name', value: 'Mary' }],
        services: [{ id: 11, name: 'Manicure' }],
        appointment_message_events: [{
            id: 2,
            appointment_id: 71,
            type: EVENT_TYPE.AUTOMATIC,
            recipient_kind: 'client',
            slot_date: '2026-08-18',
            slot_time: '15:00',
            rule_key: 'client_auto_24h',
            status: 'sent',
            sent_at: new Date(nowMs - 10 * 60 * 1000).toISOString(),
            attempt_count: 1
        }]
    });
    const service = createReminderService({
        supabase: db,
        now: () => nowMs,
        sendMessage: async () => ({ providerMessageId: 'wamid.3' }),
        env: {
            WHATSAPP_ACCESS_TOKEN: 't',
            WHATSAPP_PHONE_NUMBER_ID: '1',
            WHATSAPP_GRAPH_API_VERSION: 'v21.0',
            WHATSAPP_REMINDER_TEMPLATE_CLIENT_PENDING: 'pending_tpl',
            WHATSAPP_REMINDER_TEMPLATE_CLIENT_CONFIRMED: 'confirmed_tpl'
        }
    });
    const blocked = await service.sendClientReminder(appointment, { mode: 'manual' });
    assert.equal(blocked.needs_confirm, true);
    assert.equal(blocked.status, 409);
    const confirmed = await service.sendClientReminder(appointment, { mode: 'manual', confirm: true });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.event.status, 'sent');
});

test('without Meta template the client reminder does not fake a send', async () => {
    const db = memorySupabase({
        professionals: [{ id: 8, name: 'Jécia', role: 'professional', status: 'ativo' }],
        settings: [{ key: 'business_name', value: 'Mary' }],
        services: [{ id: 11, name: 'Manicure' }]
    });
    const service = createReminderService({
        supabase: db,
        sendMessage: async () => ({ providerMessageId: 'should-not-run' }),
        env: {}
    });
    const result = await service.sendClientReminder({
        id: 72,
        professional_id: 8,
        client_name: 'Ana',
        client_phone: '11987654321',
        date: '2026-08-18',
        time: '15:00',
        status: 'agendado',
        service_id: 11
    }, { mode: 'manual' });
    assert.equal(result.status, 503);
    assert.equal(db.tables.appointment_message_events.length, 0);
});

test('placeholders with cedilla, capital letters and horario alias render to canonical values', () => {
    assert.equal(foldPlaceholderName('serviço'), 'servico');
    assert.equal(foldPlaceholderName('Profissional'), 'profissional');
    assert.equal(foldPlaceholderName('horario'), 'hora');
    const ownerText = 'Olá {cliente} {serviço} {Profissional} {data} {horario} {estabelecimento}';
    assert.equal(validateReminderTemplate('owner', ownerText).valid, true);
    assert.equal(validateReminderTemplate('professional', 'Olá {cliente} {serviço} {data} {horario} {estabelecimento}').valid, true);
    const raw = 'Serviço: {serviço} com {Profissional} às {horario}';
    assert.equal(
        canonicalizeTemplateText(raw),
        'Serviço: {servico} com {profissional} às {hora}'
    );
    const rendered = renderTemplate(raw, {
        servico: 'Depilação',
        profissional: 'Mariana',
        hora: '18:30'
    });
    assert.equal(rendered, 'Serviço: Depilação com Mariana às 18:30');
});

test('MULTI_SERVICES notes become the service name used in template params', () => {
    const name = serviceNameFromAppointment({
        notes: 'MULTI_SERVICES:[{"name":"Depilação"},{"name":"Manicure"}]|extra'
    }, 'Catálogo');
    assert.equal(name, 'Depilação + Manicure');
    assert.equal(serviceNameFromAppointment({ notes: '' }, 'Manicure'), 'Manicure');
});

test('owner flow without owner Meta template falls back to professional template', () => {
    assert.equal(resolveConfiguredFlow('owner', {
        WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL: 'pro_tpl'
    }), 'professional');
    assert.equal(resolveConfiguredFlow('owner', {
        WHATSAPP_REMINDER_TEMPLATE_OWNER: 'owner_tpl',
        WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL: 'pro_tpl'
    }), 'owner');
});

test('same person still gets professional notice when owner notify is off', async () => {
    const db = memorySupabase({
        professionals: [
            { id: 4, name: 'Mariana', role: 'owner', is_owner: true, status: 'ativo', whatsapp_phone: '+5511911111111' }
        ],
        settings: [
            { key: SETTING_KEYS.notifyOwner, value: 'false' },
            { key: SETTING_KEYS.notifyProfessional, value: 'true' },
            { key: 'business_name', value: 'Mary' }
        ],
        services: [{ id: 11, name: 'Manicure' }]
    });
    const deliveries = [];
    const service = createReminderService({
        supabase: db,
        sendMessage: async payload => {
            deliveries.push(payload);
            return { providerMessageId: 'wamid.pro' };
        },
        env: {
            WHATSAPP_ACCESS_TOKEN: 't',
            WHATSAPP_PHONE_NUMBER_ID: '1',
            WHATSAPP_GRAPH_API_VERSION: 'v21.0',
            WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL: 'pro_tpl'
        }
    });
    const summary = await service.notifyNewBooking({
        id: 101,
        professional_id: 4,
        client_name: 'Cíntia',
        client_phone: '11987654321',
        date: '2026-08-18',
        time: '18:30',
        status: 'agendado',
        service_id: 11,
        notes: ''
    });
    assert.equal(summary.sent, 1);
    assert.equal(summary.suppressed, 0);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].flow, 'professional');
});

test('owner send failure does not suppress the professional for the same person', async () => {
    const db = memorySupabase({
        professionals: [
            { id: 4, name: 'Mariana', role: 'owner', is_owner: true, status: 'ativo', whatsapp_phone: '+5511911111111' }
        ],
        settings: [
            { key: SETTING_KEYS.notifyOwner, value: 'true' },
            { key: SETTING_KEYS.notifyProfessional, value: 'true' },
            { key: 'business_name', value: 'Mary' }
        ],
        services: [{ id: 11, name: 'Manicure' }]
    });
    const deliveries = [];
    const service = createReminderService({
        supabase: db,
        sendMessage: async payload => {
            deliveries.push(payload);
            if (payload.flow === 'owner') {
                const error = new Error('missing template');
                error.code = 'CHANNEL_NOT_CONFIGURED';
                error.status = 503;
                throw error;
            }
            return { providerMessageId: 'wamid.pro' };
        },
        env: {
            WHATSAPP_ACCESS_TOKEN: 't',
            WHATSAPP_PHONE_NUMBER_ID: '1',
            WHATSAPP_GRAPH_API_VERSION: 'v21.0',
            WHATSAPP_REMINDER_TEMPLATE_OWNER: 'owner_tpl',
            WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL: 'pro_tpl'
        }
    });
    const summary = await service.notifyNewBooking({
        id: 102,
        professional_id: 4,
        client_name: 'Cíntia',
        client_phone: '11987654321',
        date: '2026-08-18',
        time: '18:30',
        status: 'agendado',
        service_id: 11,
        notes: 'MULTI_SERVICES:[{"name":"Depilação"}]'
    });
    assert.equal(summary.sent, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.suppressed, 0);
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[1].flow, 'professional');
    assert.equal(deliveries[1].parameters.find(item => item.name === 'servico').text, 'Depilação');
    const events = db.tables.appointment_message_events;
    assert.equal(events.find(event => event.type === EVENT_TYPE.OWNER).status, 'failed');
    assert.equal(events.find(event => event.type === EVENT_TYPE.PROFESSIONAL).status, 'sent');
});

test('owner booking uses professional Meta template when owner env is missing', async () => {
    const db = memorySupabase({
        professionals: [
            { id: 4, name: 'Mariana', role: 'owner', is_owner: true, status: 'ativo', whatsapp_phone: '+5511911111111' }
        ],
        settings: [
            { key: SETTING_KEYS.notifyOwner, value: 'true' },
            { key: SETTING_KEYS.notifyProfessional, value: 'true' },
            { key: 'business_name', value: 'Mary' }
        ],
        services: [{ id: 11, name: 'Manicure' }]
    });
    const deliveries = [];
    const service = createReminderService({
        supabase: db,
        sendMessage: async payload => {
            deliveries.push(payload);
            return { providerMessageId: 'wamid.fallback' };
        },
        env: {
            WHATSAPP_ACCESS_TOKEN: 't',
            WHATSAPP_PHONE_NUMBER_ID: '1',
            WHATSAPP_GRAPH_API_VERSION: 'v21.0',
            WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL: 'pro_tpl'
        }
    });
    const summary = await service.notifyNewBooking({
        id: 103,
        professional_id: 4,
        client_name: 'Cíntia',
        client_phone: '11987654321',
        date: '2026-08-18',
        time: '18:30',
        status: 'agendado',
        service_id: 11
    });
    assert.equal(summary.sent, 1);
    assert.equal(summary.suppressed, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].flow, 'professional');
});
