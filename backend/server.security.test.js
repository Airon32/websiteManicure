const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createTestCredential } = require('./fixtures');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = createTestCredential();
delete process.env.SESSION_SECRET;

const tableRows = {
    professionals: [{ id: 7, name: 'Profissional Teste', role: 'admin', status: 'ativo' }],
    services: [{ id: 11, name: 'Serviço Teste', duration: 40, price: 50, status: 'ativo' }],
    settings: [{ key: 'max_advance_days', value: '30' }],
    appointments: [{
        id: 101,
        service_id: 11,
        professional_id: 7,
        client_phone: '11987654321',
        client_name: 'Cliente Teste',
        date: '2026-08-11',
        time: '10:00',
        status: 'agendado',
        notes: ''
    }]
};

function createQueryBuilder(table) {
    const startsEmpty = ['professionals', 'appointments'].includes(table);
    let result = { data: startsEmpty ? [] : (tableRows[table] || []), error: null };
    const builder = new Proxy({}, {
        get(_target, property) {
            if (property === 'then') return (resolve) => resolve(result);
            if (property === 'maybeSingle' || property === 'single') {
                return () => Promise.resolve({ data: tableRows[table]?.[0] || result.data?.[0] || null, error: null });
            }
            if (property === 'insert' || property === 'update') {
                return rows => {
                    result = { data: Array.isArray(rows) ? rows : [rows], error: null };
                    return builder;
                };
            }
            return () => builder;
        }
    });
    return builder;
}

const originalLoad = Module._load;
Module._load = function mockSupabase(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
        return { createClient: () => ({ from: table => createQueryBuilder(table) }) };
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

test('health response exposes no database diagnostics and includes security headers', async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'live' });
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
});

test('sensitive staff endpoints reject anonymous requests', async () => {
    const appointments = await fetch(`${baseUrl}/api/appointments`);
    assert.equal(appointments.status, 401);

    const settings = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'business_name', value: 'Alterado' })
    });
    assert.equal(settings.status, 401);
});

test('public availability returns only an occupancy list', async () => {
    const response = await fetch(`${baseUrl}/api/availability?date=2026-08-10&professional_id=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: 'success', data: [] });
});

test('quick availability exposes only safe scheduling suggestions', async () => {
    const response = await fetch(`${baseUrl}/api/availability/next?limit=5`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: 'success', data: [] });
});

test('rejects cross-site writes and oversized JSON bodies', async () => {
    const crossSite = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'teste', password: 'teste' })
    });
    assert.equal(crossSite.status, 403);

    const fetchMetadataCrossSite = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'teste', password: 'teste' })
    });
    assert.equal(fetchMetadataCrossSite.status, 403);

    const oversized = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'teste', password: 'x'.repeat(40000) })
    });
    assert.equal(oversized.status, 413);
});

test('requires origin proof when a state-changing request carries a session', async () => {
    const { signSession } = require('./security');
    const session = signSession({ type: 'staff', id: '7', role: 'admin' }, 60);
    const missingOrigin = await fetch(`${baseUrl}/api/logout`, {
        method: 'POST',
        headers: { cookie: `mary_session=${encodeURIComponent(session)}` }
    });
    assert.equal(missingOrigin.status, 403);

    const sameOrigin = await fetch(`${baseUrl}/api/logout`, {
        method: 'POST',
        headers: {
            cookie: `mary_session=${encodeURIComponent(session)}`,
            origin: baseUrl
        }
    });
    assert.equal(sameOrigin.status, 200);
});

test('OTP endpoints clearly advertise when the WhatsApp provider is not configured', async () => {
    const response = await fetch(`${baseUrl}/api/client-auth/request-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '11987654321' })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'OTP_NOT_CONFIGURED');
});

test('client appointments respect the configured advance window', async () => {
    const response = await fetch(`${baseUrl}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Cliente Teste',
            client_phone: '11987654321',
            professional_id: 7,
            service_id: 11,
            date: '2099-01-01',
            time: '10:00'
        })
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /próximos 30 dias/);
});

test('staff appointments can be created beyond the client advance window', async () => {
    const { signSession } = require('./security');
    const session = signSession({ type: 'staff', id: '7', role: 'admin' }, 60);
    const response = await fetch(`${baseUrl}/api/appointments`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(session)}`,
            origin: baseUrl
        },
        body: JSON.stringify({
            client_name: 'Cliente Teste',
            client_phone: '11987654321',
            professional_id: 7,
            service_id: 11,
            date: '2099-01-01',
            time: '10:00'
        })
    });

    assert.equal(response.status, 201);
});

test('staff can move an appointment to an earlier or later time', async () => {
    const { signSession } = require('./security');
    const session = signSession({ type: 'staff', id: '7', role: 'admin' }, 60);
    const response = await fetch(`${baseUrl}/api/appointments/101`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(session)}`,
            origin: baseUrl
        },
        body: JSON.stringify({
            date: '2026-08-12',
            time: '22:00',
            professional_id: 7,
            allow_outside_hours: true
        })
    });

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
        date: '2026-08-12',
        time: '22:00',
        professional_id: 7
    });
});
