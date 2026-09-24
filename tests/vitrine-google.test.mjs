/**
 * Google Shopping pela vitrine. O que protege: o feed leva o link da página de
 * cada produto sem o dono digitar URL; link escrito à mão continua valendo; o
 * preço e a disponibilidade da página (schema.org) batem com os do feed — é
 * isso que o Merchant Center confere pra aprovar; o botão cai no WhatsApp com o
 * produto na mensagem; esgotado não vende.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportar } from '../engine/vsestoque/exportar.mjs';
import { pagina, paginaProduto } from '../backend/vitrine.mjs';

const base = { sku: 'XT 1', nome: 'X-Tudo & Cia', descricao: 'Hambúrguer, ovo e bacon', marca: 'Juarez', categoria: 'Lanches',
  precoCentavos: 2800, moeda: 'BRL', quantidade: 10, reservado: 0, imagens: ['https://x/xt.jpg'], ativo: true, condicao: 'novo' };
const linkDe = (sku) => `https://loja.exemplo/vitrine/p/${encodeURIComponent(sku)}`;

test('feed do Google: link da pagina entra sozinho; link manual e respeitado; sem descricao fica de fora', () => {
  const r = exportar([base, { ...base, sku: 'M', link: 'https://meusite/m' }, { ...base, sku: 'S', descricao: '' }], 'google', { linkDe, loja: 'Juarez' });
  assert.equal(r.incluidos, 2);
  assert.match(r.conteudo, /<g:link>https:\/\/loja\.exemplo\/vitrine\/p\/XT%201<\/g:link>/);
  assert.match(r.conteudo, /<g:link>https:\/\/meusite\/m<\/g:link>/);
  assert.deepEqual(r.recusados.map((x) => x.sku), ['S']);
  assert.match(r.conteudo, /X-Tudo &amp; Cia/, 'o & nao pode quebrar o XML');
  assert.match(r.conteudo, /<g:identifier_exists>no<\/g:identifier_exists>/, 'sem GTIN/MPN o Google exige dizer que nao tem');
});

test('sem linkDe, produto sem link continua recusado (nao inventa URL)', () => {
  assert.deepEqual(exportar([base], 'google').recusados[0].faltando, ['link do produto']);
});

const cliente = { sku: 'XT 1', nome: 'X-Tudo', descricao: 'Hambúrguer', marca: 'Juarez', categoria: 'Lanches',
  precoCentavos: 2500, precoDeCentavos: 2800, imagem: 'https://x/xt.jpg', imagens: ['https://x/xt.jpg', 'https://x/xt2.jpg'], esgotado: false };
const loja = { nome: 'Juarez Tele-Entrega', whatsapp: '553175536010', origem: 'https://loja.exemplo' };

test('pagina do produto: schema.org com o preco vigente, disponivel e a URL canonica', () => {
  const html = paginaProduto(cliente, loja);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'Product');
  assert.equal(ld.offers.price, '25.00');
  assert.equal(ld.offers.priceCurrency, 'BRL');
  assert.equal(ld.offers.availability, 'https://schema.org/InStock');
  assert.equal(ld.offers.url, 'https://loja.exemplo/vitrine/p/XT%201');
  assert.deepEqual(ld.image, cliente.imagens);
  assert.match(html, /<link rel="canonical" href="https:\/\/loja\.exemplo\/vitrine\/p\/XT%201">/);
  assert.match(html, /−11%/);
});

test('pagina do produto: "Pedir no WhatsApp" abre a conversa com o produto na mensagem', () => {
  const html = paginaProduto(cliente, loja);
  const href = html.match(/class="pedir" href="([^"]+)"/)[1].replace(/&amp;/g, '&');
  assert.match(href, /^https:\/\/wa\.me\/553175536010\?text=/);
  assert.match(decodeURIComponent(href.split('text=')[1]), /Quero pedir: X-Tudo \(R\$\s?25,00\)/);
});

test('esgotado: a pagina diz, o schema diz, e nao tem botao de pedir', () => {
  const html = paginaProduto({ ...cliente, esgotado: true }, loja);
  assert.match(html, /Esgotado no momento/);
  assert.match(html, /OutOfStock/);
  assert.doesNotMatch(html, /class="pedir" href=/);
});

test('texto do produto nao injeta HTML nem quebra o JSON-LD', () => {
  const html = paginaProduto({ ...cliente, nome: '<script>alert(1)</script>', descricao: '</script><b>x' }, loja);
  assert.doesNotMatch(html, /<script>alert/);
  const ld = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)[1];
  assert.doesNotMatch(ld, /<\/script>/i);
  assert.equal(JSON.parse(ld).name, '<script>alert(1)</script>');
});

test('card da vitrine leva a pagina do produto', () => {
  assert.match(pagina([cliente], loja), /href="\/vitrine\/p\/XT%201"/);
});
