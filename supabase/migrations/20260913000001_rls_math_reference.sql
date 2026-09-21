-- Fecha duas tabelas auxiliares da referência de Matemática se existirem
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'math_reference_staging') then
    execute 'alter table public.math_reference_staging enable row level security';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'math_reference_ingest_log') then
    execute 'alter table public.math_reference_ingest_log enable row level security';
  end if;
end $$;
