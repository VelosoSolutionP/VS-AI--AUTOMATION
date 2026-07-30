import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
import { resolveGitCwd } from '../engine/git-cwd.mjs';
import { isGitCommit, isGitPush } from '../engine/git-cmd.mjs';
import { projectLabel } from '../engine/notify-whatsapp.mjs';
import { resolve as pathResolve } from 'node:path';
import { parseBranch, setTask, clearTask, setPreflight, clearPreflight, isPreflight } from '../engine/branch-req.mjs';
import { DEFAULT_CONFIG, branchName, branchRegex, checkCommitScope, patternUsesNumero } from '../engine/company-config.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dir, '..', 'hooks', 'on-task.mjs');
const TB_GUARD = join(__dir, '..', 'hooks', 'on-timebox-guard.mjs');

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

// Roda o guard de time-box (PreToolUse) como subprocesso.
function runTbGuard(sid, toolCommand) {
  const cwd = join(tmpdir(), 'qa-gate-tbguard-test');
  try { mkdirSync(cwd, { recursive: true }); } catch {}
  const r = spawnSync('node', [TB_GUARD], {
    input: JSON.stringify({ session_id: sid, cwd, tool_input: { command: toolCommand || 'ls' } }),
    cwd,
    encoding: 'utf8',
  });
  return r.stdout || '';
}

// Escreve o estado da tarefa direto (p/ backdatar o ts — setTask sempre carimba now).
const taskFileFor = (sid) => join(tmpdir(), `qa-gate-task-${String(sid || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'default'}.json`);
function writeTaskFile(sid, obj) { writeFileSync(taskFileFor(sid), JSON.stringify(obj)); }

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

test('time-box: 30min ABSOLUTO (sem mimi); overdue quando idade >= 30 (cfg sobrepoe)', () => {
  assert.equal(TIME_BOX_MIN, 30);
  assert.equal(timeBoxLimitMin({}), 30);
  assert.equal(timeBoxLimitMin({ repositorios: ['front', 'back', 'mobile'] }), 30); // repos nao mudam mais
  assert.equal(timeBoxLimitMin({}, { timeBoxMin: 20 }), 20); // cfg sobrepoe (escolha do admin)
  const now = 60 * 60 * 1000;
  const t29 = { num: '1', ts: now - 29 * 60000 };
  const t30 = { num: '1', ts: now - 30 * 60000 };
  assert.equal(timeBoxStatus(t29, now).overdue, false); // 29min < 30 -> ok
  assert.equal(timeBoxStatus(t30, now).overdue, true);  // 30min -> estourou
  assert.equal(timeBoxStatus(t30, now).ageMin, 30);
  assert.equal(timeBoxStatus({ num: '1' }, now).overdue, false); // sem ts -> nunca overdue
});

test('preflight: flag de sessao seta/limpa', () => {
  const sid = 'unit-preflight-flag';
  clearPreflight(sid);
  assert.equal(isPreflight(sid), false);
  setPreflight(sid);
  assert.equal(isPreflight(sid), true);
  clearPreflight(sid);
  assert.equal(isPreflight(sid), false);
});

test('preflight: 1a tarefa da sessao injeta PREFLIGHT; flag fica setada', () => {
  const sid = 'unit-preflight-inject';
  clearPreflight(sid);
  clearTask(sid);
  // turno 1: 4 campos core -> muro pede o escopo (salva req)
  runOnTask('100 fix dev back', sid);
  // turno 2: escopo -> completa a tarefa e injeta o contexto (com PREFLIGHT)
  const out = runOnTask('corrige o cadastro que nao salva ao editar', sid);
  const setAfter = isPreflight(sid);
  clearPreflight(sid);
  clearTask(sid);
  assert.match(out, /PREFLIGHT/);
  assert.equal(setAfter, true);
});

