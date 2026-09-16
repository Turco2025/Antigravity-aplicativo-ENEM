/* v18.12 — A BARRA DA RAIZ COBRE O RADICANDO INTEIRO.

   Pedido do professor, com a imagem de referência: "a barra deve começar sobre
   o 1 e se estender até o final do último zero. Não basta colocar o símbolo √
   antes do número". Até a v18.11 a barra na TELA era o combinante U+0305,
   posicionado pela fonte: nascia solta do √, alta demais e passando do último
   algarismo. Unicode não tem como acertar isso — não existe caractere que
   estique uma barra sobre um radicando de vários algarismos.

   Agora o mesmo dado (o radicando marcado com U+0305) vira marcação: a barra é
   um degradê sólido pintado sobre a caixa do radicando, então tem exatamente a
   largura dele; e a distância até o ápice do √ é medida na fonte em uso.

   Uso: node tests/verify_raiz.js <caminho absoluto do index.html> */
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
  await p.goto('file://' + INDEX); await sleep(600);

  /* ---------- (A) a marcação ---------- */
  const A = await p.evaluate(() => {
    const N = nmNormalizaTexto;
    const casos = ['√1000','√144','√123456789','√2','5√16','√(x² + 1)'];
    const out = {};
    casos.forEach(t => {
      const bruto = N(t);
      const html = mathHtml(bruto);
      const d = document.createElement('div'); d.innerHTML = html;
      const barras = Array.from(d.querySelectorAll('.rad-r')).map(e => e.textContent);
      out[t] = { html, barras, texto: d.textContent, temCombinante: /̅/.test(html) };
    });
    out.semRaiz = mathHtml('O valor de 10⁻³ é pequeno & "seguro" <b>');
    return out;
  });
  ok(A['√1000'].barras.join('|') === '1000', 'A1 √1000: o radicando sob a barra é exatamente "1000"', JSON.stringify(A['√1000']));
  ok(A['√123456789'].barras.join('|') === '123456789', 'A2 √123456789: os nove algarismos ficam sob a barra', JSON.stringify(A['√123456789'].barras));
  ok(A['5√16'].barras.join('|') === '16' && /^5/.test(A['5√16'].texto),
     'A3 5√16: o coeficiente 5 fica FORA do radical; só o 16 vai sob a barra', JSON.stringify(A['5√16']));
  ok(A['√(x² + 1)'].barras.join('|') === 'x² + 1', 'A4 √(x² + 1): a barra cobre a expressão inteira, sem os parênteses', JSON.stringify(A['√(x² + 1)'].barras));
  ok(Object.keys(A).filter(k => k !== 'semRaiz').every(k => !A[k].temCombinante),
     'A5 nenhum combinante U+0305 sobra no HTML — a barra deixou de ser desenhada com caractere');
  ok(A['√1000'].html.includes('<span class="rad"><span class="rad-s">√</span>'),
     'A6 o √ e o radicando saem num único grupo, para o CSS encostar um no outro', A['√1000'].html);
  ok(A.semRaiz === 'O valor de 10⁻³ é pequeno &amp; &quot;seguro&quot; &lt;b&gt;',
     'A7 texto sem raiz continua apenas escapado (nada de HTML injetado)', A.semRaiz);

  /* ---------- (B) geometria: a barra cobre o radicando e encosta no √ ---------- */
  const B = await p.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:900px;text-align:justify;font-size:14px;';
    host.innerHTML = 'Medidas ' + mathHtml(nmNormalizaTexto('√1000')) + ', ' +
                     mathHtml(nmNormalizaTexto('√123456789')) + ' e ' +
                     mathHtml(nmNormalizaTexto('√2')) + ' registradas em campo pelo tecnico responsavel pela obra.';
    document.body.appendChild(host);
    const medidas = Array.from(host.querySelectorAll('.rad')).map(rad => {
      const s = rad.querySelector('.rad-s'), r = rad.querySelector('.rad-r');
      const R = rad.getBoundingClientRect(), S = s.getBoundingClientRect(), Q = r.getBoundingClientRect();
      // largura "fantasma": quanto a caixa do grupo passa da soma das partes
      const fantasma = R.width - (Q.right - S.left);
      // largura do texto do radicando, medida à parte
      const c = document.createElement('canvas').getContext('2d');
      const cs = getComputedStyle(r);
      c.font = cs.fontSize + ' ' + cs.fontFamily;
      const larguraTexto = c.measureText(r.textContent).width;
      return { texto: r.textContent, fantasma: +fantasma.toFixed(2),
               sobraDaBarra: +(Q.width - larguraTexto).toFixed(2), larguraTexto: +larguraTexto.toFixed(2) };
    });
    const bp = getComputedStyle(document.documentElement).getPropertyValue('--rad-bp').trim();
    const k = getComputedStyle(document.documentElement).getPropertyValue('--rad-k').trim();
    host.remove();
    return { medidas, bp, k };
  });
  ok(B.medidas.every(m => Math.abs(m.fantasma) < 1),
     'B1 em parágrafo justificado a raiz não ganha largura fantasma — nada é esticado dentro dela', JSON.stringify(B.medidas));
  ok(B.medidas.every(m => m.sobraDaBarra >= 0 && m.sobraDaBarra <= 0.30 * m.larguraTexto / m.texto.length + 4),
     'B2 a barra tem a largura do radicando (só o respiro de padding), em 1, 4 e 9 algarismos', JSON.stringify(B.medidas));
  ok(/^0\.\d+em$/.test(B.bp), 'B3 a calibração gravou --rad-bp em em', B.bp);
  ok(/^1(\.\d+)?em$/.test(B.k) || /^1(\.\d+)?$/.test(B.k), 'B4 a calibração gravou --rad-k (esticamento do √) ≥ 1', B.k);

  /* ---------- (C) a barra fica ACIMA dos algarismos e NO ápice do √ ---------- */
  const C = await p.evaluate(() => {
    const px = 100;
    const fam = getComputedStyle(document.body).fontFamily;
    const c = document.createElement('canvas').getContext('2d');
    c.font = px + 'px ' + fam;
    const asc = c.measureText('√').fontBoundingBoxAscent;
    let apex = 0, topo = 0;
    ['', '600 ', 'bold '].forEach(w => { c.font = w + px + 'px ' + fam;
      apex = Math.max(apex, c.measureText('√').actualBoundingBoxAscent);
      topo = Math.max(topo, c.measureText('0123456789').actualBoundingBoxAscent); });
    const bp = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rad-bp')) * px;
    const k  = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rad-k')) || 1;
    const barra = asc - bp;              // altura da barra acima da linha de base
    return { barra: +barra.toFixed(1), topoDigitos: +topo.toFixed(1), apexEsticado: +(apex * k).toFixed(1), apex: +apex.toFixed(1), k: +k.toFixed(4) };
  });
  ok(C.barra > C.topoDigitos, 'C1 a barra passa ACIMA do topo dos algarismos — nunca corta o radicando', JSON.stringify(C));
  ok(Math.abs(C.barra - C.apexEsticado) <= 2.5,
     'C2 a barra encosta no ápice do √ (o sinal é esticado quando a fonte tem radical curto)', JSON.stringify(C));
  ok(C.k >= 1 && C.k <= 1.35, 'C3 o esticamento do √ fica em limites discretos', JSON.stringify(C));

  /* ---------- (D) as quatro saídas ---------- */
  const D = await p.evaluate(() => {
    const N = nmNormalizaTexto;
    return {
      tela: ['buildQuestionBody'].every(f => /mathHtml/.test(window[f].toString())),
      impressao: /radicaisEmHtml/.test(enemPrintRich.toString()),
      cssImpressao: /rad-r\{/.test(ENEM_PRINT_CSS.replace(/\s/g, '')) && /--rad-bp/.test(ENEM_PRINT_CSS),
      scriptImpressao: /rad-bp/.test(CALIBRA_RAIZ_JS) && /rad-k/.test(CALIBRA_RAIZ_JS),
      pdfComGlifos: /̅/.test(N('√144')) && pdfRadicalComBarra(N('√144')) !== N('√144'),
    };
  });
  ok(D.tela, 'D1 a tela monta o corpo da questão com mathHtml');
  ok(D.impressao, 'D2 a impressão usa a mesma conversão (radicaisEmHtml)');
  ok(D.cssImpressao, 'D3 o documento de impressão leva o CSS da barra e a variável de calibração');
  ok(D.scriptImpressao, 'D4 o documento de impressão leva o calibre embutido — funciona fora do app');
  ok(D.pdfComGlifos, 'D5 o PDF continua usando os glifos pré-compostos da fonte do caderno (caminho intocado)');

  /* ---------- (E) no cartão de verdade ---------- */
  const E = await p.evaluate(() => {
    const N = nmNormalizaTexto;
    state.area = 'matematica'; state.disciplina = 'Matemática'; state.viewMode = 'professor'; setQty(1);
    const q = state.questions[0];
    q.status = 'done'; q.recurso = 'nenhum';
    q.data = { tema:'Radiciação', dificuldade:'Médio', competencia:{numero:1,texto:'C'}, habilidade:{codigo:'H1',texto:'H'},
      objetoConhecimento:'Radiciação', textoBase:N('Medidas √1000 e √144.'), comando:N('O valor de 5√16 é'),
      alternativas:{A:N('√2'),B:N('√144'),C:N('√1000'),D:N('√123456789'),E:N('5√16')}, gabarito:'C',
      resolucaoComentada:N('Como √144 = 12, o valor é √1000.'),
      analiseAlternativas:{A:{status:'incorreta',comentario:N('Confunde √2.')},B:{status:'incorreta',comentario:'x'},
        C:{status:'correta',comentario:N('√1000 é o certo.')},D:{status:'incorreta',comentario:'x'},E:{status:'incorreta',comentario:'x'}} };
    const card = renderQuestionCard(q, 0);
    const host = document.createElement('div'); host.style.cssText='position:fixed;left:-9999px;top:0;width:900px;';
    host.appendChild(card); document.body.appendChild(host);
    const r = {
      barras: host.querySelectorAll('.rad-r').length,
      combinanteNoTexto: /̅/.test(host.textContent),
      textoBase: (host.querySelector('.texto-base') || {}).textContent || '',
      alternativaC: Array.from(host.querySelectorAll('.alt-item')).map(i => i.textContent).join(''),
    };
    host.remove();
    return r;
  });
  ok(E.barras >= 9, 'E1 o cartão renderiza a barra em texto-base, comando, alternativas, comentários e resolução', 'barras=' + E.barras);
  ok(!E.combinanteNoTexto, 'E2 nenhum combinante U+0305 chega ao texto da tela');
  ok(/√1000 e √144/.test(E.textoBase), 'E3 o texto lido continua legível e sem lixo', E.textoBase);

  ok(erros.length === 0, 'F1 nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
