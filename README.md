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

## Conteúdos de uma disciplina gerados como outra (v18.4, 15/09/2026)

O professor digitou sete conteúdos de **Química** — Radioatividade, Tabela Periódica, Modelos
Atômicos, Funções Orgânicas, Reação de Esterificação ou Saponificação, Propriedades Coligativas,
Polímeros — e o app gerou e cobrou as sete como **Matemática**, sem uma palavra. O cabeçalho saiu
`Matemática e suas Tecnologias · Matemática · 7 questão(ões)`.

**Causa de raiz, reproduzida em navegador real:** o botão "← Novo simulado" (`btnBackToForm`)
chamava `renderQuestionBlocks()` e `sincronizaContadoresLote()`, mas **não** `renderAreaGrid()`
nem `renderDisciplinaChips()`. Quem abrisse um simulado arquivado de outra área e voltasse ao
formulário ficava com a grade de áreas e os chips de disciplina mostrando a seleção **anterior**,
enquanto `state.area`/`state.disciplina` já eram os do arquivo — e é o **estado** que vai para o
backend. Na reprodução: tela mostrando "🧬 Ciências da Natureza · Química", estado
`matematica/Matemática`, e as sete chamadas saindo como `matematica/Matemática`.

A correção tem duas pontas:

1. **A tela não pode divergir do estado.** `btnBackToForm` e `abrirSimuladoSalvo` passaram a
   chamar `renderAreaGrid()`, `renderDisciplinaChips()` e `atualizaOpcoesPorArea()`. Depois da
   correção, a mesma sequência mostra "📐 Matemática · Matemática" — o que o estado de fato tem.
2. **Rede de segurança antes de gastar.** `conteudosForaDaDisciplina()` compara os conteúdos
   digitados com marcadores de alta precisão por disciplina (Matemática, Química, Física,
   Biologia), reaproveitando `palavrasChaveTema` + `radicalPalavra` + `mesmaFamiliaDePalavra` —
   então plural, acento e flexão não atrapalham ("Funções Orgânicas" bate "funcao organica").
   O aviso só sai no caso indiscutível: **nenhum** conteúdo é da disciplina escolhida **e** a
   maioria (≥60%, mínimo 2) é claramente de **uma** outra. Disciplina sem marcadores nunca acusa.
   E ele **não bloqueia de vez**: para a primeira tentativa, explica, e o segundo clique em
   "Gerar" manda assim mesmo — uma questão de Matemática ambientada em Química é legítima.

Mensagem entregue no caso real: *"Você selecionou Matemática, mas nenhum dos 7 conteúdos é de
Matemática — todos parecem de Química. Confira a área e a disciplina acima. Se for mesmo o que
você quer, clique em 'Gerar' de novo."*

Verificação: `tests/verify_disciplina_conteudo.js` (13 asserções) cobre a divergência tela/estado,
o caso real (0 chamadas pagas no primeiro clique, 7 no segundo), e a ausência de falso positivo em
Matemática, Química, Biologia, lista mista e disciplina sem marcadores. A classificação foi medida
em 33 conteúdos reais das quatro disciplinas: **0 classificações erradas**.

## Ligação orgânica escrita como carga (v74.4, 15/09/2026)

Defeito relatado pelo professor: a ligação da amida, do éster e do carbonato chegaram como
`⁻NH⁻CO⁻`, `⁻CO⁻O⁻` e `⁻O⁻CO⁻O⁻` — com o **menos sobrescrito** (U+207B), que é o sinal de
**carga**, no lugar do **travessão de ligação** (U+2013). Lido assim, cada traço vira uma carga
negativa: quimicamente falso, e impresso na prova do aluno.

**Não foi regressão do deploy da v74.3.** Os quatro módulos de notação (`notacao_quimica.ts`,
`notacao_matematica.ts`, `recurso_instrucoes.ts`, `app_data.json`) são **byte a byte idênticos**
entre os commits `a29642a2` (v74.2) e `95dbbd23` (v74.3), e o diff do `index.ts` entre as duas
versões (6 blocos, 165 linhas) **não toca uma única linha** de notação, química, ligação,
sobrescrito ou carga. O que havia era uma lacuna que ninguém tinha coberto ainda.

