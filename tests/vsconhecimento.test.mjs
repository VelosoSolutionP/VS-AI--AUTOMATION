import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as kb from '../engine/vsatendimento/conhecimento.mjs';
import * as fila from '../engine/vsatendimento/fila.mjs';

const regra = kb.novaEntrada({
  tipo: 'regra',
  titulo: 'cadastro de cliente recusa CPF ja usado em outra unidade',
  sintomas: ['cadastro', 'cliente', 'cpf', 'duplicado', 'recusa'],
  resposta: 'A plataforma nao aceita o mesmo CPF em duas unidades. Libere na unidade de origem antes.',
  origem: 'doc oficial',
}).entrada;

const solucao = kb.novaEntrada({
  tipo: 'solucao',
  titulo: 'relatorio financeiro sai em branco depois da virada do mes',
  sintomas: ['relatorio', 'financeiro', 'branco', 'vazio'],
  resposta: 'Era cache do fechamento. Limpamos e voltou.',
  origem: 'atendimento 5531-20260901',
}).entrada;

/* -------------------------------------------------------------- cadastro */

test('entrada sem origem e recusada — nao se guarda conhecimento sem saber de onde veio', () => {
  const r = kb.novaEntrada({ titulo: 'alguma coisa quebrada', resposta: 'faca assim entao' });
  assert.match(r.erro, /precisa de origem/);
});

test('entrada sem o que fazer e recusada', () => {
  const r = kb.novaEntrada({ titulo: 'alguma coisa quebrada', resposta: 'sei la', origem: 'eu' });
  assert.match(r.erro, /escreva o que o cliente deve fazer/);
});

/* ----------------------------------------------------------------- busca */

test('base vazia devolve lista vazia — e no comeco esse e o estado normal', () => {
  assert.deepEqual(kb.buscar([], 'nao entra no sistema'), []);
  const s = kb.sugerir([], 'nao entra no sistema');
  assert.equal(s.sugestao, null);
  assert.match(s.mensagem, /nao vou te fazer perder tempo/i);
});

test('o cliente escreve com acento e girias e a base acha mesmo assim', () => {
  const r = kb.buscar([regra], 'nao consigo fazer o CADASTRO do CLIENTE, o CPF da recusa');
  assert.equal(r.length, 1);
  assert.ok(r[0].confianca >= kb.LIMIAR);
});

test('LIMIAR: casamento fraco NAO vira sugestao — ela prefere dizer que nao sabe', () => {
  const s = kb.sugerir([regra, solucao], 'o cadastro esta estranho');
  assert.equal(s.sugestao, null, 'uma palavra em comum nao pode virar resposta confiante');
});

test('codigo de erro bate com confianca total — a parte confiavel de doc ruim', () => {
  const comCodigo = kb.novaEntrada({
    tipo: 'regra', titulo: 'erro na integracao de pagamento', codigo: 'ASA-422',
    resposta: 'Documento do pagador invalido. Corrija o CPF/CNPJ na cobranca.', origem: 'doc oficial',
  }).entrada;
  assert.equal(kb.confianca(comCodigo, 'deu ASA-422 aqui'), 1);
  const s = kb.sugerir([comCodigo], 'apareceu ASA-422 na tela');
  assert.equal(s.sugestao.codigo, 'asa-422');
});

test('regra da plataforma ganha de solucao no empate — economiza o especialista inteiro', () => {
  const mesmoSintoma = kb.novaEntrada({
    tipo: 'solucao', titulo: 'cadastro de cliente recusa CPF ja usado em outra unidade',
    sintomas: ['cadastro', 'cliente', 'cpf', 'duplicado', 'recusa'],
    resposta: 'Abrimos chamado e liberamos manualmente.', origem: 'atendimento 1',
  }).entrada;
  const r = kb.buscar([mesmoSintoma, regra], 'cadastro do cliente recusa cpf duplicado');
  assert.equal(r[0].entrada.tipo, 'regra');
});

test('PLACAR: entrada que erra seguido se aposenta sozinha', () => {
  let ruim = kb.novaEntrada({
    tipo: 'solucao', titulo: 'relatorio financeiro sai em branco',
    sintomas: ['relatorio', 'financeiro', 'branco'],
    resposta: 'Tente de novo mais tarde.', origem: 'chute antigo',
  }).entrada;

  assert.equal(kb.buscar([ruim], 'relatorio financeiro em branco').length, 1);
  for (let i = 0; i < 3; i += 1) { ruim = kb.registrarResultado(ruim, false).entrada; }
  assert.equal(kb.placar(ruim), -3);
  assert.equal(kb.buscar([ruim], 'relatorio financeiro em branco').length, 0,
    'entrada queimada some da busca sem ninguem precisar deletar');
});

test('produto filtra: solucao do Bolso Cheio nao aparece pra quem usa o QA-Gate', () => {
  const doBolso = kb.novaEntrada({
    tipo: 'solucao', titulo: 'lancamento nao aparece no extrato',
    sintomas: ['lancamento', 'extrato', 'aparece'], produto: 'bolso-cheio',
    resposta: 'Era filtro de data.', origem: 'atendimento 2',
  }).entrada;
  assert.equal(kb.buscar([doBolso], 'lancamento nao aparece no extrato', { produto: 'bolso-cheio' }).length, 1);
  assert.equal(kb.buscar([doBolso], 'lancamento nao aparece no extrato', { produto: 'qa-gate' }).length, 0);
});

