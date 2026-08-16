const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createTestCredential } = require('./fixtures');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = createTestCredential();
process.env.SESSION_SECRET = 'mary-esmalteria-adversarial-test-secret-key-at-least-32-chars';

function getNextBusinessDate(daysAhead = 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysAhead);
    while (date.getUTCDay() === 0) {
        date.setUTCDate(date.getUTCDate() + 1);
    }
    return date.toISOString().slice(0, 10);
}

const futureDate = getNextBusinessDate(2);

// Mock Database Tables
const dbState = {
    professionals: [
        { id: 1, name: 'Mariana Owner', role: 'admin', username: 'mariana', status: 'ativo' },
        { id: 2, name: 'Admin Geral', role: 'admin', username: 'admin_geral', status: 'ativo' },
        { id: 7, name: 'Manicure Autorizada', role: 'professional', username: 'autorizada', status: 'ativo' },
        { id: 8, name: 'Manicure Não Autorizada', role: 'professional', username: 'nao_autorizada', status: 'ativo' }
    ],
    services: [
        { id: 11, name: 'Manicure Tradicional', duration: 40, price: 50, status: 'ativo', category: 'Unhas' },
        { id: 12, name: 'Pedicure Completo', duration: 50, price: 65, status: 'ativo', category: 'Pés' }
    ],
    clients: [
        { id: 21, name: 'Cliente Alpha', phone: '11987654321' },
        { id: 22, name: 'Cliente Beta', phone: '11912345678' }
    ],
    appointments: [
        {
            id: 101,
            service_id: 11,
            professional_id: 7,
            client_phone: '11987654321',
            client_name: 'Cliente Alpha',
            date: futureDate,
            time: '10:00',
            status: 'agendado',
            notes: ''
        },
        {
            id: 102,
            service_id: 12,
            professional_id: 8,
            client_phone: '11912345678',
            client_name: 'Cliente Beta',
            date: futureDate,
            time: '14:00',
            status: 'agendado',
            notes: ''
        }
    ],
    settings: [
        { key: 'business_name', value: 'Mary Esmalteria' },
        { key: 'hide_client_phone_from_collaborators', value: 'true' },
        { key: 'allow_admins_view_client_phone', value: 'false' },
        { key: 'authorized_phone_viewer_ids', value: '["7"]' },
        { key: 'work_start', value: '09:00' },
        { key: 'work_end', value: '20:00' },
        { key: 'slot_interval', value: '30' },
        { key: 'max_advance_days', value: '60' }
    ],
    audit_logs: [],
    notifications: []
};

