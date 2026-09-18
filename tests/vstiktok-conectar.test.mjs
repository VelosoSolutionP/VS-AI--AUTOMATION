import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vstiktok-con-'));
process.env.VSTIKTOK_DIR = dir;

const vs = await import('../engine/vstiktok/index.mjs');
const { conectar, testar, ONDE_COLAR } = await import('../engine/vstiktok/conectar.mjs');
const { CAMINHO } = await import('../engine/vstiktok/callback.mjs');
const { PING } = await import('../engine/vstiktok/tunel.mjs');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/** Porta livre de verdade: o receptor sobe nela e o teste bate nela. */
function portaLivre() {
  return new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
  });
}

const URL_FALSA = 'https://teste.lhr.life';

/** Túnel falso que publica uma URL na hora. */
const spawnFalso = () => {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.kill = () => { p.morto = true; };
  setImmediate(() => p.stdout.emit('data', `Connect to ${URL_FALSA}`));
  return p;
};

/** fetch que atende o ping do túnel e a troca de token. */
const fetchFalso = (tokenCorpo) => async (url) => {
  if (String(url).includes(PING)) { return { status: 200, json: async () => ({}) }; }
  return { status: 200, json: async () => tokenCorpo };
};

test('sem credencial do app, conectar diz o comando exato que falta', async () => {
  const r = await conectar('open', { semConfirmar: true, semNavegador: true, log: () => {} });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /vstiktok app open clientKey=/);
});

test('shop sem serviceId é barrado antes de subir tunel', async () => {
  vs.salvarCredencial('shop', { appKey: 'ak', appSecret: 'as' });
  let subiu = false;
  const r = await conectar('shop', { semConfirmar: true, semNavegador: true, log: () => {}, spawnImpl: () => { subiu = true; } });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /serviceId/);
  assert.equal(subiu, false, 'nao pode gastar tunel numa config que ja sabia estar incompleta');
});

test('cada familia diz ONDE colar a URL de retorno', () => {
  assert.match(ONDE_COLAR.open, /developers\.tiktok\.com/);
  assert.match(ONDE_COLAR.business, /business-api/);
  assert.match(ONDE_COLAR.shop, /partner\.tiktokshop/);
});

test('fluxo completo: tunel -> autorizacao -> callback -> token guardado', async () => {
  vs.salvarCredencial('open', { clientKey: 'CK', clientSecret: 'CS' });
  const porta = await portaLivre();

  const promessa = conectar('open', {
    porta, semConfirmar: true, semNavegador: true, log: () => {},
    spawnImpl: spawnFalso,
    fetchImpl: fetchFalso({ access_token: 'AT-REAL', refresh_token: 'RT', expires_in: 86400, open_id: 'OID' }),
  });

  // Simula o navegador voltando do TikTok pro redirect_uri.
  let entregue = false;
  for (let i = 0; i < 40 && !entregue; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      const res = await fetch(`http://127.0.0.1:${porta}${CAMINHO}/open?code=CODE-DO-TIKTOK&state=${vs.getConfig().state_open}`);
      entregue = res.status === 200;
    } catch { /* receptor ainda subindo */ }
  }

  const r = await promessa;
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.redirectUri, `${URL_FALSA}${CAMINHO}/open`);
  assert.equal(vs.getTokens().open.accessToken, 'AT-REAL');
  // O redirect do tunel tem que ficar gravado: a troca do code exige o MESMO valor.
  assert.equal(vs.getCredenciais().open.redirectUri, `${URL_FALSA}${CAMINHO}/open`);
});

test('recusa do usuario no callback volta como motivo, sem gravar token', async () => {
  vs.salvarCredencial('business', { appId: '1', secret: 's' });
  const porta = await portaLivre();
  const promessa = conectar('business', {
    porta, semConfirmar: true, semNavegador: true, log: () => {}, spawnImpl: spawnFalso, fetchImpl: fetchFalso({}),
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      const res = await fetch(`http://127.0.0.1:${porta}${CAMINHO}/business?error=access_denied&error_description=recusou`);
      if (res.status === 400) { break; }
    } catch { /* subindo */ }
  }

  const r = await promessa;
  assert.equal(r.ok, false);
  assert.match(r.motivo, /recusou/);
  assert.equal(vs.getTokens().business, undefined);
});

test('tunel que nao sobe derruba o receptor e explica', async () => {
  vs.salvarCredencial('open', { clientKey: 'CK', clientSecret: 'CS' });
  const r = await conectar('open', {
    semConfirmar: true, semNavegador: true, log: () => {},
    spawnImpl: () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; setImmediate(() => p.emit('exit', 1)); return p; },
    esperar: async () => {},
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nenhum tunel funcionou/);
});

test('testar sem token nao finge prova — diz que falta autorizar', async () => {
  const t = await testar('shop');
  assert.equal(t.ok, false);
  assert.deepEqual(t.provas, []);
  assert.match(t.motivo, /autorize o app|falta preencher/);
});

test('testar bate na API e reporta cada chamada', async () => {
  const t = await testar('open', {
    agora: () => Date.now(),
    fetchImpl: async (url) => {
      if (url.includes('/user/info/')) { return { status: 200, json: async () => ({ data: { user: { display_name: 'Fabiano', follower_count: 10 } }, error: { code: 'ok' } }) }; }
      if (url.includes('/video/list/')) { return { status: 200, json: async () => ({ data: { videos: [{ id: 'v1' }] }, error: { code: 'ok' } }) }; }
      return { status: 200, json: async () => ({ data: { videos: [{ id: 'v1', view_count: 99 }] }, error: { code: 'ok' } }) };
    },
  });
  assert.equal(t.ok, true);
  assert.equal(t.provas.length, 3);
  assert.match(t.provas[0].chamada, /user\/info/);
  assert.match(t.provas[0].detalhe, /Fabiano/);
  assert.match(t.provas[2].detalhe, /views 99/);
});

test('falha da API aparece na prova, sem derrubar as outras', async () => {
  const t = await testar('open', {
    fetchImpl: async () => ({ status: 401, json: async () => ({ error: { code: 'access_token_invalid', message: 'invalid' } }) }),
  });
  assert.equal(t.ok, false);
  assert.equal(t.provas.length, 1);
  assert.match(t.provas[0].detalhe, /credencial invalida/);
});
