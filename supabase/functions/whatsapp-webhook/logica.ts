// whatsapp-webhook — lógica (etapa A1). Separada do index.ts para poder ser
// testada localmente sem abrir servidor.
//
// O que faz:
//  GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  → verificação do webhook (Meta)
//  GET  ?selftest=1                                                → diagnóstico (só nomes de secrets presentes, nunca valores)
//  POST (assinado com X-Hub-Signature-256)                         → mensagens recebidas:
//        "Vincular conta 123456" → conclui o pareamento telefone ↔ conta do app
//        outra mensagem de número vinculado → resposta provisória (pedidos entram na etapa B)
//        (mensagens repetidas pela Meta: 200 se já concluída, 500 se outra execução está
//         processando agora ou se a anterior falhou — aí a Meta reentrega e processamos de novo)
//        número não vinculado → instrução de como vincular
//
// Segurança: toda chamada POST precisa da assinatura HMAC-SHA256 feita com o
// App Secret; sem ela, 401 e nada é processado. Cada mensagem é registrada em
// wa_mensagens pelo id da Meta (chave primária) — repetições são ignoradas.

export const VERSAO = "A1.9";

// App da Meta ("Gerador Enem") — usado só para conferir a assinatura da WABA ao app.
export const META_APP_ID = "1708104537155293";

export interface Env {
  WHATSAPP_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_WABA_ID?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GRAPH_VERSAO?: string;
}

