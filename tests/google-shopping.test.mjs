/**
 * Google Shopping (e Meta/TikTok) sem token.
 *
 * O que protege: o arquivo de verificação do Google aceita o que o dono cola
 * (nome, conteúdo, só o código) e só responde o nome EXATO cadastrado; a tag
 * <meta> é recusada com o motivo (aqui ela não funciona); a tela diz o mesmo
 * que o arquivo (link automático só pra produto da vitrine) e diz O QUE falta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'gshop-'));
process.env.VSESTOQUE_DIR = dir;
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ja foi */ } });

const g = await import('../engine/vsestoque/google.mjs');
const { prontidao } = await import('../engine/vsestoque/exportar.mjs');

test('verificação: aceita o nome, o conteúdo do arquivo ou só o código', () => {
  assert.equal(g.nomeDoArquivo('google1a2b3c4d5e6f7a8b.html'), 'google1a2b3c4d5e6f7a8b.html');
  assert.equal(g.nomeDoArquivo('google-site-verification: google1A2B3C4D5E6F7A8B.html'), 'google1a2b3c4d5e6f7a8b.html');
  assert.equal(g.nomeDoArquivo('1a2b3c4d5e6f7a8b'), 'google1a2b3c4d5e6f7a8b.html');
  assert.equal(g.nomeDoArquivo('<meta name="google-site-verification" content="abcXYZ_123" />'), null);
  assert.equal(g.nomeDoArquivo('qualquer coisa'), null);
});

test('verificação: a tag <meta> é recusada com o motivo; vazio também', () => {
  assert.match(g.salvarVerificacao({ colado: '<meta name="google-site-verification" content="abc" />' }).motivo, /Arquivo HTML/);
  assert.equal(g.salvarVerificacao({ colado: '' }).ok, false);
});

test('verificação: serve só o arquivo exato cadastrado, com o conteúdo que o Google espera', () => {
  assert.equal(g.servirVerificacao('/google1a2b3c4d5e6f7a8b.html'), null, 'nada cadastrado, nada servido');
  assert.equal(g.salvarVerificacao({ colado: 'google1a2b3c4d5e6f7a8b.html' }).ok, true);
  assert.deepEqual(g.servirVerificacao('/google1a2b3c4d5e6f7a8b.html?x=1'),
    { tipo: 'text/html; charset=utf-8', conteudo: 'google-site-verification: google1a2b3c4d5e6f7a8b.html' });
  assert.equal(g.servirVerificacao('/google0000000000000000.html'), null, 'outro código não');
  assert.equal(g.limparVerificacao().ok, true);
  assert.equal(g.servirVerificacao('/google1a2b3c4d5e6f7a8b.html'), null);
});

const prod = (sku, extra = {}) => ({ sku, nome: sku, descricao: 'Descrição', marca: 'M', precoCentavos: 1000, imagens: ['https://x/a.png'], ativo: true, ...extra });
const linkDe = (sku) => `https://loja/vitrine/p/${sku}`;

test('tela = arquivo: link automático só pra quem está na vitrine; o motivo diz o que falta', () => {
  const r = prontidao([
    prod('A', { naVitrine: true }),                 // pronto: ganha o link da vitrine
    prod('B', { naVitrine: false }),                // fora da vitrine: falta link
    prod('C', { naVitrine: true, descricao: '' }),  // na vitrine, sem descrição
  ], { linkDe }).google;
  assert.equal(r.prontos, 1);
  assert.equal(r.faltando, 2);
  assert.deepEqual(r.motivos, { 'link do produto': 1, 'descrição': 1 });
});

test('sem linkDe (como era): nenhum link é inventado', () => {
  assert.equal(prontidao([prod('A', { naVitrine: true })]).google.prontos, 0);
});