function createQueryBuilder(table) {
    let rows = dbState[table] ? [...dbState[table]] : [];
    let filterFn = () => true;

    const builder = new Proxy({}, {
        get(_target, prop) {
            if (prop === 'then') return (resolve) => resolve({ data: rows.filter(filterFn), error: null });
            if (prop === 'select') return () => builder;
            if (prop === 'order') return () => builder;
            if (prop === 'limit') return () => builder;
            if (prop === 'eq') {
                return (field, value) => {
                    const prevFilter = filterFn;
                    filterFn = (r) => prevFilter(r) && String(r[field]) === String(value);
                    return builder;
                };
            }
            if (prop === 'neq') {
                return (field, value) => {
                    const prevFilter = filterFn;
                    filterFn = (r) => prevFilter(r) && String(r[field]) !== String(value);
                    return builder;
                };
            }
            if (prop === 'or') {
                return () => builder;
            }
            if (prop === 'gte' || prop === 'lte') {
                return () => builder;
            }
            if (prop === 'single' || prop === 'maybeSingle') {
                return () => {
                    const matched = (dbState[table] || []).filter(filterFn);
                    return Promise.resolve({ data: matched[0] || null, error: null });
                };
            }
            if (prop === 'insert') {
                return (newRows) => {
                    const inserted = (Array.isArray(newRows) ? newRows : [newRows]).map((r, i) => ({
                        id: r.id || Date.now() + i,
                        ...r
                    }));
                    if (dbState[table]) dbState[table].push(...inserted);
                    return {
                        select: () => ({
                            then: (resolve) => resolve({ data: inserted, error: null })
                        }),
                        then: (resolve) => resolve({ data: inserted, error: null })
                    };
                };
            }
            if (prop === 'update') {
                return (payload) => {
                    return {
                        eq: (field, value) => {
                            if (dbState[table]) {
                                dbState[table] = dbState[table].map(r => String(r[field]) === String(value) ? { ...r, ...payload } : r);
                            }
                            return {
                                select: () => ({
                                    single: () => Promise.resolve({ data: (dbState[table] || []).find(r => String(r[field]) === String(value)), error: null }),
                                    then: (resolve) => resolve({ data: (dbState[table] || []).filter(r => String(r[field]) === String(value)), error: null })
                                }),
                                then: (resolve) => resolve({ data: (dbState[table] || []).filter(r => String(r[field]) === String(value)), error: null })
                            };
                        }
                    };
                };
            }
            if (prop === 'delete') {
                return () => ({
                    eq: (field, value) => {
                        if (dbState[table]) {
                            dbState[table] = dbState[table].filter(r => String(r[field]) !== String(value));
                        }
                        return Promise.resolve({ error: null });
                    },
                    not: () => Promise.resolve({ error: null })
                });
            }
            if (prop === 'upsert') {
                return (entries) => {
                    if (dbState[table]) {
                        entries.forEach(e => {
                            const idx = dbState[table].findIndex(r => r.key === e.key);
                            if (idx >= 0) dbState[table][idx] = { ...dbState[table][idx], ...e };
                            else dbState[table].push(e);
                        });
                    }
                    return Promise.resolve({ error: null });
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

const { signSession, createAppointmentToken, verifyAppointmentToken } = require('./security');

let server;
let baseUrl;

// Session tokens for all test personas
let ownerSession;
let adminSession;
let authorizedCollabSession;
let unauthorizedCollabSession;
let clientAlphaSession;
let clientBetaSession;

test.before(async () => {
    server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    ownerSession = signSession({ type: 'staff', id: '1', role: 'admin', username: 'mariana', name: 'Mariana' }, 3600);
    adminSession = signSession({ type: 'staff', id: '2', role: 'admin', username: 'admin_geral' }, 3600);
    authorizedCollabSession = signSession({ type: 'staff', id: '7', role: 'professional', username: 'autorizada' }, 3600);
    unauthorizedCollabSession = signSession({ type: 'staff', id: '8', role: 'professional', username: 'nao_autorizada' }, 3600);

    clientAlphaSession = signSession({ type: 'client', id: '21', name: 'Cliente Alpha', phone: '11987654321' }, 3600);
    clientBetaSession = signSession({ type: 'client', id: '22', name: 'Cliente Beta', phone: '11912345678' }, 3600);
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
});

// ============================================================================
// FASE 2: TELEFONES DAS CLIENTES — 24 VETORES DE EXTRAÇÃO (RED TEAM ADVERSARIAL)
// ============================================================================
test('ADV-01: Unauthorized collaborator receives masked phone in GET /api/appointments', async () => {
    const res = await fetch(`${baseUrl}/api/appointments`, {
        headers: { cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    for (const appt of body.data) {
        assert.equal(appt.client_phone, 'Telefone protegido 🔒');
        assert.ok(!JSON.stringify(appt).includes('11987654321'), 'Raw phone must never appear in JSON payload');
    }
});

test('ADV-02: Unauthorized collaborator receives masked phone in GET /api/clients', async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
        headers: { cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const client of body.data) {
        assert.equal(client.phone, 'Telefone protegido 🔒');
    }
});

test('ADV-03: Unauthorized collaborator receives masked phone in GET /api/clients/check/:phone', async () => {
    const res = await fetch(`${baseUrl}/api/clients/check/11987654321`, {
        headers: { cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.phone, 'Telefone protegido 🔒');
});

test('ADV-04: Submitting placeholder phone does not overwrite real phone in DB', async () => {
    const res = await fetch(`${baseUrl}/api/clients/21`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ name: 'Cliente Alpha Editado', phone: 'Telefone protegido 🔒' })
    });
    assert.equal(res.status, 200);
    const clientInDb = dbState.clients.find(c => c.id === 21);
    assert.equal(clientInDb.phone, '11987654321', 'Database phone must remain intact');
});

test('ADV-05: Unauthorized collaborator cannot modify real phone via PUT /api/clients/:id', async () => {
    const res = await fetch(`${baseUrl}/api/clients/21`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ name: 'Cliente Alpha Hacker', phone: '11999998888' })
    });
    assert.equal(res.status, 200);
    const clientInDb = dbState.clients.find(c => c.id === 21);
    assert.equal(clientInDb.phone, '11987654321', 'Unauthorized phone change must be ignored');
});

test('ADV-06: Query params bypass attempts (?can_view_phones=true) are ignored', async () => {
    const res = await fetch(`${baseUrl}/api/clients?can_view_phones=true&bypass=1`, {
        headers: { cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const client of body.data) {
        assert.equal(client.phone, 'Telefone protegido 🔒');
    }
});

test('ADV-07: Header spoofing attempts (x-is-owner / x-role) are ignored', async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
        headers: {
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            'x-is-owner': 'true',
            'x-role': 'admin',
            'x-override-privacy': 'true'
        }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const client of body.data) {
        assert.equal(client.phone, 'Telefone protegido 🔒');
    }
});

// ============================================================================
// FASE 3: BYPASS DE PERMISSÕES & PRIVACIDADE
// ============================================================================
test('ADV-08: Collaborator cannot alter privacy settings via PUT /api/settings', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ key: 'hide_client_phone_from_collaborators', value: 'false' })
    });
    assert.equal(res.status, 403);
});

