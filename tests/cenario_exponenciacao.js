// Cenário pedido pelo professor (14/09/2026): 10 questões de Matemática com o tema
// "Exponenciação". Roda o app v17 REAL no Chromium sem rede, com um backend simulado que
// registra os corpos, e imprime: o corpo do planejamento (com os 10 domínios), os 10 corpos
// de geração (recorte, domínio, listas) e as reservas feitas. Não gasta nada.
// Uso: node tests/cenario_exponenciacao.js [index.html]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB_SUPABASE = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(){ return { data: [{ vinculado: false }], error: null }; },
  from(){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: null, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((f) => { window.__fake = f; }, { session: SESSAO });
  const corpos = [], planejamentos = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(url.includes('supabase-js') || url.includes('jsdelivr')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(url.includes('/functions/v1/generate-question')){
      const body = route.request().postDataJSON() || {};
      if(body.planejarRecortes){
        planejamentos.push(body);
        // Planejador simulado: um recorte por questão, contexto dentro do domínio reservado
        const recortes = Array.from({ length: body.quantidade }, (_, i) => ({ conteudo: ['propriedades das potências', 'potência de expoente negativo', 'notação científica', 'equação exponencial', 'crescimento exponencial', 'decaimento (meia-vida)', 'juros compostos', 'potência de base fracionária', 'comparação de potências', 'função exponencial e gráfico'][i % 10], contexto: `situação em ${body.dominios[i]}`, habilidade: 'H21: Resolver situação-problema cuja modelagem envolva conhecimentos algébricos.' }));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recortes, uso: { chamadas: 1 } }) });
      }
      corpos.push(body);
      const n = corpos.length;
      const q = { area: 'matematica', disciplina: 'Matemática', tema: `Exponenciação — ${(body.recorte || '').split(' · ')[0].replace('conteúdo: ', '')}`, dificuldade: body.dificuldade, recurso: 'nenhum', visual: null,
        competencia: { numero: 5, texto: 'C5' }, habilidade: { codigo: 'H21', texto: 'H21' }, objetoConhecimento: 'Conhecimentos algébricos',
        textoBase: `Texto-base nº ${n} ambientado em ${body.dominioContexto}.`, comando: 'Comando.', alternativas: { A: '1', B: '2', C: '3', D: '4', E: '5' }, gabarito: body.gabaritoAlvo || 'C', resolucaoComentada: 'R.',
        analiseAlternativas: { A: { status: 'incorreta', comentario: 'x' }, B: { status: 'incorreta', comentario: 'x' }, C: { status: 'correta', comentario: 'x' }, D: { status: 'incorreta', comentario: 'x' }, E: { status: 'incorreta', comentario: 'x' } } };
      if(q.gabarito !== 'C'){ q.analiseAlternativas.C.status = 'incorreta'; q.analiseAlternativas[q.gabarito].status = 'correta'; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ question: q, uso: { chamadas: 1 } }) });
    }
    if(url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('file://' + INDEX);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    state.area = 'matematica'; state.disciplina = 'Matemática';
    document.querySelectorAll('.area-tile').forEach(t => t.classList.toggle('active', t.dataset.area === 'matematica'));
    setQty(10);
    state.questions.forEach(q => { q.tema = 'Exponenciação'; q.recurso = 'nenhum'; });
  });
  await page.evaluate(() => generateAll());
  await page.waitForTimeout(800);
  const reservas = await page.evaluate(() => state.questions.map((q, i) => ({ n: i + 1, tema: q.tema, eixo: q.eixoTematico, subtopico: q.subtopico, dominio: q.dominio, alt: q.dominioAlt, recorte: q.recorte, status: q.status, temaEntregue: q.data && q.data.tema })));
  const auditoria = await page.evaluate(() => ({ contextos: auditaDiversidadeContextos(), temas: auditaDiversidadeTemas(), gabaritos: state.questions.map(q => q.data && q.data.gabarito).join('') }));
  const saida = { planejamentos, corpos, reservas, auditoria };
  fs.mkdirSync(path.resolve(__dirname, 'saida'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, 'saida', 'cenario_exponenciacao_corpos.json'), JSON.stringify(saida, null, 1));
  console.log(JSON.stringify({
    chamadasPlanejamento: planejamentos.length, dominiosNoPlanejamento: planejamentos[0] && planejamentos[0].dominios,
    chamadasGeracao: corpos.length,
    corposResumo: corpos.map((b, i) => ({ q: i + 1, tema: b.tema, recorte: b.recorte, dominio: b.dominioContexto, alt: b.dominioAlternativo, subtopico: b.subtopico, eixo: b.eixoTematico, temasEvitar: b.temasEvitar.length, dominiosEvitar: b.dominiosEvitar.length, contextosEvitar: b.contextosEvitar.length, gabaritoAlvo: b.gabaritoAlvo })),
    dominiosDistintos: new Set(corpos.map(b => b.dominioContexto)).size,
    auditoria,
  }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
