/* v74.6 — CONFERÊNCIA DA RESPOSTA NO BACKEND (generate-question).

   Prova o caminho de reparo do index.ts SEM chamar a Anthropic: o teste extrai
   do próprio arquivo de produção o trecho que vai de conferenciaGabarito() até
   garantirGabaritoCoerente() e substitui APENAS as dependências externas
   (callClaudeForJSON, normalizarCamposEstruturados, textoDeEspecificacao) por
   dublês controláveis. O código conferido é o que roda em produção — nada é
   reescrito à mão aqui.

   Uso:
     deno run --allow-read --allow-write --allow-env \
       tests/verify_gabarito_backend.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
const i = fonte.indexOf("function conferenciaGabarito");
const j = fonte.indexOf("function fnv1a");
if (i < 0 || j < 0 || j < i) { console.error("FALHA: não achei o bloco da conferência em " + alvo); Deno.exit(1); }
const modulo = `const LETRAS_ALTERNATIVAS = ["A","B","C","D","E"];
type SistemaPrompt = any;
const LIMITE_FUNCAO_MS = 140_000;
function textoDeEspecificacao(v: unknown): string { return typeof v === "string" ? v : JSON.stringify(v ?? ""); }
function normalizarCamposEstruturados(data: any): any { return data; }
export const __stub: any = { resposta: null, erro: null, chamadas: 0, ultimoPrompt: "" };
async function callClaudeForJSON(_s: any, userMsg: string, _w: any, usos: any[], _f: any) {
  __stub.chamadas++; __stub.ultimoPrompt = userMsg;
  if (usos) usos.push({ input_tokens: 1, output_tokens: 1 });
  if (__stub.erro) throw new Error(__stub.erro);
  return __stub.resposta;
}
` + fonte.slice(i, j) + `
export { conferenciaGabarito, letraNaResolucao, buildConferenciaGabaritoPrompt, garantirGabaritoCoerente, FERRAMENTA_GABARITO };
`;
const tmp = await Deno.makeTempDir();
const caminho = `${tmp}/rep_mod.ts`;
await Deno.writeTextFile(caminho, modulo);
const M: any = await import("file://" + caminho);
const { garantirGabaritoCoerente, conferenciaGabarito, letraNaResolucao, __stub } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const an = (c: string) => { const o: any = {}; for (const L of ["A","B","C","D","E"]) o[L] = { status: L === c ? "correta" : "incorreta", comentario: "c" + L }; return o; };
const alts = { A: "10⁻³", B: "10⁻¹", C: "10²", D: "10³", E: "10⁴" };
const q = (gab: string, naAnalise?: string, reso?: string) => ({
  textoBase: "Duas plantas da mesma praça em escalas 1:10² e 1:10³.",
  comando: "A razão entre as áreas ocupadas pela praça nas duas plantas é de",
  alternativas: { ...alts }, gabarito: gab,
  resolucaoComentada: reso ?? ("A razão linear é 10 e a de áreas é o quadrado dela, 10². Portanto, a alternativa correta é a " + gab + "."),
  analiseAlternativas: an(naAnalise || gab),
});
const reset = () => { __stub.chamadas = 0; __stub.erro = null; __stub.resposta = null; };
const silencio = { log: console.log, warn: console.warn, error: console.error };
const cala = () => { console.warn = () => {}; console.error = () => {}; };
const fala = () => { console.warn = silencio.warn; console.error = silencio.error; };

/* ---------- leitura da conferência ---------- */
t("A1 questão coerente é lida como coerente", conferenciaGabarito({ gabarito: "C", analiseAlternativas: an("C") }).estado === "ok");
t("A2 DEFEITO RELATADO (gabarito C, análise D): divergente e nenhuma letra escolhida",
  conferenciaGabarito({ gabarito: "C", analiseAlternativas: an("D") }).estado === "divergente" &&
  conferenciaGabarito({ gabarito: "C", analiseAlternativas: an("D") }).letra === null);
t("A3 leitura da resolução é estrita: 'é a Cinemática' não vira letra C",
  letraNaResolucao("A alternativa correta é a Cinemática do movimento.") === null);
t("A4 menção a distrator não conta como gabarito",
  letraNaResolucao("A alternativa B confunde área com perímetro; a D usa escala linear.") === null);
t("A5 duas letras pelos padrões estritos: ambíguo, não acusa divergência",
  letraNaResolucao("Gabarito: C. Mas a alternativa correta é a D.") === null);

