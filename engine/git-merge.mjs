import { execSync } from 'node:child_process';

/**
 * Branch de PROMOÇÃO de ambiente: `<tipo>/<autor>/merge-<env>` (ex.: fix/fabiano.veloso/
 * merge-hml, merge-main). É criada a partir de hml/main, recebe o merge de dev e sobe por
 * MR (o tech lead aprova) — nunca push direto na branch protegida. Isenta de número de
 * tarefa; o merge nela não passa pelo gate/padrão de tarefa.
 * IMPORTANTE: isto NÃO libera push DIRETO em branch protegida (hml/main) — isso segue
 * bloqueado (VS-GIT-002). A promoção é sempre via ESTA branch + MR.
 */
export function isPromotionBranch(branch) {
  const b = String(branch || '');
  return /(^|\/)merge-[a-z0-9._-]+$/i.test(b);
}

/**
 * Contexto de MERGE (integração): comando `git merge`, merge em andamento (MERGE_HEAD) ou
 * HEAD é merge commit (2+ pais). Usado SÓ p/ pular gate/padrão de tarefa num merge — jamais
 * p/ liberar push em branch protegida.
 */
export function isMergeContext(cmd, gitCwd) {
  const c = String(cmd || '');
  if (/\bgit\s+merge\b/.test(c)) { return true; }
  try { execSync('git rev-parse -q --verify MERGE_HEAD', { cwd: gitCwd, stdio: 'ignore' }); return true; } catch {}
  try {
    const parents = execSync('git rev-list --parents -n 1 HEAD', { cwd: gitCwd, encoding: 'utf8' }).trim().split(/\s+/);
    if (parents.length >= 3) { return true; }
  } catch {}
  return false;
}
