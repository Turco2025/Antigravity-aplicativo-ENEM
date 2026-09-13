-- ATENÇÃO: este rollback APAGA os pareamentos (perfis.whatsapp), o flag "ilimitado",
-- as mensagens recebidas e a fila. Só rode se quiser voltar ao estado anterior à etapa A1.
-- Ele pressupõe que public.perfis foi criada por migracao_A1_whatsapp.sql (era assim em 13/09/2026:
-- o schema public só tinha simulados, *_log e math_reference_*).
-- Reversão da etapa A1 — apaga SOMENTE o que migracao_A1_whatsapp.sql criou.
-- Não toca em simulados, logs, referência de Matemática nem em auth.users.
drop function if exists public.wa_concluir_vinculo(text, text, text);
drop function if exists public.wa_meu_status();
drop function if exists public.wa_desvincular();
drop function if exists public.wa_gerar_codigo();
drop table if exists public.wa_trabalhos;
drop table if exists public.wa_conversas;
drop table if exists public.wa_mensagens;
drop table if exists public.wa_vinculos;
drop trigger if exists trg_perfis_updated_at on public.perfis;
drop function if exists public.perfis_set_updated_at();
drop table if exists public.perfis;
