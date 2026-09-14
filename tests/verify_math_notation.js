// v16 — Notação matemática em Unicode: teste de ponta a ponta no navegador, SEM rede.
// Cobre: (A) o core colado no app.js dá o MESMO resultado dos casos compartilhados
// (nm/casos_notacao.json, os mesmos do backend); (B) um simulado arquivado ANTES da
// v16 (com Q0, 2^4, 10^9, "4,6 x 10^9") sai corrigido ao ser reaberto, e a
// verificação por questão aponta o que sobrou em ASCII; (C) uma questão de
// Linguagens passa intacta; (D) a fonte do PDF (Carlito ampliada) cobre 2ˣ e aₙ e
// o jsPDF (o mesmo 4.2.1 do app) gera um PDF de que o texto volta idêntico.
//
// Uso: node tests/verify_math_notation.js [caminho/para/index.html]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const CASOS = path.resolve(__dirname, '..', 'nm', 'casos_notacao.json');
const JSPDF = [
  path.resolve(__dirname, '..', 'fontwork', 'jstest', 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
  path.resolve(__dirname, '..', 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
].find(p => fs.existsSync(p));
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };

// Simulado como o de 13/09/2026 (Matemática), com os padrões reais do modelo.
const SIMULADO = {
  id: 'sim-1', nome: 'Simulado de Matemática — Potenciação', area: 'matematica', disciplina: 'Matemática', validacao_dupla: false,
  dados: {
    area: 'matematica', disciplina: 'Matemática', qty: 2,
    questions: [
      { status: 'done', recurso: 'nenhum', dificuldade: 'Médio', data: {
        area: 'matematica', disciplina: 'Matemática', tema: 'Meia-vida', dificuldade: 'Médio', recurso: 'nenhum', visual: null,
        competencia: { numero: 5, texto: 'Modelar e resolver problemas' }, habilidade: { codigo: 'H21', texto: 'Resolver situação-problema' }, objetoConhecimento: 'Função exponencial',
        textoBase: 'A quantidade ativa é dada pela expressão\n\nQ(t) = Q0 · 2^(-t/T)\n\nem que Q0 é a quantidade inicial. Após 9 horas, restava exatamente Q0 · 2^(-3/2) do material.\n\nDisponível em: https://exemplo.org/Q0_2^3. Acesso em: 10 set. 2026.',
        comando: 'A meia-vida T do radiofármaco, em horas, é', alternativas: { A: '3', B: '4,5', C: '6', D: '9', E: '13,5' }, gabarito: 'C',
        resolucaoComentada: 'Como Q(t) = Q0·2^(-t/T) e a fração foi Q0·2^(-3/2), igualam-se os expoentes: 9/T = 3/2, logo T = 6 horas.',
        analiseAlternativas: { A: { status: 'incorreta', comentario: 'Erro de processo.' }, B: { status: 'incorreta', comentario: 'Erro de processo.' }, C: { status: 'correta', comentario: 'Igualando os expoentes (pois Q0·2^(-9/T) = Q0·2^(-3/2)), obtém-se T = 6.' }, D: { status: 'incorreta', comentario: 'Verdade parcial.' }, E: { status: 'incorreta', comentario: 'Verdade parcial.' } },
      } },
      { status: 'done', recurso: 'nenhum', dificuldade: 'Fácil', data: {
        area: 'matematica', disciplina: 'Matemática', tema: 'Notação científica', dificuldade: 'Fácil', recurso: 'nenhum', visual: null,
        competencia: { numero: 1, texto: 'Construir significados para os números' }, habilidade: { codigo: 'H3', texto: 'Resolver situação-problema' }, objetoConhecimento: 'Números reais',
        textoBase: 'Formação da Terra: 4,6 x 10^9 anos atrás. Surgimento dos primeiros répteis: 3,2 x 10^8 anos atrás. A área do sítio é de 5 m2.',
        comando: 'A razão entre os dois intervalos de tempo corresponde a', alternativas: { A: '1,4', B: '14', C: '140', D: '1400', E: '14000' }, gabarito: 'B',
        resolucaoComentada: '(4,6 x 10^9) / (3,2 x 10^8). Dividindo as potências de 10, 10^9/10^8 = 10. Multiplicando os resultados parciais, 1,4 x 10 = 14.',
        analiseAlternativas: { A: { status: 'incorreta', comentario: 'Esquece o fator 10.' }, B: { status: 'correta', comentario: 'Correto: 2^4 x 3^2 = 144 não se aplica aqui, mas 1,4 x 10 = 14.' }, C: { status: 'incorreta', comentario: 'Erro de processo.' }, D: { status: 'incorreta', comentario: 'Erro de processo.' }, E: { status: 'incorreta', comentario: 'Erro de processo.' } },
      } },
    ],
  },
};
const LINGUAGENS = { data: {
  area: 'linguagens', disciplina: 'Língua Portuguesa', tema: 'Modernismo', textoBase: 'O poema, publicado em 1922, dialoga com a Semana de Arte Moderna. O eu lírico afirma: "sou 300, sou 350". Veja o item 3 x 4 do edital e a hashtag #enem_2024 e o usuário @joao_2.',
  comando: 'O verso destaca', alternativas: { A: 'a multiplicidade do sujeito_lírico', B: 'o rigor formal', C: 'a métrica clássica', D: 'o tom épico', E: 'a rima_2' }, gabarito: 'A',
  resolucaoComentada: 'O texto trata da pluralidade do eu (H20). A obra F1 não é citada.', fonte: 'ANDRADE, M. Paulicéia Desvairada, 1922. Disponível em: https://x.org/a_1^2.',
} };

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
  await page.addInitScript((f) => { window.__fake = f; }, { session: SESSAO, simulado: SIMULADO });
  const jspdfSrc = JSPDF ? fs.readFileSync(JSPDF, 'utf8') : '';
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(/supabase-js/.test(url)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(/jspdf/i.test(url) && jspdfSrc) return route.fulfill({ status: 200, contentType: 'application/javascript', body: jspdfSrc });
    if(route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  await page.goto('file://' + INDEX);
  await page.waitForSelector('#waBox');
  await sleep(300);

  // ---- (A) o core do app dá o mesmo resultado dos casos compartilhados
  const casos = JSON.parse(fs.readFileSync(CASOS, 'utf8'));
  const resA = await page.evaluate((casos) => {
    const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const falhas = [];
    for(const c of casos.texto){ const esp = c.igual ? c.in : c.out; const s = nmNormalizaTexto(c.in); if(s !== esp || nmNormalizaTexto(s) !== s) falhas.push('texto ' + c.n + ' → ' + s); }
    for(const c of casos.questao){ const esp = c.igual ? c.in : c.out; const s = nmNormalizaQuestao(c.in, c.disciplina); if(!igual(s, esp)) falhas.push('questao ' + c.n); }
    for(const c of casos.auditoria){ if(!igual(nmAudita(c.in), c.achados)) falhas.push('auditoria ' + c.in); }
    return { n: casos.texto.length + casos.questao.length + casos.auditoria.length, falhas };
  }, casos);
  ok(resA.falhas.length === 0, `A: os ${resA.n} casos compartilhados passam no núcleo colado no app`, resA.falhas.join(' | '));

  // ---- (B) simulado arquivado antes da v16 é corrigido ao reabrir
  await page.evaluate(async () => { await abrirSimuladoSalvo('sim-1'); });
  await sleep(500);
  const resB = await page.evaluate(() => {
    const q1 = state.questions[0].data, q2 = state.questions[1].data;
    const painel = document.getElementById('resultsPanel').innerText;
    return {
      tb1: q1.textoBase, rc1: q1.resolucaoComentada, comC: q1.analiseAlternativas.C.comentario, fonteIntacta: /https:\/\/exemplo\.org\/Q0_2\^3/.test(q1.textoBase),
      tb2: q2.textoBase, rc2: q2.resolucaoComentada, comB: q2.analiseAlternativas.B.comentario,
      painelTemQ0: painel.includes('Q₀'), painelTem10e9: painel.includes('4,6 × 10⁹'), painelTemCaret: /Q0 ·|Q0·|10\^9|x 10\^|\b5 m2\b|2\^4/.test(painel),
      avisos1: auditaQuestaoLocal(state.questions[0]).map(i => i.texto), avisos2: auditaQuestaoLocal(state.questions[1]).map(i => i.texto),
      visualIdentidade: state.questions[0].data.visual === null,
    };
  });
  ok(resB.tb1.includes('Q(t) = Q₀ · 2^(-t/T)') && resB.tb1.includes('em que Q₀ é'), 'B1: Q0 → Q₀ no texto-base, unificado na questão; 2^(-t/T) fica (fração no expoente)', resB.tb1);
  ok(resB.fonteIntacta, 'B1: a URL da fonte dentro do texto-base não foi tocada');
  ok(resB.rc1.includes('Q₀·2^(-t/T)') && resB.comC.includes('Q₀·2^(-9/T)'), 'B1: resolução e comentário unificados (Q₀)');
  ok(resB.tb2.includes('4,6 × 10⁹ anos') && resB.tb2.includes('3,2 × 10⁸') && resB.tb2.includes('5 m²'), 'B2: 4,6 x 10^9 → 4,6 × 10⁹; 5 m2 → 5 m²', resB.tb2);
  ok(resB.rc2.includes('(4,6 × 10⁹) / (3,2 × 10⁸)') && resB.rc2.includes('10⁹/10⁸ = 10') && resB.rc2.includes('1,4 × 10 = 14'), 'B2: resolução inteira em Unicode', resB.rc2);
  ok(resB.comB.includes('2⁴ × 3² = 144'), 'B2: comentário da alternativa: 2^4 x 3^2 → 2⁴ × 3²', resB.comB);
  ok(resB.painelTemQ0 && resB.painelTem10e9 && !resB.painelTemCaret, 'B: o painel renderizado mostra Q₀ e 4,6 × 10⁹, sem Q0/10^9/m2', String(resB.painelTemCaret));
  ok(resB.avisos1.some(t => /Notação matemática: expoente com acento circunflexo/.test(t)), 'B1: a verificação aponta o ^ que sobrou (2^(-t/T))', resB.avisos1.join(' | '));
  ok(!resB.avisos2.some(t => /Notação matemática/.test(t)), 'B2: nenhum aviso de notação depois da correção', resB.avisos2.join(' | '));

  // ---- (C) Linguagens passa intacta
  const resC = await page.evaluate((q) => {
    state.disciplina = 'Língua Portuguesa'; state.area = 'linguagens';
    const antes = JSON.stringify(q.data);
    nmAplicaNaQuestao(q);
    return { igual: JSON.stringify(q.data) === antes, depois: JSON.stringify(q.data), avisos: auditaQuestaoLocal(q).filter(i => /Notação/.test(i.texto)).map(i => i.texto) };
  }, LINGUAGENS);
  ok(resC.igual, 'C: questão de Linguagens (item 3 x 4, #enem_2024, @joao_2, sujeito_lírico, rima_2, F1, H20) sai byte a byte igual', resC.depois);
  ok(resC.avisos.length === 0, 'C: nenhum aviso de notação em Linguagens', resC.avisos.join(' | '));

  // ---- (D) fonte do PDF: cobertura e geração real com o jsPDF do app
  const resD = await page.evaluate(async () => {
    try{ await loadScriptOnce(CDN_URLS.jspdf); }catch(e){ /* sem jsPDF local: o teste pula a geração */ }
    const cob = new Set(Array.from(CARLITO_COBERTURA));
    const precisa = 'x²2ˣ10⁻³aₙSₙ2ⁿ⁻¹eᵏᵗ(1+i)ᵗQ₀xᵢAₜPₘₐₓvₒH₂SO₄⇌SO₄²⁻2ᴬvₖlog₂';
    const faltam = Array.from(new Set(Array.from(precisa).filter(ch => !cob.has(ch))));
    let saneado = null, radicalPua = null, temJsPdf = !!(window.jspdf && window.jspdf.jsPDF), registrou = false, pdfB64 = null;
    try{
      if(temJsPdf){
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
        registrou = enemRegistraFontes(doc);
        saneado = pdfSanitizeText('x² 2ˣ 10⁻³ aₙ Sₙ 2ⁿ⁻¹ eᵏᵗ (1 + i)ᵗ Q₀ H₂SO₄ ⇌ SO₄²⁻');
        doc.setFont(ENEM.fonte, 'normal'); doc.setFontSize(12); doc.text(saneado, 40, 60);
        doc.setFont(ENEM.fonte, 'bold'); doc.text(saneado, 40, 80);
        doc.setFont(ENEM.fonte, 'italic'); doc.text(saneado, 40, 100);
        doc.setFont(ENEM.fonte, 'bolditalic'); doc.text(saneado, 40, 120);
        // radical com barra: cada par "caractere + U+0305" vira o glifo pré-composto (U+E100…)
        const rad = pdfSanitizeText('√1\u03050\u03050\u03050\u0305 = 10√1\u03050\u0305 e √x\u0305²\u0305 \u0305+\u0305 \u03051\u0305');
        radicalPua = rad;
        doc.setFont(ENEM.fonte, 'normal'); doc.text(rad, 40, 150);
        pdfB64 = doc.output('datauristring').split(',')[1];
      }
    }catch(e){ saneado = 'erro: ' + e.message; }
    return { faltam, temJsPdf, registrou, saneado, pdfB64, radicalPua, cobreU0305: cob.has('\u0305'), cobrePua: cob.has('\uE100') && cob.has('\uE15E') };
  });
  ok(resD.faltam.length === 0, 'D: CARLITO_COBERTURA cobre letras sobrescritas e subscritas', 'faltam: ' + resD.faltam.join(' '));
  if(resD.temJsPdf){
    ok(resD.registrou === true, 'D: enemRegistraFontes embarca as quatro faces ampliadas no jsPDF');
    // quiJuntaFormula troca por NBSP o espaço depois de ⇌ (para a equação não quebrar de linha) — comportamento anterior, esperado.
    ok(resD.saneado.replace(/\u00a0/g, ' ') === 'x² 2ˣ 10⁻³ aₙ Sₙ 2ⁿ⁻¹ eᵏᵗ (1 + i)ᵗ Q₀ H₂SO₄ ⇌ SO₄²⁻', 'D: pdfSanitizeText não substitui nem apaga nenhum caractere novo', JSON.stringify(resD.saneado));
    const pdfPath = path.join(require('os').tmpdir(), 'verify_math_notation.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(resD.pdfB64, 'base64'));
    let texto = '';
    try{ texto = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString('utf8'); }catch(e){ texto = 'pdftotext indisponível'; }
    const linhas = texto.split('\n').filter(l => l.trim());
    ok(linhas.length >= 4 && linhas.slice(0, 4).every(l => l.trim() === 'x² 2ˣ 10⁻³ aₙ Sₙ 2ⁿ⁻¹ eᵏᵗ (1 + i)ᵗ Q₀ H₂SO₄ ⇌ SO₄²⁻'), 'D: o texto extraído do PDF volta idêntico nas quatro faces', linhas.slice(0, 4).join(' / '));
    ok(resD.cobreU0305 && resD.cobrePua, 'D: a fonte cobre o combinante U+0305 e os 95 glifos pré-compostos do radical');
    ok(resD.radicalPua.startsWith('√' + String.fromCharCode(0xE101, 0xE100, 0xE100, 0xE100) + ' = 10√' + String.fromCharCode(0xE101, 0xE100)) && !/\u0305|\u25A1/.test(resD.radicalPua), 'D: pdfSanitizeText troca "dígito + U+0305" pelo glifo pré-composto, sem sobras nem □', JSON.stringify(resD.radicalPua));
  } else {
    console.log('SKIP D: jsPDF local não encontrado (fontwork/jstest/node_modules) — geração do PDF não testada');
  }

  // ---- (E) avisos falsos que a revisão apontou: química só em Natureza; ⁻¹ é expoente
  const resE = await page.evaluate(() => {
    const avisos = (area, disciplina, data) => { state.area = area; state.disciplina = disciplina; return auditaQuestaoLocal({ data }).map(i => i.texto).filter(t => /Notação/.test(t)); };
    return {
      humanas: avisos('humanas', 'Geografia', { textoBase: 'A COP30 em Belém discutiu o agregado M2 e a banda U2 lançou um MP3; vitamina B12 e o caça F16.', comando: 'x', alternativas: { A: 'PS5' }, resolucaoComentada: 'Nada.' }),
      matExpoente: avisos('matematica', 'Matemática', { textoBase: 'Temos (1/2)⁻⁵ = 2⁵ e f⁻¹(x) e a⁻¹.', comando: 'x', alternativas: { A: '2⁻⁵' }, resolucaoComentada: 'R = 8,31 J·mol⁻¹·K⁻¹.' }),
      fisicaKelvin: avisos('natureza', 'Física', { textoBase: 'R = 8,31 J·mol⁻¹·K⁻¹ e s⁻¹.', comando: 'x', alternativas: {}, resolucaoComentada: 'ok' }),
      quimicaCargaErrada: avisos('natureza', 'Química', { textoBase: 'O íon Ca⁺² e o SO₄⁻² reagem.', comando: 'x', alternativas: {}, resolucaoComentada: 'ok' }),
      quimicaMutilada: avisos('natureza', 'Química', { textoBase: 'A molécula H2SO4 é forte.', comando: 'x', alternativas: {}, resolucaoComentada: 'ok' }),
      glifoForaMat: avisos('matematica', 'Matemática', { textoBase: 'x ∈ ℝ', comando: 'x', alternativas: {}, resolucaoComentada: 'ok' }),
    };
  });
  ok(resE.humanas.length === 0, 'E: Humanas (COP30, M2, U2, MP3, B12, F16, PS5) não recebe aviso químico', resE.humanas.join(' | '));
  ok(resE.matExpoente.length === 0, 'E: Matemática ((1/2)⁻⁵, f⁻¹, mol⁻¹·K⁻¹) não recebe aviso de carga', resE.matExpoente.join(' | '));
  ok(resE.fisicaKelvin.length === 0, 'E: Física (J·mol⁻¹·K⁻¹, s⁻¹) não recebe aviso de carga', resE.fisicaKelvin.join(' | '));
  ok(resE.quimicaCargaErrada.some(t => /sinal antes do número da carga/.test(t)), 'E: Química ainda acusa Ca⁺² / SO₄⁻²', resE.quimicaCargaErrada.join(' | '));
  ok(resE.quimicaMutilada.some(t => /índice em algarismo comum/.test(t)), 'E: Química ainda acusa H2SO4', resE.quimicaMutilada.join(' | '));
  ok(resE.glifoForaMat.some(t => /sem glifo/.test(t)), 'E: Matemática recebe aviso de glifo fora da fonte (∈ ℝ)', resE.glifoForaMat.join(' | '));

  ok(erros.length === 0, 'sem erros no console', erros.join(' | '));
  await browser.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