/* ---------- caminho de reparo ---------- */
cala();
reset();
let d: any = q("C");
let r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B1 questão saudável não gasta NENHUMA chamada extra", r.estado === "ok" && r.letra === "C" && __stub.chamadas === 0 && !d.gabaritoInconsistente, JSON.stringify(r));

reset();
__stub.resposta = { gabarito: "C", resolucaoComentada: "A razão entre as áreas é 10². A alternativa correta é a C.", analiseAlternativas: an("C") };
d = q("C", "D");
const antesAlts = JSON.stringify(d.alternativas);
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B2 o defeito relatado é reparado com UMA chamada", r.estado === "ok" && r.reparado === true && r.chamadas === 1 && d.gabarito === "C", JSON.stringify(r));
t("B3 o reparo NÃO toca no texto das alternativas (ordem numérica e paridade preservadas)", JSON.stringify(d.alternativas) === antesAlts);
t("B4 depois do reparo a análise marca só a letra do gabarito", d.analiseAlternativas.C.status === "correta" && d.analiseAlternativas.D.status === "incorreta");
t("B5 a questão reparada não sai marcada como inconsistente", !d.gabaritoInconsistente);
t("B6 o prompt de conferência manda RESOLVER do zero e proíbe alterar as alternativas",
  __stub.ultimoPrompt.includes("RESOLVA a questão abaixo do zero") && __stub.ultimoPrompt.includes("NÃO pode ser alterado"));
t("B7 o prompt de conferência exclui letra planejada e distribuição da decisão",
  __stub.ultimoPrompt.includes("Nenhuma letra planejada"));

reset();
__stub.resposta = { gabarito: "D", resolucaoComentada: "Refazendo a conta, a alternativa correta é a D.", analiseAlternativas: an("D") };
d = q("C", "E");
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B8 vale o que a resolução do CONTEÚDO apontou, mesmo mudando a letra registrada",
  r.estado === "ok" && d.gabarito === "D" && d.analiseAlternativas.D.status === "correta", JSON.stringify(r));

reset();
__stub.resposta = { gabarito: "", resolucaoComentada: "Nenhuma das cinco fecha.", analiseAlternativas: an("Z") };
d = q("C", "D");
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B9 sem alternativa defensável: divergente e questão marcada (não é entregue como boa)",
  r.estado === "divergente" && !!d.gabaritoInconsistente, JSON.stringify(r));

reset();
__stub.resposta = { gabarito: "B", resolucaoComentada: "x", analiseAlternativas: an("E") };
d = q("C", "D");
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B10 reparo que volta incoerente não é aceito", r.estado === "divergente" && !!d.gabaritoInconsistente, JSON.stringify(r));

reset();
__stub.resposta = { gabarito: "C", resolucaoComentada: "Portanto, a alternativa correta é a E.", analiseAlternativas: an("C") };
d = q("C", "D");
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B11 reparo cuja resolução aponta outra letra não é aceito", r.estado === "divergente", JSON.stringify(r));

reset();
__stub.resposta = { gabarito: "C", resolucaoComentada: "A alternativa correta é a C.", analiseAlternativas: an("C") };
d = q("C", "C", "Refazendo, a alternativa correta é a E.");
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B12 resolução concluindo outra letra também dispara a conferência",
  __stub.chamadas === 1 && r.estado === "ok" && r.reparado === true, JSON.stringify(r));

reset();
d = q("C", "D");
r = await garantirGabaritoCoerente(d, [], [], 10_000);
t("B13 com pouco tempo o backend não chama nada, marca a questão e devolve",
  __stub.chamadas === 0 && r.estado === "divergente" && !!r.pulado && !!d.gabaritoInconsistente, JSON.stringify(r));

reset();
__stub.erro = "rede fora";
d = q("C", "D");
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B14 falha de rede na conferência não derruba a geração", r.estado === "divergente" && String(r.erro).includes("rede fora"), JSON.stringify(r));

reset();
__stub.resposta = { gabarito: "C", resolucaoComentada: "A alternativa correta é a C.", analiseAlternativas: an("C") };
d = q("C"); for (const L of ["A","B","C","D","E"]) delete (d.analiseAlternativas as any)[L].status;
r = await garantirGabaritoCoerente(d, [], [], 120_000);
t("B15 análise sem 'status' é tratada como defeito e reparada",
  __stub.chamadas === 1 && r.estado === "ok" && d.analiseAlternativas.C.status === "correta");
fala();

await Deno.remove(tmp, { recursive: true });
console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
Deno.exit(bad ? 1 : 0);
