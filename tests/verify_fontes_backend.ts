/* v74.8 — VALIDAÇÃO OBRIGATÓRIA DE FONTES no backend (generate-question).

   Prova a regra do professor SEM chamar a Anthropic: extrai do arquivo de
   produção o bloco que vai de "VALIDAÇÃO OBRIGATÓRIA DE FONTES" até o marcador
   de fim, e substitui APENAS as dependências externas (callClaudeForJSON) por
   dublês controláveis. O código conferido é o que roda em produção.

   Uso:
     deno run -A tests/verify_fontes_backend.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
const i = fonte.indexOf("/* ═══════════ v74.8 — VALIDAÇÃO OBRIGATÓRIA DE FONTES");
const j = fonte.indexOf("/* ═══════════ FIM DO BLOCO DE VALIDAÇÃO DE FONTES");
if (i < 0 || j < 0 || j < i) { console.error("FALHA: não achei o bloco de fontes em " + alvo); Deno.exit(1); }

// A mensagem e o escopo são lidos do MESMO arquivo, não copiados à mão:
// se alguém reescrever o texto do professor, o teste acusa.
const mMsg = fonte.match(/const MENSAGEM_FONTE_BLOQUEIO = "([^"]+)";/);
const mAreas = fonte.match(/const AREAS_FONTES_REAIS_ESTRITO = (\[[^\]]*\]);/);
if (!mMsg || !mAreas) { console.error("FALHA: não achei MENSAGEM_FONTE_BLOQUEIO / AREAS_FONTES_REAIS_ESTRITO"); Deno.exit(1); }

const modulo = `type SistemaPrompt = any;
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
const AREAS_FONTES_REAIS_ESTRITO = ${mAreas[1]};
function fontesReaisEstrito(area: string): boolean {
  return AREAS_FONTES_REAIS_ESTRITO.includes(String(area || "").trim().toLowerCase());
}
const MENSAGEM_FONTE_BLOQUEIO = ${JSON.stringify(mMsg[1])};
export const __stub: any = { resposta: null, erro: null, chamadas: 0, ultimoPrompt: "", buscaLigada: null };
async function callClaudeForJSON(_s: any, userMsg: string, w: any, usos: any[], _f: any) {
  __stub.chamadas++; __stub.ultimoPrompt = userMsg; __stub.buscaLigada = w;
  if (usos) usos.push({ input_tokens: 1, output_tokens: 1 });
  if (__stub.erro) throw new Error(__stub.erro);
  return __stub.resposta;
}
` + fonte.slice(i, j) + `
export { conferenciaFontes, normalizaUrl, buildAuditoriaFontesPrompt, garantirFontesReais, FERRAMENTA_AUDITORIA_FONTE, MENSAGEM_FONTE_BLOQUEIO, fontesReaisEstrito };
`;
const tmp = await Deno.makeTempDir();
const caminho = `${tmp}/fontes_mod.ts`;
await Deno.writeTextFile(caminho, modulo);
const M: any = await import("file://" + caminho);
const { conferenciaFontes, normalizaUrl, buildAuditoriaFontesPrompt, garantirFontesReais,
        FERRAMENTA_AUDITORIA_FONTE, MENSAGEM_FONTE_BLOQUEIO, fontesReaisEstrito, __stub } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };

const MSG_ESPERADA = "Não foi possível verificar uma fonte real para o autor ou a obra solicitada. Envie o texto ou uma referência confiável para continuar.";

const fonteBoa = (extra: any = {}) => ({
  tipoUso: "parafrase", autor: "Machado de Assis", obra: "Memórias Póstumas de Brás Cubas",
  ano: "1881", referencia: "ASSIS, M. Memórias Póstumas de Brás Cubas. Rio de Janeiro, 1881.",
  comoVerificou: "conferido no acervo de Domínio Público", conferidoNaFonte: true, ...extra,
});
const questao = (fonte: any) => ({
  textoBase: "t", comando: "c", gabarito: "B", resolucaoComentada: "r",
  alternativas: { A: "a", B: "b", C: "c", D: "d", E: "e" },
  analiseAlternativas: { A: { comentario: "ca" }, B: { comentario: "cb" }, C: { comentario: "cc" }, D: { comentario: "cd" }, E: { comentario: "ce" } },
  fonte,
});
const fichaBoa = (extra: any = {}) => ({
  autorExiste: true, obraExiste: true, obraPertenceAoAutor: true, trechoConferidoNaFonte: true,
  usoIdentificadoCorretamente: true, referenciaLocalizavelEConfirmada: true,
  inventadoEmOutraParte: false, aprovado: true, motivo: "", ...extra,
});

/* ---------- A. A mensagem literal do professor ---------- */
t("A1 a mensagem de bloqueio é EXATAMENTE a que o professor escreveu",
  MENSAGEM_FONTE_BLOQUEIO === MSG_ESPERADA, JSON.stringify(MENSAGEM_FONTE_BLOQUEIO));
