/**
 * Agenda a trava do teste na máquina do cliente (embutido na instalação).
 * Windows: schtasks (Task Scheduler) — tarefa ONCE em install+7d roda lock.mjs.
 * macOS/Linux: crontab — best-effort. Runtime lock (trial-lock) é o backup.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOCK_SCRIPT = join(HERE, 'lock.mjs');
export const TASK_NAME = 'VelosoSolutionTrialLock';

const p2 = (n) => String(n).padStart(2, '0');

/** Data/hora de disparo (install + days). Retorna partes já formatadas p/ schtasks. */
export function scheduleMoment(base, days = 7) {
  const d = new Date(base + days * 86400000);
  return {
    sd: `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()}`, // MM/DD/YYYY
    st: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
    iso: d.toISOString(),
  };
}

/** Monta os args do schtasks (puro, testável). */
export function schtasksArgs({ sd, st }, node = 'node', lockScript = LOCK_SCRIPT, task = TASK_NAME) {
  return ['/Create', '/F', '/SC', 'ONCE', '/TN', task, '/SD', sd, '/ST', st, '/TR', `${node} "${lockScript}"`];
}

/**
 * Agenda a trava. `runImpl` injetável p/ teste (default spawnSync).
 * @returns {{scheduled:boolean, tool:string, when?:string, reason?:string}}
 */
export function scheduleTrialLock({ base = Date.now(), days = 7, platform = process.platform, runImpl } = {}) {
  const run = runImpl || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  const when = scheduleMoment(base, days);
  try {
    if (platform === 'win32') {
      const res = run('schtasks', schtasksArgs(when));
      const ok = res && (res.status === 0);
      return ok ? { scheduled: true, tool: 'schtasks', when: when.iso }
        : { scheduled: false, tool: 'schtasks', reason: (res && (res.stderr || res.stdout)) || 'schtasks falhou', when: when.iso };
    }
    // POSIX: best-effort via crontab (roda 1x/dia; lock.mjs decide)
    const line = `0 9 * * * node "${LOCK_SCRIPT}" # ${TASK_NAME}\n`;
    const res = run('/bin/sh', ['-c', `(crontab -l 2>/dev/null; echo '${line.trim()}') | crontab -`]);
    const ok = res && res.status === 0;
    return ok ? { scheduled: true, tool: 'crontab', when: when.iso }
      : { scheduled: false, tool: 'crontab', reason: 'crontab indisponível', when: when.iso };
  } catch (e) {
    return { scheduled: false, tool: 'nenhum', reason: String(e.message), when: when.iso };
  }
}
