import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
/* v5 (14/09/2026) — REVISOR DE NOTAÇÃO. Além da auditoria de contas, esta função
   agora corrige o que a rede de segurança determinística (notacao_matematica.ts)
   não consegue converter sozinha: expoente com fração (2^(t/3)), índice com
   várias letras (V_cone), letra x como ×, raiz sem barra… O passe só roda quando
   nmAudita encontra resíduo em algum campo, reescreve SÓ esses campos com as
   regras oficiais de notação (os mesmos blocos do prompt de geração), renormaliza
   e confere de novo — até 2 tentativas. Nunca derruba a entrega: o que sobrar
   volta apontado em `notacao.residuosDepois` e o app avisa no cartão. */
import { nmNormalizaQuestao, nmAudita } from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/notacao_matematica.ts";
import { normalizarNotacaoQuimica } from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/notacao_quimica.ts";
import { NOTACAO_MATEMATICA, NOTACAO_QUIMICA } from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/recurso_instrucoes.ts";

/* REVISOR DE MATEMÁTICA — agente separado do gerador de questões do ENEM
   (generate-question). Único trabalho: auditar a CORREÇÃO MATEMÁTICA (contas,
   fórmulas, unidades, coerência entre resolução comentada e gabarito) de uma
   questão de matemática já pronta, usando como lastro exclusivo os trechos
   recuperados de public.math_reference_chunks (63 livros didáticos indexados
   por embedding). NÃO revisa pedagogia/estilo/formato — isso já é feito pela
   validação existente na generate-question.

   Regra inegociável: só corrige o que estiver fundamentado em trecho
   efetivamente recuperado do banco de referência. Sem cobertura relevante,
   ou sem certeza de que o trecho recuperado endereça o ponto em dúvida, a
   questão volta INALTERADA. Ver skills/revisor-matematica/SKILL.md.

   v4 (14/09/2026): uma linha no prompt pede que a notação Unicode da questão
   seja preservada ao reescrever (v71 da generate-question). v5 (mesmo dia):
   passe de REVISÃO DE NOTAÇÃO, ver cabeçalho no topo — chamado pela
   generate-question em todas as áreas quando sobra notação ASCII.

   Chamado internamente pela generate-question (mesmo projeto Supabase) só
   quando area === "matematica". Nunca é chamado pelo app diretamente. Reusa
   os secrets já configurados neste projeto — nenhuma credencial nova:
   OPENAI_API_KEY (embeddings, mesma chave da generate-image/ingest-math-
   reference) e ANTHROPIC_API_KEY (mesma chave da generate-question). */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = "text-embedding-3-small";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Gate de cobertura: exige pelo menos MIN_CHUNKS trechos com similaridade
// >= MATCH_THRESHOLD para considerar que há lastro suficiente para revisar.
const MATCH_COUNT = 8;
const MATCH_THRESHOLD = 0.25;
const MIN_CHUNKS = 2;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function campoRevisavel(q: any) {
  return {
    textoBase: String(q?.textoBase ?? ""),
    comando: String(q?.comando ?? ""),
    alternativas: (q?.alternativas && typeof q.alternativas === "object") ? q.alternativas : {},
    gabarito: String(q?.gabarito ?? ""),
    resolucaoComentada: String(q?.resolucaoComentada ?? ""),
  };
}

