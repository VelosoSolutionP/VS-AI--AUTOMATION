import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptSummary } from '../engine/notify-whatsapp.mjs';

// Fix: o gate so olhava o WhatsApp e gritava "recibo NAO entregue" mesmo com o
// Slack tendo entregue. receiptSummary olha TODOS os canais.

test('entregue por Slack mesmo com WhatsApp falho (cota) — nao e alarme falso', () => {
  const line = receiptSummary({
    slack: { ok: true, status: 200 },
    whatsapp: { ok: false, status: 200, reason: 'CallMeBot: cota gratuita esgotada (assine para reativar)' },
  });
  assert.match(line, /ENTREGUE \(Slack\)/);
  assert.match(line, /nota:.*cota gratuita esgotada/);
  assert.doesNotMatch(line, /FALHOU/);
});

test('entregue por WhatsApp quando so ele sai', () => {
  const line = receiptSummary({
    slack: { ok: false, skipped: true },
    whatsapp: { ok: true, status: 200 },
  });
  assert.match(line, /ENTREGUE \(WhatsApp\)/);
});

test('todos desativados -> DESATIVADO', () => {
  const line = receiptSummary({
    slack: { ok: false, skipped: true },
    whatsapp: { ok: false, skipped: true },
  });
  assert.match(line, /DESATIVADO/);
});

test('nenhum canal entrega -> FALHOU com o motivo real', () => {
  const line = receiptSummary({
    slack: { ok: false, status: 500, error: 'boom' },
    whatsapp: { ok: false, status: 200, reason: 'CallMeBot: cota gratuita esgotada (assine para reativar)' },
  });
  assert.match(line, /FALHOU/);
  assert.match(line, /Slack: boom/);
  assert.match(line, /WhatsApp: CallMeBot: cota gratuita esgotada/);
});
