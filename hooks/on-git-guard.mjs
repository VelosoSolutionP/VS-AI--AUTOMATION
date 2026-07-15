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
 *  - criar nova branch com trabalho da anterior fora do origin (VS-BRANCH-004) — back/front; mobile isento
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadReq, isConsult } from '../engine/branch-req.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
let sid = 'default';
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; sid = j.session_id || 'default'; } catch { cmd = raw; }

const allow = () => process.exit(0);
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}
// opt-out por pasta (bancada de conserto): .qa-gate-off desliga
if (existsSync(join(process.cwd(), '.qa-gate-off'))) { allow(); }
const isGit = /\bgit\b/.test(cmd);
if (!isGit) { allow(); }

// REGRA MOBILE: acumula commits locais, SEM branch de tarefa, SEM push (deploy fim do dia).
const isMobile = /[\\/]mobile([\\/]|$)/i.test(process.cwd());

// add cego
if (/\bgit\s+add\s+(\.|-A\b|--all\b|:\/)/.test(cmd)) {
  deny('[VS-GIT-001] BLOCKED — `git add .` proibido. Adicione só os arquivos da tarefa explicitamente (ex.: git add app/Foo.php resources/views/foo.blade.php).');
}

// criação de branch: exige base de ORIGEM explícita (origin/<x>)
const criaBranch = /\bgit\s+checkout\s+-b\b/.test(cmd) || /\bgit\s+switch\s+-c\b/.test(cmd) || /\bgit\s+branch\s+\S/.test(cmd);
if (criaBranch && isMobile) {
  deny('[VS-MOBILE-002] BLOCKED — mobile NÃO usa branch de tarefa. Acumule os commits na branch atual; o deploy (APK) é só no fim do dia.');
}
// não iniciar nova branch deixando o trabalho da anterior FORA do ambiente (origin).
// só back/front; base protegida (main/dev/hml) é isenta (não é tarefa pendente).
if (criaBranch && !isMobile) {
  try {
    const cur = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const PROT = /^(main|master|dev|develop|hml|homolog\w*|production|prod|staging)$/i;
    if (!PROT.test(cur)) {
      const unpushed = parseInt((execSync('git rev-list --count HEAD --not --remotes', { encoding: 'utf8' }).trim() || '0'), 10);
      const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).length;
      if (unpushed > 0 || dirty > 0) {
        deny(`[VS-BRANCH-004] BLOCKED — a branch atual "${cur}" tem trabalho fora do ambiente (${unpushed} commit(s) não enviado(s), ${dirty} arquivo(s) não commitado(s)). Antes de criar nova branch: commite os arquivos da tarefa + git push -u origin ${cur}. (mobile é isento; back/front obrigatório)`);
      }
    }
  } catch {}
}
if (criaBranch) {
  // estado de branch pendente (número/tipo/origem incompletos) -> não deixa criar
  let pend = null; try { pend = loadReq(sid); } catch {}
  if (pend) {
    const falta = ['num', 'tipo', 'origem'].filter((k) => !pend[k]).join('/');
    deny(`[VS-BRANCH-003] BLOCKED — dados da branch incompletos (falta ${falta}). Informe no chat antes de criar. (desistir: "cancela")`);
  }
  if (!/\borigin\/\w/.test(cmd)) {
    deny('[VS-BRANCH-002] BLOCKED — crie a branch a partir da ORIGEM explícita. Ex.: git fetch origin <origem> && git checkout -b <tipo>/<autor>/<numero> origin/<origem>. Sem origin/<x> a branch nasce do lugar errado e quebra no merge.');
  }
}

const isCommit = /\bcommit\b/.test(cmd);
const isPush = /\bpush\b/.test(cmd);
if (!isCommit && !isPush) { allow(); }

// modo CONSULTA/DOC -> sem commit/push (não abriu tarefa)
if (isConsult(sid)) {
  deny('[VS-CONSULT-001] BLOCKED — sessão em modo CONSULTA/DOC: não commita nem faz push. Pra habilitar, inicie uma tarefa: informe número + tipo + origem (cria a branch).');
}

// mobile não faz push — acumula local; deploy (APK) só no fim do dia, a pedido do Fabiano
if (isPush && isMobile && !existsSync(join(process.cwd(), '.qa-gate-mobile-ok'))) {
  deny('[VS-MOBILE-001] BLOCKED — mobile NÃO faz push. Acumula commits locais; deploy só no fim do dia, quando o Fabiano pedir. Pra liberar agora: touch .qa-gate-mobile-ok');
}

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
