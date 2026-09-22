import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  faltaCredencial, urlAutorizacao, urlAutorizacaoBusiness, urlAutorizacaoShop,
  trocarCodigo, renovar, garantirToken, expirado, normalizarTokenOpen, normalizarTokenShop,
} from '../engine/vstiktok/auth.mjs';

const fake = (status, corpo, cap = {}) => async (url, opts) => {
  cap.url = url; cap.opts = opts;
  return { status, json: async () => corpo };
};

test('diz o que falta no app ANTES de tentar autorizar', () => {
  assert.deepEqual(faltaCredencial('open', {}), ['clientKey', 'clientSecret']);
  /* O serviceId entrou nos obrigatorios: sem ele nao ha URL de autorizacao, e
     o botao "Conectar" apareceria so pra quebrar no clique do revisor. */
  assert.deepEqual(faltaCredencial('shop', { appKey: 'a' }), ['appSecret', 'serviceId']);
  assert.deepEqual(faltaCredencial('shop', { appKey: 'a', appSecret: 's' }), ['serviceId']);
  assert.deepEqual(faltaCredencial('shop', { appKey: 'a', appSecret: 's', serviceId: 'x' }), []);
  assert.deepEqual(faltaCredencial('business', { appId: '1', secret: 's' }), []);
  assert.match(faltaCredencial('orkut', {})[0], /sem suporte/);
});

test('autorizacao exige state — callback sem state aceita code de qualquer origem', () => {
  const r = urlAutorizacao({ clientKey: 'ck', redirectUri: 'https://x.com/cb' });
  assert.ok(r.erros.some((e) => /state/.test(e)));
});

test('a TikTok so aceita redirect https', () => {
  const r = urlAutorizacao({ clientKey: 'ck', redirectUri: 'http://x.com/cb', state: 's' });
  assert.ok(r.erros.some((e) => /https/.test(e)));
});

test('URL de consentimento sai montada e escapada', () => {
  const r = urlAutorizacao({ clientKey: 'ck', redirectUri: 'https://x.com/cb?a=1', state: 'st' });
  assert.deepEqual(r.erros, []);
  assert.match(r.url, /client_key=ck/);
  assert.match(r.url, /redirect_uri=https%3A%2F%2Fx\.com%2Fcb%3Fa%3D1/);
  assert.match(r.url, /state=st/);
  assert.match(urlAutorizacaoBusiness({ appId: '77', state: 's' }).url, /app_id=77/);
  assert.match(urlAutorizacaoShop({ serviceId: 'sv', state: 's' }).url, /service_id=sv/);
});

test('troca do code guarda QUANDO vence, nao so o token', async () => {
  const r = await trocarCodigo('open', { clientKey: 'ck', clientSecret: 'cs', redirectUri: 'https://x/cb' }, 'CODE', {
    fetchImpl: fake(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'OID' }),
    agora: () => Date.parse('2026-09-17T00:00:00.000Z'),
  });
  assert.equal(r.ok, true);
  assert.equal(r.token.accessToken, 'AT');
  assert.equal(r.token.expiraEm, '2026-09-18T00:00:00.000Z');
  assert.equal(r.token.openId, 'OID');
});

test('open sem redirectUri nem tenta — a TikTok exige o MESMO da autorizacao', async () => {
  let chamou = false;
  const r = await trocarCodigo('open', { clientKey: 'ck', clientSecret: 'cs' }, 'CODE', { fetchImpl: async () => { chamou = true; } });
  assert.equal(chamou, false);
  assert.match(r.motivo, /redirectUri/);
});

test('token do Shop vem em epoch, nao em duracao', () => {
  const t = normalizarTokenShop({ access_token: 'AT', access_token_expire_in: 1789000000 }, Date.now());
  assert.equal(t.expiraEm, new Date(1789000000 * 1000).toISOString());
});

test('token do Ads nao finge prazo que a API nao deu', async () => {
  const r = await trocarCodigo('business', { appId: '1', secret: 's' }, 'C', {
    fetchImpl: fake(200, { code: 0, data: { access_token: 'AT', advertiser_ids: ['A1'] } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.token.expiraEm, null, 'prazo desconhecido tem que ser null, nao uma data inventada');
  assert.deepEqual(r.token.anunciantes, ['A1']);
});

test('expirado respeita a margem e nao chuta quando o prazo é desconhecido', () => {
  const agora = Date.parse('2026-09-17T12:00:00.000Z');
  assert.equal(expirado({ expiraEm: '2026-09-17T12:02:00.000Z' }, agora, 300), true, '2 min pra vencer ja conta como vencido');
  assert.equal(expirado({ expiraEm: '2026-09-17T18:00:00.000Z' }, agora, 300), false);
  assert.equal(expirado({ expiraEm: null }, agora), false, 'prazo desconhecido nao pode gastar refresh à toa');
});

test('garantirToken renova sozinho quando esta pra vencer', async () => {
  const agora = Date.parse('2026-09-17T12:00:00.000Z');
  const r = await garantirToken('open',
    { clientKey: 'ck', clientSecret: 'cs' },
    { accessToken: 'VELHO', refreshToken: 'RT', expiraEm: '2026-09-17T12:01:00.000Z' },
    { agora: () => agora, fetchImpl: fake(200, { access_token: 'NOVO', refresh_token: 'RT2', expires_in: 86400 }) });
  assert.equal(r.ok, true);
  assert.equal(r.renovado, true);
  assert.equal(r.token.accessToken, 'NOVO');
});

test('garantirToken nao gasta chamada com token valido', async () => {
  let chamou = false;
  const r = await garantirToken('open', {}, { accessToken: 'BOM', expiraEm: '2099-01-01T00:00:00.000Z' }, {
    agora: () => Date.parse('2026-09-17T12:00:00.000Z'),
    fetchImpl: async () => { chamou = true; },
  });
  assert.equal(chamou, false);
  assert.equal(r.renovado, false);
});

test('sem token guardado o erro manda autorizar, nao "falha de rede"', async () => {
  const r = await garantirToken('open', {}, {}, {});
  assert.equal(r.ok, false);
  assert.equal(r.reautorizar, true);
  assert.match(r.motivo, /autorize o app/);
});

test('Ads nao tem refresh — o erro diz isso em vez de tentar e falhar', async () => {
  const r = await renovar('business', { appId: '1', secret: 's' }, { accessToken: 'AT' }, {});
  assert.equal(r.ok, false);
  assert.equal(r.reautorizar, true);
  assert.match(r.motivo, /nao tem refresh/);
});

test('refresh vencido manda reautorizar em vez de queimar chamada', async () => {
  const r = await renovar('open', {}, { refreshToken: 'RT', refreshExpiraEm: '2020-01-01T00:00:00.000Z' }, {
    agora: () => Date.parse('2026-09-17T12:00:00.000Z'),
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /refresh_token tambem venceu/);
});

test('normalizarTokenOpen aguenta payload vazio', () => {
  const t = normalizarTokenOpen({}, 0);
  assert.equal(t.accessToken, null);
  assert.equal(t.expiraEm, null);
});
