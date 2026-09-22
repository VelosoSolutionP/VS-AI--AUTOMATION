import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusIntegracoes } from '../engine/vscrm/index.mjs';

const semCloud = () => {
  delete process.env.WHATSAPP_PROVIDER;
  delete process.env.WA_TOKEN;
  delete process.env.WA_PHONE_ID;
};

const canais = (estado) => ({ montado: true, canais: [{ nome: 'whatsapp-web', oficial: false, estado }] });

test('O BUG: canal pareado e conversando aparecia como "inativo" no topo', () => {
  semCloud();
  const w = statusIntegracoes(canais('conectado')).whatsapp;
  assert.equal(w.envia, true, 'com o canal conectado o topo tem que acender');
  assert.equal(w.via, 'whatsapp-web');
});

test('canal em qualquer estado que nao seja conectado continua inativo', () => {
  semCloud();
  for (const estado of ['desconectado', 'aguardando_qr', 'conectando', 'caido']) {
    const w = statusIntegracoes(canais(estado)).whatsapp;
    assert.equal(w.envia, false, `${estado} nao pode dizer que esta ativo`);
    assert.equal(w.via, null);
  }
});

test('sem canal nenhum e sem Cloud API: inativo, como antes', () => {
  semCloud();
  const w = statusIntegracoes().whatsapp;
  assert.equal(w.envia, false);
  assert.equal(w.canal, null);
  assert.equal(w.cloud, false);
});

test('Cloud API configurada acende mesmo sem canal proprio, e diz que e a oficial', () => {
  process.env.WHATSAPP_PROVIDER = 'cloud';
  process.env.WA_TOKEN = 'tok';
  process.env.WA_PHONE_ID = '123';
  const w = statusIntegracoes().whatsapp;
  assert.equal(w.envia, true);
  assert.equal(w.cloud, true);
  assert.equal(w.via, 'API oficial');
  semCloud();
});

test('Cloud API pela metade nao conta — token sem phone id nao envia nada', () => {
  process.env.WHATSAPP_PROVIDER = 'cloud';
  process.env.WA_TOKEN = 'tok';
  delete process.env.WA_PHONE_ID;
  assert.equal(statusIntegracoes().whatsapp.envia, false);
  semCloud();
});

test('a API oficial ganha do canal proprio na hora de dizer POR ONDE esta ativo', () => {
  process.env.WHATSAPP_PROVIDER = 'cloud';
  process.env.WA_TOKEN = 'tok';
  process.env.WA_PHONE_ID = '123';
  assert.equal(statusIntegracoes(canais('conectado')).whatsapp.via, 'API oficial');
  semCloud();
});
