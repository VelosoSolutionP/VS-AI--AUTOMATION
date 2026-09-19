import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerRecibo, auditarRepo, auditar, VALIDADE_MIN } from '../engine/vspainel/auditor.mjs';

const AGORA = Date.parse('2026-09-19T12:00:00.000Z');
const raiz = mkdtempSync(join(tmpdir(), 'vspainel-'));
process.on('exit', () => rmSync(raiz, { recursive: true, force: true }));

/** Cria um repo falso com .git e, se pedido, um recibo dentro. */
function repoFalso(nome, recibo) {
  const dir = join(raiz, nome);
  mkdirSync(join(dir, '.git'), { recursive: true });
  if (recibo !== undefined) {
    writeFileSync(join(dir, '.git', 'qa-gate-green.json'), typeof recibo === 'string' ? recibo : JSON.stringify(recibo));
  }
  return dir;
}

const ctx = (branch) => ({ branch, ultimaEdicao: 0 });

test('recibo verde, na branch certa e fresco é VALIDO', () => {
  const dir = repoFalso('bom', { status: 'green', branch: 'fix/1', ts: AGORA - 5 * 60000 });
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, ctx('fix/1'));
  assert.equal(r.valido, true);
  assert.equal(r.idadeMin, 5);
  assert.equal(r.motivo, null);
});

test('recibo de OUTRA branch nao vale — é o engano mais comum', () => {
  const dir = repoFalso('outra', { status: 'green', branch: 'fix/999', ts: AGORA - 60000 });
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, ctx('fix/1'));
  assert.equal(r.valido, false);
  assert.match(r.motivo, /branch "fix\/999", a atual é "fix\/1"/);
});

test('recibo velho nao vale, e o motivo diz a idade', () => {
  const dir = repoFalso('velho', { status: 'green', branch: 'fix/1', ts: AGORA - 45 * 60000 });
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, ctx('fix/1'));
  assert.equal(r.valido, false);
  assert.match(r.motivo, new RegExp(`45 min de idade \\(vale ${VALIDADE_MIN}\\)`));
});

test('status diferente de green nao vale', () => {
  const dir = repoFalso('vermelho', { status: 'red', branch: 'fix/1', ts: AGORA });
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, ctx('fix/1'));
  assert.equal(r.valido, false);
  assert.match(r.motivo, /status "red"/);
});

test('edicao DEPOIS do gate invalida o verde — o recibo nao se invalida sozinho', () => {
  const dir = repoFalso('editado', { status: 'green', branch: 'fix/1', ts: AGORA - 60000 });
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, { branch: 'fix/1', ultimaEdicao: AGORA - 30000 });
  assert.equal(r.valido, false);
  assert.match(r.motivo, /edição DEPOIS do gate/);
});

test('varios problemas aparecem juntos, nao so o primeiro', () => {
  const dir = repoFalso('ruim', { status: 'red', branch: 'outra', ts: AGORA - 90 * 60000 });
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, ctx('fix/1'));
  assert.ok(r.motivo.includes('status'));
  assert.ok(r.motivo.includes('branch'));
  assert.ok(r.motivo.includes('idade'));
});

test('recibo ausente nao é erro — é "nunca rodou"', () => {
  const dir = repoFalso('sem-recibo');
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, ctx('fix/1'));
  assert.equal(r.existe, false);
  assert.equal(r.valido, undefined);
});

test('JSON corrompido vira motivo legivel, nao excecao', () => {
  const dir = repoFalso('corrompido', '{isso nao é json');
  const r = lerRecibo(dir, 'qa-gate-green.json', AGORA, ctx('fix/1'));
  assert.equal(r.existe, true);
  assert.equal(r.valido, false);
  assert.match(r.motivo, /ilegível/);
});

test('"nunca rodou" é diferente de "vencido"', () => {
  const nunca = auditarRepo(repoFalso('n1'), AGORA);
  assert.equal(nunca.situacao, 'nunca rodou');
  const venceu = auditarRepo(repoFalso('v1', { status: 'green', branch: 'x', ts: AGORA - 99 * 60000 }), AGORA);
  assert.equal(venceu.situacao, 'vencido');
  assert.equal(venceu.verde, false);
});

test('caminho que nao é repositorio git é reportado, nao ignorado', () => {
  const r = auditarRepo(join(raiz, 'nao-existe'), AGORA);
  assert.equal(r.existe, false);
  assert.match(r.motivo, /não é um repositório git/);
});

test('auditar conta cada situacao separadamente', () => {
  const r = auditar([
    repoFalso('a1', { status: 'green', branch: null, ts: AGORA }),
    repoFalso('a2', { status: 'green', branch: null, ts: AGORA - 99 * 60000 }),
    repoFalso('a3'),
    join(raiz, 'fantasma'),
  ], AGORA);
  assert.equal(r.total, 4);
  assert.equal(r.verdes, 1);
  assert.equal(r.vencidos, 1);
  assert.equal(r.nuncaRodaram, 1);
  assert.equal(r.quebrados, 1);
});
