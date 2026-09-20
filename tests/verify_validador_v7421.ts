/* v74.21 — O LAÇO PESQUISADOR → VALIDADOR → (elaborador), SEM CHAMAR A ANTHROPIC.

   A seção M de verify_fontes_backend.ts prova as peças (lista negra, nível por
   domínio, conferência prévia, trava em código, prompts, ferramenta). Este
   arquivo prova o COMPORTAMENTO do laço de pesquisarFonteReal com dublês
   roteirizados no lugar de callClaudeForJSON:
     A. rodada 1 restrita aos acervos (allowed_domains), rodada 2 aberta
     B. dossiê aprovado volta com validação e "fonte aberta" vinda do código
     C. reprovação do validador leva o motivo à rodada 2
     D. duas reprovações → objeto bloqueado (encontrou:false) — a questão não é gerada
     E. conferência prévia reprova sem gastar a chamada do validador
     F. sem tempo, não abre rodada 2 nem valida
     G. ferramenta do validador recusada pela API → repete a rodada sem ferramenta
     H. fora de Linguagens/Humanas nada muda (null)

   Uso: deno run -A tests/verify_validador_v7421.ts supabase/functions/generate-question/index.ts */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);

function fatiar(ini: string, fim: string): string {
  const a = fonte.indexOf(ini), b = fonte.indexOf(fim, a);
  if (a < 0 || b < 0) { console.error(`FALHA: não achei o trecho ${ini.slice(0, 40)} … ${fim.slice(0, 40)}`); Deno.exit(1); }
  return fonte.slice(a, b);
}
function recortaConstArray(nome: string): string {
  const m = fonte.match(new RegExp(`const ${nome}: string\\[\\] = (\\[[^;]*?\\]);`, "s"));
  if (!m) { console.error(`FALHA: não achei ${nome}`); Deno.exit(1); }
  return `const ${nome}: string[] = ${m[1]};`;
}
const mAcervos = fonte.match(/const ACERVOS_PRIORITARIOS: \{ nome: string; url: string; dominio: string \}\[\] = (\[[^;]*?\]);/s)!;

// O bloco do validador inteiro + pesquisarFonteReal, como estão no arquivo de produção.
const blocoValidador = fatiar("/* ═══════════ v74.21 — AGENTE VALIDADOR DE FONTES E EVIDÊNCIAS", "/* ═══════════ FIM DO BLOCO DO VALIDADOR");
const pesquisar = fatiar("async function pesquisarFonteReal(", "/* v74.23 — ÚLTIMO RECURSO");
// níveis por domínio + consulta combinada + DISCIPLINAS_COM_ACERVO_PRIORITARIO + buildAcervosPrioritarios + buildPesquisaFontePrompt + buildDossieFonte, reais
const dominios = fatiar("const ORDEM_NIVEL = ", "\n/* ═══════════ v74.21 — AGENTE VALIDADOR");
const acervosFns = fatiar("function hostDaUrl(", "const DOMINIOS_VETADOS");                          // hostDaUrl, ehDominioDeAcervo, acervoFoiConsultado
const normalizaUrl = fatiar("function normalizaUrl(", "\nfunction conferenciaFontes(");

