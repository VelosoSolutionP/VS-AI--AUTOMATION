/**
 * VS-BRANCH-011 — mobile acumula por design, e o guard de tarefa aberta tem de saber disso.
 *
 * Regressão real (Egle mobile): `branch-create.mjs` cria a branch do mobile A PARTIR DA
 * BRANCH ATUAL de propósito, para acumular o trabalho anterior. Só que o VS-BRANCH-004
 * recusava criar quando a branch atual tinha commit não enviado — que no mobile é o
 * estado NORMAL desse acúmulo. Da segunda tarefa em diante o guard sempre recusava, e o
 * trabalho caía na branch da tarefa anterior: 7 tarefas (36138, 38772, 38776, 38780,
 * 38784, 38788, 38792) ficaram sem branch própria, com os commits dentro de
 * feat/fabiano.veloso/39511.
 *
 * Para mobile passa a valer só a ÁRVORE SUJA (trabalho não commitado, que se perde no
 * checkout). Front e back seguem exigindo a anterior fechada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createBranches } from '../engine/branch-create.mjs';

const CFG = { autor: 'nome.sobrenome', branchPattern: '<tipo>/<autor>/<numero>', tipos: ['fix', 'feat'] };

function g(args, cwd) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) { throw new Error('git ' + args.join(' ') + ' -> ' + (r.stderr || r.stdout)); }
  return (r.stdout || '').trim();
}

/**
 * Repo com UMA branch de tarefa contendo commit NÃO ENVIADO — o estado em que o Egle
 * mobile vive o tempo todo. Devolve { base, repo }.
 */
function repoComTrabalhoNaoEnviado() {
  const base = mkdtempSync(join(tmpdir(), 'vsbc-'));
  const remoto = join(base, 'remoto.git');
  const repo = join(base, 'repo');
  mkdirSync(remoto, { recursive: true });
  g(['init', '--bare', '-b', 'dev', '.'], remoto);

  g(['clone', remoto, 'repo'], base);
  writeFileSync(join(repo, 'a.txt'), 'x');
  g(['add', 'a.txt'], repo);
  g(['commit', '-m', 'seed'], repo);
  g(['push', '-u', 'origin', 'HEAD:dev'], repo);
  g(['checkout', '-B', 'dev'], repo);

  // branch da tarefa anterior, com 1 commit que NUNCA foi enviado
  g(['checkout', '-b', 'feat/nome.sobrenome/39511'], repo);
  writeFileSync(join(repo, 'b.txt'), 'y');
  g(['add', 'b.txt'], repo);
  g(['commit', '-m', 'feat(39511): trabalho acumulado'], repo);

  const naoEnviados = g(['rev-list', '--count', 'HEAD', '--not', '--remotes'], repo);
  assert.equal(naoEnviados, '1', 'cenario invalido: precisava de commit nao enviado');
  return { base, repo };
}

const criar = (repo, camada) => createBranches({
  targets: [{ path: repo, camada, repo: camada }],
  branchName: 'feat/nome.sobrenome/39701',
  origem: 'dev',
  cfg: CFG,
})[0];

test('#VS-BRANCH-011: mobile CRIA a branch mesmo com commit nao enviado (acumulo e o design)', () => {
  const { base, repo } = repoComTrabalhoNaoEnviado();
  try {
    const r = criar(repo, 'mobile');
    assert.equal(r.status, 'criada', 'mobile foi recusado: ' + JSON.stringify(r));
    assert.equal(r.branch, 'feat/nome.sobrenome/39701');
    // nasce da branch ATUAL, preservando o acumulo
    assert.equal(r.base, 'feat/nome.sobrenome/39511');
    assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], repo), 'feat/nome.sobrenome/39701');
    // o commit acumulado continua na historia da nova branch
    assert.match(g(['log', '--format=%s'], repo), /feat\(39511\)/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('#VS-BRANCH-011: back continua exigindo a tarefa anterior fechada', () => {
  const { base, repo } = repoComTrabalhoNaoEnviado();
  try {
    const r = criar(repo, 'back');
    assert.equal(r.status, 'pendente', 'back devia recusar: ' + JSON.stringify(r));
    assert.equal(r.naoEnviados, 1);
    assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], repo), 'feat/nome.sobrenome/39511',
      'nao pode ter trocado de branch');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('#VS-BRANCH-011: mobile com ARVORE SUJA continua barrado (risco de perder trabalho)', () => {
  const { base, repo } = repoComTrabalhoNaoEnviado();
  try {
    writeFileSync(join(repo, 'a.txt'), 'editado sem commit'); // arquivo RASTREADO sujo
    const r = criar(repo, 'mobile');
    assert.equal(r.status, 'pendente', 'arvore suja tinha de barrar: ' + JSON.stringify(r));
    assert.ok(r.sujos > 0);
    assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], repo), 'feat/nome.sobrenome/39511');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
