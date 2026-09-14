# Teste real interno — 10 × Matemática / Exponenciação (backend v73, 14/09/2026)

Registro congelado do teste que antecedeu a publicação de app v17 / generate-question v73.

- `planejamento_resposta.json` — resposta REAL do planejador de recortes (10 recortes, um por domínio reservado).
- `fase_b_corpos.json` — o que o app v17 REAL enviou ao backend para cada questão (reservas de domínio, recortes aceitos, `gabaritoPlan` EADBCEBDCA). Usado como fixture por `tests/teste_real_fase_b.js` e `tests/teste_real_fase_d.js`.
- `q01.json` … `q10.json` — as 10 respostas REAIS do backend v73 (questão + `uso` + `notacaoDiag` + `diversidadeDiag`), transcritas e conferidas por md5 de `jsonb_pretty` (`jsonb_pretty.py` reproduz a formatação do Postgres para a conferência).

Rodar: `node tests/teste_real_fase_d.js` — carrega as 10 questões no app inteiro (sem rede) e imprime gabaritos, auditorias de tema/contexto/gabarito, auditoria local de cada cartão, glifos do PDF e notação. Saída detalhada em `tests/saida/fase_d_resultado.json` (pasta ignorada pelo git).
