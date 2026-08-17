const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createTestCredential } = require('./fixtures');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = createTestCredential();
delete process.env.SESSION_SECRET;

const { hashPassword } = require('./security');

const STAFF = { id: 1, name: 'Mariana', role: 'admin', avatar: 'M', username: 'mari', specialty: 'Nails', status: 'ativo' };
const CORRECT_PASSWORD = 'senha-correta-do-teste';

const CREDENTIAL_FAILURE_MAX = 5;
const GENERAL_LOGIN_MAX = 30;

const tables = {
    professionals: [{ ...STAFF, password: 'placeholder' }],
    clients: [],
    settings: [],
    refresh_tokens: [],
    audit_logs: []
};

function createQueryBuilder(table) {
    if (!tables[table]) tables[table] = [];
    const filters = [];
    let operation = { type: 'select' };
    let sequence = 9000;

    const selectRows = () => tables[table].filter(row => filters.every(filter => {
        const value = row[filter.column];
        if (filter.op === 'eq') return String(value) === String(filter.value);
        if (filter.op === 'ilike') return String(value ?? '').toLowerCase() === String(filter.value).replace(/%/g, '').toLowerCase();
        if (filter.op === 'is') return filter.value === null ? (value === null || value === undefined) : value === filter.value;
        return true;
    }));

    function run() {
        if (operation.type === 'insert') {
            const inserted = operation.rows.map(row => {
                const created = { ...row };
                if (created.id === undefined) created.id = (sequence += 1);
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
        return { data: selectRows().map(row => ({ ...row })), error: null };
    }

    const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        or: () => builder,
        eq(column, value) { filters.push({ op: 'eq', column, value }); return builder; },
        neq: () => builder,
        is(column, value) { filters.push({ op: 'is', column, value }); return builder; },
        in: () => builder,
        gte: () => builder,
        lte: () => builder,
        ilike(column, value) { filters.push({ op: 'ilike', column, value }); return builder; },
        insert(rows) { operation = { type: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return builder; },
        update(patch) { operation = { type: 'update', patch }; return builder; },
        upsert(rows) { operation = { type: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return builder; },
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

const originalLoad = Module._load;
Module._load = function loadWithMockedSupabase(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
        return { createClient: () => ({ from: createQueryBuilder }) };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const app = require('./server');
Module._load = originalLoad;

let server;
let baseUrl;

test.before(async () => {
    tables.professionals[0].password = await hashPassword(CORRECT_PASSWORD);
    server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
});

/**
 * Every scenario runs from its own synthetic client address. The buckets are
 * keyed by IP, so a dedicated address per test keeps the counters isolated and
 * the assertions deterministic.
 */
function login({ ip, username = STAFF.username, password = CORRECT_PASSWORD }) {
    return fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: {
            origin: baseUrl,
            'content-type': 'application/json',
            'x-forwarded-for': ip
        },
        body: JSON.stringify({ username, password })
    });
}

function describeLimit(response) {
    return {
        status: response.status,
        bucket: response.headers.get('x-ratelimit-bucket'),
        remaining: response.headers.get('x-ratelimit-remaining'),
        retryAfter: response.headers.get('retry-after')
    };
}

test('bucket A blocks after five consecutive credential failures for the same IP and username', async () => {
    const ip = '203.0.113.10';

    for (let attempt = 1; attempt <= CREDENTIAL_FAILURE_MAX; attempt += 1) {
        const response = await login({ ip, password: 'senha-errada' });
        assert.equal(response.status, 401, `attempt ${attempt} should still be evaluated`);
        assert.equal(describeLimit(response).bucket, 'credential-failure');
        assert.equal(response.headers.get('x-ratelimit-remaining'), String(CREDENTIAL_FAILURE_MAX - attempt));
    }

    const blocked = await login({ ip, password: 'senha-errada' });
    assert.equal(blocked.status, 429);
    assert.equal(describeLimit(blocked).bucket, 'credential-failure');
    assert.ok(blocked.headers.get('retry-after'), 'a 429 must tell the client when to retry');
    assert.match((await blocked.json()).error, /credencial incorreta/i);
});

test('bucket A is keyed per username, so one attacked account does not lock another', async () => {
    const ip = '203.0.113.11';

    for (let attempt = 0; attempt < CREDENTIAL_FAILURE_MAX + 1; attempt += 1) {
        await login({ ip, username: 'alvo_do_ataque', password: 'senha-errada' });
    }
    const attacked = await login({ ip, username: 'alvo_do_ataque', password: 'senha-errada' });
    assert.equal(attacked.status, 429, 'the attacked username must be throttled');

    // Same IP, different username: its own counter is untouched.
    const other = await login({ ip, username: 'outra_pessoa', password: 'senha-errada' });
    assert.equal(other.status, 401);
    assert.notEqual(other.status, 429);
});

test('a successful login clears bucket A for that IP and username', async () => {
    const ip = '203.0.113.12';

    for (let attempt = 0; attempt < CREDENTIAL_FAILURE_MAX - 1; attempt += 1) {
        const failure = await login({ ip, password: 'senha-errada' });
        assert.equal(failure.status, 401);
    }

    const success = await login({ ip });
    assert.equal(success.status, 200, await success.text());

    // The counter restarted, so the full failure budget is available again.
    for (let attempt = 1; attempt <= CREDENTIAL_FAILURE_MAX; attempt += 1) {
        const afterReset = await login({ ip, password: 'senha-errada' });
        assert.equal(afterReset.status, 401, `attempt ${attempt} after the reset must not be throttled`);
        assert.equal(afterReset.headers.get('x-ratelimit-remaining'), String(CREDENTIAL_FAILURE_MAX - attempt));
    }

    const blockedAgain = await login({ ip, password: 'senha-errada' });
    assert.equal(blockedAgain.status, 429, 'the bucket must still close once the new budget runs out');
});

test('consecutive correct logins never trip bucket A', async () => {
    const ip = '203.0.113.13';

    for (let attempt = 1; attempt <= 12; attempt += 1) {
        const response = await login({ ip });
        assert.equal(response.status, 200, `successful login ${attempt} must not be throttled`);
        // Reset on success means each attempt sees a full budget minus itself.
        assert.equal(response.headers.get('x-ratelimit-remaining'), String(CREDENTIAL_FAILURE_MAX - 1));
    }
});

test('bucket B caps total login volume per IP regardless of the username used', async () => {
    const ip = '203.0.113.14';

    // A fresh username each time keeps bucket A at one hit, isolating bucket B.
    for (let attempt = 1; attempt <= GENERAL_LOGIN_MAX; attempt += 1) {
        const response = await login({ ip, username: `usuario_${attempt}`, password: 'senha-errada' });
        assert.notEqual(response.status, 429, `login ${attempt} must fit inside the volume budget`);
    }

    const blocked = await login({ ip, username: 'usuario_31', password: 'senha-errada' });
    assert.equal(blocked.status, 429);
    assert.equal(describeLimit(blocked).bucket, 'general-login', 'the volume bucket must be the one that rejects');
    assert.ok(blocked.headers.get('retry-after'));
    assert.match((await blocked.json()).error, /volume excessivo/i);
});

test('bucket B counts successful logins too', async () => {
    const ip = '203.0.113.15';

    for (let attempt = 1; attempt <= GENERAL_LOGIN_MAX; attempt += 1) {
        const response = await login({ ip });
        assert.equal(response.status, 200, `successful login ${attempt} must be accepted`);
    }

    const blocked = await login({ ip });
    assert.equal(blocked.status, 429, 'volume protection applies even to valid credentials');
    assert.equal(describeLimit(blocked).bucket, 'general-login');
});

test('GET /api/session does not consume either login bucket', async () => {
    const ip = '203.0.113.16';

    for (let call = 0; call < 20; call += 1) {
        const response = await fetch(`${baseUrl}/api/session`, { headers: { 'x-forwarded-for': ip } });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('x-ratelimit-bucket'), null, 'session must not report a login bucket');
    }

    // Bucket A still has its full budget.
    const firstLogin = await login({ ip, password: 'senha-errada' });
    assert.equal(firstLogin.status, 401);
    assert.equal(firstLogin.headers.get('x-ratelimit-remaining'), String(CREDENTIAL_FAILURE_MAX - 1));
});

test('POST /api/auth/refresh does not consume either login bucket', async () => {
    const ip = '203.0.113.17';

    for (let call = 0; call < 20; call += 1) {
        const response = await fetch(`${baseUrl}/api/auth/refresh`, {
            method: 'POST',
            headers: { origin: baseUrl, 'content-type': 'application/json', 'x-forwarded-for': ip },
            body: '{}'
        });
        assert.equal(response.status, 401);
        assert.equal((await response.json()).code, 'REFRESH_INVALID');
    }

    const firstLogin = await login({ ip, password: 'senha-errada' });
    assert.equal(firstLogin.status, 401);
    assert.equal(firstLogin.headers.get('x-ratelimit-remaining'), String(CREDENTIAL_FAILURE_MAX - 1));
});

test('session and refresh traffic leaves the full login volume budget intact', async () => {
    const ip = '203.0.113.18';

    for (let call = 0; call < 15; call += 1) {
        await fetch(`${baseUrl}/api/session`, { headers: { 'x-forwarded-for': ip } });
        await fetch(`${baseUrl}/api/auth/refresh`, {
            method: 'POST',
            headers: { origin: baseUrl, 'content-type': 'application/json', 'x-forwarded-for': ip },
            body: '{}'
        });
    }

    // If either endpoint had touched bucket B, this loop would be cut short.
    for (let attempt = 1; attempt <= GENERAL_LOGIN_MAX; attempt += 1) {
        const response = await login({ ip, username: `volume_${attempt}`, password: 'senha-errada' });
        assert.notEqual(response.status, 429, `login ${attempt} must still fit the volume budget`);
    }

    const blocked = await login({ ip, username: 'volume_31', password: 'senha-errada' });
    assert.equal(blocked.status, 429);
    assert.equal(describeLimit(blocked).bucket, 'general-login');
});

test('the reset still finds the bucket behind a multi-hop proxy chain', async () => {
    // Production sits behind more than one proxy, so X-Forwarded-For arrives as a
    // list. The limiter keys on the leftmost entry; anything deriving the key a
    // different way (for instance Express req.ip, which honours trust proxy and
    // returns a hop further right) would reset a bucket that was never filled.
    const chain = '203.0.113.21, 70.41.3.18, 150.172.238.178';

    const failUntilOneLeft = async () => {
        for (let attempt = 0; attempt < CREDENTIAL_FAILURE_MAX - 1; attempt += 1) {
            const response = await fetch(`${baseUrl}/api/login`, {
                method: 'POST',
                headers: { origin: baseUrl, 'content-type': 'application/json', 'x-forwarded-for': chain },
                body: JSON.stringify({ username: STAFF.username, password: 'senha-errada' })
            });
            assert.equal(response.status, 401);
        }
    };

    const attempt = (password) => fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { origin: baseUrl, 'content-type': 'application/json', 'x-forwarded-for': chain },
        body: JSON.stringify({ username: STAFF.username, password })
    });

    await failUntilOneLeft();
    const success = await attempt(CORRECT_PASSWORD);
    assert.equal(success.status, 200);

    const afterReset = await attempt('senha-errada');
    assert.equal(afterReset.status, 401, 'the successful login must have cleared the bucket');
    assert.equal(
        afterReset.headers.get('x-ratelimit-remaining'),
        String(CREDENTIAL_FAILURE_MAX - 1),
        'the counter must restart from zero, proving both sides derived the same key'
    );
});

test('the two buckets stay independent across separate client addresses', async () => {
    const attacker = '203.0.113.19';
    const bystander = '203.0.113.20';

    for (let attempt = 0; attempt < CREDENTIAL_FAILURE_MAX + 1; attempt += 1) {
        await login({ ip: attacker, password: 'senha-errada' });
    }
    const throttled = await login({ ip: attacker, password: 'senha-errada' });
    assert.equal(throttled.status, 429);

    // The same username from a different address must still be able to sign in.
    const legitimate = await login({ ip: bystander });
    assert.equal(legitimate.status, 200, 'one abusive IP must not lock the account globally');
});
