/**
 * Queda de sessão que parece tomada de conta.
 *
 * Golpe corriqueiro no Brasil: o golpista consegue o código de 6 dígitos, entra
 * na conta e derruba quem estava. Do lado de cá isso chega como `UNPAIRED` ou
 * `CONFLICT` — e era tratado igual a "caiu a internet", jogando fora o único
 * aviso que existe. Quem descobria depois era o cliente, recebendo pedido de
 * dinheiro em nome do escritório.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarWhatsAppWebProvider } from '../engine/canais/whatsapp-web/index.mjs';

test('o canal nasce sem queda suspeita e expoe isso no status', () => {
  const p = criarWhatsAppWebProvider();
  assert.equal(p.status().quedaSuspeita, null, 'canal novo nao pode nascer acusando invasao');
  assert.equal(typeof p.quedaSuspeita, 'function');
  assert.equal(p.quedaSuspeita(), null);
});

test('da pra assinar o aviso de invasao sem derrubar o canal', () => {
  const p = criarWhatsAppWebProvider();
  assert.equal(typeof p.aoSuspeitarInvasao, 'function');
  /* Ouvinte que quebra nao pode levar o canal junto: o aviso e importante, mas
     menos que continuar atendendo. */
  p.aoSuspeitarInvasao(() => { throw new Error('ouvinte ruim'); });
  assert.doesNotThrow(() => p.status());
});
