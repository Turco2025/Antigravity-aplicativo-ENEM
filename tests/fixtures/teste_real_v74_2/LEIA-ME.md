# Teste real interno — 10 × Biologia / "Ecologia - Ciclos Biogeoquímicos" (backend v74.2, 15/09/2026)

Registro congelado do teste que antecedeu a v18.3 / v74.3.

- `planejamento_resposta.json` — resposta REAL do planejador (10 recortes, um por domínio reservado). Serve de prova do corte limpo do contexto (v74.2): os 10 contextos terminam em frase completa, com 113 a 130 caracteres.
- `questoes_biologia.json` — as 10 questões REAIS entregues: alternativas, gabarito planejado e entregue, habilidade, competência, domínio, custo e tamanho da especificação de imagem. Os textos-base e as resoluções comentadas não foram transcritos (o que estas fixtures documentam é a PARIDADE das alternativas).

O que este registro provou: gabarito planejado = entregue nas 10; 10 habilidades distintas; nenhuma questão ordenada da mais curta para a mais longa; e o gabarito é a alternativa mais longa em 5 das 10 — em duas delas com folga (261 contra 199 caracteres na questão 7, 245 contra 184 na 10). Daí a regra de paridade do v74.3 e a auditoria corrigida do v18.3.

Usado por `tests/verify_paridade_alternativas.js`, junto com as 10 questões de Matemática de `../teste_real_v73/`.
