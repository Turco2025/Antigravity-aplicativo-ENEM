/* VALIDAÇÃO OBRIGATÓRIA DE FONTES no backend (generate-question).

   Prova a regra do professor SEM chamar a Anthropic: extrai do arquivo de
   produção o bloco que vai de "VALIDAÇÃO OBRIGATÓRIA DE FONTES" até o marcador
   de fim (mais as funções soltas que o bloco usa) e substitui APENAS as
   dependências externas (callClaudeForJSON) por dublês controláveis. O código
   conferido é o que roda em produção — nada é copiado à mão.

   Seções:
     A. a mensagem literal do professor            F. o bloqueio de verdade
     B. escopo por área                            G. autoria institucional (leva de 18/09)
     C. conferência determinística                 H. v74.13 — só o pesquisador busca
     D. URL inventada (regras 4 e 7)               I. v74.13 — a fonte é a do dossiê
     E. o prompt de auditoria

   Uso:
     deno run -A tests/verify_fontes_backend.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
const i = fonte.indexOf("/* ═══════════ v74.8 — VALIDAÇÃO OBRIGATÓRIA DE FONTES");
const j = fonte.indexOf("/* ═══════════ FIM DO BLOCO DE VALIDAÇÃO DE FONTES");
if (i < 0 || j < 0 || j < i) { console.error("FALHA: não achei o bloco de fontes em " + alvo); Deno.exit(1); }

/* Recorta uma função nomeada do arquivo de produção, casando chaves. Serve para
   trazer para o teste o código REAL das funções que vivem fora do bloco. */
function recorta(nome: string): string {
  const marca = `\nfunction ${nome}(`;
  const a = fonte.indexOf(marca);
  if (a < 0) { console.error(`FALHA: não achei a função ${nome} em ${alvo}`); Deno.exit(1); }
  let k = fonte.indexOf("{", a), nivel = 0, dentroStr = "", escapou = false;
  for (let p = k; p < fonte.length; p++) {
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

/* Recorta uma const declarada com template literal (`...`) do arquivo de
   produção — o texto do professor entra no teste como ele está lá, não copiado. */
function recortaConstTemplate(nome: string): string {
  const marca = `const ${nome} = \``;
  const a = fonte.indexOf(marca);
  if (a < 0) { console.error(`FALHA: não achei a const ${nome} em ${alvo}`); Deno.exit(1); }
  const ini = a + marca.length;
  for (let p = ini; p < fonte.length; p++) {
    if (fonte[p] === "\\") { p++; continue; }
    if (fonte[p] === "`") return fonte.slice(ini, p);
  }
  console.error(`FALHA: a const ${nome} não fecha`); Deno.exit(1); return "";
}

// A mensagem, o escopo e os tetos de busca são lidos do MESMO arquivo, não
// copiados à mão: se alguém reescrever o texto do professor ou afrouxar um
// teto, o teste acusa.
const mMsg = fonte.match(/const MENSAGEM_FONTE_BLOQUEIO = "([^"]+)";/);
const mAreas = fonte.match(/const AREAS_FONTES_REAIS_ESTRITO = (\[[^\]]*\]);/);
const mWS = fonte.match(/const WEB_SEARCH_TOOL = \{[^}]*max_uses:\s*(\d+)\s*\};/);
const mBP = fonte.match(/const BUSCA_PESQUISADOR = \{ \.\.\.WEB_SEARCH_TOOL, max_uses:\s*(\d+)\s*\};/);
const mBR = fonte.match(/const BUSCA_PESQUISADOR_RETRY = \{ \.\.\.WEB_SEARCH_TOOL, max_uses:\s*(\d+)\s*\};/);
const mBA = fonte.match(/const BUSCA_AUDITORIA = \{ \.\.\.WEB_SEARCH_TOOL, max_uses:\s*(\d+)\s*\};/);
if (!mMsg || !mAreas) { console.error("FALHA: não achei MENSAGEM_FONTE_BLOQUEIO / AREAS_FONTES_REAIS_ESTRITO"); Deno.exit(1); }
if (!mWS || !mBP || !mBR || !mBA) { console.error("FALHA: não achei os tetos de busca (WEB_SEARCH_TOOL / BUSCA_*)"); Deno.exit(1); }

const mAcervos = fonte.match(/const ACERVOS_PRIORITARIOS: \{ nome: string; url: string \}\[\] = (\[[^;]*?\]);/s);
const mDisc = fonte.match(/const DISCIPLINAS_COM_ACERVO_PRIORITARIO = (\[[^\]]*\]);/);
if (!mAcervos || !mDisc) { console.error("FALHA: não achei ACERVOS_PRIORITARIOS / DISCIPLINAS_COM_ACERVO_PRIORITARIO"); Deno.exit(1); }

