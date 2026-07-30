import { execSync } from 'node:child_process';

/**
 * Contexto de MERGE / promoção de ambiente (dev→hml→main). Nesses casos a governança
 * LIBERA (não é commit direto de código numa branch protegida, é integração):
 *  - comando `git merge ...`
 *  - merge em andamento (MERGE_HEAD existe) — o `git commit` que finaliza a resolução
 *  - HEAD é merge commit (2+ pais) — o `git push` da promoção
 * Só o commit/push DIRETO (sem merge) numa branch protegida continua bloqueado.
 */
export function isMergeContext(cmd, gitCwd) {
  const c = String(cmd || '');
  if (/\bgit\s+merge\b/.test(c)) { return true; }
  try {
    execSync('git rev-parse -q --verify MERGE_HEAD', { cwd: gitCwd, stdio: 'ignore' });
    return true;
  } catch {}
  try {
    const parents = execSync('git rev-list --parents -n 1 HEAD', { cwd: gitCwd, encoding: 'utf8' }).trim().split(/\s+/);
    if (parents.length >= 3) { return true; } // sha + 2 pais = merge commit
  } catch {}
  return false;
}
