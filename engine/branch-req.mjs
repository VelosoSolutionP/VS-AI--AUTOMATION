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
  return {
    num,
    tipo: tipoM ? (TIPOS[tipoM.toLowerCase()] || tipoM.toLowerCase()) : null,
    origem: origM ? origM.toLowerCase() : null,
  };
}

// Estado chaveado por SESSION_ID (constante na sessão) — não depende de cwd.
// Mesma sessão do Claude Code = mesmo estado, independente da pasta atual.
export function reqPath(key) {
  const safe = String(key || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'default';
  return join(tmpdir(), `qa-gate-branch-${safe}.json`);
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
