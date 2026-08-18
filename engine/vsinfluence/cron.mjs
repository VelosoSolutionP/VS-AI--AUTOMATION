/**
 * VSinfluence — agendamento da varredura na máquina do criador.
 * Windows: schtasks (MINUTE /MO n). macOS/Linux: crontab. Mesmo padrão do
 * schedule-lock da instalação: builders PUROS + `runImpl` injetável.
 *
 * A tarefa roda a CADA n minutos, não nos horários cadastrados. É de propósito:
 * `vencidosDesde` recupera tudo que passou desde a última varredura, então máquina
 * desligada no horário marcado não perde a publicação — só atrasa. Amarrar o cron
 * aos horários exatos criaria uma entrada por horário e perderia a janela offline.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VARREDURA_SCRIPT = join(HERE, 'cli.mjs');
export const TASK_NAME = 'VSinfluenceVarredura';
export const MARCA = `# ${TASK_NAME}`;

/** Intervalo em minutos, saneado (1..1440). */
export function saneiaIntervalo(min) {
  const n = Math.round(Number(min));
  if (!Number.isFinite(n) || n < 1) { return 15; }
  return Math.min(n, 1440);
}

/** Linha de crontab (pura). */
export function cronLine(everyMin, script = VARREDURA_SCRIPT, node = 'node') {
  const n = saneiaIntervalo(everyMin);
  const spec = n >= 60 && n % 60 === 0 ? `0 */${n / 60} * * *` : `*/${n} * * * *`;
  return `${spec} ${node} "${script}" varrer ${MARCA}`;
}

/** Args do schtasks (puros). */
export function schtasksArgs(everyMin, script = VARREDURA_SCRIPT, node = 'node', task = TASK_NAME) {
  const n = saneiaIntervalo(everyMin);
  return ['/Create', '/F', '/SC', 'MINUTE', '/MO', String(n), '/TN', task, '/TR', `${node} "${script}" varrer`];
}

/**
 * Instala a varredura periódica.
 * @param {{everyMin?:number, platform?:string, runImpl?:Function}} [opts]
 * @returns {{scheduled:boolean, tool:string, everyMin:number, reason?:string}}
 */
export function agendarVarredura({ everyMin = 15, platform = process.platform, runImpl } = {}) {
  const run = runImpl || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  const n = saneiaIntervalo(everyMin);
  try {
    if (platform === 'win32') {
      const res = run('schtasks', schtasksArgs(n));
      return (res && res.status === 0)
        ? { scheduled: true, tool: 'schtasks', everyMin: n }
        : { scheduled: false, tool: 'schtasks', everyMin: n, reason: (res && (res.stderr || res.stdout)) || 'schtasks falhou' };
    }
    // remove a linha antiga pela MARCA antes de inserir — reagendar não duplica
    const sh = `(crontab -l 2>/dev/null | grep -v '${MARCA}'; echo '${cronLine(n)}') | crontab -`;
    const res = run('/bin/sh', ['-c', sh]);
    return (res && res.status === 0)
      ? { scheduled: true, tool: 'crontab', everyMin: n }
      : { scheduled: false, tool: 'crontab', everyMin: n, reason: 'crontab indisponível' };
  } catch (e) {
    return { scheduled: false, tool: 'nenhum', everyMin: n, reason: String(e.message) };
  }
}

/** Remove o agendamento. */
export function removerVarredura({ platform = process.platform, runImpl } = {}) {
  const run = runImpl || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  try {
    if (platform === 'win32') {
      const res = run('schtasks', ['/Delete', '/F', '/TN', TASK_NAME]);
      return { removed: !!(res && res.status === 0), tool: 'schtasks' };
    }
    const res = run('/bin/sh', ['-c', `crontab -l 2>/dev/null | grep -v '${MARCA}' | crontab -`]);
    return { removed: !!(res && res.status === 0), tool: 'crontab' };
  } catch (e) {
    return { removed: false, tool: 'nenhum', reason: String(e.message) };
  }
}
