# Plano de teste QA — Lembretes e notificações

**Cargo:** QA  
**Fontes:** nota `reminder-system-product-spec` (VP STRATEGY) + nota `reminder-system-tech-spec` linha 52 (VP ENGINEERING) + `docs/SCHEMA_REMINDER_SYSTEM.md`  
**Status de execução:** **HOLD** até schema DEV aplicado (migration `supabase/migrations/20260817_appointment_reminders.sql`). Sem evidência de API real = **NOT VERIFIED**.  
**Não inventar PASS.** Cada cenário abaixo nasce **NOT TESTED**.

Timezone de verdade: `America/Sao_Paulo`.  
Job: `POST /api/jobs/appointment-reminders` + `Authorization: Bearer CRON_SECRET`.  
Manual: `POST /api/appointments/:id/reminders`.  
Eventos: `GET /api/appointments/:id/message-events`.  
Tabela: `appointment_message_events`. Unique parcial `(appointment_id, type, rule_key, slot_date, slot_time) WHERE status IN ('sent','suppressed')`.

Mapeamento UX → banco:

| UX | Banco |
|---|---|
| PENDENTE | `agendado` |
| CONFIRMADO | `confirmado` (exceto `BLOCK:`) |
| REMARCACAO_SOLICITADA | `remarcacao_solicitada` |
| CANCELADO | `cancelado` |
| CONCLUIDO (operacional) | `concluído` |

---

## HOLD

Execução contra API real, job cron e portal autenticado **não começa** até Database confirmar schema DEV aplicado (coluna `professionals.whatsapp_phone`, whitelist de status, tabela + unique + RLS de `appointment_message_events`).

Quando HOLD sair: pedir evidência a Database (QUERY DE PROVA do contrato) e ambiente a `DEV SERVER / DEVELOPMENT & TESTING HUB`. Só então marcar cenários.

---

## 21 cenários explícitos

Cada cenário: pré-condição, ação, esperado, evidência. Resultado = PASS / FAIL / BLOCKED / NOT TESTED.

### Grupo A — Estados da cliente (1–7)

#### C01 — PENDENTE recebe lembrete automático completo
- **Pré:** `status=agendado`; `reminder_client_auto=ON`; telefone cliente válido (não dummy); slot na janela 24h ± 20 min; sem MANUAL `sent` nas 6h.
- **Ação:** disparar o job 1x.
- **Esperado:** 1 evento `CLIENT_REMINDER_AUTOMATIC` `status=sent`; corpo = template PENDENTE (“Por favor, confirme seu horario.”); ações de sistema **Confirmar** e **Preciso remarcar**; placeholders preenchidos; data BR; hora 24h; **não** usar a palavra “amanhã”.
- **Evidência:** GET message-events + payload/log do provedor (sem telefone em claro nos eventos).

#### C02 — CONFIRMADO (confirmação prévia) recebe variante simplificada
- **Pré:** `status=confirmado` (não `BLOCK:`); mesmas condições de janela/toggle de C01.
- **Ação:** disparar o job 1x.
- **Esperado:** 1 `CLIENT_REMINDER_AUTOMATIC` `sent`; última frase = “Seu horario ja esta confirmado. Se precisar alterar, avise a gente.”; **sem** botão/ação Confirmar; apenas **Preciso remarcar**.
- **Evidência:** evento + conteúdo da mensagem.

#### C03 — REMARCACAO_SOLICITADA suspende lembrete
- **Pré:** agendamento elegível; cliente/equipe aciona Preciso remarcar → `status=remarcacao_solicitada`.
- **Ação:** disparar o job.
- **Esperado:** **zero** `sent` cliente/equipe para esse slot; nenhum queued que vire sent; sino **não** é fonte de verdade.
- **Evidência:** GET message-events vazio de sent novo; status no banco = `remarcacao_solicitada`.

