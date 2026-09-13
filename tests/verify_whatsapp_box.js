// v15 — Caixa "Solicitar simulados pelo WhatsApp": teste de ponta a ponta no navegador,
// SEM rede. O script do supabase-js (jsdelivr) é interceptado e substituído por um stub
// que define window.supabase.createClient() devolvendo um cliente falso: sessão
// programável, rpc() programável, auth.onAuthStateChange/getSession/signOut.
// (Pré-definir window.supabase não bastaria: o bundle real sobrescreveria o objeto.)
//
// Uso: node tests/verify_whatsapp_box.js [caminho/para/index.html]
const { chromium } = require('playwright');
const path = require('path');

const INDEX = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const NUMERO_EMPRESA = '556298021556';
const TEL_PROF = '556296116652';
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };

// Stub do supabase-js: comportamento controlado por window.__fake (definido por addInitScript).
const STUB_SUPABASE = `
window.supabase = {
  createClient(){
    const f = window.__fake;
    let cb = null;
    return {
      auth: {
        onAuthStateChange(fn){ cb = fn; setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; },
        async getSession(){ return { data: { session: f.session } }; },
        async signOut(){ f.session = null; if(cb) cb('SIGNED_OUT', null); return { error: null }; },
        async signInWithPassword(){ return { error: new Error('nao usado no teste') }; },
      },
      async rpc(nome, args){
        f.chamadas.push({ nome, args: args || null, t: Date.now() });
        const h = f.rpc[nome];
        if(!h) return { data: null, error: { message: 'rpc nao simulada: ' + nome } };
        return typeof h === 'function' ? h(args) : h;
      },
      from(){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, single(){ return q; }, then(r){ r({ data: [], error: null }); } }; return q; },
    };
  }
};`;

let total = 0, falhas = 0;
function ok(cond, msg){ if(cond){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function novaPagina(browser, fake, opts = {}){
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1280, height: 900 } });
  const erros = [];
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript((f) => {
    window.__fake = { session: f.session, rpc: {}, chamadas: [] };
    // Programação das RPCs a partir de "scripts" serializados (funções não atravessam o addInitScript).
    for(const [k, v] of Object.entries(f.rpc)) window.__fake.rpc[k] = (new Function('return (' + v + ')'))();
    if(f.localStorage) for(const [k, v] of Object.entries(f.localStorage)) localStorage.setItem(k, v);
  }, fake);
  // Sem rede: supabase-js vira o stub; qualquer outro script externo vira vazio.
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith('file://')) return route.continue();
    if(/supabase-js/.test(url)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE });
    if(route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  await page.goto('file://' + INDEX);
  await page.waitForSelector('#waBox');
  await sleep(250);
  return { page, erros };
}

