/**
 * Resultados por canal — a receita só é do canal quando dá pra provar.
 *
 * O que estes testes seguram: pedido sem pagamento confirmado não é receita;
 * pedido de outro canal não entra; "recuperado" só quando pagou DEPOIS da
 * retomada; campanha só pega o pedido de quem chegou pelo link dela, dentro da
 * janela; e o /start do Telegram leva o código da campanha até o pedido.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'resultados-iso-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import * as R from '../engine/vsresultados/index.mjs';
import { normalizarUpdate, idTelegram } from '../engine/canais/telegram/index.mjs';

const AGORA = '2026-09-26T12:00:00.000Z';
const antes = (min) => new Date(new Date(AGORA).getTime() - min * 60000).toISOString();
const pago = (id, quando) => ({ id, estado: 'CONFIRMADO', historico: [{ de: 'CRIADO', para: 'CONFIRMADO', quando }] });

test('codigo de campanha: sem acento, formato aceito pelo Telegram, sem repetir', () => {
  assert.equal(R.codigoDe('Promoção de Sexta!'), 'promocao-de-sexta');
  assert.equal(R.codigoDe('Promoção de Sexta!', ['promocao-de-sexta']), 'promocao-de-sexta-2');
  assert.match(R.codigoDe('x'.repeat(200)), /^[a-z0-9-]{1,64}$/);
  assert.equal(R.criarCampanha({ nome: '' }).ok, false);
});

test('receita: so pedido PAGO e do canal certo; sem pagamento vira pedido, nao dinheiro', () => {
  const tg = idTelegram(111);
  R.registrarPedido({ referencia: 'P1', pagamentoId: 'pg1', telefone: tg, canal: 'telegram', valorCentavos: 5000, quando: antes(600) });
  R.registrarPedido({ referencia: 'P2', pagamentoId: 'pg2', telefone: tg, canal: 'telegram', valorCentavos: 3000, quando: antes(500) }); // nao pago
  R.registrarPedido({ referencia: 'P3', pagamentoId: null, telefone: tg, canal: 'telegram', valorCentavos: 9999, quando: antes(400) }); // pagar na entrega
  R.registrarPedido({ referencia: 'W1', pagamentoId: 'pgw', telefone: '5531999990000', canal: 'whatsapp', valorCentavos: 7000, quando: antes(300) });
  const pagamentos = [pago('pg1', antes(590)), { id: 'pg2', estado: 'PENDENTE' }, pago('pgw', antes(290))];
  const r = R.resumo({ canal: 'telegram', dias: 30, agora: AGORA, pagamentos, leads: { atendidos: 4, peloBot: 3 } });
  assert.equal(r.receitaCentavos, 5000);
  assert.equal(r.pedidos, 3);
  assert.equal(r.pedidosConcluidos, 1);
  assert.equal(r.pedidosSemPagamento, 1);
  assert.equal(r.conversao, 1 / 4);
  const w = R.resumo({ canal: 'whatsapp', dias: 30, agora: AGORA, pagamentos });
  assert.equal(w.receitaCentavos, 7000, 'WhatsApp tem a sua receita, sem misturar');
});

test('mesma referencia duas vezes (reentrega) nao duplica o pedido', () => {
  const r = R.registrarPedido({ referencia: 'P1', pagamentoId: 'pg1', telefone: idTelegram(111), canal: 'telegram', valorCentavos: 5000 });
  assert.equal(r.repetido, true);
});

test('estorno e chargeback nao sao receita', () => {
  R.registrarPedido({ referencia: 'E1', pagamentoId: 'pge', telefone: idTelegram(222), canal: 'telegram', valorCentavos: 4000, quando: antes(100) });
  const r = R.resumo({ canal: 'telegram', dias: 30, agora: AGORA, pagamentos: [{ id: 'pge', estado: 'ESTORNADO' }] });
  assert.equal(r.receitaCentavos, 0);
  assert.ok(!r.oportunidades.some((o) => o.referencia === 'E1'), 'pedido estornado nao vira oportunidade de retomada');
});

test('oportunidade: parado ha mais de 30 min, sem pagar, e com menos de 7 dias', () => {
  R.registrarPedido({ referencia: 'O-novo', pagamentoId: 'po1', telefone: idTelegram(333), canal: 'telegram', valorCentavos: 1000, quando: antes(10) });
  R.registrarPedido({ referencia: 'O-ok', pagamentoId: 'po2', telefone: idTelegram(333), canal: 'telegram', valorCentavos: 1000, quando: antes(60) });
  R.registrarPedido({ referencia: 'O-frio', pagamentoId: 'po3', telefone: idTelegram(333), canal: 'telegram', valorCentavos: 1000, quando: antes(60 * 24 * 8) });
  const r = R.resumo({ canal: 'telegram', dias: 30, agora: AGORA, pagamentos: [] });
  const refs = r.oportunidades.map((o) => o.referencia);
  assert.ok(refs.includes('O-ok'));
  assert.ok(!refs.includes('O-novo'), 'ainda pode estar pagando');
  assert.ok(!refs.includes('O-frio'), 'esfriou: nao se incomoda quem desistiu ha dias');
});

test('retomada e uma so, e recuperado conta so quem pagou DEPOIS dela', () => {
  R.registrarPedido({ referencia: 'R1', pagamentoId: 'pr1', telefone: idTelegram(444), canal: 'telegram', valorCentavos: 2500, quando: antes(200) });
  R.registrarPedido({ referencia: 'R2', pagamentoId: 'pr2', telefone: idTelegram(445), canal: 'telegram', valorCentavos: 1500, quando: antes(200) });
  assert.equal(R.marcarRetomada('R1', antes(100)).ok, true);
  assert.equal(R.marcarRetomada('R1', antes(90)).ok, false, 'segunda retomada do mesmo pedido e recusada');
  assert.equal(R.marcarRetomada('R2', antes(100)).ok, true);
  const pagamentos = [pago('pr1', antes(50)), pago('pr2', antes(150))]; // R2 pagou ANTES da retomada
  const r = R.resumo({ canal: 'telegram', dias: 30, agora: AGORA, pagamentos });
  assert.equal(r.recuperados, 1);
  assert.equal(r.receitaRecuperadaCentavos, 2500);
});

test('campanha: pedido de quem chegou pelo link e atribuido; codigo inventado nao conta', () => {
  const c = R.criarCampanha({ nome: 'Promo Sexta', canal: 'telegram' }).campanha;
  const quem = idTelegram(555);
  assert.equal(R.registrarOrigem(quem, { canal: 'telegram', campanha: 'nao-existe' }).ok, false);
  assert.equal(R.registrarOrigem(quem, { canal: 'telegram', campanha: c.codigo, quando: antes(300) }).ok, true);
  R.registrarPedido({ referencia: 'C1', pagamentoId: 'pc1', telefone: quem, canal: 'telegram', valorCentavos: 8000, quando: antes(200) });
  const r = R.resumo({ canal: 'telegram', dias: 30, agora: AGORA, pagamentos: [pago('pc1', antes(190))] });
  const linha = r.porCampanha.find((x) => x.codigo === c.codigo);
  assert.equal(linha.conversas, 1);
  assert.equal(linha.concluidos, 1);
  assert.equal(linha.receitaCentavos, 8000);
});

test('campanha fora da janela de 30 dias nao leva o credito', () => {
  const c = R.criarCampanha({ nome: 'Antiga', canal: 'telegram' }).campanha;
  const quem = idTelegram(666);
  R.registrarOrigem(quem, { canal: 'telegram', campanha: c.codigo, quando: '2026-07-01T00:00:00.000Z' });
  const p = R.registrarPedido({ referencia: 'C2', pagamentoId: 'pc2', telefone: quem, canal: 'telegram', valorCentavos: 100, quando: antes(10) });
  assert.equal(p.pedido.campanha, null);
});

test('variacao so aparece quando existe periodo anterior com receita', () => {
  const r = R.resumo({ canal: 'telegram', dias: 7, agora: AGORA, pagamentos: [] });
  assert.equal(r.variacao, null);
  assert.equal(r.serie.length >= 7, true, 'serie tem um ponto por dia, dia sem venda como zero');
});

test('Telegram: t.me/bot?start=codigo chega com o codigo da campanha', () => {
  const u = { update_id: 1, message: { message_id: 1, date: 1790000000, text: '/start promo-sexta', chat: { id: 9, type: 'private' }, from: { id: 9, first_name: 'Bia' } } };
  const m = normalizarUpdate(u);
  assert.equal(m.texto, 'Olá');
  assert.equal(m.ref, 'promo-sexta');
  const semCodigo = normalizarUpdate({ ...u, message: { ...u.message, text: '/start' } });
  assert.equal(semCodigo.ref, null);
});

/* ---- ponta a ponta: conversa no Telegram -> pedido atribuido ---- */

