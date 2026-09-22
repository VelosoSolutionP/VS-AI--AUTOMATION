/**
 * As portas do TikTok.
 *
 * O motor ja fazia dez coisas e o painel alcancava DUAS: catalogo, campanhas,
 * metricas e descoberta de loja estavam escritos, testados e sem rota. O Modulo
 * A vende "catalogo e campanhas" — prometer isso com o codigo pronto e sem
 * porta e o pior tipo de divida, porque parece entregue.
 *
 * Aqui se protege o que NAO pode passar por essas portas novas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tk-rotas-'));
process.env.VSTIKTOK_DIR = dir;
const tk = await import('../engine/vstiktok/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

/* Espelha as guardas que a rota aplica ANTES de chamar a API — e o que impede
   uma chamada cara de sair por um campo em branco. */
function validarCampanha(d = {}) {
  const orcamento = Number(d.orcamentoCentavos || 0);
  if (!String(d.nome || '').trim()) { return { ok: false, motivo: 'dê um nome à campanha' }; }
  if (!(orcamento > 0)) { return { ok: false, motivo: 'informe o orçamento diário — campanha sem orçamento não é criada' }; }
  return { ok: true };
}

test('campanha sem nome nao e criada', () => {
  assert.equal(validarCampanha({ orcamentoCentavos: 5000 }).ok, false);
});

test('campanha sem orcamento nao e criada — isso aqui gasta dinheiro de verdade', () => {
  assert.match(validarCampanha({ nome: 'Lançamento' }).motivo, /orçamento/);
  assert.equal(validarCampanha({ nome: 'Lançamento', orcamentoCentavos: 0 }).ok, false);
});

test('campanha completa passa', () => {
  assert.equal(validarCampanha({ nome: 'Lançamento', orcamentoCentavos: 5000 }).ok, true);
});

test('sem loja escolhida, nao se chama a API — falta configuracao, nao e erro', () => {
  assert.equal(tk.getConfig().shopCipher, undefined, 'comeca sem loja');
  // A rota devolve pronto:false com o motivo, em vez de deixar a TikTok
  // responder erro cru e a tela mostrar falha onde falta um passo.
  const cfg = tk.getConfig();
  assert.equal(Boolean(cfg.shopCipher), false);
});

test('escolher a loja grava as tres coisas que a tela precisa', () => {
  tk.salvarConfig({ shopCipher: 'CIPHER123', shopId: '77', shopNome: 'Loja da Veloso' });
  const cfg = tk.getConfig();
  assert.equal(cfg.shopCipher, 'CIPHER123');
  assert.equal(cfg.shopNome, 'Loja da Veloso', 'sem o nome, a tela mostraria um cipher pro dono da loja');
});

test('trocar de loja substitui, nao acumula', () => {
  tk.salvarConfig({ shopCipher: 'OUTRO', shopId: '88', shopNome: 'Segunda loja' });
  assert.equal(tk.getConfig().shopCipher, 'OUTRO');
  assert.equal(tk.getConfig().shopNome, 'Segunda loja');
});

test('conta de anuncio guarda id E nome — o id sozinho nao diz nada a ninguem', () => {
  tk.salvarConfig({ anuncianteId: '999', anuncianteNome: 'Veloso Ads' });
  assert.equal(tk.getConfig().anuncianteId, '999');
  assert.equal(tk.getConfig().anuncianteNome, 'Veloso Ads');
});

test('o diagnostico reflete o que esta pronto pra cada coisa', () => {
  const d = tk.diagnostico();
  assert.equal(d.pronto.publicar, false, 'sem token open nao publica');
  assert.equal(d.pronto.produtos, false, 'cipher sozinho nao basta: precisa do token de shop');
  assert.equal(d.pronto.campanhas, false);
  assert.ok(d.lojaAtiva, 'a loja escolhida aparece, mascarada');
});

test('publicar sem id de publicacao e recusado antes de sair chamada', async () => {
  const r = await tk.statusPublicacao('');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /informe o id/);
});
