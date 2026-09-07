/**
 * Opt-out .qa-gate-off: dois hooks ignoravam o desligamento.
 *
 *  - on-doc: em pasta com governanca OFF o push ainda abria pendencia de documentacao
 *    e disparava recibo de entrega — travava a proxima branch por uma tarefa que nao
 *    existe.
 *  - on-session: despejava as regras de gate/recibo numa sessao so de exploracao, e o
 *    modelo passava a exigir branch/gate/commit sem tarefa aberta.
 *
 * Roda com:  node --test tests/optout.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = fileURLToPath(new URL('../hooks/', import.meta.url));

function repoTemp({ off }) {
  const dir = mkdtempSync(join(tmpdir(), 'optout-'));
  execFileSync('git', ['init', '-q', '-b', 'fix/fabiano.veloso/999'], { cwd: dir });
  if (off) { writeFileSync(join(dir, '.qa-gate-off'), 'teste'); }
  return dir;
}

function rodar(hook, payload, cwd) {
  return execFileSync(process.execPath, [join(HOOKS, hook)], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd,
  }).trim();
}

test('on-doc: com .qa-gate-off o push nao abre pendencia de doc', () => {
  const dir = repoTemp({ off: true });
  try {
    const out = rodar('on-doc.mjs', {
      cwd: dir,
      tool_input: { command: 'git ' + 'push' + ' origin fix/fabiano.veloso/999' },
      tool_response: { stdout: 'Everything up-to-date', exit_code: 0 },
    }, dir);
    assert.equal(out, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('on-doc: SEM .qa-gate-off o push continua cobrando doc', () => {
  const dir = repoTemp({ off: false });
  try {
    const out = rodar('on-doc.mjs', {
      cwd: dir,
      tool_input: { command: 'git ' + 'push' + ' origin fix/fabiano.veloso/999' },
      tool_response: { stdout: 'Everything up-to-date', exit_code: 0 },
    }, dir);
    assert.match(out, /VS-DOC-00[01]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('on-session: .qa-gate-off avisa que esta OFF em vez de mandar as regras', () => {
  const dir = repoTemp({ off: true });
  try {
    const out = rodar('on-session.mjs', {}, dir);
    assert.match(out, /DESLIGADA nesta pasta/);
    assert.doesNotMatch(out, /Governança ATIVA/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('on-session: sem o arquivo, governanca segue ativa', () => {
  const dir = repoTemp({ off: false });
  try {
    assert.match(rodar('on-session.mjs', {}, dir), /Governança ATIVA/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
