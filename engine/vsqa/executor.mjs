/**
 * VSqa — executor. Roda o cenário no browser real (como um QA usando o sistema),
 * reusando o motor do VSolution (core.simulateFlows). Retorna um Report estruturado.
 *
 * `simulate` é injetável p/ teste (default = simulateFlows do core).
 */
import { simulateFlows } from '../core.mjs';
import { scenarioToFlows } from './scenario.mjs';

/**
 * Executa o cenário.
 * @param {object} scenario  saída de buildScenario (com passos já mapeados)
 * @param {object} params
 * @param {string} params.repo
 * @param {object} params.target  config do alvo (baseUrl, login, chromeChannel...)
 * @param {(cfg:object, flows:object[], opts:object)=>Promise<object[]>} [params.simulate]
 */
export async function executeScenario(scenario, params = {}) {
  const simulate = params.simulate || simulateFlows;
  const target = params.target || {};
  const flows = scenarioToFlows(scenario);

  if (!flows.length) {
    return {
      issueId: scenario.issueId,
      titulo: scenario.titulo,
      status: 'blocked',
      reason: 'cenário sem passos executáveis (falta mapear path/seletores)',
      steps: [],
      red: 0,
      green: 0,
    };
  }

  const results = await simulate({ ...target }, flows, { repo: `${params.repo || 'vsqa'}-${scenario.issueId}` });
  const byName = new Map(results.map((r) => [r.name, r]));

  const steps = (scenario.steps || [])
    .filter((s) => s.path)
    .map((s) => {
      const r = byName.get(s.name) || { status: 'red', errors: ['sem resultado do motor'], screenshot: null };
      return {
        name: s.name,
        criterio: s.criterio,
        status: r.status,
        errors: r.errors || [],
        screenshot: r.screenshot || null,
      };
    });

  const red = steps.filter((s) => s.status === 'red').length;
  const green = steps.filter((s) => s.status === 'green').length;
  return {
    issueId: scenario.issueId,
    titulo: scenario.titulo,
    status: red > 0 ? 'red' : 'green',
    steps,
    red,
    green,
  };
}

/** Renderiza o Report em Markdown p/ virar descrição da TAREFA-2 (Execução). */
export function renderReportMarkdown(report) {
  const linhas = [
    `# Execução de Testes — US #${report.issueId}`,
    report.titulo ? `**${report.titulo}**` : '',
    `Resultado: ${report.status === 'green' ? '✅ VERDE' : report.status === 'red' ? '❌ VERMELHO' : '⚠ BLOQUEADO'} (${report.green || 0} ok / ${report.red || 0} falha)`,
    '',
  ];
  (report.steps || []).forEach((s, i) => {
    linhas.push(`## Passo ${i + 1} — ${s.status === 'green' ? '✅' : '❌'} ${s.criterio}`);
    if (s.errors?.length) { s.errors.forEach((e) => linhas.push(`- ${e}`)); }
    linhas.push('');
  });
  if (report.reason) { linhas.push(`> ${report.reason}`); }
  return linhas.filter((l) => l !== undefined).join('\n');
}
