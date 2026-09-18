import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicar, alertas, valorEmEstoque, TIPOS } from '../engine/vsestoque/saldo.mjs';

const p = (quantidade, reservado = 0) => ({ sku: 'x', nome: 'X', quantidade, reservado });
const em = () => '2026-09-18T00:00:00.000Z';

test('entrada soma ao saldo', () => {
  const r = aplicar(p(10), { tipo: 'entrada', quantidade: 5 }, em);
  assert.equal(r.produto.quantidade, 15);
  assert.equal(r.erro, null);
});

test('reserva nao muda o saldo, muda o que esta livre', () => {
  const r = aplicar(p(10), { tipo: 'reserva', quantidade: 4 }, em);
  assert.equal(r.produto.quantidade, 10, 'a peça continua na prateleira');
  assert.equal(r.produto.reservado, 4);
});

test('nao da pra reservar alem do livre — dois clientes levariam a mesma peça', () => {
  const r = aplicar(p(10, 8), { tipo: 'reserva', quantidade: 3 }, em);
  assert.equal(r.produto, null);
  assert.match(r.erro, /só há 2 livre/);
});

test('saida nao pode comer o que ja esta prometido a alguem', () => {
  const r = aplicar(p(10, 8), { tipo: 'saida', quantidade: 5 }, em);
  assert.match(r.erro, /só há 2 livre\(s\) \(10 em estoque, 8 reservado/);
});

test('venda consome a reserva e o saldo juntos', () => {
  const r = aplicar(p(10, 8), { tipo: 'vender', quantidade: 8 }, em);
  assert.equal(r.produto.quantidade, 2);
  assert.equal(r.produto.reservado, 0);
});

test('venda maior que a reserva tira o resto do saldo livre', () => {
  const r = aplicar(p(10, 3), { tipo: 'vender', quantidade: 5 }, em);
  assert.equal(r.produto.quantidade, 5);
  assert.equal(r.produto.reservado, 0);
});

test('venda acima do estoque é recusada', () => {
  assert.match(aplicar(p(3), { tipo: 'vender', quantidade: 4 }, em).erro, /há 3 em estoque/);
});

test('liberar devolve pra prateleira, e so o que estava reservado', () => {
  assert.equal(aplicar(p(10, 4), { tipo: 'liberar', quantidade: 4 }, em).produto.reservado, 0);
  assert.match(aplicar(p(10, 4), { tipo: 'liberar', quantidade: 9 }, em).erro, /só há 4 reservado/);
});

test('ajuste abaixo do reservado encolhe a reserva — senao o disponivel ficaria negativo', () => {
  const r = aplicar(p(10, 8), { tipo: 'ajuste', quantidade: 3 }, em);
  assert.equal(r.produto.quantidade, 3);
  assert.equal(r.produto.reservado, 3, 'o que foi prometido e nao existe mais deixa de estar reservado');
});

test('ajuste aceita zero (contagem que zerou a prateleira é informacao real)', () => {
  const r = aplicar(p(10), { tipo: 'ajuste', quantidade: 0 }, em);
  assert.equal(r.erro, null);
  assert.equal(r.produto.quantidade, 0);
});

test('os outros tipos recusam zero e negativo', () => {
  assert.match(aplicar(p(10), { tipo: 'entrada', quantidade: 0 }, em).erro, /maior que zero/);
  assert.match(aplicar(p(10), { tipo: 'entrada', quantidade: -3 }, em).erro, /maior que zero/);
  assert.match(aplicar(p(10), { tipo: 'ajuste', quantidade: -1 }, em).erro, /não pode ser negativo/);
});

test('quantidade fracionada é recusada', () => {
  assert.match(aplicar(p(10), { tipo: 'entrada', quantidade: 1.5 }, em).erro, /inteiro/);
});

test('tipo desconhecido lista os validos', () => {
  const r = aplicar(p(10), { tipo: 'sumiu', quantidade: 1 }, em);
  assert.match(r.erro, /tipo desconhecido/);
  for (const t of TIPOS) { assert.ok(r.erro.includes(t)); }
});

test('produto inexistente nao lanca', () => {
  assert.match(aplicar(null, { tipo: 'entrada', quantidade: 1 }, em).erro, /não encontrado/);
});

test('o movimento guarda de onde veio e pra onde foi', () => {
  const r = aplicar(p(10, 2), { tipo: 'entrada', quantidade: 5, motivo: 'nota 123' }, em);
  assert.deepEqual(r.movimento.de, { quantidade: 10, reservado: 2 });
  assert.deepEqual(r.movimento.para, { quantidade: 15, reservado: 2 });
  assert.equal(r.movimento.motivo, 'nota 123');
  assert.equal(r.movimento.em, '2026-09-18T00:00:00.000Z');
});

test('alerta separa "acabou" de "abaixo do minimo"', () => {
  const a = alertas([
    { sku: 'a', nome: 'A', quantidade: 0, reservado: 0 },
    { sku: 'b', nome: 'B', quantidade: 10, reservado: 8, minimo: 3 },
    { sku: 'c', nome: 'C', quantidade: 50, reservado: 0, minimo: 3 },
    { sku: 'd', nome: 'D', quantidade: 0, ativo: false },
  ]);
  assert.equal(a.length, 2);
  assert.equal(a[0].nivel, 'acabou');
  assert.equal(a[1].nivel, 'baixo', 'conta o LIVRE (2), não a quantidade (10)');
  assert.ok(!a.some((x) => x.sku === 'd'), 'inativo nao alerta');
});

test('valor em estoque soma quantidade x preco', () => {
  assert.equal(valorEmEstoque([{ quantidade: 3, precoCentavos: 1000 }, { quantidade: 2, precoCentavos: 500 }]), 4000);
  assert.equal(valorEmEstoque([]), 0);
});
