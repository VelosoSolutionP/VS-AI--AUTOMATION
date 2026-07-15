#!/usr/bin/env node
/**
 * Hook PreToolUse (git commit) — QA-GATE OBRIGATÓRIO.
 * Regra absoluta: commit que toca UI só passa com o gate browser VERDE.
 * Se o gate não rodar (app fora do ar / não validável), BLOQUEIA — sem gate, sem commit.
 *
 * Backend puro (sem UI staged) -> libera (gate browser não se aplica).
 * Requer qa-gate.config.json no repo. Sem config -> avisa, não bloqueia (nada a validar).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runGate } from '../engine/core.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; } catch { cmd = raw; }

const allow = (msg) => {
  if (msg) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: msg } })); }
  process.exit(0);
};
const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
};

// só age em git commit (não amend de mensagem sem código? valida assim mesmo)
if (!/\bgit\b[\s\S]*\bcommit\b/.test(cmd)) { allow(); }

const repo = process.cwd();
const cfg = join(repo, 'qa-gate.config.json');
if (!existsSync(cfg)) { allow('[VS-AUD-000] sem qa-gate.config.json — gate browser não configurado neste repo.'); }

let r;
try { r = await runGate(repo, cfg); }
catch (e) { deny(`[VS-AUD-003] BLOCKED — QA-Gate não rodou (${e.message}). Regra absoluta: sem gate verde, sem commit. Suba o app em modo dev/live e re-tente.`); }

if (r.status === 'skip') {
  allow(`[VS-AUD-002] backend puro — gate browser não se aplica (${r.reason || ''}). INFORME AO USUÁRIO: gate pulou porque nenhum arquivo de UI foi staged (só backend); validado por sintaxe/pint. Não é bug puro deixado passar.`);
}
if (r.status === 'green') {
  const flows = (r.results || []).map((x) => x.name).join(', ') || 'fluxo(s) do config';
  allow(
    `[VS-AUD-002] QA-Gate VERDE. INFORME O USUÁRIO ANTES DE COMMITAR (obrigatório, não commite calado): ` +
    `rodei em browser real os fluxos [${flows}]. Em cada um: injetei submit inválido/vazio e exigi MENSAGEM AMIGÁVEL visível no DOM, ` +
    `console SEVERE = 0 e ZERO request falho; o happy-path salvou com feedback de sucesso. ` +
    `Está VERDE porque todos passaram nesses checks. Diga isso ao Fabiano (o que rodou + por que verde) e só então commite.`
  );
}
if (r.status === 'error') {
  deny(`[VS-AUD-003] BLOCKED — QA-Gate não conseguiu validar: ${r.reason}. Regra absoluta: sem gate rodando verde, sem commit. Suba o app (modo dev/live) e re-tente.`);
}
// red
const falhas = (r.results || []).filter((x) => x.status === 'red').map((x) => `${x.name}: ${x.errors?.join('; ')}`).join(' | ');
deny(`[VS-AUD-003] BLOCKED — QA-Gate VERMELHO: ${falhas || 'fluxo reprovou'}. Arruma e re-simula. Screenshots em C:/Veloso/ProjetosMsb/QA.`);
