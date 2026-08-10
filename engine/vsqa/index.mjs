/**
 * VSqa — orquestrador. Fluxo completo: dev avisa -> lê US -> cria TAREFA-1 (Cenário)
 * -> executa no browser -> cria TAREFA-2 (Execução) -> veredito (verde fecha / vermelho devolve).
 *
 * Sem gatilho automático: chamado sob demanda (CLI/MCP) quando o dev sobe a tarefa pra dev.
 * Reusa o motor do VSolution (core.simulateFlows) via executor.
 */
import { normalizeIssue } from './reader.mjs';
import { buildScenario, validateScenario, renderScenarioMarkdown } from './scenario.mjs';
import { executeScenario, renderReportMarkdown } from './executor.mjs';
import { judge, applyVerdict } from './verdict.mjs';

/**
 * @param {number|string} issueId
 * @param {object} opts
 * @param {object} opts.tracker    adapter (makeTracker)
 * @param {object} opts.target     config do alvo p/ o browser (baseUrl, login...)
 * @param {string} [opts.repo]
 * @param {object} [opts.scenario] cenário já mapeado (pula o rascunho); se ausente, gera rascunho
 * @param {boolean} [opts.humanInLoop=true]
 * @param {boolean} [opts.createTasks=true]  cria as 2 subtarefas no tracker
 * @param {Function} [opts.simulate]  injeção p/ teste
 * @returns {Promise<object>}
 */
export async function runVsqa(issueId, opts = {}) {
  const { tracker, target, repo, humanInLoop = true, createTasks = true } = opts;
  if (!tracker) { throw new Error('runVsqa: falta tracker'); }

  // 1. lê US
  const raw = await tracker.getIssue(issueId);
  const us = normalizeIssue(raw);

  // 2. cenário (rascunho ou fornecido já mapeado)
  const scenario = opts.scenario || buildScenario(us);
  scenario.issueId = issueId;
  const check = validateScenario(scenario);
  if (!check.ready) {
    // padrão interativo: devolve o rascunho p/ o dev/modelo enriquecer path/seletores
    return {
      stage: 'scenario-draft',
      us,
      scenario,
      missing: check.missing,
      hint: 'complete path/seletores dos passos e rechame runVsqa com opts.scenario',
    };
  }

  // 3. TAREFA-1 (Cenário)
  let scenarioTask = null;
  if (createTasks) {
    scenarioTask = await tracker.createTask({
      subject: `Cenário de Teste #${issueId}`,
      description: renderScenarioMarkdown(scenario),
      parentId: issueId,
    });
  }

  // 4. executa no browser
  const report = await executeScenario(scenario, { repo, target, simulate: opts.simulate });

  // 5. TAREFA-2 (Execução)
  let execTask = null;
  if (createTasks) {
    execTask = await tracker.createTask({
      subject: `Execução de Testes #${issueId}`,
      description: renderReportMarkdown(report),
      parentId: issueId,
    });
  }

  // 6. veredito + ações no tracker
  const veredito = judge(report);
  const applied = await applyVerdict(tracker, {
    issueId,
    execTaskId: execTask?.id,
    report,
    veredito,
    humanInLoop,
  });

  return {
    stage: 'done',
    us,
    scenario,
    scenarioTask,
    report,
    execTask,
    veredito,
    actions: applied.actions,
  };
}
