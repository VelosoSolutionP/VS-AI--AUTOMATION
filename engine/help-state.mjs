/**
 * Marcador de bloqueio ("ajuda pendente"). A IA grava quando trava; o watcher
 * (cron a cada ~10 min) lê e cobra o timeout. Um arquivo por projeto em
 * ~/.qa-gate/state/pending-help.<projeto>.json. Sem marcador = nada a fazer.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function stateDir() {
  const d = join(homedir(), '.qa-gate', 'state');
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true });
  }
  return d;
}

function safeName(project) {
  return String(project || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function markerPath(project) {
  return join(stateDir(), `pending-help.${safeName(project)}.json`);
}

/**
 * Registra que a IA travou. `tsMs` deve ser Date.now() de quem chama
 * (mantém o módulo testável e sem relógio embutido).
 */
export function reportBlock({ project, task, problem, solution, tsMs }) {
  const p = markerPath(project);
  const data = {
    project: project || 'default',
    task: task || null,
    problem: problem || '',
    solution: solution || null,
    ts: tsMs || 0,
    notified: false,
  };
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return p;
}

/** IA resolveu ou o dev respondeu: limpa o marcador. */
export function clearBlock(project) {
  const p = markerPath(project);
  try {
    if (existsSync(p)) {
      rmSync(p);
    }
  } catch {}
}

/** Marca como já notificado (evita spammar a cada rodada do cron). */
export function markNotified(file, data) {
  try {
    writeFileSync(file, JSON.stringify({ ...data, notified: true }, null, 2), 'utf8');
  } catch {}
}

/** Lê todos os marcadores pendentes. */
export function readMarkers() {
  const d = stateDir();
  const out = [];
  try {
    for (const f of readdirSync(d)) {
      if (f.startsWith('pending-help.') && f.endsWith('.json')) {
        const file = join(d, f);
        try {
          out.push({ file, data: JSON.parse(readFileSync(file, 'utf8')) });
        } catch {}
      }
    }
  } catch {}
  return out;
}
