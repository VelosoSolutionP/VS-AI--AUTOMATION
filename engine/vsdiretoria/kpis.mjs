/**
 * VSdiretoria — cálculo de KPIs (puro, sem I/O). Recebe o dataset cru coletado do
 * tracker e devolve os indicadores prontos pra renderizar. Testável com dados fake.
 */

const round = (n, d = 1) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
const pct = (a, b) => (b ? round((a / b) * 100, 1) : 0);
const mes = (iso) => (iso ? String(iso).slice(0, 7) : null);

const nomeAssignee = (i) => (i.assigned_to || {}).name || 'Sem responsável';
const pontosDe = (i) => {
  const cf = (i.custom_fields || []).find((c) => /pontos/i.test(c.name || ''));
  const v = cf && cf.value ? parseFloat(cf.value) : 0;
  return Number.isFinite(v) ? v : 0;
};

/** Mix por tipo (tracker) a partir das contagens exatas. */
export function mixPorTipo(counts) {
  return [
    { label: 'Histórias', value: counts.hu || 0 },
    { label: 'Tarefas Técnicas', value: counts.tarefa || 0 },
    { label: 'Defeitos', value: counts.defeito || 0 },
    { label: 'Não Conformidades', value: counts.nc || 0 },
    { label: 'Épicos', value: counts.epico || 0 },
  ].filter((x) => x.value > 0);
}

/** Entregas (fechadas recentes) agrupadas por mês. */
export function fechadasPorMes(recentClosed) {
  const map = new Map();
  for (const i of recentClosed) {
    const m = mes(i.closed_on || i.updated_on);
    if (!m) { continue; }
    map.set(m, (map.get(m) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
}

/** Top N responsáveis por entregas (fechadas recentes). */
export function porResponsavel(recentClosed, topN = 8) {
  const map = new Map();
  for (const i of recentClosed) {
    const n = nomeAssignee(i).trim();
    map.set(n, (map.get(n) || 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value).slice(0, topN);
}

/** Horas apontadas por pessoa (time entries). */
export function horasPorPessoa(timeEntries, topN = 8) {
  const map = new Map();
  for (const t of timeEntries) {
    const n = (t.user || {}).name || '—';
    map.set(n, (map.get(n) || 0) + (t.hours || 0));
  }
  return [...map.entries()].map(([label, value]) => ({ label, value: round(value, 1) }))
    .sort((a, b) => b.value - a.value).slice(0, topN);
}

/** Aderência ao fluxo VelosoSolution a partir da amostra de HUs. */
export function aderencia(amostra) {
  if (!amostra?.length) { return { amostra: 0, comTree: 0, comCenario: 0, comExecucao: 0 }; }
  const n = amostra.length;
  const comTree = amostra.filter((h) => h.filhas >= 3).length;
  const comCenario = amostra.filter((h) => h.temCenario).length;
  const comExecucao = amostra.filter((h) => h.temExecucao).length;
  return { amostra: n, comTree: pct(comTree, n), comCenario: pct(comCenario, n), comExecucao: pct(comExecucao, n) };
}

/** Monta o objeto de KPIs completo pro render. */
export function computeKpis(dataset) {
  const c = dataset.counts || {};
  const recent = dataset.recentClosed || [];
  const pontos = recent.filter((i) => /hist[oó]ria/i.test((i.tracker || {}).name || '')).reduce((s, i) => s + pontosDe(i), 0);
  return {
    projeto: dataset.projeto || null,
    periodo: dataset.periodo || null,
    tiles: {
      entregues: c.fechadas || 0,
      emAberto: c.abertas || 0,
      taxaEntrega: pct(c.fechadas || 0, c.todas || 0),
      defeitos: c.defeito || 0,
      defeitosPorHU: round((c.defeito || 0) / (c.hu || 1), 2),
      naoConformidades: c.nc || 0,
      historias: c.hu || 0,
      epicos: c.epico || 0,
      pontosEntreguesAmostra: round(pontos, 0),
    },
    mix: mixPorTipo(c),
    fechadasMes: fechadasPorMes(recent),
    responsaveis: porResponsavel(recent),
    horas: horasPorPessoa(dataset.timeEntries || []),
    aderencia: aderencia(dataset.aderenciaAmostra),
    automacao: dataset.automacao || { issuesAutomacao: 0, gatesVerdes: 0 },
  };
}
