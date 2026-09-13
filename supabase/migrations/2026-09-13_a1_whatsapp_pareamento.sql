-- ============================================================================
-- Etapa A1 — WhatsApp: pareamento e base para a fila de pedidos
-- Projeto Supabase gkceyrkdmnhgqimmrsre · 2026-09-13
--
-- Tudo aqui é ADITIVO: cria tabelas e funções novas, não altera nem apaga
-- nenhuma tabela existente (simulados, logs, referência de Matemática).
-- Reversão: rollback_A1_whatsapp.sql (apaga só o que este arquivo cria).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. perfis — um registro por usuário do app
-- ----------------------------------------------------------------------------
create table if not exists public.perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whatsapp text unique,                        -- E.164 sem "+", ex.: 556296116652
  whatsapp_nome text,                          -- nome do perfil do WhatsApp na hora do pareamento
  whatsapp_vinculado_em timestamptz,
  ilimitado boolean not null default false,    -- conta do dono: sem freio diário (e, depois, sem créditos)
  limite_diario_wa integer not null default 30,-- questões/dia pedidas pelo WhatsApp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.perfis is 'Dados do professor além do auth.users: telefone do WhatsApp pareado e limites.';

create or replace function public.perfis_set_updated_at() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_perfis_updated_at on public.perfis;
create trigger trg_perfis_updated_at before update on public.perfis
  for each row execute function public.perfis_set_updated_at();

alter table public.perfis enable row level security;
drop policy if exists perfis_select_own on public.perfis;
create policy perfis_select_own on public.perfis for select to authenticated using (auth.uid() = user_id);
-- (sem insert/update/delete pelo navegador: tudo passa pelas funções abaixo ou pelo servidor)

-- Conta do dono: ilimitada.
insert into public.perfis (user_id, ilimitado)
select id, true from auth.users where email = 'maziadh@gmail.com'
on conflict (user_id) do update set ilimitado = true;

-- ----------------------------------------------------------------------------
-- 2. wa_vinculos — códigos de pareamento gerados no app (validade 15 min)
-- ----------------------------------------------------------------------------
create table if not exists public.wa_vinculos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  codigo text not null,                        -- 6 dígitos, único entre os pendentes (índice único parcial)
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '15 minutes',
  usado_em timestamptz,
  telefone text                                -- preenchido quando usado
);
create unique index if not exists wa_vinculos_codigo_pendente_uidx on public.wa_vinculos (codigo) where usado_em is null;
create index if not exists wa_vinculos_user_idx on public.wa_vinculos (user_id, criado_em desc);
alter table public.wa_vinculos enable row level security;
-- sem políticas: só via wa_gerar_codigo() e pelo servidor

