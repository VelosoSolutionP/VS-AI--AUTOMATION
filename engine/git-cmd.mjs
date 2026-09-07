import { readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { toNativePath } from './git-cwd.mjs';
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

/**
 * `--no-verify` (ou o `-n` de `git commit`) burla os hooks locais.
 *
 * Testar /-n\b/ na linha inteira dá falso positivo em série: `git push … | grep -n`,
 * `git commit -m "corrige -n"`, qualquer `sort -n`/`head -n` na mesma linha. Aqui a
 * busca acontece só nos ARGUMENTOS do git, até o primeiro separador de shell.
 *
 * Detalhe que importa: em `git push`, `-n` é `--dry-run`, não `--no-verify`. Ensaio é
 * inofensivo e não deve ser barrado; o `-n` curto só conta para `git commit`.
 */
export function usaNoVerify(cmd) {
  const s = String(cmd || '');
  const alvos = [
    { re: RE_COMMIT, curto: true },
    { re: RE_PUSH, curto: false },
  ];

  for (const { re, curto } of alvos) {
    const m = re.exec(s);
    if (!m) continue;

    // Argumentos do git até o próximo separador de shell (pipe, ;, &&, redireção,
    // here-doc). O que vier depois é outro comando e não é problema deste guard.
    const resto = s.slice(m.index + m[0].length);
    const args = resto.split(/\||;|&&|<<|>>|>|\n/)[0];

    // Ignora conteúdo entre aspas: `-m "corrige -n"` não é flag.
    const semAspas = args.replace(/"[^"]*"|'[^']*'/g, ' ');
    const tokens = semAspas.split(/\s+/).filter(Boolean);

    if (tokens.includes('--no-verify')) return true;

    // Formas curtas do commit: -n isolado ou agrupado (-an, -nm).
    if (curto && tokens.some((t) => /^-[a-z]*n[a-z]*$/.test(t))) return true;
  }

  return false;
}

/**
 * Modos de `git branch` que NÃO criam nada: listagem, remoção, renomeio, cópia,
 * consulta. Testar `git branch \S` barrava `git branch -r`, `-a`, `--list`, `-vv`
 * e até `git branch -d` — todos tratados como "criar branch nova".
 */
const BRANCH_NAO_CRIA = new Set([
  '-l', '--list', '-r', '--remotes', '-a', '--all', '-v', '-vv', '--verbose',
  '-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy',
  '--show-current', '--merged', '--no-merged', '--contains', '--no-contains',
  '--points-at', '--format', '--sort', '--edit-description',
  '--set-upstream-to', '-u', '--unset-upstream', '--column', '--no-column',
]);

/** Opções de `git branch` que consomem o próximo token como valor. */
const BRANCH_COM_VALOR = new Set([
  '--contains', '--no-contains', '--merged', '--no-merged', '--points-at',
  '--format', '--sort', '--set-upstream-to', '-u', '--color',
]);

/**
 * O comando CRIA uma branch? Devolve também o nome, quando houver.
 *
 * Só é criação em: `git checkout -b <nome>`, `git switch -c|-C <nome>` e
 * `git branch <nome>` sem flag de modo. Listar, deletar e renomear não são criação.
 */
export function analisarCriacaoDeBranch(cmd) {
  const s = String(cmd || '');

  const co = s.match(/\bgit\b[^|;&\n]*?\s(?:checkout\s+-b|switch\s+-[cC])\s+(\S+)/);
  if (co) return { cria: true, nome: co[1] };

  const br = s.match(/\bgit\b[^|;&\n]*?\sbranch\b([^|;&\n]*)/);
  if (!br) return { cria: false, nome: '' };

  const tokens = br[1].replace(/"[^"]*"|'[^']*'/g, ' ').split(/\s+/).filter(Boolean);

  let nome = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const base = t.split('=')[0];

    if (t.startsWith('-')) {
      if (BRANCH_NAO_CRIA.has(base)) return { cria: false, nome: '' };
      if (BRANCH_COM_VALOR.has(base) && !t.includes('=')) i++;
      continue;
    }

    if (!nome) nome = t;
  }

  return nome ? { cria: true, nome } : { cria: false, nome: '' };
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

/**
 * MENSAGEM REAL do git commit, venha de onde vier. O parser antigo lia so o PRIMEIRO `-m`,
 * entao tres caminhos passavam sem validacao nenhuma:
 *   - `-m "titulo" -m "Co-Authored-By: Claude"` -> assinatura de IA escondida no 2o -m;
 *   - `git commit -F arquivo`                       -> justamente o que o VS-AUD-005 manda usar;
 *   - `git commit -F - <<EOF ... EOF`               -> heredoc.
 * Junta todos os `-m/--message`, o conteudo de `-F/--file` e o corpo do heredoc.
 * `base` e o cwd do repo, pra resolver caminho relativo do -F.
 */
/**
 * Argumentos do git a partir de `from`, parando no primeiro separador de shell que
 * esteja FORA de aspas. Split cru por /|;&&>/ cortava no meio de `-m 'Co-Authored-By:
 * Claude <x@y.com>'` — o `>` do e-mail encerrava os argumentos e a assinatura de IA
 * escapava da validacao.
 */
function sliceGitArgs(s, from) {
  let q = null;
  let out = '';
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) { out += c; if (c === q) { q = null; } continue; }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === '\n' || c === ';' || c === '|') { break; }
    if (c === '&' && s[i + 1] === '&') { break; }
    if (c === '<' && s[i + 1] === '<') { break; }
    if (c === '>') { break; }
    out += c;
  }
  return out;
}

