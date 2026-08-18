const {
    createChannelError,
    isReminderChannelReady,
    isReminderFlowTemplateConfigured,
    isReminderWhatsAppConfigured,
    timingSafeEqualString
} = require('./whatsapp');

const BUSINESS_TIMEZONE = 'America/Sao_Paulo';
const WINDOW_TOLERANCE_MIN = 20;
const DEFAULT_LEAD_HOURS = 24;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = Object.freeze([
    5 * 60 * 1000,
    15 * 60 * 1000,
    45 * 60 * 1000
]);
const MANUAL_WINDOW_MS = 6 * 60 * 60 * 1000;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const ALLOWED_PLACEHOLDERS = Object.freeze(['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento']);
const PLACEHOLDER_ALIASES = Object.freeze({ horario: 'hora' });
const HTML_PATTERN = /<\/?[a-z][\s\S]*?>/i;
const FLOW_FALLBACK = Object.freeze({
    owner: 'professional',
    professional: 'owner'
});

const EVENT_TYPE = Object.freeze({
    OWNER: 'BOOKING_OWNER_NOTIFICATION',
    PROFESSIONAL: 'BOOKING_PROFESSIONAL_NOTIFICATION',
    MANUAL: 'CLIENT_REMINDER_MANUAL',
    AUTOMATIC: 'CLIENT_REMINDER_AUTOMATIC'
});

const RULE_KEY = Object.freeze({
    BOOKING: 'booking',
    MANUAL: 'client_manual'
});

const SETTING_KEYS = Object.freeze({
    notifyOwner: 'reminder_notify_owner',
    notifyProfessional: 'reminder_notify_professional',
    clientAuto: 'reminder_client_auto',
    leadHours: 'reminder_lead_hours',
    templateOwner: 'reminder_template_owner',
    templateProfessional: 'reminder_template_professional',
    templateClientPending: 'reminder_template_client_pending',
    templateClientConfirmed: 'reminder_template_client_confirmed'
});

const DEFAULT_TEMPLATES = Object.freeze({
    owner: [
        'Novo agendamento na {estabelecimento} ✨',
        '',
        'Cliente: {cliente}',
        'Profissional: {profissional}',
        'Servico: {servico}',
        'Data: {data}',
        'Horario: {hora}',
        '',
        'Um novo atendimento foi registrado na agenda.'
    ].join('\n'),
    professional: [
        'Voce tem um novo atendimento 💅',
        '',
        'Cliente: {cliente}',
        'Servico: {servico}',
        'Data: {data}',
        'Horario: {hora}',
        'Local: {estabelecimento}',
        '',
        'O atendimento foi adicionado a sua agenda.'
    ].join('\n'),
    client_pending: [
        'Ola, {cliente}! ✨',
        '',
        'Passando para lembrar do seu horario na {estabelecimento}.',
        '',
        'Data: {data}',
        'Horario: {hora}',
        'Servico: {servico}',
        'Profissional: {profissional}',
        '',
        'Por favor, confirme seu horario.'
    ].join('\n'),
    client_confirmed: [
        'Ola, {cliente}! ✨',
        '',
        'Passando para lembrar do seu horario na {estabelecimento}.',
        '',
        'Data: {data}',
        'Horario: {hora}',
        'Servico: {servico}',
        'Profissional: {profissional}',
        '',
        'Seu horario ja esta confirmado. Se precisar alterar, avise a gente.'
    ].join('\n')
});

const TEMPLATE_REQUIREMENTS = Object.freeze({
    owner: ['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento'],
    professional: ['cliente', 'servico', 'data', 'hora', 'estabelecimento'],
    client_pending: ['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento'],
    client_confirmed: ['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento']
});

const PARAMETER_ORDER = Object.freeze({
    owner: ['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento'],
    professional: ['cliente', 'servico', 'data', 'hora', 'estabelecimento'],
    client_pending: ['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento'],
    client_confirmed: ['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento']
});

function isTruthyFlag(value) {
    return value === true || value === 'true' || value === '1' || value === 't';
}

function isReminderOwner(user) {
    if (!user || (user.type && user.type !== 'staff')) return false;
    if (String(user.role || '') === 'owner') return true;
    return isTruthyFlag(user.is_owner);
}

function isReminderPrivileged(user) {
    if (!user || user.type !== 'staff') return false;
    return user.role === 'admin' || isReminderOwner(user);
}

function parseLeadHours(value, fallback = DEFAULT_LEAD_HOURS) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 72) return fallback;
    return parsed;
}

