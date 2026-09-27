/**
 * Canal Telegram — o provider fala com a Bot API e o resto do sistema não
 * percebe a diferença: a pessoa vira lead, o bot responde e a resposta volta
 * pelo Telegram. Tudo aqui roda com um Telegram de mentira (fetch simulado):
 * nenhum teste sai pra rede.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'telegram-iso-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import {
  criarTelegramProvider, idTelegram, chatDoId, ehTelegram, normalizarUpdate, paraHtml, fatiar, tokenValido,
} from '../engine/canais/telegram/index.mjs';
import { validarProvider } from '../engine/canais/provider.mjs';
import { normalizarTelefone } from '../engine/vscrm/leads.mjs';
import * as crm from '../engine/vscrm/index.mjs';
import * as atendimento from '../backend/atendimento.mjs';

const TOKEN = '123456789:AAHfakeTokenFakeTokenFakeToken1234';

/** Telegram de mentira: responde por método e grava o que recebeu. */
function falsoTelegram(respostas = {}) {
  const chamadas = [];
  const fila = [];
  const fetchImpl = async (url, opts) => {
    const metodo = url.split('/').pop();
    const corpo = opts.body instanceof FormData ? Object.fromEntries(opts.body.entries()) : JSON.parse(opts.body || '{}');
    chamadas.push({ metodo, corpo });
    if (metodo === 'getUpdates') {
      if (opts.signal?.aborted) { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
      const lote = fila.splice(0);
      if (!lote.length) {
        // Long polling: segura ate abortarem, como o Telegram faz.
        await new Promise((res, rej) => {
          const t = setTimeout(res, 50);
          opts.signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        });
      }
      return { status: 200, json: async () => ({ ok: true, result: lote }) };
    }
    const r = typeof respostas[metodo] === 'function' ? respostas[metodo](corpo) : respostas[metodo];
    const j = r || { ok: true, result: metodo === 'getMe' ? { id: 1, username: 'lojateste_bot', first_name: 'Loja Teste' } : { message_id: 77 } };
    return { status: j.ok ? 200 : (j.error_code || 400), json: async () => j };
  };
  return { fetchImpl, chamadas, entregar: (u) => fila.push(u) };
}

const updateTexto = (texto, { chat = 5551234, tipo = 'private', msg = 10, bot = false } = {}) => ({
  update_id: msg,
  message: { message_id: msg, date: 1790000000, text: texto, chat: { id: chat, type: tipo }, from: { id: chat, is_bot: bot, first_name: 'Ana', last_name: 'Souza' } },
});

/* ------------------------------------------------------------ identidade */

test('identidade do Telegram vai e volta, e id curto nao vira celular brasileiro', () => {
  assert.equal(idTelegram(5551234), '999000005551234');
  assert.equal(chatDoId('999000005551234'), '5551234');
  assert.ok(ehTelegram('999000005551234'));
  // Telefone de verdade nunca cai na faixa do Telegram.
  assert.ok(!ehTelegram('5531999990000'));
  assert.ok(!ehTelegram('31999990000'));
  // Um id de 8 digitos cru seria lido como celular (e ganharia 55). Com a faixa, nao.
  assert.equal(normalizarTelefone(idTelegram(12345678)).telefone, '999000012345678');
});

test('token: so a forma do @BotFather passa', () => {
  assert.ok(tokenValido(TOKEN));
  assert.ok(!tokenValido('abc'));
  assert.ok(!tokenValido('123:curto'));
  assert.ok(!tokenValido(''));
});

/* ---------------------------------------------------------- normalizacao */

test('mensagem privada de texto vira mensagem canonica com endereco pra responder', () => {
  const m = normalizarUpdate(updateTexto('quero um lanche'));
  assert.equal(m.canal, 'telegram');
  assert.equal(m.de, '999000005551234');
  assert.equal(m.endereco, '999000005551234');
  assert.equal(m.texto, 'quero um lanche');
  assert.equal(m.nome, 'Ana Souza');
  assert.equal(m.id, '5551234:10');
});

test('/start (o botao "Começar") chega pro bot como um oi', () => {
  assert.equal(normalizarUpdate(updateTexto('/start')).texto, 'Olá');
  assert.equal(normalizarUpdate(updateTexto('/start abc')).texto, 'Olá');
});

test('grupo, canal e outro bot ficam de fora do atendimento', () => {
  assert.equal(normalizarUpdate(updateTexto('oi', { tipo: 'group' })), null);
  assert.equal(normalizarUpdate(updateTexto('oi', { tipo: 'channel' })), null);
  assert.equal(normalizarUpdate(updateTexto('oi', { bot: true })), null);
  assert.equal(normalizarUpdate({ update_id: 1, edited_message: {} }), null);
});

test('foto e audio chegam sem texto (o bot responde que nao le midia)', () => {
  const u = updateTexto('x'); delete u.message.text; u.message.photo = [{ file_id: 'a' }];
  const m = normalizarUpdate(u);
  assert.equal(m.tipo, 'image');
  assert.equal(m.texto, '');
});

test('negrito do WhatsApp vira HTML do Telegram, e "<" do texto nao quebra a mensagem', () => {
  assert.equal(paraHtml('*Pedido 12* — R$ 5 < 6 & ok'), '<b>Pedido 12</b> — R$ 5 &lt; 6 &amp; ok');
  assert.equal(paraHtml('~riscado~'), '<s>riscado</s>');
});

test('texto maior que o limite do Telegram sai em partes, sem perder nada', () => {
  const longo = Array.from({ length: 300 }, (_, i) => `linha ${i} com algum texto`).join('\n');
  const partes = fatiar(longo, 1000);
  assert.ok(partes.length > 1);
  assert.ok(partes.every((p) => p.length <= 1000));
  assert.equal(partes.join('\n').replace(/\s+/g, ' '), longo.replace(/\s+/g, ' '));
});

/* -------------------------------------------------------------- provider */

test('provider cumpre o contrato de canal', () => {
  assert.deepEqual(validarProvider(criarTelegramProvider()), { ok: true });
});

test('token fora do formato e recusado sem ir a rede', async () => {
  const f = falsoTelegram();
  const p = criarTelegramProvider({ fetchImpl: f.fetchImpl });
  const r = await p.conectar({ token: 'nao-e-token' });
  assert.equal(r.ok, false);
  assert.equal(f.chamadas.length, 0);
  assert.equal(p.status().estado, 'desconectado');
});

test('token recusado pelo Telegram (401) explica o que fazer e nao fica tentando', async () => {
  const f = falsoTelegram({ getMe: { ok: false, error_code: 401, description: 'Unauthorized' } });
  const p = criarTelegramProvider({ fetchImpl: f.fetchImpl });
  const r = await p.conectar({ token: TOKEN });
  assert.equal(r.ok, false);
  assert.match(r.erro, /BotFather/);
  assert.equal(p.status().estado, 'desconectado');
});

test('conecta, recebe a mensagem, entrega pro dominio e desconecta', async () => {
  const f = falsoTelegram();
  const p = criarTelegramProvider({ fetchImpl: f.fetchImpl, esperaMs: 0 });
  const recebidas = [];
  p.aoReceber(async (m) => { recebidas.push(m); });
  const r = await p.conectar({ token: TOKEN });
  assert.equal(r.ok, true);
  assert.equal(p.status().estado, 'conectado');
  assert.equal(p.status().numero, '@lojateste_bot');
  assert.equal(p.status().link, 'https://t.me/lojateste_bot');
  // Webhook tirado ANTES de ler — senao o Telegram responde 409.
  assert.ok(f.chamadas.findIndex((c) => c.metodo === 'deleteWebhook') < f.chamadas.findIndex((c) => c.metodo === 'getUpdates') || !f.chamadas.some((c) => c.metodo === 'getUpdates'));
  f.entregar(updateTexto('oi', { msg: 41 }));
  for (let i = 0; i < 40 && !recebidas.length; i++) { await new Promise((ok) => setTimeout(ok, 20)); }
  assert.equal(recebidas.length, 1);
  assert.equal(recebidas[0].texto, 'oi');
  // A proxima leitura pede so o que vem depois (nao reentrega a mesma).
  for (let i = 0; i < 20 && !f.chamadas.some((c) => c.metodo === 'getUpdates' && c.corpo.offset === 42); i++) { await new Promise((ok) => setTimeout(ok, 20)); }
  assert.ok(f.chamadas.some((c) => c.metodo === 'getUpdates' && c.corpo.offset === 42));
  // Status nunca carrega o token.
  assert.ok(!JSON.stringify(p.status()).includes(TOKEN));
  await p.desconectar();
  assert.equal(p.status().estado, 'desconectado');
});

test('enviar: vai pro chat certo, em HTML; se o Telegram nao entender a formatacao, vai sem', async () => {
  let primeira = true;
  const f = falsoTelegram({
    sendMessage: (c) => {
      if (c.parse_mode && primeira) { primeira = false; return { ok: false, error_code: 400, description: "Bad Request: can't parse entities" }; }
      return { ok: true, result: { message_id: 9 } };
    },
  });
  const p = criarTelegramProvider({ fetchImpl: f.fetchImpl, esperaMs: 0 });
  await p.conectar({ token: TOKEN });
  const r = await p.enviarTexto({ para: '999000005551234', texto: '*oi*' });
  assert.equal(r.ok, true);
  const envios = f.chamadas.filter((c) => c.metodo === 'sendMessage');
  assert.equal(envios[0].corpo.chat_id, '5551234');
  assert.equal(envios[0].corpo.parse_mode, 'HTML');
  assert.equal(envios[1].corpo.parse_mode, undefined);
  assert.equal(envios[1].corpo.text, '*oi*');
  await p.desconectar();
});

test('pessoa que bloqueou o bot: o erro diz isso, em vez de "403"', async () => {
  const f = falsoTelegram({ sendMessage: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } });
  const p = criarTelegramProvider({ fetchImpl: f.fetchImpl, esperaMs: 0 });
  await p.conectar({ token: TOKEN });
  const r = await p.enviarTexto({ para: '999000005551234', texto: 'oi' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /bloqueou/);
  await p.desconectar();
});

test('enviar sem estar conectado nao finge que foi', async () => {
  const r = await criarTelegramProvider().enviarTexto({ para: '999000005551234', texto: 'oi' });
  assert.equal(r.ok, false);
});

/* ------------------------------------------------------ ponta a ponta */

test('quem escreve pelo Telegram vira lead de origem telegram, e a trilha grava o canal', async () => {
  crm.setFunil(['Novo lead', 'Qualificado', 'Fechado']);
  const m = normalizarUpdate(updateTexto('oi', { chat: 8887777, msg: 3 }));
  const enviados = [];
  const r = await atendimento.receberMensagem(m, {
    enviar: async ({ phone, texto }) => { enviados.push({ phone, texto }); return { ok: true }; },
    reservar: () => true,
  });
  assert.equal(r.ok, true);
  const lead = crm.listar().find((l) => l.telefone === idTelegram(8887777));
  assert.ok(lead, 'lead criado com a identidade do Telegram');
  assert.equal(lead.origem, 'telegram');
  const inter = lead.historico.filter((h) => h.tipo === 'interacao');
  assert.ok(inter.length >= 1);
  assert.ok(inter.every((h) => h.canal === 'telegram'), 'toda interacao marcada como telegram');
  // A resposta do bot sai pro mesmo endereco (o canal decide que e Telegram).
  assert.ok(enviados.every((e) => ehTelegram(e.phone)));
});
