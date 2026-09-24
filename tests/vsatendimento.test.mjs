import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as contratos from '../engine/vsatendimento/contratos.mjs';
import * as fila from '../engine/vsatendimento/fila.mjs';
import { triar } from '../engine/vsatendimento/triagem.mjs';

const planoA = { cliente: '5531999990000', plano: 'A', horasMes: 10, cotas: { campanha: 3 }, inclusos: ['suporte', 'campanha'] };
const planoB = { cliente: '5531988880000', plano: 'B', inclusos: ['suporte', 'campanha'] };
const contratoA = contratos.normalizar(planoA).contrato;
const contratoB = contratos.normalizar(planoB).contrato;

/* ------------------------------------------------------------- contratos */

test('plano A sem horasMes e recusado com o motivo no texto', () => {
  const r = contratos.normalizar({ ...planoA, horasMes: 0 });
  assert.match(r.erro, /plano A precisa de horasMes/);
});

test('plano B nao tem teto de horas — minutosRestantes e null, nunca zero', () => {
  assert.equal(contratos.minutosRestantes(contratoB, 99999), null);
  assert.equal(contratos.minutosRestantes(contratoA, 0), 600);
  assert.equal(contratos.minutosRestantes(contratoA, 590), 10);
});

test('cota so existe pro servico que tem teto; servico sem teto devolve null', () => {
  assert.equal(contratos.cotaRestante(contratoA, 'campanha', 2), 1);
  assert.equal(contratos.cotaRestante(contratoA, 'suporte', 99), null);
});

/* --------------------------------------------------------------- triagem */

test('pendencia financeira vem ANTES de tudo e nasce bloqueada no financeiro', () => {
  const r = triar({ cliente: planoA.cliente, servico: 'suporte' },
    { contrato: contratoA, pendencias: [{ valor: 300 }] });
  assert.equal(r.setor, 'financeiro');
  assert.equal(r.status, 'bloqueado');
  assert.match(r.mensagem, /pendencia financeira/i);
});

test('pendencia ganha do contrato perfeito — a ordem das regras importa', () => {
  const emDia = triar({ cliente: planoA.cliente, servico: 'suporte' }, { contrato: contratoA, pendencias: [] });
  assert.equal(emDia.setor, 'suporte');
  const devendo = triar({ cliente: planoA.cliente, servico: 'suporte' }, { contrato: contratoA, pendencias: [{ valor: 1 }] });
  assert.equal(devendo.setor, 'financeiro');
});

test('cliente sem contrato vai pro comercial, nao pro especialista', () => {
  const r = triar({ cliente: '5531977770000' }, { contrato: null });
  assert.equal(r.setor, 'comercial');
  assert.equal(r.status, 'aguardando');
});

test('contrato vencido nao chega no especialista', () => {
  const vencido = contratos.normalizar({ ...planoA, vigenteAte: '2020-01-01' }).contrato;
  const r = triar({ cliente: planoA.cliente }, { contrato: vencido, quando: '2026-09-21T10:00:00.000Z' });
  assert.equal(r.setor, 'comercial');
  assert.match(r.motivo, /vencido/);
});

test('servico fora do contrato vai pro comercial e a frase fala do PLANO, nao do cliente', () => {
  const r = triar({ cliente: planoA.cliente, servico: 'consultoria' }, { contrato: contratoA });
  assert.equal(r.setor, 'comercial');
  assert.match(r.mensagem, /plano hoje nao inclui consultoria/);
  assert.doesNotMatch(r.mensagem, /voce nao pode/i);
});

test('cota de campanha estourada manda pro comercial — este e o caso que o Fabiano descreveu', () => {
  const r = triar({ cliente: planoA.cliente, servico: 'campanha' }, { contrato: contratoA, cotaUsada: 3 });
  assert.equal(r.setor, 'comercial');
  assert.match(r.motivo, /cota de "campanha" esgotada/);
});

test('cota com folga segue pro especialista', () => {
  const r = triar({ cliente: planoA.cliente, servico: 'campanha' }, { contrato: contratoA, cotaUsada: 2 });
  assert.equal(r.setor, 'suporte');
});

