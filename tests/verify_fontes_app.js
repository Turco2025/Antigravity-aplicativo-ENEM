/* v18.17 — TRAVA DE ENTREGA POR FONTE NÃO VERIFICADA.

   Regra do professor (v74.8 no backend): "Qualquer falha deve bloquear a
   liberação da questão até sua correção." Este teste prova que, marcada a
   questão pelo backend, ela NÃO sai em PDF, Word, impressão nem HTML, e que a
   mensagem mostrada é a literal exigida por ele.

   Uso: node tests/verify_fontes_app.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STUB = `window.supabase={createClient(){return{auth:{onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',null),0);return{data:{subscription:{unsubscribe(){}}}}},async getSession(){return{data:{session:null}}},async signOut(){return{error:null}}},async rpc(){return{data:null,error:null}},from(){const q={select(){return q},order(){return q},eq(){return q},insert(){return q},update(){return q},upsert(){return q},single(){return Promise.resolve({data:null,error:null})},then(r){r({data:[],error:null})}};return q}}}};`;
const MSG = "Não foi possível verificar uma fonte real para o autor ou a obra solicitada. Envie o texto ou uma referência confiável para continuar.";
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

  /* ---------- (A) a mensagem é a literal do professor ---------- */
  const msgApp = await p.evaluate(() => typeof MENSAGEM_FONTE_BLOQUEIO === 'string' ? MENSAGEM_FONTE_BLOQUEIO : null);
  ok(msgApp === MSG, 'A1 o app usa EXATAMENTE a mensagem que o professor escreveu', JSON.stringify(msgApp));
  ok(await p.evaluate(() => typeof bloqueiaSeFonteNaoVerificada === 'function'),
     'A2 a trava de entrega existe no app');

  /* ---------- (B) a trava bloqueia, e só quando deve ---------- */
  const monta = (comMarca) => p.evaluate((m) => {
    const q = {
      status: 'done',
      data: {
        area: 'linguagens', disciplina: 'Literatura', tema: 't',
        textoBase: 'tb', comando: 'cmd', gabarito: 'B',
        alternativas: { A: 'aa', B: 'bb', C: 'cc', D: 'dd', E: 'ee' },
        analiseAlternativas: { A: { status: 'incorreta', comentario: 'x' }, B: { status: 'correta', comentario: 'x' },
                               C: { status: 'incorreta', comentario: 'x' }, D: { status: 'incorreta', comentario: 'x' },
                               E: { status: 'incorreta', comentario: 'x' } },
        resolucaoComentada: 'r',
      },
    };
    if(m) q.data.fonteNaoVerificada = { motivo: 'a obra não é do autor informado', mensagem: m, etapa: 'auditoria' };
    return [{ q, idx: 0 }];
  }, comMarca ? MSG : null);

  const limpa = await monta(false);
  const marcada = await monta(true);

  const bloqueou = (lista) => p.evaluate((l) => {
    let ultimo = null;
    const toastOriginal = window.toast;
    window.toast = (t, tipo) => { ultimo = { t, tipo }; };
    const r = bloqueiaSeFonteNaoVerificada(l);
    window.toast = toastOriginal;
    return { r, ultimo };
  }, lista);

  const r1 = await bloqueou(limpa);
  ok(r1.r === false && !r1.ultimo, 'B1 questão sem a marca do backend NÃO é bloqueada', JSON.stringify(r1));

  const r2 = await bloqueou(marcada);
  ok(r2.r === true, 'B2 questão marcada pelo backend É bloqueada', JSON.stringify(r2.r));
  ok(r2.ultimo && r2.ultimo.tipo === 'err' && r2.ultimo.t.includes(MSG),
     'B3 o aviso de bloqueio traz a mensagem literal do professor', JSON.stringify(r2.ultimo && r2.ultimo.t));
  ok(r2.ultimo && r2.ultimo.t.includes('questão 1'),
     'B4 o aviso nomeia a questão a corrigir', JSON.stringify(r2.ultimo && r2.ultimo.t));

  const duas = await p.evaluate((m) => {
    const mk = (marca) => ({ status: 'done', data: { alternativas: { A:'a',B:'b',C:'c',D:'d',E:'e' },
      analiseAlternativas: { A:{status:'incorreta'},B:{status:'correta'},C:{status:'incorreta'},D:{status:'incorreta'},E:{status:'incorreta'} },
      gabarito: 'B', ...(marca ? { fonteNaoVerificada: { motivo: 'm', mensagem: m } } : {}) } });
    return [{ q: mk(true), idx: 0 }, { q: mk(false), idx: 1 }, { q: mk(true), idx: 2 }];
  }, MSG);
  const r3 = await bloqueou(duas);
  ok(r3.r === true && r3.ultimo.t.includes('questões 1, 3'),
     'B5 com várias, o aviso lista todas as bloqueadas e ignora a boa', JSON.stringify(r3.ultimo && r3.ultimo.t));

  /* ---------- (C) as quatro exportações passam pela trava ---------- */
  const fontes = await p.evaluate(() => {
    const txt = Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
    // só os pontos de CHAMADA — a definição da função também casaria sem o "if(".
    return (txt.match(/if\(bloqueiaSeFonteNaoVerificada\(doneQuestions\)\)/g) || []).length;
  });
  ok(fontes === 4, 'C1 as QUATRO saídas (PDF, Word, impressão e HTML) chamam a trava', String(fontes));
  const pares = await p.evaluate(() => {
    const txt = Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
    return (txt.match(/bloqueiaSeGabaritoInconsistente\(doneQuestions\)\)\s*return;\s*\n\s*if\(bloqueiaSeFonteNaoVerificada/g) || []).length;
  });
  ok(pares === 4, 'C2 a trava de fonte vem logo depois da de gabarito, nas quatro', String(pares));

  /* ---------- (D) o aviso aparece no card da questão ---------- */
  const aud = await p.evaluate((m) => {
    const q = { data: { alternativas: { A:'aa',B:'bb',C:'cc',D:'dd',E:'ee' },
      analiseAlternativas: { A:{status:'incorreta',comentario:'x'},B:{status:'correta',comentario:'x'},C:{status:'incorreta',comentario:'x'},D:{status:'incorreta',comentario:'x'},E:{status:'incorreta',comentario:'x'} },
      gabarito: 'B', textoBase: 'tb', comando: 'c', resolucaoComentada: 'r',
      fonteNaoVerificada: { motivo: 'a obra não é do autor informado', mensagem: m } } };
    return auditaQuestaoLocal(q);
  }, MSG);
  const oAviso = (aud || []).find(i => String(i.texto || '').includes(MSG));
  ok(!!oAviso, 'D1 a auditoria da questão mostra a mensagem literal na tela', JSON.stringify((aud||[]).map(i=>i.texto)));
  ok(oAviso && oAviso.nivel === 'aviso', 'D2 entra como AVISO, não como informação solta', JSON.stringify(oAviso));
  ok(oAviso && oAviso.texto.includes('a obra não é do autor informado'),
     'D3 o motivo apurado pelo auditor acompanha a mensagem', JSON.stringify(oAviso && oAviso.texto));

  const semMarca = await p.evaluate(() => {
    const q = { data: { alternativas: { A:'aa',B:'bb',C:'cc',D:'dd',E:'ee' },
      analiseAlternativas: { A:{status:'incorreta',comentario:'x'},B:{status:'correta',comentario:'x'},C:{status:'incorreta',comentario:'x'},D:{status:'incorreta',comentario:'x'},E:{status:'incorreta',comentario:'x'} },
      gabarito: 'B', textoBase: 'tb', comando: 'c', resolucaoComentada: 'r' } };
    return auditaQuestaoLocal(q);
  });
  ok(!(semMarca || []).some(i => String(i.texto || '').includes('fonte real')),
     'D4 questão sem a marca não ganha aviso de fonte', JSON.stringify((semMarca||[]).map(i=>i.texto)));

  /* ---------- (E) simulado antigo, salvo antes desta versão ---------- */
  const antigo = await p.evaluate(() => {
    const q = { status: 'done', data: { alternativas: { A:'a',B:'b',C:'c',D:'d',E:'e' },
      analiseAlternativas: { A:{status:'incorreta'},B:{status:'correta'},C:{status:'incorreta'},D:{status:'incorreta'},E:{status:'incorreta'} },
      gabarito: 'B' } };
    let ultimo = null; const o = window.toast; window.toast = t => { ultimo = t; };
    const r = bloqueiaSeFonteNaoVerificada([{ q, idx: 0 }]);
    window.toast = o; return { r, ultimo };
  });
  ok(antigo.r === false, 'E1 simulado arquivado antes desta versão continua exportável (não tem a marca)', JSON.stringify(antigo));

  ok(erros.length === 0, 'Z nenhum erro de JavaScript na página', erros.join(' | '));

  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
