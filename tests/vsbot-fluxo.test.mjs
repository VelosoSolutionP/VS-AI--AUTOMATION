/**
 * Fluxo de atendimento: a árvore que o cliente percorre, e a planilha que a
 * monta. Tudo puro — nada de canal, nada de disco.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validarFluxo, avancar, desenhar, ACOES } from '../engine/vsbot/fluxo.mjs';
import { fluxoDeCsv, partirLinha, modeloCsv } from '../engine/vsbot/fluxo-csv.mjs';

const exemplo = () => validarFluxo([
  { id: 'inicio', mensagem: 'Boa noite! Sou a Micaela. Em que posso ajudar?', opcoes: [
    { tecla: '1', texto: 'Já sou cliente', vaiPara: 'cliente' },
    { tecla: '2', texto: 'Quero conhecer', vaiPara: 'novo' },
    { tecla: '3', texto: 'Falar com uma pessoa', acao: ACOES.ENCAMINHAR, departamento: 'humano', resposta: 'Já chamo alguém!' },
  ] },
  { id: 'cliente', mensagem: 'Que bom! O que precisa?', opcoes: [
    { tecla: '1', texto: 'Suporte', acao: ACOES.ENCAMINHAR, resposta: 'Passando pro suporte.' },
  ] },
  { id: 'novo', mensagem: 'Me confirma nome e cidade.', acao: ACOES.CONFIRMAR },
]).fluxo;

/* ---- validacao: o erro caro e a opcao que aponta pro vazio ---- */

test('opcao que aponta pra passo inexistente e RECUSADA', () => {
  const r = validarFluxo([{ id: 'a', mensagem: 'oi', opcoes: [{ texto: 'x', vaiPara: 'nao_existe' }] }]);
  assert.match(r.erros.join(' '), /aponta para "nao_existe"/);
});

test('passo sem saida e recusado — a conversa morreria nele', () => {
  const r = validarFluxo([{ id: 'a', mensagem: 'oi' }]);
  assert.match(r.erros.join(' '), /falta dizer para onde vai/);
});

test('passo sem mensagem e recusado', () => {
  const r = validarFluxo([{ id: 'a', mensagem: '', acao: ACOES.FIM }]);
  assert.match(r.erros.join(' '), /não tem mensagem/);
});

test('acao inventada e recusada, dizendo quais existem', () => {
  const r = validarFluxo([{ id: 'a', mensagem: 'oi', acao: 'teletransporte' }]);
  assert.match(r.erros.join(' '), /teletransporte.*não existe/);
});

test('id repetido e recusado', () => {
  const r = validarFluxo([
    { id: 'a', mensagem: 'oi', acao: ACOES.FIM },
    { id: 'a', mensagem: 'outro', acao: ACOES.FIM },
  ]);
  assert.match(r.erros.join(' '), /repetido/);
});

/* ---- o menu desenhado ---- */

test('o menu sai numerado, porque botao nao renderiza no canal nao-oficial', () => {
  const t = desenhar(exemplo().passos[0]);
  assert.match(t, /1 - Já sou cliente/);
  assert.match(t, /2 - Quero conhecer/);
  assert.match(t, /Responda com o número/);
});

/* ---- a conversa andando ---- */

test('quem chega agora recebe o primeiro passo', () => {
  const r = avancar(exemplo(), null, 'oi');
  assert.equal(r.passo, 'inicio');
  assert.match(r.texto, /Micaela/);
});

test('escolher pelo numero anda pro passo certo', () => {
  const r = avancar(exemplo(), { passo: 'inicio' }, '1');
  assert.equal(r.passo, 'cliente');
  assert.match(r.texto, /O que precisa/);
});

test('escolher escrevendo o texto da opcao tambem vale', () => {
  // gente responde "já sou cliente" em vez de "1" o tempo todo
  const r = avancar(exemplo(), { passo: 'inicio' }, 'já sou cliente');
  assert.equal(r.passo, 'cliente');
});

