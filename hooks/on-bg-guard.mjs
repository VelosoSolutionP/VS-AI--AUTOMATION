#!/usr/bin/env node
/**
 * Hook PreToolUse (Bash|PowerShell) — BG GUARD (VS-EXEC-001).
 *
 * BLOQUEIA execução em BACKGROUND (`run_in_background: true`). Regra absoluta do
 * fluxo: nada em paralelo/background — UM shell por vez, em FOREGROUND, mostrando
 * ao vivo. O dev precisa ACOMPANHAR (descobre melhorias/travas da governança);
 * background suga token e tira o controle dele. A regra de TEXTO no on-session
 * não basta — a IA ignorava; este hook bloqueia de fato.
 *
 * Opt-out: `.qa-gate-off` no cwd/sessão (bancada) libera.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

// opt-out (bancada): libera background se o cwd/sessão tiver .qa-gate-off
if (existsSync(join(sessionCwd, '.qa-gate-off'))) { allow(); }
// opt-out por SESSÃO (VS-SESSION-001): o dev desarmou esta sessão dizendo "liberado".
if (isSessionOff(sid)) { allow(); }

if (inp.run_in_background === true) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        '[VS-EXEC-001] BLOCKED — proibido rodar em BACKGROUND (run_in_background). ' +
        'Regra absoluta: UM shell por vez, em FOREGROUND, mostrando ao vivo — o dev precisa acompanhar. ' +
        'Rode o mesmo comando SEM run_in_background. Se for demorado (build/deploy), aguarde em foreground ou pergunte ao dev antes.',
    },
  }));
  process.exit(0);
}

allow();
