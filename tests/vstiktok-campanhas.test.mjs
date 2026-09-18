import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarCampanha, normalizarConjunto, normalizarAnuncio, normalizarLinhaRelatorio,
  criar, listar, mudarStatus, atualizar, relatorio, centavosParaValor,
} from '../engine/vstiktok/campanhas.mjs';

const ctx = (cap = {}, corpo = { code: 0, data: { campaign_id: 'C1' } }) => ({
  token: 't',
  fetchImpl: async (url, opts) => { cap.url = url; cap.opts = opts; cap.chamou = true; return { status: 200, json: async () => corpo }; },
});

const base = { anuncianteId: 'ADV1', nome: 'Black Friday', objetivo: 'vendas', orcamento: 'R$ 500,00' };

test('objetivo aceita apelido em portugues e vira a constante da API', () => {
  assert.equal(normalizarCampanha(base).campanha.objective_type, 'PRODUCT_SALES');
  assert.equal(normalizarCampanha({ ...base, objetivo: 'trafego' }).campanha.objective_type, 'TRAFFIC');
  assert.equal(normalizarCampanha({ ...base, objetivo: 'REACH' }).campanha.objective_type, 'REACH');
  assert.ok(normalizarCampanha({ ...base, objetivo: 'viralizar' }).erros.some((e) => /objetivo desconhecido/.test(e)));
});

test('campanha NASCE PAUSADA — ligar tem que ser um pedido explicito', () => {
  assert.equal(normalizarCampanha(base).campanha.operation_status, 'DISABLE');
  assert.equal(normalizarCampanha({ ...base, ativar: true }).campanha.operation_status, 'ENABLE');
});

test('orcamento entra em centavos e sai decimal pra API', () => {
  assert.equal(normalizarCampanha(base).campanha.budget, 500);
  assert.equal(centavosParaValor(12345), 123.45);
});

test('orcamento invalido ou zerado é erro, nao default silencioso', () => {
  assert.ok(normalizarCampanha({ ...base, orcamento: 'uns trocados' }).erros.some((e) => /orçamento inválido/.test(e)));
  assert.ok(normalizarCampanha({ ...base, orcamento: 0 }).erros.some((e) => /maior que zero/.test(e)));
});

test('orcamento sem limite dispensa valor', () => {
  const r = normalizarCampanha({ ...base, modoOrcamento: 'BUDGET_MODE_INFINITE', orcamento: '' });
  assert.deepEqual(r.erros, []);
  assert.equal(r.campanha.budget, undefined);
});

test('orcamento abaixo do minimo vira AVISO, nao bloqueio (a conta pode ser em outra moeda)', () => {
  const r = normalizarCampanha({ ...base, orcamento: 'R$ 10,00' });
  assert.deepEqual(r.erros, []);
  assert.ok(r.avisos.some((a) => /abaixo do mínimo/.test(a)));
});

test('campanha invalida nao vira chamada de API', async () => {
  const cap = {};
  const r = await criar(ctx(cap), { nome: 'x' });
  assert.equal(cap.chamou, undefined);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /campanha invalida/);
});

