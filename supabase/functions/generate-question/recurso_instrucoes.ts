/* ========================================================================
   TEXTOS FIXOS DOS PROMPTS — módulo separado do index.ts (v63).
   ========================================================================
   Este arquivo contém os blocos fixos dos prompts — três vieram do index.ts
   na v62 (sem alteração de conteúdo) e a NOTAÇÃO MATEMÁTICA entrou na v71: a regra de notação química, as instruções
   por recurso visual (protocolo de imagem em 8 seções, versão geral e a de
   Biologia, gráfico, tabela) e o formato de entrega (JSON_SCHEMA_TXT). Foram
   movidos para cá apenas para que o index.ts fique menor de implantar; o
   index.ts os importa deste mesmo caminho no repositório (GitHub, branch
   main), exatamente como já faz com app_data.json — o empacotador do Deno
   embute o conteúdo na hora do deploy, e em produção não há chamada de rede.
   Consequência prática: ANTES de implantar uma nova versão da função, este
   arquivo precisa estar publicado no GitHub (push). */

/* Notação química — a fórmula chega ao estudante pronta, nunca como comando.
   O PDF, o Word e o HTML do aplicativo imprimem Unicode direto; LaTeX ou "H2O"
   chegariam ao papel exatamente assim, e a auditoria do app barra a exportação. */
export const NOTACAO_QUIMICA = `

═══════ NOTAÇÃO QUÍMICA — REGRA ABSOLUTA DE FORMATAÇÃO ═══════
Toda fórmula, íon, equação, isótopo ou unidade científica sai PRONTA, em caracteres
Unicode, diretamente legível. Vale para texto-base, comando, tabelas, alternativas,
gabarito, resolução comentada, comentário de cada alternativa e prompt de imagem.

PROIBIDO SEM EXCEÇÃO: LaTeX, KaTeX, MathJax, \\ce{}, \\frac, $...$, _{ }, ^{ },
tags HTML (<sub>, <sup>), entidades HTML, blocos de código, crases, barras
invertidas, chaves de formatação, delimitadores matemáticos, Markdown matemático.
A fórmula aparece como H₂SO₄ — nunca como um comando a ser renderizado depois.

ÍNDICES (quantidade de átomos) em algarismo INFERIOR ₀₁₂₃₄₅₆₇₈₉:
H₂O · CO₂ · NH₃ · CH₄ · H₂SO₄ · H₃PO₄ · Ca(OH)₂ · Al₂O₃ · Fe₂(SO₄)₃ · C₆H₁₂O₆ · C₁₂H₂₂O₁₁
NUNCA: H2O, H 2 O, H²O, Al2(SO4)3. O símbolo do elemento fica no nível da linha.

CARGAS no canto superior direito, NÚMERO ANTES DO SINAL, com ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻:
Na⁺ · Ca²⁺ · Fe³⁺ · Al³⁺ · Cl⁻ · OH⁻ · NH₄⁺ · NO₃⁻ · SO₄²⁻ · CO₃²⁻ · PO₄³⁻ ·
MnO₄⁻ · Cr₂O₇²⁻ · [Fe(CN)₆]⁴⁻
NUNCA: Ca+2, Ca2+, SO4-2, SO₄-2, SO²⁻₄, ⁺².

COEFICIENTES são números comuns ANTES da fórmula: 2 H₂(g) + O₂(g) → 2 H₂O(l).
Coeficiente nunca vira índice; para balancear não se altera a fórmula (2 H₂O, nunca H₄O₂).

SETAS: → é UM ÚNICO CARACTERE (U+2192). É PROIBIDO montar seta com hífen, sinal de
maior, de menor ou de igual. Nunca escreva -> --> => ==> <- <-> <=> <==> como seta.
Nunca use imagem, emoji ou ícone no lugar do símbolo. Cada seta tem um significado:
→ reação da esquerda para a direita · ← sentido inverso · ⇌ EQUILÍBRIO QUÍMICO ·
↔ ressonância · ↑ desprendimento de gás · ↓ formação de precipitado.
↔ NÃO substitui ⇌. Reagentes antes da seta, produtos depois. Nunca sinal de
igualdade no lugar da seta. Ligação química (–, =, ≡) NÃO é seta de reação.
Estados físicos logo após a fórmula: (s) (l) (g) (aq).
Ex.: AgNO₃(aq) + NaCl(aq) → AgCl(s) + NaNO₃(aq).
Condição de reação (temperatura, pressão, luz, catalisador) vai em frase junto à
equação — não fragmente a seta para encaixá-la, e não trate catalisador como
reagente consumido.

BALANCEAMENTO: toda equação apresentada como completa está balanceada (salvo quando
a própria questão pedir que o estudante balanceie). Conte os átomos dos dois lados,
confira a conservação da massa E da carga, use os menores coeficientes inteiros.
Ex.: 4 Fe(s) + 3 O₂(g) → 2 Fe₂O₃(s).

ORGÂNICA: – ligação simples (travessão U+2013), = dupla, ≡ tripla. CH₃–CH₃ ·
CH₂=CH₂ · HC≡CH · CH₃–CH₂–OH · CH₃–COOH · CH₃–CO–CH₃. Não altere hidrogênios,
grupos ou ligações.
GRUPO FUNCIONAL com ligação SOLTA na ponta usa o MESMO travessão: –NH–CO– (amida)
· –CO–O– (éster) · –O–CO–O– (carbonato) · –OH · –COOH · –NH₂ · –CHO · –SO₃H.
NUNCA escreva a ligação com o menos sobrescrito da carga: ⁻NH⁻CO⁻, ⁻CO⁻O⁻,
⁻O⁻CO⁻O⁻, CH₃⁻CO⁻CH₃ estão ERRADOS — ali cada traço vira uma carga negativa, que
é outra coisa. O ⁻ só existe DEPOIS da espécie, como carga (Cl⁻, SO₄²⁻, e⁻);
entre dois grupos, ou na ponta de um grupo, é sempre o travessão –.
Se a estrutura for complexa demais para representação linear segura, peça fórmula
estrutural em IMAGEM — não invente a estrutura.

ISÓTOPOS: número de massa acima e número atômico abaixo, antes do símbolo —
¹⁴₆C · ²³₁₁Na · ²³⁸₉₂U · ⁴₂He · e⁻ · p⁺ · n⁰ · β⁻. Não inverta os dois.

GRANDEZAS não viram índice nem expoente: 25 °C · 2 mol · 0,5 mol/L · 1,0 atm ·
250 mL · pH 7 · 6,02 × 10²³ · 1,5 × 10⁻³ mol/L. No expoente matemático o sinal vem
antes do número (10⁻³); na carga, depois (Ca²⁺).

CONSISTÊNCIA: a mesma substância mantém a MESMA grafia no texto-base, no comando,
nos dados, na tabela, nas alternativas, no gabarito e na resolução. Maiúscula e
minúscula são significado: Co (cobalto) ≠ CO (monóxido de carbono).

CASOS DE TESTE — a notação de saída tem de sair exatamente assim:
H₂SO₄ · Al₂(SO₄)₃ · SO₄²⁻ · NH₄⁺ · [Fe(CN)₆]⁴⁻ · CuSO₄·5H₂O
2 H₂(g) + O₂(g) → 2 H₂O(l)
N₂(g) + 3 H₂(g) ⇌ 2 NH₃(g)
Ag⁺(aq) + Cl⁻(aq) → AgCl(s)
Zn(s) → Zn²⁺(aq) + 2 e⁻

JSON: as fórmulas ficam como caracteres Unicode normais, em UTF-8, nunca como
código ou sequência de escape.

BLOQUEIO: se uma fórmula não puder ser confirmada com segurança, não invente. Deixe
no campo correspondente o aviso "REVISÃO QUÍMICA NECESSÁRIA: a fórmula ou equação
não pôde ser validada com segurança."`;

