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
catch (e) { deny(`[VS-AUD-003] BLOCKED — QA-Gate não rodou (${e.message}). Regra ABSOLUTA da governança: o commit fica BLOQUEADO até o gate VERDE. VOCÊ (a IA) é responsável por RESOLVER o que impede o gate de rodar — suba o app em modo dev/live, semeie dados, rebuilde — e re-tente. NÃO commite e NÃO espere uma pessoa resolver.`); }

if (r.status === 'skip') {
  allow(`[VS-AUD-002] backend puro — gate browser não se aplica (${r.reason || ''}). INFORME AO USUÁRIO: gate pulou porque nenhum arquivo de UI foi staged (só backend); validado por sintaxe/pint. Não é bug puro deixado passar.\n` +
    `[VS-AUD-004] CAMADA EXTRA (regra absoluta): se você tocou código de produção, é OBRIGATÓRIO um teste unitário VÁLIDO correspondente à mudança (backend: PHPUnit/Pest) — cobre o que mudou, não placeholder. Sem teste, sem commit. Se não existe, VOCÊ (a IA) escreve ANTES de commitar, mesmo que não tenha sido pedido no escopo.`);
}
if (r.status === 'green') {
  const flows = (r.results || []).map((x) => x.name).join(', ') || 'fluxo(s) do config';
  allow(
    `[VS-AUD-002] QA-Gate VERDE. INFORME O USUÁRIO ANTES DE COMMITAR (obrigatório, não commite calado): ` +
    `rodei em browser real os fluxos [${flows}]. Em cada um: injetei submit inválido/vazio e exigi MENSAGEM AMIGÁVEL visível no DOM, ` +
    `console SEVERE = 0 e ZERO request falho; o happy-path salvou com feedback de sucesso. ` +
    `Está VERDE porque todos passaram nesses checks. Informe o time/solicitante (o que rodou + por que verde). ` +
    `[VS-AUD-004] CAMADA EXTRA (regra absoluta): antes de commitar, confirme que existe um teste unitário VÁLIDO correspondente ao código tocado (front: vitest/jest; mobile: flutter test; backend: PHPUnit/Pest) — cobre a mudança, não placeholder. Sem teste, sem commit: se faltar, VOCÊ (a IA) escreve, mesmo que não tenha sido pedido no escopo. Só então commite.`
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
      else if (n.start) { passos.push('rode o `start` do config'); }
      else { passos.push('suba o app (docker/dev)'); }
      if (n.rebuild) { passos.push(`rebuilde o front com as edições da branch: \`${n.rebuild}\` (o build no ar pode ser antigo/prod)`); }
      else { passos.push('se o front no ar for build antigo, rebuilde com as edições da branch (npm run build / restart do container)'); }
      if (n.seed) { passos.push(`se faltar dados: \`${n.seed}\` (seed idempotente de QA — NUNCA migrate:fresh)`); }
      return `• APP FORA DO AR / DESATUALIZADO: ${n.target} em ${n.baseUrl}. VOCÊ resolve (NÃO peça pra uma pessoa subir e NÃO commite enquanto isso): ${passos.join('; ')}. Espere subir e RE-TENTE o commit.`;
    }
    if (n.kind === 'sim-error') { return `• GATE QUEBROU em ${n.target}: ${n.detail}. VOCÊ resolve: ajuste o seletor/rota/login no config e re-tente.`; }
    if (n.kind === 'flutter') { return `• FLUTTER FALTANDO: ${n.detail}. VOCÊ resolve: garanta o Flutter SDK no PATH (flutter --version) e re-tente.`; }
    if (n.kind === 'flutter-test-missing') { return `• TESTE MOBILE FALTANDO: ${n.detail}. VOCÊ resolve: escreva o teste que reproduz a correção (contract = joga a resposta REAL da API no fromJson do model; widget = pumpa a tela e exige msg amigável/lista) e re-tente. Sem teste cobrindo, não commita o mobile.`; }
    return `• ${n.kind}: ${n.detail || ''} — VOCÊ diagnostica e resolve, depois re-roda.`;
  }).join('\n');
  deny(
    `[VS-AUD-003] BLOCKED — QA-Gate NÃO validou (faltou algo pra rodar). REGRA ABSOLUTA da governança: sem gate VERDE, sem commit. NÃO existe commit "liberado" enquanto alguém resolve o problema — o commit fica BLOQUEADO até o gate ficar verde.\n` +
    `⛔ PROIBIDO pedir pra outra pessoa subir/rebuildar/semear e "esperar" enquanto commita. A ferramenta é AUTÔNOMA: VOCÊ (a IA) é DELEGADA a resolver o que for preciso e rodar o gate.\n` +
    `🔧 RESOLVE-ALL (se vira): a cada passo, se der ERRO (docker não sobe, porta ocupada, nome de container errado, migration pendente, seed falha, build quebra, lib, seletor, o que for) — LEIA a saída do erro, diagnostique a causa raiz e CORRIJA. Você sabe resolver qualquer erro. Loop: resolve → re-roda o gate → resolve o próximo → até VERDE.\n` +
    `Passos pra este bloqueio:\n${acoes}\n` +
    `Execute um por um, tratando o erro de cada um, re-testando o commit a cada passo até ficar verde. ` +
    `IMPEDIMENTO (só quando o bloqueio depende de PESSOAS ou de uma REGRA DE NEGÓCIO que você não resolve sozinho, DEPOIS de esgotar TUDO com os erros reais em mãos): mesmo assim NÃO commite — sem gate verde, sem commit. Registre um IMPEDIMENTO na documentação de fechamento da tarefa endereçado ao TECH LEAD ou GESTOR (o que rodou + o erro exato) pra que resolvam. Nunca escale antes de tentar, e nunca commite no impedimento.`
  );
}
// red
const falhas = (r.results || []).filter((x) => x.status === 'red').map((x) => `${x.name}: ${x.errors?.join('; ')}`).join(' | ');
deny(`[VS-AUD-003] BLOCKED — QA-Gate VERMELHO: ${falhas || 'fluxo reprovou'}. Arruma e re-simula. Screenshots em C:/Veloso/ProjetosMsb/QA.`);
