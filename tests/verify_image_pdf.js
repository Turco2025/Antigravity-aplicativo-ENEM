const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  let imageCallCount = 0;
  await page.route('https://tcmwbokhdwfhihndgxll.supabase.co/functions/v1/generate-image', async route => {
    imageCallCount++;
    await new Promise(r => setTimeout(r, 300)); // simulate latency
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ imageDataUrl: `data:image/png;base64,${TINY_PNG_B64}` })
    });
  });

  await page.route('**/functions/v1/generate-question', async route => {
    const draft = {
      area: 'natureza', disciplina: 'Biologia', tema: 'Sistema circulatório',
      dificuldade: 'Médio',
      competencia: { numero: 3, texto: 'Competência de área de teste.' },
      habilidade: { codigo: 'H12', texto: 'Habilidade de teste.' },
      recurso: 'imagem',
      visual: { tipo: 'imagem', promptImagem: 'coração humano em corte, estilo didático', descricao: 'Esquema do coração humano.' },
      textoBase: 'Texto-suporte de teste sobre o sistema circulatório humano, com dados fictícios para fins de verificação automatizada.',
      comando: 'Considerando o texto e a imagem, é correto afirmar que:',
      alternativas: { A: 'Alternativa A', B: 'Alternativa B', C: 'Alternativa C (correta)', D: 'Alternativa D', E: 'Alternativa E' },
      gabarito: 'C',
      resolucaoComentada: 'Resolução comentada de teste.',
      analiseAlternativas: {
        A: { status: 'incorreta', comentario: 'Erro tipo leitura parcial.' },
        B: { status: 'incorreta', comentario: 'Erro tipo senso comum.' },
        C: { status: 'correta', comentario: 'Correta pois...' },
        D: { status: 'incorreta', comentario: 'Erro de inversão de causa/efeito.' },
        E: { status: 'incorreta', comentario: 'Erro de excesso de escopo.' },
      }
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ question: draft })
    });
  });

  const filePath = 'file://' + path.resolve('/home/claude/enem/deliverables/Gerador_Simulados_ENEM.html');
  await page.goto(filePath);

  await page.click('.area-tile[data-area="natureza"]');
  await page.waitForTimeout(200);
  await page.click('.chip:has-text("Biologia")');

  for (let i = 0; i < 6; i++) { await page.click('#qtyMinus'); }
  await page.waitForTimeout(100);

  await page.click('#btnGenerate');
  await page.waitForSelector('.qcard', { timeout: 15000 });

  const results = {};

  // Loading state should appear first
  const sawLoading = await page.waitForSelector('.visual-image-loading', { timeout: 8000 }).then(() => true).catch(() => false);
  results.sawLoadingState = sawLoading;

  // Then the actual image should replace it
  await page.waitForSelector('.visual-image-holder img', { timeout: 15000 });
  results.imageBackendCalls = imageCallCount;
  results.imageSrcIsDataUrl = await page.evaluate(() => {
    const img = document.querySelector('.visual-image-holder img');
    return img ? img.src.startsWith('data:image/png;base64,') : false;
  });
  results.loadingGoneAfterSuccess = await page.evaluate(() => !document.querySelector('.visual-image-loading'));

  // PDF button exists and is wired (full PDF render needs jsPDF/html2canvas from
  // cdnjs, which this sandbox's network blocks — verified separately on real internet).
  results.hasBtnExportPdf = await page.evaluate(() => !!document.getElementById('btnExportPdf'));
  results.exportPdfFnExists = await page.evaluate(() => typeof exportPdf === 'function');

  results.consoleErrors = consoleErrors;

  console.log(JSON.stringify(results, null, 2));

  await browser.close();
})();
