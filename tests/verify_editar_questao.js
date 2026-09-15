// v18.2 — "Editar" numa questão já gerada ("Salvar e gerar novamente"): tema alterado descarta o
// recorte planejado da leva (senão o modelo segue o recorte antigo e a edição parece ignorada —
// caso real de 15/09/2026, Biologia, questão 10); tema igual mantém o recorte (sem a habilidade
// sugerida quando o professor escolhe a dele); e a questão regenerada é regravada em "Meus
// Simulados" (antes só "Regenerar" arquivava). Sem rede (backend e supabase-js simulados).
// Uso: node tests/verify_editar_questao.js [caminho/para/index.html]
const { chromium } = require('playwright');
const path = require('path');

const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB_SUPABASE = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(){ return { data: [{ vinculado: false }], error: null }; },
  from(tabela){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(d){ f.inserts = (f.inserts || 0) + 1; f.ultimoInsert = d; return q; }, update(d){ f.updates = (f.updates || 0) + 1; f.ultimoUpdate = d; return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: { id: 'sim-teste', nome: 'Simulado de teste' }, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;

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
        const recortes = Array.from({ length: body.quantidade }, (_, i) => ({ numero: i + 1, conteudo: `${body.tema} — subtópico ${i + 1}`, contexto: `contexto ${i + 1} em ${(body.dominios || [])[i] || 'livre'}`, habilidade: `H${i + 1}: Teste` }));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recortes, uso: { chamadas: 1 } }) });
      }
      corpos.push(body);
      const PALAVRAS = ['feira', 'ônibus', 'terreno', 'poupança', 'reservatório', 'oficina', 'padaria', 'hospital'];
      const visual = body.recurso === 'tabela' ? { tipo: 'tabela', titulo: 'Tabela', colunas: ['x', 'y'], linhas: [['1', '2'], ['3', '4']] } : null;
      const q = { area: body.area, disciplina: body.disciplina, tema: `${body.tema || '(sem tema)'} — ${PALAVRAS[(corpos.length - 1) % PALAVRAS.length]}`, dificuldade: body.dificuldade, recurso: body.recurso, visual,
        competencia: { numero: body.competenciaNum || 1, texto: 'C' }, habilidade: { codigo: body.habilidadeCod || 'H1', texto: 'H' }, objetoConhecimento: 'Conhecimentos numéricos',
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
    setQty(4);
    state.questions.forEach(q => { q.tema = 'Exponenciação'; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; });
    renderQuestionBlocks();
    document.querySelectorAll('.in-tema').forEach(ta => { ta.value = 'Exponenciação'; });
  });

  // ---------- leva inicial: 4 questões com o mesmo tema → recortes planejados, simulado arquivado ----------
  await page.click('#btnGenerate');
  await page.waitForFunction(() => state.questions.length && state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 20000 });
  await sleep(600);
  const L = await page.evaluate(() => ({ recortes: state.questions.map(q => q.recorte), status: state.questions.map(q => q.status), inserts: window.__fake.inserts || 0, updates: window.__fake.updates || 0, aberto: !!simuladoAbertoId }));
  ok(planejamentos.length === 1 && L.recortes.every(r => r && /^conteúdo: Exponenciação — subtópico \d · contexto: /.test(r) && /habilidade: H\d: Teste$/.test(r)), 'L1 leva com tema único: cada questão recebe recorte planejado (conteúdo · contexto · habilidade)', JSON.stringify(L.recortes));
  ok(L.status.every(s => s === 'done') && L.inserts === 1 && L.aberto, 'L2 leva gerada e arquivada em "Meus Simulados" (1 insert; simulado aberto)', JSON.stringify(L));
  const L1b = await page.evaluate(() => state.questions.map(q => [q.recorteTema, q.temaEditado]));
  ok(L1b.every(([t, e]) => t === 'Exponenciação' && e === false), 'L1b cada recorte guarda o tema para o qual foi planejado (recorteTema); nenhuma questão marcada como editada', JSON.stringify(L1b));
  const recorteAntes = L.recortes.slice();

  // abre o painel "Editar" da questão idx e devolve o wrap
  const abrirEditar = async (idx) => {
    await page.evaluate((idx) => {
      const q = state.questions[idx];
      const wrap = document.querySelector(`[data-edit-for="${q.id}"]`);
      const card = wrap.closest('.qcard') || wrap.parentElement;
      const btn = Array.from(card.querySelectorAll('button')).find(b => b.title === 'Editar');
      btn.click();
    }, idx);
    await sleep(150);
  };
  const salvar = async (idx) => {
    const antes = corpos.length;
    await page.evaluate(() => { window.__toasts = []; });
    await page.evaluate((idx) => { const q = state.questions[idx]; document.querySelector(`[data-edit-for="${q.id}"] .edit-save`).click(); }, idx);
    await page.waitForFunction((n) => state.questions[n].status === 'done' || state.questions[n].status === 'error', idx, { timeout: 20000 });
    await sleep(700);   // regenerarQuestaoEArquivar: auditoria + salvarSimuladoAtual
    return { corpo: corpos[antes], novos: corpos.length - antes };
  };

  // ---------- (E1) tema alterado → recorte descartado, texto do professor manda, simulado regravado ----------
  await abrirEditar(2);
  const painel = await page.evaluate(() => { const q = state.questions[2]; const w = document.querySelector(`[data-edit-for="${q.id}"]`); return { visivel: !w.classList.contains('hidden'), tema: w.querySelector('.edit-tema').value, dif: w.querySelector('.edit-dif').value, rec: w.querySelector('.edit-rec').value }; });
  ok(painel.visivel && painel.tema === 'Exponenciação' && painel.dif === 'Médio' && painel.rec === 'nenhum', 'E0 painel "Editar" abre com os valores atuais da questão', JSON.stringify(painel));
  await page.evaluate(() => { const q = state.questions[2]; const w = document.querySelector(`[data-edit-for="${q.id}"]`); w.querySelector('.edit-tema').value = 'Logaritmos: escala Richter e intensidade de terremotos'; });
  const updatesAntesE1 = await page.evaluate(() => window.__fake.updates || 0);
  const E1 = await salvar(2);
  const e1 = await page.evaluate(() => ({ tema: state.questions[2].tema, recorte: state.questions[2].recorte, entregue: state.questions[2].data && state.questions[2].data.tema, updates: window.__fake.updates || 0, status: state.questions[2].status, outros: [0, 1, 3].map(i => state.questions[i].recorte) }));
  ok(E1.novos === 1 && E1.corpo.tema === 'Logaritmos: escala Richter e intensidade de terremotos' && E1.corpo.recorte === null, 'E1 tema alterado no "Editar": UMA geração, com o tema novo e SEM o recorte antigo', JSON.stringify({ tema: E1.corpo.tema, recorte: E1.corpo.recorte }));
  ok(e1.recorte === null && e1.status === 'done' && /^Logaritmos: escala Richter/.test(e1.entregue), 'E1b a questão fica sem recorte planejado e a entrega segue o tema novo', JSON.stringify(e1));
  ok(Array.isArray(E1.corpo.temasEvitar) && E1.corpo.temasEvitar.length >= 3 && E1.corpo.temasEvitar.some(t => /Exponenciação —/.test(t)) && !E1.corpo.temasEvitar.includes('Exponenciação'), 'E1c sem recorte, os temas ENTREGUES das outras questões viajam como assuntos a evitar — o tema DIGITADO delas ("Exponenciação"), não (o professor trocou o tema desta)', JSON.stringify(E1.corpo.temasEvitar));
  const e1flags = await page.evaluate(() => ({ recorteTema: state.questions[2].recorteTema, editado: state.questions[2].temaEditado }));
  ok(e1flags.recorteTema === null && e1flags.editado === true, 'E1g questão marcada como editada e sem tema de origem do recorte', JSON.stringify(e1flags));
  ok(E1.corpo.dominioContexto === (await page.evaluate(() => state.questions[2].dominio)) && E1.corpo.dominioContexto, 'E1d o domínio de contexto reservado da questão continua indo (cenário)', JSON.stringify(E1.corpo.dominioContexto));
  ok(e1.updates === updatesAntesE1 + 1, 'E1e a questão editada é regravada em "Meus Simulados" (1 update após a regeneração)', JSON.stringify({ antes: updatesAntesE1, depois: e1.updates }));
  ok(JSON.stringify(e1.outros) === JSON.stringify([recorteAntes[0], recorteAntes[1], recorteAntes[3]]), 'E1f as outras questões mantêm os seus recortes', JSON.stringify(e1.outros));

  // ---------- (E2) tema igual (só espaços/maiúsculas), dificuldade e recurso mudados → recorte fica ----------
  await abrirEditar(1);
  await page.evaluate(() => {
    const q = state.questions[1]; const w = document.querySelector(`[data-edit-for="${q.id}"]`);
    w.querySelector('.edit-tema').value = '  exponenciação ';
    w.querySelector('.edit-dif').value = 'Difícil';
    const rec = w.querySelector('.edit-rec'); rec.value = 'tabela'; rec.dispatchEvent(new Event('change'));
    w.querySelector('.edit-instr-visual').value = 'duas colunas: ano e população';
  });
  const E2 = await salvar(1);
  const e2 = await page.evaluate(() => ({ tema: state.questions[1].tema, editado: state.questions[1].temaEditado, recorte: state.questions[1].recorte, dif: state.questions[1].dificuldade, rec: state.questions[1].recurso, status: state.questions[1].status, visual: state.questions[1].data && state.questions[1].data.visual && state.questions[1].data.visual.tipo }));
  ok(E2.novos === 1 && E2.corpo.tema === 'Exponenciação' && E2.corpo.recorte === recorteAntes[1] && E2.corpo.dificuldade === 'Difícil' && E2.corpo.recurso === 'tabela' && E2.corpo.instrucoesVisual === 'duas colunas: ano e população', 'E2 tema igual (espaços/maiúsculas não contam): string original mantida, recorte mantido; dificuldade, recurso e instruções novas vão no pedido', JSON.stringify({ recorte: E2.corpo.recorte, dif: E2.corpo.dificuldade, rec: E2.corpo.recurso, instr: E2.corpo.instrucoesVisual }));
  ok(e2.tema === 'Exponenciação' && e2.editado === false && e2.recorte === recorteAntes[1] && e2.status === 'done' && e2.visual === 'tabela', 'E2b questão regenerada com a tabela pedida, recorte preservado, tema com a grafia original e sem marca de edição', JSON.stringify(e2));

  // ---------- (E3) tema igual + competência/habilidade escolhidas → recorte sem a habilidade sugerida ----------
  await abrirEditar(0);
  await page.evaluate(() => {
    const q = state.questions[0]; const w = document.querySelector(`[data-edit-for="${q.id}"]`);
    const comp = w.querySelector('.edit-comp'); const opt = Array.from(comp.options).find(o => o.value); comp.value = opt.value; comp.dispatchEvent(new Event('change'));
    const hab = w.querySelector('.edit-hab'); const h = Array.from(hab.options).find(o => o.value); hab.value = h.value;
  });
  const E3 = await salvar(0);
  const e3 = await page.evaluate(() => ({ recorte: state.questions[0].recorte, comp: state.questions[0].competenciaNum, hab: state.questions[0].habilidadeCod }));
  ok(E3.novos === 1 && E3.corpo.competenciaNum && E3.corpo.habilidadeCod && E3.corpo.recorte === recorteAntes[0].split(' · ').filter(p => !/^habilidade:/.test(p)).join(' · ') && /^conteúdo: Exponenciação — subtópico 1 · contexto: /.test(E3.corpo.recorte) && !/habilidade:/.test(E3.corpo.recorte), 'E3 professor escolhe competência/habilidade: recorte segue (conteúdo · contexto) sem a habilidade sugerida pelo planejamento', JSON.stringify({ recorte: E3.corpo.recorte, comp: E3.corpo.competenciaNum, hab: E3.corpo.habilidadeCod }));
  ok(e3.comp && e3.hab && e3.recorte === E3.corpo.recorte, 'E3b escolha guardada na questão', JSON.stringify(e3));

  // ---------- (E4) "Cancelar" não gera nem altera ----------
  await abrirEditar(3);
  const antesE4 = corpos.length;
  await page.evaluate(() => { const q = state.questions[3]; const w = document.querySelector(`[data-edit-for="${q.id}"]`); w.querySelector('.edit-tema').value = 'Outro tema'; w.querySelector('.edit-cancel').click(); });
  await sleep(300);
  const e4 = await page.evaluate(() => ({ tema: state.questions[3].tema, recorte: state.questions[3].recorte, oculto: document.querySelector(`[data-edit-for="${state.questions[3].id}"]`).classList.contains('hidden') }));
  ok(corpos.length === antesE4 && e4.tema === 'Exponenciação' && e4.recorte === recorteAntes[3] && e4.oculto, 'E4 "Cancelar" fecha o painel sem gerar nem alterar a questão', JSON.stringify(e4));

  // ---------- (E5) tema trocado fora do painel (ex.: simulado desta versão editado à mão no arquivo) com recorteTema gravado → "Regenerar" não manda o recorte ----------
  const regenerar = async (idx) => {
    const antes = corpos.length;
    await page.evaluate((idx) => { const q = state.questions[idx]; const wrap = document.querySelector(`[data-edit-for="${q.id}"]`); const card = wrap.closest('.qcard') || wrap.parentElement; Array.from(card.querySelectorAll('button')).find(b => b.title === 'Regenerar').click(); }, idx);
    await page.waitForFunction((n) => state.questions[n].status === 'done' || state.questions[n].status === 'error', idx, { timeout: 20000 });
    await sleep(500);
    return { corpo: corpos[antes], novos: corpos.length - antes };
  };
  await page.evaluate(() => { const q = state.questions[3]; q.tema = 'Probabilidade: eventos independentes'; /* recorte e recorteTema ("Exponenciação") ficam como estavam */ });
  const E5 = await regenerar(3);
  ok(E5.novos === 1 && E5.corpo.tema === 'Probabilidade: eventos independentes' && E5.corpo.recorte === null && E5.corpo.temasEvitar.includes('Exponenciação'), 'E5 "Regenerar" numa questão cujo tema já não é o do recorte planejado (recorteTema gravado): o recorte antigo não viaja (temas digitados das outras viajam, pois não foi edição pelo painel)', JSON.stringify({ tema: E5.corpo.tema, recorte: E5.corpo.recorte, evitar: E5.corpo.temasEvitar }));
  // ---------- (E5b) simulado ANTIGO inconsistente (tema trocado na versão anterior, sem recorteTema): limite conhecido — o recorte ainda viaja; o painel "Editar" com tema alterado o descarta ----------
  await page.evaluate(() => { const q = state.questions[3]; q.tema = 'Probabilidade: eventos independentes'; delete q.recorteTema; q.temaEditado = false; });
  const E5b = await regenerar(3);
  ok(E5b.novos === 1 && E5b.corpo.recorte === recorteAntes[3], 'E5b limite documentado: simulado antigo sem recorteTema com tema trocado ainda manda o recorte antigo no "Regenerar" (não há como distinguir do legado consistente)', JSON.stringify(E5b.corpo.recorte));
  await abrirEditar(3);
  await page.evaluate(() => { const q = state.questions[3]; const w = document.querySelector(`[data-edit-for="${q.id}"]`); w.querySelector('.edit-tema').value = 'Probabilidade: eventos independentes e dependentes'; });
  const E5c = await salvar(3);
  ok(E5c.novos === 1 && E5c.corpo.recorte === null && E5c.corpo.tema === 'Probabilidade: eventos independentes e dependentes', 'E5c …e o painel "Editar" com o tema alterado descarta esse recorte antigo (saída para o legado)', JSON.stringify({ tema: E5c.corpo.tema, recorte: E5c.corpo.recorte }));
  // ---------- (E6) simulado antigo (sem recorteTema) com tema igual → recorte aceito como está ----------
  await page.evaluate((rec) => { const q = state.questions[3]; q.tema = 'Exponenciação'; q.recorte = rec; delete q.recorteTema; q.temaEditado = false; }, recorteAntes[3]);
  const E6 = await regenerar(3);
  ok(E6.novos === 1 && E6.corpo.recorte === recorteAntes[3], 'E6 simulado antigo sem tema de origem gravado: recorte continua indo (compatibilidade)', JSON.stringify(E6.corpo.recorte));

  ok(erros.length === 0, 'Z sem erros de JS na página', JSON.stringify(erros.slice(0, 3)));
  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await browser.close();
  process.exit(falhas ? 1 : 0);
})();
