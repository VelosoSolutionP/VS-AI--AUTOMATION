/**
 * Qualificação e roteamento de leads — WhatsApp e Telegram, sem IA.
 *
 * O que estes testes seguram: a ficha sai da conversa sem questionário (e não
 * regride); a matriz manda integração/operação grande/reclamação pra gente e
 * deixa o simples com o bot; equipe sem ninguém não recebe; carteira decide
 * QUEM, não tira a conversa do bot; rodízio é previsível; e, no atendimento de
 * verdade, a transferência sai com o resumo e o responsável gravados no lead.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'qualificacao-iso-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import * as Q from '../engine/vsqualificacao/index.mjs';

const CAT = [{ nome: 'Bot de vendas' }, { nome: 'CRM' }];
const conversa = (...msgs) => msgs.reduce((f, m) => Q.qualificar(f, m, { produtos: CAT }), null);

test('ficha: cenário A da proposta (microempresa) fica com o bot', () => {
  const f = conversa('Tenho uma loja pequena e preciso de um bot para vender pelo WhatsApp.', 'Somente eu. Quero algo que responda meus clientes e organize os pedidos.');
  assert.equal(f.intencao, 'comprar');
  assert.equal(f.complexidade, 'padrao');
  assert.match(f.necessidade, /preciso de um bot/);
  assert.equal(Q.decidir(f).tier, 1);
});

test('ficha: cenário B (35 vendedores, 3 lojas, ERP) vai para o comercial Tier 2 com resumo', () => {
  const f = conversa('Tenho 35 vendedores, três lojas e preciso integrar o CRM ao meu ERP.');
  assert.deepEqual(f.porte, { vendedores: 35, unidades: 3 });
  assert.equal(f.complexidade, 'personalizada');
  assert.deepEqual(f.produtos, ['CRM']);
  const d = Q.decidir(f);
  assert.equal(d.tier, 2);
  assert.equal(d.destino, 'tier');
  assert.equal(d.regra, 'personalizada', 'personalizada vem antes do porte na matriz');
  assert.equal(d.proximaAcao, 'Avaliar a integração e o escopo');
  assert.match(Q.resumo(f), /3 unidade\(s\), 35 vendedor\(es\).*CRM.*sob medida/);
});

test('ficha: uma mensagem só já traz segmento, porte e prazo; não pergunta o que já sabe', () => {
  const f = conversa('Tenho uma loja de roupas com cinco vendedores e quero automatizar os pedidos até sexta');
  assert.equal(f.porte.vendedores, 5);
  assert.equal(f.prazo, 'esta-semana');
  assert.ok(!Q.faltando(f).includes('necessidade'));
  assert.ok(!Q.faltando(f).includes('prazo'));
});

test('ficha: não regride — porte só cresce, reclamação ganha de compra, prazo só encurta', () => {
  let f = conversa('quero comprar para minhas 4 lojas', 'na verdade são 2 lojas por enquanto');
  assert.equal(f.porte.unidades, 4);
  f = Q.qualificar(f, 'o último pedido veio quebrado, absurdo');
  assert.equal(f.intencao, 'reclamacao');
  f = Q.qualificar(f, 'quero comprar mais');
  assert.equal(f.intencao, 'reclamacao', 'reclamação aberta não vira compra por uma frase');
  f = Q.qualificar(Q.qualificar(null, 'sem pressa, só pesquisando'), 'preciso pra hoje');
  assert.equal(f.prazo, 'imediato');
});

test('matriz: porte sozinho não decide — microempresa com integração vai pra gente', () => {
  const f = conversa('sou MEI, só eu, mas preciso integrar com o Bling');
  assert.equal(Q.decidir(f).regra, 'personalizada');
  assert.equal(Q.decidir(f).tier, 2);
  const g = conversa('somos 40 vendedores e queremos o bot de vendas padrão');
  assert.equal(Q.decidir(g).regra, 'porte');
});

test('matriz: equipe sem ninguém não recebe — segue a próxima regra ou fica com o bot', () => {
  const f = conversa('temos 12 vendedores e precisamos integrar o ERP');
  assert.equal(Q.decidir(f, { tiersComGente: [2] }).tier, 2);
  const d = Q.decidir(f, { tiersComGente: [] });
  assert.equal(d.tier, 1);
  assert.match(d.motivo, /sem atendente em: Tier 2 do comercial/);
});

test('matriz: carteira escolhe QUEM na transferência, mas não tira do bot', () => {
  const f = conversa('quero pedir de novo');
  const resp = { operadorId: 'op-1', nome: 'Joana' };
  assert.equal(Q.decidir(f, { responsavel: resp }).tier, 1, 'mensagem comum de cliente de carteira segue no bot');
  const h = Q.decidir(f, { responsavel: resp, gatilho: 'handoff' });
  assert.equal(h.destino, 'responsavel');
  assert.equal(h.responsavel.nome, 'Joana');
});

test('matriz: configurável e validada', () => {
  assert.equal(Q.salvarConfig({ matriz: [{ condicao: 'inventada', destino: 'bot' }] }).ok, false);
  assert.equal(Q.salvarConfig({ matriz: [{ condicao: 'termo', valor: '', destino: 'equipe', equipe: 'x' }] }).ok, false);
  const r = Q.salvarConfig({ matriz: [{ condicao: 'termo', valor: 'atacado', destino: 'equipe', equipe: 'Atacado' }] });
  assert.equal(r.ok, true);
  assert.equal(r.matriz[0].equipe, 'atacado');
  assert.equal(Q.decidir(conversa('vocês vendem no atacado?'), { texto: 'vocês vendem no atacado?' }).equipe, 'atacado');
  Q.salvarConfig({ matriz: Q.MATRIZ_PADRAO });
});

test('distribuição: carteira à parte, rodízio previsível entre ativos da equipe', () => {
  const ops = [{ id: 'a', nome: 'Ana', setor: 'Corporativo' }, { id: 'b', nome: 'Beto', setor: 'corporativo' }, { id: 'c', nome: 'Caio', setor: 'corporativo', ativo: false }, { id: 'd', nome: 'Duda', setor: 'suporte' }];
  const nomes = [1, 2, 3].map(() => Q.distribuir('corporativo', ops).nome);
  assert.deepEqual(nomes, ['Ana', 'Beto', 'Ana'], 'desativado não entra no rodízio');
  assert.equal(Q.distribuir('ninguem', ops), null);
});

/* ── ponta a ponta no atendimento (mesmo caminho do WhatsApp e do Telegram) ── */

