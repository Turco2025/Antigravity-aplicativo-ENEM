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

## Diversidade de exemplos em levas, sem custo (v17 / generate-question v73; v18 / v74; v18.2 / v74.2)

Problema real (leva 538678f0, 20 de Matemática sem tema, 14/09/2026): "fábrica de componentes
eletrônicos" com linhas A/B 60%/40% em duas questões, "transportadora" em três, "cooperativa
agrícola" em três, marcenaria e velas na mesma leva. Sem tema digitado só o eixo (objeto de
conhecimento) era reservado, e as 5 questões de cada onda paralela não se enxergam.

A correção é toda determinística, decidida no app ANTES da leva (como o gabarito e os eixos),
sem chamada nova à IA, sem campo novo na resposta e sem aumentar o prompt da leva:

1. **Subtópico oficial** (`SUBTOPICOS_OFICIAIS`, `planejaSubtopicos`): dentro de cada eixo,
   cada questão sem tema recebe um item do texto do Anexo da Matriz (ex.: "porcentagem e
   juros", "sequências e progressões"), em rodízio embaralhado. Matemática, Física, Química,
   Biologia e Humanas; Linguagens fica só com o eixo por disciplina.
2. **Domínio de contexto** (`DOMINIOS_CONTEXTO`, 61 cenários; `planejaDominios`): em
   Matemática e Ciências da Natureza, toda leva de 2+ questões recebe, por questão, um domínio
   principal e um alternativo, exclusivos dela. O backend (`buildDiversidadeTematica`) manda
   ambientar a situação-problema nesse domínio (ou, se não couber, só no alternativo). Nas
   levas com tema digitado, o planejamento de recortes (que já existia) recebe os domínios
   (`dominios`) para que os contextos dele caiam neles.
3. **Prompt do usuário não cresce na leva**: os temas entregues das outras questões só viajam
   quando podem colidir em conteúdo (mesmo eixo; ou outro grupo de tema), itens de 120
   caracteres, teto 40; com recorte planejado o bloco de domínio é omitido (o planejamento já o
   recebeu). Medido em `tests/medir_prompt_diversidade.ts`, leva de 20 de Matemática sem tema:
   61.905 caracteres (v73) contra 72.840 (v72), 15% menor; leva de 5 → 7% menor; leva de 2 →
   2% menor; leva de 1 → igual. Por questão: só a PRIMEIRA da leva cresce (+205 caracteres,
   ≈ 50 tokens, ≈ US$ 0,0001), as demais encolhem. Único caminho em que cresce por questão:
   temas digitados todos diferentes (grupos de 1, sem recorte), +≈330 caracteres cada.
4. **Auditoria de contexto sem IA** (`auditaDiversidadeContextos`, só Matemática e Natureza):
   o texto-base de cada questão é conferido contra as palavras-chave do catálogo (específicas
   de propósito — nada de "empresa", "motor", "bactéria", "reportagem"); duas questões no mesmo domínio
   geram alerta na auditoria local do cartão e o botão **"Outro contexto"**
   (`regenerarComOutroContexto`), que regenera SÓ aquela questão num domínio ainda não usado e
   com o cenário colidido proibido (`contextosEvitar`, `dominiosEvitar`). Nada é regenerado
   automaticamente. Simulados arquivados antes da v17 também são auditados ao abrir.

5. **Ajustes vindos do teste real** (10 × Matemática/Exponenciação contra o backend v73, em
   `tests/fixtures/teste_real_v73/`): (a) com o mesmo tema digitado, a auditoria de temas ignora
   também a família da palavra ("exponencial", "exponenciais" com "Exponenciação"), que
   aparecia em 9 dos 10 temas entregues e apontou como parecidas duas questões de exemplos
   diferentes (`mesmaFamiliaDePalavra`); (b) o leitor numérico das alternativas
   (`lerNumeroAlternativa`) passa a entender moeda na frente, milhar, fração, potência em
   sobrescrito, notação científica e escala ("1,2 milhão") — a rede de segurança do gabarito
   deixa de trocar de lugar alternativas em R$ já em ordem crescente, e a auditoria local do
   cartão passa a apontar "R$ 10.648,00 / R$ 10.400,00" fora da ordem e "2,5 km" × "2.5 km"
   como valor repetido (em listas híbridas "valor, pois justificativa" a ordem não é exigida;
   valor repetido vira observação); (c) "FONTE: elaborado para fins didáticos" no começo de
   uma linha conta como fonte.

6. **Tema do lote × tema das questões (v17.1)**: o que vai à IA é o tema guardado em cada
   questão, e a caixa "Tema do lote" só era copiada para elas ao clicar em "Aplicar" — uma
   edição posterior da caixa (ou esquecer o "Aplicar") gerava a leva com o texto antigo, sem
   aviso (leva 1eb71207). Agora, ao clicar em "Gerar", se a caixa tem texto diferente do último
   "Aplicar" e todas as questões estão com o mesmo tema (ou sem tema), o texto da caixa vale
   para todas, com aviso na tela; questões ajustadas uma a uma nunca são sobrescritas. O aviso
   do "Aplicar" e o cabeçalho dos resultados ("tema pedido: …") mostram o texto que foi usado.
   Teste: `node tests/verify_tema_lote.js` — 20 verificações. Ao reabrir um simulado salvo, a caixa passa a mostrar o tema dele.

7. **Vários conteúdos no "Tema do lote", distribuídos em rodízio (v18 / generate-question v74)**:
   o professor lista os conteúdos ("MDC, MMC, radiciação, exponenciação, grandezas" ou um por
   linha; ponto e vírgula também separa; "1,5" e vírgulas dentro de parênteses não) e, ao
   "Aplicar", cada questão recebe **um** conteúdo, na ordem digitada e recomeçando (1.º → q1,
   2.º → q2, …): 10 questões × 5 conteúdos dá 2 de cada, misturados. O campo de tema de cada
   questão mostra só o seu conteúdo (com a dica "distribuído do lote"), o painel mostra
   "MDC → 1, 6 · MMC → 2, 7 · …", e o professor pode trocar qualquer um. Mais conteúdos do que
   questões: os últimos ficam de fora, com aviso. A lista fica guardada em `temaLote` (nome do
   simulado, cabeçalho, caixa ao reabrir). Ao "Gerar", as questões da mesma lista continuam
   formando **um** pedido ao planejador, que recebe `temasPorQuestao` e detalha o recorte
   dentro do conteúdo fixado de cada número (backend v74; o prompt sem lista é idêntico ao v73);
   o app confere cada recorte (`recorteRespeitaItem`: item inteiro no texto, ou maioria das
   palavras e nenhum outro item do grupo pontuando mais) e descarta o que sair do conteúdo —
   com um backend antigo a questão segue só com o seu conteúdo e o domínio. Custo por leva:
   o mesmo número de chamadas; os prompts de geração ficam menores (tema = um conteúdo, e os
   conteúdos irmãos não viajam como "assuntos a evitar" quando há recorte). Atenção: um tema
   único descritivo que contenha vírgula ("Funções do 1.º e 2.º graus, gráficos") agora vira
   dois conteúdos — o aviso do "Aplicar" e o painel mostram a divisão; use travessão ou "e".
   Teste: `node tests/verify_lote_itens.js` — 48 verificações. No teste real de 15/09 o planejador criou um recorte a mais e deslocou os seguintes; por isso o app casa cada recorte com a sua questão pelo conteúdo (posição → número declarado → conteúdo com contexto no domínio → conteúdo), e o backend (v74.1) lista os conteúdos um por linha, pede o campo `numero` e devolve até 2 recortes extras.

8. **"Editar" numa questão já gerada respeita o tema novo (v18.2)**: o recorte planejado da leva
   (conteúdo · contexto · habilidade) pertence ao tema que a questão tinha quando a leva foi
   planejada, e o backend manda o modelo segui-lo. Se o professor troca o tema no painel
   "Editar" e clica em "Salvar e gerar novamente", o recorte antigo é descartado e o texto dele
   manda (o domínio de contexto reservado continua, só como cenário). Sem isso, o modelo seguia o
   recorte antigo e a edição parecia ignorada — caso real de 15/09/2026 (Biologia, questão 10:
   "Ciclo do nitrogênio…" voltou como "Ciclo do carbono…"). Tema igual (espaços, maiúsculas e
   acentos não contam) mantém o recorte — só sem a habilidade sugerida quando o professor escolhe
   competência/habilidade no painel. O "Salvar e gerar novamente" passa a usar o mesmo caminho de
   "Regenerar": espera a imagem e regrava o simulado em "Meus Simulados" (antes a questão editada
   não era regravada e voltava à versão antiga ao reabrir). Guardas extras: cada recorte guarda o tema para o qual foi planejado (`recorteTema`) e só
   viaja enquanto a questão tiver esse tema — vale para "Regenerar"/"Mais fácil"/"Mais difícil"
   nos simulados gerados a partir desta versão (um simulado antigo não tem `recorteTema` e o
   recorte é aceito como está; se ele estiver descasado por uma edição feita na versão anterior,
   "Editar" com o tema alterado o descarta); e, para a questão com tema trocado no painel
   (`temaEditado`), os temas digitados das outras não viram "assunto proibido" (só os entregues —
   se outra questão já entregou algo próximo do tema novo, ela continua na lista, para não sair
   questão duplicada). Teste: `node tests/verify_editar_questao.js` — 21 verificações (no app
   anterior 11 falham, entre elas as que reproduzem o defeito).

9. **Contexto do planejador × domínio reservado, e contexto sem corte no meio da frase (v18.2 /
   generate-question v74.2)**: no teste real de 15/09 (10 × "MDC, MMC, radiciação, exponenciação,
   grandezas") o contexto da questão 8 — "um fotógrafo … a área impressa" — foi descartado pelo app
   porque as palavras do domínio "fotografia e impressão" eram só "fotografia", "impressora",
   "pixel", e a checagem reserva comparava o singular exato. Agora o domínio tem "fotograf"
   (prefixo: fotografia, fotógrafo, fotográfica) e uma lista `kp` usada SÓ por essa checagem
   (`contextoRespeitaDominio`): "impresso", "impressa". A auditoria de contextos repetidos
   (`dominioBateNoTexto`) continua usando só `k` — palavras comuns não podem entrar lá, senão
   "relatório impresso" criaria colisões falsas. Uma família genérica de palavras foi testada e
   descartada na revisão: "família" ~ "familiar", "pessoas" ~ "pessoais", "informações" ~
   "informática" abririam quase todos os domínios. No backend, o contexto do recorte era cortado em 250 caracteres onde
   caísse (duas frases da leva foram para o prompt terminando em "…uma situação em qu"); o prompt do
   planejador agora pede contextos de até 200 caracteres e, se passar, `cortaLimpo` corta no último
   fim de frase (pontuação seguida de espaço no texto original — "3.400 sacas" não conta) depois da
   metade do limite, ou no último espaço, com teto 320; os tetos do recorte
   inteiro subiram de 600 para 800 (app e backend) para nada ser cortado de novo na montagem.
   Selftest: `planejamentoV74.contextoCurto` e `corteLimpo`. Testes: `verify_lote_itens.js` (H1–H4).

Testes: `node tests/verify_diversidade.js` (catálogo, reservas, corpos enviados, auditoria com
as duas levas reais em `tests/fixtures/`, frases típicas de Física/Biologia, Humanas, leva mista, simulado antigo, botão, leitor numérico) — 49 verificações; `node tests/teste_real_fase_d.js` roda o app inteiro com as 10 questões reais. Ordem de publicação: backend v73 antes do app v17 (o app novo já encurta a lista de assuntos contando com o subtópico/domínio).

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
