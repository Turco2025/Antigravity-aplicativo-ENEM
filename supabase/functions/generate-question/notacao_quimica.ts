/* v70 — REDE DE SEGURANÇA DA NOTAÇÃO QUÍMICA (índices e cargas).

   Caso real (11/09/2026, Biologia, "Ciclo biogeoquímico…", questão 2): o
   modelo escreveu "CO2" em algarismo comum em todos os campos, apesar da regra
   NOTAÇÃO QUÍMICA do prompt. Varredura do banco: 1 questão em 150 de Ciências
   da Natureza. É falha probabilística do modelo, não bug de código — e por
   isso a correção é determinística, aqui, depois que a questão chega.

   PRINCÍPIO: LISTA FECHADA. Só são convertidos os tokens listados abaixo,
   inteiros (delimitados), exatamente como escritos. Nenhuma regra genérica
   "letra maiúscula + dígito", para nunca tocar em código de habilidade (H10),
   planta C3/C4, geração F2, vitamina B12/K2/D3, tipo sanguíneo O+/B−, COP30,
   CHIP28, CFC11, HIV2, PM2,5, H1N1, rótulos de Física (F2, N2, V2, T2)…
   O que não está na lista fica como o modelo escreveu (comportamento atual).

   v71 — TODAS AS ÁREAS, por decisão do professor (13/09/2026). Fora de
   Biologia/Química/Física (Geografia, Matemática, Linguagens…) a tabela é a
   mais conservadora possível: só as fórmulas neutras de dois ou mais elementos
   (CO2, H2O, CH4, SO2…), que não colidem com rótulo nenhum. Nada de gases de um
   elemento (O2, N2, H2 — códigos, níveis, teclas) nem de íons. */

const QN_INF: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
const QN_SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };

