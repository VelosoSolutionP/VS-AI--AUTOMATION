import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assinarShop, interpretar, explicarErro, retentavel, chamar } from '../engine/vstiktok/api.mjs';

/** fetch falso: devolve o que o teste mandar e guarda o que foi enviado. */
const fake = (respostas, cap = {}) => {
  const fila = Array.isArray(respostas) ? [...respostas] : [respostas];
  return async (url, opts) => {
    cap.url = url;
    cap.opts = opts;
    cap.chamadas = (cap.chamadas || 0) + 1;
    const r = fila.length > 1 ? fila.shift() : fila[0];
    return { status: r.status, json: async () => r.corpo };
  };
};

const semDormir = async () => {};

test('assinatura do Shop segue o algoritmo da TikTok, com o caminho na frente', () => {
  const sign = assinarShop({
    caminho: '/product/202309/products',
    query: { app_key: 'ak', timestamp: 1700000000, sign: 'ignorado', access_token: 'ignorado' },
    corpo: '{"title":"x"}',
    appSecret: 'segredo',
  });
  // app_secret + caminho + (chaves ordenadas) + corpo + app_secret
  const esperado = createHmac('sha256', 'segredo')
    .update('segredo/product/202309/productsapp_keyaktimestamp1700000000{"title":"x"}segredo', 'utf8')
    .digest('hex');
  assert.equal(sign, esperado);
});

test('sign e access_token ficam FORA da assinatura', () => {
  const base = { caminho: '/p', query: { a: '1' }, appSecret: 's' };
  const semRuido = assinarShop(base);
  const comRuido = assinarShop({ ...base, query: { a: '1', sign: 'xxx', access_token: 'yyy' } });
  assert.equal(semRuido, comRuido);
});

test('multipart nao entra na assinatura', () => {
  const a = assinarShop({ caminho: '/p', query: {}, corpo: 'conteudo', appSecret: 's', multipart: true });
  const b = assinarShop({ caminho: '/p', query: {}, corpo: null, appSecret: 's' });
  assert.equal(a, b);
});

test('open: HTTP 200 com error.code != "ok" é FALHA, nao sucesso', () => {
  const r = interpretar('open', 200, { error: { code: 'access_token_invalid', message: 'token invalid', log_id: 'L1' } });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /credencial invalida/);
  assert.equal(r.logId, 'L1');
});

test('open: code "ok" é sucesso e os dados saem de data', () => {
  const r = interpretar('open', 200, { data: { user: { display_name: 'Fabiano' } }, error: { code: 'ok' } });
  assert.equal(r.ok, true);
  assert.equal(r.dados.user.display_name, 'Fabiano');
});