test('ADV-09: Collaborator cannot add themselves to authorized_phone_viewer_ids', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ key: 'authorized_phone_viewer_ids', value: '["7", "8"]' })
    });
    assert.equal(res.status, 403);
});

test('ADV-10: Owner (Mariana) receives full unmasked phone numbers', async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
        headers: { cookie: `mary_session=${encodeURIComponent(ownerSession)}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data[0].phone, '11987654321');
});

test('ADV-11: Explicitly authorized collaborator (ID 7) receives full unmasked phone numbers', async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
        headers: { cookie: `mary_session=${encodeURIComponent(authorizedCollabSession)}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data[0].phone, '11987654321');
});

// ============================================================================
// FASE 4: IDOR / BOLA (TESTES DE ACESSO CRUZADO ENTRE ENTIDADES)
// ============================================================================
test('ADV-12: Client A cannot view Client B appointments via /api/clients/my-history', async () => {
    const res = await fetch(`${baseUrl}/api/clients/my-history`, {
        headers: { cookie: `mary_session=${encodeURIComponent(clientAlphaSession)}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const appt of body.data) {
        assert.equal(appt.client_phone, '11987654321');
        assert.notEqual(appt.client_phone, '11912345678');
    }
});

test('ADV-13: Client A cannot cancel Client B appointment via POST /api/appointments/:id/cancel', async () => {
    const res = await fetch(`${baseUrl}/api/appointments/102/cancel`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(clientAlphaSession)}`,
            origin: baseUrl
        }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'Você não pode desmarcar este compromisso.');
});

test('ADV-14: Client A cannot reschedule Client B appointment via PUT /api/appointments/:id/reschedule', async () => {
    const res = await fetch(`${baseUrl}/api/appointments/102/reschedule`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(clientAlphaSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ date: futureDate, time: '11:00' })
    });
    assert.equal(res.status, 403);
});

test('ADV-15: Collaborator 8 cannot edit profile of Collaborator 7 via PUT /api/professionals/:id', async () => {
    const res = await fetch(`${baseUrl}/api/professionals/7`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ name: 'Hacked Name', specialty: 'Unhas', avatar: 'HN', username: 'autorizada' })
    });
    assert.equal(res.status, 403);
});

// ============================================================================
// FASE 5: ESCALONAMENTO DE PRIVILÉGIOS (PRIVILEGE ESCALATION)
// ============================================================================
test('ADV-16: Collaborator cannot create service (POST /api/services)', async () => {
    const res = await fetch(`${baseUrl}/api/services`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ name: 'Serviço Fake', duration: 30, price: 100 })
    });
    assert.equal(res.status, 403);
});

test('ADV-17: Collaborator cannot delete service (DELETE /api/services/:id)', async () => {
    const res = await fetch(`${baseUrl}/api/services/11`, {
        method: 'DELETE',
        headers: {
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        }
    });
    assert.equal(res.status, 403);
});

test('ADV-18: Collaborator cannot create new professional (POST /api/professionals)', async () => {
    const res = await fetch(`${baseUrl}/api/professionals`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({ name: 'Nova Pro', avatar: 'NP', specialty: 'Unhas', username: 'novapro', password: 'password123' })
    });
    assert.equal(res.status, 403);
});

