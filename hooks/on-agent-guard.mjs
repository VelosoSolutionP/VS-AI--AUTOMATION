#!/usr/bin/env node
/**
 * Hook PreToolUse (Task) — AGENT GUARD (anti-desperdício).
 *
 * Barra o disparo de SUBAGENTE pra investigar/corrigir quando o alvo já foi
 * especificado. A ferramenta existe pra REDUZIR gasto de token — abrir vários agentes
 * em paralelo pra "investigar" um bug já localizado é o oposto: queima token à toa.
 *
 * Regra (VS-AGENT-001, absoluta por default):
 *  - alvo especificado -> a IA pesquisa DIRETO (Serena/grep/read/glob) e corrige. NUNCA agente.
 *  - alvo NÃO claro     -> a IA PERGUNTA ao Fabiano. Nunca chuta com agente.
 *  - exceção (feature extensa REAL, >3 arquivos + investigação profunda): touch .qa-gate-agents-ok
 *    (ou config da empresa "allowAgents": true).
 *
 * Contrato PreToolUse: stdin { tool_input, session_id, cwd }; nega com permissionDecision "deny".
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isSessionOff } from '../engine/branch-req.mjs';
import { loadCompanyConfig } from '../engine/company-config.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let sid = 'default';
let cwd = process.cwd();
let subagentType = '';
let toolName = '';
try {
  const j = JSON.parse(raw || '{}');
  sid = j.session_id || 'default';
  cwd = j.cwd || j.tool_input?.cwd || process.cwd();
  subagentType = j.tool_input?.subagent_type || '';
  toolName = j.tool_name || j.toolName || '';
} catch {}

const allow = () => process.exit(0);
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

// Só age no tool de SUBAGENTE (nome varia por versão do CLI: Task | Agent). Qualquer
// outro tool passa direto. Se o nome não veio, o matcher do settings já filtrou.
if (toolName && !/^(task|agent|subagent|dispatch_agent)$/i.test(toolName)) { allow(); }

// opt-outs (bancada / sessão)
if (existsSync(join(cwd, '.qa-gate-off'))) { allow(); }
if (isSessionOff(sid)) { allow(); }

// escape explícito por pasta OU config da empresa liberando agentes
if (existsSync(join(cwd, '.qa-gate-agents-ok'))) { allow(); }
const cfg = loadCompanyConfig(cwd);
if (cfg.allowAgents === true) { allow(); }

deny(
  `[VS-AGENT-001] BLOCKED — não abra SUBAGENTE pra investigar/corrigir (agent_type="${subagentType || 'geral'}"). ` +
  `A ferramenta é pra REDUZIR token — vários agentes pra investigar um alvo já dado é desperdício inaceitável.\n` +
  `• Se o ALVO está especificado (arquivo/tela/fluxo/causa): pesquise DIRETO — grep (padrão preciso, files_with_matches antes de conteúdo), read com offset/limit (fatia, não arquivo inteiro), glob — e corrija você mesmo.\n` +
  `• Se o ALVO NÃO está claro: PERGUNTE ao Fabiano o que falta. NÃO chute com agente.\n` +
  `Exceção (feature extensa REAL, >3 arquivos + investigação profunda): touch .qa-gate-agents-ok (ou "allowAgents": true no qa-gate.company.json).`
);
