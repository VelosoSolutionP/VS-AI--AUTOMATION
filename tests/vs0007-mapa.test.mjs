import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VSCRM_DIR = mkdtempSync(join(tmpdir(), 'vscrm-007-'));

const vs0007 = await import('../engine/vs0007/index.mjs');
const mapa = await import('../engine/vs0007/mapa.mjs');

test('mapa nasce com nucleo, versao 1 e historico vazio', () => {
  const m = mapa.mapaInicial();
  assert.equal(m.versao, 1);
  assert.ok(m.nucleo.missao);
  assert.ok(Array.isArray(m.nos));
  assert.deepEqual(m.historico, []);
});

test('adicionar no cria descoberta em estado descoberto com origem', async () => {
  const r = await mapa.adicionarNo({ agenteId: 'afrodite', categoria: 'carrinho', conteudo: 'fluxo de carrinho', origem: 'auditoria' });
  assert.equal(r.erro, undefined);
  assert.equal(r.no.estado, 'descoberto');
  assert.equal(r.no.origem, 'auditoria');
});

test('adicionar no rejeita estado homologado sem autorizacao', async () => {
  const r = await mapa.adicionarNo({ agenteId: 'afrodite', categoria: 'carrinho', conteudo: 'x', estado: 'homologado' });
  assert.ok(r.erro);
});

test('pesquisar retorna hits e sinaliza lacuna', async () => {
  await mapa.adicionarNo({ agenteId: 'afrodite', categoria: 'carrinho', conteudo: 'carrinho de compras com quantidade' });
  const r = await mapa.pesquisar({ agenteId: 'afrodite', termo: 'carrinho' });
  assert.equal(r.total, 2, 'dois nos sobre carrinho foram adicionados');
  assert.equal(r.lacuna, false);
  const vazio = await mapa.pesquisar({ agenteId: 'afrodite', termo: 'nao-existe' });
  assert.equal(vazio.lacuna, true);
});

test('transicionar rejeita promocao sem autorizacao', async () => {
  const r = await mapa.adicionarNo({ agenteId: 'isis', categoria: 'relacionamento', conteudo: 'comunicacao com parceiros' });
  const id = r.no.id;
  const negada = await mapa.transicionarNo(id, 'homologado', { autorizado: false });
  assert.ok(negada.erro);
  const liberada = await mapa.transicionarNo(id, 'em_validacao', { autorizado: true });
  assert.equal(liberada.erro, undefined);
});

test('atualizar no incrementa versao e registra historico', async () => {
  const r = await mapa.adicionarNo({ agenteId: 'isis', categoria: 'relacionamento', conteudo: 'comunicacao v1' });
  const id = r.no.id;
  const u = await mapa.atualizarNo(id, { conteudo: 'comunicacao v2' });
  assert.equal(u.no.conteudo, 'comunicacao v2');
  const h = await mapa.historico();
  assert.ok(h.itens.length >= 1);
  assert.equal(h.itens[h.itens.length - 1].noId, id);
});
