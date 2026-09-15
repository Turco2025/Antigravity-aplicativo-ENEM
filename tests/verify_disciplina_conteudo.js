/* v18.4 — a tela nunca mente sobre a área/disciplina, e o app não gera uma leva
   inteira de conteúdos de outra disciplina sem avisar.
   Origem: em 15/09/2026 sete conteúdos de Química (Radioatividade, Tabela Periódica,
   Modelos Atômicos, Funções Orgânicas, Esterificação/Saponificação, Propriedades
   Coligativas, Polímeros) foram gerados e cobrados como MATEMÁTICA. A tela mostrava
   "Ciências da Natureza · Química" e o estado guardava "matematica", porque
   "← Novo simulado" não redesenhava a grade de áreas nem os chips de disciplina.
   Uso: node tests/verify_disciplina_conteudo.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const SES = { access_token: 't', user: { id: 'u', email: 'p@x.com' } };
const STUB = `window.supabase={createClient(){const f=window.__fake;return{auth:{onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',f.session),0);return{data:{subscription:{unsubscribe(){}}}}},async getSession(){return{data:{session:f.session}}},async signOut(){return{error:null}}},async rpc(){return{data:[{vinculado:false}],error:null}},from(){const q={select(){return q},order(){return q},eq(){return q},insert(){return q},update(){return q},upsert(){return q},single(){return Promise.resolve({data:{id:'s1'},error:null})},then(r){r({data:[],error:null})}};return q}}}};`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUI = 'Radioatividade, Tabela Periódica, Modelos Atômicos, Funções Orgânicas, Reação de Esterificação ou Saponificação, Propriedades Coligativas, Polímeros';
const MAT = 'MDC, radiciação, exponenciação, progressão aritmética, juros compostos, probabilidade, geometria espacial';
const BIO = 'Genética mendeliana, Fotossíntese, Ecologia e ecossistemas, Citologia: mitose, Evolução e seleção natural, Sistema imunológico, Cadeia alimentar';
const MIX = 'Radioatividade, Tabela Periódica, juros compostos, Polímeros, probabilidade, Modelos Atômicos, Funções Orgânicas';
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = []; let chamadas = 0;
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  await p.addInitScript(f => { window.__fake = f; }, { session: SES });
  await p.route('**/*', r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js') || u.includes('jsdelivr')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if(u.includes('/functions/v1/generate-question')){
      const bd = r.request().postDataJSON() || {};
      if(bd.planejarRecortes) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"recortes":[]}' });
      chamadas++;
      const q = { area: bd.area, disciplina: bd.disciplina, tema: bd.tema, dificuldade: bd.dificuldade, recurso: 'nenhum', visual: null,
        competencia: { numero: 1, texto: 'C' }, habilidade: { codigo: 'H1', texto: 'H' }, objetoConhecimento: 'X',
        textoBase: 't', comando: 'c', alternativas: { A: '1', B: '2', C: '3', D: '4', E: '5' }, gabarito: 'C', resolucaoComentada: 'r',
        analiseAlternativas: Object.fromEntries(['A','B','C','D','E'].map(L => [L, { status: L === 'C' ? 'correta' : 'incorreta', comentario: 'x' }])) };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ question: q, uso: { chamadas: 1, entradaNova: 1, cacheEscrito: 0, cacheLido: 0, saida: 1 } }) });
    }
    if(u.includes('/functions/v1/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.fulfill({ status: 204, body: '' });
  });
  await p.goto('file://' + INDEX); await sleep(600);
  await p.evaluate(() => { window.__toasts = []; const o = toast; window.toast = (m, k) => { window.__toasts.push({ k, m: String(m) }); return o(m, k); }; });
  const toasts = () => p.evaluate(() => window.__toasts.map(x => x.m));
  const prep = async (area, disc, lista) => {
    if(await p.isVisible('#btnBackToForm')){ await p.click('#btnBackToForm'); await sleep(200); }
    await p.evaluate(({ a, d }) => { selectArea(a); state.disciplina = d; renderDisciplinaChips(); setQty(7); confirmaDisciplinaEm = 0; }, { a: area, d: disc });
    await p.fill('#loteTema', lista); await p.click('#btnAplicarLote'); await sleep(200);
    await p.evaluate(() => { window.__toasts = []; });
  };
  const pronto = () => p.waitForFunction(() => state.questions.length && state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 20000 });

  // ---------- (A) a tela acompanha o estado ao voltar de um simulado arquivado ----------
  await p.evaluate(() => { selectArea('natureza'); state.disciplina = 'Química'; renderDisciplinaChips(); });
  await p.evaluate(() => {
    state.area = 'matematica'; state.disciplina = 'Matemática'; state.qty = 1;
    state.questions = [{ id: 'q1', tema: 'MDC', dificuldade: 'Médio', recurso: 'nenhum', status: 'done', data: { tema: 'MDC', alternativas: { A: '1', B: '2', C: '3', D: '4', E: '5' }, gabarito: 'A' } }];
    document.getElementById('formPanel').style.display = 'none';
    document.getElementById('resultsPanel').style.display = 'block';
    renderResults(); updateProgress();
  });
  await p.click('#btnBackToForm'); await sleep(300);
  const A = await p.evaluate(() => ({ area: state.area, disc: state.disciplina,
    tile: (document.querySelector('.area-tile.sel') || {}).dataset && document.querySelector('.area-tile.sel').dataset.area,
    chip: (document.querySelector('#disciplinaChips .chip.sel') || {}).textContent }));
  ok(A.area === A.tile && A.disc === A.chip, 'A1 "← Novo simulado": grade e chips mostram a MESMA área/disciplina do estado', JSON.stringify(A));

  // ---------- (B) o caso real: 7 de Química com Matemática selecionada ----------
  chamadas = 0; await prep('matematica', 'Matemática', QUI);
  await p.click('#btnGenerate'); await sleep(700);
  let T = await toasts();
  ok(chamadas === 0, 'B1 primeiro clique NÃO gera nada (nenhuma chamada paga)', 'chamadas=' + chamadas);
  ok(T.some(x => /selecionou Matemática/.test(x) && /Química/.test(x)), 'B2 o aviso nomeia a disciplina escolhida e a que os conteúdos parecem ser', JSON.stringify(T));
  await p.evaluate(() => { window.__toasts = []; });
  await p.click('#btnGenerate'); await pronto();
  ok(chamadas === 7, 'B3 o segundo clique gera assim mesmo — o professor decide', 'chamadas=' + chamadas);

  // ---------- (C) nenhum falso positivo ----------
  for(const [rot, area, disc, lista] of [['C1 Matemática', 'matematica', 'Matemática', MAT], ['C2 Química', 'natureza', 'Química', QUI], ['C3 Biologia', 'natureza', 'Biologia', BIO]]){
    chamadas = 0; await prep(area, disc, lista);
    await p.click('#btnGenerate'); await sleep(600);
    T = await toasts();
    ok(!T.some(x => /selecionou/.test(x)), rot + ': conteúdos da própria disciplina não disparam aviso', JSON.stringify(T.filter(x => /selecionou/.test(x))));
    await pronto();
    ok(chamadas === 7, rot + ': gerou direto as 7', 'chamadas=' + chamadas);
  }

  // ---------- (D) lista mista não acusa (basta UM conteúdo da disciplina escolhida) ----------
  chamadas = 0; await prep('matematica', 'Matemática', MIX);
  await p.click('#btnGenerate'); await sleep(600);
  T = await toasts();
  ok(!T.some(x => /selecionou/.test(x)), 'D1 lista mista (juros e probabilidade entre conteúdos de Química) não acusa', JSON.stringify(T.filter(x => /selecionou/.test(x))));
  await pronto();

  // ---------- (E) disciplina sem marcadores nunca acusa ----------
  chamadas = 0; await prep('humanas', 'História', QUI);
  await p.click('#btnGenerate'); await sleep(600);
  T = await toasts();
  ok(!T.some(x => /selecionou/.test(x)), 'E1 disciplina sem marcadores (História) nunca acusa — ausência de marcador não é erro', JSON.stringify(T.filter(x => /selecionou/.test(x))));

  ok(erros.length === 0, 'F1 sem erros de JavaScript na página', JSON.stringify(erros));
  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
