/**
 * Recebimento DIRETO — a empresa cobrando do próprio cliente.
 *
 * O módulo nasceu pro marketplace, onde sempre há um prestador. Cobrar a própria
 * mensalidade caía na validação de split e exigia inventar um percentual de
 * terceiro só pra emitir um Pix. Número inventado em cobrança é o começo de uma
 * conciliação errada — daí o modelo `direto`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vspag-'));
process.env.VSPAGAMENTOS_DIR = dir;
const P = await import('../engine/vspagamentos/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const CHAVE = '$aact_chave_falsa_de_teste_nunca_vai_a_rede';
const TOKEN = 'token-de-webhook-com-32-caracteres!';

/** Gateway de mentira: devolve o que o Asaas devolveria, sem rede. */
function fakeFetch(resposta = { id: 'pay_teste', invoiceUrl: 'https://asaas/i/1' }) {
  const chamadas = [];
  const f = async (url, opts) => {
    chamadas.push({ url, corpo: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => resposta, text: async () => JSON.stringify(resposta) };
  };
  f.chamadas = chamadas;
  return f;
}

test('modelo direto dispensa percentual e base — eles nao existem no caso', () => {
  const r = P.configurar({ modelo: 'direto', ambiente: 'sandbox', apiKey: CHAVE, webhookToken: TOKEN });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  const d = P.diagnostico();
  assert.equal(d.pronto, true, 'faltando: ' + d.faltando.join('; '));
  assert.equal(d.divideComTerceiro, false);
  assert.deepEqual(d.faltando, []);
});

test('a chave nunca volta em claro no diagnostico', () => {
  const d = P.diagnostico();
  assert.notEqual(d.apiKey, CHAVE);
  assert.match(d.apiKey, /\*/);
  assert.notEqual(d.webhookToken, TOKEN);
});

test('cobranca direta vai ao gateway SEM bloco de split', async () => {
  const f = fakeFetch();
  const r = await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 19900, descricao: 'Mensalidade' }, { fetchImpl: f });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.pagamento.split, null, 'split zerado sugeriria repasse de zero pra alguem; aqui nao ha alguem');
  assert.equal(r.pagamento.valorCentavos, 19900);
  assert.equal(r.pagamento.linkPagamento, 'https://asaas/i/1');
  const corpo = f.chamadas.at(-1).corpo;
  assert.equal(corpo.split, undefined, 'mandar split vazio pro Asaas e pedir erro');
  assert.equal(corpo.value, 199, 'centavos viram reais na borda do gateway');
});

test('valor invalido e recusado antes de sair pra rede', async () => {
  const f = fakeFetch();
  for (const v of [0, -100, 1.5, 'abc', null]) {
    const r = await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: v }, { fetchImpl: f });
    assert.equal(r.ok, false, `aceitou valor ${v}`);
  }
  assert.equal(f.chamadas.length, 0, 'nenhuma chamada deveria ter saido');
});

test('repasse no modelo direto diz o motivo certo, nao "split nao fechado"', () => {
  const pg = P.listar().at(-1);
  const r = P.podeRepassar({ ...pg, estado: 'DISPONIVEL' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nao ha terceiro|não há terceiro/);
});

test('split e custodia continuam exigindo percentual e base', () => {
  P.configurar({ modelo: 'split', percentualPrestador: null, baseSplit: null });
  const d = P.diagnostico();
  assert.equal(d.pronto, false);
  assert.equal(d.divideComTerceiro, true);
  assert.equal(d.faltando.length, 2, d.faltando.join('; '));
});

test('custodia continua exigindo o reconhecimento do juridico', () => {
  const r = P.configurar({ modelo: 'custodia' });
  assert.equal(r.ok, false);
  assert.match(r.erros.join(' '), /juridico|jurídico/i);
});

/* ---- cliente e QR do Pix: as duas pontas que faltavam pra cobrar de alguem ---- */

/** Gateway de mentira com resposta por rota — o fluxo real toca 3 endpoints. */
function fakePorRota(mapa) {
  const chamadas = [];
  const f = async (url, opts) => {
    chamadas.push({ url, metodo: opts?.method || 'GET', corpo: opts?.body ? JSON.parse(opts.body) : null });
    const achou = Object.keys(mapa).find((k) => url.includes(k));
    const r = achou ? mapa[achou] : {};
    return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r) };
  };
  f.chamadas = chamadas;
  return f;
}

