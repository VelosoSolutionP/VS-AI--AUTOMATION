import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionContext } from '../engine/session-context.mjs';

// Fix: o SessionStart despejava 7 parágrafos de regra INTEIROS toda sessão. Texto
// grande e repetido perde saliência e o modelo passa a pular. Enxugado para ponteiro
// curto; gate+recibo mantidos em alta saliência (inegociável do dev).

test('mantém gate + recibo salientes (inegociável)', () => {
  const ctx = buildSessionContext({ consent: false });
  assert.match(ctx, /GATE \+ RECIBO/);
  assert.match(ctx, /qa-gate-green\.json/);
  assert.match(ctx, /qa_run_gate/);
  assert.match(ctx, /status="green"/);
  assert.match(ctx, /idade < 30min/);
});

test('mantém regra de testes antes do commit', () => {
  const ctx = buildSessionContext({ consent: false });
  assert.match(ctx, /\[Testes\]/);
  assert.match(ctx, /NUNCA a suíte/);
});

test('mantém economia de token', () => {
  const ctx = buildSessionContext({ consent: false });
  assert.match(ctx, /VS-AGENT-001/);
  assert.match(ctx, /files_with_matches/);
});

test('reflete consentimento na telemetria', () => {
  assert.match(buildSessionContext({ consent: true }), /Telemetria: ON/);
  assert.match(buildSessionContext({ consent: false }), /Telemetria: OFF/);
});

test('está ENXUTO — sem o wall antigo de 7 parágrafos', () => {
  const ctx = buildSessionContext({ consent: false });
  // No máximo 4 linhas (era 7+). Prova o corte do wall.
  assert.ok(ctx.split('\n').length <= 4, `esperado <=4 linhas, veio ${ctx.split('\n').length}`);
  // Blocos redundantes com guards NÃO devem repetir o texto longo no SessionStart.
  assert.doesNotMatch(ctx, /\[EXECUÇÃO/);
  assert.doesNotMatch(ctx, /\[COLABORAÇÃO/);
  assert.doesNotMatch(ctx, /\[IMPEDIMENTO/);
});