test('atendimento: Tier 2 transfere com resumo e responsável; Tier 1 segue com o bot', async () => {
  const bot = await import('../engine/vsbot/index.mjs');
  const crm = await import('../engine/vscrm/index.mjs');
  const operadores = await import('../engine/vsoperadores/index.mjs');
  const atendimento = await import('../backend/atendimento.mjs');
  crm.setFunil(['Novo lead', 'Qualificado', 'Fechado']);
  bot.salvarConfig({ ativo: true, assinatura: '', nome: 'Bia' });
  const op = operadores.salvar({ nome: 'Marta Especialista', setor: 'comercial', tier: 2, email: 'marta@loja.com' });
  assert.equal(op.ok, true, op.motivo || op.erro);
  const enviados = [];
  const enviar = async (m) => { enviados.push(m); return { ok: true }; };
  const msg = (de, texto, n) => ({ id: `m${n}`, de, nome: 'Carlos', texto, tipo: 'text', canal: de.startsWith('77') ? 'telegram' : 'whatsapp' });

  // Tier 2 pelo WhatsApp
  await atendimento.receberMensagem(msg('5531990000001', 'Tenho 35 vendedores, três lojas e preciso integrar o CRM ao meu ERP.', 1), { enviar, reservar: () => true });
  const lead = crm.listar().find((l) => l.telefone === '5531990000001');
  assert.equal(lead.comercial.decisao.tier, 2);
  assert.equal(lead.comercial.decisao.equipe, 'comercial');
  assert.equal(lead.comercial.decisao.tier, 2);
  assert.equal(lead.comercial.responsavel.nome, 'Marta Especialista');
  assert.match(enviados.at(-1).texto, /equipe comercial/);
  const fila = bot.emAtendimento().find((e) => e.telefone === '5531990000001');
  assert.equal(fila.departamento, 'comercial');
  assert.match(Q.resumo(lead.comercial.ficha), /35 vendedor/);
  assert.ok(lead.historico.some((h) => h.tipo === 'responsavel' && h.para === 'Marta Especialista'));

  // Devolvido ao bot: a mesma regra não transfere de novo na mensagem seguinte.
  bot.devolverAoBot('5531990000001');
  await atendimento.receberMensagem(msg('5531990000001', 'ok, e o preço?', 2), { enviar, reservar: () => true });
  assert.equal(bot.estaComGente('5531990000001'), false, 'devolver ao bot vale');

  // Tier 1 pelo Telegram (mesmo motor): segue com o bot, ficha gravada.
  await atendimento.receberMensagem(msg('77000123', 'Quero comprar um bot de vendas, só eu na loja', 3), { enviar, reservar: () => true });
  const tg = crm.listar().find((l) => l.telefone === '77000123');
  assert.equal(tg.comercial.decisao.tier, 1);
  assert.equal(tg.comercial.ficha.intencao, 'comprar');
  assert.equal(bot.estaComGente('77000123'), false);

  // Cliente de carteira pede gente: vai para o vendedor dele.
  crm.comercial(tg.id, { responsavel: { operadorId: op.operador.id, nome: 'Marta Especialista', equipe: 'comercial' } });
  await atendimento.receberMensagem(msg('77000123', 'quero falar com um atendente', 4), { enviar, reservar: () => true });
  const tg2 = crm.listar().find((l) => l.telefone === '77000123');
  assert.equal(bot.estaComGente('77000123'), true);
  assert.equal(tg2.comercial.responsavel.nome, 'Marta Especialista');
  assert.equal(tg2.comercial.decisao.destino, 'responsavel');
});

