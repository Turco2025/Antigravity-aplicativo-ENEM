/* v74.19 — EXTENSÃO NO PADRÃO DO ENEM (19/09/2026).

   Prova, no arquivo de produção e sem chamar a Anthropic, o conserto das duas
   causas medidas:

     A. o alvo de tamanho deixou de ser a necessidade da alternativa correta e
        passou a ser a calibração das provas reais
     B. a dificuldade está declarada como independente do tamanho
     C. o teto viaja também no schema da ferramenta de entrega
     D. e no prompt do usuário, onde a questão é escrita
     E. a calibração continua batendo com a medição das provas oficiais

   Medição que motivou tudo (tests/medir_provas_reais.py sobre os PDFs oficiais
   do INEP, quatro provas recentes — 2022 a 2025): a alternativa real tem 58
   caracteres em Linguagens e 38 em Humanas; o app gerava 104 em Artes, 116 em
   História e 125 em Biologia, e a de nível "difícil" saía 26% maior que a
   "fácil". Conferência cruzada com um extrator independente, nas provas de
   2022-2023: Linguagens 46/59/70 contra 47/59/70, Humanas idêntico.

   Uso:
     deno run -A tests/verify_extensao_v7419.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const src = await Deno.readTextFile(alvo);

function recorta(nome: string): string {
  const i = src.indexOf(`function ${nome}(`);
  if (i < 0) return "";
  let p = src.indexOf("(", i), np = 0, q = p;
  for (; q < src.length; q++) {
    if (src[q] === "(") np++;
    else if (src[q] === ")") { np--; if (np === 0) break; }
  }
  let k = src.indexOf("{", q), n = 0;
  for (let z = k; z < src.length; z++) {
    if (src[z] === "{") n++;
    else if (src[z] === "}") { n--; if (n === 0) { k = z; break; } }
  }
  return src.slice(i, k + 1);
}
let ok = 0, bad = 0;
const t = (n: string, c: boolean, d = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (d ? "  → " + d : "")); } };

/* ---------- A. o alvo vem da calibração, não da alternativa correta ---------- */
const regra = recorta("buildRegraAlternativas");
t("A1 a regra das alternativas existe", regra.length > 500);
t("A2 o alvo passou a ser o da calibração",
  regra.includes("o tamanho NÃO é você que escolhe: é o da CALIBRAÇÃO DE EXTENSÃO acima"));
t("A3 a alternativa correta CABE no alvo — não o define",
  regra.includes("A alternativa CORRETA cabe nessa medida — ela NÃO define o tamanho das outras"));
t("A4 não cabendo, troca-se o RECORTE, não o tamanho",
  regra.includes("o problema não é o tamanho: é o RECORTE")
  && regra.includes("Escolha outro recorte do mesmo objeto de conhecimento"));
/* a frase antiga só pode sobrar como asserção negativa do autoteste — no texto
   que vai ao modelo ela não existe mais */
t("A5 a âncora antiga saiu do texto que vai ao modelo",
  !regra.includes("a que a alternativa correta precisa para ficar completa e sem sobra"));
t("A6 igualar continua sendo ENCURTAR, nunca alongar",
  regra.includes("ENCURTE-A") && regra.includes("nunca alongue as outras para alcançá-la"));

/* ---------- B. dificuldade não é tamanho ---------- */
t("B1 o item novo está lá, com o número e a renumeração certa",
  regra.includes("5. A DIFICULDADE NÃO É TAMANHO")
  && regra.includes("6. FORMA IGUAL PARA AS CINCO")
  && regra.includes("7. COERÊNCIA DA RESPOSTA"));
t("B2 diz que os três níveis usam a mesma extensão",
  regra.includes("MESMA extensão de alternativa e de texto-base"));
t("B3 diz de onde a dificuldade vem de verdade",
  regra.includes("número de etapas de raciocínio")
  && regra.includes("proximidade do distrator")
  && regra.includes("nunca do volume de texto"));
t("B4 traz a medição que justifica a regra",
  regra.includes("26% maior") && regra.includes("Artes 93 → 117"));

/* ---------- C. o teto no schema da ferramenta ---------- */
const tetos = recorta("tetosDaDisciplina");
t("C1 tetosDaDisciplina lê a calibração e aplica o piso de 45",
  tetos.includes("findCalibracaoKey(disciplina)") && tetos.includes("Math.max(c.item[1], 45)"));
