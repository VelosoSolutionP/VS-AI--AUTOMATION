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

/* Este teste ja exigiu exclusao FISICA. A especificacao do produto (secao 3)
   pede soft delete: pedido, movimento e lancamento financeiro apontam pro
   produto, e apagar de verdade deixa historico orfao — extrato com item que
   "nao existe" e o que se investiga quando a conta nao fecha. */
test('excluir some das telas mas NAO do disco', () => {
  assert.equal(vs.excluir('bone-veloso').ok, true);
  assert.equal(vs.listar().length, 1, 'sai do catalogo');
  assert.equal(vs.listar({ incluirExcluidos: true }).length, 2, 'continua gravado');
  assert.equal(vs.obter('bone-veloso'), null, 'nao aparece mais em obter');
  assert.equal(vs.excluidos().length, 1);
});

test('excluir de novo nao e erro — e o mesmo resultado', () => {
  const r = vs.excluir('bone-veloso');
  assert.equal(r.ok, true);
  assert.equal(r.repetido, true);
});

test('excluido sai do feed e da vitrine junto', () => {
  assert.equal(vs.daVitrine().some((p) => p.sku === 'bone-veloso'), false);
  assert.equal(vs.exportar('json').conteudo.includes('bone-veloso'), false);
});

test('restaurar traz de volta — excluir errado acontece', () => {
  assert.equal(vs.restaurar('bone-veloso').ok, true);
  assert.equal(vs.listar().length, 2);
  assert.ok(vs.obter('bone-veloso'));
  assert.equal(vs.excluidos().length, 0);
  vs.excluir('bone-veloso');
});

test('publicar no TikTok exige categoria, armazem e imagem — e nao chama a API sem isso', async () => {
  assert.match((await vs.publicarNoTiktok('fantasma')).motivo, /não encontrado/);
  assert.match((await vs.publicarNoTiktok('camiseta-veloso')).motivo, /armazemId/);
  assert.match((await vs.publicarNoTiktok('camiseta-veloso', { armazemId: 'W1' })).motivo, /categoriaId/);
});

/* ---- reserva: a regra critica de estoque da especificacao ----
   "Nunca baixar estoque apenas porque o usuario clicou em Vender. Use
   reserva/idempotencia e confirme a transacao no ponto definido pelo negocio.
   Falhas e retries nao podem duplicar baixa." */

test('reservar NAO baixa o saldo — separa a peca', () => {
  const antes = vs.obter('camiseta-veloso');
  const r = vs.reservar('camiseta-veloso', 2, { chave: 'ped-1', canal: 'tiktok' });
  assert.equal(r.ok, true, r.erro);
  const depois = vs.obter('camiseta-veloso');
  assert.equal(depois.quantidade, antes.quantidade, 'a quantidade NAO pode cair na reserva');
  assert.equal(depois.reservado, (antes.reservado || 0) + 2);
});

test('a MESMA chave nao reserva duas vezes — retry e webhook reentregue sao normais', () => {
  const antes = vs.obter('camiseta-veloso');
  const r = vs.reservar('camiseta-veloso', 2, { chave: 'ped-1' });
  assert.equal(r.ok, true);
  assert.equal(r.repetido, true);
  assert.equal(vs.obter('camiseta-veloso').reservado, antes.reservado, 'reservou de novo');
});

test('reserva sem chave e recusada — sem chave nao ha idempotencia', () => {
  assert.equal(vs.reservar('camiseta-veloso', 1, {}).ok, false);
  assert.equal(vs.reservar('camiseta-veloso', 0, { chave: 'x' }).ok, false);
  assert.equal(vs.reservar('camiseta-veloso', 1.5, { chave: 'y' }).ok, false);
});

test('a baixa so acontece na CONFIRMACAO do canal', () => {
  const antes = vs.obter('camiseta-veloso');
  const r = vs.confirmarReserva('ped-1');
  assert.equal(r.ok, true, r.erro);
  const depois = vs.obter('camiseta-veloso');
  assert.equal(depois.quantidade, antes.quantidade - 2, 'agora sim o saldo cai');
  assert.equal(depois.reservado, (antes.reservado || 0) - 2);
});

