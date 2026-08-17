-- Non-destructive migration: reminder system.
-- Additive only. Does not drop columns, rewrite statuses, or expose whatsapp_phone.
begin;

-- ---------------------------------------------------------------------------
-- JWT helpers (idempotent). Used by authenticated RLS. Backend uses service_role.
-- ---------------------------------------------------------------------------
create or replace function public.app_jwt_claims()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function public.app_user_id()
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
    select coalesce(
        nullif(public.app_jwt_claims() ->> 'app_user_id', ''),
        nullif(public.app_jwt_claims() ->> 'user_id', '')
    );
$$;

create or replace function public.app_user_type()
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
    select coalesce(
        nullif(public.app_jwt_claims() ->> 'app_user_type', ''),
        nullif(public.app_jwt_claims() ->> 'user_type', '')
    );
$$;

create or replace function public.app_is_privileged_staff()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
    select
        coalesce(public.app_jwt_claims() ->> 'app_user_type', public.app_jwt_claims() ->> 'user_type', '') = 'staff'
        and (
            coalesce(public.app_jwt_claims() ->> 'app_role', public.app_jwt_claims() ->> 'staff_role', '') in ('admin', 'owner')
            or coalesce(public.app_jwt_claims() ->> 'app_is_owner', '') in ('true', 't', '1')
        );
$$;

revoke all on function public.app_jwt_claims() from public, anon;
revoke all on function public.app_user_id() from public, anon;
revoke all on function public.app_user_type() from public, anon;
revoke all on function public.app_is_privileged_staff() from public, anon;
grant execute on function public.app_jwt_claims() to authenticated, service_role;
grant execute on function public.app_user_id() to authenticated, service_role;
grant execute on function public.app_user_type() to authenticated, service_role;
grant execute on function public.app_is_privileged_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1) professionals.whatsapp_phone — nullable E.164, private
-- Public GET already selects explicit columns and will not receive this field.
-- ---------------------------------------------------------------------------
alter table public.professionals
    add column if not exists whatsapp_phone text;

comment on column public.professionals.whatsapp_phone is
    'Private staff WhatsApp in E.164 (+ and 8-15 digits). NULL if unset. Never expose on public GET.';

create or replace function public.normalize_e164_whatsapp_phone()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
    if new.whatsapp_phone is not null and btrim(new.whatsapp_phone) = '' then
        new.whatsapp_phone := null;
    end if;
    return new;
end;
$$;

drop trigger if exists professionals_normalize_whatsapp_phone on public.professionals;
create trigger professionals_normalize_whatsapp_phone
    before insert or update of whatsapp_phone on public.professionals
    for each row
    execute function public.normalize_e164_whatsapp_phone();

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'professionals_whatsapp_phone_e164'
    ) then
        alter table public.professionals
            add constraint professionals_whatsapp_phone_e164
            check (
                whatsapp_phone is null
                or whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$'
            );
    end if;
end
$$;

alter table public.professionals enable row level security;

drop policy if exists "professionals_select_self_admin_owner" on public.professionals;
drop policy if exists "professionals_update_self_admin_owner" on public.professionals;
drop policy if exists "professionals_service_role_all" on public.professionals;

-- Self / admin / owner may read their allowed rows (includes whatsapp_phone).
-- Public/anon has no GRANT, so PostgREST cannot leak the column.
create policy "professionals_select_self_admin_owner"
    on public.professionals
    for select
    to authenticated
    using (
        public.app_is_privileged_staff()
        or (
            coalesce(public.app_user_id(), '') <> ''
            and id::text = public.app_user_id()
        )
    );

-- Self updates own row (phone); admin/owner update any staff row.
create policy "professionals_update_self_admin_owner"
    on public.professionals
    for update
    to authenticated
    using (
        public.app_is_privileged_staff()
        or (
            coalesce(public.app_user_id(), '') <> ''
            and id::text = public.app_user_id()
        )
    )
    with check (
        public.app_is_privileged_staff()
        or (
            coalesce(public.app_user_id(), '') <> ''
            and id::text = public.app_user_id()
        )
    );

create policy "professionals_service_role_all"
    on public.professionals
    for all
    to service_role
    using (true)
    with check (true);

revoke all privileges on table public.professionals from public, anon, authenticated;
grant select, insert, update, delete on table public.professionals to service_role;

-- ---------------------------------------------------------------------------
-- 2) appointments.status whitelist += remarcacao_solicitada
-- Existing values stay valid. Constraint is skipped if unexpected statuses exist.
-- ---------------------------------------------------------------------------
do $$
declare
    status_udt text;
    status_typtype char;
    con record;
