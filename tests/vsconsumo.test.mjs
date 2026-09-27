/**
 * Medidor de banda (consumo geral da instalação) e modo consulta.
 *
 * O que estes testes seguram: o que passa é contado em bytes por categoria e
 * por dia; o limite vem do plano + banda adicional; 80% avisa, 100% entra em
 * modo consulta; a projeção segue o ritmo do mês; o fetch medido conta o que
 * foi enviado e o que foi lido; mídia só conta arquivo de mídia do mês; e o
 * pedido de banda não duplica.
 */
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const casa = mkdtempSync(join(tmpdir(), 'consumo-iso-'));
process.env.VS_HOME = casa;
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const C = await import('../engine/vsconsumo/index.mjs');
const P = await import('../engine/vsplanos/index.mjs');

const AGORA = new Date('2026-09-15T12:00:00-03:00');
C._relogio(() => AGORA);

test('registra por categoria e por dia; limite, faixas e modo consulta', () => {
  C._zerar();
  C.registrar('telegram', { entrada: 300 * 1024 ** 2, saida: 100 * 1024 ** 2 }, new Date('2026-09-02T10:00:00-03:00'));
  C.registrar('painel', { entrada: 50 * 1024 ** 2, saida: 350 * 1024 ** 2 });
  C.descarregar();
  C.registrar('whatsapp', { saida: 1024 }); // ainda na memória: tem de somar também
  const e = C.estado({ limiteGb: 1, midia: { bytes: 0, arquivos: 0 } });
  assert.equal(e.porCategoria.telegram.total, 400 * 1024 ** 2);
  assert.equal(e.porCategoria.whatsapp.total, 1024);
  assert.equal(e.porDia.find((d) => d.dia === '2026-09-02').telegram, 400 * 1024 ** 2);
  assert.equal(e.faixa, 'normal', `${Math.round(e.pct * 100)}%`);
  assert.ok(e.projecaoBytes > e.usadoBytes, 'meio do mês: projeção maior que o usado');
  assert.equal(e.renovaEm, new Date('2026-10-01T00:00:00-03:00').toISOString());
  assert.equal(C.estado({ limiteGb: 0.95 }).faixa, 'atencao', '≥ 80% avisa');
  const cheio = C.estado({ limiteGb: 0.5 });
  assert.equal(cheio.modoConsulta, true, 'passou do limite = modo consulta');
  assert.equal(cheio.faixa, 'consulta');
  assert.equal(C.estado({ limiteGb: null }).modoConsulta, false, 'sem limite nunca trava');
  assert.equal(C.estado({ limiteGb: 1, mes: '2026-08' }).usadoBytes, 0, 'mês novo começa do zero');
});

test('categoria pela rota e pelo host', () => {
  assert.equal(C.categoriaDaRota('/crm/api/painel'), 'painel');
  assert.equal(C.categoriaDaRota('/vitrine/produto/1'), 'loja');
  assert.equal(C.categoriaDaRota('/webhook?x=1'), 'whatsapp');
  assert.equal(C.categoriaDoHost('https://api.telegram.org/botX/sendMessage'), 'telegram');
  assert.equal(C.categoriaDoHost('http://127.0.0.1:9/bot/x', { telegramApi: 'http://127.0.0.1:9' }), 'telegram');
  assert.equal(C.categoriaDoHost('https://graph.facebook.com/v19/x'), 'whatsapp');
  assert.equal(C.categoriaDoHost('https://api.asaas.com/v3'), 'integracoes');
});

test('fetch medido conta o que foi enviado e o que foi lido', async () => {
  C._zerar();
  const corpo = 'x'.repeat(50000);
  const srv = createServer((req, res) => { req.resume(); req.on('end', () => res.end(corpo)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const antes = globalThis.fetch;
  C.medirFetch({ telegramApi: base });
  const t0 = C.estado({}).porCategoria.telegram;
  try {
    const r = await fetch(`${base}/bot/sendMessage`, { method: 'POST', body: 'y'.repeat(20000) });
    assert.equal((await r.text()).length, 50000, 'o corpo chega inteiro para quem chamou');
    await new Promise((r) => setImmediate(r));
    const t1 = C.estado({}).porCategoria.telegram;
    const saida = t1.saida - t0.saida; const entrada = t1.entrada - t0.entrada;
    assert.ok(saida >= 20000 && saida < 21000, `saída ${saida}`);
    assert.ok(entrada >= 50000 && entrada < 51000, `entrada ${entrada}`);
  } finally { globalThis.fetch = antes; srv.close(); }
});

test('mídia do mês: só arquivo de mídia conta', () => {
  const d = join(casa, 'midia-teste'); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'a.png'), Buffer.alloc(3000));
  writeFileSync(join(d, 'dados.json'), Buffer.alloc(9000));
  const m = C.midiaDoMes([d], C.mesDe(new Date()));
  assert.equal(m.bytes, 3000);
  assert.equal(m.arquivos, 1);
});

test('banda do plano + adicional; pedido de banda não duplica', () => {
  assert.equal(P.bandaDoMes().totalGb, null, 'sem plano = sem limite');
  assert.equal(P.adicionarBanda({ gb: 10, motivo: 'x' }).ok, false, 'sem plano não libera');
  P.assinar({ plano: 'whats-bronze' });
  assert.equal(P.bandaDoMes().totalGb, 1, 'Bronze do WhatsApp: 1 GB');
  assert.equal(P.adicionarBanda({ gb: 10 }).ok, false, 'exige motivo');
  const r = P.adicionarBanda({ gb: 10, motivo: 'adendo pago', por: 'dono' });
  assert.equal(r.banda.totalGb, 11);
  assert.equal(P.removerBanda(r.item.id).banda.totalGb, 1);
  assert.ok(P.adicionais().some((a) => a.code === 'banda-extra' && a.sob_consulta), 'adendo de banda no catálogo');
  const p1 = C.pedirBanda({ por: 'cliente' });
  const p2 = C.pedirBanda({ por: 'cliente' });
  assert.equal(p2.repetido, true);
  assert.equal(p2.pedido.id, p1.pedido.id);
  C.fecharPedidosBanda({ por: 'dono' });
  assert.equal(C.pedidosBanda().filter((p) => p.estado === 'aberto').length, 0);
});
