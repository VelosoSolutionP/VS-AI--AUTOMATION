/**
 * CRIAÇÃO REAL das branches da tarefa (VS-BRANCH-009).
 *
 * Antes o hook de tarefa só MANDAVA a IA criar a branch ("PASSO 1 OBRIGATÓRIO: git
 * checkout -b ..."). Quando a IA pulava esse passo — e pulava —, o dev trabalhava em
 * cima da branch ANTIGA e só descobria no commit, quando o muro do git-guard acusava.
 * Aqui a governança PARA de pedir e FAZ: fechado o checklist (número, tipo, origem,
 * repositórios, escopo), este módulo cria a branch em CADA repo escolhido.
 *
 * Regras preservadas do fluxo:
 *  - front/back: nasce de origin/<origem> (fetch antes) — base correta pro merge.
 *  - mobile: nasce da branch ATUAL (acumula o trabalho anterior), SEM origin/.
 *  - branch do número já existe (local/remota) = BUG VOLTOU -> entra na existente, não cria nova.
 *  - branch atual com trabalho pendente (commit não enviado / arquivo rastreado sujo) ->
 *    NÃO cria: devolve `pendente` pro dev fechar a anterior primeiro (VS-BRANCH-004).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { branchGlobsForNumber } from './company-config.mjs';

const PROTEGIDA = /^(main|master|dev|develop|desenvolvimento|hml|homolog\w*|production|prod|staging)$/i;

// Classificação da camada pelo NOME da pasta do repo. Cobre os padrões reais em uso:
// backend/frontend/mobile (Egle, Velvet, Ouv) e back-xxx/front-xxx (Morar Melhor).
const CAMADA = {
  mobile: /(^|[-_.])(mobile|app|flutter)([-_.]|$)/i,
  back: /(^|[-_.])(back|backend|api|server)([-_.]|$)/i,
  front: /(^|[-_.])(front|frontend|web|portal|client)([-_.]|$)/i,
};

const IGNORA = new Set(['node_modules', 'vendor', 'storage', 'dist', 'build']);

function git(args, cwd, timeoutMs = 15000) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    // nunca abrir prompt de credencial dentro de hook (travaria a sessão do dev)
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

const isRepo = (dir) => existsSync(join(dir, '.git'));

function reposFilhos(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !IGNORA.has(d.name))
      .map((d) => join(dir, d.name))
      .filter(isRepo);
  } catch { return []; }
}

function classifica(p) {
  const n = basename(p);
  if (CAMADA.mobile.test(n)) { return 'mobile'; }
  if (CAMADA.back.test(n)) { return 'back'; }
  if (CAMADA.front.test(n)) { return 'front'; }
  return null;
}

/**
 * Descobre os repos do projeto a partir do cwd da sessão. Sobe até 3 níveis e fica com
 * o nível que classificar MAIS camadas (cwd=Egle/backend -> acha Egle e as 3 camadas).
 * Projeto de 1 repo só com nome não classificável (Rurap/sigater) volta em `unico`.
 * Override da empresa: "repos": { "front": "...", "back": "...", "mobile": "..." }.
 */
export function discoverRepos(baseDir, cfg = {}) {
  const base = resolve(baseDir || '.');

  if (cfg && cfg.repos && typeof cfg.repos === 'object') {
    const map = {};
    for (const k of ['front', 'back', 'mobile']) {
      const v = cfg.repos[k];
      if (!v) { continue; }
      let p = isAbsolute(v) ? v : null;
      if (!p) { // relativo: tenta o cwd e os pais
        let d = base;
        for (let i = 0; i < 3 && !p; i++) {
          if (isRepo(join(d, v))) { p = join(d, v); }
          const up = dirname(d);
          if (up === d) { break; }
          d = up;
        }
      }
      if (p && isRepo(p)) { map[k] = p; }
    }
    if (Object.keys(map).length) { return { root: base, map, unico: null }; }
  }

  let melhor = null;
  let d = base;
  for (let i = 0; i < 3; i++) {
    const filhos = reposFilhos(d);
    if (filhos.length) {
      const map = {};
      for (const p of filhos) {
        const c = classifica(p);
        if (c && !map[c]) { map[c] = p; }
      }
      // PRIMEIRO nível que tem repo filho é o projeto — não continua subindo (senão uma
      // pasta-mãe cheia de projetos, ou o próprio temp, entraria no lugar do projeto).
      melhor = { root: d, map, filhos, score: Object.keys(map).length };
      break;
    }
    const up = dirname(d);
    if (up === d) { break; }
    d = up;
  }

  if (!melhor) {
    // cwd é o próprio repo (projeto de 1 repo, sessão aberta dentro dele)
    if (isRepo(base)) { return { root: dirname(base), map: {}, unico: base }; }
    return { root: base, map: {}, unico: null };
  }
  // 1 repo só e nome não classificável (monolito: front e back moram juntos)
  const unico = (melhor.score === 0 && melhor.filhos.length === 1) ? melhor.filhos[0] : null;
  return { root: melhor.root, map: melhor.map, unico };
}

