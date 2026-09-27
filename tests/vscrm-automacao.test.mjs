import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store isolado ANTES de importar (o caminho é lido do ambiente)
process.env.VSCRM_DIR = mkdtempSync(join(tmpdir(), 'vscrm-auto-'));

import { novoLead } from '../engine/vscrm/leads.mjs';
import { padrao, resolver, validar, aplicar, diasParado } from '../engine/vscrm/automacao.mjs';
import * as crm from '../engine/vscrm/index.mjs';

const FUNIL = ['Novo lead', 'Qualificado', 'Proposta enviada', 'Fechado'];
const DEMO = ['novo', 'contato', 'proposta', 'ganho', 'perdido'];
const T = '2026-09-16T10:00:00.000Z';
const lead = (f = FUNIL) => novoLead({ nome: 'Ana', telefone: '31975127978' }, f, T).lead;

test('padrão pelo nome da etapa; coluna de fim nunca é destino de contato/proposta', () => {
  assert.deepEqual(padrao(FUNIL), { ligada: true, contato: 'Qualificado', proposta: 'Proposta enviada', diasEsfriar: 3 });
  assert.deepEqual(padrao(DEMO), { ligada: true, contato: 'contato', proposta: 'proposta', diasEsfriar: 3 });
  // sem nome que ajude: pela posição
  const p = padrao(['A', 'B', 'C', 'D']);
  assert.equal(p.contato, 'B'); assert.equal(p.proposta, 'C');
  // funil curto: não inventa proposta
  assert.equal(padrao(['Entrada', 'Conversa']).proposta, null);
});

test('etapa que saiu do funil vira "não mover"', () => {
  assert.equal(resolver({ contato: 'Sumiu' }, FUNIL).contato, null);
  assert.ok(validar({ contato: 'Sumiu' }, FUNIL).erros);
  assert.ok(validar({ diasEsfriar: 0 }, FUNIL).erros);
});

test('equipe respondeu → contato; cobrança → proposta com valor; pago → Ganho na coluna de fim', () => {
  let l = aplicar(lead(), 'resposta-equipe', {}, { funil: FUNIL }, T);
  assert.equal(l.etapa, 'Qualificado');
  assert.equal(l.historico.at(-1).auto, true);
  l = aplicar(l, 'cobranca', { referencia: 'P-1', valorCentavos: 4990 }, { funil: FUNIL }, T);
  assert.equal(l.etapa, 'Proposta enviada');
  assert.equal(l.valor, 49.9);
  l = aplicar(l, 'pago', { referencia: 'P-1', valorCentavos: 4990 }, { funil: FUNIL }, T);
  assert.equal(l.status, 'ganho');
  assert.equal(l.etapa, 'Fechado');
  assert.match(l.historico.at(-1).motivo, /pagamento confirmado · pedido P-1/);
  // pago de novo não duplica
  assert.equal(aplicar(l, 'pago', { referencia: 'P-1' }, { funil: FUNIL }, T), l);
});

test('só pra frente: resposta da equipe não puxa de volta quem já está em proposta', () => {
  const emProposta = { ...lead(), etapa: 'Proposta enviada' };
  assert.equal(aplicar(emProposta, 'resposta-equipe', {}, { funil: FUNIL }, T), emProposta);
});

test('desligado não mexe; perdido volta como ganho quando o pagamento cai', () => {
  const l = lead();
  assert.equal(aplicar(l, 'resposta-equipe', {}, { funil: FUNIL, config: { ...resolver(null, FUNIL), ligada: false } }, T), l);
  const perdido = { ...l, status: 'perdido' };
  assert.equal(aplicar(perdido, 'cobranca', { referencia: 'X', valorCentavos: 100 }, { funil: FUNIL }, T), perdido);
  assert.equal(aplicar(perdido, 'pago', { referencia: 'X', valorCentavos: 100 }, { funil: FUNIL }, T).status, 'ganho');
});

test('parado: dias desde a última conversa, só de lead aberto', () => {
  const l = lead();
  assert.equal(diasParado(l, Date.parse(T) + 4 * 86400000), 4);
  assert.equal(diasParado({ ...l, status: 'ganho' }, Date.now()), null);
});

test('ponta a ponta no store: interação da equipe, cobrança, pagamento pela sincronização', () => {
  crm.setFunil(DEMO);
  const { lead: l } = crm.criar({ nome: 'Bia', telefone: '31988887777' });
  crm.interagir(l.id, { canal: 'telegram', direcao: 'saida', texto: 'oi', autor: 'bot' });
  assert.equal(crm.listar().find((x) => x.id === l.id).etapa, 'novo', 'resposta do bot não conta como equipe');
  crm.interagir(l.id, { canal: 'telegram', direcao: 'saida', texto: 'oi, sou a Carla', autor: 'atendente' });
  assert.equal(crm.listar().find((x) => x.id === l.id).etapa, 'contato');
  crm.eventoDeVenda(l.telefone, 'cobranca', { referencia: 'P-9', valorCentavos: 12000 });
  assert.equal(crm.listar().find((x) => x.id === l.id).etapa, 'proposta');
  const pedidos = [{ referencia: 'P-9', pagamentoId: 'pg1', telefone: l.telefone, valorCentavos: 12000 }];
  assert.equal(crm.sincronizarPagamentos(pedidos, [{ id: 'pg1', estado: 'PENDENTE' }]).mudou, 0);
  assert.equal(crm.sincronizarPagamentos(pedidos, [{ id: 'pg1', estado: 'CONFIRMADO' }]).mudou, 1);
  assert.equal(crm.sincronizarPagamentos(pedidos, [{ id: 'pg1', estado: 'CONFIRMADO' }]).mudou, 0);
  const fim = crm.listar().find((x) => x.id === l.id);
  assert.equal(fim.status, 'ganho'); assert.equal(fim.etapa, 'ganho'); assert.equal(fim.valor, 120);
  const p = crm.painel();
  assert.equal(p.resumo.ganhos, 1);
  assert.equal(p.automacao.contato, 'contato');
});
