/* v18.5 — o nível de dificuldade nunca se repete em questões seguidas.
   Exigência do professor: gerando em bloco, nunca duas (nem três, nem quatro)
   questões seguidas do mesmo nível. Até a v18.4 a ordem era só embaralhada, e
   embaralhar não impede repetição: medido, 89,5% das levas de 9 questões (3/3/3)
   saíam com pelo menos um par seguido.
   Limite aritmético: intercalando, um nível ocupa no máximo ⌈n/2⌉ posições. Acima
   disso a repetição é inevitável — o app avisa com o número exato em vez de fingir.
   Uso: node tests/verify_niveis_alternados.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Stub do supabase-js: esta prova é só das funções de distribuição, mas a página
// precisa do createClient para terminar o init sem erro.
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

  // ---------- (A) toda contagem possível de 2 a 20 questões ----------
  const A = await p.evaluate(() => {
    let casos = 0, quebras = [], acimaDoMinimo = [];
    for(let n = 2; n <= 20; n++){
      for(let f = 0; f <= n; f++) for(let m = 0; m + f <= n; m++){
        const d = n - f - m, c = { "Fácil": f, "Médio": m, "Difícil": d };
        casos++;
        const possivel = niveisPodemAlternar(c, n), minimo = repeticoesInevitaveis(c, n);
        for(let t = 0; t < (n <= 8 ? 120 : 40); t++){
          const plano = distribuiNiveis(c);
          const cc = { "Fácil": 0, "Médio": 0, "Difícil": 0 };
          plano.forEach(x => cc[x]++);
          if(plano.length !== n || cc["Fácil"] !== f || cc["Médio"] !== m || cc["Difícil"] !== d){ quebras.push("contagem " + JSON.stringify(c)); break; }
          const rep = paresSeguidos(plano);
          if(possivel && rep !== 0){ quebras.push(JSON.stringify(c) + " -> " + plano.join(",")); break; }
          if(!possivel && rep !== minimo){ acimaDoMinimo.push(JSON.stringify(c) + " rep=" + rep + " min=" + minimo); break; }
        }
      }
    }
    return { casos, quebras, acimaDoMinimo };
  });
  ok(A.quebras.length === 0, `A1 nenhuma repetição quando é possível alternar (${A.casos} contagens de 2 a 20 questões)`, A.quebras.slice(0, 3).join(' | '));
  ok(A.acimaDoMinimo.length === 0, 'A2 quando é impossível alternar, a ordem atinge o mínimo teórico de repetições', A.acimaDoMinimo.slice(0, 3).join(' | '));

  // ---------- (B) a divisão igual (o botão "Distribuir igualmente") nunca repete ----------
  const B = await p.evaluate(() => {
    const saida = {};
    for(const n of [3, 5, 6, 7, 9, 10, 12, 15, 20]){
      const c = contagemIgual(n);
      let pior = 0;
      for(let t = 0; t < 1500; t++) pior = Math.max(pior, paresSeguidos(distribuiNiveis(c)));
      saida[n] = pior;
    }
    return saida;
  });
  ok(Object.values(B).every(x => x === 0), 'B1 divisão igual: 0 repetições em 1500 sorteios para 3, 5, 6, 7, 9, 10, 12, 15 e 20 questões', JSON.stringify(B));

  // ---------- (C) a ordem continua sorteada (não vira um padrão fixo) ----------
  const C = await p.evaluate(() => {
    const c = contagemIgual(9), vistos = new Set();
    for(let t = 0; t < 2000; t++) vistos.add(distribuiNiveis(c).join("|"));
    return vistos.size;
  });
  ok(C >= 50, `C1 a ordem continua sorteada: ${C} ordens distintas em 2000 sorteios (9 questões)`, 'distintas=' + C);

  // ---------- (D) o teto e o mínimo estão certos ----------
  const D = await p.evaluate(() => ({
    teto10: maxSemRepetir(10), teto7: maxSemRepetir(7),
    min8em10: repeticoesInevitaveis({ "Fácil": 8, "Médio": 1, "Difícil": 1 }, 10),
    min6em10: repeticoesInevitaveis({ "Fácil": 6, "Médio": 2, "Difícil": 2 }, 10),
    min5em10: repeticoesInevitaveis({ "Fácil": 5, "Médio": 3, "Difícil": 2 }, 10),
    alterna5em10: niveisPodemAlternar({ "Fácil": 5, "Médio": 3, "Difícil": 2 }, 10),
    alterna6em10: niveisPodemAlternar({ "Fácil": 6, "Médio": 2, "Difícil": 2 }, 10),
  }));
  ok(D.teto10 === 5 && D.teto7 === 4, 'D1 teto de um mesmo nível: 5 em 10 questões, 4 em 7', JSON.stringify(D));
  ok(D.min8em10 === 5 && D.min6em10 === 1 && D.min5em10 === 0, 'D2 repetições inevitáveis: 8 fáceis em 10 → 5; 6 → 1; 5 → 0', JSON.stringify(D));
  ok(D.alterna5em10 === true && D.alterna6em10 === false, 'D3 5 de um nível em 10 ainda alterna; 6 já não', JSON.stringify(D));

  // ---------- (E) a linha de situação avisa ANTES de aplicar ----------
  const E = await p.evaluate(() => {
    selectArea("matematica"); setQty(10);
    loteContadores = { "Fácil": 4, "Médio": 3, "Difícil": 3 }; atualizaResumoLote();
    const bom = document.getElementById("loteResumo").textContent;
    const bomErro = document.getElementById("loteResumo").classList.contains("erro");
    loteContadores = { "Fácil": 8, "Médio": 1, "Difícil": 1 }; atualizaResumoLote();
    const ruim = document.getElementById("loteResumo").textContent;
    const ruimErro = document.getElementById("loteResumo").classList.contains("erro");
    const btn = document.getElementById("btnAplicarLote").disabled;
    return { bom, bomErro, ruim, ruimErro, btn };
  });
  ok(/sem dois n[íi]veis iguais seguidos/.test(E.bom) && !E.bomErro, 'E1 contagem equilibrada: a linha promete alternância, sem marca de erro', E.bom);
  ok(/m[áa]ximo de um mesmo n[íi]vel [ée] 5/.test(E.ruim) && /5 repeti[çc][õo]es s[ãa]o inevit[áa]veis/.test(E.ruim) && E.ruimErro, 'E2 8 fáceis em 10: a linha diz o teto e quantas repetições são inevitáveis, em vermelho', E.ruim);
  ok(E.btn === false, 'E3 o "Aplicar" continua habilitado — é decisão do professor, não bloqueio', 'disabled=' + E.btn);

  ok(erros.length === 0, 'F1 sem erros de JavaScript na página', JSON.stringify(erros));
  console.log(`\n${total} PASS, ${falhas} FAIL`);
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
