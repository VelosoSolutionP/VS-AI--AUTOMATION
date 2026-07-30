#!/usr/bin/env node
/**
 * Hook PreToolUse (TODOS os tools) — TIME-BOX de SESSÃO (VS-TIME-001).
 *
 * Tarefa ativa que passou do teto (30min, "sem mimi") BLOQUEIA a SESSÃO INTEIRA: qualquer
 * tool é negado até o dev voltar e investigar. Chama o dev no Slack (1x, dedupe pelo
 * marcador de ajuda). A IA PARA e deixa a explicação do porquê da demora em TEXTO (texto
 * não é tool — não é bloqueado). Destrava:
 *   - o dev manda "libera/destrava/investiguei/..." (on-task reinicia a janela), ou
 *   - o admin anexa a senha 9601 a um comando (reinicia a janela aqui mesmo).
 * A IA NÃO se auto-libera.
 *
 * Isento: .qa-gate-off (pasta/sessão) e sessão desligada. Sem tarefa ativa = no-op.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getTask, isSessionOff } from '../engine/branch-req.mjs';
import { loadCompanyConfig } from '../engine/company-config.mjs';
import { timeBoxStatus } from '../engine/timebox.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let sid = 'default';
let cwd = process.cwd();
try {
  const j = JSON.parse(raw || '{}');
  sid = j.session_id || 'default';
  cwd = j.cwd || j.tool_input?.cwd || process.cwd();
} catch {}

const allow = () => process.exit(0);
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

// isenções
if (existsSync(join(cwd, '.qa-gate-off')) || isSessionOff(sid)) { allow(); }

let task = null; try { task = getTask(sid); } catch {}
if (!task || !task.num || !task.ts) { allow(); }

const cfg = loadCompanyConfig(cwd);
const st = timeBoxStatus(task, Date.now(), cfg);
if (!st.overdue) { allow(); }

// chama o dev no Slack/WhatsApp 1x (dedupe pelo marcador de ajuda da tarefa)
try {
  const { readMarkers, markNotified } = await import('../engine/help-state.mjs');
  const { notify, devName, projectLabel } = await import('../engine/notify-whatsapp.mjs');
  const mk = readMarkers().find((m) => String(m.data.task) === String(task.num) && !m.data.notified);
  const r = await notify({
    project: projectLabel(cwd),
    task: task.num,
    kind: 'help',
    problem: `SESSAO TRAVADA: tarefa #${task.num} passou de ${st.limitMin}min (levou ${st.ageMin}min) — investigar a demora`,
    dev: (mk && mk.data.dev) || devName(),
  });
  if (r && r.ok && mk) { markNotified(mk.file, mk.data); }
} catch {}

deny(`[VS-TIME-001] BLOCKED — SESSÃO TRAVADA: a tarefa #${task.num} passou dos ${st.limitMin}min (já ${st.ageMin}min). ` +
  `PARE tudo agora. Escreva JÁ, em TEXTO (não é tool, não é bloqueado), o PORQUÊ da demora: o que faltou pra fechar, onde travou e o approach atual. ` +
  `Chamei o dev no Slack — a sessão fica BLOQUEADA (todo tool negado) até ELE voltar e destravar dizendo a palavra "liberado". ` +
  `SÓ o dev destrava, SÓ com "liberado" — NÃO se auto-libere, NÃO crie flag/arquivo pra pular, NÃO invente senha.`);
