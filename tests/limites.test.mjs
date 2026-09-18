import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { criarRateLimit, segredoIgual, ipDe, lerCorpoLimitado } from '../backend/limites.mjs';

/** Requisição falsa: stream de corpo + headers + socket. */
const reqFake = (corpo, headers = {}) => {
  const r = Readable.from([Buffer.from(corpo)]);
  r.headers = headers;
  r.socket = { remoteAddress: '10.0.0.1' };
  // NAO sobrescrever r.destroy: Readable ja tem o dele, e um no-op no lugar impede a
  // limpeza do stream — a suite inteira morre com "event loop has already resolved".
  return r;
};

test('corpo dentro do teto e lido inteiro', async () => {
  const r = await lerCorpoLimitado(reqFake('{"a":1}'), 1024);
  assert.equal(r.excedeu, false);
  assert.equal(r.buffer.toString(), '{"a":1}');
});

test('corpo acima do teto e cortado — nao acumula na memoria', async () => {
  const r = await lerCorpoLimitado(reqFake('x'.repeat(5000)), 1000);
  assert.equal(r.excedeu, true);
  assert.equal(r.buffer, undefined, 'nao pode devolver o corpo que estourou');
});

test('content-length grande e recusado ANTES de ler um byte', async () => {
  let leu = false;
  const req = Readable.from((function* () { leu = true; yield Buffer.from('x'); })());
  req.headers = { 'content-length': '999999' };
  req.socket = { remoteAddress: '10.0.0.1' };
  const r = await lerCorpoLimitado(req, 1000);
  assert.equal(r.excedeu, true);
  assert.equal(leu, false, 'nao podia ter comecado a ler');
  // o stream nunca foi consumido de proposito; sem fechar, ele fica pendurado e o
  // runner cancela a suite inteira com "event loop has already resolved".
  req.destroy();
});

test('rate limit solta ate o maximo e barra o excedente', () => {
  let t = 0;
  const lim = criarRateLimit({ max: 3, janelaMs: 1000, agora: () => t });
  assert.equal(lim.checar('ip1').ok, true);
  assert.equal(lim.checar('ip1').ok, true);
  assert.equal(lim.checar('ip1').ok, true);
  const quarta = lim.checar('ip1');
  assert.equal(quarta.ok, false);
  assert.equal(quarta.esperaSeg, 1);
});

test('a cota e por chave — um IP nao gasta a do outro', () => {
  let t = 0;
  const lim = criarRateLimit({ max: 1, janelaMs: 1000, agora: () => t });
  assert.equal(lim.checar('ip1').ok, true);
  assert.equal(lim.checar('ip2').ok, true);
  assert.equal(lim.checar('ip1').ok, false);
});

test('passada a janela, a cota volta', () => {
  let t = 0;
  const lim = criarRateLimit({ max: 1, janelaMs: 1000, agora: () => t });
  assert.equal(lim.checar('ip1').ok, true);
  assert.equal(lim.checar('ip1').ok, false);
  t = 1001;
  assert.equal(lim.checar('ip1').ok, true, 'janela expirou, tinha de liberar');
});

test('janela e deslizante, nao balde fixo', () => {
  let t = 0;
  const lim = criarRateLimit({ max: 2, janelaMs: 1000, agora: () => t });
  lim.checar('ip1');        // t=0
  t = 900; lim.checar('ip1'); // t=900
  t = 950; assert.equal(lim.checar('ip1').ok, false, 'ainda ha 2 hits na janela');
  t = 1050; assert.equal(lim.checar('ip1').ok, true, 'o hit de t=0 saiu da janela');
});

test('segredo vazio NUNCA casa — token nao configurado nao libera rota', () => {
  assert.equal(segredoIgual('', ''), false);
  assert.equal(segredoIgual(null, undefined), false);
  assert.equal(segredoIgual('abc', ''), false);
  assert.equal(segredoIgual(undefined, 'abc'), false);
});

test('segredo compara certo quando existe', () => {
  assert.equal(segredoIgual('tok-123', 'tok-123'), true);
  assert.equal(segredoIgual('tok-123', 'tok-124'), false);
  assert.equal(segredoIgual('tok-123', 'tok-1234'), false);
});

test('ipDe ignora x-forwarded-for sem TRUST_PROXY — header forjado nao fura cota', () => {
  delete process.env.TRUST_PROXY;
  const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(ipDe(req), '10.0.0.1');
});

test('ipDe respeita x-forwarded-for com TRUST_PROXY=1, so o primeiro', () => {
  process.env.TRUST_PROXY = '1';
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(ipDe(req), '1.2.3.4');
  delete process.env.TRUST_PROXY;
});

test('mapa de hits nao cresce sem limite', () => {
  let t = 0;
  const lim = criarRateLimit({ max: 1, janelaMs: 10, agora: () => t });
  for (let i = 0; i < 5200; i++) { lim.checar('ip' + i); t += 1; }
  assert.ok(lim.tamanho() < 5200, 'entradas velhas deviam ter sido varridas');
});