#### C04 — CANCELADO nunca recebe
- **Pré:** `status=cancelado`; slot ainda “dentro” da janela 24h.
- **Ação:** job.
- **Esperado:** nenhum `CLIENT_REMINDER_*` / booking notification `sent`.
- **Evidência:** events + resposta do job (count sent = 0 para esse id).

#### C05 — CONCLUIDO nunca recebe
- **Pré:** `status=concluído`.
- **Ação:** job.
- **Esperado:** nenhum sent.
- **Evidência:** events.

#### C06 — BLOCK: interno nunca recebe
- **Pré:** registro interno com `notes`/`BLOCK:` (spec: bloqueios de agenda excluídos); mesmo que `confirmado`.
- **Ação:** job + criação de agendamento (fluxos 1–2).
- **Esperado:** nenhum OWNER/PROFISSIONAL/CLIENTE sent.
- **Evidência:** events + job result.

#### C07 — Telefone dummy nunca recebe
- **Pré:** cliente com telefone dummy conhecido do produto; `agendado`; janela ok; auto ON.
- **Ação:** job.
- **Esperado:** nenhum sent cliente; se houver registro, `suppressed`/`failed` com motivo claro — **nunca** `sent`.
- **Evidência:** events (`suppress_reason` / `error_code`).

### Grupo B — OWNER e profissional (8–11)

#### C08 — Novo agendamento avisa OWNER (template distinto)
- **Pré:** owner canônico (`role=owner` OU `is_owner`); `whatsapp_phone` E.164; `reminder_notify_owner=ON`; profissional **diferente** do owner; agendamento criado (painel ou cliente), não BLOCK.
- **Ação:** criar agendamento.
- **Esperado:** 1 `BOOKING_OWNER_NOTIFICATION` `sent`; template OWNER (inclui Cliente, Profissional, Servico, Data, Horario, estabelecimento); **sem** fallback mari/mariana/id 1/pro-1.
- **Evidência:** event `recipient_kind=owner`, `recipient_professional_id` = id do owner.

#### C09 — Novo agendamento avisa PROFISSIONAL (template diferente do OWNER)
- **Pré:** mesmo de C08; `reminder_notify_professional=ON`; profissional com `whatsapp_phone`.
- **Ação:** criar agendamento.
- **Esperado:** 1 `BOOKING_PROFESSIONAL_NOTIFICATION` `sent`; texto **diferente** do OWNER (sem linha “Profissional:”, com “Local: {estabelecimento}”).
- **Evidência:** event + corpo.

#### C10 — OWNER = profissional (mesmo ID) — uma mensagem
- **Pré:** `owner.id === appointment.professional_id`; ambos toggles ON.
- **Ação:** criar agendamento.
- **Esperado:** 1 `sent` com template **OWNER**; evento profissional `suppressed` com `suppress_reason=MESMO_DESTINATARIO`; **não** há segundo disparo ao provedor. Comparação **só por ID**, nunca nome/telefone.
- **Evidência:** 2 rows (sent + suppressed) no mesmo appointment; 1 `provider_message_id`.

#### C11 — Zero owners canônicos
- **Pré:** nenhum professional ativo com `role=owner` nem `is_owner`; toggle owner tentado ON.
- **Ação:** criar agendamento / ligar toggle.
- **Esperado:** **não** envia; painel mostra erro de configuração; **não** usa `whatsapp_number` público do salão.
- **Evidência:** UI erro + zero sent OWNER.

### Grupo C — Manual vs automático 6h (12–15)

#### C12 — Manual sent nas 6h suprime automático
- **Pré:** PENDENTE; `CLIENT_REMINDER_MANUAL` `sent` há < 6h; auto ON; slot na janela.
- **Ação:** job.
- **Esperado:** `CLIENT_REMINDER_AUTOMATIC` `suppressed` (`MANUAL_NAS_6H` ou equivalente); **não** sent automático.
- **Evidência:** unique respeitado; 1 sent manual + 1 suppressed auto.