t("A2 o texto integral das 8 regras está no arquivo de produção",
  fonte.includes("É EXPRESSAMENTE PROIBIDO INVENTAR AUTORES, OBRAS, CITAÇÕES OU REFERÊNCIAS. Essa regra não admite exceções.")
  && fonte.includes("Regra central: na dúvida, verificar; sem confirmação, não utilizar. NUNCA INVENTAR PARA COMPLETAR UMA QUESTÃO."));
t("A3 os seis itens da validação obrigatória estão no prompt dos agentes",
  ["O autor existe?", "A obra existe?", "A obra pertence ao autor informado?",
   "O trecho utilizado foi conferido na fonte?",
   "A citação, adaptação ou paráfrase está identificada corretamente?",
   "A referência permite localizar a fonte e contém apenas dados confirmados?"].every((q) => fonte.includes(q)));

/* ---------- B. Escopo: as duas áreas inteiras ---------- */
t("B1 Linguagens está no escopo", fontesReaisEstrito("linguagens"));
t("B2 Ciências Humanas está no escopo", fontesReaisEstrito("humanas"));
t("B3 Natureza e Matemática ficam fora (o pedido é só das duas áreas)",
  !fontesReaisEstrito("natureza") && !fontesReaisEstrito("matematica"));
t("B4 o escopo é por ÁREA — então Práticas Corporais, que é Linguagens, entra",
  fontesReaisEstrito("LINGUAGENS") && fontesReaisEstrito(" linguagens "));

/* ---------- C. Conferência determinística ---------- */
t("C1 questão sem o campo fonte é reprovada", conferenciaFontes(questao(undefined)).estado === "ausente");
t("C2 tipoUso inválido é reprovado", conferenciaFontes(questao(fonteBoa({ tipoUso: "inventado" }))).estado === "invalido");
t("C3 falta de autor/obra/referência é reprovada",
  conferenciaFontes(questao(fonteBoa({ obra: "" }))).estado === "incompleto");
t("C4 citação literal sem conferência na origem é reprovada (regra 5)",
  conferenciaFontes(questao(fonteBoa({ tipoUso: "citacao", conferidoNaFonte: false }))).estado === "citacao_nao_conferida");
t("C5 texto próprio NÃO pode vir com autor/obra preenchidos",
  conferenciaFontes(questao({ tipoUso: "proprio", autor: "Drummond", obra: "", referencia: "", comoVerificou: "", conferidoNaFonte: false })).estado === "incoerente");
t("C6 texto próprio sem atribuição passa",
  conferenciaFontes(questao({ tipoUso: "proprio", autor: "", obra: "", referencia: "", comoVerificou: "", conferidoNaFonte: false })).estado === "ok");
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
t("E3 a auditoria manda usar a busca e não confiar na memória",
  promptAud.includes("web_search") && promptAud.includes("memória"));