async function embedText(text: string): Promise<number[]> {
  /* Relógio de segurança: sem isto, uma trava de rede aqui ficaria pendurada
     indefinidamente — e como quem chama esta função (generate-question)
     também não tinha timeout próprio nessa ponta, o efeito seria travar a
     entrega da questão inteira, o oposto do que este revisor promete ("nunca
     pode derrubar a entrega"). 20 s é generoso para um embedding, que
     normalmente responde em menos de 1 s. */
  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: [text] }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`OpenAI embeddings HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const item = (data.data || [])[0];
    if (!item?.embedding) throw new Error("OpenAI embeddings: resposta sem embedding.");
    return item.embedding;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("OpenAI embeddings: sem resposta em 20 s.");
    throw err;
  } finally {
    clearTimeout(watchdog);
  }
}

function buildQueryText(q: any): string {
  const partes = [
    q?.disciplina || "",
    q?.objetoConhecimento || "",
    q?.habilidade?.texto || "",
    q?.tema || "",
    q?.textoBase || "",
    q?.comando || "",
    q?.resolucaoComentada || "",
  ].filter(Boolean);
  return partes.join("\n").slice(0, 6000);
}

/* CUSTO (v3): até a v2 a ferramenta EXIGIA os cinco campos da questão em toda
   resposta — inclusive quando "alterado" era false, caso em que o código
   abaixo (questionFinal) descarta tudo e usa a questão original. Eram ~1.000
   tokens de saída pagos e jogados fora na maioria das revisões. Agora os
   campos só são obrigatórios quando há correção; o julgamento do revisor
   (o que ele confere e quando corrige) não mudou em nada. */
const FERRAMENTA_REVISAO = {
  name: "entregar_revisao",
  description: "Entrega o veredito da revisão matemática. Se alterado=false, envie SOMENTE alterado e resumo (a questão original é mantida integralmente). Se alterado=true, envie também os cinco campos finais completos (textoBase, comando, alternativas, gabarito, resolucaoComentada).",
  input_schema: {
    type: "object",
    properties: {
      alterado: { type: "boolean", description: "true somente se houve correção matemática real e fundamentada nos trechos." },
      resumo: { type: "string", description: "Explicação curta do veredito." },
      textoBase: { type: "string", description: "Obrigatório apenas se alterado=true." },
      comando: { type: "string", description: "Obrigatório apenas se alterado=true." },
      alternativas: { type: "object", description: "Obrigatório apenas se alterado=true." },
      gabarito: { type: "string", description: "Obrigatório apenas se alterado=true." },
      resolucaoComentada: { type: "string", description: "Obrigatório apenas se alterado=true." },
    },
    required: ["alterado", "resumo"],
  },
};

function buildSystemPrompt(): string {
  return `Você é o Revisor de Matemática: um auditor cuja ÚNICA tarefa é verificar se a MATEMÁTICA de uma questão já pronta está correta — contas, fórmulas, unidades, coerência entre a resolução comentada e o gabarito. Você NÃO revisa pedagogia, estilo, formato ENEM, habilidade da Matriz ou qualidade dos distratores — isso já foi validado antes de a questão chegar até você.

REGRA INEGOCIÁVEL: você só pode alterar algo se a correção estiver fundamentada em um dos trechos de referência fornecidos abaixo. Se os trechos não abordarem especificamente o ponto que está em dúvida, ou se você não tiver certeza absoluta de que há um erro matemático real, devolva a questão exatamente como recebeu (alterado: false) e explique no resumo por que não havia lastro suficiente para corrigir. NUNCA corrija por "achismo" ou por preferência de estilo de resolução — apenas erro matemático real e comprovável.

Ao corrigir, altere o MÍNIMO necessário: normalmente apenas a resolucaoComentada e/ou o gabarito (quando o gabarito não corresponde ao resultado correto) e, só se estritamente necessário, o texto de uma alternativa. Nunca reescreva a questão inteira. NOTAÇÃO: ao reescrever qualquer trecho, preserve a notação Unicode já usada na questão (x², 10⁻³, Q₀, aₙ, 2ˣ, ×, ·, √) e nunca introduza acento circunflexo como expoente (x^2), sublinhado como índice (Q_0), LaTeX ou a letra x como sinal de multiplicação. Se "alterado" for true, devolva os cinco campos (textoBase, comando, alternativas, gabarito, resolucaoComentada) por completo — os que você não mudou, idênticos aos originais. Se "alterado" for false, envie SOMENTE "alterado" e "resumo": NÃO repita os campos da questão, que será mantida exatamente como recebida.

