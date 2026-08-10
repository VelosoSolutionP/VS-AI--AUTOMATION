import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCriterios, extractModulo, normalizeIssue } from '../engine/vsqa/reader.mjs';
import { buildScenario, inferMode, validateScenario, scenarioToFlows, renderScenarioMarkdown } from '../engine/vsqa/scenario.mjs';
import { executeScenario, renderReportMarkdown } from '../engine/vsqa/executor.mjs';
import { judge, applyVerdict } from '../engine/vsqa/verdict.mjs';
import { makeRedmine } from '../engine/vsqa/tracker/redmine.mjs';
import { makeTracker } from '../engine/vsqa/tracker/index.mjs';
import { runVsqa } from '../engine/vsqa/index.mjs';

/* ---------------- reader ---------------- */

test('extractCriterios: pega a seção "Critérios de aceite"', () => {
  const desc = [
    'Descrição geral da tarefa.',
    '',
    '## Critérios de aceite',
    '- Deve listar os produtores',
    '- [ ] Deve validar CPF duplicado',
    '* Deve exibir mensagem amigável',
    '',
    '## Observações',
    '- isso não é critério',
  ].join('\n');
  const crit = extractCriterios(desc);
  assert.deepEqual(crit, ['Deve listar os produtores', 'Deve validar CPF duplicado', 'Deve exibir mensagem amigável']);
});

test('extractCriterios: fallback pega bullets soltos', () => {
  assert.deepEqual(extractCriterios('- a\n- b'), ['a', 'b']);
  assert.deepEqual(extractCriterios('sem bullet'), []);
});

test('extractModulo: [colchete] no título vence', () => {
  assert.equal(extractModulo('[Produtores] cadastro', 'x', 'proj'), 'Produtores');
  assert.equal(extractModulo('cadastro', 'Módulo: Financeiro', 'proj'), 'Financeiro');
  assert.equal(extractModulo('cadastro', 'nada', 'proj'), 'proj');
});

test('normalizeIssue: monta objeto de trabalho', () => {
  const us = normalizeIssue({ id: 42, titulo: '[Produtores] novo', descricao: '## Critérios de aceite\n- salvar produtor', modulo: 'Sigater', url: 'http://x/42' });
  assert.equal(us.id, 42);
  assert.equal(us.titulo, 'novo');
  assert.equal(us.modulo, 'Produtores');
  assert.deepEqual(us.criterios, ['salvar produtor']);
});

/* ---------------- scenario ---------------- */

test('inferMode: verbos', () => {
  assert.equal(inferMode('Deve listar produtores'), 'read');
  assert.equal(inferMode('Deve salvar o cadastro'), 'form');
  assert.equal(inferMode('algo neutro'), 'form');
});

test('buildScenario: 1 passo por critério, rascunho não pronto', () => {
  const us = { id: 7, titulo: 'x', criterios: ['listar itens', 'salvar item'], modulo: 'M' };
  const sc = buildScenario(us);
  assert.equal(sc.issueId, 7);
  assert.equal(sc.steps.length, 2);
  assert.equal(sc.steps[0].mode, 'read');
  assert.equal(sc.steps[1].mode, 'form');
  assert.equal(validateScenario(sc).ready, false); // sem path
});

test('validateScenario + scenarioToFlows: mapeado vira flow', () => {
  const sc = {
    issueId: 1, steps: [
      { name: 's1', criterio: 'listar', mode: 'read', path: '/itens', expectSelector: 'tr' },
      { name: 's2', criterio: 'salvar', mode: 'form', path: '/itens/novo', submitText: 'Salvar', fill: { '#nome': '' } },
    ],
  };
  assert.equal(validateScenario(sc).ready, true);
  const flows = scenarioToFlows(sc);
  assert.equal(flows.length, 2);
  assert.equal(flows[0].expectSelector, 'tr');
  assert.equal(flows[1].submitText, 'Salvar');
  assert.deepEqual(flows[1].fill, { '#nome': '' });
});

