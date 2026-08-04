const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'otp-integration-database-key-with-more-than-32-characters';
process.env.SESSION_SECRET = 'otp-integration-session-key-with-more-than-32-characters';

const client = { id: 7, name: 'Cliente Teste', phone: '11987654321' };
const requestedCodes = [];

function createQueryBuilder(table) {
    const builder = new Proxy({}, {
        get(_target, property) {
            if (property === 'then') {
                return resolve => resolve({ data: table === 'clients' ? [client] : [], error: null });
            }
            if (property === 'maybeSingle' || property === 'single') {
                return () => Promise.resolve({ data: table === 'clients' ? client : null, error: null });
            }
            return () => builder;
        }
    });
    return builder;
}

const fakeOtpManager = {
    expiresIn: 300,
    async requestCode(input) {
        requestedCodes.push(input);
        return { accepted: true, expiresIn: 300, deliveryAttempted: true };
    },
    async verifyCode({ code }) {
        if (code === '123456') return { status: 'verified', clientId: '7' };
        if (code === '999999') return { status: 'expired', clientId: null };
        if (code === '888888') return { status: 'too_many_attempts', clientId: null };
        return { status: 'invalid', clientId: null };
    }
};

const originalLoad = Module._load;
Module._load = function mockDependencies(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
        return { createClient: () => ({ from: table => createQueryBuilder(table) }) };
    }
    if (request === './otp' && parent?.filename?.endsWith('server.js')) {
        return {
            createMetaWhatsAppSenderFromEnv: () => async () => {},
            createOtpManager: () => fakeOtpManager,
            createSupabaseOtpStore: () => ({})
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

test('request-code keeps a generic contract and passes only normalized identity internally', async () => {
    const response = await fetch(`${baseUrl}/api/client-auth/request-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '(11) 98765-4321' })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        message: 'Se o WhatsApp estiver cadastrado, o código chegará em instantes.',
        data: { sent: true, expires_in: 300 }
    });
    assert.deepEqual(requestedCodes, [{ phone: '11987654321', clientId: 7 }]);
});

test('verify-code creates an HttpOnly client session after one valid code', async () => {
    const response = await fetch(`${baseUrl}/api/client-auth/verify-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '11987654321', code: '123456' })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        message: 'success',
        client_authenticated: true,
        data: client
    });
    assert.match(response.headers.get('set-cookie'), /mary_session=.*HttpOnly; SameSite=Lax/);
});

test('verify-code returns stable non-enumerating error codes', async () => {
    const invalid = await fetch(`${baseUrl}/api/client-auth/verify-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '11987654321', code: '000000' })
    });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).code, 'OTP_INVALID');

    const expired = await fetch(`${baseUrl}/api/client-auth/verify-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '11987654321', code: '999999' })
    });
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).code, 'OTP_EXPIRED');
});

test('legacy name login is disabled as soon as WhatsApp OTP is configured', async () => {
    const response = await fetch(`${baseUrl}/api/client/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: client.name, phone: client.phone })
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'OTP_REQUIRED');
});
