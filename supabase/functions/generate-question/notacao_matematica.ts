// @ts-nocheck — o bloco abaixo é JavaScript compartilhado com o app (sem anotações de tipo, de propósito).
/* v71/v16 — REDE DE SEGURANÇA DA NOTAÇÃO MATEMÁTICA (expoentes, índices,
   sinais de operação). Roda em TODAS as áreas, depois da rede química.

   Caso real (13/09/2026, Matemática, simulado "Potenciação, Radiciação…"):
   6 das 20 questões saíram com Q0, S0, P0, 2^4, 10^9, 2^(-t/T), "4,6 x 10^9",
   "S0 . 1". Causa: a regra de notação Unicode e a rede de segurança v70 só
   existiam para Ciências da Natureza. Agora o prompt exige Unicode em todas as
   áreas, e este código corrige, depois que a questão chega, o que o modelo
   ainda escrever em ASCII — só o que for INEQUÍVOCO. O que for ambíguo fica
   como está e é apontado pela verificação do app.

   ESTE ARQUIVO É O MESMO no backend (notacao_matematica.ts, que só acrescenta
   o `export`) e no app (src/app.js, colado sem alteração). Os dois são testados
   com o mesmo arquivo de casos (nm/casos_notacao.json). Não use sintaxe que o
   navegador não entenda; não use `import`.

   Regras (todas com guarda de URL/DOI e sem tocar no campo "fonte" nem no
   "promptImagem"):
   1. Expoente ASCII  base^n · base^-n · base^(…) · base^{…}  → sobrescrito, só
      se TODO o expoente for convertível (dígitos, sinais, parênteses, letras
      que existem em sobrescrito). Expoente "nu" é um número OU uma letra
      (x^2y não converte); a base não pode vir depois de outro ^ (2^3^2 fica);
      expoente terminado em sinal é CARGA química (SO4^2-, ^(2-)) e fica.
      2^(-3/2), 2^(-1,5) ficam (não há sobrescrito para / e ,).
   2. Índice ASCII  base_n · base_{…}  → subscrito, com fim de token
      obrigatório (meu_texto, #enem_2024, IBGE_2022 ficam).
   3. Índice em algarismo comum — letra + 1 dígito (Q0, S0, a1) — só em
      Matemática e Física, só quando o token está encostado num operador
      (= + − · × / ^) em oração com "=" ou na resolução comentada; depois a
      grafia é unificada em toda a questão. Nunca O0–O9 (oxigênio é da rede
      química) nem A4 (papel); rótulos (H2, F1, T4) não têm operador ao lado.
   2b. log10 → log₁₀, log2 → log₂.
   4. Unidades com expoente: m2 cm2 mm2 dm2 km2 m3 cm3 … depois de número ou
      barra; m/s2 → m/s².
   5. Letra x como multiplicação: "4,6 x 10^9" sempre; "3 x 5" só em oração com
      "=" ou seguida de = ^ ) ou expoente. "Brasil 3 x 1 Argentina" fica.
   6. Ponto como multiplicação: "S0 . (1 + i)" → "S₀ · (1 + i)", só entre
      operandos matemáticos.
   7. Radical com barra: "√1000" → √1̅0̅0̅0̅ e "√(x² + 1)" → √x̅²̅ ̅+̅ ̅1̅ — cada
      caractere do radicando recebe o combinante U+0305, de modo que a barra
      começa depois do √ e vai exatamente até o fim do radicando (pedido do
      professor, 14/09/2026). No PDF, pdfSanitizeText troca cada par por um
      glifo pré-composto da fonte (ver fontwork/ampliar_carlito.py).           */

var NM_SUP = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "–": "⁻", "(": "⁽", ")": "⁾", "=": "⁼",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ",
  n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ", K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ", O: "ᴼ",
  P: "ᴾ", R: "ᴿ", T: "ᵀ", U: "ᵁ", W: "ᵂ",
};
var NM_SUB = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "–": "₋", "(": "₍", ")": "₎", "=": "₌",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ",
  t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};