Por que acontecia: a seção CARGAS do prompt mostra `⁻` **nove vezes** colada numa fórmula
(`Cl⁻`, `OH⁻`, `NO₃⁻`, `SO₄²⁻`, `CO₃²⁻`, `PO₄³⁻`, `MnO₄⁻`, `Cr₂O₇²⁻`, `[Fe(CN)₆]⁴⁻`), enquanto a
seção ORGÂNICA era **a única do bloco sem uma lista "NUNCA"** — ÍNDICES, CARGAS e SETAS todas
têm a sua — e sem nenhum exemplo de ligação **solta na ponta**: os exemplos (`CH₃–CH₃`,
`CH₃–CO–CH₃`) têm grupo dos dois lados, e os casos que falharam são justamente os de grupo
funcional com a ligação livre. Nada cobria isso: nem prompt, nem normalizador, nem auditoria do
app, nem teste.

A correção tem duas pontas:

1. **Rede de segurança determinística** (`qnLigacaoOrganica`, em `notacao_quimica.ts`, rodando
   para **todas** as disciplinas antes da tabela — a amida aparece em Biologia tanto quanto em
   Química). A regra: um `⁻` seguido **imediatamente de letra** é ligação, porque uma carga nunca
   é seguida de letra — ela encerra a espécie (`Cl⁻ `, `SO₄²⁻(aq)`, `e⁻`, `β⁻`). Identificado o
   fragmento, todos os `⁻` dele viram `–`, inclusive o da ponta, que sozinho seria indistinguível
   de carga. Expoentes matemáticos não são tocados: em `10⁻³`, `2⁻ⁿ` e `2ⁿ⁻¹` o `⁻` é seguido de
   sobrescrito, não de letra.
2. **Regra no prompt**: a seção ORGÂNICA ganhou a lista de grupos com ligação solta
   (`–NH–CO–`, `–CO–O–`, `–O–CO–O–`, `–OH`, `–COOH`, `–NH₂`, `–CHO`, `–SO₃H`) e o "NUNCA"
   explícito contra o menos sobrescrito.

Verificação: 56 asserções — os 5 casos do defeito consertados no pipeline real (química →
matemática, 5 passadas, idempotente), 11 cargas reais e 5 expoentes intactos, e **0 alterações**
nos 727 campos de texto das 20 questões reais das fixtures. A chave `ligacaoOrganica` do
`GET ?selftest=1` prova, em produção, que a correção está no ar.

## Diversidade de exemplos em levas, sem custo (v17 / generate-question v73; v18 / v74; v18.2 / v74.2; v18.3 / v74.3)

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

