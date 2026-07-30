import { resolve, isAbsolute } from 'node:path';

/**
 * Repo REAL onde o comando git roda. Fecha o furo do "cd X && git ..." e do "git -C X":
 * os hooks precisam agir no repo do COMANDO, não na pasta da SESSÃO do Claude — senão o
 * recibo/branch/projeto saem trocados (leak de projeto que suja o audit). Extrai o último
 * `cd` do comando ou o alvo de `git -C`; relativo é resolvido contra `base` (cwd da sessão).
 */
export function resolveGitCwd(command, base) {
  try {
    const cmd = String(command || '');
    const mC = cmd.match(/\bgit\s+-C\s+("([^"]+)"|'([^']+)'|([^\s&;|]+))/);
    if (mC) { const d = mC[2] || mC[3] || mC[4]; return isAbsolute(d) ? d : resolve(base, d); }
    const cds = [...cmd.matchAll(/\bcd\s+("([^"]+)"|'([^']+)'|([^\s&;|]+))/g)];
    if (cds.length) { const c = cds[cds.length - 1]; const d = c[2] || c[3] || c[4]; return isAbsolute(d) ? d : resolve(base, d); }
  } catch {}
  return base;
}
