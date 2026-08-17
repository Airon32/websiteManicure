const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'mary_session';
const REFRESH_COOKIE = 'mary_refresh';
const STAFF_FLAG_COOKIE = 'has_active_staff_session';
const HASH_SCHEME = 'scrypt';
const PASSWORD_COST = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });
const ACCESS_TTL = 15 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
// A rotated token may still arrive from a request that raced the rotation.
// Inside this window it is treated as a retry instead of a stolen token.
const REFRESH_REUSE_GRACE_MS = 10 * 1000;

// Bucket A: consecutive credential failures per IP + username, cleared on a
// successful login. Bucket B: raw login volume per IP. rateLimitBuckets backs
// the generic per-route limiter used everywhere else.
const rateLimitBuckets = new Map();
const credentialFailureBuckets = new Map();
const generalLoginVolumeBuckets = new Map();

const CREDENTIAL_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const CREDENTIAL_FAILURE_MAX = 5;
const GENERAL_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const GENERAL_LOGIN_MAX = 30;

function getRequestIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function createBucketKey(ip, identifier) {
    return `${ip}:${identifier}`;
}

function checkAndIncrementBucket(buckets, key, windowMs, max, now) {
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : current;

    bucket.count += 1;
    buckets.set(key, bucket);

    return {
        allowed: bucket.count <= max,
        limit: max,
        remaining: Math.max(0, max - bucket.count),
        resetAt: bucket.resetAt,
        retryAfter: bucket.count > max ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : 0
    };
}

function credentialFailureKey(req, username) {
    const identifier = String(username ?? req.body?.username ?? '').trim().toLowerCase();
    return createBucketKey(getRequestIp(req), identifier || 'unknown');
}

function resetCredentialFailureBucket(req, username) {
    credentialFailureBuckets.delete(credentialFailureKey(req, username));
}

function rateLimitCredentialFailure(req, res, next) {
    const now = Date.now();
    const key = credentialFailureKey(req);

    const result = checkAndIncrementBucket(credentialFailureBuckets, key, CREDENTIAL_FAILURE_WINDOW_MS, CREDENTIAL_FAILURE_MAX, now);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Bucket', 'credential-failure');

    if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfter));
        return res.status(429).json({ error: 'Muitas tentativas de credencial incorreta. Aguarde 15 minutos.' });
    }

    if (credentialFailureBuckets.size > 5000) {
        for (const [bucketKey, value] of credentialFailureBuckets) {
            if (value.resetAt <= now) credentialFailureBuckets.delete(bucketKey);
        }
    }
    next();
}

function rateLimitGeneralLogin(req, res, next) {
    const now = Date.now();
    const ip = getRequestIp(req);
    const key = `general-login:${ip}`;

    const result = checkAndIncrementBucket(generalLoginVolumeBuckets, key, GENERAL_LOGIN_WINDOW_MS, GENERAL_LOGIN_MAX, now);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Bucket', 'general-login');

    if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfter));
        return res.status(429).json({ error: 'Volume excessivo de tentativas de login. Aguarde alguns minutos.' });
    }

    if (generalLoginVolumeBuckets.size > 5000) {
        for (const [bucketKey, value] of generalLoginVolumeBuckets) {
            if (value.resetAt <= now) generalLoginVolumeBuckets.delete(bucketKey);
        }
    }
    next();
}

function rateLimit({ windowMs, max, keyPrefix, message }) {
    return (req, res, next) => {
        const now = Date.now();
        const key = `${keyPrefix}:${getRequestIp(req)}`;
        const current = rateLimitBuckets.get(key);
        const bucket = !current || current.resetAt <= now
            ? { count: 0, resetAt: now + windowMs }
            : current;

        bucket.count += 1;
        rateLimitBuckets.set(key, bucket);

        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
        if (bucket.count > max) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({ error: message || 'Muitas tentativas. Aguarde alguns minutos.' });
        }

        if (rateLimitBuckets.size > 5000) {
            for (const [bucketKey, value] of rateLimitBuckets) {
                if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
            }
        }
        next();
    };
}

function base64url(value) {
    return Buffer.from(value).toString('base64url');
}

function getSessionSecret() {
    const source = process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
    if (!source || source.length < 32) {
        throw new Error('Configure SESSION_SECRET com pelo menos 32 caracteres.');
    }

    // Domain separation produces a dedicated HMAC key even while an existing
    // deployment is migrating from the Supabase key to SESSION_SECRET.
    return crypto.createHash('sha256').update('mary-esmalteria/session/v1').update(source).digest();
}

function signSession(payload, ttlSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const body = base64url(JSON.stringify({
        v: 1,
        ...payload,
        iat: now,
        exp: now + ttlSeconds,
        nonce: crypto.randomBytes(12).toString('base64url')
    }));
    const signature = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
}

