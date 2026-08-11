import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSet, sensitiveIds } from '../engine/interview/schema.mjs';
import { createState, answer, nextQuestion, isComplete } from '../engine/interview/engine.mjs';
import { applyProfiles } from '../engine/interview/apply.mjs';
import { requiredMissing, isInstalled, assertInstalled } from '../engine/interview/install.mjs';

test('sets novos existem: dev, analista, qa', () => {
  assert.ok(getSet('dev').find((q) => q.id === 'commit_escopo'));
  assert.ok(getSet('analista').find((q) => q.id === 'tracker_apikey'));
  assert.ok(getSet('qa').find((q) => q.id === 'qa_sistema'));
});

test('chaves de API marcadas como sensíveis', () => {
  assert.deepEqual(sensitiveIds('analista'), ['tracker_apikey']);
  assert.deepEqual(sensitiveIds('qa'), ['qa_apikey']);
});

test('dev: commit_escopo só aceita numero|modulo|any', () => {
  assert.equal(answer(createState('dev'), 'commit_escopo', 'foo').ok, false);
  assert.equal(answer(createState('dev'), 'commit_escopo', 'numero').ok, true);
});

test('analista: completa com URL+chave+projeto', () => {
  let s = createState('analista');
  for (const [id, v] of [['tracker_tipo', 'Redmine'], ['tracker_url', 'https://r'], ['tracker_apikey', 'k'], ['tracker_projeto', '66']]) {
    s = answer(s, id, v).state;
  }
  assert.equal(isComplete(s), true);
  assert.equal(nextQuestion(s).id, 'sprint_local'); // opcional restante
});

test('applyProfiles: dev -> branch/commit/doc', () => {
  const { company, changed } = applyProfiles({}, {
    dev: { branch_pattern: '<tipo>/<autor>/<numero>', branch_tipos: ['fix', 'feat'], commit_escopo: 'numero', commit_autor: 'Fabiano Veloso <f@x.com>', doc_modelo: 'MODELO X', testes_politica: 'quando_pedir' },
  });
  assert.equal(company.branchPattern, '<tipo>/<autor>/<numero>');
  assert.deepEqual(company.tipos, ['fix', 'feat']);
  assert.equal(company.commitScope, 'numero');
  assert.equal(company.commitAutor, 'Fabiano Veloso <f@x.com>'); // assinatura git, não o token de branch
  assert.equal(company.autor, undefined); // não sobrescreve o token <autor>
  assert.equal(company.doc.modelo, 'MODELO X');
  assert.ok(changed.includes('branchPattern'));
});

test('applyProfiles: analista -> integrations.redmine; qa -> integrations.qa', () => {
  const { company } = applyProfiles({ integrations: { redmine: { statusMap: { closed: 19 } } } }, {
    analista: { tracker_tipo: 'Redmine', tracker_url: 'https://redmine.x', tracker_apikey: 'ABC', tracker_projeto: 66 },
    qa: { qa_sistema: 'Redmine', qa_apikey: 'QK', qa_exemplo: '#28167' },
  });
  assert.equal(company.integrations.redmine.enabled, true);
  assert.equal(company.integrations.redmine.baseUrl, 'https://redmine.x');
  assert.equal(company.integrations.redmine.apiKey, 'ABC');
  assert.equal(company.integrations.redmine.projectId, 66);
  assert.equal(company.integrations.redmine.statusMap.closed, 19); // preserva o que já existia
  assert.equal(company.integrations.qa.sistema, 'Redmine');
  assert.equal(company.integrations.qa.exemplo, '#28167');
});

test('applyProfiles: azure não mexe em redmine (roadmap)', () => {
  const { company } = applyProfiles({}, { analista: { tracker_tipo: 'Azure', tracker_url: 'x', tracker_apikey: 'k', tracker_projeto: 1 } });
  assert.equal(company.integrations.redmine, undefined);
});

/* ---------------- gate de instalação (analista + qa obrigatórios) ---------------- */

const instalado = {
  integrations: {
    redmine: { enabled: true, baseUrl: 'https://r', apiKey: 'K', projectId: 66 },
    qa: { sistema: 'Redmine', apiKey: 'QK' },
  },
};

test('requiredMissing: vazio quando analista + qa completos', () => {
  assert.deepEqual(requiredMissing(instalado), []);
  assert.equal(isInstalled(instalado), true);
});

test('requiredMissing: aponta o que falta (nada configurado)', () => {
  const m = requiredMissing({});
  assert.ok(m.some((x) => /analista: URL/.test(x)));
  assert.ok(m.some((x) => /analista: chave/.test(x)));
  assert.ok(m.some((x) => /analista: projeto/.test(x)));
  assert.ok(m.some((x) => /qa: sistema/.test(x)));
  assert.ok(m.some((x) => /qa: chave/.test(x)));
});

test('requiredMissing: placeholder "xxx" conta como faltando', () => {
  const m = requiredMissing({ integrations: { redmine: { enabled: true, baseUrl: 'xxx', apiKey: 'xxx', projectId: 'xxx' }, qa: { sistema: 'x', apiKey: 'x' } } });
  assert.ok(m.length >= 3);
});

test('assertInstalled: lança notInstalled quando falta qa', () => {
  const semQa = { integrations: { redmine: instalado.integrations.redmine } };
  assert.throws(() => assertInstalled(semQa), (e) => e.notInstalled === true && /qa:/.test(e.message));
});

test('assertInstalled: passa quando instalado', () => {
  assert.equal(assertInstalled(instalado), true);
});
