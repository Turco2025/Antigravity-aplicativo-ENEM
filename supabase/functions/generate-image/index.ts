import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

  if (!GEMINI_API_KEY) {
    return jsonResponse({
      error: "Backend não configurado: falta a variável de ambiente GEMINI_API_KEY nos secrets deste projeto Supabase.",
    }, 500);
  }

  let body: {
    prompt?: string;
    size?: string;
    quality?: string;
    outputFormat?: string;
    outputCompression?: number;
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

  const size = body.size || "1024x1024";
  const quality = "high";
  const FORMATOS = ["png", "jpeg", "webp"];
  const formatoPedido = (body.outputFormat || "").toString().trim().toLowerCase();
  const outputFormatPedido = FORMATOS.includes(formatoPedido) ? formatoPedido : "png";

  const inicio = Date.now();
  let ultimoErro = "";

  // 1. Tenta modelos nativos do Gemini / Nano Banana com generateContent
  const modelosNanoBanana = [
    "gemini-3.1-flash-image",
    "gemini-3-pro-image",
    "nano-banana-pro-preview",
    "gemini-2.5-flash-image",
  ];

  for (const modImg of modelosNanoBanana) {
    try {
      const gRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modImg}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["IMAGE"],
            },
          }),
        },
      );

      if (gRes.ok) {
        const gData = await gRes.json();
        const parts = gData?.candidates?.[0]?.content?.parts || [];
        let imgB64 = "";
        let mime = outputFormatPedido === "jpeg" ? "image/jpeg" : "image/png";

        for (const p of parts) {
          if (p.inlineData?.data) {
            imgB64 = p.inlineData.data;
            if (p.inlineData.mimeType) mime = p.inlineData.mimeType;
            break;
          }
        }

        if (imgB64) {
          const imageDataUrl = `data:${mime};base64,${imgB64}`;
          const segundos = Math.round((Date.now() - inicio) / 1000);
          const bytesImagem = Math.round((imgB64.length || 0) * 3 / 4);

          try {
            await supabase.from("image_generation_log").insert({
              prompt: prompt.slice(0, 500),
              modelo: modImg,
              segundos,
              tokens_entrada: prompt.length,
              tokens_saida: bytesImagem,
              custo_usd: 0.002,
            });
          } catch (_e) {
            // best effort logging
          }

          return jsonResponse({
            imageDataUrl,
            uso: {
              modelo: modImg,
              qualidade: quality,
              tamanho: size,
              formato: outputFormatPedido,
              segundos,
              tokensEntrada: prompt.length,
              tokensSaida: bytesImagem,
              custoUSD: 0.002,
              bytesImagem,
            },
          });
        }
      } else {
        const errBody = await gRes.text().catch(() => "");
        ultimoErro = `${modImg} (status ${gRes.status}): ${errBody.slice(0, 200)}`;
      }
    } catch (gErr) {
      ultimoErro = `${modImg}: ${String(gErr)}`;
    }
  }

  // 2. Tenta Google Imagen 3 (:predict e :generateImages)
  try {
    const isLandscape = size.includes("x") &&
      parseInt(size.split("x")[0]) > parseInt(size.split("x")[1]);
    const aspectRatio = isLandscape ? "16:9" : "1:1";

    const predRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio,
            outputOptions: {
              mimeType: outputFormatPedido === "jpeg" ? "image/jpeg" : "image/png",
            },
          },
        }),
      },
    );

    if (predRes.ok) {
      const predData = await predRes.json();
      const predItem = predData?.predictions?.[0];
      const imgB64 = predItem?.bytesBase64Encoded;
      const mime = predItem?.mimeType || (outputFormatPedido === "jpeg" ? "image/jpeg" : "image/png");

      if (imgB64) {
        const imageDataUrl = `data:${mime};base64,${imgB64}`;
        const segundos = Math.round((Date.now() - inicio) / 1000);
        const bytesImagem = Math.round((imgB64.length || 0) * 3 / 4);

        try {
          await supabase.from("image_generation_log").insert({
            prompt: prompt.slice(0, 500),
            modelo: "imagen-3.0-generate-002",
            segundos,
            tokens_entrada: prompt.length,
            tokens_saida: bytesImagem,
            custo_usd: 0.004,
          });
        } catch (_e) {
          // best effort
        }

        return jsonResponse({
          imageDataUrl,
          uso: {
            modelo: "imagen-3.0-generate-002",
            qualidade: quality,
            tamanho: size,
            formato: outputFormatPedido,
            segundos,
            tokensEntrada: prompt.length,
            tokensSaida: bytesImagem,
            custoUSD: 0.004,
            bytesImagem,
          },
        });
      }
    } else {
      const errBody = await predRes.text().catch(() => "");
      ultimoErro = `imagen-3.0-generate-002 predict (status ${predRes.status}): ${errBody.slice(0, 200)}`;
    }
  } catch (errPredict) {
    ultimoErro = `imagen-3.0-generate-002 predict: ${String(errPredict)}`;
  }

  // 3. Tenta Google Imagen 3 com endpoint generateImages
  try {
    const genImgRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          config: {
            numberOfImages: 1,
            outputMimeType: outputFormatPedido === "jpeg" ? "image/jpeg" : "image/png",
            aspectRatio: "1:1",
          },
        }),
      },
    );

    if (genImgRes.ok) {
      const genImgData = await genImgRes.json();
      const imgB64 = genImgData?.generatedImages?.[0]?.image?.imageBytes;
      const mime = outputFormatPedido === "jpeg" ? "image/jpeg" : "image/png";

      if (imgB64) {
        const imageDataUrl = `data:${mime};base64,${imgB64}`;
        const segundos = Math.round((Date.now() - inicio) / 1000);
        const bytesImagem = Math.round((imgB64.length || 0) * 3 / 4);

        try {
          await supabase.from("image_generation_log").insert({
            prompt: prompt.slice(0, 500),
            modelo: "imagen-3.0-generate-002",
            segundos,
            tokens_entrada: prompt.length,
            tokens_saida: bytesImagem,
            custo_usd: 0.004,
          });
        } catch (_e) {
          // best effort
        }

        return jsonResponse({
          imageDataUrl,
          uso: {
            modelo: "imagen-3.0-generate-002",
            qualidade: quality,
            tamanho: size,
            formato: outputFormatPedido,
            segundos,
            tokensEntrada: prompt.length,
            tokensSaida: bytesImagem,
            custoUSD: 0.004,
            bytesImagem,
          },
        });
      }
    } else {
      const errBody = await genImgRes.text().catch(() => "");
      ultimoErro = `imagen-3.0-generate-002 generateImages (status ${genImgRes.status}): ${errBody.slice(0, 200)}`;
    }
  } catch (errGen) {
    ultimoErro = `imagen-3.0-generate-002 generateImages: ${String(errGen)}`;
  }

  // Falha estrita no ecossistema Google Gemini / Nano Banana sem qualquer fallback externo
  return jsonResponse({
    error: `Falha ao gerar imagem com Google Nano Banana / Imagen: ${ultimoErro || "Nenhuma imagem foi retornada pelo modelo."}`,
  }, 502);
});
