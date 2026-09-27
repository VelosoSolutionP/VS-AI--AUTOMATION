/**
 * Horário de funcionamento — semana + datas especiais (calendário).
 *
 * O que estes testes seguram: data especial vence o dia da semana (feriado
 * fechado num dia útil; horário especial num domingo); turno que vira a noite
 * vale na madrugada seguinte, também em data especial; hora de Brasília;
 * horário escrito errado é recusado ao salvar; e a loja SEM fluxo em planilha
 * (só regras) também respeita o horário.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'horario-iso-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const bot = await import('../engine/vsbot/index.mjs');

// 2026-12-25 é sexta-feira. Horários em Brasília (UTC-3).
const br = (data, hhmm) => new Date(`${data}T${hhmm}:00-03:00`);
const semana = { seg: '08:00-18:00', ter: '08:00-18:00', qua: '08:00-18:00', qui: '08:00-18:00', sex: '08:00-18:00', sab: '08:00-12:00', dom: 'fechado' };

test('semana: aberto no horário, fechado fora e no domingo', () => {
  assert.equal(bot.estaAberto(semana, br('2026-12-18', '10:00')), true);
  assert.equal(bot.estaAberto(semana, br('2026-12-18', '19:00')), false);
  assert.equal(bot.estaAberto(semana, br('2026-12-20', '10:00')), false, 'domingo fechado');
});

test('data especial vence o dia da semana', () => {
  const h = { ...semana, excecoes: { '2026-12-25': { horario: 'fechado', nome: 'Natal' }, '2026-12-20': { horario: '09:00-13:00', nome: 'Domingo de Natal' } } };
  assert.equal(bot.estaAberto(h, br('2026-12-25', '10:00')), false, 'feriado numa sexta: fechado');
  assert.equal(bot.estaAberto(h, br('2026-12-20', '10:00')), true, 'domingo com horário especial: aberto');
  assert.equal(bot.estaAberto(h, br('2026-12-20', '14:00')), false);
  assert.equal(bot.estaAberto(h, br('2026-12-18', '10:00')), true, 'o resto da semana segue igual');
});

test('turno que vira a noite vale na madrugada — também em data especial', () => {
  const h = { ...semana, sex: '18:00-02:00', excecoes: { '2026-12-31': { horario: '20:00-04:00', nome: 'Réveillon' } } };
  assert.equal(bot.estaAberto(h, br('2026-12-19', '01:30')), true, 'sábado 01:30 ainda é o turno de sexta');
  assert.equal(bot.estaAberto(h, br('2027-01-01', '03:00')), true, 'madrugada do réveillon');
  assert.equal(bot.estaAberto(h, br('2027-01-01', '05:00')), false);
});

test('mensagem de fechado lista a semana e as próximas datas especiais', () => {
  const h = { ...semana, excecoes: { '2026-12-25': { horario: 'fechado', nome: 'Natal' }, '2027-06-01': { horario: 'fechado' } } };
  const txt = bot.horarioLegivel(h, br('2026-12-10', '10:00'));
  assert.match(txt, /Segunda: 08:00 às 18:00/);
  assert.match(txt, /Datas especiais:\n25\/12 \(Natal\): fechado/);
  assert.doesNotMatch(txt, /01\/06/, 'só os próximos 30 dias');
});

test('salvar recusa horário errado (dia e data especial)', () => {
  assert.equal(bot.salvarConfig({ horario: { ...semana, seg: '8h às 18h' } }).ok, false);
  assert.equal(bot.salvarConfig({ horario: { ...semana, excecoes: { '25/12/2026': { horario: 'fechado' } } } }).ok, false);
  assert.equal(bot.salvarConfig({ horario: { ...semana, excecoes: { '2026-12-25': { horario: '10:00-10:00' } } } }).ok, false, 'início = fim');
  assert.notEqual(bot.salvarConfig({ horario: { ...semana, excecoes: { '2026-12-25': { horario: 'fechado', nome: 'Natal' } } } }).ok, false);
});

test('loja só com regras (sem fluxo) também respeita o horário; pedir gente passa', () => {
  bot.apagarFluxo();
  const agora = new Date();
  const dia = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()];
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
  bot.salvarConfig({ ativo: true, assinatura: '', horario: { ...semana, [dia]: '08:00-18:00', excecoes: { [hoje]: { horario: 'fechado', nome: 'Hoje fechado' } } } });
  const r = bot.atender('oi, vocês têm pizza?', { de: '5531900001111' });
  assert.equal(r.tipo, 'fechado');
  assert.match(r.texto, /Hoje fechado/);
  const h = bot.atender('quero falar com um atendente', { de: '5531900001112' });
  assert.notEqual(h.tipo, 'fechado', 'pedir pessoa não é barrado pelo horário');
  bot.salvarConfig({ horario: null });
});
