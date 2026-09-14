// Teste real 10 × Exponenciação — FASE D: o app v17 REAL recebe as 10 questões REAIS
// (tests/fixtures/teste_real_v73/q01.json … q10.json, geradas pela função de teste com o
// backend v73) exatamente como o backend as devolveria, e roda o fluxo completo de
// generateAll(): normalização, notação (nm), gabarito planejado, auditoria de temas,
// auditoria de contextos (v17), auditoria de gabaritos, cartões e toasts.
// Depois, para cada questão, roda auditaQuestaoLocal (a "Auditoria local (sem custo)"
// do cartão), auditaGlifosPdf e nmAudita, e registra quais domínios do catálogo cada
// texto aciona — para conferir que a auditoria por palavras-chave só bate no
// domínio reservado da própria questão.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '..');
const INDEX = path.resolve(RAIZ, 'index.html');
const DIR = path.resolve(__dirname, 'fixtures', 'teste_real_v73');
const SAIDA = path.resolve(__dirname, 'saida');
const faseB = JSON.parse(fs.readFileSync(path.join(DIR, 'fase_b_corpos.json'), 'utf8'));
const planResp = JSON.parse(fs.readFileSync(path.join(DIR, 'planejamento_resposta.json'), 'utf8'));
const respostas = [];
for(let i = 1; i <= 10; i++) respostas.push(JSON.parse(fs.readFileSync(path.join(DIR, `q${String(i).padStart(2, '0')}.json`), 'utf8')));
const porDominio = new Map(respostas.map(r => [r.diversidadeDiag.dominioContexto, r]));
const reservas = faseB.estado.reservas.map(r => ({ dominio: r.dominio, alt: r.alt }));
const PLANO = faseB.estado.gabaritoPlan;