test('acesso de vendedor: cria, entra como vendedor, sai na hora ao remover', async () => {
  const usuarios = await import('../backend/usuarios.mjs');
  assert.equal(usuarios.criarAcessoVendedor({ email: 'x', senha: '12345678', operadorId: 'op' }).ok, false);
  assert.equal(usuarios.criarAcessoVendedor({ email: 'joana@loja.com', senha: 'curta', operadorId: 'op' }).ok, false);
  assert.equal(usuarios.criarAcessoVendedor({ email: 'joana@loja.com', nome: 'Joana', senha: 'senha-forte-1', operadorId: 'op-j' }).ok, true);
  const s = usuarios.entrar('joana@loja.com', 'senha-forte-1');
  assert.equal(s.ok, true);
  assert.equal(s.papel, 'vendedor');
  assert.equal(usuarios.autenticar(s.token).operadorId, 'op-j');
  assert.equal(usuarios.criarAcessoVendedor({ email: 'joana@loja.com', senha: 'senha-forte-2', operadorId: 'op-outro' }).ok, false, 'e-mail de outro acesso');
  usuarios.removerAcessoVendedor('op-j');
  assert.equal(usuarios.autenticar(s.token), null, 'sessão derrubada');
  assert.equal(usuarios.entrar('joana@loja.com', 'senha-forte-1').ok, false);
});

