/**
 * Estado acumulado de criação de branch (multi-turn).
 * Turn 1 manda número, turn 2 origem, turn 3 tipo — só cria quando os 3 estiverem juntos.
 * Marcador em .git/qa-gate-branch-req.json (TTL 15min, nunca commitado).
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
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

// caminho robusto: acha o .git real (funciona de subpasta/worktree); se não houver repo,
// cai num arquivo em temp keyed pelo cwd — assim o estado SEMPRE persiste entre turns.
export function reqPath(cwd) {
  try {
    const g = execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (g) { return join(isAbsolute(g) ? g : join(cwd, g), 'qa-gate-branch-req.json'); }
  } catch {}
  const key = Buffer.from(cwd || 'x').toString('hex').slice(0, 20);
  return join(tmpdir(), `qa-gate-branch-${key}.json`);
}

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