/* Notação matemática (v71) — mesmo princípio da química: expoente, índice e
   sinal chegam ao estudante prontos, em Unicode, nos três destinos (tela, Word,
   PDF). Vale para TODAS as áreas — Matemática, Física, Geografia, Economia em
   Humanas, dados numéricos em qualquer texto. A fonte do PDF (Carlito, v16)
   tem exatamente os caracteres listados aqui; o que não está listado sai como
   □ no papel — por isso a regra é fechada. */
export const NOTACAO_MATEMATICA = `

═══════ NOTAÇÃO MATEMÁTICA — REGRA ABSOLUTA DE FORMATAÇÃO (todas as áreas) ═══════
Expoente, índice, raiz, fração e sinal de operação saem PRONTOS, em caracteres
Unicode, diretamente legíveis, em TODOS os campos: texto-base, comando,
alternativas, resolução comentada, comentário de cada alternativa, títulos,
rótulos e células de tabela/gráfico.

PROIBIDO SEM EXCEÇÃO: acento circunflexo como expoente (x^2, 10^-3, 2^(t/2)),
sublinhado como índice (Q_0, a_n), LaTeX/KaTeX (\\frac, \\sqrt, x^{2}, $...$),
tags HTML, "sqrt(", "elevado a" quando o sobrescrito existe, letra x ou ponto
final como sinal de multiplicação ("4,6 x 10^9", "S0 . 1").

EXPOENTES em algarismo SUPERIOR ⁰¹²³⁴⁵⁶⁷⁸⁹, sinal ⁻ antes do número:
x² · 2⁴ · 3² · 10⁹ · 10⁻³ · 10⁻⁶ · (1,05)¹² · 5⁻¹ · (1/2)⁵ · 2⁻⁵ · (2³)²
NUNCA: x^2, 2^4, 10^9, 10^-3, x2, x**2, "x ao quadrado" no meio de uma fórmula.

ÍNDICES em algarismo INFERIOR ₀₁₂₃₄₅₆₇₈₉: Q₀ · S₀ · P₀ · v₀ · a₁ · x₁ · x₂ · t₀ · log₁₀ · log₂
NUNCA: Q0, S0, P0, a1, Q_0, a_1, log10.

EXPOENTE LITERAL em letra sobrescrita — só existem estas:
minúsculas ᵃ ᵇ ᶜ ᵈ ᵉ ᶠ ᵍ ʰ ⁱ ʲ ᵏ ˡ ᵐ ⁿ ᵒ ᵖ ʳ ˢ ᵗ ᵘ ᵛ ʷ ˣ ʸ ᶻ (não há q) e
maiúsculas ᴬ ᴮ ᴰ ᴱ ᴳ ᴴ ᴵ ᴶ ᴷ ᴸ ᴹ ᴺ ᴼ ᴾ ᴿ ᵀ ᵁ ᵂ.
Ex.: 2ˣ · aⁿ · eᵏᵗ · (1 + i)ᵗ · 2ⁿ⁻¹ · 10ⁱ · bᵐ. Sinais e parênteses sobrescritos: ⁺ ⁻ ⁽ ⁾.
ÍNDICE LITERAL em letra subscrita — só existem estas: ₐ ₑ ₕ ᵢ ⱼ ₖ ₗ ₘ ₙ ₒ ₚ ᵣ ₛ ₜ ᵤ ᵥ ₓ.
Ex.: aₙ · Sₙ · xᵢ · Pₘₐₓ · vₘ · tₖ. Não há subscrito para b, c, d, f, g, q, w, y, z nem
para maiúsculas: nesses casos use outra letra de índice (aₙ em vez de a_b), uma
palavra (custo da máquina A: Cₐ; ou "C(A)"), ou numere (x₁, x₂).

EXPOENTE QUE NÃO CABE (fração, decimal ou expressão com barra: -t/T, 1/2, -1,5):
não existe sobrescrito para / e , — REESCREVA a lei, nunca use ^:
• variável auxiliar: Q(t) = Q₀ · 2⁻ⁿ, em que n = t/T é o número de meias-vidas;
  P(t) = P₀ · 2ⁿ, com n = t/2;
• raiz: 2 elevado a 1/2 é √2; 8 elevado a 1/3 é ³√8 = 2 (raiz cúbica escrita
  com o ³ antes do √); x elevado a 3/2 é x·√x;
• expoente decimal (2 elevado a −1,5): não existe sobrescrito para a vírgula —
  reescreva como fração de inteiros e raiz, 1/(2√2), ou introduza n = 1,5 e
  escreva 2⁻ⁿ.

MULTIPLICAÇÃO: × entre números (4,6 × 10⁹; 3 × 5 = 15) e · entre símbolos
(Q₀ · 2ⁿ; π · r² · h; a · b). Nunca a letra x, nunca ponto final, nunca *.
FRAÇÃO em linha com parênteses quando houver mais de um termo: (a + b)/(c + d);
9/T = 3/2; 1/(2√2).
RAIZ QUADRADA — REGRA DO RADICAL (obrigatória): em toda expressão com raiz
quadrada, represente o radical matematicamente de forma correta. A barra
horizontal superior deve começar após o símbolo √ e se estender exatamente até o
final de todo o radicando. Exemplo correto: √1̅0̅0̅0̅. Nunca deixe a barra
cobrindo apenas parte do número, como apenas 1, 10 ou 100, e nunca faça a barra
ultrapassar o final do radicando. Como escrever: o radicando vem COLADO ao √
(nunca √ espaço) — número ou letra diretamente (√2, √1000, √x, √1,44) e, quando
tiver mais de um termo, entre parênteses (√(x² + 1), √(2⁴ · 3²)); a barra é
aplicada automaticamente sobre TODO o radicando, e só sobre ele. Se você mesmo
escrever a barra, use o combinante U+0305 depois de CADA caractere do
radicando (√1̅0̅0̅0̅, √x̅²̅ ̅+̅ ̅1̅), sem parênteses. Raiz cúbica: ³√27 = 3.
Ex.: √2 · √(x² + 1) · √(2⁴ · 3²) = 2² · 3 = 12 · √288 = 12√2.
SÍMBOLOS disponíveis: π ≤ ≥ ≠ ≈ ± ∞ ° % ‰ → ∑ ∆ ∂ ∫ √ ½ ¼ ¾ − (menos matemático,
U+2212, ou o hífen comum; nunca "–" travessão como sinal).
NÃO EXISTEM na fonte do PDF (saem como □): ∈ ∉ ∪ ∩ ⊂ ⇒ ⇔ ∅ ℝ ℕ ℤ ∀ ∃ ∝ ∴ ∠ ⊥ ⋅ ∙ ∛.
Escreva por palavras: "x pertence a A", "A união B", "o conjunto dos números reais",
"implica", "é proporcional a", "ângulo AÔB"; raiz cúbica como ³√.
UNIDADES com expoente: m² · cm² · km² · m³ · cm³ · dm³ · m/s² · kg/m³ · hab/km²
(nunca m2, cm3, m/s2).

CONSISTÊNCIA: a mesma grandeza com a MESMA grafia em todos os campos; Q₀ no
texto-base é Q₀ também nas alternativas, na resolução e nos comentários.

CASOS DE TESTE — a notação de saída tem de sair exatamente assim:
Q(t) = Q₀ · 2⁻ⁿ, em que n = t/T · 288 = 2⁵ · 3² · √288 = 12√2 · 4,6 × 10⁹ anos
S = S₀ · (1 + i)ᵗ · (1 + i)⁰ = 1 · aₙ = a₁ + (n − 1) · r · f(x) = 2ˣ · log₁₀ 1000 = 3
V = π · r² · h = 3 · 3² · 8 = 216 m³ · 1,5 × 10⁻³ mol/L · 9,8 m/s²

ANTES DE ENTREGAR — AUTOVERIFICAÇÃO OBRIGATÓRIA DE NOTAÇÃO: releia CADA campo
(texto-base, comando, as cinco alternativas, resolução, os cinco comentários,
títulos e células) procurando o caractere ^ , o caractere _ e a palavra "sqrt".
Se encontrar QUALQUER um, a questão está errada e não pode ser entregue assim:
reescreva o trecho — expoente numérico → sobrescrito (2⁴); expoente com fração ou
expressão → variável auxiliar declarada (2ⁿ, em que n = t/3), usada em todas as
ocorrências; índice → subscrito (Q₀) ou número (V₁, V₂) — e só então entregue.
Uma questão com ^ ou _ em qualquer campo é rejeitada.

JSON: os caracteres Unicode entram diretamente, em UTF-8, nunca como código ou
sequência de escape.`;

