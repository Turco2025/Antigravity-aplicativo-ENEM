/* v18.11 — o botão "Gerar simulado" também dentro da seção 4.

   Pedido do professor: não ter de descer a página inteira depois de configurar
   o lote. A regra que este teste protege é que NÃO existe um segundo caminho de
   geração: os dois botões chamam a mesma função (iniciarGeracao), então se
   comportam igual hoje e depois de qualquer mudança.

   Uso: node tests/verify_gerar_no_lote.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STUB = `window.supabase={createClient(){return{auth:{onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',null),0);return{data:{subscription:{unsubscribe(){}}}}},async getSession(){return{data:{session:null}}},async signOut(){return{error:null}}},async rpc(){return{data:null,error:null}},from(){const q={select(){return q},order(){return q},eq(){return q},insert(){return q},update(){return q},upsert(){return q},single(){return Promise.resolve({data:null,error:null})},then(r){r({data:[],error:null})}};return q}}}};`;
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  await p.route('**/*', r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js') || u.includes('jsdelivr')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return r.fulfill({ status: 204, body: '' });
  });
  await p.goto('file://' + INDEX); await sleep(500);

  /* ---------- (A) o botão existe, no lugar certo ---------- */
  const A = await p.evaluate(() => {
    const btn = document.getElementById('btnGerarLote');
    const sec6 = document.getElementById('btnGenerate');
    return {
      existe: !!btn,
      dentroDaSecao4: !!(btn && btn.closest('.card-step4')),
      dentroDoPainel: !!(btn && btn.closest('#lotePanel')),
      aoLadoDoAplicar: !!(btn && btn.parentElement === document.getElementById('btnAplicarLote').parentElement),
      texto: btn ? btn.textContent.trim() : '',
      sec6Existe: !!sec6, sec6NaSecao6: !!(sec6 && sec6.closest('.card-step6')),
      antesDaSecao5: !!(btn && (btn.closest('.card-step4').compareDocumentPosition(document.querySelector('.card-step5')) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  });
  ok(A.existe, 'A1 o botão "Gerar simulado" existe');
  ok(A.dentroDaSecao4 && A.dentroDoPainel, 'A2 ele está dentro da seção 4 (painel do lote), não em outro cartão');
  ok(A.aoLadoDoAplicar, 'A3 fica na mesma linha do "Aplicar às N questões"');
  ok(/Gerar simulado/.test(A.texto), 'A4 o rótulo diz "Gerar simulado"', A.texto);
  ok(A.antesDaSecao5, 'A5 está acima da seção 5 — é o atalho que evita descer a página');
  ok(A.sec6Existe && A.sec6NaSecao6, 'A6 o botão da seção 6 continua onde estava');

  /* ---------- (B) caminho único de geração ---------- */
  const B = await p.evaluate(() => {
    const chamadas = [];
    const orig = window.generateAll;
    window.generateAll = async function(){ chamadas.push('generateAll'); };
    window.__restaura = () => { window.generateAll = orig; };
    return { temIniciar: typeof iniciarGeracao === 'function', chamadas };
  });
  ok(B.temIniciar, 'B1 existe uma função nomeada iniciarGeracao (a lógica não vive dentro do listener)');

  const B2 = await p.evaluate(async () => {
    // estado mínimo válido, sem exigir login
    window.exigirLogin = () => true;
    state.area = 'matematica'; state.disciplina = 'Matemática';
    setQty(3);
    document.getElementById('loteTema').value = 'MDC';
    document.getElementById('loteOrientacoes').value = '';
    const chamadas = [];
    const orig = window.generateAll;
    window.generateAll = async () => { chamadas.push(1); };
    document.getElementById('btnGerarLote').click();
    const doLote = chamadas.length;
    chamadas.length = 0;
    document.getElementById('btnGenerate').click();
    const daSecao6 = chamadas.length;
    window.generateAll = orig;
    return { doLote, daSecao6 };
  });
  ok(B2.doLote === 1, 'B2 o botão da seção 4 dispara a geração', JSON.stringify(B2));
  ok(B2.daSecao6 === 1, 'B3 o botão da seção 6 dispara a geração', JSON.stringify(B2));

  /* ---------- (C) orientações digitadas e não aplicadas ---------- */
  const C = await p.evaluate(async () => {
    window.exigirLogin = () => true;
    state.area = 'matematica'; state.disciplina = 'Matemática';
    setQty(3);
    document.getElementById('loteTema').value = 'MDC';
    document.getElementById('loteOrientacoes').value = 'Contextualize com uma situação do cotidiano';
    state.questions.forEach(q => q.orientacoes = '');
    const chamadas = [];
    const orig = window.generateAll;
    window.generateAll = async () => { chamadas.push(1); };
    const pendenteAntes = orientacoesDoLotePendentes();
    document.getElementById('btnGerarLote').click();
    const primeiro = chamadas.length;                 // deve ser 0: só avisa
    document.getElementById('btnGerarLote').click();
    const segundo = chamadas.length;                  // deve ser 1: gera assim mesmo
    // agora com as orientações aplicadas: nenhum aviso
    chamadas.length = 0;
    state.questions.forEach(q => q.orientacoes = 'Contextualize com uma situação do cotidiano');
    const pendenteDepois = orientacoesDoLotePendentes();
    confirmaOrientacoesEm = 0;
    document.getElementById('btnGerarLote').click();
    const aplicado = chamadas.length;
    // caixa vazia nunca acusa
    document.getElementById('loteOrientacoes').value = '';
    const pendenteVazio = orientacoesDoLotePendentes();
    window.generateAll = orig;
    return { pendenteAntes, primeiro, segundo, pendenteDepois, aplicado, pendenteVazio };
  });
  ok(C.pendenteAntes === true, 'C1 texto digitado e não aplicado é detectado como pendente');
  ok(C.primeiro === 0, 'C2 o primeiro clique NÃO gera — avisa que o texto não iria para a IA', JSON.stringify(C));
  ok(C.segundo === 1, 'C3 o segundo clique gera assim mesmo (o professor decide)', JSON.stringify(C));
  ok(C.pendenteDepois === false && C.aplicado === 1, 'C4 com as orientações já aplicadas, gera direto, sem aviso', JSON.stringify(C));
  ok(C.pendenteVazio === false, 'C5 caixa vazia nunca acusa pendência');

  /* ---------- (D) as travas antigas continuam valendo nos dois botões ---------- */
  const D = await p.evaluate(async () => {
    const orig = window.generateAll;
    const chamadas = [];
    window.generateAll = async () => { chamadas.push(1); };
    window.exigirLogin = () => true;
    document.getElementById('loteOrientacoes').value = '';
    const r = {};
    state.area = null; state.disciplina = null;
    document.getElementById('btnGerarLote').click(); r.semArea = chamadas.length;
    state.area = 'matematica'; state.disciplina = null;
    document.getElementById('btnGerarLote').click(); r.semDisciplina = chamadas.length;
    window.exigirLogin = () => false;
    state.disciplina = 'Matemática';
    document.getElementById('btnGerarLote').click(); r.semLogin = chamadas.length;
    window.generateAll = orig;
    return r;
  });
  ok(D.semArea === 0, 'D1 sem área selecionada o atalho não gera');
  ok(D.semDisciplina === 0, 'D2 sem disciplina selecionada o atalho não gera');
  ok(D.semLogin === 0, 'D3 sem login o atalho não gera (mesma trava do botão da seção 6)');

  ok(erros.length === 0, 'E1 nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