test('acento e caixa nao atrapalham a escolha', () => {
  assert.equal(avancar(exemplo(), { passo: 'inicio' }, 'JA SOU CLIENTE').passo, 'cliente');
});

test('escolha invalida repete o menu, sem perder o lugar', () => {
  const r = avancar(exemplo(), { passo: 'inicio' }, 'banana');
  assert.equal(r.erroDeEscolha, true);
  assert.equal(r.passo, 'inicio', 'nao pode jogar a pessoa pra fora do passo');
  assert.match(r.texto, /Não entendi a escolha/);
  assert.match(r.texto, /1 - Já sou cliente/, 'tem de repetir as opcoes');
});

test('opcao com acao COMERCIAL encerra o fluxo e chama gente', () => {
  const r = avancar(exemplo(), { passo: 'inicio' }, '3');
  assert.equal(r.acao, ACOES.ENCAMINHAR);
  assert.equal(r.handoff, true);
  assert.equal(r.passo, null, 'sai do fluxo: quem atende agora e uma pessoa');
  assert.match(r.texto, /Já chamo alguém/);
});

test('passo de confirmacao PERGUNTA e espera a resposta, em vez de falar no vazio', () => {
  const r = avancar(exemplo(), { passo: 'inicio' }, '2');
  assert.equal(r.passo, 'novo');
  assert.equal(r.acao, ACOES.CONFIRMAR);
  assert.equal(r.coletando, true, 'o que o cliente responder tem de ser capturado');
});

test('"menu" volta pro comeco de qualquer ponto', () => {
  const r = avancar(exemplo(), { passo: 'cliente' }, 'menu');
  assert.equal(r.passo, 'inicio');
});

test('fluxo trocado embaixo de uma conversa em andamento nao trava ninguem', () => {
  const r = avancar(exemplo(), { passo: 'passo_que_sumiu' }, '1');
  assert.equal(r.passo, 'inicio', 'recomeça em vez de morrer');
});

/* ---- a planilha ---- */

test('csv vira fluxo, com a mensagem so na primeira linha do passo', () => {
  const r = fluxoDeCsv(modeloCsv());
  assert.deepEqual(r.erros, []);
  assert.equal(r.fluxo.inicio, 'inicio');
  assert.equal(r.resumo.passos, 3);
  const inicio = r.fluxo.passos[0];
  assert.match(inicio.mensagem, /Micaela/);
  assert.equal(inicio.opcoes.length, 3);
  assert.equal(inicio.opcoes[0].vaiPara, 'cliente');
  // "comercial" na planilha vira encaminhar+departamento no motor
  assert.equal(inicio.opcoes[2].acao, 'encaminhar');
  assert.equal(inicio.opcoes[2].departamento, 'comercial');
});

test('virgula dentro de aspas nao parte a mensagem', () => {
  const campos = partirLinha('inicio,"Boa noite, tudo bem?",1,"Sim, claro",x,,', ',');
  assert.equal(campos[1], 'Boa noite, tudo bem?');
  assert.equal(campos[3], 'Sim, claro');
});

test('csv com ponto e virgula (Excel em portugues) tambem entra', () => {
  const csv = 'passo;mensagem;opcao;texto_opcao;vai_para;acao\n'
    + 'inicio;"Oi!";1;"Ver preço";;comercial\n';
  const r = fluxoDeCsv(csv);
  assert.deepEqual(r.erros, []);
  assert.equal(r.fluxo.passos[0].opcoes[0].texto, 'Ver preço');
});

test('cabecalho com outros nomes de coluna ainda e entendido', () => {
  const csv = 'Etapa,Pergunta,Numero,Escolha,Destino,Acao\n'
    + 'inicio,"Oi",1,"Sim",,comercial\n';
  assert.deepEqual(fluxoDeCsv(csv).erros, []);
});

test('csv que aponta pra passo inexistente e recusado ANTES de virar atendimento', () => {
  const csv = 'passo,mensagem,opcao,texto_opcao,vai_para,acao\n'
    + 'inicio,"Oi",1,"Vai",fantasma,\n';
  assert.match(fluxoDeCsv(csv).erros.join(' '), /fantasma/);
});