test('ADV-19: Collaborator cannot access financial stats (GET /api/financial/stats)', async () => {
    const res = await fetch(`${baseUrl}/api/financial/stats`, {
        headers: { cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}` }
    });
    assert.equal(res.status, 403);
});

test('ADV-20: Collaborator cannot clear notifications (POST /api/notifications/clear)', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/clear`, {
        method: 'POST',
        headers: {
            cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}`,
            origin: baseUrl
        }
    });
    assert.equal(res.status, 403);
});

test('ADV-21: Collaborator cannot access audit logs (GET /api/settings/audit-logs)', async () => {
    const res = await fetch(`${baseUrl}/api/settings/audit-logs`, {
        headers: { cookie: `mary_session=${encodeURIComponent(unauthorizedCollabSession)}` }
    });
    assert.equal(res.status, 403);
});

// ============================================================================
// FASE 6: SESSÕES, TOKENS & CSRF
// ============================================================================
test('ADV-22: Tampered HMAC session token is strictly rejected (401)', async () => {
    const tampered = unauthorizedCollabSession.slice(0, -5) + 'AAAAA';
    const res = await fetch(`${baseUrl}/api/clients`, {
        headers: { cookie: `mary_session=${encodeURIComponent(tampered)}` }
    });
    assert.equal(res.status, 401);
});

test('ADV-23: Forged role elevation in session payload fails signature verification', async () => {
    const [body, sig] = unauthorizedCollabSession.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.role = 'admin';
    const forgedBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forgedToken = `${forgedBody}.${sig}`;

    const res = await fetch(`${baseUrl}/api/financial/stats`, {
        headers: { cookie: `mary_session=${encodeURIComponent(forgedToken)}` }
    });
    assert.equal(res.status, 401);
});

test('ADV-24: Forged action token is rejected on appointment cancellation', async () => {
    const res = await fetch(`${baseUrl}/api/appointments/101/cancel`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin: baseUrl
        },
        body: JSON.stringify({ token: 'v2.forgedTokenSignature' })
    });
    assert.equal(res.status, 403);
});

test('ADV-25: Action token for Appt 101 cannot be reused to cancel Appt 102', async () => {
    const tokenFor101 = createAppointmentToken(101, 3600);
    const res = await fetch(`${baseUrl}/api/appointments/102/cancel`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin: baseUrl
        },
        body: JSON.stringify({ token: tokenFor101 })
    });
    assert.equal(res.status, 403);
});

test('ADV-26: Cross-Site Request Forgery (CSRF) write is rejected (403)', async () => {
    const res = await fetch(`${baseUrl}/api/appointments/101/cancel`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(clientAlphaSession)}`,
            'sec-fetch-site': 'cross-site',
            origin: 'https://attacker.com'
        }
    });
    assert.equal(res.status, 403);
});

// ============================================================================
// FASE 7: XSS PAYLOADS & TEXT SANITIZATION
// ============================================================================
test('ADV-27: Benign XSS in block description is safely stored without control chars and bounded', async () => {
    const xssPayload = '<script>alert("xss")</script>\u0000\u0007';
    const res = await fetch(`${baseUrl}/api/appointments/block`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mary_session=${encodeURIComponent(ownerSession)}`,
            origin: baseUrl
        },
        body: JSON.stringify({
            professional_id: '1',
            date: futureDate,
            time: '18:00',
            duration: 30,
            description: xssPayload
        })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(!body.data.notes.includes('\u0000'));
    assert.ok(body.data.notes.includes('BLOCK:30|<script>alert("xss")</script>'));
});

// ============================================================================
// FASE 8 & 12: INPUT TAMPERING & ERROR DISCLOSURE
// ============================================================================
test('ADV-28: Malformed JSON body is handled cleanly with 400 and zero stack trace', async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: '{ "username": "admin", "password": ' // incomplete json
    });
    assert.equal(res.status, 400);
    const body = await res.text();
    assert.ok(!body.includes('SyntaxError'));
    assert.ok(!body.includes('at ')); // no stack traces
});

test('ADV-29: Negative ID in route returns clean 404 without database error leak', async () => {
    const res = await fetch(`${baseUrl}/api/appointments/-9999`, {
        method: 'DELETE',
        headers: {
            cookie: `mary_session=${encodeURIComponent(adminSession)}`,
            origin: baseUrl
        }
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Agendamento não encontrado.');
});

test('ADV-30: Oversized payload (>32kb) is rejected with 413 and clean message', async () => {
    const hugeString = 'A'.repeat(40 * 1024);
    const res = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ username: 'admin', password: hugeString })
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.error, 'Os dados enviados são muito grandes.');
});

// ============================================================================
// FASE 10 & 11: SECRETS SCAN & FRONTEND BUNDLE AUDIT
// ============================================================================
test('ADV-31: Static scan verifies zero Supabase secret key or Session secret in frontend code', () => {
    const frontendSrc = path.join(__dirname, '..', 'frontend', 'src');
    const files = fs.readdirSync(frontendSrc, { recursive: true });
    for (const file of files) {
        const fullPath = path.join(frontendSrc, file);
        if (fs.statSync(fullPath).isFile() && /\.(js|jsx|ts|tsx|json)$/.test(file)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            assert.ok(!content.includes('SUPABASE_SECRET_KEY'), `Secret key found in ${file}`);
            assert.ok(!content.includes('SESSION_SECRET'), `Session secret found in ${file}`);
            assert.ok(!content.includes('service_role'), `Service role found in ${file}`);
        }
    }
});
