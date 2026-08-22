/**
 * VSvendas — perfil, qualificação e follow-up. Bugs que impediam o módulo de funcionar:
 *
 *  1. mapProfile lia vende/proposta/icp/ticket/tom do set "empresa", mas o schema da
 *     entrevista grava tudo isso no set "vendas" (a seção "Empresa" é só rótulo de
 *     tela). Quem respondia a entrevista INTEIRA continuava recebendo "VSvendas sem
 *     perfil" em qualify, followup, objection e ads — o módulo nunca ficava pronto.
 *  2. qualify comparava sem normalizar acento: o sinal cadastrado ("bug em producao")
 *     não casava com o texto do lead ("bug pra produção") e o lead quente virava morno.
 *  3. followup punha o texto inteiro do "o que a empresa vende" no lugar do NOME do
 *     produto, no meio da frase — mensagem impublicável e pontuação duplicada.
 *  4. "Demo feita" não casava em nenhuma etapa e caía em "novo".
 *
 * Roda com:  node --test tests/vsvendas-perfil.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapProfile, profileReady } from '../engine/vsvendas/profile.mjs';
import { qualifyLead } from '../engine/vsvendas/qualify.mjs';
import { draftFollowup } from '../engine/vsvendas/followup.mjs';

const VENDAS = {
  vende: 'QA-Gate: camada de governanca e QA automatizado para times de desenvolvimento.',
  proposta_valor: 'bug de tela morre no commit',
  icp: 'software house de 5 a 50 devs',
  tom: 'Direto',
  funil: ['Novo lead', 'Qualificado', 'Demo feita', 'Proposta enviada'],
  canais: ['WhatsApp'],
  sinais_quente: ['reclamou de bug em producao', 'perguntou preco'],
  sinais_frio: ['estudante'],
};

test('mapProfile lê os campos do set "vendas", onde o schema grava', () => {
  const p = mapProfile({ empresa_nome: 'DevPoint' }, VENDAS);
  assert.equal(p.empresa.nome, 'DevPoint');
  assert.match(p.empresa.vende, /QA-Gate/);
  assert.equal(p.empresa.tom, 'Direto');
  assert.equal(profileReady(p).ready, true);
});

test('perfil antigo (campos no set "empresa") continua valendo — fallback', () => {
  const p = mapProfile({ empresa_nome: 'X', vende: 'sofá', tom: 'Formal' }, { funil: ['Novo lead'] });
  assert.equal(p.empresa.vende, 'sofá');
  assert.equal(p.empresa.tom, 'Formal');
});

test('profileReady aponta o set CERTO quando falta o "vende"', () => {
  const r = profileReady(mapProfile({}, { funil: ['Novo lead'] }));
  assert.equal(r.ready, false);
  assert.match(r.faltando.join(' '), /set "vendas"/);
});

test('qualify casa o sinal mesmo com acento divergente', () => {
  const p = mapProfile({ empresa_nome: 'X' }, VENDAS);
  const r = qualifyLead('subiu bug pra produção duas vezes esse mês, quanto custa?', p);
  assert.equal(r.faixa, 'quente', `esperava quente, veio ${r.faixa} (${r.score})`);
  assert.match(r.motivos.join(' '), /bug em producao/);
});

test('qualify não repete o mesmo termo por causa da variante acentuada', () => {
  const p = mapProfile({ empresa_nome: 'X' }, VENDAS);
  const linha = qualifyLead('qual o preço?', p).motivos.find((m) => /intenção de compra/.test(m)) || '';
  const termos = linha.split(':')[1].split(',').map((t) => t.trim());
  assert.deepEqual(termos, [...new Set(termos)], `duplicado: ${linha}`);
});

test('qualify continua rebaixando lead frio', () => {
  const p = mapProfile({ empresa_nome: 'X' }, VENDAS);
  assert.equal(qualifyLead('sou estudante, é de graça?', p).faixa, 'frio');
});

test('followup usa NOME curto do produto, não o texto inteiro da entrevista', () => {
  const p = mapProfile({ empresa_nome: 'DevPoint' }, VENDAS);
  const { mensagem } = draftFollowup(p, { nome: 'Ricardo', etapa: 'Demo feita', dor: 'bug em produção' });
  assert.match(mensagem, /QA-Gate/);
  assert.ok(!mensagem.includes('camada de governanca'), 'vazou o texto longo da entrevista');
  assert.ok(!/\.\./.test(mensagem), 'pontuação duplicada');
});

test('followup reconhece Demo/reunião/call como etapa qualificada', () => {
  const p = mapProfile({ empresa_nome: 'X' }, VENDAS);
  for (const etapa of ['Demo feita', 'Reunião marcada', 'Call de descoberta']) {
    assert.equal(draftFollowup(p, { nome: 'A', etapa }).categoria, 'qualificado', etapa);
  }
});

test('followup sem "vende" cai no nome da empresa, não em {produto}', () => {
  const p = mapProfile({ empresa_nome: 'DevPoint' }, { funil: ['Novo lead'], vende: '' });
  const { mensagem } = draftFollowup(p, { nome: 'A', etapa: 'Novo lead' });
  assert.ok(!mensagem.includes('{produto}'));
  assert.match(mensagem, /DevPoint/);
});
