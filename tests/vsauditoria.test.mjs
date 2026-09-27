/**
 * Auditor do canal — métricas de mercado calculadas a partir do que foi gravado.
 *
 * O que estes testes seguram: TPR mede da fila até a 1ª resposta da equipe;
 * TMA da abertura ao encerramento; SLA e CSAT com a regra padrão; o que o bot
 * resolveu sozinho conta como resolução pelo bot; só entra o canal pedido; o
 * funil não cresce etapa a etapa; e o log traz quem, o quê e quando.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarAuditoria } from '../engine/vsauditoria/index.mjs';

const AGORA = '2026-09-27T15:00:00.000Z';
const h = (min) => new Date(new Date(AGORA).getTime() - min * 60000).toISOString();
const tg = (id) => /^999/.test(id);
const leads = [
  { telefone: '999000000000001', nome: 'Ana', historico: [
    { tipo: 'interacao', direcao: 'entrada', quando: h(100), texto: 'oi' },
    { tipo: 'interacao', direcao: 'saida', autor: 'bot', quando: h(100), texto: 'olá' },
    { tipo: 'interacao', direcao: 'saida', autor: 'atendente', quando: h(86), texto: 'sou a Marta' }] },
  { telefone: '999000000000002', nome: 'Bruno', historico: [
    { tipo: 'interacao', direcao: 'entrada', quando: h(60), texto: 'horário?' },
    { tipo: 'interacao', direcao: 'saida', autor: 'bot', quando: h(60), texto: '9h às 18h' }] },
  { telefone: '5531999990000', nome: 'Zé do WhatsApp', historico: [{ tipo: 'interacao', direcao: 'entrada', quando: h(50), texto: 'oi' }] },
];
const protocolos = [
  { numero: 'VS-1', de: '999000000000001', abertoEm: h(100), filaDesde: h(90), encerradoEm: h(70), estado: 'encerrado', estadoAntes: 'com_humano', desfecho: 'finalizado',
    atendidoPor: { nome: 'Marta' }, encerradoPor: { tipo: 'atendente', nome: 'Marta' }, avaliacao: { nota: 5, notaEm: h(69) } },
  { numero: 'VS-2', de: '999000000000002', abertoEm: h(60), encerradoEm: h(55), estado: 'encerrado', estadoAntes: 'com_bot', desfecho: 'finalizado', encerradoPor: { tipo: 'cliente' }, avaliacao: { nota: 2, notaEm: h(54), comentario: 'demorou' } },
  { numero: 'VS-3', de: '5531999990000', abertoEm: h(50), estado: 'com_bot' },
  { numero: 'VS-0', de: '999000000000002', abertoEm: h(60 * 24 * 40), encerradoEm: h(60 * 24 * 40 - 5), estado: 'encerrado', desfecho: 'inatividade' },
];

test('métricas de mercado só do canal pedido', () => {
  const a = montarAuditoria({ canal: 'telegram', doCanal: tg, leads, protocolos, dias: 30, agora: AGORA });
  assert.equal(a.kpis.conversas, 2, 'WhatsApp e protocolo fora do período não entram');
  assert.equal(a.kpis.pelaEquipe, 1);
  assert.equal(a.kpis.taxaBot, 0.5);
  assert.equal(a.kpis.tprMedio, 4, 'da fila (90 min atrás) até a 1ª resposta da equipe (86)');
  assert.equal(a.kpis.tmaMedio, 30, 'abertura → encerramento de quem teve gente');
  assert.equal(a.kpis.sla, 1, '4 min ≤ SLA de 5');
  assert.equal(a.kpis.csat, 0.5, 'nota ≥ 4 conta como satisfeito');
  assert.equal(a.kpis.notaMedia, 3.5);
  assert.deepEqual(a.funil.map((f) => f.n), [2, 1, 1, 1, 1]);
  assert.equal(a.atendentes[0].nome, 'Marta');
  assert.equal(a.atendentes[0].tprMedio, 4);
  assert.equal(a.serie.reduce((s, x) => s + x.bot + x.equipe, 0), 2);
  assert.equal(a.calor.flat().reduce((s, x) => s + x, 0), 2, 'mapa de calor conta mensagens de cliente do canal');
});

test('log de auditoria: quem, o quê, quando e protocolo — mais recente primeiro', () => {
  const a = montarAuditoria({ canal: 'telegram', doCanal: tg, leads, protocolos, dias: 30, agora: AGORA });
  const fin = a.log.find((e) => e.tipo === 'finalizado' && e.protocolo === 'VS-1');
  assert.equal(fin.quem, 'Marta');
  assert.ok(a.log.some((e) => e.tipo === 'avaliacao' && /nota 2\/5 — “demorou”/.test(e.detalhe)));
  assert.ok(a.log.some((e) => e.tipo === 'transferido' && e.protocolo === 'VS-1'));
  assert.ok(!a.log.some((e) => e.cliente === 'Zé do WhatsApp'), 'nada do outro canal');
  assert.ok(a.log.every((e, i) => i === 0 || a.log[i - 1].quando >= e.quando));
});

test('sem dado, métrica sai null (não inventa zero)', () => {
  const a = montarAuditoria({ canal: 'telegram', doCanal: tg, leads: [], protocolos: [], dias: 7, agora: AGORA });
  assert.equal(a.kpis.conversas, 0);
  assert.equal(a.kpis.tprMedio, null);
  assert.equal(a.kpis.csat, null);
  assert.equal(a.variacao.conversas, null, 'sem base anterior não há variação');
});