export function lerEnv(): Env {
  // .trim(): um espaço ou quebra de linha colado junto com o secret faria TODAS as
  // assinaturas falharem (401) sem nenhuma pista — o selftest também avisa disso.
  const g = (k: string) => (Deno.env.get(k) ?? "").trim();
  return {
    WHATSAPP_TOKEN: g("WHATSAPP_TOKEN"),
    WHATSAPP_APP_SECRET: g("WHATSAPP_APP_SECRET"),
    WHATSAPP_VERIFY_TOKEN: g("WHATSAPP_VERIFY_TOKEN"),
    WHATSAPP_PHONE_NUMBER_ID: g("WHATSAPP_PHONE_NUMBER_ID"),
    WHATSAPP_WABA_ID: g("WHATSAPP_WABA_ID"),
    SUPABASE_URL: g("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: g("SUPABASE_SERVICE_ROLE_KEY"),
    GRAPH_VERSAO: g("WHATSAPP_GRAPH_VERSAO") || "v25.0",
  };
}

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function assinaturaHmacSha256(segredo: string, corpo: string): Promise<string> {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", chave, enc.encode(corpo));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function assinaturaValida(env: Env, cabecalho: string | null, corpo: string): Promise<boolean> {
  if (!cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const esperado = await assinaturaHmacSha256(env.WHATSAPP_APP_SECRET, corpo);
  return igualSeguro(cabecalho.slice(7).toLowerCase(), esperado);
}

// "Vincular conta 123456", "vincular 123456", "VINCULAR CONTA: 123456" → "123456"
export function extrairCodigoVinculo(texto: string): string | null {
  // normaliza espaços "especiais" que teclados de celular inserem (NBSP, zero-width) e acentos ("víncular")
  const t = String(texto || "").replace(/[\u00a0\u2000-\u200b\ufeff]/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // não exige que a mensagem seja SÓ o comando: "Oi, vincular conta 482134 por favor" também vale
  const m = /(?:^|[^a-z])vincular\s*(?:a\s+)?(?:minha\s+)?(?:conta)?\s*[:\-]?\s*(?<!\d)(\d{6})(?!\d)/i.exec(t);
  return m ? m[1] : null;
}

// Limite de tentativas de código por telefone (janela de 15 min).
export const MAX_TENTATIVAS_CODIGO = 5;

// "maziadh@gmail.com" → "ma…h@gmail.com" (nunca mandamos o e-mail inteiro pelo WhatsApp)
export function mascararEmail(email: string): string {
  const [u, d] = String(email || "").split("@");
  if (!u || !d) return "";
  const ini = u.slice(0, 2), fim = u.length > 3 ? u.slice(-1) : "";
  return `${ini}…${fim}@${d}`;
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST com a chave de serviço)
// ---------------------------------------------------------------------------
function cabecalhosDb(env: Env, extra: Record<string, string> = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}

// Janelas do reprocessamento de reentregas da Meta.
export const TRAVADA_APOS_MS = 3 * 60 * 1000;        // linha reservada há > 3 min sem "acao": a execução anterior morreu (limite da função é 150 s)
export const REPROCESSAR_ATE_MS = 24 * 60 * 60 * 1000; // depois de 24 h não vale mais responder (janela de resposta do WhatsApp)

export type Anterior = { acao: string | null; recebido_em: string; reservado_em: string | null };
export type Decisao = "reprocessar" | "duplicada" | "em_andamento";

// Decide o que fazer com uma reentrega de mensagem já registrada.
//  reprocessar  → tentativa anterior falhou (erro / envio falhou) ou ficou travada
//  em_andamento → outra execução está processando agora (responder 500: a Meta tenta depois)
//  duplicada    → já concluída (ou velha demais): responder 200 e não fazer nada
export function decidirReentrega(ant: Anterior | undefined, agora = Date.now()): Decisao {
  if (!ant) return "duplicada";
  const idadeMsg = agora - new Date(ant.recebido_em).getTime();
  if (idadeMsg >= REPROCESSAR_ATE_MS) return "duplicada";
  if (ant.acao === null) {
    const desdeReserva = agora - new Date(ant.reservado_em ?? ant.recebido_em).getTime();
    return desdeReserva > TRAVADA_APOS_MS ? "reprocessar" : "em_andamento";   // relógio adiantado → idade negativa → em_andamento (seguro)
  }
  return ant.acao === "erro" || ant.acao.endsWith("_envio_falhou") ? "reprocessar" : "duplicada";
}

// Registra a mensagem; devolve "nova" se inseriu agora, ou a decisão sobre a reentrega.
// A "reserva" para reprocessar é um UPDATE condicional (compare-and-swap via PostgREST):
// só quem conseguir mudar a linha a partir do estado que leu segue em frente — duas
// execuções simultâneas nunca respondem as duas.
async function registrarMensagem(env: Env, m: { wamid: string; telefone: string; tipo: string; texto: string | null; payload: unknown }): Promise<"nova" | Decisao> {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?on_conflict=wamid`, {
    method: "POST",
    headers: cabecalhosDb(env, { prefer: "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify(m),
  });
  if (!resp.ok) throw new Error(`wa_mensagens insert ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const linhas = (await resp.json()) as unknown[];
  if (linhas.length > 0) return "nova";
  const r2 = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?select=acao,recebido_em,reservado_em&wamid=eq.${encodeURIComponent(m.wamid)}`, { headers: cabecalhosDb(env) });
  if (!r2.ok) throw new Error(`wa_mensagens select ${r2.status}`);
  const ant = ((await r2.json()) as Anterior[])[0];
  const decisao = decidirReentrega(ant);
  if (decisao !== "reprocessar") return decisao;
  // reserva condicional: a linha precisa estar exatamente como foi lida
  const condicao = ant.acao === null
    ? `acao=is.null&reservado_em=lt.${encodeURIComponent(new Date(Date.now() - TRAVADA_APOS_MS).toISOString())}`
    : `acao=eq.${encodeURIComponent(ant.acao)}`;
  const r3 = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?wamid=eq.${encodeURIComponent(m.wamid)}&${condicao}`, {
    method: "PATCH", headers: cabecalhosDb(env, { prefer: "return=representation" }),
    body: JSON.stringify({ acao: null, resposta: null, processado_em: null, reservado_em: new Date().toISOString() }),
  });
  if (!r3.ok) throw new Error(`wa_mensagens reserva ${r3.status}`);
  const reservadas = (await r3.json()) as unknown[];
  return reservadas.length === 1 ? "reprocessar" : "em_andamento";   // outra execução reservou antes
}

// Quantas tentativas de código inválido este telefone fez nos últimos 15 min.
async function tentativasRecentes(env: Env, telefone: string): Promise<number> {
  const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  // conta vinculo_invalido, vinculo_invalido_envio_falhou, vinculo_invalido_envio_recusado;
  // NÃO conta vinculo_bloqueado (senão quem insiste nunca sai do bloqueio)
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?select=wamid&telefone=eq.${encodeURIComponent(telefone)}&acao=like.vinculo_invalido*&recebido_em=gte.${encodeURIComponent(desde)}`, {
    method: "HEAD", headers: cabecalhosDb(env, { prefer: "count=exact" }),
  });
  // falha FECHADO: sem contagem confiável, não se testa código (vira "erro" → 500 → Meta reentrega)
  if (!resp.ok) throw new Error(`wa_mensagens contagem ${resp.status}`);
  const total = (resp.headers.get("content-range") || "").split("/")[1];
  if (total === undefined || total === "*" || !/^\d+$/.test(total)) throw new Error(`wa_mensagens contagem sem content-range (${resp.headers.get("content-range")})`);
  return Number(total);
}

// Grava o resultado. Tenta 3 vezes: se ficar sem gravar, a linha fica "em processamento"
// e uma reentrega tardia poderia responder de novo — por isso insiste.
async function atualizarMensagem(env: Env, wamid: string, campos: Record<string, unknown>): Promise<boolean> {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?wamid=eq.${encodeURIComponent(wamid)}`, {
        method: "PATCH",
        headers: cabecalhosDb(env, { prefer: "return=minimal" }),
        body: JSON.stringify({ ...campos, processado_em: new Date().toISOString() }),
      });
      if (resp.ok) return true;
      console.error(`[wa] atualizar ${wamid} (tentativa ${tentativa}): ${resp.status}`);
    } catch (e) { console.error(`[wa] atualizar ${wamid} (tentativa ${tentativa}):`, e); }
    await new Promise((r) => setTimeout(r, 300 * tentativa));
  }
  return false;
}

