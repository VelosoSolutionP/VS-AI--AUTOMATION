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
import { execSync } from 'node:child_process';
import { getTask } from '../engine/branch-req.mjs';
import { loadCompanyConfig, checkCommitScope } from '../engine/company-config.mjs';
import { isGitCommit, hasPowerShellHereStringAt } from '../engine/git-cmd.mjs';
import { resolveGitCwd } from '../engine/git-cwd.mjs';
import { evaluateUnitTestGuard } from '../engine/unit-test-guard.mjs';

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

// BLINDAGEM CMMI (ABSOLUTA, VS-AUD-005): here-string PowerShell @'...'@ usada na tool
// Bash (POSIX) vaza um "@" pro TÍTULO do commit ("@ fix(123): ..."), quebra o padrão e a
// certificação. O "@" fica FORA das aspas, então o parser de -m nem enxerga. BLOQUEIA a
// sintaxe na origem — antes de qualquer outra validação.
if (hasPowerShellHereStringAt(cmd)) {
  deny('[VS-AUD-005] BLOCKED — sintaxe de commit inválida: here-string PowerShell @\'...\'@ na tool Bash (POSIX). O "@" vaza pro TÍTULO do commit e quebra o padrão/CMMI. Use `git commit -F <arquivo>` OU heredoc bash (`git commit -F - <<\'EOF\' ... EOF`). NUNCA @\'...\'@ aqui.');
}

const m = cmd.match(/-m\s+(["'])([\s\S]*?)\1/);
if (!m) { allow(); } // sem -m (ex.: commit -F arquivo/heredoc) — validado por outra via

const subject = m[2].split(/\r?\n/)[0].trim();
// merge / promoção de ambiente: "Merge branch ..." não segue o padrão de tarefa (é junção
// via MR) — liberado. NÃO libera commit direto de código em protegida (VS-GIT-002 segue).
if (/^Merge\b/i.test(subject)) { allow(); }
const PATTERN = /^(feat|feature|fix|perf|refactor|chore|test|docs)(\([a-z0-9._\-\/]+\))?: .{3,}$/i;

// belt: subject NUNCA pode começar com "@" (resíduo de here-string) nem char estranho
if (/^@/.test(subject) || !PATTERN.test(subject)) {
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
// CAMADA EXTRA (regra absoluta, VS-AUD-004): tocou código de produção (back/front/mobile)
// exige teste unitário no MESMO commit. Enforcement determinístico — analisa o diff staged
// e BLOQUEIA (não é lembrete). Se um teste também está staged, libera; senão, nega.
try {
  const gitCwd = resolveGitCwd(cmd, process.cwd());
  const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8', cwd: gitCwd })
    .split(/\r?\n/).filter(Boolean);
  const { blocked, missing } = evaluateUnitTestGuard(staged);
  if (blocked) {
    deny('[VS-AUD-004] BLOCKED — tocou código de produção sem teste unitário no commit. ' +
      'Camada EXTRA (mesmo nível do "só commita no verde"): back (Pest/PHPUnit), front (vitest/jest) ou mobile (flutter test). ' +
      'VOCÊ (a IA) escreve o teste que cobre a mudança (não placeholder) ANTES de commitar, mesmo sem pedido no escopo.\n' +
      'Sem teste correspondente:\n - ' + missing.join('\n - '));
  }
} catch { /* sem repo/git indisponível: não trava por erro de infra */ }

// padrão OK + teste presente -> libera.
process.exit(0);
