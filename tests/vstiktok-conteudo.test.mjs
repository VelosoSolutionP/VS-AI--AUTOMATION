import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fatiar, validarPost, publicarPorUrl, publicarArquivo, enviarPedacos,
  aguardarPublicacao, CHUNK,
} from '../engine/vstiktok/conteudo.mjs';

const respostaFila = (lista) => {
  const fila = [...lista];
  return async (url, opts) => {
    const r = fila.length > 1 ? fila.shift() : fila[0];
    return { status: r.status ?? 200, json: async () => r.corpo, headers: { get: () => null } };
  };
};

const INFO_AUDITADO = { privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], max_video_post_duration_sec: 600 };
const INFO_NAO_AUDITADO = { privacy_level_options: ['SELF_ONLY'] };

test('video pequeno vai num pedaco so, sem inventar padding', () => {
  assert.deepEqual(fatiar(1_000_000), { tamanhoPedaco: 1_000_000, pedacos: 1 });
});

test('video grande é fatiado dentro das regras da TikTok', () => {
  const r = fatiar(50 * 1024 * 1024);
  assert.ok(r.tamanhoPedaco >= CHUNK.min);
  assert.ok(r.pedacos >= 1 && r.pedacos <= CHUNK.maxPedacos);
});

test('fatiar recusa tamanho invalido e video acima do teto', () => {
  assert.match(fatiar(0).erro, /tamanho do vídeo inválido/);
  assert.match(fatiar(5 * 1024 ** 3).erro, /GB/);
});

test('app nao auditado NAO deixa marcar publico — senao sobe privado e ninguem sabe', () => {
  const r = validarPost({ titulo: 'oi', privacidade: 'PUBLIC_TO_EVERYONE' }, INFO_NAO_AUDITADO);
  assert.equal(r.post, null);
  assert.ok(r.erros.some((e) => /não auditado|SELF_ONLY/.test(e)));
});

test('app nao auditado avisa que o video sai privado, mesmo no caminho feliz', () => {
  const r = validarPost({ titulo: 'oi', privacidade: 'SELF_ONLY' }, INFO_NAO_AUDITADO);
  assert.deepEqual(r.erros, []);
  assert.ok(r.avisos.some((a) => /PRIVADO/.test(a)));
});