test('conversa pelo link da campanha no Telegram gera pedido atribuido ao canal e a campanha', async () => {
  const { fluxoDeCsv } = await import('../engine/vsbot/fluxo-csv.mjs');
  const bot = await import('../engine/vsbot/index.mjs');
  const crm = await import('../engine/vscrm/index.mjs');
  const atendimento = await import('../backend/atendimento.mjs');
  crm.setFunil(['Novo lead', 'Qualificado', 'Fechado']);
  const CSV = `passo,mensagem,opcao,texto_opcao,vai_para,acao,valor
inicio,"O que vai ser?",1,"X-Tudo",fecha,,"28,00"
fecha,"Fechou!",,,,cobrar,
`;
  bot.salvarFluxo(fluxoDeCsv(CSV).fluxo.passos);
  bot.salvarConfig({ ativo: true, assinatura: '' });
  const camp = R.criarCampanha({ nome: 'Combo do Jogo', canal: 'telegram' }).campanha;
  const upd = (texto, n) => normalizarUpdate({ update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), text: texto, chat: { id: 7070, type: 'private' }, from: { id: 7070, first_name: 'Caio' } } });
  const enviar = async () => ({ ok: true });
  const cobrar = async (e) => ({ ok: true, pagamento: { id: 'pay_tg_1', valorCentavos: e.valorCentavos, linkPagamento: 'https://pague.aqui/tg' } });
  for (const [t, n] of [[`/start ${camp.codigo}`, 1], ['1', 2]]) {
    await atendimento.receberMensagem(upd(t, n), { enviar, cobrar, reservar: () => true });
  }
  const tel = idTelegram(7070);
  const r = R.resumo({ canal: 'telegram', dias: 30, pagamentos: [pago('pay_tg_1', new Date().toISOString())] });
  const linha = r.porCampanha.find((x) => x.codigo === camp.codigo);
  assert.equal(linha.pedidos, 1, 'o pedido nasceu com a campanha');
  assert.equal(linha.receitaCentavos, 2800);
  const lead = crm.listar().find((l) => l.telefone === tel);
  assert.ok(lead.historico.filter((h) => h.tipo === 'interacao' && h.direcao === 'saida').every((h) => h.autor === 'bot'));
});
