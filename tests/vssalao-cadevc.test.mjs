/**
 * Cliente da API do Cadê Você (21/10): lê salão/vagas/agendamentos e grava
 * marcar/ação pelos endpoints descobertos, com o Bearer do salão. Formato do
 * fake espelha o que a API real devolveu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarCadevcClient } from '../engine/vssalao/cadevc.mjs';

function fakeCadevc() {
  const chamadas = [];
  const fetchImpl = async (url, o = {}) => {
    chamadas.push({ url, method: o.method || 'GET', body: o.body, auth: o.headers?.authorization });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    const u = new URL(url);
    const p = u.pathname;
    if (p.endsWith('/salao')) {
      return ok({ salao: { id: 'cmv', nome: 'Studio da Rê', telefone: '(11) 98888-7777' },
        regras: { cancelamentoHorasMinimo: 24, multa: { valor: 20, tipo: 'FIXO' }, confirmacaoPresenca: true },
        horarios: [{ diaSemana: 1, abre: '09:00', fecha: '19:00', fechado: false }],
        servicos: [{ id: 'd-sv8', nome: 'Corte masculino', preco: 35, duracao: 30, categoria: 'Barbearia' }] });
    }
    if (p.endsWith('/horarios')) {
      if (!u.searchParams.get('data') || !u.searchParams.get('servicos')) { return { ok: false, status: 400, json: async () => ({ error: 'Informe data=YYYY-MM-DD e servicos=id1,id2' }) }; }
      return ok({ data: u.searchParams.get('data'), duracao: 30, valor: 35, profissionais: [{ id: 'd-c1', nome: 'Carla Barbosa', horarios: ['09:00', '09:30'] }] });
    }
    if (p.endsWith('/agendamentos') && (o.method || 'GET') === 'GET') {
      if (!u.searchParams.get('telefone')) { return { ok: false, status: 400, json: async () => ({ error: 'Informe telefone com DDD' }) }; }
      return ok({ agendamentos: [{ id: 'ag1', servico: 'Corte masculino', data: '2026-10-22', hora: '09:00' }] });
    }
    if (p.endsWith('/agendamentos') && o.method === 'POST') { return ok({ id: 'ag-novo', status: 'MARCADO' }); }
    if (/\/agendamentos\/[^/]+$/.test(p) && o.method === 'POST') { return ok({ id: p.split('/').pop(), status: 'CANCELADO' }); }
    return { ok: false, status: 404, json: async () => ({ error: 'rota falsa' }) };
  };
  return { fetchImpl, chamadas };
}

const base = { baseUrl: 'https://cadevc.x/api/integracao/v1', token: 'bfy_abc' };

test('lê salão com regras, horários e serviços, mandando o Bearer', async () => {
  const g = fakeCadevc();
  const c = criarCadevcClient({ ...base, fetchImpl: g.fetchImpl });
  const s = await c.cadevc();
  assert.equal(s.cadevc.nome, 'Studio da Rê');
  assert.equal(s.regras.cancelamentoHorasMinimo, 24);
  assert.equal(s.servicos[0].id, 'd-sv8');
  assert.equal(g.chamadas.at(-1).auth, 'Bearer bfy_abc');
});

test('vagas monta ?data=&servicos= (array vira csv)', async () => {
  const g = fakeCadevc();
  const c = criarCadevcClient({ ...base, fetchImpl: g.fetchImpl });
  const v = await c.vagas({ data: '2026-10-22', servicos: ['d-sv8', 'd-sv2'] });
  assert.equal(v.profissionais[0].nome, 'Carla Barbosa');
  assert.match(g.chamadas.at(-1).url, /data=2026-10-22/);
  assert.match(g.chamadas.at(-1).url, /servicos=d-sv8%2Cd-sv2/);
});

test('agendamentosDe limpa o telefone pra só dígitos', async () => {
  const g = fakeCadevc();
  const c = criarCadevcClient({ ...base, fetchImpl: g.fetchImpl });
  const r = await c.agendamentosDe('(11) 99999-8888');
  assert.equal(r.agendamentos[0].id, 'ag1');
  assert.match(g.chamadas.at(-1).url, /telefone=11999998888/);
});

test('marcar faz POST /agendamentos com o corpo do bot', async () => {
  const g = fakeCadevc();
  const c = criarCadevcClient({ ...base, fetchImpl: g.fetchImpl });
  const r = await c.marcar({ telefone: '11999998888', servicos: ['d-sv8'], profissionalId: 'd-c1', data: '2026-10-22', hora: '09:00' });
  assert.equal(r.status, 'MARCADO');
  const ch = g.chamadas.at(-1);
  assert.equal(ch.method, 'POST'); assert.match(ch.url, /\/agendamentos$/);
  assert.equal(JSON.parse(ch.body).hora, '09:00');
});

test('ação faz POST /agendamentos/{id} (cancelar/confirmar)', async () => {
  const g = fakeCadevc();
  const c = criarCadevcClient({ ...base, fetchImpl: g.fetchImpl });
  const r = await c.acao('ag1', { acao: 'cancelar' });
  assert.equal(r.status, 'CANCELADO');
  assert.match(g.chamadas.at(-1).url, /\/agendamentos\/ag1$/);
});

test('confirmar e cancelar fazem POST /agendamentos/{id} com acao', async () => {
  const g = fakeCadevc();
  const c = criarCadevcClient({ ...base, fetchImpl: g.fetchImpl });
  await c.confirmar('ag1');
  assert.deepEqual(JSON.parse(g.chamadas.at(-1).body), { acao: 'confirmar' });
  await c.cancelar('ag1', 'cliente pediu');
  assert.deepEqual(JSON.parse(g.chamadas.at(-1).body), { acao: 'cancelar', motivo: 'cliente pediu' });
  await c.cancelar('ag1');
  assert.deepEqual(JSON.parse(g.chamadas.at(-1).body), { acao: 'cancelar' });
});

test('erro da API vira mensagem clara', async () => {
  const g = fakeCadevc();
  const c = criarCadevcClient({ ...base, fetchImpl: g.fetchImpl });
  await assert.rejects(() => c.vagas({ data: '', servicos: '' }), /Informe data/);
});

test('sem URL/token avisa direto', async () => {
  const c = criarCadevcClient({ fetchImpl: fakeCadevc().fetchImpl });
  await assert.rejects(() => c.cadevc(), /ausentes/);
});
