/**
 * Acesso ao console. O que estes testes guardam é o que dá errado na vida real:
 * console que sobe só com senha de ambiente e deixa o dono de fora, e "primeiro
 * acesso" que continua aberto depois de configurado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'acesso-'));
process.env.VSCONSOLE_ACESSO = join(dir, 'acesso.json');
delete process.env.CRM_TOKEN;

const a = await import('../backend/acesso.mjs');

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('sem nada definido, o console pede pra CRIAR a senha', () => {
  assert.equal(a.precisaCriar(), true);
  assert.equal(a.confere('qualquer coisa'), false);
});

test('senha curta é recusada nos tres caminhos', () => {
  for (const f of [a.criar, a.definir]) {
    assert.throws(() => f('1234'), /pelo menos/);
  }
});

test('criada, a senha entra e o arquivo nasce 0600', () => {
  a.criar('senha-do-console-1');
  assert.equal(a.confere('senha-do-console-1'), true);
  assert.equal(a.confere('senha-do-console-2'), false);
  assert.equal(a.precisaCriar(), false);
  assert.equal(statSync(process.env.VSCONSOLE_ACESSO).mode & 0o777, 0o600);
});

test('primeiro acesso FECHA depois de configurado — ninguem redefine pela rede', () => {
  assert.throws(() => a.criar('outra-senha-qualquer'), /ja tem uma senha|já tem uma senha/);
  assert.equal(a.confere('senha-do-console-1'), true);
});

test('trocar exige a atual', () => {
  assert.throws(() => a.trocar('errada', 'nova-senha-boa-1'), /incorreta/);
  a.trocar('senha-do-console-1', 'nova-senha-boa-1');
  assert.equal(a.confere('nova-senha-boa-1'), true);
  assert.equal(a.confere('senha-do-console-1'), false);
});

test('definir repoe o acesso sem a senha atual — o caminho de "perdi"', () => {
  a.definir('recuperada-na-maquina-1');
  assert.equal(a.confere('recuperada-na-maquina-1'), true);
  assert.equal(a.confere('nova-senha-boa-1'), false);
});

test('a senha do ambiente continua valendo JUNTO com a da tela', () => {
  process.env.CRM_TOKEN = 'token-de-ambiente-antigo';
  try {
    assert.equal(a.confere('token-de-ambiente-antigo'), true, 'quem ja subia com CRM_TOKEN nao pode ser trancado pra fora');
    assert.equal(a.confere('recuperada-na-maquina-1'), true, 'a da tela tambem entra');
    assert.equal(a.confere('nenhuma-das-duas'), false);
    assert.equal(a.estado().porAmbiente, true, 'a tela precisa poder avisar que o ambiente manda');
  } finally { delete process.env.CRM_TOKEN; }
});
