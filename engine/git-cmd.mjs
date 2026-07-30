/**
 * Detecção de invocação REAL de `git <subcomando>` — não palavra solta no texto do
 * comando. Fecha o furo dos recibos/gate fantasma: um `echo "pronto pra commit"`, um
 * `git log --grep=push`, um caminho `.git/…` ou um `node -e "...git push..."` NÃO podem
 * disparar recibo de push nem gate de commit. Exige `git`, opções globais opcionais
 * (`-C <path>`, `-c <kv>`, `--flag[=v]`) e então o subcomando exato.
 */
function subRe(sub) {
  return new RegExp(
    '\\bgit\\b(?:\\s+-C\\s+(?:"[^"]*"|\'[^\']*\'|\\S+)|\\s+-c\\s+\\S+|\\s+--[\\w-]+(?:=\\S+)?)*\\s+' + sub + '\\b'
  );
}
const RE_PUSH = subRe('push');
const RE_COMMIT = subRe('commit');

export function isGitPush(cmd) { return RE_PUSH.test(String(cmd || '')); }
export function isGitCommit(cmd) { return RE_COMMIT.test(String(cmd || '')); }
