/**
 * A ponte estoque -> TikTok Shop.
 *
 * O que estes casos protegem sao os tres jeitos de vender errado sem ninguem
 * perceber: mandar o preco errado, mandar estoque que ja tem dono, e criar o
 * mesmo produto duas vezes na loja.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { paraTiktok, precoParaTiktok, estoqueParaTiktok, jaPublicado, registrarPublicado } from '../engine/vstiktok/ponte.mjs';

const base = {
  sku: 'cadeira-gamer', nome: 'Cadeira Gamer', descricao: 'Cadeira com apoio lombar',
  precoCentavos: 89900, precoPromocionalCentavos: null, moeda: 'BRL',
  quantidade: 10, reservado: 0, marca: 'Veloso',
};
const cfg = { categoriaId: '600001', armazemId: 'W1', imagensUri: ['tos://img1'] };

/* ---- preco ---- */

test('sem promocao vai o preco cheio', () => {
  assert.equal(precoParaTiktok(base).centavos, 89900);
  assert.equal(precoParaTiktok(base).aviso, null);
});

test('com promocao vai o VIGENTE — e avisa que la nao tem data de fim', () => {
  const p = precoParaTiktok({ ...base, precoPromocionalCentavos: 69900 });
  assert.equal(p.centavos, 69900, 'mandar o cheio faria o cliente da TikTok pagar mais que o do site');
  assert.match(p.aviso, /nao guarda data de fim|não guarda data de fim/);
});

test('promocao maior que o preco cheio e ignorada — nao e promocao', () => {
  assert.equal(precoParaTiktok({ ...base, precoPromocionalCentavos: 99900 }).centavos, 89900);
});

/* ---- estoque ---- */

test('vai o DISPONIVEL, nunca o bruto — reservado ja tem dono', () => {
  assert.equal(estoqueParaTiktok({ quantidade: 10, reservado: 3 }), 7);
});

test('reservado maior que a quantidade nao vira estoque negativo', () => {
  assert.equal(estoqueParaTiktok({ quantidade: 2, reservado: 5 }), 0);
});

test('esgotado NAO e erro — apagar e recriar perderia avaliacao e historico', () => {
  const r = paraTiktok({ ...base, quantidade: 0 }, cfg);
  assert.equal(r.erros.length, 0);
  assert.equal(r.produto.skus[0].estoque, 0);
  assert.match(r.avisos.join(' '), /sem poder ser vendido/);
});

test('quando ha reserva, o aviso diz quantas ficaram de fora', () => {
  const r = paraTiktok({ ...base, reservado: 3 }, cfg);
  assert.equal(r.produto.skus[0].estoque, 7);
  assert.match(r.avisos.join(' '), /3 unidade/);
});

/* ---- o que so a TikTok exige ---- */

test('sem categoria da TikTok, recusa com frase de gente', () => {
  const r = paraTiktok(base, { ...cfg, categoriaId: '' });
  assert.equal(r.produto, null);
  assert.match(r.erros.join(' '), /categoria da TikTok/);
  assert.doesNotMatch(r.erros.join(' '), /\d{5}/, 'nada de codigo cru da API');
});

test('sem armazem, recusa — e dele que sai o estoque', () => {
  assert.match(paraTiktok(base, { ...cfg, armazemId: '' }).erros.join(' '), /armazém|armazem/);
});

test('sem imagem enviada, recusa antes de chamar a API', () => {
  assert.match(paraTiktok(base, { ...cfg, imagensUri: [] }).erros.join(' '), /imagem/);
});

test('sem descricao usa o nome, mas avisa que vende menos', () => {
  const r = paraTiktok({ ...base, descricao: '' }, cfg);
  assert.equal(r.produto.descricao, 'Cadeira Gamer');
  assert.match(r.avisos.join(' '), /vende menos/);
});

test('o payload sai no formato que o normalizador da Shop espera', () => {
  const r = paraTiktok(base, cfg);
  assert.equal(r.produto.titulo, 'Cadeira Gamer');
  assert.equal(r.produto.moeda, 'BRL');
  assert.deepEqual(r.produto.imagens, ['tos://img1']);
  assert.equal(r.produto.skus[0].armazemId, 'W1');
  assert.equal(r.produto.skus[0].preco, 89900);
});

/* ---- publicar duas vezes ---- */

test('republicar vira EDICAO — senao a loja fica com dois produtos iguais', () => {
  let mapa = {};
  assert.equal(jaPublicado(mapa, 'cadeira-gamer'), null);
  mapa = registrarPublicado(mapa, 'cadeira-gamer', 'TK-777', '2026-09-22T10:00:00.000Z');
  const achado = jaPublicado(mapa, 'cadeira-gamer');
  assert.equal(achado.produtoId, 'TK-777');
  assert.equal(achado.em, '2026-09-22T10:00:00.000Z');
});

test('SKU diferente e produto diferente', () => {
  const mapa = registrarPublicado({}, 'cadeira-gamer', 'TK-777');
  assert.equal(jaPublicado(mapa, 'mesa-gamer'), null);
});
