/**
 * VSqa — verdict. Lê o Report e decide: VERDE fecha / VERMELHO devolve pro dev.
 * Aplica as ações no tracker (com trilha "gerado por VSqa").
 *
 * Guardrail: `humanInLoop` (default true) NÃO fecha/aprova automaticamente —
 * só comenta e sugere; um humano confirma. Ligue humanInLoop:false pra autonomia total.
 */

/** Decide o veredito a partir do Report do executor. */
export function judge(report) {
  if (report.status === 'blocked') {
    return { verde: false, bloqueado: true, resumo: report.reason || 'cenário não executável' };
  }
  const verde = report.status === 'green' && (report.green || 0) > 0;
  const falhas = (report.steps || []).filter((s) => s.status === 'red');
  return {
    verde,
    bloqueado: false,
    resumo: verde
      ? `Aprovado em QA: ${report.green} passo(s) ok, console limpo.`
      : `Reprovado em QA: ${falhas.length} passo(s) falharam.`,
    falhas: falhas.map((s) => ({ criterio: s.criterio, errors: s.errors })),
  };
}

/** Texto do comentário de reprovação (o que quebrou, por passo). */
function textoReprovado(veredito, report) {
  const linhas = ['❌ VSqa reprovou esta US no teste automatizado.', ''];
  (veredito.falhas || []).forEach((f) => {
    linhas.push(`• ${f.criterio}`);
    (f.errors || []).forEach((e) => linhas.push(`    - ${e}`));
  });
  linhas.push('', 'Devolvendo pro dev. Corrija e reenvie pra QA.');
  return linhas.join('\n');
}

/**
 * Aplica o veredito no tracker.
 * @param {object} tracker  adapter (makeTracker)
 * @param {object} ctx
 * @param {number|string} ctx.issueId
 * @param {number|string} [ctx.execTaskId]  TAREFA-2 (Execução)
 * @param {object} ctx.report
 * @param {object} ctx.veredito  saída de judge()
 * @param {boolean} [ctx.humanInLoop=true]
 * @returns {Promise<{actions:string[]}>}
 */
export async function applyVerdict(tracker, ctx) {
  const { issueId, execTaskId, report, veredito, humanInLoop = true } = ctx;
  const actions = [];

  if (veredito.bloqueado) {
    await tracker.comment(issueId, `⚠ VSqa não conseguiu executar o cenário: ${veredito.resumo}`);
    actions.push('comentou bloqueio na US');
    return { actions };
  }

  if (veredito.verde) {
    const nota = `✅ VSqa aprovou: ${veredito.resumo}`;
    if (humanInLoop) {
      await tracker.comment(issueId, `${nota}\n\n(aguardando confirmação humana p/ fechar — humanInLoop)`);
      actions.push('comentou aprovação (aguardando humano)');
    } else {
      if (execTaskId != null) { await tracker.closeTask(execTaskId, nota); actions.push('fechou TAREFA-2 (Execução)'); }
      await tracker.approve(issueId, nota);
      actions.push('marcou US como aprovada-QA');
    }
    return { actions };
  }

  // vermelho: devolve pro dev
  const txt = textoReprovado(veredito, report);
  if (humanInLoop) {
    await tracker.comment(issueId, txt);
    actions.push('comentou reprovação na US (aguardando humano p/ mudar status)');
  } else {
    await tracker.reject(issueId, txt);
    actions.push('devolveu US pro dev (status reprovado)');
  }
  return { actions };
}
