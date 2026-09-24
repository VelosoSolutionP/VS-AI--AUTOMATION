/**
 * Testes dos dois bugs que travavam o fluxo:
 *
 *  1. pendencia de doc criada por push que FALHOU  -> travava a tarefa seguinte
 *     e disparava recibo falso de entrega pro tech lead.
 *  2. /-n\b/ na linha inteira                      -> barrava `git push | grep -n`
 *     e `git commit -m "corrige -n"`.
 *
 * Roda com:  node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { usaNoVerify, isGitPush, isGitCommit, analisarCriacaoDeBranch } from '../engine/git-cmd.mjs';
import { pushFoiAceito } from '../engine/push-outcome.mjs';

// ---------------------------------------------------------------- VS-BRANCH

test('detecta criacao real de branch', () => {
  assert.deepEqual(
    analisarCriacaoDeBranch('git checkout -b feat/fabiano.veloso/37628 origin/dev'),
    { cria: true, nome: 'feat/fabiano.veloso/37628' });
  assert.deepEqual(
    analisarCriacaoDeBranch('git switch -c fix/fabiano.veloso/999 origin/main'),
    { cria: true, nome: 'fix/fabiano.veloso/999' });
  assert.equal(analisarCriacaoDeBranch('git branch nova-branch').cria, true);
});

test('listar branch NAO e criar branch (o falso positivo antigo)', () => {
  for (const cmd of [
    'git branch -r',
    'git branch -a',
    'git branch -vv',
    'git branch --list "feat/*"',
    'git branch --show-current',
    'git branch -r --contains HEAD',
    'git branch -a --list "*37628*"',
  ]) {
    assert.equal(analisarCriacaoDeBranch(cmd).cria, false, cmd);
  }
});

test('remover e renomear branch nao entram no fluxo de criacao', () => {
  for (const cmd of ['git branch -d antiga', 'git branch -D antiga', 'git branch -m velho novo']) {
    assert.equal(analisarCriacaoDeBranch(cmd).cria, false, cmd);
  }
});

test('git branch em outro comando da linha nao conta', () => {
  assert.equal(analisarCriacaoDeBranch('echo x | grep branch').cria, false);
  assert.equal(analisarCriacaoDeBranch('git log --oneline | head -n 3').cria, false);
});

// ---------------------------------------------------------------- VS-GIT-002

test('bloqueia --no-verify em commit e em push', () => {
  assert.equal(usaNoVerify('git commit --no-verify -m "x"'), true);
  assert.equal(usaNoVerify('git push --no-verify origin main'), true);
  assert.equal(usaNoVerify('git commit -n -m "x"'), true);
  assert.equal(usaNoVerify('git commit -an -m "x"'), true, 'flag curta agrupada');
});

test('nao bloqueia -n que nao e flag do git (o falso positivo antigo)', () => {
  assert.equal(usaNoVerify('git push origin main 2>&1 | grep -n erro'), false);
  assert.equal(usaNoVerify('git commit -m "corrige o parser do -n"'), false);
  assert.equal(usaNoVerify("git commit -m 'trata -n como --dry-run'"), false);
  assert.equal(usaNoVerify('git push && sort -n arquivo.txt'), false);
  assert.equal(usaNoVerify('git commit -m "x" && head -n 5 log.txt'), false);
});

test('-n em push e --dry-run, nao --no-verify: nao e burla', () => {
  assert.equal(usaNoVerify('git push -n origin main'), false);
});

test('comando sem git nao aciona o guard', () => {
  assert.equal(usaNoVerify('echo "vou commit --no-verify"'), false);
  assert.equal(isGitPush('echo "git push"'), true, 'deteccao textual e do guard existente');
  assert.equal(isGitCommit('grep -rn commit src/'), false);
});

// ---------------------------------------------------------------- VS-DOC-001

function repoTemporario() {
  const dir = mkdtempSync(join(tmpdir(), 'vsia-'));
  const g = (a) => execSync(`git ${a}`, { cwd: dir, stdio: 'ignore' });
  g('init -q -b main');
  g('config user.email teste@teste');
  g('config user.name Teste');
  writeFileSync(join(dir, 'a.txt'), 'a');
  g('add a.txt');
  g('commit -q -m inicial');
  return { dir, g };
}

test('push recusado pelo remoto NAO conta como entrega', () => {
  const { dir } = repoTemporario();
  try {
    const payload = {
      tool_response: {
        stderr: 'remote: Write access to repository not granted.\nfatal: nao foi possivel acessar',
      },
    };
    const r = pushFoiAceito('git push -u origin main', payload, dir);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /recusou/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sem ref remoto contendo o HEAD, o push nao chegou', () => {
  const { dir } = repoTemporario();
  try {
    // Saida limpa, mas nenhum refs/remotes aponta pro HEAD.
    const r = pushFoiAceito('git push', { tool_response: { stdout: '' } }, dir);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /nao chegou/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push aceito de verdade conta como entrega', () => {
  const { dir, g } = repoTemporario();
  const remoto = mkdtempSync(join(tmpdir(), 'vsia-remoto-'));
  try {
    execSync('git init -q --bare', { cwd: remoto, stdio: 'ignore' });
    g(`remote add origin ${remoto}`);
    g('push -q -u origin main');

    const r = pushFoiAceito('git push -u origin main', { tool_response: { stdout: '' } }, dir);
    assert.equal(r.ok, true, r.motivo);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remoto, { recursive: true, force: true });
  }
});

test('ensaio nao e entrega', () => {
  const { dir } = repoTemporario();
  try {
    for (const cmd of ['git push --dry-run', 'git push -n origin main']) {
      const r = pushFoiAceito(cmd, {}, dir);
      assert.equal(r.ok, false, cmd);
      assert.match(r.motivo, /ensaio/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('codigo de saida diferente de zero derruba a entrega', () => {
  const { dir } = repoTemporario();
  try {
    const r = pushFoiAceito('git push', { tool_response: { exit_code: 128 } }, dir);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /codigo 128/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
