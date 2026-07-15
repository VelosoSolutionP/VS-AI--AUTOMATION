#!/usr/bin/env node
/**
 * Hook PreToolUse (Bash) — GIT GUARD. Obriga o fluxo do Fabiano de forma determinística.
 * O agente NÃO consegue ignorar (hook bloqueia de fato). Escopo: projeto que o registrar.
 *
 * Bloqueia:
 *  - git add . / -A / --all           (VS-GIT-001)  -> add cego proibido
 *  - commit/push em branch protegida  (VS-GIT-002)  -> main/master/dev/hml/prod
 *  - commit sem --no-verify burlando   (deixa hooks rodarem)
 * Avisa (não bloqueia):
 *  - branch fora do padrão tipo/fabiano.veloso/<n>  (VS-GIT-003)
 */
import { execSync } from 'node:child_process';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; } catch { cmd = raw; }

const allow = () => process.exit(0);
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}
const isGit = /\bgit\b/.test(cmd);
if (!isGit) { allow(); }

// add cego
if (/\bgit\s+add\s+(\.|-A\b|--all\b|:\/)/.test(cmd)) {
  deny('[VS-GIT-001] BLOCKED — `git add .` proibido. Adicione só os arquivos da tarefa explicitamente (ex.: git add app/Foo.php resources/views/foo.blade.php).');
}

// criação de branch: exige base de ORIGEM explícita (origin/<x>)
const criaBranch = /\bgit\s+checkout\s+-b\b/.test(cmd) || /\bgit\s+switch\s+-c\b/.test(cmd) || /\bgit\s+branch\s+\S/.test(cmd);
if (criaBranch && !/\borigin\/\w/.test(cmd)) {
  deny('[VS-BRANCH-002] BLOCKED — crie a branch a partir da ORIGEM explícita. Ex.: git fetch origin <origem> && git checkout -b <tipo>/<autor>/<numero> origin/<origem>. Sem origin/<x> a branch nasce do lugar errado e quebra no merge.');
}

const isCommit = /\bcommit\b/.test(cmd);
const isPush = /\bpush\b/.test(cmd);
if (!isCommit && !isPush) { allow(); }

// --no-verify burla os hooks
if (/--no-verify|-n\b/.test(cmd)) {
  deny('[VS-GIT-002] BLOCKED — `--no-verify` proibido: burla o QA-Gate/governança. Rode a validação.');
}

let branch = '';
try { branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(); } catch { allow(); }

const PROTECTED = /^(main|master|dev|develop|hml|homolog\w*|production|prod|staging)$/i;
if (PROTECTED.test(branch)) {
  deny(`[VS-GIT-002] BLOCKED — ${isPush ? 'push' : 'commit'} direto em "${branch}" proibido. Crie a branch da tarefa: git checkout -b fix/fabiano.veloso/<numero> origin/${branch}`);
}

// branch fora do padrão -> só avisa (não bloqueia)
const PATTERN = /^(fix|feat|feature|perf|refactor|chore|test|docs)\/fabiano\.veloso\/.+/i;
if (!PATTERN.test(branch)) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `[VS-GIT-003] aviso — branch "${branch}" fora do padrão tipo/fabiano.veloso/<numero>.` } }));
  process.exit(0);
}
allow();
