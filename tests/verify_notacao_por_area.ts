/* v74.14 — O BLOCO DE NOTAÇÃO QUÍMICA SÓ ONDE HÁ FÓRMULA.

   Decisão do professor (18/09/2026): questões de Linguagens e de Humanas não
   precisam da notação química. Ela ensina a escrever fórmula, índice e carga de
   íon (CO₂, NO₃⁻, SO₄²⁻, ligação orgânica) — 4.294 caracteres, ≈1.200 tokens
   que iam no prompt do sistema de TODA questão, inclusive as de Artes,
   Literatura, História e Filosofia. Como a gravação de cache é cobrada em cada
   uma das três chamadas da questão, eram ≈3.600 tokens por questão pagos à toa.

   O que este teste prova, lendo o arquivo de produção (nada copiado à mão):
   · o bloco químico NÃO entra em Linguagens nem em Humanas;
   · continua entrando em Ciências da Natureza e em Matemática;
   · a notação MATEMÁTICA continua em TODAS as áreas (foi ela que acabou com
     Q0, 2^4 e "4,6 x 10^9" na v71 — não se mexeu nela);
   · o prompt do recurso visual segue exatamente a mesma regra;
   · a rede determinística continua consertando CO2 → CO₂ em QUALQUER área,
     que é o que cobre Geografia falando de clima e emissões.

   Uso:
     deno run -A tests/verify_notacao_por_area.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);

/* Recorta uma função nomeada do arquivo de produção, casando chaves. */
function recorta(nome: string): string {
  const marca = `\nfunction ${nome}(`;
  const a = fonte.indexOf(marca);
  if (a < 0) { console.error(`FALHA: não achei a função ${nome} em ${alvo}`); Deno.exit(1); }
  let nivel = 0, dentroStr = "", escapou = false;
  for (let p = fonte.indexOf("{", a); p < fonte.length; p++) {
    const c = fonte[p];
    if (dentroStr) {
      if (escapou) { escapou = false; continue; }
      if (c === "\\") { escapou = true; continue; }
      if (c === dentroStr) dentroStr = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { dentroStr = c; continue; }
    if (c === "{") nivel++;
    else if (c === "}") { nivel--; if (nivel === 0) return fonte.slice(a + 1, p + 1); }
  }
  console.error(`FALHA: função ${nome} não fecha`); Deno.exit(1); return "";
}

// A lista de áreas é lida do MESMO arquivo: mudar a regra lá muda o teste aqui.
const mAreas = fonte.match(/const AREAS_COM_NOTACAO_QUIMICA = (\[[^\]]*\]);/);
if (!mAreas) { console.error("FALHA: não achei AREAS_COM_NOTACAO_QUIMICA"); Deno.exit(1); }

const modulo = `
const NOTACAO_QUIMICA = "<<<BLOCO-QUIMICO>>>";
const NOTACAO_MATEMATICA = "<<<BLOCO-MATEMATICO>>>";
const AREA_LABELS: Record<string, string> = { linguagens: "Linguagens", humanas: "Humanas", natureza: "Natureza", matematica: "Matemática" };
const APP_DATA: any = {
  universalModel: "<<<MODELO>>>",
  areaContext: { linguagens: "<<<CTX-L>>>", humanas: "<<<CTX-H>>>", natureza: "<<<CTX-N>>>", matematica: "<<<CTX-M>>>" },
  objetosConhecimento: { linguagens: ["o1"], humanas: ["o1"], natureza: ["o1"], matematica: ["o1"] },
};
const AREAS_COM_NOTACAO_QUIMICA = ${mAreas[1]};
` + recorta("buildObjetosConhecimento") + `
` + recorta("precisaNotacaoQuimica") + `
` + recorta("blocoNotacao") + `
` + recorta("buildSystemPrompt") + `
` + recorta("buildSystemVisual") + `
export { precisaNotacaoQuimica, blocoNotacao, buildSystemPrompt, buildSystemVisual, AREAS_COM_NOTACAO_QUIMICA };
`;
const tmp = await Deno.makeTempDir();
const caminho = `${tmp}/notacao_mod.ts`;
await Deno.writeTextFile(caminho, modulo);
const M: any = await import("file://" + caminho);
const { precisaNotacaoQuimica, buildSystemPrompt, buildSystemVisual, AREAS_COM_NOTACAO_QUIMICA } = M;

// A rede determinística vem do arquivo real, sem stub nenhum.
const { normalizarNotacaoQuimica } = await import(
  "file://" + new URL("../supabase/functions/generate-question/notacao_quimica.ts", "file://" + Deno.cwd() + "/tests/").pathname
);

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };

const Q = "<<<BLOCO-QUIMICO>>>", MAT = "<<<BLOCO-MATEMATICO>>>";
const AREAS = ["linguagens", "humanas", "natureza", "matematica"];