test('cliente ja cadastrado e REUSADO — nao duplica no extrato do Asaas', async () => {
  P.configurar({ modelo: 'direto', ambiente: 'sandbox', apiKey: CHAVE, webhookToken: TOKEN });
  const f = fakePorRota({ '/customers': { data: [{ id: 'cus_ja_existe' }] } });
  const r = await P.garantirCliente({ nome: 'Fulano', cpfCnpj: '123.456.789-09' }, { fetchImpl: f });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.clienteId, 'cus_ja_existe');
  assert.equal(r.reusado, true);
  assert.equal(f.chamadas.length, 1, 'achou na busca, nao deveria ter criado');
  assert.match(f.chamadas[0].url, /cpfCnpj=12345678909/, 'o documento vai sem pontuacao');
});

test('cliente novo e criado quando a busca nao acha', async () => {
  const f = fakePorRota({ '/customers?': { data: [] }, '/customers': { id: 'cus_novo' } });
  const r = await P.garantirCliente({ nome: 'Ciclano', cpfCnpj: '98765432100', email: 'c@x.com' }, { fetchImpl: f });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.clienteId, 'cus_novo');
  assert.equal(r.reusado, false);
  assert.equal(f.chamadas.at(-1).corpo.cpfCnpj, '98765432100', 'pontuacao some antes de sair');
});

test('cliente sem documento e recusado — o Asaas exige e recusa na criacao', async () => {
  const f = fakePorRota({ '/customers?': { data: [] } });
  const r = await P.garantirCliente({ nome: 'Sem Documento' }, { fetchImpl: f });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /cpfCnpj|documento/i);
});

test('QR do Pix e buscado uma vez e guardado — reabrir a tela nao bate no Asaas', async () => {
  const f1 = fakePorRota({ '/payments': { id: 'pay_qr', invoiceUrl: 'https://asaas/i/qr' } });
  const c = await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 5000 }, { fetchImpl: f1 });
  assert.equal(c.ok, true, c.motivo);

  const f2 = fakePorRota({ '/pixQrCode': { payload: '00020126...br.gov.bcb.pix', encodedImage: 'iVBORw0KGgo=', expirationDate: '2026-09-20 12:00:00' } });
  const q1 = await P.qrPix(c.pagamento.id, { fetchImpl: f2 });
  assert.equal(q1.ok, true, q1.motivo);
  assert.equal(q1.doCache, false);
  assert.match(q1.pix.payload, /br\.gov\.bcb\.pix/);
  assert.equal(q1.pix.imagemBase64, 'iVBORw0KGgo=');

  const f3 = fakePorRota({});
  const q2 = await P.qrPix(c.pagamento.id, { fetchImpl: f3 });
  assert.equal(q2.doCache, true, 'segunda leitura tem que vir do disco');
  assert.equal(f3.chamadas.length, 0, 'nenhuma chamada nova ao Asaas');
});

test('QR sem copia-e-cola e tratado como falha — QR so de imagem nao serve no celular', async () => {
  const f1 = fakePorRota({ '/payments': { id: 'pay_sem_payload' } });
  const c = await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 3000 }, { fetchImpl: f1 });
  const f2 = fakePorRota({ '/pixQrCode': { encodedImage: 'iVBORw0KGgo=' } });
  const q = await P.qrPix(c.pagamento.id, { fetchImpl: f2 });
  assert.equal(q.ok, false);
  assert.match(q.motivo, /copia-e-cola|copia e cola/i);
});

test('cobranca sem data de vencimento nao e recusada pelo Asaas — vai com hoje', async () => {
  const f = fakePorRota({ '/payments': { id: 'pay_sem_data', dueDate: '2026-09-19' } });
  const r = await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 1000 }, { fetchImpl: f });
  assert.equal(r.ok, true, r.motivo);
  const corpo = f.chamadas.at(-1).corpo;
  assert.match(corpo.dueDate, /^\d{4}-\d{2}-\d{2}$/, 'o Asaas recusa sem dueDate, inclusive em Pix');
  assert.equal(r.pagamento.vencimento, '2026-09-19', 'a data que VALEU e a que o gateway devolveu');
});

