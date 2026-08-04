const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-only-session-secret-with-more-than-32-characters';

const {
    createAppointmentToken,
    hashPassword,
    isValidPhone,
    normalizeName,
    normalizePhone,
    signSession,
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

    const action = verifySession(createAppointmentToken(42, 60));
    assert.equal(action.action, 'confirm-appointment');
    assert.equal(action.appointmentId, '42');
});

test('normalizes Brazilian phones and names consistently', () => {
    assert.equal(normalizePhone('+55 (11) 99999-8888'), '11999998888');
    assert.equal(isValidPhone('(11) 99999-8888'), true);
    assert.equal(isValidPhone('123'), false);
    assert.equal(normalizeName('  MáRia   da Silva '), 'maria da silva');
});
