/* ===================== Gerador Inteligente de Simulados ENEM ===================== */

const AREA_META = {
  linguagens: { label: "Linguagens, Códigos e suas Tecnologias", icon: "📖", desc: "Português, literatura, artes, educação física, línguas estrangeiras",
    disciplinas: ["Língua Portuguesa","Literatura","Artes","Educação Física","Língua Estrangeira (Inglês/Espanhol)"] },
  humanas: { label: "Ciências Humanas e suas Tecnologias", icon: "🏛️", desc: "História, geografia, filosofia, sociologia",
    disciplinas: ["História","Geografia","Filosofia","Sociologia"] },
  natureza: { label: "Ciências da Natureza e suas Tecnologias", icon: "🧬", desc: "Biologia, física, química",
    disciplinas: ["Biologia","Física","Química"] },
  matematica: { label: "Matemática e suas Tecnologias", icon: "📐", desc: "Números, álgebra, geometria, estatística e probabilidade",
    disciplinas: ["Matemática"] },
};

// Backend próprio (Supabase Edge Function) que chama a API de imagens da OpenAI
// (GPT Image 1 / "ChatGPT") com segurança, mantendo a chave fora do navegador do professor.
const IMAGE_BACKEND_URL = "https://gkceyrkdmnhgqimmrsre.supabase.co/functions/v1/generate-image";

// Backend próprio (Supabase Edge Function) que chama a API da Anthropic (Claude) com
// segurança — a chave de API fica guardada só nos secrets do servidor, nunca no
// navegador do professor, e nunca é pedida ao abrir o app.
const QUESTION_BACKEND_URL = "https://gkceyrkdmnhgqimmrsre.supabase.co/functions/v1/generate-question";
// v15 — Número oficial do Gerador ENEM no WhatsApp (só dígitos, com DDI). É para onde o
// professor envia "Vincular conta 123456" (caixa "Solicitar simulados pelo WhatsApp").
// Trocar de número = trocar esta constante (e o secret WHATSAPP_PHONE_NUMBER_ID no Supabase).
const WHATSAPP_NUMERO_EMPRESA = "556298021556";

// jsPDF e docx.js são bibliotecas pesadas (~1MB juntas) usadas só nos botões
// "Exportar PDF"/"Exportar DOCX". Em vez de carregá-las sempre no <head> (o que
// deixava a página inicial mais lenta para todo mundo, mesmo quem nunca exporta),
// elas são baixadas sob demanda, uma única vez, na primeira exportação.
const CDN_URLS = {
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js",
  docx: "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
};
const _scriptLoadPromises = {};
function loadScriptOnce(url){
  if(_scriptLoadPromises[url]) return _scriptLoadPromises[url];
  _scriptLoadPromises[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete _scriptLoadPromises[url]; reject(new Error("Falha ao carregar " + url)); };
    document.head.appendChild(s);
  });
  return _scriptLoadPromises[url];
}

let state = {
  area: null,
  disciplina: null,
  qty: 1,
  questions: [],
  apiKey: "",
  model: "claude-sonnet-5",
  viewMode: "professor",
};

/* ---------------- Autenticação (Supabase Auth) + "Meus Simulados" ----------------

   Login é OBRIGATÓRIO para gerar simulados: assim que a pessoa clica em
   qualquer caixa/etapa do formulário sem estar logada, o modal de login abre
   e bloqueia o fluxo até ela entrar ou se cadastrar (ver exigirLogin() e o
   listener de clique dos cartões de área em renderAreaGrid()). Uma vez
   logada, todo simulado gerado é automaticamente arquivado em "Meus
   Simulados" (tabela "simulados" no Supabase, protegida por RLS: cada
   usuário só enxerga os próprios registros).

   O cliente Supabase só é criado dentro de init() (na virada do
   DOMContentLoaded) — ver comentário junto à tag <script defer> do
   supabase-js no template — então nenhuma função abaixo pode ser chamada
   antes disso. */
const SUPABASE_URL = "https://gkceyrkdmnhgqimmrsre.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-s4dLevKftQzX-aOJyKfMw_u5c_JzLV";

let supabaseClient = null;
let currentUser = null;
let currentSession = null;
// Guarda o id do registro em "simulados" quando o simulado exibido na tela
// veio de "Meus Simulados" (botão "Abrir") — assim, ao gerar de novo, não se
// confunde um simulado reaberto com um simulado novo.
let simuladoAbertoId = null;

// Promessas de geração de imagem ainda em andamento nesta tela. Toda imagem
// nova (nunca vista antes) entra aqui no instante em que é pedida ao backend;
// quem precisa ter certeza de que TODAS as imagens já terminaram antes de
// arquivar o simulado (generateAll, abrir um simulado salvo, refazer um
// recurso visual) chama aguardaImagensPendentes() antes de salvar.
let imagePromisesEmAndamento = [];
async function aguardaImagensPendentes(){
  if(!imagePromisesEmAndamento.length) return false;
  const pendentes = imagePromisesEmAndamento;
  imagePromisesEmAndamento = [];
  await Promise.allSettled(pendentes);
  return true;
}

function initAuth(){
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    currentUser = session ? session.user : null;
    atualizaHeaderAuth();
  });
  supabaseClient.auth.getSession().then(({ data }) => {
    currentSession = data.session;
    currentUser = data.session ? data.session.user : null;
    atualizaHeaderAuth();
  });
}

// Cabeçalho de autorização enviado ao backend (Supabase Edge Functions), que
// agora exige um usuário logado de verdade — ver usuarioAutenticado() nos
// arquivos supabase/functions/generate-question|generate-image/index.ts.
function authHeaders(){
  return currentSession && currentSession.access_token
    ? { "Authorization": "Bearer " + currentSession.access_token }
    : {};
}

function atualizaHeaderAuth(){
  const logado = !!currentUser;
  document.getElementById("btnEntrar").style.display = logado ? "none" : "";
  document.getElementById("btnSair").style.display = logado ? "" : "none";
  document.getElementById("btnMeusSimulados").style.display = logado ? "" : "none";
  // v15: a caixa do WhatsApp acompanha a sessão (carrega o status ao logar, limpa ao sair).
  // Protegida: um erro aqui nunca pode atrapalhar o login nem o formulário.
  try{ waAtualizar(); }catch(e){ console.error("[wa] atualizar:", e); }
}

// Chama antes de qualquer ação que exija estar logado (selecionar área,
// clicar em "Gerar simulado completo", abrir "Meus Simulados"...). Se não
// houver sessão, abre o modal de login/cadastro e devolve false — quem
// chamou deve interromper a ação nesse caso.
function exigirLogin(){
  if(currentUser) return true;
  abrirAuthModal("login");
  return false;
}

function abrirAuthModal(aba){
  document.getElementById("authErr").classList.remove("show");
  document.getElementById("authErr").textContent = "";
  selecionaAbaAuth(aba || "login");
  openModal("authModal");
}

function selecionaAbaAuth(aba){
  const login = aba === "login";
  document.getElementById("authTabLogin").classList.toggle("sel", login);
  document.getElementById("authTabCadastro").classList.toggle("sel", !login);
  document.getElementById("authPaneLogin").classList.toggle("sel", login);
  document.getElementById("authPaneCadastro").classList.toggle("sel", !login);
}

function mostraErroAuth(msg){
  const el = document.getElementById("authErr");
  el.textContent = msg;
  el.classList.add("show");
}

function traduzErroAuth(err){
  const msg = String(err && err.message || err || "");
  if(/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if(/already registered|already exists|user already registered/i.test(msg)) return "Já existe uma conta com este e-mail. Tente acessar em vez de cadastrar.";
  if(/password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 6 caracteres.";
  if(/invalid email/i.test(msg)) return "E-mail inválido.";
  return msg || "Não foi possível concluir. Tente novamente.";
}

async function fazerLogin(){
  const email = document.getElementById("loginEmail").value.trim();
  const senha = document.getElementById("loginSenha").value;
  if(!email || !senha){ mostraErroAuth("Preencha e-mail e senha."); return; }
  const btn = document.getElementById("btnLoginSubmit");
  btn.disabled = true;
  try{
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
    if(error) throw error;
    closeModal("authModal");
    toast("Login realizado!", "ok");
  }catch(err){
    mostraErroAuth(traduzErroAuth(err));
  }finally{
    btn.disabled = false;
  }
}

async function fazerCadastro(){
  const email = document.getElementById("cadastroEmail").value.trim();
  const senha = document.getElementById("cadastroSenha").value;
  if(!email || !senha){ mostraErroAuth("Preencha e-mail e senha."); return; }
  if(senha.length < 6){ mostraErroAuth("A senha precisa ter pelo menos 6 caracteres."); return; }
  const btn = document.getElementById("btnCadastroSubmit");
  btn.disabled = true;
  try{
    const { data, error } = await supabaseClient.auth.signUp({ email, password: senha });
    if(error) throw error;
    if(data.session){
      closeModal("authModal");
      toast("Conta criada! Você já está logado.", "ok");
    }else{
      // Projeto com confirmação de e-mail ativada: ainda não há sessão.
      mostraErroAuth("Conta criada! Confira seu e-mail para confirmar o cadastro antes de entrar.");
    }
  }catch(err){
    mostraErroAuth(traduzErroAuth(err));
  }finally{
    btn.disabled = false;
  }
}

async function fazerLoginGoogle(){
  try{
    await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
  }catch(err){
    mostraErroAuth(traduzErroAuth(err));
  }
}

async function fazerLogout(){
  try{ waLimpar(true); }catch(e){ /* v15: nunca impede o logout */ }
  await supabaseClient.auth.signOut();
  toast("Você saiu da sua conta.", "info");
  document.getElementById("formPanel").style.display = "block";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("simuladosPanel").style.display = "none";
}

/* ---------------- WhatsApp: vincular número (v15, etapa A2) ----------------

   Caixa "Solicitar simulados pelo WhatsApp" (card-wa no template). O professor
   gera um código de 6 dígitos (RPC wa_gerar_codigo, só para usuário logado),
   abre o WhatsApp com "Vincular conta 123456" pronto (link wa.me) e envia; o
   webhook do servidor conclui o pareamento. Enquanto o código está na tela, a
   caixa consulta wa_meu_status a cada WA_POLL_MS e, quando o telefone aparece,
   passa ao estado "vinculado". O código pendente fica guardado no navegador
   para sobreviver a um recarregamento (no celular, abrir o WhatsApp costuma
   descarregar a aba). A validade vem do servidor (expira_em), não de um
   cronômetro local — abas suspensas não a desalinham.

   Estados (classe .sel em .wa-estado): Inicial · Codigo · Vinculado · Expirado.
   Tudo aqui é isolado: falhas viram toast e a caixa volta ao estado inicial. */
const WA_STORAGE_CODIGO = "enem_wa_codigo_pendente";
const WA_POLL_MS = 4000;
let waTimer = null;             // polling + verificação de validade
let waStatusEmAndamento = null; // promessa de wa_meu_status em curso (nunca duas em paralelo)
let waPendente = null;          // { codigo: "482134", expiraEm: <ms> }
let waAtualizando = false;      // waAtualizar em curso (onAuthStateChange e getSession disparam quase juntos)

function waEl(id){ return document.getElementById(id); }

function waMostrar(estado){
  ["Inicial", "Codigo", "Vinculado", "Expirado"].forEach(e => {
    const el = waEl("waEstado" + e);
    if(el) el.classList.toggle("sel", e === estado);
  });
}

// "556296116652" → "+55 62 ••••-6652" (nunca mostra o número inteiro do professor)
function waFormataTelefone(t){
  const d = String(t || "").replace(/\D/g, "");
  if(!/^55\d{10,11}$/.test(d)) return d ? "+" + d : "";
  return `+55 ${d.slice(2, 4)} ••••-${d.slice(-4)}`;
}

// "556298021556" → "+55 62 9802-1556" (número da empresa, inteiro)
function waFormataNumeroEmpresa(t){
  const d = String(t || "").replace(/\D/g, "");
  const m = /^55(\d{2})(\d{8,9})$/.exec(d);
  if(!m) return "+" + d;
  const r = m[2];
  return `+55 ${m[1]} ${r.slice(0, r.length - 4)}-${r.slice(-4)}`;
}

function waLinkWhatsApp(codigo){
  return `https://wa.me/${WHATSAPP_NUMERO_EMPRESA}?text=${encodeURIComponent("Vincular conta " + codigo)}`;
}

function waLerPendente(){
  try{
    const raw = safeStorageGet(WA_STORAGE_CODIGO);
    if(!raw) return null;
    const p = JSON.parse(raw);
    if(!p || !/^\d{6}$/.test(String(p.codigo)) || !(Number(p.expiraEm) > 0)) return null;
    return { codigo: String(p.codigo), expiraEm: Number(p.expiraEm) };
  }catch(e){ return null; }
}

function waGuardarPendente(p){
  if(p) safeStorageSet(WA_STORAGE_CODIGO, JSON.stringify(p)); else safeStorageRemove(WA_STORAGE_CODIGO);
}

// Consulta o status no servidor (uma chamada por vez). Devolve a linha ou null.
function waConsultarStatus(){
  if(waStatusEmAndamento) return waStatusEmAndamento;
  waStatusEmAndamento = supabaseClient.rpc("wa_meu_status")
    .then(({ data, error }) => {
      if(error) throw error;
      return (Array.isArray(data) ? data[0] : data) || null;
    })
    .finally(() => { waStatusEmAndamento = null; });
  return waStatusEmAndamento;
}

function waMostrarVinculado(st){
  waPararEspera();
  waPendente = null;
  waGuardarPendente(null);
  waEl("waTelefone").textContent = waFormataTelefone(st.whatsapp);
  waEl("waNome").textContent = st.whatsapp_nome ? "· " + st.whatsapp_nome : "";
  waMostrar("Vinculado");
}

function waMostrarCodigo(){
  const c = waPendente.codigo;
  waEl("waCodigo").textContent = c.slice(0, 3) + " " + c.slice(3);
  waEl("waCodigoInline").textContent = c;
  waEl("waNumeroEmpresa").textContent = waFormataNumeroEmpresa(WHATSAPP_NUMERO_EMPRESA);
  waEl("linkWaAbrir").href = waLinkWhatsApp(c);
  waAtualizaExpira();
  waMostrar("Codigo");
}

function waAtualizaExpira(){
  if(!waPendente) return;
  const hora = new Date(waPendente.expiraEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  waEl("waExpira").textContent = `Vale até ${hora} · aguardando sua mensagem…`;
}

// Chamado ao logar (via atualizaHeaderAuth) e ao voltar para a aba.
async function waAtualizar(){
  if(!waEl("waBox")) return;
  if(!currentUser || !supabaseClient){ waLimpar(false); return; }
  if(waAtualizando) return;      // a chamada em curso já vai deixar a caixa no estado certo
  waAtualizando = true;
  try{
    const st = await waConsultarStatus();
    if(st && st.whatsapp){ waMostrarVinculado(st); return; }
    const pend = waLerPendente();
    if(pend && pend.expiraEm > Date.now()){
      waPendente = pend;
      waMostrarCodigo();
      waIniciarEspera();
    }else if(pend){
      waGuardarPendente(null);
      waPendente = null;
      waMostrar("Expirado");
    }else if(!waTimer && !waEl("waEstadoExpirado").classList.contains("sel")){
      waMostrar("Inicial");   // não apaga um "Expirado" que acabou de ser mostrado
    }
  }catch(err){
    console.error("[wa] status:", err);
    if(!waTimer && !waPendente) waMostrar("Inicial");
  }finally{
    waAtualizando = false;
  }
}

async function waGerarCodigo(){
  if(!exigirLogin()) return;
  const botoes = ["btnWaVincular", "btnWaNovoCodigo", "btnWaNovoCodigo2"].map(waEl).filter(Boolean);
  botoes.forEach(b => { b.disabled = true; });
  try{
    const { data, error } = await supabaseClient.rpc("wa_gerar_codigo");
    if(error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) || null;
    if(!row || !/^\d{6}$/.test(String(row.codigo))) throw new Error("Resposta inesperada do servidor.");
    const exp = new Date(row.expira_em).getTime();
    waPendente = { codigo: String(row.codigo), expiraEm: exp > 0 ? exp : Date.now() + 15 * 60 * 1000 };
    waGuardarPendente(waPendente);
    waMostrarCodigo();
    waIniciarEspera();
  }catch(err){
    console.error("[wa] gerar código:", err);
    toast("Não foi possível gerar o código agora: " + String(err && err.message || err), "err");
    if(!waPendente) waMostrar("Inicial");
  }finally{
    botoes.forEach(b => { b.disabled = false; });
  }
}

function waIniciarEspera(){
  waPararEspera();
  waTimer = setInterval(waTick, WA_POLL_MS);
}

function waPararEspera(){
  if(waTimer){ clearInterval(waTimer); waTimer = null; }
}

async function waTick(){
  if(!waPendente || !currentUser){ waPararEspera(); return; }
  if(Date.now() > waPendente.expiraEm){ waExpirar(); return; }
  waAtualizaExpira();
  try{
    const st = await waConsultarStatus();
    if(st && st.whatsapp){
      waMostrarVinculado(st);
      toast("WhatsApp vinculado! Seu número já está ligado à sua conta.", "ok");
    }
  }catch(err){
    // Sessão inválida (401/403): para de consultar e volta ao início; outros erros só tentam de novo.
    const msg = String(err && err.message || err);
    if(/jwt|401|403|not authenticated|permission/i.test(msg)){ console.error("[wa] polling:", err); waLimpar(false); }
  }
}

function waExpirar(){
  waPararEspera();
  waPendente = null;
  waGuardarPendente(null);
  waMostrar("Expirado");
}

// Cancelar só esconde o código na tela (o servidor o invalida sozinho em 15 min).
function waCancelar(){
  waPararEspera();
  waPendente = null;
  waGuardarPendente(null);
  waMostrar("Inicial");
}

async function waDesvincular(){
  if(!exigirLogin()) return;
  if(!window.confirm("Desvincular este WhatsApp da sua conta? Você poderá vincular de novo quando quiser.")) return;
  const btn = waEl("btnWaDesvincular");
  if(btn) btn.disabled = true;
  try{
    const { error } = await supabaseClient.rpc("wa_desvincular");
    if(error) throw error;
    toast("WhatsApp desvinculado.", "info");
    waMostrar("Inicial");
  }catch(err){
    console.error("[wa] desvincular:", err);
    toast("Não foi possível desvincular agora: " + String(err && err.message || err), "err");
  }finally{
    if(btn) btn.disabled = false;
  }
}

// Ao sair da conta (apagaTudo=true) ou quando não há sessão: para tudo e volta ao início.
function waLimpar(apagaTudo){
  waPararEspera();
  waPendente = null;
  if(apagaTudo) waGuardarPendente(null);
  if(waEl("waBox")) waMostrar("Inicial");
}

function waInit(){
  if(!waEl("waBox")) return;
  waEl("btnWaVincular").addEventListener("click", waGerarCodigo);
  waEl("btnWaNovoCodigo").addEventListener("click", waGerarCodigo);
  waEl("btnWaNovoCodigo2").addEventListener("click", waGerarCodigo);
  waEl("btnWaCancelar").addEventListener("click", waCancelar);
  waEl("btnWaDesvincular").addEventListener("click", waDesvincular);
  waEl("waNumeroEmpresa").textContent = waFormataNumeroEmpresa(WHATSAPP_NUMERO_EMPRESA);
  // Voltou para a aba (ex.: depois de enviar a mensagem no WhatsApp): confere na hora.
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "visible" && currentUser){ waAtualizar().catch(() => {}); }
  });
}

/* ---------------- Arquivo "Meus Simulados" ---------------- */

// Chamado ao final de generateAll(): arquiva (ou atualiza, se o simulado
// atual veio de "Abrir") o simulado recém-gerado na conta do usuário
// logado. Tudo que é necessário para reabrir o simulado depois — as
// questões, o plano de gabarito, a validação escolhida — vai no campo
// "dados" (jsonb). Melhor esforço: se salvar falhar, o professor ainda fica
// com o simulado na tela e pode exportar normalmente, só não fica arquivado.
async function salvarSimuladoAtual(){
  if(!currentUser) return;
  const nomeArea = (AREA_META[state.area] && AREA_META[state.area].label) || state.area || "";
  const linha = {
    user_id: currentUser.id,
    nome: `Simulado de ${state.disciplina || state.area || "ENEM"}` + (temaDaLevaParaTitulo() ? ` — ${resumoTema(temaDaLevaParaTitulo(), 80)}` : ""),
    area: state.area,
    area_label: nomeArea,
    disciplina: state.disciplina,
    num_questoes: state.questions.length,
    validacao_dupla: !!document.getElementById("chkValidacao").checked,
    dados: {
      area: state.area,
      disciplina: state.disciplina,
      qty: state.qty,
      questions: state.questions,
      gabaritoPlan: state.gabaritoPlan || null,
    },
  };
  try{
    if(simuladoAbertoId){
      const { error } = await supabaseClient.from("simulados").update(linha).eq("id", simuladoAbertoId);
      if(error) throw error;
    }else{
      const { data, error } = await supabaseClient.from("simulados").insert(linha).select("id").single();
      if(error) throw error;
      simuladoAbertoId = data.id;
    }
  }catch(err){
    console.error("Falha ao arquivar o simulado em 'Meus Simulados':", err);
    toast("O simulado foi gerado, mas não foi possível arquivá-lo em 'Meus Simulados' agora.", "err");
  }
}

function formataDataSimulado(iso){
  try{
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }catch(e){ return ""; }
}

async function abrirMeusSimulados(){
  if(!exigirLogin()) return;
  document.getElementById("formPanel").style.display = "none";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("simuladosPanel").style.display = "block";
  const grid = document.getElementById("simuladosGrid");
  const vazio = document.getElementById("simuladosVazio");
  grid.innerHTML = `<p class="hint">Carregando...</p>`;
  vazio.classList.add("hidden");
  try{
    const { data, error } = await supabaseClient
      .from("simulados")
      .select("id, nome, area_label, disciplina, num_questoes, validacao_dupla, created_at")
      .order("created_at", { ascending: false });
    if(error) throw error;
    renderSimuladosGrid(data || []);
  }catch(err){
    grid.innerHTML = "";
    toast("Não foi possível carregar seus simulados: " + String(err && err.message || err), "err");
  }
}

function fecharMeusSimulados(){
  document.getElementById("simuladosPanel").style.display = "none";
  document.getElementById("formPanel").style.display = "block";
}

function renderSimuladosGrid(lista){
  const grid = document.getElementById("simuladosGrid");
  const vazio = document.getElementById("simuladosVazio");
  grid.innerHTML = "";
  if(!lista.length){ vazio.classList.remove("hidden"); return; }
  vazio.classList.add("hidden");
  lista.forEach(sim => {
    const card = document.createElement("div");
    card.className = "simulado-card";
    const qtdTxt = sim.num_questoes === 1 ? "1 questão" : `${sim.num_questoes} questões`;
    const valTxt = sim.validacao_dupla ? "com validação dupla" : "sem validação dupla";
    card.innerHTML = `
      <div class="simulado-tag">${escapeHtml(sim.area_label || "")}${sim.area_label ? " · " : ""}${escapeHtml(sim.disciplina || "")}</div>
      <div class="simulado-nome">
        <span class="txt" title="${escapeHtml(sim.nome)}">${escapeHtml(sim.nome)}</span>
        <button class="simulado-edit" title="Renomear">✏️</button>
      </div>
      <div class="simulado-meta">${qtdTxt} · ${valTxt}<br>📅 ${formataDataSimulado(sim.created_at)}</div>
      <div class="simulado-actions">
        <button class="btn ghost sm btn-abrir">Abrir</button>
        <button class="simulado-del" title="Excluir">🗑️</button>
      </div>`;
    card.querySelector(".btn-abrir").addEventListener("click", () => abrirSimuladoSalvo(sim.id));
    card.querySelector(".simulado-edit").addEventListener("click", () => iniciarRenomeioSimulado(card, sim));
    card.querySelector(".simulado-del").addEventListener("click", () => excluirSimulado(sim.id, card));
    grid.appendChild(card);
  });
}

function iniciarRenomeioSimulado(card, sim){
  const nomeWrap = card.querySelector(".simulado-nome");
  const nomeAtual = sim.nome;
  nomeWrap.innerHTML = `
    <input type="text" value="${escapeHtml(nomeAtual)}" maxlength="120">
    <button class="simulado-edit edit-ok" title="Salvar">✔️</button>
    <button class="simulado-edit edit-cancelar" title="Cancelar">✕</button>`;
  const input = nomeWrap.querySelector("input");
  input.focus();
  input.select();
  const salvar = async () => {
    const novoNome = input.value.trim() || nomeAtual;
    nomeWrap.innerHTML = `<span class="txt">${escapeHtml(novoNome)}</span><button class="simulado-edit" title="Renomear">✏️</button>`;
    nomeWrap.querySelector(".simulado-edit").addEventListener("click", () => iniciarRenomeioSimulado(card, { ...sim, nome: novoNome }));
    if(novoNome === nomeAtual) return;
    try{
      const { error } = await supabaseClient.from("simulados").update({ nome: novoNome }).eq("id", sim.id);
      if(error) throw error;
    }catch(err){
      toast("Não foi possível renomear: " + String(err && err.message || err), "err");
    }
  };
  const cancelar = () => {
    nomeWrap.innerHTML = `<span class="txt">${escapeHtml(nomeAtual)}</span><button class="simulado-edit" title="Renomear">✏️</button>`;
    nomeWrap.querySelector(".simulado-edit").addEventListener("click", () => iniciarRenomeioSimulado(card, sim));
  };
  nomeWrap.querySelector(".edit-ok").addEventListener("click", salvar);
  nomeWrap.querySelector(".edit-cancelar").addEventListener("click", cancelar);
  input.addEventListener("keydown", (e) => {
    if(e.key === "Enter") salvar();
    if(e.key === "Escape") cancelar();
  });
}

async function excluirSimulado(id, card){
  if(!confirm("Excluir este simulado arquivado? Esta ação não pode ser desfeita.")) return;
  try{
    const { error } = await supabaseClient.from("simulados").delete().eq("id", id);
    if(error) throw error;
    card.remove();
    if(!document.getElementById("simuladosGrid").children.length){
      document.getElementById("simuladosVazio").classList.remove("hidden");
    }
    toast("Simulado excluído.", "ok");
  }catch(err){
    toast("Não foi possível excluir: " + String(err && err.message || err), "err");
  }
}

async function abrirSimuladoSalvo(id){
  try{
    const { data, error } = await supabaseClient.from("simulados").select("*").eq("id", id).single();
    if(error) throw error;
    const dados = data.dados || {};
    state.area = dados.area || data.area;
    state.disciplina = dados.disciplina || data.disciplina;
    // v18.4: grade de áreas e chips de disciplina acompanham o arquivo aberto
    // (ver o comentário em btnBackToForm) — a tela nunca mostra outra coisa.
    renderAreaGrid();
    renderDisciplinaChips();
    atualizaOpcoesPorArea();
    state.qty = dados.qty || (dados.questions ? dados.questions.length : 1);
    state.questions = (dados.questions || []).map(q => {
      if(q && q.data){ normalizaCamposEstruturados(q.data); q.data = corrigirQuebrasLiterais(q.data); normalizaVisualQuestao(q.data); nmAplicaNaQuestao(q); }   // v16: notação matemática também no arquivo
      // Um simulado nunca deveria ser arquivado com imagem "em geração"; se
      // aconteceu (aba fechada no meio), o status volta a refletir a realidade.
      if(q && q.status === "imagem"){
        q.status = (q.data && q.data.visual && q.data.visual.imagemDataUrl) ? "done" : "error";
        if(q.status === "error") q.errorMsg = "Imagem obrigatória não foi gerada antes de o simulado ser arquivado. Clique em \"Regenerar\".";
      }
      return q;
    });
    // Simulados arquivados antes da correção podem ter questões com imagem
    // pedida e sem recurso visual — avisa, em vez de exibi-las como completas.
    const semRecurso = state.questions.filter(q => q && q.status === "done" && q.data && !visualConformeApp(q.data, q.recurso).ok).map((q, _i, _a) => state.questions.indexOf(q) + 1);
    if(semRecurso.length){
      console.warn("[imagens] questões arquivadas sem o recurso visual pedido:", semRecurso);
      setTimeout(() => toast(`Atenção: ${semRecurso.length} questão(ões) deste simulado (nº ${semRecurso.join(", ")}) foram arquivadas sem o recurso visual pedido. Use "Regenerar" nelas.`, "err"), 600);
    }
    state.gabaritoPlan = dados.gabaritoPlan || null;
    simuladoAbertoId = data.id;
    // v17.1: a caixa "Tema do lote" passa a refletir o simulado reaberto (e
    // conta como o último "Aplicar"), para um texto antigo deixado na caixa
    // não vencer o tema dele ao clicar em "Gerar" de volta no formulário.
    const temaReaberto = temaDaLevaParaTitulo() || "";
    const caixaLote = document.getElementById("loteTema");
    if(caixaLote) caixaLote.value = temaReaberto;
    loteTemaAplicado = temaReaberto;
    document.getElementById("chkValidacao").checked = !!data.validacao_dupla;
    document.getElementById("simuladosPanel").style.display = "none";
    document.getElementById("formPanel").style.display = "none";
    document.getElementById("resultsPanel").style.display = "block";
    document.getElementById("genProgressWrap").classList.add("hidden");
    // v17: contextos repetidos também são apontados em simulados arquivados
    // (só marcação local — nada é gerado ao abrir).
    try{ auditaDiversidadeContextos(); }catch(e){ /* nunca interrompe */ }
    renderResults();
    updateProgress();
    toast(`Simulado "${data.nome}" aberto.`, "ok");
    /* Todo simulado salvo a partir de agora já guarda as imagens prontas (ver
       renderGeneratedImage/generateAll), então reabri-lo não deveria gerar
       imagem nenhuma. Simulados arquivados ANTES desta correção, porém, não
       têm essa imagem guardada — o render acima teve que pedir uma agora. Uma
       vez terminada, ela é salva de volta no registro para NUNCA MAIS
       precisar ser gerada de novo ao reabrir este mesmo simulado. */
    const gerouImagemNova = await aguardaImagensPendentes();
    if(gerouImagemNova) await salvarSimuladoAtual();
  }catch(err){
    toast("Não foi possível abrir este simulado: " + String(err && err.message || err), "err");
  }
}

/* ---------------- Geração de imagem (GPT Image 2 via backend) ----------------

   QUALIDADE FIXA EM "low" — sem opção de escolha na interface. A decisão foi
   medida, não estilística. Gerando a MESMA especificação nas três qualidades,
   em 1536×1024:

       low     16 s   ·   158 tokens   ·   US$ 0,0065
       medium  39 s   · 1.372 tokens   ·   US$ 0,0429
       high    97 s   · 5.488 tokens   ·   US$ 0,1664

   Além de 26× mais barata e 6× mais rápida que "high", a saída em "low" foi a
   MAIS legível para o nosso caso: o modelo desenhou os rótulos em texto branco
   sobre tarja sólida — a camada de anotação que o protocolo pede —, enquanto em
   "high" ele gastou o orçamento extra em realismo fotográfico e escreveu os
   rótulos em cinza fino, sem tarja, sobre a foto. Para uma figura didática com
   régua e rótulo, mais tokens de imagem trabalham CONTRA a leitura.

   Não há mais seletor de qualidade por figura: toda imagem é sempre gerada em
   "low" — o backend (generate-image) trava isso do lado do servidor também,
   então nem uma requisição feita fora deste app consegue pedir outra coisa.

   FORMATO: WebP com compressão 80. A mesma imagem que sai com 2,2 MB em PNG sai
   com 110 KB em WebP — 20× menor, custo idêntico (a OpenAI cobra pelos tokens da
   imagem, não pelos bytes). É o que torna viável um simulado com 15 figuras sem
   gerar um PDF de 30 MB.                                                      */

const IMG_QUALIDADE_PADRAO = "low";

/* O agente já entrega o "promptImagem" no protocolo das 8 seções, que ali dentro
   descreve as duas camadas, a regra de precedência e as restrições negativas.
   Mandar tudo isso de novo num preâmbulo era repetir a mesma instrução duas
   vezes na mesma requisição. Então o preâmbulo só entra quando o texto NÃO é uma
   especificação completa — o caso de reserva, em que só há a "descricao". */
function imgEhEspecificacaoCompleta(texto){
  const t = String(texto || "");
  return /ELEMENT INVENTORY/i.test(t) && /NEGATIVE CONSTRAINTS/i.test(t);
}

const IMG_PREAMBULO_CURTO = `Ilustração educacional para uma questão no padrão ENEM. Cena real e nítida, com uma camada de anotação vetorial limpa por cima: rótulos legíveis com tarja ou halo atrás do texto, setas com sentido explícito e marcações de medida. A cena nunca pode prejudicar a leitura da anotação. Todo texto visível deve estar em português do Brasil, com ortografia correta. Sem texto decorativo, marca d'água ou assinatura.

Cena: `;

/* IMAGEM FORA DE ASSUNTO — A CAUSA RAIZ.

   O professor via questões de Matemática com imagem de Física (usina, ponte,
   aquecedor solar). O log do backend mostrou o motivo: em ~40% das imagens do
   dia o prompt enviado ao gerador terminava em "Cena: [object Object]". O
   modelo às vezes entrega "visual.promptImagem" como OBJETO (uma chave por
   seção do protocolo, ou {"tipo","valor"}) em vez de string; este arquivo
   fazia String(...) disso, o gerador recebia só o preâmbulo genérico, sem cena
   nenhuma, e inventava uma imagem "educacional" qualquer — sem jamais ter
   visto o enunciado. O backend (generate-question v60) agora normaliza isso
   na origem; aqui fica a garantia do lado do app, que vale também para
   simulados já arquivados e para qualquer resposta que escape da origem.    */
const IMG_SECOES = [
  [/scene|viewpoint|cena/i, "1. SCENE AND VIEWPOINT"],
  [/inventory|element/i, "2. ELEMENT INVENTORY"],
  [/layout|position|posi/i, "3. LAYOUT AND POSITION"],
  [/arrow|seta/i, "4. ARROWS"],
  [/label|r[oó]tulo/i, "5. TEXT LABELS"],
  [/number|scale|measure|n[uú]mero|escala|medida/i, "6. NUMBERS, SCALES AND MEASUREMENT MARKS"],
  [/style|legib|estilo/i, "7. STYLE AND LEGIBILITY"],
  [/negative|constraint|restri/i, "8. NEGATIVE CONSTRAINTS"],
];
const IMG_CHAVES_ENVELOPE = ["promptImagem", "prompt", "valor", "value", "texto", "text", "descricao", "description", "conteudo", "content", "especificacao", "specification"];

// Converte qualquer valor (string, objeto por seção, envelope, lista) em texto
// corrido — nunca devolve "[object Object]".
function imgTextoDeEspecificacao(valor, profundidade){
  profundidade = profundidade || 0;
  if(valor == null) return "";
  if(typeof valor === "string") return valor.trim();
  if(typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if(Array.isArray(valor)){
    return valor.map(v => imgTextoDeEspecificacao(v, profundidade + 1)).filter(Boolean).join(profundidade === 0 ? "\n" : "; ");
  }
  if(typeof valor === "object"){
    const chaves = Object.keys(valor);
    for(const k of IMG_CHAVES_ENVELOPE){
      const conteudo = valor[k];
      if(typeof conteudo === "string" && conteudo.trim()){
        const restantes = chaves.filter(c => c !== k && c !== "tipo" && c !== "type");
        if(!restantes.length) return conteudo.trim();
      }
    }
    const partes = [];
    chaves.forEach((k, i) => {
      const conteudo = imgTextoDeEspecificacao(valor[k], profundidade + 1);
      if(!conteudo) return;
      const secao = IMG_SECOES.findIndex(par => par[0].test(k));
      const titulo = secao >= 0 ? IMG_SECOES[secao][1] : k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
      partes.push({ ordem: secao >= 0 ? secao : 100 + i, texto: titulo + ": " + conteudo });
    });
    partes.sort((a, b) => a.ordem - b.ordem);
    return partes.map(p => p.texto).join(profundidade === 0 ? "\n\n" : "; ");
  }
  return "";
}

// Garante que data.visual tenha "tipo" e que promptImagem/descricao/titulo
// sejam strings. Aplicado a toda questão que entra no app: recém-gerada,
// refeita ("Refazer imagem") ou reaberta de "Meus Simulados".
function normalizaVisualQuestao(data){
  if(!data || data.visual == null) return data;
  let v = data.visual;
  if(typeof v === "string"){
    const t = v.trim();
    if(!t){ data.visual = null; return data; }
    try{
      const p = JSON.parse(t);
      v = (p && typeof p === "object" && !Array.isArray(p)) ? p : { tipo: "imagem", promptImagem: t };
    }catch(e){ v = { tipo: "imagem", promptImagem: t }; }
  }
  if(typeof v !== "object" || Array.isArray(v)) return data;
  if(typeof v.tipo === "string") v.tipo = v.tipo.trim().toLowerCase();
  if(!v.tipo && ["imagem","grafico","tabela"].includes(data.recurso)) v.tipo = data.recurso;
  ["promptImagem","descricao","titulo"].forEach(k => {
    if(v[k] != null && typeof v[k] !== "string") v[k] = imgTextoDeEspecificacao(v[k], 0);
  });
  if(typeof v.promptImagem === "string" && !v.promptImagem.trim()) delete v.promptImagem;
  data.visual = v;
  return data;
}

/* v10 — CAMPOS ESTRUTURADOS QUE CHEGAM COMO STRING (cópia da rede de
   segurança do backend v67). Caso real (10/09/2026, questão 6 do lote
   "ciclos biogeoquímicos"): o modelo devolveu "alternativas" como uma STRING
   contendo o JSON das cinco alternativas, truncada no fim (sem o `"}`). O app
   procurava alternativas.A…E numa string e exibia as cinco em branco — a
   auditoria local acusava "Alternativa(s) sem texto". Aqui trata tanto a
   questão recém-gerada (segunda rede, depois do backend) quanto simulados já
   arquivados com o defeito. Tem de rodar ANTES de corrigirQuebrasLiterais,
   que trocaria "\n" literal por quebra real e quebraria o JSON na string.
   Objeto que já é objeto não é tocado. */
const LETRAS_ALTERNATIVAS = ["A","B","C","D","E"];

function desescaparJsonString(s){
  return s
    .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\\\/g, "\\");
}

function objetoDeString(bruto){
  const t = String(bruto).trim();
  if(!t.startsWith("{")) return null;
  for(const sufixo of ["", '"}', "}", '"}}', "}}"]){
    try{
      const p = JSON.parse(t + sufixo);
      if(p && typeof p === "object" && !Array.isArray(p)) return p;
    }catch(e){ /* tenta o próximo fechamento */ }
  }
  return null;
}

function alternativasUtilizaveis(obj){
  if(!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return LETRAS_ALTERNATIVAS.every(L => typeof obj[L] === "string" && obj[L].trim().length > 0);
}

function alternativasDeString(bruto){
  const direto = objetoDeString(bruto);
  if(direto && alternativasUtilizaveis(direto)) return direto;
  const marcas = [];
  const re = /"([A-E])"\s*[^"\w\s]{0,2}\s*"/g; // aceita ":" e também um separador trocado (caso real: `"D">"16 A."`)
  let m;
  while((m = re.exec(bruto)) !== null){
    if(marcas.some(x => x.letra === m[1])) continue;
    marcas.push({ letra: m[1], inicio: m.index, fimMarca: m.index + m[0].length });
  }
  if(marcas.length !== 5) return null;
  const saida = {};
  for(let i = 0; i < marcas.length; i++){
    const fim = i + 1 < marcas.length ? marcas[i + 1].inicio : bruto.length;
    let valor = bruto.slice(marcas[i].fimMarca, fim).trim();
    valor = valor.replace(/[\s,]*\}*\s*$/g, "").replace(/(?<!\\)"[\s,]*$/g, "").trim();
    saida[marcas[i].letra] = desescaparJsonString(valor).trim();
  }
  return alternativasUtilizaveis(saida) ? saida : null;
}

function normalizaCamposEstruturados(data){
  if(!data || typeof data !== "object") return data;
  if(typeof data.alternativas === "string"){
    const tamanho = data.alternativas.length;
    const obj = alternativasDeString(data.alternativas);
    if(obj){ data.alternativas = obj; console.log("[alternativas] campo veio como string — reparado no app (" + tamanho + " caracteres)"); }
    else console.warn("[alternativas] campo veio como string e NÃO pôde ser reparado (" + tamanho + " caracteres)");
  }
  ["analiseAlternativas","competencia","habilidade"].forEach(campo => {
    if(typeof data[campo] === "string"){
      const obj = objetoDeString(data[campo]);
      if(obj){ data[campo] = obj; console.log("[" + campo + "] campo veio como string — reparado no app"); }
    }
  });
  if(data.analiseAlternativas && typeof data.analiseAlternativas === "object"){
    LETRAS_ALTERNATIVAS.forEach(L => {
      const v = data.analiseAlternativas[L];
      if(typeof v === "string"){ const obj = objetoDeString(v); if(obj) data.analiseAlternativas[L] = obj; }
    });
  }
  return data;
}

/* Texto que vai ao gerador de imagem. Ordem de preferência: a especificação
   completa ("promptImagem"); senão a legenda ("descricao") junto com o próprio
   enunciado da questão — para que, mesmo sem especificação, a imagem seja
   sobre ESTA questão e nunca sobre um assunto inventado. */
function montaPromptImagem(visual, dataQuestao){
  const spec = imgTextoDeEspecificacao(visual && visual.promptImagem, 0);
  if(spec) return spec;
  const partes = [];
  const desc = imgTextoDeEspecificacao(visual && visual.descricao, 0);
  if(desc) partes.push(desc);
  if(dataQuestao){
    const enunciado = [dataQuestao.textoBase, dataQuestao.comando].map(t => String(t || "").trim()).filter(Boolean).join("\n");
    if(enunciado) partes.push("A imagem deve retratar fielmente a situação descrita neste enunciado, com os mesmos objetos e valores, sem revelar a resposta:\n" + enunciado.slice(0, 1500));
  }
  return partes.join("\n\n");
}

/* ---------------- Recurso visual obrigatório: conferência e diagnóstico ----------------

   O que o banco mostrou (08/09/2026, 11 simulados): o modelo entregava a
   questão SEM o recurso visual pedido (visual null) ou com o tipo trocado
   (gráfico no lugar de imagem) em 1 a 5 questões por leva de 10 — e o app
   marcava a questão como concluída sem conferir. A partir daqui:
   - visualConformeApp() confere recurso pedido × visual entregue (mesma
     regra do backend v62);
   - diagImagem() registra, por questão, cada etapa do caminho da imagem
     (q.diag — vai junto com o simulado arquivado e para o console), para que
     uma falha futura diga exatamente em que etapa aconteceu;
   - gerarImagemComRetentativas() faz até IMG_MAX_TENTATIVAS pedidos ao
     gerador antes de declarar a imagem perdida. */
const IMG_MAX_TENTATIVAS = 3;
const IMG_ESPERA_ENTRE_TENTATIVAS_MS = 2500;

function visualConformeApp(data, recurso){
  if(!["imagem","grafico","tabela"].includes(recurso)) return { ok: true, motivo: "" };
  const v = data && data.visual;
  if(v == null || typeof v !== "object") return { ok: false, motivo: `recurso "${recurso}" pedido, mas a questão veio com visual ${v == null ? "nulo" : typeof v}` };
  if(v.tipo !== recurso) return { ok: false, motivo: `recurso "${recurso}" pedido, mas a questão veio com tipo "${v.tipo || "(sem tipo)"}"` };
  if(recurso === "imagem"){
    const p = imgTextoDeEspecificacao(v.promptImagem, 0);
    if(p.length < 200) return { ok: false, motivo: `imagem sem especificação utilizável (promptImagem com ${p.length} caracteres)` };
  }
  if(recurso === "grafico" && !(Array.isArray(v.labels) && v.labels.length && Array.isArray(v.datasets) && v.datasets.length)) return { ok: false, motivo: "gráfico sem labels/datasets" };
  if(recurso === "tabela" && !(Array.isArray(v.colunas) && v.colunas.length && Array.isArray(v.linhas) && v.linhas.length)) return { ok: false, motivo: "tabela sem colunas/linhas" };
  return { ok: true, motivo: "" };
}

function diagImagem(q, etapa, detalhe){
  if(!q) return;
  if(!Array.isArray(q.diag)) q.diag = [];
  const registro = { t: new Date().toISOString(), etapa, detalhe: detalhe == null ? "" : String(detalhe).slice(0, 400) };
  q.diag.push(registro);
  if(q.diag.length > 60) q.diag.splice(0, q.diag.length - 60);
  const n = state.questions.indexOf(q);
  console.log(`[diag q${n >= 0 ? n + 1 : "?"}] ${etapa}${registro.detalhe ? " — " + registro.detalhe : ""}`);
}

// Pede a imagem ao backend até IMG_MAX_TENTATIVAS vezes. Só desiste de vez
// quando a causa não é transitória (questão sem especificação: repetir não
// ajuda) ou quando as tentativas acabam. Devolve { dataUrl, uso, tentativas }.
async function gerarImagemComRetentativas(promptText, q){
  let ultimoErro = null;
  for(let tentativa = 1; tentativa <= IMG_MAX_TENTATIVAS; tentativa++){
    diagImagem(q, "imagem_tentativa", `${tentativa}/${IMG_MAX_TENTATIVAS} · prompt ${imgTextoDeEspecificacao(promptText, 0).length} chars`);
    try{
      const r = await generateImageViaBackend(promptText);
      diagImagem(q, "imagem_ok", `tentativa ${tentativa} · ${Math.round((r.dataUrl || "").length / 1024)} KB` + (r.uso ? ` · ${r.uso.segundos}s · US$ ${Number(r.uso.custoUSD || 0).toFixed(4)}` : ""));
      return { dataUrl: r.dataUrl, uso: r.uso, tentativas: tentativa };
    }catch(err){
      ultimoErro = err;
      const msg = err && err.message ? err.message : String(err);
      diagImagem(q, "imagem_erro", `tentativa ${tentativa}: ${msg}`);
      const semEspecificacao = /sem a especificação/i.test(msg);
      // Sem login não há o que repetir: o backend recusa toda tentativa igual.
      const naoAutorizado = /HTTP 40[13]\b|fazer login/i.test(msg);
      if(semEspecificacao || naoAutorizado) break;
      if(tentativa < IMG_MAX_TENTATIVAS) await new Promise(r => setTimeout(r, IMG_ESPERA_ENTRE_TENTATIVAS_MS * tentativa));
    }
  }
  throw ultimoErro || new Error("Falha desconhecida ao gerar a imagem.");
}

async function generateImageViaBackend(promptText){
  const texto = imgTextoDeEspecificacao(promptText, 0);
  if(!texto) throw new Error("A questão veio sem a especificação da imagem. Use \"Refazer imagem\" para gerá-la.");
  const prompt = imgEhEspecificacaoCompleta(texto) ? texto : (IMG_PREAMBULO_CURTO + texto);

  const res = await fetch(IMAGE_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      prompt,
      size: "1536x1024",
      quality: IMG_QUALIDADE_PADRAO,
      outputFormat: "webp",
      outputCompression: 80,
    }),
  });
  let data = {};
  try{ data = await res.json(); }catch(e){ /* resposta não-JSON */ }
  if(!res.ok || data.error){
    throw new Error(data.error || `Erro HTTP ${res.status} ao gerar imagem.`);
  }
  if(!data.imageDataUrl){
    throw new Error("O backend não retornou a imagem.");
  }
  if(data.uso) somaUsoImagem(data.uso);
  return { dataUrl: data.imageDataUrl, uso: data.uso || null };
}

/* Contabilidade das imagens do simulado, para o custo ser verificável em vez de
   estimado: o backend devolve tokens, segundos e preço de cada imagem. */
function zeraUsoImagem(){
  state.usoImagem = { imagens: 0, segundos: 0, tokensEntrada: 0, tokensSaida: 0, custoUSD: 0, bytes: 0 };
}
function somaUsoImagem(u){
  if(!state.usoImagem) zeraUsoImagem();
  const a = state.usoImagem;
  a.imagens += 1;
  a.segundos += Number(u.segundos) || 0;
  a.tokensEntrada += Number(u.tokensEntrada) || 0;
  a.tokensSaida += Number(u.tokensSaida) || 0;
  a.custoUSD += Number(u.custoUSD) || 0;
  a.bytes += Number(u.bytesImagem) || 0;
  console.log(`[imagem] ${u.qualidade} · ${u.segundos}s · ${u.tokensSaida} tokens · US$ ${Number(u.custoUSD).toFixed(5)} · ${Math.round((Number(u.bytesImagem)||0)/1024)} KB  |  acumulado: ${a.imagens} imagens, US$ ${a.custoUSD.toFixed(4)}`);
}

let uidCounter = 1;
function uid(){ return "q" + (uidCounter++); }
/* v18.6/v18.7 — a MESMA frase abaixo da caixa de orientações, no painel do lote (no
   template) e em cada bloco de questão. Uma constante só para nunca divergirem. */
const ORIENT_AVISO = "Campo opcional para sugerir o enfoque ou a contextualização da questão. As orientações serão consideradas somente quando compatíveis com as diretrizes do INEP, a Matriz de Referência e os padrões de elaboração do ENEM.";
let confirmaDisciplinaEm = 0;   // v18.4: instante do aviso de disciplina (ver iniciarGeracao)
let confirmaOrientacoesEm = 0;  // v18.11: instante do aviso de orientações não aplicadas

/* v18.11 — o professor escreveu orientações no painel do lote e não clicou em
   "Aplicar"? Então nenhuma questão carrega esse texto e ele não chegaria à IA.
   Caixa vazia nunca acusa nada. */
function orientacoesDoLotePendentes(){
  const el = document.getElementById("loteOrientacoes");
  const txt = el ? (el.value || "").trim().slice(0, 600) : "";
  if(!txt) return false;
  return !state.questions.some(q => (q.orientacoes || "").trim() === txt);
}

/* ---------------- Armazenamento local (opcional, à prova de falhas) ----------------
   Algumas telas de pré-visualização (ex.: pré-visualização de artefatos) bloqueiam
   localStorage. Por isso todo acesso é protegido — se falhar, o app simplesmente
   volta a pedir a chave a cada sessão, sem quebrar nada. */
const STORAGE_KEYS = { apiKey: "enem_simulados_api_key", model: "enem_simulados_model" };
function safeStorageGet(key){
  try{ return window.localStorage.getItem(key); }catch(e){ return null; }
}
function safeStorageSet(key, value){
  try{ window.localStorage.setItem(key, value); return true; }catch(e){ return false; }
}
function safeStorageRemove(key){
  try{ window.localStorage.removeItem(key); }catch(e){ /* ignora */ }
}

/* ---------------- Toasts ---------------- */
function toast(msg, type){
  type = type || "info";
  const box = document.getElementById("toastBox");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 4200);
}

/* ---------------- Area / Disciplina ---------------- */
function renderAreaGrid(){
  const grid = document.getElementById("areaGrid");
  grid.innerHTML = "";
  Object.keys(AREA_META).forEach(key => {
    const m = AREA_META[key];
    const tile = document.createElement("div");
    tile.className = "area-tile" + (state.area === key ? " sel" : "");
    tile.dataset.area = key;
    tile.innerHTML = `<span class="ic">${m.icon}</span><h3>${m.label}</h3><p>${m.desc}</p>`;
    tile.addEventListener("click", () => { if(exigirLogin()) selectArea(key); });
    grid.appendChild(tile);
  });
}

function selectArea(key){
  state.area = key;
  state.disciplina = AREA_META[key].disciplinas[0];
  limpaInstrucoesVisuais(); // instruções de imagem de outra área não sobrevivem à troca
  renderAreaGrid();
  renderDisciplinaChips();
  renderQuestionBlocks();
  atualizaOpcoesPorArea();
  sincronizaContadoresLote();
}

/* Instruções opcionais de imagem/gráfico/tabela são por questão e digitadas
   livremente. Elas só fazem sentido para a disciplina em que foram escritas:
   ao trocar de área ou de disciplina, são apagadas aqui — e NÃO mais na
   geração (ver generateAll), para que a instrução digitada no formulário
   chegue de fato ao backend na primeira geração. */
function limpaInstrucoesVisuais(){
  state.questions.forEach(q => { q.instrucoesVisual = ""; });
}

// O interruptor da revisão matemática só aparece onde tem efeito (Matemática);
// nas outras áreas o backend nem chama o revisor, então não há o que decidir.
function atualizaOpcoesPorArea(){
  const lbl = document.getElementById("lblRevisaoMat");
  if(lbl) lbl.style.display = state.area === "matematica" ? "flex" : "none";
}

function renderDisciplinaChips(){
  const wrap = document.getElementById("disciplinaChips");
  wrap.innerHTML = "";
  if(!state.area){ wrap.innerHTML = `<span class="hint">Selecione uma área do conhecimento primeiro.</span>`; return; }
  AREA_META[state.area].disciplinas.forEach(d => {
    const chip = document.createElement("div");
    const marcada = state.disciplina === d;
    chip.className = "chip" + (marcada ? " sel" : "");
    chip.textContent = d;
    /* v18.10 — a marcação também é dita a quem não enxerga a cor: aria-pressed
       para o leitor de tela e title no passar do mouse. E o chip passa a ser um
       botão de verdade — foco pelo teclado e acionamento por Enter/Espaço. */
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.setAttribute("aria-pressed", marcada ? "true" : "false");
    chip.title = marcada ? d + " — disciplina selecionada" : "Selecionar " + d;
    const seleciona = () => {
      if(state.disciplina !== d) limpaInstrucoesVisuais();
      state.disciplina = d;
      renderDisciplinaChips();
      renderQuestionBlocks();
      sincronizaContadoresLote();
    };
    chip.addEventListener("click", seleciona);
    chip.addEventListener("keydown", ev => {
      if(ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar"){ ev.preventDefault(); seleciona(); }
    });
    wrap.appendChild(chip);
  });
}

/* ---------------- Quantity stepper ---------------- */
function setQty(n){
  n = Math.max(1, Math.min(20, n));
  state.qty = n;
  document.getElementById("qtyVal").textContent = n;
  syncQuestionsArrayLength();
  renderQuestionBlocks();
  sincronizaContadoresLote();
}

/* ---------------- Configuração em lote (passo 4) ----------------

   Um tema, um recurso e um ou mais níveis para todas as questões de uma vez.
   O botão só PREENCHE state.questions e redesenha os blocos individuais —
   não existe um segundo caminho de geração: "Gerar simulado completo"
   continua lendo os mesmos objetos, e com o mesmo tema em todas as questões
   o planejamento de recortes (planejaRecortesPorTema) e a distribuição de
   gabaritos fazem o trabalho de diversidade. */
/* v9 — CONTADORES POR NÍVEL (Opção B). Os contadores são um espelho
   editável dos blocos individuais, com duas regras e nenhuma exceção:
   - blocos → contadores (automático): qualquer mudança de nível em qualquer
     questão — clique num bloco, "Aplicar", stepper, troca de área/disciplina,
     volta da tela de resultados — refaz os contadores com a contagem REAL
     (sincronizaContadoresLote);
   - contadores → blocos (só no "Aplicar"): mexer nos contadores é plano;
     o botão distribui exatamente essas quantidades, embaralhadas.
   A soma dos contadores tem de ser igual à quantidade de questões; enquanto
   não fechar, a linha de situação avisa e o "Aplicar" fica desabilitado. */
const NIVEIS_LOTE = [
  { nome: "Fácil", id: "loteContFacil", plural: "fáceis", singular: "fácil" },
  { nome: "Médio", id: "loteContMedio", plural: "médias", singular: "média" },
  { nome: "Difícil", id: "loteContDificil", plural: "difíceis", singular: "difícil" },
];
// Plano dos contadores (o que o "Aplicar" vai distribuir). Começa vazio e é
// preenchido pela primeira sincronização com os blocos.
let loteContadores = { "Fácil": 0, "Médio": 0, "Difícil": 0 };

// Contagem REAL de níveis nas questões do formulário.
function contagemRealPorNivel(){
  const c = { "Fácil": 0, "Médio": 0, "Difícil": 0 };
  state.questions.forEach(q => { if(c[q.dificuldade] !== undefined) c[q.dificuldade]++; });
  return c;
}

// Divisão igual de "total" entre os três níveis; a sobra vai para os
// primeiros na ordem Fácil → Médio → Difícil.
function contagemIgual(total){
  const base = Math.floor(total / 3), sobra = total % 3;
  const saida = {};
  NIVEIS_LOTE.forEach((n, i) => { saida[n.nome] = base + (i < sobra ? 1 : 0); });
  return saida;
}

/* v18.5 — NUNCA DOIS NÍVEIS IGUAIS SEGUIDOS.
   Até a v18.4 a ordem era só um embaralhamento, e embaralhar não impede
   repetição: com 4 fáceis, 3 médias e 3 difíceis, a chance de sair pelo menos
   um par seguido é de cerca de 93%. O professor exige alternância: nunca duas
   (nem três, nem quatro) questões seguidas do mesmo nível.
   Quantas de um mesmo nível cabem sem repetir: intercalando A com as outras,
   A ocupa as posições ímpares — no máximo ⌈n/2⌉. Acima disso a repetição é
   ARITMETICAMENTE inevitável, e o app diz isso em vez de fingir que cumpriu. */
function maxSemRepetir(total){ return Math.ceil(total / 2); }
function niveisPodemAlternar(contagem, total){
  return NIVEIS_LOTE.every(n => (contagem[n.nome] || 0) <= maxSemRepetir(total));
}
/* Com um nível acima do teto, o mínimo de vizinhanças iguais que sobram é
   2·maior − total − 1 (as sobras que não têm separador). 8 fáceis em 10 → 5. */
function repeticoesInevitaveis(contagem, total){
  const maior = Math.max.apply(null, NIVEIS_LOTE.map(n => contagem[n.nome] || 0));
  return Math.max(0, 2 * maior - total - 1);
}
function paresSeguidos(lista){
  let n = 0;
  for(let i = 1; i < lista.length; i++) if(lista[i] === lista[i - 1]) n++;
  return n;
}
/* Ordem sorteada E sem dois níveis iguais seguidos.
   Duas etapas: sorteia até 200 vezes e fica com a primeira ordem que já alterna
   (mantém a variedade do embaralhamento puro, que é o que o professor quer —
   como no ENEM real, a prova não vem ordenada por dificuldade); se nenhuma
   alternar, monta pelo guloso clássico — a cada passo, entre os níveis que não
   são o anterior, escolhe o que mais resta, com sorteio no empate. O guloso
   acha uma ordem alternada sempre que existir uma. */
function distribuiNiveis(contagem){
  const lista = [];
  NIVEIS_LOTE.forEach(n => { for(let k = 0; k < (contagem[n.nome] || 0); k++) lista.push(n.nome); });
  if(lista.length < 2) return lista;
  for(let t = 0; t < 200; t++){
    const tentativa = embaralha(lista);
    if(paresSeguidos(tentativa) === 0) return tentativa;
  }
  const restam = {};
  NIVEIS_LOTE.forEach(n => { restam[n.nome] = contagem[n.nome] || 0; });
  const saida = [];
  let anterior = null;
  for(let i = 0; i < lista.length; i++){
    let cand = NIVEIS_LOTE.map(n => n.nome).filter(x => restam[x] > 0 && x !== anterior);
    // Só fica sem candidato quando a repetição é inevitável (ver repeticoesInevitaveis).
    if(!cand.length) cand = NIVEIS_LOTE.map(n => n.nome).filter(x => restam[x] > 0);
    const maior = Math.max.apply(null, cand.map(x => restam[x]));
    const escolhido = embaralha(cand.filter(x => restam[x] === maior))[0];
    saida.push(escolhido); restam[escolhido]--; anterior = escolhido;
  }
  return saida;
}

function somaContadores(){
  return NIVEIS_LOTE.reduce((s, n) => s + (loteContadores[n.nome] || 0), 0);
}

function recursoDoLote(){
  const sel = document.querySelector("#loteRecursoRow .res-opt.sel");
  return sel ? sel.dataset.r : "nenhum";
}

function textoContagem(contagem){
  return NIVEIS_LOTE.filter(n => contagem[n.nome] > 0).map(n => `${contagem[n.nome]} ${contagem[n.nome] === 1 ? n.singular : n.plural}`).join(" · ") || "nenhuma";
}

// Blocos → contadores: os contadores passam a mostrar a contagem real.
function sincronizaContadoresLote(){
  loteContadores = contagemRealPorNivel();
  atualizaResumoLote();
}

// Desenha contadores, linha de situação e estado do botão "Aplicar".
function atualizaResumoLote(){
  const qtdEl = document.getElementById("loteQtd");
  const resumoEl = document.getElementById("loteResumo");
  const btn = document.getElementById("btnAplicarLote");
  if(!qtdEl || !resumoEl) return;
  const total = state.qty;
  qtdEl.textContent = total;
  NIVEIS_LOTE.forEach(n => {
    const el = document.getElementById(n.id);
    if(!el) return;
    const v = loteContadores[n.nome] || 0;
    el.textContent = v;
    const card = el.closest(".lote-count");
    if(card){
      card.classList.toggle("zero", v === 0);
      const menos = card.querySelector(".lc-menos"), mais = card.querySelector(".lc-mais");
      if(menos) menos.disabled = v <= 0;
      if(mais) mais.disabled = v >= total;
    }
  });
  const soma = somaContadores();
  const fecha = soma === total;
  // v18.5: alternância dos níveis — o professor vê ANTES de aplicar se a
  // contagem que ele montou permite não repetir nível em questões seguidas.
  const alterna = niveisPodemAlternar(loteContadores, total);
  resumoEl.classList.toggle("erro", !fecha || (fecha && !alterna));
  resumoEl.textContent = !fecha
    ? `${soma} de ${total} — ajuste os contadores para fechar a soma`
    : alterna
      ? `${total} de ${total} ${total === 1 ? "questão" : "questões"} · ${textoContagem(loteContadores)} · ordem sorteada, sem dois níveis iguais seguidos`
      : `${total} de ${total} · ${textoContagem(loteContadores)} — com ${total} ${total === 1 ? "questão" : "questões"} o máximo de um mesmo nível é ${maxSemRepetir(total)}; assim ${repeticoesInevitaveis(loteContadores, total) === 1 ? "1 repetição é inevitável" : `${repeticoesInevitaveis(loteContadores, total)} repetições são inevitáveis`}`;
  if(btn) btn.disabled = !fecha;
}

// "+"/"−" de um contador: só o plano muda (0..N); os blocos ficam como estão
// até o "Aplicar".
function ajustaContadorLote(nivel, delta){
  const v = Math.max(0, Math.min(state.qty, (loteContadores[nivel] || 0) + delta));
  loteContadores[nivel] = v;
  atualizaResumoLote();
}

function distribuirIgualmenteLote(){
  loteContadores = contagemIgual(state.qty);
  atualizaResumoLote();
}

function aplicarLoteATodas(){
  if(!state.area){ toast("Selecione a área do conhecimento primeiro.", "err"); return; }
  const tema = (document.getElementById("loteTema").value || "").trim();
  syncQuestionsArrayLength();
  const total = state.questions.length;
  if(somaContadores() !== total){ toast(`A soma dos contadores (${somaContadores()}) tem de ser igual ao número de questões (${total}).`, "err"); return; }
  const recurso = recursoDoLote();
  const contagem = { ...loteContadores };
  const plano = distribuiNiveis(contagem);
  loteTemaAplicado = tema;
  // v18: vários conteúdos na caixa → um por questão, em rodízio (ver aplicaTemaDoLote).
  const dist = aplicaTemaDoLote(tema);
  const orientacoes = (document.getElementById("loteOrientacoes").value || "").trim().slice(0, 600);
  state.questions.forEach((q, i) => {
    q.dificuldade = plano[i];
    q.recurso = recurso;
    q.orientacoes = orientacoes;   // v18.6: mesma orientação para a leva toda
    // O lote redefine o recurso de todas: uma instrução de imagem antiga não
    // pode sobreviver a isso (mesma regra da troca de disciplina).
    q.instrucoesVisual = "";
  });
  renderQuestionBlocks();
  sincronizaContadoresLote();
  const resumo = textoContagem(contagem);
  // v18.5: a ordem sai alternada sempre que a contagem permitir; quando não
  // permitir, o professor é avisado com o número exato e o que mudar.
  const repetidos = paresSeguidos(plano);
  if(repetidos > 0) toast(`Níveis: ${repetidos === 1 ? "1 par de questões seguidas ficou" : `${repetidos} pares de questões seguidas ficaram`} com o mesmo nível — inevitável com ${textoContagem(contagem)} em ${total} ${total === 1 ? "questão" : "questões"}, porque o máximo de um mesmo nível sem repetir é ${maxSemRepetir(total)}. Equilibre os contadores para alternar.`, "err");
  console.log(`[lote] aplicado a ${total} questões · tema "${tema || "(em branco)"}" · recurso ${recurso} · níveis ${resumo} · ordem: ${plano.join(", ")}` + (dist.itens.length > 1 ? ` · ${dist.itens.length} conteúdos em rodízio: ${textoDistribuicaoLote()}` : ""));
  const temaTxt = !tema ? "; tema em branco — a IA distribui os objetos de conhecimento"
    : dist.itens.length > 1 ? `; ${dist.itens.length} conteúdos em rodízio: ${resumoTema(textoDistribuicaoLote(), 220)}`
    : `; tema: "${resumoTema(tema, 120)}"`;
  toast(`Configuração aplicada às ${total} questões (${resumo}${temaTxt}). Ajuste qualquer questão abaixo, se quiser.`, "ok");
  if(dist.sobras.length) toast(`Você listou ${dist.itens.length} conteúdos para ${total} ${total === 1 ? "questão" : "questões"}: ${dist.sobras.length === 1 ? "ficou de fora" : "ficaram de fora"} ${dist.sobras.map(t => `"${resumoTema(t, 40)}"`).join(", ")}. Aumente a quantidade de questões ou remova conteúdos da lista.`, "err");
}

/* ---------------- v18: vários conteúdos no "Tema do lote" ----------------
   O professor lista os conteúdos do simulado ("MDC, MMC, radiciação" ou um
   por linha) e o app — sem IA, sem custo — dá um conteúdo a cada questão em
   rodízio, na ordem digitada (1º → questão 1, 2º → questão 2, …, e recomeça),
   mostra a distribuição em cada questão e no painel do lote, e o professor
   pode trocar qualquer uma. Até a v17 a lista inteira ia igual para as N
   questões e só o planejador (IA) decidia, escondido, qual conteúdo cabia a
   cada uma (leva 1eb71207, 14/09/2026). Agora o planejador recebe a
   distribuição pronta (temasPorQuestao, backend v74) e só detalha o recorte
   dentro do conteúdo de cada questão — a mesma chamada única de antes.
   Cada questão guarda o SEU conteúdo em q.tema (é o que vai à IA) e a lista
   original em q.temaLote (agrupa as questões do mesmo lote para o
   planejamento, dá nome ao simulado e preenche a caixa ao reabrir). */

// Quebra o texto da caixa em itens. Com quebras de linha: uma linha por item
// (marcadores "-", "*", "•", "1." e um "e" inicial sobrando são removidos).
// Numa linha só: por ";" ou, na falta, por "," — "1,5" (vírgula entre dígitos)
// e vírgulas dentro de parênteses não separam. Um item só → lista de 1.
function tiraPontuacaoFinal(s){
  let fim = s.length;
  while(fim > 0 && /[\s.;,]/.test(s[fim - 1])) fim--;
  return s.slice(0, fim);
}
function itensDoTemaDoLote(texto){
  const t = String(texto || "").replace(/\r\n?/g, "\n").trim();
  if(!t) return [];
  const limpa = s => tiraPontuacaoFinal(s.trim().replace(/^(?:[-*•–—]\s*|\d{1,2}[.)]\s+)/, "").replace(/^(?:e|E)\s+(?=\S)/, "")).trim();
  const linhas = t.split("\n").map(limpa).filter(x => x.length >= 2);
  if(!linhas.length) return [];
  let partes;
  if(linhas.length >= 2){
    partes = linhas;
  }else{
    const linha = linhas[0];
    const sep = /;/.test(linha) ? ";" : ",";
    partes = []; let atual = ""; let nivel = 0;
    for(let i = 0; i < linha.length; i++){
      const c = linha[i];
      if(c === "(" || c === "[") nivel++;
      else if(c === ")" || c === "]") nivel = Math.max(0, nivel - 1);
      const decimal = c === "," && /\d/.test(linha[i - 1] || "") && /\d/.test(linha[i + 1] || "");
      const separa = c === sep && nivel === 0 && !decimal;
      if(separa){ partes.push(atual); atual = ""; } else atual += c;
    }
    partes.push(atual);
    partes = partes.map(limpa).filter(x => x.length >= 2);
  }
  if(partes.length <= 1) return [linhas.length === 1 ? linhas[0] : partes[0] || t];
  return partes.slice(0, 40);
}
// Rodízio: n temas, um por questão, na ordem digitada. Devolve também os
// itens que não couberam (mais conteúdos do que questões).
function distribuiTemaDoLote(texto, n){
  const itens = itensDoTemaDoLote(texto);
  const temas = [];
  for(let i = 0; i < n; i++) temas.push(itens.length ? itens[i % itens.length] : "");
  return { itens, temas, sobras: itens.length > n ? itens.slice(n) : [] };
}
// Forma canônica da lista: itens separados por ", " (uma lista digitada em
// linhas e a mesma em vírgulas são a mesma lista — mesmo grupo, mesmo título).
function listaCanonica(texto){
  const itens = itensDoTemaDoLote(texto);
  return itens.length > 1 ? itens.join(", ") : String(texto || "").replace(/\s+/g, " ").trim();
}
// Aplica o texto da caixa a todas as questões (rodízio quando há 2+ itens).
function aplicaTemaDoLote(texto){
  const dist = distribuiTemaDoLote(texto, state.questions.length);
  const lista = dist.itens.length > 1 ? listaCanonica(texto) : null;
  state.questions.forEach((q, i) => { q.tema = dist.temas[i]; q.temaLote = lista; });
  return dist;
}
// Chave de grupo para o planejamento: a lista do lote (quando houver) ou o tema.
function grupoDeTema(q){
  if(q && q.temaLote) return listaCanonica(q.temaLote).toLowerCase();
  return String((q && q.tema) || "").trim().toLowerCase();
}
// Lista do lote comum a TODAS as questões (ou null), na forma canônica.
function temaLoteComum(){
  if(!state.questions.length) return null;
  const listas = state.questions.map(q => q && q.temaLote ? listaCanonica(q.temaLote) : "");
  if(listas.some(l => !l)) return null;
  return listas.every(l => l.toLowerCase() === listas[0].toLowerCase()) ? listas[0] : null;
}
// Título da leva: a lista do lote (forma canônica), ou o tema comum, ou null.
function temaDaLevaParaTitulo(){
  return temaLoteComum() || temaComumDaLeva();
}
// "MDC → 1, 6 · MMC → 2, 7 · …" a partir do estado atual das questões.
function textoDistribuicaoLote(){
  const grupos = new Map();
  state.questions.forEach((q, i) => {
    const t = String(q && q.tema || "").trim();
    const chave = t.toLowerCase() || "(sem tema)";
    if(!grupos.has(chave)) grupos.set(chave, { rotulo: t || "(sem tema)", ns: [] });
    grupos.get(chave).ns.push(i + 1);
  });
  return Array.from(grupos.values()).map(g => `${resumoTema(g.rotulo, 60)} → ${g.ns.join(", ")}`).join(" · ");
}
// Linha "Distribuição atual" no painel do lote — só quando há lista aplicada.
function atualizaDistribuicaoLote(){
  const el = document.getElementById("loteDistribuicao");
  if(!el) return;
  const lista = temaLoteComum() || state.questions.some(q => q && q.temaLote);
  if(!lista){ el.textContent = ""; el.style.display = "none"; return; }
  el.style.display = "";
  el.textContent = `Distribuição atual (rodízio, na ordem digitada): ${textoDistribuicaoLote()}`;
}

/* O texto de "Tema do lote" só chega às questões quando o professor clica em
   "Aplicar às N questões": o que é enviado à IA é o tema guardado em CADA
   questão (state.questions[i].tema), não o da caixa. Na leva 1eb71207
   (14/09/2026) as 10 questões saíram com um assunto que o professor não
   reconhecia como pedido — o assunto estava no tema das 10 questões, e uma
   edição posterior da caixa do lote não muda as questões. Regra, na hora de
   gerar: se a caixa tem texto e TODAS as questões estão com o mesmo tema (ou
   todas sem tema), a caixa é a intenção mais recente e vale para todas; se as
   questões já foram ajustadas uma a uma (temas diferentes entre si), nada é
   alterado; e se a caixa ainda tem exatamente o texto do último "Aplicar", as
   questões é que mandam (podem ter vindo de um simulado reaberto). Devolve o
   que fez, para o aviso na tela. */
let loteTemaAplicado = null; // texto da caixa no último "Aplicar" desta sessão
function sincronizaTemaDoLote(){
  const caixa = document.getElementById("loteTema");
  const novo = ((caixa && caixa.value) || "").trim();
  if(!novo || !state.questions.length) return null;
  const n = state.questions.length;
  const baixa = t => String(t || "").trim().toLowerCase();
  const temas = state.questions.map(q => baixa(q && q.tema));
  if(loteTemaAplicado !== null && novo === loteTemaAplicado){
    // Caixa igual ao último "Aplicar": as questões mandam — salvo as que nasceram
    // vazias depois (quantidade aumentada): essas entram no rodízio já aplicado.
    const dist = distribuiTemaDoLote(novo, n);
    const vazias = temas.map((t, i) => t ? -1 : i).filter(i => i >= 0);
    const demaisBatem = temas.every((t, i) => !t || t === baixa(dist.temas[i]));
    if(vazias.length && vazias.length < n && demaisBatem){
      const irma = state.questions.find(q => q && q.temaLote);
      const lista = irma ? listaCanonica(irma.temaLote) : (dist.itens.length > 1 ? listaCanonica(novo) : null);
      vazias.forEach(i => { state.questions[i].tema = dist.temas[i]; state.questions[i].temaLote = lista; });
      renderQuestionBlocks();
      return { estado: "completado", novas: vazias.length, novo, itens: dist.itens.length };
    }
    return null;
  }
  const iguais = temas.every(t => t === temas[0]);
  // v18: as questões ainda refletem a última distribuição aplicada (ou estão
  // vazias, ex.: quantidade aumentada depois do "Aplicar")? Então a caixa
  // editada é a intenção mais recente e vale para todas.
  const aplicada = loteTemaAplicado ? distribuiTemaDoLote(loteTemaAplicado, n).temas.map(baixa) : null;
  const intocadas = temas.every((t, i) => !t || (aplicada && t === aplicada[i]));
  if(!iguais && !intocadas) return { estado: "individuais" };
  const nova = distribuiTemaDoLote(novo, n);
  if(temas.every((t, i) => t === baixa(nova.temas[i]))) return null;   // já está assim
  const anterior = iguais ? String(state.questions[0].tema || "").trim() : (loteTemaAplicado || "");
  aplicaTemaDoLote(novo);
  renderQuestionBlocks();
  loteTemaAplicado = novo;
  return { estado: anterior ? "atualizado" : "aplicado", anterior, novo, itens: nova.itens.length, sobras: nova.sobras };
}
function resumoTema(t, max){
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > (max || 100) ? s.slice(0, (max || 100) - 1) + "…" : s;
}

// Tema comum a TODAS as questões da leva (ou null): dá nome ao simulado.
function temaComumDaLeva(){
  if(!state.questions.length) return null;
  const temas = state.questions.map(q => String(q && q.tema || "").trim());
  if(temas.some(t => !t)) return null;
  const chave = temas[0].toLowerCase();
  return temas.every(t => t.toLowerCase() === chave) ? temas[0] : null;
}

function syncQuestionsArrayLength(){
  while(state.questions.length < state.qty){
    state.questions.push({
      id: uid(), tema: "", dificuldade: "Médio", recurso: "nenhum",
      competenciaNum: null, habilidadeCod: null, instrucoesVisual: "", orientacoes: "",
      status: "idle", errorMsg: "", data: null, approved: false,
    });
  }
  while(state.questions.length > state.qty){ state.questions.pop(); }
}

/* ---------------- Matrix helpers ---------------- */
function getAreaMatriz(){
  if(!state.area) return null;
  return APP_DATA.matriz[state.area];
}
function findHabilidade(codigo){
  const m = getAreaMatriz(); if(!m) return null;
  for(const c of m.competencias){ const h = c.habilidades.find(h => h.codigo === codigo); if(h) return {competencia: c, habilidade: h}; }
  return null;
}

function populateCompetenciaSelect(sel, current){
  const m = getAreaMatriz();
  sel.innerHTML = "";
  const optAuto = document.createElement("option");
  optAuto.value = ""; optAuto.textContent = "Selecionar automaticamente (recomendado)";
  sel.appendChild(optAuto);
  if(!m) return;
  m.competencias.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.numero;
    opt.textContent = `Competência ${c.numero} — ${truncate(c.texto, 70)}`;
    if(current === c.numero) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateHabilidadeSelect(sel, competenciaNum, current){
  const m = getAreaMatriz();
  sel.innerHTML = "";
  const optAuto = document.createElement("option");
  optAuto.value = ""; optAuto.textContent = "Selecionar automaticamente (recomendado)";
  sel.appendChild(optAuto);
  if(!m) return;
  const comps = competenciaNum ? m.competencias.filter(c => c.numero === competenciaNum) : m.competencias;
  comps.forEach(c => {
    const grp = document.createElement("optgroup");
    grp.label = `Competência ${c.numero}`;
    c.habilidades.forEach(h => {
      const opt = document.createElement("option");
      opt.value = h.codigo;
      opt.textContent = `${h.codigo} — ${truncate(h.texto, 65)}`;
      if(current === h.codigo) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
}

function truncate(s, n){ return s.length > n ? s.slice(0, n - 1) + "…" : s; }

/* ---------------- Question config blocks (form) ---------------- */
function renderQuestionBlocks(){
  const wrap = document.getElementById("questionBlocks");
  wrap.innerHTML = "";
  if(!state.area){ wrap.innerHTML = `<p class="hint">Selecione a área do conhecimento para configurar as questões.</p>`; return; }
  syncQuestionsArrayLength();
  state.questions.forEach((q, idx) => wrap.appendChild(buildQuestionBlock(q, idx)));
  atualizaDistribuicaoLote();
}

function buildQuestionBlock(q, idx){
  const el = document.createElement("div");
  el.className = "qblock";
  el.innerHTML = `
    <div class="qb-head">
      <div class="qb-num"><span class="dot">${idx+1}</span> Questão ${idx+1}</div>
    </div>
    <label class="field-label">Tema / conteúdo desta questão</label>
    <textarea class="in-tema" placeholder="Ex.: sistema circulatório — regulação da pressão arterial durante o exercício">${escapeHtml(q.tema || "")}</textarea>
    ${q.temaLote ? `<div class="hint lote-origem" style="margin-top:4px;">Conteúdo distribuído do lote em rodízio — pode ser trocado aqui.</div>` : ""}
    <div class="qgrid" style="margin-top:12px;">
      <div>
        <label class="field-label">Nível de dificuldade</label>
        <div class="diff-row">
          ${["Fácil","Médio","Difícil"].map(d => `<div class="diff-opt${q.dificuldade===d?" sel":""}" data-d="${d}">${d}</div>`).join("")}
        </div>
      </div>
      <div>
        <label class="field-label">Recurso visual</label>
        <div class="resource-row">
          ${resOpt("nenhum","🚫","Sem recurso",q.recurso)}
          ${resOpt("imagem","🖼️","Imagem",q.recurso)}
          ${resOpt("grafico","📊","Gráfico",q.recurso)}
          ${resOpt("tabela","📋","Tabela",q.recurso)}
        </div>
      </div>
    </div>
    <div class="visual-instr-block" style="margin-top:12px;${q.recurso==="nenhum"?"display:none;":""}">
      <label class="field-label">Instruções opcionais para a criação d${q.recurso==="imagem"?"a imagem":q.recurso==="tabela"?"a tabela":"o gráfico"}</label>
      <textarea class="in-instr-visual" placeholder="Ex.: mostre o coração em corte transversal, com as quatro câmaras nomeadas; use um gráfico de linha em vez de barras; destaque a coluna de 2020...">${escapeHtml(q.instrucoesVisual||"")}</textarea>
    </div>
    <div style="margin-top:12px;">
      <label class="field-label">Orientações adicionais para esta questão <span class="hint" style="font-weight:400;">(opcional)</span></label>
      <textarea class="in-orientacoes" placeholder="Ex.: Contextualize com uma situação do cotidiano&#10;Dê preferência a uma aplicação ambiental">${escapeHtml(q.orientacoes||"")}</textarea>
      <p class="hint" style="margin:4px 0 0;">${ORIENT_AVISO}</p>
    </div>
    <div class="qgrid2">
      <div>
        <label class="field-label">Competência de área (opcional)</label>
        <select class="in-competencia"></select>
      </div>
      <div>
        <label class="field-label">Habilidade (opcional)</label>
        <select class="in-habilidade"></select>
      </div>
    </div>
  `;

  function resOpt(val, icon, label, current){
    return `<div class="res-opt${current===val?" sel":""}" data-r="${val}"><span class="ic">${icon}</span>${label}</div>`;
  }

  const instrBlock = el.querySelector(".visual-instr-block");
  const instrLabel = instrBlock.querySelector(".field-label");

  el.querySelector(".in-tema").addEventListener("input", e => { q.tema = e.target.value; atualizaDistribuicaoLote(); });
  el.querySelector(".in-instr-visual").addEventListener("input", e => { q.instrucoesVisual = e.target.value; });
  // v18.7: orientação POR QUESTÃO — o "Aplicar" do lote sobrescreve todas (como o tema),
  // e aqui o professor ajusta uma a uma. Mesmo teto de 600 do painel do lote.
  el.querySelector(".in-orientacoes").addEventListener("input", e => { q.orientacoes = (e.target.value || "").slice(0, 600); });
  el.querySelectorAll(".diff-opt").forEach(d => d.addEventListener("click", () => {
    q.dificuldade = d.dataset.d;
    el.querySelectorAll(".diff-opt").forEach(x => x.classList.toggle("sel", x === d));
    // Blocos → contadores: o painel de lote mostra sempre a contagem real.
    sincronizaContadoresLote();
  }));
  el.querySelectorAll(".res-opt").forEach(r => r.addEventListener("click", () => {
    q.recurso = r.dataset.r;
    el.querySelectorAll(".res-opt").forEach(x => x.classList.toggle("sel", x === r));
    instrBlock.style.display = q.recurso === "nenhum" ? "none" : "";
    instrLabel.textContent = `Instruções opcionais para a criação d${q.recurso==="imagem"?"a imagem":q.recurso==="tabela"?"a tabela":"o gráfico"}`;
  }));

  const compSel = el.querySelector(".in-competencia");
  const habSel = el.querySelector(".in-habilidade");
  populateCompetenciaSelect(compSel, q.competenciaNum);
  populateHabilidadeSelect(habSel, q.competenciaNum, q.habilidadeCod);
  compSel.addEventListener("change", () => {
    q.competenciaNum = compSel.value ? parseInt(compSel.value) : null;
    q.habilidadeCod = null;
    populateHabilidadeSelect(habSel, q.competenciaNum, null);
  });
  habSel.addEventListener("change", () => {
    q.habilidadeCod = habSel.value || null;
    if(q.habilidadeCod && !q.competenciaNum){
      const found = findHabilidade(q.habilidadeCod);
      if(found){ q.competenciaNum = found.competencia.numero; populateCompetenciaSelect(compSel, q.competenciaNum); }
    }
  });

  return el;
}

/* ---------------- Generation orchestration ---------------- */
// A geração roda inteiramente no backend (Supabase Edge Function "generate-question"):
// o navegador só envia os parâmetros da questão (área, disciplina, tema, dificuldade,
// recurso, competência/habilidade) e recebe a questão pronta. A chamada à API da
// Anthropic e a chave usada para isso ficam só no servidor — nunca no navegador.
/* ================= DISTRIBUIÇÃO DO GABARITO ==================================
   Regra do professor: os gabaritos nunca podem ser sequencialmente os mesmos.
   Dentro de cada bloco de CINCO questões consecutivas, as cinco letras aparecem
   uma única vez — logo, com 2, 3, 4 ou 5 questões todos os gabaritos saem
   diferentes, que é exatamente o caso pedido.

   Nota matemática, para quem for mexer nisto: exigir que TODA janela de cinco
   questões consecutivas tenha as cinco letras distintas obriga a sequência a ser
   periódica. Se as posições i..i+4 são uma permutação e i+1..i+5 também, então
   s[i+5] = s[i] — a mesma permutação se repetindo do começo ao fim, um padrão
   ainda mais fácil de decorar do que o problema original. Por isso a regra vale
   por BLOCO de cinco, com duas garantias extras: a primeira letra de um bloco
   nunca repete a última do bloco anterior (nunca há duas iguais seguidas) e cada
   bloco usa uma permutação diferente da anterior (não há período). O resultado
   distribui as cinco letras por igual e não deixa padrão explorável.          */
const GABARITO_LETRAS = ["A", "B", "C", "D", "E"];

function embaralhaLetras(){
  const a = GABARITO_LETRAS.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function planejaGabaritos(n){
  const plano = [];
  let ultimaLetra = null;
  let blocoAnterior = "";
  while(plano.length < n){
    let bloco = embaralhaLetras();
    for(let t = 0; t < 40; t++){
      const ok = (!ultimaLetra || bloco[0] !== ultimaLetra) && bloco.join("") !== blocoAnterior;
      if(ok) break;
      bloco = embaralhaLetras();
    }
    blocoAnterior = bloco.join("");
    ultimaLetra = bloco[bloco.length - 1];
    plano.push.apply(plano, bloco);
  }
  return plano.slice(0, n);
}

// Garante que o plano existe e cobre o índice pedido (regeneração avulsa também).
/* ---------------- Diversidade temática da leva ----------------

   Objetos de conhecimento oficiais (Anexo da Matriz de Referência) que cabem
   a cada disciplina. Em Ciências da Natureza o Anexo lista Física, Química e
   Biologia em sequência; em Linguagens, cada disciplina cobre um recorte; em
   Humanas e Matemática todos os objetos valem para todas as disciplinas. */
const OBJETOS_POR_DISCIPLINA = {
  "Física": ["Conhecimentos básicos e fundamentais", "O movimento, o equilíbrio e a descoberta de leis físicas", "Energia, trabalho e potência", "A Mecânica e o funcionamento do Universo", "Fenômenos Elétricos e Magnéticos", "Oscilações, ondas, óptica e radiação", "O calor e os fenômenos térmicos"],
  "Química": ["Transformações Químicas", "Representação das transformações químicas", "Materiais, suas propriedades e usos", "Água", "Transformações Químicas e Energia", "Dinâmica das Transformações Químicas", "Transformação Química e Equilíbrio", "Compostos de Carbono", "Relações da Química com as Tecnologias, a Sociedade e o Meio Ambiente", "Energias Químicas no Cotidiano"],
  "Biologia": ["Moléculas, células e tecidos", "Hereditariedade e diversidade da vida", "Identidade dos seres vivos", "Ecologia e ciências ambientais", "Origem e evolução da vida", "Qualidade de vida das populações humanas"],
  "Língua Portuguesa": ["Estudo do texto", "Estudo dos aspectos linguísticos em diferentes textos", "Estudo do texto argumentativo, seus gêneros e recursos linguísticos", "Estudo dos aspectos linguísticos da língua portuguesa", "Estudo dos gêneros digitais"],
  "Literatura": ["Estudo do texto literário", "Produção e recepção de textos artísticos"],
  "Artes": ["Produção e recepção de textos artísticos"],
  "Educação Física": ["Estudo das práticas corporais"],
  "Língua Estrangeira (Inglês/Espanhol)": ["Estudo do texto", "Estudo dos aspectos linguísticos em diferentes textos"],
};

// Objetos de conhecimento válidos para (área, disciplina): a lista da
// disciplina filtrada pelo Anexo oficial carregado (APP_DATA), ou — quando a
// disciplina não tem recorte próprio (Humanas, Matemática) — todos da área.
function objetosDaDisciplina(area, disciplina){
  const oficiais = (APP_DATA.objetosConhecimento && APP_DATA.objetosConhecimento[area]) || [];
  const proprios = OBJETOS_POR_DISCIPLINA[disciplina];
  if(Array.isArray(proprios)){
    const ok = proprios.filter(o => oficiais.includes(o));
    if(ok.length) return ok;
  }
  return oficiais.slice();
}

function embaralha(lista){
  const a = lista.slice();
  for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/* ---------------- v17 — Diversidade de exemplos, sem custo (14/09/2026) ----------------

   Leva real 538678f0 (20 de Matemática, sem tema digitado): questões 2 e 7
   quase iguais ("fábrica de componentes eletrônicos", linhas A e B, 60%/40%),
   3 e 4 a mesma depreciação em PG, "transportadora" em 8, 13 e 15,
   "cooperativa agrícola" em 3, 11 e 18, marcenaria e velas em 14 e 19. Sem
   tema, só o eixo (objeto de conhecimento) era reservado; dentro do eixo nada
   distribuía o conteúdo, e nenhum mecanismo cuidava do CENÁRIO. A lista de
   "assuntos já usados" só via questões já entregues — as 5 da mesma onda
   paralela não se enxergam.

   Pedido do professor: nenhum exemplo/contexto repetido na leva, SEM custo a
   mais por questão. Então tudo é decidido aqui, de forma determinística, ANTES
   da leva (como o gabarito e os eixos), sem chamada nova à IA, sem campo novo
   na resposta e com o prompt da leva MENOR que antes (a lista de assuntos já
   usados passa a levar só o que pode colidir; medido em
   tests/medir_prompt_diversidade.ts):
   1) SUBTÓPICO OFICIAL — dentro do eixo, cada questão recebe um item do texto
      do Anexo da Matriz (ex.: "porcentagem e juros", "sequências e
      progressões"), em rodízio embaralhado. Fecha "duas de probabilidade
      condicional" e "duas de desvio padrão".
   2) DOMÍNIO DE CONTEXTO — catálogo curado de cenários do ENEM; cada questão
      da leva recebe um domínio principal e um alternativo, exclusivos dela.
      Os domínios das outras vão como proibidos. Fecha a cegueira da onda.
   3) AUDITORIA por palavras-chave (sem IA) do texto-base contra o catálogo:
      duas questões no mesmo domínio geram alerta e o botão "Outro contexto",
      que só gasta se o professor clicar. Nenhuma regeneração automática. */

// Subtópicos oficiais por objeto de conhecimento (texto do Anexo da Matriz de
// Referência, dividido nos itens que o próprio Anexo separa). Linguagens fica
// só com o eixo por disciplina: seus objetos são modos de ler textos reais.
const SUBTOPICOS_OFICIAIS = {
  // Matemática
  "Conhecimentos numéricos": ["operações em conjuntos numéricos (naturais, inteiros, racionais e reais)", "desigualdades", "divisibilidade", "fatoração", "razões e proporções", "porcentagem e juros", "relações de dependência entre grandezas", "sequências e progressões", "princípios de contagem"],
  "Conhecimentos geométricos": ["características das figuras geométricas planas e espaciais", "grandezas, unidades de medida e escalas", "comprimentos, áreas e volumes", "ângulos", "posições de retas", "simetrias de figuras planas ou espaciais", "congruência e semelhança de triângulos", "teorema de Tales", "relações métricas nos triângulos", "circunferências", "trigonometria do ângulo agudo"],
  "Conhecimentos de estatística e probabilidade": ["representação e análise de dados", "medidas de tendência central (médias, moda e mediana)", "desvios e variância", "noções de probabilidade"],
  "Conhecimentos algébricos": ["gráficos e funções", "funções algébricas do 1.º e do 2.º graus", "funções polinomiais e racionais", "funções exponenciais e logarítmicas", "equações e inequações", "relações no ciclo trigonométrico e funções trigonométricas"],
  "Conhecimentos algébricos/geométricos": ["plano cartesiano", "retas", "circunferências", "paralelismo e perpendicularidade", "sistemas de equações"],
  // Física
  "Conhecimentos básicos e fundamentais": ["noções de ordem de grandeza e notação científica", "Sistema Internacional de Unidades", "observações e mensurações: representação de grandezas físicas mensuráveis", "ferramentas básicas: gráficos e vetores", "grandezas vetoriais e escalares; operações básicas com vetores"],
  "O movimento, o equilíbrio e a descoberta de leis físicas": ["grandezas fundamentais da mecânica: tempo, espaço, velocidade e aceleração", "descrição matemática e gráfica do movimento; casos especiais de movimentos", "inércia, sistemas de referência, massa e quantidade de movimento", "leis de Newton e diagramas de forças (atrito, peso, normal e tração)", "conservação da quantidade de movimento e teorema do impulso", "momento de uma força (torque) e equilíbrio estático", "forças nos movimentos circulares e força centrípeta", "hidrostática: empuxo e princípios de Pascal, Arquimedes e Stevin"],
  "Energia, trabalho e potência": ["conceituação de trabalho, energia e potência", "energia potencial e energia cinética", "conservação da energia mecânica e dissipação de energia", "trabalho da força gravitacional e energia potencial gravitacional", "forças conservativas e dissipativas"],
  "A Mecânica e o funcionamento do Universo": ["força peso e aceleração gravitacional", "lei da Gravitação Universal", "leis de Kepler e movimentos de corpos celestes", "influência na Terra: marés e variações climáticas", "concepções históricas sobre a origem do universo e sua evolução"],
  "Fenômenos Elétricos e Magnéticos": ["carga elétrica, corrente elétrica e lei de Coulomb", "campo elétrico, potencial elétrico, linhas de campo, superfícies equipotenciais e blindagem", "capacitores", "lei de Ohm, resistência elétrica, resistividade e efeito Joule", "tensão, corrente, potência e energia; consumo de energia em dispositivos elétricos", "circuitos elétricos simples, correntes contínua e alternada, medidores elétricos", "campo magnético, ímãs permanentes e campo magnético terrestre"],
  "Oscilações, ondas, óptica e radiação": ["feixes e frentes de ondas; reflexão e refração", "óptica geométrica: lentes e espelhos; formação de imagens", "instrumentos ópticos simples", "fenômenos ondulatórios: pulsos e ondas; período, frequência e ciclo", "propagação: velocidade, frequência e comprimento de onda; ondas em diferentes meios"],
  "O calor e os fenômenos térmicos": ["conceitos de calor e temperatura; escalas termométricas", "transferência de calor, equilíbrio térmico e condução", "capacidade calorífica e calor específico", "dilatação térmica", "mudanças de estado físico e calor latente", "comportamento de gases ideais", "máquinas térmicas, ciclo de Carnot e leis da Termodinâmica", "fenômenos térmicos do cotidiano e fenômenos climáticos ligados ao ciclo da água"],
  // Química
  "Transformações Químicas": ["evidências e interpretação de transformações químicas", "sistemas gasosos: leis dos gases, equação geral dos gases ideais, princípio de Avogadro, massa e volume molar", "teoria cinética dos gases e misturas gasosas", "modelos atômicos: Dalton, Thomson, Rutherford e Rutherford-Bohr", "número atômico, número de massa, isótopos e massa atômica", "elementos químicos e Tabela Periódica", "reações químicas"],
  "Representação das transformações químicas": ["fórmulas químicas", "balanceamento de equações químicas", "leis ponderais das reações químicas", "determinação de fórmulas químicas", "grandezas químicas: massa, volume, mol, massa molar e constante de Avogadro", "cálculos estequiométricos"],
  "Materiais, suas propriedades e usos": ["propriedades e estados físicos dos materiais; mudanças de estado", "misturas: tipos e métodos de separação", "metais e ligas metálicas (ferro, cobre e alumínio); ligação metálica", "substâncias iônicas (cloreto, carbonato, nitrato e sulfato) e ligação iônica", "substâncias moleculares e ligação covalente", "polaridade de moléculas e forças intermoleculares", "relação entre estrutura, propriedade e aplicação das substâncias"],
  "Água": ["ocorrência e importância da água; ligação, estrutura e propriedades", "soluções verdadeiras, coloidais e suspensões; solubilidade", "concentração das soluções", "aspectos qualitativos das propriedades coligativas", "ácidos, bases, sais e óxidos: definição, classificação, formulação e nomenclatura", "propriedades de ácidos e bases: indicadores, condutibilidade elétrica, reação com metais e neutralização"],
  "Transformações Químicas e Energia": ["calor de reação, entalpia e equações termoquímicas", "lei de Hess", "reações de oxirredução e potenciais padrão de redução", "pilhas", "eletrólise e leis de Faraday", "radioatividade: desintegração radioativa e radioisótopos", "reações de fissão e fusão nuclear"],
  "Dinâmica das Transformações Químicas": ["velocidade de reação", "energia de ativação", "fatores que alteram a velocidade: concentração, pressão e temperatura", "catalisadores"],
  "Transformação Química e Equilíbrio": ["caracterização do sistema em equilíbrio e constante de equilíbrio", "produto iônico da água, equilíbrio ácido-base e pH", "solubilidade dos sais e hidrólise", "fatores que alteram o sistema em equilíbrio", "aplicação da velocidade e do equilíbrio químico no cotidiano"],
  "Compostos de Carbono": ["características gerais dos compostos orgânicos e principais funções orgânicas", "estrutura e propriedades de hidrocarbonetos", "compostos orgânicos oxigenados; fermentação", "compostos orgânicos nitrogenados", "macromoléculas e polímeros naturais e sintéticos (amido, celulose, borracha, polietileno, PVC, náilon)", "óleos e gorduras, sabões e detergentes sintéticos", "proteínas e enzimas"],
  "Relações da Química com as Tecnologias, a Sociedade e o Meio Ambiente": ["química na agricultura e na saúde", "química nos alimentos", "indústria química: obtenção e uso de cloro, hidróxido de sódio, ácido sulfúrico, amônia e ácido nítrico", "mineração e metalurgia", "poluição e tratamento de água", "poluição atmosférica", "contaminação e proteção do ambiente"],
  "Energias Químicas no Cotidiano": ["petróleo, gás natural e carvão", "madeira, hulha e biomassa", "biocombustíveis", "impactos ambientais de combustíveis fósseis", "energia nuclear, lixo atômico e suas vantagens e desvantagens"],
  // Biologia
  "Moléculas, células e tecidos": ["estrutura e fisiologia celular: membrana, citoplasma e núcleo", "divisão celular", "metabolismo energético: fotossíntese e respiração", "codificação da informação genética e síntese proteica", "diferenciação celular e principais tecidos animais e vegetais", "células-tronco, clonagem e tecnologia do DNA recombinante", "aplicações de biotecnologia: alimentos, fármacos, paternidade, investigação criminal e identificação", "aspectos éticos do desenvolvimento biotecnológico; biotecnologia e sustentabilidade"],
  "Hereditariedade e diversidade da vida": ["princípios básicos da transmissão de características hereditárias", "concepções pré-mendelianas sobre a hereditariedade", "aspectos genéticos do funcionamento do corpo humano; antígenos e anticorpos", "grupos sanguíneos, transplantes e doenças autoimunes", "neoplasias e a influência de fatores ambientais", "mutações gênicas e cromossômicas; aconselhamento genético", "fundamentos genéticos da evolução e da diversidade biológica"],
  "Identidade dos seres vivos": ["níveis de organização dos seres vivos", "vírus, procariontes e eucariontes; autótrofos e heterótrofos", "sistemática e as grandes linhas da evolução dos seres vivos", "tipos de ciclo de vida", "padrões anatômicos e fisiológicos e adaptação a diferentes ambientes", "embriologia, anatomia e fisiologia humana", "evolução humana"],
  "Ecologia e ciências ambientais": ["ecossistemas, fatores bióticos e abióticos, habitat e nicho ecológico", "comunidade biológica: teia alimentar, sucessão e comunidade clímax", "dinâmica de populações e interações entre os seres vivos", "ciclos biogeoquímicos e fluxo de energia no ecossistema", "biogeografia e biomas brasileiros", "exploração e uso de recursos naturais", "problemas ambientais: mudanças climáticas, efeito estufa, desmatamento, erosão e poluição", "conservação e recuperação de ecossistemas; conservação da biodiversidade", "tecnologias ambientais, saneamento básico e legislação ambiental"],
  "Origem e evolução da vida": ["a biologia como ciência: história, métodos, técnicas e experimentação", "hipóteses sobre a origem do Universo, da Terra e dos seres vivos", "explicações pré-darwinistas para a modificação das espécies", "a teoria evolutiva de Charles Darwin", "teoria sintética da evolução", "seleção artificial e seu impacto sobre ambientes naturais e populações humanas"],
  "Qualidade de vida das populações humanas": ["aspectos biológicos da pobreza e do desenvolvimento humano; indicadores sociais, ambientais e econômicos", "principais doenças que afetam a população brasileira: caracterização, prevenção e profilaxia", "noções de primeiros socorros", "doenças sexualmente transmissíveis", "uso indevido de drogas, gravidez na adolescência e obesidade", "violência e segurança pública", "exercícios físicos e vida saudável", "aspectos biológicos do desenvolvimento sustentável; legislação e cidadania"],
  // Ciências Humanas
  "Diversidade cultural, conflitos e vida em sociedade": ["cultura material e imaterial; patrimônio e diversidade cultural no Brasil", "a Conquista da América; conflitos entre europeus e indígenas na América colonial", "a escravidão e as formas de resistência indígena e africana na América", "história cultural dos povos africanos; a luta dos negros no Brasil e o negro na formação da sociedade brasileira", "história dos povos indígenas e a formação sociocultural brasileira", "movimentos culturais no mundo ocidental e seus impactos na vida política e social"],
  "Formas de organização social, movimentos sociais, pensamento político e ação do Estado": ["cidadania e democracia na Antiguidade; Estado e direitos do cidadão a partir da Idade Moderna; democracia direta, indireta e representativa", "revoluções sociais e políticas na Europa Moderna", "formação territorial brasileira; as regiões brasileiras; políticas de reordenamento territorial", "as lutas pela independência política das colônias da América", "grupos sociais em conflito no Brasil imperial e a construção da nação", "o pensamento liberal na sociedade capitalista e seus críticos nos séculos XIX e XX", "políticas de colonização, migração, imigração e emigração no Brasil nos séculos XIX e XX", "os grandes processos revolucionários do século XX: Revolução Bolchevique, Chinesa e Cubana", "geopolítica e conflitos entre os séculos XIX e XX: Imperialismo, Guerras Mundiais e Guerra Fria", "sistemas totalitários na Europa do século XX e ditaduras na América Latina (Estado Novo)", "conflitos político-culturais pós-Guerra Fria e organismos multilaterais", "a luta pela conquista de direitos: direitos civis, humanos, políticos e sociais; políticas afirmativas", "vida urbana: redes e hierarquia nas cidades, pobreza e segregação espacial"],
  "Características e transformações das estruturas produtivas": ["formas de organização da produção: escravismo antigo, feudalismo, capitalismo e socialismo", "economia agroexportadora brasileira: açúcar, mineração colonial, café e borracha", "Revolução Industrial, sistema de fábrica e formação do espaço urbano-industrial", "transformações na estrutura produtiva no século XX: fordismo, toyotismo e novas técnicas de produção", "a industrialização brasileira, a urbanização e as transformações sociais e trabalhistas", "a globalização e as novas tecnologias de telecomunicação e suas consequências", "espaços agrários: modernização da agricultura, agronegócio, agricultura familiar e lutas no campo; relação campo-cidade"],
  "Os domínios naturais e a relação do ser humano com o ambiente": ["relação homem-natureza e apropriação dos recursos naturais ao longo do tempo; impacto ambiental das atividades econômicas no Brasil", "recursos minerais e energéticos: exploração e impactos", "recursos hídricos; bacias hidrográficas e seus aproveitamentos", "questões ambientais contemporâneas: mudança climática, ilhas de calor, efeito estufa, chuva ácida e camada de ozônio", "a nova ordem ambiental internacional; unidades de conservação, corredores ecológicos e zoneamento ecológico-econômico", "origem e evolução do conceito de sustentabilidade", "estrutura interna da Terra; solo e relevo; agentes internos e externos modeladores do relevo", "atmosfera e classificação climática; características climáticas do território brasileiro", "os grandes domínios da vegetação no Brasil e no mundo"],
  "Representação espacial": ["projeções cartográficas", "leitura de mapas temáticos, físicos e políticos", "tecnologias modernas aplicadas à cartografia"],
};

/* Catálogo de domínios de contexto (cenários de situação-problema frequentes
   nas provas reais do ENEM). "n" é o nome que vai ao prompt; "k" são radicais
   de palavras-chave (sem acento, minúsculas) usados só pela auditoria local
   para reconhecer o cenário no texto-base — específicos de propósito (nada de
   "empresa", "loja", "cidade"), para não acusar semelhança falsa. */
const DOMINIOS_CONTEXTO = [
  { n: "transporte e logística de cargas", k: ["transportadora", "frete", "caminhao", "caminhoes", "armazem", "centro de distribuicao", "empresa de logistica"] },
  { n: "agricultura familiar e cooperativas rurais", k: ["cooperativa agricola", "cooperativa de agricultores", "agricultor", "lavoura", "plantio", "colheita", "trator", "safra", "fazenda"] },
  { n: "marcenaria e fabricação de móveis", k: ["marcenar", "marceneir", "carpint", "loja de moveis", "fabrica de moveis", "serraria"] },
  { n: "indústria de componentes eletrônicos", k: ["componente eletronic", "componentes eletronic", "fabrica de resistores", "placa de circuito", "linha de montagem"] },
  { n: "arquitetura de interiores e revestimentos", k: ["arquitetura de interiores", "ladrilh", "azulej", "piso decorativo", "pisos decorativos", "pisos de salas", "revestir pisos"] },
  { n: "saúde pública e vacinação", k: ["vacina", "posto de saude", "campanha de vacinacao", "epidemi", "agente de saude", "vigilancia sanitaria"] },
  { n: "hospital e exames médicos", k: ["hospital", "paciente", "exame medico", "medicina nuclear", "radiofarmac", "clinica medica"] },
  { n: "laboratório de microbiologia", k: ["microbiolog", "colonia de bacterias", "cultura de bacterias", "populacao de bacterias", "numero de bacterias", "cultura de celulas", "placa de petri"] },
  { n: "atletismo e treinos esportivos", k: ["atleta", "atletismo", "velocista", "maratona", "tecnico de atletismo", "prova de 100", "corrida de rua"] },
  { n: "futebol e estádios", k: ["futebol", "estadio de futebol", "estadios de futebol", "torcida", "campeonato de futebol", "jogadores de"] },
  { n: "música, bandas e shows", k: ["musica", "banda de musica", "instrumento musical", "violao", "show musical", "festival de musica"] },
  { n: "cinema e plataformas de streaming", k: ["cinema", "filme", "streaming", "sala de cinema", "serie de tv"] },
  { n: "comércio varejista e promoções", k: ["liquidacao", "promocao.", "promocoes", "desconto de", "varejo", "loja de eletro", "vendedor"] },
  { n: "consumo de energia elétrica residencial", k: ["conta de luz", "kwh", "consumo de energia", "tarifa de energia", "chuveiro eletrico", "conta de energia"] },
  { n: "energia solar fotovoltaica", k: ["painel solar", "paineis solares", "energia solar", "fotovoltaic", "placa solar"] },
  { n: "reciclagem e gestão de resíduos", k: ["reciclag", "residuos solidos", "coleta seletiva", "aterro sanitario", "lixo"] },
  { n: "clima e meteorologia", k: ["meteorolog", "precipitacao", "previsao do tempo", "estacao meteorologica", "pluviometr"] },
  { n: "astronomia e exploração espacial", k: ["telescopio", "astronom", "satelite artificial", "estacao espacial", "sonda espacial", "foguete"] },
  { n: "culinária e alimentação", k: ["receita culinaria", "cozinheir", "restaurante", "padaria", "confeitar"] },
  { n: "indústria têxtil e confecção", k: ["costur", "confeccao", "textil", "malharia", "alfaiat", "tecido de algodao"] },
  { n: "turismo e hotelaria", k: ["turista", "hotel", "pousada", "turismo", "hospede"] },
  { n: "museus e patrimônio cultural", k: ["museu", "patrimonio historico", "acervo do museu", "obra de arte"] },
  { n: "construção civil", k: ["pedreiro", "construcao civil", "concreto armado", "laje", "tijolo", "cimento", "canteiro de obras"] },
  { n: "finanças pessoais e crédito", k: ["orcamento familiar", "poupanca", "financiamento", "emprestimo", "amortizacao", "juros", "prestacao", "prestacoes"] },
  { n: "telecomunicações e internet", k: ["operadora de telefonia", "plano de dados", "telefonia", "banda larga", "wi-fi", "provedor de internet"] },
  { n: "pesquisas de opinião e eleições", k: ["eleicao", "eleitor", "pesquisa de opiniao", "urna", "votos"] },
  { n: "demografia e censo", k: ["ibge", "censo", "demograf", "taxa de natalidade", "piramide etaria", "crescimento populacional", "populacao de uma cidade", "populacao do municipio"] },
  { n: "mineração e metalurgia", k: ["mineracao", "minerio", "mina de", "metalurg", "siderurg"] },
  { n: "pesca e aquicultura", k: ["pesca", "pescador", "aquicultura", "tanque de peixes", "piscicultura"] },
  { n: "jogos de tabuleiro e sorteios", k: ["jogo de tabuleiro", "dois dados", "dado de seis faces", "baralho", "sorteio", "roleta", "loteria"] },
  { n: "trânsito e segurança viária", k: ["transito", "radar", "semaforo", "rodovia", "motorista", "limite de velocidade"] },
  { n: "escola e vida estudantil", k: ["escolar", "escola tecnica", "colegio", "alunos", "turma", "sala de aula"] },
  { n: "saneamento e abastecimento de água", k: ["saneamento", "caixa d'agua", "caixas d'agua", "reservatorio", "abastecimento de agua", "rede de esgoto", "esgoto.", "estacao de tratamento"] },
  { n: "aviação e aeroportos", k: ["aviao", "avioes", "aeroporto", "aeronave", "companhia aerea", "voo comercial"] },
  { n: "ferrovias e metrô", k: ["trem", "trens", "ferrovia", "vagao", "vagoes", "estacao de metro", "linha de metro", "trilhos da"] },
  { n: "farmácia e medicamentos", k: ["farmacia", "medicamento", "remedio", "comprimidos", "bula", "dosagem"] },
  { n: "cartografia e mapas", k: ["mapa rodoviario", "cartograf", "gps", "coordenadas geograficas", "atlas", "escala do mapa"] },
  { n: "fotografia e impressão", k: ["fotograf", "camera fotografica", "impressora", "grafica rapida", "pixel"], kp: ["impresso", "impressa"] },   // v18.2: "fotograf" pega fotógrafo/fotográfica; kp só para o contexto do planejador (teste real de 15/09)
  { n: "teatro e dança", k: ["teatro", "peca teatral", "danca", "palco", "espetaculo", "coreografia"] },
  { n: "livros, editoras e bibliotecas", k: ["biblioteca", "livraria", "tiragem", "feira do livro", "exemplares do livro"] },
  { n: "petróleo e combustíveis", k: ["petroleo", "gasolina", "etanol", "posto de combustivel", "refinaria", "postos de gasolina"] },
  { n: "informática e centros de dados", k: ["computador", "software", "centro de dados", "programador", "servidores de"] },
  { n: "redes sociais e aplicativos", k: ["rede social", "redes sociais", "aplicativo de", "seguidores", "postagem", "curtidas"] },
  { n: "trabalho e previdência", k: ["trabalhador", "aposentadoria", "inss", "previdencia", "jornada de trabalho", "carteira de trabalho", "folha de pagamento", "reajuste salarial"] },
  { n: "feiras livres e artesanato", k: ["feira livre", "feirante", "artesa", "artesanato", "barraca", "velas aromaticas"] },
  { n: "mecânica automotiva", k: ["oficina mecanica", "pneu", "pecas automotivas", "automovel", "mecanico de"] },
  { n: "academia e exercícios físicos", k: ["academia", "musculacao", "exercicio fisico", "esteira ergometrica"] },
  { n: "ciclismo e bicicletas", k: ["bicicleta", "ciclist", "ciclovia", "pedal"] },
  { n: "correios e encomendas", k: ["correios", "agencia dos correios", "carteiro", "encomendas postais"] },
  { n: "parques e praças públicas", k: ["parque municipal", "praca", "quadra poliesportiva", "playground", "parque da cidade"] },
  { n: "zoológicos e aquários", k: ["zoologico", "aquario", "tratador"] },
  { n: "supermercado e rotulagem de produtos", k: ["supermercado", "rotulo", "rotulagem", "gondola", "rede de supermercados"] },
  { n: "rádio e televisão", k: ["emissora", "estacao de radio", "televisao", "audiencia", "programa de tv"] },
  { n: "festas e eventos", k: ["festa", "festa de casamento", "aniversario", "buffet", "convidados"] },
  { n: "cerâmica e olaria", k: ["ceramica", "olaria", "argila", "oleiro", "vasos de ceramica"] },
  { n: "indústria de sucos e bebidas", k: ["fabrica de sucos", "fabrica de bebidas", "engarraf", "refrigerante"] },
  { n: "apicultura e produção de mel", k: ["abelha", "colmeia", "apicult", "mel"] },
  { n: "pecuária e laticínios", k: ["gado", "laticinio", "vaca", "queijo", "pastagem", "producao de leite"] },
  { n: "florestas e reflorestamento", k: ["floresta", "reflorestamento", "mudas", "desmatamento", "arvores"] },
  { n: "planetário e divulgação científica", k: ["planetario municipal", "cupula do planetario", "visita ao planetario", "planetarios", "cupula", "divulgacao cientifica"] },
  { n: "radioatividade e datação", k: ["meia vida", "radioativ", "decaimento", "datacao por carbono", "carbono 14", "radioisotopo"] },
];

// Áreas em que o domínio de contexto é RESERVADO (o texto-base é uma
// situação-problema construída). Em Humanas e Linguagens o texto-base costuma
// ser fonte real (documento, charge, poema): ali só valem o subtópico/eixo e
// a lista de contextos já usados — nada de forçar cenário sobre um texto real.
const AREAS_COM_DOMINIO = ["matematica", "natureza"];

function planejaSubtopicos(){
  state.questions.forEach(q => { q.subtopico = null; });
  const porEixo = new Map();
  state.questions.forEach(q => {
    if((q.tema || "").trim() || !q.eixoTematico) return;
    if(!porEixo.has(q.eixoTematico)) porEixo.set(q.eixoTematico, []);
    porEixo.get(q.eixoTematico).push(q);
  });
  porEixo.forEach((qs, eixo) => {
    const lista = SUBTOPICOS_OFICIAIS[eixo];
    if(!Array.isArray(lista) || !lista.length) return;
    const ordem = embaralha(lista);
    // Mais questões que subtópicos (ex.: "Representação espacial", 3 itens, com
    // 4 questões): as que sobram ficam só com o eixo — nunca um subtópico repetido,
    // que contradiria a lista de assuntos já usados.
    qs.forEach((q, i) => { q.subtopico = i < ordem.length ? ordem[i] : null; });
  });
}

function planejaDominios(){
  state.questions.forEach(q => { q.dominio = null; q.dominioAlt = null; q.contextosEvitar = null; q.colisaoContexto = null; });
  if(!AREAS_COM_DOMINIO.includes(state.area) || state.questions.length < 2) return;
  const ordem = embaralha(DOMINIOS_CONTEXTO.map(d => d.n));
  const n = state.questions.length;
  // Principais: os n primeiros nomes; alternativos: os n seguintes. O catálogo
  // tem 60 nomes e a leva no máximo 20 (setQty), logo 2n ≤ 40 < 60 e todos são
  // distintos. Se um dia n passar de 30, a questão fica sem alternativo (null)
  // em vez de receber o principal de outra.
  state.questions.forEach((q, i) => {
    q.dominio = ordem[i];
    q.dominioAlt = (n + i) < ordem.length ? ordem[n + i] : null;
  });
}

// Domínios principais reservados pelas OUTRAS questões da leva. (Os
// alternativos delas não precisam ir: esta questão só pode usar o próprio
// principal ou o próprio alternativo, e todos são distintos por construção.)
function dominiosEvitarPara(q){
  const lista = [];
  state.questions.forEach(o => {
    if(o === q || !o.dominio) return;
    if(!lista.includes(o.dominio) && o.dominio !== q.dominio && o.dominio !== q.dominioAlt) lista.push(o.dominio);
  });
  return lista;
}

function normalizaTextoBusca(s){
  // apóstrofo tipográfico → ', hífen → espaço ("caixa-d'água" = "caixa d'agua")
  return String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[\u2019\u02bc]/g, "'").replace(/-/g, " ").replace(/\s+/g, " ");
}
function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// Palavra-chave curta (até 5 letras, sem espaço) ou terminada em "." só vale
// como palavra inteira (com plural): "mel" não bate em "melhor", "trem" em
// "tremendo", "planeta." em "planetário", "esgoto." em "esgotou". As demais
// valem como radical no início da palavra ("marcenar" → marcenaria, marceneiro).
function dominioBateNoTexto(texto, dom){
  return dom.k.some(k => {
    const inteira = /\.$/.test(k) || (!/\s/.test(k) && k.length <= 5);
    const kn = escapeRegExp(normalizaTextoBusca(k.replace(/\.$/, "")));
    return new RegExp("(^|[^a-z])" + kn + (inteira ? "(s|es)?([^a-z]|$)" : "")).test(texto);
  });
}
function textoDeBuscaDaQuestao(q){
  const d = q && q.data;
  if(!d) return null;
  return normalizaTextoBusca([d.textoBase, d.comando, d.visual && d.visual.descricao].filter(Boolean).join(" "));
}

/* Auditoria de contexto (sem IA): para cada domínio do catálogo, quais
   questões entregues se passam nele; duas ou mais no mesmo domínio = par
   repetido. Marca em cada questão envolvida (menos a primeira do par) a
   colisão, para a auditoria local do cartão e o botão "Outro contexto".
   Devolve os pares em texto para o console/toast. */
function auditaDiversidadeContextos(){
  const qs = state.questions;
  qs.forEach(q => { q.colisaoContexto = null; });
  const pares = [];
  // Só onde o texto-base é situação-problema construída (Matemática e Natureza):
  // em Humanas e Linguagens duas questões "sobre eleições" não são exemplo repetido.
  if(!AREAS_COM_DOMINIO.includes(state.area)) return pares;
  const textos = qs.map(textoDeBuscaDaQuestao);
  const vistos = new Set();
  DOMINIOS_CONTEXTO.forEach(dom => {
    const idx = [];
    textos.forEach((t, i) => { if(t && dominioBateNoTexto(t, dom)) idx.push(i); });
    if(idx.length < 2) return;
    for(let a = 0; a < idx.length; a++){
      for(let b = a + 1; b < idx.length; b++){
        const chave = idx[a] + "-" + idx[b];
        if(vistos.has(chave)) continue;
        vistos.add(chave);
        pares.push(`${idx[a] + 1} e ${idx[b] + 1} (${dom.n})`);
        const q = qs[idx[b]];
        q.colisaoContexto = (q.colisaoContexto ? q.colisaoContexto + "; " : "") + `${dom.n} — igual à questão ${idx[a] + 1}`;
      }
    }
  });
  return pares;
}

// Botão "Outro contexto": domínio novo, ainda não usado por ninguém na leva,
// e os cenários da colisão como proibidos. Só então regenera (custo de UMA
// questão, e só porque o professor pediu).
async function regenerarComOutroContexto(q){
  const usados = new Set();
  state.questions.forEach(o => { [o.dominio, o.dominioAlt].forEach(d => { if(d) usados.add(d); }); });
  const livres = embaralha(DOMINIOS_CONTEXTO.map(d => d.n).filter(n => !usados.has(n)));
  const colididos = String(q.colisaoContexto || "").split(";").map(s => s.split(" — ")[0].trim()).filter(Boolean);
  if(livres.length && AREAS_COM_DOMINIO.includes(state.area)){
    q.dominio = livres[0];
    q.dominioAlt = livres[1] || null;
  }
  q.contextosEvitar = Array.from(new Set([...(q.contextosEvitar || []), ...colididos])).slice(0, 10);
  // Leva com tema: o recorte planejado dizia "contexto: X" com o cenário que
  // colidiu — fica só o conteúdo (e a habilidade); o cenário novo vem do
  // domínio, que o backend passa a incluir quando há contextos a evitar.
  if(q.recorte) q.recorte = q.recorte.split(" · ").filter(p => !/^contexto:/i.test(p)).join(" · ") || null;
  q.colisaoContexto = null;
  await regenerarQuestaoEArquivar(q);
}

/* Reserva um eixo temático (objeto de conhecimento oficial) para cada questão
   SEM tema digitado, em rodízio sobre a lista embaralhada: com 10 questões de
   Biologia (6 objetos), nenhum objeto recebe mais de 2 questões — e, dentro do
   mesmo objeto, o SUBTÓPICO oficial (v17) e "temasEvitar" (abaixo) impedem o
   mesmo recorte. Questões com tema do professor não recebem eixo: o tema dele
   manda. */
function planejaEixosTematicos(){
  const objetos = objetosDaDisciplina(state.area, state.disciplina);
  const semTema = state.questions.filter(q => !(q.tema || "").trim());
  semTema.forEach(q => { q.eixoTematico = null; });
  state.questions.filter(q => (q.tema || "").trim()).forEach(q => { q.eixoTematico = null; });
  if(!objetos.length || semTema.length < 2){ planejaSubtopicos(); return; } // uma questão só não tem com o que repetir
  const ordem = embaralha(objetos);
  semTema.forEach((q, i) => { q.eixoTematico = ordem[i % ordem.length]; });
  planejaSubtopicos();
}

// Assuntos já usados na leva, do ponto de vista da questão q: os temas
// digitados pelo professor nas outras questões e os temas das questões já
// entregues pela IA. Nunca inclui o tema da própria q (regenerar "mais fácil/
// mais difícil" mantém o assunto).
/* v18.2: o recorte planejado só viaja enquanto a questão tiver o tema para o qual
   ele foi planejado (`recorteTema`, gravado no planejamento) — senão o modelo segue
   o recorte e ignora o tema (incidente de 15/09/2026). Protege os simulados gerados
   a partir desta versão, por qualquer caminho ("Regenerar", "Mais fácil/difícil",
   "Outro contexto"). Simulado antigo não tem `recorteTema`: o recorte é aceito como
   está — se ele estiver descasado do tema (edição feita na versão anterior), o
   professor descarta-o abrindo "Editar" e alterando o tema. */
function recorteParaEnvio(q){
  if(!q || !(q.tema || "").trim() || !q.recorte) return null;
  if(q.recorteTema != null && temaComparavel(q.recorteTema) !== temaComparavel(q.tema)) return null;
  return q.recorte;
}
function temasEvitarPara(q){
  const vistos = new Set();
  const lista = [];
  // O tema pedido para ESTA questão nunca é "assunto a evitar" — quando todas
  // as questões têm o mesmo tema digitado, ele apareceria aqui vindo das
  // outras, e o pedido ficaria contraditório ("tema: X" / "proibido: X").
  const proprioTema = (q.tema || "").trim().toLowerCase();
  // v17: com subtópico e domínio reservados, só as questões do MESMO eixo
  // podem colidir em conteúdo — os temas entregues das demais saem da lista
  // (é o que mantém o prompt do mesmo tamanho de antes, ou menor). Os temas
  // digitados pelo professor nas outras questões continuam sempre.
  const soMesmoEixo = !!(q.subtopico && q.eixoTematico);
  // Idem com tema digitado e recorte planejado: as questões do mesmo grupo
  // já receberam recortes distintos do planejamento — seus temas entregues
  // não precisam viajar de novo; os de outros grupos continuam indo.
  const comRecorte = !!recorteParaEnvio(q);
  const grupoProprio = grupoDeTema(q);
  state.questions.forEach(o => {
    if(o === q) return;
    // v18: questões da mesma lista do lote (conteúdos distintos, recortes
    // planejados juntos) são o mesmo grupo — nem o conteúdo digitado nem o tema
    // entregue delas viajam, como já era com o tema igual.
    const mesmoGrupo = comRecorte && grupoDeTema(o) === grupoProprio && !!recorteParaEnvio(o);
    const entregue = (mesmoGrupo || (soMesmoEixo && o.eixoTematico !== q.eixoTematico)) ? "" : (o.data && o.data.tema || "").trim();
    // Tema digitado em outra questão que coincide com o subtópico reservado desta
    // ("Função exponencial" × "funções exponenciais e logarítmicas") não pode virar
    // "proibido" — seria contradição direta com a reserva.
    // v18.2: tema trocado pelo professor no painel "Editar" — os temas digitados
    // das outras questões não viram "proibido" (o tema dela era um deles, ou um
    // recorte deles: "Ciclo do nitrogênio" com "PROIBIDO: Ciclos Biogeoquímicos"
    // seria contradição). Os temas ENTREGUES continuam, para não repetir questão.
    const digitado = (mesmoGrupo || q.temaEditado) ? "" : (o.tema || "").trim();
    const candidatos = [(q.subtopico && temaCoincideComSubtopico(digitado, q.subtopico)) ? "" : digitado, entregue];
    candidatos.forEach(t => {
      if(!t) return;
      const chave = t.toLowerCase();
      if(chave === proprioTema) return;
      if(vistos.has(chave)) return;
      vistos.add(chave); lista.push(t.slice(0, 120));
    });
  });
  // v17: teto 40 (era 30). Com 20 questões, tema digitado + tema entregue das
  // outras 19 chegam a 38 itens — o teto de 30 cortava as últimas questões da
  // leva da lista das primeiras. Itens de 120 caracteres (eram 200), para o
  // prompt não crescer.
  return lista.slice(0, 40);
}

/* Recortes planejados para questões com o MESMO tema digitado (backend v64).
   Leva real de 09/09/2026: 10 questões de "Eletrodinâmica" — 4 sobre
   associação de resistores, 2 quase iguais sobre capacitores. As questões da
   mesma onda saem em paralelo e não sabem umas das outras; o eixo por objeto
   de conhecimento só vale com tema em branco. Aqui, para cada grupo de 2+
   questões com o mesmo tema, UMA chamada curta ao backend devolve um recorte
   por questão (conteúdo + contexto real + habilidade), decidido ANTES da
   leva, como o gabarito e os eixos. Custa centavos por leva. */
// O contexto planejado cita o domínio reservado? Vale uma palavra significativa
// do nome do domínio (≥ 5 letras, singularizada) ou uma palavra-chave do catálogo.
function contextoRespeitaDominio(contexto, dominio){
  if(!dominio) return false;
  const t = normalizaTextoBusca(contexto);
  const dom = DOMINIOS_CONTEXTO.find(d => d.n === dominio);
  if(dom && dominioBateNoTexto(t, dom)) return true;
  // v18.2: palavras extras SÓ desta checagem (kp) — flexões do nome do domínio que
  // não podem ir para a lista k porque a auditoria de contextos repetidos usa k e
  // palavras comuns ("impresso") criariam colisões falsas. (Uma família de palavras
  // genérica foi testada e descartada: "família" ~ "familiar", "pessoas" ~
  // "pessoais", "informações" ~ "informática" aceitariam quase tudo.)
  if(dom && Array.isArray(dom.kp) && dominioBateNoTexto(t, { k: dom.kp })) return true;
  const palavras = normalizaTextoBusca(dominio).split(/[^a-z]+/).filter(w => w.length >= 5).map(radicalPalavra);
  const tw = new Set(t.split(/[^a-z]+/).map(radicalPalavra));
  return palavras.some(w => tw.has(w));
}
function recorteTexto(r, q){
  const partes = [];
  if(r && r.conteudo) partes.push(`conteúdo: ${String(r.conteudo).trim()}`);
  if(r && r.contexto) partes.push(`contexto: ${String(r.contexto).trim()}`);
  // Se o professor fixou competência/habilidade na questão, a dele manda —
  // a habilidade sugerida pelo planejamento fica de fora para não conflitar.
  if(r && r.habilidade && !q.habilidadeCod && !q.competenciaNum) partes.push(`habilidade: ${String(r.habilidade).trim()}`);
  return partes.join(" · ").slice(0, 800) || null;   // v18.2: era 600 (backend v74.2 deixa o contexto ir a 320)
}

// v18: o recorte planejado fica dentro do conteúdo distribuído para a questão?
// Pontua cada item do grupo pelas palavras presentes no recorte (palavras curtas
// e siglas — "PA", "MMC", "1" — só valem inteiras; as demais valem pela família:
// "exponenciação" ~ "exponencial"). O recorte é da questão se o item inteiro
// aparece no texto, ou se o item dela pontua pelo menos metade E nenhum OUTRO
// item do grupo pontua mais ("Função do 2.º grau — vértice" não serve para
// "Função do 1.º grau"; "Grandezas diretamente proporcionais" não serve para
// "Grandezas inversamente proporcionais").
function palavrasDoItem(item){
  return normalizaTextoBusca(String(item || "")).split(/[^a-z0-9]+/).filter(w => w && !PALAVRAS_VAZIAS.has(w) && !/^(do|da|de|em|no|na|o|a|e|ou|um|uma|os|as|ao)$/.test(w));
}
function pontuacaoDoItem(texto, item){
  const pw = palavrasDoItem(item);
  if(!pw.length) return 0;
  const tw = texto.split(/[^a-z0-9]+/).filter(Boolean);
  const twRad = tw.map(radicalPalavra);
  let presentes = 0;
  pw.forEach(w => {
    const curta = w.length <= 3 || /^\d+$/.test(w);
    const achou = curta ? tw.includes(w) : twRad.some(t => t === radicalPalavra(w) || mesmaFamiliaDePalavra(w, t));
    if(achou) presentes++;
  });
  return presentes / pw.length;
}
function recorteRespeitaItem(r, item, outrosItens){
  const it = normalizaTextoBusca(String(item || "")).trim();
  if(!it) return true;
  const texto = normalizaTextoBusca(`${r && r.conteudo || ""} ${r && r.contexto || ""}`);
  if(new RegExp("(^|[^a-z0-9])" + escapeRegExp(it) + "([^a-z0-9]|$)").test(texto)) return true;
  const propria = pontuacaoDoItem(texto, item);
  if(propria < 0.5) return false;
  const rival = (outrosItens || []).filter(o => normalizaTextoBusca(String(o || "")).trim() !== it).reduce((m, o) => Math.max(m, pontuacaoDoItem(texto, o)), 0);
  return propria >= rival;
}

async function planejaRecortesPorTema(){
  // v18.2: novo "Gerar" — o tema do formulário manda; a origem do recorte e a marca
  // de "tema editado nos resultados" recomeçam junto com o recorte.
  state.questions.forEach(q => { q.recorte = null; q.recorteTema = null; q.temaEditado = false; });
  const grupos = new Map();
  state.questions.forEach(q => {
    const t = (q.tema || "").trim();
    if(!t) return;
    // v18: as questões de uma mesma lista do lote formam UM grupo (uma chamada),
    // cada uma com o seu conteúdo; sem lista, o grupo é o tema igual, como antes.
    const chave = grupoDeTema(q);
    if(!grupos.has(chave)) grupos.set(chave, { tema: (q.temaLote || t).trim(), lista: !!q.temaLote, qs: [] });
    grupos.get(chave).qs.push(q);
  });
  for(const g of grupos.values()){
    if(g.qs.length < 2) continue; // uma questão só não tem com o que repetir
    try{
      const resp = await fetch(QUESTION_BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          planejarRecortes: true,
          area: state.area,
          disciplina: state.disciplina,
          tema: g.tema,
          quantidade: g.qs.length,
          dificuldades: g.qs.map(q => q.dificuldade),
          // v17: o contexto de cada recorte tem de cair no domínio reservado da
          // questão (ver planejaDominios) — principal ou, se não couber com
          // naturalidade, o alternativo. Nenhuma chamada a mais.
          dominios: g.qs.map(q => q.dominio || null),
          dominiosAlternativos: g.qs.map(q => q.dominioAlt || null),
          // v18: conteúdo já distribuído pelo app para cada questão (backend v74
          // planeja o recorte dentro dele; o v73 ignora e o app filtra abaixo).
          temasPorQuestao: g.lista ? g.qs.map(q => String(q.tema || "").replace(/\s+/g, " ").trim()) : undefined,
        }),
      });
      let payload = {};
      try{ payload = await resp.json(); }catch(e){ /* corpo não é JSON — trata abaixo */ }
      if(!resp.ok || payload.error || !Array.isArray(payload.recortes) || !payload.recortes.length){
        throw new Error(payload.error || `Erro HTTP ${resp.status} ao planejar os recortes.`);
      }
      if(payload.uso) somaUso(payload.uso);
      // v17: (1) se o planejador devolveu MENOS recortes que questões, as que
      // sobram ficam sem recorte (o domínio reservado assume) — antes recebiam
      // o recorte de outra questão, contexto repetido garantido; (2) o contexto
      // de cada recorte só é aproveitado se cair no domínio reservado (principal
      // ou alternativo) e não repetir o de outro recorte do grupo — senão sai do
      // recorte e o backend ambienta pelo domínio.
      // v18: com lista do lote, cada recorte é casado com a SUA questão pelo
      // conteúdo — não só pela posição. No teste real de 15/09/2026 o planejador
      // criou um recorte a mais no meio e deslocou os seguintes: pela posição,
      // 7 de 10 seriam descartados; casando pelo conteúdo (e preferindo o recorte
      // cujo contexto cai no domínio da questão), quase todos são aproveitados.
      // Um recorte fora de qualquer conteúdo da questão não entra: o tema dela
      // e o domínio reservado bastam.
      const itens = g.qs.map(o => o.tema);
      const escolhidos = g.qs.map((q, i) => g.lista ? null : (i < payload.recortes.length ? payload.recortes[i] : null));
      if(g.lista){
        const usados = new Set();
        const cabe = (r, q) => r && recorteRespeitaItem(r, q.tema, itens);
        const noDominio = (r, q) => !q.dominio || !r.contexto || contextoRespeitaDominio(String(r.contexto), q.dominio) || contextoRespeitaDominio(String(r.contexto), q.dominioAlt);
        // Um recorte "cabe melhor" em outra questão ainda sem recorte? (itens
        // pai/filho: "Grandezas" × "Grandezas inversamente proporcionais")
        const outraPrefere = (r, i) => { const texto = normalizaTextoBusca(`${r.conteudo || ""} ${r.contexto || ""}`); const minha = pontuacaoDoItem(texto, g.qs[i].tema); return g.qs.some((o, j) => j !== i && !escolhidos[j] && pontuacaoDoItem(texto, o.tema) > minha); };
        const passadas = [
          (q, i) => (k, r) => k === i && cabe(r, q) && noDominio(r, q) && !outraPrefere(r, i),   // 1) mesma posição, contexto no domínio
          (q, i) => (k, r) => r && r.numero === i + 1 && cabe(r, q) && noDominio(r, q),          // 2) número declarado pelo planejador
          (q) => (k, r) => cabe(r, q) && noDominio(r, q),                                        // 3) mesmo conteúdo, contexto no domínio
          (q) => (k, r) => cabe(r, q),                                                           // 4) mesmo conteúdo
        ];
        passadas.forEach(regra => {
          g.qs.forEach((q, i) => {
            if(escolhidos[i]) return;
            const teste = regra(q, i);
            const k = payload.recortes.findIndex((r, idx) => !usados.has(idx) && teste(idx, r));
            if(k >= 0){ escolhidos[i] = payload.recortes[k]; usados.add(k); if(k !== i) console.log(`[tema] recorte da questão ${state.questions.indexOf(q) + 1} ("${q.tema}") veio na posição ${k + 1} do planejador`); }
          });
        });
        payload.recortes.forEach((r, k) => { if(!usados.has(k)) console.warn(`[tema] recorte ${k + 1} do planejador não coube em nenhuma questão — descartado: "${String(r && r.conteudo || "").slice(0, 120)}"`); });
      }
      const contextosAceitos = [];
      g.qs.forEach((q, i) => {
        let r = escolhidos[i] ? Object.assign({}, escolhidos[i]) : null;
        if(r && r.contexto){
          const ctx = String(r.contexto);
          const noDominio = !q.dominio || contextoRespeitaDominio(ctx, q.dominio) || contextoRespeitaDominio(ctx, q.dominioAlt);
          const repetido = contextosAceitos.some(c => temasParecidos(c, ctx));
          if(!noDominio || repetido){
            console.warn(`[tema] recorte ${state.questions.indexOf(q) + 1}: contexto do planejador descartado (${!noDominio ? "fora do domínio reservado" : "repete outro recorte"}): "${ctx.slice(0, 120)}"`);
            delete r.contexto;
          } else contextosAceitos.push(ctx);
        }
        q.recorte = r ? recorteTexto(r, q) : null;
        // v18.2: tema para o qual este recorte foi planejado (ver recorteParaEnvio).
        q.recorteTema = r ? q.tema : null;
      });
      console.log(`[tema] recortes planejados para "${g.tema}" (${payload.recortes.length}/${g.qs.length}): ` + g.qs.map(q => `${state.questions.indexOf(q) + 1}: ${q.recorte}`).join(" · "));
    }catch(e){
      // O planejamento é um refinamento: se falhar, a leva segue sem ele.
      console.warn(`[tema] planejamento de recortes falhou para "${g.tema}" (a leva segue sem recortes):`, e && e.message || e);
      toast(`Não foi possível planejar os recortes do tema "${g.tema}"; as questões serão geradas sem essa distribuição.`, "err");
    }
  }
}

// Palavras significativas de um tema (sem acentos, sem palavras vazias), para
// medir semelhança entre dois temas entregues.
const PALAVRAS_VAZIAS = new Set(["a","o","e","de","da","do","das","dos","em","na","no","nas","nos","um","uma","com","por","para","sobre","entre","seu","sua","seus","suas","ao","aos","as","os","que","se","ou","versus","vs"]);
function palavrasChaveTema(t){
  return new Set(String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(p => p.length > 3 && !PALAVRAS_VAZIAS.has(p)));
}
// Radical simples de uma palavra (plural → singular): funções→funcao,
// exponenciais→exponencial, papéis→papel, jovens→jovem, casas→casa.
function radicalPalavra(w){
  return String(w).replace(/oes$/, "ao").replace(/ais$/, "al").replace(/eis$/, "el").replace(/ois$/, "ol").replace(/ns$/, "m").replace(/(r|z)es$/, "$1").replace(/s$/, "");
}
// O tema digitado pelo professor coincide com o subtópico oficial reservado?
// ("Função exponencial" × "funções exponenciais e logarítmicas" → sim.) Metade
// ou mais das palavras significativas do tema, singularizadas, estão no subtópico.
function temaCoincideComSubtopico(tema, subtopico){
  const A = Array.from(palavrasChaveTema(tema)).map(radicalPalavra);
  const B = new Set(Array.from(palavrasChaveTema(subtopico)).map(radicalPalavra));
  if(!A.length || !B.size) return false;
  const comum = A.filter(w => B.has(w)).length;
  return comum / A.length >= 0.5;
}
// Duas palavras da mesma família? Mesmo radical, ou os 6 primeiros caracteres
// iguais: "exponenciacao" ~ "exponencial" ~ "exponenciais", "logaritmo" ~
// "logaritmica", "porcentagem" ~ "porcentual", "trigonometria" ~ "trigonometricas".
function mesmaFamiliaDePalavra(a, b){
  const ra = radicalPalavra(a), rb = radicalPalavra(b);
  if(ra === rb) return true;
  return ra.length >= 6 && rb.length >= 6 && ra.slice(0, 6) === rb.slice(0, 6);
}
function temasParecidos(a, b, ignorar){
  const A = palavrasChaveTema(a), B = palavrasChaveTema(b);
  // v17: numa leva com o mesmo tema digitado ("Exponenciação"), as palavras do
  // tema do professor aparecem em todos os temas entregues e não medem
  // semelhança entre eles — saem da conta. Vale para a família da palavra:
  // com "Exponenciação" digitado, "exponencial"/"exponenciais" também saem
  // (no teste real, "exponencial" aparecia em 9 dos 10 temas entregues e fez
  // duas questões de exemplos diferentes serem apontadas como parecidas).
  if(ignorar && ignorar.size){
    // Dois temas entregues idênticos ("Exponenciação" × "Exponenciação",
    // "Exponencial" × "Exponenciais") são parecidos por definição, mesmo que
    // sobre só a palavra do professor.
    const rA = new Set(Array.from(A).map(radicalPalavra)), rB = new Set(Array.from(B).map(radicalPalavra));
    if(rA.size && rA.size === rB.size && Array.from(rA).every(w => rB.has(w))) return true;
    const ig = Array.from(ignorar);
    [A, B].forEach(S => { Array.from(S).forEach(w => { if(ig.some(g => mesmaFamiliaDePalavra(w, g))) S.delete(w); }); });
  }
  if(!A.size || !B.size) return false;
  let comum = 0; A.forEach(p => { if(B.has(p)) comum++; });
  return comum / Math.min(A.size, B.size) >= 0.5;
}
// Pares de questões entregues com temas muito parecidos (informativo: a leva
// não é bloqueada, mas o professor fica sabendo quais regenerar).
function auditaDiversidadeTemas(){
  const pares = [];
  const qs = state.questions;
  for(let i = 0; i < qs.length; i++){
    for(let j = i + 1; j < qs.length; j++){
      const ta = qs[i].data && qs[i].data.tema, tb = qs[j].data && qs[j].data.tema;
      const ti = (qs[i].tema || "").trim().toLowerCase(), tj = (qs[j].tema || "").trim().toLowerCase();
      const ignorar = (ti && ti === tj) ? palavrasChaveTema(ti) : null;
      if(ta && tb && temasParecidos(ta, tb, ignorar)) pares.push(`${i + 1} e ${j + 1} ("${ta}" / "${tb}")`);
    }
  }
  return pares;
}

/* ---------------- v18.4: os conteúdos são da disciplina escolhida? ----------------
   Em 15/09/2026 o professor digitou sete conteúdos de Química — Radioatividade,
   Tabela Periódica, Modelos Atômicos, Funções Orgânicas, Esterificação/Saponificação,
   Propriedades Coligativas, Polímeros — com o formulário em MATEMÁTICA, e o app gerou
   as sete e cobrou por elas sem dizer uma palavra. A causa de raiz (a tela mostrando
   uma disciplina e o estado guardando outra) está corrigida em btnBackToForm, mas o
   professor também pode simplesmente esquecer de trocar a área — e aí o dinheiro vai
   embora do mesmo jeito.
   Esta é a rede de segurança. Marcadores de alta precisão por disciplina; a checagem
   só acusa no caso indiscutível: NENHUM dos conteúdos é da disciplina escolhida E a
   maioria deles é claramente de UMA outra. Disciplina sem marcadores nunca acusa —
   ausência de marcador não é evidência de erro. E o aviso NÃO bloqueia de vez: ele
   para a primeira tentativa e explica; clicar em "Gerar" de novo manda assim mesmo,
   porque uma questão de Matemática ambientada em Química é legítima. */
const MARCADORES_DISCIPLINA = {
  "Matemática": ["funcao afim","funcao quadratica","funcao exponencial","funcao logaritmica","funcao grau","funcao polinomial","equacao","inequacao","logaritmo","progressao aritmetica","progressao geometrica","matriz","determinante","polinomio","trigonometria","seno","cosseno","tangente","geometria","poligono","circunferencia","perimetro","probabilidade","estatistica","mediana","desvio padrao","porcentagem","juro","proporcao","radiciacao","potenciacao","exponenciacao","combinatoria","permutacao","fatorial","plano cartesiano","escala","grandeza proporcional"],
  "Química": ["radioatividade","tabela periodica","modelo atomico","atomistica","funcao organica","esterificacao","saponificacao","coligativa","polimero","estequiometria","molaridade","ligacao ionica","ligacao covalente","ligacao metalica","oxirreducao","eletroquimica","eletrolise","entalpia","termoquimica","cinetica quimica","equilibrio quimico","hidrocarboneto","alcano","alceno","alcino","aldeido","cetona","amida","amina","isomeria","alotropia","isotopo","distribuicao eletronica","solubilidade","titulacao","oxidacao","reacao quimica","transformacao quimica","separacao de misturas","gas ideal","mol","acido","base","sal","oxido"],
  "Física": ["cinematica","movimento uniforme","aceleracao","forca resultante","newton","atrito","trabalho e energia","energia cinetica","energia potencial","quantidade de movimento","impulso","hidrostatica","empuxo","termologia","dilatacao","calorimetria","termodinamica","ondulatoria","ondas","acustica","optica","espelho","lente","refracao","reflexao","eletrostatica","campo eletrico","corrente eletrica","resistor","circuito","magnetismo","inducao","gravitacao","lancamento obliquo","potencia eletrica"],
  "Biologia": ["celula","citologia","mitose","meiose","genetica","hereditariedade","dna","rna","proteina","enzima","fotossintese","respiracao celular","ecologia","ecossistema","cadeia alimentar","bioma","evolucao","selecao natural","especiacao","taxonomia","botanica","zoologia","fisiologia","sistema nervoso","sistema digestorio","sistema circulatorio","imunologia","virus","bacteria","fungo","protozoario","embriologia","biotecnologia","ciclo biogeoquimico","parasitose"],
};
/* Quais disciplinas este conteúdo marca? Usa as mesmas peças já existentes
   (palavrasChaveTema + radicalPalavra + mesmaFamiliaDePalavra), então plural,
   acento e flexão não atrapalham: "Funções Orgânicas" bate "funcao organica". */
function disciplinasDoConteudo(tema){
  const palavras = Array.from(palavrasChaveTema(tema)).map(radicalPalavra);
  if(!palavras.length) return [];
  const saida = [];
  for(const disc of Object.keys(MARCADORES_DISCIPLINA)){
    const bate = MARCADORES_DISCIPLINA[disc].some(marca =>
      marca.split(" ").map(radicalPalavra).every(pt => palavras.some(w => mesmaFamiliaDePalavra(w, pt))));
    if(bate) saida.push(disc);
  }
  return saida;
}
/* Devolve null quando está tudo bem, ou { outra, quantos, total } quando NENHUM
   conteúdo é da disciplina escolhida e a maioria é claramente de outra. */
function conteudosForaDaDisciplina(){
  const sel = state.disciplina;
  if(!sel || !MARCADORES_DISCIPLINA[sel]) return null;          // sem marcadores: nunca acusa
  const temas = state.questions.map(q => String(q.tema || "").trim()).filter(Boolean);
  if(temas.length < 2) return null;                              // com um conteúdo só não há "maioria"
  const porDisc = {};
  let daSelecionada = 0;
  for(const t of temas){
    const ds = disciplinasDoConteudo(t);
    if(ds.includes(sel)) daSelecionada++;
    for(const d of ds) if(d !== sel) porDisc[d] = (porDisc[d] || 0) + 1;
  }
  if(daSelecionada > 0) return null;                             // algum é da disciplina: não acusa
  const piso = Math.max(2, Math.ceil(temas.length * 0.6));
  let outra = null, quantos = 0;
  for(const d of Object.keys(porDisc)) if(porDisc[d] > quantos){ outra = d; quantos = porDisc[d]; }
  if(!outra || quantos < piso) return null;
  return { outra: outra, quantos: quantos, total: temas.length };
}
function gabaritoAlvoDe(idx){
  if(!Array.isArray(state.gabaritoPlan) || state.gabaritoPlan.length <= idx){
    state.gabaritoPlan = planejaGabaritos(Math.max(state.questions.length, idx + 1));
  }
  return state.gabaritoPlan[idx] || null;
}

/* Leitura do número que abre uma alternativa — ou null quando ela não começa
   por um número. Lê o que as questões de fato trazem: moeda na frente
   ("R$ 10.648,00"), separador de milhar por ponto ou espaço ("10.648,00",
   "1 000", "2.500.000"), vírgula ou ponto decimal ("2,5", "0,001", "3.14159"),
   fração ("1/3"), potência em sobrescrito ("10³ vezes" → 1000, "2¹⁴" → 16384,
   "10⁻³" → 0,001), notação científica ("3,5 × 10⁴" → 35000) e escala em
   palavras ("1,2 milhão", "900 mil"). Uma expressão algébrica ("2ⁿ", "2⁻ᵗ",
   "2ˣ", "2 × 10ⁿ") não é número — devolve null, para a leva não ser acusada de
   "fora de ordem" por causa de letras no expoente. Devolve também o "resto"
   (o que vem depois do número, normalizado): duas alternativas só têm "o mesmo
   valor" quando valor E resto coincidem ("2,5 km" × "2.5 km"), e não quando o
   número é só um prefixo ("1/6" × "1/5" já são distintos pela fração; "10 m/s"
   × "10 km/h" pelo resto).
   No teste real de v17 as alternativas "R$ 10.648,00" / "R$ 10.400,00" saíram
   fora da ordem crescente e a auditoria não viu, porque só lia textos que
   começavam pelo dígito. */
const SOBRESCRITOS_DIGITOS = { "\u2070": "0", "\u00b9": "1", "\u00b2": "2", "\u00b3": "3", "\u2074": "4", "\u2075": "5", "\u2076": "6", "\u2077": "7", "\u2078": "8", "\u2079": "9", "\u207b": "-" };
// Expoente em sobrescrito: dígitos, com ou sem o sinal ⁻ na frente.
const RE_EXPOENTE_SOBRESCRITO = "([\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+|\u207b[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+)";
function lerNumeroAlternativa(texto){
  let t = String(texto || "").normalize("NFC").trim()
    .replace(/^(R\$|US\$|U\$|\u20ac|\u00a3|\$)\s*/i, "")
    .replace(/^[\u2212\u2013]\s?/, "-");
  // "0,001"/"0.001" é decimal, nunca milhar; fora disso, ponto ou espaço seguido
  // de exatamente 3 dígitos é separador de milhar.
  if(!/^-?0[.,]\d/.test(t)) t = t.replace(/(\d)[.\s](?=\d{3}(?!\d))/g, "$1");
  const cient = new RegExp("^(-?\\d+(?:[.,]\\d+)?)\\s*[\u00d7xX\u00b7]\\s*10" + RE_EXPOENTE_SOBRESCRITO).exec(t);
  const m = cient || new RegExp("^(-?\\d+(?:[.,]\\d+)?)" + RE_EXPOENTE_SOBRESCRITO + "?").exec(t);
  if(!m) return null;
  let resto = t.slice(m[0].length);
  // Letra em sobrescrito colada ao número ("2ⁿ", "2⁻ᵗ", "2ˣ") ou "2 × 10ⁿ": expressão, não valor.
  if(/^[\u2070-\u209f\u02b0-\u02ff\u1d2c-\u1d6b\u2c7c]/.test(resto)) return null;
  if(/^\s*[\u00d7xX\u00b7]\s*10[\u2070-\u209f]/.test(resto)) return null;
  let valor = parseFloat(m[1].replace(",", "."));
  if(m[2]){
    const exp = parseInt(Array.from(m[2]).map(c => SOBRESCRITOS_DIGITOS[c]).join(""), 10);
    valor = cient ? valor * Math.pow(10, exp) : Math.pow(valor, exp);
  }else{
    const frac = /^\s*\/\s*(\d+)(?!\d*[.,]\d)/.exec(resto);
    if(frac && parseInt(frac[1], 10) !== 0){ valor = valor / parseInt(frac[1], 10); resto = resto.slice(frac[0].length); }
  }
  // "1,2 milhão" e "900 mil" precisam ficar na mesma escala para a ordem valer.
  const escala = /^\s*(mil|milhao|milhoes|bilhao|bilhoes|trilhao|trilhoes)\b/i.exec(resto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  if(escala){
    valor *= /^mil$/i.test(escala[1]) ? 1e3 : /^milh/i.test(escala[1]) ? 1e6 : /^bilh/i.test(escala[1]) ? 1e9 : 1e12;
    resto = resto.slice(escala[0].length);
  }
  if(!isFinite(valor)) return null;
  return { valor, resto: resto.trim().replace(/[\s.;,]+$/, "").toLowerCase() };
}
function valorNumericoAlternativa(texto){
  const r = lerNumeroAlternativa(texto);
  return r ? r.valor : null;
}

// As alternativas numéricas têm de ficar em ordem crescente (Guia do Inep). Se
// estiverem, trocar duas de lugar quebraria a regra — nesse caso não mexemos.
function alternativasNumericasOrdenadas(alts){
  const vals = GABARITO_LETRAS.map(L => valorNumericoAlternativa(alts && alts[L]));
  if(vals.some(v => v === null)) return false;
  for(let i = 1; i < vals.length; i++){ if(vals[i] < vals[i - 1]) return false; }
  return true;
}

/* Reposiciona a resposta correta na letra planejada. É rede de segurança: o
   prompt já exige a posição, e o certo é o modelo escrever os distratores de
   modo que a correta caia lá respeitando a ordem lógica. Só usamos a troca
   quando ela não quebra a ordem numérica das alternativas.
   Devolve "ok" | "mantido" | "impossivel".                                    */
/* Atenção (v18.3): quando a letra entregue erra o alvo e as alternativas NÃO são numéricas,
   esta função troca duas de lugar. Isso pode desfazer a ordem "da mais curta para a mais longa"
   que o prompt do backend pede (REGRA DAS CINCO ALTERNATIVAS, item 3) — a ordem de alternativas
   de texto é, portanto, best-effort, e nenhum teste deve exigi-la. A paridade não é afetada: a
   troca não muda o conjunto de comprimentos nem o comprimento da correta, que é o que a
   auditoria local mede. */
/* ============ v18.9 — FONTE ÚNICA DA ALTERNATIVA CORRETA ============

   DEFEITO CORRIGIDO. O app tinha SEIS lugares decidindo qual alternativa é a
   correta, e eles não concordavam entre si: a tela marcava por "gabarito"; o
   PDF, o Word e a impressão marcavam por analiseAlternativas[L].status; o
   visualizador em PDF e a exportação em HTML misturavam os dois (a tarja vinha
   de "gabarito", a palavra CORRETA/INCORRETA vinha do "status"). Bastava o
   modelo entregar gabarito "C" com a análise marcando "D" — e a MESMA questão
   saía com ✅ em C na tela, CORRETA em D no caderno do professor e C na folha
   de respostas do aluno. A prova se contradizia.

   A PARTIR DAQUI os seis pontos leem esta função, e só ela. Ela não escolhe a
   letra "mais provável" nem silencia a divergência: quando as duas fontes
   discordam, devolve letra = null e estado "divergente", e a questão não é
   entregue como concluída nem exportada (ver generateQuestion e
   bloqueiaSeGabaritoInconsistente). Trocar uma letra para a inconsistência
   sumir é exatamente o que NÃO se faz aqui.

   Devolve { letra, estado, motivo, corretas }, estado em
   "ok" | "divergente" | "indefinido".                                        */
function conferenciaGabarito(d){
  const L = GABARITO_LETRAS;
  if(!d || typeof d !== "object") return { letra: null, estado: "indefinido", corretas: [], motivo: "Questão sem dados para conferir." };
  const g = L.indexOf(d.gabarito) >= 0 ? d.gabarito : null;
  const an = (d.analiseAlternativas && typeof d.analiseAlternativas === "object") ? d.analiseAlternativas : {};
  const statusDe = k => {
    const v = an[k];
    if(!v || typeof v !== "object") return "";
    return String(v.status == null ? "" : v.status).trim().toLowerCase();
  };
  const comStatus = L.filter(k => statusDe(k));
  const corretas = L.filter(k => statusDe(k) === "correta");

  if(!g){
    return { letra: null, estado: "indefinido", corretas: corretas,
      motivo: 'O campo "gabarito" da questão está ausente ou fora de A–E' + (d.gabarito ? ' (veio "' + String(d.gabarito) + '")' : "") + "." };
  }
  /* Questão sem NENHUM status na análise (simulado salvo antes da v18.9, ou
     análise só com comentários): não existe segunda fonte para conferir, então
     a letra do gabarito vale — e fica registrado que a conferência foi parcial.
     Isto não é divergência e não bloqueia nada. */
  if(!comStatus.length) return { letra: g, estado: "ok", corretas: [], parcial: true, motivo: 'A análise das alternativas não traz o campo "status" — a conferência ficou limitada ao gabarito registrado.' };
  if(corretas.length !== 1){
    return { letra: null, estado: "divergente", corretas: corretas,
      motivo: "A análise das alternativas marca " + corretas.length + " alternativa(s) como correta" + (corretas.length ? " (" + corretas.join(", ") + ")" : "") + ", e o esperado é exatamente 1. O gabarito registrado é " + g + "." };
  }
  if(corretas[0] !== g){
    return { letra: null, estado: "divergente", corretas: corretas,
      motivo: "O gabarito registrado é " + g + ", mas a análise das alternativas marca " + corretas[0] + " como correta." };
  }
  return { letra: g, estado: "ok", corretas: corretas, motivo: "" };
}

/* A letra a marcar como correta na tela e em TODAS as exportações. null = a
   questão está inconsistente e nada pode ser marcado (ver acima). */
function letraCorretaDe(d){ return conferenciaGabarito(d).letra; }

/* Marca textual usada por tela, PDF, Word, impressão e visualizador. A terceira
   forma ("A CONFERIR") só aparece em questão divergente — que não chega às
   exportações, porque elas são bloqueadas antes. */
function marcaAlternativa(conf, letra, comIcone){
  if(conf && conf.letra === letra) return comIcone ? "✅ CORRETA" : "CORRETA";
  if(conf && conf.letra) return comIcone ? "❌ INCORRETA" : "INCORRETA";
  return comIcone ? "⚠️ A CONFERIR" : "A CONFERIR";
}

/* Quando duas alternativas trocam de lugar, TODA referência à letra antiga tem
   de acompanhar o conteúdo: "a alternativa C" na resolução comentada passa a
   ser "a alternativa A". Sem isto a troca conserta a posição e cria uma segunda
   inconsistência, agora dentro do texto. Só letras precedidas por
   alternativa/letra/opção/item/gabarito são tocadas — nunca uma letra solta,
   que numa questão de matemática pode ser uma variável. */
function trocaLetrasNoTexto(txt, a, b){
  if(typeof txt !== "string" || !txt) return txt;
  const re = new RegExp("((?:alternativas?|letras?|op[çc][ãa]o|op[çc][õo]es|itens|item|gabarito)\\s+(?:correta\\s+)?)([" + a + b + "])(?![\\wÀ-ÿ])", "gi");
  return txt.replace(re, function(_m, pre, l){
    const up = l.toUpperCase();
    const novo = up === a ? b : a;
    return pre + (l === up ? novo : novo.toLowerCase());
  });
}

function aplicaGabaritoAlvo(data, alvo){
  if(!alvo || !data || !data.gabarito) return "mantido";
  if(data.gabarito === alvo) return "ok";
  const alts = data.alternativas;
  if(!alts || !alts[data.gabarito] || !alts[alvo]) return "impossivel";
  if(alternativasNumericasOrdenadas(alts)) return "impossivel";

  /* v18.9 — A TROCA É ATÔMICA OU NÃO ACONTECE, e a resposta certa continua
     presa ao CONTEÚDO, nunca à letra:
     · nada se mexe antes de a conferência dizer que a questão está coerente.
       Numa questão já divergente a troca só embaralharia mais — "impossivel";
     · texto da alternativa, entrada da análise e as referências à letra na
       resolução e nos comentários mudam JUNTOS, sobre uma CÓPIA. Antes, o
       texto trocava sempre e a análise só trocava quando as duas entradas
       existiam: faltando uma, a questão saía com o comentário "correta" colado
       na alternativa errada — era este o caminho da dessincronização;
     · a cópia é conferida de novo e só então gravada;
     · a letra planejada NUNCA prevalece: com numéricas em ordem crescente, ou
       com a análise incompleta, a função recusa e quem se ajusta é o
       planejamento da distribuição (ver replanejaGabaritos).                 */
  const antes = conferenciaGabarito(data);
  if(antes.estado !== "ok" || antes.letra !== data.gabarito) return "impossivel";

  const de = data.gabarito;
  const an = data.analiseAlternativas;
  const temAnalise = !!(an && typeof an === "object" && GABARITO_LETRAS.some(k => an[k]));
  if(temAnalise && !(an[de] && an[alvo])) return "impossivel";

  const altsNovo = Object.assign({}, alts);
  altsNovo[de] = alts[alvo]; altsNovo[alvo] = alts[de];
  let anNovo = null;
  if(temAnalise){
    anNovo = Object.assign({}, an);
    GABARITO_LETRAS.forEach(k => { if(an[k] && typeof an[k] === "object") anNovo[k] = Object.assign({}, an[k]); });
    const t2 = anNovo[de]; anNovo[de] = anNovo[alvo]; anNovo[alvo] = t2;
    GABARITO_LETRAS.forEach(k => { if(anNovo[k] && typeof anNovo[k] === "object") anNovo[k].comentario = trocaLetrasNoTexto(anNovo[k].comentario, de, alvo); });
  }
  const provisorio = { gabarito: alvo, alternativas: altsNovo, analiseAlternativas: anNovo || an };
  const depois = conferenciaGabarito(provisorio);
  if(depois.estado !== "ok" || depois.letra !== alvo) return "impossivel";

  data.alternativas = altsNovo;
  if(anNovo) data.analiseAlternativas = anNovo;
  data.resolucaoComentada = trocaLetrasNoTexto(data.resolucaoComentada, de, alvo);
  data.gabarito = alvo;
  data.gabaritoReposicionado = true;
  return "ok";
}

/* v18.9 — a letra planejada nunca prevalece sobre a resposta certa. Quando uma
   questão entrega letra diferente da planejada e a troca não é possível (ordem
   numérica, análise incompleta), quem se ajusta é o PLANO: os alvos das
   questões que ainda NÃO foram disparadas são recalculados a partir das letras
   já entregues, mantendo o que a distribuição promete — nenhuma letra repetida
   em sequência e as cinco letras uma única vez em cada bloco de cinco. Só mexe
   em quem ainda não começou (status "idle"); nenhuma questão é reescrita. */
function replanejaGabaritos(){
  if(!Array.isArray(state.gabaritoPlan) || !state.questions.length) return;
  const n = state.questions.length;
  const letraReal = i => {
    const q = state.questions[i];
    return (q && q.data && GABARITO_LETRAS.indexOf(q.data.gabarito) >= 0) ? q.data.gabarito : null;
  };
  const mexivel = i => {
    const q = state.questions[i];
    return !!q && q.status === "idle" && !q.data;
  };
  const plano = state.gabaritoPlan.slice(0, n);
  while(plano.length < n) plano.push(null);
  for(let i = 0; i < n; i++){ const r = letraReal(i); if(r) plano[i] = r; }
  for(let i = 0; i < n; i++){
    if(!mexivel(i)) continue;
    const ini = Math.floor(i / 5) * 5;
    const usadas = [];
    for(let j = ini; j < Math.min(n, ini + 5); j++){ if(j !== i && plano[j]) usadas.push(plano[j]); }
    const anterior = i > 0 ? plano[i - 1] : null;
    const seguinte = (i + 1 < n && !mexivel(i + 1)) ? plano[i + 1] : null;
    const semVizinha = GABARITO_LETRAS.filter(Lx => Lx !== anterior && Lx !== seguinte);
    const livres = semVizinha.filter(Lx => usadas.indexOf(Lx) < 0);
    const fonte = livres.length ? livres : (semVizinha.length ? semVizinha : GABARITO_LETRAS);
    plano[i] = fonte[Math.floor(Math.random() * fonte.length)];
  }
  state.gabaritoPlan = plano;
}

// Confere a distribuição final e devolve os problemas encontrados, se houver.
function auditaGabaritos(){
  const letras = state.questions.map(q => letraCorretaDe(q.data) || null);
  const problemas = [];
  for(let i = 1; i < letras.length; i++){
    if(letras[i] && letras[i] === letras[i - 1]) problemas.push(`questões ${i} e ${i + 1} com o mesmo gabarito (${letras[i]})`);
  }
  for(let b = 0; b < letras.length; b += 5){
    const bloco = letras.slice(b, b + 5).filter(Boolean);
    if(new Set(bloco).size !== bloco.length) problemas.push(`gabarito repetido entre as questões ${b + 1} e ${Math.min(b + 5, letras.length)}`);
  }
  return problemas;
}

/* QUEBRA DE LINHA LITERAL — rede de segurança do lado do app.
   O backend (generate-question/index.ts) já corrige isso na origem antes de
   responder, mas esta cópia local trata da mesma forma qualquer questão que
   chegue sem passar por ali: simulados salvos ANTES dessa correção (linha
   385, abrirSimuladoSalvo) e, por segurança, também a resposta recém-gerada
   (linha 858). Sem isto, o defeito aparece na tela como os dois caracteres
   "\n" digitados de verdade — foi exatamente o que aconteceu na questão 1
   reportada pelo professor ("...R$ 190,00.\n\nGRÁFICA MODELO...") — porque
   a caixa de texto usa white-space:pre-wrap: só uma quebra de linha REAL
   vira parágrafo; o texto "\n" não. */
function corrigirQuebrasLiterais(valor){
  if(typeof valor === "string"){
    return valor.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
  }
  if(Array.isArray(valor)) return valor.map(corrigirQuebrasLiterais);
  if(valor && typeof valor === "object"){
    const saida = {};
    for(const k of Object.keys(valor)) saida[k] = corrigirQuebrasLiterais(valor[k]);
    return saida;
  }
  return valor;
}

async function generateQuestion(q){
  q.status = "generating"; q.errorMsg = ""; updateQuestionCard(q, state.questions.indexOf(q));
  try{
    const MAX_TENTATIVAS = 3;
    let tentativa = 0;
    /* O checkbox "chkValidacao" controla a única validação real que existe
       no backend: a revisão matemática independente (review-math-question,
       uma 2ª chamada à IA, só para Matemática). O backend lê
       "revisarMatematica" e só desliga a revisão quando recebe false —
       qualquer outra coisa mantém o comportamento padrão (revisar). Antes,
       o app enviava "validar", campo que o backend nunca leu. */
    const revisarMatematica = document.getElementById("chkValidacao").checked;
    let resp, rawBody, payload;
    while(true){
      tentativa++;
      resp = await fetch(QUESTION_BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          area: state.area,
          disciplina: state.disciplina,
          tema: q.tema || "",
          dificuldade: q.dificuldade,
          recurso: q.recurso,
          competenciaNum: q.competenciaNum || null,
          habilidadeCod: q.habilidadeCod || null,
          // Sem recurso visual não há o que instruir: uma instrução guardada
          // de quando o recurso era "imagem" não vai para o modelo.
          instrucoesVisual: q.recurso !== "nenhum" ? (q.instrucoesVisual || "") : "",
          /* v18.6 — preferência OPCIONAL do professor sobre enfoque/contextualização.
             Vai como DADO subordinado a todas as regras (ver buildOrientacoesProfessor,
             no backend): não altera as diretrizes do Inep, a Matriz de Referência, a
             notação química ou matemática, as regras dos agentes, os critérios de
             elaboração/revisão do app, nem o uso das provas reais como referência. */
          orientacoes: q.orientacoes || "",
          gabaritoAlvo: gabaritoAlvoDe(state.questions.indexOf(q)),
          revisarMatematica,
          // Diversidade temática da leva (backend v63): eixo reservado para
          // esta questão (só sem tema do professor) e assuntos já usados.
          eixoTematico: (q.tema || "").trim() ? null : (q.eixoTematico || null),
          // Recorte planejado (backend v64): só com tema digitado, e só quando
          // há 2+ questões com o mesmo tema (ver planejaRecortesPorTema).
          recorte: recorteParaEnvio(q),
          temasEvitar: temasEvitarPara(q),
          // v17 — diversidade sem custo: subtópico oficial dentro do eixo (só
          // sem tema), domínio de contexto reservado (principal e alternativo),
          // domínios reservados pelas outras questões e contextos a evitar
          // (só depois de uma colisão apontada pela auditoria).
          subtopico: (q.tema || "").trim() ? null : (q.subtopico || null),
          dominioContexto: q.dominio || null,
          dominioAlternativo: q.dominioAlt || null,
          // A lista dos domínios das outras questões só vai depois de uma colisão
          // (botão "Outro contexto"): a reserva é exclusiva por construção e a
          // lista custaria ~600 caracteres em cada questão.
          dominiosEvitar: Array.isArray(q.contextosEvitar) && q.contextosEvitar.length ? dominiosEvitarPara(q) : [],
          contextosEvitar: Array.isArray(q.contextosEvitar) ? q.contextosEvitar : [],
        }),
      });
      rawBody = await resp.text();
      payload = {};
      try{ payload = rawBody ? JSON.parse(rawBody) : {}; }catch(e){ /* corpo não é JSON — trata abaixo */ }
      const isResourceLimit = resp.status === 546 || payload.code === "WORKER_RESOURCE_LIMIT";
      if(isResourceLimit && tentativa < MAX_TENTATIVAS){
        // Falha transitória de recursos do servidor (plano free do Supabase sob carga).
        // Tenta de novo com espera crescente antes de desistir.
        await new Promise(function(r){ setTimeout(r, 1500 * tentativa); });
        continue;
      }
      break;
    }
    if(!resp.ok || payload.error){
      const msg = payload.error || rawBody.slice(0, 300) || `Erro HTTP ${resp.status} ao gerar a questão.`;
      throw new Error(msg);
    }
    if(!payload.question){
      throw new Error("O backend não retornou a questão.");
    }

    // v10: alternativas/análise/competência/habilidade sempre como objeto —
    // antes de corrigirQuebrasLiterais (ver normalizaCamposEstruturados).
    q.data = corrigirQuebrasLiterais(normalizaCamposEstruturados(payload.question));
    normalizaVisualQuestao(q.data);
    nmAplicaNaQuestao(q);   // v16: o backend já normaliza; aqui é idempotente e cobre backend antigo
    // Consumo relatado pelo backend (tokens novos, escritos e lidos do cache).
    // Serve para conferir, em produção, que o cache de prompt está valendo.
    if(payload.uso) somaUso(payload.uso);
    // Rede de segurança: a letra planejada tem de ser mesmo a correta.
    q.gabaritoStatus = aplicaGabaritoAlvo(q.data, gabaritoAlvoDe(state.questions.indexOf(q)));
    /* v18.9 — a letra planejada nunca prevalece sobre a resposta certa: quando
       a troca não é possível, quem se ajusta é o PLANO das questões que ainda
       não começaram, nunca o gabarito desta. */
    if(q.gabaritoStatus === "impossivel") replanejaGabaritos();
    /* v18.9 — TRAVA DE CONSISTÊNCIA. Questão em que o gabarito e a análise das
       alternativas apontam letras diferentes NÃO é dada como concluída: o
       simulado sairia marcando uma alternativa na tela e outra no caderno do
       professor. O backend já tenta consertar resolvendo a questão de novo; se
       mesmo assim chegou divergente, vira erro com o motivo à vista. */
    q.conferencia = conferenciaGabarito(q.data);
    if(q.conferencia.estado !== "ok"){
      throw new Error(q.conferencia.motivo + ' A questão não pode ser entregue assim — clique em "Regenerar".');
    }

    /* RECURSO VISUAL PEDIDO = RECURSO VISUAL ENTREGUE. O backend (v62) já
       confere e refaz o recurso antes de responder, e manda o diagnóstico em
       "visualDiag". Aqui é a segunda trava: se mesmo assim a questão chegou
       sem o recurso pedido, o app pede SÓ o recurso visual mais uma vez (rota
       "refazer" do backend). Se ainda faltar, a questão NÃO é dada como
       concluída — vira erro, com o motivo à vista, para o professor
       regenerar. Antes, uma questão com imagem pedida e visual nulo saía
       "done" e sem nenhum aviso. */
    q.diag = [];
    if(payload.diversidadeDiag){
      const dd = payload.diversidadeDiag;
      diagImagem(q, "tema", `entregue "${dd.temaEntregue}" · objeto "${dd.objetoEntregue}"` + (dd.eixoTematico ? ` · eixo reservado "${dd.eixoTematico}" (${dd.eixoRespeitado ? "respeitado" : "NÃO respeitado"})` : dd.recorte ? ` · recorte reservado "${String(dd.recorte).slice(0, 160)}"` : " · sem eixo nem recorte (leva de 1 ou temas distintos)") + (dd.subtopico ? ` · subtópico "${dd.subtopico}"` : "") + (dd.dominioContexto ? ` · domínio "${dd.dominioContexto}"${dd.dominioAlternativo ? ` (ou "${dd.dominioAlternativo}")` : ""} · ${dd.dominiosEvitar || 0} domínio(s) proibido(s)` : "") + ` · ${dd.temasEvitar} assunto(s) a evitar`);
    }
    /* v18.9 — diagnóstico da conferência de gabarito feita no backend. Só
       aparece quando houve divergência ou reparo; no caminho normal não há
       nada a relatar e nada é registrado. */
    if(payload.gabaritoDiag && (payload.gabaritoDiag.estado !== "ok" || payload.gabaritoDiag.reparado)){
      const gd = payload.gabaritoDiag;
      diagImagem(q, "gabarito", `conferência: ${gd.estado}` +
        (gd.motivoInicial ? ` · detectado: ${gd.motivoInicial}` : "") +
        (gd.reparado ? ` · REPARADO resolvendo a questão de novo (correta = ${gd.letra}${gd.mudouDe && gd.mudouDe !== gd.letra ? `, antes ${gd.mudouDe}` : ""})` : "") +
        (gd.motivoPosReparo ? ` · depois do reparo: ${gd.motivoPosReparo}` : "") +
        (gd.pulado ? ` · ${gd.pulado}` : "") +
        (gd.erro ? ` · erro: ${gd.erro}` : "") +
        (gd.chamadas ? ` · ${gd.chamadas} chamada(s) extra(s)` : ""));
    }
    const vd = payload.visualDiag || null;
    diagImagem(q, "questao_recebida", `recurso pedido "${q.recurso}" · visual entregue ${q.data.visual ? `tipo "${q.data.visual.tipo}"` : "nulo"} · promptImagem ${imgTextoDeEspecificacao(q.data.visual && q.data.visual.promptImagem, 0).length} chars` + (vd ? ` · backend: refeito ${vd.refeito}x, conforme ${vd.conforme}${vd.motivo ? ", " + vd.motivo : ""}` : "") + (q.data.visualPendente ? ` · visualPendente: ${q.data.visualPendente.motivo}` : ""));
    let conf = visualConformeApp(q.data, q.recurso);
    if(!conf.ok){
      diagImagem(q, "visual_nao_conforme", conf.motivo + " — pedindo ao backend para refazer só o recurso visual");
      try{
        await refazerVisualPeloBackend(q);
        conf = visualConformeApp(q.data, q.recurso);
        diagImagem(q, conf.ok ? "visual_refeito_ok" : "visual_refeito_falhou", conf.ok ? `tipo "${q.data.visual.tipo}" · promptImagem ${imgTextoDeEspecificacao(q.data.visual.promptImagem, 0).length} chars` : conf.motivo);
      }catch(e){
        diagImagem(q, "visual_refeito_erro", e && e.message || String(e));
      }
    }
    if(!conf.ok){
      throw new Error(`A IA entregou a questão sem ${recursoLabelArtigo(q.recurso)} obrigatóri${q.recurso === "imagem" || q.recurso === "tabela" ? "a" : "o"} (${conf.motivo}), mesmo após as tentativas automáticas do servidor e do aplicativo. Clique em "Regenerar" para gerar a questão de novo.`);
    }

    if(q.recurso === "imagem"){
      /* A imagem faz parte da questão: a questão só é dada como concluída
         quando a imagem estiver gerada e gravada em visual.imagemDataUrl. O
         pedido corre em paralelo com as demais questões (não trava a fila),
         com retentativas automáticas; ver garanteImagemDaQuestao(). */
      q.status = "imagem";
      garanteImagemDaQuestao(q);
    }else{
      q.status = "done";
    }
  } catch(err){
    q.status = "error";
    q.errorMsg = err.message || String(err);
    diagImagem(q, "questao_erro", q.errorMsg);
  }
  updateQuestionCard(q, state.questions.indexOf(q));
  updateProgress();
}

function recursoLabelArtigo(recurso){
  return recurso === "imagem" ? "a imagem" : recurso === "grafico" ? "o gráfico" : recurso === "tabela" ? "a tabela" : "o recurso visual";
}

// Pede ao backend SÓ o recurso visual da questão (rota regenerarVisual), com o
// texto-base/comando/alternativas/gabarito/resolução já escritos — a mesma
// rota do botão "Refazer", usada aqui automaticamente quando a questão chegou
// sem o recurso pedido. Substitui q.data.visual em caso de sucesso.
async function refazerVisualPeloBackend(q){
  const resp = await fetch(QUESTION_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      regenerarVisual: true,
      area: state.area,
      disciplina: state.disciplina,
      tema: q.data.tema || q.tema || "",
      dificuldade: q.data.dificuldade || q.dificuldade,
      recurso: q.recurso,
      textoBase: q.data.textoBase || "",
      comando: q.data.comando || "",
      alternativas: q.data.alternativas || {},
      gabarito: q.data.gabarito || "",
      resolucaoComentada: q.data.resolucaoComentada || "",
      instrucoesVisual: q.instrucoesVisual || "",
    }),
  });
  const rawBody = await resp.text();
  let payload = {};
  try{ payload = rawBody ? JSON.parse(rawBody) : {}; }catch(e){ /* trata abaixo */ }
  if(!resp.ok || payload.error) throw new Error(payload.error || rawBody.slice(0, 300) || `Erro HTTP ${resp.status} ao refazer o recurso visual.`);
  if(!payload.visual) throw new Error("O backend não retornou o recurso visual.");
  if(payload.uso) somaUso(payload.uso);
  q.data.visual = payload.visual;
  q.data.recurso = q.recurso;
  delete q.data.visualPendente;
  normalizaVisualQuestao(q.data);
  nmAplicaNaQuestao(q);   // v16
}

/* IMAGEM OBRIGATÓRIA. Dispara o pedido da imagem desta questão no próprio
   fluxo de geração (antes, a imagem só era pedida quando o card era
   renderizado — se a chamada falhasse, a questão continuava "done", com um
   botão "Tentar novamente" perdido dentro do card). Regras:
   1. o pedido fica registrado em imagensEmAndamento (por objeto "visual"),
      então qualquer renderização do card enquanto ele corre só acompanha o
      resultado — nunca gera (nem paga) uma segunda imagem;
   2. até IMG_MAX_TENTATIVAS tentativas automáticas;
   3. sucesso → visual.imagemDataUrl gravado, status "done";
      falha final → status "error" com a mensagem, e o simulado avisa ao fim;
   4. a promessa entra em imagePromisesEmAndamento: generateAll e
      regenerarQuestaoEArquivar esperam TODAS as imagens antes de arquivar. */
function garanteImagemDaQuestao(q){
  const visual = q.data && q.data.visual;
  if(!visual || visual.tipo !== "imagem"){ q.status = "done"; return; }
  if(visual.imagemDataUrl){
    diagImagem(q, "imagem_ja_pronta", `${Math.round(visual.imagemDataUrl.length / 1024)} KB`);
    q.status = "done";
    return;
  }
  if(imagensEmAndamento.has(visual)) return; // já há um pedido em voo para este visual
  const promptText = montaPromptImagem(visual, q.data);
  const pedido = gerarImagemComRetentativas(promptText, q);
  imagensEmAndamento.set(visual, pedido);
  const promessa = pedido.then(({ dataUrl }) => {
    visual.imagemDataUrl = dataUrl;
    q.status = "done";
    q.errorMsg = "";
    diagImagem(q, "imagem_vinculada", `gravada em visual.imagemDataUrl da questão ${state.questions.indexOf(q) + 1} (tema "${q.data.tema || q.tema || ""}")`);
  }).catch(err => {
    q.status = "error";
    q.errorMsg = `Imagem obrigatória NÃO gerada após ${IMG_MAX_TENTATIVAS} tentativas: ${err && err.message || String(err)}. A questão não foi concluída — clique em "Regenerar" ou em "Tentar novamente" na imagem.`;
    diagImagem(q, "imagem_perdida", q.errorMsg);
  }).finally(() => {
    imagensEmAndamento.delete(visual);
    updateQuestionCard(q, state.questions.indexOf(q));
    updateProgress();
  });
  imagePromisesEmAndamento.push(promessa);
}

// Resumo verificável do caminho das imagens da leva atual (também impresso
// como tabela no console). Serve para o professor — e para a depuração —
// confirmarem, questão a questão, que nenhuma imagem obrigatória ficou de fora.
function resumoImagens(){
  const linhas = state.questions.map((q, i) => {
    const pedida = q.recurso === "imagem";
    const v = q.data && q.data.visual;
    const prompt = pedida && v && v.tipo === "imagem" ? imgTextoDeEspecificacao(v.promptImagem, 0).length : 0;
    const diag = Array.isArray(q.diag) ? q.diag : [];
    return {
      questao: i + 1,
      status: q.status,
      imagemPedida: pedida,
      promptCriado: prompt >= 200,
      promptChars: prompt,
      chamadasImagem: diag.filter(d => d.etapa === "imagem_tentativa").length,
      imagemGerada: !!(v && v.imagemDataUrl),
      vinculada: !!(v && v.imagemDataUrl && q.data.visual === v),
      erro: q.status === "error" ? (q.errorMsg || "").slice(0, 120) : "",
    };
  });
  const pedidas = linhas.filter(l => l.imagemPedida);
  const total = {
    pedidas: pedidas.length,
    comPrompt: pedidas.filter(l => l.promptCriado).length,
    chamadas: pedidas.reduce((s, l) => s + l.chamadasImagem, 0),
    geradas: pedidas.filter(l => l.imagemGerada).length,
    vinculadas: pedidas.filter(l => l.vinculada).length,
    semImagem: pedidas.filter(l => !l.imagemGerada).map(l => l.questao),
  };
  return { linhas, total };
}

// Usado pelos botões "Regenerar"/"Mais fácil"/"Mais difícil" de uma questão já
// na tela: gera a questão de novo (com sua nova imagem, se houver), espera a
// imagem terminar e, se este simulado já estiver arquivado em "Meus
// Simulados", atualiza o arquivo — senão a edição feita aqui se perderia na
// próxima vez que o simulado fosse reaberto.
async function regenerarQuestaoEArquivar(q){
  await generateQuestion(q);
  await aguardaImagensPendentes();
  // v17: a auditoria de contextos da leva é refeita (a questão nova pode ter
  // resolvido — ou criado — uma repetição). Só os cartões cuja marcação mudou
  // são redesenhados — renderResults() inteiro descartaria um "Editar" aberto
  // em outra questão e recriaria todos os gráficos.
  try{
    const antes = state.questions.map(o => o.colisaoContexto || null);
    auditaDiversidadeContextos();
    // A própria questão sempre é redesenhada: seu cartão foi montado antes da
    // auditoria e precisa mostrar (ou tirar) o aviso e o botão.
    state.questions.forEach((o, i) => { if(o === q || (o.colisaoContexto || null) !== antes[i]) updateQuestionCard(o, i); });
  }catch(e){ /* nunca interrompe */ }
  if(simuladoAbertoId) await salvarSimuladoAtual();
}

/* Contabilidade de tokens do simulado inteiro. O backend devolve, em cada
   questão, quantos tokens de entrada foram novos, quantos gravaram cache e
   quantos vieram lidos do cache. Somando tudo dá para dizer, ao fim da geração,
   se o aquecimento funcionou — em vez de acreditar que funcionou. */
function zeraUso(){
  // buscasWeb/custoUSD: medição real por questão devolvida pelo backend (v63).
  state.uso = { chamadas: 0, entradaNova: 0, cacheEscrito: 0, cacheLido: 0, saida: 0, buscasWeb: 0, custoUSD: 0 };
}
function somaUso(u){
  if(!state.uso) zeraUso();
  Object.keys(state.uso).forEach(k => { state.uso[k] += Number(u[k]) || 0; });
}
function relatoUso(){
  const u = state.uso;
  if(!u || !u.chamadas) return "";
  const total = u.entradaNova + u.cacheEscrito + u.cacheLido;
  const pct = total ? Math.round((u.cacheLido / total) * 100) : 0;
  return `[tokens] ${u.chamadas} chamadas · entrada nova ${u.entradaNova} · cache escrito ${u.cacheEscrito} · cache lido ${u.cacheLido} (${pct}% da entrada) · saída ${u.saida} · buscas web ${u.buscasWeb || 0} · texto ≈ US$ ${(u.custoUSD || 0).toFixed(4)}`;
}

async function runPool(items, worker, concurrency){
  let i = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while(i < items.length){
      const idx = i++; await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/* v18.11 — A GERAÇÃO TEM UM CAMINHO SÓ. Antes, todo este corpo vivia dentro do
   listener do botão da seção 6. Com o atalho "Gerar simulado" dentro do painel
   do lote (seção 4), ele virou função nomeada e os dois botões a chamam — nada
   é duplicado, então os dois se comportam exatamente igual, hoje e depois. */
function iniciarGeracao(){
  if(!exigirLogin()) return;
  if(!state.area){ toast("Selecione a área do conhecimento.", "err"); return; }
  if(!state.disciplina){ toast("Selecione a disciplina.", "err"); return; }
  /* v18.11 — ORIENTAÇÕES DIGITADAS E NÃO APLICADAS. O campo "Orientações
     adicionais" da seção 4 só chega às questões pelo botão "Aplicar às N
     questões". Digitado e não aplicado, o texto ficava na tela e NÃO ia para a
     IA, em silêncio. Com um "Gerar simulado" logo abaixo do campo, o descuido
     passou a ser provável — então o primeiro clique explica e o segundo, dentro
     de 30 s, gera assim mesmo (mesma mecânica do aviso de disciplina). */
  if(orientacoesDoLotePendentes() && Date.now() - confirmaOrientacoesEm > 30000){
    confirmaOrientacoesEm = Date.now();
    toast('Você escreveu orientações adicionais na seção 4, mas não clicou em "Aplicar às ' + state.questions.length + ' questões" — do jeito que está, esse texto não vai para a IA. Clique em "Aplicar" para valer para todas, ou clique em "Gerar simulado" de novo para gerar sem ele.', "err");
    return;
  }
  confirmaOrientacoesEm = 0;
  simuladoAbertoId = null; // simulado novo, não é edição de um já arquivado
  const sync = sincronizaTemaDoLote();
  if(sync && sync.estado === "aplicado") toast(`Tema do lote aplicado às ${state.questions.length} questões: "${resumoTema(sync.novo, 120)}"${sync.itens > 1 ? ` (${sync.itens} conteúdos em rodízio: ${resumoTema(textoDistribuicaoLote(), 160)})` : ""}.`, "ok");
  if(sync && sync.estado === "atualizado") toast(`Tema do lote atualizado nas ${state.questions.length} questões: "${resumoTema(sync.anterior, 60)}" → "${resumoTema(sync.novo, 120)}"${sync.itens > 1 ? ` (${sync.itens} conteúdos em rodízio: ${resumoTema(textoDistribuicaoLote(), 160)})` : ""}.`, "ok");
  if(sync && sync.sobras && sync.sobras.length) toast(`Você listou ${sync.itens} conteúdos para ${state.questions.length} questões: ${sync.sobras.length === 1 ? "ficou de fora" : "ficaram de fora"} ${sync.sobras.map(t => `"${resumoTema(t, 40)}"`).join(", ")}.`, "err");
  if(sync && sync.estado === "completado") toast(`Tema do lote aplicado ${sync.novas === 1 ? "à 1 questão que estava" : `às ${sync.novas} questões que estavam`} sem tema${sync.itens > 1 ? ` (rodízio: ${resumoTema(textoDistribuicaoLote(), 160)})` : `: "${resumoTema(sync.novo, 120)}"`}.`, "ok");
  if(sync && sync.estado === "individuais") toast(`A caixa "Tema do lote" foi alterada, mas as questões têm temas diferentes entre si — nenhuma foi alterada. Para sobrescrever todas, use "Aplicar".`, "info");
  /* v18.4: rede de segurança da disciplina (ver conteudosForaDaDisciplina).
     Para a PRIMEIRA tentativa e explica; o segundo clique, dentro de 30 s, gera
     assim mesmo — questão de Matemática ambientada em Química é legítima. */
  const fora = conteudosForaDaDisciplina();
  if(fora && Date.now() - confirmaDisciplinaEm > 30000){
    confirmaDisciplinaEm = Date.now();
    toast(`Você selecionou ${state.disciplina}, mas ${fora.quantos === fora.total ? "nenhum dos" : `${fora.total - fora.quantos} de ${fora.total}`} ${fora.total} conteúdos é de ${state.disciplina} — ${fora.quantos === fora.total ? "todos parecem" : "a maioria parece"} de ${fora.outra}. Confira a área e a disciplina acima. Se for mesmo o que você quer, clique em "Gerar" de novo.`, "err");
    return;
  }
  confirmaDisciplinaEm = 0;
  generateAll();
}

async function generateAll(){
  document.getElementById("formPanel").style.display = "none";
  document.getElementById("resultsPanel").style.display = "block";
  document.getElementById("genProgressWrap").classList.remove("hidden");
  /* Reset completo do estado "órfão" de uma geração anterior antes de começar
     uma leva nova. Sem isto, trocar de disciplina no formulário (ex.: Física
     -> Matemática) e clicar em Gerar reaproveita os MESMOS objetos de questão
     (o array não é recriado do zero — syncQuestionsArrayLength só ajusta o
     tamanho) e qualquer instrução de imagem digitada para a disciplina
     anterior ("instrucoesVisual", por questão) sobrevivia e era enviada de
     novo junto com o tema da disciplina nova — podendo produzir uma imagem de
     um assunto completamente diferente do da questão (o backend agora também
     tem uma trava contra isso, mas aqui é onde o problema realmente nasce).
     "approved" também não deveria sobreviver a uma geração nova. */
  /* "instrucoesVisual" NÃO é mais apagada aqui: apagá-la na geração fazia as
     instruções de imagem digitadas no formulário nunca chegarem ao backend na
     primeira geração. A limpeza que motivou isso (instrução de outra
     disciplina sobrevivendo à troca) agora acontece em limpaInstrucoesVisuais,
     chamada ao trocar de área/disciplina e ao aplicar o lote. */
  state.questions.forEach(q => { q.status = "idle"; q.data = null; q.errorMsg = ""; q.gabaritoStatus = null; q.approved = false; });
  // Plano de gabaritos sorteado ANTES de gerar: como as questões saem em
  // paralelo, cada uma precisa saber de antemão qual letra é a sua, senão não há
  // como garantir que não se repitam.
  state.gabaritoPlan = planejaGabaritos(state.questions.length);
  // Eixos temáticos reservados ANTES de gerar (mesma lógica do gabarito: as
  // questões saem em paralelo, então a distribuição tem de ser decidida antes).
  planejaEixosTematicos();
  if(state.questions.some(q => q.eixoTematico)){
    console.log("[tema] eixos reservados: " + state.questions.map((q, i) => `${i + 1}: ${q.eixoTematico || "(tema do professor)"}${q.subtopico ? " › " + q.subtopico : ""}`).join(" · "));
  }
  // v17: domínios de contexto reservados ANTES de gerar (mesma lógica).
  planejaDominios();
  if(state.questions.some(q => q.dominio)){
    console.log("[contexto] domínios reservados: " + state.questions.map((q, i) => `${i + 1}: ${q.dominio}${q.dominioAlt ? " (ou " + q.dominioAlt + ")" : ""}`).join(" · "));
  }
  renderResults();
  updateProgress();
  zeraUso();
  zeraUsoImagem();
  // Recortes planejados ANTES de gerar (mesma lógica do gabarito e dos eixos):
  // uma chamada curta por grupo de questões com o mesmo tema digitado.
  await planejaRecortesPorTema();
  /* AQUECIMENTO DO CACHE. O prompt do sistema tem mais de 25 mil caracteres e é
     o mesmo em todas as questões da área. O backend o manda com cache_control,
     mas quem grava o cache é a primeira chamada — e chamadas simultâneas não
     enxergam o cache uma da outra. Disparando as 4 de uma vez, as 4 pagariam o
     prompt inteiro. Gerando a primeira sozinha, ela grava; as demais leem.
     Custa a espera de uma questão e economiza o prompt em todas as outras. */
  const [primeira, ...demais] = state.questions;
  if(primeira) await generateQuestion(primeira);
  // Concorrência 5 (era 4): cada questão já roda inteiramente no backend
  // (Supabase Edge Function), então gerar mais em paralelo reduz o tempo
  // total — para 10 questões, 3 rodadas em vez de 4. Não muda o número de
  // chamadas nem o custo. Se o plano do Supabase devolver 546
  // (WORKER_RESOURCE_LIMIT) sob carga, generateQuestion já retenta com espera
  // crescente — e esse erro acontece ANTES de a IA ser chamada, então a
  // retentativa não é cobrada. Se esses erros aparecerem com frequência no
  // console, o valor pode voltar para 4.
  if(demais.length) await runPool(demais, generateQuestion, 5);
  document.getElementById("genProgressWrap").classList.add("hidden");
  // v12: baixa o jsPDF (≈ 420 KB) em segundo plano assim que o simulado fica
  // pronto, para o primeiro "Exportar PDF"/"Imprimir" não pagar o download do
  // CDN (0,3–1,5 s). Silencioso: se falhar, o botão tenta de novo na hora.
  loadScriptOnce(CDN_URLS.jspdf).catch(() => {});
  const relato = relatoUso();
  if(relato) console.log(relato);

  // Auditoria da distribuição do gabarito, com o resultado dito em voz alta.
  const presos = state.questions.filter(q => q.gabaritoStatus === "impossivel").length;
  // Notação química: só fica registrada no console (depuração) — não bloqueia
  // mais a exportação nem pede para editar a questão antes de exportar.
  const quimica = auditaQuimica();
  if(quimica.length) console.warn("[notação] problemas encontrados (exportação NÃO bloqueada):", quimica);
  // Diversidade temática: temas entregues muito parecidos são apontados
  // (a leva não é bloqueada — o professor decide se regenera).
  const repetidos = auditaDiversidadeTemas();
  console.log("[tema] temas entregues: " + state.questions.map((q, i) => `${i + 1}: ${q.data && q.data.tema || "—"}`).join(" · "));
  if(repetidos.length){
    console.warn("[tema] temas parecidos na leva:", repetidos);
    toast(`Atenção: questões com assunto parecido — ${repetidos.slice(0, 3).join("; ")}${repetidos.length > 3 ? "; …" : ""}. Use "Regenerar" em uma delas para diversificar.`, "err");
  }
  // v17: contextos repetidos (auditoria local, sem IA). Só avisa e oferece o
  // botão "Outro contexto" no cartão — nada é regenerado sozinho.
  const contextosRepetidos = auditaDiversidadeContextos();
  if(contextosRepetidos.length){
    console.warn("[contexto] contextos repetidos na leva:", contextosRepetidos);
    toast(`Atenção: questões no mesmo contexto — ${contextosRepetidos.slice(0, 3).join("; ")}${contextosRepetidos.length > 3 ? "; …" : ""}. Use "Outro contexto" na questão marcada.`, "err");
    renderResults();
  }
  const problemas = auditaGabaritos();
  if(problemas.length){
    toast("Simulado gerado, mas a distribuição do gabarito ficou imperfeita: " + problemas[0] + ". Regenere a questão para corrigir.", "err");
  }else if(presos){
    toast("Simulado gerado. " + presos + " quest" + (presos > 1 ? "ões vieram" : "ão veio") + " com o gabarito fora da posição planejada e não pôde ser reposicionada sem quebrar a ordem numérica das alternativas.", "err");
  }else{
    toast("Simulado gerado! Revise, edite ou regenere questões conforme necessário.", "ok");
  }

  // As imagens são pedidas ao backend em paralelo ao texto (ver
  // renderGeneratedImage) e por isso ainda podem estar em andamento aqui.
  // Espera todas terminarem ANTES de arquivar, para que o simulado guardado
  // em "Meus Simulados" já leve as imagens prontas — nunca só o texto — e
  // reabri-lo depois não precise (nem vá) gerar nenhuma imagem de novo.
  await aguardaImagensPendentes();

  // Conferência final, questão a questão: nenhuma imagem obrigatória pode
  // ter ficado de fora sem aviso. Tabela completa no console; aviso na tela.
  const resumo = resumoImagens();
  if(resumo.total.pedidas){
    console.table(resumo.linhas);
    console.log(`[imagens] pedidas ${resumo.total.pedidas} · com prompt ${resumo.total.comPrompt} · chamadas ao gerador ${resumo.total.chamadas} · geradas ${resumo.total.geradas} · vinculadas ${resumo.total.vinculadas}` + (resumo.total.semImagem.length ? ` · SEM IMAGEM: questões ${resumo.total.semImagem.join(", ")}` : " · nenhuma faltando"));
    if(resumo.total.semImagem.length){
      toast(`⚠️ ${resumo.total.semImagem.length} questão(ões) com imagem obrigatória NÃO gerada (nº ${resumo.total.semImagem.join(", ")}). Elas estão marcadas com erro — use "Regenerar" ou "Tentar novamente" na imagem.`, "err");
    }
  }

  // Arquiva automaticamente em "Meus Simulados" (todo simulado gerado fica
  // arquivado). Roda por último e nunca interrompe o fluxo do professor —
  // qualquer falha aqui só avisa por toast, sem desfazer o simulado na tela.
  await salvarSimuladoAtual();
}


/* A fórmula é uma unidade visual: não pode ser partida no fim da linha. O Word e
   o navegador quebram depois de um traço de ligação ou do ponto de hidrato, e
   "CH₃–CH₂–" numa linha e "OH" na outra deixa de ser uma fórmula.

   A solução preserva o caractere que a regra determina — o traço continua sendo
   "–", o ponto continua sendo "·" — e insere depois dele um JUNTADOR DE PALAVRA
   (U+2060), que é invisível e não imprime nada: só diz ao compositor que ali não
   se quebra. No PDF ele é removido, porque lá a linha só quebra em espaço.      */
const QUI_LIGACAO = /[A-Za-zÀ-ÿ0-9₀-₉⁰-⁹⁺⁻()\[\]]+(?:[–—·=≡][A-Za-zÀ-ÿ0-9₀-₉⁰-⁹⁺⁻()\[\]]+)+/g;
function quiJuntaFormula(texto){
  let t = String(texto == null ? "" : texto);
  if(/[–—·=≡]/.test(t)){
    t = t.replace(QUI_LIGACAO, tok => {
      // Só amarra o que tem cara de fórmula: precisa de um símbolo de elemento.
      if(!/[A-Z]/.test(tok)) return tok;
      return tok.replace(/([–—·=≡])/g, "$1\u2060");
    });
  }
  // A seta nunca fica órfã no fim da linha: ela é colada ao que vem depois por
  // um espaço inseparável, então a equação longa quebra ANTES da seta — que é a
  // convenção de composição para equações que não cabem na medida.
  t = t.replace(/([→←⇌↔])[ \u00A0]+/g, "$1\u00A0");
  return t;
}

/* ---- AUDITORIA DE NOTAÇÃO QUÍMICA ----

   A fórmula tem de chegar ao estudante pronta: H₂SO₄, SO₄²⁻,
   2 H₂(g) + O₂(g) → 2 H₂O(l). Nunca um comando a ser interpretado depois —
   nada de LaTeX, tag, cifrão, chave ou barra invertida —, e nunca a versão
   mutilada em algarismo comum (H2O, Ca2+, SO4-2).

   Esta auditoria varre TUDO que sai impresso: texto-base, fonte, comando,
   recurso visual, as cinco alternativas, o gabarito, a ficha, a resolução e o
   comentário de cada alternativa. Se algo não passar, o simulado não é
   entregue como concluído (§17 da regra).                                   */

/* ==== NOTAÇÃO MATEMÁTICA (v16) — rede de segurança e verificação ====
   O bloco abaixo, entre as marcas NM-INÍCIO e NM-FIM, é IDÊNTICO ao
   supabase/functions/generate-question/notacao_matematica.ts (sem o export) e
   é testado pelos mesmos casos (nm/casos_notacao.json). Não edite aqui sem
   editar lá. Ele roda sobre toda questão que entra no app — resposta do
   backend, simulado reaberto do arquivo, recurso visual refeito —, de modo que
   os simulados gerados ANTES da v71 (com Q0, 2^4, 10^9) ficam certos ao serem
   reabertos, sem gerar de novo.                                              */
// NM-INÍCIO
/* v71/v16 — REDE DE SEGURANÇA DA NOTAÇÃO MATEMÁTICA (expoentes, índices,
   sinais de operação). Roda em TODAS as áreas, depois da rede química.

   Caso real (13/09/2026, Matemática, simulado "Potenciação, Radiciação…"):
   6 das 20 questões saíram com Q0, S0, P0, 2^4, 10^9, 2^(-t/T), "4,6 x 10^9",
   "S0 . 1". Causa: a regra de notação Unicode e a rede de segurança v70 só
   existiam para Ciências da Natureza. Agora o prompt exige Unicode em todas as
   áreas, e este código corrige, depois que a questão chega, o que o modelo
   ainda escrever em ASCII — só o que for INEQUÍVOCO. O que for ambíguo fica
   como está e é apontado pela verificação do app.

   ESTE ARQUIVO É O MESMO no backend (notacao_matematica.ts, que só acrescenta
   o `export`) e no app (src/app.js, colado sem alteração). Os dois são testados
   com o mesmo arquivo de casos (nm/casos_notacao.json). Não use sintaxe que o
   navegador não entenda; não use `import`.

   Regras (todas com guarda de URL/DOI e sem tocar no campo "fonte" nem no
   "promptImagem"):
   1. Expoente ASCII  base^n · base^-n · base^(…) · base^{…}  → sobrescrito, só
      se TODO o expoente for convertível (dígitos, sinais, parênteses, letras
      que existem em sobrescrito). Expoente "nu" é um número OU uma letra
      (x^2y não converte); a base não pode vir depois de outro ^ (2^3^2 fica);
      expoente terminado em sinal é CARGA química (SO4^2-, ^(2-)) e fica.
      2^(-3/2), 2^(-1,5) ficam (não há sobrescrito para / e ,).
   2. Índice ASCII  base_n · base_{…}  → subscrito, com fim de token
      obrigatório (meu_texto, #enem_2024, IBGE_2022 ficam).
   3. Índice em algarismo comum — letra + 1 dígito (Q0, S0, a1) — só em
      Matemática e Física, só quando o token está encostado num operador
      (= + − · × / ^) em oração com "=" ou na resolução comentada; depois a
      grafia é unificada em toda a questão. Nunca O0–O9 (oxigênio é da rede
      química) nem A4 (papel); rótulos (H2, F1, T4) não têm operador ao lado.
   2b. log10 → log₁₀, log2 → log₂.
   4. Unidades com expoente: m2 cm2 mm2 dm2 km2 m3 cm3 … depois de número ou
      barra; m/s2 → m/s².
   5. Letra x como multiplicação: "4,6 x 10^9" sempre; "3 x 5" só em oração com
      "=" ou seguida de = ^ ) ou expoente. "Brasil 3 x 1 Argentina" fica.
   6. Ponto como multiplicação: "S0 . (1 + i)" → "S₀ · (1 + i)", só entre
      operandos matemáticos.
   7. Radical com barra: "√1000" → √1̅0̅0̅0̅ e "√(x² + 1)" → √x̅²̅ ̅+̅ ̅1̅ — cada
      caractere do radicando recebe o combinante U+0305, de modo que a barra
      começa depois do √ e vai exatamente até o fim do radicando (pedido do
      professor, 14/09/2026). No PDF, pdfSanitizeText troca cada par por um
      glifo pré-composto da fonte (ver fontwork/ampliar_carlito.py).           */

var NM_SUP = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "–": "⁻", "(": "⁽", ")": "⁾", "=": "⁼",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ",
  n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ", K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ", O: "ᴼ",
  P: "ᴾ", R: "ᴿ", T: "ᵀ", U: "ᵁ", W: "ᵂ",
};
var NM_SUB = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "–": "₋", "(": "₍", ")": "₎", "=": "₌",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ",
  t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};
var NM_SUP_DIGITOS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
var NM_SUB_DIGITOS = "₀₁₂₃₄₅₆₇₈₉";

// Converte cada caractere pelo mapa; null se algum não tiver equivalente.
function nmConverte(conteudo, mapa) {
  var s = String(conteudo).replace(/\s+/g, "");
  if (!s) return null;
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = mapa[s.charAt(i)];
    if (c === undefined) return null;
    out += c;
  }
  return out;
}
// Dentro de URL, DOI ou nome de arquivo: nunca mexer.
function nmEmUrl(antesTxt) {
  return /(?:https?:\/\/|www\.|doi\.org\/|doi:|\.pdf|\.html?)\S*$/i.test(antesTxt) || /\S+\.[a-z]{2,4}\/\S*$/i.test(antesTxt);
}
// A oração (entre . ; \n ou início/fim) que contém a posição `pos`.
function nmOracao(str, pos) {
  var ini = pos, fim = pos;
  while (ini > 0 && !/[.;\n!?]/.test(str.charAt(ini - 1))) ini--;
  while (fim < str.length && !/[.;\n!?]/.test(str.charAt(fim))) fim++;
  return str.slice(ini, fim);
}

// 1) expoentes:  x^2  10^-3  2^(n-1)  (1+i)^t  e^{kt}
var NM_RE_EXPOENTE = /(?<![\^_])([\p{L}\p{Nd}\)\]₀-₉])\^(\{[^{}\n]{1,40}\}|\([^()\n]{1,40}\)|[+\-−–]?\d{1,3}(?![\p{Nd}\^_])|[A-Za-z](?![\p{L}\p{Nd}\^_]))/gu;
function nmExpoentes(texto) {
  return texto.replace(NM_RE_EXPOENTE, function (m0, base, exp, offset, str) {
    var antesTxt = str.slice(0, offset);
    if (nmEmUrl(antesTxt)) return m0;
    var depois = str.slice(offset + m0.length);
    var grupo = /^[\{\(]/.test(exp);
    var conteudo = grupo ? exp.slice(1, -1) : exp;
    var compacto = conteudo.replace(/\s+/g, "");
    if (!compacto) return m0;
    // carga química: expoente terminado em sinal (^(2-), ^{2+}) ou número
    // seguido de sinal que não continua expressão — "SO4^2-", "Ca^2+ (aq)",
    // "Fe^3+(aq)" são carga; "x^2-3x" e "x^2-(x+1)" são expressão.
    if (grupo && /[+\-−–]$/.test(compacto)) return m0;
    if (!grupo && /^[+\-−–](?![\p{L}\p{Nd}]|\((?!(?:aq|g|s|l|v)\)))/u.test(depois)) return m0;
    // expoente nu: número OU uma letra — nunca mistura (x^2y)
    if (!grupo && !/^(?:[+\-−–]?\d{1,3}|[A-Za-z])$/.test(compacto)) return m0;
    var conv = nmConverte(compacto, NM_SUP);
    return conv === null ? m0 : base + conv;
  });
}

// 2) índices:  Q_0  a_n  x_{12}  a_{n-1}
// A base de um índice é UMA letra (variável), uma função (log₂, senₙ…) ou um
// fecho de parêntese — nunca o fim de uma palavra (@joao_2, meu_texto ficam).
var NM_RE_INDICE = /((?<![\^_\p{L}\p{Nd}])(?:\p{L}|log|sen|cos|tg|lim|max|min)|(?<![\^_])[\)\]])_(\{[^{}\n]{1,20}\}|\([^()\n]{1,20}\)|\d{1,2}|[A-Za-z])(?![\p{L}\p{Nd}_])/gu;   // "v_0^2" → v₀ e depois v₀²
function nmIndices(texto) {
  return texto.replace(NM_RE_INDICE, function (m0, base, idx, offset, str) {
    if (nmEmUrl(str.slice(0, offset))) return m0;
    var grupo = /^[\{\(]/.test(idx);
    var conteudo = grupo ? idx.slice(1, -1) : idx;
    var conv = nmConverte(conteudo, NM_SUB);
    return conv === null ? m0 : base + conv;
  });
}

// 2b) logaritmo com base em algarismo comum:  log10 → log₁₀   log2 → log₂
// Só quando vem um ARGUMENTO depois (log10(x), log2 8): "adote log2 = 0,30",
// "2·log2 + log3", "log2/log3" são o logaritmo DE 2, não na base 2 — ficam.
var NM_RE_LOG = /(?<![\p{L}\p{Nd}])log(\d{1,2})(?![\p{L}\p{Nd}])(?!\s*[=≈≅<>+\-−–·×\/])(?=\s*\(|\s+(?:[\p{Nd}√]|[b-df-np-tv-zA-Z](?![\p{L}])))/gu;   // argumento: "(", número, √ ou UMA variável (não "e", "a", "o", "u", conjunções)
function nmLogaritmos(texto) {
  return texto.replace(NM_RE_LOG, function (m0, b, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : "log" + nmConverte(b, NM_SUB); });
}

// 4) unidades:  5 m2 → 5 m²   kg/m3 → kg/m³   m/s2 → m/s²
var NM_RE_UNIDADE = /(?<=\d\s?|\/)(m|cm|mm|dm|km)([23])(?![\p{L}\p{Nd}])/gu;
var NM_RE_UNIDADE_S = /(?<=\/)s2(?![\p{L}\p{Nd}])/gu;
function nmUnidades(texto) {
  return texto
    .replace(NM_RE_UNIDADE, function (m0, u, d, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : u + NM_SUP[d]; })
    .replace(NM_RE_UNIDADE_S, function (m0, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : "s²"; });
}

// 5) letra x como multiplicação
var NM_RE_X_DEZ = /(\d)\s?x\s?(?=10(?:\^|[⁰¹²³⁴⁵⁶⁷⁸⁹]))/g;
var NM_RE_X_NUM = /(\d)\s+x\s+(?=\d)/g;
function nmMultiplicacaoX(texto) {
  var t = texto.replace(NM_RE_X_DEZ, function (m0, d, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : d + " × "; });
  return t.replace(NM_RE_X_NUM, function (m0, d, offset, str) {
    if (nmEmUrl(str.slice(0, offset))) return m0;
    var depois = str.slice(offset + m0.length);
    var oracao = nmOracao(str, offset);
    var forte = /^\d+(?:[,.]\d+)?\s*(?:=|\^|[⁰¹²³⁴⁵⁶⁷⁸⁹]|\))/.test(depois) || /=/.test(oracao);
    return forte ? d + " × " : m0;
  });
}

// 6) ponto como multiplicação:  S0 . (1 + i)  → S0 · (1 + i)
var NM_RE_PONTO = /(\d|\)|(?<![\p{L}\p{Nd}])[A-Za-z][₀-₉\d]?)\s\.\s(?=\d|\(|[a-z](?![\p{L}])|[A-Za-z][₀-₉\d](?![\p{L}\p{Nd}]))/gu;
function nmPontoMultiplicacao(texto) {
  return texto.replace(NM_RE_PONTO, function (m0, a, offset, str) {
    if (nmEmUrl(str.slice(0, offset))) return m0;
    // Só em contexto de conta: oração com "=" ou parêntese depois ("S0 . (1 + i)").
    // "Lei n . 9", "R$ 5 . 000", "(2019) . a autora" ficam.
    var depois = str.slice(offset + m0.length);
    if (!/=/.test(nmOracao(str, offset)) && depois.charAt(0) !== "(" && !/^10(?:\^|[⁰¹²³⁴⁵⁶⁷⁸⁹])/.test(depois)) return m0;   // "1,5 . 10^3 kg" é notação científica
    return a + " · ";
  });
}

// 7) radical com barra sobre o radicando inteiro
var NM_SOBRELINHA = "\u0305";
// radicando "nu":
// (número com decimal, OU 1–3 letras — "√ab" é √(a·b) —, com expoente já em sobrescrito)
var NM_RE_RADICANDO_NU = /^(?:\d+(?:[,.]\d+)?|[A-Za-zπ]{1,3})[⁰¹²³⁴⁵⁶⁷⁸⁹]*/u;
function nmSobrelinha(radicando) {
  var out = "";
  for (var ch of radicando) out += ch + NM_SOBRELINHA;
  return out;
}
function nmRadicais(texto) {
  var out = "", i = 0;
  while (i < texto.length) {
    var k = texto.indexOf("√", i);
    if (k < 0) { out += texto.slice(i); break; }
    out += texto.slice(i, k + 1); i = k + 1;
    if (nmEmUrl(texto.slice(0, k))) continue;
    var resto = texto.slice(i);
    if (resto.charAt(1) === NM_SOBRELINHA) continue;              // já tem barra (idempotente)
    if (resto.charAt(0) === "(") {
      // grupo balanceado, curto, sem quebra de linha: "√(x² + 1)" → barra sobre "x² + 1" (sem os parênteses)
      var prof = 0, fim = -1;
      for (var j = 0; j < resto.length && j < 60; j++) {
        var c = resto.charAt(j);
        if (c === "\n") break;
        if (c === "(") prof++;
        else if (c === ")") { prof--; if (prof === 0) { fim = j; break; } }
      }
      if (fim > 1) { out += nmSobrelinha(resto.slice(1, fim)); i += fim + 1; }
      continue;
    }
    var m = NM_RE_RADICANDO_NU.exec(resto);
    if (m && m[0]) { out += nmSobrelinha(m[0]); i += m[0].length; }
  }
  return out;
}

// Texto isolado (sem a regra 3, que precisa da questão inteira).
function nmNormalizaTexto(texto) {
  if (typeof texto !== "string" || !texto) return texto;
  var t = texto;
  t = nmPontoMultiplicacao(t);
  t = nmMultiplicacaoX(t);
  t = nmIndices(t);       // antes dos expoentes: "v_0^2" → "v₀^2" → "v₀²"
  t = nmExpoentes(t);
  t = nmLogaritmos(t);
  t = nmUnidades(t);
  t = nmRadicais(t);      // por último: depois disto o radicando carrega U+0305 entre os caracteres
  return t;
}

// 3) letra + 1 dígito (Q0, S0, a1) — candidatos com evidência forte.
var NM_RE_LETRA_DIGITO = /(?<![\p{L}\p{Nd}_\^.,])([A-Za-z])(\d)(?![\p{L}\p{Nd}]|[,.]\d)/gu;   // "A/A0" conta: a barra é operador
var NM_OPERADOR = /[=+\-−–·×\/\^*]\s*$/;
var NM_OPERADOR_DEPOIS = /^\s*[=+\-−–·×\/\^*]/;
function nmDisciplinaComIndices(disciplina) {
  var d = String(disciplina || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return d === "matematica" || d === "fisica";
}
function nmTokenPermitido(letra, _disciplina) {
  // "O2" é oxigênio (a rede química decide); os demais rótulos (H2, F1, N2,
  // T4, C3) já ficam protegidos pela exigência de operador + oração com "="
  // — um rótulo não entra em conta. Corpus real: A0, E1, M2, N0, R1, L1, H1
  // aparecem em fórmulas de Matemática e Física e precisam do índice.
  return letra !== "O";
}
function nmColetaCandidatos(texto, campo, disciplina, conjunto) {
  if (typeof texto !== "string" || !texto) return;
  var re = new RegExp(NM_RE_LETRA_DIGITO.source, "gu"), m;
  while ((m = re.exec(texto))) {
    var tok = m[1] + m[2];
    if (tok === "A4" || !nmTokenPermitido(m[1], disciplina)) continue;
    var antes = texto.slice(0, m.index), depois = texto.slice(m.index + tok.length);
    if (nmEmUrl(antes)) continue;
    var operador = NM_OPERADOR.test(antes) || NM_OPERADOR_DEPOIS.test(depois);
    if (!operador) continue;
    // o outro lado do operador tem de ser operando matemático (número, variável, parêntese)
    var outroLado = NM_OPERADOR.test(antes)
      ? /[\p{L}\p{Nd}\)\]₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]\s*[=+\-−–·×\/\^*]\s*$/u.test(antes)
      : /^\s*[=+\-−–·×\/\^*]\s*[\p{L}\p{Nd}\(]/u.test(depois);
    if (!outroLado) continue;
    var forte = campo === "resolucaoComentada" || /=/.test(nmOracao(texto, m.index));
    if (forte) conjunto[tok] = m[1] + NM_SUB[m[2]];
  }
}
function nmAplicaCandidatos(texto, conjunto) {
  if (typeof texto !== "string" || !texto) return texto;
  var toks = Object.keys(conjunto);
  if (!toks.length) return texto;
  var re = new RegExp("(?<![\\p{L}\\p{Nd}_\\^.,])(" + toks.join("|") + ")(?![\\p{L}\\p{Nd}]|[,.]\\d)", "gu");
  return texto.replace(re, function (m0, tok, offset, str) { return nmEmUrl(str.slice(0, offset)) ? m0 : conjunto[tok]; });
}

var NM_CAMPOS_TEXTO = ["tema", "textoBase", "comando", "resolucaoComentada"];   // "fonte" fica fora de propósito
// Percorre todos os campos de texto da questão aplicando fn(texto, nomeDoCampo).
function nmPercorre(data, fn) {
  var saida = {};
  for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) saida[k] = data[k];
  for (var i = 0; i < NM_CAMPOS_TEXTO.length; i++) {
    var c = NM_CAMPOS_TEXTO[i];
    if (typeof saida[c] === "string") saida[c] = fn(saida[c], c);
  }
  if (saida.alternativas && typeof saida.alternativas === "object" && !Array.isArray(saida.alternativas)) {
    var alt = {};
    for (var L in saida.alternativas) if (Object.prototype.hasOwnProperty.call(saida.alternativas, L)) {
      alt[L] = typeof saida.alternativas[L] === "string" ? fn(saida.alternativas[L], "alternativas") : saida.alternativas[L];
    }
    saida.alternativas = alt;
  }
  if (saida.analiseAlternativas && typeof saida.analiseAlternativas === "object" && !Array.isArray(saida.analiseAlternativas)) {
    var an = {};
    for (var M in saida.analiseAlternativas) if (Object.prototype.hasOwnProperty.call(saida.analiseAlternativas, M)) {
      var a = saida.analiseAlternativas[M];
      if (a && typeof a === "object" && typeof a.comentario === "string") {
        var b = {};
        for (var kk in a) if (Object.prototype.hasOwnProperty.call(a, kk)) b[kk] = a[kk];
        b.comentario = fn(a.comentario, "analiseAlternativas");
        an[M] = b;
      } else an[M] = a;
    }
    saida.analiseAlternativas = an;
  }
  if (saida.visual && typeof saida.visual === "object" && !Array.isArray(saida.visual)) {
    var v = {};
    for (var kv in saida.visual) if (Object.prototype.hasOwnProperty.call(saida.visual, kv)) v[kv] = saida.visual[kv];
    if (typeof v.titulo === "string") v.titulo = fn(v.titulo, "visual");
    if (typeof v.descricao === "string") v.descricao = fn(v.descricao, "visual");
    if (Array.isArray(v.labels)) v.labels = v.labels.map(function (x) { return typeof x === "string" ? fn(x, "visual") : x; });
    if (Array.isArray(v.colunas)) v.colunas = v.colunas.map(function (x) { return typeof x === "string" ? fn(x, "visual") : x; });
    if (Array.isArray(v.linhas)) v.linhas = v.linhas.map(function (l) { return Array.isArray(l) ? l.map(function (x) { return typeof x === "string" ? fn(x, "visual") : x; }) : l; });
    if (Array.isArray(v.datasets)) v.datasets = v.datasets.map(function (ds) {
      if (!ds || typeof ds !== "object" || typeof ds.label !== "string") return ds;
      var d2 = {}; for (var kd in ds) if (Object.prototype.hasOwnProperty.call(ds, kd)) d2[kd] = ds[kd];
      d2.label = fn(ds.label, "visual"); return d2;
    });
    saida.visual = v;
  }
  return saida;
}

// Questão inteira (objeto do backend/app). Idempotente. Nunca lança: em caso
// de erro devolve a questão como veio.
// Questões de planilha eletrônica: "B2 = A1 + A2" são células, não índices.
var NM_RE_PLANILHA = /planilha|c[ée]lula\s+[A-Z]\d|excel|libreoffice|coluna [A-Z]\b/i;   // "célula fotovoltaica" não é planilha
function nmNormalizaQuestao(data, disciplina) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  try {
    var saida = nmPercorre(data, function (t) { return nmNormalizaTexto(t); });
    if (nmDisciplinaComIndices(disciplina)) {
      var conjunto = {}, todoTexto = "";
      nmPercorre(saida, function (t, campo) { todoTexto += t + "\n"; nmColetaCandidatos(t, campo, disciplina, conjunto); return t; });
      if (NM_RE_PLANILHA.test(todoTexto)) conjunto = {};
      // Minúscula + dígito ≥ 2 ("x2") é a grafia ASCII de x² tanto quanto de x₂:
      // só vira índice se a mesma letra aparecer com índice 1 na questão (x1 e x2,
      // raízes; a1 e a2, termos). "Resolva x2 - 5x + 6 = 0" fica (e o prompt proíbe).
      Object.keys(conjunto).forEach(function (tok) {
        if (/^[a-z][2-9]$/.test(tok) && !new RegExp("(?<![\\p{L}\\p{Nd}])" + tok.charAt(0) + "[1₁](?![\\p{L}\\p{Nd}])", "u").test(todoTexto)) delete conjunto[tok];
      });
      if (Object.keys(conjunto).length) saida = nmPercorre(saida, function (t) { return nmAplicaCandidatos(t, conjunto); });
    }
    return saida;
  } catch (_e) {
    return data;
  }
}

// Verificação (app): o que sobrou em ASCII depois da normalização.
var NM_AUDITORIA = [
  { re: /[\p{L}\p{Nd}\)\]]\^/u, o: "expoente com acento circunflexo (use x², 10⁻³, 2ˣ)" },
  { re: /(?<![\p{L}\p{Nd}])(?:\p{L}|log|sen|cos|tg|lim|max|min|\)|\])_(?:\{|\(|\d{1,2}(?![\p{Nd}]))/u, o: "índice com sublinhado (use Q₀, aₙ)" },
  { re: /\\(?:frac|sqrt|cdot|times|pi|le|ge|neq|left|right|text|mathrm)\b/, o: "comando LaTeX" },
  { re: /\bsqrt\s*\(/i, o: "raiz como texto (use √)" },
  { re: /\d\s+x\s+\d+(?:[,.]\d+)?\s*(?:=|\^|[⁰¹²³⁴⁵⁶⁷⁸⁹])/, o: "letra x como sinal de multiplicação (use ×)" },
];
function nmAudita(texto) {
  var achados = [];
  if (typeof texto !== "string" || !texto) return achados;
  for (var i = 0; i < NM_AUDITORIA.length; i++) if (NM_AUDITORIA[i].re.test(texto)) achados.push(NM_AUDITORIA[i].o);
  return achados;
}
// NM-FIM

// Aplica a normalização à questão SEM trocar os objetos (q.data e q.data.visual
// mantêm a identidade: imagensEmAndamento é indexado pelo objeto "visual").
function nmAplicaNaQuestao(q){
  try{
    if(!q || !q.data || typeof q.data !== "object") return;
    const n = nmNormalizaQuestao(q.data, state.disciplina || q.data.disciplina || "");
    if(!n || n === q.data) return;
    if(q.data.visual && typeof q.data.visual === "object" && n.visual && typeof n.visual === "object"){
      Object.assign(q.data.visual, n.visual); n.visual = q.data.visual;
    }
    Object.assign(q.data, n);
  }catch(e){ console.warn("[notação] normalização matemática ignorada:", e); }
}

const QUI_INF = "₀₁₂₃₄₅₆₇₈₉";
const QUI_SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻";

// Símbolos oficiais dos elementos químicos (IUPAC) — usados para exigir que um
// trecho candidato a "fórmula"/"carga" mutilada corresponda de fato a um
// elemento real, e não a uma variável ou rótulo comum de Matemática, Física ou
// Geometria (V1, T2, P0, E0, A2...) que por acaso tem a forma de letra
// maiúscula + dígito. Sem essa checagem, esses rótulos — extremamente comuns
// fora da Química — eram confundidos com fórmula/carga quebrada e bloqueavam
// a exportação (PDF/DOCX/HTML/impressão) de simulados que não tinham erro nenhum.
const QUI_ELEMENTOS = new Set([
  "H","He","Li","Be","B","C","N","O","F","Ne","Na","Mg","Al","Si","P","S","Cl","Ar",
  "K","Ca","Sc","Ti","V","Cr","Mn","Fe","Co","Ni","Cu","Zn","Ga","Ge","As","Se","Br","Kr",
  "Rb","Sr","Y","Zr","Nb","Mo","Tc","Ru","Rh","Pd","Ag","Cd","In","Sn","Sb","Te","I","Xe",
  "Cs","Ba","La","Ce","Pr","Nd","Pm","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu",
  "Hf","Ta","W","Re","Os","Ir","Pt","Au","Hg","Tl","Pb","Bi","Po","At","Rn",
  "Fr","Ra","Ac","Th","Pa","U","Np","Pu","Am","Cm","Bk","Cf","Es","Fm","Md","No","Lr",
  "Rf","Db","Sg","Bh","Hs","Mt","Ds","Rg","Cn","Nh","Fl","Mc","Lv","Ts","Og",
]);

// 1) Códigos de renderização — proibidos sem exceção.
const QUI_CODIGOS = [
  { re: /\\(?:ce|frac|text|mathrm|cdot|rightarrow|leftarrow|times|pm|sqrt|begin|end)\b/, o: "comando LaTeX" },
  { re: /\$\$?[^$\n]*\$\$?/,                     o: "cifrão de fórmula matemática" },
  { re: /\\\(|\\\)|\\\[|\\\]/,                   o: "delimitador matemático" },
  { re: /[_^]\{[^}]*\}/,                          o: "índice ou expoente em chaves" },
  { re: /<\/?(?:sub|sup|span|i|b|em|strong|math|mi|mn|msub|msup)\b[^>]*>/i, o: "tag HTML" },
  { re: /&(?:nbsp|amp|lt|gt|#\d+);/,             o: "entidade HTML" },
  { re: /```|~~~/,                                o: "bloco de código" },
];

// 2) Fórmula com índice em algarismo comum: H2O, Fe2O3, Al2(SO4)3.
const QUI_INDICE_ASCII = /(?:[A-Z][a-z]?\d{1,3}|\)\d{1,3}|\]\d{1,3})(?:[A-Z][a-z]?\d{0,3}|[()\[\]])*/g;
// 3) Carga escrita fora do padrão: Ca2+, Ca+2, SO4-2, SO₄2-.
// Quando o gatilho é uma LETRA maiúscula solta (não parêntese/colchete de
// fecho, nem dígito já subscrito — esses dois são inequívocos por si só), ela
// só conta como carga se for de fato um símbolo de elemento (QUI_ELEMENTOS) —
// senão "V1-V2" (diferença de velocidades) ou "P1+P2" (soma de pontos), comuns
// em Física/Matemática, seriam confundidos com carga química mal escrita.
const QUI_CARGA_ERRADA = [
  { re: /\b([A-Z][a-z]?)\d{1,2}[+\-](?![\d\-])/, o: "carga em algarismo comum (use Ca²⁺, não Ca2+)", precisaElemento: true },
  { re: /(\)|\])\d{1,2}[+\-](?![\d\-])/,         o: "carga em algarismo comum (use Ca²⁺, não Ca2+)", precisaElemento: false },
  { re: /([₀-₉])\d{1,2}[+\-](?![\d\-])/,         o: "carga em algarismo comum (use Ca²⁺, não Ca2+)", precisaElemento: false },
  { re: /\b([A-Z][a-z]?)[+\-]\d{1,2}(?![\d])/,   o: "sinal antes do número da carga (use Ca²⁺, não Ca+2)", precisaElemento: true },
  { re: /(\)|\])[+\-]\d{1,2}(?![\d])/,           o: "sinal antes do número da carga (use Ca²⁺, não Ca+2)", precisaElemento: false },
  { re: /([₀-₉])[+\-]\d{1,2}(?![\d])/,           o: "sinal antes do número da carga (use Ca²⁺, não Ca+2)", precisaElemento: false },
  // Só vale para CARGA (o sinal vem depois de uma espécie química). Expoente
  // matemático — 1,5 × 10⁻³ — tem o sinal antes do número e está certo assim.
  // v16: "⁻¹" depois de letra ou ")" é EXPOENTE (K⁻¹, mol⁻¹, (1/2)⁻⁵, f⁻¹) e não
  // carga — só o "+" denuncia carga fora de ordem (Ca⁺²); depois de índice
  // subscrito (SO₄⁻²) qualquer sinal continua acusado.
  { re: /\b([A-Z][a-z]?)⁺[⁰¹²³⁴⁵⁶⁷⁸⁹]/,           o: "sinal antes do número da carga (use ²⁺, não ⁺²)", precisaElemento: true },
  { re: /([\)\]])⁺[⁰¹²³⁴⁵⁶⁷⁸⁹]/,                   o: "sinal antes do número da carga (use ²⁺, não ⁺²)", precisaElemento: false },
  { re: /([₀-₉])[⁺⁻][⁰¹²³⁴⁵⁶⁷⁸⁹]/,                 o: "sinal antes do número da carga (use ²⁺, não ⁺²)", precisaElemento: false },
];
// 4) Seta montada com caracteres separados — proibida sem exceção. Só acusa
//    quando a sequência está funcionando COMO seta numa expressão química, isto
//    é, com espécie química de um dos lados.
const QUI_ESPECIE = "[A-Za-z0-9₀-₉⁰-⁹⁺⁻()\\[\\]·]";
const QUI_SETA_FALSA = new RegExp(
  QUI_ESPECIE + "\\s*(?:<=+>|<-+>|-+>|=+>|<-+|<=+)\\s*" + QUI_ESPECIE);
// 5) ↔ é ressonância, não equilíbrio: entre espécies com estado físico, o certo é ⇌.
const QUI_RESSONANCIA_ERRADA = /\([slgaq]{1,2}\)\s*↔|↔\s*\d*\s*[A-Z][a-z]?[₀-₉]*\(/;
// 6) Caractere solto: índice ou expoente separado da fórmula por espaço.
const QUI_SOLTO = new RegExp("[A-Za-z\\)\\]]\\s+[" + QUI_INF + QUI_SUP + "]");

// Normaliza a fórmula para comparar grafias: índices e expoentes viram
// algarismo comum, para que "H₂SO₄" e "H2SO4" colidam e a inconsistência apareça.
function quiNormaliza(t){
  let s = String(t);
  for(let i = 0; i < 10; i++){
    s = s.split(QUI_INF[i]).join(String(i)).split(QUI_SUP[i]).join(String(i));
  }
  return s.split("⁺").join("+").split("⁻").join("-");
}

function quiEhFormula(tok){
  // Precisa ter cara de substância: pelo menos um símbolo de elemento e um
  // dígito colado. Descarta "2025", "Caderno 7" e afins.
  if(!/[A-Z]/.test(tok) || !/\d/.test(tok)) return false;
  if(/^[A-Z]\d{4,}$/.test(tok)) return false;              // código, não fórmula
  // v16: com a verificação valendo em todas as áreas, "H10"…"H30" (código de
  // habilidade da Matriz, citado em resoluções) não pode ser lido como
  // hidrogênio com índice 10–30 — não existe tal substância.
  const nu = tok.replace(/[()\[\]]/g, "");
  if(/^H\d{2}$/.test(nu) || /^H[13-9]$/.test(nu)) return false;
  // Só conta como fórmula mutilada se houver pelo menos um grupo ELEMENTO+DÍGITO
  // em que (a) o dígito vale 2 ou mais — um índice químico de valor 1 nunca é
  // escrito (é "H", nunca "H1") — e (b) a letra é de fato um símbolo oficial de
  // elemento (QUI_ELEMENTOS). Sem essas duas condições juntas, "E0", "V1", "T2",
  // "A3" e outros rótulos/variáveis comuns de Matemática e Física seriam
  // confundidos com fórmula química mutilada e bloqueariam a exportação de um
  // simulado sem erro nenhum.
  const grupos = tok.match(/[A-Z][a-z]?\d+/g) || [];
  return grupos.some(g => {
    const letra = g.match(/^[A-Z][a-z]?/)[0];
    const digito = Number(g.match(/\d+/)[0]);
    return digito >= 2 && QUI_ELEMENTOS.has(letra);
  });
}

function quiCamposDaQuestao(q, idx){
  const d = (q && q.data) || {};
  const campos = [];
  const add = (rotulo, valor) => { if(valor) campos.push({ rotulo, texto: String(valor) }); };
  add("texto-base", d.textoBase);
  add("referência", d.fonte);
  add("comando", d.comando);
  if(d.visual){
    add("título do recurso visual", d.visual.titulo);
    add("descrição do recurso visual", d.visual.descricao);
    (d.visual.colunas || []).forEach((c, i) => add("cabeçalho da tabela (coluna " + (i + 1) + ")", c));
    (d.visual.linhas || []).forEach(l => (l || []).forEach(c => add("célula da tabela", c)));
    add("prompt da imagem", d.visual.prompt);
  }
  ["A","B","C","D","E"].forEach(L => add("alternativa " + L, d.alternativas && d.alternativas[L]));
  add("objeto de conhecimento", d.objetoConhecimento);
  add("resolução comentada", d.resolucaoComentada);
  const an = d.analiseAlternativas || {};
  ["A","B","C","D","E"].forEach(L => add("comentário da alternativa " + L, an[L] && an[L].comentario));
  return campos.map(c => Object.assign(c, { questao: idx + 1 }));
}

function auditaQuimica(questoes){
  const lista = questoes || state.questions;
  const problemas = [];
  const grafias = new Map();                 // fórmula normalizada → grafias vistas
  const registra = (c, o) => problemas.push({
    questao: c.questao, campo: c.rotulo, ocorrencia: o,
  });

  lista.forEach((q, idx) => {
    if(!q || !q.data) return;
    quiCamposDaQuestao(q, idx).forEach(campo => {
      const t = campo.texto;

      QUI_CODIGOS.forEach(r => { if(r.re.test(t)) registra(campo, r.o); });
      QUI_CARGA_ERRADA.forEach(r => {
        const m = t.match(r.re);
        if(!m) return;
        if(r.precisaElemento && !QUI_ELEMENTOS.has(m[1])) return;
        registra(campo, r.o);
      });
      if(QUI_SETA_FALSA.test(t)){
        registra(campo, "seta montada com caracteres separados (use → ← ⇌ ↔ ↑ ↓)");
      }
      if(QUI_RESSONANCIA_ERRADA.test(t)){
        registra(campo, "↔ usado como equilíbrio químico (o símbolo de equilíbrio é ⇌)");
      }
      if(QUI_SOLTO.test(t)) registra(campo, "índice ou carga separado da fórmula");

      const achados = t.match(QUI_INDICE_ASCII) || [];
      achados.filter(quiEhFormula).forEach(f => {
        registra(campo, "fórmula com índice em algarismo comum: " + f);
      });

      // Consistência (§12): a mesma substância em duas grafias na mesma prova.
      const corretas = t.match(new RegExp("[A-Z][A-Za-z()\\[\\]·" + QUI_INF + QUI_SUP + "]*[" + QUI_INF + QUI_SUP + "][A-Za-z()\\[\\]·" + QUI_INF + QUI_SUP + "]*", "g")) || [];
      corretas.concat(achados.filter(quiEhFormula)).forEach(f => {
        const chave = quiNormaliza(f);
        if(!grafias.has(chave)) grafias.set(chave, new Set());
        grafias.get(chave).add(f);
      });
    });
  });

  grafias.forEach((formas, chave) => {
    if(formas.size > 1){
      problemas.push({ questao: null, campo: "consistência",
        ocorrencia: "a mesma substância aparece como " + Array.from(formas).join(" e ") });
    }
  });

  // Caracteres que o PDF não conseguiria imprimir com a fonte embarcada.
  auditaGlifosPdf(lista).forEach(p => problemas.push(p));
  return problemas;
}

// v16: a checagem de glifos da fonte do PDF vale para TODAS as áreas (2ˣ, aₙ,
// ∈, ℝ…) e por isso vive separada das regras químicas, que só fazem sentido em
// Ciências da Natureza (fora dela, "COP30", "MP3", "U2", "B12" seriam acusados
// como fórmula mutilada).
// v14: os que têm equivalente (PDF_EQUIVALENTES) não são problema — o PDF os
// imprime pelo equivalente; ficam registrados só como observação informativa.
function auditaGlifosPdf(questoes){
  const lista = questoes || state.questions;
  const problemas = [];
  if(typeof CARLITO_COBERTURA !== "string") return problemas;
  const cobertura = new Set(Array.from(CARLITO_COBERTURA).concat(["\n","\t","\r","\u2060"]));
  const equivalentes = (typeof PDF_EQUIVALENTES === "object" && PDF_EQUIVALENTES) || {};
  lista.forEach((q, idx) => {
    if(!q || !q.data) return;
    quiCamposDaQuestao(q, idx).forEach(campo => {
      const todos = Array.from(new Set(Array.from(campo.texto).filter(ch => !cobertura.has(ch))));
      const fora = todos.filter(ch => equivalentes[ch] === undefined);
      const subst = todos.filter(ch => equivalentes[ch] !== undefined && equivalentes[ch] !== "");
      if(fora.length) problemas.push({ questao: campo.questao, campo: campo.rotulo,
        ocorrencia: "caractere sem glifo na fonte do PDF: " + fora.join(" ") });
      if(subst.length) problemas.push({ questao: campo.questao, campo: campo.rotulo, informativo: true,
        ocorrencia: "no PDF, " + subst.map(ch => ch + " sai como " + equivalentes[ch]).join("; ") });
    });
  });
  return problemas;
}

// Mensagem única, no formato que a regra manda (§17).
function avisoQuimica(problemas){
  if(!problemas.length) return "";
  const p = problemas[0];
  const onde = p.questao ? ("questão " + p.questao + ", " + p.campo) : p.campo;
  const resto = problemas.length > 1 ? (" (+" + (problemas.length - 1) + " ocorrência" + (problemas.length > 2 ? "s" : "") + ")") : "";
  return "REVISÃO DE NOTAÇÃO NECESSÁRIA: " + onde + " — " + p.ocorrencia + "." + resto;
}

/* Porta de saída DESATIVADA a pedido do professor. Antes, nenhum PDF, DOCX,
   HTML ou impressão saía com fórmula química suspeita — a exportação era
   bloqueada e pedia para corrigir a questão antes de tentar de novo. Agora a
   auditoria continua rodando (útil para depuração), mas NUNCA bloqueia: o
   simulado é exportado imediatamente, sem nenhuma restrição, mesmo que a
   notação química de alguma questão pareça estranha. */
function bloqueiaSeQuimicaInvalida(doneQuestions){
  try{
    const problemas = auditaQuimica(doneQuestions.map(o => o.q));
    if(problemas.length) console.warn("[notação] problemas encontrados (exportação NÃO bloqueada):", problemas);
  }catch(e){}
  return false;
}

/* v18.9 — TRAVA DE ENTREGA. Nenhuma questão em que o gabarito e a análise das
   alternativas apontem letras diferentes sai em PDF, Word, impressão ou HTML: o
   caderno do professor marcaria uma alternativa e a folha de respostas do
   aluno, outra. Diferente da auditoria de notação — que só registra no console
   —, esta bloqueia de verdade, nomeia as questões e manda regenerar. Cobre
   também simulados salvos antes desta versão, que nunca passaram pela trava da
   geração. */
function bloqueiaSeGabaritoInconsistente(doneQuestions){
  const ruins = [];
  (doneQuestions || []).forEach(o => {
    const conf = conferenciaGabarito(o.q && o.q.data);
    if(conf.estado !== "ok") ruins.push({ n: o.idx + 1, motivo: conf.motivo });
  });
  if(!ruins.length) return false;
  console.error("[gabarito] exportação bloqueada:", ruins);
  const lista = ruins.length === 1
    ? "a questão " + ruins[0].n + " está"
    : "as questões " + ruins.map(r => r.n).join(", ") + " estão";
  toast("Exportação bloqueada: " + lista + " com o gabarito inconsistente. " + ruins[0].motivo +
        ' Use "Regenerar" antes de exportar — assim o caderno do professor e a folha de respostas do aluno não saem se contradizendo.', "err");
  return true;
}

function updateProgress(){
  const total = state.questions.length;
  const done = state.questions.filter(q => q.status === "done" || q.status === "error").length;
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById("genProgressFill").style.width = pct + "%";
  const temaComum = temaDaLevaParaTitulo();
  const rodizio = temaLoteComum() ? ` · distribuição: ${resumoTema(textoDistribuicaoLote(), 200)}` : "";
  document.getElementById("resultsSummary").textContent =
    `${AREA_META[state.area].label} · ${state.disciplina} · ${total} questão(ões) · ${done}/${total} concluídas` + (temaComum ? ` · tema pedido: "${resumoTema(temaComum, 140)}"` : "") + rodizio;
}

/* ---------------- Results rendering ---------------- */
function renderResults(){
  const wrap = document.getElementById("questionResults");
  wrap.innerHTML = "";
  state.questions.forEach((q, idx) => wrap.appendChild(renderQuestionCard(q, idx)));
  document.body.classList.toggle("mode-aluno", state.viewMode === "aluno");
  document.body.classList.toggle("mode-professor", state.viewMode === "professor");
  renderSummaryTable();
}

// Atualiza SÓ o card da questão `q` (em vez de recriar o painel inteiro, como
// renderResults() faz). Antes, cada mudança de status de UMA questão durante a
// geração (que roda em paralelo para várias questões) reconstruía TODOS os
// cards e recriava do zero todos os gráficos Chart.js já prontos — deixando a
// geração de simulados com várias questões visivelmente mais lenta e travada
// quanto mais questões eram configuradas. Atualizar só o card afetado evita
// esse trabalho redundante.
function updateQuestionCard(q, idx){
  const wrap = document.getElementById("questionResults");
  const existing = wrap.querySelector(`.qcard[data-qid="${q.id}"]`);
  if(existing){
    existing.querySelectorAll("canvas").forEach(cv => {
      const ch = (window.Chart && typeof Chart.getChart === "function") ? Chart.getChart(cv) : null;
      if(ch) ch.destroy();
    });
  }
  const fresh = renderQuestionCard(q, idx);
  if(existing){ existing.replaceWith(fresh); } else { wrap.appendChild(fresh); }
  renderSummaryTable();
}

function renderSummaryTable(){
  const done = state.questions.filter(q => q.status === "done");
  const card = document.getElementById("summaryCard");
  if(!done.length){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const body = document.getElementById("summaryBody");
  body.innerHTML = "";
  state.questions.forEach((q, idx) => {
    if(q.status !== "done") return;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${idx+1}</td><td>${escapeHtml(q.data.tema||q.tema)}</td><td>${escapeHtml(q.data.habilidade?.codigo||"—")}</td><td>${escapeHtml(q.data.dificuldade||q.dificuldade)}</td><td><strong>${escapeHtml(letraCorretaDe(q.data)||"—")}</strong></td>`;
    body.appendChild(tr);
  });
}

function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* AUDITORIA LOCAL — validação de verdade, sem nenhuma chamada de API.

   Confere, no próprio navegador, o que um revisor checaria mecanicamente:
   gabarito na letra planejada, cinco alternativas distintas, numéricas em
   ordem crescente, exatamente uma alternativa "correta" na análise e
   coincidindo com o gabarito, comando sem interrogação e sem "exceto/
   incorreto", linguagem absolutista nas alternativas, correta muito mais
   longa que as demais, citação de fonte no texto-base, as 8 seções do
   protocolo na especificação da imagem, coerência de gráfico/tabela e a
   notação química (Natureza). É informativa: aparece no card do professor e
   NUNCA bloqueia geração nem exportação. Devolve [{nivel, texto}]. */
const ABSOLUTISTAS_RE = /\b(sempre|nunca|jamais|todos|todas|completamente|totalmente|exclusivamente|sem exce[çc][ãa]o|em absoluto)\b/i;
const SECOES_PROTOCOLO_IMAGEM = [
  ["SCENE AND VIEWPOINT", /scene\s+and\s+viewpoint/i],
  ["ELEMENT INVENTORY", /element\s+inventory/i],
  ["LAYOUT AND POSITION", /layout\s+and\s+position/i],
  ["ARROWS", /\barrows?\b/i],
  ["TEXT LABELS", /text\s+labels?/i],
  ["NUMBERS, SCALES AND MEASUREMENT MARKS", /numbers?,?\s+scales?/i],
  ["STYLE AND LEGIBILITY", /style\s+and\s+legibility/i],
  ["NEGATIVE CONSTRAINTS", /negative\s+constraints?/i],
];

function auditaQuestaoLocal(q){
  const itens = [];
  const aviso = t => itens.push({ nivel: "aviso", texto: t });
  const info  = t => itens.push({ nivel: "info", texto: t });
  const d = q && q.data;
  if(!d) return itens;
  const L = GABARITO_LETRAS;
  const alts = d.alternativas || {};
  const txt = k => String((alts && alts[k]) || "").trim();

  /* Gabarito — v18.9: o auditor usa EXATAMENTE a mesma conferência que a tela e
     as exportações. Antes ele tinha leitura própria (comparava, por conta
     própria, analiseAlternativas[].status com d.gabarito) e podia divergir de
     quem desenha a marcação. Agora há uma fonte só, e ela é esta. */
  const confAud = conferenciaGabarito(d);
  if(confAud.estado === "divergente") aviso(confAud.motivo + ' A questão não pode ser exportada assim — use "Regenerar".');
  else if(confAud.estado === "indefinido") aviso(confAud.motivo);
  else if(confAud.parcial) info(confAud.motivo);
  if(q.gabaritoStatus === "impossivel") info("A letra entregue não é a planejada para esta posição, e trocar duas alternativas quebraria a ordem numérica — a resposta correta ficou onde está (manda o conteúdo, não a letra) e o planejamento das questões seguintes foi refeito.");

  // Alternativas: cinco, preenchidas e distintas
  const vazias = L.filter(k => !txt(k));
  if(vazias.length) aviso("Alternativa(s) sem texto: " + vazias.join(", ") + ".");
  const norm = k => txt(k).toLowerCase().replace(/[\s.]+/g, " ").trim();
  const vistos = new Map();
  L.forEach(k => { if(txt(k)){ const n = norm(k); if(vistos.has(n)) aviso("Alternativas " + vistos.get(n) + " e " + k + " são iguais."); else vistos.set(n, k); } });

  // Numéricas em ordem crescente e sem valor repetido (mesmo leitor da rede de
  // segurança do gabarito: moeda, milhar, sobrescrito, notação científica).
  const lidos = L.map(k => lerNumeroAlternativa(txt(k)));
  if(lidos.every(v => v !== null)){
    // Lista híbrida ("10³ vezes, pois a razão…"): valor + justificativa. Aí a ordem
    // numérica não é exigível (o valor pode repetir de propósito); o que importa
    // é o valor repetido com justificativas diferentes — alternativas dependentes.
    const hibrida = lidos.some(v => v.resto.length > 40);
    if(!hibrida){
      for(let i = 1; i < lidos.length; i++){ if(lidos[i].valor < lidos[i-1].valor){ aviso("Alternativas numéricas fora da ordem crescente (Guia do Inep)."); break; } }
    }
    // Mesmo valor E mesmo complemento ("2,5 km" × "2.5 km"): alternativas dependentes.
    // Só o número igual não basta ("1/6" × "1/5", "10 m/s" × "10 km/h" são distintas).
    const porValor = new Map(), porChave = new Map();
    L.forEach((k, i) => {
      const chave = lidos[i].valor + "|" + lidos[i].resto;
      if(porChave.has(chave)){ if(norm(porChave.get(chave)) !== norm(k)) aviso("Alternativas " + porChave.get(chave) + " e " + k + " têm o mesmo valor numérico."); }
      else{
        porChave.set(chave, k);
        if(hibrida && porValor.has(lidos[i].valor)) info("Alternativas " + porValor.get(lidos[i].valor) + " e " + k + " repetem o mesmo valor (" + txt(k).split(/\s/)[0] + ") com justificativas diferentes — confira se são independentes.");
        if(!porValor.has(lidos[i].valor)) porValor.set(lidos[i].valor, k);
      }
    });
  }

  // Análise das alternativas: "exatamente uma correta" e "é a mesma letra do
  // gabarito" já foram conferidos lá em cima, por conferenciaGabarito — v18.9,
  // fonte única. Não há segunda leitura aqui de propósito.

  // Comando
  const cmd = String(d.comando || "");
  if(/\?/.test(cmd)) aviso("Comando com ponto de interrogação (deve ser frase afirmativa a completar).");
  if(/\b(exceto|incorret[ao]s?|fals[ao]s?|errad[ao]s?)\b/i.test(cmd)) aviso("Comando usa 'exceto/incorreto/falso/errado' (vedado pelo Guia do Inep).");
  if(/^\s*(pode-se afirmar|é correto afirmar)/i.test(cmd)) aviso("Comando começa com 'Pode-se afirmar'/'É correto afirmar' (vedado pelo Guia).");

  // Linguagem absolutista nas alternativas
  const absol = L.filter(k => ABSOLUTISTAS_RE.test(txt(k)));
  if(absol.length) info("Linguagem absolutista em " + absol.join(", ") + " — confira se não entrega/denuncia a resposta.");

  /* PARIDADE DAS ALTERNATIVAS (Guia do Inep) — v18.3. O critério anterior (correta acima
     de 1,6x a MÉDIA das outras) nunca disparava: nas 20 questões reais das levas de 14/09
     (Matemática) e 15/09 (Biologia) o maior valor observado foi 1,42, e ficaram de fora as
     duas questões em que o gabarito realmente se denunciava (261 contra 199 caracteres e
     245 contra 184). A comparação passa a ser com a SEGUNDA MAIOR — que é o que o candidato
     enxerga ao bater o olho. Quem protege as alternativas curtas — onde poucos caracteres
     viram uma razão alta sem significado — é o piso de 40 caracteres; os 25 caracteres são
     um gatilho ADICIONAL, para o regime de alternativas longas (ver o comentário abaixo). */
  if(confAud.letra && txt(confAud.letra)){
    const tams = L.filter(k => txt(k)).map(k => ({ k: k, n: txt(k).length }));
    const g = txt(confAud.letra).length;
    const outras = tams.filter(x => x.k !== confAud.letra).map(x => x.n);
    const segunda = outras.length ? Math.max.apply(null, outras) : 0;
    const menor = tams.length ? Math.min.apply(null, tams.map(x => x.n)) : 0;
    const maior = tams.length ? Math.max.apply(null, tams.map(x => x.n)) : 0;
    /* Razão OU margem absoluta (não "e"): no regime de alternativas longas que o gerador
       produz hoje, exigir as duas ao mesmo tempo abre um buraco — 500 contra 404 caracteres
       é só 1,24x, mas são 96 caracteres a mais que TODOS os distratores. Qualquer um dos dois
       ramos já implica que a correta é a maior de todas, então a frase do aviso é sempre
       verdadeira. Nas 20 questões reais o resultado é o mesmo com "e" ou com "ou". */
    if(g > 40 && segunda && (g > 1.25 * segunda || (g - segunda) >= 25)){
      aviso(`A alternativa correta (${confAud.letra}) é a mais longa da questão: ${g} caracteres contra ${segunda} da segunda maior. O Guia do Inep pede paridade entre as cinco — do jeito que está, o tamanho pode entregar a resposta. Use "Regenerar".`);
    } else if(menor > 40 && maior > 1.30 * menor){   // 1,25 é a paridade que o prompt pede; 1,30 dá a tolerância
      info(`Alternativas com extensões desiguais (de ${menor} a ${maior} caracteres) — o Guia do Inep pede paridade técnica entre as cinco.`);
    }
  }

  // v17: contexto repetido na leva (auditoria por palavras-chave, sem IA)
  if(q.colisaoContexto) aviso("Contexto repetido na leva: " + q.colisaoContexto + '. Use "Outro contexto".');

  // Texto-base: citação de fonte
  const tb = String(d.textoBase || "");
  // "FONTE: elaborado para fins didáticos" (no começo de uma linha) é a situação
  // hipotética que o Guia admite — conta como fonte. No meio do texto ("foi
  // elaborado pelo governo", "a principal fonte: o petróleo") não conta.
  if(tb && !/(dispon[ií]vel em|adaptad[oa]s?\b|acesso em|\bIn:|(^|\n)\s*fontes?\s*[:–—-]|(^|\n)\s*(texto\s+)?elaborad[oa]s?\s+(para|pel[oa]|com|a partir)|\b(1[89]|20)\d{2}\b)/i.test(tb)) info("Texto-base sem citação de fonte aparente (autor/obra/ano).");

  // Recurso visual
  const v = d.visual;
  if(v && v.tipo === "imagem"){
    const spec = imgTextoDeEspecificacao(v.promptImagem, 0);
    if(!spec) aviso("Imagem sem especificação (promptImagem vazio) — use 'Refazer imagem'.");
    else{
      const faltam = SECOES_PROTOCOLO_IMAGEM.filter(([, re]) => !re.test(spec)).map(([n]) => n);
      if(faltam.length) info("Especificação da imagem sem " + faltam.length + " das 8 seções do protocolo: " + faltam.join(", ") + ".");
    }
    if(!imgTextoDeEspecificacao(v.descricao, 0)) info("Imagem sem legenda (descricao).");
  } else if(v && v.tipo === "grafico"){
    const n = (v.labels || []).length;
    (v.datasets || []).forEach((ds, i) => { if(!Array.isArray(ds.data) || ds.data.length !== n) aviso("Gráfico: série " + (i + 1) + " tem " + ((ds.data || []).length) + " valores para " + n + " rótulos."); });
    if(!n) aviso("Gráfico sem rótulos (labels).");
  } else if(v && v.tipo === "tabela"){
    const nc = (v.colunas || []).length;
    (v.linhas || []).forEach((row, i) => { if(!Array.isArray(row) || row.length !== nc) aviso("Tabela: linha " + (i + 1) + " tem " + ((row || []).length) + " células para " + nc + " colunas."); });
  }

  // Notação — v16. Química só em Ciências da Natureza (fora dela "COP30",
  // "MP3", "B12" seriam acusados); glifos da fonte do PDF em TODAS as áreas;
  // matemática em todas as áreas (o que sobrou em ASCII depois da rede de
  // segurança: ^, _, LaTeX, "sqrt(", letra x como ×).
  try{
    const probs = state.area === "natureza" ? auditaQuimica([q]) : auditaGlifosPdf([q]);
    // v14: substituições de caractere no PDF (⁄ → /) são informativas, não alerta.
    const graves = probs.filter(p => !p.informativo);
    const infos = probs.filter(p => p.informativo);
    if(graves.length) aviso("Notação: " + graves.length + " ocorrência(s) suspeita(s) — ex.: " + String(graves[0].ocorrencia || "").slice(0, 80) + ".");
    if(infos.length) info("Caractere fora da fonte do PDF com equivalente — " + String(infos[0].ocorrencia || "").slice(0, 80) + (infos.length > 1 ? " (+" + (infos.length - 1) + ")" : "") + ".");
  }catch(e){ /* nunca interrompe */ }
  try{
    const achados = new Map();
    quiCamposDaQuestao(q, 0).forEach(c => { if(c.rotulo === "referência" || c.rotulo === "prompt da imagem") return; nmAudita(c.texto).forEach(o => { if(!achados.has(o)) achados.set(o, c.rotulo); }); });
    achados.forEach((rotulo, o) => aviso("Notação matemática: " + o + " (" + rotulo + ")."));
  }catch(e){ /* nunca interrompe */ }
  return itens;
}

function htmlAuditoriaLocal(q){
  let itens = [];
  try{ itens = auditaQuestaoLocal(q); }catch(e){ itens = []; }
  const avisos = itens.filter(i => i.nivel === "aviso").length;
  const titulo = itens.length
    ? (avisos ? avisos + " alerta(s)" : "") + (avisos && itens.length > avisos ? " · " : "") + (itens.length > avisos ? (itens.length - avisos) + " observação(ões)" : "")
    : "nenhum alerta";
  const lista = itens.length
    ? "<ul style=\"margin:4px 0 0;padding-left:18px;\">" + itens.map(i => "<li style=\"margin:2px 0;color:" + (i.nivel === "aviso" ? "#f59e0b" : "var(--ink-2)") + ";\">" + (i.nivel === "aviso" ? "⚠️ " : "ℹ️ ") + escapeHtml(i.texto) + "</li>").join("") + "</ul>"
    : "<div class=\"hint\" style=\"margin-top:4px;\">✅ Nenhum alerta nas verificações automáticas.</div>";
  return `
    <div class="lab" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-2);margin:12px 0 2px;">Auditoria local (sem custo) — ${escapeHtml(titulo)}</div>
    <div style="font-size:12.5px;">${lista}</div>`;
}

function renderQuestionCard(q, idx){
  const el = document.createElement("div");
  el.className = "qcard";
  el.dataset.qid = q.id;
  const top = document.createElement("div"); top.className = "qcard-top"; el.appendChild(top);
  const inner = document.createElement("div"); inner.className = "qcard-inner";

  const head = document.createElement("div"); head.className = "qcard-head";
  head.innerHTML = `
    <div class="qtitle">
      <div class="qnum-badge">${idx+1}</div>
      <div>
        <h3>${q.data ? escapeHtml(q.data.tema || q.tema || "Questão") : escapeHtml(q.tema || "Questão " + (idx+1))}</h3>
        <div class="qcard-meta">${state.disciplina} ${q.approved ? " · <span style='color:#4ade80'>✓ aprovada</span>" : ""}</div>
      </div>
    </div>
    <div class="qcard-actions no-print"></div>
  `;
  inner.appendChild(head);

  const actions = head.querySelector(".qcard-actions");
  actions.appendChild(iconBtn("🔄", "Regenerar", () => regenerarQuestaoEArquivar(q)));
  actions.appendChild(iconBtn("✏️", "Editar", () => toggleEdit(el, q, idx)));
  if(q.data && q.colisaoContexto){
    actions.appendChild(iconBtn("🎭", "Outro contexto (regenera esta questão em um cenário ainda não usado na leva)", () => regenerarComOutroContexto(q)));
  }
  if(q.data){
    actions.appendChild(iconBtn("⬇️", "Mais fácil", () => { q.dificuldade = "Fácil"; regenerarQuestaoEArquivar(q); }));
    actions.appendChild(iconBtn("⬆️", "Mais difícil", () => { q.dificuldade = "Difícil"; regenerarQuestaoEArquivar(q); }));
  }
  actions.appendChild(iconBtn(idx===0?"":"↑", "Mover para cima", () => moveQuestion(idx, -1), idx===0));
  actions.appendChild(iconBtn(idx===state.questions.length-1?"":"↓", "Mover para baixo", () => moveQuestion(idx, 1), idx===state.questions.length-1));
  actions.appendChild(iconBtn(q.approved?"✅":"☑️", q.approved?"Aprovada":"Aprovar", () => { q.approved = !q.approved; renderResults(); }));
  actions.appendChild(iconBtn("🗑️", "Excluir", () => deleteQuestion(idx)));

  // status / body
  if(q.status === "idle"){
    const s = document.createElement("div"); s.className = "status-line"; s.textContent = "Aguardando geração...";
    inner.appendChild(s);
  } else if(q.status === "generating" || q.status === "validating"){
    const s = document.createElement("div"); s.className = "status-line";
    s.innerHTML = `<div class="spinner"></div> O agente está elaborando (e revisando pedagogicamente) esta questão...`;
    inner.appendChild(s);
  } else if(q.status === "error"){
    const s = document.createElement("div"); s.className = "status-line";
    s.innerHTML = `⚠️ Erro ao gerar: ${escapeHtml(q.errorMsg)}`;
    inner.appendChild(s);
    // A questão pode ter texto pronto e só a imagem obrigatória ter falhado:
    // mostra o texto, para que o professor veja o que existe e possa tentar a
    // imagem de novo pelo botão dentro do card — sem fingir que está concluída.
    if(q.data && q.data.visual && q.data.visual.tipo === "imagem" && !q.data.visual.imagemDataUrl){
      inner.appendChild(buildQuestionBody(q.data, q));
    }
  } else if(q.status === "imagem"){
    const s = document.createElement("div"); s.className = "status-line";
    const tentativas = Array.isArray(q.diag) ? q.diag.filter(d => d.etapa === "imagem_tentativa").length : 0;
    s.innerHTML = `<div class="spinner"></div> Texto pronto — gerando a imagem obrigatória desta questão${tentativas > 1 ? ` (tentativa ${tentativas} de ${IMG_MAX_TENTATIVAS})` : ""}...`;
    inner.appendChild(s);
    inner.appendChild(buildQuestionBody(q.data, q));
  } else if(q.status === "done"){
    inner.appendChild(buildQuestionBody(q.data, q));
  }

  // inline edit form (hidden by default)
  const editWrap = document.createElement("div");
  editWrap.className = "editrow hidden";
  editWrap.dataset.editFor = q.id;
  inner.appendChild(editWrap);

  el.appendChild(inner);
  return el;
}

function iconBtn(icon, title, onClick, disabled){
  const b = document.createElement("button");
  b.className = "btn ghost sm"; b.title = title; b.textContent = icon;
  if(disabled){ b.disabled = true; }
  else { b.addEventListener("click", onClick); }
  return b;
}

function moveQuestion(idx, dir){
  const j = idx + dir;
  if(j < 0 || j >= state.questions.length) return;
  const tmp = state.questions[idx]; state.questions[idx] = state.questions[j]; state.questions[j] = tmp;
  renderResults();
}

function deleteQuestion(idx){
  state.questions.splice(idx, 1);
  state.qty = state.questions.length;
  document.getElementById("qtyVal").textContent = state.qty;
  renderResults();
  updateProgress();
}

function toggleEdit(cardEl, q, idx){
  const editWrap = cardEl.querySelector(`[data-edit-for="${q.id}"]`);
  if(!editWrap.classList.contains("hidden")){ editWrap.classList.add("hidden"); editWrap.innerHTML=""; return; }
  editWrap.classList.remove("hidden");
  editWrap.innerHTML = `
    <div style="width:100%;display:grid;grid-template-columns:1fr;gap:10px;">
      <div>
        <label class="field-label">Tema</label>
        <textarea class="edit-tema">${escapeHtml(q.tema)}</textarea>
      </div>
      <div class="qgrid-stack">
        <div>
          <label class="field-label">Dificuldade</label>
          <select class="edit-dif">
            ${["Fácil","Médio","Difícil"].map(d=>`<option ${q.dificuldade===d?"selected":""}>${d}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Recurso visual</label>
          <select class="edit-rec">
            <option value="nenhum" ${q.recurso==="nenhum"?"selected":""}>Sem recurso</option>
            <option value="imagem" ${q.recurso==="imagem"?"selected":""}>Imagem</option>
            <option value="grafico" ${q.recurso==="grafico"?"selected":""}>Gráfico</option>
            <option value="tabela" ${q.recurso==="tabela"?"selected":""}>Tabela</option>
          </select>
        </div>
      </div>
      <div class="visual-instr-block" style="${q.recurso==="nenhum"?"display:none;":""}">
        <label class="field-label">Instruções opcionais para a criação d${q.recurso==="imagem"?"a imagem":q.recurso==="tabela"?"a tabela":"o gráfico"}</label>
        <textarea class="edit-instr-visual" placeholder="Ex.: mostre o coração em corte transversal, com as quatro câmaras nomeadas; use um gráfico de linha em vez de barras...">${escapeHtml(q.instrucoesVisual||"")}</textarea>
      </div>
      <div style="margin-top:10px;">
        <label class="field-label">Orientações adicionais para esta questão <span class="hint" style="font-weight:400;">(opcional)</span></label>
        <textarea class="edit-orientacoes" placeholder="Ex.: Contextualize com uma situação do cotidiano">${escapeHtml(q.orientacoes||"")}</textarea>
        <p class="hint" style="margin:4px 0 0;">${ORIENT_AVISO}</p>
      </div>
      <div class="qgrid2">
        <div>
          <label class="field-label">Competência</label>
          <select class="edit-comp"></select>
        </div>
        <div>
          <label class="field-label">Habilidade</label>
          <select class="edit-hab"></select>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn sm ghost edit-cancel">Cancelar</button>
        <button class="btn sm edit-save">Salvar e gerar novamente</button>
      </div>
    </div>
  `;
  const compSel = editWrap.querySelector(".edit-comp");
  const habSel = editWrap.querySelector(".edit-hab");
  const recSel = editWrap.querySelector(".edit-rec");
  const instrBlock = editWrap.querySelector(".visual-instr-block");
  const instrLabel = instrBlock.querySelector(".field-label");
  populateCompetenciaSelect(compSel, q.competenciaNum);
  populateHabilidadeSelect(habSel, q.competenciaNum, q.habilidadeCod);
  compSel.addEventListener("change", () => {
    const val = compSel.value ? parseInt(compSel.value) : null;
    populateHabilidadeSelect(habSel, val, null);
  });
  recSel.addEventListener("change", () => {
    instrBlock.style.display = recSel.value === "nenhum" ? "none" : "";
    instrLabel.textContent = `Instruções opcionais para a criação d${recSel.value==="imagem"?"a imagem":recSel.value==="tabela"?"a tabela":"o gráfico"}`;
  });
  editWrap.querySelector(".edit-cancel").addEventListener("click", () => { editWrap.classList.add("hidden"); editWrap.innerHTML=""; });
  editWrap.querySelector(".edit-save").addEventListener("click", () => {
    const temaAntes = temaComparavel(q.tema);
    const temaNovo = editWrap.querySelector(".edit-tema").value;
    const temaMudou = temaComparavel(temaNovo) !== temaAntes;
    // Só espaços/maiúsculas/acentos diferentes: fica a string original, para a
    // questão continuar no grupo das irmãs (grupoDeTema compara o texto exato).
    if(temaMudou) q.tema = temaNovo;
    q.dificuldade = editWrap.querySelector(".edit-dif").value;
    q.recurso = recSel.value;
    q.instrucoesVisual = editWrap.querySelector(".edit-instr-visual").value;
    q.orientacoes = (editWrap.querySelector(".edit-orientacoes").value || "").slice(0, 600);
    q.competenciaNum = compSel.value ? parseInt(compSel.value) : null;
    q.habilidadeCod = habSel.value || null;
    /* v18.2: o recorte planejado da leva (conteúdo + contexto + habilidade) foi
       feito para o tema ANTERIOR desta questão, e o backend manda o modelo
       segui-lo ("DEVE seguir este recorte"). Tema alterado aqui → o texto do
       professor manda e o recorte sai; sem isso o modelo obedecia ao recorte
       antigo e a edição parecia ignorada (caso real de 15/09/2026: Biologia,
       questão 10, "Ciclo do nitrogênio…" gerou "Ciclo do carbono…" de novo).
       Tema igual → o recorte fica (a questão continua no seu lugar da leva),
       só sem a habilidade sugerida quando o professor escolheu a dele. */
    if(temaMudou){ q.recorte = null; q.recorteTema = null; q.temaEditado = true; }
    else if(q.recorte && (q.habilidadeCod || q.competenciaNum)) q.recorte = q.recorte.split(" · ").filter(p => !/^habilidade:/i.test(p)).join(" · ") || null;
    editWrap.classList.add("hidden"); editWrap.innerHTML = "";
    // v18.2: como "Regenerar": espera a imagem e atualiza o simulado já
    // arquivado — antes a questão editada não era regravada em "Meus
    // Simulados" e voltava à versão antiga ao reabrir.
    regenerarQuestaoEArquivar(q);
  });
}
// Tema "igual" para efeito de edição: espaços, maiúsculas e acentos não contam.
function temaComparavel(t){ return normalizaTextoBusca(t).trim(); }

function buildQuestionBody(data, q){
  const wrap = document.createElement("div");
  /* v18.9 — FONTE ÚNICA: a tela marca a alternativa correta pela mesma
     conferência que o PDF, o Word, a impressão e as duas exportações usam. */
  const confAlt = conferenciaGabarito(data);

  const metaRow = document.createElement("div");
  metaRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;";
  metaRow.innerHTML = `
    <span class="badge dif-${data.dificuldade}">${data.dificuldade}</span>
    <span class="badge">${escapeHtml(data.habilidade?.codigo||"")}</span>
    <span class="badge professor-only gabarito-badge">Gabarito: ${escapeHtml(confAlt.letra || "inconsistente")}</span>
  `;
  wrap.appendChild(metaRow);

  const tb = document.createElement("div"); tb.className = "texto-base"; tb.textContent = data.textoBase || "";
  wrap.appendChild(tb);

  if(data.visual && data.visual.tipo){
    wrap.appendChild(buildVisual(data.visual, q));
  }

  const cmd = document.createElement("p"); cmd.className = "comando"; cmd.textContent = data.comando || "";
  wrap.appendChild(cmd);

  const altList = document.createElement("div"); altList.className = "alt-list";
  ["A","B","C","D","E"].forEach(letter => {
    const isCorrect = confAlt.letra === letter;
    const item = document.createElement("div");
    item.className = "alt-item" + (isCorrect ? " correct" : "");
    const comentario = data.analiseAlternativas && data.analiseAlternativas[letter] ? data.analiseAlternativas[letter].comentario : "";
    item.innerHTML = `
      <div class="alt-letter">${letter}</div>
      <div style="flex:1;">
        <div>${escapeHtml((data.alternativas && data.alternativas[letter]) || "")}</div>
        <div class="alt-comment professor-only">${marcaAlternativa(confAlt, letter, true)} — ${escapeHtml(comentario)}</div>
      </div>
    `;
    altList.appendChild(item);
  });
  wrap.appendChild(altList);

  const pedagog = document.createElement("div"); pedagog.className = "pedagog professor-only";
  pedagog.innerHTML = `
    <div class="pedagog-grid">
      <div class="pedagog-item"><div class="lab">Área</div><div class="val">${escapeHtml(AREA_META[state.area].label)}</div></div>
      <div class="pedagog-item"><div class="lab">Disciplina</div><div class="val">${escapeHtml(data.disciplina||state.disciplina)}</div></div>
      <div class="pedagog-item"><div class="lab">Dificuldade</div><div class="val">${escapeHtml(data.dificuldade||"")}</div></div>
      <div class="pedagog-item"><div class="lab">Gabarito</div><div class="val">${escapeHtml(confAlt.letra || "inconsistente")}</div></div>
    </div>
    <div class="pedagog-grid">
      <div class="pedagog-item" style="grid-column:1/-1;"><div class="lab">Competência</div><div class="val">Competência ${escapeHtml(data.competencia?.numero)} — ${escapeHtml(data.competencia?.texto)}</div></div>
      <div class="pedagog-item" style="grid-column:1/-1;"><div class="lab">Habilidade</div><div class="val">${escapeHtml(data.habilidade?.codigo)} — ${escapeHtml(data.habilidade?.texto)}</div></div>
      ${data.objetoConhecimento ? `<div class="pedagog-item" style="grid-column:1/-1;"><div class="lab">Objeto de conhecimento</div><div class="val">${escapeHtml(data.objetoConhecimento)}</div></div>` : ""}
    </div>
    <div class="lab" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-2);margin-bottom:6px;">Resolução comentada</div>
    <div class="resolucao">${escapeHtml(data.resolucaoComentada||"")}</div>
    ${htmlAuditoriaLocal(q)}
  `;
  wrap.appendChild(pedagog);

  return wrap;
}

// Rótulo em português do tipo de recurso visual, para textos de botão/mensagens.
function recursoLabel(tipo){
  return tipo === "imagem" ? "imagem" : tipo === "grafico" ? "gráfico" : tipo === "tabela" ? "tabela" : "recurso visual";
}

function buildVisual(visual, q){
  const box = document.createElement("div"); box.className = "visual-box";

  const headerRow = document.createElement("div"); headerRow.className = "visual-header-row";
  const title = document.createElement("div"); title.className = "visual-title";
  title.textContent = visual.titulo || (visual.tipo === "imagem" ? "Imagem ilustrativa" : visual.tipo === "grafico" ? "Gráfico" : "Tabela");
  headerRow.appendChild(title);
  const redoBtn = document.createElement("button");
  redoBtn.className = "btn sm ghost no-print visual-redo-btn";
  redoBtn.textContent = `🔄 Refazer ${recursoLabel(visual.tipo)}`;
  redoBtn.title = `Gera uma nova versão d${visual.tipo==="imagem"?"a imagem":visual.tipo==="tabela"?"a tabela":"o gráfico"}, mantendo o restante da questão exatamente como está.`;
  headerRow.appendChild(redoBtn);
  box.appendChild(headerRow);

  // Instruções opcionais, editáveis a qualquer momento (antes ou depois da geração) —
  // usadas tanto na criação inicial do recurso visual quanto em cada "refazer".
  const instrWrap = document.createElement("div"); instrWrap.className = "visual-instr-wrap no-print";
  instrWrap.innerHTML = `
    <label class="field-label">Instruções opcionais para o "refazer"</label>
    <textarea class="visual-instr-input" placeholder="Ex.: use um gráfico de linha em vez de barras; destaque o ano de 2020; mostre em corte transversal...">${escapeHtml(q.instrucoesVisual||"")}</textarea>
  `;
  box.appendChild(instrWrap);
  instrWrap.querySelector(".visual-instr-input").addEventListener("input", e => { q.instrucoesVisual = e.target.value; });

  const body = document.createElement("div"); body.className = "visual-body";
  box.appendChild(body);
  renderVisualContent(body, visual, q.data);

  redoBtn.addEventListener("click", () => {
    // "Refazer" (qualquer recurso, inclusive imagem) sempre volta a passar pelo
    // Claude com o texto-base/comando/alternativas/gabarito/resolução reais da
    // questão (regenerarVisual no backend) — nunca reenvia direto ao gerador de
    // imagem só o prompt antigo, que poderia estar descrevendo a cena errada.
    redoVisual(q, body, title, redoBtn);
  });

  return box;
}

// Desenha o conteúdo do recurso visual (imagem/tabela/gráfico) dentro de .visual-body.
// Extraído à parte para poder ser chamado de novo, no mesmo elemento já existente na
// tela, quando o professor/aluno clica em "Refazer" — sem precisar recriar o card inteiro.
function renderVisualContent(body, visual, dataQuestao){
  body.innerHTML = "";
  if(visual.tipo === "imagem"){
    // Nunca um texto genérico: ou a especificação da imagem, ou a legenda +
    // o enunciado desta questão (ver montaPromptImagem). "[object Object]"
    // não passa mais por aqui.
    const promptText = montaPromptImagem(visual, dataQuestao);
    const descricao = imgTextoDeEspecificacao(visual.descricao, 0);
    const holder = document.createElement("div");
    holder.className = "visual-image-holder";
    body.appendChild(holder);
    renderGeneratedImage(holder, promptText, descricao, visual);
  } else if(visual.tipo === "tabela"){
    const table = document.createElement("table"); table.className = "enem-table";
    const thead = document.createElement("thead"); const trh = document.createElement("tr");
    (visual.colunas||[]).forEach(c => { const th = document.createElement("th"); th.textContent = c; trh.appendChild(th); });
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    (visual.linhas||[]).forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(cell => { const td = document.createElement("td"); td.textContent = cell; tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  } else if(visual.tipo === "grafico"){
    const canvas = document.createElement("canvas"); canvas.style.maxHeight = "340px";
    body.appendChild(canvas);
    setTimeout(() => {
      try{
        new Chart(canvas.getContext("2d"), {
          type: visual.chartType || "bar",
          data: { labels: visual.labels || [], datasets: (visual.datasets||[]).map((ds,i) => ({
            label: ds.label, data: ds.data,
            backgroundColor: chartColor(i, .55), borderColor: chartColor(i, 1), borderWidth: 2, tension: .3,
          })) },
          options: {
            responsive: true,
            plugins: { legend: { labels: { color: "#c7cde3" } }, title: { display: !!visual.titulo, text: visual.titulo||"", color:"#fff" } },
            scales: (visual.chartType === "pie") ? {} : {
              x: { ticks: { color: "#8a92b8" }, grid: { color: "rgba(255,255,255,.06)" } },
              y: { ticks: { color: "#8a92b8" }, grid: { color: "rgba(255,255,255,.06)" } },
            },
          },
        });
      } catch(e){ body.innerHTML += `<p class="hint">Não foi possível renderizar o gráfico.</p>`; }
    }, 30);
  }
}

// Desenha a imagem de um recurso visual. Se `visual.imagemDataUrl` já existir
// (imagem já gerada antes e guardada no próprio objeto — inclusive dentro de
// um simulado arquivado em "Meus Simulados"), mostra ela direto, sem pedir
// uma imagem nova ao backend: abrir um simulado salvo (ou só re-renderizar a
// tela, por exemplo ao aprovar/mover outra questão) NUNCA deve gerar imagens
// novas nem trocar as que já existem. Só quando não há imagem guardada é que
// uma é pedida ao backend — e, assim que chega, fica salva em `visual`, para
// a próxima renderização (e o próximo arquivamento) reaproveitarem a mesma.
/* UMA IMAGEM POR RECURSO VISUAL. O log do backend mostrou pares de imagens
   idênticas geradas com ~20 s de diferença: o card foi re-renderizado (troca
   de aba, aprovar/mover outra questão, reabrir simulado) antes de a imagem
   chegar, e renderGeneratedImage pedia uma segunda — cobrada de novo — para o
   mesmo recurso visual. Agora o pedido em andamento fica registrado por
   objeto "visual" e é reaproveitado por qualquer nova renderização até
   terminar. WeakMap: não vai para o JSON salvo e some junto com o objeto. */
const imagensEmAndamento = new WeakMap();

function renderGeneratedImage(holder, promptText, descricao, visual, forcar){
  const mostraImagem = (dataUrl) => {
    holder.innerHTML = "";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = descricao || "";
    holder.appendChild(img);
    if(descricao){
      const cap = document.createElement("p");
      cap.style.cssText = "font-size:12px;color:var(--ink-2);margin:10px 0 0;";
      cap.textContent = descricao;
      holder.appendChild(cap);
    }
  };
  const mostraErro = (err) => {
    holder.innerHTML = `
      <div style="text-align:center;padding:18px 12px;">
        <p class="hint" style="color:#f87171;">⚠️ Não foi possível gerar a imagem: ${escapeHtml(err.message || String(err))}</p>
        <button class="btn sm ghost no-print retry-img-btn">🔄 Tentar novamente</button>
      </div>
    `;
    holder.querySelector(".retry-img-btn").addEventListener("click", () => renderGeneratedImage(holder, promptText, descricao, visual, true));
  };
  const mostraCarregando = () => {
    holder.innerHTML = `
      <div class="visual-image-loading" style="text-align:center;padding:28px 12px;">
        <div class="spinner" style="margin:0 auto;"></div>
        <div class="hint" style="margin-top:10px;">Gerando imagem... cerca de 15 s.</div>
      </div>
    `;
  };
  // Já existe um pedido em voo para ESTE recurso visual: só acompanha o
  // resultado neste novo elemento da tela — não gera (nem paga) outra imagem.
  if(visual && imagensEmAndamento.has(visual)){
    mostraCarregando();
    imagensEmAndamento.get(visual).then(({ dataUrl }) => mostraImagem(dataUrl)).catch(mostraErro);
    return;
  }
  // Questão cuja imagem obrigatória já esgotou as tentativas automáticas:
  // renderizar o card NÃO gera de novo por conta própria (senão o limite de
  // IMG_MAX_TENTATIVAS não valeria nada) — mostra o erro e o botão
  // "Tentar novamente"; só o clique do professor pede outra imagem.
  const donoErro = (!forcar && visual && !visual.imagemDataUrl)
    ? state.questions.find(qq => qq.status === "error" && qq.data && qq.data.visual === visual)
    : null;
  if(donoErro){
    mostraErro(new Error(donoErro.errorMsg || "imagem obrigatória não gerada"));
    return;
  }
  if(visual && visual.imagemDataUrl){
    holder.innerHTML = "";
    const img = document.createElement("img");
    img.src = visual.imagemDataUrl;
    img.alt = descricao || "";
    holder.appendChild(img);
    if(descricao){
      const cap = document.createElement("p");
      cap.style.cssText = "font-size:12px;color:var(--ink-2);margin:10px 0 0;";
      cap.textContent = descricao;
      holder.appendChild(cap);
    }
    return;
  }
  mostraCarregando();
  // Dono deste recurso visual (para diagnóstico e para corrigir o status da
  // questão quando a imagem sair por aqui — ex.: "Tentar novamente").
  const dono = state.questions.find(qq => qq.data && qq.data.visual === visual) || null;
  const pedido = gerarImagemComRetentativas(promptText, dono);
  if(visual) imagensEmAndamento.set(visual, pedido);
  const promessa = pedido.then(({ dataUrl }) => {
    mostraImagem(dataUrl);
    // Guarda a imagem pronta no próprio recurso visual da questão, para nunca
    // mais precisar gerar de novo esta mesma figura.
    if(visual) visual.imagemDataUrl = dataUrl;
    if(dono && (dono.status === "error" || dono.status === "imagem")){
      dono.status = "done"; dono.errorMsg = "";
      diagImagem(dono, "imagem_vinculada", "gerada pelo card (Tentar novamente / reabertura) e gravada em visual.imagemDataUrl");
      updateQuestionCard(dono, state.questions.indexOf(dono));
      updateProgress();
    }
    /* Sem seletor de qualidade e sem custo exibido na tela — a geração é
       sempre "low", sem opção de troca. O uso continua contabilizado em
       state.usoImagem (ver somaUsoImagem) para consulta quando pedida. */
  }).catch(mostraErro).finally(() => {
    if(visual) imagensEmAndamento.delete(visual);
  });
  imagePromisesEmAndamento.push(promessa);
}

// Botão "Refazer" para imagem/gráfico/tabela: pede ao backend (que por sua vez chama o Claude)
// para gerar SÓ um novo recurso visual, mantendo o texto-base, comando, alternativas,
// gabarito e resolução comentada da questão exatamente como estão — guiado pelas
// instruções opcionais atuais, se houver.
async function redoVisual(q, body, titleEl, redoBtn){
  redoBtn.disabled = true;
  const originalLabel = redoBtn.textContent;
  redoBtn.textContent = "⏳ Refazendo...";
  body.innerHTML = `
    <div style="text-align:center;padding:28px 12px;">
      <div class="spinner" style="margin:0 auto;"></div>
      <div class="hint" style="margin-top:10px;">Refazendo ${recursoLabel(q.data.visual.tipo)}...</div>
    </div>
  `;
  try{
    const resp = await fetch(QUESTION_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        regenerarVisual: true,
        area: state.area,
        disciplina: state.disciplina,
        tema: q.data.tema || q.tema || "",
        dificuldade: q.data.dificuldade || q.dificuldade,
        recurso: q.data.visual.tipo,
        textoBase: q.data.textoBase || "",
        comando: q.data.comando || "",
        alternativas: q.data.alternativas || {},
        gabarito: q.data.gabarito || "",
        resolucaoComentada: q.data.resolucaoComentada || "",
        instrucoesVisual: q.instrucoesVisual || "",
      }),
    });
    const rawBody = await resp.text();
    let payload = {};
    try{ payload = rawBody ? JSON.parse(rawBody) : {}; }catch(e){ /* corpo não é JSON — trata abaixo */ }
    if(!resp.ok || payload.error){
      throw new Error(payload.error || rawBody.slice(0, 300) || `Erro HTTP ${resp.status} ao refazer o recurso visual.`);
    }
    if(!payload.visual){
      throw new Error("O backend não retornou um novo recurso visual.");
    }
    q.data.visual = payload.visual;
    normalizaVisualQuestao(q.data);
    nmAplicaNaQuestao(q);   // v16
    titleEl.textContent = q.data.visual.titulo || titleEl.textContent;
    renderVisualContent(body, q.data.visual, q.data);
    // Se for imagem, renderVisualContent acabou de pedir a imagem nova ao
    // backend (payload.visual ainda não tem imagemDataUrl). Espera ela ficar
    // pronta e, se este simulado já estiver arquivado, atualiza o arquivo —
    // senão o "Refazer" se perderia na próxima vez que o simulado reabrisse.
    await aguardaImagensPendentes();
    if(simuladoAbertoId) await salvarSimuladoAtual();
  } catch(err){
    // Mantém a versão anterior visível (ela não foi alterada) e só avisa do erro.
    renderVisualContent(body, q.data.visual, q.data);
    toast(`Não foi possível refazer: ${err.message || String(err)}`, "err");
  } finally {
    redoBtn.disabled = false;
    redoBtn.textContent = originalLabel;
  }
}

function chartColor(i, alpha){
  const palette = [`99,102,241`,`236,72,153`,`16,185,129`,`245,158,11`,`59,130,246`];
  return `rgba(${palette[i % palette.length]},${alpha})`;
}

/* ---------------- View toggle / print ---------------- */
function setViewMode(mode){
  state.viewMode = mode;
  document.getElementById("viewAluno").classList.toggle("active", mode === "aluno");
  document.getElementById("viewProfessor").classList.toggle("active", mode === "professor");
  document.body.classList.toggle("mode-aluno", mode === "aluno");
  document.body.classList.toggle("mode-professor", mode === "professor");
}

/* "Exportar HTML" — v13: o arquivo HTML CONTÉM o próprio PDF.

   Até a v12 este botão gerava um segundo documento, em CSS, que tentava
   reproduzir a diagramação do caderno (enemBuildPrintHTML, mais abaixo). Na
   tela isso nunca ficou igual ao PDF: sem altura de página, o CSS de colunas
   (column-fill:auto) despejava todo o texto na primeira coluna e deixava a
   segunda vazia; a tarja da versão caía no meio da lateral; e não havia
   paginação em 275 mm, fólio, margens espelhadas nem cabeçalho/rodapé
   repetidos — o CSS não sabe fluir texto entre folhas de altura fixa.

   Agora o botão monta o MESMO documento do botão PDF (enemBuildPdfDoc — a
   mesma função, portanto a mesma diagramação, byte a byte no conteúdo) e o
   embute, em base64, num arquivo .html autocontido que o exibe no visualizador
   de PDF do navegador, ocupando a janela inteira. Ao abrir o HTML, a tela é
   literalmente o PDF exportado. O arquivo abre com duplo clique, sem internet,
   e dali o usuário imprime ou salva o PDF. Nada muda nos botões PDF, Word e
   Imprimir. O código CSS antigo fica no arquivo sem ser chamado.              */
async function exportHtmlSnapshot(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de exportar.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de exportar.", "err");
    return;
  }
  if(!window.jspdf){
    try{
      await loadScriptOnce(CDN_URLS.jspdf);
    }catch(e){
      toast("Não foi possível carregar a biblioteca de PDF (verifique sua conexão com a internet) e tente novamente.", "err");
      return;
    }
  }
  const btn = document.getElementById("btnExport");
  const originalLabel = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "Gerando HTML..."; }
  await new Promise(r => setTimeout(r, 40));   // deixa o navegador pintar o botão
  try{
    const professor = state.viewMode !== "aluno";
    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
    if(bloqueiaSeGabaritoInconsistente(doneQuestions)) return;
    const html = enemBuildHtmlComPdf(doneQuestions, professor);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const rotulo = professor ? "professor" : "aluno";
    const safeName = "Simulado_ENEM_" + (state.disciplina || "questoes").replace(/[^a-zA-Z0-9]+/g, "_") + "_" + rotulo + ".html";
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Arquivo HTML exportado — idêntico ao PDF.", "ok");
  }catch(err){
    toast("Não foi possível exportar o arquivo: " + (err.message || err), "err");
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = originalLabel; }
  }
}

// Bytes → base64, em blocos (String.fromCharCode.apply estoura a pilha com
// arrays grandes; um PDF com imagens passa de 1 MB).
function enemBytesParaBase64(bytes){
  let bin = "";
  const passo = 0x8000;
  for(let i = 0; i < bytes.length; i += passo){
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return btoa(bin);
}

/* Documento HTML autocontido que exibe o PDF do simulado. O PDF vai em base64
   dentro de um <script>; ao abrir, o script reconstrói os bytes, cria um blob
   e o carrega num <iframe> que ocupa a janela inteira — é o visualizador de
   PDF do próprio navegador (Chrome, Edge, Firefox, Safari) que desenha as
   folhas, exatamente como faria com o arquivo .pdf. Se o navegador não tiver
   visualizador (navigator.pdfViewerEnabled === false, ou o iframe não abrir),
   aparece um aviso com o botão para baixar o PDF. O base64 nunca contém "<",
   então não há como fechar o <script> por acidente.                          */
function enemBuildHtmlComPdf(doneQuestions, professor){
  const built = enemBuildPdfDoc(doneQuestions, professor);
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const titulo = "Simulado ENEM — " + areaLabel + (state.disciplina ? " · " + state.disciplina : "") +
                 " — versão do " + (professor ? "professor" : "aluno");
  // O visualizador mostra o título do PDF na barra; sem ele apareceria o
  // identificador aleatório do blob.
  built.doc.setProperties({ title: titulo, subject: "Simulado no padrão do caderno ENEM 2025", creator: "Gerador de Questões ENEM" });
  const base64 = enemBytesParaBase64(new Uint8Array(built.doc.output("arraybuffer")));
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + esc(titulo) + '</title>\n' +
    '<style>\n' +
    'html,body{margin:0;padding:0;height:100%;background:#525659;}\n' +
    '#visor{position:fixed;top:0;left:0;width:100%;height:100%;border:0;display:block;}\n' +
    '#aviso{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:#e9e9ec;color:#222;' +
      'font:15px/1.6 system-ui,Segoe UI,Arial,sans-serif;padding:32px 24px;text-align:center;}\n' +
    '#aviso a{display:inline-block;margin-top:14px;padding:10px 18px;background:#004B8D;color:#fff;' +
      'border-radius:6px;text-decoration:none;font-weight:600;}\n' +
    'body.sem-visor #visor{display:none;} body.sem-visor #aviso{display:block;}\n' +
    '</style>\n</head>\n<body>\n' +
    '<iframe id="visor" title="' + esc(titulo) + '"></iframe>\n' +
    '<div id="aviso"><p>Este navegador não exibe PDF embutido na página.</p>' +
    '<a id="baixar" download="' + esc(built.safeName) + '">Baixar o PDF do simulado</a></div>\n' +
    '<script>\n' +
    '(function(){\n' +
    '  var B64 = "' + base64 + '";\n' +
    '  var bin = atob(B64), n = bin.length, bytes = new Uint8Array(n);\n' +
    '  for(var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);\n' +
    '  var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));\n' +
    '  document.getElementById("baixar").href = url;\n' +
    '  if(navigator.pdfViewerEnabled === false){ document.body.className = "sem-visor"; return; }\n' +
    '  document.getElementById("visor").src = url;\n' +
    '})();\n' +
    '</script>\n</body>\n</html>';
}

/* "Imprimir" manda para a impressora o MESMO documento do botão PDF. */
async function printExam(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de imprimir.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de imprimir.", "err");
    return;
  }
  if(!window.jspdf){
    try{
      await loadScriptOnce(CDN_URLS.jspdf);
    }catch(e){
      toast("Não foi possível carregar a biblioteca de impressão (verifique sua conexão) e tente novamente.", "err");
      return;
    }
  }
  const btn = document.getElementById("btnPrint");
  const label = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "Preparando..."; }
  await new Promise(r => setTimeout(r, 40));   // v12: deixa o navegador pintar o botão
  try{
    const professor = state.viewMode !== "aluno";
    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(!doneQuestions.length) throw new Error("Nenhuma questão para imprimir.");
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
    if(bloqueiaSeGabaritoInconsistente(doneQuestions)) return;
    const abriu = enemPrintPdf(doneQuestions, professor);
    toast(abriu ? "Documento aberto para impressão no padrão do caderno ENEM."
                : "Seu navegador bloqueou a janela; o arquivo foi baixado — abra-o e imprima.", abriu ? "ok" : "err");
  }catch(err){
    toast("Não foi possível preparar a impressão: " + err.message, "err");
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = label; }
  }
}

/* ---------------- PDF export (desenho vetorial em caixas coloridas — sem screenshot) ---------------- */

const PDF_PALETTE = {
  contexto:    { fill: [241, 245, 249], accent: [100, 116, 139], text: [30, 41, 59] },   // slate
  visual:      { fill: [248, 250, 252], accent: [71, 85, 105],  text: [30, 41, 59] },    // slate escuro
  pergunta:    { fill: [238, 242, 255], accent: [79, 70, 229],  text: [49, 46, 129] },    // indigo
  alternativa: { fill: [248, 250, 252], accent: [148, 163, 184],text: [30, 41, 59] },    // neutro
  correta:     { fill: [236, 253, 245], accent: [16, 185, 129], text: [6, 78, 59] },      // esmeralda
  habilidade:  { fill: [240, 253, 244], accent: [34, 197, 94],  text: [20, 83, 45] },     // verde
  gabarito:    { fill: [255, 251, 235], accent: [217, 119, 6],  text: [120, 53, 15] },    // âmbar
  resposta:    { fill: [236, 254, 255], accent: [8, 145, 178],  text: [22, 78, 99] },     // ciano
  resolucao:   { fill: [255, 247, 237], accent: [234, 88, 12],  text: [124, 45, 18] },    // laranja
  comentario:  { fill: [253, 242, 248], accent: [219, 39, 119], text: [131, 24, 67] },    // rosa
};

/* ---- NOTAÇÃO QUÍMICA NO PDF ----

   Com a Carlito embarcada (fonts.js), o PDF imprime a fórmula como ela é:
   H₂SO₄, SO₄²⁻, 2 H₂(g) + O₂(g) → 2 H₂O(l). Nada de "H2SO4", "^2", "_2" ou
   LaTeX: converter índice em "^2" mutila a fórmula e o estudante passa a ler um
   comando, não uma substância.

   Até a v28 esta função fazia exatamente isso — trocava ² por "^2", ₂ por "_2",
   µ por "u", → não existia. Era a única saída possível enquanto o PDF usava a
   Helvetica WinAnsi, que não tem esses glifos. Com a fonte embarcada o mapa
   deixou de ser necessário e passou a ser proibido.

   Sobra um caso: um caractere fora do subconjunto embarcado sairia EM BRANCO,
   e uma página em branco mente. Esses caracteres viram "□" e ficam registrados
   para o auditor apontar antes da entrega.                                   */

const PDF_SYMBOL_MAP = {
  // Mapa de emergência: só entra em ação se a Carlito não puder ser embarcada
  // (falha ao registrar a fonte). Aí o PDF cai na Helvetica WinAnsi, e é
  // preferível "m/s^2" a "m/s".
  "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5",
  "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9", "⁺": "^+", "⁻": "^-",
  "₀": "_0", "₁": "_1", "₂": "_2", "₃": "_3", "₄": "_4", "₅": "_5",
  "₆": "_6", "₇": "_7", "₈": "_8", "₉": "_9",
  "µ": "u", "μ": "u", "≈": "~", "≠": " diferente de ", "≤": "<=", "≥": ">=",
  "√": "raiz de ", "∞": "infinito",
  // Setas e ligações NÃO entram aqui: montar "→" com hífen e sinal de maior é
  // proibido pela regra de notação. Se a fonte falhar, o auditor barra a
  // exportação — não se entrega uma seta improvisada ao estudante.
  "Σ": "somatório de ", "∫": "integral de ",
  "π": "pi", "Δ": "Delta", "δ": "delta", "Ω": "Ohm", "ω": "ômega",
  "α": "alfa", "β": "beta", "θ": "teta", "λ": "lambda", "φ": "fi",
  "′": "'", "″": '"',
};
const PDF_SYMBOL_REGEX = new RegExp(Object.keys(PDF_SYMBOL_MAP).join("|"), "g");

let enemFonteEmbarcada = false;                 // ligado por enemRegistraFontes
const PDF_FORA_DO_SUBCONJUNTO = new Set();
let CARLITO_SET = null;

/* v14 — EQUIVALENTES PARA CARACTERES SEM GLIFO NA FONTE DO PDF.

   Caso real (11/09/2026, Química, questão 1 do simulado sobre Nox do cloro):
   o modelo escreveu a fração como "3⁄2 O₂(g)" com a BARRA DE FRAÇÃO Unicode
   (U+2044), que a Carlito embarcada não tem. Na tela, no Word e no HTML ela
   aparece; no PDF saía "3□2" e a auditoria avisava "caractere sem glifo".
   Varredura do banco inteiro (337 questões): só dois casos — este e um "⅓"
   numa questão de Matemática, que também saía como "□".

   Aqui, um caractere SEM glifo que tenha um equivalente EXATO com glifo é
   trocado por ele em vez de virar "□". Só entra em ação para caracteres fora
   da fonte — o que a fonte tem fica intacto —, e só no caminho do PDF (tela,
   Word e HTML nunca passam por aqui). O que não tiver equivalente continua
   virando "□" e sendo apontado pela auditoria, como antes.
   Todos os substitutos abaixo existem na fonte (conferido pelo teste). */
const PDF_EQUIVALENTES = {
  "\u2044": "/", "\u2215": "/",                                   // ⁄ barra de fração, ∕ barra de divisão
  "\u2153": "1/3", "\u2154": "2/3", "\u2155": "1/5", "\u2156": "2/5", "\u2157": "3/5", "\u2158": "4/5",
  "\u2159": "1/6", "\u215A": "5/6", "\u215B": "1/8", "\u215C": "3/8", "\u215D": "5/8", "\u215E": "7/8",
  "\u22C5": "\u00B7", "\u2219": "\u00B7",                          // ⋅ ∙ → ·
  "\u21C4": "\u21CC",                                             // ⇄ → ⇌ (reação reversível)
  "\u27F6": "\u2192", "\u27F5": "\u2190", "\u27F7": "\u2194",      // setas longas → curtas
  "\u2103": "\u00B0C", "\u2109": "\u00B0F", "\u1D52": "\u00B0",    // ℃ ℉ e "ᵒ" usado como grau
  "\u2113": "L",                                                  // ℓ (litro)
  "\u2032": "'", "\u2033": "\"",                                  // ′ ″
  "\u2010": "-", "\u2011": "-", "\u2012": "-",                    // hifens/traço de algarismo
  "\uFB01": "fi", "\uFB02": "fl", "\uFB00": "ff",                 // ligaduras
  "\u2009": " ", "\u200A": " ", "\u202F": " ", "\u2005": " ", "\u2006": " ", "\u2007": " ", "\u2008": " ",
  "\u200B": "", "\u200C": "", "\u200D": "", "\uFEFF": "",          // invisíveis
  "\u2090": "a", "\u2091": "e", "\u2092": "o", "\u2099": "n", "\u2093": "x", "\u1D62": "i", "\u2095": "h", "\u2096": "k", "\u2098": "m", "\u209A": "p", "\u209B": "s", "\u209C": "t",  // letras subscritas: Kₐ → Ka
};

/* v16 — RADICAL COM BARRA NO PDF. Na tela, no Word e no HTML o radicando sai
   com a barra por meio do combinante U+0305 (√1̅0̅0̅0̅): os motores de texto
   posicionam a marca sobre o caractere anterior. O jsPDF não posiciona marcas
   (não lê GPOS) — a barra cairia centrada na fronteira entre dois caracteres,
   começando no meio do primeiro e passando do último. A fonte embarcada traz,
   por isso, um glifo pré-composto "caractere + barra" para cada caractere
   possível de radicando (fontwork/ampliar_carlito.py), na Área de Uso Privado
   a partir de U+E100, na MESMA ordem desta string. Aqui cada par
   "caractere + U+0305" vira esse glifo; barras vizinhas se encostam e formam
   uma linha contínua exatamente do início ao fim do radicando. */
const PDF_SOBRELINHA_BASES = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ,.+-−·×/()⁰¹²³⁴⁵⁶⁷⁸⁹⁻π₀₁₂₃₄₅₆₇₈₉";
const PDF_SOBRELINHA_PUA = 0xE100;
function pdfRadicalComBarra(s){
  if(s.indexOf("\u0305") < 0) return s;
  const bases = Array.from(PDF_SOBRELINHA_BASES);
  return s.replace(/([\s\S])\u0305/gu, (m, base) => {
    const i = bases.indexOf(base);
    return i >= 0 ? String.fromCharCode(PDF_SOBRELINHA_PUA + i) : base;   // sem glifo composto: fica o caractere, sem a barra
  }).replace(/\u0305/g, "");
}

function pdfSanitizeText(text){
  if(text == null) return text;
  const s = quiJuntaFormula(String(text));
  if(!enemFonteEmbarcada){
    // Caminho degradado: sem a fonte embarcada, aproxima em ASCII.
    return s.replace(/\u0305/g, "").replace(PDF_SYMBOL_REGEX, ch => PDF_SYMBOL_MAP[ch]);
  }
  if(!CARLITO_SET) CARLITO_SET = new Set(Array.from(CARLITO_COBERTURA));
  let out = "";
  for(const ch of pdfRadicalComBarra(s)){
    if(ch === "\u2060") continue;                 // juntador: invisível, só serve ao Word e ao HTML
    if(ch === "\n" || ch === "\t" || ch === "\r" || CARLITO_SET.has(ch)) out += ch;
    else if(PDF_EQUIVALENTES[ch] !== undefined) out += PDF_EQUIVALENTES[ch];   // v14: equivalente com glifo
    else { PDF_FORA_DO_SUBCONJUNTO.add(ch); out += "\u25A1"; }
  }
  return out;
}

function pdfEnsureSpace(doc, ctx, neededHeight){
  if(ctx.y + neededHeight > ctx.pageHeight - ctx.margin){
    doc.addPage();
    ctx.y = ctx.margin;
  }
}

// Desenha uma "caixa" colorida com um rótulo (label) em maiúsculas e um corpo de texto,
// com barra de destaque colorida à esquerda. Quebra de página automática; se o próprio
// texto for maior que uma página inteira (raro), pagina o conteúdo internamente.
function pdfDrawBox(doc, ctx, opts){
  const { margin, pageWidth, pageHeight } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const padding = opts.padding != null ? opts.padding : 10;
  const innerX = margin + padding + 6;
  const innerWidth = contentWidth - padding * 2 - 6;
  const fontSize = opts.fontSize || 10.5;
  const labelSize = 8;
  const colors = opts.colors;
  const gap = opts.gap != null ? opts.gap : 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);
  const lines = opts.big ? [] : doc.splitTextToSize(pdfSanitizeText(String(opts.text || "").trim()) || "—", innerWidth);
  const lineHeight = fontSize * 1.34;
  const labelHeight = opts.label ? 14 : 0;
  const bodyHeight = opts.big ? 34 : Math.max(lines.length, 1) * lineHeight;
  const boxHeight = padding * 2 + labelHeight + bodyHeight;
  const maxPageContent = pageHeight - margin * 2;

  if(!opts.big && boxHeight > maxPageContent){
    pdfDrawBoxPaginated(doc, ctx, opts, lines, lineHeight, labelHeight, padding, colors, fontSize, labelSize, gap);
    return;
  }

  pdfEnsureSpace(doc, ctx, boxHeight);
  const boxY = ctx.y;

  doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
  doc.roundedRect(margin, boxY, contentWidth, boxHeight, 6, 6, "F");
  doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.roundedRect(margin, boxY, 4, boxHeight, 2, 2, "F");

  let cursorY = boxY + padding + 6;
  if(opts.label){
    doc.setFont("helvetica", "bold");
    doc.setFontSize(labelSize);
    doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.text(String(opts.label).toUpperCase(), innerX, cursorY);
    cursorY += labelHeight;
  }

  doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
  if(opts.big){
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text(String(opts.text || "—"), margin + contentWidth / 2, cursorY + 16, { align: "center" });
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    lines.forEach((line, li) => {
      doc.text(line, innerX, cursorY + fontSize * 0.85 + li * lineHeight);
    });
  }

  ctx.y = boxY + boxHeight + gap;
}

// Fallback para textos gigantes (ex.: uma resolução comentada enorme) que sozinhos
// ultrapassam a altura de uma página — flui o conteúdo por múltiplas páginas.
function pdfDrawBoxPaginated(doc, ctx, opts, lines, lineHeight, labelHeight, padding, colors, fontSize, labelSize, gap){
  const { margin, pageWidth, pageHeight } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const innerX = margin + padding + 6;
  let idx = 0;
  let first = true;
  while(idx < lines.length || first){
    if(ctx.y + 60 > pageHeight - margin){ doc.addPage(); ctx.y = margin; }
    const boxY = ctx.y;
    const availableHeight = (pageHeight - margin) - boxY;
    const availableForLines = availableHeight - padding * 2 - (first ? labelHeight : 0);
    const linesThisPage = Math.max(1, Math.floor(availableForLines / lineHeight));
    const chunk = lines.slice(idx, idx + linesThisPage);
    const boxHeight = padding * 2 + (first ? labelHeight : 0) + chunk.length * lineHeight;

    doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
    doc.roundedRect(margin, boxY, contentWidth, boxHeight, 6, 6, "F");
    doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.roundedRect(margin, boxY, 4, boxHeight, 2, 2, "F");

    let cursorY = boxY + padding + 6;
    if(first && opts.label){
      doc.setFont("helvetica", "bold");
      doc.setFontSize(labelSize);
      doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
      doc.text(String(opts.label).toUpperCase(), innerX, cursorY);
      cursorY += labelHeight;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
    chunk.forEach((line, li) => {
      doc.text(line, innerX, cursorY + fontSize * 0.85 + li * lineHeight);
    });

    ctx.y = boxY + boxHeight;
    idx += chunk.length;
    first = false;
    if(idx < lines.length){ doc.addPage(); ctx.y = margin; }
  }
  ctx.y += gap;
}


/* ================= ANATOMIA DO CADERNO ENEM 2025 — versão do aluno ============
   System design obrigatório para PDF, DOCX e impressão da VERSÃO DO ALUNO.
   Todas as medidas vêm de "Anatomia do caderno ENEM" (revisão 2025), levantada
   sobre o PDF oficial do ENEM 2025 — 2º dia, Caderno 7, Azul (INEP/MEC) — pela
   geometria vetorial, pelas fontes incorporadas e por amostragem de pixels.
   Nenhuma medida foi estimada a olho.

   O que mudou em relação à revisão anterior (que era de 2019): a família passou
   de Arial para Calibri; a entrelinha caiu de 12,8 para 12,0 pt; as margens
   passaram a ser espelhadas; o fio da calha virou sólido; o separador de questão
   migrou de um filete pontilhado ABAIXO para uma barra bicolor ACIMA; o rótulo
   virou caixa alta; e o miolo ganhou cor.

   A versão do PROFESSOR permanece exatamente como era (caixas coloridas, coluna
   única, gabarito, resolução e comentários). Nada aqui a afeta.                */

const MM = 72 / 25.4;                       // 1 mm em pontos tipográficos

const ENEM = {
  pageW: 200 * MM,                          // 200 mm — formato próprio do INEP
  pageH: 275 * MM,                          // 275 mm (menor que A4)

  // Margens ESPELHADAS: a mancha desliza 2,5 mm conforme a paridade da página.
  // Página ímpar (mão direita) começa em 8,00 mm; página par, em 10,50 mm.
  margOdd:  8.00 * MM,
  margEven: 10.50 * MM,

  manchaW: 182.33 * MM,                     // largura da mancha, igual em toda página
  colW:    89.47 * MM,                      // 89,47 × 2 + 3,40 = 182,34 mm
  gutter:   3.40 * MM,
  flowTop:  28.00 * MM,                     // topo do fluxo das colunas
  flowBottom: 260.00 * MM,                  // base do fluxo
  ruleHead: 25.00 * MM,                     // filete de cabeçalho
  ruleFoot: 263.00 * MM,                    // filete de rodapé
  segBlue:  49.16 * MM,                     // trecho azul do filete
  segMicro: 131.54 * MM,                    // trecho de microtexto do filete

  indent:   6.00 * MM,                      // recuo da primeira linha
  hang:     4.50 * MM,                      // texto da alternativa pendurado
  ornStart:24.47 * MM,                      // início da barra, a partir da coluna
  ornEndGap: 0.30 * MM,                     // folga antes da borda direita
  ornH:     1.06 * MM,                      // altura da faixa
  ornBlueShare: 0.795,                      // 79,5 % azul, 20,5 % escuro

  body: 10,                                 // corpo de texto e alternativas
  leading: 12.0,                            // entrelinha do corpo (1,20×)
  altLeading: 13.4,                         // entrelinha das alternativas (1,34×)
  qLabel: 11,                               // "QUESTÃO N" — bold, caixa alta
  areaTitle: 11,                            // título de área — bold, caixa alta
  caption: 8,                               // referência / fonte = corpo − 2 pt
  captionLead: 9.6,                         // entrelinha da referência (1,20×)
  footer: 9,                                // rodapé corrido e fólio
  micro: 1.5,                               // microtexto de segurança

  ink:      [35, 31, 32],                   // #231F20 — preto quente de impressão
  footGray: [88, 89, 91],                   // #58595B — rodapé corrido
  ornGray:  [147, 149, 152],                // #939598 — ornamento do cabeçalho
  azul:     [185, 229, 250],                // #B9E5FA — azul da versão
  azulTab:  [109, 207, 246],                // #6DCFF6 — cabeçalho de tabela
  azulLogo: [0, 75, 141],                   // #004B8D — logotipo "enem"

  // A Carlito vai EMBARCADA (ver fonts.js): métrica idêntica à Calibri e o
  // alfabeto completo que a notação química exige — índices inferiores, cargas
  // superiores, setas de reação, letras gregas. Não há mais substituição de
  // fonte, então o corpo é 10 pt de verdade e o fator de correção é 1.
  fonte: "Carlito",
  helvK: 1.0,
};

// Margem esquerda da mancha na página n (1 = primeira página de questões).
function enemLeft(pageNo){ return (pageNo % 2 === 1) ? ENEM.margOdd : ENEM.margEven; }
// Lado externo da página: ímpar → direita, par → esquerda.
function enemOuterIsRight(pageNo){ return pageNo % 2 === 1; }

// Define fonte e corpo já compensados para a substituição Helvetica → Calibri.
// Registra as quatro faces da Carlito no documento. Roda uma vez por PDF; se
// algo falhar, o texto ainda sai — em Helvetica, sem os glifos de química —, e
// o auditor avisa em vez de a página mentir.
function enemRegistraFontes(doc){
  try{
    CARLITO_FACES.forEach(f => {
      doc.addFileToVFS(f.arquivo, f.dados);
      doc.addFont(f.arquivo, ENEM.fonte, f.estilo);
    });
    enemFonteEmbarcada = !!doc.getFontList()[ENEM.fonte];
    return enemFonteEmbarcada;
  }catch(e){
    enemFonteEmbarcada = false;
    return false;
  }
}

function enemFont(doc, weight, size){
  doc.setFont(doc.__carlito ? ENEM.fonte : "helvetica", weight || "normal");
  doc.setFontSize(size * (doc.__carlito ? 1 : ENEM.helvK));
}
function enemInk(doc, c){ const k = c || ENEM.ink; doc.setTextColor(k[0], k[1], k[2]); }

// Filete sólido. No caderno 2025 NÃO existe traço pontilhado vetorial: tudo que
// parece pontilhado é, na verdade, o microtexto de segurança.
function enemSolidLine(doc, x1, y, x2, w, color){
  const c = color || ENEM.ink;
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setLineWidth(w == null ? 0.5 : w);
  doc.line(x1, y, x2, y);
}

// Microtexto de segurança: a palavra ENEM2025 repetida em 1,5 pt, ocupando
// 131,54 mm. À vista parece um filete pontilhado; é recurso antifraude.
function enemMicroText(doc, x, y, width, word){
  const w = word || "SIMULADO";
  enemFont(doc, "bold", ENEM.micro);
  enemInk(doc);
  const unit = doc.getTextWidth(w);
  if(!unit || unit <= 0) return;
  // Uma única linha, sem maxWidth: com quebra automática o filete viraria duas.
  const n = Math.max(1, Math.floor(width / unit));
  doc.text(w.repeat(n), x, y);
}

// Cabeçalho e rodapé de uma página de questões. Tudo que é "de canto" (fólio,
// tarja de cor, marca de registro) segue a margem EXTERNA; tudo que é "de miolo"
// (logotipo, rodapé corrido) segue a INTERNA.
function enemPageChrome(doc, ctx, flow){
  const n = ctx.pageNo;
  const left = enemLeft(n);
  const right = left + ENEM.manchaW;
  const outerRight = enemOuterIsRight(n);

  // --- Filete de cabeçalho: trecho azul do lado interno, microtexto do externo.
  if(outerRight){
    enemSolidLine(doc, left, ENEM.ruleHead, left + ENEM.segBlue, 1.0, ENEM.azul);
    enemMicroText(doc, right - ENEM.segMicro, ENEM.ruleHead - 0.6, ENEM.segMicro);
  }else{
    enemMicroText(doc, left, ENEM.ruleHead - 0.6, ENEM.segMicro);
    enemSolidLine(doc, right - ENEM.segBlue, ENEM.ruleHead, right, 1.0, ENEM.azul);
  }

  // --- Filete de rodapé: composição invertida em relação ao cabeçalho.
  if(outerRight){
    enemMicroText(doc, left, ENEM.ruleFoot - 0.6, ENEM.segMicro);
    enemSolidLine(doc, right - ENEM.segBlue, ENEM.ruleFoot, right, 1.0, ENEM.azul);
  }else{
    enemSolidLine(doc, left, ENEM.ruleFoot, left + ENEM.segBlue, 1.0, ENEM.azul);
    enemMicroText(doc, right - ENEM.segMicro, ENEM.ruleFoot - 0.6, ENEM.segMicro);
  }

  // --- Marca do caderno, na margem interna, na mesma geometria do logotipo do
  // original. NÃO reproduzimos o logotipo do INEP nem a marca oficial "enem":
  // isto é um simulado, e passar-se por caderno oficial seria falsificação.
  // O que se copia é a diagramação, não a identidade da instituição.
  const logoY = 15.6 * MM;
  const ano = String(ctx.ano || new Date().getFullYear());
  enemFont(doc, "bold", 16);
  const wMark = doc.getTextWidth("simulado");
  enemFont(doc, "normal", 16);
  const wAno = doc.getTextWidth(ano);
  const wLogo = wMark + 1.5 + wAno;
  // Na página par o bloco é ancorado pela direita, para não vazar da mancha.
  const logoX = outerRight ? left : (right - wLogo);
  enemFont(doc, "bold", 16);
  enemInk(doc, ENEM.azulLogo);
  doc.text("simulado", logoX, logoY);
  enemFont(doc, "normal", 16);
  enemInk(doc, ENEM.ornGray);
  doc.text(ano, logoX + wMark + 1.5, logoY);
  const markEnd = logoX + wLogo;
  enemFont(doc, "normal", 5.5);
  enemInk(doc, ENEM.ornGray);
  doc.text("Simulado no padrão do caderno ENEM",
    outerRight ? logoX : markEnd, logoY + 5.2,
    { align: outerRight ? "left" : "right" });

  // --- Fileira de quadrados girados 20°, em #939598, encostada no logotipo.
  const sqW = 5.5 * MM, sqH = 6.6 * MM, skew = Math.tan(20 * Math.PI / 180) * sqH;
  const sqBlock = 4 * (sqW + 0.4);
  let sqX = outerRight ? (markEnd + 4) : (logoX - sqBlock - 6);
  doc.setFillColor(ENEM.ornGray[0], ENEM.ornGray[1], ENEM.ornGray[2]);
  for(let i = 0; i < 4; i++){
    const y0 = 10.25 * MM, y1 = y0 + sqH;
    doc.triangle(sqX + skew, y0, sqX + skew + sqW, y0, sqX + sqW, y1, "F");
    doc.triangle(sqX + skew, y0, sqX + sqW, y1, sqX, y1, "F");
    sqX += sqW + 0.4;
  }

  // --- Barra cinza de 48,93 × 2,38 mm sob o logotipo, do lado interno.
  const barW = 48.93 * MM, barH = 2.38 * MM;
  doc.setFillColor(ENEM.ornGray[0], ENEM.ornGray[1], ENEM.ornGray[2]);
  doc.rect(outerRight ? left : (right - barW), 19.29 * MM, barW, barH, "F");

  // --- Tarja da versão: 11 × 30 mm sangrando na borda EXTERNA, com o quadrado
  // de registro de 3 × 3 mm na quina interna. No caderno oficial a altura da
  // tarja identifica a área; aqui o simulado tem uma área só, então ela fica
  // sempre no topo.
  const tW = 11 * MM, tH = 30 * MM;
  const tX = outerRight ? (ENEM.pageW - 6 * MM) : (-5 * MM);
  doc.setFillColor(ENEM.azul[0], ENEM.azul[1], ENEM.azul[2]);
  doc.rect(tX, -5 * MM, tW, tH, "F");
  doc.setFillColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
  doc.rect(outerRight ? (ENEM.pageW - 7.5 * MM) : (4.5 * MM), 23.5 * MM, 3 * MM, 3 * MM, "F");

  // --- Fio vertical da calha: sólido, 0,5 pt, só nas páginas de duas colunas.
  if(!flow || flow.cols === 2){
    const gx = left + 90.75 * MM;
    doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
    doc.setLineWidth(0.5);
    doc.line(gx, ENEM.flowTop, gx, ENEM.flowBottom);
  }

  // --- Rodapé: texto corrido na margem interna, fólio na externa.
  const footY = ENEM.ruleFoot + 3.9 * MM;
  enemFont(doc, "normal", ENEM.footer);
  enemInk(doc, ENEM.footGray);
  doc.text(ctx.footerText, outerRight ? left : right, footY, { align: outerRight ? "left" : "right" });
  enemFont(doc, "bold", ENEM.footer);
  enemInk(doc);
  doc.text(String(n), outerRight ? right : left, footY, { align: outerRight ? "right" : "left" });
}

// Estado do fluxo. `cols` é 1 ou 2: a página inteira vira coluna única de
// 182,33 mm quando a questão traz uma figura larga (§6 da especificação).
function enemStartPage(doc, ctx, flow, cols){
  flow.cols = cols;
  flow.col = 0;
  flow.x = enemLeft(ctx.pageNo);
  flow.w = cols === 1 ? ENEM.manchaW : ENEM.colW;
  flow.y = ENEM.flowTop;
  enemPageChrome(doc, ctx, flow);
}

function enemNewFlow(doc, ctx, cols){
  const flow = { cols: 2, col: 0, x: 0, y: 0, w: ENEM.colW, top: ENEM.flowTop, bottom: ENEM.flowBottom };
  enemStartPage(doc, ctx, flow, cols || 2);
  return flow;
}

function enemNextColumn(doc, ctx, flow){
  if(flow.cols === 2 && flow.col === 0){
    flow.col = 1;
    flow.x = enemLeft(ctx.pageNo) + ENEM.colW + ENEM.gutter;
    flow.y = flow.top;
    return;
  }
  doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
  ctx.pageNo += 1;
  enemStartPage(doc, ctx, flow, flow.cols);
}

// Troca o modo da página (1 ou 2 colunas). A troca sempre começa página nova,
// como no caderno original — figura larga nunca atravessa colunas com texto ao
// redor. Quando o modo já é o pedido, não faz nada.
function enemSetMode(doc, ctx, flow, cols){
  if(flow.cols === cols) return;
  doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
  ctx.pageNo += 1;
  enemStartPage(doc, ctx, flow, cols);
}

function enemEnsure(doc, ctx, flow, needed){
  if(flow.y + needed > flow.bottom) enemNextColumn(doc, ctx, flow);
}
function enemFits(flow, needed){ return flow.y + needed <= flow.bottom; }

// Justificação real: distribui o espaço restante entre as palavras da linha.
// A última linha de cada parágrafo fica alinhada à esquerda, como no original.

// Parágrafo de corpo: 10 pt, entrelinha 12,0 pt, justificado, primeira linha
// recuada em 6 mm, sem linha em branco entre parágrafos.
function enemParagraph(doc, ctx, flow, text, opts){
  const o = opts || {};
  const size = o.size || ENEM.body;
  const lead = o.leading || ENEM.leading;
  const indent = o.indent != null ? o.indent : ENEM.indent;
  const clean = pdfSanitizeText(String(text || "").trim());
  if(!clean) return;

  clean.split(/\n+/).forEach(par => {
    const t = par.trim();
    if(!t) return;
    // O corpo do caderno é 97,7 % regular, mas o negrito existe — e os marcadores
    // **assim** do gerador NÃO podem vazar impressos na página.
    const runs = enemRichRuns(t).map(r => ({ text: r.text, bold: r.bold || !!o.bold }));
    const lines = enemWrapRuns(doc, runs, flow.w, size, false, indent);
    lines.forEach((parts, i) => {
      const off = i === 0 ? indent : 0;            // recuo só na primeira linha
      enemEnsure(doc, ctx, flow, lead);
      enemDrawRichLine(doc, parts, flow.x + off, flow.y + size, flow.w - off,
                       size, "justify", i === lines.length - 1, false);
      flow.y += lead;
    });
  });
}

// Parágrafo de corpo que entende **negrito** no meio da frase. Mesma métrica do
// enemParagraph: 10 pt, entrelinha 12,0 pt, justificado.
function enemRichParagraph(doc, ctx, flow, text, opts){
  const o = opts || {};
  const size = o.size || ENEM.body;
  const lead = o.leading || ENEM.leading;
  const indent = o.indent != null ? o.indent : 0;
  const clean = pdfSanitizeText(String(text || "").trim());
  if(!clean) return;
  clean.split(/\n+/).forEach(par => {
    if(!par.trim()) return;
    const lines = enemWrapRuns(doc, enemRichRuns(par.trim()), flow.w - indent, size, false);
    lines.forEach((parts, i) => {
      enemEnsure(doc, ctx, flow, lead);
      enemDrawRichLine(doc, parts, flow.x + indent, flow.y + size, flow.w - indent,
                       size, "justify", i === lines.length - 1, false);
      flow.y += lead;
    });
  });
}

// Subtítulo interno — Calibri-Bold 10 pt em caixa alta, o mesmo papel que
// "TEXTO I" cumpre dentro de uma questão.
function enemSubhead(doc, ctx, flow, texto){
  enemEnsure(doc, ctx, flow, ENEM.leading * 2);
  flow.y += 1.5 * MM;
  enemFont(doc, "bold", ENEM.body);
  enemInk(doc);
  doc.text(String(texto).toUpperCase(), flow.x, flow.y + ENEM.body);
  flow.y += ENEM.leading;
}

// Rótulo "QUESTÃO N" em CAIXA ALTA (11 pt bold) seguido da barra-ornamento:
// filete escuro de 1 pt no topo e, abaixo, faixa de 1,06 mm com 79,5 % em
// #B9E5FA e 20,5 % em #231F20. A barra começa sempre a 24,47 mm da borda da
// coluna, qualquer que seja o comprimento do rótulo.
function enemBlockLabel(doc, ctx, flow, texto){
  enemEnsure(doc, ctx, flow, ENEM.qLabel * 3);
  const y = flow.y + ENEM.qLabel;

  enemFont(doc, "bold", ENEM.qLabel);
  enemInk(doc);
  doc.text(String(texto).toUpperCase(), flow.x, y);

  const x0 = flow.x + ENEM.ornStart;
  const x1 = flow.x + flow.w - ENEM.ornEndGap;
  if(x1 > x0){
    const barY = y - 2.6;
    enemSolidLine(doc, x0, barY, x1, 1.0, ENEM.ink);
    const cut = x0 + (x1 - x0) * ENEM.ornBlueShare;
    doc.setFillColor(ENEM.azul[0], ENEM.azul[1], ENEM.azul[2]);
    doc.rect(x0, barY + 0.5, cut - x0, ENEM.ornH, "F");
    doc.setFillColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
    doc.rect(cut, barY + 0.5, x1 - cut, ENEM.ornH, "F");
  }
  flow.y += ENEM.qLabel + 0.76 * MM;
}

// Título de área — Calibri-Bold 11 pt em caixa alta, recuado 2 mm da margem da
// coluna. É o componente que abre uma seção do caderno; a barra-ornamento
// pertence à questão e não é usada aqui.
function enemAreaTitle(doc, ctx, flow, texto){
  if(!texto) return;
  enemEnsure(doc, ctx, flow, ENEM.areaTitle * 3);
  enemFont(doc, "bold", ENEM.areaTitle);
  enemInk(doc);
  doc.text(String(texto).toUpperCase(), flow.x + 2 * MM, flow.y + ENEM.areaTitle,
           { maxWidth: flow.w - 2 * MM });
  flow.y += ENEM.areaTitle + 3.2 * MM;
}

function enemQuestionLabel(doc, ctx, flow, numero){
  enemBlockLabel(doc, ctx, flow, "QUESTÃO " + numero);
}

// Letra-opção circulada. No original é um glifo da fonte dingbat
// BundesbahnPiStd-1; aqui é traçado vetorial equivalente, para não depender de
// fonte incorporada.
function enemOptionMark(doc, x, yBaseline, letter){
  const r = 4.8;
  const cx = x + r, cy = yBaseline - 3.0;
  doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
  doc.setLineWidth(0.6);
  doc.circle(cx, cy, r, "S");
  enemFont(doc, "normal", ENEM.body * 0.80);
  enemInk(doc);
  doc.text(letter, cx, cy + 2.5, { align: "center" });
}

/* Alternativa A–E: letra circulada encostada na margem da coluna, texto
   pendurado a 4,5 mm, entrelinha 13,4 pt, JUSTIFICADO nas duas margens.

   Determinação do professor: todo texto do simulado sai justificado — o
   texto-base, o comando, as alternativas, o gabarito e os comentários de cada
   alternativa —, no PDF, no Word e no HTML. Esta função desenha tanto as
   alternativas da prova quanto os comentários da versão do professor, então a
   regra vale nos dois lugares. A última linha de cada alternativa nunca é
   esticada (enemDrawRichLine trata isso), e alternativa de uma linha só — o
   caso comum em Matemática, Física e Química — fica visualmente igual ao que
   era antes, porque linha única é sempre última linha.                       */
function enemAlternative(doc, ctx, flow, letter, text){
  const width = flow.w - ENEM.hang;
  const clean = pdfSanitizeText(String(text || "").trim()) || "—";
  const lines = enemWrapRuns(doc, enemRichRuns(clean), width, ENEM.body, false);
  lines.forEach((parts, i) => {
    enemEnsure(doc, ctx, flow, ENEM.altLeading);
    const base = flow.y + ENEM.body;
    if(i === 0) enemOptionMark(doc, flow.x, base, letter);
    // Justificadas, com o texto pendurado a 4,5 mm da letra circulada.
    enemDrawRichLine(doc, parts, flow.x + ENEM.hang, base, width, ENEM.body,
                     "justify", i === lines.length - 1, false);
    flow.y += ENEM.altLeading;
  });
}

// Quebra o texto em trechos normais e em negrito. O título da obra vem marcado
// com **asteriscos duplos**, convenção que o gerador de questões já usa.
function enemRichRuns(text){
  const out = [];
  String(text).split(/(\*\*[^*]+\*\*)/g).forEach(part => {
    if(!part) return;
    const bold = /^\*\*[^*]+\*\*$/.test(part);
    out.push({ text: bold ? part.slice(2, -2) : part, bold: bold });
  });
  return out.length ? out : [{ text: String(text), bold: false }];
}

// Quebra os trechos em linhas que caibam na largura, preservando o peso de cada
// palavra. Devolve um array de linhas; cada linha é um array de { text, bold }.
function enemWrapRuns(doc, runs, width, size, italic, firstIndent){
  const fi = firstIndent || 0;                     // recuo só da 1ª linha
  const lines = [];
  let line = [], lineW = 0;
  const limite = () => (lines.length === 0 ? width - fi : width);
  runs.forEach(run => {
    enemFont(doc, enemStyle(run.bold, !!italic), size);
    run.text.split(/([ \t\n]+)/).forEach(tok => {
      if(!tok) return;
      const w = doc.getTextWidth(tok);
      if(/^[ \t\n]+$/.test(tok)){
        if(line.length){ line.push({ text: tok, bold: run.bold, w: w }); lineW += w; }
        return;
      }
      if(lineW + w > limite() && line.length){
        while(line.length && /^[ \t\n]+$/.test(line[line.length - 1].text)) { lineW -= line.pop().w; }
        lines.push(line); line = []; lineW = 0;
      }
      line.push({ text: tok, bold: run.bold, w: w });
      lineW += w;
    });
  });
  if(line.length) lines.push(line);
  return lines;
}

// Estilo da fonte na substituição Helvetica → Calibri.
function enemStyle(bold, italic){
  return bold ? (italic ? "bolditalic" : "bold") : (italic ? "italic" : "normal");
}

// Desenha uma linha de trechos com peso/inclinação mistos.
//   align "right"   → bandeira à esquerda (referência do texto introdutório)
//   align "justify" → justificada nas duas margens (referência de recurso visual);
//                     a última linha do bloco nunca é esticada
function enemDrawRichLine(doc, parts, x, y, width, size, align, isLast, italic){
  const total = parts.reduce((a, p) => a + p.w, 0);
  let extra = 0;
  let cx = x;
  if(align === "right"){
    cx = x + width - total;
  }else if(align === "justify" && !isLast){
    const gaps = parts.filter(p => /^[ \t\n]+$/.test(p.text)).length;
    if(gaps > 0) extra = (width - total) / gaps;
  }
  parts.forEach(p => {
    const isGap = /^[ \t\n]+$/.test(p.text);   // o espaço inseparável NÃO é vão de justificação
    if(!isGap){
      enemFont(doc, enemStyle(p.bold, italic), size);
      enemInk(doc);
      doc.text(p.text, cx, y);
    }
    cx += p.w + (isGap ? extra : 0);
  });
}

/* Referência / fonte bibliográfica — sempre no CORPO MENOS DOIS PONTOS (8 pt
   para um corpo de 10 pt). Há dois tratamentos, e eles não se misturam:

   ▸ REFERÊNCIA DO TEXTO INTRODUTÓRIO (o texto-base da questão): em ITÁLICO,
     alinhada à direita, com o título da obra em negrito-itálico.

   ▸ REFERÊNCIA DE IMAGEM, TABELA E GRÁFICO: JUSTIFICADA nas duas margens, em
     redondo, com o título da obra em negrito.

   Divergência autorizada pelo professor: o caderno oficial de 2025 não usa
   itálico em nenhum dos 3.484 caracteres de referência e alinha tudo à direita.
   O itálico no texto introdutório e a justificação nas legendas de recurso
   visual são decisão deste sistema, registradas no design system.            */
function enemCaption(doc, ctx, flow, text, opts){
  const o = opts || {};
  const align = o.align || "right";
  const italic = !!o.italic;
  const clean = pdfSanitizeText(String(text || "").trim());
  if(!clean) return;
  const size = ENEM.caption;
  const runs = enemRichRuns(clean);
  // A medição precisa usar a mesma inclinação com que a linha será desenhada.
  const lines = enemWrapRuns(doc, runs, flow.w, size, italic);
  const lh = ENEM.captionLead;
  lines.forEach((parts, i) => {
    enemEnsure(doc, ctx, flow, lh);
    enemDrawRichLine(doc, parts, flow.x, flow.y + size, flow.w, size, align,
                     i === lines.length - 1, italic);
    flow.y += lh;
  });
  flow.y += 1.5;
}

// Reconhece a linha de referência bibliográfica ao fim do texto-base. O gerador
// de questões emite a fonte como último parágrafo, no padrão ABNT.
function enemIsReference(par){
  const t = String(par || "").trim();
  if(!t || t.length > 340) return false;
  if(/(Dispon[ií]vel em|Acesso em|adaptado\)|fragmento\)|adaptada\))/i.test(t)) return true;
  // SOBRENOME, N. ... com ano no fim — assinatura típica de referência ABNT.
  if(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ'\-]{1,}\s*,/.test(t) && /\d{4}/.test(t)) return true;
  return false;
}

// Texto-base: parágrafos de corpo e, se o último for a fonte bibliográfica,
// ela sai no tratamento de referência do texto introdutório.
function enemTextoBase(doc, ctx, flow, text, fonte){
  const pars = String(text || "").trim().split(/\n+/).filter(p => p.trim());
  let ref = String(fonte || "").trim();
  if(!ref && pars.length > 1 && enemIsReference(pars[pars.length - 1])) ref = pars.pop();
  pars.forEach(par => enemParagraph(doc, ctx, flow, par));
  if(ref) enemCaption(doc, ctx, flow, ref, { align: "right", italic: true });
}

// Recurso visual dentro da coluna. Imagem e gráfico entram COLORIDOS — em 2025
// metade das figuras do caderno oficial é colorida. Tabela é desenhada como
// tabela vetorial, com o cabeçalho preenchido em #6DCFF6.
function enemVisual(doc, ctx, flow, visual, cardIdx){
  if(!visual || !visual.tipo) return;

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return;
    const cw = flow.w / cols.length;
    const pad = 3;
    enemFont(doc, "bold", ENEM.body);
    const head = cols.map(c => doc.splitTextToSize(pdfSanitizeText(String(c)), cw - pad * 2));
    enemFont(doc, "normal", ENEM.body);
    const body = rows.map(r => r.map(c => doc.splitTextToSize(pdfSanitizeText(String(c)), cw - pad * 2)));
    const lh = ENEM.leading;
    const hH = Math.max.apply(null, head.map(l => l.length).concat([1])) * lh + pad * 2;
    const rH = body.map(r => Math.max.apply(null, r.map(l => l.length).concat([1])) * lh + pad * 2);
    enemEnsure(doc, ctx, flow, Math.min(hH + rH.reduce((a, b) => a + b, 0), flow.bottom - flow.top));
    let y = flow.y;

    doc.setFillColor(ENEM.azulTab[0], ENEM.azulTab[1], ENEM.azulTab[2]);
    doc.rect(flow.x, y, cw * cols.length, hH, "F");
    doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
    doc.setLineWidth(1.0);
    doc.rect(flow.x, y, cw * cols.length, hH, "S");
    enemFont(doc, "bold", ENEM.body);
    enemInk(doc);
    head.forEach((lines, i) => {
      lines.forEach((ln, k) => doc.text(ln, flow.x + i * cw + cw / 2, y + pad + ENEM.body + k * lh, { align: "center" }));
    });
    y += hH;

    doc.setLineWidth(0.5);
    body.forEach((row, ri) => {
      row.forEach((lines, ci) => {
        doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
        doc.rect(flow.x + ci * cw, y, cw, rH[ri], "S");
        enemFont(doc, "normal", ENEM.body);
        enemInk(doc);
        lines.forEach((ln, k) => doc.text(ln, flow.x + ci * cw + cw / 2, y + pad + ENEM.body + k * lh, { align: "center" }));
      });
      y += rH[ri];
    });
    flow.y = y + 2.11 * MM;
    if(visual.titulo) enemCaption(doc, ctx, flow, visual.titulo, { align: "justify" });
    return;
  }

  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx) : pdfGetVisualChartInfo(cardIdx);
  if(!info) return;
  const ratio = info.height / info.width;
  let w = flow.w;
  let h = w * ratio;
  const maxH = flow.bottom - flow.top - 30;
  if(h > maxH){ h = maxH; w = h / ratio; }
  flow.y += 1.60 * MM;                       // espaço texto → figura
  enemEnsure(doc, ctx, flow, h + 4);
  const fmtMatch = /^data:image\/(png|jpe?g|webp);base64,/i.exec(info.dataUrl);
  const fmt = fmtMatch ? fmtMatch[1].toUpperCase().replace("JPG", "JPEG") : "PNG";
  try{ doc.addImage(info.dataUrl, fmt, flow.x + (flow.w - w) / 2, flow.y, w, h); }catch(e){ return; }
  flow.y += h + 2.11 * MM;                   // espaço figura → texto
  if(visual.descricao) enemCaption(doc, ctx, flow, visual.descricao, { align: "justify" });
}

// Filete de fechamento: sólido, 0,5 pt, largura cheia da coluna. No caderno
// oficial ele aparece SÓ quando a questão encerra a coluna (15 das 60 colunas);
// entre questões consecutivas quem separa é a barra da questão seguinte.
function enemCloseQuestion(doc, ctx, flow, isLastOfColumn){
  flow.y += 2.53 * MM;
  if(isLastOfColumn){
    enemSolidLine(doc, flow.x, flow.y, flow.x + flow.w, 0.5, ENEM.ink);
    flow.y += 3;
  }
}

/* FOLHA DE GABARITO (versão do aluno) — sai DEPOIS de todas as questões e traz
   SOMENTE a letra de cada questão. Nada de resolução, comentário, competência,
   habilidade ou dificuldade: isso é exclusivo da versão do professor.
   Mesma anatomia: página nova, título de área, fluxo de duas colunas.        */
function enemGabaritoAluno(doc, ctx, flow, doneQuestions){
  enemSetMode(doc, ctx, flow, 2);
  doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
  ctx.pageNo += 1;
  enemStartPage(doc, ctx, flow, 2);
  enemAreaTitle(doc, ctx, flow, "Gabarito");

  doneQuestions.forEach(o => {
    const letra = letraCorretaDe(o.q.data) || "—";
    enemEnsure(doc, ctx, flow, ENEM.altLeading);
    const base = flow.y + ENEM.body;
    // Número da questão à esquerda, letra circulada logo depois — a mesma
    // letra-opção usada nas alternativas, para o aluno reconhecer de imediato.
    enemFont(doc, "bold", ENEM.body);
    enemInk(doc);
    const rotulo = String(o.idx + 1) + ".";
    doc.text(rotulo, flow.x, base);
    if(/^[A-E]$/.test(letra)){
      enemOptionMark(doc, flow.x + 8 * MM, base, letra);
    }else{
      enemFont(doc, "normal", ENEM.body);
      doc.text(letra, flow.x + 8 * MM, base);
    }
    flow.y += ENEM.altLeading;
  });
  flow.y += 2.53 * MM;
  enemSolidLine(doc, flow.x, flow.y, flow.x + flow.w, 0.5, ENEM.ink);
}

/* CADERNO DE RESPOSTAS (versão do professor) — sai DEPOIS de todas as questões,
   na mesma anatomia: 200 × 275 mm, duas colunas de 89,47 mm, Calibri 10/12,0 pt,
   tinta #231F20, rótulo em caixa alta com a barra-ornamento. Nenhum componente
   novo é inventado aqui: o que muda é o conteúdo, não a forma.               */
function enemGabaritoBlock(doc, ctx, flow, o, isLastOfColumn){
  const d = o.q.data || {};
  const numero = o.idx + 1;

  enemQuestionLabel(doc, ctx, flow, numero);

  // Gabarito: letra circulada na margem e a resposta correta ao lado.
  const letra = letraCorretaDe(d) || "—";
  enemEnsure(doc, ctx, flow, ENEM.altLeading);
  const base = flow.y + ENEM.body;
  if(/^[A-E]$/.test(letra)) enemOptionMark(doc, flow.x, base, letra);
  enemFont(doc, "bold", ENEM.body);
  enemInk(doc);
  doc.text("GABARITO: " + letra, flow.x + ENEM.hang, base);
  flow.y += ENEM.altLeading;
  const resposta = (d.alternativas && d.alternativas[letraCorretaDe(d)]) || "";
  if(resposta) enemRichParagraph(doc, ctx, flow, resposta, { indent: ENEM.hang });

  // Ficha pedagógica — cada linha é "rótulo: valor", o rótulo em negrito.
  const ficha = [];
  if(d.competencia && (d.competencia.numero || d.competencia.texto)){
    ficha.push("**Competência " + (d.competencia.numero || "—") + ":** " + (d.competencia.texto || ""));
  }
  if(d.habilidade && (d.habilidade.codigo || d.habilidade.texto)){
    ficha.push("**Habilidade " + (d.habilidade.codigo || "—") + ":** " + (d.habilidade.texto || ""));
  }
  if(d.objetoConhecimento) ficha.push("**Objeto de conhecimento:** " + d.objetoConhecimento);
  const conteudo = d.tema || o.q.tema || "";
  if(conteudo) ficha.push("**Conteúdo abordado:** " + conteudo);
  const dif = d.dificuldade || o.q.dificuldade || "";
  if(dif) ficha.push("**Nível de dificuldade:** " + dif);
  if(ficha.length){
    enemSubhead(doc, ctx, flow, "Ficha pedagógica");
    ficha.forEach(l => enemRichParagraph(doc, ctx, flow, l));
  }

  if(d.resolucaoComentada){
    enemSubhead(doc, ctx, flow, "Resolução comentada");
    enemParagraph(doc, ctx, flow, d.resolucaoComentada, { indent: 0 });
  }

  const analise = d.analiseAlternativas || {};
  const temAnalise = ["A","B","C","D","E"].some(L => analise[L] && analise[L].comentario);
  if(temAnalise){
    enemSubhead(doc, ctx, flow, "Comentários das alternativas");
    ["A","B","C","D","E"].forEach(L => {
      const info = analise[L];
      if(!info) return;
      const status = marcaAlternativa(conferenciaGabarito(d), L, false);
      enemAlternative(doc, ctx, flow, L, status + " — " + (info.comentario || ""));
    });
  }

  enemCloseQuestion(doc, ctx, flow, isLastOfColumn);
}

// Uma questão só vai para o modo de coluna única quando traz uma figura larga —
// proporção a partir de 1,8 : 1, que a 89,47 mm ficaria ilegível.
function enemNeedsWidePage(o){
  const d = o.q.data;
  if(!d.visual || !d.visual.tipo || d.visual.tipo === "tabela") return false;
  const info = d.visual.tipo === "imagem" ? pdfGetVisualImageInfo(o.idx) : pdfGetVisualChartInfo(o.idx);
  if(!info || !info.height) return false;
  return (info.width / info.height) >= 1.8;
}

/* Monta o PDF inteiro na anatomia do caderno ENEM 2025. As duas versões usam
   EXATAMENTE a mesma diagramação; a do professor apenas acrescenta, DEPOIS de
   todas as questões, o caderno de respostas — gabarito, ficha pedagógica,
   resolução comentada e comentário de cada alternativa, questão por questão. */
function enemBuildPdfDoc(doneQuestions, professor){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: [ENEM.pageW, ENEM.pageH], orientation: "portrait" });
  doc.__carlito = enemRegistraFontes(doc);
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const ctx = {
    areaLabel,
    ano: new Date().getFullYear(),
    footerText: [String(areaLabel).toUpperCase(), state.disciplina || "",
                 professor ? "VERSÃO DO PROFESSOR" : "VERSÃO DO ALUNO"].filter(Boolean).join(" | "),
    pageNo: 1,
  };

  // O modo da primeira página já nasce certo, para não abrir página em branco
  // quando a primeira questão traz figura larga.
  const wideMap = doneQuestions.map(enemNeedsWidePage);
  const flow = enemNewFlow(doc, ctx, wideMap[0] ? 1 : 2);

  // Título de área abre a primeira coluna, recuado 2 mm, 11 pt bold caixa alta.
  enemAreaTitle(doc, ctx, flow, areaLabel);

  doneQuestions.forEach((o, i) => {
    const d = o.q.data;
    enemSetMode(doc, ctx, flow, wideMap[i] ? 1 : 2);

    enemQuestionLabel(doc, ctx, flow, o.idx + 1);
    if(d.textoBase) enemTextoBase(doc, ctx, flow, d.textoBase, d.fonte);
    if(d.visual && d.visual.tipo) enemVisual(doc, ctx, flow, d.visual, o.idx);
    if(d.comando) enemParagraph(doc, ctx, flow, d.comando, { indent: 0 });
    flow.y += 1.51 * MM;                     // espaço corpo → 1ª alternativa
    ["A", "B", "C", "D", "E"].forEach(letter => {
      enemAlternative(doc, ctx, flow, letter, (d.alternativas && d.alternativas[letter]) || "");
    });
    // Fecha com filete só se a próxima questão não couber nesta coluna.
    const last = i === doneQuestions.length - 1;
    enemCloseQuestion(doc, ctx, flow, last || !enemFits(flow, 70));
  });

  // ---- Fim do caderno de questões. O que vem depois depende da versão:
  //      aluno → só as letras do gabarito;  professor → o caderno de respostas.
  if(!professor){
    enemGabaritoAluno(doc, ctx, flow, doneQuestions);
  }
  if(professor){
    enemSetMode(doc, ctx, flow, 2);
    if(flow.y > flow.top){
      doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
      ctx.pageNo += 1;
      enemStartPage(doc, ctx, flow, 2);
    }
    enemAreaTitle(doc, ctx, flow, "Gabarito e resoluções");
    doneQuestions.forEach((o, i) => {
      const last = i === doneQuestions.length - 1;
      enemGabaritoBlock(doc, ctx, flow, o, last || !enemFits(flow, 70));
    });
  }

  const rotulo = professor ? "professor" : "aluno";
  const safeName = "Simulado_ENEM_" + (state.disciplina || "questoes").replace(/[^a-zA-Z0-9]+/g, "_") + "_" + rotulo + ".pdf";
  return { doc: doc, safeName: safeName };
}

// Baixar o PDF. Construção e entrega ficam separadas para que a IMPRESSÃO possa
// usar exatamente o mesmo documento, sem uma segunda diagramação para manter
// em sincronia.
function enemExportPdf(doneQuestions, professor){
  const built = enemBuildPdfDoc(doneQuestions, professor);
  built.doc.save(built.safeName);
}


/* ---- IMPRESSÃO E EXPORTAÇÃO HTML na anatomia do caderno ENEM 2025 ----

   Duas saídas, uma só especificação:

   • "Imprimir" monta EXATAMENTE o mesmo documento do botão PDF (as mesmas
     funções enem*), chama doc.autoPrint() e abre o blob numa aba. A folha que
     sai da impressora não pode divergir do PDF nem por um décimo de milímetro,
     porque é o mesmo arquivo — inclusive fólio, margens espelhadas e cromo de
     página. Antes este botão chamava window.print() sobre a tela do app, e o
     que ia para a impressora eram os cartões da interface.

   • "Exportar HTML" — DESDE A v13 NÃO USA MAIS o que segue. O botão passou a
     embutir o próprio PDF no arquivo HTML (ver exportHtmlSnapshot /
     enemBuildHtmlComPdf). ENEM_PRINT_CSS e as funções enemPrint* /
     enemBuildPrintHTML abaixo ficam no arquivo apenas como referência e não
     são chamadas por ninguém. Elas geravam um documento web em CSS que, na
     tela, não reproduzia o PDF: sem altura de página, column-fill:auto punha
     todo o texto na primeira coluna e não havia paginação nem fólio.        */

function enemPrintEsc(s){
  return quiJuntaFormula(String(s == null ? "" : s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// **negrito** vira <strong>; todo o resto é escapado.
function enemPrintRich(text){
  return enemRichRuns(quiJuntaFormula(String(text == null ? "" : text)))
    .map(r => r.bold ? "<strong>" + enemPrintEsc(r.text) + "</strong>" : enemPrintEsc(r.text))
    .join("");
}

const ENEM_PRINT_CSS = `
/* Formato próprio do INEP — 200 × 275 mm, menor que A4. Margens ESPELHADAS:
   a mancha desliza 2,5 mm conforme a paridade da página, deixando a margem
   externa maior que a interna (§1). O cabeçalho e o rodapé ficam DENTRO do
   fluxo, no <thead>/<tfoot>, por isso a margem do @page é a do papel. */
@page { size: 200mm 275mm; margin: 8mm 9.67mm 6mm 8mm; }
@page :right { margin: 8mm 9.67mm 6mm 8mm; }
@page :left  { margin: 8mm 8mm 6mm 10.5mm; }

*{ box-sizing: border-box; }
html,body{ margin:0; padding:0; }
body{
  font-family: Calibri, Carlito, "Segoe UI", system-ui, sans-serif;
  font-size: 10pt;
  line-height: 12pt;              /* entrelinha do corpo: 12,0 pt (1,20x) */
  color: #231F20;                 /* preto quente de impressão, NÃO #000000 */
  background: #fff;
  letter-spacing: 0;              /* tracking nativo: medido em 0,0000 pt */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* A tabela é só o veículo do cromo repetido: <thead> reserva a faixa do
   cabeçalho (28 − 8 = 20 mm) e <tfoot> a do rodapé (269 − 260 = 9 mm). */
table.pg{ width:100%; border-collapse:collapse; }
table.pg > thead td{ height:20mm; padding:0; vertical-align:top; position:relative; }
table.pg > tfoot td{ height:9mm;  padding:0; vertical-align:bottom; }
table.pg > tbody td{ padding:0; vertical-align:top; }

.marca{ font-size:16pt; font-weight:700; color:#004B8D; line-height:1; }
.marca .ano{ color:#939598; font-weight:400; }
.marca-sub{ font-size:5.5pt; color:#939598; margin-top:0.8mm; }
.cab{ display:flex; align-items:flex-start; gap:4mm; padding-top:2.3mm; }
.quadros{ display:flex; gap:0.4mm; margin-top:0.4mm; }
.quadros i{ width:5.5mm; height:6.6mm; background:#939598; transform:skewX(-20deg); display:block; }
.barra-cinza{ width:48.93mm; height:2.38mm; background:#939598; margin-top:1.6mm; }

/* Filete misto: um trecho azul de 49,16 mm do lado interno e um de microtexto
   de 131,54 mm do lado externo — no rodapé a composição se inverte (§4). */
.filete{ height:1.06mm; display:flex; align-items:flex-start; margin-top:1.5mm; }
.filete .azul{ flex:0 0 49.16mm; height:1.06mm; background:#B9E5FA; }
.filete .micro{
  flex:0 0 131.54mm; min-width:0; overflow:hidden; white-space:nowrap;
  font:700 1.5pt/1 Arial, sans-serif; color:#231F20;
}
.rodape{ display:flex; align-items:baseline; font-size:9pt; color:#58595B; margin-top:1.1mm; }

/* Tarja da versão: 11 × 30 mm sangrando na borda externa, com o quadrado de
   registro de 3 × 3 mm na quina interna. Vive no <thead>, e por isso se repete. */
.tarja{ position:absolute; top:-8mm; right:-9.67mm; width:11mm; height:30mm; background:#B9E5FA; }
.tarja i{ position:absolute; left:-1.5mm; top:31.5mm; width:3mm; height:3mm; background:#231F20; }

/* Miolo: duas colunas de 89,47 mm, calha de 3,40 mm com fio vertical SÓLIDO de
   0,5 pt. Em 2025 não existe mais traço pontilhado no caderno. */
.miolo{ column-count:2; column-gap:3.40mm; column-rule:0.5pt solid #231F20; column-fill:auto; }
.miolo.unica{ column-count:1; column-rule:none; }
.quebra{ break-before:page; }

/* Título de área — 11 pt bold caixa alta, recuado 2 mm, sem barra-ornamento. */
.area{ font-size:11pt; font-weight:700; text-transform:uppercase; margin:0 0 3.2mm 2mm; }

/* Rótulo QUESTÃO N + barra-ornamento: começa sempre a 24,47 mm da borda da
   coluna, termina 0,30 mm antes da direita, altura 1,06 mm, filete escuro de
   1 pt no topo, 79,5 % em #B9E5FA e 20,5 % em #231F20 (§5.2). */
.rotulo{ display:flex; align-items:center; margin:0 0 0.76mm; break-after:avoid; }
.rotulo .txt{ width:24.47mm; flex:0 0 24.47mm; font-size:11pt; font-weight:700;
              text-transform:uppercase; white-space:nowrap; }
.rotulo .barra{
  flex:1; height:1.06mm; margin-right:0.30mm; border-top:1pt solid #231F20;
  background:linear-gradient(to right,#B9E5FA 0 79.5%,#231F20 79.5% 100%);
}

/* Corpo: justificado, primeira linha recuada em 6 mm, sem espaço entre
   parágrafos. Comando: justificado e SEM recuo. */
.corpo{ margin:0; text-align:justify; text-indent:6mm; }
.comando{ margin:0; text-align:justify; text-indent:0; }

/* §2.1 — as duas referências, que nunca se misturam. Ambas em corpo − 2 pt. */
.ref{ font-size:8pt; line-height:9.6pt; margin:0.5mm 0 1.5mm; }
.ref-texto{ text-align:right; font-style:italic; }
.ref-visual{ text-align:justify; }

/* Alternativas: letra circulada na margem, texto pendurado a 4,5 mm,
   entrelinha 13,4 pt, justificadas — como no PDF e no Word. */
.alts{ margin:1.51mm 0 0; }
.alt{ margin:0; padding-left:4.5mm; text-indent:-4.5mm; line-height:13.4pt; text-align:justify; }
.alt .letra{ font-family:"Segoe UI Symbol","Apple Symbols",Calibri,sans-serif; margin-right:1.6mm; }

/* Filete sólido de fechamento, 0,5 pt, largura cheia da coluna. No caderno
   oficial ele aparece SÓ no fim da sequência — entre questões consecutivas
   quem separa é a barra-ornamento da questão seguinte (§5.9). */
.fecho{ margin:2.53mm 0 0; }
.miolo > .questao:last-child .fecho,
.miolo > .fecho{ border-bottom:0.5pt solid #231F20; }
.questao{ margin-bottom:2.53mm; }

/* Subtítulo interno — bold 10 pt caixa alta, 1,5 mm de respiro acima (§7.4). */
.sub{ font-size:10pt; font-weight:700; text-transform:uppercase; margin:1.5mm 0 0; break-after:avoid; }
.ficha{ margin:0; text-align:justify; }

figure{ margin:1.6mm 0 2.11mm; break-inside:avoid; }
figure img{ display:block; max-width:100%; height:auto; margin:0 auto; }

/* Tabela: moldura externa 1 pt, divisórias 0,5 pt, cabeçalho em #6DCFF6 com
   texto bold 10 pt centralizado (§6). */
table.dados{ width:100%; border-collapse:collapse; margin:1.6mm 0 2.11mm; break-inside:avoid; }
table.dados th,table.dados td{ border:0.5pt solid #231F20; padding:1mm 1.5mm;
                               text-align:center; font-size:10pt; line-height:12pt; }
table.dados th{ background:#6DCFF6; font-weight:700; border-width:1pt; }

@media screen{
  body{ background:#e9e9ec; padding:10mm 0; }
  table.pg{ width:200mm; margin:0 auto; background:#fff; padding:8mm 9.67mm 6mm 8mm;
            box-shadow:0 2px 18px rgba(0,0,0,.18); }
  .aviso{ width:200mm; margin:0 auto 8mm; font:400 13px/1.55 system-ui,sans-serif;
          color:#333; background:#fff; border-left:3px solid #004B8D; padding:12px 16px 12px 14px; }
}
@media print{
  .aviso{ display:none; }
  /* Nota: na ÚLTIMA folha, se o conteúdo termina no meio da página, o rodapé
     sobe junto com ele — é limitação do <tfoot> repetido, o único mecanismo de
     cromo de página que o Chrome honra na impressão. A folha idêntica ao PDF,
     com rodapé fixo na base e fólio, sai pelo botão Imprimir. */
}
`;

function enemPrintChromeTop(ctx){
  return '<thead><tr><td>' +
    '<div class="tarja"><i></i></div>' +
    '<div class="cab"><div>' +
    '<div class="marca">simulado<span class="ano">' + enemPrintEsc(ctx.ano) + '</span></div>' +
    '<div class="marca-sub">Simulado no padrão do caderno ENEM</div></div>' +
    '<div class="quadros"><i></i><i></i><i></i><i></i></div></div>' +
    '<div class="barra-cinza"></div>' +
    '<div class="filete"><span class="azul"></span>' +
    '<span class="micro">' + "SIMULADO".repeat(150) + '</span></div>' +
    '</td></tr></thead>';
}

function enemPrintChromeBot(ctx){
  return '<tfoot><tr><td>' +
    '<div class="filete"><span class="micro">' + "SIMULADO".repeat(150) + '</span>' +
    '<span class="azul"></span></div>' +
    '<div class="rodape"><span>' + enemPrintEsc(ctx.footerText) + '</span></div>' +
    '</td></tr></tfoot>';
}

function enemPrintRotulo(texto){
  return '<div class="rotulo"><span class="txt">' + enemPrintEsc(texto) +
         '</span><span class="barra"></span></div>';
}

// Texto-base: parágrafos de corpo e, no fim, a referência do TEXTO INTRODUTÓRIO
// — itálico, à direita (§2.1). Mesma regra e mesma detecção do PDF.
function enemPrintTextoBase(out, text, fonte){
  const pars = String(text || "").trim().split(/\n+/).filter(p => p.trim());
  let ref = String(fonte || "").trim();
  if(!ref && pars.length > 1 && enemIsReference(pars[pars.length - 1])) ref = pars.pop();
  pars.forEach(p => out.push('<p class="corpo">' + enemPrintRich(p) + '</p>'));
  if(ref) out.push('<p class="ref ref-texto">' + enemPrintRich(ref) + '</p>');
}

// Recurso visual. A referência de imagem, tabela e gráfico é redonda e
// JUSTIFICADA (§2.1) — nunca em itálico, nunca à direita.
function enemPrintVisual(out, visual, cardIdx){
  if(!visual || !visual.tipo) return;
  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return;
    out.push('<table class="dados"><thead><tr>' +
      cols.map(c => '<th>' + enemPrintEsc(c) + '</th>').join("") + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map(c => '<td>' + enemPrintEsc(c) + '</td>').join("") + '</tr>').join("") +
      '</tbody></table>');
    if(visual.titulo) out.push('<p class="ref ref-visual">' + enemPrintRich(visual.titulo) + '</p>');
    return;
  }
  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx, false, true) : pdfGetVisualChartInfo(cardIdx);
  if(!info || !info.dataUrl) return;
  out.push('<figure><img src="' + info.dataUrl + '" alt=""></figure>');
  if(visual.descricao) out.push('<p class="ref ref-visual">' + enemPrintRich(visual.descricao) + '</p>');
}

// Caderno de questões — IDÊNTICO nas duas versões. Nada de gabarito, resolução
// ou comentário aparece aqui (§7.1).
function enemPrintQuestao(o){
  const d = o.q.data || {};
  const out = ['<section class="questao">'];
  out.push(enemPrintRotulo("Questão " + (o.idx + 1)));
  if(d.textoBase) enemPrintTextoBase(out, d.textoBase, d.fonte);
  if(d.visual && d.visual.tipo) enemPrintVisual(out, d.visual, o.idx);
  if(d.comando) out.push('<p class="comando">' + enemPrintRich(d.comando) + '</p>');
  out.push('<div class="alts">');
  ["A","B","C","D","E"].forEach(L => {
    out.push('<p class="alt"><span class="letra">' + (ENEM_DOCX_MARKS[L] || L) +
             '</span>' + enemPrintRich((d.alternativas && d.alternativas[L]) || "") + '</p>');
  });
  out.push('</div><div class="fecho"></div></section>');
  return out.join("\n");
}

// Caderno de respostas — SÓ na versão do professor (§7.3).
function enemPrintResposta(o){
  const d = o.q.data || {};
  const out = ['<section class="questao">'];
  out.push(enemPrintRotulo("Questão " + (o.idx + 1)));
  const letra = letraCorretaDe(d) || "—";
  out.push('<p class="alt"><span class="letra">' + (ENEM_DOCX_MARKS[letra] || letra) +
           '</span><strong>GABARITO: ' + enemPrintEsc(letra) + '</strong></p>');
  const resposta = (d.alternativas && d.alternativas[letraCorretaDe(d)]) || "";
  if(resposta) out.push('<p class="ficha" style="margin-left:4.5mm">' + enemPrintRich(resposta) + '</p>');

  const ficha = [];
  if(d.competencia && (d.competencia.numero || d.competencia.texto)){
    ficha.push("**Competência " + (d.competencia.numero || "—") + ":** " + (d.competencia.texto || ""));
  }
  if(d.habilidade && (d.habilidade.codigo || d.habilidade.texto)){
    ficha.push("**Habilidade " + (d.habilidade.codigo || "—") + ":** " + (d.habilidade.texto || ""));
  }
  if(d.objetoConhecimento) ficha.push("**Objeto de conhecimento:** " + d.objetoConhecimento);
  const conteudo = d.tema || o.q.tema || "";
  if(conteudo) ficha.push("**Conteúdo abordado:** " + conteudo);
  const dif = d.dificuldade || o.q.dificuldade || "";
  if(dif) ficha.push("**Nível de dificuldade:** " + dif);
  if(ficha.length){
    out.push('<p class="sub">Ficha pedagógica</p>');
    ficha.forEach(l => out.push('<p class="ficha">' + enemPrintRich(l) + '</p>'));
  }
  if(d.resolucaoComentada){
    out.push('<p class="sub">Resolução comentada</p>');
    out.push('<p class="comando">' + enemPrintRich(d.resolucaoComentada) + '</p>');
  }
  const analise = d.analiseAlternativas || {};
  if(["A","B","C","D","E"].some(L => analise[L] && analise[L].comentario)){
    out.push('<p class="sub">Comentários das alternativas</p>');
    ["A","B","C","D","E"].forEach(L => {
      const info = analise[L];
      if(!info) return;
      const status = marcaAlternativa(conferenciaGabarito(d), L, false);
      out.push('<p class="alt"><span class="letra">' + (ENEM_DOCX_MARKS[L] || L) +
               '</span>' + status + " — " + enemPrintRich(info.comentario || "") + '</p>');
    });
  }
  out.push('<div class="fecho"></div></section>');
  return out.join("\n");
}

/* Documento HTML completo. Questões em blocos contíguos por modo de coluna:
   uma questão com figura larga põe a página inteira em coluna única (§6), então
   ela abre um bloco .miolo.unica próprio. */
function enemBuildPrintHTML(doneQuestions, professor){
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const ctx = {
    ano: new Date().getFullYear(),
    footerText: [String(areaLabel).toUpperCase(), state.disciplina || "",
                 professor ? "VERSÃO DO PROFESSOR" : "VERSÃO DO ALUNO"].filter(Boolean).join(" | "),
  };

  // Agrupa questões consecutivas que compartilham o mesmo modo de coluna.
  const grupos = [];
  doneQuestions.forEach(o => {
    const wide = enemNeedsWidePage(o);
    const ultimo = grupos[grupos.length - 1];
    if(ultimo && ultimo.wide === wide) ultimo.itens.push(o);
    else grupos.push({ wide: wide, itens: [o] });
  });

  const miolos = grupos.map(g =>
    '<div class="miolo' + (g.wide ? " unica" : "") + '">' +
    g.itens.map(enemPrintQuestao).join("\n") + '</div>').join("\n");

  let fecho;
  if(professor){
    // §7.3 — caderno de respostas completo, em página nova.
    fecho = '<h2 class="area quebra">Gabarito e resoluções</h2>' +
            '<div class="miolo">' + doneQuestions.map(enemPrintResposta).join("\n") + '</div>';
  }else{
    // §7.2 — folha de gabarito: SOMENTE a letra de cada questão.
    const linhas = doneQuestions.map(o => {
      const letra = letraCorretaDe(o.q.data) || "—";
      return '<p class="alt"><strong>' + (o.idx + 1) + '.</strong><span class="letra">' +
             (ENEM_DOCX_MARKS[letra] || letra) + '</span></p>';
    }).join("\n");
    fecho = '<h2 class="area quebra">Gabarito</h2>' +
            '<div class="miolo">' + linhas + '<div class="fecho"></div></div>';
  }

  const titulo = "Simulado ENEM — " + areaLabel + (state.disciplina ? " · " + state.disciplina : "") +
                 " — versão do " + (professor ? "professor" : "aluno");

  return '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + enemPrintEsc(titulo) + '</title>\n<style>' + ENEM_PRINT_CSS + '</style>\n</head>\n<body>\n' +
    '<p class="aviso">Documento no padrão do caderno ENEM 2025 — 200 × 275 mm, duas colunas de 89,47 mm. ' +
    'Ao imprimir, escolha o papel <strong>200 × 275 mm</strong> (ou A4 sem "ajustar à página") e mantenha ' +
    'as margens do documento. Para a folha idêntica ao PDF, com fólio e margens espelhadas, use o botão ' +
    '<strong>Imprimir</strong> do aplicativo.</p>\n' +
    '<table class="pg">\n' + enemPrintChromeTop(ctx) + '\n' + enemPrintChromeBot(ctx) + '\n' +
    '<tbody><tr><td>\n<h2 class="area">' + enemPrintEsc(areaLabel) + '</h2>\n' +
    miolos + '\n' + fecho + '\n</td></tr></tbody>\n</table>\n</body>\n</html>';
}

/* Imprimir = o MESMO documento do PDF. Nada de re-renderizar em CSS e torcer
   para bater: montamos o jsPDF idêntico ao do botão PDF, marcamos autoPrint e
   abrimos o blob. O que sai da impressora é, literalmente, o PDF. */
function enemPrintPdf(doneQuestions, professor){
  const built = enemBuildPdfDoc(doneQuestions, professor);
  const doc = built.doc;
  doc.autoPrint();
  const url = doc.output("bloburl");
  const win = window.open(url, "_blank");
  if(!win){
    // Bloqueador de pop-up: baixa o arquivo, que imprime exatamente igual.
    doc.save(built.safeName);
    return false;
  }
  return true;
}

/* ---- Anatomia ENEM 2025 no DOCX — a MESMA página do PDF ----
   O Word não redesenha: ele declara. Mas declara exatamente a mesma geometria
   que o jsPDF desenha — página 200 × 275 mm, mancha de 182,33 mm, duas colunas
   de 89,47 mm com fio separador, corpo Calibri 10 pt com entrelinha exata de
   12,0 pt, tinta #231F20 — e carrega o mesmo cromo de página: marca, quadrados,
   barra cinza, filete misto (azul + microtexto), tarja da versão, rodapé
   corrido e fólio. Cabeçalho e rodapé se espelham pela paridade da página,
   como no caderno oficial.

   Onde as duas saídas ainda divergem, e por quê:
   • margens do CORPO espelhadas — o docx.js 8.5 não expõe o <w:mirrorMargins/>
     do Word; aplicamos a geometria da página ímpar (interna 8,00 / externa
     9,67 mm) a todas. Cabeçalho e rodapé espelham normalmente.
   • os quadrados do cabeçalho saem retos; no original são girados 20°.        */
const TW = 56.6929;                                   // 1 mm em twips
const docxMM = v => Math.round(v * TW);                   // mm → twips
const ENEM_DOCX = {
  pageW: docxMM(200), pageH: docxMM(275),
  margTop: docxMM(28.00), margBottom: docxMM(15.0),   // topo do fluxo das colunas, como no PDF
  margInner: docxMM(8.00), margOuter: docxMM(9.67),
  header: docxMM(10.3), footer: docxMM(6.7),   // filete em 25,00 mm e 263,00 mm
  mancha: docxMM(182.33), colW: docxMM(89.47), gutter: docxMM(3.40),
  indent: docxMM(6), hang: docxMM(4.5),
  line: Math.round(12.0 * 20),                        // entrelinha exata de 12,0 pt
  altLine: Math.round(13.4 * 20),                     // entrelinha das alternativas
  capLine: Math.round(9.6 * 20),                      // entrelinha da referência
  segBlue: docxMM(49.16), segMicro: docxMM(131.54),
  ornStart: docxMM(24.47), ornGap: docxMM(0.30), ornBlueShare: 0.795,
  barraCinza: docxMM(48.93),
  ink: "231F20", footGray: "58595B", ornGray: "939598",
  azul: "B9E5FA", azulTab: "6DCFF6", azulLogo: "004B8D",
  font: "Calibri", fontLight: "Calibri Light",
};

// Espessuras de borda em OITAVOS de ponto — é assim que o Word mede filete.
const DOCX_LINHA = {
  fina: 4,        // 0,5 pt — filete de fechamento e divisórias de tabela
  cheia: 8,       // 1,0 pt — filete de cabeçalho/rodapé e topo do ornamento
  orn: 24,        // 1,06 mm ≈ 3,0 pt — a faixa da barra-ornamento
  barra: 54,      // 2,38 mm ≈ 6,75 pt — a barra cinza do cabeçalho
};

// Parágrafo de altura mínima: só existe para carregar uma borda.
function docxFilamento(borders){
  const { Paragraph, LineRuleType } = window.docx;
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACTLY },
    border: borders,
    children: [],
  });
}

function docxCelula(widthTw, children, opts){
  const { TableCell, WidthType, BorderStyle, VerticalAlign } = window.docx;
  const o = opts || {};
  const nada = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new TableCell({
    width: { size: widthTw, type: WidthType.DXA },
    borders: o.borders || { top: nada, bottom: nada, left: nada, right: nada },
    shading: o.fill ? { type: window.docx.ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    verticalAlign: o.valign || VerticalAlign.BOTTOM,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: children,
  });
}

function docxLinhaTabela(cells, alturaTw){
  const { TableRow, HeightRule } = window.docx;
  return new TableRow({
    height: alturaTw ? { value: alturaTw, rule: HeightRule.EXACT } : undefined,
    children: cells,
  });
}

function docxTabelaLimpa(rows, widths, float){
  const { Table, WidthType, BorderStyle, TableLayoutType } = window.docx;
  const nada = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const cols = Array.isArray(widths) ? widths : [widths];
  return new Table({
    width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: cols,                 // vira <w:tblGrid> — sem isso a largura escorre
    layout: TableLayoutType.FIXED,
    borders: { top: nada, bottom: nada, left: nada, right: nada,
               insideHorizontal: nada, insideVertical: nada },
    float: float,
    rows: rows,
  });
}

/* Filete misto do §4: um trecho azul de 49,16 mm e um de microtexto de
   131,54 mm. No cabeçalho o azul fica do lado INTERNO; no rodapé, do EXTERNO —
   sempre cruzado. `azulPrimeiro` diz de que lado ele entra nesta folha.      */
function docxFilete(azulPrimeiro){
  const { Paragraph, TextRun, BorderStyle, LineRuleType } = window.docx;
  const azul = docxCelula(ENEM_DOCX.segBlue, [ docxFilamento({}) ], { fill: ENEM_DOCX.azul });
  // O "fio pontilhado" do caderno é, na verdade, a palavra repetida em
  // Arial-Bold 1,5 pt. É recurso antifraude, não ornamento.
  const micro = docxCelula(ENEM_DOCX.segMicro, [ new Paragraph({
    spacing: { before: 0, after: 0, line: 40, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: "SIMULADO".repeat(60), font: "Arial", size: 3, bold: true, color: ENEM_DOCX.ink }) ],
  }) ]);
  return docxTabelaLimpa(
    [ docxLinhaTabela(azulPrimeiro ? [azul, micro] : [micro, azul], docxMM(1.06)) ],
    azulPrimeiro ? [ENEM_DOCX.segBlue, ENEM_DOCX.segMicro] : [ENEM_DOCX.segMicro, ENEM_DOCX.segBlue]);
}

// Tarja da versão + quadrado de registro, ancorados à FOLHA na borda externa.
// São quadros de parágrafo (w:framePr), não tabelas flutuantes: é o mecanismo
// que o Word e o LibreOffice posicionam de forma previsível dentro do cabeçalho.
function docxTarja(outerIsRight){
  const { Paragraph, TextRun, ShadingType, FrameAnchorType, FrameWrap, HeightRule, LineRuleType } = window.docx;
  const larg = outerIsRight ? docxMM(11) : docxMM(6);   // na folha par ela sangra
  const x    = outerIsRight ? docxMM(194) : 0;
  const reg  = outerIsRight ? docxMM(192.5) : docxMM(4.5);
  const quadro = (w, h, px, py, cor) => new Paragraph({
    frame: {
      type: "absolute", width: w, height: h, rule: HeightRule.EXACT,
      anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
      position: { x: px, y: py },
      space: { horizontal: 0, vertical: 0 },
      wrap: FrameWrap.NONE,
    },
    shading: { type: ShadingType.CLEAR, fill: cor, color: "auto" },
    // O w:shd pinta a CAIXA DE LINHA do parágrafo, não o quadro — então a
    // entrelinha exata é que dá altura à tarja.
    spacing: { before: 0, after: 0, line: h, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: " ", size: 2, color: cor }) ],
  });
  // Só o PRIMEIRO parágrafo com quadro de um cabeçalho/rodapé sobrevive: os
  // seguintes são fundidos nele. Por isso a tarja mora no cabeçalho e o quadrado
  // de registro no rodapé — ambos ancorados à FOLHA, então cada um cai no seu
  // lugar independentemente de onde foi declarado.
  return {
    tarja:    quadro(larg, docxMM(25), x, 0, ENEM_DOCX.azul),  // 11 × 30 mm sangrando: 25 visíveis
    registro: quadro(docxMM(3), docxMM(3), reg, docxMM(23.5), ENEM_DOCX.ink),
  };
}

/* Marca do caderno. NÃO reproduzimos o logotipo do INEP: isto é um simulado, e
   passar-se por caderno oficial seria falsificação. Copia-se a diagramação, não
   a identidade da instituição.                                               */
function docxMarca(ano, outerIsRight){
  const { Paragraph, TextRun, AlignmentType, LineRuleType, VerticalAlign } = window.docx;
  const alinha = outerIsRight ? AlignmentType.LEFT : AlignmentType.RIGHT;
  const marca = new Paragraph({
    alignment: alinha,
    spacing: { before: 0, after: 0, line: Math.round(17 * 20), lineRule: LineRuleType.EXACTLY },
    children: [
      new TextRun({ text: "simulado", bold: true, font: ENEM_DOCX.font, size: 32, color: ENEM_DOCX.azulLogo }),
      new TextRun({ text: String(ano), font: ENEM_DOCX.font, size: 32, color: ENEM_DOCX.ornGray }),
    ],
  });
  const sub = new Paragraph({
    alignment: alinha,
    spacing: { before: 0, after: 0, line: Math.round(7 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: "Simulado no padrão do caderno ENEM", font: ENEM_DOCX.font, size: 11, color: ENEM_DOCX.ornGray }) ],
  });
  // Quatro quadrados de 5,5 × 6,6 mm em #939598, encostados na marca.
  const quad = () => docxCelula(docxMM(5.5), [ new Paragraph({ children: [] }) ], { fill: ENEM_DOCX.ornGray });
  const vao  = () => docxCelula(docxMM(0.4), [ new Paragraph({ children: [] }) ]);
  const bloco = [ quad(), vao(), quad(), vao(), quad(), vao(), quad() ];
  const wMarca = docxMM(52), wBloco = docxMM(23.2);
  const wResto = ENEM_DOCX.mancha - wMarca - wBloco;
  const marcaCel = docxCelula(wMarca, [ marca ], { valign: VerticalAlign.BOTTOM });
  const resto = docxCelula(wResto, [ new Paragraph({ children: [] }) ]);
  const larguras = [docxMM(5.5), docxMM(0.4), docxMM(5.5), docxMM(0.4), docxMM(5.5), docxMM(0.4), docxMM(5.5)];
  const cells = outerIsRight ? [marcaCel].concat(bloco, [resto])
                             : [resto].concat(bloco, [marcaCel]);
  const grade = outerIsRight ? [wMarca].concat(larguras, [wResto])
                             : [wResto].concat(larguras, [wMarca]);
  return [
    docxTabelaLimpa([ docxLinhaTabela(cells, docxMM(6.6)) ], grade),
    sub,
  ];
}

// Barra cinza de 48,93 × 2,38 mm sob a marca, do lado interno.
function docxBarraCinza(outerIsRight){
  const { BorderStyle } = window.docx;
  const barra = docxCelula(ENEM_DOCX.barraCinza, [ docxFilamento({}) ], { fill: ENEM_DOCX.ornGray });
  const vazio = docxCelula(ENEM_DOCX.mancha - ENEM_DOCX.barraCinza, [ docxFilamento({}) ]);
  const wResto = ENEM_DOCX.mancha - ENEM_DOCX.barraCinza;
  return docxTabelaLimpa(
    [ docxLinhaTabela(outerIsRight ? [barra, vazio] : [vazio, barra], docxMM(2.38)) ],
    outerIsRight ? [ENEM_DOCX.barraCinza, wResto] : [wResto, ENEM_DOCX.barraCinza]);
}

function enemDocxHeader(ctx, outerIsRight){
  const { Header } = window.docx;
  // A tarja entra POR ÚLTIMO: mesmo flutuando, uma tabela ocupa posição no
  // fluxo, e no começo ela empurraria todo o cabeçalho folha abaixo.
  const { Paragraph, LineRuleType } = window.docx;
  // 2,4 mm entre a barra cinza (19,29–21,67 mm) e o filete de 25,00 mm.
  const respiro = new Paragraph({
    spacing: { before: 0, after: 0, line: 136, lineRule: LineRuleType.EXACTLY }, children: [] });
  const filhos = [ docxTarja(outerIsRight).tarja ]
    .concat(docxMarca(ctx.ano, outerIsRight))
    .concat([ docxBarraCinza(outerIsRight), respiro, docxFilete(outerIsRight) ]);
  return new Header({ children: filhos });
}

function enemDocxFooter(ctx, outerIsRight){
  const { Footer, Paragraph, TextRun, AlignmentType, LineRuleType, PageNumber } = window.docx;
  // Rodapé: texto corrido na margem INTERNA, fólio na EXTERNA.
  const corrido = docxCelula(ENEM_DOCX.mancha - docxMM(12), [ new Paragraph({
    alignment: outerIsRight ? AlignmentType.LEFT : AlignmentType.RIGHT,
    spacing: { before: 0, after: 0, line: Math.round(11 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: ctx.footerText, font: ENEM_DOCX.fontLight, size: 18, color: ENEM_DOCX.footGray }) ],
  }) ]);
  const folio = docxCelula(docxMM(12), [ new Paragraph({
    alignment: outerIsRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: Math.round(11 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ children: [ PageNumber.CURRENT ], bold: true, font: ENEM_DOCX.font, size: 18, color: ENEM_DOCX.ink }) ],
  }) ]);
  const wCorrido = ENEM_DOCX.mancha - docxMM(12);
  const linha = docxTabelaLimpa(
    [ docxLinhaTabela(outerIsRight ? [corrido, folio] : [folio, corrido]) ],
    outerIsRight ? [wCorrido, docxMM(12)] : [docxMM(12), wCorrido]);
  // No rodapé o azul fica do lado EXTERNO — a composição inverte a do cabeçalho.
  return new Footer({ children: [ docxTarja(outerIsRight).registro,
                                  docxFilete(!outerIsRight), linha ] });
}

/* ---------------- conteúdo: as mesmas regras que o PDF desenha ------------- */

function enemDocxParagraph(text, opts){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const o = opts || {};
  const size = o.size || 10;
  const out = [];
  String(text || "").trim().split(/\n+/).forEach(par => {
    if(!par.trim()) return;
    out.push(new Paragraph({
      alignment: o.alignment || AlignmentType.JUSTIFIED,
      indent: o.indent === false ? undefined : { firstLine: ENEM_DOCX.indent },
      spacing: { line: o.line || ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
      children: enemRichRuns(quiJuntaFormula(par.trim())).map(r => new TextRun({
        text: r.text, font: ENEM_DOCX.font, size: Math.round(size * 2),
        color: o.color || ENEM_DOCX.ink, bold: r.bold || !!o.bold,
      })),
    }));
  });
  return out;
}

function enemDocxRichParagraph(text, opts){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const o = opts || {};
  const out = [];
  String(text || "").trim().split(/\n+/).forEach(par => {
    if(!par.trim()) return;
    out.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      indent: o.indent ? { left: o.indent } : undefined,
      spacing: { line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
      children: enemRichRuns(quiJuntaFormula(par.trim())).map(r => new TextRun({
        text: r.text, bold: r.bold, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink,
      })),
    }));
  });
  return out;
}

/* Rótulo QUESTÃO N com a barra-ornamento à direita: começa sempre a 24,47 mm
   da borda da coluna, termina 0,30 mm antes da direita, filete escuro de 1 pt
   no topo e faixa de 1,06 mm com 79,5 % em #B9E5FA e 20,5 % em #231F20.     */
function enemDocxQuestionLabel(numero, colTw, primeiro){
  const { Paragraph, TextRun, AlignmentType, BorderStyle, LineRuleType, VerticalAlign } = window.docx;
  const larg = colTw || ENEM_DOCX.colW;
  const barra = larg - ENEM_DOCX.ornStart - ENEM_DOCX.ornGap;
  const azulW = Math.round(barra * ENEM_DOCX.ornBlueShare);
  const escuroW = barra - azulW;
  const topo = { style: BorderStyle.SINGLE, size: DOCX_LINHA.cheia, color: ENEM_DOCX.ink, space: 0 };
  const faixa = cor => docxFilamento({
    top: topo,
    bottom: { style: BorderStyle.SINGLE, size: DOCX_LINHA.orn, color: cor, space: 0 },
  });
  const rotulo = new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 0, after: 0, line: Math.round(12 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: "QUESTÃO " + numero, bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
  });
  const respiro = primeiro ? [] : [
    // 2,53 mm entre a última alternativa da questão anterior e este rótulo.
    new Paragraph({ spacing: { before: 0, after: 143, line: 20, lineRule: LineRuleType.EXACTLY }, children: [] }),
  ];
  return respiro.concat([
    docxTabelaLimpa([ docxLinhaTabela([
      docxCelula(ENEM_DOCX.ornStart, [ rotulo ], { valign: VerticalAlign.BOTTOM }),
      docxCelula(azulW,   [ faixa(ENEM_DOCX.azul) ]),
      docxCelula(escuroW, [ faixa(ENEM_DOCX.ink) ]),
      docxCelula(ENEM_DOCX.ornGap, [ docxFilamento({}) ]),
    ]) ], [ENEM_DOCX.ornStart, azulW, escuroW, ENEM_DOCX.ornGap]),
    // 0,76 mm entre o rótulo e a primeira linha do texto-base.
    new Paragraph({ spacing: { before: 0, after: 43, line: 20, lineRule: LineRuleType.EXACTLY }, children: [] }),
  ]);
}

const ENEM_DOCX_MARKS = { A: "Ⓐ", B: "Ⓑ", C: "Ⓒ", D: "Ⓓ", E: "Ⓔ" };

// Justificada, como no PDF — ver enemAlternative. O Word aplica a justificação
// ao parágrafo inteiro e deixa a última linha em bandeira, exatamente como o
// desenho do PDF faz, o que mantém as duas saídas idênticas.
function enemDocxAlternative(letter, text){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  return [ new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: ENEM_DOCX.hang, hanging: ENEM_DOCX.hang },
    spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
    children: [
      new TextRun({ text: ENEM_DOCX_MARKS[letter] + "\t", font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      ...enemRichRuns(quiJuntaFormula(String(text || "").trim() || "—")).map(r => new TextRun({
        text: r.text, bold: r.bold, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink,
      })),
    ],
  }) ];
}

/* §2.1 — as duas referências. Do texto introdutório: itálico, à direita. De
   imagem, tabela ou gráfico: redonda, justificada. Ambas em corpo − 2 pt.   */
function enemDocxCaption(text, opts){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const o = opts || {};
  const clean = String(text || "").trim();
  if(!clean) return [];
  return [ new Paragraph({
    alignment: o.justify ? AlignmentType.JUSTIFIED : AlignmentType.RIGHT,
    spacing: { line: ENEM_DOCX.capLine, lineRule: LineRuleType.EXACTLY, before: 40, after: 60 },
    children: enemRichRuns(quiJuntaFormula(clean)).map(r => new TextRun({
      text: r.text, bold: r.bold, italics: !!o.italic,
      font: ENEM_DOCX.font, size: 16, color: ENEM_DOCX.ink,
    })),
  }) ];
}

function enemDocxTextoBase(text, fonte){
  const pars = String(text || "").trim().split(/\n+/).filter(x => x.trim());
  let ref = String(fonte || "").trim();
  if(!ref && pars.length > 1 && enemIsReference(pars[pars.length - 1])) ref = pars.pop();
  const out = [];
  pars.forEach(par => out.push(...enemDocxParagraph(par)));
  if(ref) out.push(...enemDocxCaption(ref, { italic: true }));
  return out;
}

// Filete de fechamento: sólido, 0,5 pt, largura cheia da coluna. No caderno
// oficial ele NÃO separa questões consecutivas — quem separa é a barra da
// questão seguinte (§5.9).
function enemDocxRule(){
  const { Paragraph, BorderStyle, LineRuleType } = window.docx;
  return [ new Paragraph({
    spacing: { before: 143, after: 60, line: 20, lineRule: LineRuleType.EXACTLY },
    border: { bottom: { style: BorderStyle.SINGLE, size: DOCX_LINHA.fina, color: ENEM_DOCX.ink, space: 1 } },
    children: [],
  }) ];
}

function enemDocxVisual(visual, cardIdx, colTw){
  const { Paragraph, TextRun, ImageRun, AlignmentType, Table, TableRow, TableCell,
          WidthType, BorderStyle, ShadingType } = window.docx;
  if(!visual || !visual.tipo) return [];
  const out = [];
  const larg = colTw || ENEM_DOCX.colW;

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return [];
    const moldura = { style: BorderStyle.SINGLE, size: DOCX_LINHA.cheia, color: ENEM_DOCX.ink };
    const divisa  = { style: BorderStyle.SINGLE, size: DOCX_LINHA.fina, color: ENEM_DOCX.ink };
    const cell = (txt, cab) => new TableCell({
      borders: cab ? { top: moldura, bottom: moldura, left: moldura, right: moldura }
                   : { top: divisa, bottom: divisa, left: divisa, right: divisa },
      shading: cab ? { type: ShadingType.CLEAR, fill: ENEM_DOCX.azulTab, color: "auto" } : undefined,
      children: [ new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [ new TextRun({ text: String(txt == null ? "" : txt), font: ENEM_DOCX.font, size: 20, bold: !!cab, color: ENEM_DOCX.ink }) ],
      }) ],
    });
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [ new TableRow({ children: cols.map(c => cell(c, true)) }) ]
        .concat(rows.map(r => new TableRow({ children: r.map(c => cell(c, false)) }))),
    }));
    out.push(...enemDocxCaption(visual.titulo, { justify: true }));
    return out;
  }

  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx, true) : pdfGetVisualChartInfo(cardIdx);
  if(!info) return [];
  const maxW = Math.round(larg / TW * 72 / 25.4);      // twips → mm → pontos
  const ratio = info.height / info.width;
  const w = maxW, h = Math.round(maxW * ratio);
  try{
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 91, after: 120 },              // 1,60 mm antes · 2,11 mm depois
      children: [ new ImageRun({
        data: docxDataUrlToUint8Array(info.dataUrl),
        transformation: { width: w, height: h },
        type: docxImageType(info.dataUrl),
      }) ],
    }));
  }catch(e){ return out; }
  out.push(...enemDocxCaption(visual.descricao, { justify: true }));
  return out;
}

function enemDocxSubhead(texto){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  return [ new Paragraph({
    // Justificado por coerência com o resto do documento. Subtítulo é sempre
    // uma linha só, então a justificação não estica nada — mas deixa o
    // alinhamento declarado igual em todo o arquivo.
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 85, after: 0, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: String(texto).toUpperCase(), bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }) ],
  }) ];
}

function enemDocxAreaTitle(texto){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  return [ new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 181, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    indent: { left: docxMM(2) },
    children: [ new TextRun({ text: String(texto).toUpperCase(), bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
  }) ];
}

/* §7.2 — folha de gabarito do ALUNO: somente a letra de cada questão. */
function enemDocxGabaritoAluno(doneQuestions){
  const { Paragraph, TextRun, LineRuleType } = window.docx;
  const out = [];
  out.push(...enemDocxAreaTitle("Gabarito"));
  doneQuestions.forEach(o => {
    const letra = letraCorretaDe(o.q.data) || "—";
    out.push(new Paragraph({
      spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
      children: [
        new TextRun({ text: (o.idx + 1) + ".\t", bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
        new TextRun({ text: ENEM_DOCX_MARKS[letra] || letra, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      ],
    }));
  });
  out.push(...enemDocxRule());
  return out;
}

/* §7.3 — caderno de respostas do PROFESSOR. */
function enemDocxGabaritoBlock(o){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const d = o.q.data || {};
  const out = [];
  out.push(...enemDocxQuestionLabel(o.idx + 1, ENEM_DOCX.colW, o.primeiroDoCaderno));

  const letra = letraCorretaDe(d) || "—";
  out.push(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
    indent: { left: ENEM_DOCX.hang, hanging: ENEM_DOCX.hang },
    children: [
      new TextRun({ text: (ENEM_DOCX_MARKS[letra] || "○") + "\t", font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      new TextRun({ text: "GABARITO: " + letra, bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
    ],
  }));
  const resposta = (d.alternativas && d.alternativas[letraCorretaDe(d)]) || "";
  if(resposta) out.push(...enemDocxRichParagraph(resposta, { indent: ENEM_DOCX.hang }));

  const ficha = [];
  if(d.competencia && (d.competencia.numero || d.competencia.texto)){
    ficha.push("**Competência " + (d.competencia.numero || "—") + ":** " + (d.competencia.texto || ""));
  }
  if(d.habilidade && (d.habilidade.codigo || d.habilidade.texto)){
    ficha.push("**Habilidade " + (d.habilidade.codigo || "—") + ":** " + (d.habilidade.texto || ""));
  }
  if(d.objetoConhecimento) ficha.push("**Objeto de conhecimento:** " + d.objetoConhecimento);
  const conteudo = d.tema || o.q.tema || "";
  if(conteudo) ficha.push("**Conteúdo abordado:** " + conteudo);
  const dif = d.dificuldade || o.q.dificuldade || "";
  if(dif) ficha.push("**Nível de dificuldade:** " + dif);
  if(ficha.length){
    out.push(...enemDocxSubhead("Ficha pedagógica"));
    ficha.forEach(l => out.push(...enemDocxRichParagraph(l)));
  }

  if(d.resolucaoComentada){
    out.push(...enemDocxSubhead("Resolução comentada"));
    out.push(...enemDocxParagraph(d.resolucaoComentada, { indent: false }));
  }

  const analise = d.analiseAlternativas || {};
  if(["A","B","C","D","E"].some(L => analise[L] && analise[L].comentario)){
    out.push(...enemDocxSubhead("Comentários das alternativas"));
    ["A","B","C","D","E"].forEach(L => {
      const info = analise[L];
      if(!info) return;
      const status = marcaAlternativa(conferenciaGabarito(d), L, false);
      out.push(...enemDocxAlternative(L, status + " — " + (info.comentario || "")));
    });
  }
  return out;
}

/* Uma SEÇÃO do Word por bloco de questões que compartilha o modo de coluna —
   é assim que a página inteira vira coluna única quando entra figura larga
   (§6), do mesmo jeito que o PDF faz. Cabeçalho e rodapé são reconstruídos em
   cada seção, espelhados por paridade.                                       */
function enemDocxSections(doneQuestions, professor){
  const { SectionType } = window.docx;
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const ctx = {
    ano: new Date().getFullYear(),
    footerText: [String(areaLabel).toUpperCase(), state.disciplina || "",
                 professor ? "VERSÃO DO PROFESSOR" : "VERSÃO DO ALUNO"].filter(Boolean).join(" | "),
  };

  const props = cols => ({
    page: {
      size: { width: ENEM_DOCX.pageW, height: ENEM_DOCX.pageH },
      margin: {
        top: ENEM_DOCX.margTop, bottom: ENEM_DOCX.margBottom,
        left: ENEM_DOCX.margInner, right: ENEM_DOCX.margOuter,
        header: ENEM_DOCX.header, footer: ENEM_DOCX.footer,
      },
    },
    column: cols === 1 ? { count: 1 }
                       : { count: 2, space: ENEM_DOCX.gutter, separate: true },
    type: SectionType.NEXT_PAGE,
  });
  const secao = (cols, children) => ({
    properties: props(cols),
    headers: { default: enemDocxHeader(ctx, true), even: enemDocxHeader(ctx, false) },
    footers: { default: enemDocxFooter(ctx, true), even: enemDocxFooter(ctx, false) },
    children: children,
  });

  // Agrupa questões consecutivas que compartilham o mesmo modo de coluna.
  const grupos = [];
  doneQuestions.forEach(o => {
    const wide = enemNeedsWidePage(o);
    const ultimo = grupos[grupos.length - 1];
    if(ultimo && ultimo.wide === wide) ultimo.itens.push(o);
    else grupos.push({ wide: wide, itens: [o] });
  });

  const sections = [];
  grupos.forEach((g, gi) => {
    const colTw = g.wide ? ENEM_DOCX.mancha : ENEM_DOCX.colW;
    const children = [];
    if(gi === 0) children.push(...enemDocxAreaTitle(areaLabel));
    g.itens.forEach((o, i) => {
      const d = o.q.data;
      children.push(...enemDocxQuestionLabel(o.idx + 1, colTw, gi === 0 && i === 0));
      if(d.textoBase) children.push(...enemDocxTextoBase(d.textoBase, d.fonte));
      if(d.visual && d.visual.tipo) children.push(...enemDocxVisual(d.visual, o.idx, colTw));
      if(d.comando) children.push(...enemDocxParagraph(d.comando, { indent: false }));
      ["A","B","C","D","E"].forEach(L => {
        children.push(...enemDocxAlternative(L, (d.alternativas && d.alternativas[L]) || ""));
      });
      // Filete de fechamento só ao fim da sequência — nunca entre questões.
      const ultimoDeTudo = gi === grupos.length - 1 && i === g.itens.length - 1;
      if(ultimoDeTudo) children.push(...enemDocxRule());
    });
    sections.push(secao(g.wide ? 1 : 2, children));
  });

  // Fecho: aluno → folha de gabarito; professor → caderno de respostas.
  const fecho = [];
  if(professor){
    fecho.push(...enemDocxAreaTitle("Gabarito e resoluções"));
    doneQuestions.forEach((o, i) => {
      fecho.push(...enemDocxGabaritoBlock(Object.assign({}, o, { primeiroDoCaderno: i === 0 })));
      if(i === doneQuestions.length - 1) fecho.push(...enemDocxRule());
    });
  }else{
    fecho.push(...enemDocxGabaritoAluno(doneQuestions));
  }
  sections.push(secao(2, fecho));

  return sections;
}

/* v12 — A IMAGEM ENTRA NO PDF COMO JPEG, NUNCA COMO WEBP.
   Medido em 11/09/2026 com o app real (jsPDF 4.2.1, 5 imagens WebP de
   1024×1024): doc.addImage(webp) leva ≈ 1.010 ms POR IMAGEM — o jsPDF não
   tem decodificador nativo de WebP, decodifica pixel a pixel em JavaScript
   e ainda grava os pixels crus (PDF de 8,6 MB para 5 questões). Convertendo
   antes pelo canvas do navegador (decodificação nativa, a partir da imagem já
   desenhada na tela — a mesma imagemParaJpeg que o Word usa), a inserção cai
   para ≈ 60 ms por imagem e o PDF para 1,9 MB. Era este o "pequeno delay" do
   botão Exportar PDF (e do Imprimir, que monta o mesmo documento).
   O resultado fica em cache por elemento <img>: a mesma figura é lida mais de
   uma vez por exportação (decisão de página larga + desenho) e de novo ao
   exportar aluno e professor em sequência. Se a conversão falhar, o PDF cai
   para o WebP lento (nunca perde a figura); o Word continua sem a figura,
   como antes, porque não abre WebP. */
const _jpegCache = new WeakMap();
function imagemParaJpegCacheada(img){
  const guardado = _jpegCache.get(img);
  if(guardado && guardado.src === img.src) return guardado.jpeg;
  const jpeg = imagemParaJpeg(img.src, img);
  if(jpeg) _jpegCache.set(img, { src: img.src, jpeg });
  return jpeg;
}
function pdfGetVisualImageInfo(cardIdx, paraDocx, manterOriginal){
  const card = document.querySelectorAll("#questionResults .qcard")[cardIdx];
  if(!card) return null;
  const img = card.querySelector(".visual-image-holder img");
  if(!img || !img.src) return null;
  // A exportação em HTML abre no navegador, que lê WebP: mantém o original
  // (≈ 7× menor que o JPEG) — só PDF e Word convertem.
  if(manterOriginal) return { dataUrl: img.src, width: img.naturalWidth || 800, height: img.naturalHeight || 500 };
  const jpeg = imagemParaJpegCacheada(img);
  // Sem conversão possível, o Word sai sem a figura — e, como quem chama
  // interrompe o bloco inteiro, sem a legenda também. É pior perder a figura do
  // que entregar um .docx com um quadro quebrado que ninguém consegue abrir.
  // O PDF, ao contrário, ainda aceita o WebP (devagar): melhor lento que sem figura.
  const dataUrl = paraDocx ? jpeg : (jpeg || img.src);
  if(!dataUrl) return null;
  return { dataUrl, width: img.naturalWidth || 800, height: img.naturalHeight || 500 };
}

// Os gráficos na tela usam texto claro (legenda, título, eixos) porque o app tem
// fundo escuro. Isso fica ilegível se capturado direto para o PDF (fundo branco).
// Por isso, antes de capturar a imagem do gráfico para o PDF, trocamos temporariamente
// as cores do texto para preto (alto contraste) e as linhas de grade para um cinza
// bem sutil, capturamos, e devolvemos as cores originais da tela em seguida — a
// aparência do app na tela não muda, só a imagem exportada para o PDF.
function pdfGetVisualChartInfo(cardIdx){
  const card = document.querySelectorAll("#questionResults .qcard")[cardIdx];
  if(!card) return null;
  const canvas = card.querySelector(".visual-body canvas");
  if(!canvas) return null;

  const chart = (window.Chart && typeof Chart.getChart === "function") ? Chart.getChart(canvas) : null;
  if(!chart){
    try{
      return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
    }catch(e){ return null; }
  }

  const opts = chart.options || {};
  const legendLabels = opts.plugins?.legend?.labels;
  const title = opts.plugins?.title;
  const xTicks = opts.scales?.x?.ticks;
  const yTicks = opts.scales?.y?.ticks;
  const xGrid = opts.scales?.x?.grid;
  const yGrid = opts.scales?.y?.grid;

  const original = {
    legend: legendLabels ? legendLabels.color : undefined,
    title: title ? title.color : undefined,
    xTicks: xTicks ? xTicks.color : undefined,
    yTicks: yTicks ? yTicks.color : undefined,
    xGrid: xGrid ? xGrid.color : undefined,
    yGrid: yGrid ? yGrid.color : undefined,
  };

  try{
    if(legendLabels) legendLabels.color = "#000000";
    if(title) title.color = "#000000";
    if(xTicks) xTicks.color = "#000000";
    if(yTicks) yTicks.color = "#000000";
    if(xGrid) xGrid.color = "rgba(0,0,0,.12)";
    if(yGrid) yGrid.color = "rgba(0,0,0,.12)";
    chart.update("none");

    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  }catch(e){
    return null;
  }finally{
    // Importante: NÃO reutilizamos as referências de objeto (xTicks/yTicks/xGrid/yGrid)
    // capturadas antes do chart.update() acima — nesta versão do Chart.js, update()
    // regenera internamente os sub-objetos de "scales" (ticks/grid), então a referência
    // antiga fica "órfã" e escrever nela não muda mais nada que o Chart.js realmente lê.
    // Por isso resolvemos os objetos de novo, a partir de chart.options atual, na hora
    // de restaurar. (plugins.legend.labels e plugins.title não têm esse problema, mas
    // resolvemos de novo por segurança/consistência.)
    const freshOpts = chart.options || {};
    const freshLegendLabels = freshOpts.plugins?.legend?.labels;
    const freshTitle = freshOpts.plugins?.title;
    const freshXTicks = freshOpts.scales?.x?.ticks;
    const freshYTicks = freshOpts.scales?.y?.ticks;
    const freshXGrid = freshOpts.scales?.x?.grid;
    const freshYGrid = freshOpts.scales?.y?.grid;

    if(freshLegendLabels) freshLegendLabels.color = original.legend;
    if(freshTitle) freshTitle.color = original.title;
    if(freshXTicks) freshXTicks.color = original.xTicks;
    if(freshYTicks) freshYTicks.color = original.yTicks;
    if(freshXGrid) freshXGrid.color = original.xGrid;
    if(freshYGrid) freshYGrid.color = original.yGrid;
    chart.update("none");
  }
}

// Desenha o recurso visual (imagem gerada por IA, gráfico ou tabela) em sua própria caixa.
// Imagem/gráfico: incorpora a imagem já renderizada na tela (mesma proporção). Tabela: desenhada
// como tabela vetorial de verdade (linhas/colunas nítidas), não como captura de tela.
function pdfDrawVisualBox(doc, ctx, visual, cardIdx){
  if(!visual || !visual.tipo) return;
  const { margin, pageWidth, pageHeight } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const colors = PDF_PALETTE.visual;
  const padding = 10;
  const innerX = margin + padding + 6;
  const titleText = pdfSanitizeText(visual.titulo) || (visual.tipo === "imagem" ? "Imagem ilustrativa" : visual.tipo === "grafico" ? "Gráfico" : "Tabela");

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return;
    const cellPad = 5;
    const tableWidth = contentWidth - padding * 2 - 6;
    const colWidth = tableWidth / cols.length;
    doc.setFontSize(9);
    const lineH = 9 * 1.3;
    const headerWrapped = cols.map(c => doc.splitTextToSize(pdfSanitizeText(String(c)), colWidth - cellPad * 2));
    const rowsWrapped = rows.map(row => row.map(cell => doc.splitTextToSize(pdfSanitizeText(String(cell)), colWidth - cellPad * 2)));
    const headerHeight = Math.max(...headerWrapped.map(l => l.length), 1) * lineH + cellPad * 2;
    const rowHeights = rowsWrapped.map(r => Math.max(...r.map(l => l.length), 1) * lineH + cellPad * 2);
    const tableHeight = headerHeight + rowHeights.reduce((a, b) => a + b, 0);
    const boxHeight = padding * 2 + 16 + tableHeight;

    pdfEnsureSpace(doc, ctx, Math.min(boxHeight, pageHeight - ctx.margin * 2));
    const y = ctx.y;
    doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 6, 6, "F");
    doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.roundedRect(margin, y, 4, boxHeight, 2, 2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.text(titleText.toUpperCase(), innerX, y + padding + 6);

    let ty = y + padding + 16;
    const tx = innerX;
    doc.setDrawColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    cols.forEach((c, i) => {
      // O preenchimento precisa ser reaplicado a cada coluna: no jsPDF, setTextColor()
      // reusa o mesmo estado interno de "cor de preenchimento" usado por rect(...,"F"),
      // então o texto preto da coluna anterior "vazava" para o preenchimento da
      // próxima célula do cabeçalho se a cor branca não fosse reafirmada aqui.
      doc.setFillColor(255, 255, 255);
      doc.rect(tx + i * colWidth, ty, colWidth, headerHeight, "FD");
      // Preto puro (em vez do slate padrão das caixas) para máxima legibilidade dos
      // dados da tabela, conforme pedido.
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
      headerWrapped[i].forEach((line, li) => doc.text(line, tx + i * colWidth + cellPad, ty + cellPad + 7 + li * lineH));
    });
    ty += headerHeight;
    rowsWrapped.forEach((row, ri) => {
      row.forEach((cellLines, ci) => {
        doc.setFillColor(252, 252, 253);
        doc.rect(tx + ci * colWidth, ty, colWidth, rowHeights[ri], "FD");
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
        cellLines.forEach((line, li) => doc.text(line, tx + ci * colWidth + cellPad, ty + cellPad + 7 + li * lineH));
      });
      ty += rowHeights[ri];
    });
    ctx.y = y + boxHeight + 10;
    return;
  }

  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx) : pdfGetVisualChartInfo(cardIdx);
  if(!info) return; // sem imagem disponível (ex.: falhou a geração) — não bloqueia o PDF

  const maxW = contentWidth - padding * 2 - 6;
  const maxH = 260;
  let w = maxW, h = w * (info.height / info.width);
  if(h > maxH){ h = maxH; w = h * (info.width / info.height); }

  let capLines = [];
  if(visual.descricao){
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    capLines = doc.splitTextToSize(pdfSanitizeText(visual.descricao), maxW);
  }
  const capHeight = capLines.length ? (capLines.length * 8.5 * 1.3 + 10) : 0;
  const titleHeight = 16;
  const boxHeight = padding * 2 + titleHeight + h + capHeight;

  pdfEnsureSpace(doc, ctx, boxHeight);
  const y = ctx.y;
  doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
  doc.roundedRect(margin, y, contentWidth, boxHeight, 6, 6, "F");
  doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.roundedRect(margin, y, 4, boxHeight, 2, 2, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.text(titleText.toUpperCase(), innerX, y + padding + 6);

  const imgX = margin + (contentWidth - w) / 2;
  const imgY = y + padding + titleHeight;
  const fmtMatch = /^data:image\/(png|jpe?g|webp);base64,/i.exec(info.dataUrl);
  const imgFormat = fmtMatch ? fmtMatch[1].toUpperCase().replace("JPG", "JPEG") : "PNG";
  try{ doc.addImage(info.dataUrl, imgFormat, imgX, imgY, w, h); }catch(e){ /* imagem inválida — ignora silenciosamente */ }

  if(capLines.length){
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
    capLines.forEach((line, li) => doc.text(line, innerX, imgY + h + 10 + li * (8.5 * 1.3)));
  }

  ctx.y = y + boxHeight + 10;
}

function pdfDrawQuestionHeader(doc, ctx, q, idx){
  const { margin, pageWidth } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const d = q.data;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  const title = pdfSanitizeText(`Questão ${idx + 1}` + (d.tema ? ` — ${d.tema}` : ""));
  const titleLines = doc.splitTextToSize(title, contentWidth);
  titleLines.forEach((line, li) => doc.text(line, margin, ctx.y + 12 + li * 16));
  ctx.y += titleLines.length * 16 + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const metaParts = [d.disciplina || state.disciplina, d.dificuldade].filter(Boolean);
  doc.text(pdfSanitizeText(metaParts.join("   ·   ")), margin, ctx.y + 8);
  ctx.y += 20;
}

async function exportPdf(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de exportar em PDF.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de exportar em PDF.", "err");
    return;
  }
  if(!window.jspdf){
    try{
      await loadScriptOnce(CDN_URLS.jspdf);
    }catch(e){
      toast("Não foi possível carregar a biblioteca de PDF (verifique sua conexão com a internet) e tente novamente.", "err");
      return;
    }
  }

  const btn = document.getElementById("btnExportPdf");
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = "Gerando PDF...";
  // v12: a montagem é síncrona e trava a interface; sem esta pausa o navegador
  // muitas vezes nem chega a pintar "Gerando PDF..." antes do download aparecer.
  await new Promise(r => setTimeout(r, 40));

  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    const ctx = {
      margin,
      pageWidth: doc.internal.pageSize.getWidth(),
      pageHeight: doc.internal.pageSize.getHeight(),
      y: margin,
    };
    const isAluno = state.viewMode === "aluno";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59);
    doc.text("Simulado ENEM", margin, ctx.y + 14);
    ctx.y += 26;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text(`${AREA_META[state.area] ? AREA_META[state.area].label : ""} · ${state.disciplina || ""}`, margin, ctx.y + 8);
    ctx.y += 16;
    doc.text(isAluno ? "Versão do aluno (sem gabarito)" : "Versão do professor (com gabarito e comentários)", margin, ctx.y + 8);
    ctx.y += 30;

    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(!doneQuestions.length){ throw new Error("Nenhuma questão para exportar."); }

    // AS DUAS VERSÕES saem na anatomia do caderno ENEM 2025 (200×275 mm, duas
    // colunas de 89,47 mm, Calibri 10/12,0 pt, tinta #231F20, letras circuladas,
    // barra-ornamento). A do professor é idêntica à do aluno e acrescenta, DEPOIS
    // de todas as questões, o caderno de respostas — gabarito, ficha pedagógica,
    // resolução comentada e comentário de cada alternativa.
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
    if(bloqueiaSeGabaritoInconsistente(doneQuestions)) return;
    enemExportPdf(doneQuestions, !isAluno);
    toast("PDF exportado com sucesso.", "ok");
    return;

    doneQuestions.forEach((o, i) => {
      const { q, idx } = o;
      const d = q.data;
      if(i > 0){ doc.addPage(); ctx.y = margin; }

      pdfDrawQuestionHeader(doc, ctx, q, idx);

      if(d.textoBase){
        pdfDrawBox(doc, ctx, { label: "Texto de apoio", text: d.textoBase, colors: PDF_PALETTE.contexto, fontSize: 10 });
      }

      if(d.visual && d.visual.tipo){
        pdfDrawVisualBox(doc, ctx, d.visual, idx);
      }

      if(d.comando){
        pdfDrawBox(doc, ctx, { label: "Pergunta", text: d.comando, colors: PDF_PALETTE.pergunta, fontSize: 11.5 });
      }

      ["A", "B", "C", "D", "E"].forEach(letter => {
        const isCorrect = !isAluno && letraCorretaDe(d) === letter;
        const altText = (d.alternativas && d.alternativas[letter]) || "";
        pdfDrawBox(doc, ctx, {
          label: `Alternativa ${letter}` + (isCorrect ? " — CORRETA" : ""),
          text: altText,
          colors: isCorrect ? PDF_PALETTE.correta : PDF_PALETTE.alternativa,
          fontSize: 10.5,
          gap: 8,
        });
      });

      if(!isAluno){
        let habText = `Competência ${d.competencia?.numero || "—"}: ${d.competencia?.texto || ""}\n\n${d.habilidade?.codigo || "—"}: ${d.habilidade?.texto || ""}`;
        if(d.objetoConhecimento) habText += `\n\nObjeto de conhecimento: ${d.objetoConhecimento}`;
        pdfDrawBox(doc, ctx, { label: "Habilidade, competência e objeto de conhecimento", text: habText, colors: PDF_PALETTE.habilidade, fontSize: 10 });

        pdfDrawBox(doc, ctx, { label: "Gabarito", text: letraCorretaDe(d) || "—", colors: PDF_PALETTE.gabarito, big: true, gap: 14 });

        const respostaText = (d.alternativas && d.alternativas[letraCorretaDe(d)]) || "";
        pdfDrawBox(doc, ctx, { label: "Resposta correta", text: respostaText, colors: PDF_PALETTE.resposta, fontSize: 10.5 });

        pdfDrawBox(doc, ctx, { label: "Resolução comentada", text: d.resolucaoComentada || "", colors: PDF_PALETTE.resolucao, fontSize: 10 });

        const comentarios = ["A", "B", "C", "D", "E"].map(letter => {
          const info = d.analiseAlternativas && d.analiseAlternativas[letter];
          if(!info) return "";
          const status = marcaAlternativa(conferenciaGabarito(d), letter, false);
          return `${letter} — ${status}: ${info.comentario || ""}`;
        }).filter(Boolean).join("\n\n");
        pdfDrawBox(doc, ctx, { label: "Comentários das alternativas", text: comentarios, colors: PDF_PALETTE.comentario, fontSize: 10 });
      }
    });

    const rotulo = isAluno ? "aluno" : "professor";
    const safeName = `Simulado_ENEM_${(state.disciplina||"questoes").replace(/[^a-zA-Z0-9]+/g,"_")}_${rotulo}.pdf`;
    doc.save(safeName);
    toast("PDF exportado com sucesso.", "ok");
  }catch(err){
    toast("Não foi possível exportar o PDF: " + (err.message || err), "err");
  }finally{
    btn.disabled = false; btn.textContent = originalLabel;
  }
}

/* ---------------- DOCX export (espelho exato do layout do PDF, em Word) ----------------
 * Usa as MESMAS constantes de layout (PDF_PALETTE, dimensões A4 em pt, margens, ordem
 * das seções) que o exportPdf() acima, para que o DOCX gerado seja um espelho fiel do
 * PDF: mesmas caixas coloridas com barra de destaque à esquerda, mesmos rótulos, mesma
 * ordem de blocos por questão, mesma quebra de página por questão.
 * Duas diferenças estruturais, inerentes ao formato Word (não afetam o layout visível):
 * 1) O Word faz flow automático de texto grande dentro de uma caixa/tabela entre páginas
 *    — não precisamos do equivalente a pdfDrawBoxPaginated().
 * 2) O Word tem suporte nativo a Unicode — símbolos como π, √, ², ≤, ≥ aparecem
 *    corretamente sem precisar da sanitização usada no PDF (pdfSanitizeText).
 * -------------------------------------------------------------------------------------- */

const DOCX_PAGE_WIDTH_PT = 595.28;   // A4 em pt — mesmo valor usado pelo jsPDF acima
const DOCX_PAGE_HEIGHT_PT = 841.89;
const DOCX_MARGIN_PT = 40;           // mesma margem usada no PDF (const margin = 40 em exportPdf)
const DOCX_CONTENT_WIDTH_PT = DOCX_PAGE_WIDTH_PT - DOCX_MARGIN_PT * 2;
const DOCX_CONTENT_WIDTH_TWIPS = Math.round(DOCX_CONTENT_WIDTH_PT * 20); // 1pt = 20 twips (DXA)

function ptToTwips(pt){ return Math.round(pt * 20); }
function ptToHalfPt(pt){ return Math.round(pt * 2); }       // TextRun "size" é em meios-de-ponto
function ptToPx(pt){ return Math.round(pt * (96 / 72)); }   // ImageRun usa "pixels" a 96dpi
function ptToEighths(pt){ return Math.round(pt * 8); }      // bordas OOXML em oitavos de ponto

function rgbToHex([r, g, b]){
  return [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function docxColors(paletteEntry){
  return {
    fill: rgbToHex(paletteEntry.fill),
    accent: rgbToHex(paletteEntry.accent),
    text: rgbToHex(paletteEntry.text),
  };
}

function docxImageType(dataUrl){
  const m = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.exec(dataUrl || "");
  if(!m) return "png";
  const f = m[1].toLowerCase();
  if(f === "jpeg" || f === "jpg") return "jpg";
  return f;   // diz o formato REAL; quem garante que não chega webp é imagemParaJpeg
}

/* O Word não abre WebP. Desde que as imagens passaram a chegar em WebP (bem
   menor que o PNG, ver a seção de geração de imagem), é preciso converter antes
   de embutir no .docx — senão o arquivo sai com um quadro vazio no lugar da
   figura. O PDF não precisa disto: o jsPDF converte sozinho para JPEG.

   A conversão é feita no próprio navegador, com canvas, a partir da imagem que
   JÁ está desenhada na tela (portanto já decodificada). Se algo falhar, devolve
   a original em vez de derrubar a exportação inteira — e aí o pior caso é o
   comportamento anterior, não uma exportação perdida.                         */
function imagemParaJpeg(dataUrl, imgEl){
  if(!/^data:image\/webp/i.test(dataUrl || "")) return dataUrl;
  try{
    const fonte = (imgEl && imgEl.complete && imgEl.naturalWidth) ? imgEl : null;
    if(!fonte) return null;
    const cv = document.createElement("canvas");
    cv.width = fonte.naturalWidth;
    cv.height = fonte.naturalHeight;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#FFFFFF";                 // JPEG não tem transparência
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(fonte, 0, 0);
    const saida = cv.toDataURL("image/jpeg", 0.92);
    return /^data:image\/jpeg/i.test(saida) ? saida : null;
  }catch(e){
    return null;   // devolver o WebP aqui faria o Word receber bytes que não abre
  }
}

function docxDataUrlToUint8Array(dataUrl){
  const base64 = (dataUrl || "").split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Equivalente, em DOCX, da caixa colorida desenhada por pdfDrawBox() no PDF: uma tabela
// de 1 célula (truque padrão para caixa com fundo colorido no Word), com borda esquerda
// grossa e colorida simulando a barra de destaque do PDF, rótulo em maiúsculas e corpo
// de texto — mesmas cores (PDF_PALETTE), mesmo tamanho de fonte, mesma ordem de blocos.
function docxBuildBox({ label, text, colors, fontSize = 10.5, big = false, gap = 10 }){
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, ShadingType, AlignmentType } = window.docx;
  const c = docxColors(colors);
  const cellChildren = [];

  if(label){
    cellChildren.push(new Paragraph({
      spacing: { after: 60 },
      children: [ new TextRun({ text: String(label).toUpperCase(), bold: true, size: ptToHalfPt(8), color: c.accent, font: "Helvetica" }) ],
    }));
  }

  if(big){
    cellChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [ new TextRun({ text: String(text || "—"), bold: true, size: ptToHalfPt(26), color: c.text, font: "Helvetica" }) ],
    }));
  } else {
    const raw = String(text || "").trim();
    const bodyLines = raw ? raw.split(/\n+/) : ["—"];
    bodyLines.forEach((line, i) => {
      cellChildren.push(new Paragraph({
        spacing: { after: i === bodyLines.length - 1 ? 0 : 60 },
        children: [ new TextRun({ text: line, size: ptToHalfPt(fontSize), color: c.text, font: "Helvetica" }) ],
      }));
    });
  }

  const table = new Table({
    width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    rows: [ new TableRow({ children: [ new TableCell({
      width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
      shading: { fill: c.fill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 140, bottom: 140, left: 170, right: 140 },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.SINGLE, size: ptToEighths(4), color: c.accent },
      },
      children: cellChildren,
    }) ] }) ],
  });

  return [ table, new Paragraph({ spacing: { after: ptToTwips(gap) } }) ];
}

// Equivalente, em DOCX, de pdfDrawVisualBox(): a mesma caixa (cor PDF_PALETTE.visual)
// contendo, dependendo do tipo — imagem gerada por IA / gráfico (embutidos como imagem,
// lidos da tela via pdfGetVisualImageInfo/pdfGetVisualChartInfo, reaproveitadas do bloco
// de PDF acima) ou tabela (desenhada como tabela nativa do Word, não como imagem).
function docxBuildVisualBox(visual, cardIdx){
  if(!visual || !visual.tipo) return [];
  const { Table, TableRow, TableCell, Paragraph, TextRun, ImageRun, WidthType, BorderStyle, ShadingType, AlignmentType } = window.docx;
  const c = docxColors(PDF_PALETTE.visual);
  const titleText = visual.titulo || (visual.tipo === "imagem" ? "Imagem ilustrativa" : visual.tipo === "grafico" ? "Gráfico" : "Tabela");
  const innerChildren = [
    new Paragraph({
      spacing: { after: 90 },
      children: [ new TextRun({ text: String(titleText).toUpperCase(), bold: true, size: ptToHalfPt(8), color: c.accent, font: "Helvetica" }) ],
    }),
  ];

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(cols.length){
      const tableWidthTwips = DOCX_CONTENT_WIDTH_TWIPS - 600;
      const colWidthTwips = Math.round(tableWidthTwips / cols.length);
      const headerRow = new TableRow({
        children: cols.map(col => new TableCell({
          width: { size: colWidthTwips, type: WidthType.DXA },
          shading: { fill: "FFFFFF", type: ShadingType.CLEAR, color: "auto" },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [ new Paragraph({ children: [ new TextRun({ text: String(col), bold: true, size: ptToHalfPt(9), color: "000000", font: "Helvetica" }) ] }) ],
        })),
      });
      const dataRows = rows.map(row => new TableRow({
        children: row.map(cell => new TableCell({
          width: { size: colWidthTwips, type: WidthType.DXA },
          shading: { fill: "FCFCFD", type: ShadingType.CLEAR, color: "auto" },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [ new Paragraph({ children: [ new TextRun({ text: String(cell), size: ptToHalfPt(9), color: "000000", font: "Helvetica" }) ] }) ],
        })),
      }));
      innerChildren.push(new Table({
        width: { size: tableWidthTwips, type: WidthType.DXA },
        rows: [ headerRow, ...dataRows ],
      }));
    }
  } else {
    const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx, true) : pdfGetVisualChartInfo(cardIdx);
    if(info){
      const maxW = DOCX_CONTENT_WIDTH_PT - 20 - 6;
      const maxH = 260;
      let w = maxW, h = w * (info.height / info.width);
      if(h > maxH){ h = maxH; w = h * (info.width / info.height); }
      try{
        innerChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [ new ImageRun({
            data: docxDataUrlToUint8Array(info.dataUrl),
            transformation: { width: ptToPx(w), height: ptToPx(h) },
            type: docxImageType(info.dataUrl),
          }) ],
        }));
      }catch(e){ /* imagem inválida — ignora silenciosamente, igual ao PDF */ }
      if(visual.descricao){
        innerChildren.push(new Paragraph({
          spacing: { before: 80 },
          children: [ new TextRun({ text: visual.descricao, italics: true, size: ptToHalfPt(8.5), color: c.text, font: "Helvetica" }) ],
        }));
      }
    }
  }

  const table = new Table({
    width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    rows: [ new TableRow({ children: [ new TableCell({
      width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
      shading: { fill: c.fill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 140, bottom: 140, left: 170, right: 140 },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.SINGLE, size: ptToEighths(4), color: c.accent },
      },
      children: innerChildren,
    }) ] }) ],
  });

  return [ table, new Paragraph({ spacing: { after: ptToTwips(10) } }) ];
}

function docxBuildQuestionHeader(q, idx){
  const { Paragraph, TextRun } = window.docx;
  const d = q.data;
  const title = `Questão ${idx + 1}` + (d.tema ? ` — ${d.tema}` : "");
  const metaParts = [d.disciplina || state.disciplina, d.dificuldade].filter(Boolean);
  return [
    new Paragraph({
      spacing: { after: 40 },
      children: [ new TextRun({ text: title, bold: true, size: ptToHalfPt(14), color: "1E293B", font: "Helvetica" }) ],
    }),
    new Paragraph({
      spacing: { after: 160 },
      children: [ new TextRun({ text: metaParts.join("   ·   "), size: ptToHalfPt(9), color: "64748B", font: "Helvetica" }) ],
    }),
  ];
}

async function exportDocx(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de exportar em DOCX.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de exportar em DOCX.", "err");
    return;
  }
  if(!window.docx){
    try{
      await loadScriptOnce(CDN_URLS.docx);
    }catch(e){
      toast("Não foi possível carregar a biblioteca de DOCX (verifique sua conexão com a internet) e tente novamente.", "err");
      return;
    }
  }

  const btn = document.getElementById("btnExportDocx");
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = "Gerando DOCX...";

  try{
    const { Document, Packer, Paragraph, TextRun, PageBreak } = window.docx;
    const isAluno = state.viewMode === "aluno";

    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(!doneQuestions.length){ throw new Error("Nenhuma questão para exportar."); }

    // AS DUAS VERSÕES saem na mesma anatomia do PDF: página 200 × 275 mm, duas
    // colunas de 89,47 mm com fio separador, Calibri 10/12,0 pt, tinta #231F20,
    // e o mesmo cromo de página — marca, quadrados, barra cinza, filete misto,
    // tarja, rodapé corrido e fólio. `evenAndOddHeaderAndFooters` faz cabeçalho
    // e rodapé espelharem pela paridade, como no caderno oficial.
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
    if(bloqueiaSeGabaritoInconsistente(doneQuestions)) return;
    const docEnem = new Document({
      evenAndOddHeaderAndFooters: true,
      sections: enemDocxSections(doneQuestions, !isAluno),
    });
    const blobEnem = await Packer.toBlob(docEnem);
    const rotuloEnem = isAluno ? "aluno" : "professor";
    const nomeEnem = "Simulado_ENEM_" + (state.disciplina||"questoes").replace(/[^a-zA-Z0-9]+/g,"_") + "_" + rotuloEnem + ".docx";
    const urlEnem = URL.createObjectURL(blobEnem);
    const aEnem = document.createElement("a");
    aEnem.href = urlEnem; aEnem.download = nomeEnem;
    document.body.appendChild(aEnem); aEnem.click(); document.body.removeChild(aEnem);
    setTimeout(() => URL.revokeObjectURL(urlEnem), 4000);
    toast("DOCX exportado com sucesso.", "ok");
    return;

    const children = [];
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [ new TextRun({ text: "Simulado ENEM", bold: true, size: ptToHalfPt(20), color: "1E293B", font: "Helvetica" }) ],
    }));
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [ new TextRun({ text: `${AREA_META[state.area] ? AREA_META[state.area].label : ""} · ${state.disciplina || ""}`, size: ptToHalfPt(11), color: "475569", font: "Helvetica" }) ],
    }));
    children.push(new Paragraph({
      spacing: { after: 260 },
      children: [ new TextRun({ text: isAluno ? "Versão do aluno (sem gabarito)" : "Versão do professor (com gabarito e comentários)", size: ptToHalfPt(11), color: "475569", font: "Helvetica" }) ],
    }));

    doneQuestions.forEach((o, i) => {
      const { q, idx } = o;
      const d = q.data;
      if(i > 0){
        children.push(new Paragraph({ children: [ new PageBreak() ] }));
      }

      children.push(...docxBuildQuestionHeader(q, idx));

      if(d.textoBase){
        children.push(...docxBuildBox({ label: "Texto de apoio", text: d.textoBase, colors: PDF_PALETTE.contexto, fontSize: 10 }));
      }

      if(d.visual && d.visual.tipo){
        children.push(...docxBuildVisualBox(d.visual, idx));
      }

      if(d.comando){
        children.push(...docxBuildBox({ label: "Pergunta", text: d.comando, colors: PDF_PALETTE.pergunta, fontSize: 11.5 }));
      }

      ["A", "B", "C", "D", "E"].forEach(letter => {
        const isCorrect = !isAluno && letraCorretaDe(d) === letter;
        const altText = (d.alternativas && d.alternativas[letter]) || "";
        children.push(...docxBuildBox({
          label: `Alternativa ${letter}` + (isCorrect ? " — CORRETA" : ""),
          text: altText,
          colors: isCorrect ? PDF_PALETTE.correta : PDF_PALETTE.alternativa,
          fontSize: 10.5,
          gap: 8,
        }));
      });

      if(!isAluno){
        let habText = `Competência ${d.competencia?.numero || "—"}: ${d.competencia?.texto || ""}\n\n${d.habilidade?.codigo || "—"}: ${d.habilidade?.texto || ""}`;
        if(d.objetoConhecimento) habText += `\n\nObjeto de conhecimento: ${d.objetoConhecimento}`;
        children.push(...docxBuildBox({ label: "Habilidade, competência e objeto de conhecimento", text: habText, colors: PDF_PALETTE.habilidade, fontSize: 10 }));

        children.push(...docxBuildBox({ label: "Gabarito", text: letraCorretaDe(d) || "—", colors: PDF_PALETTE.gabarito, big: true, gap: 14 }));

        const respostaText = (d.alternativas && d.alternativas[letraCorretaDe(d)]) || "";
        children.push(...docxBuildBox({ label: "Resposta correta", text: respostaText, colors: PDF_PALETTE.resposta, fontSize: 10.5 }));

        children.push(...docxBuildBox({ label: "Resolução comentada", text: d.resolucaoComentada || "", colors: PDF_PALETTE.resolucao, fontSize: 10 }));

        const comentarios = ["A", "B", "C", "D", "E"].map(letter => {
          const info = d.analiseAlternativas && d.analiseAlternativas[letter];
          if(!info) return "";
          const status = marcaAlternativa(conferenciaGabarito(d), letter, false);
          return `${letter} — ${status}: ${info.comentario || ""}`;
        }).filter(Boolean).join("\n\n");
        children.push(...docxBuildBox({ label: "Comentários das alternativas", text: comentarios, colors: PDF_PALETTE.comentario, fontSize: 10 }));
      }
    });

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: Math.round(DOCX_PAGE_WIDTH_PT * 20), height: Math.round(DOCX_PAGE_HEIGHT_PT * 20) },
            margin: {
              top: ptToTwips(DOCX_MARGIN_PT), bottom: ptToTwips(DOCX_MARGIN_PT),
              left: ptToTwips(DOCX_MARGIN_PT), right: ptToTwips(DOCX_MARGIN_PT),
            },
          },
        },
        children,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const rotulo = isAluno ? "aluno" : "professor";
    const safeName = `Simulado_ENEM_${(state.disciplina||"questoes").replace(/[^a-zA-Z0-9]+/g,"_")}_${rotulo}.docx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = safeName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("DOCX exportado com sucesso.", "ok");
  }catch(err){
    toast("Não foi possível exportar o DOCX: " + (err.message || err), "err");
  }finally{
    btn.disabled = false; btn.textContent = originalLabel;
  }
}

/* ---------------- Init / events ---------------- */
function init(){
  initAuth();
  renderAreaGrid();
  renderDisciplinaChips();
  setQty(1);
  atualizaOpcoesPorArea();

  // Recupera chave/modelo salvos neste navegador, se houver (ver STORAGE_KEYS).
  const savedKey = safeStorageGet(STORAGE_KEYS.apiKey);
  const savedModel = safeStorageGet(STORAGE_KEYS.model);
  if(savedKey){
    state.apiKey = savedKey;
    const keyInput = document.getElementById("apiKeyInput");
    if(keyInput) keyInput.value = savedKey;
  }
  if(savedModel){
    state.model = savedModel;
    const modelInput = document.getElementById("modelInput");
    if(modelInput) modelInput.value = savedModel;
  }

  document.getElementById("qtyMinus").addEventListener("click", () => setQty(state.qty - 1));
  document.getElementById("qtyPlus").addEventListener("click", () => setQty(state.qty + 1));

  // Painel de configuração em lote (passo 4): contadores por nível.
  document.querySelectorAll("#lotePanel .lote-count").forEach(card => {
    const nivel = card.dataset.d;
    card.querySelector(".lc-menos").addEventListener("click", () => ajustaContadorLote(nivel, -1));
    card.querySelector(".lc-mais").addEventListener("click", () => ajustaContadorLote(nivel, +1));
  });
  document.getElementById("btnDistribuirIgual").addEventListener("click", distribuirIgualmenteLote);
  document.querySelectorAll("#loteRecursoRow .res-opt").forEach(r => r.addEventListener("click", () => {
    document.querySelectorAll("#loteRecursoRow .res-opt").forEach(x => x.classList.toggle("sel", x === r));
  }));
  document.getElementById("btnAplicarLote").addEventListener("click", () => { if(exigirLogin()) aplicarLoteATodas(); });
  sincronizaContadoresLote();

  /* v18.11 — os DOIS botões "Gerar simulado" (o da seção 4, dentro do painel do
     lote, e o da seção 6) chamam a mesma função. Não há um segundo caminho de
     geração: é o mesmo botão em dois lugares, para o professor não ter de descer
     a página depois de configurar o lote. */
  document.getElementById("btnGenerate").addEventListener("click", iniciarGeracao);
  document.getElementById("btnGerarLote").addEventListener("click", iniciarGeracao);
  document.getElementById("btnBackToForm").addEventListener("click", () => {
    simuladoAbertoId = null;
    document.getElementById("formPanel").style.display = "block";
    document.getElementById("resultsPanel").style.display = "none";
    /* v18.4: a ÁREA e a DISCIPLINA também vêm do estado. Sem estas duas linhas,
       abrir um simulado arquivado de outra área e voltar aqui deixava a grade e
       os chips mostrando a seleção ANTERIOR enquanto state.area/state.disciplina
       já eram os do arquivo — e é o ESTADO que vai para o backend. Foi assim que
       7 conteúdos de Química saíram gerados como Matemática em 15/09/2026: a tela
       mostrava "Ciências da Natureza · Química" e o estado era "matematica". */
    renderAreaGrid();
    renderDisciplinaChips();
    atualizaOpcoesPorArea();
    // Os blocos são reconstruídos a partir do estado: o que foi editado na
    // tela de resultados (tema, nível, recurso) aparece aqui também.
    renderQuestionBlocks();
    sincronizaContadoresLote();
  });

  document.getElementById("viewAluno").addEventListener("click", () => setViewMode("aluno"));
  document.getElementById("viewProfessor").addEventListener("click", () => setViewMode("professor"));
  document.getElementById("btnPrint").addEventListener("click", printExam);
  document.getElementById("btnExport").addEventListener("click", exportHtmlSnapshot);
  document.getElementById("btnExportPdf").addEventListener("click", exportPdf);
  document.getElementById("btnExportDocx").addEventListener("click", exportDocx);

  document.getElementById("btnSettings").addEventListener("click", () => openModal("settingsModal"));
  document.getElementById("btnCloseSettings").addEventListener("click", () => closeModal("settingsModal"));
  document.getElementById("btnSaveSettings").addEventListener("click", () => {
    state.apiKey = document.getElementById("apiKeyInput").value.trim();
    state.model = document.getElementById("modelInput").value.trim() || state.model;
    let saved = false;
    if(state.apiKey){
      saved = safeStorageSet(STORAGE_KEYS.apiKey, state.apiKey);
      safeStorageSet(STORAGE_KEYS.model, state.model);
    }
    closeModal("settingsModal");
    if(!state.apiKey){
      toast("Nenhuma chave informada.", "err");
    } else if(saved){
      toast("Chave salva neste navegador — não vai pedir de novo.", "ok");
    } else {
      toast("Configurações salvas para esta sessão (este visualizador não permite lembrar a chave entre sessões).", "ok");
    }
  });

  const btnForgetKey = document.getElementById("btnForgetKey");
  if(btnForgetKey){
    btnForgetKey.addEventListener("click", () => {
      state.apiKey = "";
      safeStorageRemove(STORAGE_KEYS.apiKey);
      safeStorageRemove(STORAGE_KEYS.model);
      const keyInput = document.getElementById("apiKeyInput");
      if(keyInput) keyInput.value = "";
      toast("Chave removida deste navegador.", "ok");
    });
  }

  document.getElementById("btnHelp").addEventListener("click", () => openModal("helpModal"));
  document.getElementById("btnCloseHelp").addEventListener("click", () => closeModal("helpModal"));

  // ---------------- Autenticação e "Meus Simulados" ----------------
  document.getElementById("btnEntrar").addEventListener("click", () => abrirAuthModal("login"));
  document.getElementById("btnCloseAuth").addEventListener("click", () => closeModal("authModal"));
  document.getElementById("authTabLogin").addEventListener("click", () => selecionaAbaAuth("login"));
  document.getElementById("authTabCadastro").addEventListener("click", () => selecionaAbaAuth("cadastro"));
  document.getElementById("linkIrCadastro").addEventListener("click", () => selecionaAbaAuth("cadastro"));
  document.getElementById("linkIrLogin").addEventListener("click", () => selecionaAbaAuth("login"));
  document.getElementById("btnGoogleAuth").addEventListener("click", fazerLoginGoogle);
  document.getElementById("btnLoginSubmit").addEventListener("click", fazerLogin);
  document.getElementById("btnCadastroSubmit").addEventListener("click", fazerCadastro);
  ["loginEmail","loginSenha"].forEach(id => document.getElementById(id).addEventListener("keydown", e => { if(e.key === "Enter") fazerLogin(); }));
  ["cadastroEmail","cadastroSenha"].forEach(id => document.getElementById(id).addEventListener("keydown", e => { if(e.key === "Enter") fazerCadastro(); }));
  document.getElementById("btnSair").addEventListener("click", fazerLogout);
  document.getElementById("btnMeusSimulados").addEventListener("click", abrirMeusSimulados);
  document.getElementById("btnFecharSimulados").addEventListener("click", fecharMeusSimulados);

  // v15: caixa "Solicitar simulados pelo WhatsApp". Isolada: se falhar, o resto do app segue.
  try{ waInit(); }catch(e){ console.error("[wa] init:", e); const wb = document.getElementById("waBox"); if(wb) wb.style.display = "none"; }

  setViewMode("professor");

  // Efeito de inclinação 3D ao passar o mouse foi removido a pedido do usuário:
  // os cartões de questão (.qcard) e os blocos de área (.area-tile) agora ficam
  // fixos, sem rotacionar/deslocar ao movimentar o cursor sobre eles.
}

function openModal(id){ document.getElementById(id).classList.add("show"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }

document.addEventListener("DOMContentLoaded", init);