// Fórmulas neutras (índices → subscrito). Comuns a Biologia, Química e Física.
const QN_FORMULAS_COMUNS: string[] = [
  "CO2", "H2O", "CH4", "NH3", "H2O2", "H2S", "SO2", "SO3", "NO2", "N2O", "N2O5",
  "H2SO4", "HNO3", "H2CO3", "H3PO4", "CaCO3", "MgCO3", "Na2CO3", "NaHCO3", "CaSO4", "CaCl2", "MgCl2",
  "Ca(OH)2", "Mg(OH)2", "Al2O3", "Fe2O3", "Fe3O4", "SiO2", "TiO2", "ZnO2", "P2O5", "P4O10",
  "C6H12O6", "C12H22O11", "C2H5OH", "C2H6O", "CH3COOH", "C2H4O2", "C3H8", "C4H10", "C8H18", "C2H2", "C2H4", "C2H6", "C6H6",
  "C5H5N5", "C4H5N3O", "C5H5N5O", "C5H6N2O2", "C4H4N2O2",
  "CH3OH", "CH3CH2OH", "CH2O", "(CH2O)n", "C3H6O3", "C6H8O6", "C3H4O3", "C4H6O4", "C4H6O5", "C6H8O7",
  "KNO3", "NaNO3", "NH4NO3", "(NH4)2SO4", "K2SO4", "Na2SO4", "MgSO4", "CuSO4", "ZnSO4", "FeSO4", "Ca3(PO4)2", "AgNO3", "BaSO4", "FeS2", "CaC2", "CaF2", "UF6", "CCl4", "CHCl3", "CH2Cl2", "CH3Cl", "CF2Cl2", "CFCl3", "C2F4", "C2H3Cl", "C8H8", "C3H6", "C2H5Cl", "C2H5NH2",
  "NaN3", "Cl2O", "ClO2", "NaClO3", "KClO3", "KMnO4", "K2Cr2O7", "CrO3", "MnO2", "PbO2", "Pb3O4", "SnO2", "Cu2O", "Ag2O", "Na2O", "K2O", "Li2O", "N2O4", "NO3",
  "H2SO3", "HNO2", "Cu(NO3)2", "Pb(NO3)2", "Ca(NO3)2", "Al(OH)3", "Fe(OH)3", "Fe(OH)2", "Cu(OH)2", "Ba(OH)2", "Na3PO4", "K2CO3", "Na2S", "LiCoO2", "LiFePO4", "SF6",
  "NaClO2", "NaClO4", "KClO4", "C9H8O4", "C8H10N4O2", "C3H6O", "C3H8O3", "C2H4O", "C4H8O2", "C7H6O2", "C10H8", "C2HCl3", "C2Cl4", "Na2SO3", "K2SO3", "CaSO3", "Na2S2O3", "Na2SiO3", "H2SiO3", "H4SiO4", "Mg3(PO4)2", "AlPO4",
];
// Gases/moléculas de UM elemento — só onde não são rótulo de outra coisa.
// Entram no dicionário das três disciplinas; QUANDO convertem é decidido no
// contexto (normalizarNotacaoTexto, item 4): em Biologia O2/O3/N2 e em Química
// O2/O3/N2/Cl2/Br2 sempre (salvo rótulo); H2 em Química salvo código de
// habilidade; todos os demais casos só em contexto inequívoco de equação.
const QN_GASES: string[] = ["O2", "O3", "N2", "H2", "Cl2", "Br2", "F2", "I2", "S8"];
const QN_GASES_SEMPRE: Record<string, string[]> = { Biologia: ["O2", "O3", "N2"], Química: ["O2", "O3", "N2", "Cl2", "Br2"], Física: [] };
// Fórmulas extras por disciplina (além das comuns).
const QN_FORMULAS_DISCIPLINA: Record<string, string[]> = {
  Biologia: ["NO3", "NO2", "NH4", "SO4", "PO4", "HCO3", "CO3", "H2PO4", "HPO4", "N2O"],
  Química: ["NO3", "NO2", "NH4", "SO4", "PO4", "HCO3", "CO3", "H2PO4", "HPO4", "MnO4", "Cr2O7", "ClO4", "ClO3", "ClO2", "ClO", "S2O3", "C2O4", "SiO4"],
  Física: [],
};
// Íons — sinal obrigatoriamente seguido de espaço/pontuação (nunca de letra ou
// dígito), justamente para "O+" e "B-" de tipo sanguíneo (que NÃO estão aqui)
// e para "K+-ATPase" continuarem certos.
const QN_IONS: Record<string, string[]> = {
  Biologia: ["H+", "Na+", "K+", "NH4+", "Ca2+", "Mg2+", "Fe2+", "Fe3+", "Zn2+", "Cu2+", "Mn2+",
             "Cl-", "OH-", "NO3-", "NO2-", "HCO3-", "CO32-", "SO42-", "PO43-", "HPO42-", "H2PO4-"],
  Química:  ["H+", "Na+", "K+", "Li+", "Ag+", "NH4+", "H3O+",
             "Ca2+", "Mg2+", "Fe2+", "Fe3+", "Zn2+", "Cu2+", "Cu+", "Mn2+", "Al3+", "Ba2+", "Pb2+", "Hg2+", "Cd2+", "Ni2+", "Co2+", "Sn2+", "Cr3+",
             "Cl-", "Br-", "F-", "OH-", "NO3-", "NO2-", "HCO3-", "CO32-", "SO42-", "SO32-", "PO43-", "HPO42-", "H2PO4-", "MnO4-", "MnO42-", "Cr2O72-", "ClO-", "ClO2-", "ClO3-", "ClO4-", "S2-", "CN-", "SCN-", "CH3COO-", "HSO4-", "HSO3-", "HS-", "C2O42-", "S2O32-", "SO32-", "SiO32-"],
  Física:   [],
};

function qnSubscreveIndices(tok: string): string {
  // Dígitos após elemento ou ")" viram subscrito; o "n" de (CH2O)n fica.
  return tok.replace(/([A-Za-z\)])(\d+)/g, (_m: string, a: string, d: string) => a + d.split("").map((c: string) => QN_INF[c]).join(""));
}
function qnConverteIon(tok: string): string {
  // Separa a carga: "Ca2+" (um só elemento + dígito) → carga 2; "SO42-",
  // "CO32-", "PO43-", "Cr2O72-" (dois dígitos no fim) → o último é a carga;
  // "NH4+", "NO3-", "MnO4-", "H3O+", "HCO3-" (um dígito no fim, fórmula com
  // mais de um elemento) → o dígito é índice, carga 1 (não se escreve).
  const sinal = tok.slice(-1);
  let resto = tok.slice(0, -1), carga = "";
  let m: RegExpExecArray | null;
  if ((m = /^([A-Z][a-z]?)(\d)$/.exec(resto)) || (m = /^(.*\d)(\d)$/.exec(resto))) { resto = m[1]; carga = m[2]; }
  return qnSubscreveIndices(resto) + (carga ? QN_SUP[carga] : "") + QN_SUP[sinal];
}

