const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createTestCredential } = require('./fixtures');
const { SETTING_KEYS, DEFAULT_TEMPLATES } = require('./reminders');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = createTestCredential();
process.env.SESSION_SECRET = createTestCredential();
process.env.CRON_SECRET = 'cron-secret-16chars';
process.env.WHATSAPP_ACCESS_TOKEN = 'token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_GRAPH_API_VERSION = 'v21.0';
process.env.WHATSAPP_REMINDER_TEMPLATE_OWNER = 'owner_tpl';
process.env.WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL = 'pro_tpl';
process.env.WHATSAPP_REMINDER_TEMPLATE_CLIENT_PENDING = 'pending_tpl';
process.env.WHATSAPP_REMINDER_TEMPLATE_CLIENT_CONFIRMED = 'confirmed_tpl';

const { signSession, ACCESS_TTL } = require('./security');

const OWNER = {
    id: 4,
    name: 'Mariana',
    role: 'owner',
    is_owner: true,
    avatar: 'M',
    username: 'owner',
    specialty: 'Nails',
    status: 'ativo',
    whatsapp_phone: '+5511911111111'
};
const COLLABORATOR = {
    id: 8,
    name: 'Jécia',
    role: 'professional',
    avatar: 'J',
    username: 'jecia',
    specialty: 'Pés',
    status: 'ativo',
    whatsapp_phone: '+5511922222222'
};
const APPOINTMENT = {
    id: 501,
    client_name: 'Ana Souza',
    client_phone: '11987654321',
    professional_id: 8,
    service_id: 11,
    date: '2026-08-20',
    time: '14:00',
    status: 'agendado',
    notes: ''
};

const deliveries = [];

function seedRows() {
    return {
        professionals: [{ ...OWNER }, { ...COLLABORATOR }],
        clients: [],
        services: [{ id: 11, name: 'Manicure', duration: 60, price: 50, status: 'ativo' }],
        settings: [
            { key: 'business_name', value: 'Mary Esmalteria' },
            { key: SETTING_KEYS.notifyOwner, value: 'false' },
            { key: SETTING_KEYS.notifyProfessional, value: 'false' },
            { key: SETTING_KEYS.clientAuto, value: 'false' },
            { key: SETTING_KEYS.leadHours, value: '24' }
        ],
        appointments: [{ ...APPOINTMENT }],
        appointment_message_events: [],
        refresh_tokens: [],
        audit_logs: [],
        notifications: []
    };
}