test('confirmar duas vezes nao baixa duas vezes', () => {
  const antes = vs.obter('camiseta-veloso');
  const r = vs.confirmarReserva('ped-1');
  assert.equal(r.repetido, true);
  assert.equal(vs.obter('camiseta-veloso').quantidade, antes.quantidade);
});

test('cancelar devolve a peca pra prateleira', () => {
  vs.reservar('camiseta-veloso', 1, { chave: 'ped-2' });
  const reservado = vs.obter('camiseta-veloso').reservado;
  assert.equal(vs.cancelarReserva('ped-2').ok, true);
  assert.equal(vs.obter('camiseta-veloso').reservado, reservado - 1);
  assert.equal(vs.cancelarReserva('ped-2').ok, false, 'nao cancela duas vezes');
});

test('reserva de chave desconhecida nao move nada', () => {
  assert.equal(vs.confirmarReserva('nao-existe').ok, false);
  assert.equal(vs.cancelarReserva('nao-existe').ok, false);
});

/* ---- onde o produto foi parar ----
   Mandar pro canal e nao registrar deixava a tela sem como dizer se um produto
   ja esta la — e mandar de novo criaria duplicado do outro lado. */

test('registrar canal guarda o id de LA, nao so um sim/nao', () => {
  vs.registrarCanal('camiseta-veloso', 'tiktok', { estado: 'publicado', idExterno: 'tt_123', em: '2026-09-20T10:00:00Z' });
  const p = vs.obter('camiseta-veloso');
  assert.equal(p.canais.tiktok.estado, 'publicado');
  assert.equal(p.canais.tiktok.idExterno, 'tt_123', 'sem o id de la nao da pra atualizar nem remover depois');
});

test('falha no envio tambem fica registrada, com o motivo', () => {
  vs.registrarCanal('camiseta-veloso', 'shopee', { estado: 'falhou', motivo: 'sem categoria', em: '2026-09-20T11:00:00Z' });
  assert.equal(vs.obter('camiseta-veloso').canais.shopee.estado, 'falhou');
  assert.match(vs.obter('camiseta-veloso').canais.shopee.motivo, /categoria/);
});

test('publicados lista onde cada produto esta', () => {
  const l = vs.publicados();
  const c = l.find((x) => x.sku === 'camiseta-veloso');
  assert.ok(c);
  assert.equal(c.canais.length, 2);
  assert.ok(c.canais.some((x) => x.nome === 'tiktok' && x.estado === 'publicado'));
});

test('esquecer canal tira o registro e nao o produto', () => {
  assert.equal(vs.esquecerCanal('camiseta-veloso', 'shopee').ok, true);
  assert.equal(vs.obter('camiseta-veloso').canais.shopee, undefined);
  assert.ok(vs.obter('camiseta-veloso'), 'o produto continua');
  assert.equal(vs.esquecerCanal('fantasma', 'tiktok').ok, false);
});

test('registrar canal em produto inexistente e recusado', () => {
  assert.equal(vs.registrarCanal('fantasma', 'tiktok', {}).ok, false);
});

/* Hamburgueria que vende so pelo WhatsApp: catalogo ativo, vitrine vazia. O bot
   lia a vitrine e respondia "nao temos cardapio" com cinco itens cadastrados. */
test('atendimento enxerga produto ativo fora da vitrine; inativo e excluido nao', () => {
  assert.equal(vs.criar({ sku: 'jz-xtudo', nome: 'X-Tudo', preco: 28, quantidade: 40 }).ok, true);
  assert.equal(vs.obter('jz-xtudo').naVitrine, false);
  assert.equal(vs.daVitrine().some((p) => p.sku === 'jz-xtudo'), false, 'vitrine continua so com o exposto');
  const item = vs.doAtendimento().find((p) => p.sku === 'jz-xtudo');
  assert.ok(item, 'o bot ve o X-Tudo');
  assert.equal(item.precoCentavos, 2800);
  vs.inativar('jz-xtudo');
  assert.equal(vs.doAtendimento().some((p) => p.sku === 'jz-xtudo'), false, 'inativo nao e oferecido');
  vs.reativar('jz-xtudo');
  vs.excluir('jz-xtudo');
  assert.equal(vs.doAtendimento().some((p) => p.sku === 'jz-xtudo'), false, 'excluido nao e oferecido');
});
