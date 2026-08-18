import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_PLACEHOLDERS,
  DEFAULT_TEMPLATES,
  LEAD_HOUR_CATALOG,
  canEnableTeamToggle,
  extractPlaceholders,
  foldPlaceholderName,
  getDestinationState,
  getStaffDestination,
  getVisibleLeadHourOptions,
  insertPlaceholder,
  interpretManualSendFailure,
  isCanonicalOwner,
  isClientReminderEligible,
  isE164Phone,
  isReminderToggleActive,
  maskWhatsappPhone,
  normalizeStaffWhatsAppInput,
  renderTemplatePreview,
  resolveClientIndicator,
  stripRawWhatsappPhone,
  validateTemplate
} from '../utils/reminders.js';
import { buildDemoEvents, createReminderStore } from '../utils/reminderMock.js';

test('placeholders permitidos são exatamente 6', () => {
  assert.deepEqual(ALLOWED_PLACEHOLDERS, ['cliente', 'profissional', 'servico', 'data', 'hora', 'estabelecimento']);
});

test('OWNER exige os 6 placeholders', () => {
  const valid = validateTemplate(DEFAULT_TEMPLATES.owner, 'owner');
  assert.equal(valid.valid, true);
  assert.equal(extractPlaceholders(DEFAULT_TEMPLATES.owner).length, 6);

  const missing = validateTemplate('Olá {cliente} em {data}', 'owner');
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some(error => error.includes('{profissional}')));
});

test('PROFISSIONAL exige 5 placeholders e rejeita {profissional}', () => {
  const valid = validateTemplate(DEFAULT_TEMPLATES.professional, 'professional');
  assert.equal(valid.valid, true);
  assert.deepEqual(extractPlaceholders(DEFAULT_TEMPLATES.professional).sort(), ['cliente', 'data', 'estabelecimento', 'hora', 'servico']);

  const withPro = validateTemplate(`${DEFAULT_TEMPLATES.professional}\nProfissional: {profissional}`, 'professional');
  assert.equal(withPro.valid, false);
  assert.ok(withPro.errors.some(error => error.includes('{profissional}')));
});

test('CLIENTE exige os 6 placeholders nas duas variantes', () => {
  assert.equal(validateTemplate(DEFAULT_TEMPLATES.client_pending, 'client_pending').valid, true);
  assert.equal(validateTemplate(DEFAULT_TEMPLATES.client_confirmed, 'client_confirmed').valid, true);
  assert.equal(extractPlaceholders(DEFAULT_TEMPLATES.client_pending).length, 6);
});

test('token inválido gera erro inline e não impede manter o rascunho', () => {
  const draft = `${DEFAULT_TEMPLATES.owner}\nAmanhã: {amanha}`;
  const result = validateTemplate(draft, 'owner');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('{amanha}')));
  assert.ok(draft.includes('{amanha}'));
});

test('antecedência aceita catálogo futuro mas só exibe opções habilitadas', () => {
  const values = LEAD_HOUR_CATALOG.map(option => option.value);
  assert.deepEqual(values, [12, 24, 48, 'custom']);
  const visible = getVisibleLeadHourOptions();
  assert.deepEqual(visible.map(option => option.value), [24]);
  assert.equal(visible.some(option => option.value === 12), false);
});

test('máscara E.164 e destino não configurado', () => {
  assert.equal(isE164Phone('+5511987654321'), true);
  assert.equal(normalizeStaffWhatsAppInput('(11) 98765-4321'), '+5511987654321');
  assert.equal(normalizeStaffWhatsAppInput('+55 11 98765-4321'), '+5511987654321');
  assert.equal(normalizeStaffWhatsAppInput('5511987654321'), '+5511987654321');
  assert.equal(normalizeStaffWhatsAppInput('1199999'), null);
  assert.equal(maskWhatsappPhone('+5511987654321'), '+55 11 *****-4321');
  assert.equal(getDestinationState(null).label, 'Destino não configurado');
  assert.equal(getDestinationState('1199999').configured, false);
  assert.equal(canEnableTeamToggle(false), false);
  assert.equal(canEnableTeamToggle(true), true);
});

test('owner canônico não usa fallback mari/id 1', () => {
  assert.equal(isCanonicalOwner({ id: 1, username: 'mari', role: 'admin' }), false);
  assert.equal(isCanonicalOwner({ id: 9, role: 'owner', status: 'ativo' }), true);
  assert.equal(isCanonicalOwner({ id: 3, is_owner: true, status: 'ativo' }), true);
  assert.equal(isCanonicalOwner({ id: 4, role: 'owner', status: 'inativo' }), false);
});

