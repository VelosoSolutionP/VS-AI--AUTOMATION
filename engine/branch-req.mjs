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

export function parseBranch(prompt) {
  const p = prompt || '';
  const num = (p.match(/#?(\d{3,6})\b/) || [])[1] || null;
  const tipoM = (p.match(/\b(fix|bug|feat|feature|refactor|refact|perf|hotfix|chore|test|docs?)\b/i) || [])[1];
  const origM = (p.match(/\b(dev|develop|hml|homolog\w*|main|master|prod|produ[çc][ãa]o|staging)\b/i) || [])[1];
  // ALVO = camada onde atacar (mobile tem prioridade; depois back; depois front)
  let alvo = null;
  if (/\b(mobile|app|flutter|dart|apk)\b/i.test(p)) { alvo = 'mobile'; }
  else if (/\b(back|backend|api|laravel|controller|service|repository|migration|model|endpoint)\b/i.test(p)) { alvo = 'back'; }
  else if (/\b(front|frontend|web|tela|ui|componente|component|next|react|blade|livewire|p[áa]gina|view)\b/i.test(p)) { alvo = 'front'; }
  // bug de CRUD/validação (editar/cadastrar/salvar + erro/validação/mensagem/campo)
  const crudOp = /\b(editar|edi[çc][ãa]o|cadastr\w*|criar|cria[çc][ãa]o|excluir|deletar|salvar|atualizar|remover|lista\w*|carreg\w*)\b/i.test(p);
  const crudSymptom = /\b(erro|falha|quebr\w*|n[ãa]o (salva|valida|trata|carrega|aparece|mostra)|valida[çc][ãa]o|mensagem|campo|500|422)\b/i.test(p);
  const crud = (crudOp && crudSymptom) || /erro ao (editar|salvar|cadastrar|criar|carregar)/i.test(p);
  return {
    num,
    tipo: tipoM ? (TIPOS[tipoM.toLowerCase()] || tipoM.toLowerCase()) : null,
    origem: origM ? origM.toLowerCase() : null,
    alvo,
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

// Opt-out por SESSÃO (não por pasta): desliga a governança nesta sessão do Claude,
// mesmo trabalhando dentro de um projeto governado (bancada de conserto). Vale até
// remover o flag. Chave = session_id.
const sessionOffPath = (key) => join(tmpdir(), `qa-gate-off-session-${slug(key)}.flag`);
export function setSessionOff(key) { try { writeFileSync(sessionOffPath(key), '1'); } catch {} }
export function clearSessionOff(key) { try { rmSync(sessionOffPath(key)); } catch {} }
export function isSessionOff(key) { try { return existsSync(sessionOffPath(key)); } catch { return false; } }

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
