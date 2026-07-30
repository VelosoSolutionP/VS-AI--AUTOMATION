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
import { execSync } from 'node:child_process';
import { runGate } from '../engine/core.mjs';
import { notify, projectLabel } from '../engine/notify-whatsapp.mjs';
import { reportBlock, clearBlock, readMarkers } from '../engine/help-state.mjs';
import { recordTask } from '../engine/metrics.mjs';
import { resolveGitCwd } from '../engine/git-cwd.mjs';
import { isGitCommit } from '../engine/git-cmd.mjs';
import { isMergeContext } from '../engine/git-merge.mjs';

// Nome do projeto no recibo/audit: pai/base (desambigua backend/mobile) ou
// config.projectName. Ex.: Egle/backend, Velvet/mobile, Morar Melhor/portal...
const projectName = projectLabel;
function taskFromBranch(repo) {
  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    const m = b.match(/(\d{3,})/);
    return m ? m[1] : null;
  } catch { return null; }
}
// Comprovante WhatsApp + marcador de bloqueio. Nunca lança; awaited antes de
// allow/deny pra o envio completar (o hook sai com process.exit).
async function gateSignal(repo, status, detail) {
  try {
    const project = projectName(repo);
    const task = taskFromBranch(repo);
    if (status === 'green') {
      clearBlock(project);
      await notify({ project, task, kind: 'green', problem: detail || 'gate verde' }, repo);
    } else {
      reportBlock({ project, task, problem: detail || 'gate bloqueado/vermelho', tsMs: Date.now() });
      await notify({ project, task, kind: status === 'impediment' ? 'impediment' : 'red', problem: detail || 'gate bloqueado' }, repo);
    }
  } catch {}
}

// AUDITORIA POR COMMIT: cada commit liberado = 1 tarefa entregue. O numero da
// tarefa vem da MENSAGEM do commit (fix(NNNNN): ...) — assim o modo pacotao
// (N tarefas numa branch, N commits) conta N, nao 1 no push. Tempo do marcador
// se a tarefa foi aberta formalmente; senao 0.
function taskFromMsg(c) { const m = (c || '').match(/\((\d{3,})\)/); return m ? m[1] : null; }
function logDelivered(repo, c) {
  try {
    const project = projectName(repo);
    const task = taskFromMsg(c) || taskFromBranch(repo);
    // Tempo desta tarefa = agora − último commit (no ato de commitar a tarefa N,
    // o HEAD ainda é a tarefa N-1). Funciona no pacotão (sem marcador por tarefa).
    // 1º commit do lote: mede desde a base da branch. Fallback: marcador da tarefa.
    let durationMin = 0;
    try {
      const ct = parseInt(execSync('git log -1 --format=%ct', { cwd: repo, encoding: 'utf8' }).trim(), 10);
      if (ct > 0) { durationMin = Math.max(0, Math.round((Date.now() / 1000 - ct) / 60)); }
    } catch {}
    if (!durationMin) {
      try {
        const mk = readMarkers().find((m) => m.data && m.data.project === project);
        if (mk?.data?.ts) { durationMin = Math.max(0, Math.round((Date.now() - mk.data.ts) / 60000)); }
      } catch {}
    }
    recordTask({ type: 'task_delivered', project, task, durationMin, commitInStandard: true });
  } catch {}
}

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
let sessionCwd = process.cwd();
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; sessionCwd = j.cwd || j.tool_input?.cwd || process.cwd(); } catch { cmd = raw; }

const allow = (msg) => {
  if (msg) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: msg } })); }
  process.exit(0);
};
const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
};

// só age em git commit REAL (não palavra "commit" solta em echo/log/string)
if (!isGitCommit(cmd)) { allow(); }

// repo REAL do commit (não a pasta da sessão) — fecha o leak de projeto no gate/recibo.
const repo = resolveGitCwd(cmd, sessionCwd);

// MERGE (integração/promoção dev→hml/main) — gate NÃO se aplica (é junção via MR, revisada
// pelo tech lead). Não confundir com liberar push direto em protegida: isso segue barrado.
if (isMergeContext(cmd, repo)) { allow('[VS-AUD-006] merge/promoção de ambiente — QA-Gate não se aplica (integração via MR).'); }