const modulo = `type SistemaPrompt = any;
// o texto integral da regra do professor, lido do arquivo de producao
const REGRA_FONTES_PROFESSOR = ${JSON.stringify(recortaConstTemplate("REGRA_FONTES_PROFESSOR"))};
// v74.15: o TTL do cache e decidido fora do bloco; aqui basta um duble
function cacheControlAtual() { return { type: "ephemeral" }; }
const ACERVOS_PRIORITARIOS: { nome: string; url: string }[] = ${mAcervos[1]};
const DISCIPLINAS_COM_ACERVO_PRIORITARIO = ${mDisc[1]};
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: ${mWS[1]} };
const BUSCA_PESQUISADOR = { ...WEB_SEARCH_TOOL, max_uses: ${mBP[1]} };
const BUSCA_PESQUISADOR_RETRY = { ...WEB_SEARCH_TOOL, max_uses: ${mBR[1]} };
const BUSCA_AUDITORIA = { ...WEB_SEARCH_TOOL, max_uses: ${mBA[1]} };
const AREAS_FONTES_REAIS_ESTRITO = ${mAreas[1]};
function fontesReaisEstrito(area: string): boolean {
  return AREAS_FONTES_REAIS_ESTRITO.includes(String(area || "").trim().toLowerCase());
}
// dublês das dependências de buscaDaGeracao que vivem noutra parte do arquivo
function ehBiologia(d: string) { return /biolog/i.test(String(d || "")); }
function precisaFontesReais(d: string) { return /hist[óo]ria|geografia|filosofia|sociologia|literatura|artes/i.test(String(d || "")); }
function webSearchTool(disciplina: string) {
  return ehBiologia(disciplina) ? { ...WEB_SEARCH_TOOL, max_uses: 2 } : WEB_SEARCH_TOOL;
}
const MENSAGEM_FONTE_BLOQUEIO = ${JSON.stringify(mMsg[1])};
export const __stub: any = { resposta: null, erro: null, chamadas: 0, ultimoPrompt: "", buscaLigada: null };
async function callClaudeForJSON(_s: any, userMsg: string, w: any, usos: any[], _f: any) {
  __stub.chamadas++; __stub.ultimoPrompt = userMsg; __stub.buscaLigada = w; __stub.sistema = _s;
  if (usos) usos.push({ input_tokens: 1, output_tokens: 1 });
  if (__stub.erro) throw new Error(__stub.erro);
  return __stub.resposta;
}
` + fonte.slice(i, j) + `
` + recorta("temAcervoPrioritario") + `
` + recorta("buildAcervosPrioritarios") + `
` + recorta("buscaDaGeracao") + `
` + recorta("buildDossieFonte") + `
export { SISTEMA_AUDITORIA_FONTES, REGRA_FONTES_PROFESSOR };
export { ACERVOS_PRIORITARIOS, DISCIPLINAS_COM_ACERVO_PRIORITARIO, temAcervoPrioritario, buildAcervosPrioritarios };
export { conferenciaFontes, conferenciaDossie, tokensDeFonte, normalizaUrl, buildAuditoriaFontesPrompt,
         garantirFontesReais, FERRAMENTA_AUDITORIA_FONTE, MENSAGEM_FONTE_BLOQUEIO, fontesReaisEstrito,
         buscaDaGeracao, buildDossieFonte,
         WEB_SEARCH_TOOL, BUSCA_PESQUISADOR, BUSCA_PESQUISADOR_RETRY, BUSCA_AUDITORIA };
`;
const tmp = await Deno.makeTempDir();
const caminho = `${tmp}/fontes_mod.ts`;
await Deno.writeTextFile(caminho, modulo);
const M: any = await import("file://" + caminho);
const { conferenciaFontes, conferenciaDossie, normalizaUrl, buildAuditoriaFontesPrompt, garantirFontesReais,
        FERRAMENTA_AUDITORIA_FONTE, MENSAGEM_FONTE_BLOQUEIO, fontesReaisEstrito, buscaDaGeracao,
        buildDossieFonte, WEB_SEARCH_TOOL, BUSCA_PESQUISADOR, BUSCA_PESQUISADOR_RETRY, BUSCA_AUDITORIA,
        SISTEMA_AUDITORIA_FONTES, REGRA_FONTES_PROFESSOR, ACERVOS_PRIORITARIOS,
        DISCIPLINAS_COM_ACERVO_PRIORITARIO, temAcervoPrioritario, buildAcervosPrioritarios,
        __stub } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };

const MSG_ESPERADA = "Não foi possível verificar uma fonte real para o autor ou a obra solicitada. Envie o texto ou uma referência confiável para continuar.";

const fonteBoa = (extra: any = {}) => ({
  tipoUso: "parafrase", autor: "Machado de Assis", instituicao: "", obra: "Memórias Póstumas de Brás Cubas",
  ano: "1881", referencia: "ASSIS, M. Memórias Póstumas de Brás Cubas. Rio de Janeiro, 1881.",
  comoVerificou: "conferido no acervo de Domínio Público", conferidoNaFonte: true, ...extra,
});
const questao = (fonte: any) => ({
  textoBase: "t", comando: "c", gabarito: "B", resolucaoComentada: "r",
  alternativas: { A: "a", B: "b", C: "c", D: "d", E: "e" },
  analiseAlternativas: { A: { comentario: "ca" }, B: { comentario: "cb" }, C: { comentario: "cc" }, D: { comentario: "cd" }, E: { comentario: "ce" } },
  fonte,
});
/* A ficha do professor tem DEZ perguntas (v74.12): doze positivos + o varredor
   das outras partes. Uma ficha "boa" precisa marcar TODOS os positivos — foi
   assim que a versão anterior deste teste ficou obsoleta e passou a reprovar
   questões corretas. */
