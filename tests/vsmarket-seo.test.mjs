import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagina, quemAtende, rotas, sitemap, robots, acharCategoria, acharCidade, CIDADES, slug } from '../marketplace/seo.mjs';

const CAT = { id: 'eletrica', nome: 'Elétrica' };
const pro = (o) => ({ status: 'ACTIVE', categorias: ['eletrica'], cidades: ['Belo Horizonte'], nome: 'X', ...o });

test('conta so quem REALMENTE atende: ativo, da categoria e com a cidade declarada', () => {
  const lista = [
    pro({ nome: 'Atende' }),
    pro({ nome: 'Inativo', status: 'PENDING' }),
    pro({ nome: 'Outra categoria', categorias: ['pintura'] }),
    pro({ nome: 'Outra cidade', cidades: ['Betim'] }),
  ];
  const r = quemAtende(lista, 'eletrica', 'Belo Horizonte');
  assert.equal(r.length, 1);
  assert.equal(r[0].nome, 'Atende');
});

test('acento e caixa da cidade nao quebram a contagem', () => {
  assert.equal(quemAtende([pro({ cidades: ['belo horizonte'] })], 'eletrica', 'Belo Horizonte').length, 1);
  assert.equal(quemAtende([pro({ cidades: ['Ribeirão das Neves'] })], 'eletrica', 'Ribeirao das Neves').length, 1);
});

test('SEM profissional a pagina NAO inventa disponibilidade', () => {
  const h = pagina({ categoria: CAT, cidade: 'Sabará', prestadores: [] });
  assert.match(h, /Ainda estamos formando a rede/);
  assert.match(h, /Transparência/);
  assert.doesNotMatch(h, /profissionais de elétrica atendem/);
  // e nao publica nota agregada que nao existe
  assert.doesNotMatch(h, /aggregateRating/);
});

test('mesmo sem profissional a pagina CONVERTE — o pedido é registrado', () => {
  const h = pagina({ categoria: CAT, cidade: 'Sabará', prestadores: [] });
  assert.match(h, /Pedir orçamento/);
  assert.match(h, /Começar meu pedido/);
});

test('COM profissional a pagina diz o numero real e lista quem é', () => {
  const h = pagina({ categoria: CAT, cidade: 'Belo Horizonte', prestadores: [pro({ nome: 'Carlos', reputacao: 4.9, servicosConcluidos: 127 })] });
  assert.match(h, /1 profissional de elétrica atende Belo Horizonte/);
  assert.match(h, /Carlos/);
  assert.doesNotMatch(h, /Transparência/);
});

test('concordancia de plural correta — "profissionais", nao "profissionalis"', () => {
  const um = pagina({ categoria: CAT, cidade: 'Betim', prestadores: [pro({})] });
  const tres = pagina({ categoria: CAT, cidade: 'Betim', prestadores: [pro({}), pro({}), pro({})] });
  assert.match(um, /1 profissional de elétrica atende Betim/);
  assert.match(tres, /3 profissionais de elétrica atendem Betim/);
  assert.doesNotMatch(tres, /profissionalis/);
});

test('a nota agregada so aparece quando ha nota E servico de verdade', () => {
  const sem = pagina({ categoria: CAT, cidade: 'Betim', prestadores: [pro({ reputacao: null, servicosConcluidos: 0 })] });
  assert.doesNotMatch(sem, /aggregateRating/);
  const com = pagina({ categoria: CAT, cidade: 'Betim', prestadores: [pro({ reputacao: 4.8, servicosConcluidos: 50 })] });
  assert.match(com, /aggregateRating/);
  assert.match(com, /"ratingValue":"4.8"/);
});

test('a pagina tem o basico de indexacao', () => {
  const h = pagina({ categoria: CAT, cidade: 'Betim', prestadores: [], origem: 'https://qg.com' });
  assert.match(h, /<html lang="pt-BR">/);
  assert.match(h, /<title>Elétrica em Betim \| Quebra-Galho<\/title>/);
  assert.match(h, /rel="canonical" href="https:\/\/qg\.com\/servicos\/eletrica\/betim"/);
  assert.match(h, /property="og:title"/);
  assert.match(h, /application\/ld\+json/);
  // o conteudo esta no HTML, nao depende de JS rodar
  assert.match(h, /Como funciona/);
});

test('conteudo da pagina é escapado — nome de prestador nao injeta HTML', () => {
  const h = pagina({ categoria: CAT, cidade: 'Betim', prestadores: [pro({ nome: '<script>alert(1)</script>' })] });
  assert.doesNotMatch(h, /<script>alert\(1\)<\/script>/);
  assert.match(h, /&lt;script&gt;/);
});

test('rotas cobrem categoria x cidade, e o sitemap as publica', () => {
  const cats = [CAT, { id: 'pintura', nome: 'Pintura' }];
  const r = rotas(cats);
  assert.equal(r.length, cats.length * CIDADES.length);
  assert.ok(r.includes('/servicos/eletrica/belo-horizonte'));
  const sm = sitemap(cats, 'https://qg.com');
  assert.match(sm, /<urlset/);
  assert.equal((sm.match(/<loc>/g) || []).length, r.length + 1, 'sitemap = rotas + home');
});

test('robots aponta o sitemap', () => {
  assert.match(robots('https://qg.com'), /Sitemap: https:\/\/qg\.com\/sitemap\.xml/);
});

test('slug resolve categoria e cidade com acento', () => {
  assert.equal(acharCategoria([CAT], 'eletrica').id, 'eletrica');
  assert.equal(acharCidade('ribeirao-das-neves'), 'Ribeirão das Neves');
  assert.equal(acharCidade('xique-xique'), null);
  assert.equal(slug('São João'), 'sao-joao');
});
