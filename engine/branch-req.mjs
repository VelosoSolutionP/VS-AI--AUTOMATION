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

export function parseBranch(prompt) {
  const p = prompt || '';
  const num = (p.match(/#?(\d{3,6})\b/) || [])[1] || null;
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

export function loadReq(key) {
  try {
    const p = reqPath(key);
    if (!existsSync(p)) { return null; }
    const o = JSON.parse(readFileSync(p, 'utf8'));
    if (Date.now() - (o.ts || 0) > TTL) { rmSync(p); return null; }
    return o;
  } catch { return null; }
}
export function saveReq(key, o) { try { writeFileSync(reqPath(key), JSON.stringify({ ...o, ts: Date.now() })); } catch {} }
export function clearReq(key) { try { rmSync(reqPath(key)); } catch {} }