const fichaBoa = (extra: any = {}) => ({
  autorExiste: true, obraExiste: true, obraPertenceAoAutor: true, fonteExiste: true,
  instituicaoExiste: true, trechoConferidoNaFonte: true, parafraseFielAFonte: true,
  usoIdentificadoCorretamente: true, referenciaLocalizavelEConfirmada: true,
  nadaFoiInventado: true, nenhumaFraseAtribuidaIndevidamente: true, comprovavelPelaFonte: true,
  inventadoEmOutraParte: false, aprovado: true, motivo: "", ...extra,
});

/* ---------- A. A mensagem literal do professor ---------- */
t("A1 a mensagem de bloqueio é EXATAMENTE a que o professor escreveu",
  MENSAGEM_FONTE_BLOQUEIO === MSG_ESPERADA, JSON.stringify(MENSAGEM_FONTE_BLOQUEIO));

/* ---------- B. Escopo: as duas áreas inteiras ---------- */
t("B1 Linguagens exige fonte real", fontesReaisEstrito("linguagens"));
t("B2 Humanas exige fonte real", fontesReaisEstrito("humanas"));
t("B3 Natureza não entra no regime estrito", !fontesReaisEstrito("natureza"));
t("B4 Matemática não entra no regime estrito", !fontesReaisEstrito("matematica"));

/* ---------- C. Conferência determinística ---------- */
t("C1 questão sem o campo fonte é reprovada", conferenciaFontes(questao(undefined)).estado === "ausente");
t("C2 tipoUso inválido é reprovado", conferenciaFontes(questao(fonteBoa({ tipoUso: "inventado" }))).estado === "invalido");
t("C3 sem autor E sem instituição é reprovada (alguém tem de responder pela fonte)",
  conferenciaFontes(questao(fonteBoa({ autor: "", instituicao: "" }))).estado === "incompleto");
t("C3b referência em branco é reprovada (é o que permite localizar a fonte)",
  conferenciaFontes(questao(fonteBoa({ referencia: "" }))).estado === "incompleto");
t("C3c comoVerificou em branco é reprovado",
  conferenciaFontes(questao(fonteBoa({ comoVerificou: "" }))).estado === "incompleto");
t("C3d v74.9: obra em branco NÃO trava — em acervo o título está na referência",
  conferenciaFontes(questao(fonteBoa({ obra: "" }))).estado === "ok");
t("C4 citação literal sem conferência na origem é reprovada (regra 5)",
  conferenciaFontes(questao(fonteBoa({ tipoUso: "citacao", conferidoNaFonte: false }))).estado === "citacao_nao_conferida");
t("C5 texto próprio NÃO pode vir com autor/obra preenchidos",
  conferenciaFontes(questao({ tipoUso: "proprio", autor: "Drummond", instituicao: "", obra: "", referencia: "", comoVerificou: "", conferidoNaFonte: false })).estado === "incoerente");
t("C6 texto próprio sem atribuição passa",
  conferenciaFontes(questao({ tipoUso: "proprio", autor: "", instituicao: "", obra: "", referencia: "", comoVerificou: "", conferidoNaFonte: false })).estado === "ok");
t("C7 fonte completa e coerente passa", conferenciaFontes(questao(fonteBoa())).estado === "ok");

/* ---------- D. URL inventada (regras 4 e 7) ---------- */
t("D1 URL que não saiu de nenhuma busca real é reprovada",
  conferenciaFontes(questao(fonteBoa({ urlVerificacao: "https://exemplo-inventado.org/obra" })), []).estado === "url_nao_confirmada");
t("D2 URL que saiu de uma busca real passa",
  conferenciaFontes(questao(fonteBoa({ urlVerificacao: "https://www.dominiopublico.gov.br/obra/123" })),
    [{ url: "https://dominiopublico.gov.br/obra/123", title: "x" }]).estado === "ok");
t("D3 a comparação ignora http/https, www e barra final",
  normalizaUrl("HTTPS://WWW.Exemplo.org/a/") === "exemplo.org/a" && normalizaUrl("http://exemplo.org/a") === "exemplo.org/a");
t("D4 sem URL declarada não há o que reprovar", conferenciaFontes(questao(fonteBoa()), []).estado === "ok");

