/**
 * Encerramento (pelo cliente ou pelo atendente), avaliação e histórico —
 * WhatsApp e Telegram pelo mesmo caminho.
 *
 * O que estes testes seguram: "pode encerrar" fecha e pede nota; "quero
 * encerrar minha conta" NÃO fecha; a nota logo depois não reabre o
 * atendimento nem cai no bot; nota baixa pede comentário; responder outra
 * coisa no lugar da nota segue a conversa normal; toda conversa tem protocolo
 * (mesmo loja sem fluxo em planilha); e o encerrado guarda quem encerrou e
 * quem atendeu.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'encerramento-iso-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const proto = await import('../engine/vsprotocolo/index.mjs');
const bot = await import('../engine/vsbot/index.mjs');
const crm = await import('../engine/vscrm/index.mjs');
const atendimento = await import('../backend/atendimento.mjs');

crm.setFunil(['Novo lead', 'Fechado']);
bot.salvarConfig({ ativo: true, assinatura: '', nome: 'Bia' });
const enviados = [];
const enviar = async (m) => { enviados.push(m); return { ok: true }; };
let n = 0;
const fala = (de, texto) => atendimento.receberMensagem({ id: `x${n++}`, de, nome: 'Ana', texto, tipo: 'text' }, { enviar, reservar: () => true });

test('frases: encerrar e nota', () => {
  for (const t of ['pode encerrar', 'Encerrar atendimento', 'era só isso, obrigado!', 'resolvido, valeu']) { assert.equal(proto.clientePediuEncerrar(t), true, t); }
  for (const t of ['quero encerrar minha conta', 'como encerro meu plano?', 'ok']) { assert.equal(proto.clientePediuEncerrar(t), false, t); }
  assert.deepEqual(['5', 'nota 4', '⭐⭐', 'ótimo', '3/5'].map(proto.lerNota), [5, 4, 2, 5, 3]);
  assert.equal(proto.lerNota('quero 5 pizzas'), null);
});

test('toda conversa tem protocolo, mesmo sem fluxo em planilha', async () => {
  await fala('5531911110001', 'oi, boa tarde');
  assert.ok(proto.aberto('5531911110001'), 'loja só com regras também abre protocolo');
});

test('cliente encerra → pede nota → nota alta agradece, sem reabrir', async () => {
  const de = '5531911110001';
  const r = await fala(de, 'pode encerrar');
  assert.equal(r.tipo, 'encerrado:cliente');
  assert.match(enviados.at(-1).texto, /Protocolo .*[\s\S]*1 a 5/);
  assert.equal(proto.aberto(de), null);
  const p = proto.ultimoEncerrado(de);
  assert.equal(p.encerradoPor.tipo, 'cliente');
  const nota = await fala(de, '5');
  assert.equal(nota.tipo, 'avaliacao:nota');
  assert.equal(proto.aberto(de), null, 'a nota não reabre o atendimento');
  assert.equal(proto.ultimoEncerrado(de).avaliacao.nota, 5);
  assert.equal(proto.ultimoEncerrado(de).avaliacao.estado, 'respondida');
});

test('nota baixa pede comentário, e o comentário fica guardado', async () => {
  const de = '77000555';
  await fala(de, 'oi');
  await fala(de, 'era só isso');
  await fala(de, '2');
  assert.match(enviados.at(-1).texto, /o que faltou/);
  const c = await fala(de, 'demorou muito para me responderem');
  assert.equal(c.tipo, 'avaliacao:comentario');
  const a = proto.ultimoEncerrado(de).avaliacao;
  assert.equal(a.nota, 2);
  assert.equal(a.comentario, 'demorou muito para me responderem');
  assert.equal(proto.aberto(de), null);
});

test('responder outra coisa no lugar da nota segue a conversa normal', async () => {
  const de = '5531911110002';
  await fala(de, 'oi');
  await fala(de, 'pode encerrar');
  const r = await fala(de, 'esqueci, vocês abrem sábado?');
  assert.notEqual(r.tipo, 'avaliacao:nota');
  assert.equal(proto.ultimoEncerrado(de)?.avaliacao?.estado ?? 'reaberto', proto.aberto(de) ? 'reaberto' : 'sem-resposta');
  assert.ok(proto.aberto(de), 'mensagem nova abre (ou retoma) atendimento');
});

test('atendente encerra: guarda quem encerrou e quem atendeu', () => {
  const de = '5531911110003';
  const { protocolo } = proto.aoChegar(de);
  proto.anotar(protocolo.numero, { estado: proto.ESTADOS.COM_HUMANO, atendidoPor: { operadorId: 'op1', nome: 'Marta' } });
  const f = proto.encerrarPorNumero(protocolo.numero, { motivo: 'encerrado pelo atendente', por: { tipo: 'atendente', nome: 'Marta', operadorId: 'op1' } });
  assert.equal(f.encerradoPor.nome, 'Marta');
  assert.equal(f.atendidoPor.nome, 'Marta');
  assert.equal(f.estadoAntes, proto.ESTADOS.COM_HUMANO);
  proto.pedirAvaliacao(f.numero);
  assert.ok(proto.avaliacaoPendente(de));
  assert.equal(proto.avaliacaoPendente(de, new Date(Date.now() + 3 * 3600e3).toISOString()), null, 'avaliação vence em 2 h');
  assert.ok(proto.encerrados().some((p) => p.numero === f.numero));
});

test('contato por LID: protocolo novo herda o endereço do anterior (senão o aviso não sai)', () => {
  const de = '130894144782430';
  const a = proto.aoChegar(de, { endereco: `${de}@lid` }).protocolo;
  proto.encerrarPorNumero(a.numero, { motivo: 'inatividade', quando: new Date(Date.now() - 48 * 3600e3).toISOString() });
  const b = proto.aoChegar(de).protocolo; // aberto pelo painel, sem endereço na mão
  assert.equal(b.endereco, `${de}@lid`);
  assert.equal(proto.enderecoDe(de), `${de}@lid`);
  assert.equal(proto.enderecoDe('5531999999999'), '5531999999999', 'sem nada guardado, usa o próprio id');
});

test('finalizar: "posso ajudar em algo mais?" → "não" finaliza e pede nota; outra resposta continua', async () => {
  const de = '5531911110009';
  await fala(de, 'oi, quero ver meu pedido');
  const p = proto.aberto(de);
  // Atendente perguntou (a rota do servidor faz isto):
  proto.pedirFinalizacao(p.numero, { operadorId: 'op9', nome: 'Rita' });
  const cont = await fala(de, 'não, mas e o frete?');
  assert.notEqual(cont.tipo, 'finalizado', 'resposta que não é "não" continua a conversa');
  assert.ok(proto.aberto(de));
  assert.equal(proto.aberto(de).finalizacao.estado, 'continuou');
  proto.pedirFinalizacao(p.numero, { operadorId: 'op9', nome: 'Rita' });
  const fim = await fala(de, 'Não, obrigado!');
  assert.equal(fim.tipo, 'finalizado');
  const f = proto.ultimoEncerrado(de);
  assert.equal(f.desfecho, 'finalizado');
  assert.equal(f.encerradoPor.nome, 'Rita');
  assert.match(f.motivoTexto, /pergunta final/);
  assert.match(enviados.at(-1).texto, /finalizado[\s\S]*1 a 5/);
  assert.equal((await fala(de, '4')).tipo, 'avaliacao:nota');
});

test('finalizar sem resposta: fecha sozinho como finalizado (não como abandono) depois de 30 min', () => {
  const de = '5531911110010';
  const { protocolo } = proto.aoChegar(de);
  const t0 = new Date(Date.now() - 31 * 60000).toISOString();
  proto.pedirFinalizacao(protocolo.numero, { nome: 'Rita' }, t0);
  const fechados = proto.varrerInativos();
  const f = fechados.find((x) => x.numero === protocolo.numero);
  assert.equal(f.desfecho, 'finalizado');
  assert.match(f.motivoTexto, /não respondeu/);
});

test('cliente finaliza: desfecho finalizado, a frase dele vira o motivo', () => {
  const p = proto.encerrados().find((x) => x.encerradoPor?.tipo === 'cliente');
  assert.equal(p.desfecho, 'finalizado');
  assert.match(p.motivoTexto, /cliente escreveu/);
});
