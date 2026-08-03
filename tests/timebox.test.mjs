import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeBoxStatus, TIME_BOX_MIN } from '../engine/timebox.mjs';

const MIN = 60000;

// Fix: o time-box media wall-clock desde que a tarefa ABRIU (task.ts) — travava
// trabalho ativo e espera do dev, e re-travava a cada 30min. Agora mede INATIVIDADE
// a partir da ULTIMA atividade (task.lastTs), com fallback ao inicio (ts).

test('sem atividade recente (lastTs) usa lastTs, nao ts: tarefa velha mas ativa NAO estoura', () => {
  const now = 10_000 * MIN;
  const task = { num: '1', ts: now - 300 * MIN, lastTs: now - 2 * MIN }; // aberta ha 5h, ativa ha 2min
  const st = timeBoxStatus(task, now);
  assert.equal(st.overdue, false);
  assert.equal(st.ageMin, 2);
});

test('inatividade acima do teto estoura', () => {
  const now = 10_000 * MIN;
  const task = { num: '1', ts: now - 300 * MIN, lastTs: now - (TIME_BOX_MIN + 5) * MIN };
  const st = timeBoxStatus(task, now);
  assert.equal(st.overdue, true);
  assert.equal(st.ageMin, TIME_BOX_MIN + 5);
});

test('sem lastTs cai no fallback ts (tarefa recem-aberta nao estoura)', () => {
  const now = 10_000 * MIN;
  const task = { num: '1', ts: now - 3 * MIN };
  const st = timeBoxStatus(task, now);
  assert.equal(st.overdue, false);
  assert.equal(st.ageMin, 3);
});

test('cfg.timeBoxMin sobrepoe o teto', () => {
  const now = 10_000 * MIN;
  const task = { num: '1', lastTs: now - 12 * MIN };
  assert.equal(timeBoxStatus(task, now, { timeBoxMin: 10 }).overdue, true);
  assert.equal(timeBoxStatus(task, now, { timeBoxMin: 15 }).overdue, false);
});

test('sem tarefa/ancora = nunca estoura', () => {
  assert.equal(timeBoxStatus(null, 10_000 * MIN).overdue, false);
  assert.equal(timeBoxStatus({ num: '1' }, 10_000 * MIN).overdue, false);
});