test('horas do plano A no fim vao pro comercial; plano B nunca esgota', () => {
  const a = triar({ cliente: planoA.cliente }, { contrato: contratoA, minutosUsados: 600 });
  assert.equal(a.setor, 'comercial');
  const b = triar({ cliente: planoB.cliente }, { contrato: contratoB, minutosUsados: 99999 });
  assert.equal(b.setor, 'suporte');
});

test('nenhum caminho da triagem termina sem atendimento — sempre ha setor e mensagem', () => {
  const casos = [
    { contrato: contratoA, pendencias: [{ valor: 1 }] },
    { contrato: null },
    { contrato: contratoA, cotaUsada: 3 },
    { contrato: contratoA, minutosUsados: 600 },
    { contrato: contratoA },
  ];
  for (const ctx of casos) {
    const r = triar({ cliente: planoA.cliente, servico: 'campanha' }, ctx);
    assert.ok(contratos.SETORES.includes(r.setor), `setor invalido: ${r.setor}`);
    assert.ok(r.mensagem.length > 10, 'toda saida da triagem fala com o cliente');
  }
});

/* ------------------------------------------------------------------ fila */

test('a fila e puxada: assumir entrega o mais antigo do setor', () => {
  const t0 = '2026-09-21T10:00:00.000Z';
  const t1 = '2026-09-21T11:00:00.000Z';
  const velho = fila.abrir({ cliente: '5531900000001', setor: 'suporte', motivo: 'x' }, t0).atendimento;
  const novo = fila.abrir({ cliente: '5531900000002', setor: 'suporte', motivo: 'x' }, t1).atendimento;
  const outro = fila.abrir({ cliente: '5531900000003', setor: 'comercial', motivo: 'x' }, t0).atendimento;

  const r = fila.assumir([novo, outro, velho], 'suporte', 'ana');
  assert.equal(r.atendimento.cliente, velho.cliente);
  assert.equal(r.atendimento.status, 'em_atendimento');
  assert.equal(r.atendimento.especialista, 'ana');
});

test('fila vazia devolve {vazio:true}, nao erro — fila vazia e o estado bom', () => {
  const r = fila.assumir([], 'suporte', 'ana');
  assert.equal(r.vazio, true);
  assert.equal(r.erro, undefined);
});

test('bloqueado nao entra na fila do especialista', () => {
  const b = fila.abrir({ cliente: '5531900000004', setor: 'financeiro', status: 'bloqueado', motivo: 'deve' }).atendimento;
  assert.equal(fila.aguardando([b], 'financeiro').length, 0);
  assert.equal(fila.assumir([b], 'financeiro', 'ana').vazio, true);
});

test('so o financeiro tira do bloqueio, e a liberacao fica registrada na conversa', () => {
  const b = fila.abrir({ cliente: '5531900000005', setor: 'financeiro', status: 'bloqueado', motivo: 'deve' }).atendimento;
  assert.match(fila.liberar(b, { setor: 'suporte' }).erro, /informe quem liberou/);

  const r = fila.liberar(b, { setor: 'suporte', por: 'joana' });
  assert.equal(r.atendimento.status, 'aguardando');
  assert.equal(r.atendimento.setor, 'suporte');
  assert.match(r.atendimento.mensagens.at(-1).texto, /joana/);

  assert.match(fila.liberar(r.atendimento, { por: 'joana' }).erro, /so um atendimento bloqueado/);
});

test('o tempo conta de quando o especialista assumiu, nao de quando o cliente chegou', () => {
  const chegou = '2026-09-21T10:00:00.000Z';
  const assumiu = '2026-09-21T12:00:00.000Z';
  const fechou = '2026-09-21T12:30:00.000Z';

  const a = fila.abrir({ cliente: '5531900000006', setor: 'suporte', motivo: 'x' }, chegou).atendimento;
  const emAt = fila.assumir([a], 'suporte', 'ana', assumiu).atendimento;
  const fim = fila.encerrar(emAt, {}, fechou).atendimento;

  // 2h de fila + 30min de especialista: so os 30 saem da cota do cliente.
  assert.equal(fim.minutos, 30);
  assert.equal(fim.status, 'encerrado');
});

