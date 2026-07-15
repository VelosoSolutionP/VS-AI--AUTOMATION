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
// BLOQUEADO por FALTA (lib/flow/app/seletor) — a IA RESOLVE, não muda regra de negócio.
if (r.status === 'blocked' || r.status === 'error') {
  const acoes = (r.needs || []).map((n) => {
    if (n.kind === 'playwright') { return '• LIB FALTANDO: playwright não instalado. VOCÊ resolve: `npm i -D playwright` e depois `npx playwright install chromium`. Re-tente o commit.'; }
    if (n.kind === 'flow') {
      const files = (n.uiFiles || []).slice(0, 8).join(', ');
      return `• FLOW FALTANDO: você tocou UI (${files}) e NENHUM flow no qa-gate.config.json cobre. VOCÊ resolve: adicione um flow apontando a rota afetada — mode "form" (cadastro/edição: injeta bug + exige msg amigável) ou mode "read" (lista/visualização: expectSelector+expectMinCount). NÃO é mudar regra de negócio, é dar cobertura à ferramenta.`;
    }
    if (n.kind === 'app-up') {
      const passos = [];
      if (n.dockerUp) { passos.push(`suba o ambiente: \`${n.dockerUp}\``); }
      else if (n.start) { passos.push('tem `start` no config — veja por que não subiu'); }
      else { passos.push('suba o app (dev/live)'); }
      if (n.seed) { passos.push(`se faltar dados: \`${n.seed}\` (seed idempotente de QA — NUNCA migrate:fresh que apaga dados)`); }
      return `• APP FORA DO AR: ${n.target} não responde em ${n.baseUrl}. VOCÊ resolve: ${passos.join('; ')}. Espere subir e re-tente.`;
    }
    if (n.kind === 'sim-error') { return `• GATE QUEBROU em ${n.target}: ${n.detail}. VOCÊ resolve: ajuste o seletor/rota/login no config e re-tente.`; }
    return `• ${n.kind}: ${n.detail || ''}`;
  }).join('\n');
  deny(
    `[VS-AUD-003] BLOCKED — QA-Gate NÃO validou (faltou algo pra rodar). Regra absoluta: sem gate verde, sem commit.\n` +
    `RESOLVA TUDO até o gate rodar (Docker parado → sobe; falta dados → seed; falta lib → instala; falta flow → adiciona) e SÓ ENTÃO commite. É responsabilidade da IA deixar o gate rodar, não pular:\n${acoes}\n` +
    `Resolva um por um, re-testando o commit a cada passo — o gate roda de novo até ficar verde.`
  );
}
// red
const falhas = (r.results || []).filter((x) => x.status === 'red').map((x) => `${x.name}: ${x.errors?.join('; ')}`).join(' | ');
deny(`[VS-AUD-003] BLOCKED — QA-Gate VERMELHO: ${falhas || 'fluxo reprovou'}. Arruma e re-simula. Screenshots em C:/Veloso/ProjetosMsb/QA.`);