/**
 * Camadas escolhidas -> repos onde criar. Monolito (um repo servindo front e back)
 * entra UMA vez: "front back" em projeto de 1 repo = 1 branch, não duas.
 */
export function resolveTargets(repos, disc) {
  const vistos = new Set();
  const targets = [];
  for (const camada of (repos || [])) {
    const p = disc.map[camada] || disc.unico || null;
    if (!p) { targets.push({ camada, path: null, nome: null }); continue; }
    if (vistos.has(p)) { continue; }
    vistos.add(p);
    targets.push({ camada, path: p, nome: basename(p) });
  }
  return targets;
}

function branchLocalExiste(path, nome) {
  try { return !!git(['branch', '--list', nome], path); } catch { return false; }
}

/**
 * Cria (ou entra em) a branch da tarefa em cada repo. NUNCA lança: cada repo volta com
 * um `status` e o hook explica ao dev o que aconteceu em cada um.
 *   criada | existente (bug voltou) | ja-nela | pendente | sem-repo | erro
 */
export function createBranches({ targets, branchName, origem, cfg = {}, budgetMs = 35000 }) {
  // ORÇAMENTO de tempo: o hook tem limite (60s) e ser MORTO no meio faria o dev perder o
  // contexto da tarefa inteiro. Estourado o orçamento, os repos restantes voltam como
  // erro pedindo criação manual — nunca em silêncio.
  const prazo = Date.now() + budgetMs;
  return (targets || []).map((t) => {
    if (!t.path) { return { ...t, status: 'sem-repo' }; }
    if (Date.now() > prazo) {
      return { ...t, status: 'erro', erro: 'tempo esgotado antes de chegar neste repo (rede/fetch lento)' };
    }
    const ehMobile = t.camada === 'mobile';
    try {
      const atual = git(['rev-parse', '--abbrev-ref', 'HEAD'], t.path);
      if (atual === branchName) { return { ...t, status: 'ja-nela', branch: atual }; }

      // BUG VOLTOU: já existe branch do número (local ou remota) -> entra nela
      const num = (String(branchName).match(/(\d{3,6})/) || [])[1];
      let existente = '';
      if (num) {
        const globs = branchGlobsForNumber(cfg, num);
        try { existente = git(['branch', '--list', ...globs], t.path); } catch {}
        if (!existente) {
          try { existente = git(['ls-remote', '--heads', 'origin', ...globs], t.path, 20000); } catch {}
        }
      }
      if (existente) {
        const nome = existente.split(/\r?\n/)[0]
          .replace(/^[*+\s]+/, '')
          .replace(/^[0-9a-f]+\s+refs\/heads\//, '')
          .trim();
        if (!branchLocalExiste(t.path, nome)) {
          try { git(['fetch', 'origin', `${nome}:${nome}`], t.path, 20000); } catch {}
        }
        git(['checkout', nome], t.path);
        return { ...t, status: 'existente', branch: nome, de: atual };
      }

      // trabalho da tarefa anterior ainda aberto -> não cria (VS-BRANCH-004)
      if (!PROTEGIDA.test(atual)) {
        let naoEnviados = 0;
        let sujos = 0;
        try { naoEnviados = parseInt(git(['rev-list', '--count', 'HEAD', '--not', '--remotes'], t.path) || '0', 10); } catch {}
        try { sujos = git(['status', '--porcelain', '--untracked-files=no'], t.path).split(/\r?\n/).filter(Boolean).length; } catch {}
        // MOBILE ACUMULA POR DESIGN (ver cabeçalho e o checkout logo abaixo): commit não
        // enviado na branch atual é o estado NORMAL dele, não "tarefa anterior aberta".
        // Cobrar push aqui fazia o guard recusar TODA tarefa da segunda em diante — e o
        // trabalho caía na branch da tarefa anterior. No Egle isso deixou 7 tarefas sem
        // branch própria (36138, 38772, 38776, 38780, 38784, 38788, 38792), com os commits
        // dentro de feat/fabiano.veloso/39511. Para mobile vale só a ÁRVORE SUJA, que é o
        // risco de verdade: trabalho não commitado se perde no checkout. (VS-BRANCH-011)
        const bloqueia = ehMobile ? sujos > 0 : (naoEnviados > 0 || sujos > 0);
        if (bloqueia) {
          return { ...t, status: 'pendente', branch: atual, naoEnviados, sujos };
        }
      }

      if (ehMobile) {
        git(['checkout', '-b', branchName], t.path); // ACUMULA: sai da atual, sem origin/
        return { ...t, status: 'criada', branch: branchName, base: atual };
      }
      git(['fetch', 'origin', origem], t.path, 20000);
      git(['checkout', '-b', branchName, `origin/${origem}`], t.path);
      return { ...t, status: 'criada', branch: branchName, base: `origin/${origem}` };
    } catch (e) {
      const msg = String((e && (e.stderr || e.message)) || e)
        .split(/\r?\n/).filter(Boolean).slice(-2).join(' | ').slice(0, 280);
      return { ...t, status: 'erro', erro: msg };
    }
  });
}
