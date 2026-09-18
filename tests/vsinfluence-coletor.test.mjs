import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDENCIAL, faltaCredencial, urlTeste, urlMetrica, explicarFalha,
  identificarConta, testarConexao, coletarMetrica,
} from '../engine/vsinfluence/coletor.mjs';

/** fetch falso: devolve o que o teste mandar, sem tocar na rede. */
const fake = (status, corpo, capturar) => async (url, opts) => {
  if (capturar) { capturar.url = url; capturar.opts = opts; }
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
};

test('diz o que falta ANTES de tentar a chamada', () => {
  assert.deepEqual(faltaCredencial('youtube', {}), ['apiKey']);
  assert.deepEqual(faltaCredencial('instagram', { token: 'x' }), ['userId']);
  assert.deepEqual(faltaCredencial('tiktok', { token: 'x' }), []);
  assert.match(faltaCredencial('orkut', {})[0], /sem coletor/);
});

test('todas as redes coletaveis tem credencial declarada', () => {
  for (const r of Object.keys(CREDENCIAL)) {
    assert.ok(CREDENCIAL[r].campos.length > 0, r + ' sem campos');
    assert.ok(CREDENCIAL[r].nome, r + ' sem nome');
  }
});

test('url de teste sai montada e com o token escapado', () => {
  assert.match(urlTeste('youtube', { apiKey: 'a b' }).url, /key=a%20b/);
  assert.match(urlTeste('instagram', { userId: '123', token: 't' }).url, /123\?fields=id,username/);
  assert.equal(urlTeste('tiktok', { token: 'tk' }).headers.authorization, 'Bearer tk');
  assert.match(urlTeste('facebook', { token: 't' }).url, /me\?fields=id,name/);
  assert.match(urlTeste('orkut', {}).erro, /sem coletor/);
});

test('token vai no header do TikTok, nunca na URL', async () => {
  const cap = {};
  await testarConexao('tiktok', { token: 'segredo' }, fake(200, { data: { user: { display_name: 'Fabiano' } } }, cap));
  assert.ok(!cap.url.includes('segredo'), 'token vazou na URL');
  assert.equal(cap.opts.headers.authorization, 'Bearer segredo');
});

test('conexao boa devolve a conta identificada', async () => {
  const r = await testarConexao('tiktok', { token: 't' }, fake(200, { data: { user: { display_name: 'Fabiano' } } }));
  assert.equal(r.ok, true);
  assert.equal(r.conta, 'Fabiano');
  const i = await testarConexao('instagram', { token: 't', userId: '1' }, fake(200, { username: 'veloso' }));
  assert.equal(i.conta, '@veloso');
});

test('falha da API vira motivo em portugues, nao codigo cru', async () => {
  const r401 = await testarConexao('facebook', { token: 'x' }, fake(401, { error: {} }));
  assert.equal(r401.ok, false);
  assert.match(r401.motivo, /credencial invalida|sem permissao/);
  const exp = await testarConexao('facebook', { token: 'x' }, fake(401, { error: { message: 'Session has expired' } }));
  assert.match(exp.motivo, /expirada/);
  // YouTube: 400 com "API key not valid" tambem e credencial ruim, nao erro de campo.
  const yt400 = await testarConexao('youtube', { apiKey: 'x' },
    fake(400, { error: { message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } }));
  assert.match(yt400.motivo, /credencial invalida/);
  // A Meta devolve 400 com OAuthException para token invalido — nao pode virar "confira id/campos".
  const meta400 = await testarConexao('facebook', { token: 'x' },
    fake(400, { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } }));
  assert.match(meta400.motivo, /credencial invalida/);
  assert.doesNotMatch(meta400.motivo, /id\/campos/);
  // 400 sem cara de token continua sendo erro de requisicao.
  assert.match(explicarFalha('instagram', 400, { error: { message: 'unknown field' } }), /id\/campos/);
  assert.match(explicarFalha('youtube', 429), /limite/);
  assert.match(explicarFalha('youtube', 503), /lado dela/);
  assert.match(explicarFalha('youtube', 404), /nao encontrado/);
});

test('credencial faltando nao chega a chamar a rede', async () => {
  let chamou = false;
  const r = await testarConexao('youtube', {}, async () => { chamou = true; });
  assert.equal(chamou, false);
  assert.equal(r.ok, false);
  assert.deepEqual(r.faltando, ['apiKey']);
});

