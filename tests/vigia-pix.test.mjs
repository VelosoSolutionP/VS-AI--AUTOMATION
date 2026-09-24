/**
 * Vigia do Pix do bot. O que protege: pago → desfecho UMA vez (conferência e
 * webhook não avisam em dobro); pendente continua sendo conferido; vencido sai
 * da lista; e a lista sobrevive a reinício (mora em disco).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vigia-pix-'));
process.env.VSPIX_DIR = dir;
const V = await import('../backend/vigia-pix.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const reg = (id) => ({ pagamentoId: id, referencia: `VS-${id}`, para: '5531@c.us', de: '5531', mensagens: ['msgTexto', 'msgQr'], itens: [], totalCentavos: 50 });
const estado = (e) => async () => ({ ok: true, pagamento: { id: 'x', estado: e } });

test('pendente continua na lista; pago dispara o desfecho uma vez so', async () => {
  V.registrar(reg('1'));
  const avisos = [];
  const aoConfirmar = async (r) => { avisos.push(r.referencia); };
  await V.conferir({ consultar: estado('PENDENTE'), aoConfirmar });
  assert.equal(avisos.length, 0);
  assert.equal(V.pendentes().length, 1);
  await V.conferir({ consultar: estado('CONFIRMADO'), aoConfirmar });
  await V.conferir({ consultar: estado('CONFIRMADO'), aoConfirmar });
  assert.deepEqual(avisos, ['VS-1'], 'pago avisa uma vez, e sai da lista');
  assert.equal(V.pendentes().length, 0);
});

test('o desfecho recebe as mensagens do QR pra apagar', async () => {
  V.registrar(reg('2'));
  let apagar;
  await V.conferir({ consultar: estado('DISPONIVEL'), aoConfirmar: async (r) => { apagar = r.mensagens; } });
  assert.deepEqual(apagar, ['msgTexto', 'msgQr']);
});

test('webhook primeiro: a conferencia seguinte nao avisa de novo', async () => {
  V.registrar(reg('3'));
  const avisos = [];
  const aoConfirmar = async (r) => { avisos.push(r.referencia); };
  assert.equal((await V.confirmado({ id: '3' }, { aoConfirmar })).ok, true);
  await V.conferir({ consultar: estado('CONFIRMADO'), aoConfirmar });
  assert.deepEqual(avisos, ['VS-3']);
  assert.equal((await V.confirmado({ id: 'outro' }, { aoConfirmar })).naoEDoBot, true, 'pagamento que nao e do bot nao mexe em nada');
});

test('Pix vencido sai da lista sem avisar pago', async () => {
  V.registrar(reg('4'), Date.now() - (V.MINUTOS_VALIDADE + 1) * 60000);
  let avisou = false;
  await V.conferir({ consultar: estado('CONFIRMADO'), aoConfirmar: async () => { avisou = true; } });
  assert.equal(avisou, false);
  assert.equal(V.pendentes().length, 0);
});

test('gerar o Pix de novo pro mesmo pagamento junta as mensagens pra apagar', async () => {
  V.registrar({ ...reg('5'), mensagens: ['a', 'b'] });
  V.registrar({ ...reg('5'), mensagens: ['c', 'd'] });
  assert.deepEqual(V.pendentes().find((r) => r.pagamentoId === '5').mensagens, ['a', 'b', 'c', 'd']);
});