/* ---------- E. O prompt de auditoria cobre tudo o que o professor exigiu ---------- */
const promptAud = buildAuditoriaFontesPrompt(questao(fonteBoa()));
t("E1 a auditoria recebe texto-base, enunciado, alternativas, gabarito e resolução",
  ["TEXTO-BASE", "ENUNCIADO", "ALTERNATIVAS", "GABARITO", "RESOLUÇÃO COMENTADA", "COMENTÁRIOS DAS ALTERNATIVAS"].every((k) => promptAud.includes(k)));
t("E2 a auditoria recebe a legenda do recurso visual quando existe",
  buildAuditoriaFontesPrompt({ ...questao(fonteBoa()), visual: { descricao: "gráfico de barras do IBGE" } }).includes("gráfico de barras do IBGE"));
t("E3 SEM dossiê, a auditoria manda usar a busca e não confiar na memória",
  promptAud.includes("web_search") && promptAud.includes("memória"));
t("E4 a auditoria manda reprovar na dúvida", promptAud.includes("na dúvida, verificar; sem confirmação, não utilizar"));
t("E5 a ficha da ferramenta tem as DEZ perguntas do professor (12 positivos + varredor + veredito + motivo)",
  FERRAMENTA_AUDITORIA_FONTE.input_schema.required.length === 15
  && ["autorExiste", "obraExiste", "obraPertenceAoAutor", "fonteExiste", "instituicaoExiste",
      "trechoConferidoNaFonte", "parafraseFielAFonte", "usoIdentificadoCorretamente",
      "referenciaLocalizavelEConfirmada", "nadaFoiInventado", "nenhumaFraseAtribuidaIndevidamente",
      "comprovavelPelaFonte", "inventadoEmOutraParte", "aprovado", "motivo"]
     .every((k) => FERRAMENTA_AUDITORIA_FONTE.input_schema.required.includes(k)),
  JSON.stringify(FERRAMENTA_AUDITORIA_FONTE.input_schema.required));
t("E6 a auditoria explica que autoria institucional é legítima (não reprovar por autor vazio)",
  promptAud.includes("AUTORIA INSTITUCIONAL") && promptAud.includes('não reprove por "autor vazio"'));

/* ---------- F. O bloqueio de verdade ---------- */
const roda = async (q: any, area = "linguagens", restante = 120_000, buscas: any[] = [], dossie: any = null) => {
  return await garantirFontesReais(q, [], [], restante, area, buscas, dossie);
};

__stub.resposta = fichaBoa(); __stub.erro = null; __stub.chamadas = 0;
let q1: any = questao(fonteBoa());
let d1 = await roda(q1);
t("F1 fonte verificada e ficha limpa: aprovada, sem marca de bloqueio",
  d1.estado === "aprovado" && !q1.fonteNaoVerificada, JSON.stringify(d1));
t("F2 SEM dossiê, a auditoria roda COM busca na web ligada",
  !!(__stub.buscaLigada && __stub.buscaLigada.name === "web_search"), JSON.stringify(__stub.buscaLigada));

__stub.chamadas = 0;
let q2: any = questao(fonteBoa({ autor: "", instituicao: "", referencia: "" }));
let d2 = await roda(q2);
t("F3 falha estrutural bloqueia SEM gastar chamada de auditoria",
  d2.estado === "reprovado" && __stub.chamadas === 0 && q2.fonteNaoVerificada.mensagem === MSG_ESPERADA, JSON.stringify(d2));

__stub.resposta = fichaBoa({ obraPertenceAoAutor: false, aprovado: true });
let q3: any = questao(fonteBoa());
let d3 = await roda(q3);
t("F4 obra que não é do autor reprova MESMO com o auditor dizendo 'aprovado'",
  d3.estado === "reprovado" && q3.fonteNaoVerificada.mensagem === MSG_ESPERADA, JSON.stringify(d3.motivo));

__stub.resposta = fichaBoa({ inventadoEmOutraParte: true, aprovado: true });
let q4: any = questao(fonteBoa());
let d4 = await roda(q4);
t("F5 autor inventado numa alternativa/resolução bloqueia a questão inteira",
  d4.estado === "reprovado" && q4.fonteNaoVerificada.mensagem === MSG_ESPERADA);

__stub.resposta = fichaBoa({ comprovavelPelaFonte: false, aprovado: true });
let q4b: any = questao(fonteBoa());
let d4b = await roda(q4b);
t("F5b v74.12: o que a fonte não sustenta reprova (o caso do mural do Kobra)",
  d4b.estado === "reprovado" && d4b.motivo.includes("comprovavelPelaFonte"), JSON.stringify(d4b.motivo));

__stub.resposta = fichaBoa({ trechoConferidoNaFonte: false, aprovado: false, motivo: "trecho não conferido" });
let q5: any = questao(fonteBoa());
let d5 = await roda(q5);
t("F6 trecho não conferido na fonte bloqueia, com o motivo do auditor",
  d5.estado === "reprovado" && d5.motivo.includes("trecho não conferido"));

