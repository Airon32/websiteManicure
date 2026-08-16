const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestCredential } = require('./fixtures');

process.env.SESSION_SECRET = createTestCredential();

const {
    PROTECTED_PHONE_PLACEHOLDER,
    canViewClientPhone,
    createAppointmentToken,
    hashPassword,
    isOwner,
    isProtectedPhone,
    isValidPhone,
    maskPhone,
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

test('accurately evaluates owner and phone view permissions with privacy setting ON/OFF', () => {
    const ownerByRole = { type: 'staff', id: '10', role: 'owner', username: 'owner_user' };
    const ownerByMari = { type: 'staff', id: '1', role: 'admin', username: 'mari' };
    const adminStandard = { type: 'staff', id: '2', role: 'admin', username: 'admin_joao' };
    const collaborator = { type: 'staff', id: '3', role: 'professional', username: 'colab_ana' };
    const clientUser = { type: 'client', id: '100', phone: '11988887777' };

    assert.equal(isOwner(ownerByRole), true);
    assert.equal(isOwner(ownerByMari), true);
    assert.equal(isOwner(adminStandard), false);
    assert.equal(isOwner(collaborator), false);
    assert.equal(isOwner(clientUser), false);

    // Protection OFF:
    const settingsOff = { hide_client_phone_from_collaborators: 'false' };
    assert.equal(canViewClientPhone(ownerByRole, settingsOff), true);
    assert.equal(canViewClientPhone(ownerByMari, settingsOff), true);
    assert.equal(canViewClientPhone(adminStandard, settingsOff), true);
    assert.equal(canViewClientPhone(collaborator, settingsOff), true);
    assert.equal(canViewClientPhone(clientUser, settingsOff), false);

    // Protection ON (no explicit admin permissions):
    const settingsOn = { hide_client_phone_from_collaborators: 'true' };
    assert.equal(canViewClientPhone(ownerByRole, settingsOn), true);
    assert.equal(canViewClientPhone(ownerByMari, settingsOn), true);
    assert.equal(canViewClientPhone(adminStandard, settingsOn), false);
    assert.equal(canViewClientPhone(collaborator, settingsOn), false);

    // Protection ON with explicit admin flag:
    const settingsOnAdminAllowed = {
        hide_client_phone_from_collaborators: 'true',
        allow_admins_view_client_phone: 'true'
    };
    assert.equal(canViewClientPhone(ownerByRole, settingsOnAdminAllowed), true);
    assert.equal(canViewClientPhone(adminStandard, settingsOnAdminAllowed), true);
    assert.equal(canViewClientPhone(collaborator, settingsOnAdminAllowed), false);

    // Protection ON with authorized_phone_viewer_ids:
    const settingsOnSpecificAdmin = {
        hide_client_phone_from_collaborators: 'true',
        authorized_phone_viewer_ids: JSON.stringify(['admin_joao'])
    };
    assert.equal(canViewClientPhone(adminStandard, settingsOnSpecificAdmin), true);
    assert.equal(canViewClientPhone({ type: 'staff', id: '4', role: 'admin', username: 'admin_pedro' }, settingsOnSpecificAdmin), false);

    // Masking and placeholder detection
    assert.equal(maskPhone('11999998888', true), '11999998888');
    assert.equal(maskPhone('11999998888', false), PROTECTED_PHONE_PLACEHOLDER);
    assert.equal(isProtectedPhone('Telefone protegido 🔒'), true);
    assert.equal(isProtectedPhone('11999998888'), false);
    assert.equal(isProtectedPhone(''), true);
});
