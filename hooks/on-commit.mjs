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
import { getTask } from '../engine/branch-req.mjs';
import { loadCompanyConfig, checkCommitScope } from '../engine/company-config.mjs';
import { isGitCommit } from '../engine/git-cmd.mjs';

const raw = await new Promise((res) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => res(s)); });
let cmd = '';
let sid = 'default';
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; sid = j.session_id || 'default'; } catch { cmd = raw; }

const allow = () => process.exit(0);
// opt-out por pasta (bancada de conserto): .qa-gate-off desliga
if (existsSync(join(process.cwd(), '.qa-gate-off'))) { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

// só age em git commit REAL (não palavra "commit" solta em echo/log/string)
if (!isGitCommit(cmd)) { allow(); }
const m = cmd.match(/-m\s+(["'])([\s\S]*?)\1/);
if (!m) { allow(); } // sem -m (ex.: commit interativo) — não valida

const subject = m[2].split(/\r?\n/)[0].trim();
const PATTERN = /^(feat|feature|fix|perf|refactor|chore|test|docs)(\([a-z0-9._\-\/]+\))?: .{3,}$/i;

if (!PATTERN.test(subject)) {
  deny(`[VS-AUD-003] BLOCKED — commit fora do padrão.\nRecebido: "${subject}"\nEsperado: <tipo>(<numero-da-tarefa>): <descrição>\nEx.: feat(36846): termo de consentimento único\nTipos: feat|fix|perf|refactor|chore|test|docs`);
}

// ESCOPO DO COMMIT conforme a CONFIG DA EMPRESA (default = número da tarefa). Quando há
// tarefa ativa, valida o escopo pela regra configurada — determinístico, não dá pra burlar.
let task = null; try { task = getTask(sid); } catch {}
if (task && task.num) {
  const cfg = loadCompanyConfig(process.cwd());
  const escopo = (subject.match(/^[a-z]+\(([^)]*)\)/i) || [])[1] || '';
  const { ok, expected } = checkCommitScope(cfg, escopo, task.num);
  if (!ok) {
    const tipo = (subject.match(/^([a-z]+)/i) || [])[1] || 'feat';
    const exemplo = (cfg.commitScope === 'modulo') ? `${tipo}(<modulo>): <descrição>` : `${tipo}(${task.num}): <descrição breve>`;
    deny(`[VS-AUD-003] BLOCKED — escopo do commit deve ser ${expected}, não "${escopo || '—'}".\n` +
      `Recebido: "${subject}"\nCorrija p/: ${exemplo}`);
  }
}
// tempo/assinatura de IA proibida no commit
if (/co-authored-by:\s*claude|generated with .*claude/i.test(m[2])) {
  deny('[VS-AUD-003] BLOCKED — commit não pode conter assinatura/atribuição de IA.');
}
// padrão OK -> libera, mas REFORÇA a camada extra de qualidade (regra absoluta):
// tocou código de produção exige teste unitário válido correspondente (VS-AUD-004).
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason:
  '[VS-AUD-004] Mensagem no padrão. CAMADA EXTRA (regra absoluta): se este commit toca código de produção (back/front/mobile), confirme que existe teste unitário VÁLIDO correspondente à mudança (cobre o que mudou, não placeholder). Sem teste, sem commit — se faltar, VOCÊ (a IA) escreve antes, mesmo que não tenha sido pedido no escopo.' } }));
process.exit(0);
