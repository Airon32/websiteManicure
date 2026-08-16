const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createTestCredential } = require('./fixtures');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://privacy-test.supabase.co';
process.env.SUPABASE_SECRET_KEY = createTestCredential();
process.env.SESSION_SECRET = createTestCredential();

const store = {
    professionals: [
        { id: 1, name: 'Mariana Silva', username: 'mari', role: 'admin', status: 'ativo' }, // OWNER
        { id: 2, name: 'Administrador Secundário', username: 'admin_sec', role: 'admin', status: 'ativo' }, // ADMIN
        { id: 3, name: 'Jécia Colaboradora', username: 'jecia', role: 'professional', status: 'ativo' } // COLLABORATOR
    ],
    clients: [
        { id: 10, name: 'Fernanda Lima', phone: '11988887777' },
        { id: 11, name: 'Carla Souza', phone: '11977776666' }
    ],
    appointments: [
        {
            id: 201,
            service_id: 1,
            professional_id: 3,
            client_phone: '11988887777',
            client_name: 'Fernanda Lima',
            date: '2026-08-20',
            time: '14:00',
            status: 'agendado',
            notes: ''
        }
    ],
    settings: [
        { key: 'hide_client_phone_from_collaborators', value: 'false' },
        { key: 'allow_admins_view_client_phone', value: 'false' }
    ],
    audit_logs: []
};

function createQueryBuilder(table) {
    const filters = {};

    const builder = {
        select: () => builder,
        eq: (field, val) => {
            filters[field] = String(val);
            return builder;
        },
        neq: () => builder,
        order: () => builder,
        limit: () => builder,
        ilike: () => builder,
        or: () => builder,
        maybeSingle: async () => {
            let list = store[table] ? [...store[table]] : [];
            if (filters.id) list = list.filter(item => String(item.id) === String(filters.id));
            if (filters.key) list = list.filter(item => item.key === filters.key);
            if (filters.status) list = list.filter(item => item.status === filters.status);
            if (filters.phone) list = list.filter(item => item.phone === filters.phone);
            return { data: list[0] || null, error: null };
        },
        single: async () => {
            return builder.maybeSingle();
        },
        insert: (rows) => {
            const list = Array.isArray(rows) ? rows : [rows];
            if (store[table]) {
                list.forEach(r => {
                    const entry = { id: Date.now() + Math.floor(Math.random() * 1000), ...r };
                    store[table].push(entry);
                });
            }
            return {
                select: () => ({
                    maybeSingle: async () => ({ data: list[0], error: null }),
                    then: (resolve) => resolve({ data: list, error: null })
                }),
                then: (resolve) => resolve({ data: list, error: null })
            };
        },
        upsert: (rows) => {
            const list = Array.isArray(rows) ? rows : [rows];
            if (table === 'settings') {
                list.forEach(item => {
                    const idx = store.settings.findIndex(s => s.key === item.key);
                    if (idx >= 0) store.settings[idx].value = item.value;
                    else store.settings.push({ key: item.key, value: item.value });
                });
            }
            return {
                then: (resolve) => resolve({ data: list, error: null })
            };
        },
        update: (payload) => {
            return {
                eq: (f, v) => {
                    filters[f] = String(v);
                    if (store[table]) {
                        const target = store[table].find(item => String(item[f]) === String(v));
                        if (target) Object.assign(target, payload);
                    }
                    return {
                        select: () => ({
                            then: (resolve) => {
                                const found = (store[table] || []).find(r => String(r[f]) === String(v));
                                return resolve({ data: found ? [found] : [payload], error: null });
                            }
                        }),
                        then: (resolve) => resolve({ data: [payload], error: null })
                    };
                }
            };
        },
        then: (resolve) => {
            let list = store[table] ? [...store[table]] : [];
            if (filters.id) list = list.filter(item => String(item.id) === String(filters.id));
            if (filters.key) list = list.filter(item => item.key === filters.key);
            if (filters.status) list = list.filter(item => item.status === filters.status);
            return resolve({ data: list, error: null });
        }
    };
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
const { signSession, PROTECTED_PHONE_PLACEHOLDER } = require('./security');
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
    if (server) await new Promise(resolve => server.close(resolve));
});

