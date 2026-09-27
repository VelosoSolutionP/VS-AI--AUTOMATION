/**
 * Um bot por canal — WhatsApp e Telegram com configuração, regras e fluxo
 * próprios.
 *
 * O que estes testes seguram: o Telegram nasce como CÓPIA do bot atual (nada
 * muda pro cliente na troca) e daí em diante é independente; mudar um não mexe
 * no outro; a mensagem de cada canal é atendida pelo bot DAQUELE canal (nome,
 * horário); e apagar o fluxo do Telegram não derruba conversa do WhatsApp.
 */
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'bot-canal-iso-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const bot = await import('../engine/vsbot/index.mjs');
const crm = await import('../engine/vscrm/index.mjs');
const atendimento = await import('../backend/atendimento.mjs');

const tg = (fn) => bot.comCanal('telegram', fn);

test('Telegram nasce como cópia do bot atual e depois é independente', () => {
  bot.salvarConfig({ ativo: true, nome: 'Micaela', assinatura: '' });
  bot.salvarRegra({ id: 'preco', termos: ['preço'], resposta: 'Custa R$ 10.' });
  assert.equal(existsSync(join(casa, 'vsbot', 'config.telegram.json')), false);
  assert.equal(tg(() => bot.getConfig().nome), 'Micaela', 'primeira leitura: cópia');
  assert.equal(tg(() => bot.regras().length), 1);
  assert.equal(existsSync(join(casa, 'vsbot', 'config.telegram.json')), true);

  tg(() => bot.salvarConfig({ nome: 'Tina do Telegram' }));
  tg(() => bot.salvarRegra({ id: 'frete', termos: ['frete'], resposta: 'Frete grátis no Telegram.' }));
  assert.equal(bot.getConfig().nome, 'Micaela', 'WhatsApp não mudou');
  assert.equal(bot.regras().length, 1, 'regra do Telegram não vazou');
  bot.salvarConfig({ nome: 'Micaela WA' });
  assert.equal(tg(() => bot.getConfig().nome), 'Tina do Telegram', 'e o contrário também');
});

test('cada mensagem é atendida pelo bot do seu canal', async () => {
  crm.setFunil(['Novo lead', 'Fechado']);
  const enviados = [];
  const enviar = async (m) => { enviados.push(m); return { ok: true }; };
  // Telegram fechado hoje; WhatsApp aberto.
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  tg(() => bot.salvarConfig({ horario: { seg: '00:00-23:59', ter: '00:00-23:59', qua: '00:00-23:59', qui: '00:00-23:59', sex: '00:00-23:59', sab: '00:00-23:59', dom: '00:00-23:59', excecoes: { [hoje]: { horario: 'fechado', nome: 'Folga do Telegram' } } } }));
  await atendimento.receberMensagem({ id: 'c1', de: '999000000777001', nome: 'Ana', texto: 'qual o frete?', tipo: 'text', canal: 'telegram' }, { enviar, reservar: () => true });
  assert.match(enviados.at(-1).texto, /Folga do Telegram/, 'Telegram usa o horário dele');
  await atendimento.receberMensagem({ id: 'c2', de: '5531988887777', nome: 'Beto', texto: 'qual o preço?', tipo: 'text' }, { enviar, reservar: () => true });
  assert.match(enviados.at(-1).texto, /Custa R\$ 10/, 'WhatsApp segue aberto, com a regra dele');
  tg(() => bot.salvarConfig({ horario: null }));
  await atendimento.receberMensagem({ id: 'c3', de: '999000000777001', nome: 'Ana', texto: 'e o frete?', tipo: 'text', canal: 'telegram' }, { enviar, reservar: () => true });
  assert.match(enviados.at(-1).texto, /Frete grátis no Telegram/, 'regra só do Telegram');
});

test('apagar o fluxo do Telegram não derruba conversa do WhatsApp', () => {
  bot.assumirConversa('5531988887777');
  bot.assumirConversa('999000000777001');
  tg(() => bot.apagarFluxo());
  assert.equal(bot.estaComGente('5531988887777'), true, 'WhatsApp intacto');
  assert.equal(bot.estaComGente('999000000777001'), false, 'Telegram zerado');
});