/* ----------------------------------------------------------- aprendizado */

test('so atendimento encerrado E resolvido vira conhecimento', () => {
  const a = fila.abrir({ cliente: '5531900000010', setor: 'suporte', motivo: 'x' }).atendimento;
  assert.match(kb.aprender(a).erro, /so atendimento encerrado/);
  const fim = fila.encerrar(a, { desfecho: 'sem-resposta' }).atendimento;
  assert.match(kb.aprender(fim).erro, /so atendimento resolvido/);
});

test('atendimento resolvido vira RASCUNHO, nunca entrada publicada', () => {
  const t0 = '2026-09-21T10:00:00.000Z';
  let a = fila.abrir({ cliente: '5531900000011', setor: 'suporte', motivo: 'x', assunto: 'relatorio em branco',
    conversa: [{ autor: 'cliente', texto: 'o relatorio financeiro sai todo em branco' }] }, t0).atendimento;
  a = fila.assumir([a], 'suporte', 'ana', t0).atendimento;
  a = fila.falar(a, { autor: 'ana', texto: 'Era cache do fechamento, limpei e voltou.' }).atendimento;
  a = fila.encerrar(a, { desfecho: 'resolvido' }).atendimento;

  const r = kb.aprender(a);
  assert.equal(r.rascunho.tipo, 'solucao');
  assert.match(r.rascunho.origem, /atendimento/);
  assert.match(r.rascunho.resposta, /cache do fechamento/);
  assert.ok(r.rascunho.sintomas.includes('relatorio'));
  assert.equal(r.rascunho.precisaRevisao, false);
  assert.equal(r.rascunho.id, undefined, 'rascunho nao e entrada: alguem precisa publicar');
});

test('resolvido sem a equipe escrever nada nasce pedindo revisao, nao entrada vazia', () => {
  let a = fila.abrir({ cliente: '5531900000012', setor: 'suporte', motivo: 'x', assunto: 'travou' }).atendimento;
  a = fila.assumir([a], 'suporte', 'ana').atendimento;
  a = fila.encerrar(a, { desfecho: 'resolvido' }).atendimento;
  assert.equal(kb.aprender(a).rascunho.precisaRevisao, true);
});

/* ------------------------------------------------------------ evidencias */

test('atendimento sem evidencia fica marcado pro especialista ver antes de abrir', () => {
  const a = fila.abrir({ cliente: '5531900000013', setor: 'suporte', motivo: 'x' }).atendimento;
  assert.equal(fila.semEvidencia(a), true);
  const com = fila.anexar(a, { tipo: 'imagem', conteudo: 'print-erro.png' }).atendimento;
  assert.equal(fila.semEvidencia(com), false);
  assert.equal(com.evidencias[0].de, 'cliente');
});

test('evidencia vazia ou de tipo desconhecido e recusada', () => {
  const a = fila.abrir({ cliente: '5531900000014', setor: 'suporte', motivo: 'x' }).atendimento;
  assert.match(fila.anexar(a, { tipo: 'imagem', conteudo: '  ' }).erro, /vazia/);
  assert.match(fila.anexar(a, { tipo: 'planilha', conteudo: 'x' }).erro, /tipo de evidencia invalido/);
});

/* ------------------------------------------------- ponta a ponta com disco */

test('ponta a ponta: base vazia escala, atendimento vira base, proximo cliente ja recebe sugestao', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vskb-'));
  process.env.VSCRM_DIR = dir;
  const at = await import('../engine/vsatendimento/index.mjs?kb');

  at.salvarContrato({ cliente: '5531900000020', plano: 'B', inclusos: ['suporte'] });

  // Dia 1: base vazia. Ela nao inventa, escala com evidencia.
  assert.equal(at.sugerir('relatorio financeiro sai em branco').sugestao, null);

  const esc = at.escalar({ cliente: '5531900000020', servico: 'suporte', assunto: 'relatorio em branco',
    conversa: [{ autor: 'cliente', texto: 'o relatorio financeiro sai todo em branco' }],
    evidencias: [{ tipo: 'imagem', conteudo: 'print.png' }] });
  assert.equal(esc.atendimento.setor, 'suporte');
  assert.equal(esc.atendimento.evidencias.length, 1);

  const puxou = at.assumir('suporte', 'ana');
  at.falar(puxou.atendimento.id, { autor: 'ana', texto: 'Era cache do fechamento do mes, limpei e voltou.' });
  at.encerrar(puxou.atendimento.id, { desfecho: 'resolvido' });

  // O especialista publica o que aprendeu.
  const r = at.aprenderCom(puxou.atendimento.id, { autor: 'ana' });
  assert.match(r.rascunho.resposta, /cache do fechamento/);
  assert.ok(at.salvarConhecimento(r.rascunho).entrada);

  // Dia 2: o proximo cliente com o mesmo sintoma ja recebe resposta.
  const s = at.sugerir('meu relatorio financeiro esta saindo em branco');
  assert.ok(s.sugestao, 'depois de aprender, ela responde');
  assert.match(s.mensagem, /cache do fechamento/);

  // E o placar funciona na ida e na volta.
  assert.equal(at.avaliarConhecimento(s.sugestao.id, true).entrada.resolveu, 1);

  const p = at.painel();
  assert.equal(p.conhecimento, 1);
  assert.equal(p.semEvidencia, 0);

  rmSync(dir, { recursive: true, force: true });
  delete process.env.VSCRM_DIR;
});
