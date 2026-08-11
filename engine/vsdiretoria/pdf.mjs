/**
 * VSdiretoria — export PDF. Renderiza o HTML self-contained num Chrome real
 * (Playwright, mesmo motor do gate) e imprime em PDF A4. Sem serviço externo.
 */

/** Gera o PDF a partir do HTML completo. Retorna o caminho salvo. */
export async function htmlToPdf(html, outPath, opts = {}) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('VSdiretoria PDF exige playwright. Instale: npm i playwright'); }

  const browser = await chromium.launch({ channel: opts.chromeChannel || 'chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newContext({ colorScheme: opts.theme === 'dark' ? 'dark' : 'light' }).then((c) => c.newPage());
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      landscape: opts.landscape !== false,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    return outPath;
  } finally {
    await browser.close();
  }
}