var NM_SUP_DIGITOS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
var NM_SUB_DIGITOS = "₀₁₂₃₄₅₆₇₈₉";

// Converte cada caractere pelo mapa; null se algum não tiver equivalente.
function nmConverte(conteudo, mapa) {
  var s = String(conteudo).replace(/\s+/g, "");
  if (!s) return null;
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = mapa[s.charAt(i)];
    if (c === undefined) return null;
    out += c;
  }
  return out;
}
// Dentro de URL, DOI ou nome de arquivo: nunca mexer.
function nmEmUrl(antesTxt) {
  return /(?:https?:\/\/|www\.|doi\.org\/|doi:|\.pdf|\.html?)\S*$/i.test(antesTxt) || /\S+\.[a-z]{2,4}\/\S*$/i.test(antesTxt);
}
// A oração (entre . ; \n ou início/fim) que contém a posição `pos`.
function nmOracao(str, pos) {
  var ini = pos, fim = pos;
  while (ini > 0 && !/[.;\n!?]/.test(str.charAt(ini - 1))) ini--;
  while (fim < str.length && !/[.;\n!?]/.test(str.charAt(fim))) fim++;
  return str.slice(ini, fim);
}

// 1) expoentes:  x^2  10^-3  2^(n-1)  (1+i)^t  e^{kt}
var NM_RE_EXPOENTE = /(?<![\^_])([\p{L}\p{Nd}\)\]₀-₉])\^(\{[^{}\n]{1,40}\}|\([^()\n]{1,40}\)|[+\-−–]?\d{1,3}(?![\p{Nd}\^_])|[A-Za-z](?![\p{L}\p{Nd}\^_]))/gu;
function nmExpoentes(texto) {
  return texto.replace(NM_RE_EXPOENTE, function (m0, base, exp, offset, str) {
    var antesTxt = str.slice(0, offset);
    if (nmEmUrl(antesTxt)) return m0;
    var depois = str.slice(offset + m0.length);
    var grupo = /^[\{\(]/.test(exp);
    var conteudo = grupo ? exp.slice(1, -1) : exp;
    var compacto = conteudo.replace(/\s+/g, "");
    if (!compacto) return m0;
    // carga química: expoente terminado em sinal (^(2-), ^{2+}) ou número
    // seguido de sinal que não continua expressão — "SO4^2-", "Ca^2+ (aq)",
    // "Fe^3+(aq)" são carga; "x^2-3x" e "x^2-(x+1)" são expressão.
    if (grupo && /[+\-−–]$/.test(compacto)) return m0;
    if (!grupo && /^[+\-−–](?![\p{L}\p{Nd}]|\((?!(?:aq|g|s|l|v)\)))/u.test(depois)) return m0;
    // expoente nu: número OU uma letra — nunca mistura (x^2y)
    if (!grupo && !/^(?:[+\-−–]?\d{1,3}|[A-Za-z])$/.test(compacto)) return m0;
    var conv = nmConverte(compacto, NM_SUP);
    return conv === null ? m0 : base + conv;
  });
}

// 2) índices:  Q_0  a_n  x_{12}  a_{n-1}
// A base de um índice é UMA letra (variável), uma função (log₂, senₙ…) ou um
// fecho de parêntese — nunca o fim de uma palavra (@joao_2, meu_texto ficam).
var NM_RE_INDICE = /((?<![\^_\p{L}\p{Nd}])(?:\p{L}|log|sen|cos|tg|lim|max|min)|(?<![\^_])[\)\]])_(\{[^{}\n]{1,20}\}|\([^()\n]{1,20}\)|\d{1,2}|[A-Za-z])(?![\p{L}\p{Nd}_])/gu;   // "v_0^2" → v₀ e depois v₀²
function nmIndices(texto) {
  return texto.replace(NM_RE_INDICE, function (m0, base, idx, offset, str) {
    if (nmEmUrl(str.slice(0, offset))) return m0;
    var grupo = /^[\{\(]/.test(idx);
    var conteudo = grupo ? idx.slice(1, -1) : idx;
    var conv = nmConverte(conteudo, NM_SUB);
    return conv === null ? m0 : base + conv;
  });
}

// 2b) logaritmo com base em algarismo comum:  log10 → log₁₀   log2 → log₂
// Só quando vem um ARGUMENTO depois (log10(x), log2 8): "adote log2 = 0,30",
// "2·log2 + log3", "log2/log3" são o logaritmo DE 2, não na base 2 — ficam.
var NM_RE_LOG = /(?<![\p{L}\p{Nd}])log(\d{1,2})(?![\p{L}\p{Nd}])(?!\s*[=≈≅<>+\-−–·×\/])(?=\s*\(|\s+(?:[\p{Nd}√]|[b-df-np-tv-zA-Z](?![\p{L}])))/gu;   // argumento: "(", número, √ ou UMA variável (não "e", "a", "o", "u", conjunções)
function nmLogaritmos(texto) {
  return texto.replace(NM_RE_LOG, function (m0, b, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : "log" + nmConverte(b, NM_SUB); });
}

// 4) unidades:  5 m2 → 5 m²   kg/m3 → kg/m³   m/s2 → m/s²
var NM_RE_UNIDADE = /(?<=\d\s?|\/)(m|cm|mm|dm|km)([23])(?![\p{L}\p{Nd}])/gu;
var NM_RE_UNIDADE_S = /(?<=\/)s2(?![\p{L}\p{Nd}])/gu;
function nmUnidades(texto) {
  return texto
    .replace(NM_RE_UNIDADE, function (m0, u, d, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : u + NM_SUP[d]; })
    .replace(NM_RE_UNIDADE_S, function (m0, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : "s²"; });
}

// 5) letra x como multiplicação
var NM_RE_X_DEZ = /(\d)\s?x\s?(?=10(?:\^|[⁰¹²³⁴⁵⁶⁷⁸⁹]))/g;
var NM_RE_X_NUM = /(\d)\s+x\s+(?=\d)/g;
function nmMultiplicacaoX(texto) {
  var t = texto.replace(NM_RE_X_DEZ, function (m0, d, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : d + " × "; });
  return t.replace(NM_RE_X_NUM, function (m0, d, offset, str) {
    if (nmEmUrl(str.slice(0, offset))) return m0;
    var depois = str.slice(offset + m0.length);
    var oracao = nmOracao(str, offset);
    var forte = /^\d+(?:[,.]\d+)?\s*(?:=|\^|[⁰¹²³⁴⁵⁶⁷⁸⁹]|\))/.test(depois) || /=/.test(oracao);
    return forte ? d + " × " : m0;
  });
}

// 6) ponto como multiplicação:  S0 . (1 + i)  → S0 · (1 + i)
var NM_RE_PONTO = /(\d|\)|(?<![\p{L}\p{Nd}])[A-Za-z][₀-₉\d]?)\s\.\s(?=\d|\(|[a-z](?![\p{L}])|[A-Za-z][₀-₉\d](?![\p{L}\p{Nd}]))/gu;
function nmPontoMultiplicacao(texto) {
  return texto.replace(NM_RE_PONTO, function (m0, a, offset, str) {
    if (nmEmUrl(str.slice(0, offset))) return m0;
    // Só em contexto de conta: oração com "=" ou parêntese depois ("S0 . (1 + i)").
    // "Lei n . 9", "R$ 5 . 000", "(2019) . a autora" ficam.
    var depois = str.slice(offset + m0.length);
    if (!/=/.test(nmOracao(str, offset)) && depois.charAt(0) !== "(" && !/^10(?:\^|[⁰¹²³⁴⁵⁶⁷⁸⁹])/.test(depois)) return m0;   // "1,5 . 10^3 kg" é notação científica
    return a + " · ";
  });
}

// 7) radical com barra sobre o radicando inteiro
var NM_SOBRELINHA = "\u0305";
// radicando "nu": número (com decimal), letra ou letra grega, com expoente já em sobrescrito
var NM_RE_RADICANDO_NU = /^(?:\d+(?:[,.]\d+)?|[A-Za-zπ])[⁰¹²³⁴⁵⁶⁷⁸⁹]*/u;
function nmSobrelinha(radicando) {
  var out = "";
  for (var ch of radicando) out += ch + NM_SOBRELINHA;
  return out;
}
function nmRadicais(texto) {
  var out = "", i = 0;
  while (i < texto.length) {
    var k = texto.indexOf("√", i);
    if (k < 0) { out += texto.slice(i); break; }
    out += texto.slice(i, k + 1); i = k + 1;
    if (nmEmUrl(texto.slice(0, k))) continue;
    var resto = texto.slice(i);
    if (resto.charAt(1) === NM_SOBRELINHA) continue;              // já tem barra (idempotente)
    if (resto.charAt(0) === "(") {
      // grupo balanceado, curto, sem quebra de linha: "√(x² + 1)" → barra sobre "x² + 1" (sem os parênteses)
      var prof = 0, fim = -1;
      for (var j = 0; j < resto.length && j < 60; j++) {
        var c = resto.charAt(j);
        if (c === "\n") break;
        if (c === "(") prof++;
        else if (c === ")") { prof--; if (prof === 0) { fim = j; break; } }
      }
      if (fim > 1) { out += nmSobrelinha(resto.slice(1, fim)); i += fim + 1; }
      continue;
    }
    var m = NM_RE_RADICANDO_NU.exec(resto);
    if (m && m[0]) { out += nmSobrelinha(m[0]); i += m[0].length; }
  }
  return out;
}

// Texto isolado (sem a regra 3, que precisa da questão inteira).
function nmNormalizaTexto(texto) {
  if (typeof texto !== "string" || !texto) return texto;
  var t = texto;
  t = nmPontoMultiplicacao(t);
  t = nmMultiplicacaoX(t);
  t = nmIndices(t);       // antes dos expoentes: "v_0^2" → "v₀^2" → "v₀²"
  t = nmExpoentes(t);
  t = nmLogaritmos(t);
  t = nmUnidades(t);
  t = nmRadicais(t);      // por último: depois disto o radicando carrega U+0305 entre os caracteres
  return t;
}

// 3) letra + 1 dígito (Q0, S0, a1) — candidatos com evidência forte.
var NM_RE_LETRA_DIGITO = /(?<![\p{L}\p{Nd}_\^.,])([A-Za-z])(\d)(?![\p{L}\p{Nd}]|[,.]\d)/gu;   // "A/A0" conta: a barra é operador
var NM_OPERADOR = /[=+\-−–·×\/\^*]\s*$/;
var NM_OPERADOR_DEPOIS = /^\s*[=+\-−–·×\/\^*]/;
function nmDisciplinaComIndices(disciplina) {
  var d = String(disciplina || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return d === "matematica" || d === "fisica";
}
function nmTokenPermitido(letra, _disciplina) {
  // "O2" é oxigênio (a rede química decide); os demais rótulos (H2, F1, N2,
  // T4, C3) já ficam protegidos pela exigência de operador + oração com "="
  // — um rótulo não entra em conta. Corpus real: A0, E1, M2, N0, R1, L1, H1
  // aparecem em fórmulas de Matemática e Física e precisam do índice.
  return letra !== "O";
}
function nmColetaCandidatos(texto, campo, disciplina, conjunto) {
  if (typeof texto !== "string" || !texto) return;
  var re = new RegExp(NM_RE_LETRA_DIGITO.source, "gu"), m;
  while ((m = re.exec(texto))) {
    var tok = m[1] + m[2];
    if (tok === "A4" || !nmTokenPermitido(m[1], disciplina)) continue;
    var antes = texto.slice(0, m.index), depois = texto.slice(m.index + tok.length);
    if (nmEmUrl(antes)) continue;
    var operador = NM_OPERADOR.test(antes) || NM_OPERADOR_DEPOIS.test(depois);
    if (!operador) continue;
    // o outro lado do operador tem de ser operando matemático (número, variável, parêntese)
    var outroLado = NM_OPERADOR.test(antes)
      ? /[\p{L}\p{Nd}\)\]₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]\s*[=+\-−–·×\/\^*]\s*$/u.test(antes)
      : /^\s*[=+\-−–·×\/\^*]\s*[\p{L}\p{Nd}\(]/u.test(depois);
    if (!outroLado) continue;
    var forte = campo === "resolucaoComentada" || /=/.test(nmOracao(texto, m.index));
    if (forte) conjunto[tok] = m[1] + NM_SUB[m[2]];
  }
}
function nmAplicaCandidatos(texto, conjunto) {
  if (typeof texto !== "string" || !texto) return texto;
  var toks = Object.keys(conjunto);
  if (!toks.length) return texto;
  var re = new RegExp("(?<![\\p{L}\\p{Nd}_\\^.,])(" + toks.join("|") + ")(?![\\p{L}\\p{Nd}]|[,.]\\d)", "gu");
  return texto.replace(re, function (m0, tok, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : conjunto[tok]; });
}

var NM_CAMPOS_TEXTO = ["tema", "textoBase", "comando", "resolucaoComentada"];   // "fonte" fica fora de propósito
// Percorre todos os campos de texto da questão aplicando fn(texto, nomeDoCampo).
function nmPercorre(data, fn) {
  var saida = {};
  for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) saida[k] = data[k];
  for (var i = 0; i < NM_CAMPOS_TEXTO.length; i++) {
    var c = NM_CAMPOS_TEXTO[i];
    if (typeof saida[c] === "string") saida[c] = fn(saida[c], c);
  }
  if (saida.alternativas && typeof saida.alternativas === "object" && !Array.isArray(saida.alternativas)) {
    var alt = {};
    for (var L in saida.alternativas) if (Object.prototype.hasOwnProperty.call(saida.alternativas, L)) {
      alt[L] = typeof saida.alternativas[L] === "string" ? fn(saida.alternativas[L], "alternativas") : saida.alternativas[L];
    }
    saida.alternativas = alt;
  }
  if (saida.analiseAlternativas && typeof saida.analiseAlternativas === "object" && !Array.isArray(saida.analiseAlternativas)) {
    var an = {};
    for (var M in saida.analiseAlternativas) if (Object.prototype.hasOwnProperty.call(saida.analiseAlternativas, M)) {
      var a = saida.analiseAlternativas[M];
      if (a && typeof a === "object" && typeof a.comentario === "string") {
        var b = {};
        for (var kk in a) if (Object.prototype.hasOwnProperty.call(a, kk)) b[kk] = a[kk];
        b.comentario = fn(a.comentario, "analiseAlternativas");
        an[M] = b;
      } else an[M] = a;
    }
    saida.analiseAlternativas = an;
  }
  if (saida.visual && typeof saida.visual === "object" && !Array.isArray(saida.visual)) {
    var v = {};
    for (var kv in saida.visual) if (Object.prototype.hasOwnProperty.call(saida.visual, kv)) v[kv] = saida.visual[kv];
    if (typeof v.titulo === "string") v.titulo = fn(v.titulo, "visual");
    if (typeof v.descricao === "string") v.descricao = fn(v.descricao, "visual");
    if (Array.isArray(v.labels)) v.labels = v.labels.map(function (x) { return typeof x === "string" ? fn(x, "visual") : x; });
    if (Array.isArray(v.colunas)) v.colunas = v.colunas.map(function (x) { return typeof x === "string" ? fn(x, "visual") : x; });
    if (Array.isArray(v.linhas)) v.linhas = v.linhas.map(function (l) { return Array.isArray(l) ? l.map(function (x) { return typeof x === "string" ? fn(x, "visual") : x; }) : l; });
    if (Array.isArray(v.datasets)) v.datasets = v.datasets.map(function (ds) {
      if (!ds || typeof ds !== "object" || typeof ds.label !== "string") return ds;
      var d2 = {}; for (var kd in ds) if (Object.prototype.hasOwnProperty.call(ds, kd)) d2[kd] = ds[kd];
      d2.label = fn(ds.label, "visual"); return d2;
    });
    saida.visual = v;
  }
  return saida;
}

// Questão inteira (objeto do backend/app). Idempotente. Nunca lança: em caso
// de erro devolve a questão como veio.
// Questões de planilha eletrônica: "B2 = A1 + A2" são células, não índices.
var NM_RE_PLANILHA = /planilha|c[ée]lula\s+[A-Z]\d|excel|libreoffice|coluna [A-Z]\b/i;   // "célula fotovoltaica" não é planilha
function nmNormalizaQuestao(data, disciplina) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  try {
    var saida = nmPercorre(data, function (t) { return nmNormalizaTexto(t); });
    if (nmDisciplinaComIndices(disciplina)) {
      var conjunto = {}, todoTexto = "";
      nmPercorre(saida, function (t, campo) { todoTexto += t + "\n"; nmColetaCandidatos(t, campo, disciplina, conjunto); return t; });
      if (NM_RE_PLANILHA.test(todoTexto)) conjunto = {};
      // Minúscula + dígito ≥ 2 ("x2") é a grafia ASCII de x² tanto quanto de x₂:
      // só vira índice se a mesma letra aparecer com índice 1 na questão (x1 e x2,
      // raízes; a1 e a2, termos). "Resolva x2 - 5x + 6 = 0" fica (e o prompt proíbe).
      Object.keys(conjunto).forEach(function (tok) {
        if (/^[a-z][2-9]$/.test(tok) && !new RegExp("(?<![\\p{L}\\p{Nd}])" + tok.charAt(0) + "[1₁](?![\\p{L}\\p{Nd}])", "u").test(todoTexto)) delete conjunto[tok];
      });
      if (Object.keys(conjunto).length) saida = nmPercorre(saida, function (t) { return nmAplicaCandidatos(t, conjunto); });
    }
    return saida;
  } catch (_e) {
    return data;
  }
}