async function perfilPorTelefone(env: Env, telefone: string): Promise<{ user_id: string; whatsapp_nome: string | null; ilimitado: boolean } | null> {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/perfis?select=user_id,whatsapp_nome,ilimitado&whatsapp=eq.${encodeURIComponent(telefone)}&limit=1`, { headers: cabecalhosDb(env) });
  if (!resp.ok) throw new Error(`perfis ${resp.status}`);
  const arr = (await resp.json()) as { user_id: string; whatsapp_nome: string | null; ilimitado: boolean }[];
  return arr[0] ?? null;
}

async function concluirVinculo(env: Env, codigo: string, telefone: string, nome: string): Promise<{ vinculado_user_id: string; vinculado_email: string } | null> {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/wa_concluir_vinculo`, {
    method: "POST",
    headers: cabecalhosDb(env),
    body: JSON.stringify({ p_codigo: codigo, p_telefone: telefone, p_nome: nome }),
  });
  if (!resp.ok) throw new Error(`wa_concluir_vinculo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const arr = (await resp.json()) as { vinculado_user_id: string; vinculado_email: string }[];
  return arr[0] ?? null;
}

// ---------------------------------------------------------------------------
// WhatsApp (Graph API)
// ---------------------------------------------------------------------------
// Tempo máximo de espera por uma resposta da Graph API (a função inteira tem 150 s).
export const TIMEOUT_GRAPH_MS = 20_000;

// Erros da Graph que valem nova tentativa (a Meta reentrega o webhook se respondermos 500).
// Qualquer outro 4xx é permanente (número fora da lista de testes, janela de 24 h fechada,
// token inválido...): repetir não resolve e um laço de reentregas pode fazer a Meta
// desativar o webhook. Fonte: códigos de erro da Cloud API.
const CODIGOS_GRAPH_TRANSITORIOS = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131000, 131016, 131056]);
// Lê o código de erro da Graph a partir do corpo COMPLETO (o corpo de erro costuma passar
// de 300 caracteres; se fosse cortado antes, o JSON não parsearia e o código viria 0).
export function codigoErroGraph(corpoCompleto: string): number {
  try { return Number(JSON.parse(corpoCompleto)?.error?.code) || 0; } catch { return 0; }
}
export function envioTransitorio(status: number, corpoCompleto: string): boolean {
  if (status === 429 || status >= 500) return true;
  return CODIGOS_GRAPH_TRANSITORIOS.has(codigoErroGraph(corpoCompleto));
}

// Nono dígito (Brasil): o WhatsApp identifica contas antigas como 55+DDD+8 dígitos, mas
// a lista de destinatários do número de TESTE da Meta guarda o número como foi digitado
// (normalmente com o 9). Se a Meta recusar com #131030 ("não está na lista de permissões"),
// tentamos a outra forma do mesmo número. Devolve null se não houver forma alternativa.
export function formaAlternativaBr(telefone: string): string | null {
  let m = /^55(\d{2})(\d{8})$/.exec(telefone);            // 12 dígitos → insere o 9
  if (m) return `55${m[1]}9${m[2]}`;
  m = /^55(\d{2})9(\d{8})$/.exec(telefone);               // 13 dígitos com 9 → remove o 9
  if (m) return `55${m[1]}${m[2]}`;
  return null;
}
const CODIGO_FORA_DA_LISTA = 131030;

async function postarTexto(env: Env, para: string, corpo: string): Promise<{ status: number; detalhe: string; codigo: number; transitorio: boolean }> {
  const url = `https://graph.facebook.com/${env.GRAPH_VERSAO}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: para, type: "text", text: { preview_url: false, body: corpo } }),
    signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS),   // estoura → exceção → acao "erro" → 500 → Meta reentrega
  });
  const completo = await resp.text();
  return { status: resp.status, detalhe: completo.slice(0, 300), codigo: resp.ok ? 0 : codigoErroGraph(completo), transitorio: !resp.ok && envioTransitorio(resp.status, completo) };
}