function getSessionCookie(user) {
    const token = signSession({ type: 'staff', id: String(user.id), role: user.role, username: user.username }, 3600);
    return `mary_session=${encodeURIComponent(token)}`;
}

test('Protection OFF: all staff roles receive full phone numbers', async () => {
    const setting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    setting.value = 'false';

    const colabCookie = getSessionCookie(store.professionals[2]); // Jecia
    const res = await fetch(`${baseUrl}/api/appointments`, {
        headers: { cookie: colabCookie }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data[0].client_phone, '11988887777');

    const cliRes = await fetch(`${baseUrl}/api/clients`, {
        headers: { cookie: colabCookie }
    });
    assert.equal(cliRes.status, 200);
    const cliBody = await cliRes.json();
    assert.equal(cliBody.data[0].phone, '11988887777');
});

test('Protection ON: Collaborator receives masked phone and no real phone in payload', async () => {
    const setting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    setting.value = 'true';

    const colabCookie = getSessionCookie(store.professionals[2]); // Jecia (id 3)
    const appRes = await fetch(`${baseUrl}/api/appointments`, {
        headers: { cookie: colabCookie }
    });
    assert.equal(appRes.status, 200);
    const appBody = await appRes.json();
    assert.equal(appBody.data[0].client_phone, PROTECTED_PHONE_PLACEHOLDER);
    assert.equal(JSON.stringify(appBody).includes('11988887777'), false);

    const cliRes = await fetch(`${baseUrl}/api/clients`, {
        headers: { cookie: colabCookie }
    });
    assert.equal(cliRes.status, 200);
    const cliBody = await cliRes.json();
    assert.equal(cliBody.data[0].phone, PROTECTED_PHONE_PLACEHOLDER);
    assert.equal(JSON.stringify(cliBody).includes('11988887777'), false);
    assert.equal(JSON.stringify(cliBody).includes('11977776666'), false);
});

test('Protection ON: OWNER (Mariana) receives full phone numbers', async () => {
    const setting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    setting.value = 'true';

    const ownerCookie = getSessionCookie(store.professionals[0]); // Mariana (mari / id 1)
    const appRes = await fetch(`${baseUrl}/api/appointments`, {
        headers: { cookie: ownerCookie }
    });
    assert.equal(appRes.status, 200);
    const appBody = await appRes.json();
    assert.equal(appBody.data[0].client_phone, '11988887777');

    const cliRes = await fetch(`${baseUrl}/api/clients`, {
        headers: { cookie: ownerCookie }
    });
    assert.equal(cliRes.status, 200);
    const cliBody = await cliRes.json();
    assert.equal(cliBody.data[0].phone, '11988887777');
});

test('Protection ON: ADMIN without explicit permission receives masked phone', async () => {
    const setting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    setting.value = 'true';
    const adminAllowSetting = store.settings.find(s => s.key === 'allow_admins_view_client_phone');
    adminAllowSetting.value = 'false';

    const adminCookie = getSessionCookie(store.professionals[1]); // admin_sec (id 2)
    const appRes = await fetch(`${baseUrl}/api/appointments`, {
        headers: { cookie: adminCookie }
    });
    assert.equal(appRes.status, 200);
    const appBody = await appRes.json();
    assert.equal(appBody.data[0].client_phone, PROTECTED_PHONE_PLACEHOLDER);
});

test('Protection ON: ADMIN with explicit permission receives full phone', async () => {
    const setting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    setting.value = 'true';
    const adminAllowSetting = store.settings.find(s => s.key === 'allow_admins_view_client_phone');
    adminAllowSetting.value = 'true';

    const adminCookie = getSessionCookie(store.professionals[1]); // admin_sec (id 2)
    const appRes = await fetch(`${baseUrl}/api/appointments`, {
        headers: { cookie: adminCookie }
    });
    assert.equal(appRes.status, 200);
    const appBody = await appRes.json();
    assert.equal(appBody.data[0].client_phone, '11988887777');
});

test('Collaborator editing client does not overwrite real phone with protected placeholder', async () => {
    const setting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    setting.value = 'true';

    const colabCookie = getSessionCookie(store.professionals[2]); // Jecia (id 3)
    const putRes = await fetch(`${baseUrl}/api/clients/10`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: colabCookie,
            origin: baseUrl
        },
        body: JSON.stringify({
            name: 'Fernanda Lima Atualizada',
            phone: PROTECTED_PHONE_PLACEHOLDER
        })
    });

    assert.equal(putRes.status, 200);
    const body = await putRes.json();
    assert.equal(body.data.name, 'Fernanda Lima Atualizada');
    assert.equal(body.data.phone, PROTECTED_PHONE_PLACEHOLDER);

    // Database real phone must remain intact!
    const clientInDb = store.clients.find(c => c.id === 10);
    assert.equal(clientInDb.name, 'Fernanda Lima Atualizada');
    assert.equal(clientInDb.phone, '11988887777');
});

