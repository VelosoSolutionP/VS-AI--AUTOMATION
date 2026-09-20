/**
 * Lote de exportação por período.
 *
 * Exportar "tudo, agora" serve pra conferir, não pra operar: quem recebe o feed
 * precisa saber o que MUDOU e precisa poder reimportar o mesmo arquivo se a carga
 * falhar no meio. Estes testes guardam as duas coisas — a janela e o congelamento.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'lote-'));
process.env.VSESTOQUE_DIR = dir;
const est = await import('../engine/vsestoque/index.mjs');
const lote = await import('../engine/vsestoque/lote.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const prod = (sku, quando, extra = {}) => ({
  sku, nome: 'Produto ' + sku, precoCentavos: 1000, quantidade: 5,
  marca: 'VS', categoria: 'Teste', gtin: '7891234567895',
  link: 'https://loja/x', imagens: ['https://cdn/1.jpg'], descricao: 'desc',
  ativo: true, criadoEm: quando, atualizadoEm: quando, ...extra,
});

const CATALOGO = [
  prod('A', '2026-09-01T10:00:00.000Z'),
  prod('B', '2026-09-10T10:00:00.000Z'),
  prod('C', '2026-09-20T10:00:00.000Z'),
  prod('D', '2026-09-10T10:00:00.000Z', { ativo: false }),
];

test('a janela e sobre o que MUDOU, e inclui os dois extremos do dia', () => {
  const r = lote.selecionar(CATALOGO, { de: '2026-09-10', ate: '2026-09-10' });
  assert.deepEqual(r.map((p) => p.sku), ['B'], 'dia inteiro, nao so a meia-noite');
});

test('sem data, a janela fica aberta daquele lado', () => {
  assert.deepEqual(lote.selecionar(CATALOGO, { ate: '2026-09-10' }).map((p) => p.sku), ['A', 'B']);
  assert.deepEqual(lote.selecionar(CATALOGO, { de: '2026-09-10' }).map((p) => p.sku), ['B', 'C']);
  assert.deepEqual(lote.selecionar(CATALOGO, {}).map((p) => p.sku), ['A', 'B', 'C']);
});

test('inativo fica de fora por padrao — nao anunciar foi escolha', () => {
  assert.equal(lote.selecionar(CATALOGO, {}).some((p) => p.sku === 'D'), false);
  assert.equal(lote.selecionar(CATALOGO, { incluirInativos: true }).some((p) => p.sku === 'D'), true);
});

test('data invalida e RECUSADA — nao pode virar "hoje" calado', () => {
  assert.equal(lote.criarLote(CATALOGO, { de: 'ontem' }).ok, false);
  assert.equal(lote.criarLote(CATALOGO, { ate: '31/09/2026' }).ok, false);
  assert.match(lote.criarLote(CATALOGO, { de: '2026-09-20', ate: '2026-09-01' }).motivo, /depois da final/);
});

test('periodo sem nada avisa em vez de gerar arquivo vazio', () => {
  const r = lote.criarLote(CATALOGO, { de: '2020-01-01', ate: '2020-01-02' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nenhum produto/);
});

test('o lote GUARDA o conteudo gerado — reimportar tem que dar o mesmo arquivo', () => {
  const r = lote.criarLote(CATALOGO, { de: '2026-09-01', ate: '2026-09-30', canal: 'json' });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.lote.selecionados, 3);
  assert.ok(r.lote.bytes > 0);
  const guardado = lote.obterLote(r.lote.id);
  assert.equal(guardado.conteudo, r.lote.conteudo, 'o conteudo tem que ficar congelado no lote');
  assert.equal(JSON.parse(guardado.conteudo).length ?? JSON.parse(guardado.conteudo).produtos?.length ?? 3, 3);
});

test('o resumo nao carrega o arquivo inteiro, e vem do mais novo pro mais velho', () => {
  lote.criarLote(CATALOGO, { de: '2026-09-20', canal: 'json' });
  const lista = lote.resumirLotes();
  assert.ok(lista.length >= 2);
  assert.equal(lista[0].conteudo, undefined, 'a tela nao precisa do arquivo');
  assert.ok(lista[0].criadoEm >= lista[1].criadoEm, 'mais novo primeiro');
});

test('recusado por campo faltando fica NOMEADO, nao some calado', () => {
  const incompleto = [{ sku: 'X', nome: 'Sem nada', precoCentavos: 500, quantidade: 1, ativo: true, atualizadoEm: '2026-09-15T10:00:00.000Z' }];
  const r = lote.criarLote(incompleto, { canal: 'google' });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.lote.incluidos, 0);
  assert.equal(r.lote.recusados.length, 1);
  assert.equal(r.lote.recusados[0].sku, 'X');
  assert.ok(r.lote.recusados[0].faltando.length, 'tem que dizer O QUE falta');
});

test('excluir lote so aceita id existente', () => {
  assert.equal(lote.excluirLote('L9999').ok, false);
  const id = lote.resumirLotes()[0].id;
  assert.equal(lote.excluirLote(id).ok, true);
  assert.equal(lote.obterLote(id), null);
});

test('pelo orquestrador, o lote sai do catalogo gravado', () => {
  est.criar({ nome: 'Camiseta', preco: 'R$ 79,90', quantidade: 3, marca: 'VS', categoria: 'Roupa',
    gtin: '7891234567895', link: 'https://loja/c', imagens: ['https://cdn/c.jpg'], descricao: 'algodao' });
  const r = est.criarLote({ canal: 'json' });
  assert.equal(r.ok, true, r.motivo);
  assert.ok(r.lote.selecionados >= 1);
  assert.ok(est.lotes().some((l) => l.id === r.lote.id));
});