export async function enviarTexto(env: Env, para: string, corpo: string): Promise<{ ok: boolean; transitorio: boolean; detalhe: string; paraUsado: string }> {
  let r = await postarTexto(env, para, corpo);
  let paraUsado = para;
  if (r.codigo === CODIGO_FORA_DA_LISTA) {
    const alt = formaAlternativaBr(para);
    if (alt) {
      console.log(`[wa] ${para} fora da lista de testes (#131030); tentando ${alt}`);
      const r2 = await postarTexto(env, alt, corpo);
      if (r2.status < 400 || r2.status >= 500) { r = r2; paraUsado = alt; }
      else console.log(`[wa] ${alt} também recusado: ${r2.status} código ${r2.codigo}`);
    }
  }
  const ok = r.status >= 200 && r.status < 300;
  if (!ok) console.error(`[wa] envio para ${paraUsado} falhou ${r.status} (código ${r.codigo}): ${r.detalhe}`);
  return { ok, transitorio: r.transitorio, detalhe: r.detalhe, paraUsado };
}

async function marcarLida(env: Env, wamid: string) {
  try {
    await fetch(`https://graph.facebook.com/${env.GRAPH_VERSAO}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: wamid }),
      signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS),
    });
  } catch (_e) { /* cosmético */ }
}

// ---------------------------------------------------------------------------
// textos das respostas (etapa A1)
// ---------------------------------------------------------------------------
export const TEXTOS = {
  vinculoOk: (nome: string, emailMascarado: string) =>
    `Pronto${nome ? ", " + nome : ""}! Este número ficou vinculado à sua conta do Gerador ENEM${emailMascarado ? ` (${emailMascarado})` : ""}.\n\n` +
    `Em breve você vai poder pedir simulados por aqui — por exemplo: "10 questões de Biologia sobre ciclo do carbono, 3 fáceis, 4 médias e 3 difíceis, com imagem". ` +
    `Aviso quando essa parte estiver ativa.`,
  vinculoInvalido:
    `Não encontrei um código válido nessa mensagem. Os códigos valem 15 minutos.\n\n` +
    `No Gerador ENEM, entre na sua conta, vá em "Solicitar simulados pelo WhatsApp" → "Vincular meu WhatsApp" e envie o novo código, assim: Vincular conta 123456`,
  vinculoBloqueado:
    `Muitas tentativas de código em pouco tempo. Por segurança, aguarde 15 minutos, gere um novo código no Gerador ENEM e tente de novo.`,
  naoVinculado:
    `Olá! Este número ainda não está ligado a uma conta do Gerador ENEM.\n\n` +
    `Para vincular: no site, entre na sua conta, vá em "Solicitar simulados pelo WhatsApp" → "Vincular meu WhatsApp" e envie aqui o código que aparecer, assim: Vincular conta 123456`,
  aguardandoEtapaB: (texto: string) =>
    `Recebi sua mensagem${texto ? ` ("${[...texto].slice(0, 80).join("")}${[...texto].length > 80 ? "…" : ""}")` : ""}. ✅ Seu número está vinculado.\n\n` +
    `O pedido de simulados pelo WhatsApp está sendo construído e entra em seguida; aviso por aqui quando estiver ativo.`,
  soTexto: `Por enquanto só entendo mensagens de texto.`,
};

// ---------------------------------------------------------------------------
// processamento de uma mensagem recebida
// ---------------------------------------------------------------------------
interface MsgMeta { from: string; id: string; type: string; text?: { body?: string }; timestamp?: string }

export async function processarMensagem(env: Env, msg: MsgMeta, nomePerfil: string, payload: unknown): Promise<string> {
  const telefone = String(msg.from || "").replace(/\D/g, "");
  const texto = msg.type === "text" ? String(msg.text?.body ?? "") : null;
  if (!telefone || !msg.id) return "ignorado_sem_origem";

  const registro = await registrarMensagem(env, { wamid: msg.id, telefone, tipo: msg.type, texto, payload });
  if (registro === "duplicada") return "duplicada";
  if (registro === "em_andamento") return "duplicada_em_andamento";   // outra execução cuida; handler devolve 500 para a Meta tentar depois

  const lida = marcarLida(env, msg.id);
  (globalThis as any).EdgeRuntime?.waitUntil?.(lida); // termina em segundo plano, se o runtime oferecer

  let acao = "ignorado";
  let resposta = "";
  let userId: string | null = null;
  try {
    const perfil = await perfilPorTelefone(env, telefone);
    userId = perfil?.user_id ?? null;

    const codigo = texto !== null ? extrairCodigoVinculo(texto) : null;
    if (codigo) {
      if (await tentativasRecentes(env, telefone) >= MAX_TENTATIVAS_CODIGO) {
        acao = "vinculo_bloqueado"; resposta = TEXTOS.vinculoBloqueado;
      } else {
        const r = await concluirVinculo(env, codigo, telefone, nomePerfil);
        if (r) { acao = "vinculo_ok"; userId = r.vinculado_user_id; resposta = TEXTOS.vinculoOk(nomePerfil, mascararEmail(r.vinculado_email)); }
        else { acao = "vinculo_invalido"; resposta = TEXTOS.vinculoInvalido; }
      }
    } else if (!perfil) {
      acao = "nao_vinculado"; resposta = TEXTOS.naoVinculado;
    } else if (texto === null) {
      acao = "so_texto"; resposta = TEXTOS.soTexto;
    } else {
      acao = "aguardando_etapa_B"; resposta = TEXTOS.aguardandoEtapaB(texto);
    }
    const envio = await enviarTexto(env, telefone, resposta);
    if (!envio.ok) acao += envio.transitorio ? "_envio_falhou" : "_envio_recusado";   // falhou → 500 e reentrega; recusado → fica registrado, sem reentrega
    await atualizarMensagem(env, msg.id, { acao, resposta: envio.ok ? resposta : `${resposta}\n\n[envio: ${envio.detalhe.slice(0, 200)}]`, user_id: userId });
  } catch (e) {
    console.error("[wa] erro ao processar", msg.id, e);
    await atualizarMensagem(env, msg.id, { acao: "erro", resposta: String(e).slice(0, 500), user_id: userId });
    acao = "erro";
  }
  return acao;
}

// ---------------------------------------------------------------------------
// Assinatura da WABA ao app (camada que faz a Meta ENCAMINHAR mensagens reais).
// Sem ela, a URL do webhook fica configurada mas nada chega. GET lista; se o app
// não estiver na lista, POST assina. Só roda pelo selftest (frase secreta).
// ---------------------------------------------------------------------------
async function garantirAssinaturaWaba(env: Env): Promise<Record<string, unknown>> {
  if (!env.WHATSAPP_WABA_ID) return { erro: "WHATSAPP_WABA_ID não configurado" };
  const url = `https://graph.facebook.com/${env.GRAPH_VERSAO}/${env.WHATSAPP_WABA_ID}/subscribed_apps`;
  const cab = { authorization: `Bearer ${env.WHATSAPP_TOKEN}` };
  const listar = async () => {
    const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS) });
    const j = await r.json().catch(() => ({}));
    const apps = ((j?.data ?? []) as any[]).map((a) => ({ id: String(a?.whatsapp_business_api_data?.id ?? ""), nome: String(a?.whatsapp_business_api_data?.name ?? "") }));
    return { http: r.status, apps, erro: j?.error?.message };
  };
  const antes = await listar();
  const jaAssinado = antes.apps.some((a) => a.id === META_APP_ID);
  if (jaAssinado) return { wabaId: env.WHATSAPP_WABA_ID, appEsperado: META_APP_ID, antes, acao: "já estava assinado" };
  const r = await fetch(url, { method: "POST", headers: cab, signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS) });
  const jr = await r.json().catch(() => ({}));
  const depois = await listar();
  return { wabaId: env.WHATSAPP_WABA_ID, appEsperado: META_APP_ID, antes, acao: "assinatura solicitada", respostaPost: { http: r.status, ...jr }, depois, assinadoAgora: depois.apps.some((a) => a.id === META_APP_ID) };
}