test('PUT /api/settings records audit log and prevents unauthorized changes', async () => {
    const setting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    setting.value = 'false'; // Set to false so update to true is an actual change

    const colabCookie = getSessionCookie(store.professionals[2]); // Jecia
    const ownerCookie = getSessionCookie(store.professionals[0]); // Mariana

    // Unauthorized collaborator attempt:
    const failRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: colabCookie,
            origin: baseUrl
        },
        body: JSON.stringify({
            key: 'hide_client_phone_from_collaborators',
            value: 'true'
        })
    });
    assert.equal(failRes.status, 403);

    // Authorized owner update:
    const initialLogCount = store.audit_logs.length;
    const okRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: ownerCookie,
            origin: baseUrl
        },
        body: JSON.stringify({
            key: 'hide_client_phone_from_collaborators',
            value: 'true'
        })
    });
    assert.equal(okRes.status, 200);

    // Audit log was recorded
    assert.ok(store.audit_logs.length > initialLogCount);
    const lastLog = store.audit_logs[store.audit_logs.length - 1];
    assert.equal(lastLog.setting_key, 'hide_client_phone_from_collaborators');
    assert.equal(lastLog.new_value, 'true');
    assert.equal(lastLog.changed_by_username, 'mari');
});

test('Protection ON: Collaborator added to authorized_phone_viewer_ids receives full phone, removed receives masked', async () => {
    const hideSetting = store.settings.find(s => s.key === 'hide_client_phone_from_collaborators');
    hideSetting.value = 'true';
    const adminAllowSetting = store.settings.find(s => s.key === 'allow_admins_view_client_phone');
    adminAllowSetting.value = 'false';

    let authIdsSetting = store.settings.find(s => s.key === 'authorized_phone_viewer_ids');
    if (!authIdsSetting) {
        authIdsSetting = { key: 'authorized_phone_viewer_ids', value: '[]' };
        store.settings.push(authIdsSetting);
    }

    const colabCookie = getSessionCookie(store.professionals[2]); // Jecia (id 3)
    const ownerCookie = getSessionCookie(store.professionals[0]); // Mariana

    // 1. Initial state: not in list -> masked
    authIdsSetting.value = '[]';
    let res = await fetch(`${baseUrl}/api/appointments`, { headers: { cookie: colabCookie } });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.data[0].client_phone, PROTECTED_PHONE_PLACEHOLDER);

    // 2. Owner grants permission to Jecia (id 3)
    const grantRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: ownerCookie,
            origin: baseUrl
        },
        body: JSON.stringify({
            key: 'authorized_phone_viewer_ids',
            value: JSON.stringify([3])
        })
    });
    assert.equal(grantRes.status, 200);

    // 3. Now Jecia receives full phone number
    res = await fetch(`${baseUrl}/api/appointments`, { headers: { cookie: colabCookie } });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.data[0].client_phone, '11988887777');

    // 4. Owner revokes permission (empty list)
    const revokeRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: ownerCookie,
            origin: baseUrl
        },
        body: JSON.stringify({
            key: 'authorized_phone_viewer_ids',
            value: JSON.stringify([])
        })
    });
    assert.equal(revokeRes.status, 200);

    // 5. Jecia is back to receiving masked phone
    res = await fetch(`${baseUrl}/api/appointments`, { headers: { cookie: colabCookie } });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.data[0].client_phone, PROTECTED_PHONE_PLACEHOLDER);
});

