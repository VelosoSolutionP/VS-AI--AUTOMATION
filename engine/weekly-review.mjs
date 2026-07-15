/**
 * Revisão semanal (low-cost, determinística) — sinaliza o que come tempo/token
 * pra lapidar o produto. Sem IA. Lê git (últimos 7 dias) + auditoria de aderência.
 *
 *   node engine/weekly-review.mjs [raizProjetos] [autor]
 */
import { execSync } from 'node:child_process';
import { readdirSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || 'C:/Veloso/ProjetosMsb';
const AUTHOR = process.argv[3] || 'fabiano';
const OUT_DIR = join(ROOT, 'ControleHoras');
const SINCE = '7 days ago';

function findRepos(root, depth = 3) {
  const repos = [];
  const walk = (dir, d) => {
    if (d > depth) { return; }
    if (existsSync(join(dir, '.git'))) { repos.push(dir); return; }
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') { walk(join(dir, e.name), d + 1); }
    }
  };
  walk(root, 0);
  return repos;
}

function gitLog(repo) {
  try {
    return execSync(`git log --all --since="${SINCE}" --author="${AUTHOR}" -i --pretty=%ad~%s --date=format:%Y-%m-%d~%H:%M`, { cwd: repo, encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
  } catch { return []; }
}

const days = {}; // data -> {commits, times[], projetos:Set}
for (const repo of findRepos(ROOT)) {
  const proj = repo.replace(ROOT + '/', '').split('/')[0];
  for (const line of gitLog(repo)) {
    const [date, time] = line.split('~');
    const d = (days[date] ||= { commits: 0, times: [], projetos: new Set() });
    d.commits++; d.times.push(time); d.projetos.add(proj);
  }
}

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const flags = [];
const rows = Object.keys(days).sort().map((date) => {
  const d = days[date];
  const mins = d.times.map(toMin).sort((a, b) => a - b);
  const spanH = mins.length ? Math.round((mins[mins.length - 1] - mins[0]) / 6) / 10 : 0;
  if (spanH >= 14) { flags.push(`${date}: janela de commits de ${spanH}h (jornada longa — revisar carga).`); }
  if (d.commits >= 20) { flags.push(`${date}: ${d.commits} commits (volume alto — possível churn/retrabalho).`); }
  return `| ${date} | ${d.commits} | ${spanH}h | ${[...d.projetos].join(', ')} |`;
});

// auditoria de aderência do mês corrente
let ader = 0;
const now = new Date();
const audit = join(OUT_DIR, `auditoria-aderencia-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.md`);
if (existsSync(audit)) { ader = (readFileSync(audit, 'utf8').match(/^### /gm) || []).length; }

const md = [
  `# Revisão Semanal — ${now.toISOString().slice(0, 10)}`,
  '',
  'Baixo custo, determinística. Sinaliza o que revisar pra entregar produto sólido.',
  '',
  '## Atividade (últimos 7 dias)',
  '| Data | Commits | Janela | Projetos |',
  '|---|---|---|---|',
  ...rows,
  '',
  '## Sinalizações (comilões de tempo/token)',
  ...(flags.length ? flags.map((f) => `- ⚠️ ${f}`) : ['- Nada fora do padrão na janela.']),
  `- Eventos de não-aderência no mês: **${ader}** (custo evitável atribuído ao usuário).`,
  '',
  '## Lacuna de dados',
  '- Token/tempo por tarefa exige a **telemetria Tier 1** ligada (metrics.jsonl). Enquanto off, a análise usa git (volume/janela) + auditoria de aderência.',
  '',
  '## Ação',
  '- Revisar os itens ⚠️ e decidir ajustes (processo, catálogo, automação) para o produto final do próximo mês.',
].join('\n');

mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, `revisao-semanal-${now.toISOString().slice(0, 10)}.md`);
writeFileSync(outFile, md);
console.log('Revisão salva em:', outFile);
console.log('---');
console.log(md);
