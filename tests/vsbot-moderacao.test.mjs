/**
 * Respeito no atendimento — e os limites dele.
 *
 * O caso que mais importa aqui não é o xingamento: é o cliente COM CONTRATO.
 * Um robô decidir parar de atender quem já pagou cria problema com a OAB e com
 * o cliente, e é o tipo de regra que só se descobre quebrada depois.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'moderacao-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import { ehOfensa, avaliar, HORAS_DE_SILENCIO } from '../engine/vsbot/moderacao.mjs';

test('ofensa dirigida a quem atende conta; desabafo sobre a situacao nao', () => {
  assert.equal(ehOfensa('vai se foder'), true);
  assert.equal(ehOfensa('seu imbecil'), true);
  assert.equal(ehOfensa('FDP'), true);
  assert.equal(ehOfensa('f  d  p'), false, 'sem exagerar: separado por espaco vira falso positivo facil');
  assert.equal(ehOfensa('vagabundoooooo'), true, 'letra repetida e a mesma ofensa');

  // Estes NAO sao ofensa a ninguem — e barrar aqui calaria gente no pior dia dela.
  assert.equal(ehOfensa('que merda'), false);
  assert.equal(ehOfensa('caralho'), false);
  assert.equal(ehOfensa('preciso de ajuda urgente'), false);
  assert.equal(ehOfensa(''), false);
});

test('palavra dentro de outra nao dispara', () => {
  assert.equal(ehOfensa('vou pegar o burro de carga amanha'), true, 'sanidade: "burro" isolado conta');
  assert.equal(ehOfensa('moro em Burrolandia'), false, 'nao pode casar no meio da palavra');
});

test('primeira vez avisa, segunda encerra por 12 horas', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const um = avaliar('seu idiota', {}, { agora });
  assert.equal(um.acao, 'avisa');
  assert.equal(um.marcar.avisosDeRespeito, 1);
  assert.ok(!um.marcar.silenciadoAte, 'primeira vez nao cala ninguem');

  const dois = avaliar('seu idiota', um.marcar, { agora });
  assert.equal(dois.acao, 'encerra');
  assert.match(dois.texto, new RegExp(`${HORAS_DE_SILENCIO} horas`));
  const horas = (Date.parse(dois.marcar.silenciadoAte) - agora) / 3600000;
  assert.equal(horas, HORAS_DE_SILENCIO);
});

test('durante o castigo o bot fica CALADO — nao repete a bronca', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const ate = new Date(agora + 3600 * 1000).toISOString();
  const r = avaliar('oi, desculpa', { silenciadoAte: ate }, { agora });
  assert.equal(r.acao, 'calado');
  assert.equal(r.texto, undefined, 'silencio prometido e silencio cumprido');
});

test('passado o prazo, volta a atender normalmente', () => {
  const agora = Date.parse('2026-09-24T10:00:00.000Z');
  const ate = new Date(Date.parse('2026-09-23T22:00:00.000Z')).toISOString();
  assert.equal(avaliar('oi, quero marcar consulta', { silenciadoAte: ate }, { agora }).acao, 'segue');
});

test('cliente COM CONTRATO nunca e encerrado por robo', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  let estado = {};
  for (let i = 0; i < 4; i += 1) {
    const r = avaliar('seu incompetente', estado, { agora, temContrato: true });
    assert.equal(r.acao, 'avisa', `na ${i + 1}a vez ainda nao pode encerrar`);
    assert.ok(!r.marcar.silenciadoAte, 'contrato ativo nao vira silencio');
    assert.ok(r.marcar.ofensaComContrato, 'mas fica marcado pra uma pessoa decidir');
    estado = r.marcar;
  }
  assert.equal(estado.avisosDeRespeito, 4, 'as vezes sao contadas do mesmo jeito');
});
