import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store isolado ANTES de importar (o caminho é lido do ambiente)
process.env.VSCRM_DIR = mkdtempSync(join(tmpdir(), 'vscrm-'));

import { load, save, has } from '../engine/vscrm/store.mjs';
import {
  normalizarTelefone, leadId, novoLead, moverEtapa, fechar,
  aplicarQualificacao, registrarInteracao, upsert, resumoFunil,
} from '../engine/vscrm/leads.mjs';

const FUNIL = ['Novo lead', 'Qualificado', 'Proposta enviada', 'Fechado'];
const T = '2026-09-16T10:00:00.000Z';

test('telefone sem DDI ganha o 55 — era o motivo de nada chegar no zap', () => {
  assert.equal(normalizarTelefone('31975127978').telefone, '5531975127978');
  assert.equal(normalizarTelefone('(31) 97512-7978').telefone, '5531975127978');
  assert.equal(normalizarTelefone('5531975127978').telefone, '5531975127978');
  assert.equal(normalizarTelefone('3197512797').telefone, '553197512797'); // 10 digitos
});

test('telefone fora do padrao passa, mas avisa em vez de fingir que esta ok', () => {
  const r = normalizarTelefone('123');
  assert.equal(r.telefone, '123');
  assert.match(r.erro, /fora do padrao/);
  assert.equal(normalizarTelefone('').telefone, null);
});

test('id do lead vem do telefone normalizado', () => {
  assert.equal(leadId('5531975127978'), 'l_5531975127978');
});

test('novo lead entra na primeira etapa do funil da empresa', () => {
  const { lead } = novoLead({ nome: 'Carla', telefone: '31975127978', valor: 1200 }, FUNIL, T);
  assert.equal(lead.etapa, 'Novo lead');
  assert.equal(lead.telefone, '5531975127978');
  assert.equal(lead.status, 'aberto');
  assert.equal(lead.valor, 1200);
  assert.equal(lead.historico.length, 1);
});

test('sem funil cadastrado o CRM recusa em vez de inventar etapa', () => {
  const r = novoLead({ nome: 'X', telefone: '31975127978' }, [], T);
  assert.match(r.erro, /sem funil/);
  assert.equal(r.lead, undefined);
});

test('mover para etapa fora do funil e recusado', () => {
  const { lead } = novoLead({ telefone: '31975127978' }, FUNIL, T);
  assert.match(moverEtapa(lead, 'Inventada', FUNIL, T).erro, /nao esta no funil/);
  const ok = moverEtapa(lead, 'Qualificado', FUNIL, T);
  assert.equal(ok.lead.etapa, 'Qualificado');
  assert.equal(ok.lead.historico.at(-1).de, 'Novo lead');
});

test('fechar exige ganho ou perdido', () => {
  const { lead } = novoLead({ telefone: '31975127978' }, FUNIL, T);
  assert.match(fechar(lead, 'talvez').erro, /ganho ou perdido/);
  assert.equal(fechar(lead, 'ganho', 'fechou na proposta', T).lead.status, 'ganho');
});

test('qualificacao do VSvendas fica auditavel no historico', () => {
  const { lead } = novoLead({ telefone: '31975127978' }, FUNIL, T);
  const q = aplicarQualificacao(lead, { score: 82, faixa: 'quente', motivos: ['pediu preco'] }, T);
  assert.equal(q.score, 82);
  assert.equal(q.faixa, 'quente');
  assert.deepEqual(q.historico.at(-1).motivos, ['pediu preco']);
});

test('interacao registra canal e direcao', () => {
  const { lead } = novoLead({ telefone: '31975127978' }, FUNIL, T);
  const i = registrarInteracao(lead, { direcao: 'entrada', texto: 'quanto custa?' }, T);
  assert.equal(i.historico.at(-1).canal, 'whatsapp');
  assert.equal(i.historico.at(-1).direcao, 'entrada');
});

test('upsert substitui pelo id em vez de duplicar o lead', () => {
  const { lead } = novoLead({ telefone: '31975127978' }, FUNIL, T);
  const um = upsert([], lead);
  const dois = upsert(um, moverEtapa(lead, 'Qualificado', FUNIL, T).lead);
  assert.equal(dois.length, 1);
  assert.equal(dois[0].etapa, 'Qualificado');
});

test('resumo conta por etapa e nao transforma valor ausente em zero', () => {
  const a = novoLead({ telefone: '31911111111', valor: 500 }, FUNIL, T).lead;
  const b = novoLead({ telefone: '31922222222' }, FUNIL, T).lead; // sem valor
  const r = resumoFunil([a, b], FUNIL);
  assert.equal(r.etapas[0].leads, 2);
  assert.equal(r.etapas[0].valor, 500);
  assert.equal(r.etapas[1].valor, null); // etapa vazia: null, nao 0
  assert.equal(r.abertos, 2);
});

test('conversao sem nenhum lead fechado e null, nao 0%', () => {
  const a = novoLead({ telefone: '31911111111' }, FUNIL, T).lead;
  assert.equal(resumoFunil([a], FUNIL).conversao, null);
  const ganho = fechar(a, 'ganho', null, T).lead;
  const perdido = fechar(novoLead({ telefone: '31922222222' }, FUNIL, T).lead, 'perdido', null, T).lead;
  const r = resumoFunil([ganho, perdido], FUNIL);
  assert.equal(r.conversao, 0.5);
  assert.equal(r.abertos, 0);
});

test('store sobrevive a arquivo ausente e grava/le de volta', () => {
  assert.equal(has('leads'), false);
  assert.deepEqual(load('leads', []), []);
  save('leads', [{ id: 'l_1' }]);
  assert.equal(has('leads'), true);
  assert.deepEqual(load('leads', []), [{ id: 'l_1' }]);
});