#### C13 — Automático sent nas 6h → manual pede confirmação (`needs_confirm`)
- **Pré:** `CLIENT_REMINDER_AUTOMATIC` `sent` há < 6h.
- **Ação:** POST manual **sem** confirmar extra.
- **Esperado:** API **não** envia; resposta `needs_confirm`; UI: “Um lembrete automatico foi enviado ha X. Deseja enviar novamente?” ações **Voltar** e **Enviar mesmo assim**. Manual **nunca** proibido.
- **Evidência:** HTTP body + screenshot; segundo POST com confirm = 1 novo MANUAL sent.

#### C14 — Manual permanece com automático OFF
- **Pré:** `reminder_client_auto=OFF`; PENDENTE; staff autorizado.
- **Ação:** POST `/api/appointments/:id/reminders`.
- **Esperado:** `CLIENT_REMINDER_MANUAL` `sent` (canal ok); botão visível no card/detalhe.
- **Evidência:** event `created_by_staff_id` + UI.

#### C15 — wa.me / tentativa / falha não contam como enviado
- **Pré:** staff abre wa.me **ou** provedor falha **ou** tentativa queued/failed.
- **Ação:** (a) não chamar API / só abrir link; (b) job na janela com MANUAL failed < 6h (sem sent).
- **Esperado:** (a) nenhum event `sent`; detalhe = “Sem envio registrado” se não houver histórico. (b) automático **não** é suprimido por failed. Unique **não** trata failed como sent.
- **Evidência:** events; job ainda elegível.

### Grupo D — Remarcação, retry, canal (16–21)

#### C16 — Remarcação aceita reinicia slot
- **Pré:** C03 feito; equipe aceita novo date/time → `status=agendado` (PENDENTE) em **novo** `slot_date`/`slot_time`.
- **Ação:** job na janela do **novo** slot (e de novo no slot antigo, se ainda “24h”).
- **Esperado:** slot antigo **não** reenvia; novo slot **elegível** (C01). Tarefas pendentes do horário anterior invalidadas.
- **Evidência:** events com `slot_date/time` distintos; unique por slot.

#### C17 — Retry 3x; falha nunca vira sent
- **Pré:** agendamento elegível; provedor força erro.
- **Ação:** job na falha; avançar relógio/backoff 5 min → 15 min → 45 min (3 tentativas).
- **Esperado:** `status=failed`; `attempt_count` até 3; `next_attempt_at` 5/15/45; **nunca** `sent` sem `provider_message_id` de sucesso. UI detalhe: Falha + **Tentar novamente**. Após max: permanece failed.
- **Evidência:** 1 row failed (não 3 sent); attempt_count=3.

#### C18 — Canal sem botões: fallback de ações
- **Pré:** canal/provedor sem botões interativos (ou modo texto).
- **Ação:** enviar C01 (PENDENTE) e C02 (CONFIRMADO).
- **Esperado:** links/ações textuais **equivalentes e seguros** para Confirmar / Preciso remarcar (PENDENTE) e só remarcar (CONFIRMADO). Botões **não** vêm do texto livre do template.
- **Evidência:** payload da mensagem (sem HTML interpretado).

#### C19 — Sem provedor: 503; toggle não finge envio
- **Pré:** credenciais Meta/WhatsApp ausentes.
- **Ação:** job e/ou manual; tentar ligar toggles “Ativo”.
- **Esperado:** HTTP **503** de canal; toggle **não** mostra Ativo com envio real; nenhum `sent`.
- **Evidência:** status code + UI.

#### C20 — Toggle equipe sem destino válido não liga
- **Pré:** owner ou profissional com `whatsapp_phone` NULL.
- **Ação:** ligar “Avisar proprietaria” / “Avisar profissional”.
- **Esperado:** bloqueado; “Destino não configurado”; CTA “Configurar contato”; destino mascarado quando existir. Fora do GET público.
- **Evidência:** PUT settings rejeitado ou UI impede; GET público de professionals **sem** `whatsapp_phone`.