export function extractCommitMessage(cmd, base) {
  const s = String(cmd || '');
  const partes = [];
  let origem = null;

  // -m/-F so valem nos ARGUMENTOS do git. Varrer a linha inteira fazia o CORPO da
  // mensagem virar flag: um commit que explica "so o primeiro -m era lido" casava
  // `-m era` e o guard passava a validar a palavra "era" como titulo. Corta no
  // primeiro separador de shell (o heredoc entra por outro caminho, abaixo).
  const inicio = RE_COMMIT.exec(s);
  const args = inicio ? sliceGitArgs(s, inicio.index + inicio[0].length) : s;

  const RE_M = /(?:^|\s)(?:-m|--message)(?:=|\s+)("([^"]*)"|'([^']*)'|([^\s;|&]+))/g;
  for (const m of args.matchAll(RE_M)) {
    partes.push(m[2] ?? m[3] ?? m[4] ?? '');
    origem = origem || '-m';
  }

  const heredoc = s.match(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1\r?\n([\s\S]*?)\r?\n[ \t]*\2\b/);
  const mF = args.match(/(?:^|\s)(?:-F|--file)(?:=|\s+)("([^"]*)"|'([^']*)'|([^\s;|&]+))/);
  if (mF) {
    const alvo = mF[2] ?? mF[3] ?? mF[4] ?? '';
    if (alvo === '-') {
      if (heredoc) { partes.push(heredoc[3]); origem = origem || 'heredoc'; }
    } else {
      try {
        const nat = toNativePath(alvo);
        const abs = isAbsolute(nat) ? nat : resolve(base || '.', nat);
        partes.push(readFileSync(abs, 'utf8'));
        origem = origem || '-F';
      } catch {
        // PreToolUse roda ANTES do comando: `cat > msg.txt <<EOF ... && ... -F msg.txt`
        // ainda nao criou o arquivo. O texto esta no heredoc do proprio comando.
        if (heredoc) { partes.push(heredoc[3]); origem = origem || 'heredoc'; }
        else { origem = origem || '-F-ilegivel'; }
      }
    }
  } else if (heredoc) {
    partes.push(heredoc[3]);
    origem = origem || 'heredoc';
  }

  const full = partes.join('\n\n').replace(/^\s*\n/, '');
  const linhas = full.split(/\r?\n/);
  return {
    origem,
    full,
    subject: (linhas[0] || '').trim(),
    body: linhas.slice(1).join('\n').trim(),
  };
}
