/**
 * Canal do WhatsApp: a mensagem que entra vira lead, passa pelo bot e a resposta
 * sai. Nada aqui toca a rede — o envio é injetado, como no resto da suíte.
 *
 * O que estes casos protegem, em ordem de estrago:
 *  - reentrega da Meta virando segundo lead / segunda cobrança de atenção;
 *  - payload forjado entrando na trilha como se fosse o cliente;
 *  - trilha jurando que respondeu quando o envio falhou.
 */
import test from 'node:test';
/* Este arquivo faz o bot atender, e atender ABRE PROTOCOLO. Sem apontar o
   armazem pra uma pasta descartavel, o teste escreveria na casa de quem roda
   — e um caso comecaria "retomando" o protocolo que o anterior deixou aberto. */
import { mkdtempSync as _mkd, rmSync as _rm } from 'node:fs';
import { tmpdir as _tmp } from 'node:os';
import { join as _join } from 'node:path';
const _dirProto = _mkd(_join(_tmp(), 'proto-iso-'));
process.env.VSPROTOCOLO_DIR = _dirProto;
process.on('exit', () => { try { _rm(_dirProto, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'wa-canal-'));
process.env.VSCRM_DIR = dir;
process.env.VSBOT_DIR = dir;
process.env.QA_GATE_HOME = dir;
// A trava de idempotencia grava FORA do QA_GATE_HOME (pasta propria). Sem
// apontar ela pro temporario, a segunda execucao da suite via toda mensagem
// como reentrega — e ainda sujava o ~/.qa-gate da maquina de quem roda.
process.env.WEBHOOK_EVENTS_DIR = join(dir, 'webhook-events');

const crm = await import('../engine/vscrm/index.mjs');
const bot = await import('../engine/vsbot/index.mjs');
const at = await import('../backend/atendimento.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

crm.setFunil(['Novo lead', 'Qualificado', 'Fechado']);
bot.salvarConfig({ ativo: true, nome: 'Bia', mensagemFallback: 'Não entendi.', falhasAteHumano: 2 });
bot.salvarRegra({ nome: 'Preço', termos: ['preco', 'quanto custa'], gatilho: 'contem', resposta: 'O plano sai R$ 149.' });

/** Envelope igual ao que a Meta manda. */
const evento = (id, texto, de = '5531975127978', nome = 'Fabiano') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '0', changes: [{ field: 'messages', value: {
    contacts: [{ wa_id: de, profile: { name: nome } }],
    messages: [{ id, from: de, timestamp: '1758300000', type: 'text', text: { body: texto } }],
  } }] }],
});

/* ---- envelope ---- */

test('extrai a mensagem de dentro do envelope da Meta', () => {
  const [m] = at.extrairMensagens(evento('wamid.1', 'quanto custa?'));
  assert.equal(m.id, 'wamid.1');
  assert.equal(m.de, '5531975127978');
  assert.equal(m.nome, 'Fabiano');
  assert.equal(m.texto, 'quanto custa?');
});

test('aviso de entrega ("lida", "entregue") nao e conversa e nao vira lead', () => {
  const statuses = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.x', status: 'read' }] } }] }] };
  assert.deepEqual(at.extrairMensagens(statuses), []);
});

test('audio e imagem entram sem texto, pra atendente ver que a pessoa falou', () => {
  const ev = { entry: [{ changes: [{ value: { messages: [{ id: 'a1', from: '5531975127978', type: 'audio' }] } }] }] };
  const [m] = at.extrairMensagens(ev);
  assert.equal(m.tipo, 'audio');
  assert.equal(m.texto, '');
});

/* ---- assinatura ---- */

test('assinatura correta passa', () => {
  const corpo = JSON.stringify(evento('wamid.a', 'oi'));
  const h = 'sha256=' + createHmac('sha256', 'segredo').update(corpo).digest('hex');
  assert.equal(at.confereAssinatura(corpo, h, 'segredo').ok, true);
});

test('assinatura de outro segredo e RECUSADA', () => {
  const corpo = JSON.stringify(evento('wamid.b', 'oi'));
  const h = 'sha256=' + createHmac('sha256', 'outro').update(corpo).digest('hex');
  const r = at.confereAssinatura(corpo, h, 'segredo');
  assert.equal(r.ok, false);
  assert.equal(r.conferida, true);
});

test('corpo adulterado depois de assinado e RECUSADO', () => {
  const corpo = JSON.stringify(evento('wamid.c', 'oi'));
  const h = 'sha256=' + createHmac('sha256', 'segredo').update(corpo).digest('hex');
  assert.equal(at.confereAssinatura(corpo + ' ', h, 'segredo').ok, false);
});

test('sem header nenhum e recusado quando ha segredo', () => {
  assert.equal(at.confereAssinatura('{}', undefined, 'segredo').ok, false);
});

test('sem WA_APP_SECRET a rota atende mas AVISA que nao conferiu', () => {
  const r = at.confereAssinatura('{}', undefined, '');
  assert.equal(r.ok, true);
  assert.equal(r.conferida, false);
  assert.match(r.motivo, /WA_APP_SECRET/);
});

/* ---- conversa ---- */