const modulo = `type SistemaPrompt = any;
type FetchRegistro = { url: string; ok: boolean; erro: string };
const LIMITE_FUNCAO_MS = 140_000;
const AREA_LABELS: Record<string, string> = { linguagens: "Linguagens", humanas: "Humanas", natureza: "Natureza" };
const AREAS_FONTES_REAIS_ESTRITO = ["linguagens", "humanas"];
function fontesReaisEstrito(area: string) { return AREAS_FONTES_REAIS_ESTRITO.includes(String(area || "").toLowerCase()); }
function cacheControlAtual() { return { type: "ephemeral" }; }
const SISTEMA_PESQUISA_FONTE = "sistema do pesquisador";
const FERRAMENTA_DOSSIE_FONTE = { name: "entregar_dossie_fonte" };
/* v74.23 — dublê do banco de fontes validadas: devolve o que o teste puser em __banco.resposta e registra o que foi guardado */
export const __banco: any = { resposta: null, consultas: [] as any[], guardados: [] as any[] };
async function consultarBancoFontes(o: any, evitar: string[]) { __banco.consultas.push({ o, evitar: [...evitar] }); return __banco.resposta; }
async function guardarNoBancoFontes(o: any, d: any) { __banco.guardados.push({ o, d }); }
const ACERVOS_PRIORITARIOS: { nome: string; url: string; dominio: string }[] = ${mAcervos[1]};
const DOMINIOS_ACERVO_PRIORITARIO: string[] = Array.from(new Set(ACERVOS_PRIORITARIOS.map((a) => a.dominio)));
${recortaConstArray("DOMINIOS_VETADOS")}
${recortaConstArray("DOMINIOS_NIVEL_A")}
${recortaConstArray("DOMINIOS_NIVEL_B")}
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", blocked_domains: DOMINIOS_VETADOS, max_uses: 3 };
const BUSCA_PESQUISADOR_ACERVOS = { type: WEB_SEARCH_TOOL.type, name: WEB_SEARCH_TOOL.name, allowed_domains: DOMINIOS_ACERVO_PRIORITARIO, max_uses: 1 };
const BUSCA_PESQUISADOR = { ...WEB_SEARCH_TOOL, max_uses: 1 };
const BUSCA_PESQUISADOR_RETRY = { ...WEB_SEARCH_TOOL, max_uses: 1 };
${normalizaUrl}
${acervosFns}
${dominios}
${blocoValidador}
${pesquisar}
/* dublê roteirizado: cada chamada consome a próxima resposta da fila */
export const __stub: any = { fila: [] as any[], chamadas: [] as any[] };
async function callClaudeForJSON(_s: any, userMsg: string, ferramentaServidor: any, usos: any[], ferramenta: any, buscas?: any[], etapa = "", fetches?: any[], _timeoutMs?: number) {
  const passo = __stub.fila.shift();
  __stub.chamadas.push({ etapa, ferramentaServidor, ferramentaNome: ferramenta && ferramenta.name, userMsg });
  if (usos) usos.push({ input_tokens: 1, output_tokens: 1, etapa });
  if (!passo) throw new Error("fila do dublê vazia em " + etapa);
  if (passo.erro) throw new Error(passo.erro);
  if (buscas && Array.isArray(passo.buscas)) buscas.push(...passo.buscas);
  if (fetches && Array.isArray(passo.fetches)) fetches.push(...passo.fetches);
  return passo.resposta;
}
export { pesquisarFonteReal, liberaGeracao, liberaRestritoAoConfirmado, conferenciaPreviaDossie, MODO_VALIDADOR, DOMINIOS_VETADOS, RODADAS_VALIDACAO, MS_MINIMO_PARA_VALIDAR, MS_MINIMO_PARA_SEGUNDA_RODADA, REELABORACOES_MAX };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/mod.ts`, modulo);
const M: any = await import("file://" + `${tmp}/mod.ts`);
const { pesquisarFonteReal, __stub, __banco, MODO_VALIDADOR } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const roteiro = (...passos: any[]) => { __stub.fila = passos; __stub.chamadas = []; };
const URL_ACERVO = "https://bndigital.bn.gov.br/dossies/modernismo";
const URL_FORA = "https://enciclopedia.itaucultural.org.br/pessoas/1";
const dossieBom = (url = URL_ACERVO) => ({ encontrou: true, autor: "", instituicao: "Biblioteca Nacional", obra: "Dossiê", ano: "1922", referencia: "BIBLIOTECA NACIONAL. Dossiê.", url, trecho: "Trecho real do acervo.", trechoEhLiteral: true, abriuAFonte: true, comoVerificou: "busca" });
const vAprovado = { status: "aprovado", fonteExiste: true, autorConfirmado: true, obraConfirmada: true, dataConfirmada: "confirmada", referenciaConfere: true, suporteDaEvidencia: "direto", trechoLiteralConfere: "confere", naturezaDoMaterial: "fato_documental", nivelFonte: "A", risco: "alto", confianca: "alta", afirmacoesComSuporte: ["O dossiê é da BN."], afirmacoesSemSuporte: [], divergenciaDocumental: "", correcoesNecessarias: [], observacoesAoElaborador: "", comoVerificou: "abri a página", motivo: "" };
const vReprovado = { ...vAprovado, status: "corrigir", suporteDaEvidencia: "parcial", confianca: "media", correcoesNecessarias: ["confirmar o ano na página"], motivo: "a fonte não sustenta o ano" };
const o = { area: "linguagens", disciplina: "Artes", tema: "Semana de 1922" };
const muitoTempo = () => 140_000;

