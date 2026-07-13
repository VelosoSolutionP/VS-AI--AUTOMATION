import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { validateTask } from '../engine/requirements.mjs';
import { recordTask, loadEvents, aggregate } from '../engine/metrics.mjs';
import { hasConsent, setConsent, collectIfConsented } from '../engine/consent.mjs';
import { verifyLicense } from '../license/license.mjs';
import { issueLicense } from '../license/issue.mjs';
import { globToRe, matchAny } from '../engine/core.mjs';

test('requirements: tarefa insuficiente bloqueia (REQ-001)', () => {
  const r = validateTask('arruma o login');
  assert.equal(r.code, 'VS-REQ-001');
  assert.equal(r.blocked, true);
});

test('requirements: tarefa completa libera (READY/PARTIAL, nao bloqueia)', () => {
  const r = validateTask('Descricao: cadastro cliente. Objetivo: salvar. Criterio de aceite: cpf invalido mostra msg. Arquivo: ClienteController. Regra de negocio: cpf unico. Origem: dev.');
  assert.equal(r.blocked, false);
  assert.ok(['VS-REQ-005', 'VS-REQ-003'].includes(r.code));
});

test('requirements: bug escala pra IA', () => {
  const r = validateTask('Bug: as vezes carrega lento, nao sei a causa. Objetivo: reduzir latencia. Criterio: abrir em menos de 500ms. Arquivo: X.');
  assert.equal(r.escalate.call_ai, true);
});

test('requirements: ambiguidade de produto (REQ-004)', () => {
  const r = validateTask('Muda a cor, ou azul ou verde, voce decide. Objetivo: visual. Criterio de aceite: cor nova.');
  assert.equal(r.code, 'VS-REQ-004');
});

test('metrics: aggregate calcula economia e taxas', () => {
  const LOG = './.metrics/unit.jsonl';
  try { rmSync(LOG); } catch {}
  recordTask({ type: 'bug', durationMin: 30, tokens: 90000, aiCalled: true, ts: 1 }, LOG);
  recordTask({ type: 'default', durationMin: 10, tokens: 8000, aiCalled: false, reqBlocked: true, ts: 2 }, LOG);
  const a = aggregate(loadEvents(LOG));
  assert.equal(a.tasks, 2);
  assert.ok(a.timeSavedMin > 0);
  assert.equal(a.aiCallsAvoided, 1);
  assert.ok(a.tokenReductionPct > 0);
});

test('consent: sem aceite nao coleta; com aceite coleta', () => {
  const P = './.consent/unit.json', LOG = './.metrics/unit2.jsonl';
  try { rmSync(P); } catch {} try { rmSync(LOG); } catch {}
  assert.equal(hasConsent(P), false);
  assert.equal(collectIfConsented((e) => recordTask(e, LOG), { type: 'bug', durationMin: 1, ts: 1 }, P), false);
  setConsent(true, { ts: 1 }, P);
  assert.equal(hasConsent(P), true);
  assert.equal(collectIfConsented((e) => recordTask(e, LOG), { type: 'bug', durationMin: 1, ts: 1 }, P), true);
});

test('license: rejeita vazio e adulterado', () => {
  assert.equal(verifyLicense('').valid, false);
  assert.equal(verifyLicense('lixo.invalido').valid, false);
});

test('license: token assinado valida (requer chave privada local)', { skip: !existsSync('./license/.keys/private.pem') && 'sem chave privada (CI)' }, () => {
  const token = issueLicense({ email: 'x@y.com', plan: 'pro', days: 365 });
  assert.equal(verifyLicense(token).valid, true);
  assert.equal(verifyLicense(token.slice(0, -6) + 'AAAAAA').valid, false);
});

test('glob: matchAny casa padroes', () => {
  assert.ok(globToRe('**/*.blade.php').test('resources/views/x/y.blade.php'));
  assert.ok(matchAny('app/Http/Livewire/Foo.php', ['app/Http/Livewire/**']));
  assert.equal(matchAny('README.md', ['app/**']), false);
});