function verifySession(token) {
    if (!token || typeof token !== 'string') return null;
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) return null;

    const expected = crypto.createHmac('sha256', getSessionSecret()).update(body).digest();
    let provided;
    try {
        provided = Buffer.from(signature, 'base64url');
    } catch {
        return null;
    }

    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        const now = Math.floor(Date.now() / 1000);
        if (payload.v !== 1 || !payload.exp || payload.exp <= now) return null;
        if (!['staff', 'client'].includes(payload.type)) return null;
        return payload;
    } catch {
        return null;
    }
}

function parseCookies(header = '') {
    return header.split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return cookies;
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (!key) return cookies;
        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
        return cookies;
    }, {});
}

function readSession(req) {
    try {
        return verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    } catch {
        return null;
    }
}

function cookieAttributes({ httpOnly = true } = {}) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return `Path=/; ${httpOnly ? 'HttpOnly; ' : ''}SameSite=Lax${secure}`;
}

/**
 * A response often carries the access cookie, the refresh cookie and the UX
 * flag at once. setHeader would keep only the last one, silently logging the
 * user out, so every cookie has to accumulate.
 */
function appendCookie(res, cookie) {
    if (typeof res.append === 'function') {
        res.append('Set-Cookie', cookie);
        return;
    }
    const current = res.getHeader('Set-Cookie');
    const cookies = current ? [].concat(current, cookie) : [cookie];
    res.setHeader('Set-Cookie', cookies);
}

function setSessionCookie(res, token, maxAgeSeconds = ACCESS_TTL) {
    appendCookie(res, `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; ${cookieAttributes()}`);
}

function clearSessionCookie(res) {
    appendCookie(res, `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttributes()}`);
}

function setRefreshCookie(res, token, maxAgeSeconds = REFRESH_TTL) {
    appendCookie(res, `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; ${cookieAttributes()}`);
}

function clearRefreshCookie(res) {
    appendCookie(res, `${REFRESH_COOKIE}=; Max-Age=0; ${cookieAttributes()}`);
}

/**
 * Readable by scripts on purpose: the SPA uses it to skip the logged-out flash
 * while it revalidates. It carries no identity, only a boolean hint.
 */
function setStaffSessionFlagCookie(res, maxAgeSeconds = REFRESH_TTL) {
    appendCookie(res, `${STAFF_FLAG_COOKIE}=true; Max-Age=${maxAgeSeconds}; ${cookieAttributes({ httpOnly: false })}`);
}

function clearStaffSessionFlagCookie(res) {
    appendCookie(res, `${STAFF_FLAG_COOKIE}=; Max-Age=0; ${cookieAttributes({ httpOnly: false })}`);
}

function readRefreshToken(req) {
    try {
        return parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    } catch {
        return null;
    }
}

function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('base64url');
}

async function createRefreshToken(supabase, userId, userType, ttlSeconds = REFRESH_TTL) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const { data, error } = await supabase
        .from('refresh_tokens')
        .insert([{
            user_id: String(userId),
            user_type: userType,
            token_hash: hashRefreshToken(token),
            expires_at: expiresAt
        }])
        .select('id')
        .single();

    if (error) throw error;
    return { token, id: data?.id ?? null, expiresAt };
}

/**
 * Returns the stored token even when it is revoked or expired, because the
 * caller has to tell a plain expiry apart from a replayed token.
 */
async function findRefreshToken(supabase, token) {
    if (!token) return null;

    const { data, error } = await supabase
        .from('refresh_tokens')
        .select('id, user_id, user_type, expires_at, revoked_at, replaced_by_token_id')
        .eq('token_hash', hashRefreshToken(token))
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const revokedAt = data.revoked_at ? new Date(data.revoked_at) : null;
    return {
        id: data.id,
        userId: data.user_id,
        userType: data.user_type,
        replacedByTokenId: data.replaced_by_token_id ?? null,
        revoked: Boolean(revokedAt),
        revokedAt,
        expired: new Date(data.expires_at) <= new Date()
    };
}

async function revokeRefreshToken(supabase, tokenId, replacedByTokenId = null) {
    const patch = { revoked_at: new Date().toISOString() };
    if (replacedByTokenId) patch.replaced_by_token_id = replacedByTokenId;
    const { error } = await supabase
        .from('refresh_tokens')
        .update(patch)
        .eq('id', tokenId);
    if (error) throw error;
}

/**
 * Drops every live token of a user. Used when a rotated token is replayed:
 * the cookie has leaked, so the whole lineage stops being trusted.
 */