test('planilha sem a coluna passo diz o que achou, em vez de erro seco', () => {
  const r = fluxoDeCsv('nome,valor\na,b');
  assert.match(r.erros[0], /não achei a coluna "passo".*achei/s);
});

test('planilha vazia nao vira fluxo vazio', () => {
  assert.match(fluxoDeCsv('passo,mensagem').erros.join(' '), /vazia|cabeçalho/);
});

test('mensagem repetida no mesmo passo avisa onde esta o erro', () => {
  const csv = 'passo,mensagem,opcao,texto_opcao,vai_para,acao\n'
    + 'inicio,"Oi",1,"a",,fim\n'
    + 'inicio,"Outra coisa",2,"b",,fim\n';
  assert.match(fluxoDeCsv(csv).erros.join(' '), /linha 3.*primeira linha do passo/);
});

/* ---- o motor usando o fluxo, com memoria em disco ---- */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirBot = mkdtempSync(join(tmpdir(), 'fluxo-bot-'));
process.env.VSBOT_DIR = dirBot;
const bot = await import('../engine/vsbot/index.mjs');
test.after(() => rmSync(dirBot, { recursive: true, force: true }));

test('com fluxo cadastrado o bot conduz, e lembra onde a pessoa parou', () => {
  assert.equal(bot.importarFluxoCsv(modeloCsv()).ok, true);
  bot.salvarConfig({ ativo: true });

  const p1 = bot.atender('oi', { de: '5531975127978' });
  assert.match(p1.texto, /Micaela/);
  assert.match(p1.texto, /1 - Já sou cliente/);

  // segunda mensagem: ele TEM de lembrar que estava no menu inicial
  const p2 = bot.atender('1', { de: '5531975127978' });
  assert.match(p2.texto, /O que você precisa hoje/);

  // outra pessoa comeca do zero, sem herdar o passo de ninguem
  const outra = bot.atender('oi', { de: '5531988887777' });
  assert.match(outra.texto, /Micaela/);
});

test('depois do handoff o bot fica CALADO — nao fala por cima do atendente', () => {
  const de = '5531911112222';
  bot.atender('oi', { de });
  const r = bot.atender('3', { de }); // "Falar com uma pessoa"
  assert.equal(r.handoff, true);
  assert.match(r.texto, /chamando alguém/i);

  const depois = bot.atender('alo? tem alguem ai?', { de });
  assert.equal(depois.calado, true, 'o bot nao pode responder por cima da pessoa');
  assert.equal(depois.texto, '');
});

test('sem fluxo cadastrado, volta a valer a regra por palavra', () => {
  bot.apagarFluxo();
  bot.salvarRegra({ nome: 'Preço', termos: ['preco'], resposta: 'Sai 149.' });
  const r = bot.atender('qual o preco?', { de: '5531900001111' });
  assert.equal(r.tipo, 'regra');
  assert.match(r.texto, /149/);
});

/* ---- o vocabulario de quem escreve a planilha ---- */

import { traduzirAcao } from '../engine/vsbot/fluxo-csv.mjs';
import { readFileSync } from 'node:fs';

test('"encaminhar_financeiro" vira encaminhar com departamento', () => {
  assert.deepEqual(traduzirAcao('encaminhar_financeiro'), { acao: 'encaminhar', departamento: 'financeiro' });
});

test('"coletar_descricao" e "coletar_comentario" sao a mesma coisa: pergunta aberta', () => {
  assert.equal(traduzirAcao('coletar_descricao').acao, 'coletar');
  assert.equal(traduzirAcao('coletar_comentario').acao, 'coletar');
});

test('acao que o sistema ainda nao faz e marcada como PENDENTE, nao aceita calada', () => {
  assert.equal(traduzirAcao('consultar_base_conhecimento').pendente, 'base de conhecimento');
  assert.equal(traduzirAcao('abrir_ticket_e_encaminhar').pendente, 'ticket');
});