test('indicadores: relógio, auto, manual, falha e suprimido', () => {
  const eligible = { id: 10, status: 'agendado', date: '2026-08-20', time: '14:00', client_phone: '+5511988887777' };
  assert.equal(resolveClientIndicator(eligible, []).key, 'pending');
  assert.equal(resolveClientIndicator(eligible, [{ type: 'CLIENT_REMINDER_AUTOMATIC', status: 'sent', created_at: '2026-08-17T12:00:00Z' }]).key, 'auto');
  assert.equal(resolveClientIndicator(eligible, [{ type: 'CLIENT_REMINDER_MANUAL', status: 'sent', created_at: '2026-08-17T12:00:00Z' }]).key, 'manual');
  assert.equal(resolveClientIndicator(eligible, [{ type: 'CLIENT_REMINDER_MANUAL', status: 'failed', created_at: '2026-08-17T12:00:00Z' }]).key, 'failed');
  assert.equal(resolveClientIndicator({ ...eligible, status: 'cancelado' }, []).key, 'suppressed');
  assert.equal(resolveClientIndicator({ ...eligible, notes: 'BLOCK:almoco' }, []).key, 'suppressed');
});

test('sem histórico elegível não inventa envio', () => {
  const eligible = { id: 11, status: 'agendado', client_phone: '11977776666' };
  const summary = resolveClientIndicator(eligible, []);
  assert.equal(summary.hasHistory, false);
  assert.equal(summary.key, 'pending');
});

test('inserir variável preserva o restante do texto', () => {
  const next = insertPlaceholder('Olá ', 'cliente', 4, 4);
  assert.equal(next.text, 'Olá {cliente}');
});

test('mock bloqueia envio inelegível e pede confirmação após automático recente', () => {
  const store = createReminderStore();
  const cancelled = { id: 1, status: 'cancelado', date: '2026-08-20', time: '10:00', client_phone: '11988887777' };
  assert.equal(isClientReminderEligible(cancelled), false);
  assert.equal(store.sendManual({ appointment: cancelled }).ok, false);

  const pending = { id: 2, status: 'agendado', date: '2026-08-20', time: '10:00', client_phone: '11988887777' };
  store.setEvents(2, [{
    id: 'auto-1',
    type: 'CLIENT_REMINDER_AUTOMATIC',
    status: 'sent',
    sent_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  }]);
  const blocked = store.sendManual({ appointment: pending, confirm: false });
  assert.equal(blocked.needs_confirm, true);
  const confirmed = store.sendManual({ appointment: pending, confirm: true, user: { id: '7', name: 'Equipe' } });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.type, 'CLIENT_REMINDER_MANUAL');
});

test('demo events cobrem os 5 estados visuais', () => {
  const base = { id: 'x', status: 'agendado', date: '2026-08-20', time: '14:00', client_phone: '11988887777' };
  assert.equal(buildDemoEvents(base, 0).length, 0);
  assert.equal(resolveClientIndicator(base, buildDemoEvents({ ...base, id: 1 }, 1)).key, 'auto');
  assert.equal(resolveClientIndicator(base, buildDemoEvents({ ...base, id: 2 }, 2)).key, 'manual');
  assert.equal(resolveClientIndicator(base, buildDemoEvents({ ...base, id: 3 }, 3)).key, 'failed');
  assert.equal(resolveClientIndicator(base, buildDemoEvents({ ...base, id: 4 }, 4)).key, 'manual');
});

test('toggle ligado não é Ativo sem canal Meta', () => {
  assert.equal(isReminderToggleActive(true, false), false);
  assert.equal(isReminderToggleActive(true, true), true);
  assert.equal(isReminderToggleActive(false, true), false);
});

test('destino da equipe usa máscara e nunca o número cru', () => {
  const presented = {
    whatsapp_phone_set: true,
    whatsapp_phone_masked: '+5511****4321',
    whatsapp_phone: '+5511987654321'
  };
  const destination = getStaffDestination(presented);
  assert.equal(destination.configured, true);
  assert.equal(destination.label, '+5511****4321');
  assert.equal(stripRawWhatsappPhone(presented).whatsapp_phone, undefined);
  assert.equal(getStaffDestination({ whatsapp_phone: '+5511987654321' }).configured, false);
});

test('503 de canal não é tratado como envio', () => {
  const failure = interpretManualSendFailure({
    response: { status: 503, data: { error: 'Canal de WhatsApp indisponível. O envio não foi fingido.' } }
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.status, 503);
  assert.equal(failure.needs_confirm, undefined);
});

test('409 needs_confirm pede segundo POST com confirm', () => {
  const failure = interpretManualSendFailure({
    response: { status: 409, data: { needs_confirm: true, error: 'Já foi enviado um lembrete automático nas últimas 6 horas.' } }
  });
  assert.equal(failure.needs_confirm, true);
  assert.equal(failure.status, 409);
});

test('preview e extração aceitam {serviço}, {Profissional} e {horario}', () => {
  assert.equal(foldPlaceholderName('serviço'), 'servico');
  const text = 'Serviço: {serviço} com {Profissional} às {horario}';
  const used = extractPlaceholders(text).sort();
  assert.deepEqual(used, ['hora', 'profissional', 'servico']);
  const preview = renderTemplatePreview(text);
  assert.equal(preview.includes('{serviço}'), false);
  assert.match(preview, /Alongamento em gel/);
  assert.match(preview, /Jécia/);
  assert.match(preview, /14:30/);
  assert.equal(validateTemplate(`${DEFAULT_TEMPLATES.owner}\n{serviço}`, 'owner').valid, true);
});
