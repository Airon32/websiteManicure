require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const {
    ACCESS_TTL,
    PROTECTED_PHONE_PLACEHOLDER,
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
    verifyPassword
} = require('./security');
const {
    createMetaWhatsAppSenderFromEnv,
    createOtpManager,
    createSupabaseOtpStore
} = require('./otp');
const {
    createReminderWhatsAppSenderFromEnv,
    isReminderChannelReady
} = require('./whatsapp');
const {
    DEFAULT_TEMPLATES,
    SETTING_KEYS,
    createReminderService,
    isMissingWhatsappPhoneColumn,
    isReminderOwner,
    isReminderPrivileged,
    isValidE164,
    normalizeE164,
    omitStaffWhatsApp,
    presentStaffWhatsApp,
    reminderSettingSpec,
    requireCronSecret,
    staffWhatsAppWriteError,
    validateReminderTemplate
} = require('./reminders');

// --- CONFIGURAÇÃO SUPABASE (CENTRALIZADA PARA VERCEL) ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY antes de iniciar o servidor.');
}
// Placeholder values satisfy the presence check above but leave the server
// running against a host that does not resolve, which surfaces much later as an
// opaque 500 on every request. Refuse to boot instead.
const PLACEHOLDER_TOKENS = ['your-project', 'your_project', 'replace_me', 'replace-me', 'replace_with', 'changeme', 'change_me', 'todo', 'xxxx'];

function looksLikePlaceholder(value) {
    const normalized = String(value).toLowerCase();
    return PLACEHOLDER_TOKENS.some(token => normalized.includes(token));
}

let supabaseHost;
try {
    const parsedSupabaseUrl = new URL(supabaseUrl);
    if (parsedSupabaseUrl.protocol !== 'https:' && parsedSupabaseUrl.hostname !== 'localhost' && parsedSupabaseUrl.hostname !== '127.0.0.1') {
        throw new Error('protocol');
    }
    supabaseHost = parsedSupabaseUrl.host;
} catch {
    throw new Error(`SUPABASE_URL inválida ("${supabaseUrl}"). Use a URL https do projeto, por exemplo https://abcdefgh.supabase.co`);
}

if (process.env.NODE_ENV !== 'test' && (looksLikePlaceholder(supabaseUrl) || looksLikePlaceholder(supabaseKey))) {
    throw new Error(
        'SUPABASE_URL/SUPABASE_SECRET_KEY ainda contêm valores de exemplo do .env.example. '
        + 'Preencha as credenciais reais do projeto antes de iniciar o servidor.'
    );
}

const sessionKeySource = process.env.SESSION_SECRET || supabaseKey;
if (sessionKeySource.length < 32) {
    throw new Error('Configure SESSION_SECRET com pelo menos 32 caracteres antes de iniciar o servidor.');
}
if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'test') {
    console.warn('[Security] SESSION_SECRET ausente; usando chave derivada durante a migração.');
}

const SUPABASE_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS) || 8000;

const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
        // Without a deadline a hung connection keeps the request (and its rate
        // limit slot) alive indefinitely.
        fetch: (input, init = {}) => fetch(input, {
            ...init,
            signal: init.signal ?? AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
        })
    },
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
});

const whatsAppOtpSender = createMetaWhatsAppSenderFromEnv();
const clientOtpManager = whatsAppOtpSender
    ? createOtpManager({
        store: createSupabaseOtpStore(supabase),
        sendCode: whatsAppOtpSender
    })
    : null;

const reminderWhatsAppSender = createReminderWhatsAppSenderFromEnv();
const reminderService = createReminderService({
    supabase,
    sendMessage: reminderWhatsAppSender,
    timeZone: process.env.BUSINESS_TIMEZONE || 'America/Sao_Paulo'
});

if (typeof supabase.from !== 'function') {
    console.error('[SUPABASE DIAGNOSTIC] Erro Crítico: supabase.from não é uma função!', {
        keys: Object.keys(supabase),
        type: typeof supabase
    });
} else {
    if (process.env.NODE_ENV !== 'test') console.log('[SUPABASE] Cliente inicializado com sucesso.');
}

// A proteção CSRF é implementada pelo middleware requireSameOrigin abaixo.
const app = express(); // nosemgrep
// A regra njsscan abaixo é positiva (INFO), mas o agregador a exibe como vulnerabilidade.
app.disable('x-powered-by'); // nosemgrep
app.set('trust proxy', 1);

const configuredOrigins = String(
    process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || process.env.FRONTEND_URL || ''
).split(',').map(value => value.trim()).filter(Boolean);
const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = new Set([...configuredOrigins, ...(process.env.NODE_ENV === 'production' ? [] : developmentOrigins)]);

app.use(cors({
    credentials: true,
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(null, false);
    }
}));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
});
app.use(optionalSession);
app.use(requireSameOrigin({ allowedOrigins }));
app.use('/api', async (req, res, next) => {
    if (!req.auth || req.auth.action) return next();

    const table = req.auth.type === 'staff' ? 'professionals' : 'clients';
    const columns = req.auth.type === 'staff'
        ? 'id, name, role, avatar, username, specialty, status'
        : 'id, name, phone';
    let query = supabase.from(table).select(columns).eq('id', req.auth.id);
    if (req.auth.type === 'staff') query = query.eq('status', 'ativo');
    const { data, error } = await query.maybeSingle();

    if (error) {
        console.error('[Session] Falha ao revalidar sessão:', error.code || error.message);
        return res.status(503).json({ error: 'Não foi possível validar sua sessão agora.' });
    }
    if (!data) {
        clearSessionCookie(res);
        req.auth = null;
        return next();
    }

    if (req.auth.type === 'staff') {
        req.auth = { ...req.auth, role: data.role, profile: data };
    } else {
        req.auth = { ...req.auth, name: data.name, phone: normalizePhone(data.phone), profile: data };
    }
    next();
});
// Rota de Health Check
app.get('/', (req, res) => {
    res.json({ status: 'live' });
});

// Logger simples
app.use((req, res, next) => {
    if (!['production', 'test'].includes(process.env.NODE_ENV)) console.log('%s %s', req.method, req.url);
    next();
});

const PORT = Number(process.env.PORT) || 3001;
const DEFAULT_WORK_START = '09:00';
const DEFAULT_WORK_END = '20:00';
const DEFAULT_SLOT_INTERVAL = '30';

// Supabase reports transport failures with an empty `code` and buries the real
// cause (a stack trace) in `details`, so `error.code || error.message` alone
// yields an unactionable "TypeError: fetch failed".
const CONNECTIVITY_ERROR_PATTERN = /fetch failed|failed to fetch|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|socket hang up|aborted|timeout/i;

function isDbConnectivityError(error) {
    if (!error) return false;
    const haystack = [error.message, error.details, error.hint, error.cause?.code, error.name]
        .filter(Boolean)
        .join(' ');
    return CONNECTIVITY_ERROR_PATTERN.test(haystack);
}

function logDbConnectivityFailure(context, error) {
    if (process.env.NODE_ENV === 'test') return;
    // Never log the service key; the host is enough to diagnose DNS/firewall.
    const reason = String(error?.details || error?.message || '').split('\n')[0];
    console.error(
        `[${context}] Banco de dados inacessível (host=${supabaseHost}). `
        + `Verifique SUPABASE_URL, a rede e se o projeto Supabase está ativo. Causa: ${reason}`
    );
}

function safeDbErrorMessage(error, defaultMessage = 'Não foi possível processar a solicitação.') {
    if (!error) return defaultMessage;
    if (isDbConnectivityError(error)) {
        logDbConnectivityFailure('Database', error);
        return 'Serviço temporariamente indisponível. Tente novamente em instantes.';
    }
    if (process.env.NODE_ENV !== 'test') {
        console.error('[Database Error]:', error.code || 'UNKNOWN', error.message);
    }
    if (error.code === '23505') return 'Este registro já existe ou entra em conflito com outro item.';
    if (error.code === '23503') return 'O item referenciado não existe ou não está mais disponível.';
    return defaultMessage;
}

// Rota para buscar notificações (DEDICADA - Busca da tabela 'notifications')
app.get('/api/notifications', requireStaff(), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (error) {
            return res.status(500).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar as notificações.') });
        }
        
        res.json(data);
    } catch {
        res.status(500).json({ error: 'Erro interno ao carregar notificações.' });
    }
});

// Rota para limpar notificações (DEDICADA - Deleta da tabela 'notifications')
app.post('/api/notifications/clear', requireStaff('admin'), async (req, res) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .delete()
            .not('id', 'is', null);
            
        if (error) {
            return res.status(500).json({ error: safeDbErrorMessage(error, 'Não foi possível limpar as notificações.') });
        }
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Erro interno ao limpar notificações.' });
    }
});
const DEFAULT_WORK_DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DAY_NAME_MAP = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };
const DAY_KEYS = Object.freeze(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function getDateStringInTimeZone(date = new Date(), timeZone = process.env.BUSINESS_TIMEZONE || 'America/Sao_Paulo') {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function getTimeStringInTimeZone(date = new Date(), timeZone = process.env.BUSINESS_TIMEZONE || 'America/Sao_Paulo') {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit', minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.hour}:${values.minute}`;
}

function getProfessionalSettingKey(professionalId, suffix) {
    return `professional_${professionalId}_${suffix}`;
}

async function loadSettingsMap() {
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;
    return Object.fromEntries((data || []).map(setting => [setting.key, setting.value]));
}

function parseWorkDays(value) {
    if (!value) return [...DEFAULT_WORK_DAYS];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_WORK_DAYS];
    } catch {
        return [...DEFAULT_WORK_DAYS];
    }
}

