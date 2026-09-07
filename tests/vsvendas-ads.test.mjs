/**
 * VSvendas/ads — formatador de FEED do Facebook e o que o teste manual pegou junto:
 *
 *  1. so existia "marketplace" (classificado); post de feed nao tinha formatador, e
 *     feed tem regra propria (corte do "ver mais", hashtag rende pouco, sem preco).
 *  2. hashtags repetiam quando o nome do produto tambem aparecia no campo "vende"
 *     (ex.: "#qagate #qagate") — atingia o Instagram, que ja existia.
 *  3. o separador de bloco ('' no array) era descartado pelo filter(Boolean) e os
 *     paragrafos saiam colados.
 *  4. preco faltando recusava TODAS as plataformas, inclusive feed/direct, que nao
 *     precisam de preco.
 *
 * Roda com:  node --test tests/vsvendas-ads.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAds, PLATAFORMAS, PRECO_OBRIGATORIO } from '../engine/vsvendas/ads.mjs';

const prof = { empresa: {
  nome: 'DevPoint Innovation',
  vende: 'QA-Gate automacao governanca',
  propostaValor: 'bug de tela barrado no commit',
  tom: 'Direto',
} };

const produto = {
  produto: 'QA-Gate',
  gancho: 'Seu teste unitario passou. E a tela quebrou mesmo assim.',
  descricao: 'Simula o fluxo num Chrome real antes do commit.',
  prova: 'Hidratacao errada e lib que nao subiu o teste unitario nao pega.',
  link: 'https://devpointinnovation.com.br/',
};

test('facebook: formatador existe e e distinto do marketplace', () => {
  assert.ok(PLATAFORMAS.facebook, 'faltou o formatador de feed');
  const fb = PLATAFORMAS.facebook(produto, prof);
  const mk = PLATAFORMAS.marketplace(produto, prof);
  assert.equal(fb.plataforma, 'Facebook (feed)');
  assert.notEqual(fb.texto, mk.texto);
});

test('facebook: gancho e a primeira linha e cabe no corte do "ver mais"', () => {
  const { texto } = PLATAFORMAS.facebook(produto, prof);
  const primeira = texto.split('\n')[0];
  assert.equal(primeira, produto.gancho);
  assert.ok(primeira.length <= 120, `gancho longo demais: ${primeira.length}`);
});

test('facebook: blocos separados por linha em branco (filter nao come o separador)', () => {
  const { texto } = PLATAFORMAS.facebook(produto, prof);
  assert.match(texto, /\n\n/);
  assert.ok(!/[^\n]\n[^\n]/.test(texto.replace(/\n\n/g, '')), 'blocos colados');
});

test('hashtags nao repetem quando o produto tambem esta em "vende"', () => {
  const { texto } = PLATAFORMAS.instagram(produto, prof);
  const tags = texto.split('\n').pop().split(' ').filter(Boolean);
  assert.deepEqual(tags, [...new Set(tags)], `repetidas: ${tags.join(' ')}`);
});

test('facebook usa no maximo 2 hashtags (no feed hashtag rende pouco)', () => {
  const { texto } = PLATAFORMAS.facebook(produto, prof);
  const tags = texto.split('\n').pop().split(' ').filter((t) => t.startsWith('#'));
  assert.ok(tags.length <= 2, `hashtags demais: ${tags.length}`);
});

test('sem preco: feed sai, classificado fica pendente', () => {
  const r = buildAds(produto, prof, ['facebook', 'instagram', 'marketplace', 'olx']);
  const nomes = r.anuncios.map((a) => a.plataforma);
  assert.ok(nomes.includes('Facebook (feed)'));
  assert.ok(nomes.includes('Instagram'));
  assert.ok(!nomes.some((n) => /Marketplace|OLX/.test(n)));
  assert.match(r.faltando, /pre.o/);
});

test('com preco: classificado tambem sai, e sem pendencia', () => {
  const r = buildAds({ ...produto, preco: 297 }, prof, ['facebook', 'marketplace']);
  assert.equal(r.anuncios.length, 2);
  assert.equal(r.faltando, undefined);
  assert.match(r.anuncios.find((a) => /Marketplace/.test(a.plataforma)).preco, /297/);
});

test('so classificado e sem preco: recusa tudo, como antes', () => {
  const r = buildAds(produto, prof, ['marketplace', 'olx']);
  assert.equal(r.anuncios.length, 0);
  assert.equal(r.faltando, 'preço');
});

test('PRECO_OBRIGATORIO cobre so os classificados', () => {
  assert.deepEqual([...PRECO_OBRIGATORIO].sort(), ['marketplace', 'mercadolivre', 'olx']);
  assert.ok(!PRECO_OBRIGATORIO.has('facebook'));
});