test('tiers: cada nível do comercial recebe o seu; sem ninguém no nível, a regra é pulada', () => {
  const ops = [
    { id: 't2a', nome: 'Ana T2', setor: 'comercial', tier: 2 },
    { id: 't3a', nome: 'Beto T3', setor: 'Comercial', tier: 3 },
    { id: 'fin', nome: 'Caio Fin', setor: 'financeiro' },
  ];
  assert.deepEqual(Q.tiersComGente(ops).sort(), [2, 3]);
  assert.equal(Q.distribuir('comercial', ops, { tier: 3 }).nome, 'Beto T3');
  assert.equal(Q.distribuir('comercial', ops, { tier: 2 }).nome, 'Ana T2');
  assert.equal(Q.distribuir('comercial', ops, { tier: 4 }), null);
  const matriz = [
    { id: 'grande', condicao: 'porteVendedores', valor: 50, destino: 'tier', tier: 3, nome: 'grande → T3' },
    { id: 'medio', condicao: 'porteVendedores', valor: 10, destino: 'tier', tier: 2, nome: 'médio → T2' },
  ];
  assert.equal(Q.decidir(conversa('temos 80 vendedores'), { matriz, tiersComGente: [2, 3] }).tier, 3);
  assert.equal(Q.decidir(conversa('temos 15 vendedores'), { matriz, tiersComGente: [2, 3] }).tier, 2);
  assert.equal(Q.decidir(conversa('temos 80 vendedores'), { matriz, tiersComGente: [2] }).tier, 2, 'sem ninguém no Tier 3, cai na próxima regra que tem gente');
  assert.equal(Q.decidir(conversa('temos 80 vendedores'), { matriz, tiersComGente: [] }).tier, 1, 'ninguém no comercial: fica com o bot');
});

test('equipe: singular e plural são a mesma fila ("especialista" × "especialistas")', () => {
  const matriz = [{ id: 'x', condicao: 'complexidade', destino: 'equipe', equipe: 'especialistas', nome: 'x' }];
  const f = conversa('preciso integrar com o ERP');
  assert.equal(Q.decidir(f, { matriz, equipesComGente: ['especialista'] }).tier, 2);
  assert.equal(Q.distribuir('especialistas', [{ id: 'j', nome: 'Juarez', setor: 'especialista' }]).nome, 'Juarez');
});

test('coletar o mínimo: pergunta porte/integração UMA vez a quem quer comprar', async () => {
  const f = conversa('quero comprar o bot de vendas');
  assert.equal(Q.precisaPerguntar(f), true);
  assert.equal(Q.precisaPerguntar({ ...f, perguntouEm: 'x' }), false, 'uma vez só');
  assert.equal(Q.precisaPerguntar(conversa('quero comprar para minhas 4 lojas')), false, 'porte já dito');
  assert.equal(Q.precisaPerguntar(conversa('meu pedido veio quebrado, absurdo')), false, 'reclamação não é venda');
  const crm = await import('../engine/vscrm/index.mjs');
  const atendimento = await import('../backend/atendimento.mjs');
  const enviados = [];
  await atendimento.receberMensagem({ id: 'pq1', de: '5531990000077', nome: 'Rui', texto: 'quero comprar o bot de vendas', tipo: 'text' }, { enviar: async (m) => { enviados.push(m); return { ok: true }; }, reservar: () => true });
  assert.match(enviados.at(-1).texto, /quantas pessoas ou lojas/);
  const lead = crm.listar().find((l) => l.telefone === '5531990000077');
  assert.ok(lead.comercial.ficha.perguntouEm);
  await atendimento.receberMensagem({ id: 'pq2', de: '5531990000077', nome: 'Rui', texto: 'quero comprar agora', tipo: 'text' }, { enviar: async (m) => { enviados.push(m); return { ok: true }; }, reservar: () => true });
  assert.doesNotMatch(enviados.at(-1).texto, /quantas pessoas ou lojas/, 'não pergunta de novo');
});

test('operador: tier só no setor comercial', async () => {
  const R = await import('../engine/vsoperadores/regras.mjs');
  assert.equal(R.validar({ nome: 'a', setor: 'Comercial', tier: 4 }).operador.tier, 4);
  assert.equal(R.validar({ nome: 'a', setor: 'comercial' }).operador.tier, 2, 'comercial sem tier = Tier 2');
  assert.equal(R.validar({ nome: 'a', setor: 'financeiro', tier: 4 }).operador.tier, null, 'fora do comercial não tem tier');
  assert.equal(R.validar({ nome: 'a', setor: 'comercial', tier: 1 }).ok, false, 'Tier 1 é o bot');
});
