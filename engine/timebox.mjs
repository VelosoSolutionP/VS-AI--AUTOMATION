/**
 * Time-box da tarefa: 30min ABSOLUTO ("sem mimi"). Passou -> a SESSÃO INTEIRA é
 * bloqueada (on-timebox-guard, PreToolUse em todo tool) até o dev voltar e investigar.
 * Chama o dev no Slack. Destrava SÓ o dev, dizendo a palavra "liberado" no chat ->
 * reinicia a janela. SEM senha; a IA não se auto-libera. A IA para e deixa a explicação
 * em TEXTO (não é tool). `cfg.timeBoxMin` sobrepõe (escolha explícita do admin/projeto).
 * Módulo puro (recebe `nowMs`) p/ ser testável.
 */
export const TIME_BOX_MIN = 30;

export function timeBoxLimitMin(task = {}, cfg = {}) {
  return (cfg && cfg.timeBoxMin) ? cfg.timeBoxMin : TIME_BOX_MIN;
}

/**
 * @returns {{ limitMin:number, ageMin:number, overdue:boolean }}
 */
export function timeBoxStatus(task, nowMs, cfg = {}) {
  const limitMin = timeBoxLimitMin(task, cfg);
  // Ancora = ULTIMA atividade (lastTs), com fallback ao inicio da tarefa (ts). O
  // time-box mede INATIVIDADE (tarefa parada/travada), NAO wall-clock desde que a
  // tarefa abriu. Trabalho ativo (tools/mensagens resetam lastTs) nao trava mais por
  // tempo de sessao/espera do dev — so bloqueia com `limitMin` SEM nenhuma atividade.
  const anchor = (task && (task.lastTs || task.ts)) || 0;
  const ageMin = anchor ? Math.floor((nowMs - anchor) / 60000) : 0;
  const overdue = !!anchor && ageMin >= limitMin;
  return { limitMin, ageMin, overdue };
}