#### C21 — Janela 24h ± 20 min em America/Sao_Paulo
- **Pré:** auto ON; três agendamentos PENDENTE: (a) 24h ± 10 min (dentro); (b) 24h + 30 min (fora); (c) 2h à frente (fora).
- **Ação:** um POST job “agora”.
- **Esperado:** só (a) `sent` (ou queued→sent); (b)(c) não sent. `reminder_lead_hours=24` nesta entrega. Cron só acorda; sem `setTimeout` no frontend.
- **Evidência:** timestamps do job vs `slot_date+slot_time` convertidos em `America/Sao_Paulo`.

---

## Casos de idempotência (obrigatórios — fora da contagem dos 21, mas critério de pronto da tech-spec)

Chave: **appointment + regra (`type`/`rule_key`) + slot (`slot_date`+`slot_time`)**. Unique parcial em `sent` e `suppressed`.

### I01 — Job 3x = 1 sent (mesmo appointment+regra+slot)
- **Pré:** C01 elegível; nenhum sent prévio.
- **Ação:** `POST /api/jobs/appointment-reminders` **três vezes seguidas** (mesmo relógio).
- **Esperado:** exatamente **1** `CLIENT_REMINDER_AUTOMATIC` `sent` para aquele appointment+`rule_key`+slot. Rodadas 2 e 3: no-op ou suppressed; **não** segundo `provider_message_id`. Constraint unique não quebra o job (sem 500).
- **Evidência:** `SELECT count(*) ... status='sent'` = 1; log das 3 respostas do job.

### I02 — Remarcação gera slot novo (libera 1 sent no slot novo)
- **Pré:** I01 sent no slot A; depois C16 (slot B).
- **Ação:** job 3x no horário do slot B.
- **Esperado:** 1 sent no slot B; slot A permanece 1 sent (não reenvia). Total sent cliente = 2 (A+B), cada um com slot diferente.
- **Evidência:** events agrupados por `slot_date, slot_time`.

### I03 — Unique não collapsa tipos diferentes
- **Pré:** mesmo appointment/slot; OWNER sent + PROFESSIONAL sent (C08+C09, IDs diferentes).
- **Ação:** re-job.
- **Esperado:** 1 sent por `type`/`rule_key`; owner e profissional **não** se sobrescrevem. C10 continua 1 sent + 1 suppressed.
- **Evidência:** counts por `type`.

### I04 — `failed` não ocupa a unique de sent
- **Pré:** C17 failed no slot.
- **Ação:** provedor volta a funcionar; Tentar novamente ou job após backoff, sucesso.
- **Esperado:** pode virar `sent` (update da mesma row ou nova row — o contrato unique só trava `sent|suppressed`). Nunca dois `sent` do mesmo type+rule+slot.
- **Evidência:** 1 sent final; attempt_count refletido.

### I05 — Manual e automático são regras distintas, com dedup 6h
- **Pré:** C13 confirmado “Enviar mesmo assim”.
- **Ação:** job de novo na mesma janela.
- **Esperado:** auto **suprimido** (manual recente nas 6h) — C12. Dois `type` diferentes podem coexistir (`MANUAL sent` + `AUTOMATIC suppressed`), unique por type+rule+slot.
- **Evidência:** events.

---

## Checklist visual — 4 viewports (portal localhost)

Portal: `localhost` → `http://localhost:5173`  
Comando: `maestri portal create http://localhost:5173 "qa-vp" --size WxH` (ou `portal edit` + size).  
Viewports **obrigatórios** (tech-spec L52):

| ID | Size | Perfil |
|---|---|---|
| V1 | 390×844 | iPhone 12/13/14 |
| V2 | 412×915 | Android grande |
| V3 | 768×1024 | Tablet |
| V4 | 1440×900 | Desktop |

Aprovar mobile **somente** com viewport real. Sem screenshot = **NOT VERIFIED**.

