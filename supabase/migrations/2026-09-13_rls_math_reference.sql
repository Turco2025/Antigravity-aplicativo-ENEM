-- Aplicada em 13/09/2026 como migration "rls_math_reference_staging_ingest_log".
-- Fecha duas tabelas auxiliares da referência de Matemática que estavam sem RLS
-- (anon/authenticated podiam ler, inserir e apagar com a chave pública do site).
-- Sem políticas: só o servidor (postgres / service_role) acessa. Nenhuma função
-- do app usa estas tabelas (ingest-math-reference só escreve em math_reference_chunks).
alter table public.math_reference_staging enable row level security;
alter table public.math_reference_ingest_log enable row level security;
