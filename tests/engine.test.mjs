import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTask } from '../engine/requirements.mjs';
import { recordTask, loadEvents, aggregate } from '../engine/metrics.mjs';
import { hasConsent, setConsent, collectIfConsented } from '../engine/consent.mjs';
import { verifyLicense } from '../license/license.mjs';
import { issueLicense } from '../license/issue.mjs';
import { globToRe, matchAny, normalizeStartCommand } from '../engine/core.mjs';
import { timeBoxStatus, timeBoxLimitMin, TIME_BOX_MIN } from '../engine/timebox.mjs';
import { parseBranch, setTask, clearTask } from '../engine/branch-req.mjs';
import { DEFAULT_CONFIG, branchName, branchRegex, checkCommitScope, patternUsesNumero } from '../engine/company-config.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dir, '..', 'hooks', 'on-task.mjs');

// Roda o hook UserPromptSubmit como subprocesso (cwd limpo p/ não pegar .qa-gate-off do repo).
function runOnTask(prompt, sid) {
  const cwd = join(tmpdir(), 'qa-gate-ontask-test');
  try { mkdirSync(cwd, { recursive: true }); } catch {}
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ prompt, session_id: sid }),
    cwd,
    encoding: 'utf8',
  });
  return r.stdout || '';
}

test('parseBranch: repositorios (lista) e alvo rotulados separados', () => {
  const r = parseBranch('36885 fix origem dev repositorios todos alvo mobile');
  assert.equal(r.num, '36885');
  assert.equal(r.tipo, 'fix');
  assert.equal(r.origem, 'dev');
  assert.deepEqual(r.repositorios, ['front', 'back', 'mobile']); // todos = lista completa
  assert.equal(r.alvo, 'mobile');
});

test('parseBranch: MULTI-repo — "front back" vira lista', () => {
  const r = parseBranch('36885 feat dev repositorios front back');
  assert.deepEqual(r.repositorios, ['front', 'back']);
});

test('parseBranch: valor solto vira target lista (sem rotulo)', () => {
  const r = parseBranch('todos');
  assert.deepEqual(r.target, ['front', 'back', 'mobile']);
  assert.equal(r.repositorios, null);
  assert.equal(r.alvo, null);
});

test('parseBranch: origem so aceita dev/hml/main-like; lixo nao vira origem', () => {
  const r = parseBranch('36885 feat repositorios front alvo front');
  assert.equal(r.origem, null); // sem origem valida -> null (muro segura)
  assert.deepEqual(r.repositorios, ['front']);
  assert.equal(r.alvo, 'front');
});

test('company-config: DEFAULT = padrão Fabiano (autor + escopo número)', () => {
  assert.equal(DEFAULT_CONFIG.autor, 'fabiano.veloso');
  assert.equal(branchName(DEFAULT_CONFIG, { tipo: 'feat', numero: '36846' }), 'feat/fabiano.veloso/36846');
  assert.equal(checkCommitScope(DEFAULT_CONFIG, '36846', '36846').ok, true);
  assert.equal(checkCommitScope(DEFAULT_CONFIG, 'consent', '36846').ok, false); // módulo barra
  assert.equal(patternUsesNumero(DEFAULT_CONFIG), true);
});

test('company-config: empresa com escopo por MÓDULO', () => {
  const cfg = { ...DEFAULT_CONFIG, commitScope: 'modulo' };
  assert.equal(checkCommitScope(cfg, 'auth', '10').ok, true);
  assert.equal(checkCommitScope(cfg, '10', '10').ok, false); // número não vale quando é módulo
});

test('company-config: pattern sem autor + escopo regex (Jira)', () => {
  const cfg = { ...DEFAULT_CONFIG, autor: '', branchPattern: '<tipo>/<numero>', commitScopeRegex: '^[A-Z]+-\\d+$' };
  assert.equal(branchName(cfg, { tipo: 'fix', numero: 'PROJ-1' }), 'fix/PROJ-1');
  assert.equal(checkCommitScope(cfg, 'PROJ-123', 'x').ok, true);
  assert.equal(checkCommitScope(cfg, 'auth', 'x').ok, false);
  assert.ok(branchRegex(cfg).test('fix/PROJ-1'));
});

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

test('VS-TASK-001: tarefa ativa não finalizada -> número diferente NÃO abre nova tarefa (bloqueia)', () => {
  const sid = 'unit-task-block';
  clearTask(sid);
  setTask(sid, { num: '100', tipo: 'fix', origem: 'dev', repositorios: ['back'], escopo: 'x' });
  // mensagem começa com OUTRO número (explicando problema, ex.: código de erro)
  const out = runOnTask('500 erro ao salvar no cadastro', sid);
  clearTask(sid);
  assert.match(out, /VS-TASK-001/);
  assert.match(out, /"decision":"block"/);
});

test('VS-TASK-001: mesmo número da tarefa ativa NÃO bloqueia (é conversa da própria tarefa)', () => {
  const sid = 'unit-task-same';
  clearTask(sid);
  setTask(sid, { num: '100', tipo: 'fix', origem: 'dev', repositorios: ['back'], escopo: 'x' });
  const out = runOnTask('100 o erro é no campo cpf', sid);
  clearTask(sid);
  assert.doesNotMatch(out, /VS-TASK-001/);
  assert.doesNotMatch(out, /"decision":"block"/);
});

test('VS-TASK-001: tarefa ativa + explicação sem número deliberado -> livre (não bloqueia)', () => {
  const sid = 'unit-task-free';
  clearTask(sid);
  setTask(sid, { num: '100', tipo: 'fix', origem: 'dev', repositorios: ['back'], escopo: 'x' });
  const out = runOnTask('o erro 422 aparece ao salvar sem tratar', sid);
  clearTask(sid);
  assert.doesNotMatch(out, /VS-TASK-001/);
  assert.doesNotMatch(out, /"decision":"block"/);
});

test('gate SEMPRE webpack: normalizeStartCommand tira --turbo/--turbopack', () => {
  assert.equal(normalizeStartCommand('next dev --turbopack'), 'next dev');
  assert.equal(normalizeStartCommand('next dev --turbo -p 3001'), 'next dev -p 3001');
  assert.equal(normalizeStartCommand('next dev'), 'next dev'); // sem flag -> intacto
  assert.equal(normalizeStartCommand('php artisan serve'), 'php artisan serve');
});

test('time-box: 15min ABSOLUTO; overdue quando idade >= limite (cfg sobrepoe)', () => {
  assert.equal(TIME_BOX_MIN, 15);
  assert.equal(timeBoxLimitMin({}), 15);
  assert.equal(timeBoxLimitMin({ timeBoxMin: 20 }), 20); // override por config
  const now = 60 * 60 * 1000; // base qualquer
  const t14 = { num: '1', tipo: 'fix', ts: now - 14 * 60000 };
  const t15 = { num: '1', tipo: 'feat', ts: now - 15 * 60000 };
  assert.equal(timeBoxStatus(t14, now).overdue, false); // 14min < 15 -> ok
  assert.equal(timeBoxStatus(t15, now).overdue, true);  // 15min -> estourou (tipo nao importa)
  assert.equal(timeBoxStatus(t15, now).ageMin, 15);
  assert.equal(timeBoxStatus({ num: '1' }, now).overdue, false); // sem ts -> nunca overdue
});

test('glob: matchAny casa padroes', () => {
  assert.ok(globToRe('**/*.blade.php').test('resources/views/x/y.blade.php'));
  assert.ok(matchAny('app/Http/Livewire/Foo.php', ['app/Http/Livewire/**']));
  assert.equal(matchAny('README.md', ['app/**']), false);
});