/* A/B — aprovado na rodada 1, restrita aos acervos, com fonte aberta pelo código */
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "BN" }] },
  { resposta: vAprovado, buscas: [{ url: URL_ACERVO, title: "BN — a própria página" }] },
);
let usos: any[] = [], buscas: any[] = [];
let r = await pesquisarFonteReal(o, usos, buscas, muitoTempo);
t("A1 a rodada 1 de Artes usa a busca RESTRITA aos acervos (allowed_domains), com 1 uso",
  __stub.chamadas[0].etapa === "pesquisa/tentativa-1"
  && JSON.stringify(__stub.chamadas[0].ferramentaServidor.allowed_domains) === JSON.stringify(["bndigital.bn.gov.br", "bbm.usp.br", "buscaintegrada.usp.br", "dominiopublico.gov.br"])
  && !("blocked_domains" in __stub.chamadas[0].ferramentaServidor) && __stub.chamadas[0].ferramentaServidor.max_uses === 1);
t("A2 o prompt da rodada 1 avisa que a restrição é do sistema (e o da rodada 2 não)",
  __stub.chamadas[0].userMsg.includes("RESTRITA, PELO SISTEMA"));
t("B1 o validador roda em seguida, com UMA busca restrita ao host do dossiê (modo busca_no_dominio), sem lista negra e sem busca ampla",
  __stub.chamadas[1].etapa === "validacao/rodada-1" && __stub.chamadas[1].ferramentaNome === "entregar_validacao_fonte"
  && __stub.chamadas[1].ferramentaServidor.name === "web_search" && __stub.chamadas[1].ferramentaServidor.max_uses === 1
  && JSON.stringify(__stub.chamadas[1].ferramentaServidor.allowed_domains) === JSON.stringify(["bndigital.bn.gov.br"])
  && !("blocked_domains" in __stub.chamadas[1].ferramentaServidor) && MODO_VALIDADOR === "busca_no_dominio");
t("B2 o dossiê volta aprovado, com a validação, o nível, as afirmações e 'fonte aberta' = a URL do dossiê apareceu na busca restrita do validador",
  r && r.encontrou === true && r.validacao && r.validacao.libera === true && r.validacao.estado === "aprovado"
  && r.validacao.nivel === "A" && r.validacao.suporte === "direto" && r.validacao.fonteAberta === true && r.abriuAFonte === true
  && r.validacao.afirmacoesComSuporte[0] === "O dossiê é da BN." && r.rodadas === 1 && r.validacao.modo === "busca_no_dominio");
t("B3 duas chamadas no total (pesquisa + validação) e o dossiê veio do acervo (sem marca foraDoAcervo)",
  __stub.chamadas.length === 2 && usos.length === 2 && !r.foraDoAcervo);

/* B4 — sem fetch registrado, 'fonte aberta' é false mesmo que o pesquisador tenha dito que abriu */
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "BN" }] },
  { resposta: vAprovado, fetches: [] },
);
r = await pesquisarFonteReal(o, [], [], muitoTempo);
t("B4 sem a URL do dossiê nos resultados do validador (nem fetch), fonteAberta = false e abriuAFonte do pesquisador é sobrescrito",
  r.validacao.libera === true && r.validacao.fonteAberta === false && r.abriuAFonte === false);

/* C — reprovado na rodada 1, aprovado na 2 (aberta, com lista negra), fonte de fora marcada */
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "BN" }] },
  { resposta: vReprovado, buscas: [{ url: URL_ACERVO, title: "" }] },
  { resposta: dossieBom(URL_FORA), buscas: [{ url: URL_FORA, title: "Itaú Cultural" }] },
  { resposta: { ...vAprovado, nivelFonte: "B" }, buscas: [{ url: URL_FORA, title: "" }] },
);
usos = []; buscas = [];
r = await pesquisarFonteReal(o, usos, buscas, muitoTempo);
t("C1 a rodada 2 recebe o motivo e as correções do validador",
  __stub.chamadas[2].etapa === "pesquisa/tentativa-2"
  && __stub.chamadas[2].userMsg.includes("o validador reprovou o dossiê anterior (a fonte não sustenta o ano)")
  && __stub.chamadas[2].userMsg.includes("confirmar o ano na página"));
