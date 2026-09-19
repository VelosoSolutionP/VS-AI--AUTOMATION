/**
 * VSpainel — auditor. Lê os recibos que o QA-Gate grava e diz, por repositório, se
 * existe verde VÁLIDO agora.
 *
 * A tela antes dizia: "o QA-Gate grava recibo em .git/qa-gate-green.json por
 * repositório — este painel ainda não lê esses recibos". Passa a ler.
 *
 * A regra de validade é a mesma da governança, e é dura de propósito: recibo existir
 * não basta. Ele vale só se status="green", se a branch for a que está em uso AGORA e
 * se for mais novo que o último arquivo tocado. Recibo velho é pior que recibo
 * nenhum — dá a sensação de verde para um código que mudou depois.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/** Janela em que um verde ainda vale, em minutos. */
export const VALIDADE_MIN = 30;

const RECIBOS = [
  { arquivo: 'qa-gate-green.json', stack: 'back/front' },
  { arquivo: 'qa-gate-mobile.json', stack: 'mobile' },
];

function branchAtual(repo) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Arquivo rastreado mais recente do repositório. É com isso que se sabe se alguém
 * editou DEPOIS do gate — o recibo não se invalida sozinho.
 */
export function ultimaEdicao(repo) {
  try {
    const lista = execSync('git ls-files -z', { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
    let maior = 0;
    for (const f of lista) {
      try {
        const t = statSync(join(repo, f)).mtimeMs;
        if (t > maior) { maior = t; }
      } catch { /* arquivo sumiu entre o ls e o stat */ }
    }
    return maior || null;
  } catch {
    return null;
  }
}

/**
 * Lê UM recibo e julga. Nunca lança: repositório sem .git, sem recibo ou com JSON
 * corrompido volta como "não tem", que é a informação honesta.
 */
export function lerRecibo(repo, arquivo, agora = Date.now(), opts = {}) {
  const caminho = join(repo, '.git', arquivo);
  if (!existsSync(caminho)) { return { existe: false, caminho }; }

  let dados;
  try {
    dados = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return { existe: true, caminho, valido: false, motivo: 'recibo ilegível (JSON corrompido)' };
  }

  const ts = Number(dados.ts) || 0;
  const idadeMin = ts ? Math.round((agora - ts) / 60000) : null;
  const atual = opts.branch ?? branchAtual(repo);
  const edicao = opts.ultimaEdicao ?? ultimaEdicao(repo);

  const motivos = [];
  if (dados.status !== 'green') { motivos.push(`status "${dados.status}", não "green"`); }
  if (atual && dados.branch && dados.branch !== atual) { motivos.push(`recibo é da branch "${dados.branch}", a atual é "${atual}"`); }
  if (idadeMin == null) { motivos.push('recibo sem data'); }
  else if (idadeMin > VALIDADE_MIN) { motivos.push(`${idadeMin} min de idade (vale ${VALIDADE_MIN})`); }
  // O que mais engana: gate verde e alguém edita em seguida.
  if (edicao && ts && edicao > ts) { motivos.push('houve edição DEPOIS do gate'); }

  return {
    existe: true,
    caminho,
    status: dados.status ?? null,
    branch: dados.branch ?? null,
    branchAtual: atual,
    ts: ts || null,
    quando: ts ? new Date(ts).toISOString() : null,
    idadeMin,
    valido: motivos.length === 0,
    motivo: motivos.join('; ') || null,
  };
}

/** Situação de um repositório: os dois recibos possíveis + a branch em uso. */
export function auditarRepo(repo, agora = Date.now()) {
  const nome = repo.split('/').filter(Boolean).slice(-2).join('/');
  if (!existsSync(join(repo, '.git'))) {
    return { repo, nome, existe: false, motivo: 'não é um repositório git (ou o caminho sumiu)' };
  }
  const branch = branchAtual(repo);
  const edicao = ultimaEdicao(repo);
  const recibos = {};
  for (const { arquivo, stack } of RECIBOS) {
    recibos[stack] = lerRecibo(repo, arquivo, agora, { branch, ultimaEdicao: edicao });
  }
  const algumValido = Object.values(recibos).some((r) => r.valido);
  return {
    repo, nome, existe: true, branch,
    ultimaEdicao: edicao ? new Date(edicao).toISOString() : null,
    recibos,
    verde: algumValido,
    // Sem recibo nenhum é diferente de recibo vencido: o primeiro nunca rodou, o
    // segundo rodou e perdeu a validade. A tela precisa distinguir.
    situacao: algumValido ? 'verde'
      : Object.values(recibos).some((r) => r.existe) ? 'vencido' : 'nunca rodou',
  };
}

/** Repositórios a auditar: os configurados + o do próprio processo. */
export function reposConfigurados(extra = []) {
  const doEnv = String(process.env.VSPAINEL_REPOS || '').split(/[:,]/).map((s) => s.trim()).filter(Boolean);
  return [...new Set([...extra, ...doEnv, process.cwd()])];
}

/** Auditoria de todos, com contagem pronta pra tela. */
export function auditar(repos = reposConfigurados(), agora = Date.now()) {
  const itens = repos.map((r) => auditarRepo(r, agora));
  return {
    itens,
    total: itens.length,
    verdes: itens.filter((i) => i.verde).length,
    vencidos: itens.filter((i) => i.situacao === 'vencido').length,
    nuncaRodaram: itens.filter((i) => i.situacao === 'nunca rodou').length,
    quebrados: itens.filter((i) => i.existe === false).length,
  };
}

/** Pendência de documentação que o hook grava ao dar push. */
export function docPendente(repo) {
  const f = join(repo, '.git', 'qa-gate-pending-doc');
  if (!existsSync(f)) { return null; }
  try {
    return { branch: readFileSync(f, 'utf8').trim(), desde: new Date(statSync(f).mtimeMs).toISOString() };
  } catch {
    return { branch: null, desde: null };
  }
}
