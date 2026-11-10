import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parecerDoPendente,
  faltasDeTreino,
  classificarParametroDaPergunta,
  diagnosticoParametros,
  sugerirTreinoPorParametro,
  MODELOS_FREE_0007,
} from '../engine/vs0007/auditoria.mjs';

test('sugere resposta só com o que já está na base', () => {
  const r = parecerDoPendente({ pergunta: 'qual o frete para Contagem?', conhecimento: ['como-funciona: O frete para Contagem custa R$ 10'] });
  assert.equal(r.voto, 'aprovar');
  assert.equal(r.sugestao, 'O frete para Contagem custa R$ 10');
});

test('dado da empresa sem base pede a resposta e não inventa', () => {
  const r = parecerDoPendente({ pergunta: 'vocês parcelam no cartão?' });
  assert.equal(r.voto, 'aprovar');
  assert.equal(r.sugestao, '');
});

test('recusa ruído, conta repetição e admite quando não sabe', () => {
  assert.equal(parecerDoPendente({ pergunta: 'seu idiota' }).voto, 'recusar');
  assert.equal(parecerDoPendente({ pergunta: 'hmm' }).voto, 'recusar');
  assert.equal(parecerDoPendente({ pergunta: 'vocês atendem condomínio grande?', vezes: 3 }).voto, 'aprovar');
  assert.equal(parecerDoPendente({ pergunta: 'vocês atendem condomínio grande?' }).voto, 'revisar');
});

test('aponta o que falta no treino', () => {
  assert.deepEqual(faltasDeTreino(['produto', 'precos', 'horario', 'contato', 'como-funciona']), []);
  assert.deepEqual(faltasDeTreino(['horarios', 'regras']).map((f) => f.chave), ['produto', 'precos', 'horario', 'contato', 'como-funciona']);
});

test('classifica perguntas por parâmetro e recusa links soltos do Instagram', () => {
  assert.equal(parecerDoPendente({ pergunta: 'https://www.instagram.com/reel/DfgT91zO1II/?rpxt=ZGNoYmVtdG42N2hz' }).voto, 'recusar');
  assert.equal(parecerDoPendente({ pergunta: 'Da ideia' }).voto, 'recusar');
  assert.equal(classificarParametroDaPergunta('Tem horário livre na agenda amanhã?').parametro, 'agenda');
  assert.equal(classificarParametroDaPergunta('Qual o valor da mensalidade no pix?').parametro, 'precos');
});

test('diagnosticoParametros, sugerirTreinoPorParametro e MODELOS_FREE_0007 cobrem os 9 parâmetros com zero autonomia', () => {
  assert.ok(MODELOS_FREE_0007.some((m) => m.id === 'qwen2.5:1.5b' && m.padraoMessenger));
  const sug = sugerirTreinoPorParametro({ nome: 'ísis', nicho: 'Vendedora', especialidade: 'Vendas', empresaNome: 'Veloso Solution' });
  assert.ok(sug.limites.toLowerCase().includes('zero autonomia'));
  const diag = diagnosticoParametros([{ categoria: 'nicho', conteudo: sug.nicho }, { categoria: 'limites', conteudo: sug.limites }]);
  assert.equal(diag.length, 9);
  assert.equal(diag.find((p) => p.chave === 'nicho')?.ok, true);
  assert.equal(diag.find((p) => p.chave === 'limites')?.ok, true);
});
