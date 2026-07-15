#!/usr/bin/env node
/**
 * Hook PreToolUse (git commit) — AUD: valida padrão de commit ANTES de executar.
 * Determinístico. Bloqueia commit fora do padrão (VS-AUD-003).
 * Padrão: <tipo>(<escopo>): <descrição>  — tipo em feat|fix|perf|refactor|chore|test|docs.
 *
 * Contrato PreToolUse: stdin { tool_name, tool_input:{command} };
 * nega com permissionDecision "deny".
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const raw = await new Promise((res) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => res(s)); });
let cmd = '';
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; } catch { cmd = raw; }

const allow = () => process.exit(0);
// opt-out por pasta (bancada de conserto): .qa-gate-off desliga
if (existsSync(join(process.cwd(), '.qa-gate-off'))) { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

// só age em git commit com mensagem
if (!/\bgit\b[\s\S]*\bcommit\b/.test(cmd)) { allow(); }
const m = cmd.match(/-m\s+(["'])([\s\S]*?)\1/);
if (!m) { allow(); } // sem -m (ex.: commit interativo) — não valida

const subject = m[2].split(/\r?\n/)[0].trim();
const PATTERN = /^(feat|feature|fix|perf|refactor|chore|test|docs)(\([a-z0-9._\-\/]+\))?: .{3,}$/i;

if (!PATTERN.test(subject)) {
  deny(`[VS-AUD-003] BLOCKED — commit fora do padrão.\nRecebido: "${subject}"\nEsperado: <tipo>(<escopo>): <descrição>\nTipos: feat|fix|perf|refactor|chore|test|docs`);
}
// tempo/assinatura de IA proibida no commit
if (/co-authored-by:\s*claude|generated with .*claude/i.test(m[2])) {
  deny('[VS-AUD-003] BLOCKED — commit não pode conter assinatura/atribuição de IA.');
}
allow();