test('acao inventada e recusada com o nome dela', () => {
  assert.equal(traduzirAcao('fazer_cafe').desconhecida, 'fazer_cafe');
});

test('BOM do Excel nao esconde a coluna passo', () => {
  const r = fluxoDeCsv('﻿passo,mensagem,opcao,texto_opcao,vai_para,acao\ninicio,"Oi",1,"Sim",,fim\n');
  assert.deepEqual(r.erros, [], 'BOM fazia a importacao dizer que nao achou a coluna que estava ali');
});

test('o fluxo REAL da Micaela importa inteiro', () => {
  const csv = readFileSync('/home/veloso/Veloso/VelosoSolution/Micaela/fluxo-atendimento-micaela-completo.csv', 'utf8');
  const r = fluxoDeCsv(csv);
  assert.deepEqual(r.erros, []);
  assert.equal(r.resumo.passos, 27);
  assert.ok(r.avisos.length >= 2, 'tem de avisar sobre base de conhecimento e ticket');
});

test('pergunta aberta guarda o que a pessoa escreveu e segue em frente', () => {
  const fx = validarFluxo([
    { id: 'pergunta', mensagem: 'Descreva o problema.', acao: ACOES.COLETAR, vaiPara: 'fim' },
    { id: 'fim', mensagem: 'Obrigado!', acao: ACOES.FIM },
  ]).fluxo;

  const chegada = avancar(fx, null, 'oi');
  assert.equal(chegada.coletando, true, 'depois de perguntar, espera texto livre');
  assert.equal(chegada.passo, 'pergunta');

  const resposta = avancar(fx, { passo: 'pergunta', coletando: true }, 'a importação trava desde hoje cedo');
  assert.deepEqual(resposta.coleta, { chave: 'pergunta', valor: 'a importação trava desde hoje cedo' });
  assert.match(resposta.texto, /Obrigado/);
});

test('texto livre NAO e lido como escolha de menu', () => {
  const fx = validarFluxo([
    { id: 'p', mensagem: 'Descreva.', acao: ACOES.COLETAR, vaiPara: 'f' },
    { id: 'f', mensagem: 'Fim', acao: ACOES.FIM },
  ]).fluxo;
  const r = avancar(fx, { passo: 'p', coletando: true }, '1');
  assert.equal(r.coleta.valor, '1', 'o "1" era a resposta da pessoa, nao uma opcao');
});

test('encaminhar entrega o departamento pra quem vai rotear', () => {
  const r = avancar(exemplo(), { passo: 'inicio' }, '3');
  assert.equal(r.acao, ACOES.ENCAMINHAR);
  assert.equal(r.departamento, 'humano');
  assert.equal(r.handoff, true);
});

test('PORTA DE SAIDA: pedir gente escapa do menu em qualquer ponto da arvore', () => {
  bot.importarFluxoCsv(modeloCsv());
  bot.salvarConfig({ ativo: true, mensagemHandoff: 'Já chamo uma pessoa do time.' });
  const de = '5531955554444';
  bot.atender('oi', { de });
  bot.atender('1', { de });            // entra fundo na arvore
  const r = bot.atender('quero falar com um atendente', { de });
  assert.equal(r.handoff, true, 'ninguem pode ficar preso no menu');
  assert.match(r.texto, /chamo uma pessoa/);
});

test('mas numa pergunta ABERTA a palavra e resposta, nao comando', () => {
  const fx = validarFluxo([
    { id: 'p', mensagem: 'Descreva o problema.', acao: ACOES.COLETAR, vaiPara: 'f' },
    { id: 'f', mensagem: 'Obrigado!', acao: ACOES.FIM },
  ]).fluxo;
  assert.equal(bot.salvarFluxo(fx.passos).ok, true);
  const de = '5531944443333';
  bot.atender('oi', { de });
  const r = bot.atender('quero cancelar meu plano', { de });
  assert.equal(r.handoff, false, 'isso era a descricao do problema, nao um pedido de atendente');
  assert.match(r.texto, /Obrigado/);
});