const _qnCache: Record<string, { mapa: Map<string, string>; re: RegExp | null }> = {};
function qnTabela(disciplina: string): { mapa: Map<string, string>; re: RegExp | null } {
  const d = disciplina === "Biologia" || disciplina === "Química" || disciplina === "Física" ? disciplina : "outra";
  if (_qnCache[d]) return _qnCache[d];
  const mapa = new Map<string, string>();
  if (d !== "outra") {
    QN_IONS[d].forEach((t: string) => mapa.set(t, qnConverteIon(t)));
    QN_FORMULAS_COMUNS.concat(QN_FORMULAS_DISCIPLINA[d], QN_GASES).forEach((t: string) => mapa.set(t, qnSubscreveIndices(t)));
  } else {
    // v71: demais disciplinas — só fórmulas neutras de 2+ elementos (sem gases, sem íons).
    QN_FORMULAS_COMUNS.forEach((t: string) => mapa.set(t, qnSubscreveIndices(t)));
  }
  // Mais longo primeiro: "NO3-" antes de "NO3", "CO32-" antes de "CO3".
  const tokens = Array.from(mapa.keys()).sort((a: string, b: string) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Delimitação. Antes do token: nada de letra (qualquer alfabeto, com ou sem
  // acento combinado), dígito (qualquer escrita), índice, expoente ou sinal —
  // OU um coeficiente colado de 1–2 dígitos que por sua vez vem depois de
  // início/espaço/+/→/⇌/( ("6CO2 + 6H2O" → "6CO₂ + 6H₂O"; "2024CO2" não).
  // Depois: nada de letra, dígito ou índice — expoente PODE vir depois
  // ("SO4²⁻" → "SO₄²⁻"). Os expoentes ¹²³ ficam fora do bloco U+2070, por isso
  // são listados um a um, nunca como intervalo.
  const re = tokens.length
    ? new RegExp("(^|[^\\p{L}\\p{M}\\p{Nd}₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]|(?:^|[\\s+→⇌←\\(])\\d{1,2})(" + tokens.map(esc).join("|") + ")(?![\\p{L}\\p{M}\\p{Nd}₀-₉])", "gu")
    : null;
  _qnCache[d] = { mapa, re };
  return _qnCache[d];
}

function normalizarNotacaoTexto(texto: string, disciplina: string): string {
  if (typeof texto !== "string" || !texto) return texto;
  const { mapa, re } = qnTabela(disciplina);
  if (!re) return texto;
  return texto.replace(re, (m0: string, antes: string, tok: string, offset: number, str: string) => {
    const antesTxt = str.slice(0, offset + antes.length);
    const depoisTxt = str.slice(offset + m0.length);
    const temCarga = /[+-]$/.test(tok);
    // 1) Dentro de URL/DOI: nunca ("…/CO2/2020").
    if (/(?:https?:\/\/|www\.|doi\.org\/|doi:)\S*$/i.test(antesTxt)) return m0;
    // 2) Íon seguido de outro "+" ("Na+ +" não é o caso; "K+-ATPase" é permitido).
    if (temCarga && depoisTxt.charAt(0) === "+") return m0;
    // 3) Fórmula neutra seguida de carga escrita em OUTRO estilo ASCII
    //    ("SO4 2-", "SO4^2-", "SO4-2"): não converter pela metade — fica para o
    //    modelo/auditoria, em vez de sair "SO₄ 2-".
    if (!temCarga && /^(?:\^|\s?\d[+\-−](?![\p{L}\p{Nd}])|[\-−]\d|\s?\(\d?[+\-−]\)|\)\d|[+\-−](?![\p{L}\p{Nd}(]))/u.test(depoisTxt)) return m0;   // também "SO4(2-)", "SO4 (2−)", "(CH2O)6" e "NO3-" fora da tabela de íons (v71)
    // 4) Gases/moléculas de UM elemento (O2, O3, N2, H2, Cl2, Br2, F2, I2, S8)
    //    colidem com rótulos (F2 força/geração, N2 normal/estádio, H2 habilidade,
    //    S8 celular, teclas F2, intervalo I2). Regras por disciplina, abaixo.
    if (/^[A-Z][a-z]?\d$/.test(tok)) {
      const elemento = tok.replace(/\d$/, "");
      // vizinho "químico": fórmula da lista, escrita com ou sem subscrito ("H₂O" conta; "F₁" não).
      const semSub = (v: string) => v.replace(/[₀-₉]/g, (c: string) => String.fromCharCode(c.charCodeAt(0) - 0x2080 + 48));
      const ehQuimico = (v: string | undefined) => v != null && (mapa.has(v) || mapa.has(semSub(v)));
      // Sinais FORTES de equação — coisas que um rótulo (F2 força, N2 normal,
      // H2 habilidade, F2 geração) nunca tem ao lado:
      //   estado físico logo depois: O2(g);  razão com fórmula da lista: CO2/O2;
      //   vizinho do outro lado de + → ⇌ ← ↔ que É fórmula da lista (ou já tem
      //   subscrito): "CH4 + 2 O2", "N2 + 3 H2", "H2 + O2 → H2O";
      //   coeficiente antes E operador logo depois: "2 H2 + O2", "6CO2 →".
      // "F2 + F3 = 10 N", "P + F2", "N2 + m·a", "(P) → F2" NÃO passam.
      const estado = /^\((?:g|l|s|aq|v)\)/.test(depoisTxt);
      const coef = /(?:^|[\s(+→⇌←])\d{1,2}\s?$/.test(antesTxt);
      const opDepois = /^\s*[+→⇌←↔]/.test(depoisTxt);
      const vizAntes = (/([A-Za-z0-9()₀-₉]+)(?:\((?:g|l|s|aq|v)\))?\s*[+→⇌←↔]\s*(?:\d{1,2}\s?)?$/.exec(antesTxt) || [])[1];
      const vizDepois = (/^\s*[+→⇌←↔]\s*(?:\d{1,2}\s?)?([A-Za-z0-9()₀-₉]+)/.exec(depoisTxt) || [])[1];
      const razAntes = (/([A-Za-z0-9()₀-₉]+)\s*\/\s*$/.exec(antesTxt) || [])[1];
      const razDepois = (/^\s*\/\s*([A-Za-z0-9()₀-₉]+)/.exec(depoisTxt) || [])[1];
      const equacao = estado || ehQuimico(vizAntes) || ehQuimico(vizDepois) || ehQuimico(razAntes) || ehQuimico(razDepois) || (coef && opDepois);
      const reIrmao = new RegExp("(?:^|[^\\p{L}\\p{Nd}])\\d?(" + elemento + "\\d)(?![\\p{L}\\p{Nd}])", "gu");
      const temIrmao = (trecho: string, paraTras: boolean) => Array.from(trecho.matchAll(reIrmao)).some((mm: RegExpMatchArray) => {
        if (mm[1] === tok || mapa.has(mm[1])) return false;
        const i = mm.index || 0;
        return !/[.;\n]/.test(paraTras ? trecho.slice(i) : trecho.slice(0, i));   // mesma oração
      });
      // Sinais de rótulo: palavra classificadora logo antes ("estádio N2", "teclas
      // F2", "grupo N2") ou código do MESMO elemento com outro dígito na mesma
      // oração ("O1, O2 e O3", "2F1 + 2F2", "T2 → T1").
      const rotulo = /(?:est[áa]dios?|est[áa]gios?|sono|linfonodos?|tumor|grupos?|itens|item|teclas?|modelos?|galaxy|n[íi]ve(?:l|is)|fases?|categorias?|intervalos?|op[çc](?:[ãa]o|[õo]es)|alternativas?|amostras?|se[çc][ãa]o|quest[ãa]o|turmas?|salas?|s[ée]ries?|for[çc]as?|normais|normal|tens[õo]es|tens[ãa]o|testes?|linhas?|colunas?|pontos?|v[ée]rtices?)\s*\d{0,3}\s*$/i.test(antesTxt) ||
        // — "código irmão": mesmo elemento + outro dígito, na mesma oração (30
        //   caracteres para trás ou para a frente), que NÃO seja ele próprio fórmula
        //   da lista ("O1", "N1", "F3", "T1", "2F1" contam; "O3" ao lado de "O2" é ozônio).
        temIrmao(antesTxt.slice(Math.max(0, antesTxt.length - 30)), true) || temIrmao(depoisTxt.slice(0, 30), false);
      if (tok === "H2") {
        // H2 (gás) É TAMBÉM o código da habilidade H2 da Matriz.
        const vizinhoCodigo = /\bH\d{1,2}[\s,+→]*(?:e\s+)?$/.test(antesTxt) || /^[\s,+]*(?:e\s+)?H\d{1,2}(?![\p{L}\p{Nd}(])/u.test(depoisTxt);
        const palavraCodigo = rotulo || /(?:habilidades?|compet[êe]ncias?|matriz|c[óo]digos?)\b[^.;\n]{0,40}$/i.test(antesTxt) ||
          /^\s*[:–—-]\s+\p{Lu}/u.test(depoisTxt) || /^\([a-z]\)/.test(depoisTxt) ||     // "H2: Identificar", "H2 – Reconhecer", "H2(a)" — mas "H2: 30000 mol" é gás
          (antes === "(" && /^\)\s+\p{Lu}/u.test(depoisTxt));                          // "(H2) Identificar" — mas "(H2) e oxigênio" é gás
        if (vizinhoCodigo && !estado) return m0;            // "H1, H2 e H3", "H2 + H3", "H1→H2" — mas "H2 e H2(g)" é gás
        if (disciplina === "Química") { if (palavraCodigo && !equacao) return m0; }
        else if (!equacao) return m0;                        // Biologia e Física: só em equação
      } else {
        const sempre = (QN_GASES_SEMPRE[disciplina] || []).includes(tok);
        if (sempre ? (rotulo && !equacao) : (!equacao || rotulo)) return m0;
      }
    }
    return antes + mapa.get(tok);
  });
}

const QN_CAMPOS_TEXTO: string[] = ["tema", "textoBase", "fonte", "comando", "resolucaoComentada"];
function normalizarNotacaoQuimica(data: any, _area: string, disciplina: string): any {
  // v71: roda em todas as áreas (a tabela por disciplina decide o quanto converte).
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const N = (t: string) => normalizarNotacaoTexto(t, disciplina);
  const saida: any = { ...data };
  for (const c of QN_CAMPOS_TEXTO) if (typeof saida[c] === "string") saida[c] = N(saida[c]);
  if (saida.alternativas && typeof saida.alternativas === "object" && !Array.isArray(saida.alternativas)) {
    saida.alternativas = { ...saida.alternativas };
    for (const L of Object.keys(saida.alternativas)) if (typeof saida.alternativas[L] === "string") saida.alternativas[L] = N(saida.alternativas[L]);
  }
  if (saida.analiseAlternativas && typeof saida.analiseAlternativas === "object" && !Array.isArray(saida.analiseAlternativas)) {
    saida.analiseAlternativas = { ...saida.analiseAlternativas };
    for (const L of Object.keys(saida.analiseAlternativas)) {
      const a = saida.analiseAlternativas[L];
      if (a && typeof a === "object" && typeof a.comentario === "string") saida.analiseAlternativas[L] = { ...a, comentario: N(a.comentario) };
    }
  }
  if (saida.visual && typeof saida.visual === "object" && !Array.isArray(saida.visual)) saida.visual = normalizarNotacaoVisual(saida.visual, disciplina);
  return saida;
}
function normalizarNotacaoVisual(visual: any, disciplina: string): any {
  if (!visual || typeof visual !== "object" || Array.isArray(visual)) return visual;
  const N = (t: string) => normalizarNotacaoTexto(t, disciplina);
  const v: any = { ...visual };
  for (const c of ["descricao", "titulo"]) if (typeof v[c] === "string") v[c] = N(v[c]);
  if (Array.isArray(v.labels)) v.labels = v.labels.map((x: any) => (typeof x === "string" ? N(x) : x));
  if (Array.isArray(v.colunas)) v.colunas = v.colunas.map((x: any) => (typeof x === "string" ? N(x) : x));
  if (Array.isArray(v.linhas)) v.linhas = v.linhas.map((l: any) => (Array.isArray(l) ? l.map((x: any) => (typeof x === "string" ? N(x) : x)) : l));
  if (Array.isArray(v.datasets)) v.datasets = v.datasets.map((ds: any) => (ds && typeof ds === "object" && typeof ds.label === "string" ? { ...ds, label: N(ds.label) } : ds));
  return v;
}

export { normalizarNotacaoTexto, normalizarNotacaoQuimica, normalizarNotacaoVisual, qnTabela, qnConverteIon, QN_FORMULAS_COMUNS, QN_FORMULAS_DISCIPLINA, QN_GASES, QN_GASES_SEMPRE, QN_IONS };