test('resolveGitCwd: repo real do comando (cd/-C); leak de projeto fechado', () => {
  const abs = (p) => (process.platform === 'win32' ? 'C:/' : '/') + p;
  const base = abs('sessao');
  assert.equal(resolveGitCwd('git push origin main', base), base); // sem cd/-C -> base (sessao)
  assert.equal(resolveGitCwd(`cd ${abs('veloso/qa-gate')} && git push`, base), abs('veloso/qa-gate'));
  assert.equal(resolveGitCwd(`git -C ${abs('veloso/egle/frontend')} commit -m x`, base), abs('veloso/egle/frontend'));
  assert.equal(resolveGitCwd(`cd ${abs('a')} && cd ${abs('b')} && git push`, base), abs('b')); // ultimo cd
  assert.equal(resolveGitCwd(`cd "${abs('Morar Melhor/portal')}" && git commit`, base), abs('Morar Melhor/portal'));
  assert.equal(resolveGitCwd('cd sub && git push', base), pathResolve(base, 'sub')); // relativo -> resolve na base
});

test('VS-TIME-001 guard: tarefa >30min BLOQUEIA a sessao inteira (deny)', () => {
  const sid = 'unit-tb-guard-block';
  writeTaskFile(sid, { num: '77', tipo: 'fix', origem: 'dev', repositorios: ['back'], escopo: 'x', ts: Date.now() - 31 * 60000 });
  const out = runTbGuard(sid, 'ls');
  clearTask(sid);
  assert.match(out, /VS-TIME-001/);
  assert.match(out, /"permissionDecision":"deny"/);
});

test('VS-TIME-001 guard: dentro do tempo LIBERA (sem deny)', () => {
  const sid = 'unit-tb-guard-ok';
  writeTaskFile(sid, { num: '77', ts: Date.now() - 5 * 60000 });
  const out = runTbGuard(sid, 'ls');
  clearTask(sid);
  assert.doesNotMatch(out, /deny/);
});

test('VS-TIME-001 unlock: dev diz "liberado" -> destrava e reinicia a janela (sem senha)', () => {
  const sid = 'unit-tb-unlock';
  writeTaskFile(sid, { num: '88', tipo: 'fix', origem: 'dev', repositorios: ['back'], escopo: 'x', ts: Date.now() - 45 * 60000 });
  const out = runOnTask('liberado', sid);
  clearTask(sid);
  assert.match(out, /destravado/);
});

test('VS-TIME-001 unlock: palavra diferente de "liberado" NAO destrava', () => {
  const sid = 'unit-tb-nounlock';
  writeTaskFile(sid, { num: '88', tipo: 'fix', origem: 'dev', repositorios: ['back'], escopo: 'x', ts: Date.now() - 45 * 60000 });
  const out = runOnTask('continua ai', sid);
  clearTask(sid);
  assert.doesNotMatch(out, /destravado/);
});

test('git-cmd: invocacao REAL de commit/push (nao palavra solta) — fim do recibo fantasma', () => {
  // reais -> TRUE
  assert.equal(isGitCommit('git commit -m x'), true);
  assert.equal(isGitCommit('git -c user.name=fabiano -c user.email=f@x commit -F msg.txt'), true);
  assert.equal(isGitPush('git push -u origin fix/fabiano.veloso/40000'), true);
  assert.equal(isGitPush('git -C C:/Veloso/Velvet/frontend push'), true);
  assert.equal(isGitPush('cd /repo && git push'), true);
  // FANTASMAS (palavra solta em echo/log/path/subcomando) -> FALSE
  assert.equal(isGitCommit('git rev-parse HEAD; echo "ultimo commit real"; git log'), false);
  assert.equal(isGitCommit('git log --grep=commit'), false);
  assert.equal(isGitCommit('echo "pronto pra commit"'), false);
  assert.equal(isGitCommit('git status'), false);
  assert.equal(isGitPush('git log --oneline | grep push'), false);
  assert.equal(isGitPush('cat .git/HEAD'), false);
});

test('projectLabel: recibo = pai/base consistente (Velvet/frontend), MCP e hooks iguais', () => {
  assert.equal(projectLabel('C:/Veloso/ProjetosMsb/Velvet/frontend'), 'Velvet/frontend');
  assert.equal(projectLabel('C:/Veloso/ProjetosMsb/Velvet/mobile'), 'Velvet/mobile');
  assert.equal(projectLabel('C:/Veloso/ProjetosMsb/Egle/backend'), 'Egle/backend');
});

test('glob: matchAny casa padroes', () => {
  assert.ok(globToRe('**/*.blade.php').test('resources/views/x/y.blade.php'));
  assert.ok(matchAny('app/Http/Livewire/Foo.php', ['app/Http/Livewire/**']));
  assert.equal(matchAny('README.md', ['app/**']), false);
});
