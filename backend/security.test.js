const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestCredential } = require('./fixtures');

process.env.SESSION_SECRET = createTestCredential();

const {
    createAppointmentToken,
    hashPassword,
    isValidPhone,
    normalizeName,
    normalizePhone,
    signSession,
    verifyAppointmentToken,
    verifyPassword,
    verifySession
} = require('./security');

test('hashes passwords and verifies only the correct value', async () => {
    const hash = await hashPassword('uma-senha-segura');
    assert.match(hash, /^scrypt\$/);
    assert.equal((await verifyPassword('uma-senha-segura', hash)).valid, true);
    assert.equal((await verifyPassword('senha-errada', hash)).valid, false);
});

test('accepts a legacy plaintext password only for transparent migration', async () => {
    const result = await verifyPassword('legacy-pass', 'legacy-pass');
    assert.deepEqual(result, { valid: true, needsUpgrade: true });
    assert.equal((await verifyPassword('wrong-pass', 'legacy-pass')).valid, false);
});

test('signs tamper-evident staff and appointment tokens', () => {
    const session = signSession({ type: 'staff', id: '7', role: 'admin' }, 60);
    assert.equal(verifySession(session).id, '7');
    assert.equal(verifySession(`${session}x`), null);

    const actionToken = createAppointmentToken(42, 60);
    assert.match(actionToken, /^v2\.[a-z0-9]+\.[A-Za-z0-9_-]{22}$/);
    assert.ok(actionToken.length < 40);
    assert.equal(verifyAppointmentToken(actionToken, 42), true);
    assert.equal(verifyAppointmentToken(actionToken, 43), false);
    assert.equal(verifyAppointmentToken(`${actionToken}x`, 42), false);

    const legacyActionToken = signSession({ type: 'client', action: 'confirm-appointment', appointmentId: '42' }, 60);
    assert.equal(verifyAppointmentToken(legacyActionToken, 42), true);
});

test('keeps sessions available while a deployment migrates to SESSION_SECRET', () => {
    const configuredSessionCredential = process.env.SESSION_SECRET;
    const configuredDatabaseCredential = process.env.SUPABASE_SECRET_KEY;
    delete process.env.SESSION_SECRET;
    process.env.SUPABASE_SECRET_KEY = createTestCredential();

    try {
        const session = signSession({ type: 'staff', id: '9', role: 'admin' }, 60);
        assert.equal(verifySession(session).id, '9');
    } finally {
        process.env.SESSION_SECRET = configuredSessionCredential;
        if (configuredDatabaseCredential === undefined) delete process.env.SUPABASE_SECRET_KEY;
        else process.env.SUPABASE_SECRET_KEY = configuredDatabaseCredential;
    }
});

test('normalizes Brazilian phones and names consistently', () => {
    assert.equal(normalizePhone('+55 (11) 99999-8888'), '11999998888');
    assert.equal(isValidPhone('(11) 99999-8888'), true);
    assert.equal(isValidPhone('123'), false);
    assert.equal(normalizeName('  MáRia   da Silva '), 'maria da silva');
});
