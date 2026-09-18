import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vsestoque-'));
process.env.VSESTOQUE_DIR = dir;
const vs = await import('../engine/vsestoque/index.mjs');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const base = { nome: 'Camiseta Veloso', preco: 'R$ 79,90', quantidade: 10, marca: 'Veloso',
  descricao: 'Algodão', link: 'https://loja.x/c', imagens: ['https://cdn.x/1.jpg'] };

test('cadastra e encontra pelo SKU', () => {
  const r = vs.criar(base);
  assert.equal(r.ok, true);
  assert.equal(vs.obter('camiseta-veloso').nome, 'Camiseta Veloso');
});

test('SKU repetido é recusado na gravacao, nao so na validacao', () => {
  const r = vs.criar(base);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /já existe produto/.test(e)));
  assert.equal(vs.listar().length, 1, 'nao pode ter gravado o duplicado');
});

test('editar mantem o que nao foi enviado', () => {
  const r = vs.editar('camiseta-veloso', { marca: 'Veloso Solution' });
  assert.equal(r.ok, true);
  assert.equal(r.produto.marca, 'Veloso Solution');
  assert.equal(r.produto.precoCentavos, 7990, 'o preço nao pode se perder na edicao');
  assert.equal(r.produto.quantidade, 10);
});

test('editar preco converte de novo pra centavos, sem reinterpretar o antigo', () => {
  const r = vs.editar('camiseta-veloso', { preco: 'R$ 99,90' });
  assert.equal(r.produto.precoCentavos, 9990);
  const r2 = vs.editar('camiseta-veloso', { marca: 'Veloso' });
  assert.equal(r2.produto.precoCentavos, 9990, 'edicao seguinte nao pode dividir o preco por 100 de novo');
});

test('editar produto inexistente nao cria nada', () => {
  const r = vs.editar('fantasma', { marca: 'X' });
  assert.equal(r.ok, false);
  assert.equal(vs.listar().length, 1);
});

test('movimentar grava saldo e historico', () => {
  const r = vs.movimentar('camiseta-veloso', { tipo: 'reserva', quantidade: 4, ref: 'pedido 1' });
  assert.equal(r.ok, true);
  assert.equal(r.produto.reservado, 4);
  const h = vs.historico('camiseta-veloso');
  assert.equal(h[0].tipo, 'reserva');
  assert.equal(h[0].ref, 'pedido 1');
  assert.equal(h[0].sku, 'camiseta-veloso');
});

test('movimento recusado nao grava nem saldo nem historico', () => {
  const antes = vs.historico().length;
  const r = vs.movimentar('camiseta-veloso', { tipo: 'reserva', quantidade: 99 });
  assert.equal(r.ok, false);
  assert.equal(vs.obter('camiseta-veloso').reservado, 4);
  assert.equal(vs.historico().length, antes);
});

test('inativar tira da vitrine sem apagar', () => {
  vs.criar({ ...base, nome: 'Boné Veloso' });
  assert.equal(vs.inativar('bone-veloso').ok, true);
  assert.equal(vs.obter('bone-veloso').ativo, false);
  assert.equal(vs.listar().length, 2, 'continua no catalogo');
  assert.equal(vs.listar({ inativos: false }).length, 1);
});

test('exportar usa o catalogo gravado e pula o inativo', () => {
  const r = vs.exportar('crm');
  assert.equal(r.ok, true);
  assert.equal(r.incluidos, 1);
  assert.equal(r.ignoradosInativos, 1);
});

test('painel soma unidades, reservas e valor parado', () => {
  const d = vs.painel();
  assert.equal(d.total, 2);
  assert.equal(d.ativos, 1);
  assert.equal(d.unidades, 20);
  assert.equal(d.reservadas, 4);
  assert.equal(d.valorCentavos, 9990 * 10 + 7990 * 10);
  assert.ok(d.canais.google, 'o painel diz o que esta pronto por canal');
});

test('busca por texto acha por nome, sku, marca ou categoria', () => {
  assert.equal(vs.listar({ texto: 'boné' }).length, 1);
  assert.equal(vs.listar({ texto: 'veloso' }).length, 2);
  assert.equal(vs.listar({ texto: 'geladeira' }).length, 0);
});

test('excluir some de vez; excluir de novo avisa', () => {
  assert.equal(vs.excluir('bone-veloso').ok, true);
  assert.equal(vs.listar().length, 1);
  assert.equal(vs.excluir('bone-veloso').ok, false);
});

test('publicar no TikTok exige categoria, armazem e imagem — e nao chama a API sem isso', async () => {
  assert.match((await vs.publicarNoTiktok('fantasma')).motivo, /não encontrado/);
  assert.match((await vs.publicarNoTiktok('camiseta-veloso')).motivo, /armazemId/);
  assert.match((await vs.publicarNoTiktok('camiseta-veloso', { armazemId: 'W1' })).motivo, /categoriaId/);
});
