/**
 * Estado acumulado de criação de branch (multi-turn).
 * Turn 1 manda número, turn 2 origem, turn 3 tipo — só cria quando os 3 estiverem juntos.
 * Marcador em .git/qa-gate-branch-req.json (TTL 15min, nunca commitado).
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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

export const reqPath = (cwd) => join(cwd, '.git', 'qa-gate-branch-req.json');

export function loadReq(cwd) {
  try {
    if (!existsSync(reqPath(cwd))) { return null; }
    const o = JSON.parse(readFileSync(reqPath(cwd), 'utf8'));
    if (Date.now() - (o.ts || 0) > TTL) { rmSync(reqPath(cwd)); return null; }
    return o;
  } catch { return null; }
}
export function saveReq(cwd, o) { try { writeFileSync(reqPath(cwd), JSON.stringify({ ...o, ts: Date.now() })); } catch {} }
export function clearReq(cwd) { try { rmSync(reqPath(cwd)); } catch {} }
