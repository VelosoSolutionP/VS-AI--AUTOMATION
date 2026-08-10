/**
 * VSqa — scenario. US normalizada -> Cenário de teste (passos executáveis).
 *
 * Cada critério de aceite vira 1 passo. O passo é COMPATÍVEL com o "flow" do
 * core.mjs (path/mode/fill/submitText/expect*), então o executor roda direto.
 *
 * A heurística monta um RASCUNHO: infere modo (read x form) pelos verbos e deixa
 * `path`/seletores vazios quando não há como adivinhar. `validateScenario` diz o
 * que falta; o dev/modelo enriquece antes de executar (padrão interativo do MCP).
 */

const VERBOS_READ = /\b(list(a|ar|agem)?|ver|visualiz|exib|mostr|consult|filtr|pesquis|relat[oó]rio)\b/i;
const VERBOS_FORM = /\b(cadastr|salv|criar?|edit|atualiz|excluir?|remov|validar?|enviar?|submet|aprov|reprov|login|autentic)\b/i;

/** Infere o modo do passo a partir do texto do critério. */
export function inferMode(criterio) {
  if (VERBOS_FORM.test(criterio)) { return 'form'; }
  if (VERBOS_READ.test(criterio)) { return 'read'; }
  return 'form';
}

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 48);

/**
 * Monta o cenário-rascunho a partir da US normalizada.
 * @param {{id,titulo,criterios,modulo,url}} us
 * @param {{ baseHint?: string }} [opts]
 */
export function buildScenario(us, opts = {}) {
  const criterios = us.criterios?.length ? us.criterios : [us.titulo].filter(Boolean);
  const steps = criterios.map((c, i) => ({
    name: `passo-${i + 1}-${slug(c)}`,
    criterio: c,
    mode: inferMode(c),
    path: null,          // rota a testar — preencher
    fill: null,          // campos p/ reproduzir validação/negócio
    submitText: null,
    expectFriendlyError: undefined,
    expectText: null,
    expectSelector: null,
  }));
  return {
    issueId: us.id,
    titulo: us.titulo,
    modulo: us.modulo,
    baseHint: opts.baseHint || null,
    steps,
  };
}

/** Diz se o cenário está pronto p/ executar (todo passo precisa de `path`). */
export function validateScenario(scenario) {
  const missing = [];
  (scenario.steps || []).forEach((s) => {
    if (!s.path) { missing.push(`${s.name}: falta "path" (rota a testar)`); }
    if (s.mode === 'form' && !s.submitText && !s.submitSelector) {
      missing.push(`${s.name}: form sem submitText/submitSelector`);
    }
    if (s.mode === 'read' && !s.expectText && !s.expectSelector) {
      missing.push(`${s.name}: read sem expectText/expectSelector`);
    }
  });
  return { ready: missing.length === 0, missing };
}

/** Converte os passos do cenário nos "flows" que o core.mjs (simulateFlows) executa. */
export function scenarioToFlows(scenario) {
  return (scenario.steps || [])
    .filter((s) => s.path)
    .map((s) => {
      const f = { name: s.name, path: s.path, mode: s.mode };
      if (s.fill) { f.fill = s.fill; }
      if (s.submitText) { f.submitText = s.submitText; }
      if (s.submitSelector) { f.submitSelector = s.submitSelector; }
      if (s.expectFriendlyError !== undefined) { f.expectFriendlyError = s.expectFriendlyError; }
      if (s.expectMessageText) { f.expectMessageText = s.expectMessageText; }
      if (s.expectText) { f.expectText = s.expectText; }
      if (s.expectSelector) { f.expectSelector = s.expectSelector; }
      if (s.expectMinCount) { f.expectMinCount = s.expectMinCount; }
      return f;
    });
}

/** Renderiza o cenário em Markdown p/ virar descrição da TAREFA-1 (Cenário). */
export function renderScenarioMarkdown(scenario) {
  const linhas = [
    `# Cenário de Teste — US #${scenario.issueId}`,
    scenario.titulo ? `**${scenario.titulo}**` : '',
    scenario.modulo ? `Módulo: ${scenario.modulo}` : '',
    '',
  ];
  (scenario.steps || []).forEach((s, i) => {
    linhas.push(`## Passo ${i + 1} — ${s.criterio}`);
    linhas.push(`- Tipo: ${s.mode === 'read' ? 'leitura/visualização' : 'formulário (injeta inválido → exige msg amigável)'}`);
    if (s.path) { linhas.push(`- Rota: \`${s.path}\``); }
    if (s.fill) { linhas.push(`- Dados: \`${JSON.stringify(s.fill)}\``); }
    if (s.expectText) { linhas.push(`- Espera texto: "${s.expectText}"`); }
    linhas.push('');
  });
  return linhas.filter((l) => l !== undefined).join('\n');
}
