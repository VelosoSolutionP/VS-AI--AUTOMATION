/**
 * Limite de produtos por plano. Regra comercial: bronze 20, prata 50, ouro sem
 * teto de itens. O que estes casos protegem é o cliente — de descobrir o limite
 * tentando cadastrar, e de ser bloqueado por uma falha nossa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planoDe, cabeMais, uso, PLANOS } from '../engine/vsestoque/plano.mjs';

test('reconhece o plano no nome escrito por gente', () => {
  assert.equal(planoDe('bronze').limite, 20);
  assert.equal(planoDe('Plano Prata').limite, 50);
  assert.equal(planoDe('  OURO ').limite, null);
  assert.equal(planoDe('Suíte Ouro Anual').chave, 'ouro');
});

test('plano desconhecido NAO bloqueia — nao punir cliente por falha nossa', () => {
  assert.equal(cabeMais(9999, 'plano que nao existe').ok, true);
  assert.equal(cabeMais(9999, '').ok, true);
  assert.equal(cabeMais(9999, null).ok, true);
});

test('bronze trava no 20', () => {
  assert.equal(cabeMais(19, 'bronze').ok, true);
  assert.equal(cabeMais(19, 'bronze').restam, 1);
  const cheio = cabeMais(20, 'bronze');
  assert.equal(cheio.ok, false);
  assert.match(cheio.motivo, /Bronze permite 20/);
  assert.match(cheio.motivo, /Desative um|amplie/, 'tem de dizer o que fazer, nao so que nao pode');
});

test('prata trava no 50', () => {
  assert.equal(cabeMais(49, 'prata').ok, true);
  assert.equal(cabeMais(50, 'prata').ok, false);
});

test('ouro nao trava por quantidade', () => {
  assert.equal(cabeMais(5000, 'ouro').ok, true);
  assert.equal(cabeMais(5000, 'ouro').limite, null);
});

test('a tela avisa ANTES de encher', () => {
  assert.equal(uso(10, 'bronze').alerta, null);
  assert.equal(uso(16, 'bronze').alerta, 'quase cheio', '80% ja merece aviso');
  assert.equal(uso(20, 'bronze').alerta, 'cheio');
  assert.equal(uso(20, 'bronze').restam, 0);
  assert.equal(uso(12, 'bronze').texto, '12 de 20 (plano Bronze)');
});

test('ouro mostra que nao tem teto, em vez de numero inventado', () => {
  const u = uso(900, 'ouro');
  assert.equal(u.limite, null);
  assert.match(u.texto, /sem teto/);
});

test('os tres planos estao declarados num lugar so', () => {
  assert.deepEqual(Object.keys(PLANOS), ['bronze', 'prata', 'ouro']);
});
