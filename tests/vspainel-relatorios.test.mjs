import { test } from 'node:test';
import assert from 'node:assert/strict';
import { porOrigem, funilConversao, cicloMedioDias, esquecidos, montar } from '../engine/vspainel/relatorios.mjs';

const AGORA = Date.parse('2026-09-19T12:00:00.000Z');
const d = (dias) => new Date(AGORA - dias * 86400000).toISOString();

const lead = (o) => ({
  id: o.id || Math.random().toString(36).slice(2),
  origem: o.origem, status: o.status, etapa: o.etapa, valor: o.valor ?? null,
  criadoEm: o.criadoEm || d(30), atualizadoEm: o.atualizadoEm || d(1),
  historico: o.historico || [{ etapa: o.etapa }],
});

test('agrupa por origem e ordena pelo volume', () => {
  const r = porOrigem([
    lead({ origem: 'instagram', status: 'ganho', etapa: 'Fechado' }),
    lead({ origem: 'instagram', status: 'aberto', etapa: 'Novo' }),
    lead({ origem: 'indicacao', status: 'ganho', etapa: 'Fechado' }),
  ]);
  assert.equal(r[0].origem, 'instagram');
  assert.equal(r[0].leads, 2);
  assert.equal(r[1].origem, 'indicacao');
});

test('conversao de origem sem nada fechado é null, nao 0% — senao mata um canal por amostra vazia', () => {
  const r = porOrigem([lead({ origem: 'tiktok', status: 'aberto', etapa: 'Novo' })]);
  assert.equal(r[0].conversao, null);
  assert.equal(r[0].amostraSuficiente, false);
});

test('amostra so é suficiente com 3 fechados', () => {
  const tres = [1, 2, 3].map(() => lead({ origem: 'x', status: 'ganho', etapa: 'F' }));
  assert.equal(porOrigem(tres)[0].amostraSuficiente, true);
  assert.equal(porOrigem(tres.slice(0, 2))[0].amostraSuficiente, false);
});

test('lead sem origem vira "sem origem", nao some do relatorio', () => {
  const r = porOrigem([lead({ origem: null, status: 'aberto', etapa: 'Novo' })]);
  assert.equal(r[0].origem, 'sem origem');
});

test('receita da origem soma so os ganhos com valor', () => {
  const r = porOrigem([
    lead({ origem: 'x', status: 'ganho', etapa: 'F', valor: 100 }),
    lead({ origem: 'x', status: 'ganho', etapa: 'F', valor: null }),
    lead({ origem: 'x', status: 'aberto', etapa: 'N', valor: 9999 }),
  ]);
  assert.equal(r[0].receita, 100);
});

test('conversao de etapa conta quem PASSOU, nao quem esta parado ali', () => {
  const funil = ['Novo', 'Proposta', 'Fechado'];
  const leads = [
    // ja avancou pra Proposta: tem que contar em Novo tambem
    lead({ origem: 'x', status: 'aberto', etapa: 'Proposta', historico: [{ etapa: 'Novo' }, { etapa: 'Proposta' }] }),
    lead({ origem: 'x', status: 'aberto', etapa: 'Novo', historico: [{ etapa: 'Novo' }] }),
  ];
  const r = funilConversao(leads, funil);
  assert.equal(r[0].etapa, 'Novo');
  assert.equal(r[0].chegaram, 2, 'quem avancou continua contando como tendo passado por Novo');
  assert.equal(r[0].parados, 1);
  assert.equal(r[0].avancaram, 1);
  assert.equal(r[0].passagem, 0.5);
});

test('a ultima etapa nao tem passagem — nao existe proxima', () => {
  const r = funilConversao([lead({ origem: 'x', status: 'ganho', etapa: 'Fechado' })], ['Novo', 'Fechado']);
  assert.equal(r[1].passagem, null);
  assert.equal(r[1].avancaram, null);
});

test('ciclo medio olha so quem fechou; sem fechamento é null', () => {
  assert.equal(cicloMedioDias([lead({ origem: 'x', status: 'aberto', etapa: 'N' })]), null);
  const r = cicloMedioDias([lead({ origem: 'x', status: 'ganho', etapa: 'F', criadoEm: d(10), atualizadoEm: d(0) })]);
  assert.equal(r, 10);
});

test('esquecidos lista so aberto parado, do mais velho pro mais novo', () => {
  const r = esquecidos([
    lead({ id: 'a', origem: 'x', status: 'aberto', etapa: 'N', atualizadoEm: d(30) }),
    lead({ id: 'b', origem: 'x', status: 'aberto', etapa: 'N', atualizadoEm: d(10) }),
    lead({ id: 'c', origem: 'x', status: 'aberto', etapa: 'N', atualizadoEm: d(1) }),
    lead({ id: 'd', origem: 'x', status: 'ganho', etapa: 'F', atualizadoEm: d(99) }),
  ], 7, AGORA);
  assert.deepEqual(r.map((x) => x.id), ['a', 'b']);
  assert.equal(r[0].paradoDias, 30);
});

test('o relatorio declara o que NAO entrou', () => {
  const r = montar({ leads: [], funil: [] }, AGORA);
  assert.ok(r.naoEntrou.some((x) => /nenhum lead/.test(x)));
  assert.ok(r.naoEntrou.some((x) => /catálogo vazio/.test(x)));
  assert.ok(r.naoEntrou.some((x) => /bot não é medido/.test(x)));
  assert.equal(r.catalogo, null);
});

test('com catalogo, o relatorio traz a prontidao por canal', () => {
  const r = montar({
    leads: [lead({ origem: 'x', status: 'ganho', etapa: 'F' })], funil: ['F'],
    estoque: { total: 3, ativos: 2, semEstoque: 1, valorFormatado: 'R$ 10,00', canais: { google: { prontos: 1, total: 2 } } },
  }, AGORA);
  assert.equal(r.catalogo.produtos, 3);
  assert.equal(r.catalogo.canais.google.prontos, 1);
  assert.ok(!r.naoEntrou.some((x) => /catálogo vazio/.test(x)));
});