async function revokeRefreshTokenFamily(supabase, userId, userType) {
    const { error } = await supabase
        .from('refresh_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', String(userId))
        .eq('user_type', userType)
        .is('revoked_at', null);
    if (error) throw error;
}

/**
 * Issues the replacement before revoking the old token so a failure keeps the
 * caller logged in instead of stranding them with no valid token at all.
 */
async function rotateRefreshToken(supabase, oldTokenId, userId, userType, ttlSeconds = REFRESH_TTL) {
    const created = await createRefreshToken(supabase, userId, userType, ttlSeconds);
    await revokeRefreshToken(supabase, oldTokenId, created.id);
    return created;
}

function isBenignRefreshReuse(record) {
    if (!record?.revoked || !record.revokedAt) return false;
    return Date.now() - record.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(password, salt, PASSWORD_COST.keyLength, {
        N: PASSWORD_COST.N,
        r: PASSWORD_COST.r,
        p: PASSWORD_COST.p,
        maxmem: 64 * 1024 * 1024
    });
    return [
        HASH_SCHEME,
        PASSWORD_COST.N,
        PASSWORD_COST.r,
        PASSWORD_COST.p,
        salt.toString('base64url'),
        Buffer.from(derived).toString('base64url')
    ].join('$');
}

async function verifyPassword(password, storedValue) {
    const stored = String(storedValue || '');

    if (!stored.startsWith(`${HASH_SCHEME}$`)) {
        const storedDigest = crypto.createHash('sha256').update(stored).digest();
        const inputDigest = crypto.createHash('sha256').update(password).digest();
        return { valid: crypto.timingSafeEqual(storedDigest, inputDigest), needsUpgrade: true };
    }

    const [prefix, n, r, p, saltValue, hashValue] = stored.split('$');
    if (prefix !== HASH_SCHEME || !n || !r || !p || !saltValue || !hashValue) {
        return { valid: false, needsUpgrade: false };
    }

    try {
        const expected = Buffer.from(hashValue, 'base64url');
        const derived = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, {
            N: Number(n),
            r: Number(r),
            p: Number(p),
            maxmem: 64 * 1024 * 1024
        });
        const actual = Buffer.from(derived);
        return {
            valid: actual.length === expected.length && crypto.timingSafeEqual(actual, expected),
            needsUpgrade: Number(n) < PASSWORD_COST.N
        };
    } catch {
        return { valid: false, needsUpgrade: false };
    }
}

function optionalSession(req, _res, next) {
    req.auth = readSession(req);
    next();
}

function normalizeOrigin(value) {
    if (!value) return null;
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function getRequestOrigin(req) {
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || String(req.headers.host || '').trim();
    const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProtocol || req.protocol;
    return host && protocol ? `${protocol}://${host}` : null;
}

/**
 * Blocks cross-site state changes. Requests carrying an authenticated cookie
 * must also prove their origin, while non-browser/public API clients can omit
 * Origin when no ambient session is present.
 */
function requireSameOrigin({ allowedOrigins = [] } = {}) {
    const trustedOrigins = new Set(
        [...allowedOrigins].map(normalizeOrigin).filter(Boolean)
    );

    return (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

        const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
        if (fetchSite === 'cross-site') {
            return res.status(403).json({ error: 'Origem da solicitação não permitida.' });
        }

        const ownOrigin = getRequestOrigin(req);
        const suppliedOrigin = normalizeOrigin(req.headers.origin);
        if (req.headers.origin && !suppliedOrigin) {
            return res.status(403).json({ error: 'Origem da solicitação não permitida.' });
        }
        if (suppliedOrigin) {
            if (suppliedOrigin !== ownOrigin && !trustedOrigins.has(suppliedOrigin)) {
                return res.status(403).json({ error: 'Origem da solicitação não permitida.' });
            }
            return next();
        }

        if (req.auth) {
            const refererOrigin = normalizeOrigin(req.headers.referer);
            if (!refererOrigin || (refererOrigin !== ownOrigin && !trustedOrigins.has(refererOrigin))) {
                return res.status(403).json({ error: 'Origem da solicitação não permitida.' });
            }
        }

        next();
    };
}

function requireStaff(...roles) {
    return (req, res, next) => {
        const session = req.auth || readSession(req);
        if (!session || session.type !== 'staff') {
            return res.status(401).json({ error: 'Faça login para continuar.' });
        }
        if (roles.length > 0 && !roles.includes(session.role)) {
            return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
        }
        req.auth = session;
        next();
    };
}

function requireClient(req, res, next) {
    const session = req.auth || readSession(req);
    if (!session || session.type !== 'client') {
        return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    }
    req.auth = session;
    next();
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.startsWith('55') && digits.length === 13 ? digits.slice(2) : digits;
}

function isValidPhone(value) {
    return /^\d{10,11}$/.test(normalizePhone(value));
}

function normalizeName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('pt-BR');
}

