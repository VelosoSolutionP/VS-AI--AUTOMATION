import { resolve, isAbsolute } from 'node:path';

/**
 * Normaliza path estilo MSYS/Git-Bash (`/c/Users/...`) para Windows (`C:/Users/...`).
 * Sem isso, o cwd vaza inválido pro execSync no Windows e o guard/recibo falha em silêncio
 * (fail-open) quando o comando traz `cd /c/...`. No-op em qualquer outro formato.
 */
export function toNativePath(p) {
  const m = String(p || '').match(/^\/([a-zA-Z])\/(.*)$/);
  return m ? `${m[1].toUpperCase()}:/${m[2]}` : String(p || '');
}

/**
 * Repo REAL onde o comando git roda. Fecha o furo do "cd X && git ..." e do "git -C X":
 * os hooks precisam agir no repo do COMANDO, não na pasta da SESSÃO do Claude — senão o
 * recibo/branch/projeto saem trocados (leak de projeto que suja o audit). Extrai o último
 * `cd` do comando ou o alvo de `git -C`; relativo é resolvido contra `base` (cwd da sessão).
 */
/**
 * Absoluto de verdade em QUALQUER plataforma. `isAbsolute('D:/Proj')` e false no Linux
 * (path posix), entao um `cd /d/Proj/repo` normalizado virava resolve(base,'D:/Proj')
 * -> caminho Frankenstein e o guard ia validar o repo errado. Aceita drive-letter
 * explicitamente, sem depender do SO onde o hook roda.
 */
function isAbsCross(p) {
  return isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(String(p || ''));
}

export function resolveGitCwd(command, base) {
  try {
    const cmd = String(command || '');
    const mC = cmd.match(/\bgit\s+-C\s+("([^"]+)"|'([^']+)'|([^\s&;|]+))/);
    if (mC) { const d = toNativePath(mC[2] || mC[3] || mC[4]); return isAbsCross(d) ? d : resolve(base, d); }
    const cds = [...cmd.matchAll(/\bcd\s+("([^"]+)"|'([^']+)'|([^\s&;|]+))/g)];
    if (cds.length) { const c = cds[cds.length - 1]; const d = toNativePath(c[2] || c[3] || c[4]); return isAbsCross(d) ? d : resolve(base, d); }
  } catch {}
  return base;
}