Dark/pink: fundo/cards escuros, borda rosa sutil, toggle ativo rosa, **rosa não é o único indicador**, foco/contraste acessíveis.

### Por viewport, marcar PASS/FAIL

**P0 — Ajustes > Lembretes e notificações**
- [ ] Rota Painel ADM > Ajustes > Lembretes e notificações
- [ ] Cabeçalho + apoio “Configure quem recebe avisos…”
- [ ] Sem overflow horizontal; tap target ≥ 44×44 no V1/V2
- [ ] Foco visível no teclado (V4)

**P1 — Card Cliente**
- [ ] Toggle “Lembrete automatico para cliente” + badge Ativo/Inativo (não só cor)
- [ ] Antecedência 24h; **sem** opções falsas 12h/48h/Personalizado
- [ ] Ajuda: envio pode ocorrer alguns minutos antes/depois
- [ ] Toggle OFF não esconde o manual no card/detalhe da agenda

**P2 — Card Equipe**
- [ ] Toggles independentes proprietária / profissional
- [ ] Destino mascarado **ou** “Destino não configurado”
- [ ] Ativação bloqueada sem destino + CTA Configurar contato
- [ ] Erro de configuração visível se zero owners (C11)

**P3 — Templates (3 abas)**
- [ ] Abas Proprietária / Profissional / Cliente
- [ ] Textarea, contador, Inserir variável, preview fictício escapado, Restaurar padrão, Salvar
- [ ] Erro inline (token inválido/vazio) **não** apaga rascunho
- [ ] “Em aprovacao” se provedor exigir (quando aplicável)
- [ ] Botões Confirmar/Remarcar **não** editáveis no texto

**P4 — Card da agenda (indicador)**
- [ ] Um sino discreto + tooltip/aria-label
- [ ] Formas: contornado pendente; check auto; mão+check manual; alerta falha; riscado suprimido (só se relevante)
- [ ] Sem histórico: não inventa status

**P5 — Detalhe do agendamento**
- [ ] Seção “Lembretes da cliente”: status, último envio local, tipo, resultado, antecedência, autor, motivo
- [ ] Enviar lembrete; Tentar novamente em falha; Ver histórico se >1 evento
- [ ] “Sem envio registrado” se vazio
- [ ] “Avisos da equipe” separado e **não** muda o sino da cliente
- [ ] Modal C13 (Voltar / Enviar mesmo assim) cabe no V1 sem corte

**P6 — Regressão visual**
- [ ] Login / agenda DIA não quebram no viewport
- [ ] Sem texto cortado nos templates preview (V1)

Evidência por viewport: screenshot nomeado `qa-reminder-V{1-4}-{P0-P6}.png` + nota PASS/FAIL.

---

## Ordem de execução (quando HOLD liberar)

1. Database: QUERY DE PROVA ok em DEV.  
2. `DEV SERVER / DEVELOPMENT & TESTING HUB`: API + frontend no ar; portal 5173.  
3. I01 (job 3x=1 sent) **antes** de poluir dados.  
4. C01–C21 em fixtures isolados (não reutilizar o appointment do I01 sem reset).  
5. I02–I05.  
6. Visual V1→V4 no portal.  
7. Relatório a **GERENTE DE ENGENHARIA** (regressão crítica também a **VP ENGINEERING**): counts reais, sem “21/21” inventado.

## Fora de escopo deste plano

- Implementar feature (Frontend/backend).  
- Schema/RLS (Database).  
- Security review de secrets (Security).  
- Aprovar produção.

## Registro

| Campo | Valor |
|---|---|
| Plano | `docs/QA_REMINDER_SYSTEM_TEST_PLAN.md` |
| Execução API real | HOLD |
| 21 cenários | descritos; **NOT TESTED** |
| Idempotência I01–I05 | descritos; **NOT TESTED** |
| Visual 4 viewports | checklist pronto; **NOT VERIFIED** |