Responda SEMPRE usando a ferramenta entregar_revisao — nunca em texto livre.`;
}

function buildUserPrompt(q: any, trechos: any[]): string {
  const campos = campoRevisavel(q);
  const trechosTxt = trechos.map((t, i) =>
    `[Trecho ${i + 1} — livro ${t.livro}, pág. ~${t.pagina_aprox ?? "?"}, similaridade ${t.similarity.toFixed(3)}]\n${t.conteudo}`
  ).join("\n\n");

  return `QUESTÃO A AUDITAR
Disciplina: ${q?.disciplina || ""}
Tema: ${q?.tema || ""}
Objeto de conhecimento: ${q?.objetoConhecimento || ""}
Habilidade: ${q?.habilidade?.codigo || ""} — ${q?.habilidade?.texto || ""}

Texto-base:
${campos.textoBase}

Comando:
${campos.comando}

Alternativas:
${JSON.stringify(campos.alternativas, null, 2)}

Gabarito informado: ${campos.gabarito}

Resolução comentada:
${campos.resolucaoComentada}

TRECHOS RECUPERADOS DO BANCO DE REFERÊNCIA (use como lastro exclusivo para qualquer correção)
${trechosTxt}

Verifique: a resolução comentada bate matematicamente? O gabarito corresponde ao resultado correto? Alguma fórmula/propriedade foi aplicada de forma incorreta, à luz dos trechos acima? Se sim e houver lastro claro nos trechos, corrija o mínimo necessário (alterado: true, com os cinco campos). Se não houver erro real, ou os trechos não sustentarem uma correção específica, responda apenas alterado: false e o resumo — sem repetir a questão.`;
}

async function callClaudeForReview(system: string, userMsg: string, prazoMs = 45_000): Promise<any> {
  /* Mesmo relógio de segurança que a embedText, pelo mesmo motivo: esta
     chamada não é streaming e não tinha nenhum limite de tempo próprio. 45 s
     é folgado para uma resposta de até 4000 tokens sem streaming (v5: ou o
     que restar do prazo do chamador, se for menos). */
  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), Math.max(8_000, Math.min(45_000, prazoMs)));
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: userMsg }],
        tools: [FERRAMENTA_REVISAO],
        tool_choice: { type: "tool", name: "entregar_revisao" },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const toolUse = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === "entregar_revisao");
    if (!toolUse?.input) throw new Error("Resposta do Claude sem tool_use de entregar_revisao.");
    return toolUse.input;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Anthropic: sem resposta em 45 s.");
    throw err;
  } finally {
    clearTimeout(watchdog);
  }
}

/* ======================= REVISÃO DE NOTAÇÃO (v5) ======================= */
// Campos de texto que a notação alcança (os mesmos da rede determinística; "fonte" e
// "promptImagem" ficam de fora de propósito).
type Residuo = { campo: string; achados: string[]; texto: string };
function camposDeTexto(q: any): { campo: string; texto: string }[] {
  const out: { campo: string; texto: string }[] = [];
  // "tema" fica de fora: é texto do professor, não do modelo.
  for (const c of ["textoBase", "comando", "resolucaoComentada"]) if (typeof q?.[c] === "string") out.push({ campo: c, texto: q[c] });
  if (q?.alternativas && typeof q.alternativas === "object") for (const L of Object.keys(q.alternativas)) if (typeof q.alternativas[L] === "string") out.push({ campo: `alternativas.${L}`, texto: q.alternativas[L] });
  if (q?.analiseAlternativas && typeof q.analiseAlternativas === "object") for (const L of Object.keys(q.analiseAlternativas)) { const a = q.analiseAlternativas[L]; if (a && typeof a.comentario === "string") out.push({ campo: `analiseAlternativas.${L}.comentario`, texto: a.comentario }); }
  const v = q?.visual;
  if (v && typeof v === "object") {
    for (const c of ["titulo", "descricao"]) if (typeof v[c] === "string") out.push({ campo: `visual.${c}`, texto: v[c] });
    if (Array.isArray(v.colunas)) v.colunas.forEach((x: any, i: number) => { if (typeof x === "string") out.push({ campo: `visual.colunas.${i}`, texto: x }); });
    if (Array.isArray(v.linhas)) v.linhas.forEach((l: any, i: number) => { if (Array.isArray(l)) l.forEach((x: any, j: number) => { if (typeof x === "string") out.push({ campo: `visual.linhas.${i}.${j}`, texto: x }); }); });
    if (Array.isArray(v.labels)) v.labels.forEach((x: any, i: number) => { if (typeof x === "string") out.push({ campo: `visual.labels.${i}`, texto: x }); });
  }
  return out;
}
// Resíduos de notação ASCII que a rede determinística deixou (^, _, LaTeX, "sqrt(", letra x como ×)
// e índices com mais de uma letra (V_cone, R_total), que não têm subscrito possível.
// Só em Matemática e Natureza: em Linguagens/Humanas "@a_silva", "#e_agora" são
// nomes de usuário e hashtags, não índices (o @/# também é excluído).
const RE_INDICE_PALAVRA = /(?<![\p{L}\p{Nd}@#\/])\p{L}_[\p{L}]{2,}(?![\p{L}\p{Nd}])/u;
export function residuosNotacao(q: any, area = "matematica"): Residuo[] {
  const out: Residuo[] = [];
  const indicesContam = area === "matematica" || area === "natureza";
  for (const { campo, texto } of camposDeTexto(q)) {
    const achados = nmAudita(texto).slice();
    if (indicesContam && RE_INDICE_PALAVRA.test(texto)) achados.push("índice com mais de uma letra (V_cone, R_total): use índice de uma letra, número ou palavra");
    if (achados.length) out.push({ campo, achados, texto });
  }
  return out;
}
function lerCampo(q: any, campo: string): any {
  return campo.split(".").reduce((o, k) => (o == null ? o : o[k]), q);
}
function escreverCampo(q: any, campo: string, valor: string): void {
  const partes = campo.split(".");
  let o = q;
  for (let i = 0; i < partes.length - 1; i++) { if (o[partes[i]] == null || typeof o[partes[i]] !== "object") return; o = o[partes[i]]; }
  if (typeof o[partes[partes.length - 1]] === "string") o[partes[partes.length - 1]] = valor;
}

const FERRAMENTA_NOTACAO = {
  name: "entregar_notacao",
  description: "Entrega os campos reescritos em notação Unicode. Envie SOMENTE os campos listados como problemáticos, cada um com o texto COMPLETO reescrito (não só o trecho).",
  input_schema: {
    type: "object",
    properties: {
      campos: { type: "object", description: "Mapa nomeDoCampo → texto completo reescrito. Use exatamente os nomes recebidos (ex.: 'resolucaoComentada', 'alternativas.B', 'analiseAlternativas.C.comentario').", additionalProperties: { type: "string" } },
      resumo: { type: "string", description: "O que foi reescrito, em uma frase." },
    },
    required: ["campos", "resumo"],
  },
};

function systemNotacao(area: string): string {
  const quimica = area === "natureza" ? NOTACAO_QUIMICA : "";
  return `Você é o Revisor de Notação do Gerador de Simulados ENEM. Uma questão já pronta chegou com trechos em notação ASCII que o sistema não consegue converter automaticamente (expoente com fração como 2^(t/3), índice com várias letras como V_cone, letra x como sinal de multiplicação, raiz escrita como "sqrt(" etc.). Sua ÚNICA tarefa é reescrever os campos indicados de modo que TODA a notação obedeça às regras abaixo, preservando integralmente o conteúdo matemático, o raciocínio, os valores e o sentido pedagógico do texto — nada de acrescentar, cortar ou "melhorar" o que não for notação.

