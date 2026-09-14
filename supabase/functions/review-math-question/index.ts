import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
   seja preservada ao reescrever (v71 da generate-question — notação em todas
   as áreas). Nenhuma outra mudança.

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

async function callClaudeForReview(system: string, userMsg: string): Promise<any> {
  /* Mesmo relógio de segurança que a embedText, pelo mesmo motivo: esta
     chamada não é streaming e não tinha nenhum limite de tempo próprio. 45 s
     é folgado para uma resposta de até 4000 tokens sem streaming. */
  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), 45_000);
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

  // Falha segura: qualquer erro interno devolve a questão original inalterada
  // em vez de propagar o erro — este agente nunca pode bloquear a entrega.
  try {
    if (!OPENAI_API_KEY || !ANTHROPIC_API_KEY) {
      return jsonResponse({
        question,
        coberturaEncontrada: false,
        alterado: false,
        resumo: "Revisor de matemática não configurado (falta OPENAI_API_KEY ou ANTHROPIC_API_KEY) — questão mantida sem alterações.",
      });
    }

    const queryText = buildQueryText(question);
    if (!queryText.trim()) {
      return jsonResponse({ question, coberturaEncontrada: false, alterado: false, resumo: "Questão sem conteúdo suficiente para busca — mantida sem alterações." });
    }

    const queryEmbedding = await embedText(queryText);

    const { data: trechos, error: rpcError } = await supabase.rpc("match_math_reference_chunks", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      match_threshold: MATCH_THRESHOLD,
    });
    if (rpcError) throw new Error(`RPC match_math_reference_chunks: ${rpcError.message}`);

    const chunks = Array.isArray(trechos) ? trechos : [];
    if (chunks.length < MIN_CHUNKS) {
      return jsonResponse({
        question,
        coberturaEncontrada: false,
        alterado: false,
        resumo: `Nenhuma cobertura relevante encontrada na base de referência (${chunks.length} trecho(s) acima do limiar) — questão mantida sem alterações.`,
      });
    }

    const system = buildSystemPrompt();
    const userMsg = buildUserPrompt(question, chunks);
    const revisao = await callClaudeForReview(system, userMsg);

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

    return jsonResponse({
      question: questionFinal,
      coberturaEncontrada: true,
      alterado,
      resumo: String(revisao?.resumo || ""),
      referencias: chunks.map((c: any) => ({ livro: c.livro, pagina_aprox: c.pagina_aprox, similarity: c.similarity })),
    });
  } catch (err) {
    return jsonResponse({
      question,
      coberturaEncontrada: false,
      alterado: false,
      resumo: `Erro interno no revisor de matemática — questão mantida sem alterações: ${String((err as any)?.message || err)}`,
    });
  }
});
