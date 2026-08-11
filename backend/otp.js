const crypto = require('crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RESEND_COOLDOWN_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_SEND_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_SENDS_PER_WINDOW = 5;

function deriveOtpKey(secret) {
    const source = String(secret || process.env.OTP_SECRET || process.env.SESSION_SECRET || '');
    if (source.length < 32) {
        throw new Error('Configure OTP_SECRET com pelo menos 32 caracteres.');
    }
    return crypto.createHash('sha256').update('mary-esmalteria/client-otp/v1').update(source).digest();
}

function digest(key, purpose, value) {
    return crypto.createHmac('sha256', key).update(purpose).update('\0').update(String(value)).digest('base64url');
}

function isWhatsAppProviderConfigured(env = process.env) {
    return Boolean(
        env.WHATSAPP_ACCESS_TOKEN
        && env.WHATSAPP_PHONE_NUMBER_ID
        && env.WHATSAPP_OTP_TEMPLATE_NAME
        && env.WHATSAPP_GRAPH_API_VERSION
    );
}

function createMetaWhatsAppSender({
    accessToken,
    phoneNumberId,
    templateName,
    templateLanguage = 'pt_BR',
    graphApiVersion,
    countryCode = '55',
    buttonSubtype,
    timeoutMs = 5000,
    fetchImpl = globalThis.fetch
}) {
    if (!accessToken || !phoneNumberId || !templateName || !graphApiVersion) {
        throw new Error('Configuração incompleta do WhatsApp Cloud API.');
    }
    if (typeof fetchImpl !== 'function') throw new Error('Uma implementação de fetch é obrigatória.');
    if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error('WHATSAPP_GRAPH_API_VERSION inválida.');
    if (!/^\d+$/.test(phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID inválido.');

    return async function sendWhatsAppOtp({ phone, code }) {
        const components = [{
            type: 'body',
            parameters: [{ type: 'text', text: code }]
        }];

        // Some approved authentication templates also require a one-tap/copy
        // button parameter. It is opt-in because template topology is defined
        // in Meta Business Manager and must match exactly.
        if (buttonSubtype) {
            components.push({
                type: 'button',
                sub_type: buttonSubtype,
                index: '0',
                parameters: [{ type: 'text', text: code }]
            });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetchImpl(
                `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
                {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${accessToken}`,
                    'content-type': 'application/json'
                },
                signal: controller.signal,
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: `${countryCode}${phone}`,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: templateLanguage },
                        components
                    }
                })
                }
            );
        } catch (cause) {
            const error = new Error('O provedor de WhatsApp não respondeu.');
            error.code = 'WHATSAPP_DELIVERY_FAILED';
            error.status = cause?.name === 'AbortError' ? 504 : 502;
            throw error;
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const error = new Error('O provedor de WhatsApp não aceitou a mensagem.');
            error.code = 'WHATSAPP_DELIVERY_FAILED';
            error.status = response.status;
            throw error;
        }
    };
}

function createMetaWhatsAppSenderFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
    if (!isWhatsAppProviderConfigured(env)) return null;
    return createMetaWhatsAppSender({
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        templateName: env.WHATSAPP_OTP_TEMPLATE_NAME,
        templateLanguage: env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || 'pt_BR',
        graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
        countryCode: env.WHATSAPP_COUNTRY_CODE || '55',
        buttonSubtype: env.WHATSAPP_OTP_BUTTON_SUBTYPE || '',
        fetchImpl
    });
}

