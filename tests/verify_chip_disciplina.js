/* v18.10 — o chip de disciplina diz que está marcado sem depender da cor.

   Defeito relatado: na seção 2 (verde), o chip selecionado era pintado com o
   degradê var(--accent-a/b), que ali também é verde — a seleção sumia no fundo.
   Em Matemática, com uma disciplina só e já marcada, não havia nem um segundo
   chip para comparar: o professor clicava e nada parecia acontecer.

   Uso: node tests/verify_chip_disciplina.js <caminho absoluto do index.html> */
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
  await p.evaluate(() => { let n = document.querySelector('.card-step2'); while(n){ n.classList && n.classList.remove('hidden'); n = n.parentElement; } });

  const lê = () => p.evaluate(() => Array.from(document.querySelectorAll('#disciplinaChips .chip')).map(c => {
    const antes = getComputedStyle(c, '::before');
    const cs = getComputedStyle(c);
    return {
      texto: c.textContent, sel: c.classList.contains('sel'),
      aria: c.getAttribute('aria-pressed'), role: c.getAttribute('role'),
      tab: c.getAttribute('tabindex'), title: c.title,
      marca: (antes.content || '').replace(/"/g, ''),
      fundoMarca: antes.backgroundColor, peso: cs.fontWeight, anel: cs.boxShadow,
    };
  }));

  /* ---------- (A) área com uma disciplina só: o caso do relato ---------- */
  await p.evaluate(() => { state.area = 'matematica'; state.disciplina = AREA_META.matematica.disciplinas[0]; renderDisciplinaChips(); });
  const A = await lê();
  ok(A.length === 1 && A[0].texto === 'Matemática', 'A1 Matemática tem uma disciplina só — o caso em que não há com o que comparar', JSON.stringify(A.map(c => c.texto)));
  ok(A[0].sel === true, 'A2 o chip único entra marcado');
  ok(A[0].marca === '✓', 'A3 a marcação é dita por um ✓, não só pela cor', JSON.stringify(A[0].marca));
  ok(/rgb\(255,\s*255,\s*255\)/.test(A[0].fundoMarca), 'A4 o disco do ✓ é branco (contrasta com qualquer cor de cartão)', A[0].fundoMarca);
  ok(/inset/.test(A[0].anel), 'A5 o chip marcado ganha o anel branco interno', A[0].anel);
  ok(Number(A[0].peso) >= 700, 'A6 o rótulo do chip marcado fica em negrito', A[0].peso);
  ok(A[0].aria === 'true' && A[0].role === 'button' && A[0].tab === '0', 'A7 a marcação também é anunciada (role=button, aria-pressed=true) e o chip recebe foco', JSON.stringify(A[0]));
  ok(/selecionada/.test(A[0].title), 'A8 o title confirma a seleção ao passar o mouse', A[0].title);

  /* ---------- (B) marcado x não marcado são distinguíveis ---------- */
  await p.evaluate(() => { state.area = 'natureza'; state.disciplina = 'Biologia'; renderDisciplinaChips(); });
  const B = await lê();
  const sel = B.filter(c => c.sel), nao = B.filter(c => !c.sel);
  ok(B.length >= 3 && sel.length === 1, 'B1 numa área com várias disciplinas, só uma fica marcada', JSON.stringify(B.map(c => c.texto + ':' + c.sel)));
  ok(sel[0].marca === '✓' && nao.every(c => c.marca === '' || c.marca === 'none'), 'B2 só o marcado mostra o ✓; os demais mostram o círculo vazio', JSON.stringify(B.map(c => c.marca)));
  ok(nao.every(c => !/inset/.test(c.anel)), 'B3 os não marcados não têm o anel branco');
  ok(nao.every(c => c.aria === 'false'), 'B4 os não marcados anunciam aria-pressed="false"');
  ok(nao.every(c => /^Selecionar /.test(c.title)), 'B5 o title dos não marcados convida a selecionar', JSON.stringify(nao.map(c => c.title)));

  /* ---------- (C) clicar move a marcação ---------- */
  await p.evaluate(() => Array.from(document.querySelectorAll('#disciplinaChips .chip')).find(c => c.textContent === 'Química').click());
  await sleep(150);
  const C = await lê();
  ok(C.filter(c => c.sel).length === 1 && C.find(c => c.sel).texto === 'Química', 'C1 clicar em Química move a marcação para Química', JSON.stringify(C.map(c => c.texto + ':' + c.sel)));
  ok(C.find(c => c.texto === 'Química').marca === '✓' && C.find(c => c.texto === 'Biologia').marca !== '✓', 'C2 o ✓ acompanha o clique');
  ok(await p.evaluate(() => state.disciplina) === 'Química', 'C3 o estado do app acompanha o clique');

  /* ---------- (D) teclado ---------- */
  await p.evaluate(() => {
    const c = Array.from(document.querySelectorAll('#disciplinaChips .chip')).find(x => x.textContent === 'Física');
    c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(150);
  ok(await p.evaluate(() => state.disciplina) === 'Física', 'D1 Enter no chip seleciona (o chip é um botão de verdade)');
  await p.evaluate(() => {
    const c = Array.from(document.querySelectorAll('#disciplinaChips .chip')).find(x => x.textContent === 'Biologia');
    c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  await sleep(150);
  ok(await p.evaluate(() => state.disciplina) === 'Biologia', 'D2 Espaço no chip também seleciona');

  ok(erros.length === 0, 'E1 nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