test('renderScenarioMarkdown: sai com passos', () => {
  const md = renderScenarioMarkdown({ issueId: 3, titulo: 'T', steps: [{ criterio: 'c1', mode: 'read', path: '/x' }] });
  assert.match(md, /US #3/);
  assert.match(md, /Passo 1 — c1/);
});

/* ---------------- executor (simulate mockado) ---------------- */

const fakeSim = (results) => async () => results;

test('executeScenario: todos verdes', async () => {
  const sc = { issueId: 1, titulo: 'T', steps: [{ name: 's1', criterio: 'c1', mode: 'read', path: '/a' }] };
  const rep = await executeScenario(sc, { simulate: fakeSim([{ name: 's1', status: 'green', errors: [], screenshot: null }]) });
  assert.equal(rep.status, 'green');
  assert.equal(rep.green, 1);
  assert.equal(rep.red, 0);
});

test('executeScenario: um vermelho reprova o report', async () => {
  const sc = { issueId: 1, titulo: 'T', steps: [
    { name: 's1', criterio: 'c1', mode: 'read', path: '/a' },
    { name: 's2', criterio: 'c2', mode: 'form', path: '/b', submitText: 'Ok' },
  ] };
  const rep = await executeScenario(sc, { simulate: fakeSim([
    { name: 's1', status: 'green', errors: [], screenshot: null },
    { name: 's2', status: 'red', errors: ['sem msg amigável'], screenshot: '/tmp/x.jpg' },
  ]) });
  assert.equal(rep.status, 'red');
  assert.equal(rep.red, 1);
});

test('executeScenario: sem passo mapeado -> blocked', async () => {
  const rep = await executeScenario({ issueId: 1, steps: [{ name: 's1', criterio: 'c', mode: 'read', path: null }] }, { simulate: fakeSim([]) });
  assert.equal(rep.status, 'blocked');
});

test('renderReportMarkdown: mostra resultado', () => {
  const md = renderReportMarkdown({ issueId: 9, titulo: 'T', status: 'red', green: 0, red: 1, steps: [{ criterio: 'c', status: 'red', errors: ['erro x'] }] });
  assert.match(md, /VERMELHO/);
  assert.match(md, /erro x/);
});

/* ---------------- verdict ---------------- */

test('judge: verde/vermelho/bloqueado', () => {
  assert.equal(judge({ status: 'green', green: 2, steps: [] }).verde, true);
  assert.equal(judge({ status: 'red', green: 1, steps: [{ status: 'red', criterio: 'c', errors: ['e'] }] }).verde, false);
  assert.equal(judge({ status: 'blocked', reason: 'x' }).bloqueado, true);
});

function fakeTracker() {
  const calls = [];
  return {
    calls,
    async getIssue(id) { calls.push(['getIssue', id]); return { id, titulo: '[Mod] tarefa', descricao: '## Critérios de aceite\n- salvar item', modulo: 'P', url: `http://x/${id}` }; },
    async createTask(t) { calls.push(['createTask', t.subject]); return { id: 100 + calls.length, url: 'http://x/new' }; },
    async comment(id, n) { calls.push(['comment', id, n]); return true; },
    async setStatus(id, s, n) { calls.push(['setStatus', id, s]); return true; },
    async closeTask(id, n) { calls.push(['closeTask', id]); return true; },
    async approve(id, n) { calls.push(['approve', id]); return true; },
    async reject(id, n) { calls.push(['reject', id]); return true; },
  };
}

test('applyVerdict verde humanInLoop=false: fecha exec + aprova US', async () => {
  const t = fakeTracker();
  await applyVerdict(t, { issueId: 5, execTaskId: 101, report: {}, veredito: { verde: true, resumo: 'ok' }, humanInLoop: false });
  assert.ok(t.calls.some((c) => c[0] === 'closeTask' && c[1] === 101));
  assert.ok(t.calls.some((c) => c[0] === 'approve' && c[1] === 5));
});

test('applyVerdict verde humanInLoop=true: só comenta', async () => {
  const t = fakeTracker();
  await applyVerdict(t, { issueId: 5, execTaskId: 101, report: {}, veredito: { verde: true, resumo: 'ok' }, humanInLoop: true });
  assert.ok(t.calls.some((c) => c[0] === 'comment'));
  assert.ok(!t.calls.some((c) => c[0] === 'closeTask'));
});

test('applyVerdict vermelho humanInLoop=false: devolve pro dev', async () => {
  const t = fakeTracker();
  await applyVerdict(t, { issueId: 5, report: {}, veredito: { verde: false, resumo: 'reprovado', falhas: [{ criterio: 'c', errors: ['e'] }] }, humanInLoop: false });
  assert.ok(t.calls.some((c) => c[0] === 'reject' && c[1] === 5));
});

/* ---------------- redmine adapter (fetch mockado) ---------------- */

function fakeFetch(routes) {
  return async (url, opts) => {
    const key = `${opts.method} ${url}`;
    const hit = Object.entries(routes).find(([k]) => key.includes(k));
    if (!hit) { return { ok: false, status: 404, text: async () => 'no route ' + key }; }
    const val = typeof hit[1] === 'function' ? hit[1](opts) : hit[1];
    return { ok: true, status: val.status || 200, json: async () => val.body, text: async () => JSON.stringify(val.body) };
  };
}

test('redmine.getIssue: mapeia campos', async () => {
  const rm = makeRedmine({ baseUrl: 'http://r/', apiKey: 'k', projectId: 1 }, {
    fetchImpl: fakeFetch({ 'GET http://r/issues/8.json': { body: { issue: { id: 8, subject: 'S', description: 'D', project: { name: 'Proj' } } } } }),
  });
  const it = await rm.getIssue(8);
  assert.equal(it.id, 8);
  assert.equal(it.titulo, 'S');
  assert.equal(it.modulo, 'Proj');
  assert.equal(it.url, 'http://r/issues/8');
});

test('redmine.createTask: manda parent + tag automação', async () => {
  let sent;
  const rm = makeRedmine({ baseUrl: 'http://r', apiKey: 'k', projectId: 3 }, {
    fetchImpl: fakeFetch({ 'POST http://r/issues.json': (opts) => { sent = JSON.parse(opts.body); return { body: { issue: { id: 55 } } }; } }),
  });
  const r = await rm.createTask({ subject: 'Cenário #8', description: 'x', parentId: 8 });
  assert.equal(r.id, 55);
  assert.equal(sent.issue.parent_issue_id, 8);
  assert.match(sent.issue.description, /VSqa/);
});

test('redmine.closeTask: exige statusMap.closed', async () => {
  const rm = makeRedmine({ baseUrl: 'http://r', apiKey: 'k', projectId: 1, statusMap: {} }, { fetchImpl: fakeFetch({}) });
  await assert.rejects(() => rm.closeTask(1), /statusMap.closed/);
});

test('redmine: HTTP erro estoura', async () => {
  const rm = makeRedmine({ baseUrl: 'http://r', apiKey: 'k', projectId: 1 }, {
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  });
  await assert.rejects(() => rm.getIssue(1), /HTTP 500/);
});

test('makeTracker: sem tracker habilitado estoura', () => {
  assert.throws(() => makeTracker({ integrations: {} }), /nenhum tracker/);
});

test('makeTracker: redmine habilitado retorna adapter', () => {
  const t = makeTracker({ integrations: { redmine: { enabled: true, baseUrl: 'http://r', apiKey: 'k', projectId: 1 } } });
  assert.equal(t.name, 'redmine');
});

test('makeTracker: azure habilitado é roadmap', () => {
  assert.throws(() => makeTracker({ integrations: { azureDevops: { enabled: true } } }), /roadmap/);
});

/* ---------------- orquestrador ---------------- */

test('runVsqa: cenário incompleto devolve rascunho', async () => {
  const t = fakeTracker();
  const r = await runVsqa(8, { tracker: t, target: {}, simulate: fakeSim([]) });
  assert.equal(r.stage, 'scenario-draft');
  assert.ok(r.missing.length > 0);
  assert.ok(!t.calls.some((c) => c[0] === 'createTask')); // não criou tarefa ainda
});

test('runVsqa verde (humanInLoop=false): cria 2 tarefas, fecha exec, aprova US', async () => {
  const t = fakeTracker();
  const scenario = { issueId: 8, titulo: 'T', steps: [{ name: 's1', criterio: 'salvar item', mode: 'form', path: '/x', submitText: 'Salvar' }] };
  const r = await runVsqa(8, { tracker: t, target: {}, scenario, humanInLoop: false, simulate: fakeSim([{ name: 's1', status: 'green', errors: [], screenshot: null }]) });
  assert.equal(r.stage, 'done');
  assert.equal(r.veredito.verde, true);
  assert.equal(t.calls.filter((c) => c[0] === 'createTask').length, 2);
  assert.ok(t.calls.some((c) => c[0] === 'approve'));
});

test('runVsqa vermelho: devolve pro dev', async () => {
  const t = fakeTracker();
  const scenario = { issueId: 8, titulo: 'T', steps: [{ name: 's1', criterio: 'salvar', mode: 'form', path: '/x', submitText: 'Salvar' }] };
  const r = await runVsqa(8, { tracker: t, target: {}, scenario, humanInLoop: false, simulate: fakeSim([{ name: 's1', status: 'red', errors: ['sem msg'], screenshot: null }]) });
  assert.equal(r.veredito.verde, false);
  assert.ok(t.calls.some((c) => c[0] === 'reject'));
});