t("C2 a ferramenta de entrega recebe a disciplina",
  /function ferramentaQuestaoPara\(recurso: string, exigeFonte = false, disciplina = ""\)/.test(src));
t("C3 cada alternativa ganha maxLength e o alvo na descrição",
  src.includes("maxLength: t.item") && src.includes("Alvo ~${t.alvoItem} caracteres, teto ${t.item}")
  && src.includes("properties: { A: alt(\"A\"), B: alt(\"B\"), C: alt(\"C\"), D: alt(\"D\"), E: alt(\"E\") }"));
t("C4 texto-base e comando também ganham teto",
  src.includes("maxLength: t.texto") && src.includes("maxLength: t.comando"));
t("C5 a descrição da alternativa repete que dificuldade não muda o número",
  src.includes("O nível de dificuldade não altera este número"));
t("C6 as chamadas de geração passam a disciplina (rascunho, retentativa e, desde a v74.23, a reelaboração)",
  (src.match(/ferramentaQuestaoPara\(recurso, fontesReaisEstrito\(area\), disciplina\)/g) || []).length === 3);

/* ---------- D. o alvo no prompt do usuário ---------- */
const alvoFn = recorta("buildAlvoExtensao");
t("D1 buildAlvoExtensao existe e usa os tetos da disciplina",
  alvoFn.includes("tetosDaDisciplina(disciplina)") && alvoFn.includes("EXTENSÃO DESTA QUESTÃO"));
t("D2 manda CONTAR antes de entregar", alvoFn.includes("CONTE antes de entregar"));
t("D3 repete que o nível pedido não altera os números",
  alvoFn.includes("NÃO altera nenhum destes números"));
t("D4 entra no prompt do usuário antes da ordem de entregar",
  src.includes("${buildAlvoExtensao(opts.disciplina, opts.dificuldade)}")
  && src.indexOf("${buildAlvoExtensao(opts.disciplina, opts.dificuldade)}") < src.indexOf('Entregue a questão chamando a ferramenta "entregar_questao"'));
t("D5 disciplina sem calibração não ganha bloco nenhum", alvoFn.includes('if (!t) return "";'));

/* ---------- E. a calibração bate com as provas oficiais ---------- */
const m = src.match(/const CALIBRACAO_EXTENSAO[\s\S]*?\n\};/);
const tabela = m ? m[0] : "";
t("E1 a tabela continua no arquivo", tabela.length > 500);
/* v74.20: a faixa das alternativas passou a sair só das provas de 2022 a 2025
   (2021 fora — PDF com fonte quebrada), por grupo e não por disciplina. */
for (const [disc, item] of [["Artes", "[46, 69, 58]"], ["História", "[28, 46, 38]"],
                            ["Biologia", "[12, 46, 33]"], ["Matemática", "[3, 10, 10]"]] as [string, string][]) {
  t(`E2 ${disc} com a faixa das provas recentes ${item}`, tabela.includes(`"${disc}"`) && tabela.includes(`item: ${item}`));
}
// item: [number, number, number] da assinatura não conta — só as linhas com números
t("E2b toda disciplina tem o teto do aviso (p90 da média das cinco)",
  (tabela.match(/avisoMedia: \d+/g) || []).length === 14
  && (tabela.match(/item: \[\d/g) || []).length === 14,
  `avisoMedia=${(tabela.match(/avisoMedia: \d+/g) || []).length} item=${(tabela.match(/item: \[\d/g) || []).length}`);
t("E2c o prompt cita as quatro provas recentes, não 2015-2025",
  src.includes("2022, 2023, 2024 e 2025") && !/nas provas do ENEM 2015-2025/.test(src));
t("E3 o medidor das provas reais está versionado",
  (() => { try { return Deno.statSync("tests/medir_provas_reais.py").size > 2000; } catch { return false; } })());
t("E4 o autoteste de produção cobre a v74.19",
  ["v7419_alvoVemDaCalibracao", "v7419_dificuldadeNaoEhTamanho", "v7419_tetosPorDisciplina",
   "v7419_tetoNoSchema", "v7419_alvoNaMensagemDoUsuario"].every((k) => src.includes(k + ":")));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);
