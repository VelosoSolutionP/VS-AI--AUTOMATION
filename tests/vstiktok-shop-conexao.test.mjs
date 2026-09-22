/**
 * Conexao com a TikTok Shop, do jeito que a revisao do marketplace exige.
 *
 * A regra que estes casos protegem e uma so, e esta escrita na propria
 * exigencia: "nao simular dados da TikTok Shop como se fossem retornados pela
 * API". Tela de integracao que mostra numero inventado passa na revisao e
 * quebra no cliente — e quando quebra, ninguem confia mais em nenhuma tela.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tk-shop-'));
process.env.VSTIKTOK_DIR = dir;
const tk = await import('../engine/vstiktok/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('sem loja escolhida, sincronizar RECUSA e diz o porque — nao devolve lista vazia calada', async () => {
  const r = await tk.sincronizarProdutos();
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nenhuma loja/);
  assert.equal(r.total, 0);
});

test('a recusa fica REGISTRADA — a tela precisa mostrar que a ultima tentativa falhou', () => {
  const s = tk.ultimaSincronizacao();
  assert.equal(s.ok, false);
  assert.ok(s.em, 'sem carimbo de hora, "ultima sincronizacao" nao prova nada');
});

test('falha de API tambem e registrada — guardar so o sucesso esconderia que hoje nao conecta', async () => {
  tk.salvarConfig({ shopCipher: 'CIPHER', shopId: '7', shopNome: 'Loja Demo' });
  const r = await tk.sincronizarProdutos({
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'token invalido' }) }),
  });
  assert.equal(r.ok, false);
  assert.equal(tk.ultimaSincronizacao().ok, false, 'a falha tem de sobrescrever o sucesso anterior');
  assert.equal(r.total, 0, 'falhou: nao pode aparecer produto nenhum');
});

test('sem credencial de APP, nao sai chamada nenhuma — e o motivo diz o que falta', async () => {
  /* Este e o estado real da demo enquanto o app nao for aprovado no partner
     center. A tela tem de dizer "falta configurar o app", nao mostrar produto. */
  const r = await tk.sincronizarProdutos({
    fetchImpl: async () => { throw new Error('a TikTok NAO devia ter sido chamada'); },
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /credencial do app/);
  assert.equal(r.total, 0);
  assert.equal(tk.ultimaSincronizacao().ok, false);
});

test('o registro guarda de QUAL loja a tentativa foi feita', () => {
  assert.equal(tk.ultimaSincronizacao().loja, 'Loja Demo',
    'sem dizer a loja, o carimbo nao prova nada numa conta com varias');
});

test('nenhum caminho de falha devolve produto — a exigencia e nao simular a TikTok', async () => {
  for (const cenario of [
    { fetchImpl: async () => { throw new Error('rede caiu'); } },
    { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) },
  ]) {
    const r = await tk.sincronizarProdutos(cenario);
    assert.equal(r.ok, false);
    assert.equal(r.total, 0);
    assert.deepEqual(r.produtos ?? [], []);
  }
});

test('o estado da conexao nao se declara conectado so por ter credencial de app', () => {
  const d = tk.diagnostico();
  assert.equal(d.familias.shop.autorizado, false, 'sem token OAuth nao ha loja conectada');
  /* A exigencia e explicita: credencial de developer NAO substitui a
     autorizacao. Ter appKey preenchida nao e "conectado". */
  assert.equal(d.pronto.produtos, false);
});
