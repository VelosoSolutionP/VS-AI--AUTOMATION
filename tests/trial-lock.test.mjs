import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrityCore } from '../engine/trial-lock.mjs';
import { scheduleMoment, schtasksArgs, scheduleTrialLock } from '../installer/schedule-lock.mjs';

/* ---------------- integridade / anti-adulteração ---------------- */

const rec = (installedAt) => ({ exists: true, sigValid: true, data: { installedAt, days: 7, plan: 'trial' } });

test('integrityCore: 3 registros íntegros e iguais -> ok', () => {
  const r = integrityCore([rec(1000), rec(1000), rec(1000)]);
  assert.equal(r.managed, true);
  assert.equal(r.tamper, false);
  assert.equal(r.installedAt, 1000);
});

test('integrityCore: nenhum registro -> não gerenciado', () => {
  const r = integrityCore([{ exists: false }, { exists: false }, { exists: false }]);
  assert.equal(r.managed, false);
  assert.equal(r.tamper, false);
});

test('integrityCore: um removido -> TAMPER', () => {
  const r = integrityCore([rec(1000), { exists: false }, rec(1000)]);
  assert.equal(r.tamper, true);
  assert.match(r.motivo, /removido/);
});

test('integrityCore: assinatura inválida (data editada) -> TAMPER', () => {
  const r = integrityCore([rec(1000), { exists: true, sigValid: false, data: { installedAt: 9 } }, rec(1000)]);
  assert.equal(r.tamper, true);
  assert.match(r.motivo, /assinatura/);
});

test('integrityCore: datas divergentes -> TAMPER', () => {
  const r = integrityCore([rec(1000), rec(2000), rec(1000)]);
  assert.equal(r.tamper, true);
  assert.match(r.motivo, /divergentes/);
});

/* ---------------- agendamento (cron / schtasks) ---------------- */

test('scheduleMoment: soma os dias e formata MM/DD/YYYY', () => {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0); // 01/01/2026
  const m = scheduleMoment(base, 7);
  assert.match(m.sd, /\d{2}\/\d{2}\/\d{4}/);
  assert.ok(m.iso.startsWith('2026-01-08'));
});

test('schtasksArgs: monta /Create ONCE com data/hora', () => {
  const a = schtasksArgs({ sd: '01/08/2026', st: '12:00' });
  assert.ok(a.includes('/Create'));
  assert.ok(a.includes('ONCE'));
  assert.ok(a.includes('01/08/2026'));
});

test('scheduleTrialLock: win chama schtasks (runImpl injetado)', () => {
  const calls = [];
  const r = scheduleTrialLock({ base: 0, days: 7, platform: 'win32', runImpl: (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; } });
  assert.equal(r.scheduled, true);
  assert.equal(r.tool, 'schtasks');
  assert.equal(calls[0][0], 'schtasks');
});

test('scheduleTrialLock: falha do agendador não quebra (scheduled=false)', () => {
  const r = scheduleTrialLock({ platform: 'win32', runImpl: () => ({ status: 1, stderr: 'x' }) });
  assert.equal(r.scheduled, false);
});
