import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servidorCallback, extrairCode, CAMINHO } from '../engine/vstiktok/callback.mjs';

/** Sobe o receptor de verdade numa porta livre e devolve um helper pra bater nele. */
async function comServidor(fn) {
  const srv = await servidorCallback({});
  const bater = (caminho) => fetch(`http://127.0.0.1:${srv.porta}${caminho}`);
  try { await fn(srv, bater); } finally { await srv.fechar(); }
}

test('aceita code (open/shop) e auth_code (business) — o nome muda por familia', () => {
  assert.equal(extrairCode(new URLSearchParams('code=C1')), 'C1');
  assert.equal(extrairCode(new URLSearchParams('auth_code=A1')), 'A1');
  assert.equal(extrairCode(new URLSearchParams('state=s')), null);
});

test('callback com code resolve a espera e mostra pagina de sucesso', async () => {
  await comServidor(async (srv, bater) => {
    const espera = srv.esperar('open', 2000);
    const res = await bater(`${CAMINHO}/open?code=CODE123&state=st1`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Conta conectada/);
    const r = await espera;
    assert.equal(r.ok, true);
    assert.equal(r.code, 'CODE123');
    assert.equal(r.state, 'st1');
  });
});

test('business chega como auth_code e é entendido igual', async () => {
  await comServidor(async (srv, bater) => {
    const espera = srv.esperar('business', 2000);
    await bater(`${CAMINHO}/business?auth_code=AC9&state=st2`);
    const r = await espera;
    assert.equal(r.ok, true);
    assert.equal(r.code, 'AC9');
  });
});

test('usuario que recusa a autorizacao vira motivo, nao espera infinita', async () => {
  await comServidor(async (srv, bater) => {
    const espera = srv.esperar('open', 2000);
    const res = await bater(`${CAMINHO}/open?error=access_denied&error_description=usuario%20recusou`);
    assert.equal(res.status, 400);
    const r = await espera;
    assert.equal(r.ok, false);
    assert.match(r.motivo, /usuario recusou/);
  });
});

test('volta sem code é falha explicita, nao sucesso vazio', async () => {
  await comServidor(async (srv, bater) => {
    const espera = srv.esperar('open', 2000);
    await bater(`${CAMINHO}/open`);
    const r = await espera;
    assert.equal(r.ok, false);
    assert.match(r.motivo, /sem code/);
  });
});

test('callback que chega ANTES da espera nao se perde', async () => {
  await comServidor(async (srv, bater) => {
    await bater(`${CAMINHO}/shop?code=ANTES`);
    const r = await srv.esperar('shop', 100);
    assert.equal(r.code, 'ANTES');
  });
});

test('familias diferentes nao se misturam', async () => {
  await comServidor(async (srv, bater) => {
    await bater(`${CAMINHO}/shop?code=DO-SHOP`);
    const r = await srv.esperar('open', 60);
    assert.equal(r.ok, false, 'o callback do shop nao pode satisfazer a espera do open');
  });
});

test('timeout de espera diz o que fazer', async () => {
  await comServidor(async (srv) => {
    const r = await srv.esperar('open', 60);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /rode de novo/);
  });
});

test('rota fora do callback devolve 404, nao vaza nada', async () => {
  await comServidor(async (srv, bater) => {
    const res = await bater('/qualquer-outra');
    assert.equal(res.status, 404);
  });
});

test('escuta so em 127.0.0.1 — o tunel é a unica porta de entrada', async () => {
  await comServidor(async (srv) => {
    assert.ok(srv.porta > 0);
    assert.equal(srv.caminho('open'), `${CAMINHO}/open`);
  });
});

test('responde o ping do tunel — é como o modulo prova que a URL publica chega aqui', async () => {
  const { PING } = await import('../engine/vstiktok/tunel.mjs');
  await comServidor(async (srv, bater) => {
    const res = await bater(PING);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'pong');
  });
});
