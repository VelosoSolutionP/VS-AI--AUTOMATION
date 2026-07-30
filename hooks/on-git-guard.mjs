#!/usr/bin/env node
/**
 * Hook PreToolUse (Bash) — GIT GUARD. Obriga o fluxo do Fabiano de forma determinística.
 * O agente NÃO consegue ignorar (hook bloqueia de fato). Escopo: projeto que o registrar.
 *
 * Bloqueia:
 *  - git add . / -A / --all           (VS-GIT-001)  -> add cego proibido
 *  - commit/push em branch protegida  (VS-GIT-002)  -> main/master/dev/hml/prod
 *  - commit sem --no-verify burlando   (deixa hooks rodarem)
 *  - commit de código de produção SEM teste unitário  (VS-AUD-004) -> escape: .qa-gate-notest-ok
 * Avisa (não bloqueia):
 *  - branch fora do padrão tipo/fabiano.veloso/<n>  (VS-GIT-003)
 *  - criar nova branch com trabalho da anterior fora do origin (VS-BRANCH-004) — back/front; mobile isento
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { loadReq, isConsult, isSessionOff, getTask, setTask } from '../engine/branch-req.mjs';
import { loadCompanyConfig, branchName as buildBranchName, branchRegex, branchGlobsForNumber, patternUsesNumero } from '../engine/company-config.mjs';
import { timeBoxStatus } from '../engine/timebox.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
let sid = 'default';
let sessionCwd = process.cwd();
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; sid = j.session_id || 'default'; sessionCwd = j.cwd || j.tool_input?.cwd || process.cwd(); } catch { cmd = raw; }

const allow = () => process.exit(0);
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}

// FIX cwd (fecha o furo do "cd fura"): o `cd X && git ...` — ou `git -C X` — do comando
// enganava o hook, que checava a pasta da SESSÃO (ex.: sigater) em vez do repo real
// (ex.: egle/frontend), fazendo VS-GATE-001/VS-AUD-004 não verem os arquivos staged e
// LIBERAREM o commit. Aqui extraímos o diretório REAL onde o git roda e usamos ele em
// TODAS as checagens (execSync com cwd + flags de pasta).
function resolveGitCwd(command, base) {
  try {
    const mC = command.match(/\bgit\s+-C\s+("([^"]+)"|'([^']+)'|([^\s&;|]+))/);
    if (mC) { const d = mC[2] || mC[3] || mC[4]; return isAbsolute(d) ? d : resolve(base, d); }
    const cds = [...command.matchAll(/\bcd\s+("([^"]+)"|'([^']+)'|([^\s&;|]+))/g)];
    if (cds.length) { const c = cds[cds.length - 1]; const d = c[2] || c[3] || c[4]; return isAbsolute(d) ? d : resolve(base, d); }
  } catch {}
  return base;
}
const gitCwd = resolveGitCwd(cmd, sessionCwd);
// CONFIG DA EMPRESA (autor/branch/commit) — default = padrão Fabiano se não houver arquivo.
const cfg = loadCompanyConfig(gitCwd);

// opt-out por pasta (bancada de conserto): .qa-gate-off desliga — no repo real OU na sessão
if (existsSync(join(gitCwd, '.qa-gate-off')) || existsSync(join(sessionCwd, '.qa-gate-off'))) { allow(); }
if (isSessionOff(sid)) { allow(); }
const isGit = /\bgit\b/.test(cmd);
if (!isGit) { allow(); }

// REGRA MOBILE: branch da tarefa SAI DA ATUAL (acumula o trabalho anterior), commits
// LOCAIS, SEM push (deploy/APK só no fim do dia).
const isMobile = /[\\/]mobile([\\/]|$)/i.test(gitCwd);

// add cego
if (/\bgit\s+add\s+(\.|-A\b|--all\b|:\/)/.test(cmd)) {
  deny('[VS-GIT-001] BLOCKED — `git add .` proibido. Adicione só os arquivos da tarefa explicitamente (ex.: git add app/Foo.php resources/views/foo.blade.php).');
}

// REGRA ABSOLUTA (Fabiano 23/07/2026): depois de criada, a branch NÃO pode
// ser renomeada — renomear quebra o fluxo (rastreio da tarefa, MR aberto).
const renomeiaBranch = /\bgit\s+branch\s+(-m|-M|--move)\b/.test(cmd) || /\bgit\s+branch\s+.*\s(-m|-M|--move)\b/.test(cmd);
// Exceção: só o ADMIN pode renomear, informando a senha (anexar 9601 ao comando).
const admOverride = /\b9601\b/.test(cmd);
if (renomeiaBranch && !admOverride) {
  deny('[VS-BRANCH-007] BLOCKED — proibido renomear branch (git branch -m/-M/--move). Uma vez criada, a branch da tarefa é imutável — renomear quebra o fluxo. Só o admin renomeia, informando a senha (anexe 9601 ao comando). Ou crie nova branch no padrão.');
}

// criação de branch: exige base de ORIGEM explícita (origin/<x>)
const criaBranch = /\bgit\s+checkout\s+-b\b/.test(cmd) || /\bgit\s+switch\s+-c\b/.test(cmd) || /\bgit\s+branch\s+\S/.test(cmd);
// MOBILE acumula: a branch da tarefa DEVE sair da branch ATUAL (carrega o trabalho
// anterior). Usar origin/<x> RESETA e perde o acúmulo -> bloqueia.
if (criaBranch && isMobile && /\borigin\/\w/.test(cmd)) {
  deny('[VS-MOBILE-002] BLOCKED — mobile ACUMULA: crie a branch a partir da ATUAL (git checkout -b <tipo>/fabiano.veloso/<numero>), SEM origin/<x>. Sair do origin reseta e perde o trabalho acumulado.');
}
// não iniciar nova branch deixando o trabalho da anterior FORA do ambiente (origin).
// só back/front; base protegida (main/dev/hml) é isenta (não é tarefa pendente).
if (criaBranch && !isMobile) {
  try {
    const cur = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: gitCwd }).trim();
    const PROT = /^(main|master|dev|develop|hml|homolog\w*|production|prod|staging)$/i;
    if (!PROT.test(cur)) {
      const unpushed = parseInt((execSync('git rev-list --count HEAD --not --remotes', { encoding: 'utf8', cwd: gitCwd }).trim() || '0'), 10);
      const dirty = execSync('git status --porcelain', { encoding: 'utf8', cwd: gitCwd }).split(/\r?\n/).filter(Boolean).length;
      if (unpushed > 0 || dirty > 0) {
        deny(`[VS-BRANCH-004] BLOCKED — a branch atual "${cur}" tem trabalho fora do ambiente (${unpushed} commit(s) não enviado(s), ${dirty} arquivo(s) não commitado(s)). Antes de criar nova branch: commite os arquivos da tarefa + git push -u origin ${cur}. (mobile é isento; back/front obrigatório)`);
      }
    }
  } catch {}
}
if (criaBranch) {
  // estado de branch pendente (número/tipo/origem incompletos) -> não deixa criar
  let pend = null; try { pend = loadReq(sid); } catch {}
  if (pend) {
    const falta = ['num', 'tipo', 'origem'].filter((k) => !pend[k]).join('/');
    deny(`[VS-BRANCH-003] BLOCKED — dados da branch incompletos (falta ${falta}). Informe no chat antes de criar. (desistir: "cancela")`);
  }
  // front/back: exige origin/ (base correta). MOBILE é ISENTO — sai da branch atual (acumula).
  if (!isMobile && !/\borigin\/\w/.test(cmd)) {
    deny('[VS-BRANCH-002] BLOCKED — crie a branch a partir da ORIGEM explícita. Ex.: git fetch origin <origem> && git checkout -b <tipo>/<autor>/<numero> origin/<origem>. Sem origin/<x> a branch nasce do lugar errado e quebra no merge. (mobile é isento — acumula da branch atual)');
  }
  // NOME da branch tem que carregar o NÚMERO da tarefa (senão o número some no push).
  // Só exige número quando o pattern da empresa usa <numero>.
  const bm = cmd.match(/\b(?:checkout\s+-b|switch\s+-c|branch)\s+(\S+)/);
  const novoNome = bm ? bm[1] : '';
  if (patternUsesNumero(cfg) && novoNome && !/\d{3,6}/.test(novoNome)) {
    deny(`[VS-BRANCH-005] BLOCKED — a branch "${novoNome}" não tem o NÚMERO da tarefa. Padrão: ${cfg.branchPattern}. Sem número, o push não rastreia a tarefa. Recrie com o número.`);
  }
  // BUG VOLTOU: se já existe branch (local OU remota) com esse número, NÃO cria nova —
  // acessa a existente. Sinaliza que a correção anterior não segurou.
  const numB = (novoNome.match(/(\d{3,6})/) || [])[1];
  if (numB) {
    const globs = branchGlobsForNumber(cfg, numB);
    const listArgs = globs.map((g) => `--list "${g}"`).join(' ');
    const remoteArgs = globs.map((g) => `"${g}"`).join(' ');
    let existente = '';
    try { existente = execSync(`git branch -a ${listArgs}`, { encoding: 'utf8', cwd: gitCwd }).trim(); } catch {}
    if (!existente) { try { existente = execSync(`git ls-remote --heads origin ${remoteArgs}`, { encoding: 'utf8', cwd: gitCwd }).trim(); } catch {} }
    if (existente) {
      const bName = existente.split(/\r?\n/)[0].replace(/^[*\s]+/, '').replace(/^remotes\//, '').replace(/^[0-9a-f]+\s+refs\/heads\//, '');
      deny(`[VS-BRANCH-007] BUG #${numB} VOLTOU — já existe a branch "${bName}". NÃO crie nova. Acesse a existente: git fetch origin && git checkout ${bName.replace(/^origin\//, '')} — e trabalhe NELA (a correção anterior não segurou; investigue o que regrediu).`);
    }
  }
}

const isCommit = /\bcommit\b/.test(cmd);
const isPush = /\bpush\b/.test(cmd);
if (!isCommit && !isPush) { allow(); }

// modo CONSULTA/DOC -> sem commit/push (não abriu tarefa)
if (isConsult(sid)) {
  deny('[VS-CONSULT-001] BLOCKED — sessão em modo CONSULTA/DOC: não commita nem faz push. Pra habilitar, inicie uma tarefa: informe número + tipo + origem (cria a branch).');
}

// mobile não faz push — acumula local; deploy (APK) só no fim do dia, a pedido do Fabiano
if (isPush && isMobile && !existsSync(join(gitCwd, '.qa-gate-mobile-ok'))) {
  deny('[VS-MOBILE-001] BLOCKED — mobile NÃO faz push. Acumula commits locais; deploy só no fim do dia, quando o Fabiano pedir. Pra liberar agora: touch .qa-gate-mobile-ok');
}

// --no-verify burla os hooks
if (/--no-verify|-n\b/.test(cmd)) {
  deny('[VS-GIT-002] BLOCKED — `--no-verify` proibido: burla o QA-Gate/governança. Rode a validação.');
}

// [VS-AUD-004] camada extra: tocou código de produção -> exige teste unitário no MESMO commit.
// Determinístico: compara arquivos staged (código × teste). Escape justificado: .qa-gate-notest-ok
if (isCommit && !existsSync(join(gitCwd, '.qa-gate-notest-ok'))) {
  try {
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf8', cwd: gitCwd }).split(/\r?\n/).filter(Boolean);
    const isTest = (f) => /(^|\/)tests?\//i.test(f) || /__tests__\//.test(f) || /(_test\.dart|_test\.py|\.test\.[jt]sx?|\.spec\.[jt]sx?|Test\.php)$/i.test(f);
    const isGen = (f) => /(\.g\.dart|\.freezed\.dart|\.gr\.dart|\.g\.ts)$/i.test(f);
    const isExempt = (f) => /(^|\/)database\/(migrations|seeders|factories)\//i.test(f) || /\.(config|conf)\.[jt]s$/i.test(f);
    const isProd = (f) => /\.(php|dart|ts|tsx|js|jsx|vue)$/i.test(f) && !isTest(f) && !isGen(f) && !isExempt(f);
    const prod = staged.filter(isProd);
    const tests = staged.filter(isTest);
    if (prod.length > 0 && tests.length === 0) {
      const amostra = prod.slice(0, 3).join(', ') + (prod.length > 3 ? ` (+${prod.length - 3})` : '');
      deny(`[VS-AUD-004] BLOCKED — código de produção no commit SEM teste unitário correspondente (${amostra}). Regra absoluta: sem teste, sem commit. Você (IA) é responsável por CRIAR o teste unitário válido que cobre a mudança — mesmo que não tenha sido pedido no alvo — e incluí-lo no commit (back: PHPUnit/Pest · front: vitest/jest · mobile: flutter test). Exceção rara e justificada: touch .qa-gate-notest-ok`);
    }
  } catch {}
}

let branch = '';
try { branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: gitCwd }).trim(); } catch { allow(); }

// [VS-GATE-001] REGRA ABSOLUTA — tocou código de produção no commit -> exige RECIBO
// do QA-Gate VERDE nesta branch, gravado DEPOIS da última edição staged. É a prova
// determinística de que o gate rodou verde; a IA NÃO consegue pular nem "opinar" que
// não precisa. Front/back: 100% dos verdes passaram no QA — então roda sempre.
// Mobile é ISENTO (gate browser inviável — tratado à parte). Escape raro: .qa-gate-green-ok
if (isCommit && !isMobile && !existsSync(join(gitCwd, '.qa-gate-green-ok'))) {
  try {
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf8', cwd: gitCwd }).split(/\r?\n/).filter(Boolean);
    const isTest = (f) => /(^|\/)tests?\//i.test(f) || /__tests__\//.test(f) || /(_test\.dart|_test\.py|\.test\.[jt]sx?|\.spec\.[jt]sx?|Test\.php)$/i.test(f);
    const isGen = (f) => /(\.g\.dart|\.freezed\.dart|\.gr\.dart|\.g\.ts)$/i.test(f);
    const isExempt = (f) => /(^|\/)database\/(migrations|seeders|factories)\//i.test(f) || /\.(config|conf)\.[jt]s$/i.test(f);
    const isProd = (f) => /\.(php|dart|ts|tsx|js|jsx|vue)$/i.test(f) && !isTest(f) && !isGen(f) && !isExempt(f);
    const prod = staged.filter(isProd);
    if (prod.length > 0) {
      const receiptPath = join(gitCwd, '.git', 'qa-gate-green.json');
      let ok = false; let why = 'o gate nunca rodou verde nesta branch';
      if (existsSync(receiptPath)) {
        try {
          const rc = JSON.parse(readFileSync(receiptPath, 'utf8'));
          const TTL = 30 * 60 * 1000;
          const age = Date.now() - (rc.ts || 0);
          let newest = 0;
          for (const f of staged) { try { const m = statSync(join(gitCwd, f)).mtimeMs; if (m > newest) { newest = m; } } catch {} }
          if (rc.status !== 'green') { why = 'último resultado não foi verde'; }
          else if (rc.branch && rc.branch !== branch) { why = `o recibo é de outra branch (${rc.branch})`; }
          else if (age > TTL) { why = 'o recibo verde expirou (>30min) — rode de novo'; }
          else if (newest > (rc.ts || 0)) { why = 'houve edição DEPOIS do gate verde — rode de novo'; }
          else { ok = true; }
        } catch { why = 'recibo ilegível'; }
      }
      if (!ok) {
        deny(`[VS-GATE-001] BLOCKED — commit de código de produção SEM QA-Gate VERDE (${why}). ` +
          `Regra ABSOLUTA da governança: front/back só commitam no verde (todo verde passou no QA — funciona). ` +
          `Rode o gate DE VERDADE neste repo (MCP qa_run_gate) até VERDE — ele grava o recibo — e só então commite. ` +
          `Se o app não sobe/faltam dados, VOCÊ resolve (sobe ambiente, seed, rebuild) — NÃO pule, NÃO opine que não precisa, NÃO espere uma pessoa. ` +
          `Exceção rara e justificada (ex.: só refactor sem runtime): touch .qa-gate-green-ok`);
      }
    }
  } catch {}
}

const PROTECTED = /^(main|master|dev|develop|hml|homolog\w*|production|prod|staging)$/i;
if (PROTECTED.test(branch)) {
  const exemplo = buildBranchName(cfg, { tipo: 'fix', numero: '<numero>' });
  deny(`[VS-GIT-002] BLOCKED — ${isPush ? 'push' : 'commit'} direto em "${branch}" proibido. Crie a branch da tarefa: git checkout -b ${exemplo} origin/${branch}`);
}

// MURO DE ESTADO: tarefa ativa (checklist completo) EXIGE que o commit/push seja na
// branch dela. Prova que a branch foi criada — se o agente foi direto pro código sem
// criar a branch, aqui BLOQUEIA. Vale pra qualquer alvo (inclui mobile: cria a branch,
// commita nela; só o push do mobile é barrado à parte).
let task = null; try { task = getTask(sid); } catch {}
if (task && task.num) {
  // Governança não usa o tipo `test` para branch — normaliza para `fix`
  // (decisão do Fabiano 23/07/2026). Aceita branch fix/ mesmo em tarefa
  // classificada como test, sem exigir rename.
  const tipoBranch = task.tipo === 'test' ? 'fix' : task.tipo;
  const expected = buildBranchName(cfg, { tipo: tipoBranch, numero: task.num });
  if (branch !== expected) {
    const repos = Array.isArray(task.repositorios) ? task.repositorios : (task.repositorios ? [task.repositorios] : []);
    const multi = repos.length > 1;
    const criarExpected = isMobile
      ? `git checkout -b ${expected}  (mobile: sai da branch atual, acumula — SEM origin/)`
      : `git fetch origin ${task.origem} && git checkout -b ${expected} origin/${task.origem}`;
    deny(`[VS-BRANCH-006] BLOCKED — a branch da TAREFA #${task.num} não está ativa (você está em "${branch}", esperado "${expected}"). ` +
      `Crie/entre nela ANTES de ${isPush ? 'pushar' : 'commitar'}: ${criarExpected}. ` +
      `${multi ? `REPOSITÓRIOS=${repos.join('+')}: crie essa MESMA branch em CADA repo escolhido (mobile acumula da atual). ` : ''}Não pule a criação da branch.`);
  }
}

// [VS-TIME-001] TIME-BOX 15min ABSOLUTO: tarefa ativa que passou do tempo pré-estabelecido
// BLOQUEIA commit/push. Chama o dev no Slack (1 vez) e exige a explicação AO VIVO do porquê
// da demora. Só o DEV ou ADMIN libera: o admin anexa a senha 9601 ao comando git (reinicia
// a janela). A IA NÃO se auto-libera nem cria flag/arquivo pra pular.
if (task && task.num && task.ts) {
  const st = timeBoxStatus(task, Date.now(), cfg);
  if (st.overdue) {
    if (/\b9601\b/.test(cmd)) {
      try { setTask(sid, { ...task, ts: Date.now() }); } catch {} // admin liberou -> reinicia a janela
    } else {
      // chama o dev (Slack/WhatsApp conforme config), 1 vez — dedupe pelo marcador de ajuda da tarefa
      try {
        const { readMarkers, markNotified } = await import('../engine/help-state.mjs');
        const { notify, devName, projectLabel } = await import('../engine/notify-whatsapp.mjs');
        const mk = readMarkers().find((m) => String(m.data.task) === String(task.num) && !m.data.notified);
        const r = await notify({
          project: projectLabel(gitCwd),
          task: task.num,
          kind: 'help',
          problem: `time-box estourado: tarefa #${task.num} passou de ${st.limitMin}min (levou ${st.ageMin}min) — apurar a demora`,
          dev: (mk && mk.data.dev) || devName(),
        });
        if (r && r.ok && mk) { markNotified(mk.file, mk.data); }
      } catch {}
      deny(`[VS-TIME-001] BLOCKED — a tarefa #${task.num} passou dos ${st.limitMin}min (já ${st.ageMin}min). ` +
        `PARE agora e deixe AO VIVO no chat (sem backlog) o PORQUÊ da demora: o que faltou pra fechar no prazo, onde travou e o approach atual. ` +
        `Chamei o dev no Slack. Só o DEV ou ADMIN libera este ${isPush ? 'push' : 'commit'} — o admin anexa a senha 9601 ao comando git (reinicia a janela). ` +
        `NÃO se auto-libere, NÃO crie flag/arquivo pra pular, NÃO anexe 9601 por conta própria.`);
    }
  }
}

// branch de tarefa (bate o autor da empresa) SEM número -> bloqueia commit/push (número some).
// Só vale quando o pattern usa <numero> e o autor está presente no nome da branch.
const autorEsc = String(cfg.autor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const temAutorNaBranch = cfg.autor && /<autor>/.test(cfg.branchPattern || '') ? new RegExp(autorEsc, 'i').test(branch) : false;
if (patternUsesNumero(cfg) && temAutorNaBranch && !/\d{3,6}/.test(branch) && !isMobile) {
  deny(`[VS-BRANCH-005] BLOCKED — a branch "${branch}" não tem o NÚMERO da tarefa; ${isPush ? 'push' : 'commit'} bloqueado. Recrie no padrão ${cfg.branchPattern}.`);
}

// branch fora do padrão -> só avisa (não bloqueia)
const PATTERN = branchRegex(cfg);
if (!PATTERN.test(branch)) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `[VS-GIT-003] aviso — branch "${branch}" fora do padrão ${cfg.branchPattern}.` } }));
  process.exit(0);
}
allow();
