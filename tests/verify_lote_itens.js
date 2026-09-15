// v18 — vários conteúdos no "Tema do lote": leitura da lista, rodízio na ordem digitada, exibição
// por questão e no painel, planejamento ÚNICO com temasPorQuestao (backend v74), recorte fora do
// conteúdo descartado (backend antigo), temasEvitar sem crescer, sincronização ao "Gerar", nome e
// cabeçalho, simulado reaberto. Sem rede (backend e supabase-js simulados).
// Uso: node tests/verify_lote_itens.js [caminho/para/index.html]
const { chromium } = require('playwright');
const path = require('path');

const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB_SUPABASE = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(){ return { data: [{ vinculado: false }], error: null }; },
  from(tabela){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(d){ f.ultimoInsert = d; return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: (tabela === 'simulados' && f.simulado) ? f.simulado : { id: 'sim-teste', nome: 'Simulado de teste' }, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;

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
  // Planejador simulado: por padrão respeita temasPorQuestao (comportamento v74);
  // com `planejadorAntigo`, distribui por conta própria (v73) — os recortes vêm com
  // conteúdos trocados; um caso "sinônimo" ("raiz quadrada" para "radiciação").
  let planejadorAntigo = false;
  // `planejadorDeslocado` reproduz o caso real de 15/09/2026: o modelo criou um recorte
  // a mais para o domínio alternativo da questão 3 e deslocou todos os seguintes.
  let planejadorDeslocado = false;
  // `planejadorTroca`: posições certas, mas os contextos dos dois "MDC" (q1 e q6) vêm trocados
  let planejadorTroca = false;
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(url.includes('supabase-js') || url.includes('jsdelivr') || url.includes('unpkg')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(url.includes('/functions/v1/generate-question')){
      const body = route.request().postDataJSON() || {};
      if(body.planejarRecortes){
        planejamentos.push(body);
        const itens = Array.isArray(body.temasPorQuestao) ? body.temasPorQuestao : [];
        let recortes = Array.from({ length: body.quantidade }, (_, i) => {
          let item = itens[i] || body.tema;
          if(planejadorAntigo){ item = itens[(i + 1) % itens.length] || body.tema; if(/radicia/i.test(itens[i] || '')) item = 'raiz quadrada'; }
          return { numero: i + 1, conteudo: `${item} — subtópico ${i + 1}`, contexto: `contexto ${i + 1} em ${(body.dominios || [])[i] || 'livre'}`, habilidade: 'H1: Teste' };
        });
        if(planejadorTroca && itens.length >= 6){
          const doms = body.dominios || [];
          const c0 = recortes[0].contexto, c5 = recortes[5].contexto;
          recortes[0].contexto = `contexto em ${doms[5] || 'livre'}`; recortes[5].contexto = `contexto em ${doms[0] || 'livre'}`;
          void c0; void c5;
        }
        if(planejadorDeslocado && itens.length >= 4){
          const doms = body.dominios || [], alts = body.dominiosAlternativos || [];
          recortes = [];
          for(let i = 0; i < body.quantidade; i++){
            recortes.push({ numero: recortes.length + 1, conteudo: `${itens[i]} — subtópico ${i + 1}`, contexto: `contexto em ${doms[i] || 'livre'}`, habilidade: 'H1: Teste' });
            if(i === 2) recortes.push({ numero: recortes.length + 1, conteudo: `${itens[i]} — propriedades (extra)`, contexto: `contexto em ${alts[i] || 'livre'}`, habilidade: 'H4: Teste' });
          }
          recortes = recortes.slice(0, body.quantidade + 2);   // como o backend v74.1 devolve
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recortes, uso: { chamadas: 1 } }) });
      }
      corpos.push(body);
      const PALAVRAS = ['feira', 'ônibus', 'terreno', 'poupança', 'reservatório', 'oficina', 'padaria', 'hospital', 'estádio', 'laboratório', 'escola', 'porto'];
      const q = { area: body.area, disciplina: body.disciplina, tema: `${body.tema || '(sem tema)'} — ${PALAVRAS[(corpos.length - 1) % PALAVRAS.length]}`, dificuldade: 'Médio', recurso: 'nenhum', visual: null,
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
    setQty(10);
    state.questions.forEach(q => { q.tema = ''; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; });
    renderQuestionBlocks();
  });

  // ---------- (A) leitura da lista (sem DOM) ----------
  const A = await page.evaluate(() => ({
    virgulas: itensDoTemaDoLote('MDC, MMC, radiciação, exponenciação, grandezas'),
    decimalEParenteses: itensDoTemaDoLote('Escala 1:100 e razão 1,5, Funções (1.º e 2.º graus, gráficos), Porcentagem'),
    linhas: itensDoTemaDoLote('* MDC\n* MMC\n- radiciação\n• exponenciação\n1. grandezas\n2) escala'),
    eInicial: itensDoTemaDoLote('Potenciação \nRadiciação\nEscala\nProdutos notáveis\ne Fatoração'),
    pontoEVirgula: itensDoTemaDoLote('Funções: 1.º grau, gráficos; Funções: 2.º grau, vértice; Progressões'),
    unico: itensDoTemaDoLote('Potenciação e Radiciação'),
    unicoComVirgulaDecimal: itensDoTemaDoLote('Escala 1:100 e razão 1,5'),
    linhaComVirgula: itensDoTemaDoLote('MDC, MMC\nRadiciação'),
    vazio: itensDoTemaDoLote('   \n  '),
    primeiroGrau: itensDoTemaDoLote('1.º e 2.º graus, Progressões'),
    virgulaFinal: itensDoTemaDoLote('MDC, MMC, '),
    duplicado: itensDoTemaDoLote('MMC, MMC, MDC'),
    eSolto: itensDoTemaDoLote('MDC\ne\nMMC'),
    eAposVirgula: itensDoTemaDoLote('MDC, MMC, e radiciação'),
    eIndentado: itensDoTemaDoLote('MDC\n  e MMC\n\te radiciação'),
    unicoComMarcador: itensDoTemaDoLote('- Eletrodinâmica.'),
    unicoNumerado: itensDoTemaDoLote('1. Eletrodinâmica;'),
    semEspaco: itensDoTemaDoLote('MDC,MMC,radiciação'),
    misto: itensDoTemaDoLote('MDC, MMC,radiciação'),
    decimaisSemEspaco: itensDoTemaDoLote('Escala 1:100,5 e razão 1,5'),
    espacosLongos: itensDoTemaDoLote('MDC' + ' '.repeat(20000) + 'x, MMC'),
  }));
  ok(JSON.stringify(A.virgulas) === JSON.stringify(['MDC', 'MMC', 'radiciação', 'exponenciação', 'grandezas']), 'A1 vírgulas separam conteúdos', JSON.stringify(A.virgulas));
  ok(JSON.stringify(A.decimalEParenteses) === JSON.stringify(['Escala 1:100 e razão 1,5', 'Funções (1.º e 2.º graus, gráficos)', 'Porcentagem']), 'A2 vírgula decimal (1,5) e vírgula dentro de parênteses não separam', JSON.stringify(A.decimalEParenteses));
  ok(JSON.stringify(A.linhas) === JSON.stringify(['MDC', 'MMC', 'radiciação', 'exponenciação', 'grandezas', 'escala']), 'A3 um por linha, marcadores *, -, •, 1., 2) removidos', JSON.stringify(A.linhas));
  ok(JSON.stringify(A.eInicial) === JSON.stringify(['Potenciação', 'Radiciação', 'Escala', 'Produtos notáveis', 'Fatoração']), 'A4 lista real de 13/09 ("e Fatoração" perde o "e")', JSON.stringify(A.eInicial));
  ok(JSON.stringify(A.pontoEVirgula) === JSON.stringify(['Funções: 1.º grau, gráficos', 'Funções: 2.º grau, vértice', 'Progressões']), 'A5 ponto e vírgula manda quando existe (vírgulas ficam dentro do item)', JSON.stringify(A.pontoEVirgula));
  ok(JSON.stringify(A.unico) === JSON.stringify(['Potenciação e Radiciação']) && JSON.stringify(A.unicoComVirgulaDecimal) === JSON.stringify(['Escala 1:100 e razão 1,5']), 'A6 "e" não separa; um conteúdo só continua um só', JSON.stringify([A.unico, A.unicoComVirgulaDecimal]));
  ok(JSON.stringify(A.linhaComVirgula) === JSON.stringify(['MDC, MMC', 'Radiciação']), 'A7 com quebras de linha, a linha é o item (vírgula interna não separa)', JSON.stringify(A.linhaComVirgula));
  ok(A.vazio.length === 0 && JSON.stringify(A.primeiroGrau) === JSON.stringify(['1.º e 2.º graus', 'Progressões']) && JSON.stringify(A.virgulaFinal) === JSON.stringify(['MDC', 'MMC']) && JSON.stringify(A.duplicado) === JSON.stringify(['MMC', 'MMC', 'MDC']) && JSON.stringify(A.eSolto) === JSON.stringify(['MDC', 'MMC']), 'A8 vazio → nada; "1.º" não é marcador; vírgula final ignorada; duplicata mantida (peso do professor); linha só com "e" descartada', JSON.stringify([A.vazio, A.primeiroGrau, A.virgulaFinal, A.duplicado, A.eSolto]));
  ok(JSON.stringify(A.eAposVirgula) === JSON.stringify(['MDC', 'MMC', 'radiciação']) && JSON.stringify(A.eIndentado) === JSON.stringify(['MDC', 'MMC', 'radiciação']), 'A9 "e" sobrando depois de vírgula ou com indentação também cai', JSON.stringify([A.eAposVirgula, A.eIndentado]));
  ok(JSON.stringify(A.unicoComMarcador) === JSON.stringify(['Eletrodinâmica']) && JSON.stringify(A.unicoNumerado) === JSON.stringify(['Eletrodinâmica']), 'A10 item único também perde marcador e pontuação final', JSON.stringify([A.unicoComMarcador, A.unicoNumerado]));
  ok(JSON.stringify(A.semEspaco) === JSON.stringify(['MDC', 'MMC', 'radiciação']) && JSON.stringify(A.misto) === JSON.stringify(['MDC', 'MMC', 'radiciação']) && JSON.stringify(A.decimaisSemEspaco) === JSON.stringify(['Escala 1:100,5 e razão 1,5']), 'A11 vírgula sem espaço separa; vírgula entre dígitos (1,5 / 100,5) não', JSON.stringify([A.semEspaco, A.misto, A.decimaisSemEspaco]));
  ok(A.espacosLongos.length === 2 && A.espacosLongos[0].startsWith('MDC') && A.espacosLongos[1] === 'MMC', 'A12 20 mil espaços no meio não travam a leitura (sem regex quadrática)', JSON.stringify(A.espacosLongos.map(x => x.length)));

  // ---------- (B) rodízio ----------
  const B = await page.evaluate(() => ({
    dez5: distribuiTemaDoLote('MDC, MMC, radiciação, exponenciação, grandezas', 10),
    dez6: distribuiTemaDoLote('t1, t2, t3, t4, t5, t6', 10),
    tres5: distribuiTemaDoLote('MDC, MMC, radiciação, exponenciação, grandezas', 3),
    unico: distribuiTemaDoLote('Exponenciação', 4),
  }));
  ok(JSON.stringify(B.dez5.temas) === JSON.stringify(['MDC', 'MMC', 'radiciação', 'exponenciação', 'grandezas', 'MDC', 'MMC', 'radiciação', 'exponenciação', 'grandezas']) && B.dez5.sobras.length === 0, 'B1 10 questões × 5 conteúdos: rodízio na ordem digitada, 2 de cada', JSON.stringify(B.dez5.temas));
  ok(JSON.stringify(B.dez6.temas) === JSON.stringify(['t1', 't2', 't3', 't4', 't5', 't6', 't1', 't2', 't3', 't4']), 'B2 10 × 6: 2,2,2,2,1,1', JSON.stringify(B.dez6.temas));
  ok(JSON.stringify(B.tres5.temas) === JSON.stringify(['MDC', 'MMC', 'radiciação']) && JSON.stringify(B.tres5.sobras) === JSON.stringify(['exponenciação', 'grandezas']), 'B3 3 × 5: os 2 últimos ficam de fora (sobras)', JSON.stringify(B.tres5));
  ok(B.unico.temas.every(t => t === 'Exponenciação') && B.unico.itens.length === 1, 'B4 um conteúdo só: todas iguais (comportamento antigo)', JSON.stringify(B.unico));

  // ---------- (C) "Aplicar" com lista: blocos, painel, temaLote, aviso ----------
  const LISTA = 'MDC, MMC, radiciação, exponenciação, grandezas';
  await page.fill('#loteTema', LISTA);
  await page.evaluate(() => { window.__toasts = []; });
  await page.click('#btnAplicarLote');
  await sleep(250);
  const C = await page.evaluate(() => ({
    temas: state.questions.map(q => q.tema), lotes: state.questions.map(q => q.temaLote),
    blocos: Array.from(document.querySelectorAll('.in-tema')).map(e => e.value),
    dicas: document.querySelectorAll('.qblock .lote-origem').length,
    painel: document.getElementById('loteDistribuicao').textContent, painelVisivel: document.getElementById('loteDistribuicao').style.display !== 'none',
    toasts: window.__toasts.map(t => t.msg),
  }));
  ok(JSON.stringify(C.temas) === JSON.stringify(B.dez5.temas) && C.lotes.every(l => l === LISTA), 'C1 "Aplicar": cada questão recebe o SEU conteúdo e guarda a lista (temaLote)', JSON.stringify({ temas: C.temas, lote: C.lotes[0] }));
  ok(JSON.stringify(C.blocos) === JSON.stringify(B.dez5.temas) && C.dicas === 10, 'C2 os 10 campos mostram só o conteúdo da questão, com a dica "distribuído do lote"', JSON.stringify({ blocos: C.blocos, dicas: C.dicas }));
  ok(C.painelVisivel && /MDC → 1, 6 · MMC → 2, 7 · radiciação → 3, 8 · exponenciação → 4, 9 · grandezas → 5, 10/.test(C.painel), 'C3 painel do lote mostra "MDC → 1, 6 · MMC → 2, 7 · …"', C.painel);
  ok(C.toasts.some(m => /Configuração aplicada às 10 questões/.test(m) && /5 conteúdos em rodízio: MDC → 1, 6/.test(m)) && !C.toasts.some(m => /ficaram de fora|ficou de fora/.test(m)), 'C4 aviso do "Aplicar" mostra a distribuição, sem sobras', JSON.stringify(C.toasts));

  // edição manual de um item reflete no painel
  await page.evaluate(() => { const ta = document.querySelectorAll('.in-tema')[2]; ta.value = 'Raiz quadrada'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  const C5 = await page.evaluate(() => ({ tema: state.questions[2].tema, painel: document.getElementById('loteDistribuicao').textContent }));
  ok(C5.tema === 'Raiz quadrada' && /Raiz quadrada → 3/.test(C5.painel) && /radiciação → 8/.test(C5.painel), 'C5 trocar um conteúdo à mão atualiza o painel ("Raiz quadrada → 3 · … radiciação → 8")', JSON.stringify(C5));
  await page.evaluate(() => { const ta = document.querySelectorAll('.in-tema')[2]; ta.value = 'radiciação'; ta.dispatchEvent(new Event('input', { bubbles: true })); });

  // sobras: 12 conteúdos para 10 questões
  await page.fill('#loteTema', 't1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12');
  await page.evaluate(() => { window.__toasts = []; });
  await page.click('#btnAplicarLote');
  await sleep(250);
  const C6 = await page.evaluate(() => ({ temas: state.questions.map(q => q.tema), toasts: window.__toasts.map(t => t.msg) }));
  ok(JSON.stringify(C6.temas) === JSON.stringify(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10']) && C6.toasts.some(m => /12 conteúdos para 10 questões/.test(m) && /"t11", "t12"/.test(m)), 'C6 mais conteúdos que questões: os 10 primeiros entram e o aviso nomeia os que ficaram de fora', JSON.stringify(C6.toasts));

  // ---------- (D) "Gerar": um planejamento, temasPorQuestao, recortes no conteúdo, corpos com o item ----------
  await page.fill('#loteTema', LISTA);
  await page.click('#btnAplicarLote');
  await sleep(250);
  const gerar = async () => {
    corpos = []; planejamentos = [];
    await page.evaluate(() => { window.__toasts = []; });
    await page.click('#btnGenerate');
    await page.waitForFunction(() => state.questions.length && state.questions.every(q => q.status === 'done' || q.status === 'error'), null, { timeout: 20000 });
    await sleep(400);
    return page.evaluate(() => ({ temas: state.questions.map(q => q.tema), recortes: state.questions.map(q => q.recorte), toasts: window.__toasts.map(t => t.msg), resumo: document.getElementById('resultsSummary').textContent, nome: window.__fake.ultimoInsert && window.__fake.ultimoInsert.nome }));
  };
  const voltar = async () => { await page.click('#btnBackToForm'); await sleep(250); };
  let D = await gerar();
  ok(planejamentos.length === 1 && planejamentos[0].tema === LISTA && planejamentos[0].quantidade === 10 && JSON.stringify(planejamentos[0].temasPorQuestao) === JSON.stringify(B.dez5.temas), 'D1 UMA chamada de planejamento para a lista, com temasPorQuestao na ordem das questões', JSON.stringify(planejamentos.map(p => ({ tema: p.tema, q: p.quantidade, tpq: p.temasPorQuestao }))));
  ok(D.recortes.every((r, i) => r && r.startsWith(`conteúdo: ${B.dez5.temas[i]} — subtópico ${i + 1}`)), 'D2 recortes do planejador (v74) aceitos, um por questão, dentro do conteúdo', JSON.stringify(D.recortes.slice(0, 3)));
  ok(corpos.length === 10 && corpos.every(b => B.dez5.temas.includes(b.tema)) && corpos.every(b => b.recorte && b.recorte.includes(`conteúdo: ${b.tema} —`)), 'D3 cada corpo de geração leva o conteúdo da questão como tema e o recorte correspondente', JSON.stringify(corpos.slice(0, 2).map(b => ({ tema: b.tema, recorte: b.recorte.slice(0, 60) }))));
  ok(corpos.every(b => Array.isArray(b.temasEvitar) && b.temasEvitar.length === 0), 'D4 temasEvitar continua vazio na leva com lista (mesmo grupo → prompt não cresce)', JSON.stringify(corpos.map(b => b.temasEvitar.length)));
  ok(D.resumo.includes(`tema pedido: "${LISTA}"`) && /distribuição: MDC → 1, 6/.test(D.resumo), 'D5 cabeçalho dos resultados: lista pedida + distribuição', D.resumo);
  ok(D.nome === `Simulado de Matemática — ${LISTA}`, 'D6 nome do simulado usa a lista', JSON.stringify(D.nome));
  ok(!D.toasts.some(m => /Tema do lote/.test(m)) && !D.toasts.some(m => /assunto parecido/.test(m)), 'D7 sem aviso de lote (caixa igual ao aplicado) e sem falso "assunto parecido" entre conteúdos diferentes', JSON.stringify(D.toasts));
  await voltar();

  // planejador antigo (v73): recortes trocados → descartados; "raiz quadrada" para "radiciação" também sai (falso negativo aceito)
  planejadorAntigo = true;
  D = await gerar();
  planejadorAntigo = false;
  // no mock "antigo", os recortes que seriam de exponenciação viram "raiz quadrada" → as 2 questões de exponenciação ficam sem recorte; as demais são casadas pelo conteúdo
  const semIdx = B.dez5.temas.map((t, i) => t === 'exponenciação' ? i : -1).filter(i => i >= 0);
  ok(D.recortes.every((r, i) => semIdx.includes(i) ? r === null : (r && r.startsWith(`conteúdo: ${B.dez5.temas[i]} —`))) && corpos.every(b => B.dez5.temas.includes(b.tema)), 'D8 backend antigo troca os conteúdos: cada recorte é casado com a questão do SEU conteúdo (8 aproveitados); recorte sem raiz comum com o item não serve (2 sem recorte)', JSON.stringify(D.recortes));
  ok(D.recortes.filter(r => r && /contexto:/.test(r)).length <= 2, 'D8b recorte casado por conteúdo com contexto fora do domínio da questão: o contexto sai, o conteúdo fica (no máximo coincidências de palavra)', JSON.stringify(D.recortes.filter(r => r && /contexto:/.test(r))));
  ok(corpos.filter(b => b.recorte === null).every(b => b.temasEvitar.length >= 1) && corpos.filter(b => b.recorte).every(b => b.temasEvitar.length <= 2), 'D9 sem recorte, os outros conteúdos voltam a viajar como assuntos a evitar; com recorte, só os das questões sem recorte', JSON.stringify(corpos.map(b => b.temasEvitar.length)));
  await voltar();

  // dois itens iguais (MDC em q1 e q6) com os contextos trocados pelo planejador → cada questão fica com o contexto do SEU domínio
  planejadorTroca = true;
  D = await gerar();
  planejadorTroca = false;
  const dTroca = await page.evaluate(() => ({ d1: state.questions[0].dominio, d6: state.questions[5].dominio }));
  ok(D.recortes[0] && D.recortes[0].includes(`contexto: contexto em ${dTroca.d1}`) && D.recortes[5] && D.recortes[5].includes(`contexto: contexto em ${dTroca.d6}`), 'D8d dois "MDC" com contextos trocados: o casamento devolve a cada questão o contexto do seu domínio (nenhum contexto perdido)', JSON.stringify([D.recortes[0], D.recortes[5], dTroca]));
  await voltar();

  // caso real de 15/09/2026: recorte extra no meio, todos os seguintes deslocados → realinhados pelo conteúdo, contextos no domínio preservados
  planejadorDeslocado = true;
  D = await gerar();
  planejadorDeslocado = false;
  ok(D.recortes.every((r, i) => r && r.startsWith(`conteúdo: ${B.dez5.temas[i]} —`)) && D.recortes.filter(r => /contexto:/.test(r)).length >= 9 && corpos.every(b => b.recorte && b.recorte.includes(`conteúdo: ${b.tema} —`)), 'D8c planejador desloca a lista (caso real): as 10 questões recebem o recorte do seu conteúdo e os contextos dentro do domínio são mantidos', JSON.stringify(D.recortes.map(r => r && r.slice(0, 50))));
  await voltar();

  // recorteRespeitaItem direto
  const R = await page.evaluate(() => {
    const G1 = ['MDC', 'MMC', 'radiciação', 'exponenciação', 'grandezas'];
    const G2 = ['Função do 1.º grau', 'Função do 2.º grau'];
    const G3 = ['Grandezas inversamente proporcionais', 'Grandezas diretamente proporcionais'];
    const G4 = ['Juros simples', 'Juros compostos'];
    const G5 = ['PA', 'PG'];
    return {
      exato: recorteRespeitaItem({ conteudo: 'MDC — lotes iguais', contexto: 'feira' }, 'MDC', G1),
      familia: recorteRespeitaItem({ conteudo: 'Função exponencial — juros', contexto: 'banco' }, 'exponenciação', G1),
      plural: recorteRespeitaItem({ conteudo: 'Grandezas inversamente proporcionais — vazão', contexto: 'reservatório' }, 'grandezas', G1),
      fora: recorteRespeitaItem({ conteudo: 'MMC — ciclos', contexto: 'ônibus' }, 'MDC', G1),
      sinonimo: recorteRespeitaItem({ conteudo: 'Raiz quadrada — área', contexto: 'terreno' }, 'radiciação', G1),
      vazio: recorteRespeitaItem({ conteudo: 'x', contexto: 'y' }, '', G1),
      grau2paraGrau1: recorteRespeitaItem({ conteudo: 'Função do 2.º grau — vértice', contexto: 'lançamento' }, 'Função do 1.º grau', G2),
      grau1paraGrau1: recorteRespeitaItem({ conteudo: 'Função do 1.º grau — taxa de variação', contexto: 'táxi' }, 'Função do 1.º grau', G2),
      diretaParaInversa: recorteRespeitaItem({ conteudo: 'Grandezas diretamente proporcionais — receita', contexto: 'cozinha' }, 'Grandezas inversamente proporcionais', G3),
      inversaParaInversa: recorteRespeitaItem({ conteudo: 'Grandezas inversamente proporcionais — torneiras', contexto: 'tanque' }, 'Grandezas inversamente proporcionais', G3),
      compostosParaSimples: recorteRespeitaItem({ conteudo: 'Juros compostos — poupança', contexto: 'banco' }, 'Juros simples', G4),
      pgParaPa: recorteRespeitaItem({ conteudo: 'Progressão geométrica — juros', contexto: 'banco' }, 'PA', G5),
      paParaPa: recorteRespeitaItem({ conteudo: 'PA — soma dos termos', contexto: 'arquibancada' }, 'PA', G5),
      paExpandido: recorteRespeitaItem({ conteudo: 'Progressão aritmética — termo geral', contexto: 'arquibancada' }, 'PA', G5),
    };
  });
  ok(R.exato && R.familia && R.plural && !R.fora && !R.sinonimo && R.vazio, 'D10 recorteRespeitaItem: exato, família (exponencial~exponenciação), plural; fora do item e sinônimo sem raiz comum → não', JSON.stringify(R));
  ok(!R.grau2paraGrau1 && R.grau1paraGrau1 && !R.diretaParaInversa && R.inversaParaInversa && !R.compostosParaSimples, 'D11 itens irmãos: o recorte só vale para o item que pontua mais (1.º × 2.º grau, direta × inversa, simples × compostos)', JSON.stringify(R));
  ok(!R.pgParaPa && R.paParaPa && !R.paExpandido, 'D12 siglas: "PA" só vale inteira; recorte de PG não serve para PA; "Progressão aritmética" sem "PA" é rejeitado (falso negativo aceito)', JSON.stringify(R));

  // ---------- (E) sincronização ao "Gerar" ----------
  // E1: lista editada depois do "Aplicar" (questões intactas) → redistribui
  await page.fill('#loteTema', 'MDC, MMC, radiciação, exponenciação');
  D = await gerar();
  ok(JSON.stringify(D.temas) === JSON.stringify(['MDC', 'MMC', 'radiciação', 'exponenciação', 'MDC', 'MMC', 'radiciação', 'exponenciação', 'MDC', 'MMC']) && D.toasts.some(m => /Tema do lote atualizado nas 10 questões/.test(m) && /4 conteúdos em rodízio/.test(m)) && planejamentos[0].temasPorQuestao[4] === 'MDC', 'E1 lista editada depois de "Aplicar": redistribuída em rodízio ao "Gerar", com aviso', JSON.stringify({ temas: D.temas, toasts: D.toasts.filter(m => /lote/.test(m)) }));
  await voltar();
  // E2: quantidade aumentada depois do "Aplicar" (novas vazias) → todas recebem a distribuição atual
  await page.evaluate(() => { setQty(12); renderQuestionBlocks(); });
  await page.fill('#loteTema', 'MDC, MMC, radiciação');
  D = await gerar();
  ok(D.temas.length === 12 && JSON.stringify(D.temas) === JSON.stringify(['MDC', 'MMC', 'radiciação', 'MDC', 'MMC', 'radiciação', 'MDC', 'MMC', 'radiciação', 'MDC', 'MMC', 'radiciação']), 'E2 quantidade aumentada e lista editada: as 12 recebem a distribuição nova', JSON.stringify(D.temas));
  await voltar();
  // E3: um item ajustado à mão + lista editada → nada muda, aviso explica
  await page.evaluate(() => { state.questions[1].tema = 'Divisores'; renderQuestionBlocks(); });
  await page.fill('#loteTema', 'MDC, MMC');
  D = await gerar();
  ok(D.temas[1] === 'Divisores' && D.temas[0] === 'MDC' && D.temas[2] === 'radiciação' && D.toasts.some(m => /temas diferentes entre si/.test(m)), 'E3 conteúdo ajustado à mão: a lista editada não sobrescreve e o aviso explica', JSON.stringify({ temas: D.temas.slice(0, 3), toasts: D.toasts.filter(m => /lote/.test(m)) }));
  ok(planejamentos.length === 1 && planejamentos[0].temasPorQuestao[1] === 'Divisores' && corpos.find(b => b.tema === 'Divisores'), 'E3b o conteúdo ajustado à mão vai ao planejamento e à geração como está', JSON.stringify(planejamentos[0].temasPorQuestao));
  await voltar();
  // E4: caixa igual ao aplicado → nada
  await page.evaluate(() => { setQty(10); renderQuestionBlocks(); });
  await page.fill('#loteTema', LISTA);
  await page.click('#btnAplicarLote');
  await sleep(250);
  D = await gerar();
  ok(!D.toasts.some(m => /Tema do lote/.test(m)) && JSON.stringify(D.temas) === JSON.stringify(B.dez5.temas), 'E4 caixa igual ao último "Aplicar": nenhum aviso, distribuição mantida', JSON.stringify(D.toasts));
  await voltar();

  // E5: quantidade aumentada com a caixa IGUAL ao aplicado → as novas entram no rodízio, com aviso
  await page.evaluate(() => { setQty(12); renderQuestionBlocks(); });
  D = await gerar();
  ok(D.temas.length === 12 && D.temas[10] === 'MDC' && D.temas[11] === 'MMC' && D.toasts.some(m => /Tema do lote aplicado às 2 questões que estavam sem tema/.test(m)) && planejamentos[0].quantidade === 12, 'E5 quantidade aumentada com a caixa igual: as 2 novas entram no rodízio (MDC, MMC), com aviso, e o planejamento cobre as 12', JSON.stringify({ temas: D.temas.slice(9), toasts: D.toasts.filter(m => /lote/.test(m)) }));
  await voltar();
  await page.evaluate(() => { setQty(10); renderQuestionBlocks(); });

  // ---------- (F) reabrir simulado com lista ----------
  const SIM = { id: 'sim-lista', nome: 'Sim lista', area: 'matematica', disciplina: 'Matemática', validacao_dupla: false,
    dados: { area: 'matematica', disciplina: 'Matemática', qty: 4, gabaritoPlan: ['A', 'B', 'C', 'D'], questions: ['MDC', 'MMC', 'radiciação', 'MDC'].map((t, i) => ({ id: 'r' + i, status: 'done', recurso: 'nenhum', dificuldade: 'Médio', tema: t, temaLote: 'MDC\nMMC\nradiciação', data: { area: 'matematica', disciplina: 'Matemática', tema: t + ' — q' + i, dificuldade: 'Médio', recurso: 'nenhum', visual: null, competencia: { numero: 1, texto: 'C' }, habilidade: { codigo: 'H1', texto: 'H' }, objetoConhecimento: 'Conhecimentos numéricos', textoBase: 'Texto ' + i + '. Fonte, 2024.', comando: 'Comando.', alternativas: { A: '1', B: '2', C: '3', D: '4', E: '5' }, gabarito: 'ABCD'[i], resolucaoComentada: 'R.', analiseAlternativas: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(L => [L, { status: L === 'ABCD'[i] ? 'correta' : 'incorreta', comentario: 'x' }])) } })) } };
  await page.fill('#loteTema', 'texto antigo');
  await page.evaluate((sim) => { window.__fake.simulado = sim; }, SIM);
  await page.evaluate(() => abrirSimuladoSalvo('sim-lista'));
  await sleep(500);
  const F = await page.evaluate(() => ({ caixa: document.getElementById('loteTema').value, resumo: document.getElementById('resultsSummary').textContent }));
  ok(F.caixa === 'MDC, MMC, radiciação' && /tema pedido: "MDC, MMC, radiciação"/.test(F.resumo) && /distribuição: MDC → 1, 4/.test(F.resumo), 'F1 simulado reaberto com lista (digitada em linhas): caixa e cabeçalho mostram "MDC, MMC, radiciação" e a distribuição', JSON.stringify(F));
  await voltar();
  const F2 = await page.evaluate(() => ({ blocos: Array.from(document.querySelectorAll('.in-tema')).map(e => e.value), painel: document.getElementById('loteDistribuicao').textContent }));
  ok(JSON.stringify(F2.blocos) === JSON.stringify(['MDC', 'MMC', 'radiciação', 'MDC']) && /MDC → 1, 4 · MMC → 2 · radiciação → 3/.test(F2.painel), 'F2 "Novo simulado" depois de reabrir: blocos e painel refletem a distribuição salva', JSON.stringify(F2));
  // F3: depois de reabrir (lista em linhas), aumentar a quantidade e gerar → UM grupo, lista canônica nas novas, nome com a lista
  await page.evaluate(() => { setQty(6); renderQuestionBlocks(); });
  D = await gerar();
  const F3 = await page.evaluate(() => ({ lotes: state.questions.map(q => q.temaLote), comum: temaLoteComum() }));
  ok(planejamentos.length === 1 && planejamentos[0].quantidade === 6 && F3.comum === 'MDC, MMC, radiciação' && D.nome === 'Simulado de Matemática — MDC, MMC, radiciação' && corpos.every(b => b.temasEvitar.length === 0) && D.temas[4] === 'MMC' && D.temas[5] === 'radiciação', 'F3 reaberto + quantidade aumentada: um planejamento só (6), lista canônica comum, nome com a lista, temasEvitar vazio', JSON.stringify({ n: planejamentos.length, q: planejamentos[0] && planejamentos[0].quantidade, comum: F3.comum, nome: D.nome, temas: D.temas }));
  await voltar();
  await page.evaluate(() => { setQty(10); renderQuestionBlocks(); window.__fake.simulado = null; });

  // simulado antigo (sem temaLote): nada de lista
  const G = await page.evaluate(() => { const salvo = state.questions; state.questions = [{ tema: 'Exponenciação' }, { tema: 'Exponenciação' }]; const r = { loteComum: temaLoteComum(), titulo: temaDaLevaParaTitulo(), grupo: grupoDeTema(state.questions[0]) }; state.questions = salvo; return r; });
  ok(G.loteComum === null && G.titulo === 'Exponenciação' && G.grupo === 'exponenciação', 'G1 questões sem temaLote: comportamento antigo (grupo = tema)', JSON.stringify(G));

  const errosReais = erros.filter(e => !/favicon|net::ERR|Failed to load resource|supabase/i.test(e));
  ok(errosReais.length === 0, 'Z sem erros de JavaScript no console', errosReais.join('\n     '));

  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await browser.close();
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