__stub.resposta = fichaBoa(); __stub.chamadas = 0;
let q6: any = questao(fonteBoa());
let d6 = await roda(q6, "linguagens", 10_000);
t("F7 sem tempo para validar NÃO passa — bloqueia (sem confirmação, não utilizar)",
  d6.estado === "reprovado" && __stub.chamadas === 0 && q6.fonteNaoVerificada.etapa === "tempo");

__stub.erro = "timeout";
let q7: any = questao(fonteBoa());
let d7 = await roda(q7);
t("F8 erro na validação bloqueia — nunca libera por omissão",
  d7.estado === "reprovado" && q7.fonteNaoVerificada.etapa === "erro");
__stub.erro = null;

__stub.chamadas = 0;
let q8: any = questao(fonteBoa());
let d8 = await roda(q8, "natureza");
t("F9 fora das duas áreas a validação não roda e nada é bloqueado",
  d8.estado === "nao_se_aplica" && __stub.chamadas === 0 && !q8.fonteNaoVerificada);

__stub.resposta = fichaBoa(); __stub.chamadas = 0;
let q9: any = questao(fonteBoa({ urlVerificacao: "https://link-inventado.test/x" }));
let d9 = await roda(q9, "humanas", 120_000, []);
t("F10 em Humanas, link inventado bloqueia antes mesmo da auditoria",
  d9.estado === "reprovado" && __stub.chamadas === 0 && d9.determinista === "url_nao_confirmada");

__stub.resposta = fichaBoa();
let q10: any = questao(fonteBoa());
q10.fonteNaoVerificada = { motivo: "sobra de uma rodada anterior" };
let d10 = await roda(q10);
t("F11 aprovando, a marca de bloqueio antiga é apagada",
  d10.estado === "aprovado" && !q10.fonteNaoVerificada, JSON.stringify(d10));

/* ---------- G. Autoria institucional — a regressão da leva de 18/09/2026 ----------
   Sete fontes oficiais legítimas foram reprovadas por exigir autor PESSOAL.
   Entidade coletiva é autoria legítima em ABNT e é o padrão em acervo, museu e
   órgão público. Estas são as fontes REAIS daquela leva. */
const institucionais = [
  { instituicao: "IPHAN", obra: "Conjunto Moderno da Pampulha", referencia: "IPHAN. Conjunto Moderno da Pampulha. Brasília: IPHAN, 2016." },
  { instituicao: "Itaú Cultural", obra: "Tarsila do Amaral", referencia: "ITAÚ CULTURAL. Tarsila do Amaral. Enciclopédia Itaú Cultural de Arte e Cultura Brasileiras, 2023." },
  { instituicao: "MAM Rio", obra: "Parangolés", referencia: "MAM RIO. Hélio Oiticica: Parangolés. Rio de Janeiro, 2019." },
  { instituicao: "Museu Afro Brasil", obra: "Arte afro-brasileira", referencia: "MUSEU AFRO BRASIL. Acervo de arte afro-brasileira. São Paulo, 2021." },
  { instituicao: "Agência Brasil", obra: "Semana de Arte Moderna faz 100 anos", referencia: "AGÊNCIA BRASIL. Semana de Arte Moderna faz 100 anos. Brasília, 2022." },
  { instituicao: "Instituto Ling", obra: "Arthur Bispo do Rosário", referencia: "INSTITUTO LING. Arthur Bispo do Rosário. Porto Alegre, 2020." },
  { instituicao: "Cultura Genial", obra: "Abaporu de Tarsila do Amaral", referencia: "CULTURA GENIAL. Abaporu, de Tarsila do Amaral. 2022." },
];
institucionais.forEach((f, n) => {
  const est = conferenciaFontes(questao({
    tipoUso: "parafrase", autor: "", instituicao: f.instituicao, obra: f.obra,
    ano: "", referencia: f.referencia, comoVerificou: "página institucional", conferidoNaFonte: true,
  })).estado;
  t(`G${n + 1} autoria institucional aceita: ${f.instituicao}`, est === "ok", est);
});
t("G8 instituição que NÃO aparece na referência é reprovada (campo digitado no vazio)",
  conferenciaFontes(questao({
    tipoUso: "parafrase", autor: "", instituicao: "Museu Inexistente de Sorocaba", obra: "x",
    ano: "", referencia: "ASSIS, M. Dom Casmurro. Garnier, 1899.", comoVerificou: "c", conferidoNaFonte: true,
  })).estado === "instituicao_fora_da_referencia");

/* ---------- H. v74.13 — só o pesquisador busca ---------- */
const doss = {
  encontrou: true, autor: "", instituicao: "IPHAN", obra: "Conjunto Moderno da Pampulha",
  ano: "2016", referencia: "IPHAN. Conjunto Moderno da Pampulha. Brasília, 2016.",
  url: "https://portal.iphan.gov.br/pampulha",
  trecho: "O conjunto foi inscrito na Lista do Patrimônio Mundial da UNESCO em 2016.",
  trechoEhLiteral: false, abriuAFonte: true, comoVerificou: "portal do IPHAN",
};
t("H1 o teto geral de buscas caiu para 3 (era 5 — o custo cresce com o quadrado das buscas)",
  WEB_SEARCH_TOOL.max_uses === 3, String(WEB_SEARCH_TOOL.max_uses));
