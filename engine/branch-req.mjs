/**
 * Estado acumulado de criação de branch (multi-turn).
 * Turn 1 manda número, turn 2 origem, turn 3 tipo — só cria quando os 3 estiverem juntos.
 * Marcador em .git/qa-gate-branch-req.json (TTL 15min, nunca commitado).
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TIPOS = { fix: 'fix', bug: 'fix', feat: 'feat', feature: 'feat', refactor: 'refactor', refact: 'refactor', perf: 'perf', hotfix: 'hotfix', chore: 'chore', test: 'test', doc: 'docs', docs: 'docs' };
const TTL = 15 * 60 * 1000;
// TTL do CHECKLIST em aberto (VS-BRANCH-010). Era o mesmo 15min do consult/preflight, e
// isso derrubava tarefa viva: enquanto a IA coleta dados (grep, build, suíte de teste)
// passam-se minutos sem mensagem do dev, o pendente expirava e o muro recomeçava pedindo
// o número que o dev JÁ tinha mandado. Agora conta INATIVIDADE — loadReq renova o ts a
// cada leitura — com teto de janela de trabalho.
const TTL_REQ = 4 * 60 * 60 * 1000;

// Mapeia uma palavra p/ camada/repo canônica única: todos | front | back | mobile.
// (mantido p/ o campo `alvo`, que continua sendo valor único.)
function canonTarget(word) {
  if (!word) { return null; }
  const w = word.toLowerCase();
  if (/\b(todos|tudo|all|geral|cross|full ?stack|fullstack)\b/.test(w)) { return 'todos'; }
  if (/\b(mobile|app|flutter|dart|apk)\b/.test(w)) { return 'mobile'; }
  if (/\b(back|backend|api|laravel|controller|service|repository|migration|model|endpoint)\b/.test(w)) { return 'back'; }
  if (/\b(front|frontend|web|tela|ui|componente|component|next|react|blade|livewire|p[áa]gina|view)\b/.test(w)) { return 'front'; }
  return null;
}

// REPOSITÓRIOS = MULTI-escolha. Uma frase pode pedir vários repos ("front back",
// "front e back", "back mobile"). Retorna LISTA canônica ordenada [front, back, mobile]
// (dedup), ou ['front','back','mobile'] p/ "todos". null quando não reconhece nenhum.
function canonTargets(word) {
  if (!word) { return null; }
  const w = word.toLowerCase();
  if (/\b(todos|tudo|all|geral|cross|full ?stack|fullstack)\b/.test(w)) { return ['front', 'back', 'mobile']; }
  const set = new Set();
  if (/\b(front|frontend|web|tela|ui|componente|component|next|react|blade|livewire|p[áa]gina|view)\b/.test(w)) { set.add('front'); }
  if (/\b(back|backend|api|laravel|controller|service|repository|migration|model|endpoint)\b/.test(w)) { set.add('back'); }
  if (/\b(mobile|app|flutter|dart|apk)\b/.test(w)) { set.add('mobile'); }
  const order = ['front', 'back', 'mobile'];
  const out = order.filter((r) => set.has(r));
  return out.length ? out : null;
}

// Ruído numérico que NUNCA é número de tarefa. Sai ANTES de procurar o número, porque
// report de QA é feito disso: "Navegação 100% por clique real", "medido em 04/09/2026",
// "HU-05", "RN-102", "a área sai como 10.00 e 6.50", ULID do cadastro. Sem esta limpeza
// o primeiro número de 3-6 dígitos do texto virava o número da tarefa — foi assim que
// nasceu a branch fantasma fix/fabiano.veloso/100, com zero commits (VS-BRANCH-010).
export function limparRuidoNumerico(txt) {
  return String(txt || '')
    .replace(/https?:\/\/\S+/gi, ' ')                        // URLs
    .replace(/\b[\w.+-]+@[\w.-]+\b/g, ' ')                   // e-mails
    .replace(/\/\S+/g, ' ')                                  // /paths
    .replace(/:\d+/g, ' ')                                   // :porta e hh:mm
    .replace(/\b\d{1,4}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, ' ')  // datas
    .replace(/\b\d+\s*%/g, ' ')                              // percentuais ("100%")
    .replace(/\b\d+[.,]\d+\b/g, ' ')                         // decimais (10.00 / 6,50)
    .replace(/\b[a-z]{1,4}[-_]?\d{1,6}\b/gi, ' ')            // HU-05, RN-102, P04, v1, CT001
    .replace(/\b[0-9a-z]*\d[0-9a-z]*\b/gi, (m) => (/^\d+$/.test(m) ? m : ' ')) // ULID e afins
    .replace(/\b[0-9a-f]{7,}\b/gi, ' ');                     // hashes
}

/**
 * Número da tarefa no texto. Devolve { inicio, marcado }:
 *  - inicio  = a mensagem COMEÇA com o número ("39701 fix dev back").
 *  - marcado = veio explicitamente rotulado: "#39701", "tarefa 39701", "chamado 39701".
 * Antes bastava a palavra "tarefa" existir em QUALQUER lugar do texto + qualquer número:
 * o report de QA fechava a conta com o primeiro número que aparecesse. Agora o marcador
 * tem que estar COLADO no número.
 */
