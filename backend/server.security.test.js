const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'integration-test-database-key-with-more-than-32-characters';
process.env.SESSION_SECRET = 'integration-test-secret-with-more-than-32-characters';

function createQueryBuilder() {
    const result = { data: [], error: null };
    const builder = new Proxy({}, {
        get(_target, property) {
            if (property === 'then') return (resolve) => resolve(result);
            if (property === 'maybeSingle' || property === 'single') {
                return () => Promise.resolve({ data: null, error: null });
            }
            return () => builder;
        }
    });
    return builder;
}

const originalLoad = Module._load;
Module._load = function mockSupabase(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
        return { createClient: () => ({ from: () => createQueryBuilder() }) };
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

    const oversized = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'teste', password: 'x'.repeat(40000) })
    });
    assert.equal(oversized.status, 413);
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
