/**
 * Entender o que a pessoa escreveu, sem IA paga.
 *
 * O que estes casos protegem:
 *  - o cliente que já disse o que quer não ser obrigado a digitar 1, 2, 3;
 *  - e, do outro lado, o bot NÃO chutar departamento: mandar pra pessoa errada
 *    com cara de certeza faz o cliente contar o problema duas vezes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { entender } from '../engine/vsbot/entender.mjs';
import { avancar, validarFluxo, ACOES } from '../engine/vsbot/fluxo.mjs';

const menu = [
  { tecla: '1', texto: 'Já sou cliente', vaiPara: 'cliente' },
  { tecla: '2', texto: 'Quero conhecer as soluções', vaiPara: 'comercial' },
  { tecla: '3', texto: 'Financeiro', vaiPara: 'financeiro' },
  { tecla: '4', texto: 'Parcerias', vaiPara: 'parcerias' },
  { tecla: '5', texto: 'Falar com uma pessoa', acao: ACOES.ENCAMINHAR, departamento: 'humano' },
];

test('"meu boleto venceu" vai pro financeiro sem passar por menu', () => {
  assert.equal(entender('meu boleto venceu ontem', menu).escolhida.texto, 'Financeiro');
});

test('o jeito que as pessoas escrevem de verdade', () => {
  const casos = [
    ['preciso da segunda via da fatura', 'Financeiro'],
    ['quanto custa o plano de voces?', 'Quero conhecer as soluções'],
    ['queria um orcamento', 'Quero conhecer as soluções'],
    ['quero ser revendedor de voces', 'Parcerias'],
    ['me passa um atendente por favor', 'Falar com uma pessoa'],
    ['ja tenho contrato com voces', 'Já sou cliente'],
  ];
  for (const [frase, esperado] of casos) {
    const r = entender(frase, menu);
    assert.equal(r.escolhida?.texto, esperado, `"${frase}" devia cair em ${esperado}`);
  }
});

test('frase sem nada a ver NAO escolhe — melhor menu que palpite', () => {
  assert.equal(entender('kkkkk', menu).escolhida, undefined);
  assert.equal(entender('...', menu).escolhida, undefined);
});

test('so palavras vazias nao escolhem nada', () => {
  // "quero falar sobre isso" casaria com a opcao que diz "Falar" se "falar" pontuasse.
  const r = entender('quero falar sobre isso', menu);
  assert.equal(r.escolhida, undefined, 'palavra de encher linguica nao pode decidir departamento');
});

test('empate devolve os candidatos em vez de escolher um', () => {
  const dois = [
    { tecla: '1', texto: 'Financeiro', vaiPara: 'f' },
    { tecla: '2', texto: 'Suporte', vaiPara: 's' },
  ];
  const r = entender('boleto e erro', dois);
  assert.equal(r.escolhida, undefined, 'na duvida, nao chuta');
  assert.equal(r.empate.length, 2);
});

test('a planilha pode ensinar o vocabulario da casa', () => {
  const proprio = [
    { tecla: '1', texto: 'Setor A', termos: ['xmlzao', 'remessa'], vaiPara: 'a' },
    { tecla: '2', texto: 'Setor B', vaiPara: 'b' },
  ];
  assert.equal(entender('preciso mandar a remessa', proprio).escolhida.texto, 'Setor A');
});

/* ---- dentro do fluxo, ponta a ponta ---- */

const arvore = () => validarFluxo([
  { id: 'inicio', mensagem: 'Oi! Sou a Micaela.', opcoes: menu },
  { id: 'cliente', mensagem: 'Que bom!', opcoes: [{ tecla: '1', texto: 'Suporte', acao: ACOES.ENCAMINHAR, departamento: 'suporte' }] },
  { id: 'comercial', mensagem: 'Me conta o que procura.', acao: ACOES.COLETAR, vaiPara: 'fim' },
  { id: 'financeiro', mensagem: 'Passando pro financeiro.', acao: ACOES.ENCAMINHAR, departamento: 'financeiro' },
  { id: 'parcerias', mensagem: 'Passando pra parcerias.', acao: ACOES.ENCAMINHAR, departamento: 'parcerias' },
  { id: 'fim', mensagem: 'Obrigada!', acao: ACOES.FIM },
]).fluxo;

test('quem abre a conversa dizendo o problema PULA o menu inteiro', () => {
  const r = avancar(arvore(), { passo: 'inicio' }, 'oi, minha fatura venceu e preciso de segunda via');
  assert.equal(r.departamento, 'financeiro');
  assert.equal(r.handoff, true);
  assert.doesNotMatch(r.texto, /1 - |Responda com o número/, 'nao pode mostrar menu pra quem ja disse o que quer');
});

