#!/usr/bin/env node
/**
 * Hook PreToolUse (git commit) — AUD: valida padrao de git commit ANTES de executar.
 * Deterministico. Bloqueia git commit fora do padrao (VS-AUD-003).
 * Padrao: <tipo>(<numero-da-tarefa>): <descricao curta>
 *         <linha em branco>
 *         <descricao detalhada da tarefa>
 *
 * Contrato PreToolUse: stdin { tool_name, cwd, tool_input:{command} };
 * nega com permissionDecision "deny".
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { getTask } from '../engine/branch-req.mjs';
import { loadCompanyConfig, checkCommitScope } from '../engine/company-config.mjs';
import { isGitCommit, hasPowerShellHereStringAt, extractCommitMessage } from '../engine/git-cmd.mjs';
import { resolveGitCwd } from '../engine/git-cwd.mjs';
import { evaluateUnitTestGuard } from '../engine/unit-test-guard.mjs';

const raw = await new Promise((res) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => res(s)); });
let cmd = '';
let sid = 'default';
let sessionCwd = process.cwd();
try {
  const j = JSON.parse(raw || '{}');
  cmd = j.tool_input?.command || j.command || '';
  sid = j.session_id || 'default';
  // cwd da SESSAO vem no payload. Usar process.cwd() aqui fazia o hook validar o
  // repo errado (e o `git diff --cached` estourar fora de repo -> catch -> libera
  // git commit sem checar teste). O repo REAL sai de resolveGitCwd.
  sessionCwd = j.cwd || j.tool_input?.cwd || process.cwd();
} catch { cmd = raw; }

const allow = () => process.exit(0);
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

// so age em git commit REAL (nao palavra "commit" solta em echo/log/string)
if (!isGitCommit(cmd)) { allow(); }

const gitCwd = resolveGitCwd(cmd, sessionCwd);

// opt-out por pasta (bancada de conserto): .qa-gate-off desliga — no REPO do git commit,
// nao na pasta da sessao (senao um arquivo solto desligava o gate de todos os repos).
if (existsSync(join(gitCwd, '.qa-gate-off'))) { allow(); }

// BLINDAGEM CMMI (ABSOLUTA, VS-AUD-005): here-string PowerShell @\'...\'@ usada na tool
// Bash (POSIX) vaza um "@" pro TITULO do git commit ("@ fix(123): ..."), quebra o padrao e a
// certificacao. O "@" fica FORA das aspas, entao o parser de -m nem enxerga.
if (hasPowerShellHereStringAt(cmd)) {
  deny('[VS-AUD-005] BLOCKED — sintaxe de commit invalida: here-string PowerShell @\'...\'@ na tool Bash (POSIX). O "@" vaza pro TITULO do commit e quebra o padrao/CMMI. Use heredoc bash (`-F - <<\'EOF\' ... EOF`) OU -m. NUNCA @\'...\'@ aqui.');
}

// MENSAGEM REAL: todos os -m, o -F <arquivo> e o heredoc. O parser antigo lia so o
// primeiro -m, entao `-F arquivo`, heredoc e assinatura de IA no 2o -m passavam batido.
const msg = extractCommitMessage(cmd, gitCwd);
const cfg = loadCompanyConfig(gitCwd);

// formas legitimas sem mensagem nova: reaproveitam a mensagem ja existente.
const SEM_MSG_OK = /(^|\s)(--amend\b[\s\S]*--no-edit|--no-edit|--fixup(=|\s)|--squash(=|\s)|-C\s|--reuse-message|-c\s|--reedit-message)/.test(cmd);

if (!msg.full.trim()) {
  if (!SEM_MSG_OK) {
    deny('[VS-AUD-003] BLOCKED — nao consegui LER a mensagem deste commit, entao nao da pra auditar o padrao. ' +
      'Use uma forma auditavel: `-m "<tipo>(<numero>): <descricao>" -m "<descricao detalhada>"` ou heredoc `-F - <<\'EOF\' ... EOF`. ' +
      'Se usou `-F arquivo`, crie o arquivo no MESMO comando (heredoc) ou passe a mensagem por -m.');
  }
} else if (!/^Merge\b/i.test(msg.subject)) {
  // merge / promocao de ambiente nao segue o padrao de tarefa (e juncao via MR) — liberado.
  const PATTERN = /^(feat|feature|fix|perf|refactor|chore|test|docs|hotfix|build|ci|style|revert)(\([a-z0-9._\-\/]+\))?: .{3,}$/i;

  if (/^@/.test(msg.subject) || !PATTERN.test(msg.subject)) {
    deny(`[VS-AUD-003] BLOCKED — commit fora do padrao.\nRecebido: "${msg.subject}"\nEsperado: <tipo>(<numero-da-tarefa>): <descricao>\nEx.: feat(36846): termo de consentimento unico\nTipos: feat|fix|perf|refactor|chore|test|docs`);
  }

  // ESCOPO conforme a CONFIG DA EMPRESA (default = numero da tarefa).
  let task = null; try { task = getTask(sid); } catch {}
  if (task && task.num) {
    const escopo = (msg.subject.match(/^[a-z]+\(([^)]*)\)/i) || [])[1] || '';
    const { ok, expected } = checkCommitScope(cfg, escopo, task.num);
    if (!ok) {
      const tipo = (msg.subject.match(/^([a-z]+)/i) || [])[1] || 'feat';
      const exemplo = (cfg.commitScope === 'modulo') ? `${tipo}(<modulo>): <descricao>` : `${tipo}(${task.num}): <descricao breve>`;
      deny(`[VS-AUD-003] BLOCKED — escopo do commit deve ser ${expected}, nao "${escopo || '—'}".\n` +
        `Recebido: "${msg.subject}"\nCorrija p/: ${exemplo}`);
    }
  }

  // CORPO OBRIGATORIO: titulo curto + descricao detalhada da tarefa. Titulo sozinho
  // nao documenta nada e o revisor abre o MR sem contexto. Desliga com
  // requireCommitBody:false no qa-gate.company.json.
  if (cfg.requireCommitBody) {
    const min = cfg.commitBodyMinChars || 20;
    const corpo = msg.body.replace(/^\s*#.*$/gm, '').trim();
    if (corpo.length < min) {
      deny(`[VS-AUD-006] BLOCKED — commit sem DESCRICAO DETALHADA. O padrao e titulo curto + corpo explicando a tarefa (minimo ${min} caracteres).\n` +
        `Recebido: "${msg.subject}" (corpo: ${corpo.length} chars)\n` +
        `Use: -m "${msg.subject}" -m "<o que mudou, por que, e o impacto>"`);
    }
  }
}

// assinatura de IA proibida — na mensagem INTEIRA (era so o 1o -m; o padrao do
// Co-Authored-By e justamente ir no 2o -m / no corpo).
if (/co-authored-by:\s*claude|generated with .*claude|claude\.com\/claude-code/i.test(msg.full)) {
  deny('[VS-AUD-003] BLOCKED — commit nao pode conter assinatura/atribuicao de IA (Co-Authored-By / "Generated with"). Remova do corpo da mensagem.');
}

// CAMADA EXTRA (regra absoluta, VS-AUD-004): tocou codigo de producao exige teste
// unitario no MESMO commit. Roda SEMPRE — inclusive em -F/heredoc/--amend, que antes
// saiam pelo allow() antecipado sem passar por aqui.
try {
  const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8', cwd: gitCwd })
    .split(/\r?\n/).filter(Boolean);
  const { blocked, missing } = evaluateUnitTestGuard(staged);
  if (blocked) {
    deny('[VS-AUD-004] BLOCKED — tocou codigo de producao sem teste unitario no commit. ' +
      'Camada EXTRA (mesmo nivel do "so commita no verde"): back (Pest/PHPUnit), front (vitest/jest) ou mobile (flutter test). ' +
      'VOCE (a IA) escreve o teste que cobre a mudanca (nao placeholder) ANTES de commitar, mesmo sem pedido no escopo.\n' +
      'Sem teste correspondente:\n - ' + missing.join('\n - '));
  }
} catch { /* sem repo/git indisponivel: nao trava por erro de infra */ }

// padrao OK + corpo OK + teste presente -> libera.
process.exit(0);
