// v17 — Diversidade de exemplos sem custo: teste de ponta a ponta no navegador, SEM rede.
// (A) catálogo e subtópicos íntegros; (B) reservas determinísticas — 20 domínios distintos
// (principal e alternativo), subtópicos distintos dentro de cada eixo, nada em Linguagens,
// questão com tema sem eixo/subtópico; (C) corpo enviado ao backend — subtopico, dominio,
// listas separadas, temas entregues só do mesmo eixo, planejamento com domínios; (D) a
// auditoria de contextos acha exatamente as repetições da leva real 538678f0 e nenhum falso
// par; (E) simulado antigo (sem os campos) reabre, é auditado, regenera com corpo válido e o
// botão "Outro contexto" manda cenário proibido + domínio novo; (F) medição: o prompt do
// usuário não cresce (feita à parte, em Deno — ver README).
//
// Uso: node tests/verify_diversidade.js [caminho/para/index.html]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'leva_538678f0.json'), 'utf8'));
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };

function questaoDados(f, extra) {
  return Object.assign({
    area: 'matematica', disciplina: 'Matemática', tema: f.tema, dificuldade: 'Médio', recurso: 'nenhum', visual: null,
    competencia: { numero: 1, texto: 'C' }, habilidade: { codigo: 'H1', texto: 'H' }, objetoConhecimento: f.eixo,
    textoBase: f.textoBase, comando: f.comando,
    alternativas: { A: '1', B: '2', C: '3', D: '4', E: '5' }, gabarito: 'C', resolucaoComentada: 'Resolução.',
    analiseAlternativas: { A: { status: 'incorreta', comentario: 'x' }, B: { status: 'incorreta', comentario: 'x' }, C: { status: 'correta', comentario: 'x' }, D: { status: 'incorreta', comentario: 'x' }, E: { status: 'incorreta', comentario: 'x' } },
  }, extra || {});
}
// Simulado arquivado ANTES da v17: só os campos antigos (sem subtopico/dominio/colisao).
const SIMULADO_ANTIGO = {
  id: 'sim-antigo', nome: 'Simulado de Matemática', area: 'matematica', disciplina: 'Matemática', validacao_dupla: false,
  dados: { area: 'matematica', disciplina: 'Matemática', qty: 20, gabaritoPlan: null,
    questions: FIXTURE.questoes.map(f => ({ status: 'done', recurso: 'nenhum', dificuldade: 'Médio', tema: '', eixoTematico: f.eixo, recorte: null, data: questaoDados(f) })) },
};

const STUB_SUPABASE = `
window.supabase = {
  createClient(){
    const f = window.__fake;
    return {
      auth: {
        onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; },
        async getSession(){ return { data: { session: f.session } }; },
        async signOut(){ f.session = null; return { error: null }; },
      },
      async rpc(nome){ if(nome === 'wa_meu_status') return { data: [{ vinculado: false }], error: null }; return { data: null, error: null }; },
      from(tabela){
        const q = { _t: tabela, select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; },
          single(){ return Promise.resolve(tabela === 'simulados' ? { data: f.simulado, error: null } : { data: null, error: null }); },
          then(r){ r({ data: [], error: null }); } };
        return q;
      },
    };
  }
};`;