t("H2 o pesquisador é a única etapa que varre a web, com teto 2",
  BUSCA_PESQUISADOR.max_uses === 2 && BUSCA_PESQUISADOR.max_uses >= BUSCA_AUDITORIA.max_uses);
t("H3 a segunda tentativa do pesquisador existe e não é mais cara que a primeira",
  BUSCA_PESQUISADOR_RETRY.max_uses === 2 && BUSCA_PESQUISADOR_RETRY.max_uses <= BUSCA_PESQUISADOR.max_uses);
t("H4 a auditoria sem dossiê tem teto 2", BUSCA_AUDITORIA.max_uses === 2);
t("H5 COM dossiê validado a geração NÃO busca", buscaDaGeracao(doss, "linguagens", "Artes") === false);
t("H6 SEM dossiê a geração continua buscando em Linguagens",
  !!buscaDaGeracao(null, "linguagens", "Artes"));
t("H7 dossiê vazio ou sem trecho não desliga a busca (não achou fonte = continua procurando)",
  !!buscaDaGeracao({ encontrou: false }, "humanas", "História")
  && !!buscaDaGeracao({ encontrou: true, trecho: "   " }, "humanas", "História"));
t("H8 em Matemática a geração segue sem busca, como antes",
  buscaDaGeracao(null, "matematica", "Matemática") === false);
t("H9 o dossiê avisa o gerador de que a busca está desligada de propósito",
  buildDossieFonte(doss).includes("A BUSCA NA WEB ESTÁ DESLIGADA NESTA ETAPA")
  && buildDossieFonte(doss).includes("Não procure outra fonte"));
t("H10 o dossiê continua mandando copiar autor/obra/referência sem alterar",
  buildDossieFonte(doss).includes("sem alterar") && buildDossieFonte(doss).includes("IPHAN"));

__stub.resposta = fichaBoa(); __stub.erro = null; __stub.chamadas = 0; __stub.buscaLigada = "?";
let q11: any = questao(fonteBoa({ autor: "", instituicao: "IPHAN", obra: "Conjunto Moderno da Pampulha", referencia: doss.referencia }));
let d11 = await roda(q11, "linguagens", 120_000, [], doss);
t("H11 COM dossiê a auditoria roda SEM busca (confere contra a fonte já validada)",
  d11.estado === "aprovado" && __stub.buscaLigada === false && __stub.chamadas === 1,
  JSON.stringify({ estado: d11.estado, busca: __stub.buscaLigada, chamadas: __stub.chamadas }));
t("H12 o diagnóstico registra que a auditoria não buscou", d11.auditoriaBuscou === false && d11.dossie === "ok");
t("H13 o prompt da auditoria recebe o dossiê inteiro",
  __stub.ultimoPrompt.includes("DOSSIÊ DA PESQUISA PRÉVIA")
  && __stub.ultimoPrompt.includes("Conjunto Moderno da Pampulha")
  && __stub.ultimoPrompt.includes("Lista do Patrimônio Mundial"));
t("H14 com dossiê some a ordem de buscar, e entra a de conferir contra o dossiê",
  !__stub.ultimoPrompt.includes("USE a ferramenta web_search")
  && __stub.ultimoPrompt.includes("comprovavelPelaFonte"));

__stub.chamadas = 0; __stub.buscaLigada = "?";
let q12: any = questao(fonteBoa());
let d12 = await roda(q12, "linguagens", 120_000, []);
t("H15 SEM dossiê a auditoria volta a buscar, com o teto 2",
  __stub.buscaLigada && __stub.buscaLigada.max_uses === 2 && d12.auditoriaBuscou === true,
  JSON.stringify(__stub.buscaLigada));

/* ---------- I. v74.13 — a questão tem de ser a do dossiê ---------- */
const mesma = { fonte: { tipoUso: "parafrase", autor: "", instituicao: "IPHAN", obra: "Conjunto Moderno da Pampulha", referencia: doss.referencia, comoVerificou: "c", conferidoNaFonte: true } };
const outra = { fonte: { tipoUso: "citacao", autor: "Machado de Assis", instituicao: "", obra: "Dom Casmurro", referencia: "ASSIS, Machado de. Dom Casmurro. Garnier, 1899.", comoVerificou: "c", conferidoNaFonte: true } };
t("I1 a fonte do dossiê é aceita", conferenciaDossie(mesma, doss).estado === "ok");
t("I2 fonte trocada por outra, lembrada de memória, é reprovada",
  conferenciaDossie(outra, doss).estado === "fonte_trocada"
  && conferenciaDossie(outra, doss).motivo.includes("Machado de Assis"));
t("I3 texto próprio não casa com dossiê nenhum — e não é reprovado por isso",
  conferenciaDossie({ fonte: { tipoUso: "proprio", autor: "", instituicao: "", obra: "", referencia: "", comoVerificou: "c", conferidoNaFonte: false } }, doss).estado === "proprio");
