/**
 * Login por e-mail + senha, convite e separação admin × cliente.
 * O que protege: cliente nunca vira admin; link de convite é de uso único;
 * a senha antiga do console continua entrando como admin; senha nunca em claro.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'usuarios-'));
process.env.VSUSUARIOS_DIR = dir;
process.env.VSCONSOLE_ACESSO = join(dir, 'acesso.json');
process.env.CONSOLE_ADMIN_EMAIL = 'dono@exemplo.com';
delete process.env.CRM_TOKEN;
const acesso = await import('../backend/acesso.mjs');
const U = await import('../backend/usuarios.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('admin entra com o e-mail dele e a senha que o console ja tinha', () => {
  acesso.criar('senha-do-dono-123');
  const r = U.entrar('DONO@exemplo.com ', 'senha-do-dono-123');
  assert.equal(r.ok, true);
  assert.equal(r.papel, 'admin');
  assert.equal(U.autenticar(r.token).papel, 'admin');
  assert.equal(U.entrar('dono@exemplo.com', 'errada').ok, false);
});

test('a senha antiga no lugar do token (aba ja aberta) continua valendo como admin', () => {
  assert.equal(U.autenticar('senha-do-dono-123').papel, 'admin');
  assert.equal(U.autenticar('chute'), null);
});

let convite;
test('convite: link de uso unico cria o usuario do cliente, com papel cliente', () => {
  convite = U.convidar({ email: 'Cliente@Loja.com', clienteId: 'cli_1', nome: 'Maria Loja' });
  assert.equal(convite.ok, true);
  assert.equal(U.lerConvite(convite.token).email, 'cliente@loja.com');
  assert.match(U.aceitarConvite(convite.token, 'curta').motivo, /8 caracteres/);
  const r = U.aceitarConvite(convite.token, 'senha-da-maria');
  assert.equal(r.ok, true);
  assert.equal(r.papel, 'cliente');
  assert.equal(U.autenticar(r.token).clienteId, 'cli_1');
  assert.equal(U.aceitarConvite(convite.token, 'outra-senha-1').ok, false, 'link usado nao abre de novo');
});

test('cliente entra com e-mail + senha e NUNCA vira admin', () => {
  const r = U.entrar('cliente@loja.com', 'senha-da-maria');
  assert.equal(r.ok, true);
  assert.equal(r.papel, 'cliente');
  assert.equal(U.entrar('cliente@loja.com', 'senha-do-dono-123').ok, false);
  assert.equal(U.convidar({ email: 'dono@exemplo.com', clienteId: 'cli_x' }).ok, false, 'ninguem recebe convite com o e-mail do admin');
});

test('mesma mensagem pra e-mail inexistente e senha errada — nao entrega quem e cliente', () => {
  assert.equal(U.entrar('ninguem@x.com', 'qualquer-1').motivo, U.entrar('cliente@loja.com', 'errada-123').motivo);
});

test('e-mail de um cliente nao pode ser tomado por outro cliente', () => {
  assert.equal(U.convidar({ email: 'cliente@loja.com', clienteId: 'cli_2' }).ok, false);
  assert.equal(U.convidar({ email: 'cliente@loja.com', clienteId: 'cli_1' }).ok, true, 'o proprio cliente pode receber link novo');
});

test('sair encerra a sessao; senha e token nunca ficam em claro no disco', () => {
  const r = U.entrar('cliente@loja.com', 'senha-da-maria');
  U.sair(r.token);
  assert.equal(U.autenticar(r.token), null);
  const disco = readFileSync(join(dir, 'usuarios.json'), 'utf8') + readFileSync(join(dir, 'sessoes.json'), 'utf8') + readFileSync(join(dir, 'convites.json'), 'utf8');
  assert.ok(!disco.includes('senha-da-maria') && !disco.includes(r.token));
});

test('reenviar o convite NAO derruba o link que o cliente ja tem; criar a senha derruba todos', () => {
  const a = U.convidar({ email: 'reenvio@loja.com', clienteId: 'cli_reenvio', nome: 'Rita' });
  const b = U.convidar({ email: 'reenvio@loja.com', clienteId: 'cli_reenvio', nome: 'Rita' });
  assert.equal(U.lerConvite(a.token).ok, true, 'o link de minutos atras continua abrindo');
  assert.equal(U.aceitarConvite(a.token, 'senha-da-rita-1').ok, true);
  assert.equal(U.lerConvite(b.token).ok, false, 'senha criada: os outros links do cliente morrem');
  assert.equal(U.lerConvite(b.token).usado, true, 'e a tela diz "pode entrar", nao "vencido"');
  assert.equal(U.lerConvite('token-que-nunca-existiu').usado, undefined);
});

test('esqueci a senha (cliente): link de 1 h troca a senha, derruba sessoes e morre depois de usado', () => {
  const velha = U.entrar('reenvio@loja.com', 'senha-da-rita-1');
  assert.equal(U.pedirRedefinicao('ninguem@x.com').ok, false, 'e-mail sem conta nao gera link');
  const p = U.pedirRedefinicao(' REENVIO@loja.com');
  assert.equal(p.ok, true);
  assert.equal(U.lerRedefinicao(p.token).email, 'reenvio@loja.com');
  assert.match(U.redefinirSenha(p.token, 'curta').motivo, /8 caracteres/);
  const r = U.redefinirSenha(p.token, 'nova-da-rita-99');
  assert.equal(r.ok, true);
  assert.equal(r.papel, 'cliente');
  assert.equal(U.autenticar(velha.token), null, 'sessao aberta com a senha velha cai');
  assert.equal(U.entrar('reenvio@loja.com', 'senha-da-rita-1').ok, false);
  assert.equal(U.entrar('reenvio@loja.com', 'nova-da-rita-99').ok, true);
  assert.equal(U.redefinirSenha(p.token, 'outra-senha-00').ok, false, 'link usado nao abre de novo');
  assert.ok(!readFileSync(join(dir, 'redefinicoes.json'), 'utf8').includes(p.token), 'token nunca em claro');
});

test('esqueci a senha (dono): o link troca a senha do console', () => {
  const p = U.pedirRedefinicao('dono@exemplo.com');
  assert.equal(p.ok, true);
  const r = U.redefinirSenha(p.token, 'dono-nova-senha-1');
  assert.equal(r.papel, 'admin');
  assert.equal(U.entrar('dono@exemplo.com', 'senha-do-dono-123').ok, false);
  assert.equal(U.entrar('dono@exemplo.com', 'dono-nova-senha-1').ok, true);
});

test('trocar a senha logado exige a atual — dono e cliente', () => {
  assert.equal(U.trocarSenha('reenvio@loja.com', 'errada-123', 'x-nova-senha-1').code, 401);
  assert.equal(U.trocarSenha('reenvio@loja.com', 'nova-da-rita-99', 'rita-trocada-1').ok, true);
  assert.equal(U.entrar('reenvio@loja.com', 'rita-trocada-1').ok, true);
  assert.equal(U.trocarSenha('dono@exemplo.com', 'errada-123', 'x-nova-senha-1').code, 401);
  assert.equal(U.trocarSenha('dono@exemplo.com', 'dono-nova-senha-1', 'dono-trocada-22').ok, true);
  assert.equal(U.entrar('dono@exemplo.com', 'dono-trocada-22').ok, true);
});
