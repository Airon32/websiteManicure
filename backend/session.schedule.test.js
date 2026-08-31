const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createTestCredential } = require('./fixtures');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = createTestCredential();
delete process.env.SESSION_SECRET;

const { signSession, ACCESS_TTL, REFRESH_TTL } = require('./security');

const STAFF_ADMIN = { id: 1, name: 'Mariana', role: 'admin', avatar: 'M', username: 'mari', specialty: 'Nails', status: 'ativo' };
const STAFF_COLLABORATOR = { id: 7, name: 'Colaboradora', role: 'professional', avatar: 'C', username: 'colab', specialty: 'Pés', status: 'ativo' };
const CLIENT = { id: 21, name: 'Cliente Teste', phone: '11987654321' };

function seedRows() {
    return {
        professionals: [{ ...STAFF_ADMIN }, { ...STAFF_COLLABORATOR }],
        clients: [{ ...CLIENT }],
        services: [{ id: 11, name: 'Manicure', duration: 60, price: 50, status: 'ativo' }],
        settings: [{ key: 'max_advance_days', value: '60' }, { key: 'allow_online_booking', value: 'true' }],
        refresh_tokens: [],
        appointments: [],
        audit_logs: [],
        notifications: []
    };
}

function matchesFilter(row, filter) {
    const value = row[filter.column];
    switch (filter.op) {
        case 'eq': return String(value) === String(filter.value);
        case 'neq': return String(value) !== String(filter.value);
        case 'is': return filter.value === null ? (value === null || value === undefined) : value === filter.value;
        case 'in': return filter.value.map(String).includes(String(value));
        case 'gte': return value >= filter.value;
        case 'lte': return value <= filter.value;
        case 'ilike': return String(value ?? '').toLowerCase() === String(filter.value).replace(/%/g, '').toLowerCase();
        default: return true;
    }
}

/**
 * Minimal in-memory stand-in for the Supabase client. It keeps real rows so the
 * refresh token lifecycle (insert, rotate, revoke) can be asserted directly.
 */