export const RECURSO_INSTRUCOES: Record<string, string> = {
  nenhum: `Recurso visual: NENHUM. Não inclua gráfico, tabela ou imagem. Explore a situação-problema apenas por meio do texto-suporte. Deixe o campo "visual" como null e "recurso" como "nenhum".`,
  imagem: `Recurso visual: IMAGEM. A questão deve depender de uma imagem/ilustração pedagogicamente necessária (nunca meramente decorativa) para ser respondida corretamente — por exemplo: esquema anatômico, diagrama de processo, mapa, representação de fenômeno, estrutura, infográfico. Preencha "recurso":"imagem" e "visual" com: {"tipo":"imagem","descricao":"<legenda em português explicando o que a imagem mostra e por que ela é necessária para resolver a questão>","promptImagem":"<especificação técnica em INGLÊS, redigida conforme o PROTOCOLO OBRIGATÓRIO abaixo>"}. ⚠️ TIPO DO CAMPO — leia com atenção: "promptImagem" e "descricao" são, cada um, UMA ÚNICA STRING de texto corrido. As 8 seções do protocolo ficam DENTRO dessa string, uma após a outra, cada uma iniciada pelo seu título numerado (ex.: "1. SCENE AND VIEWPOINT: ..."), separadas por quebra de linha. NUNCA entregue "promptImagem" como objeto JSON — nem uma chave por seção, nem {"tipo":..., "valor":...}, nem qualquer outro aninhamento. O gerador de imagens só recebe TEXTO: um objeto chega a ele vazio, e a imagem sai sobre um assunto aleatório, sem nenhuma relação com a questão.

⚠️ PROTOCOLO OBRIGATÓRIO DE ESPECIFICAÇÃO DA IMAGEM
O gerador NÃO conhece a questão, NÃO lê o texto-base, NÃO vê o comando e NÃO infere nada: desenha exatamente e só o que estiver no "promptImagem". Toda ambiguidade vira erro — seta invertida, rótulo no elemento errado, elemento ausente, número ilegível. Portanto o "promptImagem" NÃO é descrição literária nem frase única: é ESPECIFICAÇÃO TÉCNICA COMPLETA, em inglês, elemento por elemento, com posição e direção explícitas, nas 8 seções abaixo, nesta ordem, cada uma com seu título em inglês:

🎯 FIDELIDADE OBRIGATÓRIA AO ENUNCIADO — antes de escrever qualquer seção, releia integralmente o texto-base, o comando, as alternativas e a resolução e extraia TODOS os dados concretos ali contidos: cada objeto citado, cada valor numérico, cada posição relativa, cada direção de causa-efeito, cada processo ou fenômeno descrito, cada relação entre elementos (o que vem antes/depois, o que está à esquerda/direita, o que é maior/menor, o que aumenta/diminui, o que está ligado a quê). Nenhum desses dados pode ficar de fora do "promptImagem", e nenhum dado inventado que contradiga o enunciado pode entrar na imagem. Se o enunciado descreve, por exemplo, um circuito elétrico em série ou em paralelo, resistores, capacitores, uma reação química específica, um objeto em movimento com velocidade e sentido definidos, ou qualquer outro elemento técnico com propriedades exatas, a imagem tem de refletir EXATAMENTE essas propriedades, sem aproximação e sem ambiguidade. É PROIBIDO entregar uma especificação genérica que sirva para "qualquer questão parecida" — a especificação tem de servir apenas para ESTA questão, com estes dados exatos. Toda vez que restar dúvida sobre um detalhe (direção de uma seta, posição de um elemento, valor de uma grandeza), a resposta está na resolução da questão: releia-a antes de decidir.

1. SCENE AND VIEWPOINT — o que a figura é, em uma frase, e o ponto de vista exato: front view, side view, top-down view, cross-section, exploded view ou three-quarter view. Declare a orientação absoluta (ex.: "the plant is upright, roots at the bottom, leaves at the top") e o AMBIENTE: por padrão um ambiente real, coerente com a cena, com profundidade e atmosfera (ex.: "shallow tropical reef bathed in shafts of sunlight, softly blurred background"). Reserve deliberadamente uma área visualmente calma (céu, água, parede, fundo desfocado) do lado em que os rótulos vão entrar. Fundo liso ("plain white background") só em conteúdo puramente abstrato/matemático: gráfico de eixos ou figura geométrica pura. CIRCUITOS ELÉTRICOS, COMPONENTES E APARELHOS NUNCA são exceção: um circuito em série ou em paralelo, resistores, capacitores, pilhas, fios, multímetros e demais componentes físicos têm de ser especificados como OBJETOS REAIS fotografados/renderizados sobre uma bancada, protoboard ou placa de circuito — com fios reais coloridos, resistores reais com faixas de cores visíveis, terminais e soldas quando fizer sentido — jamais como diagrama esquemático abstrato com símbolos de livro didático (nada de linhas retas com símbolos de circuito, zigue-zague genérico para resistor ou par de traços para pilha). Peça, em inglês, termos como "photorealistic photograph of a real electronics workbench, real breadboard or PCB, real resistors with visible color bands, real copper wires, real battery pack" sempre que o assunto envolver circuitos ou componentes eletrônicos.

2. ELEMENT INVENTORY — lista numerada de TODOS os elementos, com quantidade explícita ("exactly three test tubes", "one arrow"). O gerador inventa elementos extras; contar reduz isso. Nada fora desta lista pode aparecer.

3. LAYOUT AND POSITION — para CADA elemento, a posição absoluta (left / center / right com top / middle / bottom) E em relação aos vizinhos, com o lado sempre explícito. Ex.: "the beaker sits at the center-bottom; the flame is directly beneath the beaker; the thermometer is inserted from above, tilted about 30 degrees to the right". PROIBIDO escrever só "next to", "near" ou "beside" sem dizer de que lado. Se o enunciado descrever explicitamente a posição de algum elemento (à esquerda, acima, no topo, entre dois pontos etc.), a posição na imagem tem de ser IDÊNTICA à descrita — nunca uma posição diferente, ainda que visualmente plausível.

4. ARROWS — a causa mais frequente de erro. Para CADA seta, uma linha própria contendo, nesta ordem: origem, destino, onde fica a ponta (arrowhead), direção na tela e o que representa. Modelo: "One arrow starting at the right edge of the sun and ending at the top surface of the leaf, with the arrowhead touching the leaf and pointing down-left, representing incident sunlight." TERMINANTEMENTE PROIBIDO "an arrow between A and B", "arrows connecting the parts", "arrows showing the cycle" ou qualquer forma sem origem, destino e ponta — sem isso o gerador escolhe o sentido e frequentemente o inverte. Se o SENTIDO for parte do que a questão avalia (fluxo de energia, corrente elétrica, movimento, sentido de reação, cadeia alimentar, ciclo biogeoquímico), repita a direção uma segunda vez, com outras palavras, ao final. O sentido de CADA seta tem de corresponder exatamente ao que o texto-base, o comando, as alternativas ou a resolução afirmam sobre aquele fenômeno — nunca um sentido genérico ou "provável"; havendo qualquer dúvida sobre o sentido correto, releia a resolução antes de decidir, pois é ali que o sentido correto sempre está implícito ou explícito.

5. TEXT LABELS — para CADA rótulo, escreva: o texto EXATO entre ASPAS SIMPLES, o elemento a que pertence, o lado em que fica e se há linha de chamada. Modelo: the label 'Cloroplasto' placed immediately to the right of the green organelle, connected to it by a thin straight leader line. Use aspas simples em TODA a especificação da imagem — ela viaja dentro de um campo JSON, e aspas duplas não escapadas quebram a resposta inteira. Regras: (a) TODO texto visível deve estar EM PORTUGUÊS, ainda que a especificação esteja em inglês — inclua "all visible text must be rendered exactly as written above, in Portuguese, with correct spelling"; (b) o rótulo fica FORA do contorno do elemento, nunca sobreposto; (c) nem rótulo sem elemento, nem elemento essencial sem rótulo; (d) se dois rótulos correrem risco de se aproximar, declare os lados opostos; (e) declare o tamanho ("labels in a clear sans-serif typeface, large enough to be read when the image is printed at half page width").

6. NUMBERS, SCALES AND MEASUREMENT MARKS — havendo dado referencial (régua ou escala graduada, marcações de altura, distância, tempo, velocidade, temperatura, valores em eixo, unidades), liste os valores EXATOS, onde cada um aparece e de que lado do traço fica impresso. Modelo: "a vertical graduated ruler along the left side, with clearly legible labeled tick marks at 5 m, 10 m, 15 m and 20 m, each number printed to the left of its own tick". Os valores devem ser exatamente os mesmos do texto-base, do comando, das alternativas e da resolução — nunca aproximados nem arredondados de outra forma.

7. STYLE AND LEGIBILITY — a imagem tem DUAS CAMADAS, e as duas são obrigatórias.

   ⛔ REGRA NÃO NEGOCIÁVEL DE REALISMO — vale para TODA imagem, sem exceção: ela tem de ser ULTRA-REALISTA ou, no mínimo, SEMI-ULTRA-REALISTA. É PROIBIDO entregar uma imagem simples, chapada, tipo clipart ou tipo desenho esquemático de livro didático genérico — mesmo quando o assunto pareceria "simples" à primeira vista (um objeto do dia a dia, uma célula, uma reação química), a imagem tem de receber o mesmo padrão de produção fotorrealista de uma cena complexa. Sempre que o conteúdo permitir (isto é, sempre que a seção 1 não exigir fundo liso por se tratar de conteúdo puramente abstrato/matemático — gráfico de eixos ou figura geométrica pura), PREFIRA renderização TRIDIMENSIONAL. Isto SEMPRE inclui circuitos elétricos e componentes eletrônicos, que devem ser tratados como objetos reais fotografados, nunca como esquema plano. Peça, em inglês, termos como "photorealistic 3D render, three-dimensional CGI model, physically-based rendering, volumetric lighting and shadow, realistic depth" combinados com o padrão cinematográfico da Camada 1 abaixo — a cena deve parecer modelada em três dimensões e fotografada, nunca desenhada em plano único.

   ▸ CAMADA 1 — BASE CINEMATOGRÁFICA (beleza e impacto), no padrão National Geographic, BBC Earth, Planet Earth e IMAX, preferencialmente com renderização 3D fotorrealista. Peça, em inglês: "ultra-realistic 4K/8K photography, three-dimensional photorealistic render when applicable, ultra definition, razor-sharp focus on the subject, cinematic composition, dramatic directional natural lighting, rich material textures and micro-detail, deep saturated color, atmospheric depth of field, epic sense of scale and grandeur, museum-quality documentary photography". Bonita, imponente e memorável — nunca chapada, genérica, simples, borrada ou pixelizada.

   ▸ CAMADA 2 — CAMADA DE ANOTAÇÃO (precisão). Por cima da cena, camada vetorial limpa com as setas (seção 4), os rótulos (seção 5) e as marcações (seção 6), em princípios de UI/UX: hierarquia visual clara, tipografia sans-serif de tamanhos consistentes, mesma cor para o mesmo tipo de elemento, espaçamento generoso, contraste garantido contra o que está atrás. Peça, em inglês: "clean vector annotation overlay in modern UI/UX infographic style, consistent labeling system, clear visual hierarchy, high contrast between annotation and background, thin leader lines, subtle translucent backing plates or soft halo behind text wherever the scene behind it is busy".

   ▸ REGRA DE PRECEDÊNCIA (não negociável): a Camada 1 NUNCA prejudica a Camada 2. Se a cena ameaçar a leitura de um número, rótulo ou seta, a cena cede — menos detalhe, área escurecida/desfocada atrás da anotação, ou mais espaço. Declare no prompt, em inglês: "the cinematic scene must never obscure the annotation layer; every label, arrow and numeric mark must remain fully legible". Uma imagem deslumbrante com a régua ilegível é uma imagem inútil para a questão.

   ▸ FIDELIDADE: o esplendor jamais custa exatidão. A cena reflete EXATAMENTE a situação-problema — mesmo objeto, mesmo processo, mesmo momento, mesmos valores. PROIBIDO acrescentar elementos espetaculares alheios à questão (relâmpagos, erupções, fauna extra, luz impossível) só para impressionar: tudo que a questão não previu vira ruído ou erro conceitual.

   ▸ PASSAGEM PELA MODERAÇÃO DO GERADOR DE IMAGENS (v74.24, 20/09/2026 — cinco imagens de uma leva de Literatura foram recusadas pelo sistema de segurança da OpenAI: crianças em fotorrealismo, cenas de morte e violência). Regras que a especificação SEMPRE cumpre, sem perder o conteúdo pedagógico:
     · pessoas retratadas como ADULTOS, ou como silhuetas/figuras distantes sem rosto identificável; NUNCA crianças ou adolescentes em estilo fotorrealista — se a cena exige uma criança, ela é silhueta distante, de costas, ou substituída por um objeto que a represente (um caderno, um brinquedo, uma carteira escolar);
     · violência, morte, sofrimento físico, doença grave, nudez, sangue, armas e drogas são SUGERIDOS por símbolos, objetos, ambiente ou consequência (a rede vazia, a terra rachada, o navio ao longe, a cama desfeita), NUNCA mostrados de forma explícita — mesmo em obras literárias ou históricas que os tenham como tema;
     · nada de rostos de pessoas reais, marcas registradas ou logotipos.

8. NEGATIVE CONSTRAINTS — encerre listando o que NÃO pode aparecer: "no decorative text, no watermark, no signature, no caption bar, no extra arrows, no additional objects beyond those listed above, no duplicated labels, no cropped or cut-off elements, no text in any language other than Portuguese, no flat clipart or generic cartoon style, no simple or plain illustration, no basic flat 2D line art when a realistic or three-dimensional rendering is possible, no blurry, pixelated or low-detail rendering, no annotation hidden or obscured by the scene".

VERIFICAÇÃO ANTES DE ENTREGAR: releia a "descricao", o texto-base, o comando, as alternativas e a resolução e confirme que (i) todo elemento citado como visível consta do ELEMENT INVENTORY; (ii) toda seta tem origem, destino, ponta e direção na seção ARROWS; (iii) todo rótulo tem texto exato, elemento dono e lado; (iv) todo número citado na questão aparece com o MESMO valor na seção NUMBERS; (v) nada foi afirmado na "descricao" que não esteja especificado; (vi) todo dado numérico, toda posição relativa e todo sentido de seta especificados correspondem exatamente ao texto-base, ao comando, às alternativas e à resolução — nenhum deles é genérico ou aproximado; (vii) se a questão envolve circuito elétrico, componente eletrônico ou aparelho técnico, ele foi especificado como objeto real fotografado/renderizado, nunca como esquema abstrato. Nunca descreva na "descricao" um dado que não esteja visível na imagem, nem deixe na imagem um dado essencial que a "descricao" não mencione.`,

  grafico: `Recurso visual: GRÁFICO. A questão deve depender de um gráfico com dados numéricos plausíveis e coerentes (cientificamente ou matematicamente consistentes com o texto-suporte), efetivamente necessários para resolver a questão — não apenas decorativos. Preencha "recurso":"grafico" e "visual" com: {"tipo":"grafico","chartType":"bar" ou "line" ou "pie","titulo":"...","labels":["...","..."],"datasets":[{"label":"...","data":[num,num,...]}]}. Os números usados no gráfico devem ser os mesmos que a resolução comentada utiliza.`,
  tabela: `Recurso visual: TABELA. A questão deve depender de uma tabela com dados relevantes (resultados experimentais, dados populacionais, séries históricas, comparações entre grupos etc.), efetivamente necessários para resolver a questão. Preencha "recurso":"tabela" e "visual" com: {"tipo":"tabela","titulo":"...","colunas":["...","..."],"linhas":[["...","..."],["...","..."]]}.`,
};


