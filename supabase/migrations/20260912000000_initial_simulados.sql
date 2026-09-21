-- ============================================================================
-- Tabela principal: simulados
-- Arquivamento de simulados por professor (protegido por RLS)
-- ============================================================================

create table if not exists public.simulados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text,
  area text,
  disciplina text,
  dados jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.simulados is 'Simulados gerados pelos professores e armazenados na conta.';

alter table public.simulados enable row level security;

drop policy if exists simulados_select_own on public.simulados;
create policy simulados_select_own on public.simulados for select to authenticated using (auth.uid() = user_id);

drop policy if exists simulados_insert_own on public.simulados;
create policy simulados_insert_own on public.simulados for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists simulados_update_own on public.simulados;
create policy simulados_update_own on public.simulados for update to authenticated using (auth.uid() = user_id);

drop policy if exists simulados_delete_own on public.simulados;
create policy simulados_delete_own on public.simulados for delete to authenticated using (auth.uid() = user_id);
