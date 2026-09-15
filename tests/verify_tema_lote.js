// v17.1 (+ v18: textos SEM vírgula, porque a vírgula passou a separar conteúdos — ver verify_lote_itens.js) — "Tema do lote" × tema das questões (leva 1eb71207, 14/09/2026): o que vai à IA é o
// tema guardado em cada questão; a caixa do lote só valia ao clicar em "Aplicar". Agora, ao
// clicar em "Gerar": (1) caixa com texto e questões sem tema → o texto vale para todas;
// (2) caixa editada depois de "Aplicar" (todas as questões ainda com o tema antigo) → o texto
// novo vale para todas; (3) questões ajustadas uma a uma → nada muda; (4) caixa vazia → nada
// muda; (5) o cabeçalho dos resultados mostra o tema pedido; (6) o aviso de "Aplicar" ecoa o tema.
// Uso: node tests/verify_tema_lote.js [caminho/para/index.html]
const { chromium } = require('playwright');
const path = require('path');

const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB_SUPABASE = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(){ return { data: [{ vinculado: false }], error: null }; },
  from(tabela){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: (tabela === 'simulados' && f.simulado) ? f.simulado : { id: 'sim-teste', nome: 'Simulado de teste' }, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;

let total = 0, falhas = 0;
function ok(cond, msg, extra){ if(cond){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  await page.addInitScript((f) => { window.__fake = f; }, { session: SESSAO });

  let corpos = [], planejamentos = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(url.includes('supabase-js') || url.includes('jsdelivr') || url.includes('unpkg')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(url.includes('/functions/v1/generate-question')){
      const body = route.request().postDataJSON() || {};
      if(body.planejarRecortes){
        planejamentos.push(body);
        const recortes = Array.from({ length: body.quantidade }, (_, i) => ({ conteudo: `conteúdo ${i + 1} de ${body.tema}`, contexto: `contexto ${i + 1}`, habilidade: 'H1: Teste' }));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recortes, uso: { chamadas: 1 } }) });
      }
      corpos.push(body);
      const q = { area: body.area, disciplina: body.disciplina, tema: `Entregue: ${body.tema || '(sem tema)'} #${corpos.length}`, dificuldade: 'Médio', recurso: 'nenhum', visual: null,
        competencia: { numero: 1, texto: 'C' }, habilidade: { codigo: 'H1', texto: 'H' }, objetoConhecimento: 'Conhecimentos numéricos',
        textoBase: `Cenário ${corpos.length}. Fonte, 2024.`, comando: 'Comando.', alternativas: { A: '1', B: '2', C: '3', D: '4', E: '5' }, gabarito: body.gabaritoAlvo || 'C', resolucaoComentada: 'R.',
        analiseAlternativas: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(L => [L, { status: L === (body.gabaritoAlvo || 'C') ? 'correta' : 'incorreta', comentario: 'x' }])) };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ question: q, uso: { chamadas: 1, entradaNova: 10, cacheEscrito: 0, cacheLido: 0, saida: 5 } }) });
    }
    if(url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('file://' + INDEX);
  await sleep(600);
  await page.evaluate(() => {
    window.__toasts = [];
    const t = toast; window.toast = function(msg, tipo){ window.__toasts.push({ tipo, msg: String(msg) }); return t(msg, tipo); };
    state.area = 'matematica'; state.disciplina = 'Matemática';
    document.querySelectorAll('.area-tile').forEach(t => t.classList.toggle('active', t.dataset.area === 'matematica'));
    setQty(3);
    state.questions.forEach(q => { q.tema = ''; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; });
    renderQuestionBlocks();
  });
  const gerar = async () => {
    corpos = []; planejamentos = [];
    await page.evaluate(() => { window.__toasts = []; });
    await page.click('#btnGenerate');
    await page.waitForFunction(() => state.questions.length && state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 15000 });
    await sleep(300);
    return page.evaluate(() => ({ temas: state.questions.map(q => q.tema), toasts: window.__toasts.map(t => t.msg), resumo: document.getElementById('resultsSummary').textContent, blocos: Array.from(document.querySelectorAll('.in-tema')).map(e => e.value) }));
  };
  const voltar = async () => { await page.click('#btnBackToForm'); await sleep(200); };
  const TEMA_A = 'Grandezas inversamente proporcionais e escala';
  const TEMA_B = 'Grandezas inversamente proporcionais e escala com Radiciação';

  // (1) caixa preenchida, sem clicar em "Aplicar", questões sem tema → o texto vale para todas
  await page.fill('#loteTema', TEMA_A);
  let r = await gerar();
  ok(r.temas.every(t => t === TEMA_A) && corpos.length === 3 && corpos.every(b => b.tema === TEMA_A) && planejamentos.length === 1 && planejamentos[0].tema === TEMA_A, '1 caixa do lote preenchida sem "Aplicar": as 3 questões e o planejamento recebem o tema da caixa', JSON.stringify({ temas: r.temas, corpos: corpos.map(b => b.tema), plan: planejamentos.map(p => p.tema) }));
  ok(r.toasts.some(m => /Tema do lote aplicado às 3 questões/.test(m) && m.includes(TEMA_A)), '1b aviso "Tema do lote aplicado" com o texto', JSON.stringify(r.toasts));
  ok(r.resumo.includes(`tema pedido: "${TEMA_A}"`), '5 cabeçalho dos resultados mostra o tema pedido', r.resumo);
  await voltar();

  // (2) "Aplicar" com TEMA_B, depois a caixa é editada para TEMA_A (sem "Aplicar") → gerar usa TEMA_A
  await page.fill('#loteTema', TEMA_B);
  await page.evaluate(() => { window.__toasts = []; });
  await page.click('#btnAplicarLote');
  await sleep(200);
  const aplicou = await page.evaluate(() => ({ temas: state.questions.map(q => q.tema), toasts: window.__toasts.map(t => t.msg) }));
  ok(aplicou.temas.every(t => t === TEMA_B) && aplicou.toasts.some(m => /Configuração aplicada às 3 questões/.test(m) && m.includes('Radiciação')), '6 "Aplicar" copia o tema para as 3 questões e o aviso ecoa o tema (com "Radiciação")', JSON.stringify(aplicou));
  await page.fill('#loteTema', TEMA_A);
  r = await gerar();
  ok(r.temas.every(t => t === TEMA_A) && corpos.every(b => b.tema === TEMA_A) && !corpos.some(b => /Radiciação/.test(b.tema)) && r.blocos.every(v => v === TEMA_A), '2 caixa editada depois de "Aplicar" (todas com o tema antigo): o texto novo vale para todas — "Radiciação" não vai à IA; blocos atualizados', JSON.stringify({ temas: r.temas, corpos: corpos.map(b => b.tema), blocos: r.blocos }));
  ok(r.toasts.some(m => /Tema do lote atualizado nas 3 questões: "Grandezas inversamente proporcionais e escala com Radiciação" → "/.test(m) && m.includes(TEMA_A)), '2b aviso "Tema do lote atualizado" mostra o tema anterior → o novo', JSON.stringify(r.toasts));
  await voltar();

  // (3) questões ajustadas uma a uma (temas diferentes) → a caixa não mexe em nada
  await page.evaluate(() => { state.questions[1].tema = 'Escala em plantas baixas'; renderQuestionBlocks(); });
  await page.fill('#loteTema', TEMA_B);
  r = await gerar();
  ok(r.temas[0] === TEMA_A && r.temas[1] === 'Escala em plantas baixas' && r.temas[2] === TEMA_A && corpos.every(b => !/Radiciação/.test(b.tema)) && r.toasts.some(m => /temas diferentes entre si/.test(m)), '3 questões ajustadas uma a uma: a caixa (com "Radiciação") não sobrescreve nada e o aviso explica por quê', JSON.stringify({ temas: r.temas, toasts: r.toasts }));
  ok(!r.resumo.includes('tema pedido'), '5b sem tema comum o cabeçalho não mostra "tema pedido"', r.resumo);
  await voltar();

  // (4) caixa vazia → questões mantêm o tema
  await page.evaluate(() => { state.questions.forEach(q => { q.tema = 'Porcentagem e juros'; }); renderQuestionBlocks(); });
  await page.fill('#loteTema', '');
  r = await gerar();
  ok(r.temas.every(t => t === 'Porcentagem e juros') && corpos.every(b => b.tema === 'Porcentagem e juros') && !r.toasts.some(m => /Tema do lote/.test(m)), '4 caixa vazia: as questões mantêm o tema e não há aviso', JSON.stringify({ temas: r.temas, toasts: r.toasts }));
  await voltar();

  // (4b) caixa igual ao tema das questões → nada acontece (sem aviso)
  await page.fill('#loteTema', 'Porcentagem e juros');
  r = await gerar();
  ok(r.temas.every(t => t === 'Porcentagem e juros') && !r.toasts.some(m => /Tema do lote/.test(m)), '4b caixa igual ao tema das questões: sem aviso', JSON.stringify(r.toasts));

  // (7) caixa ainda com o texto do último "Aplicar", mas as questões vieram com outro tema (ex.: simulado reaberto) → questões mandam
  await voltar();
  await page.fill('#loteTema', TEMA_B);
  await page.click('#btnAplicarLote');
  await sleep(200);
  await page.evaluate(() => { state.questions.forEach(q => { q.tema = 'Exponenciação'; }); renderQuestionBlocks(); });
  r = await gerar();
  ok(r.temas.every(t => t === 'Exponenciação') && corpos.every(b => b.tema === 'Exponenciação') && !r.toasts.some(m => /Tema do lote/.test(m)), '7 caixa igual ao último "Aplicar" e questões com outro tema (simulado reaberto): as questões mandam, sem aviso', JSON.stringify({ temas: r.temas, toasts: r.toasts }));
  await voltar();
  // (7b) …e se a caixa for editada de novo, volta a valer para todas
  await page.fill('#loteTema', TEMA_A);
  r = await gerar();
  ok(r.temas.every(t => t === TEMA_A) && r.toasts.some(m => /Tema do lote atualizado/.test(m)), '7b caixa editada de novo: volta a valer para todas', JSON.stringify({ temas: r.temas, toasts: r.toasts }));

  // (8) P3: reabrir um simulado salvo alinha a caixa do lote ao tema dele; um texto antigo na caixa não vence
  await voltar();
  await page.fill('#loteTema', 'texto antigo esquecido na caixa');
  const SIM = { id: 'sim-x', nome: 'Sim X', area: 'matematica', disciplina: 'Matemática', validacao_dupla: false,
    dados: { area: 'matematica', disciplina: 'Matemática', qty: 3, gabaritoPlan: ['A', 'B', 'C'], questions: [1, 2, 3].map(i => ({ id: 'r' + i, status: 'done', recurso: 'nenhum', dificuldade: 'Médio', tema: 'Exponenciação', data: { area: 'matematica', disciplina: 'Matemática', tema: 'Exponenciação — q' + i, dificuldade: 'Médio', recurso: 'nenhum', visual: null, competencia: { numero: 1, texto: 'C' }, habilidade: { codigo: 'H1', texto: 'H' }, objetoConhecimento: 'Conhecimentos numéricos', textoBase: 'Texto ' + i + '. Fonte, 2024.', comando: 'Comando.', alternativas: { A: '1', B: '2', C: '3', D: '4', E: '5' }, gabarito: 'ABC'[i - 1], resolucaoComentada: 'R.', analiseAlternativas: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(L => [L, { status: L === 'ABC'[i - 1] ? 'correta' : 'incorreta', comentario: 'x' }])) } })) } };
  await page.evaluate((sim) => { window.__fake.simulado = sim; }, SIM);
  await page.evaluate(() => abrirSimuladoSalvo('sim-x'));
  await sleep(500);
  const caixaApos = await page.evaluate(() => document.getElementById('loteTema').value);
  ok(caixaApos === 'Exponenciação', '8 reabrir simulado salvo: a caixa do lote passa a mostrar o tema dele', JSON.stringify(caixaApos));
  await voltar();
  r = await gerar();
  ok(r.temas.every(t => t === 'Exponenciação') && corpos.every(b => b.tema === 'Exponenciação') && !r.toasts.some(m => /Tema do lote/.test(m)), '8b "Novo simulado" + "Gerar" depois de reabrir: as questões mantêm o tema do simulado, sem aviso', JSON.stringify({ temas: r.temas, toasts: r.toasts }));
  await voltar();
  await page.evaluate(() => { window.__fake.simulado = null; });

  // (9) P1: questões ajustadas uma a uma E caixa editada → nada muda, mas avisa
  await page.fill('#loteTema', TEMA_B);
  await page.click('#btnAplicarLote');
  await sleep(200);
  await page.evaluate(() => { state.questions[1].tema = 'Escala em plantas baixas'; renderQuestionBlocks(); });
  await page.fill('#loteTema', TEMA_A);
  r = await gerar();
  ok(r.temas[0] === TEMA_B && r.temas[1] === 'Escala em plantas baixas' && r.temas[2] === TEMA_B && r.toasts.some(m => /temas diferentes entre si/.test(m) && /nenhuma foi alterada/.test(m)), '9 caixa editada com questões ajustadas uma a uma: nada muda e o aviso explica', JSON.stringify({ temas: r.temas, toasts: r.toasts }));
  await voltar();

  // (10) P4: tema com caracteres especiais aparece intacto nos blocos (escapeHtml) e não gera aviso em loop
  const TEMA_ESP = 'Potenciação & Radiciação "MMC" < MDC > 5 (1,5)';
  await page.fill('#loteTema', TEMA_ESP);
  await page.click('#btnAplicarLote');
  await sleep(200);
  const blocosEsp = await page.evaluate(() => ({ blocos: Array.from(document.querySelectorAll('.in-tema')).map(e => e.value), temas: state.questions.map(q => q.tema), xss: !!window.__xss }));
  ok(blocosEsp.blocos.every(v => v === TEMA_ESP) && blocosEsp.temas.every(t => t === TEMA_ESP), '10 tema com &, <, >, aspas e vírgula decimal: blocos mostram o texto intacto (um item só)', JSON.stringify(blocosEsp));
  await page.evaluate(() => { state.questions[0].tema = '</textarea><img src=x onerror="window.__xss=1">'; renderQuestionBlocks(); });
  await sleep(300);
  const xss = await page.evaluate(() => ({ xss: !!window.__xss, valor: document.querySelectorAll('.in-tema')[0].value }));
  ok(xss.xss === false && xss.valor === '</textarea><img src=x onerror="window.__xss=1">', '10b tema com HTML não executa nada e aparece literal no bloco (escapeHtml)', JSON.stringify(xss));
  await page.evaluate(() => { state.questions[0].tema = state.questions[1].tema; renderQuestionBlocks(); });
  r = await gerar();
  ok(r.temas.every(t => t === TEMA_ESP) && !r.toasts.some(m => /Tema do lote/.test(m)), '10c gerar com a caixa igual ao aplicado: sem aviso', JSON.stringify(r.toasts));
  await voltar();
  r = await gerar();
  ok(!r.toasts.some(m => /Tema do lote/.test(m)), '10d segunda geração com a mesma caixa: sem aviso (sem loop)', JSON.stringify(r.toasts));

  const errosReais = erros.filter(e => !/favicon|net::ERR|Failed to load resource|supabase/i.test(e));
  ok(errosReais.length === 0, 'Z sem erros de JavaScript no console', errosReais.join('\n     '));

  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await browser.close();
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
