import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEBHOOK_EVENTS_DIR = mkdtempSync(join(tmpdir(), 'wh-'));

import { reservarEvento, eventoConhecido, limpar, baseDir } from '../backend/idempotencia.mjs';

test('primeira chamada reserva, segunda e recusada — reentrega do Stripe nao emite 2a licenca', () => {
  assert.equal(reservarEvento('evt_1', { tipo: 'checkout.session.completed' }), true);
  assert.equal(reservarEvento('evt_1'), false);
  assert.equal(reservarEvento('evt_1'), false);
});

test('eventos diferentes nao se atrapalham', () => {
  assert.equal(reservarEvento('evt_2'), true);
  assert.equal(reservarEvento('evt_3'), true);
  assert.equal(reservarEvento('evt_2'), false);
});

test('eventoConhecido nao reserva — so consulta', () => {
  assert.equal(eventoConhecido('evt_4'), false);
  assert.equal(eventoConhecido('evt_4'), false);
  assert.equal(reservarEvento('evt_4'), true, 'consultar nao podia ter reservado');
});

test('id vazio ou ausente nao reserva nada', () => {
  assert.equal(reservarEvento(''), false);
  assert.equal(reservarEvento(null), false);
  assert.equal(reservarEvento(undefined), false);
});

test('id malicioso nao escapa do diretorio', () => {
  assert.equal(reservarEvento('../../../etc/passwd'), true);
  const arquivos = readdirSync(baseDir());
  assert.ok(arquivos.some((f) => f.includes('etc_passwd')), 'deveria ter virado nome plano');
  assert.ok(!arquivos.some((f) => f.includes('/')), 'separador de caminho sobreviveu');
});

test('a corrida e vencida por UMA chamada so', async () => {
  // dez tentativas concorrentes no mesmo id: exatamente uma pode ganhar.
  const r = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve().then(() => reservarEvento('evt_corrida'))));
  assert.equal(r.filter(Boolean).length, 1, 'mais de uma chamada reservou o mesmo evento');
});

test('limpeza remove reserva velha e preserva a recente', () => {
  const antigo = join(baseDir(), 'evt_antigo.json');
  writeFileSync(antigo, '{}');
  const velho = Date.now() / 1000 - 40 * 86400; // 40 dias atras
  utimesSync(antigo, velho, velho);
  reservarEvento('evt_novinho');
  const { removidos } = limpar(30);
  assert.equal(removidos, 1);
  assert.equal(eventoConhecido('evt_antigo'), false);
  assert.equal(eventoConhecido('evt_novinho'), true, 'reserva recente nao podia sumir');
});

test('limpar em diretorio inexistente nao quebra', () => {
  const antes = process.env.WEBHOOK_EVENTS_DIR;
  process.env.WEBHOOK_EVENTS_DIR = join(tmpdir(), 'nao-existe-' + Date.now());
  assert.deepEqual(limpar(30), { removidos: 0 });
  process.env.WEBHOOK_EVENTS_DIR = antes;
});
