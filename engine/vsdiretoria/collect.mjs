/**
 * VSdiretoria — collect. Puxa o dataset cru do tracker (Redmine) pros KPIs.
 * Resiliente: cada bloco é best-effort; falha vira 0/[] em vez de derrubar o painel.
 */
import { TRACKERS } from '../vsanalista/template.mjs';

const CENARIO = /especificar\s+testes/i;
const EXECUCAO = /execu[cç][aã]o\s+d/i;

/**
 * @param {object} opts
 * @param {object} opts.tracker
 * @param {number} opts.projectId
 * @param {string} [opts.since]  data ISO (YYYY-MM-DD) — filtra as entregas recentes
 * @param {number} [opts.sampleClosed=200]
 * @param {number} [opts.sampleHU=12]
 */
export async function buildDataset(opts) {
  const { tracker, projectId } = opts;
  const base = `project_id=${projectId}&subproject_id=*`;
  const safe = async (p, d) => { try { return await p; } catch { return d; } };

  const counts = {
    todas: await safe(tracker.countIssues(`${base}&status_id=*`), 0),
    abertas: await safe(tracker.countIssues(`${base}&status_id=open`), 0),
    fechadas: await safe(tracker.countIssues(`${base}&status_id=closed`), 0),
    epico: await safe(tracker.countIssues(`${base}&status_id=*&tracker_id=${TRACKERS.epico}`), 0),
    hu: await safe(tracker.countIssues(`${base}&status_id=*&tracker_id=${TRACKERS.hu}`), 0),
    tarefa: await safe(tracker.countIssues(`${base}&status_id=*&tracker_id=${TRACKERS.tarefaTecnica}`), 0),
    defeito: await safe(tracker.countIssues(`${base}&status_id=*&tracker_id=${TRACKERS.defeito}`), 0),
    nc: await safe(tracker.countIssues(`${base}&status_id=*&tracker_id=42`), 0),
  };

  const closedQs = `${base}&status_id=closed&sort=updated_on:desc`;
  const recentClosed = await safe(tracker.listIssues(closedQs, { max: opts.sampleClosed || 200 }), []);
  const timeEntries = await safe(tracker.listTimeEntries(`project_id=${projectId}&sort=spent_on:desc`, { max: 300 }), []);

  // aderência ao fluxo: amostra de HUs recentes -> filhas + tem Especificar/Execução
  const husAmostra = await safe(tracker.listIssues(`${base}&status_id=*&tracker_id=${TRACKERS.hu}&sort=updated_on:desc`, { max: opts.sampleHU || 12 }), []);
  const aderenciaAmostra = [];
  for (const hu of husAmostra) {
    const filhas = await safe(tracker.listIssues(`parent_id=${hu.id}&status_id=*`, { max: 20 }), []);
    aderenciaAmostra.push({
      huId: hu.id,
      filhas: filhas.length,
      temCenario: filhas.some((f) => CENARIO.test(f.subject || '')),
      temExecucao: filhas.some((f) => EXECUCAO.test(f.subject || '')),
    });
  }

  // automação: best-effort via busca da marca "gerado por VSqa/VSanalista"
  let issuesAutomacao = 0;
  try {
    if (tracker.search) { issuesAutomacao = await tracker.search('gerado por VSqa'); }
  } catch { issuesAutomacao = 0; }

  return {
    projeto: opts.projeto || `Projeto ${projectId}`,
    periodo: opts.since ? { desde: opts.since, ate: null } : null,
    counts,
    recentClosed,
    timeEntries,
    aderenciaAmostra,
    automacao: { issuesAutomacao, gatesVerdes: opts.gatesVerdes || 0 },
  };
}