t("C2 a rodada 2 busca ABERTA, com a lista negra como blocked_domains e 1 uso",
  JSON.stringify(__stub.chamadas[2].ferramentaServidor.blocked_domains) === JSON.stringify(M.DOMINIOS_VETADOS) && M.DOMINIOS_VETADOS.length > 30
  && __stub.chamadas[2].ferramentaServidor.max_uses === 1 && !("allowed_domains" in __stub.chamadas[2].ferramentaServidor));
t("C3 aprovado na rodada 2: dossiê volta com rodadas = 2, nível B (Itaú Cultural) e marcado como fora do acervo",
  r.encontrou === true && r.validacao.libera === true && r.rodadas === 2 && r.validacao.nivel === "B" && r.foraDoAcervo && r.foraDoAcervo.dominio === "enciclopedia.itaucultural.org.br");
t("C4 quatro chamadas no total (2 pesquisas + 2 validações)", __stub.chamadas.length === 4);

/* D — três reprovações → bloqueado (v74.23: eram duas rodadas; agora três, e as fontes tentadas voltam) */
const URL_TERCEIRA = "https://www.scielo.br/j/terceira";
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "BN" }] },
  { resposta: vReprovado },
  { resposta: dossieBom(URL_FORA), buscas: [{ url: URL_FORA, title: "" }] },
  { resposta: { ...vReprovado, motivo: "citação não localizada", trechoLiteralConfere: "nao_confere" } },
  { resposta: dossieBom(URL_TERCEIRA), buscas: [{ url: URL_TERCEIRA, title: "" }] },
  { resposta: { ...vReprovado, motivo: "autoria não confirmada" } },
);
r = await pesquisarFonteReal(o, [], [], muitoTempo);
t("D1 sem fonte aprovada em TRÊS rodadas, volta encontrou:false + bloqueado:true com o último motivo e as três fontes tentadas",
  r && r.encontrou === false && r.bloqueado === true && r.rodadas === 3 && __stub.chamadas.length === 6
  && String(r.motivo).includes("autoria não confirmada") && r.validacao && r.validacao.libera === false
  && Array.isArray(r.fontesTentadas) && r.fontesTentadas.length === 3 && r.fontesTentadas[0].url === URL_ACERVO && r.fontesTentadas[2].url === URL_TERCEIRA
  && r.fontesTentadas[1].motivo === "citação não localizada");
t("D3 a rodada 3 recebe a lista das fontes já reprovadas nesta chamada (não volta a elas)",
  __stub.chamadas[4].etapa === "pesquisa/tentativa-3" && __stub.chamadas[4].userMsg.includes("FONTES JÁ REPROVADAS PELO VALIDADOR")
  && __stub.chamadas[4].userMsg.includes(URL_ACERVO) && __stub.chamadas[4].userMsg.includes(URL_FORA)
  && !__stub.chamadas[0].userMsg.includes("FONTES JÁ REPROVADAS"));
t("D2 um objeto bloqueado NÃO passa por dossiê válido (encontrou !== true)", !(r.encontrou === true));

/* E — conferência prévia reprova sem chamar o validador */
roteiro(
  { resposta: dossieBom("https://x.blogspot.com/post"), buscas: [{ url: "https://x.blogspot.com/post", title: "" }] },
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },
  { resposta: vAprovado, buscas: [{ url: URL_ACERVO, title: "" }] },
);
r = await pesquisarFonteReal(o, [], [], muitoTempo);
t("E1 domínio vetado reprova na conferência prévia, sem gastar a chamada do validador, e a rodada 2 recebe o motivo",
  __stub.chamadas.length === 3 && __stub.chamadas[1].etapa === "pesquisa/tentativa-2"
  && __stub.chamadas[1].userMsg.includes("nível D") && r.validacao.libera === true && r.rodadas === 2);
roteiro(
  { resposta: dossieBom("https://bndigital.bn.gov.br/outra"), buscas: [{ url: "https://outro.org/z", title: "" }] },
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },
  { resposta: vAprovado },
);
r = await pesquisarFonteReal(o, [], [], muitoTempo);
t("E2 URL que não veio da busca reprova na conferência prévia (regras 4 e 7)",
  __stub.chamadas[1].userMsg.includes("não apareceu em nenhum resultado real da busca") && r.validacao.libera === true);

