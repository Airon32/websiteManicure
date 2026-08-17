# Contrato de dados — lembretes e notificações

Dono: Database. Consumidor: backend. Migration: `supabase/migrations/20260817_appointment_reminders.sql`.

## SCHEMA CHANGE

### `professionals.whatsapp_phone`
- Tipo: `text`, **nullable**
- Formato: E.164 `^\+[1-9][0-9]{7,14}$` (ex.: `+5511999999999`)
- `''` é normalizado para `NULL` no trigger
- **Fora do GET público:** a coluna não entra em `select` público atual (`id, name, avatar, specialty, status`). Não usar `select(*)` nesta tabela.

### `appointments.status`
Whitelist: `agendado`, `confirmado`, `remarcacao_solicitada`, `cancelado`, `concluído`.  
Só adiciona o valor novo. Statuses antigos continuam válidos.

### `appointment_message_events`
PK surrogate `id` + colunas da tech-spec linha 24:

| Coluna | Tipo | Nulo |
|---|---|---|
| `appointment_id` | `bigint` | não |
| `type` | `text` | não — `BOOKING_OWNER_NOTIFICATION`, `BOOKING_PROFESSIONAL_NOTIFICATION`, `CLIENT_REMINDER_MANUAL`, `CLIENT_REMINDER_AUTOMATIC` |
| `recipient_kind` | `text` | não — `owner`, `professional`, `client` |
| `recipient_professional_id` | `text` | sim — `String(professionals.id)` quando o destino é equipe |
| `slot_date` | `date` | não |
| `slot_time` | `time` | não |
| `rule_key` | `text` | não — ex. `booking`, `client_auto_24h`, `client_manual` |
| `status` | `text` | não — `queued`, `sent`, `failed`, `suppressed` |
| `suppress_reason` | `text` | sim — ex. `MESMO_DESTINATARIO`, `MANUAL_NAS_6H` |
| `attempt_count` | `integer` | não, default 0 |
| `next_attempt_at` | `timestamptz` | sim |
| `error_code` | `text` | sim |
| `provider_message_id` | `text` | sim |
| `created_by_staff_id` | `text` | sim |
| `created_at` | `timestamptz` | não, default `now()` |
| `sent_at` | `timestamptz` | sim |

Sem telefone de cliente. Sem secrets.

Unique parcial:

```sql
UNIQUE (appointment_id, type, rule_key, slot_date, slot_time)
WHERE status IN ('sent', 'suppressed')
```

Settings seed (ON CONFLICT DO NOTHING): `reminder_notify_owner`, `reminder_notify_professional`, `reminder_client_auto` = `false`; `reminder_lead_hours` = `24`.

## RLS POLICY

| Objeto | Policy | Quem acessa | Quem não acessa |
|---|---|---|---|
| `professionals` | `professionals_select_self_admin_owner` / `professionals_update_self_admin_owner` | JWT staff: a própria linha; admin/owner: todas | anon; colaborador não vê linha de colega |
| `professionals` | `professionals_service_role_all` | backend `service_role` | — |
| `appointment_message_events` | `appointment_message_events_select_self_admin_owner` | admin/owner: tudo; profissional: eventos do próprio `recipient_professional_id`, `created_by_staff_id` ou agendamentos seus | anon; cliente direto no PostgREST |
| `appointment_message_events` | `appointment_message_events_service_role_all` | backend `service_role` (INSERT/UPDATE/SELECT, inclusive `failed`/`suppressed`) | — |

`anon` e `authenticated` **sem GRANT** de tabela (mesmo padrão de `security_hardening.sql`). GET público não passa pelo PostgREST autenticado; o backend com service_role **não deve** incluir `whatsapp_phone` no JSON público.

## QUERY DE PROVA

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'professionals' and column_name = 'whatsapp_phone';

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname in ('professionals_whatsapp_phone_e164', 'appointments_status_whitelist');

select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'appointment_message_events'
order by ordinal_position;

select indexname, indexdef
from pg_indexes
where tablename = 'appointment_message_events'
  and indexname = 'appointment_message_events_sent_suppressed_uidx';

select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in ('professionals', 'appointment_message_events');

select polname, tablename
from pg_policies
where tablename in ('professionals', 'appointment_message_events');

-- E.164 rejeita lixo; NULL passa
-- insert into professionals (..., whatsapp_phone) values (..., '1199999'); -- must fail
-- insert into professionals (..., whatsapp_phone) values (..., null); -- must pass
```
