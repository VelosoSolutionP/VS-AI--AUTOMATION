/**
 * Bot de vendas: cardápio com foto, carrinho e resumo antes de pagar.
 * O que protege: o resumo mostra o pedido de verdade ({pedido}/{total}); voltar
 * ao início zera o carrinho; as fotos saem uma vez por conversa; e quem volta
 * depois de trocarem o fluxo não cai num passo que nem existe mais.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'bot-vendas-'));
process.env.VSBOT_DIR = join(dir, 'bot');
process.env.VSPROTOCOLO_DIR = join(dir, 'proto');
const bot = await import('../engine/vsbot/index.mjs');
const proto = await import('../engine/vsprotocolo/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const produtos = [
  { sku: 'XT', nome: 'X-Tudo', descricao: 'Hambúrguer e ovo', precoCentavos: 2800, imagem: 'https://x/xt.jpg' },
  { sku: 'RF', nome: 'Refri', descricao: '', precoCentavos: 600, imagem: null },
];
const fluxo = [
  { id: 'inicio', mensagem: 'Olá, {nome}!', opcoes: [{ tecla: '1', texto: 'Cardápio', vaiPara: 'cardapio' }] },
  { id: 'cardapio', mensagem: 'Escolha:', opcoes: [
    { tecla: '1', texto: 'X-Tudo', sku: 'XT', vaiPara: 'mais' },
    { tecla: '2', texto: 'Refri', sku: 'RF', vaiPara: 'mais' }] },
  { id: 'mais', mensagem: 'Pedido:\n{pedido}\nTotal: {total}', opcoes: [
    { tecla: '1', texto: 'Mais', vaiPara: 'cardapio' },
    { tecla: '2', texto: 'De novo', vaiPara: 'inicio' },
    { tecla: '3', texto: 'Pagar', vaiPara: 'pagar' }] },
  { id: 'pagar', mensagem: 'Segue o PIX:', acao: 'cobrar' },
];
assert.equal(bot.salvarFluxo(fluxo).ok, true);

let n = 0;
const conversa = () => { const de = `55319${String(++n).padStart(8, '0')}`; return (t) => bot.atender(t, { de, nome: 'Ana', produtos }); };

test('resumo mostra o pedido agrupado e o total; cobranca sai com a soma', async () => {
  const f = conversa();
  // oi → cardapio → X-Tudo → mais → X-Tudo → mais → Refri
  await f('oi'); await f('1'); await f('1'); await f('1'); await f('1'); await f('1');
  const r = await f('2');
  assert.match(r.texto, /2x X-Tudo — R\$ 56,00/);
  assert.match(r.texto, /1x Refri — R\$ 6,00/);
  assert.match(r.texto, /Total: R\$ 62,00/);
  const pg = await f('3');
  assert.equal(pg.cobranca.valorCentavos, 6200);
});

test('voltar ao inicio zera o carrinho', async () => {
  const f = conversa();
  await f('oi'); await f('1'); await f('1');
  const ini = await f('2');
  assert.match(ini.texto, /Olá, Ana!/);
  await f('1');
  const r = await f('2');
  assert.match(r.texto, /1x Refri/);
  assert.doesNotMatch(r.texto, /X-Tudo/, 'o X-Tudo do pedido anterior nao pode voltar');
});

test('cards: so produto com foto, e uma vez por conversa', async () => {
  const f = conversa();
  await f('oi');
  const c1 = await f('1');
  assert.deepEqual(c1.cartoes.map((c) => [c.tecla, c.nome, c.preco]), [['1', 'X-Tudo', 'R$ 28,00']]);
  await f('1');
  const c2 = await f('1');
  assert.equal(c2.cartoes, undefined, 'segunda vez no cardapio: so o menu em texto');
  assert.match(c2.texto, /1 - X-Tudo — R\$ 28,00/);
});

test('fluxo trocado: quem volta nao "continua de onde parou" num passo que sumiu', async () => {
  const de = '5531988887777';
  const ap = proto.aoChegar(de);
  proto.anotar(ap.protocolo.numero, { passo: 'venda_dor', estado: proto.ESTADOS.COM_BOT });
  proto.encerrarPorNumero(ap.protocolo.numero);
  const r = await bot.atender('oi', { de, nome: 'Ana', produtos });
  assert.doesNotMatch(r.texto, /continuar de onde paramos/);
  assert.match(r.texto, /Olá, Ana!/);
});
