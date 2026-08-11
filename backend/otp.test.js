const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestCredential } = require('./fixtures');
const {
    createMetaWhatsAppSender,
    createOtpManager,
    isWhatsAppProviderConfigured
} = require('./otp');

class MemoryOtpStore {
    constructor() {
        this.records = [];
        this.nextId = 1;
    }

    async findActiveByPhoneHash(phoneHash) {
        return [...this.records].reverse().find(record => (
            record.phone_hash === phoneHash && !record.consumed_at
        )) || null;
    }

    async countRecentByPhoneHash(phoneHash, since) {
        return this.records.filter(record => (
            record.phone_hash === phoneHash && new Date(record.created_at) >= new Date(since)
        )).length;
    }

    async invalidateByPhoneHash(phoneHash, consumedAt) {
        for (const record of this.records) {
            if (record.phone_hash === phoneHash && !record.consumed_at) record.consumed_at = consumedAt;
        }
    }

    async create(record) {
        this.records.push({ id: this.nextId++, consumed_at: null, ...record });
    }

    async consume({ phoneHash, codeHash, now }) {
        const record = await this.findActiveByPhoneHash(phoneHash);
        if (!record) return { status: 'invalid', clientId: null };
        if (new Date(record.expires_at) <= new Date(now)) {
            record.consumed_at = now;
            return { status: 'expired', clientId: null };
        }
        if (record.attempts >= record.max_attempts) {
            record.consumed_at = now;
            return { status: 'too_many_attempts', clientId: null };
        }
        if (record.code_hash !== codeHash) {
            record.attempts += 1;
            if (record.attempts >= record.max_attempts) {
                record.consumed_at = now;
                return { status: 'too_many_attempts', clientId: null };
            }
            return { status: 'invalid', clientId: null };
        }
        record.consumed_at = now;
        return { status: 'verified', clientId: record.client_id };
    }
}

const TEST_SECRET = createTestCredential();

test('detects whether all WhatsApp Cloud API settings are present', () => {
    assert.equal(isWhatsAppProviderConfigured({}), false);
    assert.equal(isWhatsAppProviderConfigured({
        WHATSAPP_ACCESS_TOKEN: 'token',
        WHATSAPP_PHONE_NUMBER_ID: '123',
        WHATSAPP_OTP_TEMPLATE_NAME: 'login_code',
        WHATSAPP_GRAPH_API_VERSION: 'v99.0'
    }), true);
});

test('stores only keyed hashes, sends a six-digit code and consumes it once', async () => {
    const store = new MemoryOtpStore();
    const deliveries = [];
    const manager = createOtpManager({
        store,
        sendCode: async delivery => deliveries.push(delivery),
        secret: TEST_SECRET,
        now: () => Date.parse('2026-08-03T12:00:00Z'),
        randomInt: () => 123456
    });

    const request = await manager.requestCode({ phone: '11987654321', clientId: 7 });
    assert.equal(request.accepted, true);
    assert.deepEqual(deliveries, [{ phone: '11987654321', code: '123456' }]);
    assert.equal(store.records.length, 1);
    assert.equal(store.records[0].phone, undefined);
    assert.equal(store.records[0].code, undefined);
    assert.notEqual(store.records[0].code_hash, '123456');
    assert.match(store.records[0].code_hash, /^[A-Za-z0-9_-]{40,}$/);

    assert.deepEqual(await manager.verifyCode({ phone: '11987654321', code: '123456' }), {
        status: 'verified',
        clientId: '7'
    });
    assert.deepEqual(await manager.verifyCode({ phone: '11987654321', code: '123456' }), {
        status: 'invalid',
        clientId: null
    });
});

test('uses decoy challenges, resend cooldown, expiry and an attempt ceiling', async () => {
    let clock = Date.parse('2026-08-03T12:00:00Z');
    let generatedCode = 111111;
    const store = new MemoryOtpStore();
    const deliveries = [];
    const manager = createOtpManager({
        store,
        sendCode: async delivery => deliveries.push(delivery),
        secret: TEST_SECRET,
        now: () => clock,
        randomInt: () => generatedCode,
        ttlMs: 5 * 60 * 1000,
        resendCooldownMs: 60 * 1000,
        maxAttempts: 2
    });

    await manager.requestCode({ phone: '11888887777', clientId: null });
    assert.equal(store.records.length, 1);
    assert.equal(deliveries.length, 0);

    await manager.requestCode({ phone: '11888887777', clientId: null });
    assert.equal(store.records.length, 1, 'cooldown must reuse the active challenge');

    clock += 61 * 1000;
    generatedCode = 222222;
    await manager.requestCode({ phone: '11888887777', clientId: 9 });
    assert.equal(store.records.length, 2);
    assert.equal(deliveries[0].code, '222222');

    assert.equal((await manager.verifyCode({ phone: '11888887777', code: '000000' })).status, 'invalid');
    assert.equal((await manager.verifyCode({ phone: '11888887777', code: '000000' })).status, 'too_many_attempts');

    clock += 61 * 1000;
    generatedCode = 333333;
    await manager.requestCode({ phone: '11777776666', clientId: 10 });
    clock += 5 * 60 * 1000;
    assert.equal((await manager.verifyCode({ phone: '11777776666', code: '333333' })).status, 'expired');
});

test('limits resends per phone even when requests come from different IP addresses', async () => {
    let clock = Date.parse('2026-08-03T12:00:00Z');
    const store = new MemoryOtpStore();
    const deliveries = [];
    const manager = createOtpManager({
        store,
        sendCode: async delivery => deliveries.push(delivery),
        secret: TEST_SECRET,
        now: () => clock,
        randomInt: () => 444444,
        resendCooldownMs: 1,
        sendWindowMs: 15 * 60 * 1000,
        maxSendsPerWindow: 2
    });

    await manager.requestCode({ phone: '11666665555', clientId: 11 });
    clock += 2;
    await manager.requestCode({ phone: '11666665555', clientId: 11 });
    clock += 2;
    await manager.requestCode({ phone: '11666665555', clientId: 11 });

    assert.equal(deliveries.length, 2);
    assert.equal(store.records.length, 2);
});

test('Meta adapter sends only the approved template payload', async () => {
    let request;
    const sender = createMetaWhatsAppSender({
        accessToken: 'secret-token',
        phoneNumberId: '123456789',
        templateName: 'client_login_code',
        templateLanguage: 'pt_BR',
        graphApiVersion: 'v99.0',
        fetchImpl: async (url, options) => {
            request = { url, options };
            return { ok: true, status: 200 };
        }
    });

    await sender({ phone: '11987654321', code: '654321' });
    assert.equal(request.url, 'https://graph.facebook.com/v99.0/123456789/messages');
    assert.equal(request.options.headers.authorization, 'Bearer secret-token');
    const body = JSON.parse(request.options.body);
    assert.equal(body.to, '5511987654321');
    assert.equal(body.template.name, 'client_login_code');
    assert.equal(body.template.components[0].parameters[0].text, '654321');
});
