const crypto = require('node:crypto');

const FLOW_TEMPLATE_ENV = Object.freeze({
    owner: 'WHATSAPP_REMINDER_TEMPLATE_OWNER',
    professional: 'WHATSAPP_REMINDER_TEMPLATE_PROFESSIONAL',
    client_pending: 'WHATSAPP_REMINDER_TEMPLATE_CLIENT_PENDING',
    client_confirmed: 'WHATSAPP_REMINDER_TEMPLATE_CLIENT_CONFIRMED'
});

const META_RETRY_CODES = new Set(['131047', '131026']);

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function toGraphRecipient(phone) {
    return digitsOnly(phone);
}

function isReminderWhatsAppConfigured(env = process.env) {
    return Boolean(
        env.WHATSAPP_ACCESS_TOKEN
        && env.WHATSAPP_PHONE_NUMBER_ID
        && env.WHATSAPP_GRAPH_API_VERSION
    );
}

function reminderTemplateName(flow, env = process.env) {
    const key = FLOW_TEMPLATE_ENV[flow];
    const name = key ? String(env[key] || '').trim() : '';
    return name || '';
}

function isReminderFlowTemplateConfigured(flow, env = process.env) {
    return Boolean(reminderTemplateName(flow, env));
}

function isReminderChannelReady(env = process.env) {
    return isReminderWhatsAppConfigured(env) && Object.keys(FLOW_TEMPLATE_ENV).some(flow => (
        isReminderFlowTemplateConfigured(flow, env)
    ));
}

function createChannelError(message, { code = 'CHANNEL_NOT_CONFIGURED', status = 503, metaCode = '' } = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.metaCode = metaCode;
    return error;
}

function extractMetaErrorCode(payload) {
    const code = payload?.error?.code ?? payload?.error?.error_subcode;
    return code == null ? '' : String(code);
}

function createReminderWhatsAppSender({
    accessToken,
    phoneNumberId,
    graphApiVersion,
    templateLanguage = 'pt_BR',
    timeoutMs = 5000,
    fetchImpl = globalThis.fetch,
    env = process.env
} = {}) {
    if (!accessToken || !phoneNumberId || !graphApiVersion) {
        throw new Error('Configuração incompleta do WhatsApp Cloud API para lembretes.');
    }
    if (typeof fetchImpl !== 'function') throw new Error('Uma implementação de fetch é obrigatória.');
    if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error('WHATSAPP_GRAPH_API_VERSION inválida.');
    if (!/^\d+$/.test(phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID inválido.');

    async function postGraph(body) {
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
                    body: JSON.stringify(body)
                }
            );
        } catch (cause) {
            const error = createChannelError('O provedor de WhatsApp não respondeu.', {
                code: 'WHATSAPP_DELIVERY_FAILED',
                status: cause?.name === 'AbortError' ? 504 : 502
            });
            throw error;
        } finally {
            clearTimeout(timeout);
        }

        let payload = {};
        try {
            payload = await response.json();
        } catch {
            payload = {};
        }

        if (!response.ok) {
            const metaCode = extractMetaErrorCode(payload);
            const error = createChannelError('O provedor de WhatsApp não aceitou a mensagem.', {
                code: META_RETRY_CODES.has(metaCode) ? metaCode : 'WHATSAPP_DELIVERY_FAILED',
                status: response.status,
                metaCode
            });
            throw error;
        }

        const providerMessageId = payload?.messages?.[0]?.id ? String(payload.messages[0].id) : '';
        return { ok: true, providerMessageId, metaCode: '' };
    }

    return async function sendReminderMessage({
        to,
        flow,
        parameters = [],
        renderedText = '',
        sessionWindowOpen = false
    }) {
        const recipient = toGraphRecipient(to);
        if (!recipient) {
            throw createChannelError('Destino de WhatsApp ausente.', {
                code: 'DESTINO_AUSENTE',
                status: 400
            });
        }

        const body = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient
        };

        if (sessionWindowOpen && renderedText) {
            body.type = 'text';
            body.text = { preview_url: false, body: String(renderedText).slice(0, 4096) };
            return postGraph(body);
        }

        const templateName = reminderTemplateName(flow, env);
        if (!templateName) {
            throw createChannelError('Template pré-aprovado do WhatsApp não configurado para este fluxo.', {
                code: 'CHANNEL_NOT_CONFIGURED',
                status: 503
            });
        }

        body.type = 'template';
        body.template = {
            name: templateName,
            language: { code: templateLanguage },
            components: [{
                type: 'body',
                parameters: parameters.map(text => ({ type: 'text', text: String(text || '-') }))
            }]
        };
        return postGraph(body);
    };
}

function createReminderWhatsAppSenderFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
    if (!isReminderWhatsAppConfigured(env)) return null;
    return createReminderWhatsAppSender({
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
        templateLanguage: env.WHATSAPP_REMINDER_TEMPLATE_LANGUAGE || env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || 'pt_BR',
        fetchImpl,
        env
    });
}

function timingSafeEqualString(left, right) {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    if (a.length !== b.length) {
        crypto.timingSafeEqual(a, Buffer.alloc(a.length));
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    FLOW_TEMPLATE_ENV,
    META_RETRY_CODES,
    createChannelError,
    createReminderWhatsAppSender,
    createReminderWhatsAppSenderFromEnv,
    isReminderChannelReady,
    isReminderFlowTemplateConfigured,
    isReminderWhatsAppConfigured,
    reminderTemplateName,
    timingSafeEqualString,
    toGraphRecipient
};
