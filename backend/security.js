const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'mary_session';
const HASH_SCHEME = 'scrypt';
const PASSWORD_COST = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });
const rateLimitBuckets = new Map();

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

function setSessionCookie(res, token, maxAgeSeconds) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`
    );
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
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

function getRequestIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
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
    return signSession({ type: 'client', action: 'confirm-appointment', appointmentId: String(appointmentId) }, ttlSeconds);
}

module.exports = {
    clearSessionCookie,
    createAppointmentToken,
    hashPassword,
    isValidPhone,
    normalizeName,
    normalizePhone,
    optionalSession,
    rateLimit,
    readSession,
    requireClient,
    requireSameOrigin,
    requireStaff,
    safeText,
    sameSubject,
    setSessionCookie,
    signSession,
    verifyPassword,
    verifySession
};