function automaticRuleKey(leadHours = DEFAULT_LEAD_HOURS) {
    return `client_auto_${parseLeadHours(leadHours)}h`;
}

function sanitizeTemplateValue(value) {
    return String(value ?? '')
        .replace(HTML_PATTERN, '')
        .replace(/[&<>"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

function foldPlaceholderName(name) {
    const folded = String(name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');
    return PLACEHOLDER_ALIASES[folded] || folded;
}

function canonicalizeTemplateText(text) {
    return String(text || '').replace(/\{([^\s{}]+)\}/g, (match, name) => {
        const canonical = foldPlaceholderName(name);
        return ALLOWED_PLACEHOLDERS.includes(canonical) ? `{${canonical}}` : match;
    });
}

function extractPlaceholders(text) {
    const found = [];
    const pattern = /\{([^\s{}]+)\}/g;
    let match;
    while ((match = pattern.exec(String(text || ''))) !== null) {
        found.push(foldPlaceholderName(match[1]));
    }
    return found;
}

function validateReminderTemplate(kind, text) {
    const required = TEMPLATE_REQUIREMENTS[kind];
    if (!required) return { valid: false, error: 'Tipo de template desconhecido.' };
    const raw = String(text ?? '');
    if (!raw.trim()) return { valid: false, error: 'O texto do template é obrigatório.' };
    if (raw.length > 2000) return { valid: false, error: 'O template excede 2000 caracteres.' };
    if (HTML_PATTERN.test(raw)) return { valid: false, error: 'O template não pode conter HTML.' };
    const placeholders = extractPlaceholders(raw);
    const unknown = placeholders.find(name => !ALLOWED_PLACEHOLDERS.includes(name));
    if (unknown) return { valid: false, error: `Placeholder não permitido: {${unknown}}.` };
    if (kind === 'professional' && placeholders.includes('profissional')) {
        return { valid: false, error: 'O template do profissional não deve incluir {profissional}.' };
    }
    const missing = required.filter(name => !placeholders.includes(name));
    if (missing.length) {
        return { valid: false, error: `Faltam placeholders obrigatórios: ${missing.map(name => `{${name}}`).join(', ')}.` };
    }
    return { valid: true, value: canonicalizeTemplateText(raw).replace(/\u0000/g, '') };
}

function renderTemplate(text, vars = {}) {
    return String(text || '').replace(/\{([^\s{}]+)\}/g, (match, name) => {
        const key = foldPlaceholderName(name);
        if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
        return sanitizeTemplateValue(vars[key] ?? '');
    });
}

function formatDateBR(dateStr) {
    const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return sanitizeTemplateValue(dateStr);
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatTime24(timeStr) {
    const match = String(timeStr || '').match(/^([01]\d|2[0-3]):([0-5]\d)/);
    return match ? `${match[1]}:${match[2]}` : sanitizeTemplateValue(timeStr);
}

function zonedLocalToUtcMs(dateStr, timeStr, timeZone = BUSINESS_TIMEZONE) {
    const [year, month, day] = String(dateStr).split('-').map(Number);
    const [hour, minute] = String(timeStr).split(':').map(Number);
    if (![year, month, day, hour, minute].every(Number.isFinite)) return NaN;
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date(utcGuess));
    const got = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const asIfUtc = Date.UTC(
        Number(got.year),
        Number(got.month) - 1,
        Number(got.day),
        Number(got.hour),
        Number(got.minute),
        Number(got.second || 0)
    );
    return utcGuess - (asIfUtc - utcGuess);
}

function isWithinLeadWindow({
    date,
    time,
    nowMs,
    leadHours = DEFAULT_LEAD_HOURS,
    timeZone = BUSINESS_TIMEZONE,
    toleranceMin = WINDOW_TOLERANCE_MIN
}) {
    const slotMs = zonedLocalToUtcMs(date, time, timeZone);
    if (!Number.isFinite(slotMs)) return false;
    const targetMs = slotMs - parseLeadHours(leadHours) * 60 * 60 * 1000;
    const toleranceMs = toleranceMin * 60 * 1000;
    return nowMs >= targetMs - toleranceMs && nowMs <= targetMs + toleranceMs;
}

function normalizeSlotDate(value) {
    return String(value || '').slice(0, 10);
}

function normalizeSlotTime(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)/);
    return match ? `${match[1]}:${match[2]}` : String(value || '').slice(0, 5);
}

function normalizeE164(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (E164_PATTERN.test(trimmed)) return trimmed;

    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;

    // Already includes country code 55. Do not prepend +55 again.
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
        return `+${digits}`;
    }
    // Brazilian landline (10) or mobile (11) without country code.
    if (digits.length === 10 || digits.length === 11) {
        return `+55${digits}`;
    }
    if (digits.length >= 8 && digits.length <= 15) {
        const candidate = `+${digits}`;
        return E164_PATTERN.test(candidate) ? candidate : null;
    }
    return null;
}

function isValidE164(value) {
    return E164_PATTERN.test(String(value || ''));
}

function isMissingWhatsappPhoneColumn(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (code === 'PGRST204' || code === '42703') {
        return /whatsapp_phone/i.test(message) || /schema cache/i.test(message);
    }
    return /whatsapp_phone/i.test(message) && (/does not exist/i.test(message) || /schema cache/i.test(message) || /could not find/i.test(message));
}

function staffWhatsAppWriteError(error) {
    if (isMissingWhatsappPhoneColumn(error)) {
        return {
            status: 503,
            error: 'O banco ainda não tem a coluna whatsapp_phone. Aplique a migration e recarregue o schema da API.'
        };
    }
    if (error?.code === '23514') {
        return { status: 400, error: 'Informe um WhatsApp válido, por exemplo +5511999999999.' };
    }
    if (error?.code === '42501' || /permission denied/i.test(String(error?.message || ''))) {
        return { status: 403, error: 'Sem permissão para alterar o WhatsApp profissional.' };
    }
    return { status: 400, error: 'Não foi possível salvar o WhatsApp profissional.' };
}

function maskE164(value) {
    if (!value) return '';
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 8) return '****';
    return `+${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

function presentStaffWhatsApp(row = {}) {
    const { whatsapp_phone, ...rest } = row;
    return {
        ...rest,
        whatsapp_phone_set: Boolean(whatsapp_phone),
        whatsapp_phone_masked: maskE164(whatsapp_phone)
    };
}

function omitStaffWhatsApp(row = {}) {
    const { whatsapp_phone, whatsapp_phone_set, whatsapp_phone_masked, ...rest } = row;
    return rest;
}

function isDummyPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 10) return true;
    const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
    if (national.length < 10 || national.length > 11) return true;
    if (/^(\d)\1+$/.test(national) || /^(\d)\1+$/.test(digits)) return true;
    if (/^123456789/.test(national) || /^987654321/.test(national)) return true;
    if (/^0{2,}/.test(national)) return true;
    return false;
}

function isBlockAppointment(appointment) {
    return String(appointment?.notes || '').startsWith('BLOCK:');
}

function isEligibleAppointmentStatus(status) {
    return status === 'agendado' || status === 'confirmado';
}

function findReminderOwners(professionals = []) {
    return (professionals || []).filter(person => (
        String(person.status || 'ativo') === 'ativo' && isReminderOwner(person)
    ));
}

function settingFlag(settingsMap, key) {
    return String(settingsMap?.[key] || '').toLowerCase() === 'true';
}

function templateFor(settingsMap, kind) {
    const key = {
        owner: SETTING_KEYS.templateOwner,
        professional: SETTING_KEYS.templateProfessional,
        client_pending: SETTING_KEYS.templateClientPending,
        client_confirmed: SETTING_KEYS.templateClientConfirmed
    }[kind];
    const stored = key ? String(settingsMap?.[key] || '') : '';
    if (stored.trim()) {
        const validated = validateReminderTemplate(kind, stored);
        if (validated.valid) return validated.value;
    }
    return DEFAULT_TEMPLATES[kind];
}

function buildTemplateVars({ appointment, professionalName, serviceName, businessName }) {
    return {
        cliente: sanitizeTemplateValue(appointment?.client_name),
        profissional: sanitizeTemplateValue(professionalName),
        servico: sanitizeTemplateValue(serviceName),
        data: formatDateBR(appointment?.date),
        hora: formatTime24(appointment?.time),
        estabelecimento: sanitizeTemplateValue(businessName || 'Estabelecimento')
    };
}

function parametersFor(kind, vars) {
    return (PARAMETER_ORDER[kind] || []).map(name => ({
        name,
        text: vars[name] || '-'
    }));
}

function resolveConfiguredFlow(preferred, env = process.env) {
    if (isReminderFlowTemplateConfigured(preferred, env)) return preferred;
    const fallback = FLOW_FALLBACK[preferred];
    if (fallback && isReminderFlowTemplateConfigured(fallback, env)) return fallback;
    return preferred;
}

function serviceNameFromAppointment(appointment, catalogName) {
    const notes = String(appointment?.notes || '');
    if (notes.includes('MULTI_SERVICES:')) {
        try {
            const marker = notes.split('|').find(part => part.startsWith('MULTI_SERVICES:'));
            const items = JSON.parse(String(marker || '').replace('MULTI_SERVICES:', ''));
            const names = (items || []).map(item => item?.name).filter(Boolean);
            if (names.length) return names.join(' + ');
        } catch {
            // notes malformadas: cai no nome do catálogo
        }
    }
    return catalogName || 'Serviço';
}

function nextAttemptAt(attemptCount, nowMs) {
    const delay = RETRY_BACKOFF_MS[attemptCount - 1];
    if (!delay || attemptCount >= MAX_ATTEMPTS) return null;
    return new Date(nowMs + delay).toISOString();
}

function sameEventKey(event, keys) {
    return String(event.appointment_id) === String(keys.appointment_id)
        && event.type === keys.type
        && event.rule_key === keys.rule_key
        && normalizeSlotDate(event.slot_date) === normalizeSlotDate(keys.slot_date)
        && normalizeSlotTime(event.slot_time) === normalizeSlotTime(keys.slot_time);
}

function publicEvent(event) {
    if (!event) return null;
    return {
        id: event.id,
        appointment_id: event.appointment_id,
        type: event.type,
        recipient_kind: event.recipient_kind,
        recipient_professional_id: event.recipient_professional_id == null ? null : String(event.recipient_professional_id),
        slot_date: normalizeSlotDate(event.slot_date),
        slot_time: normalizeSlotTime(event.slot_time),
        rule_key: event.rule_key,
        status: event.status,
        suppress_reason: event.suppress_reason || null,
        attempt_count: Number(event.attempt_count || 0),
        next_attempt_at: event.next_attempt_at || null,
        error_code: event.error_code || null,
        provider_message_id: event.provider_message_id || null,
        created_by_staff_id: event.created_by_staff_id == null ? null : String(event.created_by_staff_id),
        created_at: event.created_at,
        sent_at: event.sent_at || null
    };
}

function createReminderService({
    supabase,
    sendMessage,
    now = () => Date.now(),
    timeZone = process.env.BUSINESS_TIMEZONE || BUSINESS_TIMEZONE,
    env = process.env
}) {
    if (!supabase || typeof supabase.from !== 'function') {
        throw new Error('Um cliente de banco é obrigatório para o serviço de lembretes.');
    }

    async function loadSettingsMap() {
        const { data, error } = await supabase.from('settings').select('key, value');
        if (error) throw error;
        return Object.fromEntries((data || []).map(row => [row.key, row.value]));
    }

    async function loadProfessionals() {
        const { data, error } = await supabase
            .from('professionals')
            .select('id, name, role, status, whatsapp_phone, is_owner')
            .eq('status', 'ativo');
        if (!error) return data || [];
        const fallback = await supabase
            .from('professionals')
            .select('id, name, role, status, whatsapp_phone')
            .eq('status', 'ativo');
        if (fallback.error) throw fallback.error;
        return fallback.data || [];
    }

    async function loadEvents(appointmentId) {
        const { data, error } = await supabase
            .from('appointment_message_events')
            .select('*')
            .eq('appointment_id', appointmentId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async function insertEvent(row) {
        const payload = {
            attempt_count: 0,
            created_at: new Date(now()).toISOString(),
            ...row
        };
        const { data, error } = await supabase
            .from('appointment_message_events')
            .insert([payload])
            .select('*');
        if (error) throw error;
        return data?.[0] || payload;
    }

    async function updateEvent(id, patch) {
        const { data, error } = await supabase
            .from('appointment_message_events')
            .update(patch)
            .eq('id', id)
            .select('*');
        if (error) throw error;
        return data?.[0] || { id, ...patch };
    }

    function hasTerminalEvent(events, keys) {
        return (events || []).some(event => (
            sameEventKey(event, keys) && (event.status === 'sent' || event.status === 'suppressed')
        ));
    }

    function findRetryable(events, keys, nowMs) {
        return (events || []).find(event => {
            if (!sameEventKey(event, keys) || event.status !== 'failed') return false;
            if (Number(event.attempt_count || 0) >= MAX_ATTEMPTS) return false;
            if (!event.next_attempt_at) return false;
            return new Date(event.next_attempt_at).getTime() <= nowMs;
        }) || null;
    }

    async function deliver({
        appointment,
        type,
        recipientKind,
        recipientProfessionalId,
        ruleKey,
        to,
        flow,
        vars,
        settingsMap = {},
        createdByStaffId = null,
        sessionWindowOpen = false,
        events = null
    }) {
        const keys = {
            appointment_id: appointment.id,
            type,
            rule_key: ruleKey,
            slot_date: normalizeSlotDate(appointment.date),
            slot_time: normalizeSlotTime(appointment.time)
        };
        const existing = events || await loadEvents(appointment.id);
        if (hasTerminalEvent(existing, keys)) {
            return { skipped: true, reason: 'idempotent', event: publicEvent(existing.find(event => sameEventKey(event, keys) && (event.status === 'sent' || event.status === 'suppressed'))) };
        }

        const retryRow = findRetryable(existing, keys, now());
        let event = retryRow;
        if (!event) {
            event = await insertEvent({
                ...keys,
                recipient_kind: recipientKind,
                recipient_professional_id: recipientProfessionalId == null ? null : String(recipientProfessionalId),
                status: 'queued',
                created_by_staff_id: createdByStaffId
            });
        }

        if (!to) {
            const failed = await updateEvent(event.id, {
                status: 'failed',
                error_code: 'DESTINO_AUSENTE',
                attempt_count: Number(event.attempt_count || 0) + 1,
                next_attempt_at: nextAttemptAt(Number(event.attempt_count || 0) + 1, now())
            });
            return { failed: true, event: publicEvent(failed) };
        }

        if (typeof sendMessage !== 'function') {
            const failed = await updateEvent(event.id, {
                status: 'failed',
                error_code: 'CHANNEL_NOT_CONFIGURED',
                attempt_count: Number(event.attempt_count || 0) + 1,
                next_attempt_at: null
            });
            return { failed: true, channel: false, event: publicEvent(failed) };
        }

        try {
            const resolvedFlow = resolveConfiguredFlow(flow, env);
            const result = await sendMessage({
                to,
                flow: resolvedFlow,
                parameters: parametersFor(resolvedFlow, vars),
                renderedText: renderTemplate(templateFor(settingsMap, flow), vars),
                sessionWindowOpen
            });
            const sent = await updateEvent(event.id, {
                status: 'sent',
                sent_at: new Date(now()).toISOString(),
                provider_message_id: result?.providerMessageId || null,
                error_code: null,
                next_attempt_at: null,
                attempt_count: Number(event.attempt_count || 0) + 1
            });
            return { sent: true, event: publicEvent(sent) };
        } catch (error) {
            const attemptCount = Number(event.attempt_count || 0) + 1;
            const failed = await updateEvent(event.id, {
                status: 'failed',
                error_code: error.metaCode || error.code || 'WHATSAPP_DELIVERY_FAILED',
                attempt_count: attemptCount,
                next_attempt_at: nextAttemptAt(attemptCount, now()),
                sent_at: null,
                provider_message_id: null
            });
            return { failed: true, event: publicEvent(failed), error };
        }
    }

    async function suppress({ appointment, type, recipientKind, recipientProfessionalId, ruleKey, reason, createdByStaffId = null, events = null }) {
        const keys = {
            appointment_id: appointment.id,
            type,
            rule_key: ruleKey,
            slot_date: normalizeSlotDate(appointment.date),
            slot_time: normalizeSlotTime(appointment.time)
        };
        const existing = events || await loadEvents(appointment.id);
        if (hasTerminalEvent(existing, keys)) {
            return publicEvent(existing.find(event => sameEventKey(event, keys) && (event.status === 'sent' || event.status === 'suppressed')));
        }
        const row = await insertEvent({
            ...keys,
            recipient_kind: recipientKind,
            recipient_professional_id: recipientProfessionalId == null ? null : String(recipientProfessionalId),
            status: 'suppressed',
            suppress_reason: reason,
            created_by_staff_id: createdByStaffId
        });
        return publicEvent(row);
    }

    async function resolveContext(appointment, settingsMap, professionals) {
        const professional = (professionals || []).find(person => String(person.id) === String(appointment.professional_id)) || null;
        let serviceName = 'Serviço';
        if (appointment.service_id != null) {
            const { data } = await supabase
                .from('services')
                .select('id, name')
                .eq('id', appointment.service_id)
                .maybeSingle();
            if (data?.name) serviceName = data.name;
        }
        serviceName = serviceNameFromAppointment(appointment, serviceName);
        const vars = buildTemplateVars({
            appointment,
            professionalName: professional?.name || 'Profissional',
            serviceName,
            businessName: settingsMap.business_name || 'Estabelecimento'
        });
        return { professional, vars, owners: findReminderOwners(professionals) };
    }

    async function notifyNewBooking(appointment, { settingsMap, professionals } = {}) {
        const summary = { sent: 0, failed: 0, suppressed: 0, skipped: 0, owner_missing: false, channel_ready: isReminderChannelReady(env) };
        if (isBlockAppointment(appointment) || !isEligibleAppointmentStatus(appointment.status)) {
            summary.skipped += 1;
            return summary;
        }
        const map = settingsMap || await loadSettingsMap();
        const staff = professionals || await loadProfessionals();
        const { professional, vars, owners } = await resolveContext(appointment, map, staff);
        if (!owners.length) summary.owner_missing = true;

        let ownerDelivered = false;
        if (settingFlag(map, SETTING_KEYS.notifyOwner)) {
            if (!owners.length) {
                summary.skipped += 1;
            } else {
                for (const owner of owners) {
                    const result = await deliver({
                        appointment,
                        type: EVENT_TYPE.OWNER,
                        recipientKind: 'owner',
                        recipientProfessionalId: owner.id,
                        ruleKey: RULE_KEY.BOOKING,
                        to: owner.whatsapp_phone,
                        flow: 'owner',
                        vars,
                        settingsMap: map
                    });
                    if (result.sent) {
                        summary.sent += 1;
                        ownerDelivered = true;
                    } else if (result.failed) summary.failed += 1;
                    else summary.skipped += 1;
                }
            }
        }

        if (settingFlag(map, SETTING_KEYS.notifyProfessional)) {
            const ownerIds = new Set(owners.map(owner => String(owner.id)));
            const professionalIsOwner = Boolean(professional && ownerIds.has(String(professional.id)));
            if (professionalIsOwner && ownerDelivered) {
                await suppress({
                    appointment,
                    type: EVENT_TYPE.PROFESSIONAL,
                    recipientKind: 'professional',
                    recipientProfessionalId: professional.id,
                    ruleKey: RULE_KEY.BOOKING,
                    reason: 'MESMO_DESTINATARIO'
                });
                summary.suppressed += 1;
            } else if (professional) {
                const result = await deliver({
                    appointment,
                    type: EVENT_TYPE.PROFESSIONAL,
                    recipientKind: 'professional',
                    recipientProfessionalId: professional.id,
                    ruleKey: RULE_KEY.BOOKING,
                    to: professional.whatsapp_phone,
                    flow: 'professional',
                    vars,
                    settingsMap: map
                });
                if (result.sent) summary.sent += 1;
                else if (result.failed) summary.failed += 1;
                else summary.skipped += 1;
            } else {
                summary.skipped += 1;
            }
        }

        return summary;
    }

    function recentEvent(events, type, nowMs) {
        return (events || []).find(event => (
            event.type === type
            && event.status === 'sent'
            && event.sent_at
            && nowMs - new Date(event.sent_at).getTime() <= MANUAL_WINDOW_MS
        )) || null;
    }

    async function sendClientReminder(appointment, { mode, confirm = false, createdByStaffId = null, settingsMap, professionals, sessionWindowOpen = false } = {}) {
        if (isBlockAppointment(appointment)) {
            return { ok: false, status: 409, error: 'Bloqueios de agenda não recebem lembrete.' };
        }
        if (!isEligibleAppointmentStatus(appointment.status)) {
            return { ok: false, status: 409, error: 'Este agendamento não está elegível para lembrete.' };
        }
        if (isDummyPhone(appointment.client_phone)) {
            return { ok: false, status: 409, error: 'Telefone da cliente inválido para envio.' };
        }

        const map = settingsMap || await loadSettingsMap();
        const staff = professionals || await loadProfessionals();
        const leadHours = parseLeadHours(map[SETTING_KEYS.leadHours]);
        const { vars } = await resolveContext(appointment, map, staff);
        const events = await loadEvents(appointment.id);
        const nowMs = now();
        const flow = appointment.status === 'confirmado' ? 'client_confirmed' : 'client_pending';
        const type = mode === 'manual' ? EVENT_TYPE.MANUAL : EVENT_TYPE.AUTOMATIC;
        const ruleKey = mode === 'manual' ? RULE_KEY.MANUAL : automaticRuleKey(leadHours);

        if (mode === 'automatic') {
            const manualRecent = recentEvent(events, EVENT_TYPE.MANUAL, nowMs);
            if (manualRecent) {
                const suppressed = await suppress({
                    appointment,
                    type,
                    recipientKind: 'client',
                    recipientProfessionalId: null,
                    ruleKey,
                    reason: 'MANUAL_NAS_6H',
                    createdByStaffId,
                    events
                });
                return { ok: true, suppressed: true, event: suppressed };
            }
        }

        if (mode === 'manual') {
            const autoRecent = recentEvent(events, EVENT_TYPE.AUTOMATIC, nowMs);
            if (autoRecent && !confirm) {
                return {
                    ok: false,
                    status: 409,
                    needs_confirm: true,
                    error: 'Já foi enviado um lembrete automático nas últimas 6 horas.'
                };
            }
        }

        if (!isReminderWhatsAppConfigured(env) || !isReminderFlowTemplateConfigured(flow, env)) {
            return { ok: false, status: 503, error: 'Canal de WhatsApp indisponível. O envio não foi fingido.' };
        }

        const result = await deliver({
            appointment,
            type,
            recipientKind: 'client',
            recipientProfessionalId: null,
            ruleKey,
            to: normalizeE164(appointment.client_phone) || appointment.client_phone,
            flow,
            vars,
            settingsMap: map,
            createdByStaffId,
            sessionWindowOpen,
            events
        });
        if (result.sent) return { ok: true, event: result.event };
        if (result.skipped) return { ok: true, skipped: true, event: result.event };
        return { ok: false, status: result.error?.status || 502, error: 'Não foi possível enviar o lembrete.', event: result.event };
    }

    async function runAutomaticJob() {
        const summary = {
            processed: 0,
            sent: 0,
            failed: 0,
            suppressed: 0,
            skipped: 0,
            retried: 0,
            owner_missing: false,
            channel_ready: isReminderChannelReady(env)
        };
        const settingsMap = await loadSettingsMap();
        const professionals = await loadProfessionals();
        const owners = findReminderOwners(professionals);
        if (!owners.length) summary.owner_missing = true;

        const nowMs = now();
        const { data: dueFailed, error: retryError } = await supabase
            .from('appointment_message_events')
            .select('*')
            .eq('status', 'failed')
            .lte('next_attempt_at', new Date(nowMs).toISOString());
        if (retryError) throw retryError;

        for (const event of dueFailed || []) {
            if (Number(event.attempt_count || 0) >= MAX_ATTEMPTS) continue;
            const { data: appointment } = await supabase
                .from('appointments')
                .select('*')
                .eq('id', event.appointment_id)
                .maybeSingle();
            if (!appointment || !isEligibleAppointmentStatus(appointment.status) || isBlockAppointment(appointment)) {
                summary.skipped += 1;
                continue;
            }
            summary.retried += 1;
            summary.processed += 1;
            const { vars, professional, owners: currentOwners } = await resolveContext(appointment, settingsMap, professionals);
            let to = null;
            let flow = 'client_pending';
            if (event.type === EVENT_TYPE.OWNER) {
                const owner = currentOwners.find(person => String(person.id) === String(event.recipient_professional_id));
                to = owner?.whatsapp_phone;
                flow = 'owner';
            } else if (event.type === EVENT_TYPE.PROFESSIONAL) {
                to = professional?.whatsapp_phone;
                flow = 'professional';
            } else {
                to = normalizeE164(appointment.client_phone) || appointment.client_phone;
                flow = appointment.status === 'confirmado' ? 'client_confirmed' : 'client_pending';
            }
            const result = await deliver({
                appointment,
                type: event.type,
                recipientKind: event.recipient_kind,
                recipientProfessionalId: event.recipient_professional_id,
                ruleKey: event.rule_key,
                to,
                flow,
                vars,
                settingsMap,
                events: [event]
            });
            if (result.sent) summary.sent += 1;
            else if (result.failed) summary.failed += 1;
            else summary.skipped += 1;
        }

        if (!settingFlag(settingsMap, SETTING_KEYS.clientAuto)) {
            return summary;
        }
        if (!isReminderWhatsAppConfigured(env) || !isReminderFlowTemplateConfigured('client_pending', env)) {
            return summary;
        }

        const leadHours = parseLeadHours(settingsMap[SETTING_KEYS.leadHours]);
        const { data: appointments, error } = await supabase
            .from('appointments')
            .select('*')
            .in('status', ['agendado', 'confirmado']);
        if (error) throw error;

        for (const appointment of appointments || []) {
            if (isBlockAppointment(appointment) || isDummyPhone(appointment.client_phone)) {
                summary.skipped += 1;
                continue;
            }
            if (!isWithinLeadWindow({
                date: appointment.date,
                time: appointment.time,
                nowMs,
                leadHours,
                timeZone
            })) continue;

            summary.processed += 1;
            const result = await sendClientReminder(appointment, {
                mode: 'automatic',
                settingsMap,
                professionals
            });
            if (result.suppressed) summary.suppressed += 1;
            else if (result.ok && result.skipped) summary.skipped += 1;
            else if (result.ok && result.event?.status === 'sent') summary.sent += 1;
            else summary.failed += 1;
        }

        return summary;
    }

    async function listMessageEvents(appointmentId, auth, { appointment } = {}) {
        const events = await loadEvents(appointmentId);
        if (isReminderPrivileged(auth)) return events.map(publicEvent);
        if (appointment && String(appointment.professional_id) === String(auth.id)) {
            return events.map(publicEvent);
        }
        return events
            .filter(event => (
                String(event.recipient_professional_id || '') === String(auth.id)
                || String(event.created_by_staff_id || '') === String(auth.id)
            ))
            .map(publicEvent);
    }

    return {
        loadSettingsMap,
        loadProfessionals,
        notifyNewBooking,
        sendClientReminder,
        runAutomaticJob,
        listMessageEvents
    };
}

function requireCronSecret(env = process.env) {
    return function cronAuth(req, res, next) {
        const secret = String(env.CRON_SECRET || '');
        if (secret.length < 16) {
            return res.status(503).json({ error: 'CRON_SECRET não configurado.' });
        }
        const header = String(req.headers.authorization || '');
        const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
        if (!token || !timingSafeEqualString(token, secret)) {
            return res.status(401).json({ error: 'Não autorizado.' });
        }
        return next();
    };
}

function reminderSettingSpec(key) {
    if ([SETTING_KEYS.notifyOwner, SETTING_KEYS.notifyProfessional, SETTING_KEYS.clientAuto].includes(key)) {
        return { kind: 'boolean' };
    }
    if (key === SETTING_KEYS.leadHours) return { kind: 'leadHours' };
    if (key === SETTING_KEYS.templateOwner) return { kind: 'template', templateKind: 'owner' };
    if (key === SETTING_KEYS.templateProfessional) return { kind: 'template', templateKind: 'professional' };
    if (key === SETTING_KEYS.templateClientPending) return { kind: 'template', templateKind: 'client_pending' };
    if (key === SETTING_KEYS.templateClientConfirmed) return { kind: 'template', templateKind: 'client_confirmed' };
    return null;
}

module.exports = {
    ALLOWED_PLACEHOLDERS,
    BUSINESS_TIMEZONE,
    DEFAULT_LEAD_HOURS,
    DEFAULT_TEMPLATES,
    EVENT_TYPE,
    MANUAL_WINDOW_MS,
    MAX_ATTEMPTS,
    PARAMETER_ORDER,
    RETRY_BACKOFF_MS,
    RULE_KEY,
    SETTING_KEYS,
    TEMPLATE_REQUIREMENTS,
    WINDOW_TOLERANCE_MIN,
    automaticRuleKey,
    buildTemplateVars,
    canonicalizeTemplateText,
    createReminderService,
    extractPlaceholders,
    findReminderOwners,
    foldPlaceholderName,
    formatDateBR,
    formatTime24,
    isBlockAppointment,
    isDummyPhone,
    isEligibleAppointmentStatus,
    isReminderOwner,
    isReminderPrivileged,
    isMissingWhatsappPhoneColumn,
    isValidE164,
    isWithinLeadWindow,
    maskE164,
    nextAttemptAt,
    normalizeE164,
    normalizeSlotDate,
    normalizeSlotTime,
    parametersFor,
    parseLeadHours,
    presentStaffWhatsApp,
    omitStaffWhatsApp,
    publicEvent,
    reminderSettingSpec,
    renderTemplate,
    requireCronSecret,
    resolveConfiguredFlow,
    sanitizeTemplateValue,
    serviceNameFromAppointment,
    staffWhatsAppWriteError,
    validateReminderTemplate,
    zonedLocalToUtcMs
};