test('data informada manda — o default nao atropela quem escolheu', async () => {
  const f = fakePorRota({ '/payments': { id: 'pay_com_data', dueDate: '2026-12-01' } });
  await P.cobrar({ clienteId: 'cus_1', metodo: 'BOLETO', valorCentavos: 1000, vencimento: '2026-12-01' }, { fetchImpl: f });
  assert.equal(f.chamadas.at(-1).corpo.dueDate, '2026-12-01');
});

/* ---- webhook: o evento recusado NAO pode matar a reentrega ---- */

const ev = (id, evento, cobranca, extra = {}) => ({ id, event: evento, payment: { id: cobranca, ...extra } });
const HEAD = { 'asaas-access-token': TOKEN };

test('Pix recebido confirma mesmo chegando direto em CRIADO', async () => {
  P.configurar({ modelo: 'direto', ambiente: 'sandbox', apiKey: CHAVE, webhookToken: TOKEN });
  const f = fakePorRota({ '/payments': { id: 'pay_pix_direto' } });
  await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 19990 }, { fetchImpl: f });

  const r = await P.processarWebhook(HEAD, ev('evt_pix_1', 'PAYMENT_RECEIVED', 'pay_pix_direto', { value: 199.9, netValue: 198.91 }));
  assert.equal(r.ok, true, r.motivo);
  assert.equal(P.obter('pay_pix_direto').estado, 'DISPONIVEL');
});

test('evento RECUSADO nao entra na lista de vistos — a reentrega ainda salva', async () => {
  const f = fakePorRota({ '/payments': { id: 'pay_fora_de_ordem' } });
  await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 5000 }, { fetchImpl: f });
  await P.processarWebhook(HEAD, ev('evt_cancela', 'PAYMENT_DELETED', 'pay_fora_de_ordem'));
  assert.equal(P.obter('pay_fora_de_ordem').estado, 'CANCELADO');

  // Estado final: este evento nao cabe. O Asaas vai reentregar.
  const r1 = await P.processarWebhook(HEAD, ev('evt_atrasado', 'PAYMENT_RECEIVED', 'pay_fora_de_ordem'));
  assert.equal(r1.ok, false);
  assert.equal(r1.http, 200, '4xx repetido PAUSA a fila do Asaas depois de 15 falhas');
  assert.equal(r1.podeReentregar, true);

  const r2 = await P.processarWebhook(HEAD, ev('evt_atrasado', 'PAYMENT_RECEIVED', 'pay_fora_de_ordem'));
  assert.notEqual(r2.duplicado, true, 'marcar o recusado como processado matava a unica chance de recuperar');
});

test('o recusado aparece no painel — dinheiro que entrou e a tela pode nao saber', () => {
  const rec = P.painel().recusados;
  assert.ok(rec.length >= 1);
  assert.equal(rec[0].cobrancaId, 'pay_fora_de_ordem');
  assert.match(rec[0].motivo, /CANCELADO/);
});

test('duplicata de evento que DEU CERTO continua sendo ignorada', async () => {
  const f = fakePorRota({ '/payments': { id: 'pay_dup' } });
  await P.cobrar({ clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 1000 }, { fetchImpl: f });
  const a = await P.processarWebhook(HEAD, ev('evt_dup', 'PAYMENT_RECEIVED', 'pay_dup'));
  assert.equal(a.ok, true);
  const b = await P.processarWebhook(HEAD, ev('evt_dup', 'PAYMENT_RECEIVED', 'pay_dup'));
  assert.equal(b.duplicado, true);
});

test('token forjado nao move nada', async () => {
  const r = await P.processarWebhook({ 'asaas-access-token': 'token-de-invasor-com-32-caracter' }, ev('evt_x', 'PAYMENT_RECEIVED', 'pay_dup'));
  assert.equal(r.ok, false);
  assert.equal(r.http, 401);
});
