#!/usr/bin/env node
/**
 * VSqa — CLI. Uso sob demanda pelo dev (sem gatilho automático).
 *
 *   vsqa scenario <issueId> [--repo .] [--out arquivo]
 *       Lê a US no tracker e grava o CENÁRIO-rascunho num JSON pra você mapear
 *       path/seletores de cada passo. Livre (não executa browser).
 *
 *   vsqa run <issueId> [--repo .] [--config vs-gate-config.json] [--alvo front|mobile]
 *                      [--scenario arquivo] [--auto] [--no-tasks]
 *       Carrega o cenário mapeado (--scenario ou .vsqa/<id>.scenario.json),
 *       confere se o app está no ar, roda o cenário no browser e dá o veredito.
 *       --auto = humanInLoop off (fecha/devolve sozinho). --no-tasks = não cria subtarefas.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadCompanyConfig } from '../company-config.mjs';
import { loadConfig, targetsFor, checkApp, ensureUp, acharConfig, NOMES_CONFIG } from '../core.mjs';
import { makeTracker } from './tracker/index.mjs';
import { normalizeIssue } from './reader.mjs';
import { buildScenario, validateScenario } from './scenario.mjs';
import { runVsqa } from './index.mjs';

/** Parser de flags simples. Exportado p/ teste. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const defaultScenarioPath = (repo, id) => join(repo, '.vsqa', `${id}.scenario.json`);

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

async function cmdScenario(args) {
  const id = args._[1];
  if (!id) { die('uso: vsqa scenario <issueId> [--repo .] [--out arquivo]'); }
  const repo = args.repo || process.cwd();
  const company = loadCompanyConfig(repo);
  const tracker = makeTracker(company);
  const us = normalizeIssue(await tracker.getIssue(id));
  const scenario = buildScenario(us);
  const check = validateScenario(scenario);
  const out = args.out || defaultScenarioPath(repo, id);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(scenario, null, 2));
  console.log(`✔ cenário-rascunho: ${out}`);
  console.log(`  US #${id} — ${us.titulo} (${us.criterios.length} critério(s))`);
  if (!check.ready) {
    console.log('  ► preencha path/seletores nos passos e rode: vsqa run ' + id);
    check.missing.forEach((m) => console.log('    - ' + m));
  } else {
    console.log('  ► pronto pra: vsqa run ' + id);
  }
}

async function cmdRun(args) {
  const id = args._[1];
  if (!id) { die('uso: vsqa run <issueId> [--config vs-gate-config.json] [--alvo front] [--scenario arquivo] [--auto]'); }
  const repo = args.repo || process.cwd();
  const company = loadCompanyConfig(repo);
  const tracker = makeTracker(company);

  const scenarioFile = args.scenario || defaultScenarioPath(repo, id);
  if (!existsSync(scenarioFile)) {
    die(`sem cenário em ${scenarioFile}. Rode antes: vsqa scenario ${id}`);
  }
  const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8'));
  const check = validateScenario(scenario);
  if (!check.ready) {
    die('cenário incompleto:\n' + check.missing.map((m) => '  - ' + m).join('\n'));
  }

  const cfgPath = args.config || acharConfig(repo);
  const cfg = loadConfig(cfgPath);
  if (!cfg) { die(`sem ${NOMES_CONFIG[0]} em ` + cfgPath); }
  const [tgt] = targetsFor(cfg, args.alvo);
  if (!tgt) { die('nenhum alvo no config'); }
  const target = tgt.tcfg;

  // health-check: app precisa estar no ar (sobe se target tiver `start`)
  const base = target.baseUrl;
  const up = target.start
    ? await ensureUp(base, target.healthPath || cfg.healthPath, target)
    : await checkApp(base, target.healthPath || cfg.healthPath);
  if (!up) { die(`✖ app fora do ar em ${base} — suba o ambiente e rode de novo`); }

  console.log(`▶ testando US #${id} em ${base} (alvo ${tgt.name})...`);
  const r = await runVsqa(id, {
    tracker,
    target,
    repo,
    scenario,
    humanInLoop: !args.auto,
    createTasks: !args['no-tasks'],
  });

  const flag = r.veredito.verde ? '✅ VERDE' : r.veredito.bloqueado ? '⚠ BLOQUEADO' : '❌ VERMELHO';
  console.log(`\n${flag} — ${r.veredito.resumo}`);
  if (r.scenarioTask) { console.log(`  Cenário:  ${r.scenarioTask.url || r.scenarioTask.id}`); }
  if (r.execTask) { console.log(`  Execução: ${r.execTask.url || r.execTask.id}`); }
  console.log(`  Ações: ${(r.actions || []).join('; ')}`);
  (r.report.steps || []).filter((s) => s.status === 'red').forEach((s) => {
    console.log(`  ❌ ${s.criterio}`);
    (s.errors || []).forEach((e) => console.log(`       ${e}`));
  });
  process.exit(r.veredito.verde ? 0 : 1);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (cmd === 'scenario') { return cmdScenario(args); }
  if (cmd === 'run') { return cmdRun(args); }
  console.log('VSqa — automação de QA (VelosoSolution)\n\nComandos:\n  vsqa scenario <issueId>   lê a US e gera o cenário-rascunho\n  vsqa run <issueId>        executa o cenário no browser e dá o veredito\n\nFlags: --repo --config --alvo --scenario --auto --no-tasks');
}

// só executa quando ESTE arquivo é o binário chamado (não em import de teste nem
// quando outro cli.mjs — ex.: vsdiretoria — importa parseArgs daqui)
if (/vsqa[\\/]cli\.mjs$/.test(process.argv[1] || '')) {
  main().catch((e) => die('✖ ' + (e?.message || e)));
}
