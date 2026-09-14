# Gerador Inteligente de Simulados ENEM

Aplicativo que gera questões inéditas no padrão ENEM (com gabarito, resolução comentada e
análise de cada alternativa), incluindo recursos visuais opcionais — imagem gerada por IA,
gráfico ou tabela — para professores montarem simulados personalizados por área, disciplina,
tema, dificuldade e competência/habilidade da Matriz de Referência oficial.

## Como usar

Basta abrir o arquivo **`index.html`** direto no navegador (localmente, ou publicado via
GitHub Pages/Netlify/qualquer hospedagem de arquivo estático). Não é preciso instalar nada
nem configurar chave de API no navegador — o app já vem pronto para uso.

## Arquitetura

O app é 100% estático no navegador (`index.html`, um único arquivo autocontido) e depende de
duas Supabase Edge Functions próprias para gerar conteúdo com segurança:

- **`generate-question`** — recebe os parâmetros da questão (área, disciplina, tema,
  dificuldade, recurso visual, competência/habilidade) e chama a API da Anthropic (Claude)
  para elaborar a questão completa, com revisão pedagógica automática opcional. Também
  atende o modo "refazer recurso visual", que gera só uma nova versão do gráfico/tabela/
  imagem de uma questão já pronta, mantendo o resto intacto.
- **`generate-image`** — recebe uma descrição e chama a API de imagens da OpenAI
  (`gpt-image-2` por padrão) para gerar a ilustração usada nas questões do tipo "imagem".
- **`whatsapp-webhook`** — recebe as mensagens do WhatsApp (Meta Cloud API) enviadas ao
  número oficial do Gerador ENEM. Nesta fase faz o **pareamento**: o professor clica em
  "Solicitar simulados pelo WhatsApp → Vincular meu WhatsApp" no app, recebe um código de
  6 dígitos e o envia pelo WhatsApp; o webhook confere a assinatura da Meta, valida o código
  e liga o telefone à conta. Pedir simulados pela conversa é a próxima fase.

As chaves de API (`ANTHROPIC_API_KEY` e `OPENAI_API_KEY`) e as credenciais do WhatsApp
(`WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WABA_ID`) ficam guardadas só nos **secrets**
do projeto Supabase que hospeda essas funções — nunca aparecem no navegador, neste
repositório, ou em qualquer arquivo do projeto.

```
index.html                            → app final, pronto para uso (gerado por src/combine.py)
src/app_template.html                 → HTML/CSS base do app
src/app.js                            → lógica do app (client-side)
src/app_data.json                     → Matriz de Referência do ENEM + contexto pedagógico por área
src/combine.py                        → script que combina os três arquivos acima em index.html
src/fonts.js                          → Carlito embarcada no PDF (subconjunto; v16 com letras sobre/subscritas)
fontwork/ampliar_carlito.py           → gera o fonts.js a partir da Carlito do sistema (documentação do subconjunto)
nm/                                   → núcleo da notação matemática (JS compartilhado) + casos de teste + testes Node/Deno
supabase/functions/generate-question/ → Edge Function que gera as questões (Claude) + notação (notacao_quimica.ts, notacao_matematica.ts)
supabase/functions/review-math-question/ → revisor de matemática (contas com lastro nos livros de referência)
supabase/functions/generate-image/    → Edge Function que gera as imagens (GPT Image)
supabase/functions/whatsapp-webhook/  → Edge Function do WhatsApp (pareamento) + testes Deno
supabase/migrations/                  → migrações do banco (tabelas perfis e wa_*, RLS)
tests/                                → testes automatizados (Playwright) do app
```

## Caixa "Solicitar simulados pelo WhatsApp" (v15)

Logo abaixo do cabeçalho, para usuários logados. Gera um código de 6 dígitos (função
`wa_gerar_codigo` do banco, só para o usuário autenticado), abre o WhatsApp com a mensagem
"Vincular conta 123456" pronta (link `wa.me` para o número em `WHATSAPP_NUMERO_EMPRESA`, no
topo de `src/app.js`) e acompanha o pareamento consultando `wa_meu_status` a cada 4 s. Teste
sem rede: `node tests/verify_whatsapp_box.js` (o supabase-js é substituído por um stub).

## Notação matemática e química em Unicode, em todas as áreas (v16 / generate-question v71)