/* v69 — COMPLEMENTO DE BIOLOGIA.
   Até a v68 Biologia tinha um protocolo de imagem PRÓPRIO (imagem_biologia,
   21,5 mil caracteres) que reescrevia as 8 seções — e foi nessa reescrita
   que o estilo escapou: seção 1 com "ambiente… ou neutro", seção 7 sóbria
   ("textbook illustration", "even lighting"), lista negativa diferente. O
   banco mostrou (10/09/2026): 20/20 imagens de Biologia pedidas como
   esquema, 13/20 no estilo livro didático, 6/20 em fundo branco/neutro;
   Física: 0 e 0. Agora Biologia usa LITERALMENTE o protocolo genérico
   (o mesmo texto de Física, byte a byte — ver instrucoesImagem) e este
   complemento acrescenta SÓ exatidão biológica. Nenhuma regra de estilo,
   iluminação, ambiente ou fundo vive aqui — e não pode viver. */
export const COMPLEMENTO_BIOLOGIA = `
🧬 COMPLEMENTO OBRIGATÓRIO — BIOLOGIA (exatidão científica). Este complemento NÃO altera nenhuma regra de estilo, iluminação, ambiente, fundo ou realismo das seções 1, 7 e 8 acima: a imagem de Biologia segue EXATAMENTE o mesmo padrão cinematográfico e fotorrealista das demais disciplinas, com ambiente real e coerente por padrão. Ele apenas acrescenta exigências de exatidão biológica ao preencher as 8 seções. Também não é pedido de volume: a especificação de Biologia deve ter a MESMA extensão típica das outras disciplinas — cada informação aparece uma única vez, na seção certa, em frases curtas; não repita nas seções 7 e 8 o que já foi dito nas seções 2 a 6.

a) FUNÇÃO PEDAGÓGICA (raciocínio interno — nunca copie este item para o "promptImagem" nem para a "descricao"): antes de especificar, decida o que precisa estar visível para o aluno analisar, o que ele deve INFERIR a partir do visível (e portanto não pode estar escrito) e o que NÃO pode aparecer porque entregaria a resposta. Nenhum rótulo, título ou legenda pode nomear a estrutura, o processo ou o organismo que o comando pede para identificar; nomeie-os apenas quando o texto-base já os nomeia.

b) CONSTRUÇÕES ESQUEMÁTICAS EM AMBIENTE REAL (seção 1): célula, corte de órgão, tecido, ciclo de vida, ciclo biogeoquímico, processo fisiológico e representação microscópica NÃO são fotografia real nem micrografia real — declare-os como "photorealistic 3D render of the structure/process staged in its real, coherent environment" (o parasita dentro do intestino, o caramujo na margem do rio, a célula em corte com o tecido ao redor, o ciclo do carbono sobre a paisagem real onde ocorre), nunca como esquema plano flutuando em fundo vazio. A ÚNICA exceção de fundo liso, além das que a seção 1 já prevê para gráficos e figuras geométricas puras, é o cladograma/árvore filogenética (diagrama de nós e ramos): para ele, "plain white or neutral background". Cadeias e teias alimentares são CENA real, com os organismos no seu ambiente e as setas de fluxo de energia sobrepostas.

c) INVENTÁRIO (seção 2): quantidade EXATA sempre que o número tiver significado biológico (organelas, cromossomos, cromátides, organismos, etapas); as características que permitem reconhecer cada estrutura; e quais estruturas homólogas/análogas NÃO podem aparecer no lugar da pedida. Em representações anatômicas, celulares ou histológicas, declare o organismo/órgão/tecido, a vista adotada (frontal, dorsal, ventral, lateral), o tipo e plano de corte, o que está dentro/fora/adjacente e quais compartimentos se comunicam.

d) SETAS (seção 4): a causa nº 1 de erro em Biologia é o sentido. Para cada seta, além de origem, destino, ponta e direção na tela, declare a FUNÇÃO (identificação, deslocamento, fluxo, transformação, transferência de energia) e confirme que o sentido corresponde exatamente ao fenômeno descrito no texto-base e na resolução — nunca invertido, nunca atravessando barreiras que o processo não atravessa.

e) RÓTULOS E CORES (seções 5 e 7): nomes científicos em itálico ("rendered in italics"); todo texto visível em português com acentuação correta. Ao usar cor convencional (ex.: vermelho/azul em esquema circulatório), declare explicitamente que é convenção e o que ela significa — nunca como aparência real do material biológico; a cor nunca é o único meio de transmitir uma informação indispensável; mesma convenção em todos os painéis da figura.

f) PROPORÇÕES E ESCALAS (seção 6): proporções biologicamente coerentes; diga quais estruturas foram ampliadas por razão didática e se o desenho está deliberadamente fora de escala. NÃO invente barras de escala, valores ou ampliações que não estejam na questão.

g) RESTRIÇÕES ESPECÍFICAS (seção 8): acrescente à lista negativa genérica da seção 8 até 6 itens específicos DESTA figura, escritos a partir do conteúdo real da questão — por exemplo "no duplicated nuclei beyond the exact count specified", "no reversed flow direction on any arrow", "no structure placed outside its correct anatomical compartment", "no label naming the structure the student must identify", "no extra organisms beyond those listed".

VERIFICAÇÃO FINAL — BIOLOGIA: antes de entregar, confirme que (i) nenhum rótulo entrega a resposta; (ii) toda contagem e todo valor citados na questão aparecem com o mesmo número na especificação; (iii) o sentido de cada seta corresponde ao fenômeno; (iv) a cena tem ambiente real e coerente (exceto cladograma), no mesmo padrão cinematográfico das demais disciplinas.`;

