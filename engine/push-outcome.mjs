/**
 * O push FUNCIONOU?
 *
 * PostToolUse dispara depois do comando, com sucesso ou sem. Sem esta checagem,
 * um push recusado (403, branch protegida, rejected, sem rede) marcava pendencia
 * de doc, encerrava o relogio de ajuda e disparava recibo de "tarefa concluida"
 * pro tech lead -- tudo mentira, e a pendencia travava a tarefa seguinte.
 *
 * Duas fontes, nesta ordem de confianca:
 *   1. refs locais      -- o git so atualiza refs/remotes/<remoto>/<branch> quando o
 *                          servidor aceita. E deterministico e nao usa rede.
 *   2. saida do comando -- usada quando (1) nao se aplica: tags, remocao de branch,
 *                          refspec apontando pra outra branch.
 */
import { execSync } from 'node:child_process';

/** Sinais de recusa na saida do git, em ingles e em portugues. */
const RECUSA = [
  /^fatal:/im,
  /error:\s*failed to push/i,
  /!\s*\[rejected\]/i,
  /\[remote rejected\]/i,
  /permission denied/i,
  /write access to repository not granted/i,
  /authentication failed/i,
  /repository not found/i,
  /could not read from remote repository/i,
  /n[ãa]o foi poss[íi]vel acessar/i,
  /does not appear to be a git repository/i,
  /pre-receive hook declined/i,
  /protected branch/i,
  /remote:\s*error/i,
  /the requested url returned error:\s*(4\d\d|5\d\d)/i,
  /support for password authentication was removed/i,
];

function git(args, cwd) {
  return execSync(`git ${args}`, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Texto de toda a resposta da ferramenta, sem depender do formato exato do payload. */
function textoDaResposta(payload) {
  const r = payload?.tool_response ?? payload?.toolResponse ?? payload?.result ?? null;
  if (r == null) return '';
  if (typeof r === 'string') return r;
  try { return JSON.stringify(r); } catch { return String(r); }
}

/** Codigo de saida, quando o payload expuser algum. */
function codigoDeSaida(payload) {
  const r = payload?.tool_response ?? payload?.toolResponse ?? {};
  for (const k of ['exit_code', 'exitCode', 'code', 'status']) {
    const v = r?.[k] ?? payload?.[k];
    if (typeof v === 'number') return v;
  }
  return null;
}

/**
 * O comando avanca a branch atual, de modo que o ref local sirva de prova?
 * Nao serve quando o push manda tags, remove branch ou nomeia outra ref.
 */
function verificavelPorRefLocal(cmd) {
  const c = String(cmd || '');
  if (/--(tags|delete|mirror|prune|all)\b/.test(c)) return false;

  const semOpcoes = c.replace(/--[\w-]+(=\S+)?/g, ' ');
  const partes = semOpcoes.split(/\s+/).filter(Boolean);
  const i = partes.indexOf('push');
  if (i < 0) return true;

  // Aceita apenas `git push` ou `git push <remoto>`. Com refspec explicita a
  // branch enviada pode nao ser a atual, e o HEAD nao prova nada.
  return partes.length - i <= 2;
}

/**
 * @returns {{ok: boolean, motivo: string}} ok=true so quando o push foi de fato aceito.
 */
export function pushFoiAceito(cmd, payload, gitCwd) {
  const c = String(cmd || '');

  // Ensaio nao e entrega. Em `git push`, tanto --dry-run quanto -n sao ensaio.
  if (/(^|\s)(--dry-run|-n)(\s|$)/.test(c)) {
    return { ok: false, motivo: 'ensaio (--dry-run): nada foi enviado' };
  }

  const codigo = codigoDeSaida(payload);
  if (typeof codigo === 'number' && codigo !== 0) {
    return { ok: false, motivo: `git terminou com codigo ${codigo}` };
  }

  if (RECUSA.some((re) => re.test(textoDaResposta(payload)))) {
    return { ok: false, motivo: 'o remoto recusou o push' };
  }

  // Prova local: o ref de rastreamento so avanca quando o servidor aceita.
  if (verificavelPorRefLocal(c)) {
    let head = '';
    try {
      head = git('rev-parse HEAD', gitCwd);
    } catch {
      return { ok: false, motivo: 'sem HEAD: nao da pra confirmar o push' };
    }

    let remotos = '';
    try {
      remotos = git(`branch -r --contains ${head}`, gitCwd);
    } catch {
      return { ok: false, motivo: 'nao foi possivel ler os refs remotos locais' };
    }

    if (!remotos) {
      return { ok: false, motivo: 'nenhum ref remoto contem o HEAD: o push nao chegou' };
    }
  }

  return { ok: true, motivo: '' };
}
