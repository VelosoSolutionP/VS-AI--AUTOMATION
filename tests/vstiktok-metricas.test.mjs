import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfil, listarVideos, consultarVideos, coletarMetricas } from '../engine/vstiktok/metricas.mjs';

const ctx = (cap = {}, corpo = { data: {}, error: { code: 'ok' } }, status = 200) => ({
  token: 't',
  fetchImpl: async (url, opts) => { cap.url = url; cap.opts = opts; cap.chamou = true; return { status, json: async () => corpo }; },
});

test('consulta de video é POST com filters.video_ids no corpo (era o bug: ia GET sem corpo)', async () => {
  const cap = {};
  await consultarVideos(ctx(cap, { data: { videos: [] }, error: { code: 'ok' } }), ['v1', 'v2']);
  assert.equal(cap.opts.method, 'POST');
  assert.match(cap.url, /\/v2\/video\/query\//);
  assert.deepEqual(JSON.parse(cap.opts.body), { filters: { video_ids: ['v1', 'v2'] } });
});

test('os campos pedidos vao na query, nao no corpo', async () => {
  const cap = {};
  await consultarVideos(ctx(cap, { data: { videos: [] }, error: { code: 'ok' } }), ['v1']);
  assert.match(decodeURIComponent(cap.url), /fields=.*view_count/);
});

test('lista vazia nao vira chamada', async () => {
  const cap = {};
  const r = await consultarVideos(ctx(cap), []);
  assert.equal(cap.chamou, undefined);
  assert.match(r.motivo, /ao menos um videoId/);
});

test('acima de 20 ids é barrado aqui — é o limite da TikTok', async () => {
  const cap = {};
  const r = await consultarVideos(ctx(cap), Array.from({ length: 21 }, (_, i) => `v${i}`));
  assert.equal(cap.chamou, undefined);
  assert.match(r.motivo, /máximo 20 ids/);
});

test('metrica sai normalizada a partir de data.videos[], nao da raiz de data', async () => {
  const corpo = {
    data: { videos: [{ id: 'v1', view_count: 1200, like_count: 80, comment_count: 9, share_count: 3 }] },
    error: { code: 'ok' },
  };
  const r = await coletarMetricas(ctx({}, corpo), ['v1'], { agora: () => '2026-09-17T00:00:00.000Z' });
  assert.equal(r.ok, true);
  const m = r.medicoes[0];
  assert.equal(m.videoId, 'v1');
  assert.equal(m.views, 1200);
  assert.equal(m.likes, 80);
  assert.equal(m.comentarios, 9);
  assert.equal(m.compartilhamentos, 3);
  assert.equal(m.dislikes, null, 'TikTok nao tem dislike: null, nunca 0');
  assert.equal(m.coletadoEm, '2026-09-17T00:00:00.000Z');
});

test('id que a TikTok OMITE volta listado em ausentes, em vez de sumir calado', async () => {
  const corpo = { data: { videos: [{ id: 'v1', view_count: 10 }] }, error: { code: 'ok' } };
  const r = await coletarMetricas(ctx({}, corpo), ['v1', 'v2']);
  assert.deepEqual(r.ausentes, ['v2']);
  assert.equal(r.medicoes.length, 1);
});

test('token revogado (HTTP 200 com error.code) nao vira medicao inventada', async () => {
  const corpo = { error: { code: 'access_token_invalid', message: 'token invalid' } };
  const r = await coletarMetricas(ctx({}, corpo), ['v1']);
  assert.equal(r.ok, false);
  assert.equal(r.medicoes, undefined);
  assert.match(r.motivo, /credencial invalida/);
});

test('perfil devolve a conta e os numeros em forma limpa', async () => {
  const corpo = { data: { user: { open_id: 'OID', display_name: 'Fabiano', follower_count: 1200, video_count: 40 } }, error: { code: 'ok' } };
  const r = await perfil(ctx({}, corpo));
  assert.equal(r.ok, true);
  assert.equal(r.conta, 'Fabiano');
  assert.equal(r.perfil.seguidores, 1200);
  assert.equal(r.perfil.curtidas, null, 'campo nao devolvido fica null');
});

test('listagem de video pagina por cursor e respeita o teto de 20', async () => {
  const cap = {};
  const corpo = { data: { videos: [{ id: 'v1' }], cursor: 123, has_more: true }, error: { code: 'ok' } };
  const r = await listarVideos(ctx(cap, corpo), { quantidade: 99, cursor: 50 });
  assert.equal(JSON.parse(cap.opts.body).max_count, 20);
  assert.equal(JSON.parse(cap.opts.body).cursor, 50);
  assert.equal(r.temMais, true);
  assert.equal(r.cursor, 123);
});
