import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTask } from '../engine/requirements.mjs';
import { recordTask, loadEvents, aggregate } from '../engine/metrics.mjs';
import { hasConsent, setConsent, collectIfConsented } from '../engine/consent.mjs';
import { verifyLicense } from '../license/license.mjs';
import { issueLicense } from '../license/issue.mjs';
import { globToRe, matchAny, normalizeStartCommand } from '../engine/core.mjs';
import { timeBoxStatus, timeBoxLimitMin, TIME_BOX_MIN } from '../engine/timebox.mjs';
import { resolveGitCwd } from '../engine/git-cwd.mjs';
import { isGitCommit, isGitPush, hasPowerShellHereStringAt, createsBranch } from '../engine/git-cmd.mjs';
import { projectLabel } from '../engine/notify-whatsapp.mjs';
import { isMergeContext, isPromotionBranch } from '../engine/git-merge.mjs';
import { resolve as pathResolve } from 'node:path';
import { parseBranch, setTask, clearTask, setPreflight, clearPreflight, isPreflight } from '../engine/branch-req.mjs';
import { DEFAULT_CONFIG, branchName, branchRegex, checkCommitScope, patternUsesNumero } from '../engine/company-config.mjs';
import { discoverRepos, resolveTargets } from '../engine/branch-create.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dir, '..', 'hooks', 'on-task.mjs');
const TB_GUARD = join(__dir, '..', 'hooks', 'on-timebox-guard.mjs');