test('tecla continua funcionando — quem prefere numero nao foi abandonado', () => {
  const r = avancar(arvore(), { passo: 'inicio' }, '3');
  assert.equal(r.departamento, 'financeiro');
});

test('na duvida ela PERGUNTA, mostrando so os candidatos', () => {
  const r = avancar(arvore(), { passo: 'inicio' }, 'sou cliente e quero saber de parceria');
  assert.equal(r.desambiguando, true);
  assert.match(r.texto, /nao te mandar pro lugar errado|não te mandar pro lugar errado/);
  assert.doesNotMatch(r.texto, /Financeiro/, 'so os que empataram entram na pergunta');
});

/* ---- o assunto que mora dois niveis abaixo ---- */

import { entenderNoFluxo } from '../engine/vsbot/entender.mjs';

const arvoreFunda = () => validarFluxo([
  { id: 'inicio', mensagem: 'Oi!', opcoes: [
    { tecla: '1', texto: 'Já sou cliente', vaiPara: 'cliente_area' },
    { tecla: '2', texto: 'Quero conhecer', vaiPara: 'comercial' },
  ] },
  { id: 'cliente_area', mensagem: 'Qual assunto?', opcoes: [
    { tecla: '1', texto: 'Suporte técnico', vaiPara: 'suporte_triagem' },
    { tecla: '2', texto: 'Financeiro', acao: ACOES.ENCAMINHAR, departamento: 'financeiro' },
  ] },
  { id: 'suporte_triagem', mensagem: 'Qual situação descreve o problema?', opcoes: [
    { tecla: '1', texto: 'Não abre', acao: ACOES.ENCAMINHAR, departamento: 'suporte' },
  ] },
  { id: 'comercial', mensagem: 'O que procura?', opcoes: [
    { tecla: '1', texto: 'Vendas / CRM / atendimento', acao: ACOES.ENCAMINHAR, departamento: 'comercial' },
    { tecla: '2', texto: 'Automação / IA', acao: ACOES.ENCAMINHAR, departamento: 'comercial' },
  ] },
  { id: 'satisfacao', mensagem: 'Como foi o atendimento?', acao: ACOES.NOTA, vaiPara: 'fim' },
  { id: 'fim', mensagem: 'Obrigada!', acao: ACOES.FIM },
]).fluxo;

test('"o sistema travou" pula DOIS niveis e cai na triagem de suporte', () => {
  const r = avancar(arvoreFunda(), { passo: 'inicio' }, 'o sistema travou e nao consigo entrar');
  assert.equal(r.saltou, true);
  assert.match(r.texto, /Qual situação descreve/);
});

test('o salto so vale no COMECO — no meio da arvore a frase e resposta, nao comando', () => {
  // Mesmo texto, mas a pessoa ja esta respondendo outra pergunta.
  const r = avancar(arvoreFunda(), { passo: 'cliente_area' }, 'o sistema travou e nao consigo entrar');
  assert.notEqual(r.saltou, true, 'trocar o assunto na cara de quem respondeu e pior que nao entender');
});

test('nunca salta pra passo que nao e assunto (fim, pesquisa de satisfacao)', () => {
  const r = entenderNoFluxo('queria falar do atendimento de voces', arvoreFunda(), { ignorar: 'inicio' });
  assert.notEqual(r.passo?.id, 'satisfacao');
  assert.notEqual(r.passo?.id, 'fim');
});

test('empate entre IRMAS leva ao galho delas, nao ao menu principal', () => {
  const r = avancar(arvoreFunda(), { passo: 'inicio' }, 'queria automatizar meu atendimento');
  assert.equal(r.saltou, true);
  assert.match(r.texto, /O que procura/, 'cai no comercial e escolhe entre as duas');
});

test('empate entre irmas de galhos DIFERENTES nao salta — volta pro menu', () => {
  // Um pe no comercial, outro no suporte: nao ha galho comum pra levar a pessoa.
  const r = avancar(arvoreFunda(), { passo: 'inicio' }, 'quero comprar e meu sistema travou');
  assert.notEqual(r.saltou, true, 'na duvida entre departamentos, nao chuta');
});

test('empate dentro do mesmo galho leva ao galho — "suporte e financeiro" cai na area do cliente', () => {
  const r = avancar(arvoreFunda(), { passo: 'inicio' }, 'suporte e financeiro');
  assert.equal(r.saltou, true);
  assert.match(r.texto, /Qual assunto/, 'os dois assuntos moram ali: mostra os dois');
});
