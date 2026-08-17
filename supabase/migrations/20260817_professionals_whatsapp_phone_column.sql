-- Additive only. Safe to re-run.
-- Adds professionals.whatsapp_phone so ADM can persist staff WhatsApp.
-- Does not revoke existing grants on professionals.
begin;

alter table public.professionals
    add column if not exists whatsapp_phone text;

comment on column public.professionals.whatsapp_phone is
    'Private staff WhatsApp in E.164. NULL if unset. Never expose on public GET.';

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

notify pgrst, 'reload schema';

commit;