test('toda mensagem tem autor — e o que permite a Micaela e a pessoa aparecerem na mesma conversa', () => {
  const a = fila.abrir({ cliente: '5531900000007', setor: 'suporte', motivo: 'x',
    conversa: [{ autor: 'cliente', texto: 'sistema fora do ar' }, { autor: 'micaela', texto: 'ja chamo alguem' }] }).atendimento;
  assert.deepEqual(a.mensagens.map((m) => m.autor), ['cliente', 'micaela']);

  const comPessoa = fila.falar(a, { autor: 'ana', texto: 'oi, sou a Ana do suporte' }).atendimento;
  assert.equal(comPessoa.mensagens.at(-1).autor, 'ana');
  assert.match(fila.falar(a, { texto: 'sem autor' }).erro, /precisa de autor/);
});

test('atendimento encerrado nao recebe mensagem nova', () => {
  const a = fila.abrir({ cliente: '5531900000008', setor: 'suporte', motivo: 'x' }).atendimento;
  const fim = fila.encerrar(a).atendimento;
  assert.match(fila.falar(fim, { autor: 'ana', texto: 'oi' }).erro, /ja encerrado/);
});

/* --------------------------------------------- ponta a ponta com disco */

test('ponta a ponta: Micaela escala, especialista puxa, encerra e debita do plano', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vsatend-'));
  process.env.VSCRM_DIR = dir;
  const at = await import('../engine/vsatendimento/index.mjs?e2e');

  assert.ok(at.salvarContrato(planoA).contrato);

  const esc = at.escalar({ cliente: planoA.cliente, servico: 'suporte', assunto: 'nao abre',
    conversa: [{ autor: 'cliente', texto: 'nao abre de jeito nenhum' }] });
  assert.equal(esc.atendimento.setor, 'suporte');
  assert.equal(esc.atendimento.status, 'aguardando');
  // a fala da Micaela entrou na conversa: o especialista nao pede pra repetir
  assert.equal(esc.atendimento.mensagens.at(-1).autor, 'micaela');

  const puxou = at.assumir('suporte', 'ana');
  assert.equal(puxou.atendimento.especialista, 'ana');
  assert.equal(at.aguardando('suporte').length, 0);

  assert.ok(at.falar(puxou.atendimento.id, { autor: 'ana', texto: 'ja olhei aqui' }).atendimento);

  const fim = at.encerrar(puxou.atendimento.id, { desfecho: 'resolvido' });
  assert.equal(fim.atendimento.status, 'encerrado');
  assert.equal(typeof fim.minutosRestantes, 'number');
  assert.ok(fim.minutosRestantes <= 600);

  const p = at.painel();
  assert.equal(p.porSetor.suporte.aguardando, 0);
  assert.equal(p.contratos, 1);

  rmSync(dir, { recursive: true, force: true });
  delete process.env.VSCRM_DIR;
});

test('ponta a ponta: devendo, o mesmo pedido para no financeiro e bloqueado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vsatend-'));
  process.env.VSCRM_DIR = dir;
  const at = await import('../engine/vsatendimento/index.mjs?e2e2');

  at.salvarContrato(planoA);
  const esc = at.escalar({ cliente: planoA.cliente, servico: 'suporte' }, { pendencias: [{ valor: 250 }] });

  assert.equal(esc.atendimento.setor, 'financeiro');
  assert.equal(esc.atendimento.status, 'bloqueado');
  assert.equal(at.assumir('suporte', 'ana').vazio, true);

  const lib = at.liberar(esc.atendimento.id, { setor: 'suporte', por: 'joana' });
  assert.equal(lib.atendimento.status, 'aguardando');
  assert.equal(at.assumir('suporte', 'ana').atendimento.especialista, 'ana');

  rmSync(dir, { recursive: true, force: true });
  delete process.env.VSCRM_DIR;
});