t("I4 sem dossiê não há o que conferir",
  conferenciaDossie(mesma, null).estado === "sem_dossie"
  && conferenciaDossie(mesma, { encontrou: false }).estado === "sem_dossie"
  && conferenciaDossie(mesma, { encontrou: true, trecho: "" }).estado === "sem_dossie");
t("I5 TOLERÂNCIA: referência abreviada, sem acento e com caixa diferente continua casando",
  conferenciaDossie({ fonte: { tipoUso: "adaptacao", autor: "", instituicao: "Iphan", obra: "Pampulha", referencia: "IPHAN. Pampulha, 2016.", comoVerificou: "c", conferidoNaFonte: true } }, doss).estado === "ok");
t("I6 TOLERÂNCIA: só o nome do autor pessoal em comum já basta",
  conferenciaDossie(
    { fonte: { tipoUso: "citacao", autor: "Machado de Assis", instituicao: "", obra: "Dom Casmurro", referencia: "ASSIS, M. Dom Casmurro. 1899.", comoVerificou: "c", conferidoNaFonte: true } },
    { encontrou: true, autor: "Machado de Assis", instituicao: "", obra: "Memórias Póstumas de Brás Cubas", referencia: "ASSIS, M. Memórias Póstumas. Garnier, 1881.", url: "", trecho: "x" },
  ).estado === "ok");
t("I7 palavras genéricas de referência NÃO contam como fonte em comum",
  conferenciaDossie(
    { fonte: { tipoUso: "parafrase", autor: "", instituicao: "Museu Nacional", obra: "Acervo digital", referencia: "MUSEU NACIONAL. Acervo digital brasileiro. 2020. Disponível em: https://www.exemplo.org", comoVerificou: "c", conferidoNaFonte: true } },
    { encontrou: true, autor: "", instituicao: "Instituto Moreira Salles", obra: "Fotografia brasileira", referencia: "INSTITUTO MOREIRA SALLES. Fotografia brasileira. 2019. Disponível em: https://www.ims.com.br", url: "https://ims.com.br", trecho: "x" },
  ).estado === "fonte_trocada");

__stub.resposta = fichaBoa(); __stub.chamadas = 0;
let q13: any = questao(outra.fonte);
let d13 = await roda(q13, "linguagens", 120_000, [], doss);
t("I8 fonte trocada bloqueia a questão SEM gastar a chamada de auditoria",
  d13.estado === "reprovado" && __stub.chamadas === 0
  && q13.fonteNaoVerificada.etapa === "conferência do dossiê"
  && q13.fonteNaoVerificada.mensagem === MSG_ESPERADA, JSON.stringify(d13));

/* ---------- J. v74.15 — a auditoria tem sistema próprio, curto e completo ----------
   A economia vem de a auditoria deixar de carregar o prompt da geração. O que
   NÃO pode acontecer é ela perder a regra do professor no caminho. */
t("J1 o sistema da auditoria existe e diz o papel dela",
  typeof SISTEMA_AUDITORIA_FONTES === "string"
  && SISTEMA_AUDITORIA_FONTES.includes("VALIDADOR DE FONTES")
  && SISTEMA_AUDITORIA_FONTES.includes("NÃO reescreve a questão"));
t("J2 a regra do professor vai INTEIRA, palavra por palavra",
  SISTEMA_AUDITORIA_FONTES.includes(REGRA_FONTES_PROFESSOR)
  && [1,2,3,4,5,6,7,8].every((n) => SISTEMA_AUDITORIA_FONTES.includes("\n" + n + ". ")),
  `chars=${SISTEMA_AUDITORIA_FONTES.length} regra=${REGRA_FONTES_PROFESSOR.length}`);
t("J3 os seis itens da ficha do professor continuam no sistema da auditoria",
  ["O autor existe?", "A obra existe?", "A obra pertence ao autor informado?",
   "O trecho utilizado foi conferido na fonte?",
   "A citação, adaptação ou paráfrase está identificada corretamente?",
   "A referência permite localizar a fonte e contém apenas dados confirmados?"]
  .every((q) => SISTEMA_AUDITORIA_FONTES.includes(q)));
t("J4 autoria institucional segue reconhecida como legítima",
  SISTEMA_AUDITORIA_FONTES.includes("Autoria institucional é legítima")
  && SISTEMA_AUDITORIA_FONTES.includes("não exija nome de pessoa"));
t("J5 a regra de ouro continua lá",
  SISTEMA_AUDITORIA_FONTES.includes("Na dúvida, verificar; sem confirmação, não utilizar"));
t("J6 é curto — abaixo de 9.000 caracteres (o da geração tem 48.203)",
  SISTEMA_AUDITORIA_FONTES.length < 9000, String(SISTEMA_AUDITORIA_FONTES.length));
t("J7 garantirFontesReais usa o sistema próprio, não o da geração",
  garantirFontesReais.toString().includes("SISTEMA_AUDITORIA_FONTES")
  && garantirFontesReais.toString().includes("sistemaAuditoria"));

