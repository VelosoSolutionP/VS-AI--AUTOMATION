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
const RE_BRANCH = subRe('branch');

export function isGitPush(cmd) { return RE_PUSH.test(String(cmd || '')); }
export function isGitCommit(cmd) { return RE_COMMIT.test(String(cmd || '')); }

/**
 * CRIAÇÃO de branch. `checkout -b` / `switch -c` sempre criam. O subcomando `branch` só
 * cria quando recebe um NOME — com flag de leitura/manutenção (`-a`, `-r`, `--list`,
 * `--show-current`, `--format=…`, `--merged`, `-d`, `-m`…) é consulta ou faxina.
 *
 * Antes o guard testava `\s+branch\s+\S`: QUALQUER argumento contava como criação, então
 * uma LISTAGEM caía no VS-BRANCH-002 ("crie a partir de origin/<origem>") — bloqueando
 * justamente o passo que o fluxo EXIGE: antes de criar, conferir se já existe branch do
 * número (bug voltou).
 */
const BRANCH_NAO_CRIA = new Set([
  '--all', '--remotes', '--list', '--verbose', '--quiet', '--show-current', '--format',
  '--contains', '--no-contains', '--merged', '--no-merged', '--sort', '--points-at',
  '--color', '--no-color', '--column', '--no-column', '--delete', '--move', '--copy',
  '--set-upstream-to', '--unset-upstream', '--edit-description',
]);
// flags curtas que NÃO criam (-a -r -l -v -q -d/-D -m/-M -C -u), inclusive combinadas (-av).
const BRANCH_CURTA_NAO_CRIA = /[arlvqdDmMCu]/;

export function createsBranch(cmd) {
  const s = String(cmd || '');
  if (/\bgit\s+checkout\s+-b\b/.test(s) || /\bgit\s+switch\s+-c\b/.test(s)) { return true; }
  const m = s.match(RE_BRANCH);
  if (!m) { return false; }
  // argumentos do subcomando até o próximo separador de comando
  const args = s.slice(m.index + m[0].length).split(/[&|;]/)[0].trim();
  if (!args) { return false; } // sem argumento = listagem
  let nomes = 0;
  for (const t of (args.match(/"[^"]*"|'[^']*'|\S+/g) || [])) {
    if (t.startsWith('--')) {
      if (BRANCH_NAO_CRIA.has(t.split('=')[0])) { return false; }
      continue; // --force e afins não descaracterizam criação
    }
    if (/^-[a-zA-Z]+$/.test(t)) {
      if (BRANCH_CURTA_NAO_CRIA.test(t.slice(1))) { return false; }
      continue;
    }
    nomes++;
  }
  return nomes > 0;
}

/**
 * Detecta a here-string PowerShell `@'...'@` (ou `@"..."@`) usada POR ENGANO na tool Bash
 * (POSIX). Aí o `@` fica FORA das aspas e VAZA pro título do commit (ex.: "@ fix(123): x"),
 * quebrando o padrão e a certificação CMMI — e o parser de `-m` (que casa a partir da aspa)
 * nem vê o `@`. Assinatura: `-m` seguido de `@`, ou o par `@'...'@` / `@"..."@` no comando.
 */
export function hasPowerShellHereStringAt(cmd) {
  const s = String(cmd || '');
  return /-m\s*@/.test(s) || /@'[\s\S]*'@/.test(s) || /@"[\s\S]*"@/.test(s);
}
