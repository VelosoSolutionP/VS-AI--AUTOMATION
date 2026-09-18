import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { subirProvedor, verificarTunel, abrirTunel, PROVEDORES, ORDEM_AUTO, PING } from '../engine/vstiktok/tunel.mjs';

/** Processo falso: o teste empurra linhas em stdout/stderr sem subir nada. */
function procFalso() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.kill = () => { p.morto = true; };
  return p;
}

const LINHA_CF = '2026-09-17T12:00:00Z INF |  https://tres-palavras-quaisquer.trycloudflare.com  |';
const LINHA_LHR = 'Connect to http://abc.lhr.life or https://f2861140d73bbf.lhr.life';
const semDormir = async () => {};

test('cada provedor reconhece a propria URL no meio do log', () => {
  assert.equal(LINHA_CF.match(PROVEDORES.cloudflared.re)[0], 'https://tres-palavras-quaisquer.trycloudflare.com');
  assert.equal(LINHA_LHR.match(PROVEDORES['localhost.run'].re)[0], 'https://f2861140d73bbf.lhr.life');
});

test('cloudflared aponta pra 127.0.0.1, nao "localhost" (que pode virar ::1)', () => {
  assert.ok(PROVEDORES.cloudflared.args(8788).includes('http://127.0.0.1:8788'));
  assert.ok(PROVEDORES['localhost.run'].args(8788).includes('80:127.0.0.1:8788'));
});

test('le a URL do STDERR — é onde o cloudflared imprime', async () => {
  const p = procFalso();
  const promessa = subirProvedor('cloudflared', { porta: 8788, spawnImpl: () => p });
  setImmediate(() => p.stderr.emit('data', LINHA_CF));
  const r = await promessa;
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://tres-palavras-quaisquer.trycloudflare.com');
});

test('le a URL do stdout tambem', async () => {
  const p = procFalso();
  const promessa = subirProvedor('localhost.run', { porta: 8788, spawnImpl: () => p });
  setImmediate(() => p.stdout.emit('data', LINHA_LHR));
  assert.equal((await promessa).url, 'https://f2861140d73bbf.lhr.life');
});

test('fechar derruba o processo do tunel', async () => {
  const p = procFalso();
  const promessa = subirProvedor('cloudflared', { porta: 8788, spawnImpl: () => p });
  setImmediate(() => p.stderr.emit('data', LINHA_CF));
  (await promessa).fechar();
  assert.equal(p.morto, true);
});

test('binario ausente vira instrucao de instalacao, nao stack trace', async () => {
  const p = procFalso();
  const promessa = subirProvedor('cloudflared', { porta: 8788, spawnImpl: () => p });
  setImmediate(() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; p.emit('error', e); });
  const r = await promessa;
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nao esta instalado/);
});

test('tunel que morre antes de publicar URL é reportado, nao fica pendurado', async () => {
  const p = procFalso();
  const promessa = subirProvedor('cloudflared', { porta: 8788, spawnImpl: () => p });
  setImmediate(() => p.emit('exit', 1));
  assert.match((await promessa).motivo, /encerrou antes de publicar URL/);
});

test('sem URL no tempo previsto, desiste e mata o processo', async () => {
  const p = procFalso();
  const r = await subirProvedor('cloudflared', { porta: 8788, spawnImpl: () => p, timeoutMs: 30 });
  assert.match(r.motivo, /nao publicou URL/);
  assert.equal(p.morto, true);
});

test('porta é obrigatoria', async () => {
  assert.match((await abrirTunel({})).motivo, /porta é obrigatória/);
  assert.match((await subirProvedor('cloudflared', {})).motivo, /porta é obrigatória/);
});

test('provedor desconhecido é recusado', async () => {
  assert.match((await subirProvedor('inventado', { porta: 1 })).motivo, /provedor desconhecido/);
});

test('verificarTunel bate no ping e aceita so 200', async () => {
  let url = null;
  const r = await verificarTunel('https://x.lhr.life', { fetchImpl: async (u) => { url = u; return { status: 200 }; } });
  assert.equal(r.ok, true);
  assert.equal(url, `https://x.lhr.life${PING}`);
});

test('verificarTunel insiste um pouco — a propagacao demora alguns segundos', async () => {
  let n = 0;
  const r = await verificarTunel('https://x.lhr.life', {
    esperar: semDormir,
    fetchImpl: async () => ({ status: ++n < 3 ? 404 : 200 }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.tentativas, 3);
});

test('404 teimoso NAO vira tunel bom — foi o bug real do quick tunnel', async () => {
  const r = await verificarTunel('https://x.trycloudflare.com', {
    esperar: semDormir, tentativas: 3, fetchImpl: async () => ({ status: 404 }),
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nao responde de fora/);
});

test('auto cai pro proximo provedor quando o primeiro publica URL morta', async () => {
  const usados = [];
  const spawnImpl = (bin) => {
    const p = procFalso();
    usados.push(bin);
    const linha = bin === 'ssh' ? LINHA_LHR : LINHA_CF;
    setImmediate(() => p.stderr.emit('data', linha));
    return p;
  };
  // o primeiro da ORDEM_AUTO nunca responde; o segundo responde.
  const mortos = [];
  const r = await abrirTunel({
    porta: 8788, spawnImpl, esperar: semDormir, tentativas: 2,
    fetchImpl: async (u) => {
      const ehPrimeiro = u.includes(ORDEM_AUTO[0] === 'localhost.run' ? 'lhr.life' : 'trycloudflare.com');
      if (ehPrimeiro) { mortos.push(u); return { status: 404 }; }
      return { status: 200 };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.verificado, true);
  assert.equal(usados.length, 2, 'tinha que ter tentado os dois provedores');
  assert.equal(r.tentados.length, 1);
  assert.match(r.tentados[0].motivo, /nao responde de fora/);
});

test('quando nenhum provedor serve, o motivo lista o que falhou em cada um', async () => {
  const spawnImpl = () => { const p = procFalso(); setImmediate(() => p.emit('exit', 1)); return p; };
  const r = await abrirTunel({ porta: 8788, spawnImpl, esperar: semDormir });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nenhum tunel funcionou/);
  assert.equal(r.tentados.length, ORDEM_AUTO.length);
});

test('verificar:false entrega a URL sem ping (uso em ambiente controlado)', async () => {
  const p = procFalso();
  const promessa = abrirTunel({ porta: 8788, provedor: 'cloudflared', verificar: false, spawnImpl: () => p });
  setImmediate(() => p.stderr.emit('data', LINHA_CF));
  const r = await promessa;
  assert.equal(r.ok, true);
  assert.equal(r.verificado, undefined);
});
