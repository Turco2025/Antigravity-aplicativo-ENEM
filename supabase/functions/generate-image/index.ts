import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Usa a API oficial da OpenAI (Image API, "ChatGPT Images").
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
/* MODELO FIXO EM "GPT-Image-2" (snapshot datado), QUALIDADE FIXA EM "low"
   — decisão do professor em 09/09/2026. Histórico: no lançamento do ChatGPT
   Images 2.5 (08/09/2026) a função chegou a ser fixada no gpt-image-2.5-flare
   (v24), mas a OpenAI exige "verificação de organização" para esse modelo
   (erro 403 em todas as imagens de uma leva) e, no mesmo dia, cortou o preço
   do gpt-image-2 pela metade. O professor optou por voltar ao gpt-image-2 —
   metade do custo, sem verificação, mesmo pipeline que já gerou 74 imagens
   com 100% de sucesso. Isto é intencional e definitivo: a variável de
   ambiente OPENAI_IMAGE_MODEL NÃO é lida — mesmo que exista nos secrets do
   projeto, é ignorada de propósito, para que nenhuma configuração externa
   troque o modelo sem editar este arquivo (mesmo critério do modelo de texto
   em generate-question). O snapshot datado garante que o modelo não muda por
   baixo dos panos quando a OpenAI atualizar o apelido "gpt-image-2".
   Preços vigentes (por milhão de tokens): texto de entrada US$ 2,50, imagem
   de saída US$ 15 — os mesmos usados no cálculo de custo abaixo. */
const IMAGE_MODEL = "gpt-image-2-2026-04-21";
/* Rede de segurança de nome, não de modelo: se a OpenAI recusar o snapshot
   datado (404/400 "model"), a MESMA imagem é pedida ao apelido oficial do
   mesmo modelo, "gpt-image-2" — nunca a outro modelo. O nome efetivamente
   usado volta em "uso.modelo" e fica no log. */
