import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarVisao } from '../engine/vspainel/visao.mjs';

const AGORA = '2026-09-27T12:00:00.000Z';
const d = (dias) => new Date(Date.parse(AGORA) - dias * 86400000).toISOString();
const ehTelegram = (t) => String(t).startsWith('999');
const lead = (tel, criado, status = 'aberto', fechado) => ({ telefone: tel, criadoEm: criado, status,
  historico: [{ tipo: 'criado', quando: criado }, ...(fechado ? [{ tipo: 'fechado', status, quando: fechado }] : [])] });

test('leads novos por dia e por canal; variação sobre o período anterior', () => {
  const leads = [lead('5531900000001', d(1)), lead('999000000000002', d(1)), lead('999000000000003', d(2)), lead('5531900000004', d(10))];
  const v = montarVisao({ leads, ehTelegram, dias: 7, agora: AGORA });
  assert.equal(v.kpis.leadsNovos, 3);
  const dia1 = v.serieLeads.find((x) => x.dia === d(1).slice(0, 10));
  assert.deepEqual([dia1.whatsapp, dia1.telegram], [1, 1]);
  assert.equal(v.variacao.leadsNovos, 2); // 3 contra 1
  assert.equal(v.serieLeads.length, 8);
});

test('conversão só com lead fechado no período; sem fechado é null, não 0%', () => {
  assert.equal(montarVisao({ leads: [lead('1', d(1))], dias: 7, agora: AGORA }).kpis.conversao, null);
  const leads = [lead('1', d(3), 'ganho', d(1)), lead('2', d(3), 'perdido', d(2)), lead('3', d(20), 'ganho', d(20))];
  assert.equal(montarVisao({ leads, dias: 7, agora: AGORA }).kpis.conversao, 0.5);
});

test('receita soma os canais dia a dia; sem base anterior a variação é null', () => {
  const r = (canal, c, ant) => ({ canal, receitaCentavos: c, receitaAnteriorCentavos: ant, pedidos: 2, pedidosConcluidos: 1, serie: [{ dia: d(1).slice(0, 10), centavos: c }], oportunidades: [{ valorCentavos: 500 }] });
  const v = montarVisao({ resultados: [r('whatsapp', 1000, 0), r('telegram', 3000, 0)], dias: 7, agora: AGORA });
  assert.equal(v.kpis.receitaCentavos, 4000);
  assert.equal(v.kpis.pedidos, 4);
  assert.equal(v.variacao.receitaCentavos, null);
  assert.equal(v.serieReceita.find((x) => x.dia === d(1).slice(0, 10)).centavos, 4000);
  assert.equal(v.atencao.aguardandoPagamento, 2);
  assert.equal(v.atencao.aguardandoCentavos, 1000);
});

test('sem auditoria, TPR e conversas ficam null', () => {
  const v = montarVisao({ agora: AGORA });
  assert.equal(v.kpis.tprMedio, null);
  assert.equal(v.kpis.conversas, null);
});