/* F — tempo */
roteiro({ resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] });
r = await pesquisarFonteReal(o, [], [], () => 60_000);
t("F1 sem tempo para validar (< 70 s), o dossiê é tratado como não validado e a questão bloqueia",
  __stub.chamadas.length === 1 && r.encontrou === false && r.bloqueado === true && r.validacao.estado === "sem_tempo");
roteiro({ resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] }, { resposta: vReprovado });
let chamadasTempo = 0;
r = await pesquisarFonteReal(o, [], [], () => (chamadasTempo++ < 1 ? 100_000 : 80_000));   // 1ª leitura: antes de validar (ok); 2ª: antes da rodada 2 (80 s < 90 s)
t("F2 reprovado na rodada 1 e sem 90 s para a rodada 2, não abre a rodada 2",
  __stub.chamadas.length === 2 && r.bloqueado === true && r.rodadas === 1);

/* G — web_fetch recusado pela API */
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },
  { erro: "HTTP 400: tools.0.allowed_domains: invalid" },
  { resposta: vAprovado },
);
r = await pesquisarFonteReal(o, [], [], muitoTempo);
t("G1 ferramenta recusada pela API → repete a MESMA rodada sem ferramenta, modo registrado, fonte aberta false",
  __stub.chamadas.length === 3 && __stub.chamadas[1].ferramentaServidor.name === "web_search"
  && __stub.chamadas[2].ferramentaServidor === false && __stub.chamadas[2].etapa === "validacao/rodada-1"
  && r.validacao.libera === true && r.validacao.modo === "sem_ferramenta" && r.validacao.fonteAberta === false);
t("G2 a mensagem sem ferramenta manda declarar que não abriu a fonte",
  __stub.chamadas[2].userMsg.includes("declare em comoVerificou que não abriu a fonte"));

/* I — v74.21c: aprovação restrita ao confirmado */
const vParcialI = { ...vReprovado, afirmacoesComSuporte: ["Sodré fundou a Liga em 5/11/1904", "Varela usava o jornal contra a vacina", "Barbosa Lima se opôs à lei"], afirmacoesSemSuporte: ["frase de abertura não confirmada"] };
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },
  { resposta: vParcialI, buscas: [{ url: URL_ACERVO, title: "a própria página" }] },   // página localizada
);
r = await pesquisarFonteReal({ area: "humanas", disciplina: "História", tema: "Revolta da Vacina" }, [], [], muitoTempo);
t("I1 suporte parcial com página localizada, nível A e 3 fatos → aprovação RESTRITA na mesma rodada, sem segunda pesquisa",
  __stub.chamadas.length === 2 && r.encontrou === true && r.validacao.libera === true && r.validacao.estado === "aprovado_restrito" && r.rodadas === 1);
t("I2 o material vira a lista de fatos do validador, sem trecho literal, e o dossiê fica marcado como restrito",
  r.restritoAoConfirmado === true && r.trechoEhLiteral === false && r.trecho.startsWith("1. Sodré fundou a Liga") && r.trecho.includes("3. Barbosa Lima")
  && r.validacao.motivo.startsWith("aprovação restrita ao confirmado:"));
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },
  { resposta: vParcialI, buscas: [{ url: "https://bndigital.bn.gov.br/outra-pagina", title: "" }] },   // página NÃO localizada
  { resposta: dossieBom(URL_FORA), buscas: [{ url: URL_FORA, title: "" }] },
  { resposta: { ...vParcialI, afirmacoesComSuporte: ["a", "b"] }, buscas: [{ url: URL_FORA, title: "" }] },   // só 2 fatos
  { resposta: { ...dossieBom(URL_TERCEIRA), encontrou: false }, buscas: [] },   // rodada 3 (v74.23) sem fonte
);
r = await pesquisarFonteReal({ area: "humanas", disciplina: "História", tema: "Revolta da Vacina" }, [], [], muitoTempo);
t("I3 sem página localizada, ou com menos de 3 fatos, a restrita NÃO libera — segue para as rodadas 2 e 3 e bloqueia",
  __stub.chamadas.length === 5 && r.encontrou === false && r.bloqueado === true && r.rodadas === 3);