t("E4 a auditoria manda reprovar na dúvida", promptAud.includes("na dúvida, verificar; sem confirmação, não utilizar"));
t("E5 a ficha da ferramenta tem os seis itens + o varredor das outras partes",
  FERRAMENTA_AUDITORIA_FONTE.input_schema.required.length === 9
  && ["autorExiste", "obraExiste", "obraPertenceAoAutor", "trechoConferidoNaFonte",
      "usoIdentificadoCorretamente", "referenciaLocalizavelEConfirmada", "inventadoEmOutraParte"]
     .every((k) => FERRAMENTA_AUDITORIA_FONTE.input_schema.required.includes(k)));

/* ---------- F. O bloqueio de verdade ---------- */
const roda = async (q: any, area = "linguagens", restante = 120_000, buscas: any[] = []) => {
  const d = await garantirFontesReais(q, [], [], restante, area, buscas);
  return d;
};

__stub.resposta = fichaBoa(); __stub.erro = null; __stub.chamadas = 0;
let q1: any = questao(fonteBoa());
let d1 = await roda(q1);
t("F1 fonte verificada e ficha limpa: aprovada, sem marca de bloqueio",
  d1.estado === "aprovado" && !q1.fonteNaoVerificada, JSON.stringify(d1));
t("F2 a auditoria roda COM busca na web ligada", __stub.buscaLigada && __stub.buscaLigada.name === "web_search");

__stub.chamadas = 0;
let q2: any = questao(fonteBoa({ obra: "" }));
let d2 = await roda(q2);
t("F3 falha estrutural bloqueia SEM gastar chamada de auditoria",
  d2.estado === "reprovado" && __stub.chamadas === 0 && q2.fonteNaoVerificada.mensagem === MSG_ESPERADA);

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

__stub.resposta = fichaBoa({ trechoConferidoNaFonte: false, aprovado: false, motivo: "trecho não conferido" });
let q5: any = questao(fonteBoa());
let d5 = await roda(q5);
t("F6 trecho não conferido na fonte bloqueia, com o motivo do auditor",
  d5.estado === "reprovado" && d5.motivo === "trecho não conferido");

__stub.resposta = fichaBoa();
let q6: any = questao(fonteBoa());
let d6 = await roda(q6, "linguagens", 10_000);
t("F7 sem tempo para validar NÃO passa — bloqueia (sem confirmação, não utilizar)",
  d6.estado === "reprovado" && q6.fonteNaoVerificada.etapa === "tempo");

__stub.erro = "rede caiu";
let q7: any = questao(fonteBoa());
let d7 = await roda(q7);
t("F8 erro na validação bloqueia — nunca libera por omissão",
  d7.estado === "reprovado" && q7.fonteNaoVerificada.mensagem === MSG_ESPERADA);
__stub.erro = null;

__stub.resposta = fichaBoa(); __stub.chamadas = 0;
let q8: any = questao(undefined);
let d8 = await roda(q8, "natureza");
t("F9 fora das duas áreas a validação não roda e nada é bloqueado",
  d8.estado === "nao_se_aplica" && !q8.fonteNaoVerificada && __stub.chamadas === 0);

__stub.resposta = fichaBoa();
let q9: any = questao(fonteBoa({ urlVerificacao: "https://link-inventado.test/x" }));
let d9 = await roda(q9, "humanas", 120_000, [{ url: "https://scielo.br/abc", title: "y" }]);
t("F10 em Humanas, link inventado bloqueia antes mesmo da auditoria",
  d9.estado === "reprovado" && d9.determinista === "url_nao_confirmada");

__stub.resposta = fichaBoa();
let q10: any = questao(fonteBoa());
q10.fonteNaoVerificada = { motivo: "marca velha" };
let d10 = await roda(q10);
t("F11 aprovando, a marca de bloqueio antiga é apagada",
  d10.estado === "aprovado" && !q10.fonteNaoVerificada);

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);