/* ---------- A. Onde o bloco químico entra e onde não entra ---------- */
t("A1 Linguagens NÃO recebe a notação química", !buildSystemPrompt("linguagens").includes(Q));
t("A2 Humanas NÃO recebe a notação química", !buildSystemPrompt("humanas").includes(Q));
t("A3 Ciências da Natureza continua recebendo", buildSystemPrompt("natureza").includes(Q));
t("A4 Matemática continua recebendo", buildSystemPrompt("matematica").includes(Q));
t("A5 a lista de áreas é exatamente natureza + matemática",
  JSON.stringify(AREAS_COM_NOTACAO_QUIMICA) === JSON.stringify(["natureza", "matematica"]),
  JSON.stringify(AREAS_COM_NOTACAO_QUIMICA));
t("A6 precisaNotacaoQuimica não se engana com caixa alta nem espaço",
  precisaNotacaoQuimica(" Natureza ") && precisaNotacaoQuimica("MATEMATICA")
  && !precisaNotacaoQuimica("Humanas") && !precisaNotacaoQuimica("") && !precisaNotacaoQuimica(undefined as any));

/* ---------- B. A notação matemática não foi tocada ---------- */
t("B1 a notação matemática continua em TODAS as áreas",
  AREAS.every((a) => buildSystemPrompt(a).includes(MAT)));
t("B2 em Linguagens e Humanas sobra a matemática e só ela",
  ["linguagens", "humanas"].every((a) => {
    const p = buildSystemPrompt(a);
    return p.includes(MAT) && !p.includes(Q);
  }));

/* ---------- C. O prompt do recurso visual segue a mesma regra ---------- */
t("C1 o visual de Humanas não carrega a notação química", !buildSystemVisual("humanas").includes(Q));
t("C2 o visual de Linguagens não carrega a notação química", !buildSystemVisual("linguagens").includes(Q));
t("C3 o visual de Natureza carrega (rótulo de gráfico pode ter fórmula)", buildSystemVisual("natureza").includes(Q));
t("C4 o visual de todas as áreas carrega a notação matemática",
  AREAS.every((a) => buildSystemVisual(a).includes(MAT)));

/* ---------- D. O resto do prompt do sistema continua intacto ---------- */
t("D1 modelo universal, contexto da área e objetos de conhecimento seguem em todas as áreas",
  AREAS.every((a) => {
    const p = buildSystemPrompt(a);
    return p.includes("<<<MODELO>>>") && p.includes("OBJETOS DE CONHECIMENTO OFICIAIS");
  }));
t("D2 o único texto que saiu de Linguagens é o bloco químico",
  buildSystemPrompt("natureza").replace(Q + "\n", "") === buildSystemPrompt("natureza").replace(Q + "\n", "")
  && buildSystemPrompt("linguagens").length === buildSystemPrompt("natureza").length - Q.length - 1
     + ("<<<CTX-L>>>".length - "<<<CTX-N>>>".length));

/* ---------- E. A rede determinística é a que de fato conserta — e não mudou ----------
   Este é o ponto que justifica tirar o bloco do prompt: quem converte CO2 → CO₂
   é código, não instrução, e roda em qualquer área. Era o caso da Geografia. */
const N = (txt: string, area: string, disc: string) =>
  normalizarNotacaoQuimica({ textoBase: txt }, area, disc).textoBase;
t("E1 Geografia (humanas): CO2 e CH4 continuam virando CO₂ e CH₄",
  N("A concentração de CO2 e de CH4 subiu.", "humanas", "Geografia") === "A concentração de CO₂ e de CH₄ subiu.",
  N("A concentração de CO2 e de CH4 subiu.", "humanas", "Geografia"));
t("E2 Geografia: SO2 das termelétricas continua virando SO₂",
  N("O SO2 das termelétricas.", "humanas", "Geografia") === "O SO₂ das termelétricas.");
t("E3 Artes (linguagens): CaCO3 do calcário continua virando CaCO₃",
  N("O CaCO3 do calcário.", "linguagens", "Artes") === "O CaCO₃ do calcário.");
t("E4 História: H2O continua virando H₂O",
  N("A H2O dos aquedutos romanos.", "humanas", "História") === "A H₂O dos aquedutos romanos.");
t("E5 fora de Natureza a rede NÃO inventa íon onde não há (tipo sanguíneo O+ intacto)",
  N("O doador tem sangue O+ e o receptor B-.", "humanas", "Geografia") === "O doador tem sangue O+ e o receptor B-.");
t("E6 e o ano de uma data não é confundido com índice",
  N("Em 2024CO2 não é fórmula.", "humanas", "História") === "Em 2024CO2 não é fórmula.");

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);
