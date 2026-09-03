#!/usr/bin/env node
/**
 * Hook PreToolUse (Edit|Write|MultiEdit) — BRANCH FIRST (VS-BRANCH-008).
 *
 * BLOQUEIA editar CÓDIGO DE PRODUÇÃO enquanto o repo está numa BRANCH BASE
 * protegida (main, master, dev, develop, hml, homolog, prod, staging). Regra do fluxo:
 * a BRANCH VEM PRIMEIRO, depois trabalha NELA. As IAs vinham fazendo a correção
 * em cima da base e só criavam a branch no commit — o muro do commit (VS-BRANCH-006/
 * VS-GIT-002) pega tarde, com o código já escrito no lugar errado. Este guard fecha
 * na ORIGEM: sem feature branch, não edita.
 *
 * Só código-fonte (não trava README/JSON/env em manutenção pontual). Fora de repo
 * git = libera (scratchpad/temp). Opt-out: `.qa-gate-off` no repo do arquivo OU na
 * sessão (bancada de conserto).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { isSessionOff } from '../engine/branch-req.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let inp = {};
let sessionCwd = process.cwd();
let sid = 'default';
try {
  const j = JSON.parse(raw || '{}');
  inp = j.tool_input || {};
  sessionCwd = j.cwd || inp.cwd || process.cwd();
  sid = j.session_id || 'default';
} catch {}

const allow = () => process.exit(0);
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

// opt-out (bancada): libera se a sessão tiver .qa-gate-off
if (existsSync(join(sessionCwd, '.qa-gate-off'))) { allow(); }
// opt-out por SESSÃO (VS-SESSION-001): o dev desarmou esta sessão dizendo "liberado".
if (isSessionOff(sid)) { allow(); }

const filePath = inp.file_path || inp.path || inp.relative_path || '';
if (!filePath) { allow(); }

// só código de produção (não trava doc/config em manutenção pontual na base)
const isCode = /\.(php|dart|ts|tsx|js|jsx|vue|py)$/i.test(filePath) || /\.blade\.php$/i.test(filePath);
if (!isCode) { allow(); }

const fileDir = dirname(isAbsolute(filePath) ? filePath : join(sessionCwd, filePath));

// opt-out no repo do arquivo
if (existsSync(join(fileDir, '.qa-gate-off'))) { allow(); }

let repoRoot = fileDir;
try { repoRoot = execSync('git rev-parse --show-toplevel', { cwd: fileDir, encoding: 'utf8' }).trim() || fileDir; } catch { allow(); }
if (existsSync(join(repoRoot, '.qa-gate-off'))) { allow(); }

let branch = '';
try { branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: fileDir, encoding: 'utf8' }).trim(); } catch { allow(); }

const PROTECTED = /^(main|master|dev|develop|desenvolvimento|hml|homolog\w*|production|prod|staging)$/i;
if (PROTECTED.test(branch)) {
  deny(
    `[VS-BRANCH-008] BLOCKED — proibido EDITAR código na branch base "${branch}". ` +
    'BRANCH PRIMEIRO, depois trabalha nela. Crie a feature branch da tarefa ANTES de qualquer correção: ' +
    'git fetch origin ' + branch + ' && git checkout -b <tipo>/fabiano.veloso/<numero> origin/' + branch + ' — ' +
    'e faça a alteração NELA. Nada de corrigir na base e criar branch depois.'
  );
}

allow();