// ── VS-AUD-004 (regra ABSOLUTA): tocou código de produção → EXIGE teste no
// mesmo commit. Sem teste, sem commit. Bloqueio determinístico (não é aviso).
// Escape raro p/ mudança sem superfície de teste: touch .qa-gate-notest-ok
{
  let staged = [];
  try {
    staged = execSync('git diff --cached --name-only', { cwd: repo, encoding: 'utf8' })
      .trim().split(/\r?\n/).filter(Boolean);
  } catch {}
  const isTest = (f) =>
    /(^|\/)(tests?|__tests__|spec|test)\//i.test(f) ||
    /\.(spec|test)\.[cm]?[jt]sx?$/i.test(f) ||
    /_test\.dart$/i.test(f) ||
    /(Test|Spec)\.(php|java|kt)$/i.test(f) ||
    /_spec\.rb$/i.test(f) ||
    /_test\.(py|go)$/i.test(f);
  const isProdCode = (f) =>
    /\.(php|ts|tsx|js|jsx|vue|dart|java|kt|py|go|cs|rb|swift)$/i.test(f) &&
    !/\.blade\.php$/i.test(f) && // view Laravel = gate de browser, não unit test
    !isTest(f) &&
    !/(^|\/)migrations?\//i.test(f);
  const prod = staged.filter(isProdCode);
  const tests = staged.filter(isTest);
  if (prod.length > 0 && tests.length === 0 && !existsSync(join(repo, '.qa-gate-notest-ok'))) {
    await gateSignal(repo, 'red', 'commit sem teste — VS-AUD-004');
    deny(
      `[VS-AUD-004] BLOCKED — REGRA ABSOLUTA: você tocou código de produção ` +
      `(${prod.slice(0, 6).join(', ')}${prod.length > 6 ? '…' : ''}) e NÃO há teste no commit. ` +
      `Sem teste, sem commit. Escreva o teste unitário que cobre a mudança (backend PHPUnit/Pest; front vitest/jest; mobile flutter test) e faça \`git add\` dele — mesmo que não tenha sido pedido no escopo. ` +
      `Escape raro (mudança sem superfície de teste, ex.: config/constante): \`touch .qa-gate-notest-ok\`.`
    );
  }
}

const cfg = join(repo, 'qa-gate.config.json');
if (!existsSync(cfg)) {
  // Sem config de UI (repo backend/sem gate browser): ainda assim gera COMPROVANTE
  // no WhatsApp do commit (rastreabilidade), pra backend não ficar sem recibo.
  await gateSignal(repo, 'green', 'commit backend — gate de UI nao configurado; validado por sintaxe/testes');
  logDelivered(repo, cmd);
  allow('[VS-AUD-000] sem qa-gate.config.json — gate browser não configurado neste repo. Comprovante de commit enviado.');
}

let r;
try { r = await runGate(repo, cfg); }
catch (e) { await gateSignal(repo, 'impediment', `gate nao rodou: ${e.message}`); deny(`[VS-AUD-003] BLOCKED — QA-Gate não rodou (${e.message}). Regra ABSOLUTA da governança: o commit fica BLOQUEADO até o gate VERDE. VOCÊ (a IA) é responsável por RESOLVER o que impede o gate de rodar — suba o app em modo dev/live, semeie dados, rebuilde — e re-tente. NÃO commite e NÃO espere uma pessoa resolver.`); }

if (r.status === 'skip') {
  await gateSignal(repo, 'green', `backend puro validado (${r.reason || 'sintaxe/pint + testes tocados'})`);
  logDelivered(repo, cmd);
  allow(`[VS-AUD-002] backend puro — gate browser não se aplica (${r.reason || ''}). INFORME AO USUÁRIO: gate pulou porque nenhum arquivo de UI foi staged (só backend); validado por sintaxe/pint. Não é bug puro deixado passar.\n` +
    `[VS-AUD-004] CAMADA EXTRA (regra absoluta): se você tocou código de produção, é OBRIGATÓRIO um teste unitário VÁLIDO correspondente à mudança (backend: PHPUnit/Pest) — cobre o que mudou, não placeholder. Sem teste, sem commit. Se não existe, VOCÊ (a IA) escreve ANTES de commitar, mesmo que não tenha sido pedido no escopo.`);
}
if (r.status === 'green') {
  const flows = (r.results || []).map((x) => x.name).join(', ') || 'fluxo(s) do config';
  await gateSignal(repo, 'green');
  logDelivered(repo, cmd);
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
  await gateSignal(repo, 'impediment', `gate bloqueado: ${(r.needs || []).map((n) => n.kind).join(', ') || 'faltou algo pra rodar'}`);
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
await gateSignal(repo, 'red', falhas || 'fluxo reprovou');
deny(`[VS-AUD-003] BLOCKED — QA-Gate VERMELHO: ${falhas || 'fluxo reprovou'}. Arruma e re-simula. Screenshots em C:/Veloso/ProjetosMsb/QA.`);