function createSupabaseOtpStore(supabase) {
    return {
        async findActiveByPhoneHash(phoneHash) {
            const { data, error } = await supabase
                .from('client_login_codes')
                .select('id, phone_hash, expires_at, last_sent_at, attempts, max_attempts')
                .eq('phone_hash', phoneHash)
                .is('consumed_at', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        },

        async countRecentByPhoneHash(phoneHash, since) {
            const { count, error } = await supabase
                .from('client_login_codes')
                .select('id', { count: 'exact', head: true })
                .eq('phone_hash', phoneHash)
                .gte('created_at', since);
            if (error) throw error;
            return Number(count || 0);
        },

        async invalidateByPhoneHash(phoneHash, consumedAt) {
            const { error } = await supabase
                .from('client_login_codes')
                .update({ consumed_at: consumedAt })
                .eq('phone_hash', phoneHash)
                .is('consumed_at', null);
            if (error) throw error;
        },

        async create(record) {
            const { error } = await supabase.from('client_login_codes').insert([record]);
            if (error) throw error;
        },

        async consume({ phoneHash, codeHash, now }) {
            const { data, error } = await supabase.rpc('consume_client_login_code', {
                p_phone_hash: phoneHash,
                p_code_hash: codeHash,
                p_now: now
            });
            if (error) throw error;
            const result = Array.isArray(data) ? data[0] : data;
            return {
                status: result?.status || 'invalid',
                clientId: result?.client_id == null ? null : String(result.client_id)
            };
        }
    };
}

function createOtpManager({
    store,
    sendCode,
    secret,
    now = () => Date.now(),
    randomInt = crypto.randomInt,
    ttlMs = DEFAULT_TTL_MS,
    resendCooldownMs = DEFAULT_RESEND_COOLDOWN_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    sendWindowMs = DEFAULT_SEND_WINDOW_MS,
    maxSendsPerWindow = DEFAULT_MAX_SENDS_PER_WINDOW
}) {
    if (!store || typeof store.create !== 'function' || typeof store.consume !== 'function') {
        throw new Error('Um armazenamento de OTP válido é obrigatório.');
    }
    if (typeof sendCode !== 'function') throw new Error('Um adaptador de envio de OTP é obrigatório.');
    const key = deriveOtpKey(secret);

    function phoneDigest(phone) {
        return digest(key, 'phone', phone);
    }

    function codeDigest(phoneHash, code) {
        return digest(key, 'code', `${phoneHash}:${code}`);
    }

    async function requestCode({ phone, clientId = null }) {
        const currentTime = now();
        const phoneHash = phoneDigest(phone);
        const recent = await store.findActiveByPhoneHash(phoneHash);
        const recentSentAt = recent ? new Date(recent.last_sent_at).getTime() : 0;
        const recentExpiresAt = recent ? new Date(recent.expires_at).getTime() : 0;

        if (recent && recentExpiresAt > currentTime && currentTime - recentSentAt < resendCooldownMs) {
            return { accepted: true, expiresIn: Math.ceil(ttlMs / 1000), deliveryAttempted: false };
        }

        if (typeof store.countRecentByPhoneHash === 'function') {
            const since = new Date(currentTime - sendWindowMs).toISOString();
            const recentCount = await store.countRecentByPhoneHash(phoneHash, since);
            if (recentCount >= maxSendsPerWindow) {
                return { accepted: true, expiresIn: Math.ceil(ttlMs / 1000), deliveryAttempted: false };
            }
        }

        await store.invalidateByPhoneHash(phoneHash, new Date(currentTime).toISOString());
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const createdAt = new Date(currentTime).toISOString();
        const expiresAt = new Date(currentTime + ttlMs).toISOString();

        await store.create({
            client_id: clientId == null ? null : String(clientId),
            phone_hash: phoneHash,
            code_hash: codeDigest(phoneHash, code),
            expires_at: expiresAt,
            attempts: 0,
            max_attempts: maxAttempts,
            last_sent_at: createdAt,
            created_at: createdAt
        });

        // A decoy challenge is intentionally persisted for unknown phone
        // numbers. This keeps timing, expiry and attempt responses uniform and
        // prevents account enumeration. Only real clients receive a message.
        if (clientId == null) {
            return { accepted: true, expiresIn: Math.ceil(ttlMs / 1000), deliveryAttempted: false };
        }

        try {
            await sendCode({ phone, code });
            return { accepted: true, expiresIn: Math.ceil(ttlMs / 1000), deliveryAttempted: true };
        } catch (error) {
            await store.invalidateByPhoneHash(phoneHash, new Date(now()).toISOString());
            return {
                accepted: true,
                expiresIn: Math.ceil(ttlMs / 1000),
                deliveryAttempted: true,
                deliveryFailed: true,
                providerStatus: error?.status
            };
        }
    }

    async function verifyCode({ phone, code }) {
        const phoneHash = phoneDigest(phone);
        return store.consume({
            phoneHash,
            codeHash: codeDigest(phoneHash, code),
            now: new Date(now()).toISOString()
        });
    }

    return {
        expiresIn: Math.ceil(ttlMs / 1000),
        requestCode,
        verifyCode
    };
}

module.exports = {
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_MAX_SENDS_PER_WINDOW,
    DEFAULT_RESEND_COOLDOWN_MS,
    DEFAULT_SEND_WINDOW_MS,
    DEFAULT_TTL_MS,
    createMetaWhatsAppSender,
    createMetaWhatsAppSenderFromEnv,
    createOtpManager,
    createSupabaseOtpStore,
    isWhatsAppProviderConfigured
};