// ---------------------------------------------------------------------------
// selftest: presença dos secrets (só true/false) e acesso às tabelas
// ---------------------------------------------------------------------------
async function selftest(env: Env, meta = false): Promise<Response> {
  const presentes: Record<string, boolean> = {};
  const brutosComEspacos: string[] = [];
  for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as (keyof Env)[]) {
    presentes[k] = !!env[k];
    const bruto = Deno.env.get(k);                       // valor como foi colado (lerEnv já limpa)
    if (bruto !== undefined && bruto !== bruto.trim()) brutosComEspacos.push(k);
  }
  const formatoOk = {
    WHATSAPP_APP_SECRET_hex32: /^[0-9a-f]{32}$/i.test(env.WHATSAPP_APP_SECRET),   // App Secret da Meta: 32 hexadecimais
    WHATSAPP_PHONE_NUMBER_ID_numerico: /^\d{10,20}$/.test(env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_TOKEN_tamanho_plausivel: env.WHATSAPP_TOKEN.length >= 100,
  };
  const tabelas: Record<string, string> = {};
  for (const t of ["perfis", "wa_vinculos", "wa_mensagens", "wa_conversas", "wa_trabalhos"]) {
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&limit=0`, { method: "HEAD", headers: cabecalhosDb(env, { prefer: "count=exact" }) });
      tabelas[t] = r.ok ? `ok (${(r.headers.get("content-range") || "").split("/")[1] ?? "?"} linhas)` : `HTTP ${r.status}`;
    } catch (e) { tabelas[t] = "erro: " + String(e).slice(0, 80); }
  }
  const assinaturaWaba = meta ? await garantirAssinaturaWaba(env) : undefined;
  return json({ funcao: "whatsapp-webhook", versao: VERSAO, phoneNumberIdConfigurado: env.WHATSAPP_PHONE_NUMBER_ID, graph: env.GRAPH_VERSAO, secretsPresentes: presentes, secretsComEspacosNasPontas: brutosComEspacos, formatoOk, tabelas, assinaturaWaba });
}

// ---------------------------------------------------------------------------
// handler HTTP
// ---------------------------------------------------------------------------
export async function handler(req: Request, env: Env = lerEnv()): Promise<Response> {
  const u = new URL(req.url);

  if (req.method === "GET") {
    if (u.searchParams.get("selftest") === "1") {
      // diagnóstico só com a mesma frase secreta usada na verificação da Meta
      const t = u.searchParams.get("t") || "";
      if (!env.WHATSAPP_VERIFY_TOKEN || !igualSeguro(t, env.WHATSAPP_VERIFY_TOKEN)) return json({ erro: "não autorizado" }, 401);
      return await selftest(env, u.searchParams.get("meta") === "1");
    }
    // Verificação do webhook pela Meta
    const modo = u.searchParams.get("hub.mode");
    const token = u.searchParams.get("hub.verify_token") || "";
    const desafio = u.searchParams.get("hub.challenge") || "";
    if (modo === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && igualSeguro(token, env.WHATSAPP_VERIFY_TOKEN)) {
      return new Response(desafio, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return json({ erro: "verificação recusada" }, 403);
  }

  if (req.method !== "POST") return json({ erro: "método não suportado" }, 405);

  const corpo = await req.text();
  if (!env.WHATSAPP_APP_SECRET || !(await assinaturaValida(env, req.headers.get("x-hub-signature-256"), corpo))) {
    console.warn("[wa] POST com assinatura inválida ou ausente");
    return json({ erro: "assinatura inválida" }, 401);
  }

  let dados: any;
  try { dados = JSON.parse(corpo); } catch { return json({ erro: "JSON inválido" }, 400); }
  if (dados?.object !== "whatsapp_business_account") return json({ ok: true, ignorado: "objeto desconhecido" });

  const resultados: string[] = [];
  for (const entry of dados.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "messages") continue;
      const v = ch.value ?? {};
      // eventos de status (enviada/entregue/lida/FALHOU) não geram ação, mas ficam no log:
      // uma falha de entrega (ex.: destinatário não é conta de WhatsApp) só aparece aqui
      for (const st of v.statuses ?? []) {
        const erros = (st?.errors ?? []).map((e: any) => `${e?.code} ${e?.title ?? ""} ${e?.error_data?.details ?? ""}`.trim());
        console.log(`[wa] status ${st?.status} para ${st?.recipient_id} (msg ${String(st?.id ?? "").slice(-12)})${erros.length ? " ERROS: " + erros.join(" | ") : ""}`);
        if (erros.length) resultados.push("status_falhou");
      }
      const nomes: Record<string, string> = {};
      for (const c of v.contacts ?? []) if (c?.wa_id) nomes[String(c.wa_id)] = String(c.profile?.name ?? "");
      const unicoContato = (v.contacts?.length === 1 ? String(v.contacts[0]?.profile?.name ?? "") : "");
      for (const m of v.messages ?? []) {
        // no Brasil o wa_id do contato pode vir sem o 9º dígito e não bater com "from": usa o único contato do lote
        const nome = nomes[String(m.from)] ?? unicoContato;
        resultados.push(await processarMensagem(env, m, nome, { entryId: entry.id, value: { metadata: v.metadata, contacts: v.contacts, message: m } }));
      }
    }
  }
  console.log(`[wa] POST processado: ${resultados.join(", ") || "sem mensagens"}`);
  // "status_falhou" é só informativo (não pede reentrega)
  const houveFalha = resultados.some((r) => r === "erro" || r === "duplicada_em_andamento" || r.endsWith("_envio_falhou"));
  // Com falha, devolve 500: a Meta reentrega mais tarde e a mensagem é reprocessada
  // (registrarMensagem aceita reentrega de linhas com acao "erro"/"*_envio_falhou" ou travadas).
  // "*_envio_recusado" (erro permanente da Graph) NÃO pede reentrega: repetir não resolveria.
  return json({ ok: !houveFalha, resultados }, houveFalha ? 500 : 200);
}
