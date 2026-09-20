/**
 * Mídia do painel. O que estes testes guardam: isto vira ROTA PÚBLICA e recebe
 * arquivo grande — os dois jeitos clássicos de se machucar (nome de caminho vindo
 * do usuário e upload sem teto) ficam fechados aqui.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

const dir = mkdtempSync(join(tmpdir(), 'midia-'));
process.env.VSMIDIA_DIR = dir;
process.env.MIDIA_MAX_BYTES = String(64 * 1024);
const m = await import('../backend/midia.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** Requisição falsa: um stream com os bytes. */
const pedido = (bytes) => Object.assign(Readable.from([bytes]), { headers: {} });

test('nome gerado nao carrega nada do que o usuario mandou', () => {
  const n = m.novoNome('../../etc/passwd.mp4');
  assert.match(n, /^[0-9a-f]{24}\.mp4$/);
  assert.doesNotMatch(n, /passwd|\.\./);
});

test('extensao desconhecida vira .mp4, nao vira caminho', () => {
  assert.match(m.novoNome('video.exe'), /\.mp4$/);
  assert.match(m.novoNome('x.mov'), /\.mov$/);
  assert.match(m.novoNome(''), /\.mp4$/);
});

test('arquivo dentro do teto e gravado', async () => {
  const r = await m.receber(pedido(Buffer.alloc(1024, 7)), 'clipe.mp4');
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.bytes, 1024);
  assert.ok(existsSync(join(dir, r.arquivo)));
});

test('arquivo acima do teto e cortado E APAGADO — teto que deixa lixo nao e teto', async () => {
  const antes = readdirSync(dir).length;
  const r = await m.receber(pedido(Buffer.alloc(200 * 1024, 1)), 'grande.mp4');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /acima de/);
  assert.equal(readdirSync(dir).length, antes, 'sobrou arquivo no disco');
});

test('arquivo vazio e recusado', async () => {
  const r = await m.receber(pedido(Buffer.alloc(0)), 'nada.mp4');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /vazio/);
});

test('so nome gerado por nos e aceito na hora de servir', () => {
  assert.equal(m.nomeValido('z'.repeat(24) + '.mp4'), false, 'hex e so 0-9a-f — "z" nao entra');
  assert.equal(m.nomeValido('0123456789abcdef0123456.mp4'), false, '23 caracteres nao serve');
  assert.equal(m.nomeValido('0123456789abcdef01234567.mp4'), true);
  assert.equal(m.nomeValido('../../etc/passwd'), false);
  assert.equal(m.nomeValido('0123456789abcdef01234567.exe'), false);
  assert.equal(m.nomeValido(''), false);
});

test('servir recusa nome invalido e arquivo que nao existe', () => {
  const res = { writeHead() {}, end() {} };
  assert.equal(m.servir({ headers: {} }, res, '../../etc/passwd'), false);
  assert.equal(m.servir({ headers: {} }, res, '0123456789abcdef01234567.mp4'), false);
});

/** Destino de verdade: sem isso o pipe continua depois do teste e estoura ENOENT
    quando outro teste apaga o arquivo. */
function respostaFalsa() {
  const chunks = [];
  const w = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
  w.status = null; w.cabecalhos = null;
  w.writeHead = (s, h) => { w.status = s; w.cabecalhos = h || {}; };
  w.pronto = () => new Promise((r) => { if (w.writableEnded) { return r(); } w.on('finish', r); w.on('close', r); });
  w.corpo = () => Buffer.concat(chunks);
  return w;
}

test('Range e atendido — a TikTok baixa por pedaco', async () => {
  const nome = '0123456789abcdef01234500.mp4';
  writeFileSync(join(dir, nome), Buffer.alloc(1000, 3));
  const res = respostaFalsa();
  assert.equal(m.servir({ headers: { range: 'bytes=10-19' } }, res, nome), true);
  await res.pronto();
  assert.equal(res.status, 206);
  assert.equal(res.cabecalhos['content-range'], 'bytes 10-19/1000');
  assert.equal(res.cabecalhos['content-length'], '10');
  assert.equal(res.corpo().length, 10, 'tem que mandar SO o pedaco pedido');
});

test('sem Range vai o arquivo inteiro, dizendo que aceita Range', async () => {
  const nome = '0123456789abcdef01234502.mp4';
  writeFileSync(join(dir, nome), Buffer.alloc(300, 9));
  const res = respostaFalsa();
  assert.equal(m.servir({ headers: {} }, res, nome), true);
  await res.pronto();
  assert.equal(res.status, 200);
  assert.equal(res.cabecalhos['accept-ranges'], 'bytes');
  assert.equal(res.corpo().length, 300);
});

test('Range fora do arquivo devolve 416, nao dado errado', () => {
  const nome = '0123456789abcdef01234501.mp4';
  writeFileSync(join(dir, nome), Buffer.alloc(100, 3));
  const res = respostaFalsa();
  m.servir({ headers: { range: 'bytes=500-600' } }, res, nome);
  assert.equal(res.status, 416);
});

test('excluir so aceita nome valido', () => {
  assert.equal(m.excluir('../../etc/passwd').ok, false);
  const achado = m.listar()[0];
  assert.ok(achado, 'deveria haver arquivo listado');
  assert.equal(m.excluir(achado.arquivo).ok, true);
});

/* ---- imagem ---- */

test('imagem tem teto proprio, bem menor que video', async () => {
  const r = await m.receber(pedido(Buffer.alloc(5000, 1)), 'foto.jpg', { maxBytes: 1000, padrao: '.jpg' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /acima de/);
});

test('extensao de imagem e preservada, e o nome continua sendo nosso', async () => {
  for (const [orig, esperado] of [['foto.JPG', '.jpg'], ['x.png', '.png'], ['y.webp', '.webp'], ['z.jpeg', '.jpeg']]) {
    const r = await m.receber(pedido(Buffer.alloc(64, 2)), orig, { padrao: '.jpg' });
    assert.equal(r.ok, true, r.motivo);
    assert.ok(r.arquivo.endsWith(esperado), `${orig} virou ${r.arquivo}`);
    assert.match(r.arquivo, /^[0-9a-f]{24}\./);
  }
});

test('arquivo sem extensao conhecida cai no PADRAO pedido, nao vira caminho', async () => {
  const r = await m.receber(pedido(Buffer.alloc(32, 3)), '../../etc/passwd', { padrao: '.jpg' });
  assert.equal(r.ok, true);
  assert.match(r.arquivo, /^[0-9a-f]{24}\.jpg$/);
  assert.doesNotMatch(r.arquivo, /passwd|\.\./);
});

test('imagem e servida com o content-type certo', async () => {
  const r = await m.receber(pedido(Buffer.alloc(120, 4)), 'capa.png', { padrao: '.jpg' });
  const res = respostaFalsa();
  assert.equal(m.servir({ headers: {} }, res, r.arquivo), true);
  await res.pronto();
  assert.equal(res.cabecalhos['content-type'], 'image/png');
});

test('ehImagem separa foto de video', () => {
  assert.equal(m.ehImagem('a.png'), true);
  assert.equal(m.ehImagem('a.jpeg'), true);
  assert.equal(m.ehImagem('a.mp4'), false);
  assert.equal(m.ehImagem('a.exe'), false);
});