function safeText(value, maxLength = 160) {
    return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function sameSubject(left, right) {
    return String(left) === String(right);
}

function createAppointmentToken(appointmentId, ttlSeconds = 7 * 24 * 60 * 60) {
    const subject = String(appointmentId);
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const compactExpiry = expiresAt.toString(36);
    const signature = crypto
        .createHmac('sha256', getSessionSecret())
        .update(`mary-esmalteria/appointment-confirmation/v2:${subject}:${compactExpiry}`)
        .digest()
        .subarray(0, 16)
        .toString('base64url');
    return `v2.${compactExpiry}.${signature}`;
}

function verifyAppointmentToken(token, appointmentId) {
    if (!token || typeof token !== 'string') return false;

    const [version, compactExpiry, signature, extra] = token.split('.');
    if (version === 'v2' && compactExpiry && signature && !extra) {
        const expiresAt = Number.parseInt(compactExpiry, 36);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;

        const expected = crypto
            .createHmac('sha256', getSessionSecret())
            .update(`mary-esmalteria/appointment-confirmation/v2:${String(appointmentId)}:${compactExpiry}`)
            .digest()
            .subarray(0, 16);
        let provided;
        try {
            provided = Buffer.from(signature, 'base64url');
        } catch {
            return false;
        }
        return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    }

    // Compatibilidade durante a validade dos lembretes enviados antes desta atualização.
    const legacy = verifySession(token);
    return legacy?.action === 'confirm-appointment' && sameSubject(legacy.appointmentId, appointmentId);
}

const PROTECTED_PHONE_PLACEHOLDER = 'Telefone protegido 🔒';

function isOwner(user) {
    if (!user || user.type !== 'staff') return false;
    if (user.role === 'owner') return true;
    if (user.is_owner === true || user.is_owner === 'true') return true;
    const username = String(user.username || user.profile?.username || '').toLowerCase();
    const id = String(user.id || user.profile?.id || '');
    if (user.role === 'admin' && (username === 'mari' || username === 'mariana' || id === '1' || id === 'pro-1')) {
        return true;
    }
    return false;
}

function canViewClientPhone(auth, settingsMap = {}) {
    if (!auth || auth.type !== 'staff') return false;
    const hidePhones = String(settingsMap.hide_client_phone_from_collaborators || '').toLowerCase() === 'true';
    if (!hidePhones) return true;

    if (isOwner(auth)) return true;

    if (auth.role === 'admin') {
        const allowAdmins = String(settingsMap.allow_admins_view_client_phone || '').toLowerCase() === 'true';
        if (allowAdmins) return true;
    }

    let authorizedIds = [];
    try {
        const raw = settingsMap.authorized_phone_viewer_ids;
        if (raw) authorizedIds = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}

    const currentId = String(auth.id || '');
    const currentUsername = String(auth.username || auth.profile?.username || '').toLowerCase();
    if (Array.isArray(authorizedIds) && (
        authorizedIds.map(String).includes(currentId) ||
        authorizedIds.map(v => String(v).toLowerCase()).includes(currentUsername)
    )) {
        return true;
    }

    return false;
}

function maskPhone(phone, canView) {
    if (canView) return phone ? String(phone) : '';
    return PROTECTED_PHONE_PLACEHOLDER;
}

function isProtectedPhone(value) {
    if (!value) return true;
    const str = String(value);
    return str.includes('Telefone protegido') || str.includes('🔒');
}

module.exports = {
    ACCESS_TTL,
    PROTECTED_PHONE_PLACEHOLDER,
    REFRESH_REUSE_GRACE_MS,
    REFRESH_TTL,
    canViewClientPhone,
    clearRefreshCookie,
    clearSessionCookie,
    clearStaffSessionFlagCookie,
    createAppointmentToken,
    createRefreshToken,
    findRefreshToken,
    getRequestIp,
    hashPassword,
    isBenignRefreshReuse,
    isOwner,
    isProtectedPhone,
    isValidPhone,
    maskPhone,
    normalizeName,
    normalizePhone,
    optionalSession,
    rateLimit,
    rateLimitCredentialFailure,
    rateLimitGeneralLogin,
    resetCredentialFailureBucket,
    readRefreshToken,
    readSession,
    requireClient,
    requireSameOrigin,
    requireStaff,
    revokeRefreshToken,
    revokeRefreshTokenFamily,
    rotateRefreshToken,
    safeText,
    sameSubject,
    setRefreshCookie,
    setSessionCookie,
    setStaffSessionFlagCookie,
    signSession,
    verifyAppointmentToken,
    verifyPassword,
    verifySession
};
