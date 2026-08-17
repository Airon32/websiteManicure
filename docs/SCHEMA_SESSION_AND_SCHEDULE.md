# Contrato de dados — sessão (refresh) e expediente por dia

Dono: Database. Consumidor: backend. Sem coluna nova em `settings`.

## 1. `public.refresh_tokens`

| Coluna | Tipo | Nulo | Notas |
|---|---|---|---|
| `id` | `bigint` identity | não | PK |
| `user_id` | `text` | não | `String(professionals.id)` ou `String(clients.id)` |
| `user_type` | `text` | não | `staff` ou `client` |
| `token_hash` | `text` | não | digest SHA-256 (hex ou base64url), mínimo 40 chars. Nunca o token cru |
| `expires_at` | `timestamptz` | não | validade absoluta do refresh |
| `created_at` | `timestamptz` | não | default `now()` |
| `revoked_at` | `timestamptz` | sim | logout / rotação / reuso. `NULL` = ativo |
| `replaced_by_token_id` | `bigint` FK → `refresh_tokens.id` | sim | próximo token da cadeia. `ON DELETE SET NULL` |

Índices: `user_id`, `(user_id, user_type)`, `expires_at`, unique `token_hash`, parciais de revogados e ativos, `replaced_by_token_id`.

`professionals.id` e `clients.id` no schema real desta app são numéricos (`int`/`bigint`), não UUID. `user_id` é TEXT de propósito para caber `String(id)` sem cast no banco.

## 2. RLS

RLS ativo + `FORCE`. `anon` e `authenticated` sem privilégio de tabela.

| Quem | Acesso |
|---|---|
| `service_role` (backend com `SUPABASE_SECRET_KEY`) | SELECT / INSERT / UPDATE / DELETE em todas as linhas, inclusive revogadas |
| owner/admin via JWT autenticado (`app_role` admin/owner) | SELECT de todos os tokens |
| profissional/cliente via JWT autenticado | SELECT só das próprias linhas (`user_id` + `user_type`) |
| `anon` | nada |

Policy nomeada **`Service role full access`**: `FOR ALL TO service_role USING (true) WITH CHECK (true)`.

No Supabase hospedado, `service_role` também tem `BYPASSRLS`. A policy + o `GRANT` cobrem INSERT/UPDATE/SELECT de `replaced_by_token_id` e de linhas com `revoked_at` preenchido. **Não precisa de policy extra.** SELECT não filtra `revoked_at IS NULL`.

Rotação / reuso (backend, service_role):

1. `SELECT` pelo `token_hash` (pode já estar revogado).
2. Se reuso: `UPDATE ... SET revoked_at = now()` em toda a família `user_id + user_type`.
3. Se rotação saudável: `INSERT` do novo token, depois `UPDATE` do antigo com `revoked_at` e `replaced_by_token_id`.

## 3. Expediente por dia — `settings` (key/value TEXT)

`settings.value` é `TEXT`. Não há `varchar(2000)` no banco. O JSON das 7 chaves cabe com folga (centenas de bytes). Não há coluna nova.

Chaves canônicas:

- `schedule` — global
- `professional_<id>_schedule` — por profissional (`<id>` numérico)

Formato (string JSON):

```json
{
  "dom": null,
  "seg": { "start": "09:00", "end": "18:00" },
  "ter": { "start": "10:00", "end": "19:00" },
  "qua": null,
  "qui": { "start": "09:00", "end": "18:00" },
  "sex": { "start": "09:00", "end": "18:00" },
  "sab": { "start": "09:00", "end": "14:00" }
}
```

Regras: exatamente as 7 chaves `dom,seg,ter,qua,qui,sex,sab`. Folga = `null`. Aberto = objeto só com `start` e `end` em `HH:MM` 24h, `start < end`. Trigger rejeita JSON inválido nessas chaves.

Legado preservado (não apagado): `work_start`, `work_end`, `work_days` e `professional_<id>_work_*`. Fallback se `schedule` ainda não existir.

A migration faz seed não destrutivo (`ON CONFLICT DO NOTHING`) de `schedule` a partir do legado.