Expoentes, índices, raízes e sinais chegam ao estudante prontos — x², 2⁴, 10⁻³, Q₀, aₙ, 2ˣ,
4,6 × 10⁹, H₂SO₄ — nos três destinos (tela, Word, PDF). Nunca LaTeX nem `^`/`_`. Três camadas:

1. **Prompt**: os blocos `NOTACAO_QUIMICA` e `NOTACAO_MATEMATICA` (`recurso_instrucoes.ts`)
   entram no prompt do sistema de **todas** as áreas (até a v70 a química só entrava em
   Natureza e a Matemática não recebia regra nenhuma — daí `Q0`, `2^4`, `10^9`).
2. **Rede de segurança determinística**: `notacao_quimica.ts` (lista fechada de fórmulas; fora
   de Natureza só as neutras, sem gases nem íons) e `notacao_matematica.ts` (só padrões
   inequívocos: `x^2`→x², `10^-3`→10⁻³, `2^(n-1)`→2ⁿ⁻¹, `Q_0`→Q₀, `Q0`→Q₀ quando encostado em
   operador em oração com "=", `m2`→m², `4,6 x 10^9`→4,6 × 10⁹, `S0 . 1`→S₀ · 1). O que for
   ambíguo (`2^(-t/T)`) fica e é apontado pela verificação do app. Raiz quadrada sai com a
   barra sobre todo o radicando (`√1000` → √1̅0̅0̅0̅, combinante U+0305 em cada caractere); no PDF
   cada par vira um glifo pré-composto da fonte (U+E100…), para a barra ir exatamente do √ ao
   fim do radicando. O núcleo JavaScript é o
   MESMO no backend e em `src/app.js` (entre as marcas `NM-INÍCIO`/`NM-FIM`), testado pelos
   mesmos casos: `node nm/testa_core_node.js` e `deno run --allow-read nm/testa_core_deno.ts`.
2b. **Revisor de notação (LLM, `review-math-question` v5)**: quando ainda sobra `^`, `_`, "sqrt(",
   letra x como × ou índice com várias letras (`V_cone`) depois da rede determinística — caso
   típico: expoente com fração, `2^(t/3)` —, a `generate-question` (v72, todas as áreas) chama o
   revisor, que reescreve SÓ os campos afetados com as regras oficiais de notação (variável
   auxiliar: `2ⁿ, em que n = t/3`), renormaliza e aceita campo a campo (só se reduziu os resíduos,
   preservou todos os números e o tamanho), até 2 tentativas, dentro do orçamento de tempo da
   função. Em Matemática o mesmo revisor continua auditando as contas com lastro nos livros.
   O prompt de geração também ganhou uma autoverificação obrigatória de `^`/`_` antes de entregar.
3. **App**: a normalização roda em toda questão que entra (backend, arquivo, refazer visual) —
   simulados arquivados antes da v16 saem corrigidos ao reabrir. A verificação por questão
   aponta `^`, `_`, LaTeX e letra x como × em todas as áreas. A fonte do PDF ganhou as letras
   sobrescritas/subscritas (`fontwork/ampliar_carlito.py`). Teste no navegador, sem rede:
   `node tests/verify_math_notation.js`.

## Reconstruindo o `index.html` após editar `src/`

```bash
cd src
python3 combine.py
```

## Publicando as Edge Functions em um novo projeto Supabase

1. Crie um projeto no [Supabase](https://supabase.com).
2. Publique as duas funções em `supabase/functions/` (via Supabase CLI ou dashboard).
3. Em **Project Settings → Edge Functions → Secrets**, adicione:
   - `ANTHROPIC_API_KEY` — sua chave da [Anthropic](https://platform.claude.com).
   - `OPENAI_API_KEY` — sua chave da [OpenAI](https://platform.openai.com).
   - (opcionais) `ANTHROPIC_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`,
     `MAX_DAILY_QUESTIONS`, `MAX_DAILY_IMAGES`.
4. Atualize as constantes `QUESTION_BACKEND_URL` e `IMAGE_BACKEND_URL` no topo de
   `src/app.js` com a URL do seu próprio projeto Supabase, e rode `combine.py` de novo.

## Segurança

Nenhuma chave de API, senha ou token está neste repositório. As funções de backend
(`supabase/functions/`) só funcionam com as chaves configuradas como *secrets* no projeto
Supabase de quem as publica — nunca commitadas em código.