const IMAGE_MODEL_ALIAS = "gpt-image-2";
// SEM TETO DIÁRIO (decisão do professor): ausente, 0 ou negativo = ilimitado.
// Para reativar um limite depois, basta definir MAX_DAILY_IMAGES com um número
// positivo nos secrets do projeto Supabase — não é preciso reimplantar a função.
const MAX_DAILY_IMAGES = Number(Deno.env.get("MAX_DAILY_IMAGES") || "0");

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Geração de imagem agora exige login (Supabase Auth): o app cliente manda o
// token da sessão do usuário em "Authorization: Bearer <token>". A chave
// anônima (anon key) sozinha NÃO passa nesta checagem, só um token de sessão
// de um usuário autenticado de verdade.
async function usuarioAutenticado(req: Request) {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  const usuario = await usuarioAutenticado(req);
  if (!usuario) {
    return jsonResponse({ error: "É necessário fazer login para gerar imagens." }, 401);
  }

  if (!OPENAI_API_KEY) {
    return jsonResponse({
      error:
        "Backend não configurado: falta a variável de ambiente OPENAI_API_KEY nos secrets deste projeto Supabase.",
    }, 500);
  }

  let body: {
    prompt?: string; size?: string; quality?: string;
    outputFormat?: string; outputCompression?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }

  const prompt = (body.prompt || "").toString().trim();
  if (!prompt) {
    return jsonResponse({ error: "Campo 'prompt' é obrigatório." }, 400);
  }
  const size = body.size || "1536x1024";

  /* QUALIDADE FIXA EM "low" — decisão do professor, travada aqui no servidor.
     Antes a qualidade vinha por requisição (o app tinha um seletor por figura
     que permitia "medium"/"high"); agora ela é sempre "low", não importa o
     que o corpo da requisição peça — o campo "quality", se vier, é ignorado.
     Trocar isso exige mexer neste arquivo, não um clique na interface.        */
  const quality = "low";

  /* FORMATO DE SAÍDA. O padrão continua PNG — é o que o aplicativo sempre
     recebeu, e trocar sozinho mudaria o peso de todo PDF já gerado. Pedindo
     "webp" com compressão, a mesma imagem chega várias vezes menor, o que
     encurta o download e enxuga o PDF sem alterar o que a OpenAI cobra (o
     preço é pelos tokens da imagem, não pelos bytes que trafegam).           */
  const FORMATOS = ["png", "jpeg", "webp"];
  const formatoPedido = (body.outputFormat || "").toString().trim().toLowerCase();
  const outputFormatPedido = FORMATOS.includes(formatoPedido) ? formatoPedido : null;
  const compressao = Number(body.outputCompression);
  const outputCompression = (outputFormatPedido && outputFormatPedido !== "png" &&
    Number.isFinite(compressao) && compressao >= 1 && compressao <= 100)
    ? Math.round(compressao) : null;

  // Limite diário opcional (desligado por padrão). Quando MAX_DAILY_IMAGES não
  // está definido, nada é consultado nem bloqueado — a geração é ilimitada.
  if (Number.isFinite(MAX_DAILY_IMAGES) && MAX_DAILY_IMAGES > 0) try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("image_generation_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (!countErr && typeof count === "number" && count >= MAX_DAILY_IMAGES) {
      return jsonResponse({
        error: `Limite diário de ${MAX_DAILY_IMAGES} imagens atingido. Tente novamente amanhã, ou aumente MAX_DAILY_IMAGES nas configurações do backend.`,
      }, 429);
    }
  } catch (_e) {
    // Se o log falhar por algum motivo, não bloqueia a geração de imagem.
  }

  try {
    // OBS: a API de imagens da OpenAI para o gpt-image-2 (e gpt-image-1) já
    // devolve a imagem em base64 por padrão — o parâmetro "response_format"
    // NÃO é mais aceito por esse endpoint e causa erro 400 "Unknown parameter"
    // se enviado. Por isso ele foi removido do corpo da requisição abaixo.
    const corpo: Record<string, unknown> = {
      model: IMAGE_MODEL,
      prompt,
      size,
      quality,
      /* MODERAÇÃO "low" — decisão deliberada: o padrão da OpenAI ("auto") é
         mais restritivo e pode bloquear, por engano, imagens científicas
         legítimas (ex.: anatomia humana em questões de Biologia). Com "low"
         a barreira de conteúdo fica mais permissiva, reduzindo falsos
         positivos nesse tipo de imagem educacional — sem abrir mão da
         moderação, só afrouxando o limiar. */
      moderation: "low",
      n: 1,
    };
    if (outputFormatPedido) corpo.output_format = outputFormatPedido;
    if (outputCompression !== null) corpo.output_compression = outputCompression;

    /* Uma imagem em qualidade alta leva mais de um minuto para ficar pronta, e
       até agora esta função chamava a OpenAI sem relógio e sem segunda chance:
       qualquer soluço de rede devolvia erro ao professor — e a imagem que a
       OpenAI já tinha começado a produzir seria cobrada assim mesmo. Agora há
       um limite de 240 s por tentativa e até 3 tentativas, com espera crescente
       entre elas, no mesmo padrão da função de questões.                      */
    const inicio = Date.now();
    let data: any = null;
    let ultimoErro = "";
    let modeloUsado = IMAGE_MODEL;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const controller = new AbortController();
      const relogio = setTimeout(() => controller.abort(), 240_000);
      try {
        corpo.model = modeloUsado;
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(corpo),
          signal: controller.signal,
        });
        clearTimeout(relogio);
        if (res.ok) { data = await res.json(); break; }
        const errText = await res.text();
        /* Snapshot datado não reconhecido pela OpenAI (nome, não modelo):
           repete imediatamente com o apelido oficial do MESMO modelo. */
        const nomeRecusado = modeloUsado === IMAGE_MODEL &&
          (res.status === 404 || (res.status === 400 && /model/i.test(errText)));
        if (nomeRecusado) {
          console.warn(`[imagem] OpenAI recusou o snapshot "${IMAGE_MODEL}" (status ${res.status}); repetindo com "${IMAGE_MODEL_ALIAS}".`);
          modeloUsado = IMAGE_MODEL_ALIAS;
          ultimoErro = `status ${res.status}: ${errText.slice(0, 400)}`;
          if (tentativa === 3) return jsonResponse({ error: `Falha ao gerar imagem na OpenAI (${ultimoErro})` }, 502);
          continue;
        }
        /* v32 (20/09/2026) — RECUSA DA MODERAÇÃO. Cinco imagens de uma leva de
           Literatura voltaram com "Your request was rejected by the safety
           system" (crianças em fotorrealismo, cenas de morte/violência), e o
           app repetia o MESMO prompt três vezes. Aqui a recusa vira um código
           próprio (422 + code "moderation_blocked"), sem repetir: quem
           resolve é o app, pedindo ao generate-question um prompt reescrito
           com restrição de segurança (regenerarVisual + restricaoSeguranca). */
        const moderacao = res.status === 400 && /safety system|moderation_blocked|content_policy|rejected by|safety/i.test(errText);
        if (moderacao) {
          console.warn(`[imagem] recusada pela moderação da OpenAI (prompt ${prompt.length} chars): ${errText.slice(0, 200).replace(/\s+/g, " ")}`);
          return jsonResponse({
            error: "A imagem foi recusada pelo sistema de segurança do gerador de imagens. O aplicativo vai pedir uma nova especificação, sem o que a moderação barra.",
            code: "moderation_blocked",
            detalhe: errText.slice(0, 300),
          }, 422);
        }
        // 429 e 5xx passam; 400 é erro de pedido e não melhora tentando de novo.
        const vaiMelhorar = res.status === 429 || res.status >= 500;
        ultimoErro = `status ${res.status}: ${errText.slice(0, 400)}`;
        if (!vaiMelhorar || tentativa === 3) {
          return jsonResponse({ error: `Falha ao gerar imagem na OpenAI (${ultimoErro})` }, 502);
        }
      } catch (err) {
        clearTimeout(relogio);
        const abortou = (err as any)?.name === "AbortError";
        ultimoErro = abortou ? "a OpenAI passou de 240 s sem responder" : String(err);
        if (tentativa === 3) {
          return jsonResponse({ error: `Falha ao gerar imagem (${ultimoErro}) após 3 tentativas.` }, 502);
        }
      }
      await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
    if (!data) {
      return jsonResponse({ error: `Falha ao gerar imagem (${ultimoErro}).` }, 502);
    }
    const segundos = Math.round((Date.now() - inicio) / 1000);
    const b64 = data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) {
      return jsonResponse({ error: "A resposta da OpenAI não trouxe a imagem (b64_json ausente).", raw: data }, 502);
    }
    const outputFormat = data.output_format || "png";
    const imageDataUrl = `data:image/${outputFormat};base64,${b64}`;

    /* O custo da imagem é verificável, não estimado: a OpenAI devolve, em
       "usage", quantos tokens de texto entraram e quantos tokens de imagem
       saíram. Multiplicando pelos preços vigentes (US$ 2,50 e US$ 15 por milhão)
       sai o preço real daquela imagem — dá para comparar qualidades sem
       depender de tabela publicada.                                          */
    const uso = data.usage || {};
    const tokensEntrada = Number(uso.input_tokens) || 0;
    const tokensSaida = Number(uso.output_tokens) || 0;
    const custoUSD = Number(((tokensEntrada * 2.5 + tokensSaida * 15) / 1e6).toFixed(5));

    /* O log agora guarda os mesmos números que já eram calculados e devolvidos
       ao app (segundos, tokens, custo) — antes só o prompt ficava registrado,
       e não havia como consultar depois quanto as imagens custaram de fato ao
       longo do tempo. Registro best-effort: uma falha aqui nunca pode impedir
       a entrega da imagem já gerada. */
    console.log(`[imagem] ${modeloUsado} · ${quality} · ${size} · ${segundos}s · entrada ${tokensEntrada} · saída ${tokensSaida} · US$ ${custoUSD.toFixed(5)}`);
    try {
      await supabase.from("image_generation_log").insert({
        prompt: prompt.slice(0, 500),
        modelo: modeloUsado,
        segundos,
        tokens_entrada: tokensEntrada,
        tokens_saida: tokensSaida,
        custo_usd: custoUSD,
      });
    } catch (_e) {
      // best-effort logging
    }

    return jsonResponse({
      imageDataUrl,
      uso: {
        modelo: modeloUsado,
        qualidade: quality,
        tamanho: size,
        formato: outputFormat,
        segundos,
        tokensEntrada,
        tokensSaida,
        custoUSD,
        bytesImagem: Math.round(b64.length * 3 / 4),
      },
    });
  } catch (err) {
    return jsonResponse({ error: `Erro inesperado no backend: ${String(err)}` }, 500);
  }
});