function createSupabaseMock() {
    const tables = seedRows();
    let sequence = 8000;

    function from(table) {
        if (!tables[table]) tables[table] = [];
        const filters = [];
        let operation = { type: 'select' };
        const selectRows = () => tables[table].filter(row => filters.every(filter => {
            const value = row[filter.column];
            switch (filter.op) {
                case 'eq': return String(value) === String(filter.value);
                case 'neq': return String(value) !== String(filter.value);
                case 'in': return filter.value.map(String).includes(String(value));
                case 'gte': return String(value) >= String(filter.value);
                case 'lte': return String(value) <= String(filter.value);
                default: return true;
            }
        }));
        function run() {
            if (operation.type === 'insert') {
                const inserted = operation.rows.map(row => {
                    const created = { ...row };
                    if (created.id === undefined || created.id === null) created.id = ++sequence;
                    tables[table].push(created);
                    return { ...created };
                });
                return { data: inserted, error: null };
            }
            if (operation.type === 'update') {
                const affected = selectRows();
                for (const row of affected) Object.assign(row, operation.patch);
                return { data: affected.map(row => ({ ...row })), error: null };
            }
            if (operation.type === 'upsert') {
                const saved = operation.rows.map(row => {
                    const existing = tables[table].find(candidate => candidate.key === row.key);
                    if (existing) {
                        Object.assign(existing, row);
                        return { ...existing };
                    }
                    tables[table].push({ ...row });
                    return { ...row };
                });
                return { data: saved, error: null };
            }
            return { data: selectRows().map(row => ({ ...row })), error: null };
        }
        const builder = {
            select: () => builder,
            order: () => builder,
            limit: () => builder,
            eq(column, value) { filters.push({ op: 'eq', column, value }); return builder; },
            neq(column, value) { filters.push({ op: 'neq', column, value }); return builder; },
            in(column, value) { filters.push({ op: 'in', column, value }); return builder; },
            gte(column, value) { filters.push({ op: 'gte', column, value }); return builder; },
            lte(column, value) { filters.push({ op: 'lte', column, value }); return builder; },
            ilike: () => builder,
            or: () => builder,
            insert(rows) { operation = { type: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return builder; },
            update(patch) { operation = { type: 'update', patch }; return builder; },
            upsert(rows) { operation = { type: 'upsert', rows: Array.isArray(rows) ? rows : [rows] }; return builder; },
            maybeSingle() {
                const { data, error } = run();
                return Promise.resolve({ data: data?.[0] ?? null, error });
            },
            single() {
                const { data, error } = run();
                return Promise.resolve({ data: data?.[0] ?? null, error });
            },
            then(resolve, reject) {
                return Promise.resolve(run()).then(resolve, reject);
            }
        };
        return builder;
    }

    return { client: { from }, tables };
}

const mock = createSupabaseMock();
const originalLoad = Module._load;
Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
        return { createClient: () => mock.client };
    }
    if (request === './whatsapp' && parent?.filename?.endsWith('server.js')) {
        const real = originalLoad.call(this, request, parent, isMain);
        return {
            ...real,
            createReminderWhatsAppSenderFromEnv: () => async payload => {
                deliveries.push(payload);
                return { ok: true, providerMessageId: `wamid.${deliveries.length}` };
            },
            isReminderChannelReady: () => true
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const app = require('./server');
Module._load = originalLoad;

let server;
let baseUrl;

test.before(async () => {
    server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
});

function cookieFor(professional) {
    return `mary_session=${encodeURIComponent(signSession({
        type: 'staff',
        id: String(professional.id),
        role: professional.role,
        is_owner: professional.is_owner || false
    }, ACCESS_TTL))}`;
}

function request(path, { method = 'GET', body, cookies, authorization } = {}) {
    const headers = {};
    if (body !== undefined) {
        headers.origin = baseUrl;
        headers['content-type'] = 'application/json';
    }
    if (cookies) headers.cookie = cookies;
    if (authorization) headers.authorization = authorization;
    return fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
}

test('cron job requires Bearer CRON_SECRET', async () => {
    const missing = await request('/api/jobs/appointment-reminders', { method: 'POST', body: {} });
    assert.equal(missing.status, 401);
    const wrong = await request('/api/jobs/appointment-reminders', {
        method: 'POST',
        body: {},
        authorization: 'Bearer totally-wrong-secret'
    });
    assert.equal(wrong.status, 401);
    const ok = await request('/api/jobs/appointment-reminders', {
        method: 'POST',
        body: {},
        authorization: `Bearer ${process.env.CRON_SECRET}`
    });
    assert.equal(ok.status, 200, await ok.clone().text());
    const payload = await ok.json();
    assert.equal(payload.data.channel_ready, true);
});

test('PUT whatsapp_phone is self or owner, E.164, and GET public never returns the number', async () => {
    const forbidden = await request(`/api/professionals/${OWNER.id}/whatsapp_phone`, {
        method: 'PUT',
        cookies: cookieFor(COLLABORATOR),
        body: { whatsapp_phone: '+5511933333333' }
    });
    assert.equal(forbidden.status, 403);

    const invalid = await request(`/api/professionals/${COLLABORATOR.id}/whatsapp_phone`, {
        method: 'PUT',
        cookies: cookieFor(COLLABORATOR),
        body: { whatsapp_phone: '1199999' }
    });
    assert.equal(invalid.status, 400);

    const saved = await request(`/api/professionals/${COLLABORATOR.id}/whatsapp_phone`, {
        method: 'PUT',
        cookies: cookieFor(COLLABORATOR),
        body: { whatsapp_phone: '+5511933334444' }
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const savedBody = await saved.json();
    assert.equal(savedBody.data.whatsapp_phone, undefined);
    assert.equal(savedBody.data.whatsapp_phone_set, true);
    assert.match(savedBody.data.whatsapp_phone_masked, /\*\*\*\*/);
    assert.equal(mock.tables.professionals.find(row => row.id === COLLABORATOR.id).whatsapp_phone, '+5511933334444');

    const publicGet = await request(`/api/professionals/${COLLABORATOR.id}`);
    assert.equal(publicGet.status, 200);
    const publicBody = await publicGet.json();
    assert.equal(publicBody.data.whatsapp_phone, undefined);
    assert.equal(publicBody.data.whatsapp_phone_set, undefined);
});

test('settings KV persist the 8 reminder keys for owner and reject collaborator plus invalid templates', async () => {
    const denied = await request('/api/settings', {
        method: 'PUT',
        cookies: cookieFor(COLLABORATOR),
        body: { key: SETTING_KEYS.clientAuto, value: 'true' }
    });
    assert.equal(denied.status, 403);

    const badTemplate = await request('/api/settings', {
        method: 'PUT',
        cookies: cookieFor(OWNER),
        body: { key: SETTING_KEYS.templateOwner, value: 'oi {cliente}' }
    });
    assert.equal(badTemplate.status, 400);

    const writes = [
        [SETTING_KEYS.notifyOwner, 'true'],
        [SETTING_KEYS.notifyProfessional, 'true'],
        [SETTING_KEYS.clientAuto, 'true'],
        [SETTING_KEYS.leadHours, '24'],
        [SETTING_KEYS.templateOwner, DEFAULT_TEMPLATES.owner],
        [SETTING_KEYS.templateProfessional, DEFAULT_TEMPLATES.professional],
        [SETTING_KEYS.templateClientPending, DEFAULT_TEMPLATES.client_pending],
        [SETTING_KEYS.templateClientConfirmed, DEFAULT_TEMPLATES.client_confirmed]
    ];
    for (const [key, value] of writes) {
        const response = await request('/api/settings', {
            method: 'PUT',
            cookies: cookieFor(OWNER),
            body: { key, value }
        });
        assert.equal(response.status, 200, `${key} -> ${await response.text()}`);
    }

    const listed = await request('/api/settings', { cookies: cookieFor(OWNER) });
    const payload = await listed.json();
    const keys = new Set(payload.data.map(row => row.key));
    for (const [key] of writes) assert.equal(keys.has(key), true, key);
    assert.equal(payload.reminder_channel_ready, true);
});

test('manual reminder sends via WhatsApp module and lists message-events without client phone', async () => {
    deliveries.length = 0;
    const sent = await request(`/api/appointments/${APPOINTMENT.id}/reminders`, {
        method: 'POST',
        cookies: cookieFor(COLLABORATOR),
        body: {}
    });
    assert.equal(sent.status, 200, await sent.clone().text());
    const sentBody = await sent.json();
    assert.equal(sentBody.data.status, 'sent');
    assert.equal(sentBody.data.type, 'CLIENT_REMINDER_MANUAL');
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].flow, 'client_pending');
    assert.equal(deliveries[0].sessionWindowOpen, false);
    assert.ok(Array.isArray(deliveries[0].parameters));

    const replay = await request(`/api/appointments/${APPOINTMENT.id}/reminders`, {
        method: 'POST',
        cookies: cookieFor(COLLABORATOR),
        body: {}
    });
    assert.equal(replay.status, 200, await replay.clone().text());
    const replayBody = await replay.json();
    assert.equal(replayBody.skipped || replayBody.data.status === 'sent', true);
    assert.equal(deliveries.length, 1, 'idempotent replay must not send again');

    const events = await request(`/api/appointments/${APPOINTMENT.id}/message-events`, {
        cookies: cookieFor(OWNER)
    });
    assert.equal(events.status, 200);
    const listed = await events.json();
    assert.equal(listed.data.length >= 1, true);
    assert.equal(JSON.stringify(listed.data).includes('11987654321'), false);
    assert.equal(JSON.stringify(listed.data).includes(COLLABORATOR.whatsapp_phone), false);
});

test('job is idempotent for the same appointment+rule+slot', async () => {
    deliveries.length = 0;
    mock.tables.settings.find(row => row.key === SETTING_KEYS.clientAuto).value = 'true';
    const inWindow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(inWindow);
    const got = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    mock.tables.appointments.push({
        id: 777,
        client_name: 'Bia',
        client_phone: '11988887777',
        professional_id: 8,
        service_id: 11,
        date: `${got.year}-${got.month}-${got.day}`,
        time: `${got.hour}:${got.minute}`,
        status: 'agendado',
        notes: ''
    });

    const first = await request('/api/jobs/appointment-reminders', {
        method: 'POST',
        body: {},
        authorization: `Bearer ${process.env.CRON_SECRET}`
    });
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json();
    assert.ok(firstBody.data.sent >= 1, 'first job must send the in-window reminder');
    const afterFirst = deliveries.length;
    assert.ok(afterFirst >= 1);

    const second = await request('/api/jobs/appointment-reminders', {
        method: 'POST',
        body: {},
        authorization: `Bearer ${process.env.CRON_SECRET}`
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.data.sent, 0);
    assert.equal(deliveries.length, afterFirst);
    assert.ok(secondBody.data.skipped >= 1);
});