test('mensagem do cliente vira lead, bot responde e os dois lados ficam na trilha', async () => {
  at._zerarFalhas();
  const enviadas = [];
  const enviar = async ({ phone, texto }) => { enviadas.push({ phone, texto }); return { ok: true, provider: 'cloud', id: 'x1' }; };

  const r = await at.processarEvento(evento('wamid.101', 'quanto custa?'), { enviar });
  const [res] = r.resultados;

  assert.equal(res.leadNovo, true, 'devia ter criado o lead');
  assert.equal(res.tipo, 'regra');
  assert.equal(res.respondeu, true);
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].phone, '5531975127978');
  assert.match(enviadas[0].texto, /R\$ 149/);

  const lead = crm.listar().find((l) => l.id === 'l_5531975127978');
  assert.ok(lead, 'lead nao foi gravado');
  assert.equal(lead.origem, 'whatsapp');
  assert.equal(lead.nome, 'Fabiano');
  const inter = lead.historico.filter((h) => h.tipo === 'interacao');
  assert.equal(inter.length, 2, 'entrada e saida deviam estar na trilha');
  assert.equal(inter[0].direcao, 'entrada');
  assert.equal(inter[1].direcao, 'saida');
});

test('reentrega do MESMO id nao cria segundo lead nem responde de novo', async () => {
  const antes = crm.listar().find((l) => l.id === 'l_5531975127978').historico.length;
  const enviadas = [];
  const r = await at.processarEvento(evento('wamid.101', 'quanto custa?'), {
    enviar: async (m) => { enviadas.push(m); return { ok: true }; },
  });
  assert.equal(r.resultados[0].duplicado, true);
  assert.equal(enviadas.length, 0, 'nao podia ter respondido de novo');
  const depois = crm.listar().find((l) => l.id === 'l_5531975127978').historico.length;
  assert.equal(depois, antes, 'a trilha nao podia crescer');
});

test('segunda mensagem do mesmo numero cai no lead que ja existe', async () => {
  const r = await at.processarEvento(evento('wamid.102', 'quanto custa?'), { enviar: async () => ({ ok: true }) });
  assert.equal(r.resultados[0].leadNovo, false);
  assert.equal(crm.listar().filter((l) => l.telefone === '5531975127978').length, 1);
});

test('envio que FALHA nao vira interacao de saida na trilha', async () => {
  at._zerarFalhas();
  const antes = crm.listar().find((l) => l.id === 'l_5531975127978').historico.filter((h) => h.direcao === 'saida').length;
  const r = await at.processarEvento(evento('wamid.103', 'quanto custa?'), {
    enviar: async () => ({ ok: false, provider: 'cloud', error: 'token vencido' }),
  });
  assert.equal(r.resultados[0].respondeu, false);
  const depois = crm.listar().find((l) => l.id === 'l_5531975127978').historico.filter((h) => h.direcao === 'saida').length;
  assert.equal(depois, antes, 'registrou resposta que nunca saiu');
});

test('quem pede atendente dispara handoff', async () => {
  at._zerarFalhas();
  const r = await at.processarEvento(evento('wamid.104', 'quero falar com um atendente'), { enviar: async () => ({ ok: true }) });
  assert.equal(r.resultados[0].tipo, 'humano');
  assert.equal(r.resultados[0].handoff, true);
});

test('dois "nao entendi" seguidos chamam gente', async () => {
  at._zerarFalhas();
  /* O teste anterior (pede atendente) poe este numero na fila e o bot se cala —
     que e o certo. Aqui a conversa tem de comecar do zero, de volta com o bot. */
  bot.devolverAoBot('5531975127978');
  const p1 = await at.processarEvento(evento('wamid.105', 'xyzabc'), { enviar: async () => ({ ok: true }) });
  assert.equal(p1.resultados[0].handoff, false, 'na primeira falha ainda tenta');
  const p2 = await at.processarEvento(evento('wamid.106', 'wkqjhe'), { enviar: async () => ({ ok: true }) });
  assert.equal(p2.resultados[0].handoff, true, 'na segunda tem de chamar gente');
});

test('bot desligado: registra a mensagem e NAO responde', async () => {
  bot.salvarConfig({ ativo: false });
  const enviadas = [];
  const r = await at.processarEvento(evento('wamid.107', 'quanto custa?'), {
    enviar: async (m) => { enviadas.push(m); return { ok: true }; },
  });
  assert.equal(r.resultados[0].botDesligado, true);
  assert.equal(enviadas.length, 0);
  bot.salvarConfig({ ativo: true });
});

test('telefone fora do padrao nao entra', async () => {
  const r = await at.receberMensagem({ id: 'wamid.108', de: 'abc', texto: 'oi' }, { enviar: async () => ({ ok: true }) });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /telefone/);
});


/* ---- o que o primeiro teste com telefone de verdade mostrou ---- */

test('audio recebe resposta cordial, em vez de silencio', async () => {
  at._zerarFalhas();
  bot.devolverAoBot('5531975127978'); // conversa nova: o teste anterior deixou o numero na fila

  bot.salvarConfig({ ativo: true, mensagemSemTexto: 'Ainda não consigo ouvir áudio — me escreve em texto?' });
  const enviadas = [];
  const r = await at.receberMensagem(
    { id: 'wamid.audio1', de: '5531975127978', nome: 'Fabiano', tipo: 'audio', texto: '' },
    { enviar: async (m) => { enviadas.push(m); return { ok: true }; } },
  );
  assert.equal(r.semTexto, true);
  assert.equal(r.respondeu, true, 'silencio parece defeito pra quem mandou');
  assert.match(enviadas[0].texto, /escreve em texto/);
  assert.equal(r.handoff, true, 'quem manda audio costuma querer gente');
});

test('audio com o bot desligado nao responde, mas fica na trilha', async () => {
  bot.salvarConfig({ ativo: false });
  const enviadas = [];
  const r = await at.receberMensagem(
    { id: 'wamid.audio2', de: '5531975127978', tipo: 'audio', texto: '' },
    { enviar: async (m) => { enviadas.push(m); return { ok: true }; } },
  );
  assert.equal(enviadas.length, 0);
  assert.equal(r.semTexto, true);
  bot.salvarConfig({ ativo: true });
});
