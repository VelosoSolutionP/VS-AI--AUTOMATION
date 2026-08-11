import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huSubject, renderHUDescription, renderEpicDescription, TRACKERS, CUSTOM_FIELDS, HU_TASKS } from '../engine/vsanalista/template.mjs';
import { normalizeEpicSpec, validateEpicSpec, previewEpic } from '../engine/vsanalista/builder.mjs';
import { createEpic } from '../engine/vsanalista/index.mjs';
import { extractCriterios } from '../engine/vsqa/reader.mjs';

/* ---------------- template ---------------- */

test('huSubject: padrão [Módulo] título', () => {
  assert.equal(huSubject({ modulo: 'Planejamento', titulo: 'Deve exibir botão' }), '[Planejamento] Deve exibir botão');
  assert.equal(huSubject({ titulo: 'sem módulo' }), 'sem módulo');
});

test('renderHUDescription: contém as seções do padrão RURAP', () => {
  const html = renderHUDescription({ modulo: 'X', titulo: 'Deve X', como: 'Usuário', solicito: 'algo', para: 'benefício', criteriosTeste: ['crit 1'] });
  assert.match(html, /Descrição de História de Usuário/);
  assert.match(html, /<strong>Como:<\/strong> Usuário/);
  assert.match(html, /Critério de Aceitação do Teste de Software/);
  assert.match(html, /crit 1/);
});

test('renderHUDescription: campos ausentes viram placeholder', () => {
  const html = renderHUDescription({ modulo: 'X', titulo: 'T' });
  assert.match(html, /&lt;preencher/); // escapado
});

test('HU description é lida de volta pelo reader do VSqa (round-trip)', () => {
  const html = renderHUDescription({ modulo: 'Plan', titulo: 'Deve salvar', criteriosTeste: ['Salva com dados válidos', 'Bloqueia duplicado'] });
  const crit = extractCriterios(html);
  assert.ok(crit.includes('Salva com dados válidos'));
  assert.ok(crit.includes('Bloqueia duplicado'));
});

test('renderEpicDescription: lista numerada NN - [Módulo] título', () => {
  const d = renderEpicDescription([{ modulo: 'A', titulo: 'Deve 1' }, { modulo: 'B', titulo: 'Deve 2' }]);
  assert.match(d, /01 - \[A\] Deve 1/);
  assert.match(d, /02 - \[B\] Deve 2/);
});

test('constantes RURAP corretas', () => {
  assert.equal(TRACKERS.epico, 37);
  assert.equal(TRACKERS.hu, 38);
  assert.equal(TRACKERS.tarefaTecnica, 40);
  assert.equal(CUSTOM_FIELDS.tarefaPlanejada, 7);
  assert.equal(HU_TASKS.length, 3);
});

/* ---------------- builder ---------------- */

test('validateEpicSpec: exige título, HUs, módulo, dev e QA', () => {
  const spec = normalizeEpicSpec({ titulo: '', hus: [{ titulo: 'x' }] });
  const r = validateEpicSpec(spec, {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /sem título/.test(e)));
  assert.ok(r.errors.some((e) => /sem módulo/.test(e)));
  assert.ok(r.errors.some((e) => /sem dev/.test(e)));
  assert.ok(r.errors.some((e) => /sem QA/.test(e)));
});

test('validateEpicSpec: ok com dev/QA nos opts', () => {
  const spec = normalizeEpicSpec({ titulo: 'Ep', hus: [{ modulo: 'M', titulo: 'Deve X' }] });
  assert.equal(validateEpicSpec(spec, { devId: 156, qaId: 115 }).ok, true);
});

test('previewEpic: mostra HU + 3 tarefas + dev/QA', () => {
  const spec = normalizeEpicSpec({ titulo: 'Ep', hus: [{ modulo: 'M', titulo: 'Deve X' }] });
  const p = previewEpic(spec, { devId: 156, qaId: 115 });
  assert.equal(p.hus[0].subject, '[M] Deve X');
  assert.equal(p.hus[0].dev, 156);
  assert.equal(p.hus[0].qa, 115);
  assert.equal(p.hus[0].tarefas.length, 3);
});

/* ---------------- orquestrador ---------------- */

function fakeTracker() {
  const created = [];
  let seq = 1000;
  return {
    created,
    async createIssue(f) { const id = ++seq; created.push({ id, ...f }); return { id, url: `http://r/issues/${id}` }; },
  };
}

test('createEpic: dryRun (default) não escreve', async () => {
  const t = fakeTracker();
  const r = await createEpic({ titulo: 'Ep', hus: [{ modulo: 'M', titulo: 'Deve X' }] }, { tracker: t, projectId: 66, devId: 156, qaId: 115 });
  assert.equal(r.stage, 'preview');
  assert.equal(t.created.length, 0);
});

test('createEpic: spec inválida sem dev/QA', async () => {
  const r = await createEpic({ titulo: 'Ep', hus: [{ modulo: 'M', titulo: 'Deve X' }] }, { tracker: fakeTracker(), projectId: 66, dryRun: false });
  assert.equal(r.stage, 'invalid');
});

test('createEpic real: cria épico + HU + 3 tarefas com assignees corretos', async () => {
  const t = fakeTracker();
  const r = await createEpic(
    { titulo: 'Ep', hus: [{ modulo: 'Plan', titulo: 'Deve salvar', criteriosTeste: ['c1'], pontos: 8 }] },
    { tracker: t, projectId: 66, devId: 156, qaId: 115, dryRun: false },
  );
  assert.equal(r.stage, 'done');
  // 1 épico + 1 HU + 3 tarefas = 5 issues
  assert.equal(t.created.length, 5);
  const epico = t.created.find((c) => c.trackerId === TRACKERS.epico);
  const hu = t.created.find((c) => c.trackerId === TRACKERS.hu);
  const tarefas = t.created.filter((c) => c.trackerId === TRACKERS.tarefaTecnica);
  assert.ok(epico);
  assert.equal(hu.assignedToId, 156);          // HU -> dev
  assert.equal(hu.parentId, epico.id);
  assert.ok(hu.customFields.some((c) => c.id === CUSTOM_FIELDS.pontosMsb && c.value === '8'));
  assert.equal(tarefas.length, 3);
  const codificar = tarefas.find((c) => c.subject === 'Codificar História do Usuário');
  const especificar = tarefas.find((c) => c.subject === 'Especificar Testes');
  const execucao = tarefas.find((c) => c.subject === 'Execução dos testes');
  assert.equal(codificar.assignedToId, 156);   // dev
  assert.equal(especificar.assignedToId, 115); // QA
  assert.equal(execucao.assignedToId, 115);    // QA
});

test('createEpic real: devId/qaId por HU sobrepõem o default', async () => {
  const t = fakeTracker();
  await createEpic(
    { titulo: 'Ep', hus: [{ modulo: 'M', titulo: 'Deve Y', devId: 322, qaId: 132 }] },
    { tracker: t, projectId: 66, devId: 156, qaId: 115, dryRun: false },
  );
  const hu = t.created.find((c) => c.trackerId === TRACKERS.hu);
  assert.equal(hu.assignedToId, 322);
});
