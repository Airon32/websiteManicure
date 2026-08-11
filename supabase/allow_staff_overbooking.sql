begin;

-- Remove a trava legada de horário inicial duplicado. A autorização e as regras
-- diferentes para equipe e clientes são aplicadas pelo backend.
drop index if exists public.appointments_unique_active_start;

commit;
