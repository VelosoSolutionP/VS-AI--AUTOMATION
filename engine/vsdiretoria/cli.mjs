#!/usr/bin/env node
/**
 * VSdiretoria — CLI. Gera o painel executivo (BI) do projeto.
 *
 *   vsdiretoria [--repo .] [--project 66] [--out painel.html] [--pdf] [--since 2026-06-01] [--theme dark]
 *
 * Sem --project usa integrations.redmine.projectId. --pdf exporta PDF (Playwright).
 */
import { loadCompanyConfig } from '../company-config.mjs';
import { makeTracker } from '../vsqa/tracker/index.mjs';
import { writeDashboard } from './index.mjs';
import { parseArgs } from '../vsqa/cli.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repo = args.repo || process.cwd();
  const company = loadCompanyConfig(repo);
  const tracker = makeTracker(company);
  const projectId = args.project ? Number(args.project) : company.integrations?.redmine?.projectId;
  if (!projectId) { console.error('sem projeto: passe --project <id> ou configure integrations.redmine.projectId'); process.exit(1); }

  console.log(`▶ coletando painel do projeto ${projectId}...`);
  const r = await writeDashboard({
    tracker, projectId,
    projeto: args.projeto || `Projeto ${projectId}`,
    since: args.since || null,
    out: args.out || 'painel-diretoria.html',
    pdf: !!args.pdf,
    theme: args.theme || 'light',
    geradoEm: args.data || '',
  });
  const t = r.kpis.tiles;
  console.log(`✔ HTML: ${r.htmlPath}`);
  if (r.pdfPath) { console.log(`✔ PDF:  ${r.pdfPath}`); }
  console.log(`  entregues ${t.entregues} · abertas ${t.emAberto} · defeitos ${t.defeitos} (${t.defeitosPorHU}/HU) · aderência ${r.kpis.aderencia.comTree}%`);
}

if ((process.argv[1] || '').includes('vsdiretoria')) {
  main().catch((e) => { console.error('✖ ' + (e?.message || e)); process.exit(1); });
}
