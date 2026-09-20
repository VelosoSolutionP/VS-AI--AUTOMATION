/**
 * Contrato e política. O texto é do cliente; o que se testa aqui é a PROVA:
 * versão publicada não muda, e aceite aponta pro texto que a pessoa leu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vsdoc-'));
process.env.VSDOCS_DIR = dir;
const doc = await import('../engine/vsdocumentos/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const TEXTO = 'Este contrato regula o uso do console e a prestação do serviço entre as partes, com prazo, escopo e responsabilidades.';

test('tipo desconhecido e recusado', () => {
  assert.equal(doc.salvarRascunho('nota-fiscal', TEXTO).ok, false);
});

test('texto vazio ou curto demais nao vira documento', () => {
  assert.equal(doc.salvarRascunho('contrato', '').ok, false);
  assert.equal(doc.salvarRascunho('contrato', 'aceito').ok, false);
});

test('rascunho nasce na versao 1 e ainda nao vale', () => {
  const r = doc.salvarRascunho('contrato', TEXTO);
  assert.equal(r.ok, true);
  assert.equal(r.versao.versao, 1);
  assert.equal(r.versao.publicadaEm, null);
  assert.equal(doc.vigente('contrato'), null, 'rascunho nao vigora');
});

test('so existe UM rascunho — salvar de novo atualiza o mesmo', () => {
  doc.salvarRascunho('contrato', TEXTO + ' Versao ajustada.');
  const rs = doc.versoes('contrato').filter((v) => !v.publicadaEm);
  assert.equal(rs.length, 1, 'dois rascunhos e a receita pra publicar o errado');
  assert.equal(rs[0].versao, 1);
});

test('nao da pra aceitar o que nao foi publicado', () => {
  const r = doc.registrarAceite('contrato', { email: 'a@b.c' });
  assert.equal(r.ok, false);
  assert.match(r.erros.join(), /publicado/);
});

test('publicar faz vigorar', () => {
  const p = doc.publicar('contrato');
  assert.equal(p.ok, true);
  const v = doc.vigente('contrato');
  assert.ok(v);
  assert.equal(v.versao, 1);
  assert.equal(doc.publicar('contrato').ok, false, 'nao ha mais rascunho');
});

test('aceite guarda versao E hash — "aceitou a v1" nao prova nada sozinho', () => {
  const r = doc.registrarAceite('contrato', { nome: 'Fulano', email: 'f@x.com' });
  assert.equal(r.ok, true);
  assert.equal(r.aceite.versao, 1);
  assert.equal(r.aceite.hash, doc.vigente('contrato').hash);
  assert.equal(doc.conferirAceite(r.aceite.id).ok, true);
});

test('aceite sem identificacao e recusado', () => {
  assert.equal(doc.registrarAceite('contrato', {}).ok, false);
});

test('aceitar duas vezes a MESMA versao nao gera prova nova', () => {
  const a = doc.registrarAceite('contrato', { email: 'f@x.com' });
  const b = doc.registrarAceite('contrato', { email: 'f@x.com' });
  assert.equal(b.repetido, true);
  assert.equal(a.aceite.id, b.aceite.id);
});

test('nova versao NAO apaga a anterior nem os aceites dela', () => {
  doc.salvarRascunho('contrato', TEXTO + ' Clausula nova sobre reajuste anual.');
  doc.publicar('contrato');
  assert.equal(doc.vigente('contrato').versao, 2);
  assert.equal(doc.versoes('contrato').length, 2);
  assert.equal(doc.aceites('contrato').filter((a) => a.versao === 1).length, 1, 'o aceite da v1 continua');
});

test('quem aceitou a v1 NAO conta como tendo aceito a v2', () => {
  const v2 = doc.aceites('contrato').filter((a) => a.versao === 2);
  assert.equal(v2.length, 0, 'concordou com o que leu, nao com o que veio depois');
});

test('texto adulterado depois do aceite e DENUNCIADO', () => {
  const a = doc.aceites('contrato').find((x) => x.versao === 1);
  // Mexe no arquivo por fora, como faria quem quer reescrever a historia.
  const p = join(dir, 'contrato.json');
  const todas = JSON.parse(readFileSync(p, 'utf8'));
  const i = todas.findIndex((v) => v.versao === 1);
  todas[i].texto = 'Texto trocado depois que a pessoa assinou, o que muda tudo.';
  writeFileSync(p, JSON.stringify(todas));
  const c = doc.conferirAceite(a.id);
  assert.equal(c.ok, false);
  assert.equal(c.adulterado, true);
  assert.match(c.motivo, /mudou depois do aceite/);
});

test('vigencia futura nao vigora antes da data', () => {
  doc.salvarRascunho('politica', 'Esta politica descreve como tratamos dado pessoal, finalidade, retencao e direitos do titular.',
    { vigenteDe: '2099-01-01' });
  doc.publicar('politica');
  assert.equal(doc.vigente('politica'), null, 'documento com vigencia futura nao vale hoje');
  assert.ok(doc.vigente('politica', '2099-06-01'));
});

test('painel separa vigente, rascunho e historico', () => {
  const p = doc.painel();
  assert.equal(p.contrato.vigente.versao, 2);
  assert.equal(p.contrato.versoes.length, 2);
  assert.ok(p.contrato.aceites >= 1);
  assert.equal(p.politica.vigente, null);
  assert.ok(p.politica.versoes.length >= 1);
});
