import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, coerce, answer, nextQuestion, isComplete, progress } from '../engine/interview/engine.mjs';
import { findQuestion } from '../engine/interview/schema.mjs';
import { mapProfile, profileReady } from '../engine/vsvendas/profile.mjs';
import { qualifyLead } from '../engine/vsvendas/qualify.mjs';
import { draftFollowup } from '../engine/vsvendas/followup.mjs';
import { handleObjection } from '../engine/vsvendas/objection.mjs';
import { qualificar, followup, objecao } from '../engine/vsvendas/index.mjs';

/* ---------------- interview engine ---------------- */

test('coerce: number/list/choice validam', () => {
  assert.equal(coerce({ tipo: 'number', required: true }, 'R$ 5000').value, 5000);
  assert.equal(coerce({ tipo: 'number', required: false }, '').value, null);
  assert.equal(coerce({ tipo: 'number' }, 'abc').ok, false);
  assert.deepEqual(coerce({ tipo: 'list', required: true }, 'a\nb; c').value, ['a', 'b', 'c']);
  assert.equal(coerce({ tipo: 'choice', opcoes: ['X', 'Y'] }, 'Z').ok, false);
  assert.equal(coerce({ tipo: 'text', required: true }, '  ').ok, false);
});

test('nextQuestion: obrigatórias primeiro; completa quando todas required respondidas', () => {
  let s = createState('empresa');
  const q1 = nextQuestion(s);
  assert.equal(q1.id, 'empresa_nome');
  // responde todas as obrigatórias
  for (const q of [
    ['empresa_nome', 'MSB'], ['vende', 'software rural'], ['proposta_valor', 'agiliza atendimento'],
    ['icp', 'gestor público agro'], ['tom', 'Consultivo'],
  ]) { s = answer(s, q[0], q[1]).state; }
  assert.equal(isComplete(s), true);
  // ticket é opcional -> ainda aparece como próxima (opcional), mas completa=true
  assert.equal(progress(s).completa, true);
});

test('answer: rejeita choice inválida com erro', () => {
  const r = answer(createState('empresa'), 'tom', 'ZZ');
  assert.equal(r.ok, false);
  assert.match(r.error, /escolha uma/);
});

/* ---------------- profile ---------------- */

const empresa = { empresa_nome: 'MSB', vende: 'software de gestão rural', proposta_valor: 'reduz retrabalho', icp: 'secretaria de agricultura gestor', ticket: 5000, tom: 'Direto' };
const vendas = { funil: ['Novo lead', 'Qualificado', 'Proposta enviada', 'Negociação', 'Fechado'], canais: ['WhatsApp', 'E-mail'], sinais_quente: ['pediu preço', 'tem prazo'], sinais_frio: ['sem verba'], objecoes: ['tá caro => mostro o ROI', 'vou pensar'], follow_prazo: 2 };

test('mapProfile + profileReady', () => {
  const p = mapProfile(empresa, vendas);
  assert.equal(p.empresa.nome, 'MSB');
  assert.equal(p.funil.length, 5);
  assert.equal(p.objecoes[0].objecao, 'tá caro');
  assert.equal(p.objecoes[0].resposta, 'mostro o ROI');
  assert.equal(p.objecoes[1].resposta, null);
  assert.equal(profileReady(p).ready, true);
  assert.equal(profileReady(mapProfile({}, {})).ready, false);
});

/* ---------------- qualify ---------------- */

test('qualifyLead: quente quando bate sinais de compra', () => {
  const p = mapProfile(empresa, vendas);
  const r = qualifyLead('Oi, pediu preço e tem prazo apertado, quero contratar', p);
  assert.equal(r.faixa, 'quente');
  assert.ok(r.score >= 66);
  assert.match(r.proximoPasso, /agir agora/);
});

test('qualifyLead: frio quando sem verba/hesitação', () => {
  const p = mapProfile(empresa, vendas);
  const r = qualifyLead('to só olhando, sem verba esse ano, caro demais', p);
  assert.equal(r.faixa, 'frio');
  assert.ok(r.score < 33);
});

/* ---------------- followup ---------------- */

test('draftFollowup: tom + etapa (proposta) e pede variáveis', () => {
  const p = mapProfile(empresa, vendas);
  const r = draftFollowup(p, { etapa: 'Proposta enviada' });
  assert.equal(r.categoria, 'proposta');
  assert.match(r.mensagem, /proposta/i);
  assert.match(r.mensagem, /software de gestão rural/); // produto do perfil
  assert.ok(r.variaveis.includes('nome')); // não passou nome
  assert.deepEqual(r.canaisSugeridos, ['WhatsApp', 'E-mail']);
});

/* ---------------- objection ---------------- */

test('handleObjection: usa resposta da empresa quando existe', () => {
  const p = mapProfile(empresa, vendas);
  const r = handleObjection('achei tá caro isso', p);
  assert.equal(r.origem, 'empresa');
  assert.equal(r.resposta, 'mostro o ROI');
});

test('handleObjection: cai na genérica com prazo do perfil', () => {
  const p = mapProfile(empresa, vendas);
  const r = handleObjection('vou pensar melhor', p);
  // "vou pensar" existe no perfil mas sem resposta -> genérica
  assert.equal(r.origem, 'generica');
  assert.match(r.resposta, /2 dias/);
});

/* ---------------- index (perfil injetado, sem disco) ---------------- */

test('index: qualificar/followup/objecao com perfil pronto', () => {
  const p = mapProfile(empresa, vendas);
  assert.equal(qualificar('pediu preço, quero fechar', p).faixa, 'quente');
  assert.equal(followup({ etapa: 'Novo lead' }, p).categoria, 'novo');
  assert.equal(objecao('tá caro', p).origem, 'empresa');
});

test('index: sem perfil -> erro needInterview', () => {
  const vazio = mapProfile({}, {});
  assert.throws(() => qualificar('x', vazio), (e) => e.needInterview === true);
});
