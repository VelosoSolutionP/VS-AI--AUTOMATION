/**
 * Time-box da tarefa: 15min ABSOLUTO. Passou -> o git-guard BLOQUEIA commit/push
 * (VS-TIME-001), chama o dev no Slack e exige a explicação (ao vivo) do porquê da
 * demora. Só o dev ou o admin libera (senha admin no comando; reinicia a janela).
 * `cfg.timeBoxMin` sobrepõe o default (15). Módulo puro (recebe `nowMs`) p/ ser testável.
 */
export const TIME_BOX_MIN = 15;

export function timeBoxLimitMin(cfg = {}) {
  return (cfg && cfg.timeBoxMin) ? cfg.timeBoxMin : TIME_BOX_MIN;
}

/**
 * @returns {{ limitMin:number, ageMin:number, overdue:boolean }}
 */
export function timeBoxStatus(task, nowMs, cfg = {}) {
  const limitMin = timeBoxLimitMin(cfg);
  const ageMin = (task && task.ts) ? Math.floor((nowMs - task.ts) / 60000) : 0;
  const overdue = !!(task && task.ts) && ageMin >= limitMin;
  return { limitMin, ageMin, overdue };
}