// Seleciona as instruções de recurso visual a usar. v69: para Biologia + imagem,
// o protocolo é LITERALMENTE o genérico (o mesmo texto de Física, byte a byte)
// seguido do COMPLEMENTO_BIOLOGIA — que só acrescenta exatidão científica e,
// por construção, não pode divergir em estilo, ambiente ou fundo. Uma única
// fonte de verdade para o estilo; a ciência vem por acréscimo.
export function ehBiologia(disciplina: string): boolean {
  return (disciplina || "").trim().toLowerCase() === "biologia";
}
export function instrucoesImagem(recurso: string, disciplina: string): string {
  if (recurso === "imagem" && ehBiologia(disciplina)) {
    return RECURSO_INSTRUCOES["imagem"] + "\n\n" + COMPLEMENTO_BIOLOGIA;
  }
  return RECURSO_INSTRUCOES[recurso];
}

export const JSON_SCHEMA_TXT = `Responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois, sem comentários), exatamente neste formato:
{
 "area": "string",
 "disciplina": "string",
 "tema": "string",
 "dificuldade": "Fácil" | "Médio" | "Difícil",
 "competencia": {"numero": number, "texto": "string (texto oficial completo da competência)"},
 "habilidade": {"codigo": "HXX", "texto": "string (texto oficial completo da habilidade)"},
 "objetoConhecimento": "string (título do objeto de conhecimento oficial da área, copiado literalmente da lista de OBJETOS DE CONHECIMENTO OFICIAIS apresentada no prompt do sistema — nunca um objeto inventado)",
 "recurso": "nenhum" | "imagem" | "grafico" | "tabela",
 "visual": null ou objeto conforme instruído acima,
 "textoBase": "string (texto-suporte com contextualização; termine com a citação de fonte no formato ENEM. Em Linguagens e em Ciências Humanas a fonte TEM que ser real e verificada — a REGRA OBRIGATÓRIA DO PROFESSOR abaixo não admite exceção, e uma fonte 'verossímil'/fictícia reprova a questão; nessas áreas, quando você não tiver fonte real verificada, escreva o texto-suporte como situação-problema DE SUA AUTORIA e declare 'tipoUso':'proprio' no campo 'fonte', sem citar autor nenhum. Nas demais áreas a citação pode ser real ou verossímil, salvo quando a regra 'PROIBIDO INVENTAR AUTORES OU TEXTOS' se aplicar à disciplina, caso em que TEM que ser real. Separe o corpo do texto da citação final com uma quebra de parágrafo DE VERDADE — nunca escreva os dois caracteres literais \\n no meio do texto para representar essa quebra; se precisar de uma quebra de linha dentro da própria string JSON, produza-a como quebra de linha real, não como texto \\n)",
 "comando": "string (o enunciado da pergunta, curto, indireto, SEM nenhum ponto de interrogação — é sempre uma frase afirmativa que se completa com as alternativas, nunca uma pergunta direta)",
 "alternativas": {"A":"string","B":"string","C":"string","D":"string","E":"string"},
 "gabarito": "A" | "B" | "C" | "D" | "E",
 "resolucaoComentada": "string (explicação detalhada do raciocínio para chegar à resposta correta)",
 "analiseAlternativas": {
   "A": {"status":"correta"|"incorreta","comentario":"string"},
   "B": {"status":"correta"|"incorreta","comentario":"string"},
   "C": {"status":"correta"|"incorreta","comentario":"string"},
   "D": {"status":"correta"|"incorreta","comentario":"string"},
   "E": {"status":"correta"|"incorreta","comentario":"string"}
 }
}
No campo "comentario" de cada alternativa errada, nomeie explicitamente o tipo de distrator (leitura parcial, inversão de causa/efeito, verdade parcial, anacronismo/confusão conceitual, senso comum, erro de processo, excesso de escopo, reaproveitamento fora de contexto) e explique EM TERMOS CONCEITUAIS o raciocínio equivocado que ela representa — nunca justifique a incorreção apenas apontando que a alternativa usa uma palavra absoluta/extrema; a palavra não é o motivo do erro, o raciocínio é. Nunca deixe mais de uma alternativa com status "correta".

REGRA DE FORMATAÇÃO DO JSON — vale para TODOS os campos de texto, e o campo "promptImagem" é o mais sensível porque cita o texto dos rótulos:
- prefira ASPAS SIMPLES dentro dos textos; se precisar mesmo de uma aspa dupla, escape-a como \\" ;
- nada de LaTeX nem de barra invertida solta: escreva "T = 2π√(L/g)" (Unicode, conforme a REGRA ABSOLUTA DE NOTAÇÃO MATEMÁTICA), nunca "2\\\\pi\\\\sqrt{L/g}" nem "2π vezes a raiz quadrada de (L/g)";
- nada de quebra de linha literal dentro de uma string (use \\n);
- nada de vírgula sobrando antes de } ou ].

COMO ENTREGAR: chame a ferramenta "entregar_questao" passando esse objeto como argumento. Não escreva o JSON no texto da resposta, não use crases e não escreva nada antes ou depois da chamada da ferramenta.`;