function createSupabaseMock() {
    const tables = seedRows();
    let sequence = 5000;

    function from(table) {
        if (!tables[table]) tables[table] = [];
        const filters = [];
        let operation = { type: 'select' };

        const selectRows = () => tables[table].filter(row => filters.every(filter => matchesFilter(row, filter)));

        function run() {
            if (operation.type === 'insert') {
                const inserted = operation.rows.map(row => {
                    const created = { ...row };
                    if (created.id === undefined || created.id === null) {
                        sequence += 1;
                        created.id = sequence;
                    }
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
            is(column, value) { filters.push({ op: 'is', column, value }); return builder; },
            in(column, value) { filters.push({ op: 'in', column, value }); return builder; },
            gte(column, value) { filters.push({ op: 'gte', column, value }); return builder; },
            lte(column, value) { filters.push({ op: 'lte', column, value }); return builder; },
            ilike(column, value) { filters.push({ op: 'ilike', column, value }); return builder; },
            or: () => builder,
            insert(rows) { operation = { type: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return builder; },
            update(patch) { operation = { type: 'update', patch }; return builder; },
            upsert(rows) { operation = { type: 'upsert', rows: Array.isArray(rows) ? rows : [rows] }; return builder; },
            delete() { operation = { type: 'select' }; return builder; },
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
Module._load = function loadWithMockedSupabase(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
        return { createClient: () => mock.client };
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

function parseCookies(response) {
    const jar = {};
    for (const header of response.headers.getSetCookie()) {
        const [pair, ...attributes] = header.split(';');
        const separator = pair.indexOf('=');
        jar[pair.slice(0, separator).trim()] = {
            value: decodeURIComponent(pair.slice(separator + 1).trim()),
            attributes: attributes.map(attribute => attribute.trim())
        };
    }
    return jar;
}

function cookieHeader(jar) {
    return Object.entries(jar)
        .filter(([, cookie]) => cookie.value)
        .map(([name, cookie]) => `${name}=${encodeURIComponent(cookie.value)}`)
        .join('; ');
}

function post(path, { cookies, body } = {}) {
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            origin: baseUrl,
            'content-type': 'application/json',
            ...(cookies ? { cookie: typeof cookies === 'string' ? cookies : cookieHeader(cookies) } : {})
        },
        body: JSON.stringify(body ?? {})
    });
}

function put(path, body, cookies) {
    return fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: {
            origin: baseUrl,
            'content-type': 'application/json',
            ...(cookies ? { cookie: typeof cookies === 'string' ? cookies : cookieHeader(cookies) } : {})
        },
        body: JSON.stringify(body)
    });
}

function get(path, cookies) {
    return fetch(`${baseUrl}${path}`, {
        headers: cookies ? { cookie: typeof cookies === 'string' ? cookies : cookieHeader(cookies) } : {}
    });
}

function staffCookie(professional = STAFF_ADMIN, ttlSeconds = ACCESS_TTL) {
    return `mary_session=${encodeURIComponent(signSession({ type: 'staff', id: String(professional.id), role: professional.role }, ttlSeconds))}`;
}

function clientCookie(client = CLIENT, ttlSeconds = ACCESS_TTL) {
    return `mary_session=${encodeURIComponent(signSession({
        type: 'client',
        id: String(client.id),
        name: client.name,
        phone: client.phone
    }, ttlSeconds))}`;
}

function tokensOf(userId, userType) {
    return mock.tables.refresh_tokens.filter(row => String(row.user_id) === String(userId) && row.user_type === userType);
}

async function issueRefreshSession(userId = STAFF_ADMIN.id, userType = 'staff') {
    const response = await post('/api/auth/refresh');
    assert.equal(response.status, 401, 'sanity: no cookie means no session');
    const created = await require('./security').createRefreshToken(mock.client, String(userId), userType, REFRESH_TTL);
    return created;
}

test('login issues access, refresh and the UX flag cookie in the same response', async () => {
    mock.tables.refresh_tokens.length = 0;
    // The stored hash is scrypt based, so login goes through the legacy branch.
    const professional = mock.tables.professionals.find(row => row.id === STAFF_ADMIN.id);
    professional.password = 'senha-super-secreta';

    const response = await post('/api/login', { body: { username: 'mari', password: 'senha-super-secreta' } });
    assert.equal(response.status, 200);

    const jar = parseCookies(response);
    // Regression: three sequential Set-Cookie writes used to overwrite each other.
    assert.ok(jar.mary_session?.value, 'access cookie must be present');
    assert.ok(jar.mary_refresh?.value, 'refresh cookie must be present');
    assert.equal(jar.has_active_staff_session?.value, 'true');

    assert.ok(jar.mary_session.attributes.includes('HttpOnly'));
    assert.ok(jar.mary_refresh.attributes.includes('HttpOnly'));
    assert.ok(jar.mary_refresh.attributes.includes('SameSite=Lax'));
    assert.ok(jar.mary_refresh.attributes.includes(`Max-Age=${REFRESH_TTL}`));

    assert.equal(tokensOf(STAFF_ADMIN.id, 'staff').length, 1, 'refresh token must be persisted');
});

test('session reports needsRefresh when the access token expired but the refresh token lives', async () => {
    mock.tables.refresh_tokens.length = 0;
    const created = await issueRefreshSession();

    const expiredAccess = staffCookie(STAFF_ADMIN, -60);
    const response = await get('/api/session', `${expiredAccess}; mary_refresh=${encodeURIComponent(created.token)}`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Sessão não encontrada.', needsRefresh: true });
});

test('session reports needsRefresh false when there is no refresh token at all', async () => {
    const response = await get('/api/session');
    assert.equal(response.status, 401);
    assert.equal((await response.json()).needsRefresh, false);
});

test('refresh rotates the token, links the replacement and returns the staff identity', async () => {
    mock.tables.refresh_tokens.length = 0;
    const created = await issueRefreshSession();

    const response = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.data.type, 'staff');
    assert.equal(payload.data.name, 'Mariana');
    assert.equal(payload.data.is_owner, true);

    const jar = parseCookies(response);
    assert.ok(jar.mary_session?.value, 'a fresh access cookie must be issued');
    assert.ok(jar.mary_refresh?.value, 'a rotated refresh cookie must be issued');
    assert.notEqual(jar.mary_refresh.value, created.token, 'the refresh token must change on every use');
    assert.equal(jar.has_active_staff_session?.value, 'true');

    const stored = tokensOf(STAFF_ADMIN.id, 'staff');
    assert.equal(stored.length, 2, 'rotation keeps the old row and adds the replacement');
    const previous = stored.find(row => row.id === created.id);
    assert.ok(previous.revoked_at, 'the presented token must be revoked');
    assert.ok(previous.replaced_by_token_id, 'the replacement must be linked for audit');
});

test('refresh accepts a client token and returns the client identity', async () => {
    mock.tables.refresh_tokens.length = 0;
    const created = await issueRefreshSession(CLIENT.id, 'client');

    const response = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        message: 'success',
        data: { type: 'client', name: 'Cliente Teste', phone: '11987654321' }
    });
});

test('replaying a rotated refresh token revokes the whole family', async () => {
    mock.tables.refresh_tokens.length = 0;
    const created = await issueRefreshSession();

    const rotation = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });
    assert.equal(rotation.status, 200);

    // Age the revocation past the race grace window so the replay looks like theft.
    const previous = tokensOf(STAFF_ADMIN.id, 'staff').find(row => row.id === created.id);
    previous.revoked_at = new Date(Date.now() - 60 * 1000).toISOString();

    const replay = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).code, 'REFRESH_INVALID');

    const live = tokensOf(STAFF_ADMIN.id, 'staff').filter(row => !row.revoked_at);
    assert.equal(live.length, 0, 'a leaked lineage must leave no usable token behind');

    const jar = parseCookies(replay);
    assert.equal(jar.mary_session.value, '');
    assert.equal(jar.mary_refresh.value, '');
});

