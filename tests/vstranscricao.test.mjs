/**
 * Áudio vira texto: o motor limpa o que não é fala e NUNCA trava o atendimento
 * — servidor fora, lento ou áudio vazio devolvem null com o motivo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
const t = await import('../engine/vstranscricao/index.mjs');

test('texto do whisper: tira silêncio e legenda de ruído', () => {
  assert.equal(t.limpar(' Bom dia!  Preciso de peça. \n'), 'Bom dia! Preciso de peça.');
  assert.equal(t.limpar('[BLANK_AUDIO]'), '');
  assert.equal(t.limpar(' [Música] '), '');
  assert.equal(t.limpar('(risos)'), '');
});

test('transcreve pelo servidor e devolve o texto limpo', async () => {
  let pedido = null;
  const falso = async (url, o) => { pedido = { url, fd: o.body }; return new Response(JSON.stringify({ text: ' Quero falar com um vendedor.\n' }), { status: 200 }); };
  const r = await t.transcrever(Buffer.from('OggS...'), { fetch: falso, cfg: { url: 'http://x' } });
  assert.equal(r.texto, 'Quero falar com um vendedor.');
  assert.equal(pedido.url, 'http://x/inference');
  assert.equal(pedido.fd.get('language'), 'pt');
});

test('servidor fora do ar, lento ou sem fala: null com o motivo, sem exceção', async () => {
  const fora = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
  assert.match((await t.transcrever(Buffer.from('a'), { fetch: fora })).erro, /fora do ar/);
  const lento = (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  assert.match((await t.transcrever(Buffer.from('a'), { fetch: lento, cfg: { timeoutMs: 30 } })).erro, /demorou/);
  const mudo = async () => new Response(JSON.stringify({ text: '[BLANK_AUDIO]' }), { status: 200 });
  const r = await t.transcrever(Buffer.from('a'), { fetch: mudo });
  assert.equal(r.texto, null);
  assert.match(r.erro, /nenhuma fala/);
  assert.match((await t.transcrever(Buffer.alloc(0))).erro, /vazio/);
  assert.match((await t.transcrever(Buffer.alloc(10), { cfg: { maxBytes: 5 } })).erro, /grande demais/);
});