let total = 0, falhas = 0;
function ok(cond, msg, extra){ if(cond){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript((f) => { window.__fake = f; }, { session: SESSAO, simulado: SIMULADO_ANTIGO });

  // Backend simulado: registra cada corpo; planejamento devolve recortes; geração devolve
  // uma questão cujo texto-base cita o domínio reservado (para a auditoria não acusar).
  const corpos = [];
  const corposPlanejamento = [];
  let recolideCom = null; // quando definido, a próxima questão gerada volta nesse cenário (para testar recolisão)
  let planejadorRuim = false; // quando true, o planejador devolve MENOS recortes e um contexto fora do domínio
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(url.includes('supabase-js') || url.includes('jsdelivr') || url.includes('unpkg')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(url.includes('/functions/v1/generate-question')){
      const body = route.request().postDataJSON() || {};
      if(body.planejarRecortes){
        corposPlanejamento.push(body);
        let recortes = Array.from({ length: body.quantidade }, (_, i) => ({ conteudo: `conteúdo ${i + 1}`, contexto: `contexto ${i + 1} em ${(body.dominios || [])[i] || 'livre'}`, habilidade: 'H1: Teste' }));
        if(planejadorRuim){ recortes = recortes.slice(0, body.quantidade - 1); recortes[1].contexto = 'uma fábrica de parafusos que produz lotes diários'; planejadorRuim = false; }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recortes, uso: { chamadas: 1 } }) });
      }
      corpos.push(body);
      const n = corpos.length;
      const cenario = recolideCom || `Cenário nº ${n}: ${body.dominioContexto || 'sem domínio'} — texto de teste sem palavras de outro catálogo.`;
      recolideCom = null;
      const q = questaoDados({ tema: `Tema entregue ${n} (${body.subtopico || body.recorte || 'sem reserva'})`, eixo: body.eixoTematico || 'Conhecimentos numéricos', comando: 'Comando.', textoBase: cenario }, { area: body.area, disciplina: body.disciplina });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ question: q, uso: { chamadas: 1, entradaNova: 10, cacheEscrito: 0, cacheLido: 0, saida: 5 }, diversidadeDiag: { eixoTematico: body.eixoTematico, subtopico: body.subtopico, dominioContexto: body.dominioContexto, dominioAlternativo: body.dominioAlternativo, dominiosEvitar: (body.dominiosEvitar || []).length, temasEvitar: (body.temasEvitar || []).length, temaEntregue: q.tema, objetoEntregue: q.objetoConhecimento, eixoRespeitado: true } }) });
    }
    if(url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('file://' + INDEX);
  await sleep(600);

  // ---------- (A) catálogo e subtópicos
  const A = await page.evaluate(() => {
    const nomes = DOMINIOS_CONTEXTO.map(d => d.n);
    const oficiais = [].concat(...Object.values(APP_DATA.objetosConhecimento));
    const chaves = Object.keys(SUBTOPICOS_OFICIAIS);
    return {
      total: nomes.length, unicos: new Set(nomes).size,
      chavesVazias: DOMINIOS_CONTEXTO.filter(d => !Array.isArray(d.k) || !d.k.length).length,
      chavesGenericas: DOMINIOS_CONTEXTO.flatMap(d => d.k).filter(k => ['empresa', 'loja', 'cidade', 'producao', 'produto', 'metro', 'dados', 'tecido', 'carga', 'professor', 'grafica', 'exposicao', 'candidato', 'deposito', 'embalagens'].includes(k)),
      subtopicosForaDaMatriz: chaves.filter(c => !oficiais.includes(c)),
      objetosSemSubtopico: oficiais.filter(o => !SUBTOPICOS_OFICIAIS[o] && !APP_DATA.objetosConhecimento.linguagens.includes(o)),
      listasCurtas: chaves.filter(c => SUBTOPICOS_OFICIAIS[c].length < 3),
      areasComDominio: AREAS_COM_DOMINIO.slice(),
    };
  });
  ok(A.total === 61 && A.unicos === 61, 'A1 catálogo com 61 domínios de nomes únicos', JSON.stringify(A));
  ok(A.chavesVazias === 0 && A.chavesGenericas.length === 0, 'A2 nenhum domínio sem palavras-chave nem palavra-chave genérica', JSON.stringify(A.chavesGenericas));
  ok(A.subtopicosForaDaMatriz.length === 0, 'A3 todo objeto com subtópicos existe no Anexo oficial carregado', JSON.stringify(A.subtopicosForaDaMatriz));
  ok(A.objetosSemSubtopico.length === 0, 'A4 todo objeto oficial de Matemática, Natureza e Humanas tem lista de subtópicos', JSON.stringify(A.objetosSemSubtopico));
  ok(A.listasCurtas.length === 0, 'A5 nenhuma lista de subtópicos com menos de 3 itens', JSON.stringify(A.listasCurtas));
  ok(JSON.stringify(A.areasComDominio) === JSON.stringify(['matematica', 'natureza']), 'A6 domínio reservado só em Matemática e Ciências da Natureza');

  // ---------- (B) reservas determinísticas (20 de Matemática sem tema; 1 com tema; Linguagens)
  const B = await page.evaluate(() => {
    state.area = 'matematica'; state.disciplina = 'Matemática'; state.qty = 20;
    state.questions = Array.from({ length: 20 }, (_, i) => ({ id: 'q' + i, tema: i === 19 ? 'Função exponencial' : '', dificuldade: 'Médio', recurso: 'nenhum', status: 'idle', data: null }));
    planejaEixosTematicos(); planejaDominios();
    const doms = state.questions.map(q => q.dominio), alts = state.questions.map(q => q.dominioAlt);
    const porEixo = {};
    state.questions.forEach(q => { if(q.eixoTematico){ (porEixo[q.eixoTematico] = porEixo[q.eixoTematico] || []).push(q.subtopico); } });
    const subRepetidos = Object.entries(porEixo).filter(([, subs]) => new Set(subs).size !== subs.length).map(([e]) => e);
    const comTema = state.questions[19];
    const r1 = { doms: new Set(doms).size, alts: new Set(alts).size, algumAltNulo: alts.some(a => !a), intersecao: doms.filter(d => alts.includes(d)).length, semSub: state.questions.filter(q => q.eixoTematico && !q.subtopico).length, subRepetidos, comTema: { eixo: comTema.eixoTematico, sub: comTema.subtopico, dom: !!comTema.dominio }, evitar0: dominiosEvitarPara(state.questions[0]).length, evitarInclui: !dominiosEvitarPara(state.questions[0]).includes(state.questions[0].dominio) && !dominiosEvitarPara(state.questions[0]).includes(state.questions[0].dominioAlt) };
    // Linguagens: nada de domínio
    state.area = 'linguagens'; state.disciplina = 'Língua Portuguesa';
    state.questions = Array.from({ length: 4 }, (_, i) => ({ id: 'l' + i, tema: '', dificuldade: 'Médio', recurso: 'nenhum', status: 'idle', data: null }));
    planejaEixosTematicos(); planejaDominios();
    r1.linguagens = { dom: state.questions.filter(q => q.dominio).length, eixo: state.questions.filter(q => q.eixoTematico).length, sub: state.questions.filter(q => q.subtopico).length };
    // Leva de 1: nada reservado
    state.area = 'matematica'; state.disciplina = 'Matemática';
    state.questions = [{ id: 'u', tema: '', dificuldade: 'Médio', recurso: 'nenhum', status: 'idle', data: null }];
    planejaEixosTematicos(); planejaDominios();
    r1.unica = { dom: state.questions[0].dominio, eixo: state.questions[0].eixoTematico, sub: state.questions[0].subtopico };
    return r1;
  });
  ok(B.doms === 20 && B.alts === 20 && !B.algumAltNulo && B.intersecao === 0, 'B1 20 domínios principais distintos, 20 alternativos distintos e disjuntos dos principais', JSON.stringify(B));
  ok(B.semSub === 0 && B.subRepetidos.length === 0, 'B2 toda questão sem tema tem subtópico e nenhum subtópico repete dentro do eixo', JSON.stringify({ semSub: B.semSub, subRepetidos: B.subRepetidos }));
  ok(B.comTema.eixo === null && B.comTema.sub === null && B.comTema.dom === true, 'B3 questão com tema digitado: sem eixo/subtópico, mas com domínio de contexto', JSON.stringify(B.comTema));
  ok(B.evitar0 === 19 && B.evitarInclui, 'B4 domínios a evitar = os 19 principais das outras (nunca o próprio nem o alternativo)', JSON.stringify({ evitar0: B.evitar0 }));
  ok(B.linguagens.dom === 0 && B.linguagens.eixo === 4 && B.linguagens.sub === 0, 'B5 Linguagens: eixo por disciplina, sem domínio e sem subtópico', JSON.stringify(B.linguagens));
  ok(B.unica.dom === null && B.unica.eixo === null && B.unica.sub === null, 'B6 leva de 1 questão: nenhuma reserva', JSON.stringify(B.unica));

  // ---------- (C) corpo enviado ao backend — leva de 6 sem tema (Matemática)
  await page.evaluate(() => {
    state.area = 'matematica'; state.disciplina = 'Matemática';
    document.querySelectorAll('.area-tile').forEach(t => t.classList.toggle('active', t.dataset.area === 'matematica'));
  });
  await page.evaluate(() => { setQty(6); state.questions.forEach(q => { q.tema = ''; }); });
  corpos.length = 0; corposPlanejamento.length = 0;
  await page.evaluate(() => generateAll());
  await sleep(500);
  const C1 = corpos.length === 6;
  ok(C1, 'C1 6 chamadas de geração, nenhuma de planejamento (sem tema não há planejamento — zero chamadas extras)', `geração ${corpos.length}, planejamento ${corposPlanejamento.length}`);
  ok(corposPlanejamento.length === 0, 'C2 zero chamadas de planejamento na leva sem tema');
  const camposOk = corpos.every(b => typeof b.subtopico === 'string' && b.subtopico && typeof b.dominioContexto === 'string' && b.dominioContexto && typeof b.dominioAlternativo === 'string' && Array.isArray(b.dominiosEvitar) && b.dominiosEvitar.length === 0 && Array.isArray(b.contextosEvitar) && b.contextosEvitar.length === 0 && Array.isArray(b.temasEvitar) && b.eixoTematico && b.recorte === null);
  ok(camposOk, 'C3 cada corpo leva subtopico, dominioContexto, dominioAlternativo, dominiosEvitar=[] e contextosEvitar=[] (lista de proibidos só depois de colisão)', JSON.stringify(corpos.map(b => ({ s: !!b.subtopico, d: b.dominioContexto, a: b.dominioAlternativo, de: b.dominiosEvitar, ce: b.contextosEvitar }))));
  ok(new Set(corpos.map(b => b.dominioContexto)).size === 6, 'C4 os 6 domínios enviados são distintos');
  const eixosDaLeva = await page.evaluate(() => state.questions.map(q => q.eixoTematico));
  // temasEvitar só com temas entregues do MESMO eixo (a 6ª questão repete o eixo da 1ª).
  const ultimo = corpos[corpos.length - 1];
  const mesmoEixo = corpos.filter(b => b.eixoTematico === ultimo.eixoTematico).length;
  ok(ultimo.temasEvitar.length <= Math.max(0, mesmoEixo - 1) && corpos.every(b => b.temasEvitar.every(t => t.length <= 120)), 'C5 temas a evitar só do mesmo eixo, itens de até 120 caracteres', JSON.stringify({ eixos: eixosDaLeva, ultimoEixo: ultimo.eixoTematico, temasEvitar: ultimo.temasEvitar }));
  const auditoriaC = await page.evaluate(() => ({ pares: auditaDiversidadeContextos(), colisoes: state.questions.filter(q => q.colisaoContexto).length, done: state.questions.filter(q => q.status === 'done').length }));
  ok(auditoriaC.done === 6 && auditoriaC.pares.length === 0 && auditoriaC.colisoes === 0, 'C6 leva concluída e a auditoria não acusa contexto repetido quando cada questão ficou no seu domínio', JSON.stringify(auditoriaC));
  const diagC = await page.evaluate(() => (state.questions[0].diag || []).map(d => typeof d === 'string' ? d : JSON.stringify(d)).join(' | '));
  ok(/subtópico/.test(diagC) && /domínio/.test(diagC), 'C7 diagnóstico da questão mostra subtópico e domínio reservados', diagC.slice(0, 300));

  // ---------- (C') leva COM tema (3 questões iguais): planejamento recebe domínios; corpos levam recorte + domínio, sem subtópico
  corpos.length = 0; corposPlanejamento.length = 0;
  await page.evaluate(() => { setQty(3); state.questions.forEach(q => { q.tema = 'Função exponencial'; }); });
  await page.evaluate(() => generateAll());
  await sleep(500);
  ok(corposPlanejamento.length === 1 && Array.isArray(corposPlanejamento[0].dominios) && corposPlanejamento[0].dominios.length === 3 && corposPlanejamento[0].dominios.every(d => typeof d === 'string' && d), 'C8 com tema: UMA chamada de planejamento (como hoje) e ela recebe os 3 domínios reservados', JSON.stringify(corposPlanejamento[0] && corposPlanejamento[0].dominios));
  ok(corpos.length === 3 && corpos.every(b => b.recorte && b.subtopico === null && b.dominioContexto && b.eixoTematico === null), 'C9 com tema: corpos levam recorte planejado e domínio, sem eixo nem subtópico', JSON.stringify(corpos.map(b => ({ r: !!b.recorte, s: b.subtopico, d: b.dominioContexto, e: b.eixoTematico }))));
  ok(corpos.every(b => b.temasEvitar.length === 0), 'C10 com tema e recorte planejado: temas entregues do mesmo grupo não viajam de novo (prompt não cresce)', JSON.stringify(corpos.map(b => b.temasEvitar)));
  ok(Array.isArray(corposPlanejamento[0].dominiosAlternativos) && corposPlanejamento[0].dominiosAlternativos.length === 3 && corposPlanejamento[0].dominiosAlternativos.every(Boolean), 'C11 o planejamento recebe também os domínios alternativos', JSON.stringify(corposPlanejamento[0].dominiosAlternativos));

  // ---------- (C'') planejador que falha: devolve 2 recortes para 3 questões, um deles fora do domínio
  corpos.length = 0; corposPlanejamento.length = 0; planejadorRuim = true;
  await page.evaluate(() => { setQty(3); state.questions.forEach(q => { q.tema = 'Exponenciação'; }); });
  await page.evaluate(() => generateAll());
  await sleep(500);
  const rec = corpos.map(b => b.recorte);
  ok(rec.length === 3 && /contexto:/.test(rec[0] || '') && rec[1] && !/contexto:/.test(rec[1]) && /conteúdo: conteúdo 2/.test(rec[1]) && rec[2] === null, 'C12 planejador devolveu menos recortes e um contexto fora do domínio: o contexto errado sai do recorte (fica conteúdo+habilidade) e a 3ª questão fica sem recorte — nos dois casos o backend ambienta pelo domínio reservado', JSON.stringify(rec));
  ok(corpos.every(b => b.dominioContexto), 'C13 todas as 3 questões levam o domínio reservado (é ele que assume quando o recorte não traz contexto)');

  // ---------- (D) auditoria de contextos na leva real 538678f0
  const D = await page.evaluate((fx) => {
    state.area = 'matematica'; state.disciplina = 'Matemática';
    state.questions = fx.questoes.map(f => ({ id: 'f' + f.ord, tema: '', dificuldade: 'Médio', recurso: 'nenhum', status: 'done', eixoTematico: f.eixo, data: { textoBase: f.textoBase, comando: f.comando, tema: f.tema, visual: null } }));
    const pares = auditaDiversidadeContextos();
    return { pares, marcadas: state.questions.map((q, i) => q.colisaoContexto ? i + 1 : null).filter(Boolean), colisoes: state.questions.filter(q => q.colisaoContexto).map(q => q.colisaoContexto) };
  }, FIXTURE);
  const paresEsperados = ['2 e 7', '3 e 11', '3 e 18', '11 e 18', '5 e 6', '8 e 13', '8 e 15', '13 e 15', '14 e 19'];
  const paresAchados = D.pares.map(p => p.replace(/\s*\(.*$/, ''));
  const faltando = paresEsperados.filter(p => !paresAchados.includes(p));
  const extras = paresAchados.filter(p => !paresEsperados.includes(p));
  ok(faltando.length === 0, 'D1 acha as repetições reais: fábrica de eletrônicos (2,7), cooperativa/trator (3,11,18), arquitetura de interiores (5,6), transportadora (8,13,15), produção artesanal (14,19)', 'faltando: ' + JSON.stringify(faltando) + ' · achados: ' + JSON.stringify(D.pares));
  ok(extras.length === 0, 'D2 nenhum par falso (12×17 atletismo/peças automotivas, 4 gráfica, 9 laboratório, 16 planetário, 20 rampas ficam sozinhas)', 'extras: ' + JSON.stringify(extras));
  ok(!D.marcadas.includes(2) && D.marcadas.includes(7) && D.marcadas.includes(19) && !D.marcadas.includes(1), 'D3 marca a segunda questão de cada par (7, 11, 18, 6, 13, 15, 19), nunca a primeira', JSON.stringify(D.marcadas));

  // ---------- (D') leva bem diversificada (6eb68563, com recortes planejados): só os pares legítimos
  const BOA = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'leva_6eb68563.json'), 'utf8'));
  const D4 = await page.evaluate((fx) => {
    state.questions = fx.questoes.map(f => ({ id: 'b' + f.ord, tema: 'x', dificuldade: 'Médio', recurso: 'nenhum', status: 'done', data: { textoBase: f.t, comando: '', tema: '', visual: null } }));
    return auditaDiversidadeContextos().map(p => p.replace(/\s*\(.*$/, ''));
  }, BOA);
  const extras2 = D4.filter(p => !BOA.paresLegitimos.includes(p));
  const faltando2 = BOA.paresLegitimos.filter(p => !D4.includes(p));
  ok(extras2.length === 0 && faltando2.length === 0, 'D4 leva bem diversificada: só os pares legítimos (dois reservatórios de água; duas lojas de eletro com vendedor) — nada de bactéria×notação científica, reportagem, mapa×planta, móveis, madeira, editora, estudantes', 'extras: ' + JSON.stringify(extras2) + ' · faltando: ' + JSON.stringify(faltando2));

  // ---------- (D'') falsos positivos típicos de Física/Química/Biologia/Humanas e plurais
  const D5 = await page.evaluate(() => {
    const bate = t => DOMINIOS_CONTEXTO.filter(d => dominioBateNoTexto(normalizaTextoBusca(t), d)).map(d => d.n);
    return {
      fisica: bate('Dois resistores associados em série a um motor; ar comprimido no cilindro converte energia mecânica em energia elétrica; a velocidade máxima do projétil; movimento planetário; trilho de ar; ondas de rádio; orbitais atômicos; água doce do planeta'),
      biologia: bate('RNA transportador; vasos sanguíneos; 120 exemplares da espécie; estádios larvais; casamento consanguíneo; corredores ecológicos; a bactéria Escherichia coli; suco gástrico; colônia de exploração; expedição de Cabral'),
      fontes: bate('Segundo reportagem publicada em 2023. Editora Universitária. O mapa a seguir mostra a distribuição. média salarial; soma das parcelas de uma PA; algoritmo da divisão; servidores públicos; aula de campo'),
      plurais: [bate('três trens partiram'), bate('dois aviões decolaram'), bate('cinco vagões'), bate('a caixa-d’água da escola'), bate('mel de abelhas'), bate('o melhor resultado')],
    };
  });
  ok(D5.fisica.length === 0 && D5.biologia.length === 0 && D5.fontes.length === 0, 'D5 frases típicas de Física, Biologia e de fontes (reportagem, editora, mapa) não acusam nenhum domínio', JSON.stringify(D5));
  ok(D5.plurais[0].includes('ferrovias e metrô') && D5.plurais[1].includes('aviação e aeroportos') && D5.plurais[2].includes('ferrovias e metrô') && D5.plurais[3].includes('saneamento e abastecimento de água') && D5.plurais[4].includes('apicultura e produção de mel') && D5.plurais[5].length === 0, 'D6 plurais (trens, aviões, vagões), apóstrofo tipográfico/hífen (caixa-d’água) e palavra inteira (mel ≠ melhor)', JSON.stringify(D5.plurais));
  const D7 = await page.evaluate((fx) => {
    state.area = 'humanas'; state.disciplina = 'História';
    state.questions = fx.questoes.slice(0, 8).map(f => ({ id: 'h' + f.ord, tema: '', status: 'done', data: { textoBase: f.textoBase, comando: f.comando, tema: f.tema } }));
    const pares = auditaDiversidadeContextos();
    // Humanas, 20 sem tema: "Representação espacial" tem 3 subtópicos → as sobras ficam sem subtópico, nunca repetido
    state.questions = Array.from({ length: 20 }, (_, i) => ({ id: 'h' + i, tema: '', dificuldade: 'Médio', recurso: 'nenhum', status: 'idle', data: null }));
    planejaEixosTematicos(); planejaDominios();
    const porEixo = {};
    state.questions.forEach(q => { (porEixo[q.eixoTematico] = porEixo[q.eixoTematico] || []).push(q.subtopico); });
    const repetidos = Object.values(porEixo).filter(l => { const s = l.filter(Boolean); return new Set(s).size !== s.length; }).length;
    const semSub = state.questions.filter(q => !q.subtopico).length;
    state.area = 'matematica'; state.disciplina = 'Matemática';
    return { pares, repetidos, semSub, dominios: state.questions.filter(q => q.dominio).length };
  }, FIXTURE);
  ok(D7.pares.length === 0 && D7.dominios === 0, 'D7 Humanas: auditoria de contexto não roda e nenhum domínio é reservado', JSON.stringify(D7));
  ok(D7.repetidos === 0 && D7.semSub >= 1 && D7.semSub <= 3, 'D8 Humanas, 20 sem tema: nenhum subtópico repetido dentro do eixo; as sobras de "Representação espacial" (3 itens) ficam só com o eixo', JSON.stringify(D7));
  // leva mista: tema digitado igual ao subtópico de outra questão não vira "proibido"
  const D9 = await page.evaluate(() => {
    state.questions = [
      { id: 'm0', tema: '', eixoTematico: 'Conhecimentos algébricos', subtopico: 'funções exponenciais e logarítmicas', status: 'idle', data: null },
      { id: 'm1', tema: 'Função exponencial', eixoTematico: null, subtopico: null, status: 'idle', data: null },
      { id: 'm2', tema: 'Escala e proporção', eixoTematico: null, subtopico: null, status: 'idle', data: null },
      { id: 'm3', tema: '', eixoTematico: 'Conhecimentos algébricos', subtopico: 'gráficos e funções', status: 'done', data: { tema: 'Leitura de gráfico de função' } },
      { id: 'm4', tema: '', eixoTematico: 'Conhecimentos numéricos', subtopico: 'porcentagem e juros', status: 'done', data: { tema: 'Juros compostos em financiamento' } },
    ];
    return temasEvitarPara(state.questions[0]);
  });
  ok(!D9.includes('Função exponencial') && D9.includes('Escala e proporção') && D9.includes('Leitura de gráfico de função') && !D9.includes('Juros compostos em financiamento'), 'D9 leva mista: tema digitado que coincide com o subtópico reservado não vira proibido; tema de outro eixo entregue não viaja; tema digitado de outro grupo e entregue do mesmo eixo viajam', JSON.stringify(D9));

  // ---------- (E) simulado arquivado antes da v17: reabre, audita, regenera e "Outro contexto"
  corpos.length = 0;
  await page.evaluate(() => abrirSimuladoSalvo('sim-antigo'));
  await sleep(800);
  const E1 = await page.evaluate(() => ({ n: state.questions.length, colisoes: state.questions.filter(q => q.colisaoContexto).length, botoes: document.querySelectorAll('.qcard-actions button[title^="Outro contexto"]').length, avisoCard: !!Array.from(document.querySelectorAll('.qcard')).find(c => /Contexto repetido na leva/.test(c.textContent)) }));
  ok(E1.n === 20 && E1.colisoes >= 7 && E1.botoes === E1.colisoes && E1.avisoCard, 'E1 simulado antigo reaberto: colisões marcadas, um botão "Outro contexto" por questão marcada e alerta na auditoria local do cartão', JSON.stringify(E1));
  // Regenerar comum numa questão antiga (sem reservas): corpo válido com nulos
  await page.evaluate(() => regenerarQuestaoEArquivar(state.questions[0]));
  await sleep(300);
  const bAntigo = corpos[corpos.length - 1];
  ok(bAntigo && bAntigo.subtopico === null && bAntigo.dominioContexto === null && bAntigo.dominioAlternativo === null && Array.isArray(bAntigo.dominiosEvitar) && Array.isArray(bAntigo.contextosEvitar) && bAntigo.contextosEvitar.length === 0, 'E2 regenerar questão de simulado antigo: campos novos nulos/vazios, sem erro', JSON.stringify(bAntigo && { s: bAntigo.subtopico, d: bAntigo.dominioContexto, a: bAntigo.dominioAlternativo, de: bAntigo.dominiosEvitar, ce: bAntigo.contextosEvitar }));
  // "Outro contexto" na questão 7 (fábrica de componentes eletrônicos, igual à 2)
  const antes = await page.evaluate(() => ({ colisao: state.questions[6].colisaoContexto, usados: state.questions.map(q => q.dominio).filter(Boolean) }));
  await page.evaluate(() => regenerarComOutroContexto(state.questions[6]));
  await sleep(300);
  const bOutro = corpos[corpos.length - 1];
  const E3 = await page.evaluate(() => ({ dom: state.questions[6].dominio, alt: state.questions[6].dominioAlt, colisao: state.questions[6].colisaoContexto, evitar: state.questions[6].contextosEvitar }));
  ok(/indústria de componentes eletrônicos/.test(antes.colisao || ''), 'E3 a questão 7 estava marcada como repetição da fábrica de componentes eletrônicos', antes.colisao);
  ok(bOutro && bOutro.contextosEvitar.includes('indústria de componentes eletrônicos') && bOutro.dominioContexto === E3.dom && E3.dom && !antes.usados.includes(E3.dom) && Array.isArray(bOutro.dominiosEvitar), 'E4 "Outro contexto": corpo leva o cenário colidido como proibido e um domínio novo não usado na leva', JSON.stringify({ ce: bOutro && bOutro.contextosEvitar, d: bOutro && bOutro.dominioContexto, de: bOutro && bOutro.dominiosEvitar.length, E3 }));
  ok(E3.colisao === null, 'E5 depois de regenerar em outro cenário, a questão 7 deixa de estar marcada (o texto novo cita só o domínio dela)', JSON.stringify(E3));
  // Recolisão: a questão 19 (velas, artesanato) é regenerada e volta em "marcenaria" → colide de novo com a 14 e o PRÓPRIO cartão tem de mostrar o aviso e o botão
  recolideCom = 'Uma marcenaria artesanal fabrica mesas sob medida para restaurantes da cidade.';
  await page.evaluate(() => regenerarQuestaoEArquivar(state.questions[18]));
  await sleep(300);
  const E7 = await page.evaluate(() => { const c = document.querySelectorAll('.qcard')[18]; return { colisao: state.questions[18].colisaoContexto, aviso: /Contexto repetido na leva/.test(c.textContent), botao: !!c.querySelector('.qcard-actions button[title^="Outro contexto"]') }; });
  ok(/marcenaria/.test(E7.colisao || '') && E7.aviso && E7.botao, 'E7 questão regenerada que volta a colidir: o próprio cartão mostra o aviso e o botão "Outro contexto"', JSON.stringify(E7));
  // "Outro contexto" numa questão COM tema e recorte planejado: o recorte perde o "contexto: …" e o corpo leva contextosEvitar + domínios proibidos
  await page.evaluate(() => { const q = state.questions[18]; q.tema = 'Sistemas lineares'; q.recorte = 'conteúdo: sistema 2×2 · contexto: marcenaria que fabrica mesas · habilidade: H21: x'; });
  await page.evaluate(() => regenerarComOutroContexto(state.questions[18]));
  await sleep(300);
  const bRec = corpos[corpos.length - 1];
  ok(bRec && bRec.recorte === 'conteúdo: sistema 2×2 · habilidade: H21: x' && bRec.contextosEvitar.some(c => /marcenaria/.test(c)) && bRec.dominioContexto && bRec.dominiosEvitar.length > 0, 'E8 "Outro contexto" com tema e recorte: o recorte perde o "contexto:" colidido, e vão o cenário proibido, o domínio novo e a lista de proibidos', JSON.stringify(bRec && { r: bRec.recorte, ce: bRec.contextosEvitar, d: bRec.dominioContexto, de: bRec.dominiosEvitar.length }));
  await page.evaluate(() => { state.questions[18].tema = ''; state.questions[18].recorte = null; });

  // Auditoria de TEMAS numa leva com o mesmo tema digitado: as palavras do tema do professor não contam como semelhança
  const E9 = await page.evaluate(() => {
    const salvo = state.questions;
    state.questions = [
      { id: 't0', tema: 'Exponenciação', data: { tema: 'Exponenciação — propriedades das potências em juros' } },
      { id: 't1', tema: 'Exponenciação', data: { tema: 'Exponenciação — decaimento radioativo' } },
      { id: 't2', tema: 'Exponenciação', data: { tema: 'Exponenciação — propriedades das potências em diluições' } },
      { id: 't3', tema: '', data: { tema: 'Exponenciação em bactérias' } },
      { id: 't4', tema: '', data: { tema: 'Exponenciação em juros' } },
    ];
    const pares = auditaDiversidadeTemas();
    state.questions = salvo;
    return pares.map(p => p.replace(/\s*\(.*$/, ''));
  });
  ok(!E9.includes('1 e 2') && E9.includes('1 e 3') && E9.includes('4 e 5'), 'E9 auditoria de temas: com o mesmo tema digitado, "Exponenciação" não conta (1×2 não é par; 1×3 "propriedades das potências" é); sem tema digitado a regra antiga continua (4×5)', JSON.stringify(E9));

  // persistência: os campos vão para o arquivo (state.questions inteiro é serializado)
  const E6 = await page.evaluate(() => { const q = state.questions[6]; const j = JSON.parse(JSON.stringify({ questions: state.questions })); return j.questions[6].dominio === q.dominio && 'contextosEvitar' in j.questions[6]; });
  ok(E6, 'E6 domínio e contextos a evitar sobrevivem à serialização do simulado (arquivar/reabrir)');

  // (F) Ajustes decorrentes do teste real (10 × Exponenciação, backend v73)
  // F1 família da palavra do tema digitado: "exponencial" não conta com "Exponenciação" digitado
  const F1 = await page.evaluate(() => {
    const ig = palavrasChaveTema('Exponenciação');
    return {
      real: temasParecidos('Exponenciação — depreciação exponencial de veículos e comparação de taxas anuais', 'Exponenciação — crescimento exponencial de colônias e comparação de taxas em tabela', ig),
      semIgnorar: temasParecidos('Exponenciação — depreciação exponencial de veículos e comparação de taxas anuais', 'Exponenciação — crescimento exponencial de colônias e comparação de taxas em tabela', null),
      aindaPega: temasParecidos('Exponenciação — juros compostos em poupança', 'Exponenciação — juros compostos em financiamento', ig),
      familia: [mesmaFamiliaDePalavra('exponenciacao', 'exponencial'), mesmaFamiliaDePalavra('funcoes', 'funcao'), mesmaFamiliaDePalavra('logaritmo', 'logaritmica'), mesmaFamiliaDePalavra('energia', 'energetico'), mesmaFamiliaDePalavra('taxas', 'tabela')],
    };
  });
  ok(F1.real === false && F1.semIgnorar === true && F1.aindaPega === true && F1.familia.join() === 'true,true,true,false,false', 'F1 temas 7 e 10 do teste real (exemplos diferentes) deixam de ser "parecidos" com o tema digitado; "juros compostos" ×2 continua apontado', JSON.stringify(F1));
  // F2 leitor numérico das alternativas: moeda, milhar, sobrescrito, científica, escala, fração, decimal com zero; expressão algébrica e texto dão null
  const F2 = await page.evaluate(() => [
    valorNumericoAlternativa('R$ 10.648,00.'), valorNumericoAlternativa('R$ 10.400,00.'), valorNumericoAlternativa('1 000'), valorNumericoAlternativa('2,5 km'), valorNumericoAlternativa('2.5'),
    valorNumericoAlternativa('10³ vezes, pois…'), valorNumericoAlternativa('2¹⁴'), valorNumericoAlternativa('10⁻³ g'), valorNumericoAlternativa('3,5 × 10⁴ habitantes'), valorNumericoAlternativa('2 X 10⁻³'),
    valorNumericoAlternativa('1,2 milhão'), valorNumericoAlternativa('900 mil'), valorNumericoAlternativa('3 milhões'), valorNumericoAlternativa('−3 °C'), valorNumericoAlternativa('– 2'), valorNumericoAlternativa('0 °C.'),
    valorNumericoAlternativa('0.001'), valorNumericoAlternativa('0,125'), valorNumericoAlternativa('2.500.000'), valorNumericoAlternativa('3,14159'), valorNumericoAlternativa('12%'), valorNumericoAlternativa('1ª'),
    Math.round(valorNumericoAlternativa('1/3') * 1e6), valorNumericoAlternativa('3/4 xícara'), valorNumericoAlternativa('10 m/s'),
    valorNumericoAlternativa('2ⁿ'), valorNumericoAlternativa('2⁻ᵗ'), valorNumericoAlternativa('2ˣ'), valorNumericoAlternativa('2ⁿ⁺¹'), valorNumericoAlternativa('2 × 10ⁿ'), valorNumericoAlternativa('√2'), valorNumericoAlternativa('menor que o do modelo X'), valorNumericoAlternativa('x = 2'),
  ]);
  const F2esp = [10648, 10400, 1000, 2.5, 2.5, 1000, 16384, 0.001, 35000, 0.002, 1200000, 900000, 3000000, -3, -2, 0, 0.001, 0.125, 2500000, 3.14159, 12, 1, 333333, 0.75, 10, null, null, null, null, null, null, null, null];
  ok(JSON.stringify(F2) === JSON.stringify(F2esp), 'F2 valorNumericoAlternativa lê moeda, milhar, sobrescrito, científica, escala, fração e decimal com zero; expressão algébrica e texto dão null', JSON.stringify(F2) + ' ≠ ' + JSON.stringify(F2esp));
  // F3 rede de segurança do gabarito passa a enxergar "R$": ordem crescente respeitada → não troca (impossivel); fora de ordem → troca
  const F3 = await page.evaluate(() => {
    const ord = { A: 'R$ 100,00.', B: 'R$ 200,00.', C: 'R$ 300,00.', D: 'R$ 400,00.', E: 'R$ 500,00.' };
    const d1 = { gabarito: 'B', alternativas: Object.assign({}, ord), analiseAlternativas: {} };
    const s1 = aplicaGabaritoAlvo(d1, 'D');
    const d2 = { gabarito: 'A', alternativas: { A: 'R$ 10.648,00.', B: 'R$ 10.400,00.', C: 'R$ 11.000,00.', D: 'R$ 12.800,00.', E: 'R$ 24.000,00.' }, analiseAlternativas: {} };
    const s2 = aplicaGabaritoAlvo(d2, 'A');
    return { s1, gab1: d1.gabarito, ordenadas: alternativasNumericasOrdenadas(ord), s2, potencias: alternativasNumericasOrdenadas({ A: '10³', B: '10⁴', C: '10⁶', D: '10¹⁵', E: '10²⁰' }), algebricas: alternativasNumericasOrdenadas({ A: '2ⁿ', B: '3ⁿ', C: '4ⁿ', D: '5ⁿ', E: '6ⁿ' }), fracoes: alternativasNumericasOrdenadas({ A: '1/6', B: '1/5', C: '1/4', D: '1/3', E: '1/2' }) };
  });
  ok(F3.s1 === 'impossivel' && F3.gab1 === 'B' && F3.ordenadas === true && F3.s2 === 'ok' && F3.potencias === true && F3.algebricas === false && F3.fracoes === true, 'F3 alternativas em R$ em ordem crescente não são trocadas de lugar (Guia); potências em sobrescrito e frações são lidas; expressões algébricas não contam como numéricas', JSON.stringify(F3));
  // F4 auditoria local: Q1 e Q2 do teste real; falsos positivos do revisor (prefixo numérico igual) não disparam
  const F4 = await page.evaluate(() => {
    const mk = (gab, alts) => ({ data: { gabarito: gab, alternativas: alts, analiseAlternativas: { [gab]: { status: 'correta' } }, comando: 'x', textoBase: 'Fonte, 2024.' } });
    const t = q => auditaQuestaoLocal(q).filter(i => i.nivel === 'aviso').map(i => i.texto);
    const q1real = { A: '10³ vezes, pois a razão entre as idades resulta em uma potência cujo expoente é a soma 9 + 6.', B: '10¹⁵ vezes, pois a comparação entre as duas idades deve multiplicar diretamente os expoentes 9 e 6.', C: '10⁴ vezes, pois o expoente da razão corresponde à diferença entre o maior expoente do painel e o da estrela.', D: '10⁶ vezes, pois o valor do expoente da idade da estrela já expressa isoladamente essa proporção.', E: '10³ vezes, pois a razão entre as idades corresponde a uma potência cujo expoente é a diferença 9 − 6.' };
    return {
      q1: t(mk('E', q1real)),
      q1info: auditaQuestaoLocal(mk('E', q1real)).filter(i => i.nivel === 'info').map(i => i.texto),
      identicas: t(mk('C', { A: '10 m/s.', B: '10 m/s.', C: '12 m/s.', D: '14 m/s.', E: '16 m/s.' })),
      q2: t(mk('A', { A: 'R$ 10.648,00.', B: 'R$ 10.400,00.', C: 'R$ 11.000,00.', D: 'R$ 12.800,00.', E: 'R$ 24.000,00.' })),
      q4: t(mk('B', { A: '3.', B: '5.', C: '8.', D: '16.', E: '32.' })),
      dup: t(mk('A', { A: '2,5 km.', B: '2.5 km', C: '3 km.', D: '4 km.', E: '5 km.' })),
      fracoes: t(mk('C', { A: '1/6.', B: '1/5.', C: '1/4.', D: '1/3.', E: '1/2.' })),
      unidades: t(mk('C', { A: '10 m/s.', B: '10 km/h.', C: '10 cm/s.', D: '10 mm/s.', E: '10 m/min.' })),
      pares: t(mk('C', { A: '3 cm e 4 cm.', B: '3 cm e 5 cm.', C: '4 cm e 5 cm.', D: '4 cm e 6 cm.', E: '5 cm e 6 cm.' })),
      expressoes: t(mk('C', { A: '2x + 1.', B: '2x − 1.', C: '2x + 3.', D: '2x − 3.', E: '2x + 5.' })),
    };
  });
  ok(F4.q1.length === 0 && F4.q1info.length === 1 && /A e E repetem o mesmo valor \(10³\)/.test(F4.q1info[0]) && F4.identicas.length === 1 && /A e B são iguais/.test(F4.identicas[0]) && F4.q2.length === 1 && /fora da ordem crescente/.test(F4.q2[0]) && F4.q4.length === 0 && F4.dup.length === 1 && /A e B têm o mesmo valor/.test(F4.dup[0]) && F4.fracoes.length === 0 && F4.unidades.length === 0 && F4.pares.length === 0 && F4.expressoes.length === 0, 'F4 auditoria local: Q1 real (híbrida, 10³ em A e E) vira observação "repetem o mesmo valor", sem aviso de ordem; alternativas idênticas recebem só "são iguais"; Q2 real (R$ fora de ordem) apontada; "2,5 km"×"2.5 km" é valor repetido; frações, unidades, pares e expressões com o mesmo prefixo numérico NÃO disparam', JSON.stringify(F4));
  // F5 temas entregues idênticos continuam "parecidos"; fonte no meio do texto não conta como citação, "FONTE:" no começo da linha conta
  const F5 = await page.evaluate(() => {
    const ig = palavrasChaveTema('Exponenciação');
    const infoFonte = tb => auditaQuestaoLocal({ data: { gabarito: 'A', alternativas: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' }, analiseAlternativas: { A: { status: 'correta' } }, comando: 'x', textoBase: tb } }).some(i => /sem citação de fonte/.test(i.texto));
    return {
      identicos: temasParecidos('Exponenciação', 'Exponenciação', ig),
      identicosFamilia: temasParecidos('Exponencial', 'Exponenciais', ig),
      fonteDidatica: infoFonte('Um aplicativo monta circuitos.\n\nFONTE: elaborado para fins didáticos.'),
      elaboradoInicio: infoFonte('Texto.\n\nElaborado a partir de dados do IBGE.'),
      governo: infoFonte('O plano de metas foi elaborado pelo governo para acelerar a economia.'),
      petroleo: infoFonte('A principal fonte: o petróleo, que domina a matriz.'),
      comAno: infoFonte('SILVA, J. Obra. São Paulo: Editora, 2019.'),
      fontesPlural: infoFonte('Texto.\n\nFontes: IBGE e IPEA.'),
      fonteDeEnergia: infoFonte('Fonte de energia renovável é o que mais cresce no país.'),
    };
  });
  ok(F5.identicos === true && F5.identicosFamilia === true && F5.fonteDidatica === false && F5.elaboradoInicio === false && F5.governo === true && F5.petroleo === true && F5.comAno === false && F5.fontesPlural === false && F5.fonteDeEnergia === true, 'F5 temas idênticos são parecidos; "FONTE:"/"Elaborado a partir" no começo da linha contam como fonte, "elaborado pelo governo"/"fonte: o petróleo" no meio do texto não', JSON.stringify(F5));

  const errosReais = erros.filter(e => !/favicon|net::ERR|Failed to load resource|supabase/i.test(e));
  ok(errosReais.length === 0, 'Z sem erros de JavaScript no console', errosReais.join('\n     '));

  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await browser.close();
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
