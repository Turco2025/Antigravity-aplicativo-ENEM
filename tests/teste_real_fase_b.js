// Teste real 10 × Exponenciação — FASE B: o app v17 REAL recebe a resposta REAL do planejador
// (tests/fixtures/teste_real_v73/planejamento_resposta.json), aplica sua lógica (contexto no domínio,
// sem repetição) e monta os 10 corpos de geração, que serão enviados à função de teste.
// As reservas de domínio são as congeladas em tests/fixtures/teste_real_v73/fase_b_corpos.json (as mesmas da fase A).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '..');
const INDEX = path.resolve(RAIZ, 'index.html');
const FIX = path.resolve(__dirname, 'fixtures', 'teste_real_v73');
const congelado = JSON.parse(fs.readFileSync(path.join(FIX, 'fase_b_corpos.json'), 'utf8'));
const faseA = { reservas: congelado.estado.reservas.map(r => ({ dominio: r.dominio, alt: r.alt })) };
const planResp = JSON.parse(fs.readFileSync(path.join(FIX, 'planejamento_resposta.json'), 'utf8'));
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB_SUPABASE = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(){ return { data: [{ vinculado: false }], error: null }; },
  from(){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: null, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((f) => { window.__fake = f; }, { session: SESSAO });
  const corpos = []; const planejamentos = []; const avisos = [];
  page.on('console', m => { if(/\[tema\]|\[contexto\]/.test(m.text())) avisos.push(m.text()); });
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(url.includes('supabase-js') || url.includes('jsdelivr')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(url.includes('/functions/v1/generate-question')){
      const body = route.request().postDataJSON() || {};
      if(body.planejarRecortes){ planejamentos.push(body); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planResp) }); }
      corpos.push(body);
      // Geração simulada só para a leva terminar; as questões reais virão da função de teste.
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fase B: geração não é feita aqui' }) });
    }
    if(url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('file://' + INDEX);
  await page.waitForTimeout(600);
  await page.evaluate((reservas) => {
    state.area = 'matematica'; state.disciplina = 'Matemática';
    document.querySelectorAll('.area-tile').forEach(t => t.classList.toggle('active', t.dataset.area === 'matematica'));
    setQty(10);
    state.questions.forEach(q => { q.tema = 'Exponenciação'; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; });
    // Mesmas reservas de domínio da fase A (o planejador real já recebeu esses domínios).
    window.__reservas = reservas;
    const original = planejaDominios;
    window.planejaDominios = function(){ original(); state.questions.forEach((q, i) => { q.dominio = reservas[i].dominio; q.dominioAlt = reservas[i].alt; }); };
  }, faseA.reservas);
  await page.evaluate(() => generateAll());
  await page.waitForTimeout(1500);
  const estado = await page.evaluate(() => ({ gabaritoPlan: state.gabaritoPlan, reservas: state.questions.map((q, i) => ({ n: i + 1, dominio: q.dominio, alt: q.dominioAlt, recorte: q.recorte, gabaritoAlvo: gabaritoAlvoDe(i) })) }));
  const saida = { planejamentoEnviado: planejamentos[0], corposGeracao: corpos, estado, avisosConsole: avisos };
  const dir = path.resolve(__dirname, 'saida'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fase_b_corpos.json'), JSON.stringify(saida, null, 1));
  console.log(JSON.stringify({ planejamentos: planejamentos.length, corpos: corpos.length, recortesComContexto: corpos.filter(b => /contexto:/.test(b.recorte || '')).length, gabaritos: estado.reservas.map(r => r.gabaritoAlvo).join(''), avisos }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