/* J — v74.23: banco de fontes validadas */
__banco.resposta = { encontrou: true, autor: "Machado de Assis", obra: "Memórias Póstumas", referencia: "R", url: "https://www.dominiopublico.gov.br/x", trecho: "t", doBanco: { id: 7, pontos: 4, usos: 2 }, rodadas: 0, fontesTentadas: [], validacao: { libera: true, estado: "aprovado_banco", nivel: "A", fonteAberta: true, doBanco: true } };
__banco.consultas = []; __banco.guardados = [];
roteiro();
r = await pesquisarFonteReal({ area: "linguagens", disciplina: "Literatura", tema: "Machado de Assis" }, [], [], muitoTempo);
t("J1 fonte no banco: volta como dossiê aprovado SEM nenhuma chamada à IA (pesquisa e validação poupadas)",
  __stub.chamadas.length === 0 && r.encontrou === true && r.validacao.libera === true && r.validacao.estado === "aprovado_banco" && r.doBanco && r.doBanco.id === 7
  && __banco.consultas.length === 1);
__banco.resposta = null; __banco.consultas = []; __banco.guardados = [];
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },
  { resposta: vAprovado, buscas: [{ url: URL_ACERVO, title: "" }] },
);
r = await pesquisarFonteReal(o, [], [], muitoTempo);
t("J2 sem fonte no banco, pesquisa normal; a fonte aprovada é GUARDADA no banco",
  __stub.chamadas.length === 2 && r.validacao.libera === true && __banco.guardados.length === 1 && __banco.guardados[0].d.url === URL_ACERVO);
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },
  { resposta: vAprovado, buscas: [{ url: URL_ACERVO, title: "" }] },
);
__banco.consultas = [];
r = await pesquisarFonteReal({ ...o, usarBanco: false }, [], [], muitoTempo);
t("J3 usarBanco:false desliga a consulta ao banco", __banco.consultas.length === 0 && r.validacao.libera === true);

/* K — v74.23: fontes a evitar vindas do app (chamadas anteriores) */
__banco.consultas = [];
roteiro(
  { resposta: dossieBom(), buscas: [{ url: URL_ACERVO, title: "" }] },           // a fonte que o app mandou evitar
  { resposta: dossieBom(URL_FORA), buscas: [{ url: URL_FORA, title: "" }] },
  { resposta: { ...vAprovado, nivelFonte: "B" }, buscas: [{ url: URL_FORA, title: "" }] },
);
r = await pesquisarFonteReal({ ...o, fontesEvitar: [URL_ACERVO] }, [], [], muitoTempo);
t("K1 fonte da lista do app é reprovada na conferência prévia (fonte_evitada), sem gastar o validador, e a rodada 2 acha outra",
  __stub.chamadas.length === 3 && __stub.chamadas[1].etapa === "pesquisa/tentativa-2"
  && __stub.chamadas[1].userMsg.includes("já foi reprovada numa tentativa anterior") && r.validacao.libera === true && r.rodadas === 2);
t("K2 o prompt da rodada 1 já traz a lista do app, e a consulta ao banco recebe a mesma lista",
  __stub.chamadas[0].userMsg.includes("FONTES JÁ REPROVADAS PELO VALIDADOR") && __stub.chamadas[0].userMsg.includes(URL_ACERVO)
  && __banco.consultas.length === 1 && __banco.consultas[0].evitar.includes(URL_ACERVO));

/* H — fora do escopo */
roteiro();
r = await pesquisarFonteReal({ area: "natureza", disciplina: "Biologia", tema: "t" }, [], [], muitoTempo);
t("H1 fora de Linguagens e Humanas nada muda: null, sem chamada", r === null && __stub.chamadas.length === 0);
roteiro(
  { resposta: dossieBom("https://www.scielo.br/j/x"), buscas: [{ url: "https://www.scielo.br/j/x", title: "" }] },
  { resposta: vAprovado },
);
r = await pesquisarFonteReal({ area: "humanas", disciplina: "História", tema: "t" }, [], [], muitoTempo);
t("H2 em Humanas (sem acervo prioritário) a rodada 1 já é aberta, com a lista negra, e o fluxo é o mesmo",
  !("allowed_domains" in __stub.chamadas[0].ferramentaServidor) && Array.isArray(__stub.chamadas[0].ferramentaServidor.blocked_domains)
  && r.validacao.libera === true && r.validacao.nivel === "A" && !r.foraDoAcervo);

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);
