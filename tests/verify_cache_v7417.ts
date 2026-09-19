/* v74.17 — CACHE E CUSTO (19/09/2026).

   Prova, direto no arquivo de produção e sem chamar a Anthropic, as quatro
   medidas tomadas depois da leva de 18/09 (10 questões de Artes, ids 1108–1117,
   US$ 0,185 reais por questão contra um teto de US$ 0,09):

     A. o bloco cacheado voltou a ser fixo (sai o recurso visual, sai a Matriz)
     B. o recurso visual e a Matriz passaram para a mensagem do usuário
     C. o TTL do cache na geração é sempre o de 5 minutos
     D. o preço da gravação de cache segue o TTL em vigor
     E. o pesquisador abre com UMA busca
     F. o autoteste de produção cobre tudo isto

   Uso:
     deno run -A tests/verify_cache_v7417.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const src = await Deno.readTextFile(alvo);

/* Recorta uma função nomeada do arquivo de produção, casando chaves. */
function recorta(nome: string): string {
  const marca = `function ${nome}(`;
  const i = src.indexOf(marca);
  if (i < 0) return "";
  // 1) fecha os parênteses da assinatura (ela pode trazer um objeto com chaves)
  let p = src.indexOf("(", i), np = 0, q = p;
  for (; q < src.length; q++) {
    if (src[q] === "(") np++;
    else if (src[q] === ")") { np--; if (np === 0) break; }
  }
  // 2) só então abre o corpo e casa as chaves
  let k = src.indexOf("{", q), n = 0;
  for (let z = k; z < src.length; z++) {
    if (src[z] === "{") n++;
    else if (src[z] === "}") { n--; if (n === 0) { k = z; break; } }
  }
  return src.slice(i, k + 1);
}

let ok = 0, bad = 0;
function t(nome: string, cond: boolean, detalhe = "") {
  if (cond) { ok++; console.log("PASS " + nome); }
  else { bad++; console.log("FAIL " + nome + (detalhe ? "  → " + detalhe : "")); }
}

/* ---------- A. o bloco cacheado voltou a ser fixo ---------- */
const blocoFixo = recorta("buildBlocoFixo");
t("A1 buildBlocoFixo existe", blocoFixo.length > 100);
t("A2 a assinatura depende só de área e disciplina",
  /function buildBlocoFixo\(opts: \{ area: string; disciplina: string \}\)/.test(blocoFixo),
  blocoFixo.slice(0, 120));
t("A3 o recurso visual saiu do bloco cacheado", !blocoFixo.includes("instrucoesImagem("));
t("A4 a Matriz saiu do bloco cacheado", !blocoFixo.includes("buildMatrizInstrucoes("));
t("A5 o cabeçalho não carrega mais o recurso", !blocoFixo.includes("recurso visual: ${"));
t("A6 o que é fixo de verdade continua lá",
  blocoFixo.includes("buildRecorteDaDisciplina(") && blocoFixo.includes("buildRegraFontesReais(")
  && blocoFixo.includes("buildCalibracaoExtensao(") && blocoFixo.includes("buildRegraAlternativas()")
  && blocoFixo.includes("JSON_SCHEMA_TXT"));
t("A7 nenhuma chamada usa mais a assinatura antiga",
  !/buildBlocoFixo\(\{[^}]*recurso/.test(src) && !/buildBlocoFixo\(\{[^}]*habilidadeCod/.test(src));
// 5 no código (aquecimento, handler e três do autoteste) + 2 do bloco v7417
t("A8 todas as chamadas de buildBlocoFixo passam só área e disciplina",
  (src.match(/buildBlocoFixo\(\{ area/g) || []).length === 7,
  String((src.match(/buildBlocoFixo\(\{ area/g) || []).length));

/* ---------- B. recurso e Matriz na mensagem do usuário ---------- */
const userPrompt = recorta("buildUserPrompt");
t("B1 a Matriz é montada no prompt do usuário, com os argumentos da questão",
  userPrompt.includes("const matriz = ")
  && userPrompt.includes("buildMatrizInstrucoes(opts.area, opts.competenciaNum, opts.habilidadeCod)"));
t("B2 as instruções do recurso visual são montadas no prompt do usuário",
  userPrompt.includes("const instrucoesDoRecurso = ")
  && userPrompt.includes("instrucoesImagem(opts.recurso, opts.disciplina)"));
t("B3 as duas entram no texto entregue ao modelo",
  userPrompt.includes("${instrucoesDoRecurso}${matriz}"));
t("B4 a frase de abertura avisa que elas vêm nesta mensagem",
  userPrompt.includes("que vêm mais abaixo nesta mesma mensagem"));
t("B5 não sobrou resto da montagem antiga",
  !src.includes("matrizEspecifica") && !src.includes("matrizFixa"));

/* ---------- C. TTL sempre de 5 minutos na geração ---------- */
const escolhe = recorta("escolheCacheControl");
t("C1 escolheCacheControl devolve sempre o de 5 minutos",
  escolhe.includes("return CACHE_5MIN;") && !escolhe.includes("CACHE_1H"), escolhe.slice(-80));
t("C2 o handler não consulta mais 'geração recente' para decidir o TTL",
  src.includes("_cacheControlAtual = escolheCacheControl(quantidadeLeva, false);")
  && !src.includes("await houveGeracaoRecente()"));
t("C3 o de 1 hora continua existindo só para o aquecimento opcional",
  src.includes('const CACHE_1H: CacheControl = { type: "ephemeral", ttl: "1h" };')
  && recorta("aquecerCacheResponse").includes("CACHE_1H"));

/* ---------- D. o preço da gravação segue o TTL ---------- */
t("D1 a tabela de preços tem os dois preços de gravação",
  /cacheEscrito: 2\.5, cacheEscrito1h: 4/.test(src));
t("D2 precoCacheEscrito escolhe pelo TTL em vigor",
  recorta("precoCacheEscrito").includes('cacheControlAtual().ttl === "1h"'));
t("D3 a conta do custo usa precoCacheEscrito()",
  recorta("resumoUso").includes("r.cacheEscrito * precoCacheEscrito()")
  && !recorta("resumoUso").includes("PRECO_USD_POR_M.cacheEscrito,"));

/* ---------- E. o pesquisador abre com uma busca ---------- */
t("E1 primeira tentativa do pesquisador: teto 1",
  /const BUSCA_PESQUISADOR = \{ \.\.\.WEB_SEARCH_TOOL, max_uses: 1 \};/.test(src));
t("E2 segunda tentativa: teto 2",
  /const BUSCA_PESQUISADOR_RETRY = \{ \.\.\.WEB_SEARCH_TOOL, max_uses: 2 \};/.test(src));
t("E3 auditoria sem dossiê: teto 2 (inalterado)",
  /const BUSCA_AUDITORIA = \{ \.\.\.WEB_SEARCH_TOOL, max_uses: 2 \};/.test(src));
t("E4 o teto geral continua 3", /const WEB_SEARCH_TOOL = \{[^}]*max_uses: 3 \};/.test(src));

/* ---------- F. o autoteste de produção cobre tudo ---------- */
for (const chave of [
  "v7417_ttlSempre5min", "v7417_blocoFixoEstavel",
  "v7417_recursoEMatrizNoPromptDoUsuario", "v7417_precoSegueOTtl", "v7417_pesquisadorUmaBusca",
]) t("F " + chave + " está no ?selftest=1", src.includes(chave + ":"));
t("F a regra antiga do TTL saiu do autoteste", !src.includes("v7415_regraDoTtl"));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);