export function extrairNumeroTarefa(prompt) {
  const p = String(prompt || '');
  const inicio = (p.match(/^\s*#?(\d{3,6})\b/) || [])[1] || null;
  const limpo = limparRuidoNumerico(p);
  const m = limpo.match(/(?:#\s*|\b(?:tarefas?|task|chamado|issue|ticket)\s*[:#-]?\s*)(\d{3,6})\b/i);
  return { inicio, marcado: m ? m[1] : null };
}

/**
 * Precedência do número entre turnos (VS-BRANCH-010). O checklist JÁ validado manda:
 * um número achado no turno de agora NÃO sobrescreve o que o dev abriu antes. Era o
 * contrário (`numDeliberado || pending.num`), e por isso colar o report de QA como
 * ESCOPO trocava a tarefa #39702 pela #100 e criava a branch errada — com o escopo
 * certo dentro. Trocar de número no meio do checklist se faz com "cancela".
 */
export function resolverNumero(pending, numDoTurno) {
  return (pending && pending.num) || numDoTurno || null;
}

export function parseBranch(prompt) {
  const p = prompt || '';
  // num usa a MESMA regra do muro (marcado ou abrindo a mensagem). Antes era uma regex
  // solta e as duas discordavam: esta dizia "2026" (a data) e a do muro dizia "100".
  const achado = extrairNumeroTarefa(p);
  const num = achado.inicio || achado.marcado || null;
  const tipoM = (p.match(/\b(fix|bug|feat|feature|refactor|refact|perf|hotfix|chore|test|docs?)\b/i) || [])[1];
  const origM = (p.match(/\b(dev|develop|hml|homolog\w*|main|master|prod|produ[çc][ãa]o|staging)\b/i) || [])[1];

  // REPOSITÓRIOS e ALVO são estágios DISTINTOS (#velvet):
  // - repositorios = em QUAIS repos criar a branch. 'todos' = mesma branch em back+front+mobile.
  // - alvo = a camada onde a mudança ataca (front/back/mobile/todos).
  // Quando vêm ROTULADOS ("repositorios: todos", "alvo front"), respeita o rótulo;
  // um valor solto (só "todos"/"front") vira `target` e o hook preenche o próximo
  // campo faltante na sequência (repositorios antes de alvo).
  const repoLabel = (p.match(/reposit[óo]rios?\s*[:\-]?\s*([\wçãáéíóúâêô ,]+)/i) || [])[1];
  const alvoLabel = (p.match(/\balvo\s*[:\-]?\s*([\wçãáéíóúâêô ]+)/i) || [])[1];
  // repositorios = LISTA (multi-repo). target = lista solta (sem rótulo) p/ preencher em sequência.
  const repositorios = canonTargets(repoLabel);
  const alvo = canonTarget(alvoLabel);
  const target = canonTargets(p);

  // bug de CRUD/validação (editar/cadastrar/salvar + erro/validação/mensagem/campo)
  const crudOp = /\b(editar|edi[çc][ãa]o|cadastr\w*|criar|cria[çc][ãa]o|excluir|deletar|salvar|atualizar|remover|lista\w*|carreg\w*)\b/i.test(p);
  const crudSymptom = /\b(erro|falha|quebr\w*|n[ãa]o (salva|valida|trata|carrega|aparece|mostra)|valida[çc][ãa]o|mensagem|campo|500|422)\b/i.test(p);
  const crud = (crudOp && crudSymptom) || /erro ao (editar|salvar|cadastrar|criar|carregar)/i.test(p);
  return {
    num,
    tipo: tipoM ? (TIPOS[tipoM.toLowerCase()] || tipoM.toLowerCase()) : null,
    origem: origM ? origM.toLowerCase() : null,
    repositorios,
    alvo,
    target,
    crud,
  };
}

// Estado chaveado por SESSION_ID (constante na sessão) — não depende de cwd.
// Mesma sessão do Claude Code = mesmo estado, independente da pasta atual.
const slug = (key) => String(key || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'default';
export function reqPath(key) { return join(tmpdir(), `qa-gate-branch-${slug(key)}.json`); }

// Modo CONSULTA/DOC: sessão liberada só p/ leitura e geração de documento — sem commit/push.
const consultPath = (key) => join(tmpdir(), `qa-gate-consult-${slug(key)}.json`);
export function setConsult(key) { try { writeFileSync(consultPath(key), JSON.stringify({ ts: Date.now() })); } catch {} }
export function clearConsult(key) { try { rmSync(consultPath(key)); } catch {} }
export function isConsult(key) {
  try {
    if (!existsSync(consultPath(key))) { return false; }
    const o = JSON.parse(readFileSync(consultPath(key), 'utf8'));
    if (Date.now() - (o.ts || 0) > TTL) { rmSync(consultPath(key)); return false; }
    return true;
  } catch { return false; }
}

// Modo LIVRE pós-tarefa: setado após o push. A sessão fica liberada p/ perguntas,
// dúvidas e confirmações — o muro de branch NÃO engata. Só re-arma quando o Fabiano
// mandar a próxima tarefa (número), disser "próxima/nova tarefa" ou "deploy feito".
const FREE_TTL = 12 * 60 * 60 * 1000; // 12h (janela de trabalho)
const freePath = (key) => join(tmpdir(), `qa-gate-free-${slug(key)}.json`);
export function setFree(key) { try { writeFileSync(freePath(key), JSON.stringify({ ts: Date.now() })); } catch {} }
export function clearFree(key) { try { rmSync(freePath(key)); } catch {} }
export function isFree(key) {
  try {
    if (!existsSync(freePath(key))) { return false; }
    const o = JSON.parse(readFileSync(freePath(key), 'utf8'));
    if (Date.now() - (o.ts || 0) > FREE_TTL) { rmSync(freePath(key)); return false; }
    return true;
  } catch { return false; }
}

// PREFLIGHT por SESSÃO: na 1ª tarefa da sessão a IA valida ambiente ON (docker/app/
// reverb) + roda um smoke do gate. Verde -> marca a sessão como liberada e NÃO repete o
// preflight. Se algo cair depois, a IA resolve na hora (fluxo normal) — sem re-travar.
const preflightPath = (key) => join(tmpdir(), `qa-gate-preflight-${slug(key)}.json`);
export function setPreflight(key) { try { writeFileSync(preflightPath(key), JSON.stringify({ ts: Date.now() })); } catch {} }
export function clearPreflight(key) { try { rmSync(preflightPath(key)); } catch {} }
export function isPreflight(key) {
  try {
    if (!existsSync(preflightPath(key))) { return false; }
    const o = JSON.parse(readFileSync(preflightPath(key), 'utf8'));
    if (Date.now() - (o.ts || 0) > FREE_TTL) { rmSync(preflightPath(key)); return false; }
    return true;
  } catch { return false; }
}

// Opt-out por SESSÃO (não por pasta): desliga a governança nesta sessão do Claude,
// mesmo trabalhando dentro de um projeto governado (bancada de conserto). Vale até
// remover o flag. Chave = session_id.
const sessionOffPath = (key) => join(tmpdir(), `qa-gate-off-session-${slug(key)}.flag`);
export function setSessionOff(key) { try { writeFileSync(sessionOffPath(key), '1'); } catch {} }
export function clearSessionOff(key) { try { rmSync(sessionOffPath(key)); } catch {} }
export function isSessionOff(key) { try { return existsSync(sessionOffPath(key)); } catch { return false; } }

// ESTADO DA TAREFA ATIVA (checklist validado). Setado quando o muro completa
// (num+tipo+origem+alvo válidos). git-guard usa pra EXIGIR que o commit/push seja
// na branch da tarefa (prova de que a branch foi criada). TTL = janela de trabalho.
const taskPath = (key) => join(tmpdir(), `qa-gate-task-${slug(key)}.json`);
export function setTask(key, o) { try { writeFileSync(taskPath(key), JSON.stringify({ ...o, ts: Date.now() })); } catch {} }
export function clearTask(key) { try { rmSync(taskPath(key)); } catch {} }
export function getTask(key) {
  try {
    if (!existsSync(taskPath(key))) { return null; }
    const o = JSON.parse(readFileSync(taskPath(key), 'utf8'));
    if (Date.now() - (o.ts || 0) > FREE_TTL) { rmSync(taskPath(key)); return null; }
    return o;
  } catch { return null; }
}
// Marca ATIVIDADE na tarefa (bump de lastTs) sem alterar o inicio (ts). O time-box
// mede inatividade a partir daqui: cada tool/mensagem reseta -> trabalho ativo NAO
// trava por tempo de sessao/espera; so trava com o teto SEM atividade nenhuma.
export function touchTask(key) {
  try {
    const p = taskPath(key);
    if (!existsSync(p)) { return; }
    const o = JSON.parse(readFileSync(p, 'utf8'));
    o.lastTs = Date.now();
    writeFileSync(p, JSON.stringify(o));
  } catch {}
}

export function loadReq(key) {
  try {
    const p = reqPath(key);
    if (!existsSync(p)) { return null; }
    const o = JSON.parse(readFileSync(p, 'utf8'));
    if (Date.now() - (o.ts || 0) > TTL_REQ) { rmSync(p); return null; }
    // TTL DESLIZANTE: cada leitura renova a janela. O que expira é INATIVIDADE do dev,
    // não o tempo que a tarefa leva — coleta de dados longa não pode apagar o número.
    try { writeFileSync(p, JSON.stringify({ ...o, ts: Date.now() })); } catch {}
    return o;
  } catch { return null; }
}
export function saveReq(key, o) { try { writeFileSync(reqPath(key), JSON.stringify({ ...o, ts: Date.now() })); } catch {} }
export function clearReq(key) { try { rmSync(reqPath(key)); } catch {} }