COMO RESOLVER OS CASOS QUE NÃO TÊM CARACTERE UNICODE:
• expoente com fração ou expressão (2^(t/3), 10^(x/2), e^(-t/RC)): introduza uma variável auxiliar de UMA letra e declare-a em seguida — "P(t) = 500 · 2ⁿ, em que n = t/3" — e use essa mesma variável em TODAS as ocorrências do campo (500 · 2ⁿ = 4000 ⇒ 2ⁿ = 8 ⇒ n = 3 ⇒ t/3 = 3 ⇒ t = 9). Se a variável já existir com outro significado na questão, escolha outra letra (k, m, u, w).
• expoente decimal (2^(-1,5)): reescreva como fração de inteiros com raiz (1/(2√2)) ou com variável auxiliar.
• índice com mais de uma letra (V_cone, V_cil, R_total, t_subida): troque por índice de UMA letra que exista em subscrito (ₐ ₑ ₕ ᵢ ⱼ ₖ ₗ ₘ ₙ ₒ ₚ ᵣ ₛ ₜ ᵤ ᵥ ₓ) ou por número (V₁ para o cone, V₂ para o cilindro), declarando o significado uma vez ("V₁ (volume do cone)"), e use a mesma grafia em todas as ocorrências.
• letra x como multiplicação → × entre números, · entre símbolos. "sqrt(a)" → √ com barra sobre todo o radicando (escreva √(a) que o sistema aplica a barra, ou use o combinante U+0305 em cada caractere).
• expoente/índice simples que sobrou (x^2, a_1): x², a₁ — direto.

