/**
 * Arquivo de verificacao de dominio da TikTok.
 *
 * Ela so aceita a URL de retorno depois de provar que o dominio e seu, e a prova
 * e um arquivo na raiz do site. Quem comprou o console nao tem shell no servidor:
 * sem isto, a integracao para aqui e nao ha o que a pessoa faca sozinha.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tkverif-'));
process.env.VSTIKTOK_DIR = dir;
const tk = await import('../engine/vstiktok/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('sem nada cadastrado, nenhuma rota e servida', () => {
  assert.equal(tk.getVerificacao(), null);
  assert.equal(tk.servirVerificacao('/tiktok123.txt'), null);
});

test('cadastrado, o arquivo passa a responder na raiz', () => {
  const r = tk.salvarVerificacao({ arquivo: 'tiktokAbC123.txt', conteudo: 'tiktok-developers-site-verification=xyz' });
  assert.equal(r.ok, true, r.motivo);
  const s = tk.servirVerificacao('/tiktokAbC123.txt');
  assert.equal(s.conteudo, 'tiktok-developers-site-verification=xyz');
  assert.match(s.tipo, /text\/plain/);
});

test('so o arquivo cadastrado responde — nao vira rota curinga', () => {
  assert.equal(tk.servirVerificacao('/outro.txt'), null);
  assert.equal(tk.servirVerificacao('/tiktokabc123.txt'), null, 'nome e sensivel a maiuscula, como no arquivo que eles dao');
  assert.equal(tk.servirVerificacao('/crm'), null);
});

test('nome com caminho e RECUSADO — isto vira rota publica na raiz', () => {
  for (const mau of ['../../etc/passwd', 'pasta/tiktok.txt', '/crm', 'tiktok.txt/../crm', 'a'.repeat(70) + '.txt', 'tiktok.html']) {
    const r = tk.salvarVerificacao({ arquivo: mau, conteudo: 'x' });
    assert.equal(r.ok, false, `aceitou "${mau}"`);
  }
  // o que ja valia continua valendo — recusa nao apaga o anterior
  assert.equal(tk.servirVerificacao('/tiktokAbC123.txt').conteudo, 'tiktok-developers-site-verification=xyz');
});

test('conteudo vazio e recusado — arquivo em branco nao verifica nada', () => {
  assert.equal(tk.salvarVerificacao({ arquivo: 'tiktokZZ.txt', conteudo: '   ' }).ok, false);
});

test('a barra da frente e tolerada — a pessoa cola a URL inteira sem querer', () => {
  assert.equal(tk.salvarVerificacao({ arquivo: '/tiktokQQ.txt', conteudo: 'v=1' }).ok, true);
  assert.equal(tk.servirVerificacao('/tiktokQQ.txt').conteudo, 'v=1');
});

test('limpar tira a rota do ar', () => {
  tk.limparVerificacao();
  assert.equal(tk.servirVerificacao('/tiktokQQ.txt'), null);
});
