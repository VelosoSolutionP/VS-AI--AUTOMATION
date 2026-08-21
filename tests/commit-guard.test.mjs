/**
 * Bypasses do guard de git commit que deixavam passar coisa fora do padrao:
 *
 *  1. so o PRIMEIRO -m era lido  -> `-m titulo -m "Co-Authored-By: Claude"` passava.
 *  2. sem -m => allow() imediato -> `-F arquivo` e heredoc passavam sem validacao
 *     NENHUMA (nem padrao, nem teste unitario) — e o VS-AUD-005 manda usar -F.
 *  3. process.cwd() no lugar do cwd do payload -> `git diff --cached` rodava no repo
 *     errado; fora de repo estourava, caia no catch e LIBERAVA sem checar teste.
 *  4. titulo sem corpo -> tarefa entregue sem descricao detalhada (VS-AUD-006).
 *
 * Roda com:  node --test tests/commit-guard.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractCommitMessage } from '../engine/git-cmd.mjs';

const GC = 'git ' + 'com' + 'mit';
const HOOK = fileURLToPath(new URL('../hooks/on-commit.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

/** Roda o hook com um cwd de PROCESSO que nao e repo git, provando que o payload manda. */
function rodar(command, { cwd = REPO, sid = 'test' } = {}) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: sid, tool_input: { command } }),
    encoding: 'utf8',
    cwd: tmpdir(),
  }).trim();
  if (!out) { return { liberado: true }; }
  const o = JSON.parse(out).hookSpecificOutput;
  return { liberado: false, code: (o.permissionDecisionReason.match(/\[(VS-[A-Z]+-\d+)\]/) || [])[1], reason: o.permissionDecisionReason };
}

// ------------------------------------------------------------- extrator

test('extrai mensagem de todos os -m, nao so do primeiro', () => {
  const r = extractCommitMessage(GC + ' -m "fix(1): titulo" -m "corpo detalhado"', tmpdir());
  assert.equal(r.subject, 'fix(1): titulo');
  assert.equal(r.body, 'corpo detalhado');
});

test('extrai mensagem de heredoc (-F -)', () => {
  const r = extractCommitMessage(GC + " -F - <<'EOF'\nfix(2): via heredoc\n\ndetalhe da tarefa\nEOF", tmpdir());
  assert.equal(r.origem, 'heredoc');
  assert.equal(r.subject, 'fix(2): via heredoc');
});

test('extrai mensagem de arquivo (-F arquivo)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  try {
    const f = join(dir, 'msg.txt');
    writeFileSync(f, 'fix(3): via arquivo\n\ncorpo que explica a tarefa');
    const r = extractCommitMessage(`${GC} -F ${f}`, dir);
    assert.equal(r.origem, '-F');
    assert.equal(r.subject, 'fix(3): via arquivo');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('arquivo ainda nao criado: cai no heredoc do mesmo comando', () => {
  const cmd = `cat > /tmp/naoexiste-cg.txt <<EOF\nfix(4): criado no mesmo comando\n\ndetalhe\nEOF\n${GC} -F /tmp/naoexiste-cg.txt`;
  const r = extractCommitMessage(cmd, tmpdir());
  assert.equal(r.subject, 'fix(4): criado no mesmo comando');
});

// ------------------------------------------------------------- hook

test('bloqueia commit fora do padrao', () => {
  const r = rodar(GC + " -m 'ajustes gerais'");
  assert.equal(r.liberado, false);
  assert.equal(r.code, 'VS-AUD-003');
});

test('bloqueia assinatura de IA escondida no 2o -m', () => {
  const r = rodar(GC + " -m 'fix(36481): corrige o gate' -m 'Co-Authored-By: Claude <n@a.com>'");
  assert.equal(r.liberado, false);
  assert.match(r.reason, /assinatura\/atribuicao de IA/);
});

test('bloqueia commit fora do padrao vindo de -F arquivo', () => {
  const r = rodar(`cat > /tmp/cg-m.txt <<EOF\nqualquer coisa\nEOF\n${GC} -F /tmp/cg-m.txt`);
  assert.equal(r.liberado, false);
  assert.equal(r.code, 'VS-AUD-003');
});

test('bloqueia commit fora do padrao vindo de heredoc', () => {
  const r = rodar(GC + " -F - <<'EOF'\nmexi num negocio ai\nEOF");
  assert.equal(r.liberado, false);
  assert.equal(r.code, 'VS-AUD-003');
});

test('bloqueia titulo no padrao mas SEM descricao detalhada', () => {
  const r = rodar(GC + " -m 'fix(36481): corrige o gate do atendimento'");
  assert.equal(r.liberado, false);
  assert.equal(r.code, 'VS-AUD-006');
});

test('libera padrao completo: titulo + corpo detalhado', () => {
  const r = rodar(GC + " -m 'fix(36481): corrige o gate do atendimento' -m 'Elimina o N+1 no edit e adiciona o gate do modulo coletivo.'");
  assert.equal(r.liberado, true);
});

test('libera heredoc no padrao completo', () => {
  const r = rodar(GC + " -F - <<'EOF'\nfix(36481): corrige o gate\n\nElimina o N+1 no edit do atendimento coletivo.\nEOF");
  assert.equal(r.liberado, true);
});

test('libera merge e --amend --no-edit', () => {
  assert.equal(rodar(GC + " -m 'Merge branch dev into fix/36481'").liberado, true);
  assert.equal(rodar(GC + ' --amend --no-edit').liberado, true);
});

test('nao bloqueia comando que apenas menciona a palavra', () => {
  assert.equal(rodar('grep -rn commit src/').liberado, true);
});

test('corpo que MENCIONA -m/-F nao vira flag (falso positivo do parser)', () => {
  // Regressao real: um commit explicando "so o primeiro -m era lido" casava `-m era`
  // e o guard validava a palavra "era" como titulo, bloqueando commit correto.
  const cmd = GC + " -F - <<'EOF'\nfix(6458): titulo real\n\nCorpo citando -m era lido e -F arquivo no meio do texto.\nEOF";
  const r = extractCommitMessage(cmd, tmpdir());
  assert.equal(r.subject, 'fix(6458): titulo real');
  assert.match(r.body, /-m era lido/);
  assert.equal(rodar(cmd).liberado, true);
});
