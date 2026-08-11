/**
 * VSdiretoria — orquestrador. Painel executivo (BI) da suite VelosoSolution:
 * coleta do Redmine -> KPIs -> HTML moderno (dark/light) -> arquivo + PDF opcional.
 */
import { writeFileSync } from 'node:fs';
import { buildDataset } from './collect.mjs';
import { computeKpis } from './kpis.mjs';
import { renderDocument } from './render.mjs';
import { htmlToPdf } from './pdf.mjs';

/** Coleta + calcula + renderiza. Retorna { kpis, html, dataset }. Não escreve arquivo. */
export async function buildDashboard(opts) {
  const dataset = await buildDataset(opts);
  const kpis = computeKpis(dataset);
  const html = renderDocument(kpis, { geradoEm: opts.geradoEm });
  return { kpis, html, dataset };
}

/**
 * Gera o painel e grava em disco. Se opts.pdf, também exporta PDF (Playwright).
 * @returns {Promise<{htmlPath, pdfPath?, kpis}>}
 */
export async function writeDashboard(opts) {
  const { kpis, html } = await buildDashboard(opts);
  const htmlPath = opts.out || 'painel-diretoria.html';
  writeFileSync(htmlPath, html, 'utf8');
  const res = { htmlPath, kpis };
  if (opts.pdf) {
    const pdfPath = opts.pdfOut || htmlPath.replace(/\.html?$/i, '') + '.pdf';
    await htmlToPdf(html, pdfPath, { theme: opts.theme, landscape: opts.landscape });
    res.pdfPath = pdfPath;
  }
  return res;
}