// Roda o hook UserPromptSubmit como subprocesso (cwd limpo p/ não pegar .qa-gate-off do repo).
function runOnTask(prompt, sid) {
  const cwd = join(tmpdir(), 'qa-gate-ontask-test');
  try { mkdirSync(cwd, { recursive: true }); } catch {}
  // Empresa CONFIGURADA (o que a entrevista grava). Sem isso o hook bloqueia a tarefa
  // por padrão de branch ausente — que é o comportamento correto, coberto à parte.
  try {
    writeFileSync(join(cwd, 'qa-gate.company.json'), JSON.stringify({
      autor: 'nome.sobrenome',
      branchPattern: '<tipo>/<autor>/<numero>',
      tipos: ['fix', 'feat'],
    }));
  } catch {}
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

const ONCOMMIT = join(__dir, '..', 'hooks', 'on-commit.mjs');
function runOnCommit(command) {
  const cwd = join(tmpdir(), 'qa-gate-oncommit-test');
  try { mkdirSync(cwd, { recursive: true }); } catch {}
  const r = spawnSync('node', [ONCOMMIT], { input: JSON.stringify({ tool_input: { command }, session_id: 'oc-test' }), cwd, encoding: 'utf8' });
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

test('company-config: DEFAULT não embute autor (vem da entrevista) + escopo número', () => {
  assert.equal(DEFAULT_CONFIG.autor, null);
  // com o autor da empresa, o pattern expande normalmente
  const cfg = { ...DEFAULT_CONFIG, autor: 'nome.sobrenome' };
  assert.equal(branchName(cfg, { tipo: 'feat', numero: '36846' }), 'feat/nome.sobrenome/36846');
  assert.equal(checkCommitScope(DEFAULT_CONFIG, '36846', '36846').ok, true);
  assert.equal(checkCommitScope(DEFAULT_CONFIG, 'consent', '36846').ok, false); // módulo barra
  assert.equal(patternUsesNumero(DEFAULT_CONFIG), true);
});

test('company-config: pattern usa <autor> sem autor configurado -> FALHA ALTO', () => {
  assert.throws(
    () => branchName(DEFAULT_CONFIG, { tipo: 'feat', numero: '36846' }),
    /autor não está configurado/,
  );
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

test('governança: empresa SEM autor configurado bloqueia a tarefa (não inventa default)', () => {
  const sid = 'unit-sem-autor';
  clearPreflight(sid);
  clearTask(sid);
  // company.json com pattern que usa <autor>, mas sem o autor respondido na entrevista
  const cfgFile = join(tmpdir(), 'qa-gate-sem-autor.company.json');
  writeFileSync(cfgFile, JSON.stringify({ branchPattern: '<tipo>/<autor>/<numero>', tipos: ['fix'] }));
  const cwd = join(tmpdir(), 'qa-gate-ontask-noautor');
  try { mkdirSync(cwd, { recursive: true }); } catch {}
  const run = (prompt) => spawnSync('node', [HOOK], {
    input: JSON.stringify({ prompt, session_id: sid }),
    cwd,
    encoding: 'utf8',
    env: { ...process.env, QA_GATE_COMPANY_CONFIG: cfgFile },
  }).stdout || '';
  run('100 fix dev back');
  const out = run('corrige o cadastro que nao salva ao editar');
  clearPreflight(sid);
  clearTask(sid);
  assert.match(out, /TAREFA BLOQUEADA/);
  assert.match(out, /autor não está configurado/);
  assert.doesNotMatch(out, /fix\/\/100/); // nunca monta branch quebrada
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

test('CMMI: hasPowerShellHereStringAt pega @ vazado no commit (VS-AUD-005)', () => {
  // MISUSO @'...'@ na Bash -> "@" vaza pro titulo -> TRUE (bloqueia)
  assert.equal(hasPowerShellHereStringAt("git commit -m @'\nfix(35575): trata dado sensivel\n'@"), true);
  assert.equal(hasPowerShellHereStringAt("git -c user.name=x commit -m @'fix(2): y'@"), true);
  assert.equal(hasPowerShellHereStringAt('git commit -m @"fix(3): z"@'), true);
  // formas corretas -> FALSE (libera)
  assert.equal(hasPowerShellHereStringAt('git commit -m "fix(1): descricao ok"'), false);
  assert.equal(hasPowerShellHereStringAt('git commit -F msg.txt'), false);
  assert.equal(hasPowerShellHereStringAt('git commit -m "corrige login do user@dominio"'), false);
});

test('VS-AUD-005 on-commit: BLOQUEIA commit com @ vazado (here-string @...@)', () => {
  const out = runOnCommit("git commit -m @'\nfix(35575): trata dado sensivel\n'@");
  assert.match(out, /VS-AUD-005/);
  assert.match(out, /"permissionDecision":"deny"/);
});

test('on-commit: LIBERA commit no padrao correto (aspas normais)', () => {
  const out = runOnCommit('git commit -m "fix(35575): trata dado sensivel na edicao"');
  assert.doesNotMatch(out, /VS-AUD-005/);
  assert.doesNotMatch(out, /"permissionDecision":"deny"/);
});

test('promocao: branch merge-hml reconhecida (isenta de numero); tarefa normal NAO', () => {
  assert.equal(isPromotionBranch('fix/fabiano.veloso/merge-hml'), true);
  assert.equal(isPromotionBranch('fix/fabiano.veloso/merge-main'), true);
  assert.equal(isPromotionBranch('fix/fabiano.veloso/37069'), false);
  assert.equal(isPromotionBranch('feat/fabiano.veloso/36846'), false);
});

test('git-merge: isMergeContext (git merge -> true; commit direto -> false)', () => {
  const tmp = join(tmpdir(), 'qa-gate-merge2');
  try { mkdirSync(tmp, { recursive: true }); } catch {}
  assert.equal(isMergeContext('git merge origin/dev', tmp), true);
  assert.equal(isMergeContext('git commit -m "fix(1): x"', tmp), false);
});

test('on-commit: LIBERA merge commit da promocao (Merge branch ...)', () => {
  const out = runOnCommit("git commit -m \"Merge branch 'dev' into fix/fabiano.veloso/merge-hml\"");
  assert.doesNotMatch(out, /"permissionDecision":"deny"/);
  assert.doesNotMatch(out, /VS-AUD-003/);
});

test('createsBranch: LISTAGEM nao e criacao (fim do falso VS-BRANCH-002)', () => {
  // criam de fato
  assert.equal(createsBranch('git checkout -b fix/nome.sobrenome/123 origin/dev'), true);
  assert.equal(createsBranch('git switch -c fix/nome.sobrenome/123'), true);
  assert.equal(createsBranch('git branch fix/nome.sobrenome/123 origin/dev'), true);
  // consulta/faxina: NAO criam -> o guard nao pode exigir origin/<origem>
  assert.equal(createsBranch('git branch'), false);
  assert.equal(createsBranch('git branch -a'), false);
  assert.equal(createsBranch('git branch --show-current'), false);
  assert.equal(createsBranch("git branch --format='%(refname:short)' refs/heads"), false);
  assert.equal(createsBranch("git branch --list 'fix/*36481*'"), false); // checagem "bug voltou"
  assert.equal(createsBranch('git branch -d fix/nome.sobrenome/123'), false);
  assert.equal(createsBranch('git -C /repo branch -r'), false);
  assert.equal(createsBranch('git status -sb'), false);
});

test('escopo: mensagem que e SO o numero (ou so os campos) NAO vira escopo', () => {
  const sid = 'unit-escopo-numero';
  clearPreflight(sid);
  clearTask(sid);
  const t1 = runOnTask('39311 feat hml front back', sid); // 4 campos core -> pede escopo
  const t2 = runOnTask('39311', sid);                     // repetiu o numero: NAO e escopo
  const t3 = runOnTask('nao carrega o painel de OS ao filtrar por status', sid); // escopo real
  clearPreflight(sid);
  clearTask(sid);
  assert.match(t1, /VS-BRANCH-001/);
  assert.match(t2, /VS-BRANCH-001/);          // continua pedindo
  assert.doesNotMatch(t2, /PASSO 1 OBRIGAT/); // e NAO abre tarefa com escopo="39311"
  assert.match(t3, /PASSO 1 OBRIGAT/);        // descricao de verdade abre normalmente
  assert.match(t3, /TAREFA #39311/);
});

test('discoverRepos: classifica camadas; monolito entra 1x (1 branch, nao 2)', () => {
  const base = join(tmpdir(), 'qa-gate-disc-' + process.pid);
  try { rmSync(base, { recursive: true, force: true }); } catch {}
  for (const d of ['ProjA/backend/.git', 'ProjA/frontend/.git', 'ProjA/mobile/.git', 'ProjB/sigater/.git']) {
    mkdirSync(join(base, d), { recursive: true });
  }
  const a = discoverRepos(join(base, 'ProjA'));
  assert.equal(basename(a.map.back), 'backend');
  assert.equal(basename(a.map.front), 'frontend');
  assert.equal(basename(a.map.mobile), 'mobile');
  assert.equal(resolveTargets(['front', 'back', 'mobile'], a).length, 3);
  // cwd DENTRO de um repo tem que achar o projeto (sobe 1 nivel)
  const dentro = discoverRepos(join(base, 'ProjA', 'backend'));
  assert.equal(basename(dentro.map.back), 'backend');
  // monolito (front e back no mesmo repo): "front back" = UM alvo
  const b = discoverRepos(join(base, 'ProjB'));
  assert.equal(basename(b.unico), 'sigater');
  assert.equal(resolveTargets(['front', 'back'], b).length, 1);
  try { rmSync(base, { recursive: true, force: true }); } catch {}
});

test('VS-BRANCH-009: o hook CRIA a branch nos repos escolhidos (back+front)', () => {
  const base = join(tmpdir(), 'qa-gate-bc-' + process.pid);
  try { rmSync(base, { recursive: true, force: true }); } catch {}
  const g = (args, cwd) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) { throw new Error('git ' + args.join(' ') + ' -> ' + (r.stderr || r.stdout)); }
    return (r.stdout || '').trim();
  };
  const remoto = join(base, 'remoto.git');
  const seed = join(base, 'seed');
  const proj = join(base, 'ProjetoX');
  mkdirSync(remoto, { recursive: true });
  mkdirSync(seed, { recursive: true });
  mkdirSync(proj, { recursive: true });
  g(['init', '--bare', '-b', 'dev', '.'], remoto);
  g(['init', '-b', 'dev', '.'], seed);
  writeFileSync(join(seed, 'a.txt'), 'x');
  g(['add', 'a.txt'], seed);
  g(['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-m', 'seed'], seed);
  g(['remote', 'add', 'origin', remoto], seed);
  g(['push', '-u', 'origin', 'dev'], seed);
  g(['clone', remoto, 'backend'], proj);
  g(['clone', remoto, 'frontend'], proj);
  writeFileSync(join(proj, 'qa-gate.company.json'), JSON.stringify({
    autor: 'nome.sobrenome', branchPattern: '<tipo>/<autor>/<numero>', tipos: ['fix', 'feat'],
  }));
  const sid = 'unit-bc-' + process.pid;
  clearPreflight(sid);
  clearTask(sid);
  const run = (prompt) => spawnSync('node', [HOOK], {
    input: JSON.stringify({ prompt, session_id: sid }), cwd: proj, encoding: 'utf8',
  }).stdout || '';
  run('12345 fix origem dev repositorios: front back'); // 4 campos core -> pede escopo
  const out = run('nao lista os registros ao filtrar por status'); // escopo -> abre e CRIA
  const hb = g(['rev-parse', '--abbrev-ref', 'HEAD'], join(proj, 'backend'));
  const hf = g(['rev-parse', '--abbrev-ref', 'HEAD'], join(proj, 'frontend'));
  clearPreflight(sid);
  clearTask(sid);
  try { rmSync(base, { recursive: true, force: true }); } catch {}
  assert.match(out, /CRIADA/);
  assert.equal(hb, 'fix/nome.sobrenome/12345'); // branch existe DE VERDADE, nao instrucao
  assert.equal(hf, 'fix/nome.sobrenome/12345');
});

test('campo NAO sai de palavra solta em frase de conversa (caso #5578)', () => {
  const sid = 'unit-campo-frase';
  clearPreflight(sid);
  clearTask(sid);
  const t1 = runOnTask('5578', sid); // numero deliberado, resto falta
  // frases de conversa: "tudo" NAO pode virar repositorios, "main" NAO pode virar origem
  const t2 = runOnTask('criar branch na coleta de dados vc ja fez tudo so falta subir', sid);
  const t3 = runOnTask('ta foda preciso seguir com minhas tarefas na main de novo', sid);
  clearPreflight(sid);
  clearTask(sid);
  assert.match(t1, /VS-BRANCH-001/);
  // nenhuma das frases fecha o checklist: continua pedindo, sem inventar campo
  for (const out of [t2, t3]) {
    assert.doesNotMatch(out, /TAREFA #5578 \(/); // nao abriu tarefa
    assert.doesNotMatch(out, /FRONT\+BACK\+MOBILE/); // nao inventou repositorios
  }
  // e a IA passa a SABER que a tarefa esta pendente (fim do "me passa o numero" em loop)
  assert.match(t3, /PENDENTE de abertura[\s\S]*n[úu]mero 5578/i);
});

test('resposta de checklist (rotulada ou so valores) CONTINUA alimentando o campo', () => {
  const sid = 'unit-campo-resposta';
  clearPreflight(sid);
  clearTask(sid);
  runOnTask('5578', sid);
  runOnTask('fix', sid);                    // so valor
  runOnTask('origem dev', sid);             // rotulada
  const t = runOnTask('repositorios: back', sid);
  const abriu = runOnTask('nao salva o cadastro ao editar o registro', sid);
  clearPreflight(sid);
  clearTask(sid);
  assert.match(t, /③ ✅ ORIGEM dev/);       // aceitou os campos respondidos
  assert.match(abriu, /TAREFA #5578 \(fix\)/);
  assert.match(abriu, /REPOSIT[ÓO]RIOS=BACK/);
});

test('glob: matchAny casa padroes', () => {
  assert.ok(globToRe('**/*.blade.php').test('resources/views/x/y.blade.php'));
  assert.ok(matchAny('app/Http/Livewire/Foo.php', ['app/Http/Livewire/**']));
  assert.equal(matchAny('README.md', ['app/**']), false);
});