const estadoVisivel = page => page.evaluate(() => {
  const m = { waEstadoInicial: 'Inicial', waEstadoCodigo: 'Codigo', waEstadoVinculado: 'Vinculado', waEstadoExpirado: 'Expirado' };
  for(const id in m){ if(document.getElementById(id).classList.contains('sel')) return m[id]; }
  return null;
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const expira = () => new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // ---- Cenário 1: logado, sem vínculo → gera código → polling detecta vínculo → desvincula
  {
    const rpc = {
      wa_meu_status: `() => ({ data: window.__fake.vinculado ? [{ whatsapp: '${TEL_PROF}', whatsapp_nome: 'Maziad-Turco', whatsapp_vinculado_em: new Date().toISOString(), ilimitado: true, limite_diario_wa: 30 }] : [], error: null })`,
      wa_gerar_codigo: `() => ({ data: [{ codigo: '482134', expira_em: '${expira()}' }], error: null })`,
      wa_desvincular: `() => { window.__fake.vinculado = false; return { data: null, error: null }; }`,
    };
    const { page, erros } = await novaPagina(browser, { session: SESSAO, rpc });
    ok(await estadoVisivel(page) === 'Inicial', 'c1: logado sem vínculo → estado Inicial');
    ok(await page.isVisible('#btnWaVincular') && (await page.textContent('.wa-title')).trim() === 'Solicitar simulados pelo WhatsApp', 'c1: título e botão "Vincular meu WhatsApp" visíveis');
    ok((await page.textContent('#waNumeroEmpresa')).trim() === '+55 62 9802-1556', 'c1: número da empresa formatado');

    await page.click('#btnWaVincular');
    await page.waitForFunction(() => document.getElementById('waEstadoCodigo').classList.contains('sel'));
    ok((await page.textContent('#waCodigo')).trim() === '482 134', 'c1: código exibido "482 134"');
    ok((await page.textContent('#waCodigoInline')).trim() === '482134', 'c1: frase para digitar traz o código');
    const href = await page.getAttribute('#linkWaAbrir', 'href');
    ok(href === `https://wa.me/${NUMERO_EMPRESA}?text=Vincular%20conta%20482134`, 'c1: link wa.me exato: ' + href);
    ok(await page.getAttribute('#linkWaAbrir', 'target') === '_blank' && /noopener/.test(await page.getAttribute('#linkWaAbrir', 'rel')), 'c1: link abre em nova aba com rel=noopener');
    ok(/Vale até \d{2}:\d{2}/.test(await page.textContent('#waExpira')), 'c1: validade mostrada como horário do servidor');
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('enem_wa_codigo_pendente') || 'null'));
    ok(guardado && guardado.codigo === '482134' && guardado.expiraEm > Date.now(), 'c1: código pendente guardado no navegador');

    // polling: primeiro tick ainda não vinculado; depois vincula
    await sleep(4500);
    const antes = await page.evaluate(() => window.__fake.chamadas.filter(c => c.nome === 'wa_meu_status').length);
    ok(antes >= 2, `c1: polling consultou wa_meu_status (${antes} chamadas)`);
    await page.evaluate(() => { window.__fake.vinculado = true; });
    await page.waitForFunction(() => document.getElementById('waEstadoVinculado').classList.contains('sel'), null, { timeout: 12000 });
    ok((await page.textContent('#waTelefone')).trim() === '+55 62 ••••-6652', 'c1: telefone mascarado "+55 62 ••••-6652"');
    ok((await page.textContent('#waNome')).trim() === '· Maziad-Turco', 'c1: nome do perfil do WhatsApp');
    ok(await page.evaluate(() => localStorage.getItem('enem_wa_codigo_pendente')) === null, 'c1: código pendente apagado ao vincular');
    ok(await page.isVisible('.toast.ok'), 'c1: aviso "WhatsApp vinculado!"');
    const n1 = await page.evaluate(() => window.__fake.chamadas.filter(c => c.nome === 'wa_meu_status').length);
    await sleep(5000);
    const n2 = await page.evaluate(() => window.__fake.chamadas.filter(c => c.nome === 'wa_meu_status').length);
    ok(n2 === n1, 'c1: polling parou depois de vincular');

    await page.click('#btnWaDesvincular');
    await page.waitForFunction(() => document.getElementById('waEstadoInicial').classList.contains('sel'));
    ok(await page.evaluate(() => window.__fake.chamadas.some(c => c.nome === 'wa_desvincular')), 'c1: Desvincular chamou wa_desvincular e voltou ao Inicial');

    // logout limpa (código pendente novo + sair)
    await page.click('#btnWaVincular');
    await page.waitForFunction(() => document.getElementById('waEstadoCodigo').classList.contains('sel'));
    await page.click('#btnSair');
    await sleep(400);
    ok(await estadoVisivel(page) === 'Inicial' && await page.evaluate(() => localStorage.getItem('enem_wa_codigo_pendente')) === null, 'c1: sair da conta limpa a caixa e o código guardado');
    ok(erros.length === 0, 'c1: sem erros no console' + (erros.length ? ' → ' + erros.join(' | ') : ''));
    await page.close();
  }

  // ---- Cenário 2: recarregar com código pendente válido → volta ao estado Codigo e retoma o polling
  {
    const rpc = { wa_meu_status: `() => ({ data: [], error: null })` };
    const pend = JSON.stringify({ codigo: '777001', expiraEm: Date.now() + 10 * 60 * 1000 });
    const { page, erros } = await novaPagina(browser, { session: SESSAO, rpc, localStorage: { enem_wa_codigo_pendente: pend } });
    await page.waitForFunction(() => document.getElementById('waEstadoCodigo').classList.contains('sel'), null, { timeout: 3000 });
    ok((await page.textContent('#waCodigo')).trim() === '777 001', 'c2: recarregou com código pendente → mesmo código na tela');
    ok((await page.getAttribute('#linkWaAbrir', 'href')) === `https://wa.me/${NUMERO_EMPRESA}?text=Vincular%20conta%20777001`, 'c2: link refeito com o código guardado');
    const a = await page.evaluate(() => window.__fake.chamadas.length); await sleep(4500);
    const b = await page.evaluate(() => window.__fake.chamadas.length);
    ok(b > a, 'c2: polling retomado');
    ok(erros.length === 0, 'c2: sem erros no console');
    await page.close();
  }

  // ---- Cenário 3: código pendente vencido → estado Expirado; "Gerar novo código" funciona
  {
    const rpc = {
      wa_meu_status: `() => ({ data: [], error: null })`,
      wa_gerar_codigo: `() => ({ data: [{ codigo: '123456', expira_em: '${expira()}' }], error: null })`,
    };
    const pend = JSON.stringify({ codigo: '777001', expiraEm: Date.now() - 1000 });
    const { page, erros } = await novaPagina(browser, { session: SESSAO, rpc, localStorage: { enem_wa_codigo_pendente: pend } });
    await page.waitForFunction(() => document.getElementById('waEstadoExpirado').classList.contains('sel'), null, { timeout: 3000 });
    ok(true, 'c3: código vencido → estado Expirado');
    await page.click('#btnWaNovoCodigo2');
    await page.waitForFunction(() => document.getElementById('waEstadoCodigo').classList.contains('sel'));
    ok((await page.textContent('#waCodigo')).trim() === '123 456', 'c3: "Gerar novo código" → novo código na tela');
    ok(erros.length === 0, 'c3: sem erros no console');
    await page.close();
  }

  // ---- Cenário 4: deslogado → clique abre o modal de login; nenhuma RPC é chamada
  {
    const { page, erros } = await novaPagina(browser, { session: null, rpc: {} });
    ok(await estadoVisivel(page) === 'Inicial', 'c4: deslogado → estado Inicial visível');
    await page.click('#btnWaVincular');
    await sleep(200);
    ok(await page.evaluate(() => document.getElementById('authModal').classList.contains('show')), 'c4: clique deslogado abre o modal de login');
    ok(await page.evaluate(() => window.__fake.chamadas.length) === 0, 'c4: nenhuma RPC chamada sem sessão');
    ok(erros.length === 0, 'c4: sem erros no console');
    await page.close();
  }

  // ---- Cenário 5: RPC falha ao gerar → toast de erro e caixa volta ao Inicial
  {
    const rpc = {
      wa_meu_status: `() => ({ data: [], error: null })`,
      wa_gerar_codigo: `() => ({ data: null, error: { message: 'permission denied for function wa_gerar_codigo' } })`,
    };
    const { page, erros } = await novaPagina(browser, { session: SESSAO, rpc });
    await page.click('#btnWaVincular');
    await page.waitForSelector('.toast.err', { timeout: 3000 });
    ok(true, 'c5: erro da RPC vira toast de erro');
    ok(await estadoVisivel(page) === 'Inicial' && !(await page.isDisabled('#btnWaVincular')), 'c5: caixa volta ao Inicial com o botão habilitado');
    ok(erros.filter(e => !/\[wa\]/.test(e)).length === 0, 'c5: só o log esperado do erro no console');
    await page.close();
  }

  // ---- Cenário 6: celular (400 px) — caixa cabe sem rolagem horizontal
  {
    const rpc = { wa_meu_status: `() => ({ data: [] , error: null })`, wa_gerar_codigo: `() => ({ data: [{ codigo: '482134', expira_em: '${expira()}' }], error: null })` };
    const { page, erros } = await novaPagina(browser, { session: SESSAO, rpc }, { viewport: { width: 400, height: 800 } });
    await page.click('#btnWaVincular');
    await page.waitForFunction(() => document.getElementById('waEstadoCodigo').classList.contains('sel'));
    const semRolagem = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok(semRolagem, 'c6: a 400 px não há rolagem horizontal');
    ok(erros.length === 0, 'c6: sem erros no console');
    await page.close();
  }

  await browser.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE:', e); process.exit(1); });