test('post valido vira payload da API', () => {
  const r = validarPost({ titulo: 'Corte 01', privacidade: 'PUBLIC_TO_EVERYONE', desabilitarDueto: true }, INFO_AUDITADO);
  assert.deepEqual(r.erros, []);
  assert.equal(r.post.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.equal(r.post.disable_duet, true);
  assert.equal(r.post.disable_comment, false);
});

test('titulo e privacidade sao obrigatorios e validados', () => {
  const r = validarPost({}, null);
  assert.ok(r.erros.some((e) => /título é obrigatório/.test(e)));
  assert.ok(r.erros.some((e) => /privacidade inválida/.test(e)));
});

test('video mais longo que o limite da conta é barrado antes do upload', () => {
  const r = validarPost({ titulo: 'x', privacidade: 'SELF_ONLY', duracaoSeg: 900 }, INFO_AUDITADO);
  assert.ok(r.erros.some((e) => /passa do limite da conta/.test(e)));
});

test('publicar por URL exige https de dominio verificado', async () => {
  const r = await publicarPorUrl(
    { token: 't', infoCriador: INFO_AUDITADO, fetchImpl: respostaFila([{ corpo: { data: {} } }]) },
    { titulo: 'x', privacidade: 'SELF_ONLY', videoUrl: 'http://inseguro/v.mp4' },
  );
  assert.equal(r.ok, false);
  assert.match(r.motivo, /https/);
});

test('publicar por URL devolve o publish_id', async () => {
  const r = await publicarPorUrl(
    { token: 't', infoCriador: INFO_AUDITADO, fetchImpl: respostaFila([{ corpo: { data: { publish_id: 'PUB1' }, error: { code: 'ok' } } }]) },
    { titulo: 'x', privacidade: 'SELF_ONLY', videoUrl: 'https://cdn.meusite.com/v.mp4' },
  );
  assert.equal(r.ok, true);
  assert.equal(r.publishId, 'PUB1');
});

test('upload sem upload_url falha com motivo claro, nao com TypeError', async () => {
  const r = await enviarPedacos(null, Buffer.alloc(10), { pedacos: 1, tamanhoPedaco: 10 }, {});
  assert.equal(r.ok, false);
  assert.match(r.motivo, /upload_url/);
});

test('o ultimo pedaco absorve a sobra e o Content-Range cobre o arquivo inteiro', async () => {
  const bytes = Buffer.alloc(25);
  const ranges = [];
  const ctx = { fetchImpl: async (url, opts) => { ranges.push(opts.headers['content-range']); return { status: 201 }; } };
  const r = await enviarPedacos('https://up', bytes, { pedacos: 2, tamanhoPedaco: 10 }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(ranges, ['bytes 0-9/25', 'bytes 10-24/25']);
});

test('falha no upload diz QUAL pedaco quebrou', async () => {
  const ctx = { fetchImpl: async () => ({ status: 500 }) };
  const r = await enviarPedacos('https://up', Buffer.alloc(10), { pedacos: 1, tamanhoPedaco: 10 }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /pedaço 1\/1/);
});

test('publicarArquivo sem bytes nem caminho nao tenta upload', async () => {
  const r = await publicarArquivo({ token: 't', infoCriador: INFO_AUDITADO }, { titulo: 'x', privacidade: 'SELF_ONLY' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /bytes.*caminho/);
});

test('publicarArquivo faz init e sobe os pedacos', async () => {
  const chamadas = [];
  const ctx = {
    token: 't', infoCriador: INFO_AUDITADO,
    fetchImpl: async (url, opts) => {
      chamadas.push(url);
      if (url.includes('/video/init/')) {
        return { status: 200, json: async () => ({ data: { publish_id: 'PUB9', upload_url: 'https://up' }, error: { code: 'ok' } }) };
      }
      return { status: 201, json: async () => ({}) };
    },
  };
  const r = await publicarArquivo(ctx, { titulo: 'x', privacidade: 'SELF_ONLY', bytes: Buffer.alloc(1000) });
  assert.equal(r.ok, true);
  assert.equal(r.publishId, 'PUB9');
  assert.equal(chamadas.filter((u) => u === 'https://up').length, 1);
});

test('aguardar publicacao pega a falha que acontece DEPOIS do init', async () => {
  const ctx = {
    token: 't', esperar: async () => {},
    fetchImpl: respostaFila([
      { corpo: { data: { status: 'PROCESSING_UPLOAD' }, error: { code: 'ok' } } },
      { corpo: { data: { status: 'FAILED', fail_reason: 'video_format_check_failed' }, error: { code: 'ok' } } },
    ]),
  };
  const r = await aguardarPublicacao(ctx, 'PUB1', { tentativas: 3, intervaloMs: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'FAILED');
  assert.match(r.motivo, /video_format_check_failed/);
});

test('publicacao concluida volta ok', async () => {
  const ctx = { token: 't', esperar: async () => {}, fetchImpl: respostaFila([{ corpo: { data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } } }]) };
  const r = await aguardarPublicacao(ctx, 'PUB1', { tentativas: 2, intervaloMs: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'PUBLISH_COMPLETE');
});

test('se nunca termina, o motivo diz em que estado parou', async () => {
  const ctx = { token: 't', esperar: async () => {}, fetchImpl: respostaFila([{ corpo: { data: { status: 'PROCESSING_UPLOAD' }, error: { code: 'ok' } } }]) };
  const r = await aguardarPublicacao(ctx, 'PUB1', { tentativas: 2, intervaloMs: 0 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /PROCESSING_UPLOAD/);
});
