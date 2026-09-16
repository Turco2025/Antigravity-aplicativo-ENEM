/* v18.6 / v74.5 — campo OPCIONAL "Orientações adicionais para a questão".
   O professor sugere enfoque/contextualização; o texto viaja como DADO subordinado a
   todas as regras e nunca altera diretrizes do Inep, Matriz de Referência, notação
   química ou matemática, regras dos agentes, critérios de elaboração/revisão do app,
   nem o uso das provas reais do ENEM como referência.
   Uso: node tests/verify_orientacoes.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const SES = { access_token: 't', user: { id: 'u', email: 'p@x.com' } };
const STUB = `window.supabase={createClient(){const f=window.__fake;return{auth:{onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',f.session),0);return{data:{subscription:{unsubscribe(){}}}}},async getSession(){return{data:{session:f.session}}},async signOut(){return{error:null}}},async rpc(){return{data:[{vinculado:false}],error:null}},from(){const q={select(){return q},order(){return q},eq(){return q},insert(){return q},update(){return q},upsert(){return q},single(){return Promise.resolve({data:{id:'s1'},error:null})},then(r){r({data:[],error:null})}};return q}}}};`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HINT = 'Campo opcional para sugerir o enfoque ou a contextualização da questão. As orientações serão consideradas somente quando compatíveis com as diretrizes do INEP, a Matriz de Referência e os padrões de elaboração do ENEM.';
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const erros = []; let corpos = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  await p.addInitScript(f => { window.__fake = f; }, { session: SES });
  await p.route('**/*', r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js') || u.includes('jsdelivr')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if(u.includes('/functions/v1/generate-question')){
      const bd = r.request().postDataJSON() || {};
      if(bd.planejarRecortes) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"recortes":[]}' });
      corpos.push(bd);
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

  // ---------- (A) a caixa existe, no lugar certo, com o texto exato ----------
  const A = await p.evaluate(() => {
    const ta = document.getElementById('loteOrientacoes');
    const tema = document.getElementById('loteTema');
    if(!ta || !tema) return { existe: false };
    const lbl = ta.previousElementSibling;
    const hint = ta.nextElementSibling;
    // a caixa vem DEPOIS do tema do lote, no mesmo painel
    const pos = tema.compareDocumentPosition(ta);
    return { existe: true, depoisDoTema: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING),
      mesmoPainel: tema.closest('.lote-panel') === ta.closest('.lote-panel'),
      rotulo: lbl ? lbl.textContent.trim() : '', hint: hint ? hint.textContent.trim() : '',
      // v18.14 — o professor pediu para tirar a mensagem de baixo da caixa DO LOTE;
      // a de cada questão, na seção 5, continua (ver bloco G).
      textoNoPainel: /Campo opcional para sugerir o enfoque/.test(ta.closest('.lote-panel').textContent),
      vazia: ta.value === '' };
  });
  ok(A.existe, 'A1 a caixa "Orientações adicionais" existe');
  ok(A.depoisDoTema && A.mesmoPainel, 'A2 fica logo abaixo do "Tema do lote", no mesmo painel', JSON.stringify(A));
  ok(/^Orientações adicionais para a questão/.test(A.rotulo) && /opcional/i.test(A.rotulo), 'A3 rótulo correto e marcado como opcional', A.rotulo);
  ok(A.textoNoPainel === false, 'A4 a mensagem explicativa NÃO aparece mais abaixo da caixa do lote (removida a pedido do professor)', A.hint);
  ok(A.vazia, 'A5 nasce vazia — é opcional');

  // ---------- (B) vazia: a geração segue normal e o campo vai vazio ----------
  corpos = [];
  await p.evaluate(() => { selectArea('natureza'); state.disciplina = 'Química'; renderDisciplinaChips(); setQty(3); });
  await p.fill('#loteTema', 'oxirredução');
  await p.click('#btnAplicarLote'); await sleep(200);
  await p.click('#btnGenerate');
  await p.waitForFunction(() => state.questions.length && state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 20000 });
  ok(corpos.length === 3 && corpos.every(c => c.orientacoes === ''), 'B1 caixa vazia: gera normalmente e manda orientacoes vazio', JSON.stringify(corpos.map(c => c.orientacoes)));

  // ---------- (C) preenchida: chega a TODAS as questões da leva ----------
  corpos = [];
  await p.click('#btnBackToForm'); await sleep(200);
  const TXT = 'Contextualize com uma situação do cotidiano; dê preferência a uma aplicação ambiental.';
  await p.fill('#loteOrientacoes', TXT);
  await p.click('#btnAplicarLote'); await sleep(200);
  const C0 = await p.evaluate(() => state.questions.map(q => q.orientacoes));
  ok(C0.length === 3 && C0.every(x => x === TXT), 'C1 "Aplicar" grava a orientação em todas as questões', JSON.stringify(C0));
  await p.click('#btnGenerate');
  await p.waitForFunction(() => state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 20000 });
  ok(corpos.length === 3 && corpos.every(c => c.orientacoes === TXT), 'C2 o texto viaja no corpo das 3 chamadas', JSON.stringify(corpos.map(c => (c.orientacoes || '').slice(0, 30))));

  // ---------- (D) teto de 600 caracteres ----------
  corpos = [];
  await p.click('#btnBackToForm'); await sleep(200);
  await p.fill('#loteOrientacoes', 'a'.repeat(900));
  await p.click('#btnAplicarLote'); await sleep(200);
  const D = await p.evaluate(() => state.questions[0].orientacoes.length);
  ok(D === 600, 'D1 o campo é cortado em 600 caracteres no app', 'tamanho=' + D);

  // ---------- (E) o campo não mexe em mais nada do corpo ----------
  await p.click('#btnGenerate');
  await p.waitForFunction(() => state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 20000 });
  const E = corpos[0] || {};
  ok(E.area === 'natureza' && E.disciplina === 'Química' && E.tema === 'oxirredução' && E.recurso === 'nenhum' && typeof E.gabaritoAlvo === 'string',
    'E1 área, disciplina, tema, recurso e gabarito continuam vindo do formulário, não do campo', JSON.stringify({ a: E.area, d: E.disciplina, t: E.tema, r: E.recurso, g: E.gabaritoAlvo }));

  // ---------- (G) v18.7: caixa em CADA bloco de questão, com orientação própria ----------
  await p.click('#btnBackToForm'); await sleep(200);
  await p.fill('#loteOrientacoes', '');
  await p.evaluate(() => { setQty(3); renderQuestionBlocks(); });
  const G0 = await p.evaluate(() => {
    const cx = document.querySelectorAll('#questionBlocks .in-orientacoes');
    const hints = [...document.querySelectorAll('#questionBlocks .in-orientacoes')].map(t => t.nextElementSibling.textContent.trim());
    const rots = [...document.querySelectorAll('#questionBlocks .in-orientacoes')].map(t => t.previousElementSibling.textContent.trim());
    return { quantas: cx.length, hints, rots };
  });
  ok(G0.quantas === 3, 'G1 cada bloco de questão tem a sua caixa de orientações', 'caixas=' + G0.quantas);
  ok(G0.hints.every(h => h === HINT), 'G2 a mesma mensagem aparece abaixo de cada caixa', JSON.stringify(G0.hints.map(h => h.slice(0, 40))));
  ok(G0.rots.every(r => /^Orientações adicionais para esta questão/.test(r) && /opcional/i.test(r)), 'G3 rótulo por questão correto', JSON.stringify(G0.rots));

  // orientação DIFERENTE em cada questão chega diferente ao backend
  corpos = [];
  await p.evaluate(() => {
    const cx = document.querySelectorAll('#questionBlocks .in-orientacoes');
    ['foco no cotidiano', 'foco ambiental', 'foco industrial'].forEach((t, i) => {
      cx[i].value = t; cx[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  const G1 = await p.evaluate(() => state.questions.map(q => q.orientacoes));
  ok(JSON.stringify(G1) === JSON.stringify(['foco no cotidiano', 'foco ambiental', 'foco industrial']), 'G4 cada questão guarda a SUA orientação', JSON.stringify(G1));
  await p.click('#btnGenerate');
  await p.waitForFunction(() => state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 20000 });
  const enviadas = corpos.map(c => c.orientacoes).sort();
  ok(JSON.stringify(enviadas) === JSON.stringify(['foco ambiental', 'foco industrial', 'foco no cotidiano']), 'G5 as três orientações distintas chegam ao backend, uma por questão', JSON.stringify(enviadas));

  // o "Aplicar" do lote sobrescreve todas (mesmo comportamento do tema)
  await p.click('#btnBackToForm'); await sleep(200);
  await p.fill('#loteOrientacoes', 'vale para a leva toda');
  await p.click('#btnAplicarLote'); await sleep(200);
  const G2 = await p.evaluate(() => state.questions.map(q => q.orientacoes));
  ok(G2.every(x => x === 'vale para a leva toda'), 'G6 "Aplicar" do lote sobrescreve a orientação de todas', JSON.stringify(G2));

  // teto de 600 também na caixa por questão
  await p.evaluate(() => {
    const c = document.querySelector('#questionBlocks .in-orientacoes');
    c.value = 'b'.repeat(900); c.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const G3 = await p.evaluate(() => state.questions[0].orientacoes.length);
  ok(G3 === 600, 'G7 a caixa por questão também corta em 600 caracteres', 'tamanho=' + G3);

  ok(erros.length === 0, 'F1 sem erros de JavaScript na página', JSON.stringify(erros));
  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