begin
    select t.typname, t.typtype
      into status_udt, status_typtype
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
     where n.nspname = 'public'
       and c.relname = 'appointments'
       and a.attname = 'status'
       and a.attnum > 0
       and not a.attisdropped;

    if status_typtype = 'e' then
        begin
            execute format('alter type %I add value if not exists %L', status_udt, 'remarcacao_solicitada');
        exception when others then
            raise notice 'appointments status enum add skipped: %', sqlerrm;
        end;
    end if;

    for con in
        select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'appointments'
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%status%'
          and pg_get_constraintdef(c.oid) not ilike '%remarcacao_solicitada%'
    loop
        execute format('alter table public.appointments drop constraint %I', con.conname);
    end loop;

    if exists (
        select 1
        from public.appointments
        where status is not null
          and status not in ('agendado', 'confirmado', 'remarcacao_solicitada', 'cancelado', 'concluído')
    ) then
        raise notice 'appointments_status_whitelist skipped: unexpected existing status values';
    elsif not exists (
        select 1 from pg_constraint where conname = 'appointments_status_whitelist'
    ) then
        alter table public.appointments
            add constraint appointments_status_whitelist
            check (status in ('agendado', 'confirmado', 'remarcacao_solicitada', 'cancelado', 'concluído'));
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3) appointment_message_events — exact columns from tech-spec line 24
-- Surrogate id is added as PK; business columns match the spec.
-- No client phone. No secrets.
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_message_events (
    id bigint generated by default as identity primary key,
    appointment_id bigint not null,
    type text not null
        check (type in (
            'BOOKING_OWNER_NOTIFICATION',
            'BOOKING_PROFESSIONAL_NOTIFICATION',
            'CLIENT_REMINDER_MANUAL',
            'CLIENT_REMINDER_AUTOMATIC'
        )),
    recipient_kind text not null
        check (recipient_kind in ('owner', 'professional', 'client')),
    recipient_professional_id text,
    slot_date date not null,
    slot_time time not null,
    rule_key text not null,
    status text not null
        check (status in ('queued', 'sent', 'failed', 'suppressed')),
    suppress_reason text,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    next_attempt_at timestamptz,
    error_code text,
    provider_message_id text,
    created_by_staff_id text,
    created_at timestamptz not null default now(),
    sent_at timestamptz
);

comment on table public.appointment_message_events is
    'WhatsApp send ledger for bookings and client reminders. No client phone, no secrets.';
comment on column public.appointment_message_events.rule_key is
    'Idempotency key inside a slot, e.g. booking, client_auto_24h, client_manual.';
comment on column public.appointment_message_events.suppress_reason is
    'Machine-readable reason, e.g. MESMO_DESTINATARIO, MANUAL_NAS_6H.';

create unique index if not exists appointment_message_events_sent_suppressed_uidx
    on public.appointment_message_events (appointment_id, type, rule_key, slot_date, slot_time)
    where status in ('sent', 'suppressed');

create index if not exists appointment_message_events_appointment_id_idx
    on public.appointment_message_events (appointment_id);

create index if not exists appointment_message_events_status_retry_idx
    on public.appointment_message_events (status, next_attempt_at);

create index if not exists appointment_message_events_slot_idx
    on public.appointment_message_events (appointment_id, slot_date, slot_time);

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'appointment_message_events_appointment_id_fkey'
    ) then
        begin
            alter table public.appointment_message_events
                add constraint appointment_message_events_appointment_id_fkey
                foreign key (appointment_id)
                references public.appointments(id)
                on delete cascade;
        exception when others then
            raise notice 'appointment_id FK skipped (type mismatch or missing table): %', sqlerrm;
        end;
    end if;
end
$$;

alter table public.appointment_message_events enable row level security;
alter table public.appointment_message_events force row level security;

drop policy if exists "appointment_message_events_select_self_admin_owner" on public.appointment_message_events;
drop policy if exists "appointment_message_events_service_role_all" on public.appointment_message_events;

create policy "appointment_message_events_select_self_admin_owner"
    on public.appointment_message_events
    for select
    to authenticated
    using (
        public.app_is_privileged_staff()
        or (
            coalesce(public.app_user_id(), '') <> ''
            and (
                recipient_professional_id = public.app_user_id()
                or created_by_staff_id = public.app_user_id()
                or exists (
                    select 1
                    from public.appointments a
                    where a.id = appointment_message_events.appointment_id
                      and a.professional_id::text = public.app_user_id()
                )
            )
        )
    );

create policy "appointment_message_events_service_role_all"
    on public.appointment_message_events
    for all
    to service_role
    using (true)
    with check (true);

revoke all privileges on table public.appointment_message_events from public, anon, authenticated;
grant select, insert, update, delete on table public.appointment_message_events to service_role;

do $$
begin
    if exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'appointment_message_events_id_seq'
          and c.relkind = 'S'
    ) then
        execute 'grant usage, select on sequence public.appointment_message_events_id_seq to service_role';
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Settings KV for reminder toggles/templates. Defaults OFF. Non-destructive seed.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
    ('reminder_notify_owner', 'false'),
    ('reminder_notify_professional', 'false'),
    ('reminder_client_auto', 'false'),
    ('reminder_lead_hours', '24')
on conflict (key) do nothing;

commit;
