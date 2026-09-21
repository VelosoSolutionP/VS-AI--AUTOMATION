/**
 * Gateway do Mercado Pago. Nada aqui toca a rede nem move dinheiro: o `fetch` é
 * injetado, como no resto do repo.
 *
 * O que estes casos protegem, em ordem de estrago:
 *  - webhook forjado entrando como pagamento confirmado;
 *  - "em revisão" sendo lido como pago (libera mercadoria antes do dinheiro);
 *  - reentrega de rede virando duas cobranças pro mesmo cliente.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { criarGateway, validarWebhook, ESTADO_MP } from '../engine/vspagamentos/mercadopago.mjs';

/** fetch de mentira que grava o que foi pedido e devolve o que mandarmos. */
function fetchFalso(respostas = []) {
  const chamadas = [];
  let i = 0;
  const f = async (url, opts) => {
    chamadas.push({ url, metodo: opts.method, corpo: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    const r = respostas[Math.min(i, respostas.length - 1)]; i += 1;
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.dados };
  };
  f.chamadas = chamadas;
  return f;
}

/* ---- cobranca Pix ---- */

test('cobranca Pix devolve QR e payload prontos pra tela', async () => {
  const f = fetchFalso([{ dados: {
    id: 123, status: 'pending', transaction_amount: 189, external_reference: 'plano-prata',
    payment_method_id: 'pix', date_created: '2026-09-21T10:00:00Z',
    point_of_interaction: { transaction_data: { qr_code: '000201...', qr_code_base64: 'iVBOR...' } },
  } }]);
  const g = criarGateway({ apiKey: 'token', fetchImpl: f });
  const r = await g.criarCobranca({ valorCentavos: 18900, metodo: 'PIX', descricao: 'Combo Prata', referencia: 'plano-prata' });

  assert.equal(r.ok, true);
  assert.equal(r.pagamento.estado, 'PENDENTE');
  assert.equal(r.pagamento.valorCentavos, 18900, 'reais do MP tem de voltar em centavos');
  assert.equal(r.pagamento.pix.payload, '000201...');
  assert.equal(r.pagamento.pix.imagemBase64, 'iVBOR...');
  assert.match(f.chamadas[0].url, /\/v1\/payments$/);
  assert.equal(f.chamadas[0].corpo.transaction_amount, 189, 'o MP cobra em reais, nao centavos');
});

test('a cobranca vai com chave de idempotencia — reentrega nao vira duas cobrancas', async () => {
  const f = fetchFalso([{ dados: { id: 1, status: 'pending', transaction_amount: 10 } }]);
  await criarGateway({ apiKey: 't', fetchImpl: f }).criarCobranca({ valorCentavos: 1000, referencia: 'ref-unica' });
  assert.equal(f.chamadas[0].headers['X-Idempotency-Key'], 'ref-unica');
});

test('cartao vira preferencia de checkout, nao pagamento direto', async () => {
  const f = fetchFalso([{ dados: { id: 'pref-9', init_point: 'https://mp/checkout/pref-9' } }]);
  const r = await criarGateway({ apiKey: 't', fetchImpl: f })
    .criarCobranca({ valorCentavos: 12900, metodo: 'CREDIT_CARD', descricao: 'Prata' });
  assert.equal(r.ok, true);
  assert.match(f.chamadas[0].url, /checkout\/preferences/);
  assert.equal(r.pagamento.linkPagamento, 'https://mp/checkout/pref-9');
  assert.equal(r.pagamento.estado, 'CRIADO');
});

test('forma invalida e valor zerado sao recusados antes de sair chamada', async () => {
  const f = fetchFalso([]);
  const g = criarGateway({ apiKey: 't', fetchImpl: f });
  assert.match((await g.criarCobranca({ valorCentavos: 100, metodo: 'CHEQUE' })).motivo, /inválida/);
  assert.match((await g.criarCobranca({ valorCentavos: 0 })).motivo, /valor/);
  assert.equal(f.chamadas.length, 0, 'nao pode ter chamado o MP');
});

test('sem Access Token nao tenta a rede — diz o que falta', async () => {
  const f = fetchFalso([]);
  const r = await criarGateway({ fetchImpl: f }).criarCobranca({ valorCentavos: 100 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Access Token/);
  assert.equal(f.chamadas.length, 0);
});

/* ---- traducao de estado: onde mora o prejuizo ---- */

test('"em revisao" NAO e pago — liberar mercadoria ai e prejuizo', () => {
  assert.equal(ESTADO_MP.in_process, 'PENDENTE');
  assert.equal(ESTADO_MP.authorized, 'PENDENTE', 'autorizado ainda nao e capturado');
  assert.equal(ESTADO_MP.approved, 'CONFIRMADO');
  assert.equal(ESTADO_MP.rejected, 'CANCELADO');
  assert.equal(ESTADO_MP.charged_back, 'CHARGEBACK');
  assert.equal(ESTADO_MP.refunded, 'ESTORNADO');
});

test('estado desconhecido cai em PENDENTE, nunca em CONFIRMADO', async () => {
  const f = fetchFalso([{ dados: { id: 7, status: 'status_que_nao_existe', transaction_amount: 10 } }]);
  const r = await criarGateway({ apiKey: 't', fetchImpl: f }).consultarCobranca(7);
  assert.equal(r.pagamento.estado, 'PENDENTE');
});

test('erro do MP vira frase em portugues, nao json cru', async () => {
  const f = fetchFalso([{ ok: false, status: 401, dados: { message: 'invalid token' } }]);
  const r = await criarGateway({ apiKey: 'errado', fetchImpl: f }).criarCobranca({ valorCentavos: 100 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Access Token.*inválido|vencido/);
});

/* ---- webhook: a porta que um forjador tentaria ---- */

const assinar = (segredo, { id, requestId, ts }) =>
  createHmac('sha256', segredo).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');

test('assinatura correta passa', () => {
  const v1 = assinar('segredo', { id: '123', requestId: 'req-1', ts: '1700000000' });
  const r = validarWebhook(
    { 'x-signature': `ts=1700000000,v1=${v1}`, 'x-request-id': 'req-1' },
    { 'data.id': '123' }, 'segredo');
  assert.equal(r.ok, true);
  assert.equal(r.conferida, true);
});

test('assinatura de outro segredo e RECUSADA', () => {
  const v1 = assinar('outro', { id: '123', requestId: 'req-1', ts: '1700000000' });
  const r = validarWebhook({ 'x-signature': `ts=1700000000,v1=${v1}`, 'x-request-id': 'req-1' }, { 'data.id': '123' }, 'segredo');
  assert.equal(r.ok, false);
});

test('trocar o id do pagamento invalida a assinatura', () => {
  const v1 = assinar('segredo', { id: '123', requestId: 'req-1', ts: '1700000000' });
  const r = validarWebhook({ 'x-signature': `ts=1700000000,v1=${v1}`, 'x-request-id': 'req-1' }, { 'data.id': '999' }, 'segredo');
  assert.equal(r.ok, false, 'o manifesto inclui o id — trocar tem de reprovar');
});

test('x-signature ausente ou fora do formato e recusado', () => {
  assert.equal(validarWebhook({}, {}, 'segredo').ok, false);
  assert.match(validarWebhook({ 'x-signature': 'lixo' }, {}, 'segredo').motivo, /formato/);
});

test('sem segredo configurado a rota atende mas AVISA que nao conferiu', () => {
  const r = validarWebhook({}, {}, '');
  assert.equal(r.ok, true);
  assert.equal(r.conferida, false);
  assert.match(r.motivo, /MP_WEBHOOK_SECRET/);
});

/* ---- o que o MP NAO faz ---- */

test('subconta, saldo e transferencia dizem que nao dao — em vez de fingir', async () => {
  const g = criarGateway({ apiKey: 't', fetchImpl: fetchFalso([]) });
  for (const m of ['criarSubconta', 'consultarSubconta', 'saldo', 'transferir']) {
    const r = await g[m]({});
    assert.equal(r.ok, false, m);
    assert.match(r.motivo, /Mercado Pago não faz/);
  }
});

test('criarCliente nao inventa id — diz que o pagador vai na cobranca', async () => {
  const r = await criarGateway({ apiKey: 't', fetchImpl: fetchFalso([]) }).criarCliente({ email: 'a@b.c' });
  assert.equal(r.ok, true);
  assert.equal(r.cliente.id, null, 'inventar id faria o modulo gravar uma referencia falsa');
  assert.match(r.aviso, /não exige cliente/);
});

/* ---- webhook do MP no formato do modulo ---- */

import { traduzirEvento } from '../engine/vspagamentos/estados.mjs';

test('o webhook do MP nao traz estado — ele manda BUSCAR', () => {
  const ev = traduzirEvento({ type: 'payment', action: 'payment.updated', data: { id: '123' } }, { provedor: 'mercadopago' });
  assert.equal(ev.conhecido, true);
  assert.equal(ev.cobrancaId, '123');
  assert.equal(ev.estado, null, 'inventar estado aqui seria adivinhar o que so a consulta responde');
  assert.equal(ev.precisaConsultar, true);
});

test('a chave de idempotencia do MP junta tipo, id e acao', () => {
  const a = traduzirEvento({ type: 'payment', action: 'payment.created', data: { id: '9' } }, { provedor: 'mercadopago' });
  const b = traduzirEvento({ type: 'payment', action: 'payment.updated', data: { id: '9' } }, { provedor: 'mercadopago' });
  assert.notEqual(a.eventoId, b.eventoId, 'criado e atualizado sao eventos diferentes do mesmo pagamento');
});

test('evento do MP sem id nao passa — sem id nao ha idempotencia', () => {
  assert.equal(traduzirEvento({ type: 'payment' }, { provedor: 'mercadopago' }).eventoId, null);
});

test('o formato do Asaas continua funcionando como antes', () => {
  const ev = traduzirEvento({ id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', value: 189 } });
  assert.equal(ev.eventoId, 'evt_1');
  assert.equal(ev.cobrancaId, 'pay_1');
  assert.equal(ev.valorCentavos, 18900);
});

/* ---- o que a conta de teste revelou ----
   `/v1/payments` (Pix direto, QR na hora) exige a conta habilitada. Conta de
   teste e boa parte das novas recebem 401 "Unauthorized use of live
   credentials". Falhar ali seria desistir de cobrar por um detalhe de conta —
   a saida e o Checkout, que a MESMA credencial cria sem reclamar. */

test('Pix negado por conta nao habilitada cai no Checkout, em vez de falhar', async () => {
  const f = fetchFalso([
    { ok: false, status: 401, dados: { message: 'Unauthorized use of live credentials', cause: [{ code: 7 }] } },
    { dados: { id: 'pref-77', init_point: 'https://mp/checkout/pref-77' } },
  ]);
  const r = await criarGateway({ apiKey: 't', fetchImpl: f }).criarCobranca({ valorCentavos: 18900, metodo: 'PIX' });
  assert.equal(r.ok, true);
  assert.equal(r.viaCheckout, true);
  assert.equal(r.pagamento.linkPagamento, 'https://mp/checkout/pref-77');
  assert.match(r.pagamento.aviso, /não gera o QR do Pix direto/);
  assert.match(f.chamadas[0].url, /\/v1\/payments$/, 'tentou o direto primeiro');
  assert.match(f.chamadas[1].url, /checkout\/preferences/, 'e so entao caiu no checkout');
});

test('o checkout de Pix exclui cartao — senao abre o menu inteiro', async () => {
  const f = fetchFalso([
    { ok: false, status: 401, dados: { message: 'Unauthorized use of live credentials' } },
    { dados: { id: 'pref-1', init_point: 'https://mp/x' } },
  ]);
  await criarGateway({ apiKey: 't', fetchImpl: f }).criarCobranca({ valorCentavos: 1000, metodo: 'PIX' });
  const tipos = f.chamadas[1].corpo.payment_methods.excluded_payment_types.map((x) => x.id);
  assert.deepEqual(tipos.sort(), ['credit_card', 'debit_card', 'ticket']);
});

test('erro que NAO e de permissao continua falhando — nao mascara problema real', async () => {
  const f = fetchFalso([{ ok: false, status: 400, dados: { message: 'invalid transaction_amount' } }]);
  const r = await criarGateway({ apiKey: 't', fetchImpl: f }).criarCobranca({ valorCentavos: 1000, metodo: 'PIX' });
  assert.equal(r.ok, false, 'cair no checkout aqui esconderia um bug nosso');
  assert.equal(f.chamadas.length, 1);
});

/* ---- o webhook que BUSCA o estado ----
   O MP nao diz o que aconteceu: ele avisa "mexeu no pagamento X". Se o modulo
   parasse ai, pagamento aprovado nunca viraria lancamento no caixa — que e o
   unico motivo de existir este webhook. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirPag = mkdtempSync(join(tmpdir(), 'mp-webhook-'));
process.env.VSPAGAMENTOS_DIR = dirPag;
process.env.MP_ACCESS_TOKEN_TESTE = 'token-de-teste';
process.env.MP_WEBHOOK_SECRET = 'segredo-do-teste';
const P = await import('../engine/vspagamentos/index.mjs');
test.after(() => rmSync(dirPag, { recursive: true, force: true }));

const assinarPara = (id, reqId, ts) =>
  createHmac('sha256', 'segredo-do-teste').update(`id:${id};request-id:${reqId};ts:${ts};`).digest('hex');

test('webhook do MP consulta o pagamento e usa o estado que voltou', async () => {
  P.configurar({ provedor: 'mercadopago', modelo: 'direto' });
  const ts = '1700000000';
  const v1 = assinarPara('555', 'req-a', ts);
  const consultado = { id: 555, status: 'approved', transaction_amount: 189,
    transaction_details: { net_received_amount: 180 } };

  const r = await P.processarWebhook(
    { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-a' },
    { type: 'payment', action: 'payment.updated', data: { id: '555' } },
    { query: { 'data.id': '555' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => consultado }) },
  );
  // A cobranca nao e nossa (nao foi criada por aqui), mas o estado TEM de ter
  // sido descoberto — e o que prova que a consulta aconteceu.
  assert.equal(r.http, 200);
  assert.equal(r.orfao, true, 'nao criamos esta cobranca aqui');
  assert.notEqual(r.motivo, '"payment" não muda o estado do pagamento');
});

test('se a consulta falhar, o evento NAO e dado por processado', async () => {
  const ts = '1700000001';
  const v1 = assinarPara('777', 'req-b', ts);
  const r = await P.processarWebhook(
    { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-b' },
    { type: 'payment', action: 'payment.updated', data: { id: '777' } },
    { query: { 'data.id': '777' }, fetchImpl: async () => { throw new Error('rede caiu'); } },
  );
  assert.equal(r.ok, false);
  assert.equal(r.podeReentregar, true, 'o MP tem de poder tentar de novo');
  assert.match(r.motivo, /não consegui consultar/);
});

test('pagamento inexistente (404) encerra o evento — nao pede reentrega eterna', async () => {
  const ts = '1700000002';
  const v1 = assinarPara('888', 'req-c', ts);
  const r = await P.processarWebhook(
    { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-c' },
    { type: 'payment', action: 'payment.updated', data: { id: '888' } },
    { query: { 'data.id': '888' },
      fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ message: 'not found' }) }) },
  );
  assert.equal(r.http, 200, '404 nao melhora com o tempo: reentregar seria batida eterna na porta');
  assert.equal(r.orfao, true);
  assert.notEqual(r.podeReentregar, true);
});

/* ---- teste e producao lado a lado ----

   No painel do Mercado Pago, modo de teste e modo de producao sao dois
   cadastros, cada um com o SEU segredo de assinatura. Um segredo so, servindo
   aos dois, faz o pior tipo de falha: o aviso do pagamento de VERDADE chega,
   nao confere, leva 401 — e o dinheiro entra na conta sem virar lancamento
   aqui. O caminho da URL e quem diz de qual ambiente veio o aviso. */

test('o segredo de assinatura sai POR AMBIENTE, com o unico como reserva', () => {
  const antes = { ...process.env };
  process.env.MP_WEBHOOK_SECRET_TESTE = 'segredo-t';
  process.env.MP_WEBHOOK_SECRET_PRODUCAO = 'segredo-p';
  assert.equal(P.credenciaisMercadoPago({ mpAmbiente: 'teste' }).segredo, 'segredo-t');
  assert.equal(P.credenciaisMercadoPago({ mpAmbiente: 'producao' }).segredo, 'segredo-p');

  delete process.env.MP_WEBHOOK_SECRET_PRODUCAO;
  assert.equal(P.credenciaisMercadoPago({ mpAmbiente: 'producao' }).segredo, 'segredo-do-teste',
    'sem o de producao, cai no unico — quem ja configurou so ele nao pode quebrar');
  process.env = antes;
});

test('aviso de PRODUCAO assinado com o segredo de producao e RECUSADO no caminho de teste', async () => {
  const antes = { ...process.env };
  process.env.MP_WEBHOOK_SECRET_PRODUCAO = 'segredo-de-producao';
  const ts = '1700000010';
  const v1 = createHmac('sha256', 'segredo-de-producao').update(`id:901;request-id:req-p;ts:${ts};`).digest('hex');
  const cabecalho = { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-p' };
  const corpo = { type: 'payment', action: 'payment.updated', data: { id: '901' } };

  const noTeste = await P.processarWebhook(cabecalho, corpo, { query: { 'data.id': '901' } });
  assert.equal(noTeste.http, 401, 'conferir com o segredo do outro ambiente e o mesmo que nao conferir');
  process.env = antes;
});

test('no caminho de producao, o aviso vale E a consulta vai na conta de producao', async () => {
  const antes = { ...process.env };
  process.env.MP_WEBHOOK_SECRET_PRODUCAO = 'segredo-de-producao';
  process.env.MP_ACCESS_TOKEN = 'token-de-PRODUCAO';
  const ts = '1700000011';
  const v1 = createHmac('sha256', 'segredo-de-producao').update(`id:902;request-id:req-q;ts:${ts};`).digest('hex');

  let autorizacao = null;
  const r = await P.processarWebhook(
    { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-q' },
    { type: 'payment', action: 'payment.updated', data: { id: '902' } },
    { query: { 'data.id': '902' },
      mpAmbiente: 'producao',
      fetchImpl: async (url, opts) => {
        autorizacao = opts.headers.authorization;
        return { ok: true, status: 200, json: async () => ({ id: 902, status: 'approved', transaction_amount: 50 }) };
      } },
  );
  assert.notEqual(r.http, 401, 'com o segredo do ambiente certo, a assinatura confere');
  assert.equal(autorizacao, 'Bearer token-de-PRODUCAO',
    'consultar com a chave de teste acharia 404 e marcaria orfao um pagamento REAL');
  process.env = antes;
});