const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB_SUPABASE = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(){ return { data: [{ vinculado: false }], error: null }; },
  from(){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: null, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((f) => { window.__fake = f; }, { session: SESSAO });
  const corpos = []; const planejamentos = []; const consoleLogs = []; const errosPagina = [];
  page.on('console', m => { if(/\[tema\]|\[contexto\]|\[notação\]|\[uso\]|custo/i.test(m.text())) consoleLogs.push(m.text()); });
  page.on('pageerror', e => errosPagina.push(String(e && e.message || e)));
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(url.includes('supabase-js') || url.includes('jsdelivr')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(url.includes('/functions/v1/generate-question')){
      const body = route.request().postDataJSON() || {};
      if(body.planejarRecortes){ planejamentos.push(body); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planResp) }); }
      corpos.push(body);
      const r = porDominio.get(body.dominioContexto);
      if(!r) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fase D: sem resposta real para o domínio ' + body.dominioContexto }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
    }
    if(url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('file://' + INDEX);
  await page.waitForTimeout(600);
  await page.evaluate(({ reservas, plano }) => {
    window.__toasts = [];
    const toastOriginal = toast;
    window.toast = function(msg, tipo){ window.__toasts.push({ tipo, msg: String(msg) }); return toastOriginal(msg, tipo); };
    state.area = 'matematica'; state.disciplina = 'Matemática';
    document.querySelectorAll('.area-tile').forEach(t => t.classList.toggle('active', t.dataset.area === 'matematica'));
    setQty(10);
    state.questions.forEach(q => { q.tema = 'Exponenciação'; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; });
    // Mesmo plano de gabaritos e mesmas reservas de domínio da fase B (as questões
    // reais foram geradas com esses alvos).
    window.planejaGabaritos = function(){ return plano.slice(); };
    const original = planejaDominios;
    window.planejaDominios = function(){ original(); state.questions.forEach((q, i) => { q.dominio = reservas[i].dominio; q.dominioAlt = reservas[i].alt; }); };
  }, { reservas, plano: PLANO });
  await page.evaluate(() => generateAll());
  await page.waitForFunction(() => state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 30000 });
  await page.waitForTimeout(800);

  const resultado = await page.evaluate(() => {
    const L = GABARITO_LETRAS;
    const dominiosAcionados = q => DOMINIOS_CONTEXTO.filter(d => dominioBateNoTexto(textoDeBuscaDaQuestao(q), d)).map(d => d.n);
    // Mesmo leitor numérico do app (valorNumericoAlternativa): moeda, milhar, sobrescrito, científica.
    const numericas = alts => { const vals = L.map(k => valorNumericoAlternativa(alts[k])); return vals.every(v => v !== null) ? vals : null; };
    const tamanhos = alts => L.map(k => String(alts[k] || '').trim().length);
    const questoes = state.questions.map((q, i) => {
      const d = q.data || {};
      const card = document.querySelector(`[data-qidx="${i}"]`) || document.querySelectorAll('.qcard, .question-card, [class*="card"]')[i] || null;
      return {
        n: i + 1,
        status: q.status,
        erro: q.errorMsg || null,
        gabaritoAlvo: gabaritoAlvoDe(i),
        gabaritoEntregue: d.gabarito,
        gabaritoStatus: q.gabaritoStatus,
        reposicionado: !!d.gabaritoReposicionado,
        dominioReservado: q.dominio,
        dominioAlt: q.dominioAlt,
        temaEntregue: d.tema,
        objeto: d.objetoConhecimento,
        habilidade: d.habilidade && d.habilidade.codigo,
        competencia: d.competencia && d.competencia.numero,
        recurso: q.recurso,
        visual: d.visual,
        colisaoContexto: q.colisaoContexto || null,
        contextosEvitar: q.contextosEvitar || null,
        dominiosAcionados: dominiosAcionados(q),
        numericasOrdenadas: (() => { const v = numericas(d.alternativas || {}); if(!v) return 'não numéricas'; for(let k = 1; k < v.length; k++) if(v[k] < v[k - 1]) return 'FORA DE ORDEM ' + v.join(' , '); return 'crescente ' + v.join(' , '); })(),
        tamanhosAlternativas: tamanhos(d.alternativas || {}),
        auditoriaLocal: auditaQuestaoLocal(q),
        glifosPdf: auditaGlifosPdf([q]),
        nm: (() => { const achados = []; quiCamposDaQuestao(q, 0).forEach(c => nmAudita(c.texto).forEach(o => achados.push(c.rotulo + ': ' + o))); return achados; })(),
        diag: q.diag,
        chavesAnalise: Object.fromEntries(L.map(k => [k, Object.keys((d.analiseAlternativas || {})[k] || {})])),
        analiseCorretas: L.filter(k => d.analiseAlternativas && d.analiseAlternativas[k] && d.analiseAlternativas[k].status === 'correta'),
      };
    });
    return {
      gabaritoPlan: state.gabaritoPlan,
      questoes,
      auditaDiversidadeContextos: auditaDiversidadeContextos(),
      auditaDiversidadeTemas: auditaDiversidadeTemas(),
      auditaGabaritos: auditaGabaritos(),
      auditaGlifosPdfLeva: auditaGlifosPdf(state.questions),
      toasts: window.__toasts,
      // Botões de verdade no DOM (o código-fonte inlined no index.html também contém a frase).
      botoesOutroContexto: document.querySelectorAll('.qcard button[title^="Outro contexto"]').length,
      botoesRegenerar: document.querySelectorAll('.qcard button[title="Regenerar"]').length,
      cartoesRenderizados: document.querySelectorAll('.qcard').length,
      temasNoHtml: state.questions.filter(q => q.data && Array.from(document.querySelectorAll('.qcard h3')).some(h => h.textContent === q.data.tema)).length,
      relatoUso: relatoUso(),
    };
  });

  // Determinismo: os corpos enviados nesta fase têm de ser os mesmos da fase B.
  const norm = b => JSON.stringify(b, Object.keys(b).sort());
  const corposB = faseB.corposGeracao;
  const iguais = corpos.length === corposB.length && corpos.every(c => corposB.some(b => norm(b) === norm(c)));
  const saida = { corposIguaisFaseB: iguais, planejamentos: planejamentos.length, corpos: corpos.length, errosPagina, consoleLogs, ...resultado };
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, 'fase_d_resultado.json'), JSON.stringify(saida, null, 1));

  // Resumo legível
  const linhas = [];
  linhas.push(`corpos iguais à fase B: ${iguais} · planejamentos: ${planejamentos.length} · corpos: ${corpos.length} · erros de página: ${errosPagina.length}`);
  linhas.push(`gabaritoPlan: ${resultado.gabaritoPlan.join('')} · entregues: ${resultado.questoes.map(q => q.gabaritoEntregue).join('')} · status: ${resultado.questoes.map(q => q.gabaritoStatus).join(',')}`);
  linhas.push(`auditaGabaritos: ${JSON.stringify(resultado.auditaGabaritos)}`);
  linhas.push(`auditaDiversidadeTemas: ${JSON.stringify(resultado.auditaDiversidadeTemas)}`);
  linhas.push(`auditaDiversidadeContextos: ${JSON.stringify(resultado.auditaDiversidadeContextos)}`);
  linhas.push(`cartões: ${resultado.cartoesRenderizados} · botões "Regenerar": ${resultado.botoesRegenerar} · botões "Outro contexto": ${resultado.botoesOutroContexto} · temas nos cartões: ${resultado.temasNoHtml}/10 · glifos PDF (leva): ${resultado.auditaGlifosPdfLeva.length}`);
  linhas.push(`toasts: ${resultado.toasts.map(t => `[${t.tipo}] ${t.msg.slice(0, 140)}`).join(' | ')}`);
  linhas.push(`uso: ${resultado.relatoUso}`);
  for(const q of resultado.questoes){
    linhas.push(`\nQ${q.n} [${q.status}] alvo ${q.gabaritoAlvo} entregue ${q.gabaritoEntregue} (${q.gabaritoStatus}) · H${String(q.habilidade).replace(/^H/, '')} C${q.competencia} · ${q.objeto}`);
    linhas.push(`   domínio reservado: ${q.dominioReservado} · acionados pelo texto: ${JSON.stringify(q.dominiosAcionados)}`);
    linhas.push(`   tema: ${q.temaEntregue}`);
    linhas.push(`   alternativas: ${q.numericasOrdenadas} · tamanhos ${q.tamanhosAlternativas.join('/')} · corretas na análise: ${q.analiseCorretas.join('')}`);
    const chavesEstranhas = Object.entries(q.chavesAnalise).filter(([, ks]) => ks.some(k => k !== 'status' && k !== 'comentario'));
    if(chavesEstranhas.length) linhas.push(`   chaves fora do padrão na análise: ${JSON.stringify(chavesEstranhas)}`);
    linhas.push(`   auditoria local: ${q.auditoriaLocal.length ? q.auditoriaLocal.map(i => (i.nivel === 'aviso' ? '⚠ ' : 'ℹ ') + i.texto).join(' | ') : 'nenhum alerta'}`);
    linhas.push(`   glifos PDF: ${q.glifosPdf.length} · nm: ${q.nm.length ? q.nm.join(' | ') : 'sem resíduos'}`);
    if(q.colisaoContexto) linhas.push(`   COLISÃO: ${q.colisaoContexto}`);
  }
  console.log(linhas.join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