// Verificação (app): o que sobrou em ASCII depois da normalização.
var NM_AUDITORIA = [
  { re: /[\p{L}\p{Nd}\)\]]\^/u, o: "expoente com acento circunflexo (use x², 10⁻³, 2ˣ)" },
  { re: /(?<![\p{L}\p{Nd}])(?:\p{L}|log|sen|cos|tg|lim|max|min|\)|\])_(?:\{|\(|\d{1,2}(?![\p{Nd}]))/u, o: "índice com sublinhado (use Q₀, aₙ)" },
  { re: /\\(?:frac|sqrt|cdot|times|pi|le|ge|neq|left|right|text|mathrm)\b/, o: "comando LaTeX" },
  { re: /\bsqrt\s*\(/i, o: "raiz como texto (use √)" },
  { re: /\d\s+x\s+\d+(?:[,.]\d+)?\s*(?:=|\^|[⁰¹²³⁴⁵⁶⁷⁸⁹])/, o: "letra x como sinal de multiplicação (use ×)" },
];
function nmAudita(texto) {
  var achados = [];
  if (typeof texto !== "string" || !texto) return achados;
  for (var i = 0; i < NM_AUDITORIA.length; i++) if (NM_AUDITORIA[i].re.test(texto)) achados.push(NM_AUDITORIA[i].o);
  return achados;
}

// ---------------------------------------------------------------------------
// Interface do backend (generate-question). O bloco acima é JavaScript puro,
// idêntico ao colado em src/app.js; só esta parte é específica do Deno.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
function normalizarNotacaoMatematica(data: any, disciplina: string): any {
  return nmNormalizaQuestao(data, disciplina);
}
export { normalizarNotacaoMatematica, nmNormalizaTexto, nmNormalizaQuestao, nmAudita, NM_SUP, NM_SUB };