-- ----------------------------------------------------------------------------
-- 3. wa_mensagens — toda mensagem recebida (id da Meta é a chave → nunca processa 2x)
-- ----------------------------------------------------------------------------
create table if not exists public.wa_mensagens (
  wamid text primary key,
  telefone text not null,
  user_id uuid references auth.users(id) on delete set null,
  tipo text,
  texto text,
  recebido_em timestamptz not null default now(),
  reservado_em timestamptz not null default now(), -- última vez que uma execução "pegou" esta linha para processar
  processado_em timestamptz,
  acao text,                                   -- vinculo_ok, vinculo_invalido, nao_vinculado, *_envio_falhou, *_envio_recusado, erro...
  resposta text,
  payload jsonb
);
create index if not exists wa_mensagens_telefone_idx on public.wa_mensagens (telefone, recebido_em desc);
alter table public.wa_mensagens enable row level security;
drop policy if exists wa_mensagens_select_own on public.wa_mensagens;
create policy wa_mensagens_select_own on public.wa_mensagens for select to authenticated using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4. wa_conversas — estado por telefone (pedido aguardando "SIM"; etapa B)
-- ----------------------------------------------------------------------------
create table if not exists public.wa_conversas (
  telefone text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  estado jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.wa_conversas enable row level security;

-- ----------------------------------------------------------------------------
-- 5. wa_trabalhos — fila de simulados pedidos pelo WhatsApp (etapa B/C)
-- ----------------------------------------------------------------------------
create table if not exists public.wa_trabalhos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  telefone text not null,
  parametros jsonb not null,                   -- area, disciplina, tema, quantidade, dificuldades, recurso...
  status text not null default 'pendente',     -- pendente | gerando | enviado | falhou | cancelado
  progresso jsonb not null default '{}'::jsonb,
  simulado_id uuid,                            -- referência ao simulado salvo (sem FK: simulados podem ser apagados)
  documentos jsonb,                            -- ids de mídia enviados à Meta
  erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
create index if not exists wa_trabalhos_status_idx on public.wa_trabalhos (status, criado_em);
create index if not exists wa_trabalhos_user_idx on public.wa_trabalhos (user_id, criado_em desc);
alter table public.wa_trabalhos enable row level security;
drop policy if exists wa_trabalhos_select_own on public.wa_trabalhos;
create policy wa_trabalhos_select_own on public.wa_trabalhos for select to authenticated using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 6. Funções chamadas pelo app (SECURITY DEFINER: executam com direitos do
--    dono, mas só agem sobre o usuário logado — auth.uid())
-- ----------------------------------------------------------------------------

-- Gera um código de 6 dígitos para o usuário logado. Invalida códigos pendentes
-- anteriores dele. Devolve o código e a validade.
-- Segurança: o sorteio usa pgcrypto (gen_random_bytes), não random() — random() é um
-- gerador previsível cujo estado é compartilhado entre usuários pelo pool de conexões.
-- O índice único parcial garante que dois usuários nunca tenham o mesmo código
-- pendente ao mesmo tempo, mesmo gerando no mesmo instante.
create or replace function public.wa_gerar_codigo()
returns table (codigo text, expira_em timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  novo text := null;
  tentativas int := 0;
  liberou boolean;
begin
  if uid is null then raise exception 'É preciso estar logado.' using errcode = '28000'; end if;
  -- garante que o perfil existe
  insert into public.perfis (user_id) values (uid) on conflict (user_id) do nothing;
  -- cancela pendentes anteriores do mesmo usuário (só dele: evita disputa de linhas entre usuários)
  -- (colunas qualificadas com "w." porque "codigo"/"expira_em" também são colunas de saída da função)
  update public.wa_vinculos w set usado_em = now()
   where w.usado_em is null and w.user_id = uid;
  loop
    -- 4 bytes aleatórios criptográficos → 0..4294967295 → 100000..999999
    if novo is null then
      novo := lpad((100000 + (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 900000))::text, 6, '0');
    end if;
    begin
      insert into public.wa_vinculos as w (user_id, codigo) values (uid, novo);
      exit;                                   -- inseriu sem colidir
    exception when unique_violation then
      tentativas := tentativas + 1;           -- outro usuário tem esse código pendente
      if tentativas > 20 then raise exception 'Não foi possível gerar um código; tente de novo.'; end if;
      -- se o dono do código já o deixou expirar, libera a linha dele e tenta O MESMO código de novo;
      -- se ainda está válido, sorteia outro
      update public.wa_vinculos w set usado_em = now()
       where w.codigo = novo and w.usado_em is null and w.expira_em < now();
      get diagnostics liberou = row_count;
      if not liberou then novo := null; end if;
    end;
  end loop;
  return query select novo, now() + interval '15 minutes';
end;
$$;
revoke all on function public.wa_gerar_codigo() from public, anon;
grant execute on function public.wa_gerar_codigo() to authenticated, service_role;

-- Remove o vínculo do WhatsApp do usuário logado.
create or replace function public.wa_desvincular()
returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'É preciso estar logado.' using errcode = '28000'; end if;
  update public.perfis set whatsapp = null, whatsapp_nome = null, whatsapp_vinculado_em = null where user_id = auth.uid();
  update public.wa_vinculos set usado_em = now() where user_id = auth.uid() and usado_em is null;
end;
$$;
revoke all on function public.wa_desvincular() from public, anon;
grant execute on function public.wa_desvincular() to authenticated, service_role;

-- Situação do WhatsApp do usuário logado (para a caixa do app).
create or replace function public.wa_meu_status()
returns table (whatsapp text, whatsapp_nome text, whatsapp_vinculado_em timestamptz, ilimitado boolean, limite_diario_wa integer)
language sql security definer set search_path = pg_catalog, public, pg_temp stable
as $$
  select p.whatsapp, p.whatsapp_nome, p.whatsapp_vinculado_em, p.ilimitado, p.limite_diario_wa
  from public.perfis p where p.user_id = auth.uid();
$$;
revoke all on function public.wa_meu_status() from public, anon;
grant execute on function public.wa_meu_status() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Função usada pelo webhook (servidor, chave de serviço): conclui o pareamento
--    de forma atômica. Devolve o user_id vinculado ou NULL se código inválido.
-- ----------------------------------------------------------------------------
create or replace function public.wa_concluir_vinculo(p_codigo text, p_telefone text, p_nome text)
returns table (vinculado_user_id uuid, vinculado_email text)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
  v record;
begin
  -- Aceita (1) um código pendente e válido, ou (2) um código que ESTE MESMO telefone já
  -- usou há menos de 30 min — assim, se a Meta reentregar a mesma mensagem (ex.: a
  -- resposta não pôde ser enviada), a resposta continua "vinculado", e não "código inválido".
  -- "for update" sem "skip locked": uma segunda execução simultânea espera a primeira
  -- terminar e então cai no caso (2), em vez de responder "inválido" por engano.
  select * into v from public.wa_vinculos w
   where w.codigo = p_codigo
     and (   (w.usado_em is null and w.expira_em > now())
          or (w.usado_em is not null and w.telefone = p_telefone and w.usado_em > now() - interval '30 minutes'))
   order by (w.usado_em is null) desc, w.criado_em desc limit 1
   for update;
  if not found then return; end if;
  if v.usado_em is null then
    -- o telefone só pode estar em um perfil: solta de quem o tinha antes
    update public.perfis p set whatsapp = null, whatsapp_nome = null, whatsapp_vinculado_em = null
     where p.whatsapp = p_telefone and p.user_id <> v.user_id;
    insert into public.perfis (user_id, whatsapp, whatsapp_nome, whatsapp_vinculado_em)
     values (v.user_id, p_telefone, p_nome, now())
     on conflict (user_id) do update set whatsapp = excluded.whatsapp, whatsapp_nome = excluded.whatsapp_nome, whatsapp_vinculado_em = now();
    update public.wa_vinculos w set usado_em = now(), telefone = p_telefone where w.id = v.id;
  end if;
  return query select u.id, u.email::text from auth.users u where u.id = v.user_id;
end;
$$;
-- IMPORTANTE: no Supabase, funções novas nascem executáveis por anon e authenticated
-- (default privileges). Esta função NÃO pode ser chamada pelo navegador — senão um
-- usuário logado poderia testar os 900.000 códigos e sequestrar o pareamento de outro.
revoke all on function public.wa_concluir_vinculo(text, text, text) from public, anon, authenticated;
grant execute on function public.wa_concluir_vinculo(text, text, text) to service_role;
-- (só a chave de serviço — usada pelo webhook — pode chamar esta função)
-- O gatilho de updated_at também não precisa ser chamável por ninguém via API:
revoke all on function public.perfis_set_updated_at() from public, anon, authenticated;