REGRAS (as mesmas do gerador):${quimica}
${NOTACAO_MATEMATICA}

ENTREGA: chame a ferramenta entregar_notacao com o texto COMPLETO de cada campo listado (não só o trecho), usando exatamente os nomes de campo recebidos. Não altere campos que não foram listados. Não use ^, _, LaTeX, HTML nem a letra x como sinal em NENHUM lugar do texto devolvido.`;
}

// Letras soltas já usadas como variável na questão inteira (t, P, n…): a variável
// auxiliar não pode colidir com elas.
function letrasUsadas(q: any): string[] {
  const set = new Set<string>();
  for (const { texto } of camposDeTexto(q)) for (const m of texto.matchAll(/(?<![\p{L}\p{Nd}])([a-zA-Z])(?![\p{L}\p{Nd}])/gu)) set.add(m[1]);
  return Array.from(set).sort();
}
function userNotacao(q: any, residuos: Residuo[], tentativa: number, restantes?: Residuo[]): string {
  const blocos = residuos.map((r) => `— campo "${r.campo}" (problemas: ${r.achados.join("; ")}):\n${r.texto}`).join("\n\n");
  const cabecalho = tentativa === 1
    ? "CAMPOS COM NOTAÇÃO A CORRIGIR (devolva cada um completo, reescrito):"
    : `A tentativa anterior AINDA deixou notação ASCII nestes campos (${(restantes || []).map((r) => r.campo + ": " + r.achados.join("; ")).join(" | ")}). Reescreva de novo, eliminando TODO ^ e _ — se um expoente tiver fração, introduza a variável auxiliar. Campos:`;
  const listados = new Set(residuos.map((r) => r.campo));
  const contexto = camposDeTexto(q).filter((c) => !listados.has(c.campo)).map((c) => `[${c.campo}] ${c.texto.slice(0, 700)}`).join("\n");
  const letras = letrasUsadas(q);
  return `${cabecalho}\n\n${blocos}\n\nCONTEXTO — os demais campos da questão, SÓ PARA LEITURA (não devolva, não altere): use a MESMA variável auxiliar e a MESMA grafia que já aparecem neles.\n${contexto}\n\nLETRAS JÁ USADAS COMO VARIÁVEL NA QUESTÃO: ${letras.join(", ") || "(nenhuma)"} — se precisar de variável auxiliar, escolha uma letra que NÃO esteja nesta lista (preferência: n, k, m, u, w, nessa ordem), a menos que a auxiliar já tenha sido introduzida em outro campo — aí repita exatamente a mesma.`;
}

async function callClaudeNotacao(system: string, userMsg: string, prazoMs: number): Promise<any> {
  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), Math.max(5_000, prazoMs));
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, thinking: { type: "disabled" }, messages: [{ role: "user", content: userMsg }], tools: [FERRAMENTA_NOTACAO], tool_choice: { type: "tool", name: "entregar_notacao" } }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Anthropic HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
    const data = await resp.json();
    const toolUse = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === "entregar_notacao");
    if (!toolUse?.input) throw new Error("Resposta sem tool_use de entregar_notacao.");
    return toolUse.input;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Anthropic (notação): sem resposta no prazo.");
    throw err;
  } finally { clearTimeout(watchdog); }
}

// Aplica os campos devolvidos, renormaliza (química → matemática) e confere de novo.
// Exportada para teste; `chamar` permite simular o modelo.
export async function revisarNotacao(question: any, area: string, disciplina: string, prazoMs: number, chamar = callClaudeNotacao): Promise<{ question: any; notacao: any }> {
  const inicio = Date.now();
  let q = nmNormalizaQuestao(normalizarNotacaoQuimica(question, area, disciplina), disciplina);
  const antes = residuosNotacao(q, area);
  const info: any = { residuosAntes: antes.map((r) => ({ campo: r.campo, achados: r.achados })), tentativas: 0, alterado: false, resumo: "" };
  if (!antes.length) { info.residuosDepois = []; return { question: q, notacao: info }; }
  let pendentes = antes;
  for (let tentativa = 1; tentativa <= 2 && pendentes.length; tentativa++) {
    const restante = prazoMs - (Date.now() - inicio);
    if (restante < 8_000) { info.interrompido = "sem tempo para nova tentativa"; break; }
    info.tentativas = tentativa;
    let saida: any;
    try { saida = await chamar(systemNotacao(area), userNotacao(q, tentativa === 1 ? antes : pendentes, tentativa, pendentes), Math.min(restante - 2_000, 45_000)); }
    catch (e) { info.erro = String((e as any)?.message || e); break; }
    const campos = saida?.campos && typeof saida.campos === "object" ? saida.campos : {};
    const permitidos = new Set(antes.map((r) => r.campo));
    const candidato = JSON.parse(JSON.stringify(q));
    let aplicados = 0;
    for (const [campo, texto] of Object.entries(campos)) {
      if (!permitidos.has(campo) || typeof texto !== "string" || !texto.trim()) continue;   // só os campos listados; nunca apaga um campo
      escreverCampo(candidato, campo, texto); aplicados++;
    }
    if (!aplicados) { info.erro = "o modelo não devolveu nenhum dos campos pedidos"; break; }
    let renormalizado = nmNormalizaQuestao(normalizarNotacaoQuimica(candidato, area, disciplina), disciplina);
    // Aceitação CAMPO A CAMPO: um campo reescrito só entra se ficou com menos
    // resíduos do que tinha; se piorou ou empatou, volta o texto anterior.
    const contaResiduos = (texto: string) => nmAudita(texto).length + (RE_INDICE_PALAVRA.test(texto) ? 1 : 0);
    // Guarda de conteúdo: a reescrita é só de notação, então todo NÚMERO do texto
    // original tem de continuar lá (sobrescritos/subscritos contam como dígitos) e o
    // tamanho não pode mudar demais. Impede que o modelo "resolva" a notação
    // trocando o conteúdo da resolução.
    const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹", SUB = "₀₁₂₃₄₅₆₇₈₉";
    const soDigitos = (t: string) => Array.from(t).map((c) => { const i = SUP.indexOf(c); const j = SUB.indexOf(c); return i >= 0 ? String(i) : j >= 0 ? String(j) : c; }).join("").replace(/\u0305/g, "");
    const numeros = (t: string): string[] => Array.from(soDigitos(t).match(/\d+(?:[,.]\d+)?/g) || []);
    const preservaConteudo = (antesTxt: string, depoisTxt: string): string | null => {
      // os números DENTRO de um expoente que será reescrito (2^(1/2) → √2, 2^(3/2) → 2√2) podem sumir legitimamente
      const semExpoentes = antesTxt.replace(/\^(?:\([^()\n]{1,40}\)|\{[^{}\n]{1,40}\}|[+\-−–]?\d{1,3}|[A-Za-z])/g, "^");
      const dep = numeros(depoisTxt); const faltam = numeros(semExpoentes).filter((n) => !dep.includes(n));
      const razao = depoisTxt.length / Math.max(1, antesTxt.length);
      if (faltam.length) return `números sumiram: ${faltam.slice(0, 5).join(", ")}`;
      // declarar uma variável auxiliar ("V₁ (cone)") alonga um campo curto — tolera crescimento pequeno em valor absoluto
      if (razao < 0.6 || (razao > 1.8 && depoisTxt.length - antesTxt.length > 80)) return `tamanho mudou demais (${razao.toFixed(2)}×)`;
      return null;
    };
    const rejeitados: string[] = [];
    for (const campo of Object.keys(campos)) {
      if (!permitidos.has(campo)) continue;
      const antesTxt = lerCampo(q, campo), depoisTxt = lerCampo(renormalizado, campo);
      if (typeof antesTxt !== "string" || typeof depoisTxt !== "string" || depoisTxt === antesTxt) continue;
      const melhorou = contaResiduos(depoisTxt) < contaResiduos(antesTxt);
      const motivo = melhorou ? preservaConteudo(antesTxt, depoisTxt) : "não melhorou a notação";
      if (motivo) { escreverCampo(renormalizado, campo, antesTxt); rejeitados.push(`${campo} (${motivo})`); }
    }
    if (rejeitados.length) info.rejeitados = (info.rejeitados || []).concat(rejeitados.map((c) => `tentativa ${tentativa}: ${c}`));
    renormalizado = nmNormalizaQuestao(normalizarNotacaoQuimica(renormalizado, area, disciplina), disciplina);
    const depois = residuosNotacao(renormalizado, area);
    if (JSON.stringify(renormalizado) !== JSON.stringify(q)) { info.alterado = true; info.resumo = String(saida?.resumo || ""); }
    q = renormalizado; pendentes = depois;
  }
  info.residuosDepois = pendentes.map((r) => ({ campo: r.campo, achados: r.achados }));
  info.ms = Date.now() - inicio;
  return { question: q, notacao: info };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado. Use POST." }, 405);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "JSON inválido." }, 400); }

  const question = body?.question;
  if (!question || typeof question !== "object") {
    return jsonResponse({ error: "Campo 'question' ausente ou inválido." }, 400);
  }
  // v5: contexto para o passe de notação (todas as áreas) e orçamento de tempo do chamador.
  const area = String(body?.area || question?.area || "matematica");
  const disciplina = String(body?.disciplina || question?.disciplina || "Matemática");
  const prazoTotalMs = Number.isFinite(Number(body?.prazoMs)) ? Math.max(10_000, Math.min(120_000, Number(body.prazoMs))) : 100_000;
  const inicioReq = Date.now();
  const soNotacao = body?.soNotacao === true || area !== "matematica";

  // Falha segura: qualquer erro interno devolve a questão original inalterada
  // em vez de propagar o erro — este agente nunca pode bloquear a entrega.
  // v5: o passe de notação corre depois da revisão de contas (ou sozinho, fora de
  // Matemática) e nunca derruba a entrega.
  const comNotacao = async (resposta: any) => {
    try {
      if (!ANTHROPIC_API_KEY) return resposta;
      const prazo = prazoTotalMs - (Date.now() - inicioReq);
      const r = await revisarNotacao(resposta.question, area, disciplina, prazo);
      return { ...resposta, question: r.question, notacao: r.notacao };
    } catch (e) {
      return { ...resposta, notacao: { erro: String((e as any)?.message || e) } };
    }
  };

  try {
    if (soNotacao) {
      return jsonResponse(await comNotacao({ question, coberturaEncontrada: false, alterado: false, resumo: "Só revisão de notação (fora de Matemática)." }));
    }
    if (!OPENAI_API_KEY || !ANTHROPIC_API_KEY) {
      return jsonResponse(await comNotacao({
        question,
        coberturaEncontrada: false,
        alterado: false,
        resumo: "Revisor de matemática não configurado (falta OPENAI_API_KEY ou ANTHROPIC_API_KEY) — questão mantida sem alterações.",
      }));
    }

    // v5: com pouco tempo E resíduo de notação, a notação tem prioridade (o
    // professor exige zero resíduo; a revisão de contas é melhor esforço).
    if (prazoTotalMs < 60_000 && residuosNotacao(question, area).length) {
      return jsonResponse(await comNotacao({ question, coberturaEncontrada: false, alterado: false, resumo: "Prazo curto: revisão de contas pulada para garantir a de notação." }));
    }
    const queryText = buildQueryText(question);
    if (!queryText.trim()) {
      return jsonResponse(await comNotacao({ question, coberturaEncontrada: false, alterado: false, resumo: "Questão sem conteúdo suficiente para busca — mantida sem alterações." }));
    }

    const queryEmbedding = await embedText(queryText);

    const { data: trechos, error: rpcError } = await supabase.rpc("match_math_reference_chunks", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      match_threshold: MATCH_THRESHOLD,
    }).abortSignal(AbortSignal.timeout(20_000));   // v5: a busca vetorial também tem relógio
    if (rpcError) throw new Error(`RPC match_math_reference_chunks: ${rpcError.message}`);

    const chunks = Array.isArray(trechos) ? trechos : [];
    if (chunks.length < MIN_CHUNKS) {
      return jsonResponse(await comNotacao({
        question,
        coberturaEncontrada: false,
        alterado: false,
        resumo: `Nenhuma cobertura relevante encontrada na base de referência (${chunks.length} trecho(s) acima do limiar) — questão mantida sem alterações.`,
      }));
    }

    const system = buildSystemPrompt();
    const userMsg = buildUserPrompt(question, chunks);
    const revisao = await callClaudeForReview(system, userMsg, prazoTotalMs - (Date.now() - inicioReq) - 12_000);

    const alterado = revisao?.alterado === true;
    const questionFinal = alterado
      ? {
          ...question,
          textoBase: revisao.textoBase ?? question.textoBase,
          comando: revisao.comando ?? question.comando,
          alternativas: revisao.alternativas ?? question.alternativas,
          gabarito: revisao.gabarito ?? question.gabarito,
          resolucaoComentada: revisao.resolucaoComentada ?? question.resolucaoComentada,
        }
      : question;

    return jsonResponse(await comNotacao({
      question: questionFinal,
      coberturaEncontrada: true,
      alterado,
      resumo: String(revisao?.resumo || ""),
      referencias: chunks.map((c: any) => ({ livro: c.livro, pagina_aprox: c.pagina_aprox, similarity: c.similarity })),
    }));
  } catch (err) {
    return jsonResponse(await comNotacao({
      question,
      coberturaEncontrada: false,
      alterado: false,
      resumo: `Erro interno no revisor de matemática — questão mantida sem alterações: ${String((err as any)?.message || err)}`,
    }));
  }
});
