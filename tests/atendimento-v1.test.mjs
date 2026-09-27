/**
 * Atendimento v1 — quem precisa de atencao agora.
 *
 * Segura as tres regras que a tela depende: "aguardando vendedor" e "com
 * vendedor" sao situacoes diferentes; assumir a conversa NAO apaga a hora em
 * que o bot transferiu (e o que o historico mostra); e o pedido do cliente vem
 * com o estado do pagamento lido do gateway.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'atend-v1-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import * as bot from '../engine/vsbot/index.mjs';
import * as R from '../engine/vsresultados/index.mjs';

const fila = (tel) => bot.emAtendimento().find((x) => x.telefone === tel);

test('bot transferiu: aguardando vendedor, com a hora da transferencia', () => {
  bot.entregarParaEquipe('999000000000001', { departamento: 'comercial' });
  const f = fila('999000000000001');
  assert.equal(f.assumida, false);
  assert.ok(f.transferidaEm);
  assert.equal(f.assumidaEm, null);
});

test('vendedor assume: vira "com vendedor" e a hora da transferencia NAO muda', async () => {
  const antes = fila('999000000000001').transferidaEm;
  await new Promise((ok) => setTimeout(ok, 15));
  assert.equal(bot.assumirConversa('999000000000001').ok, true);
  const f = fila('999000000000001');
  assert.equal(f.assumida, true);
  assert.equal(f.transferidaEm, antes, 'o marco "transferido" continua no mesmo horario');
  assert.ok(f.assumidaEm >= antes);
  assert.equal(f.departamento, 'comercial', 'assumir nao apaga o setor que o bot escolheu');
  assert.ok(bot.estaComGente('999000000000001'), 'o bot fica quieto');
});

test('responder de novo renova o silencio mas nao muda a hora em que assumiu', async () => {
  const antes = fila('999000000000001').assumidaEm;
  await new Promise((ok) => setTimeout(ok, 15));
  bot.assumirConversa('999000000000001');
  assert.equal(fila('999000000000001').assumidaEm, antes);
});

test('vendedor pega conversa que estava com o bot: "com vendedor" sem marco de transferencia', () => {
  bot.assumirConversa('999000000000002');
  const f = fila('999000000000002');
  assert.equal(f.assumida, true);
  assert.equal(f.transferidaEm, null, 'ninguem pediu gente: nao houve transferencia');
  assert.ok(f.assumidaEm);
});

test('devolver pro bot tira a conversa da fila', () => {
  bot.devolverAoBot('999000000000002');
  assert.equal(fila('999000000000002'), undefined);
  assert.equal(bot.estaComGente('999000000000002'), false);
});

test('pedido da conversa: estado do pagamento vem do gateway', () => {
  const tel = '999000000000003';
  R.registrarPedido({ referencia: 'A1', pagamentoId: 'p1', telefone: tel, canal: 'telegram', valorCentavos: 5990, itens: [{ nome: 'Camiseta' }], quando: '2026-09-27T10:00:00.000Z' });
  assert.equal(R.ultimoPedido(tel, [{ id: 'p1', estado: 'PENDENTE' }]).estado, 'pendente');
  assert.equal(R.ultimoPedido(tel, [{ id: 'p1', estado: 'CONFIRMADO' }]).estado, 'pago');
  assert.equal(R.ultimoPedido(tel, [{ id: 'p1', estado: 'ESTORNADO' }]).estado, 'cancelado');
  R.registrarPedido({ referencia: 'A2', pagamentoId: null, telefone: tel, canal: 'telegram', valorCentavos: 100, quando: '2026-09-27T11:00:00.000Z' });
  assert.equal(R.ultimoPedido(tel, []).referencia, 'A2', 'mostra o mais recente');
  assert.equal(R.ultimoPedido(tel, []).estado, 'sem-pagamento');
  assert.equal(R.ultimoPedido('999000000000999', []), null);
});