test('criar avisa que nasceu pausada e devolve o id', async () => {
  const cap = {};
  const r = await criar(ctx(cap), base);
  assert.equal(r.ok, true);
  assert.equal(r.criadaPausada, true);
  assert.equal(r.dados.campaign_id, 'C1');
  assert.match(cap.url, /\/campaign\/create\//);
  assert.equal(JSON.parse(cap.opts.body).operation_status, 'DISABLE');
});

test('conjunto exige local e periodo coerente', () => {
  const g = {
    anuncianteId: 'ADV1', campanhaId: 'C1', nome: 'BR 18-34',
    orcamento: 'R$ 100,00', inicio: '2026-10-01 00:00:00', locais: ['BR'],
  };
  assert.deepEqual(normalizarConjunto(g).erros, []);
  assert.ok(normalizarConjunto({ ...g, locais: [] }).erros.some((e) => /location_id/.test(e)));
  assert.ok(normalizarConjunto({ ...g, inicio: '2026-10-01' }).erros.some((e) => /início inválido/.test(e)));
  assert.ok(normalizarConjunto({ ...g, fim: '2026-09-01 00:00:00' }).erros.some((e) => /depois do início/.test(e)));
});

test('orcamento total sem data de fim é recusado — gastaria indefinidamente', () => {
  const r = normalizarConjunto({
    anuncianteId: 'A', campanhaId: 'C', nome: 'n', locais: ['BR'],
    orcamento: 'R$ 100,00', inicio: '2026-10-01 00:00:00', modoOrcamento: 'BUDGET_MODE_TOTAL',
  });
  assert.ok(r.erros.some((e) => /exige data de fim/.test(e)));
});

test('sem lance informado o conjunto vai como BID_TYPE_NO_BID', () => {
  const g = { anuncianteId: 'A', campanhaId: 'C', nome: 'n', locais: ['BR'], orcamento: 'R$ 100,00', inicio: '2026-10-01 00:00:00' };
  assert.equal(normalizarConjunto(g).conjunto.bid_type, 'BID_TYPE_NO_BID');
  const comLance = normalizarConjunto({ ...g, lance: 'R$ 1,50' }).conjunto;
  assert.equal(comLance.bid_type, 'BID_TYPE_CUSTOM');
  assert.equal(comLance.bid_price, 1.5);
});

test('anuncio exige identidade, video e texto dentro do limite', () => {
  const a = { anuncianteId: 'A', conjuntoId: 'G', nome: 'ad', videoId: 'V', texto: 'compre', identidadeId: 'ID' };
  assert.deepEqual(normalizarAnuncio(a).erros, []);
  assert.ok(normalizarAnuncio({ ...a, identidadeId: '' }).erros.some((e) => /identidadeId/.test(e)));
  assert.ok(normalizarAnuncio({ ...a, texto: 'x'.repeat(101) }).erros.some((e) => /100 caracteres/.test(e)));
  assert.ok(normalizarAnuncio({ ...a, destino: 'ftp://x' }).erros.some((e) => /http/.test(e)));
});

test('mudarStatus valida o status e a lista', async () => {
  assert.match((await mudarStatus(ctx(), 'A', [], 'ENABLE')).motivo, /ao menos uma campanhaId/);
  assert.match((await mudarStatus(ctx(), 'A', ['C1'], 'LIGAR')).motivo, /status inválido/);
  const cap = {};
  await mudarStatus(ctx(cap), 'A', 'C1', 'disable');
  assert.deepEqual(JSON.parse(cap.opts.body).campaign_ids, ['C1']);
  assert.equal(JSON.parse(cap.opts.body).operation_status, 'DISABLE');
});

test('atualizar sem mudanca nao gasta chamada', async () => {
  const cap = {};
  const r = await atualizar(ctx(cap), 'A', 'C1', {});
  assert.equal(cap.chamou, undefined);
  assert.match(r.motivo, /nada pra atualizar/);
});

test('filtro da listagem vai JSON-encodado na query (exigencia da Ads API)', async () => {
  const cap = {};
  await listar(ctx(cap), 'ADV1', { ids: ['C1', 'C2'] });
  assert.match(decodeURIComponent(cap.url), /filtering=\{"campaign_ids":\["C1","C2"\]\}/);
});

test('relatorio valida o periodo antes de chamar', async () => {
  const cap = {};
  assert.match((await relatorio(ctx(cap), 'A', { inicio: '01/09/2026', fim: '2026-09-30' })).motivo, /início inválido/);
  assert.match((await relatorio(ctx(cap), 'A', { inicio: '2026-09-30', fim: '2026-09-01' })).motivo, /depois do início/);
  assert.equal(cap.chamou, undefined);
});

test('relatorio normaliza as linhas e nao inventa zero', async () => {
  const cap = {};
  const corpo = {
    code: 0,
    data: { list: [{ dimensions: { campaign_id: 'C1' }, metrics: { spend: '12.34', clicks: '5', impressions: '1000', conversion: null } }] },
  };
  const r = await relatorio(ctx(cap, corpo), 'ADV1', { inicio: '2026-09-01', fim: '2026-09-30' });
  assert.equal(r.ok, true);
  const l = r.linhas[0];
  assert.equal(l.campanhaId, 'C1');
  assert.equal(l.gastoCentavos, 1234);
  assert.equal(l.cliques, 5);
  assert.equal(l.conversoes, null, 'metrica ausente tem que ser null, nunca 0');
  assert.match(decodeURIComponent(cap.url), /data_level=AUCTION_CAMPAIGN/);
});

test('linha sem metrica nenhuma fica toda null, com gasto "—"', () => {
  const l = normalizarLinhaRelatorio({});
  assert.equal(l.gastoCentavos, null);
  assert.equal(l.gastoFormatado, '—');
  assert.equal(l.impressoes, null);
});
