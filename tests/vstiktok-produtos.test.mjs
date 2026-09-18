import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarProduto, centavosParaDecimal, criar, editar, buscar,
  ativar, desativar, excluir, atualizarEstoque, atualizarPreco,
} from '../engine/vstiktok/produtos.mjs';

const ctx = (cap = {}, corpo = { code: 0, data: { product_id: 'P1' } }) => ({
  token: 't', appKey: 'ak', appSecret: 'as', shopCipher: 'cipher',
  fetchImpl: async (url, opts) => { cap.url = url; cap.opts = opts; cap.chamou = true; return { status: 200, json: async () => corpo }; },
});

const valido = {
  titulo: 'Camiseta Veloso',
  descricao: '<p>Algodão</p>',
  categoriaId: '600001',
  moeda: 'BRL',
  imagens: ['uri-1'],
  peso: { valor: 300, unidade: 'GRAM' },
  skus: [{ sku: 'CAM-P', preco: 'R$ 79,90', estoque: 10, armazemId: 'W1' }],
};

test('produto valido vira payload com preco decimal em string', () => {
  const { produto, erros } = normalizarProduto(valido);
  assert.deepEqual(erros, []);
  assert.equal(produto.title, 'Camiseta Veloso');
  assert.equal(produto.skus[0].price.amount, '79.90');
  assert.equal(produto.skus[0].price.currency, 'BRL');
  assert.equal(produto.skus[0].inventory[0].warehouse_id, 'W1');
  assert.deepEqual(produto.main_images, [{ uri: 'uri-1' }]);
});

test('centavos viram decimal com 2 casas, sempre', () => {
  assert.equal(centavosParaDecimal(7990), '79.90');
  assert.equal(centavosParaDecimal(5), '0.05');
  assert.equal(centavosParaDecimal('x'), null);
});

test('erro aponta O CAMPO, em portugues — a Shop API so devolve codigo generico', () => {
  const { produto, erros } = normalizarProduto({});
  assert.equal(produto, null);
  assert.ok(erros.some((e) => /título é obrigatório/.test(e)));
  assert.ok(erros.some((e) => /categoriaId/.test(e)));
  assert.ok(erros.some((e) => /moeda inválida/.test(e)));
  assert.ok(erros.some((e) => /imagem/.test(e)));
  assert.ok(erros.some((e) => /ao menos 1 SKU/.test(e)));
});

test('SKU ruim diz qual SKU errou', () => {
  const { erros } = normalizarProduto({
    ...valido,
    skus: [
      { sku: 'A', preco: 'R$ 10,00', estoque: 1, armazemId: 'W1' },
      { sku: 'B', preco: 'de graça', estoque: -3, armazemId: '' },
    ],
  });
  assert.ok(erros.some((e) => /SKU 2: preço inválido/.test(e)));
  assert.ok(erros.some((e) => /SKU 2: estoque/.test(e)));
  assert.ok(erros.some((e) => /SKU 2: armazemId/.test(e)));
  assert.ok(!erros.some((e) => /SKU 1/.test(e)));
});

test('preco zero é recusado — produto de graca na vitrine é prejuizo, nao promocao', () => {
  const { erros } = normalizarProduto({ ...valido, skus: [{ ...valido.skus[0], preco: 0 }] });
  assert.ok(erros.some((e) => /maior que zero/.test(e)));
});

test('titulo acima do limite da TikTok é barrado aqui, nao na API', () => {
  const { erros } = normalizarProduto({ ...valido, titulo: 'x'.repeat(256) });
  assert.ok(erros.some((e) => /255 caracteres/.test(e)));
});

test('produto invalido NAO vira chamada de API', async () => {
  const cap = {};
  const r = await criar(ctx(cap), { titulo: 'so isso' });
  assert.equal(cap.chamou, undefined, 'gastou chamada com produto que ja sabia ser invalido');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /produto invalido/);
  assert.ok(r.erros.length > 1);
});

test('criar manda POST assinado com o shop_cipher da loja', async () => {
  const cap = {};
  const r = await criar(ctx(cap), valido);
  assert.equal(r.ok, true);
  assert.equal(r.dados.product_id, 'P1');
  assert.equal(cap.opts.method, 'POST');
  assert.match(cap.url, /\/product\/202309\/products/);
  assert.match(cap.url, /shop_cipher=cipher/);
  assert.match(cap.url, /sign=[a-f0-9]{64}/);
  assert.match(cap.opts.body, /"title":"Camiseta Veloso"/);
});

test('editar exige id e usa PUT', async () => {
  assert.match((await editar(ctx(), '', valido)).motivo, /produtoId/);
  const cap = {};
  await editar(ctx(cap), 'P9', valido);
  assert.equal(cap.opts.method, 'PUT');
  assert.match(cap.url, /products\/P9/);
});

test('ativar/desativar/excluir recusam lista vazia', async () => {
  for (const fn of [ativar, desativar, excluir]) {
    const r = await fn(ctx(), []);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /ao menos um produtoId/);
  }
});

test('ativar manda os ids no corpo', async () => {
  const cap = {};
  await ativar(ctx(cap), ['P1', 'P2']);
  assert.match(cap.url, /products\/activate/);
  assert.deepEqual(JSON.parse(cap.opts.body).product_ids, ['P1', 'P2']);
});

test('busca pagina por page_token, nao por numero de pagina', async () => {
  const cap = {};
  await buscar(ctx(cap), { texto: 'camiseta', cursor: 'TK1', tamanho: 5 });
  assert.match(cap.url, /page_token=TK1/);
  assert.match(cap.url, /page_size=5/);
  assert.equal(JSON.parse(cap.opts.body).title_keyword, 'camiseta');
});

test('estoque negativo ou sem armazem nao chega na API', async () => {
  const cap = {};
  const r = await atualizarEstoque(ctx(cap), 'P1', [{ skuId: 'S1', armazemId: '', quantidade: -1 }]);
  assert.equal(cap.chamou, undefined);
  assert.ok(r.erros.some((e) => /armazemId/.test(e)));
  assert.ok(r.erros.some((e) => /inteiro >= 0/.test(e)));
});

test('estoque valido vai na rota propria, sem reenviar o produto todo', async () => {
  const cap = {};
  const r = await atualizarEstoque(ctx(cap), 'P1', [{ skuId: 'S1', armazemId: 'W1', quantidade: 7 }]);
  assert.equal(r.ok, true);
  assert.match(cap.url, /products\/P1\/inventory\/update/);
  assert.equal(JSON.parse(cap.opts.body).skus[0].inventory[0].quantity, 7);
});

test('preco atualizado sai em centavos convertidos, com a moeda validada', async () => {
  assert.match((await atualizarPreco(ctx(), 'P1', [{ skuId: 'S1', preco: 10 }], 'reais')).motivo, /moeda inválida/);
  const cap = {};
  await atualizarPreco(ctx(cap), 'P1', [{ skuId: 'S1', preco: 'R$ 1.234,56' }], 'brl');
  const corpo = JSON.parse(cap.opts.body);
  assert.equal(corpo.skus[0].price.amount, '1234.56');
  assert.equal(corpo.skus[0].price.currency, 'BRL');
});

test('falha da Shop API vira motivo em portugues', async () => {
  const cap = {};
  const r = await criar(ctx(cap, { code: 105002, message: 'invalid access_token' }), valido);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /credencial invalida|expirada/);
});