10. **Paridade das alternativas (v18.3 / generate-question v74.3)**: no teste real de 15/09 (10
   questões de Biologia, `tests/fixtures/teste_real_v74_2/`) nenhuma questão saiu com as
   alternativas ordenadas da mais curta para a mais longa, e em 5 das 10 a correta era a mais
   longa — na questão 7 com 261 caracteres contra 199 da segunda, na 10 com 245 contra 184. Não
   era regressão: nas levas de Matemática o defeito não aparecia porque 7 de 10 questões têm
   alternativas numéricas, curtas e já ordenadas. A causa estava na estrutura do prompt: a única
   menção ao tamanho e à ordem das alternativas vivia dentro de `buildGabaritoAlvo` (prompt do
   usuário), em itens de um bloco cujo título fala da LETRA do gabarito, e citava uma "regra 4.4"
   **que não existe em nenhum texto do prompt**. Pior: com a letra fixada pelo app, exigir ordem
   por tamanho é contraditório — com gabarito A a correta teria de ser a mais curta; com E, a mais
   longa, que é justamente o que o Guia proíbe.
   A correção move a regra para o bloco FIXO do prompt do sistema (`buildRegraAlternativas`,
   cacheado) e troca a ênfase de "ordenar por tamanho" para **paridade**: as cinco com a mesma
   extensão (a mais longa até ~1,25× a mais curta), a correta nunca se destacando por tamanho (no
   máximo 25% ou 25 caracteres acima da segunda mais longa — a mesma tolerância que a auditoria do
   app usa), e uma forma única para as cinco (uma oração cada, sem segundo período e sem explicação
   emendada no fim), que é o que produz a paridade na hora de escrever. Com paridade, a ordem por
   tamanho deixa de entregar a resposta e deixa de brigar com a letra reservada. `buildGabaritoAlvo` perde a referência morta e passa a dizer que a letra não
   autoriza quebrar a paridade. Custo: o texto novo (≈436 tokens) vive no bloco cacheado e o prompt
   por questão cresce ≈57 tokens — o saldo real é cerca de **+US$ 0,0003 por questão**, mais uma
   regravação de cache (~US$ 0,02) na primeira chamada de cada combinação depois do deploy. Não é
   economia: é o preço de a regra passar a existir nas duas pontas.
   **Escopo (revisão de 15/09, antes da publicação):** a paridade e o teto de tamanho valem para
   alternativas de **TEXTO**. Os itens 1, 4 e 5 já vinham marcados assim; o item 2 ("o gabarito não
   pode se denunciar") e o item 4 do bloco do gabarito não vinham, e lidos ao pé da letra mandariam
   igualar o número de caracteres de "R$ 12,50" e "R$ 1.234.567,89" — isto é, distorcer os VALORES,
   que é o que o item 3 proíbe. Os dois ganharam a marca de escopo e uma frase para numéricas ("em
   numéricas o tamanho do número é irrelevante; manda a ordem crescente"), e o passo 2 do bloco do
   gabarito passou a separar os dois casos: em texto reescreve-se a **redação** dos distratores, em
   numéricas escolhem-se outros **valores** — a ordem crescente nunca cede à letra. O selftest
   (`regraAlternativas`) passou a exigir essas marcas.
   No app, a auditoria local ganhou dentes: o critério anterior (correta acima de 1,6× a **média**
   das outras) **nunca disparava** — nas 20 questões reais das duas levas o maior valor observado
   foi 1,42. Agora a comparação é com a **segunda maior** — mais de 1,25× **ou** pelo menos 25
   caracteres de diferença, razão ou margem e não as duas juntas, senão 500 contra 404 caracteres
   escaparia por ser "só" 1,24× — e há uma observação separada quando as cinco ficam desiguais
   (mais de 1,30× entre a maior e a menor: 1,25× é a paridade que o prompt pede, 1,30 é ela com
   tolerância). Nas mesmas 20 questões o alerta sai exatamente nas duas em que o gabarito se
   denuncia (Bio q07 e q10) e a observação na única que a merece (Bio q04, de 76 a 102 caracteres),
   sem nenhum falso positivo. O corte limpo passou a valer também para `habilidade`
   do recorte (`cortaLimpo`, 240 caracteres: as 120 habilidades oficiais cabem inteiras; com o teto
   antigo de 200 cinco eram cortadas, e duas chegaram assim no teste real de 15/09 — "…relações
   matem", "…físicos ne") e para `conteudo`, este com uma guarda própria (`cortaConteudo`): recuar
   até o último fim de frase é bom para a habilidade, mas no `conteudo` — que é a linha que
   diferencia um recorte do outro — um ponto final logo depois da metade do limite decepava a
   segunda frase (medido: 120 caracteres entregues de um teto de 200). A guarda só aceita o corte
   por frase quando ele preserva pelo menos 85% do limite; abaixo disso cai no corte por palavra
   inteira. Nos 10 recortes reais de 15/09 o campo tinha de 43 a 82 caracteres e nenhum dos dois
   caminhos chega a disparar — a guarda é para o caso que ainda não apareceu.
   Por que a regra fixa a forma em vez de mandar conferir no fim: o modelo entrega a questão numa
   única chamada de ferramenta, sem rascunho — quando escreve a alternativa E, as outras quatro já
   são texto comprometido, então "conte os caracteres antes de entregar" não é executável (foi
   exatamente esse tipo de instrução que a v74.2 tinha e que as 10 questões ignoraram). O escopo é sempre **alternativas de texto**: em numéricas manda a
   ordem crescente, e os valores dos distratores (que carregam o erro de raciocínio de cada um)
   nunca podem ser mexidos para acertar tamanho — sem essa ressalva a regra estragaria Matemática,
   onde 7 de 10 questões têm alternativas numéricas de 1 a 10 caracteres.
   Duas limitações conhecidas, registradas de propósito: `aplicaGabaritoAlvo` (app) troca duas
   alternativas de lugar quando a letra entregue erra o alvo, o que pode desfazer a ordem por
   tamanho — a ordem de alternativas de texto é best-effort e nenhum teste a exige (a paridade não
   é afetada, porque a troca não muda os comprimentos); e `tests/verify_app.js` aponta para um
   artefato de 13/09 fora do repositório e falha por timeout desde então.
   Selftest: `planejamentoV74.regraAlternativas` e `corteHabilidade`.
   Teste: `node tests/verify_paridade_alternativas.js` — 13 verificações sobre as 20 questões reais
   (`fixtures/teste_real_v73` e `fixtures/teste_real_v74_2`) e sete casos de fronteira.

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