function minutesToTime(totalMinutes) {
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    return `${hours}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function normalizeClock(value) {
    const match = String(value ?? '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
    if (!match) return null;
    return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
}

function isDayOffEntry(entry) {
    if (entry === undefined || entry === null || entry === false || entry === '') return true;
    if (typeof entry === 'string') {
        const lowered = entry.trim().toLowerCase();
        return lowered === 'folga' || lowered === 'off' || lowered === 'null';
    }
    if (typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (entry.off === true || entry.folga === true) return true;
    const start = String(entry.start ?? '').trim();
    const end = String(entry.end ?? '').trim();
    return !start && !end;
}

/**
 * Validates the per-day expedient and expands it to all seven days, where null
 * means a day off. A missing day is stored as a day off so a partial payload
 * can never silently inherit the previous opening hours.
 */
function normalizeDaySchedule(rawValue) {
    let source = rawValue;

    if (typeof source === 'string') {
        const trimmed = source.trim();
        if (!trimmed || trimmed === '{}' || trimmed === 'null') {
            return { valid: true, value: null, cleared: true };
        }
        try {
            source = JSON.parse(trimmed);
        } catch {
            return { valid: false, error: 'O expediente enviado não é um JSON válido.' };
        }
    }

    if (source == null) {
        return { valid: true, value: null, cleared: true };
    }

    if (typeof source !== 'object' || Array.isArray(source)) {
        return { valid: false, error: 'O expediente deve ser um objeto com os dias da semana.' };
    }

    if (Object.keys(source).length === 0) {
        return { valid: true, value: null, cleared: true };
    }

    const unknownDay = Object.keys(source).find(day => !DAY_KEYS.includes(day));
    if (unknownDay) {
        return { valid: false, error: `Dia inválido no expediente: "${safeText(unknownDay, 20)}".` };
    }

    const schedule = {};
    let openDays = 0;

    for (const day of DAY_KEYS) {
        const entry = source[day];
        if (isDayOffEntry(entry)) {
            schedule[day] = null;
            continue;
        }
        if (typeof entry !== 'object' || Array.isArray(entry)) {
            return { valid: false, error: `Informe início e fim do expediente de ${day} ou marque o dia como folga.` };
        }

        const start = normalizeClock(entry.start);
        const end = normalizeClock(entry.end);
        if (!start || !end) {
            return { valid: false, error: `Horário inválido no expediente de ${day}. Use o formato HH:MM.` };
        }
        if (timeToMinutes(end) <= timeToMinutes(start)) {
            return { valid: false, error: `O fim do expediente de ${day} precisa ser depois do início.` };
        }

        schedule[day] = { start, end };
        openDays += 1;
    }

    if (openDays === 0) {
        return { valid: false, error: 'Selecione ao menos um dia de atendimento.' };
    }

    return { valid: true, value: schedule };
}

function scheduleFromFlatHours(workStart, workEnd, workDays) {
    const openDays = new Set(workDays);
    return Object.fromEntries(
        DAY_KEYS.map(day => [day, openDays.has(day) ? { start: workStart, end: workEnd } : null])
    );
}

function buildProfessionalSchedule(settingsMap, professionalId) {
    const rawInterval = Number(settingsMap[getProfessionalSettingKey(professionalId, 'slot_interval')] || settingsMap.slot_interval || DEFAULT_SLOT_INTERVAL);
    const flatStart = settingsMap[getProfessionalSettingKey(professionalId, 'work_start')] || settingsMap.work_start || DEFAULT_WORK_START;
    const flatEnd = settingsMap[getProfessionalSettingKey(professionalId, 'work_end')] || settingsMap.work_end || DEFAULT_WORK_END;
    const flatDays = parseWorkDays(settingsMap[getProfessionalSettingKey(professionalId, 'work_days')] || settingsMap.work_days);

    const rawPerDay = settingsMap[getProfessionalSettingKey(professionalId, 'schedule')] || settingsMap.schedule;
    const parsedPerDay = rawPerDay ? normalizeDaySchedule(rawPerDay) : null;
    const schedule = parsedPerDay?.valid
        ? parsedPerDay.value
        : scheduleFromFlatHours(flatStart, flatEnd, flatDays);
    const openDays = DAY_KEYS.filter(day => schedule[day]);
    const hasPerDay = Boolean(parsedPerDay?.valid) && openDays.length > 0;

    // The flat fields stay in the payload for clients written before the per-day
    // format. When a per-day expedient exists they describe its widest window,
    // so an older client never rejects an hour the server accepts.
    return {
        work_start: hasPerDay ? minutesToTime(Math.min(...openDays.map(day => timeToMinutes(schedule[day].start)))) : flatStart,
        work_end: hasPerDay ? minutesToTime(Math.max(...openDays.map(day => timeToMinutes(schedule[day].end)))) : flatEnd,
        slot_interval: Number.isInteger(rawInterval) && rawInterval >= 5 && rawInterval <= 240 ? rawInterval : Number(DEFAULT_SLOT_INTERVAL),
        work_days: hasPerDay ? openDays : flatDays,
        is_public_agenda: settingsMap[getProfessionalSettingKey(professionalId, 'is_public_agenda')] === 'true',
        schedule
    };
}

async function buildProfessionalScheduleWithExceptions(supabase, settingsMap, professionalId) {
    const baseSchedule = buildProfessionalSchedule(settingsMap, professionalId);
    
    // Load exceptions from database
    const { data: exceptions } = await supabase
        .from('schedule_exceptions')
        .select('exception_date, start_time, end_time, is_day_off')
        .eq('professional_id', professionalId);
    
    const exceptionsMap = {};
    if (exceptions) {
        for (const exc of exceptions) {
            exceptionsMap[exc.exception_date] = exc.is_day_off ? null : {
                start: exc.start_time,
                end: exc.end_time
            };
        }
    }
    
    return {
        ...baseSchedule,
        exceptions: exceptionsMap
    };
}

/**
 * Resolves the opening window of one date. Returns null when the professional
 * does not work that day, so every caller enforces the same per-day rule.
 */
function getScheduleWindowForDay(schedule, dayKey) {
    const perDay = schedule?.schedule;
    if (perDay) {
        const day = perDay[dayKey];
        return day ? { start: timeToMinutes(day.start), end: timeToMinutes(day.end) } : null;
    }
    if (!schedule?.work_days?.includes(dayKey)) return null;
    return { start: timeToMinutes(schedule.work_start), end: timeToMinutes(schedule.work_end) };
}

async function recordAuditLog({ action = 'update_setting', setting_key = null, old_value = null, new_value = null, user = null }) {
    const auditEntry = {
        action: String(action),
        setting_key: setting_key ? String(setting_key) : null,
        old_value: old_value !== null && old_value !== undefined ? String(old_value) : null,
        new_value: new_value !== null && new_value !== undefined ? String(new_value) : null,
        changed_by_id: user?.id ? String(user.id) : null,
        changed_by_name: user?.profile?.name || user?.name || null,
        changed_by_username: user?.profile?.username || user?.username || null,
        created_at: new Date().toISOString()
    };

    try {
        const { error } = await supabase.from('audit_logs').insert([auditEntry]);
        if (error && process.env.NODE_ENV !== 'test') {
            console.warn('[Audit] Erro ao registrar auditoria no banco:', error.message);
        }
    } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
            console.warn('[Audit] Exceção ao gravar auditoria:', err.message);
        }
    }
}

function validateAppointmentAgainstSchedule({ date, time, duration, schedule, ignoreExpedientLimit = false }) {
    if (ignoreExpedientLimit) {
        return { valid: true };
    }

    const appointmentDate = new Date(`${date}T00:00:00`);
    const dayKey = DAY_NAME_MAP[appointmentDate.getDay()];

    const window = getScheduleWindowForDay(schedule, dayKey);
    if (!window) {
        return { valid: false, error: 'Este profissional não atende no dia selecionado.' };
    }

    const appointmentStart = timeToMinutes(time);
    const appointmentEnd = appointmentStart + duration;

    if (appointmentStart < window.start || appointmentEnd > window.end) {
        return { valid: false, error: 'O horário escolhido está fora do expediente configurado para este profissional.' };
    }

    return { valid: true };
}

function validateClientRescheduleAgainstSchedule({ date, time, duration, schedule, toleranceMinutes = 60 }) {
    const appointmentDate = new Date(`${date}T00:00:00`);
    const dayKey = DAY_NAME_MAP[appointmentDate.getDay()];

    const window = getScheduleWindowForDay(schedule, dayKey);
    if (!window) {
        return { valid: false, error: 'A profissional não atende nesse dia. Fale com a equipe para solicitar uma exceção.' };
    }

    const scheduleStart = window.start;
    const scheduleEnd = window.end;
    const appointmentStart = timeToMinutes(time);
    const appointmentEnd = appointmentStart + duration;
    const earliestStart = Math.max(0, scheduleStart - toleranceMinutes);
    const latestEnd = Math.min(24 * 60, scheduleEnd + toleranceMinutes);

    if (appointmentStart < earliestStart || appointmentEnd > latestEnd) {
        return {
            valid: false,
            error: 'Esse horário ultrapassa o limite de 1 hora fora do expediente. Fale com a profissional ou com a equipe.'
        };
    }

    return { valid: true };
}

// --- ROTA DE LOGIN ---
app.post('/api/login', rateLimitGeneralLogin, rateLimitCredentialFailure, async (req, res) => {
    const rawUsername = String(req.body.username || '').trim();
    const rawPassword = String(req.body.password || '').trim();

    if (!/^[\p{L}\p{N}._-]{3,50}$/u.test(rawUsername) || !rawPassword) {
        return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    // Usando ilike para ser insensível a maiúsculas/minúsculas
    const { data, error } = await supabase
        .from('professionals')
        .select('id, name, role, avatar, username, password, specialty, status')
        .ilike('username', rawUsername)
        .eq('status', 'ativo')
        .maybeSingle();

    if (error) {
        if (isDbConnectivityError(error)) {
            logDbConnectivityFailure('Login', error);
            return res.status(503).json({ error: 'Serviço temporariamente indisponível. Tente novamente em instantes.' });
        }
        console.error('[Login] Falha ao consultar usuário:', error.code || error.message);
        return res.status(500).json({ error: 'Não foi possível entrar agora. Tente novamente.' });
    }
    
    if (!data) {
        await verifyPassword(rawPassword, 'credencial-inválida-para-equalizar-tempo');
        return res.status(401).json({"error": "Usuário ou senha incorretos."});
    }

    const passwordResult = await verifyPassword(rawPassword, data.password);
    if (!passwordResult.valid) {
        return res.status(401).json({"error": "Usuário ou senha incorretos."});
    }

    // A correct password clears the consecutive-failure bucket. The key must be
    // derived from the request exactly as the limiter derived it, otherwise the
    // reset lands on a different bucket and never releases the user.
    resetCredentialFailureBucket(req, rawUsername);

    if (passwordResult.needsUpgrade) {
        const upgradedPassword = await hashPassword(rawPassword);
        const { error: upgradeError } = await supabase
            .from('professionals')
            .update({ password: upgradedPassword })
            .eq('id', data.id);
        if (upgradeError) console.error('[Login] Não foi possível atualizar o hash da senha:', upgradeError.code || upgradeError.message);
    }

    const { password, ...userWithoutPassword } = data;
    try {
        const accessToken = signSession({ type: 'staff', id: String(data.id), role: data.role }, ACCESS_TTL);
        const refreshToken = await createRefreshToken(supabase, String(data.id), 'staff', REFRESH_TTL);
        setSessionCookie(res, accessToken, ACCESS_TTL);
        setRefreshCookie(res, refreshToken.token, REFRESH_TTL);
        setStaffSessionFlagCookie(res, REFRESH_TTL);
    } catch (persistError) {
        if (process.env.NODE_ENV !== 'test') {
            console.error('[Login] Falha ao persistir sessão:', persistError.code || persistError.message);
        }
        return res.status(503).json({ error: 'Não foi possível entrar agora. Tente novamente.' });
    }
    res.json({"message": "success", "data": userWithoutPassword });
});

app.post('/api/client/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    keyPrefix: 'client-login',
    message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
}), async (req, res) => {
    if (clientOtpManager) {
        return res.status(409).json({
            error: 'Use o código enviado por WhatsApp para entrar.',
            code: 'OTP_REQUIRED'
        });
    }

    const rawPhone = req.body.phone;
    const phone = normalizePhone(rawPhone);
    const name = safeText(req.body.name, 100) || 'Cliente';

    if (!isValidPhone(phone)) {
        return res.status(400).json({ error: 'Informe um número de WhatsApp válido com DDD.' });
    }

    try {
        const suffix = phone.slice(-8);
        const { data: candidates, error } = await supabase
            .from('clients')
            .select('id, name, phone')
            .or(`phone.eq.${phone},phone.ilike.%${suffix}`);

        if (error) {
            console.error('[Client Login] Erro ao buscar cliente:', error.message);
        }

        let client = (candidates || []).find(c => normalizePhone(c.phone) === phone);

        if (!client && candidates && candidates.length > 0) {
            client = candidates[0];
        }

        if (!client) {
            const { data: newClient, error: insertError } = await supabase
                .from('clients')
                .insert([{ name, phone }])
                .select('id, name, phone')
                .single();

            if (insertError) {
                console.error('[Client Login] Erro ao criar cliente:', insertError.message);
                client = { id: `temp-${Date.now()}`, name, phone };
            } else {
                client = newClient;
            }
        } else if (name && name !== 'Cliente' && (!client.name || client.name === 'Cliente')) {
            await supabase.from('clients').update({ name }).eq('id', client.id).catch(() => {});
            client.name = name;
        }

        const accessToken = signSession({
            type: 'client',
            id: String(client.id),
            name: safeText(client.name || name, 100),
            phone
        }, ACCESS_TTL);
        let refreshToken;
        try {
            refreshToken = await createRefreshToken(supabase, String(client.id), 'client', REFRESH_TTL);
        } catch (persistError) {
            if (process.env.NODE_ENV !== 'test') {
                console.error('[Client Login] Falha ao persistir sessão:', persistError.code || persistError.message);
            }
            return res.status(503).json({ error: 'Não foi possível acessar a conta agora. Tente novamente.' });
        }
        setSessionCookie(res, accessToken, ACCESS_TTL);
        setRefreshCookie(res, refreshToken.token, REFRESH_TTL);

        return res.json({
            message: 'success',
            auth_method: 'phone_name_login',
            client_authenticated: true,
            data: { id: client.id, name: client.name || name, phone }
        });
    } catch (err) {
        console.error('[Client Login] Exceção:', err);
        return res.status(500).json({ error: 'Não foi possível acessar a conta agora. Tente novamente.' });
    }
});

async function findClientForOtp(phone) {
    // The suffix lookup also finds historical records saved with punctuation or
    // a +55 prefix. The final normalized comparison remains exact.
    const suffix = phone.slice(-8);
    const { data, error } = await supabase
        .from('clients')
        .select('id, name, phone')
        .ilike('phone', `%${suffix}%`)
        .limit(25);
    if (error) throw error;
    return (data || []).find(candidate => normalizePhone(candidate.phone) === phone) || null;
}

function otpUnavailable(res) {
    return res.status(503).json({
        error: 'O acesso por código ainda não está disponível.',
        code: 'OTP_NOT_CONFIGURED'
    });
}

const otpMinimumResponseMs = process.env.NODE_ENV === 'test'
    ? 0
    : Math.min(2000, Math.max(300, Number(process.env.OTP_RESPONSE_MIN_MS) || 750));

async function equalizeOtpResponseTime(startedAt) {
    const remaining = otpMinimumResponseMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
}

app.post('/api/client-auth/request-code', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 6,
    keyPrefix: 'client-otp-request',
    message: 'Muitas solicitações. Aguarde alguns minutos antes de tentar novamente.'
}), async (req, res) => {
    if (!clientOtpManager) return otpUnavailable(res);

    const startedAt = Date.now();
    const phone = normalizePhone(req.body.phone);
    if (!isValidPhone(phone)) {
        return res.status(400).json({ error: 'Informe um WhatsApp válido.', code: 'INVALID_PHONE' });
    }

    let client = null;
    try {
        client = await findClientForOtp(phone);
        const result = await clientOtpManager.requestCode({ phone, clientId: client?.id ?? null });
        if (result.deliveryFailed && process.env.NODE_ENV !== 'test') {
            // Never log the phone number or the one-time code.
            console.error('[Client OTP] O provedor não aceitou uma entrega.', {
                status: result.providerStatus || 'unknown'
            });
        }
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
            console.error('[Client OTP] Não foi possível preparar a solicitação.', {
                code: error?.code || 'OTP_STORAGE_ERROR'
            });
        }
        await equalizeOtpResponseTime(startedAt);
        return res.status(503).json({
            error: 'Não foi possível enviar o código agora. Tente novamente.',
            code: 'OTP_UNAVAILABLE'
        });
    }

    // This response is deliberately identical for registered and unknown
    // numbers. Unknown numbers receive a decoy challenge but no message.
    await equalizeOtpResponseTime(startedAt);
    return res.json({
        message: 'Se o WhatsApp estiver cadastrado, o código chegará em instantes.',
        data: { sent: true, expires_in: clientOtpManager.expiresIn }
    });
});

app.post('/api/client-auth/verify-code', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    keyPrefix: 'client-otp-verify',
    message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
}), async (req, res) => {
    if (!clientOtpManager) return otpUnavailable(res);

    const phone = normalizePhone(req.body.phone);
    const code = String(req.body.code || '').trim();
    if (!isValidPhone(phone) || !/^\d{6}$/.test(code)) {
        return res.status(401).json({ error: 'Código inválido.', code: 'OTP_INVALID' });
    }

    let verification;
    try {
        verification = await clientOtpManager.verifyCode({ phone, code });
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
            console.error('[Client OTP] Falha ao validar código.', {
                code: error?.code || 'OTP_STORAGE_ERROR'
            });
        }
        return res.status(503).json({ error: 'Não foi possível validar agora.', code: 'OTP_UNAVAILABLE' });
    }

    const failureByStatus = {
        expired: { status: 401, error: 'O código expirou. Solicite outro.', code: 'OTP_EXPIRED' },
        too_many_attempts: { status: 429, error: 'Limite de tentativas atingido. Solicite outro código.', code: 'OTP_TOO_MANY_ATTEMPTS' },
        invalid: { status: 401, error: 'Código inválido.', code: 'OTP_INVALID' }
    };
    if (verification.status !== 'verified' || !verification.clientId) {
        const failure = failureByStatus[verification.status] || failureByStatus.invalid;
        return res.status(failure.status).json({ error: failure.error, code: failure.code });
    }

    const { data: client, error } = await supabase
        .from('clients')
        .select('id, name, phone')
        .eq('id', verification.clientId)
        .maybeSingle();
    if (error) {
        return res.status(503).json({ error: 'Não foi possível validar agora.', code: 'OTP_UNAVAILABLE' });
    }
    if (!client || normalizePhone(client.phone) !== phone) {
        return res.status(401).json({ error: 'Código inválido.', code: 'OTP_INVALID' });
    }

    const normalizedClientPhone = normalizePhone(client.phone);
    const accessToken = signSession({
        type: 'client',
        id: String(client.id),
        name: safeText(client.name, 100),
        phone: normalizedClientPhone
    }, ACCESS_TTL);
    let refreshToken;
    try {
        refreshToken = await createRefreshToken(supabase, String(client.id), 'client', REFRESH_TTL);
    } catch (persistError) {
        if (process.env.NODE_ENV !== 'test') {
            console.error('[Client OTP] Falha ao persistir sessão:', persistError.code || persistError.message);
        }
        return res.status(503).json({ error: 'Não foi possível validar agora.', code: 'OTP_UNAVAILABLE' });
    }
    setSessionCookie(res, accessToken, ACCESS_TTL);
    setRefreshCookie(res, refreshToken.token, REFRESH_TTL);

    return res.json({
        message: 'success',
        client_authenticated: true,
        data: { id: client.id, name: client.name, phone: normalizedClientPhone }
    });
});

app.get('/api/session', async (req, res) => {
    const session = req.auth || readSession(req);

    if (!session || session.action) {
        // An expired access cookie backed by a live refresh token is a renewable
        // session, not a visitor who has to log in again.
        let needsRefresh = false;
        try {
            const record = await findRefreshToken(supabase, readRefreshToken(req));
            needsRefresh = Boolean(record && !record.revoked && !record.expired);
        } catch (error) {
            console.error('[Session] Falha ao consultar refresh token:', error.code || error.message);
            return res.status(503).json({ error: 'Não foi possível validar sua sessão agora.' });
        }
        return res.status(401).json({ error: 'Sessão não encontrada.', needsRefresh });
    }

    if (session.type === 'client') {
        return res.json({ message: 'success', data: { type: 'client', name: session.name, phone: session.phone }, needsRefresh: false });
    }

    const settingsMap = await loadSettingsMap().catch(() => ({}));

    if (session.profile) {
        const staffObj = { type: 'staff', ...session.profile };
        return res.json({
            message: 'success',
            data: {
                type: 'staff',
                ...session.profile,
                is_owner: isOwner(staffObj),
                can_view_client_phones: canViewClientPhone(staffObj, settingsMap)
            },
            needsRefresh: false
        });
    }

    const { data, error } = await supabase
        .from('professionals')
        .select('id, name, role, avatar, username, specialty, status')
        .eq('id', session.id)
        .eq('status', 'ativo')
        .maybeSingle();
    if (error) {
        console.error('[Session] Falha ao recarregar o perfil:', error.code || error.message);
        return res.status(503).json({ error: 'Não foi possível validar sua sessão agora.' });
    }
    if (!data) {
        clearSessionCookie(res);
        clearRefreshCookie(res);
        clearStaffSessionFlagCookie(res);
        await revokeRefreshTokenFamily(supabase, session.id, 'staff').catch(() => {});
        return res.status(401).json({ error: 'Sessão expirada.', needsRefresh: false });
    }
    const staffObj = { type: 'staff', ...data };
    res.json({
        message: 'success',
        data: {
            type: 'staff',
            ...data,
            is_owner: isOwner(staffObj),
            can_view_client_phones: canViewClientPhone(staffObj, settingsMap)
        },
        needsRefresh: false
    });
});

app.post('/api/logout', async (req, res) => {
    const presentedToken = readRefreshToken(req);
    if (presentedToken) {
        try {
            const record = await findRefreshToken(supabase, presentedToken);
            if (record && !record.revoked) {
                await revokeRefreshToken(supabase, record.id);
            } else if (record) {
                // A already rotated token arriving at logout means the cookie is
                // stale or leaked, so nothing in that lineage stays usable.
                await revokeRefreshTokenFamily(supabase, record.userId, record.userType);
            }
        } catch (error) {
            console.error('[Logout] Não foi possível revogar o refresh token:', error.code || error.message);
        }
    }
    clearSessionCookie(res);
    clearRefreshCookie(res);
    clearStaffSessionFlagCookie(res);
    res.json({ message: 'success' });
});

const REFRESH_INVALID = Object.freeze({ error: 'Sua sessão expirou. Entre novamente.', code: 'REFRESH_INVALID' });
const REFRESH_UNAVAILABLE = Object.freeze({ error: 'Não foi possível renovar sua sessão agora.', code: 'REFRESH_UNAVAILABLE' });

function endRefreshedSession(res) {
    clearSessionCookie(res);
    clearRefreshCookie(res);
    clearStaffSessionFlagCookie(res);
    return res.status(401).json(REFRESH_INVALID);
}

// Its own bucket on purpose: renewing a session must never consume, or be
// blocked by, the login buckets.
app.post('/api/auth/refresh', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyPrefix: 'token-refresh',
    message: 'Muitas tentativas de renovação. Aguarde alguns minutos.'
}), async (req, res) => {
    const presentedToken = readRefreshToken(req);
    if (!presentedToken) return endRefreshedSession(res);

    let record;
    try {
        record = await findRefreshToken(supabase, presentedToken);
    } catch (error) {
        console.error('[Refresh] Falha ao consultar refresh token:', error.code || error.message);
        // A database hiccup is not a credential problem: keep the cookies.
        return res.status(503).json(REFRESH_UNAVAILABLE);
    }

    if (!record) return endRefreshedSession(res);

    if (record.revoked) {
        if (isBenignRefreshReuse(record)) {
            // Two requests raced the same rotation. The cookie jar already holds
            // the replacement, so the caller only has to retry once.
            return res.status(401).json({ error: 'Renovação concorrente. Tente novamente.', code: 'REFRESH_RETRY' });
        }
        // Replaying a rotated token means it leaked. Drop the whole lineage.
        try {
            await revokeRefreshTokenFamily(supabase, record.userId, record.userType);
        } catch (error) {
            console.error('[Refresh] Falha ao revogar família de tokens:', error.code || error.message);
        }
        return endRefreshedSession(res);
    }

    if (record.expired) {
        await revokeRefreshToken(supabase, record.id).catch(() => {});
        return endRefreshedSession(res);
    }

    const isStaff = record.userType === 'staff';
    const { data: account, error: accountError } = isStaff
        ? await supabase
            .from('professionals')
            .select('id, name, role, avatar, username, specialty, status')
            .eq('id', record.userId)
            .eq('status', 'ativo')
            .maybeSingle()
        : await supabase
            .from('clients')
            .select('id, name, phone')
            .eq('id', record.userId)
            .maybeSingle();

    if (accountError) {
        console.error('[Refresh] Falha ao recarregar a identidade:', accountError.code || accountError.message);
        return res.status(503).json(REFRESH_UNAVAILABLE);
    }
    if (!account) {
        // Account deactivated or removed while the refresh token was still alive.
        await revokeRefreshTokenFamily(supabase, record.userId, record.userType).catch(() => {});
        return endRefreshedSession(res);
    }

    let rotated;
    try {
        rotated = await rotateRefreshToken(supabase, record.id, record.userId, record.userType, REFRESH_TTL);
    } catch (error) {
        console.error('[Refresh] Falha ao rotacionar refresh token:', error.code || error.message);
        return res.status(503).json(REFRESH_UNAVAILABLE);
    }
    setRefreshCookie(res, rotated.token, REFRESH_TTL);

    if (!isStaff) {
        const clientName = safeText(account.name, 100);
        const clientPhone = normalizePhone(account.phone);
        setSessionCookie(res, signSession({
            type: 'client',
            id: String(account.id),
            name: clientName,
            phone: clientPhone
        }, ACCESS_TTL), ACCESS_TTL);
        return res.json({
            message: 'success',
            data: { type: 'client', name: clientName, phone: clientPhone }
        });
    }

    setSessionCookie(res, signSession({
        type: 'staff',
        id: String(account.id),
        role: account.role
    }, ACCESS_TTL), ACCESS_TTL);
    setStaffSessionFlagCookie(res, REFRESH_TTL);

    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const staffObj = { type: 'staff', ...account };
    res.json({
        message: 'success',
        data: {
            type: 'staff',
            ...account,
            is_owner: isOwner(staffObj),
            can_view_client_phones: canViewClientPhone(staffObj, settingsMap)
        }
    });
});

const defaultServicesMock = [
    { id: 'srv-1', name: 'Manicure Tradicional', price: 45, duration: 40, category: 'Mãos', description: 'Cutilagem e esmaltação perfeita com acabamento duradouro.', status: 'ativo' },
    { id: 'srv-2', name: 'Pedicure Tradicional', price: 55, duration: 45, category: 'Pés', description: 'Cuidado completo para os pés, esfoliação e cutilagem.', status: 'ativo' },
    { id: 'srv-3', name: 'Esmaltação em Gel', price: 80, duration: 60, category: 'Mãos', description: 'Brilho intenso e durabilidade de até 20 dias.', status: 'ativo' },
    { id: 'srv-4', name: 'Spá dos Pés', price: 90, duration: 60, category: 'Pés', description: 'Hidratação profunda, esfoliação e massagem relaxante.', status: 'ativo' },
    { id: 'srv-5', name: 'Alongamento de Unhas', price: 150, duration: 120, category: 'Alongamento', description: 'Alongamento em gel ou fibra de vidro com acabamento natural.', status: 'ativo' }
];

const defaultProfessionalsMock = [
    { id: 'pro-1', name: 'Mary Silva', specialty: 'Especialista em Gel & Nails', bio: 'Mais de 8 anos de experiência em nail art, alongamentos em fibra e cuidados especiais.', avatar: 'M', status: 'ativo', skills: ['Alongamento em Gel', 'Nail Art', 'Spá'] },
    { id: 'pro-2', name: 'Juliana Oliveira', specialty: 'Manicure & Pedicure Premium', bio: 'Focada em cutilagem russa, biossegurança e esmaltação de alta durabilidade.', avatar: 'J', status: 'ativo', skills: ['Cutilagem Russa', 'Pedicure', 'Esmaltação'] },
    { id: 'pro-3', name: 'Beatriz Santos', specialty: 'Designer de Unhas & Alongamento', bio: 'Apaixonada por transformações de unhas, formatos elegantes e decorações exclusivas.', avatar: 'B', status: 'ativo', skills: ['Fibra de Vidro', 'Formatos Elegantes', 'Francesinha'] }
];

// --- ROTAS DE SERVIÇOS ---
app.get('/api/services', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('services')
            .select('id, name, duration, price, category, description, status')
            .eq('status', 'ativo')
            .order('category', { ascending: true })
            .order('name', { ascending: true });

        if (error || !data || data.length === 0) {
            return res.json({ message: "success", data: defaultServicesMock });
        }
        res.json({ message: "success", data });
    } catch {
        res.json({ message: "success", data: defaultServicesMock });
    }
});

app.post('/api/services', requireStaff('admin'), async (req, res) => {
    const name = safeText(req.body.name, 100);
    const category = safeText(req.body.category || 'Geral', 60);
    const description = safeText(req.body.description, 500);
    const duration = Number(req.body.duration);
    const price = Number(req.body.price);
    if (!name || !Number.isInteger(duration) || duration < 5 || duration > 480 || !Number.isFinite(price) || price < 0 || price > 100000) {
        return res.status(400).json({ error: 'Revise nome, duração e preço do serviço.' });
    }
    const { data, error } = await supabase
        .from('services')
        .insert([{ 
            name, 
            duration, 
            price, 
            category,
            description,
            status: 'ativo' 
        }])
        .select();
    
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível cadastrar o serviço.') });
    res.json({ "message": "success", "data": data[0] });
});

app.delete('/api/services/:id', requireStaff('admin'), async (req, res) => {
    const { error } = await supabase
        .from('services')
        .update({ status: 'inativo' })
        .eq('id', req.params.id);
        
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível desativar o serviço.') });
    res.json({ "message": "success" });
});

app.put('/api/services/:id', requireStaff('admin'), async (req, res) => {
    const { id } = req.params;
    const name = safeText(req.body.name, 100);
    const category = safeText(req.body.category || 'Geral', 60);
    const description = safeText(req.body.description, 500);
    const duration = Number(req.body.duration);
    const price = Number(req.body.price);

    if (!name || !Number.isInteger(duration) || duration < 5 || duration > 480 || !Number.isFinite(price) || price < 0 || price > 100000) {
        return res.status(400).json({ error: 'Revise nome, duração e preço do serviço.' });
    }

    // 1. Atualiza a tabela de serviços
    const { data: updatedServices, error } = await supabase
        .from('services')
        .update({ name, duration, price, category, description })
        .eq('id', id)
        .select();

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível atualizar o serviço.') });

    const updatedService = updatedServices && updatedServices[0] ? updatedServices[0] : { id, name, duration, price, category, description };

    // 2. Sincroniza agendamentos marcados que possuem múltiplos serviços salvos em 'notes'
    try {
        const { data: multiApps } = await supabase
            .from('appointments')
            .select('id, notes')
            .neq('status', 'cancelado')
            .like('notes', '%MULTI_SERVICES:%');

        if (multiApps && multiApps.length > 0) {
            for (const app of multiApps) {
                if (!app.notes || typeof app.notes !== 'string') continue;
                try {
                    const parts = app.notes.split('|');
                    const multiIndex = parts.findIndex(p => p.startsWith('MULTI_SERVICES:'));
                    if (multiIndex === -1) continue;

                    const jsonPart = parts[multiIndex].replace('MULTI_SERVICES:', '');
                    let multiData = JSON.parse(jsonPart);
                    let changed = false;

                    multiData = multiData.map(srv => {
                        if (String(srv.id) === String(id)) {
                            changed = true;
                            return { ...srv, name, price, duration };
                        }
                        return srv;
                    });

                    if (changed) {
                        parts[multiIndex] = `MULTI_SERVICES:${JSON.stringify(multiData)}`;
                        const newNotes = parts.join('|');
                        await supabase
                            .from('appointments')
                            .update({ notes: newNotes })
                            .eq('id', app.id);
                    }
                } catch (e) {
                    console.error('Erro ao atualizar agendamento com MULTI_SERVICES:', e);
                }
            }
        }
    } catch (e) {
        console.error('Erro ao sincronizar agendamentos no update de serviço:', e);
    }

    res.json({ message: "success", data: updatedService });
});

// --- ROTAS DE PROFISSIONAIS ---
app.get('/api/professionals', async (req, res) => {
    try {
        const canViewPrivate = req.auth?.type === 'staff' && (
            req.auth.role === 'admin' || isReminderPrivileged(req.auth)
        );
        const publicColumns = 'id, name, avatar, specialty, status';
        const staffColumns = 'id, name, role, avatar, specialty, username, status, whatsapp_phone';
        let { data, error } = await supabase
            .from('professionals')
            .select(canViewPrivate ? staffColumns : publicColumns)
            .eq('status', 'ativo')
            .order('name');

        if (error && canViewPrivate && isMissingWhatsappPhoneColumn(error)) {
            ({ data, error } = await supabase
                .from('professionals')
                .select('id, name, role, avatar, specialty, username, status')
                .eq('status', 'ativo')
                .order('name'));
        }
        
        let professionalsList = data;
        if (error || !data || data.length === 0) {
            professionalsList = defaultProfessionalsMock;
        }

        const settingsMap = await loadSettingsMap().catch(() => ({}));
        const withSchedule = await Promise.all((professionalsList || []).map(async (professional) => {
            const visible = canViewPrivate
                ? presentStaffWhatsApp(professional)
                : omitStaffWhatsApp(professional);
            return {
                ...visible,
                ...await buildProfessionalScheduleWithExceptions(supabase, settingsMap, professional.id)
            };
        }));

        res.json({ message: "success", data: withSchedule });
    } catch {
        res.json({ message: "success", data: defaultProfessionalsMock.map(omitStaffWhatsApp) });
    }
});

app.get('/api/professionals/:id', async (req, res) => {
    const { id } = req.params;
    const canViewPrivate = req.auth?.type === 'staff' && (
        req.auth.role === 'admin' || isReminderOwner(req.auth) || sameSubject(req.auth.id, id)
    );
    const publicColumns = 'id, name, avatar, specialty, status';
    const staffColumns = 'id, name, role, avatar, specialty, username, status, whatsapp_phone';
    let { data, error } = await supabase
        .from('professionals')
        .select(canViewPrivate ? staffColumns : publicColumns)
        .eq('id', id)
        .eq('status', 'ativo')
        .maybeSingle();

    if (error && canViewPrivate && isMissingWhatsappPhoneColumn(error)) {
        ({ data, error } = await supabase
            .from('professionals')
            .select('id, name, role, avatar, specialty, username, status')
            .eq('id', id)
            .eq('status', 'ativo')
            .maybeSingle());
    }

    if (error || !data) return res.status(404).json({ "error": "Profissional não encontrado." });

    try {
        const settingsMap = await loadSettingsMap();
        const scheduleWithExceptions = await buildProfessionalScheduleWithExceptions(supabase, settingsMap, data.id);
        const payload = canViewPrivate ? presentStaffWhatsApp(data) : omitStaffWhatsApp(data);
        res.json({
            "message": "success",
            "data": {
                ...payload,
                ...scheduleWithExceptions
            }
        });
    } catch (settingsError) {
        res.status(400).json({ error: safeDbErrorMessage(settingsError, 'Não foi possível carregar as configurações do profissional.') });
    }
});

app.put('/api/professionals/:id/whatsapp_phone', requireStaff(), async (req, res) => {
    const { id } = req.params;
    if (!isReminderPrivileged(req.auth) && !sameSubject(req.auth.id, id)) {
        return res.status(403).json({ error: 'Você só pode editar o próprio WhatsApp profissional.' });
    }

    const rawPhone = req.body?.whatsapp_phone;
    const wantsClear = rawPhone == null || String(rawPhone).trim() === '';
    const normalized = wantsClear ? null : normalizeE164(rawPhone);
    if (!wantsClear && !isValidE164(normalized)) {
        return res.status(400).json({ error: 'Informe um WhatsApp válido, por exemplo +5511999999999.' });
    }

    const professionalId = /^\d+$/.test(String(id)) ? Number(id) : id;
    const { data, error } = await supabase
        .from('professionals')
        .update({ whatsapp_phone: normalized })
        .eq('id', professionalId)
        .select('id, name, role, status, whatsapp_phone')
        .maybeSingle();

    if (error) {
        console.error('[PUT /api/professionals/:id/whatsapp_phone] Supabase error:', {
            code: error.code || null,
            message: error.message || null,
            details: error.details || null,
            hint: error.hint || null
        });
        const mapped = staffWhatsAppWriteError(error);
        return res.status(mapped.status).json({ error: mapped.error });
    }
    if (!data) {
        return res.status(404).json({ error: 'Profissional não encontrado.' });
    }
    res.json({ message: 'success', data: presentStaffWhatsApp(data) });
});

app.post('/api/professionals', requireStaff('admin'), async (req, res) => {
    const name = safeText(req.body.name, 100);
    const avatar = safeText(req.body.avatar, 2).toUpperCase();
    const specialty = safeText(req.body.specialty, 100);
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    
    if (!name || !specialty || !avatar || !/^[\p{L}\p{N}._-]{3,50}$/u.test(username) || password.length < 8) {
        return res.status(400).json({ "error": "Preencha os campos e use uma senha com pelo menos 8 caracteres." });
    }
    const passwordHash = await hashPassword(password);
    const { data: maxRow } = await supabase
        .from('professionals')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
    const nextId = (maxRow && maxRow[0] ? maxRow[0].id : 0) + 1;

    const { data, error } = await supabase
        .from('professionals')
        .insert([{ id: nextId, name, avatar, specialty, status: "ativo", username, password: passwordHash, role: "professional" }])
        .select('id, name, role, avatar, specialty, username, status');
    
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível cadastrar o profissional.') });
    res.json({ "message": "success", "data": data[0] });
});

app.put('/api/professionals/:id', requireStaff(), async (req, res) => {
    const { id } = req.params;
    if (req.auth.role !== 'admin' && !sameSubject(req.auth.id, id)) {
        return res.status(403).json({ error: 'Você só pode editar o próprio perfil.' });
    }
    const name = safeText(req.body.name, 100);
    const specialty = safeText(req.body.specialty, 100);
    const avatar = safeText(req.body.avatar, 2).toUpperCase();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();

    if (!name || !specialty || !avatar || !/^[\p{L}\p{N}._-]{3,50}$/u.test(username)) {
        return res.status(400).json({ "error": "Nome, especialidade, iniciais e usuário são obrigatórios." });
    }
    if (password && password.length < 8) {
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    }

    const { data: existingUsername, error: usernameError } = await supabase
        .from('professionals')
        .select('id')
        .ilike('username', username)
        .neq('id', id)
        .limit(1);

    if (usernameError) {
        return res.status(400).json({ error: safeDbErrorMessage(usernameError, 'Não foi possível validar o nome de usuário.') });
    }

    if (existingUsername && existingUsername.length > 0) {
        return res.status(400).json({ "error": "Este nome de usuário já está em uso." });
    }

    const updatePayload = { name, specialty, avatar, username };
    if (password) updatePayload.password = await hashPassword(password);

    const { data, error } = await supabase
        .from('professionals')
        .update(updatePayload)
        .eq('id', id)
        .select('id, name, role, avatar, specialty, username, status')
        .single();

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível atualizar o perfil.') });
    res.json({ "message": "success", "data": data });
});

app.delete('/api/professionals/:id', requireStaff('admin'), async (req, res) => {
    // Soft Delete: Apenas desativamos para não quebrar o histórico de faturamento
    const { error } = await supabase
        .from('professionals')
        .update({ status: 'inativo' })
        .eq('id', req.params.id);
        
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível desativar o profissional.') });
    res.json({ "message": "success" });
});

// --- ROTAS DE CLIENTES ---
app.get('/api/clients/check/:phone', requireStaff(), async (req, res) => {
    const { phone } = req.params;
    const cleanPhone = phone.replace(/\D/g, "");
    if (!isValidPhone(cleanPhone)) return res.status(400).json({ error: 'WhatsApp inválido.' });

    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const canViewPhones = canViewClientPhone(req.auth, settingsMap);
    
    // Tenta exato ou limpo
    const { data: client, error } = await supabase
        .from('clients')
        .select('id, name, phone')
        .or(`phone.eq.${phone},phone.eq.${cleanPhone}`)
        .maybeSingle();

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível consultar o cliente.') });
    
    if (!client) {
        return res.json({ "message": "new", "exists": false });
    }
    
    res.json({
        "message": "found",
        "exists": true,
        "data": {
            ...client,
            phone: maskPhone(client.phone, canViewPhones)
        }
    });
});

app.get('/api/clients', requireStaff(), async (req, res) => {
    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const canViewPhones = canViewClientPhone(req.auth, settingsMap);
    const { data, error } = await supabase.from('clients').select('id, name, phone').order('name');
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível listar os clientes.') });
    const formatted = (data || []).map(c => ({
        ...c,
        phone: maskPhone(c.phone, canViewPhones)
    }));
    res.json({ "message": "success", "data": formatted });
});

app.put('/api/clients/:id', requireStaff(), async (req, res) => {
    const { id } = req.params;
    const name = safeText(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const canViewPhones = canViewClientPhone(req.auth, settingsMap);
    const rawPhone = req.body.phone;
    const isProtected = isProtectedPhone(rawPhone);

    const updatePayload = { name };
    if (!isProtected && canViewPhones) {
        const phone = normalizePhone(rawPhone);
        if (!isValidPhone(phone)) return res.status(400).json({ error: 'WhatsApp inválido.' });
        updatePayload.phone = phone;
    }

    const { data, error } = await supabase
        .from('clients')
        .update(updatePayload)
        .eq('id', id)
        .select();
    
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível atualizar o cliente.') });
    if (!data || data.length === 0) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json({
        "message": "success",
        "data": {
            ...data[0],
            phone: maskPhone(data[0].phone, canViewPhones)
        }
    });
});

app.delete('/api/clients/:id', requireStaff('admin'), async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível remover o cliente.') });
    res.json({ "message": "success" });
});

app.post('/api/clients', requireStaff(), async (req, res) => {
    const name = safeText(req.body.name, 100);
    const phone = normalizePhone(req.body.phone);
    if (!name || !isValidPhone(phone)) return res.status(400).json({ "error": "Nome e WhatsApp válidos são obrigatórios." });

    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const canViewPhones = canViewClientPhone(req.auth, settingsMap);

    try {
        // Busca robusta: tenta pelo telefone exato OU pelo telefone limpo
        const cleanPhone = phone.replace(/\D/g, "");
        const { data: byExact } = await supabase.from('clients').select('id, phone').eq('phone', phone).maybeSingle();
        const { data: byClean } = !byExact ? await supabase.from('clients').select('id, phone').eq('phone', cleanPhone).maybeSingle() : { data: null };
        const existing = byExact || byClean;
        
        let result;
        if (existing) {
            // Se já existe, atualizamos o nome se fornecido
            if (name) {
                result = await supabase.from('clients').update({ name }).eq('id', existing.id).select();
            } else {
                result = await supabase.from('clients').select('*').eq('id', existing.id);
            }
        } else {
            // Se não existe, criamos novo
            result = await supabase.from('clients').insert([{ name: name || 'Cliente Novo', phone: cleanPhone }]).select();
        }

        if (result.error) return res.status(400).json({ error: safeDbErrorMessage(result.error, 'Não foi possível salvar o cliente.') });
        const clientData = result.data[0];
        res.json({
            "message": "success",
            "data": {
                ...clientData,
                phone: maskPhone(clientData.phone, canViewPhones)
            }
        });
    } catch {
        res.status(500).json({ "error": "Erro interno ao processar cliente." });
    }
});

app.get('/api/clients/appointments', requireClient, async (req, res) => {
    const phone = req.auth.phone;
    const name = req.auth.name;
    const cleanPhone = (phone || "").replace(/\D/g, "");
    const suffix = cleanPhone.slice(-8);
    
    let query = supabase
        .from('appointments')
        .select(`
            *,
            service:services(id, name, price, duration),
            professional:professionals(id, name, avatar, specialty)
        `)
        .or(`client_phone.eq.${phone},client_phone.eq.${cleanPhone},client_phone.ilike.%${suffix}`)
        .order('date', { ascending: false })
        .order('time', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar os agendamentos.') });
    
    // Formatar para manter compatibilidade com o frontend
    const ownedAppointments = (data || []).filter(app => normalizePhone(app.client_phone) === cleanPhone);
    const formatted = ownedAppointments.map(app => ({
        ...app,
        service_name: app.service?.name,
        service_price: app.service?.price,
        service_duration: app.service?.duration,
        professional_name: app.professional?.name
    }));

    let client_name_res = name || "";
    if (!client_name_res && formatted.length > 0) {
        client_name_res = formatted[0].client_name;
    }

    res.json({ "message": "success", "data": { appointments: formatted, client_name: client_name_res } });
});

// Busca consolidada e robusta de histórico (Novo Endpoint Blindado)
app.get('/api/clients/my-history', requireClient, async (req, res) => {
    const { type } = req.query; // type can be 'future' or 'all'
    const phone = req.auth.phone;
    
    // LIMPEZA DE TELEFONE: Remove tudo que não é número
    const cleanPhone = (phone || "").replace(/\D/g, "");
    const suffix = cleanPhone.slice(-8);
    const today = new Date().toISOString().split('T')[0];

    let query = supabase
        .from('appointments')
        .select(`
            *,
            service:services(id, name, price, duration),
            professional:professionals(id, name, avatar, specialty)
        `)
        .or(`client_phone.eq.${phone},client_phone.eq.${cleanPhone},client_phone.ilike.%${suffix}`);

    // Filtro de tipo (futuros ou todos)
    if (type === 'future') {
        query = query.gte('date', today).neq('status', 'cancelado');
    }

    query = query.order('date', { ascending: type === 'future' }).order('time', { ascending: type === 'future' });

    const { data, error } = await query;

    if (error) {
        return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar o histórico.') });
    }
    
    const ownedAppointments = (data || []).filter(app => normalizePhone(app.client_phone) === cleanPhone);
    const formatted = ownedAppointments.map(app => ({
        ...app,
        service_name: app.service?.name,
        service_price: app.service?.price,
        service_duration: app.service?.duration,
        professional_name: app.professional?.name
    }));

    res.json({ "message": "success", "data": formatted });
});

// Busca apenas agendamentos futuros (Legado/Compatibilidade)
app.get('/api/clients/future-appointments', requireClient, async (req, res) => {
    const phone = req.auth.phone;
    
    const cleanPhone = (phone || "").replace(/\D/g, "");
    const suffix = cleanPhone.slice(-8);
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('appointments')
        .select(`
            *,
            service:services(id, name, price, duration),
            professional:professionals(id, name, avatar, specialty)
        `)
        .or(`client_phone.eq.${phone},client_phone.eq.${cleanPhone},client_phone.ilike.%${suffix}`)
        .gte('date', today)
        .neq('status', 'cancelado')
        .order('date', { ascending: true })
        .order('time', { ascending: true });

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar os agendamentos futuros.') });
    
    const ownedAppointments = (data || []).filter(app => normalizePhone(app.client_phone) === cleanPhone);
    const formatted = ownedAppointments.map(app => ({
        ...app,
        service_name: app.service?.name,
        service_price: app.service?.price,
        service_duration: app.service?.duration,
        professional_name: app.professional?.name
    }));

    res.json({ "message": "success", "data": formatted });
});

// --- ROTAS DE AGENDAMENTOS ---
app.get('/api/availability/next', rateLimit({
    windowMs: 60 * 1000,
    max: 45,
    keyPrefix: 'next-availability'
}), async (req, res) => {
    const limit = Math.min(8, Math.max(1, Number.parseInt(req.query.limit, 10) || 5));
    const settingsMap = await loadSettingsMap().catch(() => ({}));

    const today = getDateStringInTimeZone();
    const lastDay = new Date(`${today}T12:00:00Z`);
    lastDay.setUTCDate(lastDay.getUTCDate() + 20);
    const lastDate = lastDay.toISOString().slice(0, 10);

    const [{ data: professionalRows, error: professionalError }, { data: appointmentRows, error: appointmentError }] = await Promise.all([
        supabase.from('professionals').select('id, name, specialty, status').eq('status', 'ativo').order('id'),
        supabase
            .from('appointments')
            .select('date, time, notes, professional_id, service:services(duration)')
            .gte('date', today)
            .lte('date', lastDate)
            .neq('status', 'cancelado')
    ]);

    if (professionalError || appointmentError) {
        return res.status(500).json({ error: 'Não foi possível consultar os próximos horários.' });
    }

    const professionals = (professionalRows || []).filter(professional => {
        const searchable = `${professional.name || ''} ${professional.specialty || ''}`.toLocaleLowerCase('pt-BR');
        return !searchable.includes('sócio') && !searchable.includes('socio');
    });
    
    // Load all exceptions for these professionals
    const professionalIds = professionals.map(p => p.id);
    const { data: allExceptions } = await supabase
        .from('schedule_exceptions')
        .select('professional_id, exception_date, start_time, end_time, is_day_off')
        .in('professional_id', professionalIds)
        .gte('exception_date', today)
        .lte('exception_date', lastDate);
    
    const exceptionsByProfessional = {};
    if (allExceptions) {
        for (const exc of allExceptions) {
            if (!exceptionsByProfessional[exc.professional_id]) {
                exceptionsByProfessional[exc.professional_id] = {};
            }
            exceptionsByProfessional[exc.professional_id][exc.exception_date] = exc.is_day_off ? null : {
                start: exc.start_time,
                end: exc.end_time
            };
        }
    }
    
    const busyByProfessionalAndDate = new Map();
    for (const appointment of appointmentRows || []) {
        const key = `${appointment.professional_id}:${appointment.date}`;
        const entries = busyByProfessionalAndDate.get(key) || [];
        let duration = Number(appointment.service?.duration) || 30;
        if (appointment.notes?.startsWith('MULTI_SERVICES:')) {
            try {
                const marker = appointment.notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
                duration = JSON.parse(marker.replace('MULTI_SERVICES:', '')).reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
            } catch {}
        } else if (appointment.notes?.startsWith('BLOCK:')) {
            duration = Number.parseInt(appointment.notes.split(':')[1], 10) || duration;
        }
        entries.push({ start: timeToMinutes(appointment.time), duration });
        busyByProfessionalAndDate.set(key, entries);
    }

    const nowParts = new Intl.DateTimeFormat('en-US', {
        timeZone: process.env.BUSINESS_TIMEZONE || 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const nowValues = Object.fromEntries(nowParts.map(part => [part.type, part.value]));
    const currentMinutes = Number(nowValues.hour) * 60 + Number(nowValues.minute);
    const labelFormatter = new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC'
    });
    const suggestions = [];

    for (let offset = 0; offset <= 20 && suggestions.length < limit; offset += 1) {
        const cursor = new Date(`${today}T12:00:00Z`);
        cursor.setUTCDate(cursor.getUTCDate() + offset);
        const date = cursor.toISOString().slice(0, 10);
        const dayKey = DAY_NAME_MAP[cursor.getUTCDay()];

        for (const professional of professionals) {
            const schedule = buildProfessionalSchedule(settingsMap, professional.id);
            const window = getScheduleWindowForDay(schedule, dayKey);
            if (!window) continue;
            const workStart = window.start;
            const workEnd = window.end;
            const busy = busyByProfessionalAndDate.get(`${professional.id}:${date}`) || [];

            for (let start = workStart; start + 30 <= workEnd; start += schedule.slot_interval) {
                if (offset === 0 && start <= currentMinutes + 30) continue;
                const conflicts = busy.some(entry => start < entry.start + entry.duration && start + 30 > entry.start);
                if (conflicts) continue;
                const hours = String(Math.floor(start / 60)).padStart(2, '0');
                const minutes = String(start % 60).padStart(2, '0');
                suggestions.push({
                    id: `${professional.id}-${date}-${hours}${minutes}`,
                    date,
                    dateLabel: labelFormatter.format(cursor).replace('.', ''),
                    time: `${hours}:${minutes}`,
                    professional_id: professional.id,
                    professional: professional.name
                });
                break;
            }
            if (suggestions.length >= limit) break;
        }
    }

    res.json({ message: 'success', data: suggestions });
});

app.get('/api/availability', rateLimit({
    windowMs: 60 * 1000,
    max: 90,
    keyPrefix: 'availability'
}), async (req, res) => {
    const date = String(req.query.date || '');
    const professionalId = String(req.query.professional_id || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d+$/.test(professionalId)) {
        return res.status(400).json({ error: 'Data e profissional são obrigatórios.' });
    }

    let query = supabase
        .from('appointments')
        .select('time, notes, status, service:services(duration)')
        .eq('date', date)
        .eq('professional_id', professionalId)
        .neq('status', 'cancelado');

    const excludedAppointmentId = String(req.query.exclude_appointment_id || '');
    if (/^\d+$/.test(excludedAppointmentId)) {
        const excluded = await loadAppointmentForAuthorization(excludedAppointmentId);
        if (!excluded.error && canAccessAppointment(req.auth, excluded.data, { allowClient: true })) {
            query = query.neq('id', excludedAppointmentId);
        }
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Não foi possível consultar os horários.' });

    const busy = (data || []).map(appointment => {
        let duration = Number(appointment.service?.duration) || 30;
        if (appointment.notes?.startsWith('MULTI_SERVICES:')) {
            try {
                const marker = appointment.notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
                const services = JSON.parse(marker.replace('MULTI_SERVICES:', ''));
                duration = services.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
            } catch {}
        } else if (appointment.notes?.startsWith('BLOCK:')) {
            duration = Number.parseInt(appointment.notes.split(':')[1], 10) || duration;
        }
        return { time: appointment.time, service_duration: duration, status: 'ocupado' };
    });
    res.json({ message: 'success', data: busy });
});

app.get('/api/appointments', requireStaff(), async (req, res) => {
    const { date } = req.query;
    const professional_id = req.auth.role === 'admin' ? req.query.professional_id : req.auth.id;
    let query = supabase.from('appointments').select(`
        *,
        service:services(id, name, price, duration),
        professional:professionals(id, name, avatar, specialty)
    `);

    if (date) query = query.eq('date', date);
    if (professional_id) query = query.eq('professional_id', professional_id);
    
    query = query.order('date', { ascending: false }).order('time', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar os agendamentos.') });

    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const canViewPhones = canViewClientPhone(req.auth, settingsMap);
    
    const formatted = (data || []).map(app => {
        let duration = app.service?.duration;
        let sName = app.service?.name;
        let sPrice = app.service?.price;
        
        // Suporte a múltiplos serviços via campo 'notes'
        if (app.notes && typeof app.notes === 'string' && app.notes.startsWith('MULTI_SERVICES:')) {
            try {
                const parts = app.notes.split('|');
                const jsonPart = parts.find(p => p.startsWith('MULTI_SERVICES:')).replace('MULTI_SERVICES:', '');
                const multiData = JSON.parse(jsonPart);
                
                sName = multiData.map(s => s.name).join(' + ');
                duration = multiData.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
                sPrice = multiData.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
            } catch (e) {
                console.error('Erro ao parsear MULTI_SERVICES:', e);
            }
        } 
        else if (!duration && app.notes && typeof app.notes === 'string' && app.notes.startsWith('BLOCK:')) {
            duration = parseInt(app.notes.split(':')[1], 10);
            sName = "⏳ Agenda Fechada";
            sPrice = 0;
        }
        
        return {
            ...app,
            client_phone: maskPhone(app.client_phone, canViewPhones),
            service_name: sName,
            service_price: sPrice,
            service_duration: duration,
            professional_name: app.professional?.name,
            confirmation_token: createAppointmentToken(app.id)
        };
    });

    res.json({ "message": "success", "data": formatted });
});

app.post('/api/appointments', rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyPrefix: 'create-appointment',
    message: 'Muitos agendamentos foram enviados deste dispositivo. Tente novamente mais tarde.'
}), async (req, res) => {
    try {
        const isStaff = req.auth?.type === 'staff';
        const isClient = req.auth?.type === 'client' && !req.auth.action;
        const clientName = isClient ? req.auth.name : safeText(req.body.client_name, 100);
        const clientPhone = isClient ? normalizePhone(req.auth.phone) : normalizePhone(req.body.client_phone);
        const date = String(req.body.date || '');
        const time = String(req.body.time || '');
        let professionalId = String(req.body.professional_id || '');
        if (isStaff && req.auth.role !== 'admin') professionalId = String(req.auth.id);

        const submittedIds = Array.isArray(req.body.service_ids)
            ? req.body.service_ids
            : (req.body.service_id ? [req.body.service_id] : []);
        const serviceIds = [...new Set(submittedIds.map(id => String(id)).filter(Boolean))];

        if (!clientName || !isValidPhone(clientPhone)) {
            return res.status(400).json({ error: 'Informe seu nome e um WhatsApp válido.' });
        }
        if (!professionalId || serviceIds.length === 0 || serviceIds.length > 8) {
            return res.status(400).json({ error: 'Selecione um profissional e pelo menos um serviço.' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            return res.status(400).json({ error: 'Data ou horário inválido.' });
        }

        const settingsMap = await loadSettingsMap().catch(() => ({ allow_online_booking: 'true' }));
        const today = getDateStringInTimeZone();
        const maxAdvanceDays = Math.min(365, Math.max(1, Number(settingsMap.max_advance_days) || 60));
        const dayDistance = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
        if (!isStaff && (dayDistance < 0 || dayDistance > maxAdvanceDays)) {
            return res.status(400).json({ error: `Escolha uma data entre hoje e os próximos ${maxAdvanceDays} dias.` });
        }

        let professional = null;
        try {
            const { data: dbPro } = await supabase
                .from('professionals')
                .select('id, status')
                .eq('id', professionalId)
                .maybeSingle();
            professional = dbPro;
        } catch {}
        if (!professional) {
            professional = defaultProfessionalsMock.find(p => String(p.id) === String(professionalId)) || { id: professionalId, status: 'ativo' };
        }

        let services = [];
        try {
            const { data: dbServices } = await supabase
                .from('services')
                .select('id, name, duration, price, status')
                .in('id', serviceIds);
            services = dbServices || [];
        } catch {}
        if (!services || services.length === 0) {
            services = defaultServicesMock.filter(s => serviceIds.includes(String(s.id)));
        }
        if (!services || services.length === 0) {
            services = serviceIds.map(id => ({ id, name: 'Serviço Agendado', duration: 40, price: 50, status: 'ativo' }));
        }

        const totalDuration = services.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);

        const professionalSchedule = buildProfessionalSchedule(settingsMap, professionalId);
        const allowOutsideHours = isStaff;
        const validation = validateAppointmentAgainstSchedule({
            date,
            time,
            duration: totalDuration,
            schedule: professionalSchedule,
            ignoreExpedientLimit: allowOutsideHours
        });
        if (!validation.valid) return res.status(400).json({ error: validation.error });

        let existing = [];
        if (!isStaff) {
            try {
                const { data: dbExisting } = await supabase.from('appointments')
                    .select('time, notes, service:services(duration)')
                    .eq('professional_id', professionalId)
                    .eq('date', date)
                    .neq('status', 'cancelado');
                existing = dbExisting || [];
            } catch {}
        }

        if (!isStaff && hasAppointmentCollision(existing, time, totalDuration)) {
            return res.status(409).json({ error: 'Este horário acabou de ser ocupado. Escolha outro horário.' });
        }

        const userNotes = isStaff ? safeText(req.body.notes, 500) : '';
        const multiInfo = services.map(service => ({
            id: service.id,
            name: service.name,
            duration: service.duration,
            price: service.price
        }));
        const appointmentNotes = services.length > 1
            ? `MULTI_SERVICES:${JSON.stringify(multiInfo)}${userNotes ? `|NOTE:${userNotes}` : ''}`
            : userNotes;
        const primaryServiceId = serviceIds.includes(String(req.body.service_id))
            ? req.body.service_id
            : services[0].id;

        const { data: dbInserted, error: insertError } = await supabase.from('appointments').insert([{
                client_name: clientName,
                client_phone: clientPhone,
                service_id: primaryServiceId,
                professional_id: professionalId,
                date,
                time,
                status: 'agendado',
                notes: appointmentNotes
            }]).select();
        if (insertError) {
            const message = insertError.code === '23505' && isStaff
                ? 'A trava antiga de sobreposição ainda está ativa no banco de dados. Aplique a atualização do Supabase e tente novamente.'
                : 'Não foi possível salvar o agendamento.';
            return res.status(insertError.code === '23505' ? 409 : 400).json({ error: message });
        }
        const insertedAppointment = dbInserted?.[0];
        if (!insertedAppointment) return res.status(500).json({ error: 'O banco não confirmou o novo agendamento.' });

        try {
            await supabase.from('notifications').insert([{
                client_name: clientName,
                service_name: services.map(service => service.name).join(', '),
                date,
                time,
                is_read: false
            }]);
        } catch {}

        let clientRecord = null;
        try {
            const { data: clientCandidates } = await supabase
                .from('clients')
                .select('id, name, phone')
                .ilike('phone', `%${clientPhone.slice(-4)}%`)
                .limit(100);
            clientRecord = (clientCandidates || []).find(candidate => normalizePhone(candidate.phone) === clientPhone) || null;
            if (!clientRecord) {
                const { data: insertedClients } = await supabase
                    .from('clients')
                    .insert([{ name: clientName, phone: clientPhone }])
                    .select('id, name, phone');
                clientRecord = insertedClients?.[0] || null;
            }
        } catch {}

        const canStartClientSession = !isStaff && clientRecord && (
            isClient || (!clientOtpManager && normalizeName(clientRecord.name) === normalizeName(clientName))
        );
        if (canStartClientSession) {
            const maxAge = 30 * 24 * 60 * 60;
            setSessionCookie(res, signSession({
                type: 'client',
                id: String(clientRecord.id),
                name: safeText(clientRecord.name, 100),
                phone: clientPhone
            }, maxAge), maxAge);
        }

        try {
            const notifySummary = await reminderService.notifyNewBooking(insertedAppointment);
            if (process.env.NODE_ENV !== 'test') {
                console.info('[Reminders] novo agendamento', {
                    appointment_id: insertedAppointment.id,
                    sent: notifySummary.sent,
                    failed: notifySummary.failed,
                    suppressed: notifySummary.suppressed,
                    skipped: notifySummary.skipped,
                    owner_missing: notifySummary.owner_missing
                });
            }
        } catch (notifyError) {
            if (process.env.NODE_ENV !== 'test') {
                console.error('[Reminders] Falha ao notificar novo agendamento:', notifyError.code || notifyError.message);
            }
        }

        const canViewPhones = isStaff ? canViewClientPhone(req.auth, settingsMap) : true;
        const responseData = {
            ...insertedAppointment,
            client_phone: maskPhone(insertedAppointment.client_phone, canViewPhones)
        };

        res.status(201).json({
            message: 'success',
            data: responseData,
            client_authenticated: Boolean(canStartClientSession),
            client: canStartClientSession && clientRecord ? { name: clientRecord.name, phone: clientPhone } : undefined
        });
    } catch (err) {
        console.error('[Appointments] Falha inesperada:', err.message);
        res.status(500).json({ error: 'Não foi possível concluir o agendamento agora.' });
    }
});

// Criar um bloqueio de horário (Horário Fechado)
app.post('/api/appointments/block', requireStaff(), async (req, res) => {
    const professional_id = req.auth.role === 'admin' ? String(req.body.professional_id || '') : String(req.auth.id);
    const date = String(req.body.date || '');
    const time = String(req.body.time || '');
    const duration = Number(req.body.duration);
    const description = safeText(req.body.description, 160);
    if (!/^\d+$/.test(professional_id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(duration) || duration < 5 || duration > 720) {
        return res.status(400).json({ error: 'Revise profissional, data, horário e duração do bloqueio.' });
    }
    
    try {
        const newStart = timeToMinutes(time);
        const newEnd = newStart + duration;
        
        // Regra de Conflitos
        const { data: existing, error: eErr } = await supabase
            .from('appointments')
            .select(`
                time, 
                notes,
                service:services(duration)
            `)
            .eq('professional_id', professional_id)
            .eq('date', date)
            .neq('status', 'cancelado');
            
        if (!eErr && existing) {
            const hasConflict = existing.some(app => {
                const exStart = Number(timeToMinutes(app.time));
                let exDuration = 30;

                if (app.notes?.startsWith('MULTI_SERVICES:')) {
                    try {
                        const marker = app.notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
                        const services = JSON.parse(marker.replace('MULTI_SERVICES:', ''));
                        exDuration = services.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
                    } catch {}
                } else if (app.notes?.startsWith('BLOCK:')) {
                    exDuration = Number.parseInt(app.notes.split(':')[1], 10) || 30;
                } else if (app.service) {
                    const sDuration = Array.isArray(app.service)
                        ? Number(app.service[0]?.duration)
                        : Number(app.service?.duration);
                    if (Number.isFinite(sDuration) && sDuration > 0) exDuration = sDuration;
                }

                exDuration = Number(exDuration) || 30;
                const exEnd = exStart + exDuration;
                return newStart < exEnd && newEnd > exStart;
            });
            if (hasConflict) {
                return res.status(400).json({ "error": "Já existe um agendamento ou bloqueio neste horário." });
            }
        }
        
        // Inserir o Bloqueio
        const { data: insertData, error: insertError } = await supabase.from('appointments').insert([{
            client_name: description ? `Bloqueio: ${description}` : 'Bloqueio de Agenda',
            client_phone: '00000000000',
            service_id: null,
            professional_id,
            date,
            time,
            status: 'confirmado',
            notes: description ? `BLOCK:${duration}|${description}` : `BLOCK:${duration}`
        }]).select();
        
        if (insertError) return res.status(400).json({ error: safeDbErrorMessage(insertError, 'Não foi possível registrar o bloqueio.') });
        
        // Enrich with same fields as GET /api/appointments
        const raw = insertData[0];
        const { data: profData } = await supabase.from('professionals').select('name').eq('id', professional_id).single();
        const formatted = {
            ...raw,
            service_name: '⏳ Agenda Fechada',
            service_price: 0,
            service_duration: duration,
            professional_name: profData?.name || 'Equipe',
            confirmation_token: createAppointmentToken(raw.id)
        };
        
        res.json({ "message": "success", "data": formatted });
    } catch {
        res.status(400).json({ error: 'Não foi possível registrar o bloqueio de horário.' });
    }
});

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function getAppointmentDurationFromRow(appointment, fallback = 30) {
    let duration = Number(fallback) || 30;

    if (appointment?.notes?.startsWith('MULTI_SERVICES:')) {
        try {
            const marker = appointment.notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
            const services = JSON.parse(marker.replace('MULTI_SERVICES:', ''));
            duration = services.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);
        } catch {}
    } else if (appointment?.notes?.startsWith('BLOCK:')) {
        duration = Number.parseInt(appointment.notes.split(':')[1], 10) || duration;
    } else if (appointment?.service) {
        const serviceDuration = Array.isArray(appointment.service)
            ? Number(appointment.service[0]?.duration)
            : Number(appointment.service?.duration);
        if (Number.isFinite(serviceDuration) && serviceDuration > 0) duration = serviceDuration;
    }

    return Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 30;
}

async function loadAppointmentDuration(appointment) {
    const embeddedDuration = getAppointmentDurationFromRow(appointment, 0);
    if (appointment?.notes?.startsWith('MULTI_SERVICES:') || appointment?.notes?.startsWith('BLOCK:')) {
        return embeddedDuration;
    }
    if (!appointment?.service_id) return embeddedDuration;

    const { data: service } = await supabase
        .from('services')
        .select('duration')
        .eq('id', appointment.service_id)
        .maybeSingle();
    return Number(service?.duration) || embeddedDuration;
}

function hasAppointmentCollision(appointments, targetTime, targetDuration) {
    const targetStart = Number(timeToMinutes(targetTime));
    const targetEnd = targetStart + Number(targetDuration);

    return (appointments || []).some(appointment => {
        const existingStart = Number(timeToMinutes(appointment.time));
        const existingEnd = existingStart + getAppointmentDurationFromRow(appointment);
        return targetStart < existingEnd && targetEnd > existingStart;
    });
}

function sanitizeAppointmentNotes(value, existingNotes = '') {
    if (existingNotes.startsWith('BLOCK:')) return existingNotes;

    const cleanParts = [];
    if (existingNotes.startsWith('MULTI_SERVICES:')) {
        const multiMarker = existingNotes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
        if (multiMarker) cleanParts.push(multiMarker);
    }

    for (const rawPart of String(value || '').split('|').slice(0, 20)) {
        if (!rawPart || rawPart.startsWith('MULTI_SERVICES:') || rawPart.startsWith('BLOCK:')) continue;
        if (rawPart.startsWith('PAYMENT:')) {
            const method = safeText(rawPart.slice('PAYMENT:'.length), 40);
            if (['Dinheiro', 'PIX', 'Cartão de Crédito', 'Cartão de Débito'].includes(method)) cleanParts.push(`PAYMENT:${method}`);
            continue;
        }
        if (rawPart.startsWith('CHARGE:')) {
            const [, rawAmount, ...reasonParts] = rawPart.split(':');
            const amount = Number(rawAmount);
            const reason = safeText(reasonParts.join(':'), 120);
            if (Number.isFinite(amount) && amount >= 0 && amount <= 100000 && reason) {
                cleanParts.push(`CHARGE:${amount.toFixed(2)}:${reason}`);
            }
            continue;
        }
        const cleanPart = safeText(rawPart.replace(/^NOTE:/, ''), 500);
        if (cleanPart) cleanParts.push(`NOTE:${cleanPart}`);
    }
    return cleanParts.join('|').slice(0, 2000);
}

async function loadAppointmentForAuthorization(id) {
    const { data, error } = await supabase
        .from('appointments')
        .select('id, service_id, professional_id, client_phone, client_name, date, time, status, notes')
        .eq('id', id)
        .maybeSingle();
    return { data, error };
}

function canAccessAppointment(session, appointment, { allowClient = false } = {}) {
    if (!session || !appointment) return false;
    if (session.type === 'staff') {
        return session.role === 'admin' || sameSubject(session.id, appointment.professional_id);
    }
    return allowClient && session.type === 'client' && normalizePhone(session.phone) === normalizePhone(appointment.client_phone);
}

app.put('/api/appointments/:id/reschedule', rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyPrefix: 'client-reschedule',
    message: 'Muitas remarcações foram enviadas deste dispositivo. Tente novamente mais tarde.'
}), requireClient, async (req, res) => {
    const { id } = req.params;
    const date = String(req.body.date || '');
    const time = String(req.body.time || '');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return res.status(400).json({ error: 'Data ou horário inválido.' });
    }

    const ownership = await loadAppointmentForAuthorization(id);
    if (ownership.error || !ownership.data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (!canAccessAppointment(req.auth, ownership.data, { allowClient: true })) {
        return res.status(403).json({ error: 'Você não pode remarcar este agendamento.' });
    }
    if (['cancelado', 'concluído'].includes(ownership.data.status)) {
        return res.status(400).json({ error: 'Este agendamento não pode mais ser remarcado.' });
    }

    const settingsMap = await loadSettingsMap();
    const today = getDateStringInTimeZone();
    const maxAdvanceDays = Math.min(365, Math.max(1, Number(settingsMap.max_advance_days) || 60));
    const dayDistance = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (dayDistance < 0 || dayDistance > maxAdvanceDays) {
        return res.status(400).json({ error: `Escolha uma data entre hoje e os próximos ${maxAdvanceDays} dias.` });
    }

    if (date === today && timeToMinutes(time) <= timeToMinutes(getTimeStringInTimeZone())) {
        return res.status(400).json({ error: 'Escolha um horário futuro.' });
    }

    const duration = await loadAppointmentDuration(ownership.data);
    const schedule = buildProfessionalSchedule(settingsMap, ownership.data.professional_id);
    const scheduleValidation = validateClientRescheduleAgainstSchedule({
        date,
        time,
        duration,
        schedule,
        toleranceMinutes: 60
    });
    if (!scheduleValidation.valid) {
        return res.status(400).json({
            error: scheduleValidation.error,
            code: 'CLIENT_RESCHEDULE_CONTACT_REQUIRED',
            contact_required: true
        });
    }

    const { data: collisions, error: collisionError } = await supabase
        .from('appointments')
        .select('time, notes, service:services(duration)')
        .eq('professional_id', ownership.data.professional_id)
        .eq('date', date)
        .neq('id', id)
        .neq('status', 'cancelado');
    if (collisionError) return res.status(500).json({ error: 'Não foi possível validar o novo horário.' });
    if (hasAppointmentCollision(collisions, time, duration)) {
        return res.status(409).json({ error: 'O novo horário entra em conflito com outro compromisso. Escolha outro horário.' });
    }

    const { data, error } = await supabase
        .from('appointments')
        .update({ date, time, status: 'agendado' })
        .eq('id', id)
        .select();
    if (error) return res.status(400).json({ error: 'Não foi possível remarcar o agendamento.' });

    try {
        await supabase.from('notifications').insert([{
            client_name: ownership.data.client_name,
            service_name: 'Remarcação solicitada pela cliente',
            date,
            time,
            is_read: false
        }]);
    } catch {}

    const isClientOwner = req.auth?.type === 'client' && sameSubject(req.auth.phone, ownership.data.client_phone);
    const canViewPhones = isClientOwner || canViewClientPhone(req.auth, settingsMap);
    const resultApp = { ...(data?.[0] || { ...ownership.data, date, time, status: 'agendado' }) };
    if (resultApp.client_phone !== undefined) {
        resultApp.client_phone = maskPhone(resultApp.client_phone, canViewPhones);
    }
    res.json({ message: 'success', data: resultApp });
});

app.delete('/api/appointments/:id', requireStaff(), async (req, res) => {
    const ownership = await loadAppointmentForAuthorization(req.params.id);
    if (ownership.error || !ownership.data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (!canAccessAppointment(req.auth, ownership.data)) return res.status(403).json({ error: 'Você não pode excluir este agendamento.' });
    const { error } = await supabase.from('appointments').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível excluir o agendamento.') });
    res.json({ "message": "success" });
});

app.put('/api/appointments/:id', requireStaff(), async (req, res) => {
    const { id } = req.params;
    const { date, time, professional_id, status, notes } = req.body;
    const ownership = await loadAppointmentForAuthorization(id);
    if (ownership.error || !ownership.data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (!canAccessAppointment(req.auth, ownership.data)) return res.status(403).json({ error: 'Você não pode alterar este agendamento.' });
    
    const updatePayload = {};
    if (date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: 'Data inválida.' });
        updatePayload.date = String(date);
    }
    if (time !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return res.status(400).json({ error: 'Horário inválido.' });
        updatePayload.time = String(time);
    }
    if (professional_id !== undefined) {
        if (!/^\d+$/.test(String(professional_id))) return res.status(400).json({ error: 'Profissional inválido.' });
        updatePayload.professional_id = req.auth.role === 'admin' ? professional_id : req.auth.id;
    }
    if (status !== undefined) {
        const allowedStatuses = ['agendado', 'confirmado', 'cancelado', 'concluído'];
        if (!allowedStatuses.includes(String(status))) return res.status(400).json({ error: 'Status inválido.' });
        updatePayload.status = String(status);
    }
    if (notes !== undefined) {
        updatePayload.notes = sanitizeAppointmentNotes(notes, ownership.data.notes || '');
    }
    if (Object.keys(updatePayload).length === 0) return res.status(400).json({ error: 'Nenhuma alteração válida foi enviada.' });

    const { data, error } = await supabase
        .from('appointments')
        .update(updatePayload)
        .eq('id', id)
        .select();

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível atualizar o agendamento.') });
    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const canViewPhones = canViewClientPhone(req.auth, settingsMap);
    const updatedApp = { ...(data?.[0] || { ...ownership.data, ...updatePayload }) };
    if (updatedApp.client_phone !== undefined) {
        updatedApp.client_phone = maskPhone(updatedApp.client_phone, canViewPhones);
    }
    res.json({
        "message": "success",
        "data": updatedApp
    });
});

app.get('/api/appointments/:id/confirm-info', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    keyPrefix: 'confirm-info'
}), async (req, res) => {
    const { id } = req.params;
    const ownership = await loadAppointmentForAuthorization(id);
    if (ownership.error || !ownership.data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    
    const token = String(req.query.token || '');
    const validActionToken = verifyAppointmentToken(token, id);
    if (!validActionToken && !canAccessAppointment(req.auth, ownership.data, { allowClient: true })) {
        return res.status(401).json({ error: 'Este link de confirmação é inválido ou expirou.' });
    }

    const app = ownership.data;
    let serviceName = 'Serviço Agendado';
    let servicePrice = 0;
    let serviceDuration = 40;

    if (app.notes && app.notes.includes('MULTI_SERVICES:')) {
        try {
            const parts = app.notes.split('|');
            const jsonPart = parts.find(p => p.startsWith('MULTI_SERVICES:')).replace('MULTI_SERVICES:', '');
            const multi = JSON.parse(jsonPart);
            serviceName = multi.map(s => s.name).join(', ');
            servicePrice = multi.reduce((acc, s) => acc + (Number(s.price) || 0), 0);
            serviceDuration = multi.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
        } catch {}
    } else if (app.service_id) {
        try {
            const { data: dbSrv } = await supabase.from('services').select('name, price, duration').eq('id', app.service_id).maybeSingle();
            if (dbSrv) {
                serviceName = dbSrv.name;
                servicePrice = Number(dbSrv.price) || 0;
                serviceDuration = Number(dbSrv.duration) || 40;
            }
        } catch {}
    }

    let professionalName = 'Equipe';
    if (app.professional_id) {
        try {
            const { data: dbPro } = await supabase.from('professionals').select('name').eq('id', app.professional_id).maybeSingle();
            if (dbPro) professionalName = dbPro.name;
        } catch {}
    }

    const settingsMap = await loadSettingsMap().catch(() => ({}));
    const canViewPhones = validActionToken || (req.auth?.type === 'client' && sameSubject(req.auth.phone, app.client_phone))
        ? true
        : canViewClientPhone(req.auth, settingsMap);

    res.json({
        message: 'success',
        data: {
            id: app.id,
            client_name: app.client_name,
            client_phone: maskPhone(app.client_phone, canViewPhones),
            date: app.date,
            time: app.time,
            status: app.status,
            service_name: serviceName,
            service_price: servicePrice,
            service_duration: serviceDuration,
            professional_name: professionalName
        }
    });
});

app.post('/api/appointments/:id/confirm', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyPrefix: 'confirm-appointment'
}), async (req, res) => {
    const { id } = req.params;
    const ownership = await loadAppointmentForAuthorization(id);
    if (ownership.error || !ownership.data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    const validActionToken = verifyAppointmentToken(String(req.body.token || req.query.token || ''), id);
    if (!validActionToken && !canAccessAppointment(req.auth, ownership.data, { allowClient: true })) {
        return res.status(401).json({ error: 'Este link de confirmação é inválido ou expirou.' });
    }
    if (ownership.data.status === 'cancelado') return res.status(409).json({ error: 'Este agendamento foi cancelado.' });
    const { error } = await supabase
        .from('appointments')
        .update({ status: 'confirmado' })
        .eq('id', id);

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível confirmar o agendamento.') });
    res.json({ "message": "success", "status": "confirmado" });
});

app.post('/api/appointments/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const token = String(req.body?.token || req.query?.token || '');
    const validActionToken = token ? verifyAppointmentToken(token, id) : false;
    const ownership = await loadAppointmentForAuthorization(id);
    if (ownership.error || !ownership.data) {
        // Se for id sintético do mock (ex: block-123 ou appt-123), considera sucesso
        if (String(id).startsWith('block-') || String(id).startsWith('mock-') || String(id).startsWith('appt-')) {
            return res.json({ message: "success" });
        }
        return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }
    if (!validActionToken && !canAccessAppointment(req.auth, ownership.data, { allowClient: true })) {
        return res.status(403).json({ error: 'Você não pode desmarcar este compromisso.' });
    }

    const isBlock = ownership.data.notes?.startsWith('BLOCK:');

    // Se for bloqueio de horário ou ação do profissional/admin, deleta do banco para liberar a agenda 100%
    if (isBlock || req.auth?.type === 'staff') {
        const { error: delErr } = await supabase.from('appointments').delete().eq('id', id);
        if (delErr) {
            await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', id);
        }
        return res.json({ message: "success" });
    }

    if (ownership.data.status === 'concluído') {
        return res.status(409).json({ error: 'Um atendimento já concluído não pode ser cancelado.' });
    }

    if (req.auth?.type === 'client' || validActionToken) {
        const appointmentDateTime = new Date(`${ownership.data.date}T${ownership.data.time}:00-03:00`);
        if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= new Date()) {
            return res.status(409).json({ error: 'Este horário já passou e não pode mais ser cancelado online.' });
        }
    }

    const { error } = await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .eq('id', id);

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível cancelar o agendamento.') });
    res.json({ message: "success" });
});

app.post('/api/jobs/appointment-reminders', requireCronSecret(), rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    keyPrefix: 'appointment-reminders-job',
    message: 'O job de lembretes já foi disparado recentemente.'
}), async (req, res) => {
    try {
        const summary = await reminderService.runAutomaticJob();
        res.json({ message: 'success', data: summary });
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
            console.error('[Reminders] Job falhou:', error.code || error.message);
        }
        res.status(503).json({ error: 'Não foi possível processar os lembretes agora.' });
    }
});

app.post('/api/appointments/:id/reminders', requireStaff(), rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyPrefix: 'appointment-reminder-manual',
    message: 'Muitos lembretes manuais. Aguarde alguns minutos.'
}), async (req, res) => {
    const { id } = req.params;
    const { data: appointment, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (error || !appointment) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (!isReminderPrivileged(req.auth) && !sameSubject(req.auth.id, appointment.professional_id)) {
        return res.status(403).json({ error: 'Você não pode enviar lembrete deste agendamento.' });
    }

    const result = await reminderService.sendClientReminder(appointment, {
        mode: 'manual',
        confirm: req.body?.confirm === true,
        createdByStaffId: String(req.auth.id),
        sessionWindowOpen: req.body?.session_window_open === true
    });
    if (result.needs_confirm) {
        return res.status(409).json({ needs_confirm: true, error: result.error });
    }
    if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error, data: result.event || null });
    }
    res.json({ message: 'success', data: result.event, suppressed: Boolean(result.suppressed), skipped: Boolean(result.skipped) });
});

app.get('/api/appointments/:id/message-events', requireStaff(), async (req, res) => {
    const { id } = req.params;
    const { data: appointment, error } = await supabase
        .from('appointments')
        .select('id, professional_id')
        .eq('id', id)
        .maybeSingle();
    if (error || !appointment) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (!isReminderPrivileged(req.auth) && !sameSubject(req.auth.id, appointment.professional_id)) {
        return res.status(403).json({ error: 'Você não pode ver os eventos deste agendamento.' });
    }
    try {
        const events = await reminderService.listMessageEvents(id, req.auth, { appointment });
        res.json({ message: 'success', data: events });
    } catch (listError) {
        res.status(400).json({ error: safeDbErrorMessage(listError, 'Não foi possível carregar os eventos de mensagem.') });
    }
});

app.post('/api/appointments/:id/complete', requireStaff(), async (req, res) => {
    const { id } = req.params;
    const ownership = await loadAppointmentForAuthorization(id);
    if (ownership.error || !ownership.data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (!canAccessAppointment(req.auth, ownership.data)) return res.status(403).json({ error: 'Você não pode concluir este agendamento.' });
    const { error } = await supabase
        .from('appointments')
        .update({ status: 'concluído' })
        .eq('id', id);

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível concluir o agendamento.') });
    res.json({ "message": "success" });
});

app.get('/api/financial/stats', requireStaff('admin'), async (req, res) => {
    const { data, error } = await supabase
        .from('appointments')
        .select(`
            *,
            service:services(price, duration),
            professional:professionals(id, name)
        `)
        .neq('status', 'cancelado');

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar as estatísticas financeiras.') });

    const todayStr = getDateStringInTimeZone();
    const localNow = new Date(`${todayStr}T12:00:00Z`);
    const dayOfWeek = localNow.getUTCDay(); // 0 is Sunday
    const startOfWeek = new Date(localNow);
    startOfWeek.setUTCDate(localNow.getUTCDate() - dayOfWeek);
    const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
    
    const endOfWeek = new Date(localNow);
    endOfWeek.setUTCDate(localNow.getUTCDate() + (6 - dayOfWeek));
    const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

    const currentMonthPrefix = todayStr.substring(0, 7); // "YYYY-MM"

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;
    const professionalStats = {}; 
    const monthlyHistory = {}; 

    data.forEach(app => {
        if (app.notes && typeof app.notes === 'string' && app.notes.startsWith('BLOCK:')) return;
        
        // Apenas agendamentos que já passaram ou que foram marcados como concluídos
        if (app.status !== 'concluído' && app.date > todayStr) return;

        let price = app.service?.price || 0;
        
        if (app.notes && app.notes.startsWith('MULTI_SERVICES:')) {
            try {
                const parts = app.notes.split('|');
                const jsonPart = parts.find(p => p.startsWith('MULTI_SERVICES:')).replace('MULTI_SERVICES:', '');
                const multiData = JSON.parse(jsonPart);
                price = multiData.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
            } catch (e) {}
        }

        if (app.notes && app.notes.includes('CHARGE:')) {
            const extraTotal = app.notes.split('|')
                .filter(part => part.startsWith('CHARGE:'))
                .reduce((sum, part) => sum + (Number(part.split(':')[1]) || 0), 0);
            price = Number(price) + extraTotal;
        }

        price = Number(price);

        if (app.date === todayStr) todayTotal += price;
        if (app.date >= startOfWeekStr && app.date <= endOfWeekStr) weekTotal += price;
        
        const appMonth = app.date.substring(0, 7);
        if (appMonth === currentMonthPrefix) monthTotal += price;

        if (appMonth === currentMonthPrefix && app.professional) {
            if (!professionalStats[app.professional.id]) {
                professionalStats[app.professional.id] = { name: app.professional.name, total: 0 };
            }
            professionalStats[app.professional.id].total += price;
        }

        if (!monthlyHistory[appMonth]) monthlyHistory[appMonth] = 0;
        monthlyHistory[appMonth] += price;
    });

    const profArray = Object.values(professionalStats).sort((a,b) => b.total - a.total);
    const histArray = Object.keys(monthlyHistory).sort().reverse().map(m => {
        const [year, month] = m.split('-');
        const date = new Date(year, month - 1);
        const monthName = date.toLocaleString('pt-BR', { month: 'long' });
        return {
            monthId: m,
            label: `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`,
            total: monthlyHistory[m]
        };
    });

    res.json({
        message: "success",
        data: {
            today: todayTotal,
            week: weekTotal,
            month: monthTotal,
            professionals: profArray,
            history: histArray
        }
    });
});

// --- ROTAS DE CONFIGURAÇÃO ---
app.get('/api/settings', async (req, res) => {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar as configurações.') });
    const publicKeys = new Set([
        'business_name', 'whatsapp_message', 'work_start', 'work_end', 'slot_interval',
        'work_days', 'whatsapp_number', 'allow_online_booking', 'max_advance_days', 'public_profile',
        'hide_client_phone_from_collaborators', 'schedule'
    ]);
    let visibleSettings = data || [];
    if (req.auth?.type !== 'staff') {
        visibleSettings = visibleSettings.filter(setting => publicKeys.has(setting.key));
    } else if (req.auth.role !== 'admin' && !isOwner(req.auth)) {
        const ownPrefix = `professional_${req.auth.id}_`;
        visibleSettings = visibleSettings.filter(setting => publicKeys.has(setting.key) || setting.key.startsWith(ownPrefix));
    }
    if (isReminderPrivileged(req.auth)) {
        const present = new Set(visibleSettings.map(setting => setting.key));
        const reminderDefaults = [
            [SETTING_KEYS.notifyOwner, 'false'],
            [SETTING_KEYS.notifyProfessional, 'false'],
            [SETTING_KEYS.clientAuto, 'false'],
            [SETTING_KEYS.leadHours, '24'],
            [SETTING_KEYS.templateOwner, DEFAULT_TEMPLATES.owner],
            [SETTING_KEYS.templateProfessional, DEFAULT_TEMPLATES.professional],
            [SETTING_KEYS.templateClientPending, DEFAULT_TEMPLATES.client_pending],
            [SETTING_KEYS.templateClientConfirmed, DEFAULT_TEMPLATES.client_confirmed]
        ];
        for (const [key, value] of reminderDefaults) {
            if (!present.has(key)) visibleSettings.push({ key, value });
        }
    }
    const payload = { message: 'success', data: visibleSettings };
    if (isReminderPrivileged(req.auth)) {
        payload.reminder_channel_ready = isReminderChannelReady();
    }
    res.json(payload);
});

app.get('/api/settings/audit-logs', requireStaff('admin'), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) return res.json({ message: "success", data: [] });
        res.json({ message: "success", data: data || [] });
    } catch {
        res.json({ message: "success", data: [] });
    }
});

app.put('/api/settings', requireStaff(), async (req, res) => {
    const key = String(req.body.key || '');
    const rawValue = req.body.value;
    // The per-day expedient is the one setting the clients may send as an object
    // instead of a JSON string, so it is serialized before the generic cleanup.
    const isDayScheduleKey = key === 'schedule' || /^professional_\d+_schedule$/.test(key);
    let value = (isDayScheduleKey && rawValue && typeof rawValue === 'object')
        ? JSON.stringify(rawValue)
        : String(rawValue ?? '');
    value = value.replace(/\u0000/g, '').trim().slice(0, key === 'public_profile' ? 5000 : 2000);
    const globalKeys = new Set([
        'business_name', 'whatsapp_message', 'work_start', 'work_end', 'slot_interval',
        'work_days', 'whatsapp_number', 'allow_online_booking', 'max_advance_days', 'public_profile',
        'hide_client_phone_from_collaborators', 'allow_admins_view_client_phone', 'authorized_phone_viewer_ids',
        'schedule',
        SETTING_KEYS.notifyOwner, SETTING_KEYS.notifyProfessional, SETTING_KEYS.clientAuto, SETTING_KEYS.leadHours,
        SETTING_KEYS.templateOwner, SETTING_KEYS.templateProfessional,
        SETTING_KEYS.templateClientPending, SETTING_KEYS.templateClientConfirmed
    ]);
    const professionalMatch = key.match(/^professional_(\d+)_(work_start|work_end|slot_interval|work_days|is_public_agenda|schedule)$/);
    const isGlobalAdmin = req.auth.role === 'admin' || isOwner(req.auth);
    const reminderSpec = reminderSettingSpec(key);
    if (reminderSpec && !isReminderPrivileged(req.auth)) {
        return res.status(403).json({ error: 'Você não pode alterar esta configuração.' });
    }
    const allowed = isGlobalAdmin
        ? globalKeys.has(key) || Boolean(professionalMatch)
        : Boolean(professionalMatch && sameSubject(professionalMatch[1], req.auth.id));
    if (!allowed) return res.status(403).json({ error: 'Você não pode alterar esta configuração.' });

    const suffix = professionalMatch?.[2] || key;
    if (['work_start', 'work_end'].includes(suffix) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return res.status(400).json({ error: 'Horário de expediente inválido.' });
    }
    if (suffix === 'slot_interval' && (![15, 20, 30, 45, 60, 90, 120].includes(Number(value)))) {
        return res.status(400).json({ error: 'Intervalo de agenda inválido.' });
    }
    if (suffix === 'max_advance_days' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 365)) {
        return res.status(400).json({ error: 'O limite de antecedência deve ficar entre 1 e 365 dias.' });
    }
    if (['allow_online_booking', 'is_public_agenda', 'hide_client_phone_from_collaborators', 'allow_admins_view_client_phone'].includes(suffix) && !['true', 'false'].includes(value)) {
        return res.status(400).json({ error: 'Valor booleano inválido.' });
    }
    if (reminderSpec?.kind === 'boolean' && !['true', 'false'].includes(value)) {
        return res.status(400).json({ error: 'Valor booleano inválido.' });
    }
    if (reminderSpec?.kind === 'leadHours') {
        const hours = Number(value);
        if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
            return res.status(400).json({ error: 'A antecedência do lembrete deve ficar entre 1 e 72 horas.' });
        }
    }
    if (reminderSpec?.kind === 'template') {
        const parsedTemplate = validateReminderTemplate(reminderSpec.templateKind, value);
        if (!parsedTemplate.valid) {
            return res.status(400).json({ error: parsedTemplate.error });
        }
        value = parsedTemplate.value;
    }
    if (suffix === 'authorized_phone_viewer_ids') {
        try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) throw new Error('invalid');
        } catch {
            return res.status(400).json({ error: 'Lista de permissões autorizadas inválida.' });
        }
    }
    if (suffix === 'work_days') {
        try {
            const days = JSON.parse(value);
            const validDays = new Set(Object.values(DAY_NAME_MAP));
            if (!Array.isArray(days) || days.length === 0 || days.some(day => !validDays.has(day))) throw new Error('invalid');
        } catch {
            return res.status(400).json({ error: 'Selecione ao menos um dia de atendimento válido.' });
        }
    }
    if (suffix === 'schedule') {
        const parsedSchedule = normalizeDaySchedule(value);
        if (!parsedSchedule.valid) {
            return res.status(400).json({ error: parsedSchedule.error });
        }
        // Empty / {} clears the per-day expedient so the flat hours remain the source.
        value = parsedSchedule.cleared ? '' : JSON.stringify(parsedSchedule.value);
    }
    if (suffix === 'public_profile') {
        try {
            const profile = JSON.parse(value);
            if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('invalid');
            const textLimits = {
                address: 200,
                openingNote: 120,
                payments: 140,
                parking: 140,
                privacyContact: 160,
                heroEyebrow: 80,
                heroSubtitle: 240,
                cancellationPolicy: 600
            };
            const sanitized = {};
            for (const [field, limit] of Object.entries(textLimits)) sanitized[field] = safeText(profile[field], limit);
            for (const field of ['mapsUrl', 'instagramUrl', 'googleReviewsUrl']) {
                const candidate = safeText(profile[field], 600);
                if (!candidate) {
                    sanitized[field] = '';
                    continue;
                }
                const parsedUrl = new URL(candidate);
                if (parsedUrl.protocol !== 'https:') throw new Error('unsafe-url');
                sanitized[field] = parsedUrl.toString();
            }
            const rating = Number(profile.googleRating);
            sanitized.googleRating = Number.isFinite(rating) && rating >= 1 && rating <= 5 ? String(rating) : '';
            const reviewCount = Number(profile.googleReviewCount);
            sanitized.googleReviewCount = Number.isInteger(reviewCount) && reviewCount >= 0 && reviewCount <= 1000000 ? String(reviewCount) : '';
            value = JSON.stringify(sanitized);
        } catch {
            return res.status(400).json({ error: 'As informações públicas estão inválidas. Revise links e campos.' });
        }
    }

    // Auditoria de alterações de configurações de privacidade e críticas
    if (['hide_client_phone_from_collaborators', 'allow_admins_view_client_phone', 'authorized_phone_viewer_ids'].includes(key)) {
        try {
            const { data: existingRow } = await supabase
                .from('settings')
                .select('value')
                .eq('key', key)
                .maybeSingle();
            const oldValue = existingRow ? existingRow.value : (key === 'authorized_phone_viewer_ids' ? '[]' : 'false');
            if (oldValue !== value) {
                await recordAuditLog({
                    action: 'privacy_setting_change',
                    setting_key: key,
                    old_value: oldValue,
                    new_value: value,
                    user: req.auth
                });
            }
        } catch (auditErr) {
            console.warn('[Settings] Falha ao auditar mudança de configuração:', auditErr.message);
        }
    }

    const { error } = await supabase
        .from('settings')
        .upsert([{ key, value }]);
    
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível salvar a configuração.') });
    res.json({ "message": "success" });
});

// --- ROTAS DE EXCEÇÕES DE EXPEDIENTE ---
app.get('/api/schedule/exceptions', requireStaff(), async (req, res) => {
    const professionalId = req.auth.role === 'admin' ? req.query.professional_id : req.auth.id;
    if (!professionalId) return res.status(400).json({ error: 'Profissional não identificado.' });

    const { data, error } = await supabase
        .from('schedule_exceptions')
        .select('*')
        .eq('professional_id', professionalId)
        .order('exception_date', { ascending: true });
    
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível carregar as exceções.') });
    res.json({ message: 'success', data: data || [] });
});

app.post('/api/schedule/exceptions', requireStaff(), async (req, res) => {
    const professionalId = req.auth.role === 'admin' ? req.body.professional_id : req.auth.id;
    if (!professionalId) return res.status(400).json({ error: 'Profissional não identificado.' });

    const { exception_date, start_time, end_time, is_day_off, reason } = req.body;
    if (!exception_date) return res.status(400).json({ error: 'Data da exceção é obrigatória.' });
    if (!is_day_off && (!start_time || !end_time)) return res.status(400).json({ error: 'Horário de início e fim são obrigatórios para dias de trabalho.' });
    if (start_time && end_time && start_time >= end_time) return res.status(400).json({ error: 'Horário de início deve ser anterior ao fim.' });

    const { data, error } = await supabase
        .from('schedule_exceptions')
        .upsert([{
            professional_id: professionalId,
            exception_date,
            start_time: is_day_off ? null : start_time,
            end_time: is_day_off ? null : end_time,
            is_day_off: Boolean(is_day_off),
            reason: reason || null
        }], { onConflict: 'professional_id,exception_date' })
        .select()
        .single();

    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível salvar a exceção.') });
    res.json({ message: 'success', data });
});

app.delete('/api/schedule/exceptions/:id', requireStaff(), async (req, res) => {
    const professionalId = req.auth.role === 'admin' ? null : req.auth.id;
    
    let query = supabase.from('schedule_exceptions').delete().eq('id', req.params.id);
    if (professionalId) query = query.eq('professional_id', professionalId);
    
    const { error } = await query;
    
    if (error) return res.status(400).json({ error: safeDbErrorMessage(error, 'Não foi possível remover a exceção.') });
    res.json({ message: 'success' });
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((error, req, res, _next) => {
    if (process.env.NODE_ENV !== 'test') console.error('[API] Erro não tratado:', error.message);
    if (res.headersSent) return;
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({ error: 'Formato de dados (JSON) inválido.' });
    }
    const status = error.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({
        error: status === 413 ? 'Os dados enviados são muito grandes.' : 'Erro interno. Tente novamente.'
    });
});

if (require.main === module && process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log('Servidor rodando na porta %d com Supabase', PORT);
    });
}

module.exports = app;