test('rede fora do ar nao lanca excecao — volta motivo', async () => {
  const r = await testarConexao('facebook', { token: 't' }, async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /falha de rede/);
});

test('timeout vira motivo legivel', async () => {
  const abortar = async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; };
  const r = await testarConexao('facebook', { token: 't' }, abortar, 3000);
  assert.match(r.motivo, /sem resposta em 3s/);
});

test('coleta de metrica volta normalizada, com dislike null', async () => {
  const yt = { items: [{ statistics: { viewCount: '1200', likeCount: '80', commentCount: '9' } }] };
  const r = await coletarMetrica('youtube', 'vid1', { apiKey: 'k' }, fake(200, yt), () => '2026-09-17T00:00:00.000Z');
  assert.equal(r.ok, true);
  assert.equal(r.medicao.views, 1200);
  assert.equal(r.medicao.likes, 80);
  assert.equal(r.medicao.dislikes, null, 'dislike tem que ser null, nunca 0');
  assert.equal(r.medicao.coletadoEm, '2026-09-17T00:00:00.000Z');
});

test('coleta que falha nao devolve medicao inventada', async () => {
  const r = await coletarMetrica('tiktok', 'v', { token: 't' }, fake(403, {}));
  assert.equal(r.ok, false);
  assert.equal(r.medicao, undefined);
  assert.match(r.motivo, /credencial invalida|sem permissao/);
});

test('url de metrica por rede', () => {
  assert.match(urlMetrica('youtube', 'abc', { apiKey: 'k' }).url, /part=statistics&id=abc/);
  assert.match(urlMetrica('instagram', '99', { token: 't' }).url, /99\/insights/);
  assert.equal(urlMetrica('tiktok', 'x', { token: 't' }).headers.authorization, 'Bearer t');
  assert.match(urlMetrica('orkut', 'x', {}).erro, /sem coletor/);
});

test('identificarConta aguenta payload vazio', () => {
  assert.equal(identificarConta('youtube', null), null);
  assert.equal(identificarConta('tiktok', {}), null);
});

/* ---- regressao: a coleta do TikTok nunca funcionou contra a API de producao ---- */

test('metrica do TikTok vai POST com filters.video_ids — GET sem corpo nunca traz o video', async () => {
  const cap = {};
  const corpo = { data: { videos: [{ id: 'v1', view_count: 500, like_count: 20, comment_count: 4, share_count: 2 }] }, error: { code: 'ok' } };
  const r = await coletarMetrica('tiktok', 'v1', { token: 't' }, fake(200, corpo, cap), () => '2026-09-17T00:00:00.000Z');
  assert.equal(cap.opts.method, 'POST');
  assert.deepEqual(JSON.parse(cap.opts.body), { filters: { video_ids: ['v1'] } });
  assert.equal(r.ok, true);
  assert.equal(r.medicao.views, 500, 'os numeros vem de data.videos[], nao da raiz de data');
  assert.equal(r.medicao.compartilhamentos, 2);
  assert.equal(r.medicao.dislikes, null);
});

test('TikTok que responde 200 com error.code nao passa como sucesso', async () => {
  const corpo = { error: { code: 'access_token_invalid', message: 'token invalid' } };
  const conexao = await testarConexao('tiktok', { token: 't' }, fake(200, corpo));
  assert.equal(conexao.ok, false);
  assert.match(conexao.motivo, /credencial invalida/);

  const metrica = await coletarMetrica('tiktok', 'v1', { token: 't' }, fake(200, corpo));
  assert.equal(metrica.ok, false);
  assert.equal(metrica.medicao, undefined);
});

test('video que a rede nao devolveu vira motivo, nao medicao zerada', async () => {
  const r = await coletarMetrica('tiktok', 'v9', { token: 't' }, fake(200, { data: { videos: [] }, error: { code: 'ok' } }));
  assert.equal(r.ok, false);
  assert.equal(r.medicao, undefined);
  assert.match(r.motivo, /nao devolveu esse video/);
});

test('escopo faltando é explicado como escopo, nao como token errado', () => {
  assert.match(explicarFalha('tiktok', 200, { error: { code: 'scope_not_authorized' } }), /escopo/);
});
