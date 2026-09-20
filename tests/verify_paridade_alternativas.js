// v18.3 — paridade das alternativas na "Auditoria local (sem custo)": a alternativa correta
// não pode ser a mais longa, e as cinco devem ter extensão equivalente (Guia do Inep).
// Roda a auditoria REAL do app sobre as 20 questões REAIS já geradas (10 de Matemática em
// fixtures/teste_real_v73 e 10 de Biologia em fixtures/teste_real_v74_2) e sobre casos
// sintéticos de fronteira. Sem rede.
// Uso: node tests/verify_paridade_alternativas.js [caminho/para/index.html]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const FIXV73 = path.resolve(__dirname, 'fixtures', 'teste_real_v73');
const FIXV742 = path.resolve(__dirname, 'fixtures', 'teste_real_v74_2');

let total = 0, falhas = 0;
function ok(cond, msg, extra){ if(cond){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

const mat = [];
for(let i = 1; i <= 10; i++){
  const d = JSON.parse(fs.readFileSync(path.join(FIXV73, `q${String(i).padStart(2, '0')}.json`), 'utf8'));
  const q = d.question || d;
  mat.push({ nome: `Mat q${String(i).padStart(2, '0')}`, alt: q.alternativas, gab: q.gabarito });
}
const bio = JSON.parse(fs.readFileSync(path.join(FIXV742, 'questoes_biologia.json'), 'utf8'))
  .map(q => ({ nome: `Bio q${String(q.n).padStart(2, '0')}`, alt: q.alt, gab: q.gab }));
const reais = mat.concat(bio);

/* Casos de fronteira construídos à mão. Os limiares NÃO foram escolhidos para calar o teste:
   1,25x vem da paridade que o prompt do backend pede (v74.3) e 1,30x é essa mesma paridade com
   tolerância. Nas 20 questões reais isso aponta Bio q07 e q10 (gabarito se denunciando) e Bio q04
   (as cinco desiguais) — e deixa Mat q03 de fora por pouco (1,29x), o que é o comportamento
   desejado para uma questão em que o gabarito nem é a maior. */
const txt = n => 'a'.repeat(n);
const sinteticos = [
  { nome: 'curtas com razão alta (30 a 48) — não deve apontar nada', alt: { A: txt(30), B: txt(34), C: txt(38), D: txt(42), E: txt(48) }, gab: 'E', esperado: null },
  { nome: 'correta 30% maior que a segunda — aviso', alt: { A: txt(150), B: txt(160), C: txt(170), D: txt(180), E: txt(240) }, gab: 'E', esperado: 'aviso' },
  /* v18.24 — o limiar da observação de paridade está em 1,60, medido nas QUATRO
     PROVAS RECENTES (2022-2025, subconjunto limpo, menor > 40): p50 1,25 ·
     p75 1,41 · p90 1,57 · p95 1,63. Acima de 1,30 estão 41% das questões REAIS
     e acima de 1,50 ainda 15% — por isso 1,30 e 1,50 eram apertados demais. */
  { nome: 'correta 10% acima da segunda, conjunto 1,32x — normal no ENEM real, nada', alt: { A: txt(150), B: txt(160), C: txt(170), D: txt(180), E: txt(198) }, gab: 'E', esperado: null },
  { nome: 'correta 10% acima da segunda, conjunto 1,22x — nada', alt: { A: txt(162), B: txt(170), C: txt(175), D: txt(180), E: txt(198) }, gab: 'E', esperado: null },
  { nome: 'conjunto 1,74x sem favorecer o gabarito — acima do p90 real (1,57), sai a observação', alt: { A: txt(270), B: txt(160), C: txt(155), D: txt(158), E: txt(162) }, gab: 'C', esperado: 'info' },
  { nome: 'conjunto 1,55x sem favorecer o gabarito — ainda dentro do ENEM real, nada', alt: { A: txt(240), B: txt(160), C: txt(155), D: txt(158), E: txt(162) }, gab: 'C', esperado: null },
  { nome: 'conjunto 1,45x sem favorecer o gabarito — normal no ENEM, nada', alt: { A: txt(232), B: txt(170), C: txt(160), D: txt(165), E: txt(168) }, gab: 'C', esperado: null },
  { nome: 'cinco iguais — nada', alt: { A: txt(120), B: txt(120), C: txt(120), D: txt(120), E: txt(120) }, gab: 'B', esperado: null },
  // regime longo: a correta passa de todos os distratores por 96 caracteres, mas só 1,24x —
  // com "e" entre razão e margem isso escapava das duas checagens (achado da revisão)
  { nome: 'correta +96 caracteres mas só 1,24x — aviso pela margem absoluta', alt: { A: txt(380), B: txt(390), C: txt(400), D: txt(404), E: txt(500) }, gab: 'E', esperado: 'aviso' },
  { nome: 'correta +20 caracteres e 1,05x — nada', alt: { A: txt(380), B: txt(390), C: txt(400), D: txt(404), E: txt(424) }, gab: 'E', esperado: null },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.fulfill({ status: 204, body: '' }));
  await page.goto('file://' + INDEX);
  await page.waitForTimeout(700);

  const roda = casos => page.evaluate((casos) => {
    state.area = 'natureza'; state.disciplina = 'Biologia';
    return casos.map(c => {
      const q = { tema: 'x', recurso: 'nenhum', dificuldade: 'Médio', data: {
        tema: 'x', comando: 'Comando da questão.', textoBase: 'Texto-base. Disponível em: https://exemplo.gov.br. Acesso em: 15 set. 2026.',
        alternativas: c.alt, gabarito: c.gab, recurso: 'nenhum', visual: null,
        analiseAlternativas: Object.fromEntries(['A','B','C','D','E'].map(L => [L, { status: L === c.gab ? 'correta' : 'incorreta', comentario: 'y' }])) } };
      const itens = auditaQuestaoLocal(q).filter(i => /paridade|mais longa|extensões desiguais/i.test(i.texto));
      return { nome: c.nome, nivel: itens.length ? itens[0].nivel : null, texto: itens.length ? itens[0].texto : '' };
    });
  }, casos);

  const r = await roda(reais);
  const avisos = r.filter(x => x.nivel === 'aviso').map(x => x.nome);
  const infos = r.filter(x => x.nivel === 'info').map(x => x.nome);
  ok(JSON.stringify(avisos) === JSON.stringify(['Bio q07', 'Bio q10']),
    'R1 nas 20 questões reais, o alerta sai exatamente nas duas em que o gabarito se denuncia (Bio q07 e q10)', JSON.stringify(avisos));
  /* v18.23: Bio q04 tem 102 contra 76 caracteres — razão 1,34, abaixo do p75 das
     provas oficiais (1,37). Com o limiar medido, nenhuma das 20 questões reais
     merece a observação de paridade: elas já são tão uniformes quanto o ENEM. */
  ok(infos.length === 0,
    'R2 com o limiar medido (1,50), nenhuma das 20 questões reais é apontada por desigualdade — a maior razão é 1,34, abaixo do p75 do ENEM', JSON.stringify(infos));
  const q07 = r.find(x => x.nome === 'Bio q07');
  ok(/261 caracteres contra 199/.test(q07.texto), 'R3 a mensagem mostra os números que o professor precisa ver', q07.texto);

  const s = await roda(sinteticos);
  s.forEach(x => {
    const esperado = sinteticos.find(c => c.nome === x.nome).esperado;
    ok(x.nivel === esperado, `S ${x.nome}`, `nível=${x.nivel} esperado=${esperado} · ${x.texto}`);
  });

  // a checagem antiga (1,6x a média) não apontava nenhuma das 20 — registro do porquê da mudança
  const antigo = await page.evaluate((casos) => casos.map(c => {
    const g = c.alt[c.gab].length;
    const outras = ['A','B','C','D','E'].filter(k => k !== c.gab).map(k => c.alt[k].length);
    const media = outras.reduce((a, b) => a + b, 0) / outras.length;
    return g > 1.6 * media && g > 40;
  }).filter(Boolean).length, reais);
  ok(antigo === 0, 'R4 o critério anterior (1,6x a média) não apontaria nenhuma das 20 — era código morto', String(antigo));

  // o supabase-js não carrega neste harness mínimo (toda a rede devolve 204) — esse erro é do ambiente, não do app
  const reaisErros = erros.filter(e => !/createClient|supabase|favicon|net::ERR|Failed to load resource/i.test(e));
  ok(reaisErros.length === 0, 'Z sem erros de JavaScript', reaisErros.join('\n'));
  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await browser.close();
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