test('open: endpoint de token erra no padrao OAuth (error como string)', () => {
  // O que este teste guarda e a LEITURA do formato (error/error_description como
  // string na raiz, fora do padrao do resto da TikTok). A frase e a de reconectar:
  // nesse ponto do fluxo nao existe token nenhum pra renovar.
  const r = interpretar('open', 400, { error: 'invalid_grant', error_description: 'authorization code expired' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Conectar conta/);
});

test('open: token bom devolve os campos da raiz, sem exigir data', () => {
  const r = interpretar('open', 200, { access_token: 'AT', expires_in: 86400 });
  assert.equal(r.ok, true);
  assert.equal(r.dados.access_token, 'AT');
});

test('business/shop: code 0 é sucesso, qualquer outro é falha', () => {
  assert.equal(interpretar('business', 200, { code: 0, data: { list: [] } }).ok, true);
  const r = interpretar('business', 200, { code: 40002, message: 'No permission to operate advertiser', request_id: 'R9' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /escopo|permissao/i);
  assert.equal(r.logId, 'R9');
});

test('erro de sign do Shop vira frase acionavel, nao codigo cru', () => {
  const r = interpretar('shop', 200, { code: 105002, message: 'invalid signature' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /credencial invalida ou revogada/);
});

test('app nao auditado é explicado, nao vira "resposta inesperada"', () => {
  assert.match(explicarErro('open', 200, 'unaudited_client', 'app not audited'), /nao auditado/);
});

/* A resposta ABAIXO e a que a TikTok devolve de verdade quando o code do OAuth ja
   foi usado (conferido contra open.tiktokapis.com em 19/09/2026). Ela diz "expired",
   e o mapeamento generico mandava "renove o token" — token que ainda nem existe
   nesse ponto do fluxo. O teste existe pra essa frase nao voltar a ser generica. */
test('code de OAuth queimado manda reconectar, nao renovar token', () => {
  const m = explicarErro('open', 200, 'invalid_grant', 'Authorization code is expired.');
  assert.match(m, /Conectar conta/);
  assert.doesNotMatch(m, /renove o token/);
});

test('client key/secret errados sao ditos pelo nome', () => {
  assert.match(explicarErro('open', 200, 'invalid_client', 'Client key or secret is incorrect.'), /client key ou client secret/i);
});

test('redirect_uri diferente do cadastrado aponta pra URL da tela', () => {
  assert.match(explicarErro('open', 200, 'invalid_request', 'Redirect_uri mismatch.'), /URL de retorno/i);
});

test('token de API expirado continua mandando renovar', () => {
  assert.match(explicarErro('open', 401, 'access_token_invalid', 'access token is expired'), /renove o token/);
});

test('so o que é transitorio é retentavel', () => {
  assert.equal(retentavel(429), true);
  assert.equal(retentavel(503), true);
  assert.equal(retentavel(401), false);
  assert.equal(retentavel(400), false);
});

test('token vai no header certo de cada familia', async () => {
  const cap = {};
  await chamar('open', '/v2/user/info/', { token: 't1', fetchImpl: fake({ status: 200, corpo: { data: {} } }, cap) });
  assert.equal(cap.opts.headers.authorization, 'Bearer t1');

  const cap2 = {};
  await chamar('business', '/campaign/get/', { token: 't2', fetchImpl: fake({ status: 200, corpo: { code: 0 } }, cap2) });
  assert.equal(cap2.opts.headers['Access-Token'], 't2');

  const cap3 = {};
  await chamar('shop', '/product/202309/products', {
    token: 't3', appKey: 'ak', appSecret: 'as', fetchImpl: fake({ status: 200, corpo: { code: 0 } }, cap3),
  });
  assert.equal(cap3.opts.headers['x-tts-access-token'], 't3');
});

test('token do Shop nunca vai na URL — so no header', async () => {
  const cap = {};
  await chamar('shop', '/product/202309/products', {
    token: 'SEGREDO', appKey: 'ak', appSecret: 'as', fetchImpl: fake({ status: 200, corpo: { code: 0 } }, cap),
  });
  assert.ok(!cap.url.includes('SEGREDO'), 'token vazou na URL');
  assert.match(cap.url, /sign=[a-f0-9]{64}/);
});

test('shop sem app_key/app_secret nem chega a chamar', async () => {
  let chamou = false;
  const r = await chamar('shop', '/x', { token: 't', fetchImpl: async () => { chamou = true; } });
  assert.equal(chamou, false);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /app_key\/app_secret/);
});

test('429 é retentado; 401 nao (credencial ruim nao melhora repetindo)', async () => {
  const cap = {};
  const r = await chamar('business', '/campaign/get/', {
    token: 't', esperar: semDormir, fetchImpl: fake([
      { status: 429, corpo: { code: 40100, message: 'rate limit' } },
      { status: 200, corpo: { code: 0, data: { list: [1] } } },
    ], cap),
  });
  assert.equal(r.ok, true);
  assert.equal(cap.chamadas, 2);

  const cap2 = {};
  await chamar('business', '/campaign/get/', {
    token: 't', esperar: semDormir, fetchImpl: fake({ status: 401, corpo: { code: 40001, message: 'bad token' } }, cap2),
  });
  assert.equal(cap2.chamadas, 1, 'nao pode repetir credencial invalida');
});

test('rede fora do ar nao lanca — volta motivo depois de esgotar as tentativas', async () => {
  let n = 0;
  const r = await chamar('open', '/v2/user/info/', {
    token: 't', tentativas: 2, esperar: semDormir,
    fetchImpl: async () => { n++; throw new Error('ECONNREFUSED'); },
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /falha de rede/);
  assert.equal(n, 2);
});

test('timeout vira motivo legivel', async () => {
  const r = await chamar('open', '/x', {
    token: 't', tentativas: 1, timeoutMs: 3000,
    fetchImpl: async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; },
  });
  assert.match(r.motivo, /sem resposta em 3s/);
});

test('corpo de OAuth vai form-encoded, nao JSON', async () => {
  const cap = {};
  await chamar('open', '', {
    urlAbsoluta: 'https://open.tiktokapis.com/v2/oauth/token/',
    metodo: 'POST', form: true, corpo: { grant_type: 'refresh_token', refresh_token: 'r1' },
    fetchImpl: fake({ status: 200, corpo: { access_token: 'x' } }, cap),
  });
  assert.equal(cap.opts.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.match(cap.opts.body, /grant_type=refresh_token/);
});