test('a rotated token replayed inside the grace window asks for a retry instead of killing the session', async () => {
    mock.tables.refresh_tokens.length = 0;
    const created = await issueRefreshSession();

    await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });
    const raced = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });

    assert.equal(raced.status, 401);
    assert.equal((await raced.json()).code, 'REFRESH_RETRY');
    const live = tokensOf(STAFF_ADMIN.id, 'staff').filter(row => !row.revoked_at);
    assert.equal(live.length, 1, 'the replacement issued by the winning request stays valid');
});

test('refresh refuses an expired token and a missing cookie', async () => {
    mock.tables.refresh_tokens.length = 0;

    const missing = await post('/api/auth/refresh');
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, 'REFRESH_INVALID');

    const expired = await require('./security').createRefreshToken(mock.client, String(STAFF_ADMIN.id), 'staff', -60);
    const response = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(expired.token)}` });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'REFRESH_INVALID');
});

test('refresh stops working for a deactivated professional', async () => {
    mock.tables.refresh_tokens.length = 0;
    const created = await issueRefreshSession(STAFF_COLLABORATOR.id, 'staff');
    const professional = mock.tables.professionals.find(row => row.id === STAFF_COLLABORATOR.id);
    professional.status = 'inativo';

    try {
        const response = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });
        assert.equal(response.status, 401);
        assert.equal((await response.json()).code, 'REFRESH_INVALID');
        assert.equal(tokensOf(STAFF_COLLABORATOR.id, 'staff').filter(row => !row.revoked_at).length, 0);
    } finally {
        professional.status = 'ativo';
    }
});

test('logout revokes the refresh token so it cannot renew a session again', async () => {
    mock.tables.refresh_tokens.length = 0;
    const created = await issueRefreshSession();

    const logout = await post('/api/logout', { cookies: `${staffCookie()}; mary_refresh=${encodeURIComponent(created.token)}` });
    assert.equal(logout.status, 200);
    assert.ok(tokensOf(STAFF_ADMIN.id, 'staff').every(row => row.revoked_at));

    const jar = parseCookies(logout);
    assert.equal(jar.mary_session.value, '');
    assert.equal(jar.mary_refresh.value, '');
    assert.equal(jar.has_active_staff_session.value, '');

    const afterLogout = await post('/api/auth/refresh', { cookies: `mary_refresh=${encodeURIComponent(created.token)}` });
    assert.equal(afterLogout.status, 401);
});

test('refresh is rate limited', async () => {
    let sawRateLimit = false;
    for (let attempt = 0; attempt < 60 && !sawRateLimit; attempt += 1) {
        const response = await post('/api/auth/refresh', { cookies: 'mary_refresh=nao-existe' });
        if (response.status === 429) {
            sawRateLimit = true;
            assert.ok(response.headers.get('retry-after'), 'a 429 must tell the client when to retry');
        }
    }
    assert.ok(sawRateLimit, 'repeated refresh attempts must eventually be throttled');
});

test('per-day expedient is stored expanded to the seven days', async () => {
    const response = await put('/api/settings', {
        key: 'schedule',
        value: { seg: { start: '09:00', end: '18:00' }, sab: { start: '09:00', end: '14:00' } }
    }, staffCookie());
    assert.equal(response.status, 200, await response.text());

    const stored = JSON.parse(mock.tables.settings.find(row => row.key === 'schedule').value);
    assert.deepEqual(stored, {
        dom: null,
        seg: { start: '09:00', end: '18:00' },
        ter: null,
        qua: null,
        qui: null,
        sex: null,
        sab: { start: '09:00', end: '14:00' }
    });
});

test('per-day expedient treats Folga, empty clocks and HH:MM:SS as a valid week', async () => {
    const response = await put('/api/settings', {
        key: 'schedule',
        value: {
            dom: { start: '', end: '', off: true },
            seg: { start: '', end: '', off: true },
            ter: { start: '', end: '', off: true },
            qua: { start: '', end: '', off: true },
            qui: { start: '', end: '', off: true },
            sex: { start: '07:00:00', end: '20:00:00', off: false },
            sab: { start: '', end: '', off: true }
        }
    }, staffCookie());
    assert.equal(response.status, 200, await response.text());

    const stored = JSON.parse(mock.tables.settings.find(row => row.key === 'schedule').value);
    assert.equal(stored.dom, null);
    assert.deepEqual(stored.sex, { start: '07:00', end: '20:00' });
    assert.equal(stored.sab, null);
});

test('empty per-day expedient clears the setting so flat hours remain the source', async () => {
    await put('/api/settings', {
        key: 'schedule',
        value: { sex: { start: '09:00', end: '18:00' } }
    }, staffCookie());

    const cleared = await put('/api/settings', { key: 'schedule', value: '' }, staffCookie());
    assert.equal(cleared.status, 200, await cleared.text());
    assert.equal(mock.tables.settings.find(row => row.key === 'schedule').value, '');
});

test('professional payload exposes the per-day schedule and a compatible flat envelope', async () => {
    mock.tables.settings = mock.tables.settings.filter(row => row.key !== 'schedule');
    await put('/api/settings', {
        key: `professional_${STAFF_COLLABORATOR.id}_schedule`,
        value: { ter: { start: '10:00', end: '19:00' }, sab: { start: '08:00', end: '14:00' } }
    }, staffCookie());

    const response = await get(`/api/professionals/${STAFF_COLLABORATOR.id}`);
    assert.equal(response.status, 200);
    const { data } = await response.json();

    assert.deepEqual(data.schedule.ter, { start: '10:00', end: '19:00' });
    assert.equal(data.schedule.qua, null);
    assert.deepEqual(Object.keys(data.schedule).sort(), ['dom', 'qua', 'qui', 'sab', 'seg', 'sex', 'ter']);
    assert.deepEqual(data.work_days, ['ter', 'sab']);
    // Widest window across the open days, so legacy clients stay permissive.
    assert.equal(data.work_start, '08:00');
    assert.equal(data.work_end, '19:00');
});

test('per-day expedient rejects malformed payloads', async () => {
    const cases = [
        [{ seg: { start: '18:00', end: '09:00' } }, 'end before start'],
        [{ seg: { start: '9h', end: '18:00' } }, 'unpadded time'],
        [{ segunda: { start: '09:00', end: '18:00' } }, 'unknown day key'],
        [{ dom: null, seg: null, ter: null, qua: null, qui: null, sex: null, sab: null }, 'no open day'],
        [[{ start: '09:00', end: '18:00' }], 'array instead of object'],
        [{ seg: 'aberto' }, 'day is not an object'],
        ['{seg:', 'broken json string']
    ];

    for (const [value, label] of cases) {
        const response = await put('/api/settings', { key: 'schedule', value }, staffCookie());
        assert.equal(response.status, 400, `expected 400 for ${label}`);
        assert.match((await response.json()).error, /expediente|Dia inválido|Horário|atendimento/i);
    }
});

test('a collaborator may set only their own per-day expedient', async () => {
    const own = await put('/api/settings', {
        key: `professional_${STAFF_COLLABORATOR.id}_schedule`,
        value: { qui: { start: '09:00', end: '17:00' } }
    }, staffCookie(STAFF_COLLABORATOR));
    assert.equal(own.status, 200);

    const someoneElse = await put('/api/settings', {
        key: `professional_${STAFF_ADMIN.id}_schedule`,
        value: { qui: { start: '09:00', end: '17:00' } }
    }, staffCookie(STAFF_COLLABORATOR));
    assert.equal(someoneElse.status, 403);
});

test('client booking enforces the per-day window instead of a single weekly range', async () => {
    mock.tables.settings = mock.tables.settings.filter(row => !row.key.endsWith('schedule'));
    mock.tables.settings.push({
        key: `professional_${STAFF_COLLABORATOR.id}_schedule`,
        value: JSON.stringify({ ter: { start: '09:00', end: '18:00' }, qua: null })
    });

    function getFutureWeekday(targetDay) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        while (d.getDay() !== targetDay) {
            d.setDate(d.getDate() + 1);
        }
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    const nextTue = getFutureWeekday(2);
    const nextWed = getFutureWeekday(3);

    const booking = (date, time) => post('/api/appointments', {
        cookies: clientCookie(),
        body: { date, time, professional_id: String(STAFF_COLLABORATOR.id), service_ids: [11] }
    });

    const closedDay = await booking(nextWed, '10:00');
    assert.equal(closedDay.status, 400);
    assert.match((await closedDay.json()).error, /não atende no dia/i);

    // The 60 minute service would end at 18:30, past Tuesday's 18:00 close.
    const afterHours = await booking(nextTue, '17:30');
    assert.equal(afterHours.status, 400);
    assert.match((await afterHours.json()).error, /fora do expediente/i);

    const withinHours = await booking(nextTue, '10:00');
    assert.equal(withinHours.status, 201, await withinHours.text());
});

test('a closed weekday produces no availability suggestion for that professional', async () => {
    mock.tables.settings = mock.tables.settings.filter(row => !row.key.endsWith('schedule'));
    mock.tables.settings.push({
        key: 'schedule',
        value: JSON.stringify({ dom: null, seg: null, ter: null, qua: null, qui: null, sex: null, sab: { start: '09:00', end: '14:00' } })
    });

    const response = await get('/api/availability/next?limit=8');
    assert.equal(response.status, 200);
    const { data } = await response.json();
    // Only Saturdays are open, so every suggestion must land on one.
    for (const suggestion of data) {
        const weekday = new Date(`${suggestion.date}T12:00:00Z`).getUTCDay();
        assert.equal(weekday, 6, `${suggestion.date} should not be offered`);
    }
});
