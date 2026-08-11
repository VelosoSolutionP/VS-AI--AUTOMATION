import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKpis, mixPorTipo, fechadasPorMes, porResponsavel, horasPorPessoa, aderencia } from '../engine/vsdiretoria/kpis.mjs';
import { donut, legend, columns, barsH, gauge } from '../engine/vsdiretoria/charts.mjs';
import { renderDashboard, renderDocument } from '../engine/vsdiretoria/render.mjs';

const dataset = {
  projeto: 'RURAP',
  counts: { todas: 100, abertas: 20, fechadas: 80, epico: 5, hu: 40, tarefa: 30, defeito: 60, nc: 8 },
  recentClosed: [
    { tracker: { name: 'História do Usuário' }, assigned_to: { name: 'Fabiano' }, closed_on: '2026-07-10T00:00:00Z', custom_fields: [{ name: 'Pontos MSB', value: '5' }] },
    { tracker: { name: 'Defeito' }, assigned_to: { name: 'Flávio' }, closed_on: '2026-07-15T00:00:00Z' },
    { tracker: { name: 'História do Usuário' }, assigned_to: { name: 'Fabiano' }, closed_on: '2026-08-02T00:00:00Z', custom_fields: [{ name: 'Pontos MSB', value: '3' }] },
  ],
  timeEntries: [{ user: { name: 'Fabiano' }, hours: 4 }, { user: { name: 'Fabiano' }, hours: 2 }, { user: { name: 'Flávio' }, hours: 5 }],
  aderenciaAmostra: [
    { huId: 1, filhas: 3, temCenario: true, temExecucao: true },
    { huId: 2, filhas: 1, temCenario: false, temExecucao: false },
  ],
  automacao: { issuesAutomacao: 7, gatesVerdes: 12 },
};

/* ---------------- kpis ---------------- */

test('mixPorTipo: filtra zeros e ordena por presença', () => {
  const m = mixPorTipo(dataset.counts);
  assert.ok(m.find((x) => x.label === 'Defeitos').value === 60);
  assert.ok(m.every((x) => x.value > 0));
});

test('fechadasPorMes: agrupa por YYYY-MM ordenado', () => {
  const f = fechadasPorMes(dataset.recentClosed);
  assert.deepEqual(f, [{ label: '2026-07', value: 2 }, { label: '2026-08', value: 1 }]);
});

test('porResponsavel: conta e ordena desc', () => {
  const r = porResponsavel(dataset.recentClosed);
  assert.equal(r[0].label, 'Fabiano');
  assert.equal(r[0].value, 2);
});

test('horasPorPessoa: soma e ordena', () => {
  const h = horasPorPessoa(dataset.timeEntries);
  assert.equal(h.find((x) => x.label === 'Fabiano').value, 6);
  assert.equal(h.find((x) => x.label === 'Flávio').value, 5);
});

test('aderencia: percentuais da amostra', () => {
  const a = aderencia(dataset.aderenciaAmostra);
  assert.equal(a.amostra, 2);
  assert.equal(a.comTree, 50);
  assert.equal(a.comCenario, 50);
});

test('computeKpis: tiles principais', () => {
  const k = computeKpis(dataset);
  assert.equal(k.tiles.entregues, 80);
  assert.equal(k.tiles.taxaEntrega, 80);
  assert.equal(k.tiles.defeitos, 60);
  assert.equal(k.tiles.defeitosPorHU, 1.5);
  assert.equal(k.tiles.pontosEntreguesAmostra, 8); // 5 + 3 das HUs
  assert.equal(k.automacao.gatesVerdes, 12);
});

test('computeKpis: dataset vazio não quebra', () => {
  const k = computeKpis({ counts: {}, recentClosed: [], timeEntries: [], aderenciaAmostra: [] });
  assert.equal(k.tiles.entregues, 0);
  assert.equal(k.mix.length, 0);
  assert.equal(k.aderencia.comTree, 0);
});

/* ---------------- charts ---------------- */

test('donut: SVG com arco por segmento', () => {
  const svg = donut([{ label: 'A', value: 3 }, { label: 'B', value: 1 }]);
  assert.match(svg, /<svg/);
  assert.equal((svg.match(/<circle/g) || []).length, 2);
});

test('legend: mostra label + valor + %', () => {
  const h = legend([{ label: 'A', value: 3 }, { label: 'B', value: 1 }]);
  assert.match(h, /A<b>3<\/b><em>75%/);
});

test('columns: vazio -> mensagem; com dados -> rects', () => {
  assert.match(columns([]), /sem dados/);
  assert.match(columns([{ label: '2026-07', value: 2 }]), /<rect/);
});

test('barsH: fill proporcional', () => {
  const h = barsH([{ label: 'X', value: 10 }, { label: 'Y', value: 5 }]);
  assert.match(h, /width:100%/);
  assert.match(h, /width:50%/);
});

test('gauge: cor por faixa', () => {
  assert.match(gauge(90), /var\(--ok\)/);
  assert.match(gauge(60), /var\(--warn\)/);
  assert.match(gauge(20), /var\(--bad\)/);
});

/* ---------------- render ---------------- */

test('renderDashboard: contém tiles e seções', () => {
  const html = renderDashboard(computeKpis(dataset));
  assert.match(html, /Painel da Diretoria/);
  assert.match(html, /Entregues/);
  assert.match(html, /Composição do trabalho/);
  assert.match(html, /aderência ao fluxo/i);
});

test('renderDocument: documento completo dark/light', () => {
  const html = renderDocument(computeKpis(dataset), { geradoEm: '2026-08-11' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /data-theme=dark/);
});
