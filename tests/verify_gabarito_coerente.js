/* v18.9 — A ALTERNATIVA CORRETA É UMA SÓ, EM TODA PARTE.

   Defeito corrigido: o app tinha SEIS lugares decidindo qual alternativa é a
   correta e eles discordavam entre si — a tela marcava por "gabarito"; PDF,
   Word e impressão marcavam por analiseAlternativas[L].status; o visualizador
   e a exportação em HTML misturavam os dois. Com gabarito "C" e a análise
   marcando "D", a mesma questão saía com ✅ em C na tela, CORRETA em D no
   caderno do professor e C na folha de respostas do aluno.

   Esta prova cobre os seis pontos pedidos pelo professor: fonte única, uma
   única correta, sincronismo (inclusive nas exportações), embaralhamento que
   leva a letra junto com o conteúdo, a distribuição planejada que nunca
   prevalece sobre a resposta certa, e o bloqueio da entrega inconsistente.

   Uso: node tests/verify_gabarito_coerente.js <caminho absoluto do index.html> */
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

  // fábrica comum, usada por todos os blocos
  await p.evaluate(() => {
    window.__an = (correta, extra) => {
      const o = {};
      /* a etiqueta "[marca-x]" NÃO é uma referência de letra (não vem depois de
         "alternativa"/"letra"/"item"), então não é reescrita: é o rastreador que
         mostra qual objeto de análise foi parar em qual posição. */
      ["A","B","C","D","E"].forEach(L => o[L] = { status: L === correta ? "correta" : "incorreta", comentario: "comentário da alternativa " + L + " [marca-" + L.toLowerCase() + "]" });
      if(extra) Object.assign(o, extra);
      return o;
    };
    // Questão real do relato: escalas 1:10² e 1:10³ → razão linear 10 → razão de
    // áreas 10². Alternativas NUMÉRICAS em ordem crescente; a correta é C.
    window.__questao = (gab, corretaNaAnalise) => ({
      area: "matematica", disciplina: "Matemática", tema: "Semelhança e escalas",
      dificuldade: "Médio",
      competencia: { numero: 2, texto: "Competência 2" },
      habilidade: { codigo: "H8", texto: "Habilidade 8" },
      objetoConhecimento: "Geometria",
      textoBase: "Duas plantas da mesma praça foram impressas em escalas 1:10² e 1:10³.",
      comando: "A razão entre as áreas ocupadas pela praça nas duas plantas é de",
      alternativas: { A: "10⁻³", B: "10⁻¹", C: "10²", D: "10³", E: "10⁴" },
      gabarito: gab,
      resolucaoComentada: "A razão entre as escalas é 10. Como a área varia com o quadrado da razão linear, a razão entre as áreas é 10². Portanto, a alternativa correta é a " + gab + ".",
      analiseAlternativas: window.__an(corretaNaAnalise || gab),
    });
    window.__texto = () => ({
      alternativas: { A: "curta", B: "um pouco maior", C: "uma alternativa média", D: "uma alternativa um tanto maior", E: "a mais longa das cinco alternativas" },
      gabarito: "D",
      resolucaoComentada: "Somando as parcelas, chega-se ao valor da alternativa D. A alternativa B erra ao somar antes de converter.",
      analiseAlternativas: window.__an("D"),
    });
  });

  /* ---------- (A) conferência: uma leitura só, e ela lê certo ---------- */
  const A = await p.evaluate(() => {
    const an = window.__an;
    const c = d => conferenciaGabarito(d);
    const duas = an("C"); duas.E.status = "correta";
    const semStatus = {}; ["A","B","C","D","E"].forEach(L => semStatus[L] = { comentario: "x" });
    const defeito = c({ gabarito: "C", analiseAlternativas: an("D") });
    return {
      coerente: c({ gabarito: "C", analiseAlternativas: an("C") }),
      defeito,
      duas: c({ gabarito: "C", analiseAlternativas: duas }),
      nenhuma: c({ gabarito: "C", analiseAlternativas: an("Z") }),
      foraAE: c({ gabarito: "F", analiseAlternativas: an("C") }),
      semGab: c({ analiseAlternativas: an("C") }),
      antigo: c({ gabarito: "C", analiseAlternativas: semStatus }),
      caixa: c({ gabarito: "B", analiseAlternativas: { A:{status:"incorreta"}, B:{status:" Correta "}, C:{status:"incorreta"}, D:{status:"incorreta"}, E:{status:"incorreta"} } }),
      nulo: c(null),
    };
  });
  ok(A.coerente.estado === 'ok' && A.coerente.letra === 'C', 'A1 questão coerente: estado "ok" e letra C', JSON.stringify(A.coerente));
  ok(A.defeito.estado === 'divergente' && A.defeito.letra === null, 'A2 DEFEITO RELATADO (gabarito C, análise marca D): divergente e NENHUMA letra é escolhida', JSON.stringify(A.defeito));
  ok(A.defeito.motivo.includes('C') && A.defeito.motivo.includes('D'), 'A3 o motivo nomeia as duas letras em conflito (o alerta não é silenciado)', A.defeito.motivo);
  ok(A.duas.estado === 'divergente' && A.duas.letra === null, 'A4 duas alternativas marcadas como corretas: divergente');
  ok(A.nenhuma.estado === 'divergente' && A.nenhuma.letra === null, 'A5 nenhuma alternativa marcada como correta: divergente');
  ok(A.foraAE.estado === 'indefinido' && A.foraAE.letra === null, 'A6 gabarito fora de A–E: indefinido');
  ok(A.semGab.estado === 'indefinido', 'A7 gabarito ausente: indefinido');
  ok(A.antigo.estado === 'ok' && A.antigo.letra === 'C' && A.antigo.parcial === true, 'A8 simulado salvo sem "status" na análise: vale o gabarito, marcado como conferência parcial (não bloqueia)');
  ok(A.caixa.estado === 'ok' && A.caixa.letra === 'B', 'A9 status " Correta " (caixa e espaços) é aceito');
  ok(A.nulo.estado === 'indefinido' && A.nulo.letra === null, 'A10 questão nula: indefinido, sem quebrar');

  /* ---------- (B) FONTE ÚNICA: nenhum ponto decide por conta própria ---------- */
  const B = await p.evaluate(() => {
    const fontes = ["buildQuestionBody","enemGabaritoBlock","enemPrintResposta","enemDocxGabaritoBlock",
                    "enemGabaritoAluno","enemDocxGabaritoAluno","enemBuildPrintHTML","exportPdf","exportDocx",
                    "auditaQuestaoLocal","auditaGabaritos","renderSummaryTable"];
    const antigos = [], novos = [];
    fontes.forEach(n => {
      const f = window[n];
      if(typeof f !== "function") { antigos.push(n + ": função inexistente"); return; }
      const s = f.toString();
      if(/info\.status\s*===\s*"correta"/.test(s)) antigos.push(n + ': ainda lê info.status === "correta"');
      if(/d\.gabarito\s*===\s*letter|data\.gabarito\s*===\s*letter/.test(s)) antigos.push(n + ": ainda compara .gabarito com a letra");
      if(/alternativas\[d\.gabarito\]|alternativas\[data\.gabarito\]/.test(s)) antigos.push(n + ": ainda indexa alternativas por .gabarito");
      if(/conferenciaGabarito|letraCorretaDe|marcaAlternativa/.test(s)) novos.push(n);
    });
    return { antigos, novos, total: fontes.length };
  });
  ok(B.antigos.length === 0, `B1 nenhum dos ${B.total} pontos de exibição/exportação decide a correta por conta própria`, B.antigos.join(' | '));
  ok(B.novos.length >= 10, `B2 ${B.novos.length} pontos leem a fonte única (conferenciaGabarito/letraCorretaDe/marcaAlternativa)`, B.novos.join(', '));

  /* ---------- (C) tela e exportações marcam a MESMA letra ---------- */
  const C = await p.evaluate(() => {
    state.area = "matematica"; state.disciplina = "Matemática";
    const leTela = d => {
      const q = { data: d, recurso: "nenhum", status: "done" };
      const el = buildQuestionBody(d, q);
      const itens = Array.from(el.querySelectorAll(".alt-item"));
      return {
        comClasse: itens.filter(i => i.classList.contains("correct")).map(i => i.querySelector(".alt-letter").textContent),
        comTexto: itens.filter(i => /✅ CORRETA/.test(i.textContent)).map(i => i.querySelector(".alt-letter").textContent),
        badge: (el.querySelector(".gabarito-badge") || {}).textContent || "",
        conferir: itens.filter(i => /A CONFERIR/.test(i.textContent)).length,
      };
    };
    const lePrint = d => {
      const html = enemPrintResposta({ q: { data: d }, idx: 0 });
      const corretas = [];
      html.replace(/<span class="letra">[^<]*<\/span>(CORRETA|INCORRETA|A CONFERIR)/g, () => {});
      ["A","B","C","D","E"].forEach(L => {
        const re = new RegExp('comentário da alternativa ' + L);
        const m = html.split('<p class="alt">').find(t => re.test(t));
        if(m && /(^|>)CORRETA/.test(m.replace(/<[^>]+>/g, ">"))) corretas.push(L);
      });
      const gab = (html.match(/GABARITO:\s*([A-E—])/) || [])[1];
      return { corretas, gab };
    };
    const boa = window.__questao("C");
    const ruim = window.__questao("C", "D");
    return { telaBoa: leTela(boa), printBoa: lePrint(boa), telaRuim: leTela(ruim), printRuim: lePrint(ruim) };
  });
  ok(C.telaBoa.comClasse.join('') === 'C' && C.telaBoa.comTexto.join('') === 'C',
     'C1 tela (questão coerente): a tarja e o "✅ CORRETA" caem os dois na alternativa C', JSON.stringify(C.telaBoa));
  ok(C.telaBoa.badge.includes('C'), 'C2 tela: a etiqueta "Gabarito:" mostra C', C.telaBoa.badge);
  ok(C.printBoa.corretas.join('') === 'C' && C.printBoa.gab === 'C',
     'C3 caderno do professor (impressão): CORRETA em C e "GABARITO: C" — a mesma letra da tela', JSON.stringify(C.printBoa));
  ok(C.telaRuim.comClasse.length === 0 && C.telaRuim.comTexto.length === 0 && C.telaRuim.conferir === 5,
     'C4 questão divergente: a tela NÃO marca ninguém como correta — as cinco saem "A CONFERIR"', JSON.stringify(C.telaRuim));
  ok(C.printRuim.corretas.length === 0 && C.printRuim.gab === '—',
     'C5 questão divergente: o caderno do professor também não marca ninguém (antes marcava D enquanto a tela marcava C)', JSON.stringify(C.printRuim));
  ok(C.telaRuim.badge.includes('inconsistente'), 'C6 questão divergente: a etiqueta diz "inconsistente" em vez de afirmar uma letra', C.telaRuim.badge);

  /* ---------- (D) embaralhamento: a letra segue o CONTEÚDO ---------- */
  const D = await p.evaluate(() => {
    const antes = window.__texto();
    const textoCorretoAntes = antes.alternativas[antes.gabarito];
    const r = aplicaGabaritoAlvo(antes, "B");
    const conf = conferenciaGabarito(antes);
    return {
      r, gabarito: antes.gabarito, conf,
      mesmoConteudo: antes.alternativas[antes.gabarito] === textoCorretoAntes,
      statusB: antes.analiseAlternativas.B.status, statusD: antes.analiseAlternativas.D.status,
      comentarioB: antes.analiseAlternativas.B.comentario,
      comentarioD: antes.analiseAlternativas.D.comentario,
      resolucao: antes.resolucaoComentada,
    };
  });
  ok(D.r === 'ok' && D.gabarito === 'B', 'D1 troca possível: a correta vai para a letra planejada B');
  ok(D.mesmoConteudo, 'D2 a resposta certa continua presa ao CONTEÚDO — o texto da alternativa correta é o mesmo de antes');
  ok(D.statusB === 'correta' && D.statusD === 'incorreta', 'D3 a análise acompanha a troca (B passa a "correta", D passa a "incorreta")');
  ok(D.conf.estado === 'ok' && D.conf.letra === 'B', 'D4 depois da troca a conferência continua coerente e aponta B');
  ok(/valor da alternativa B\./.test(D.resolucao) && /A alternativa D erra/.test(D.resolucao),
     'D5 a resolução passou a concluir pela alternativa B e a citar D como distrator — as duas referências trocaram junto com o conteúdo (antes a resolução continuava apontando D como a resposta)', D.resolucao);
  ok(D.comentarioB === "comentário da alternativa B [marca-d]" && D.comentarioD === "comentário da alternativa D [marca-b]",
     'D6 os comentários trocaram de posição JUNTO com o texto (a etiqueta marca-d foi parar em B) e a referência de letra dentro deles foi reescrita para a nova posição',
     D.comentarioB + ' / ' + D.comentarioD);

  const E = await p.evaluate(() => {
    // análise incompleta: falta a entrada da letra-alvo → a troca é recusada INTEIRA
    const q1 = window.__texto(); delete q1.analiseAlternativas.B;
    const copia1 = JSON.stringify(q1);
    const r1 = aplicaGabaritoAlvo(q1, "B");
    // numéricas em ordem crescente: a letra planejada NUNCA quebra a ordem
    const q2 = window.__questao("C");
    const copia2 = JSON.stringify(q2);
    const r2 = aplicaGabaritoAlvo(q2, "A");
    // questão já divergente: não se mexe em nada
    const q3 = window.__questao("C", "D");
    const copia3 = JSON.stringify(q3);
    const r3 = aplicaGabaritoAlvo(q3, "A");
    return {
      r1, intacta1: JSON.stringify(q1) === copia1,
      r2, intacta2: JSON.stringify(q2) === copia2,
      r3, intacta3: JSON.stringify(q3) === copia3,
    };
  });
  ok(E.r1 === 'impossivel' && E.intacta1, 'E1 análise incompleta: a troca é recusada e NADA é alterado (antes o texto trocava e a análise ficava para trás — era este o caminho da dessincronização)');
  ok(E.r2 === 'impossivel' && E.intacta2, 'E2 alternativas numéricas em ordem crescente: a letra planejada não prevalece, nada é trocado');
  ok(E.r3 === 'impossivel' && E.intacta3, 'E3 questão já divergente: a troca é recusada (não se troca letra para a inconsistência sumir)');

  /* ---------- (F) referências de letra no texto ---------- */
  const F = await p.evaluate(() => ({
    troca: trocaLetrasNoTexto("A alternativa C traz a razão correta; a alternativa A confunde escala. Veja o item C e o gabarito C.", "C", "A"),
    variavel: trocaLetrasNoTexto("Considere x = C + 2 e a constante C do problema.", "C", "A"),
    minuscula: trocaLetrasNoTexto("veja a letra c do enunciado", "C", "A"),
    vazio: trocaLetrasNoTexto("", "C", "A"),
    naoTexto: trocaLetrasNoTexto(null, "C", "A"),
  }));
  ok(F.troca === "A alternativa A traz a razão correta; a alternativa C confunde escala. Veja o item A e o gabarito A.",
     'F1 "alternativa/item/gabarito C" viram A, e a antiga A vira C', F.troca);
  ok(F.variavel === "Considere x = C + 2 e a constante C do problema.",
     'F2 uma letra solta (variável de matemática) nunca é trocada', F.variavel);
  ok(F.minuscula === "veja a letra a do enunciado", 'F3 minúscula é preservada', F.minuscula);
  ok(F.vazio === "" && F.naoTexto === null, 'F4 texto vazio ou não-texto passa intacto');

  /* ---------- (G) a distribuição planejada é que se ajusta ---------- */
  const G = await p.evaluate(() => {
    const an = window.__an;
    const monta = n => {
      state.questions = [];
      for(let i = 0; i < n; i++) state.questions.push({ status: "idle", data: null });
      state.gabaritoPlan = planejaGabaritos(n);
    };
    const perfeito = pl => {
      const p = [];
      for(let i = 1; i < pl.length; i++) if(pl[i] === pl[i-1]) p.push("seguidas em " + i + ": " + pl.join(""));
      for(let b = 0; b < pl.length; b += 5){ const bl = pl.slice(b, b+5); if(new Set(bl).size !== bl.length) p.push("bloco " + bl.join("")); }
      return p;
    };
    // (1) o plano limpo já respeita as duas regras
    let quebras = [];
    for(let t = 0; t < 300; t++){ monta(10); quebras = quebras.concat(perfeito(state.gabaritoPlan)); }

    // (2) a questão 1 entrega letra diferente da planejada e não pode ser trocada:
    //     o plano das que ainda não começaram é refeito e continua perfeito
    const casosA = [];
    for(let t = 0; t < 400; t++){
      monta(10);
      const entregue = ["A","B","C","D","E"].filter(L => L !== state.gabaritoPlan[0])[t % 4];
      state.questions[0] = { status: "done", data: { gabarito: entregue, analiseAlternativas: an(entregue) } };
      replanejaGabaritos();
      const pl = state.gabaritoPlan;
      const p = perfeito(pl);
      if(pl[0] !== entregue) p.push("a letra entregue não foi registrada no plano");
      if(p.length) casosA.push(p.join("; "));
    }

    // (3) com uma questão JÁ DISPARADA no meio, o alvo dela não pode ser mexido —
    //     e tudo o que ainda dá para escolher continua sem repetir vizinha nem
    //     repetir dentro do bloco. (Se a letra entregue colidir com o alvo de quem
    //     já está em voo, não há o que fazer: as duas estão fora de alcance, e é a
    //     auditoria final que reporta isso ao professor.)
    const casosB = [];
    for(let t = 0; t < 400; t++){
      monta(10);
      const entregue = ["A","B","C","D","E"].filter(L => L !== state.gabaritoPlan[0])[t % 4];
      state.questions[0] = { status: "done", data: { gabarito: entregue, analiseAlternativas: an(entregue) } };
      state.questions[1] = { status: "gerando", data: null };
      const alvoEmVoo = state.gabaritoPlan[1];
      replanejaGabaritos();
      const pl = state.gabaritoPlan, fixo = i => i === 0 || i === 1;
      const p = [];
      if(pl[0] !== entregue) p.push("a letra entregue não foi registrada no plano");
      if(pl[1] !== alvoEmVoo) p.push("mexeu no alvo de uma questão já disparada");
      for(let i = 1; i < pl.length; i++) if(pl[i] === pl[i-1] && !(fixo(i) && fixo(i-1))) p.push("seguidas evitáveis em " + i + ": " + pl.join(""));
      for(let b = 0; b < pl.length; b += 5){
        const bl = pl.slice(b, b + 5);
        bl.forEach((L, k) => { const i = b + k; if(fixo(i)) return;
          for(let k2 = 0; k2 < bl.length; k2++) if(k2 !== k && bl[k2] === L) p.push("bloco com repetição evitável: " + bl.join("")); });
      }
      if(p.length) casosB.push(p.join("; "));
    }
    return { quebras: quebras.slice(0, 3), casosA: casosA.slice(0, 3), nA: casosA.length, casosB: casosB.slice(0, 3), nB: casosB.length };
  });
  ok(G.quebras.length === 0, 'G1 o plano de gabaritos continua sem letras seguidas e com as 5 letras por bloco (300 sorteios de 10 questões)', G.quebras.join(' | '));
  ok(G.nA === 0, 'G2 quando a letra entregue diverge do plano, quem se ajusta é o PLANO — e ele continua perfeito: sem letra repetida em sequência e com as 5 letras por bloco (400 sorteios)', G.casosA.join(' | '));
  ok(G.nB === 0, 'G3 com uma questão já disparada, o alvo dela não é mexido e todo o resto que ainda dá para escolher continua sem repetição evitável (400 sorteios)', G.casosB.join(' | '));

  /* ---------- (H) entrega: a conferência AVISA, não bloqueia (v18.22) ----------
     Decisão do professor: nenhuma exportação pode ser interrompida. A conferência
     de coerência do gabarito continua rodando e continua avisando — o que saiu
     foi a interrupção. */
  const H = await p.evaluate(() => {
    const done = d => ({ q: { data: d, status: "done" }, idx: 0 });
    const boa = window.__questao("C");
    const ruim = window.__questao("C", "D");
    const antigo = { gabarito: "C", alternativas: boa.alternativas, analiseAlternativas: { A:{comentario:"x"},B:{comentario:"x"},C:{comentario:"x"},D:{comentario:"x"},E:{comentario:"x"} } };
    return {
      bloqueiaRuim: bloqueiaSeGabaritoInconsistente([done(boa), { q: { data: ruim, status: "done" }, idx: 4 }]),
      liberaBoa: bloqueiaSeGabaritoInconsistente([done(boa)]),
      liberaAntigo: bloqueiaSeGabaritoInconsistente([done(antigo)]),
      vazio: bloqueiaSeGabaritoInconsistente([]),
    };
  });
  ok(H.bloqueiaRuim === false, 'H1 v18.22: questão inconsistente NÃO bloqueia mais a exportação — só avisa');
  ok(H.liberaBoa === false, 'H2 exportação liberada quando todas estão coerentes');
  ok(H.liberaAntigo === false, 'H3 simulado antigo (sem "status" na análise) continua exportável — a correção não quebra o que já existe');
  ok(H.vazio === false, 'H4 lista vazia não bloqueia');

  const H2 = await p.evaluate(() => {
    const fontes = ["exportHtmlSnapshot","printExam","exportPdf","exportDocx"];
    return fontes.filter(n => typeof window[n] === "function" && /bloqueiaSeGabaritoInconsistente/.test(window[n].toString()));
  });
  ok(H2.length === 4, 'H5 as quatro saídas (HTML, impressão, PDF e Word) chamam a trava antes de exportar', H2.join(', '));

  /* ---------- (I) o auditor lê a mesma coisa que a tela ---------- */
  const I = await p.evaluate(() => {
    const aud = d => auditaQuestaoLocal({ data: d, recurso: "nenhum" }).map(x => x.nivel + ": " + x.texto);
    const ruim = aud(window.__questao("C", "D"));
    const boa = aud(window.__questao("C"));
    return {
      ruim, boa,
      apontaRuim: ruim.some(t => /aviso: O gabarito registrado é C, mas a análise das alternativas marca D/.test(t)),
      silencioBoa: boa.every(t => !/gabarito|análise das alternativas marca/i.test(t)),
    };
  });
  ok(I.apontaRuim, 'I1 o auditor aponta a divergência com as duas letras, pela mesma conferência da tela', I.ruim.join(' | '));
  ok(I.silencioBoa, 'I2 o auditor não inventa alerta na questão coerente', I.boa.join(' | '));

  /* ---------- (J) a questão inconsistente não é dada como concluída ---------- */
  const J = await p.evaluate(() => {
    const s = generateQuestion.toString();
    return {
      temTrava: /conferenciaGabarito\(q\.data\)/.test(s) && /estado !== "ok"/.test(s) && /throw new Error/.test(s),
      temReplan: /replanejaGabaritos\(\)/.test(s),
      ordem: s.indexOf("conferenciaGabarito(q.data)") < s.indexOf('q.status = "done"'),
    };
  });
  ok(J.temTrava, 'J1 a geração confere o gabarito e recusa a questão divergente (vira erro, não "concluída")');
  ok(J.temReplan, 'J2 a geração replaneja a distribuição quando a letra entregue não é a planejada');
  ok(J.ordem, 'J3 a conferência acontece ANTES de a questão ser marcada como concluída');

  ok(erros.length === 0, 'K1 nenhum erro de JavaScript na página', erros.join(' | '));

  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