__stub.resposta = fichaBoa(); __stub.erro = null; __stub.chamadas = 0;
let q14: any = questao(fonteBoa());
// o `system` passado é propositalmente lixo: se a auditoria ainda o usasse, apareceria
await garantirFontesReais(q14, [{ type: "text", text: "<<<SISTEMA DA GERACAO>>>" }], [], 120_000, "linguagens", [], null);
t("J8 o sistema da geração NÃO chega à auditoria",
  JSON.stringify(__stub.sistema || "").includes("VALIDADOR DE FONTES")
  && !JSON.stringify(__stub.sistema || "").includes("<<<SISTEMA DA GERACAO>>>"),
  JSON.stringify(__stub.sistema || "").slice(0, 120));

/* ---------- K. v74.16 — acervos de prioridade obrigatória ----------
   Cinco acervos indicados pelo professor, a serem consultados nesta ordem em
   Língua Portuguesa, Literatura e Artes. Prioridade, não exclusividade. */
const ORDEM_DO_PROFESSOR = [
  "https://bndigital.bn.gov.br/",
  "https://bndigital.bn.gov.br/hemeroteca-digital/",
  "https://search.bbm.usp.br/pt-br/projetos-digitais-da-bbm/bbm-digital/",
  "https://www.buscaintegrada.usp.br/",
  "http://www.dominiopublico.gov.br/",
];
t("K1 os cinco acervos estão na ORDEM que o professor mandou",
  ACERVOS_PRIORITARIOS.map((a: any) => a.url).join("|") === ORDEM_DO_PROFESSOR.join("|"),
  JSON.stringify(ACERVOS_PRIORITARIOS.map((a: any) => a.url)));
t("K2 os endereços estão sem o rastreador utm_source com que chegaram",
  ACERVOS_PRIORITARIOS.every((a: any) => !a.url.includes("utm_source") && !a.url.includes("?")));
t("K3 cada acervo tem nome, para a referência sair identificada",
  ACERVOS_PRIORITARIOS.every((a: any) => typeof a.nome === "string" && a.nome.length > 5));
t("K4 vale nas três disciplinas que o professor nomeou",
  JSON.stringify(DISCIPLINAS_COM_ACERVO_PRIORITARIO) === JSON.stringify(["Língua Portuguesa", "Literatura", "Artes"])
  && ["Língua Portuguesa", "Literatura", "Artes"].every((d) => temAcervoPrioritario(d)));
t("K5 NÃO vale nas demais disciplinas",
  ["História", "Geografia", "Filosofia", "Sociologia", "Biologia", "Química", "Física", "Matemática",
   "Práticas Corporais", "Língua Estrangeira (Inglês/Espanhol)"]
  .every((d) => !temAcervoPrioritario(d) && buildAcervosPrioritarios(d) === ""));
t("K6 o bloco manda começar por eles, na ordem, e só passar ao seguinte quando o anterior não tiver",
  (() => { const b = buildAcervosPrioritarios("Literatura");
    return b.includes("ACERVOS DE PRIORIDADE OBRIGATÓRIA")
      && b.includes("Consulte-os PRIMEIRO, NESTA ORDEM")
      && b.includes("Só passe ao acervo seguinte quando o anterior não tiver o material")
      && ORDEM_DO_PROFESSOR.every((u, i) => b.indexOf(u) > -1 && (i === 0 || b.indexOf(u) > b.indexOf(ORDEM_DO_PROFESSOR[i - 1])));
  })());
t("K7 é PRIORIDADE, não exclusividade: esgotada a lista, valem as fontes do item 1 da regra",
  buildAcervosPrioritarios("Artes").includes("Esgotada a lista inteira")
  && buildAcervosPrioritarios("Artes").includes("universidades, bibliotecas, museus"));
t("K8 a prioridade não afrouxa autoria, ano, referência nem trecho conferido",
  buildAcervosPrioritarios("Artes").includes("A prioridade NÃO afrouxa nada"));
t("K9 a trava da URL continua inteira — nada de link deduzido",
  buildAcervosPrioritarios("Artes").includes("tenha aparecido DE FATO num resultado de busca desta conversa")
  && buildAcervosPrioritarios("Artes").includes("NÃO monte endereço de acervo por dedução"));
/* K10/K11 leem o ARQUIVO DE PRODUÇÃO: buildPesquisaFontePrompt tem template
   literals aninhados que o recortador deste teste não isola com segurança.
   O comportamento em execução está provado no selftest (economiaBuscas
   .v7416_acervosPrioritarios.noPromptDoPesquisador). */
t("K10 buildPesquisaFontePrompt injeta o bloco pela disciplina da questão",
  fonte.includes("${buildAcervosPrioritarios(o.disciplina)}"));
t("K11 a segunda tentativa manda sair dos acervos quando eles já foram varridos",
  fonte.includes("Se você já varreu os acervos de prioridade e eles não tinham o material, procure AGORA fora deles"));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);
