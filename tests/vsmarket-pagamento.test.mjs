import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dividir, podeRepassar, podeIr, validarGateway, LIBERA_REPASSE } from '../engine/vsmarket/pagamento.mjs';
import { criarSimulado } from '../marketplace/gateway-simulado.mjs';
import { criarAsaas, tokenConfere, EVENTOS } from '../marketplace/gateway-asaas.mjs';

const dir = mkdtempSync(join(tmpdir(), 'qg-pag-'));
process.env.VSMARKET_DIR = dir;
const vs = await import('../engine/vsmarket/index.mjs');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/* ── divisão ── */

test('o split fecha exatamente — nao cria nem some centavo', () => {
  for (const bruto of [10000, 3333, 999, 20501, 1]) {
    const r = dividir(bruto, 80);
    if (!r.ok) { continue; }
    assert.equal(r.split.prestadorCentavos + r.split.plataformaCentavos, bruto, 'quebrou em ' + bruto);
  }
});

test('percentual NAO tem default — 80/20 é hipotese comercial', () => {
  assert.equal(dividir(10000, undefined).ok, false);
  assert.equal(dividir(10000, 0).ok, false);
  assert.equal(dividir(10000, 100).ok, false);
  assert.equal(dividir(10000, 80).ok, true);
});

test('com liquido informado, divide sobre o que SOBROU da taxa', () => {
  const r = dividir(10000, 80, 9800);
  assert.equal(r.split.prestadorCentavos, 7840);
  assert.equal(r.split.taxaGatewayCentavos, 200);
  assert.equal(r.split.prestadorCentavos + r.split.plataformaCentavos, 9800);
});

/* ── estados e repasse ── */

test('CONFIRMADO nao libera repasse; so DISPONIVEL', () => {
  assert.deepEqual(LIBERA_REPASSE, ['DISPONIVEL']);
  const r = podeRepassar({ estado: 'CONFIRMADO', split: { prestadorCentavos: 100 } });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /ainda NÃO liquidou/);
  assert.equal(podeRepassar({ estado: 'DISPONIVEL', split: { prestadorCentavos: 100 } }).ok, true);
});

test('contestacao aberta segura o repasse mesmo com dinheiro liquidado', () => {
  const r = podeRepassar({ estado: 'DISPONIVEL', split: { prestadorCentavos: 100 } }, { disputaAberta: true });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /contestação aberta/);
});

test('repasse nao acontece duas vezes', () => {
  assert.match(podeRepassar({ estado: 'DISPONIVEL', repassado: true }).motivo, /já foi repassado/);
});

test('estado nao pula de CRIADO para DISPONIVEL', () => {
  assert.equal(podeIr('CRIADO', 'DISPONIVEL').ok, false);
  assert.equal(podeIr('CONFIRMADO', 'DISPONIVEL').ok, true);
});

/* ── contrato do provedor ── */

test('provedor que nao cumpre o contrato é recusado ANTES de cobrar', () => {
  assert.match(validarGateway(null).motivo, /nenhum provedor/);
  assert.match(validarGateway({ nome: 'meia-boca' }).motivo, /não implementa: garantirCliente, criarCobranca/);
  assert.equal(validarGateway(criarSimulado()).ok, true);
  assert.equal(validarGateway(criarAsaas({ apiKey: 'x' })).ok, true);
});

/* ── Asaas ── */

test('Asaas: CONFIRMED e RECEIVED sao estados DIFERENTES', () => {
  assert.equal(EVENTOS.PAYMENT_CONFIRMED, 'CONFIRMADO');
  assert.equal(EVENTOS.PAYMENT_RECEIVED, 'DISPONIVEL');
});

test('Asaas: token do webhook comparado em tempo constante, tamanho confere antes', () => {
  const t = 'x'.repeat(40);
  assert.equal(tokenConfere(t, t), true);
  assert.equal(tokenConfere('x'.repeat(39), t), false);
  assert.equal(tokenConfere(t, ''), false);
});

test('Asaas: SEM token configurado o webhook é RECUSADO — nao é modo permissivo', () => {
  const g = criarAsaas({ apiKey: 'k' });
  const r = g.validarWebhook({ 'asaas-access-token': 'qualquer' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /aceitaria evento forjado/);
});

test('Asaas: split vai como VALOR FIXO — percentual incidiria sobre o netValue', async () => {
  let corpo = null;
  const g = criarAsaas({
    apiKey: 'k',
    fetchImpl: async (u, o) => { corpo = JSON.parse(o.body); return { status: 200, json: async () => ({ id: 'pay_1', status: 'CONFIRMED', netValue: 98 }) }; },
  });
  await g.criarCobranca({ metodo: 'PIX', valorCentavos: 10000, prestadorCentavos: 8000, walletIdPrestador: 'w1', clienteExternoId: 'c1' });
  assert.deepEqual(corpo.split, [{ walletId: 'w1', fixedValue: 80 }]);
  assert.equal(corpo.value, 100, 'centavos viram decimal so na borda');
});

test('Asaas: evento desconhecido nao move dinheiro', () => {
  const g = criarAsaas({ apiKey: 'k' });
  const t = g.traduzirEvento({ id: 'e1', event: 'PAYMENT_INVENTADO' });
  assert.equal(t.conhecido, false);
  assert.equal(t.estado, null);
});

/* ── fluxo com provedor injetado ── */

/** O provedor exige saber quem paga — e o documento so aparece na hora de pagar. */
const PAGADOR = { id: 'cli_teste', nome: 'Maria Souza', telefone: '5531988887777', documento: '11144477735' };

async function contratar() {
  vs.semear();
  const ps = vs.prestadores();
  const p = vs.fluxo.criarPedido({
    categoria: 'eletrica', descricao: 'A tomada do quarto parou de funcionar de vez.',
    lat: -19.9245, lng: -43.9352, cidade: 'Belo Horizonte',
  }, ps);
  vs.fluxo.simularPropostas(p.pedido.id, ps, vs.categorias());
  const lista = vs.fluxo.propostasDoPedido(p.pedido.id, ps);
  vs.fluxo.escolherProposta(lista.cards[0].id, ps);
  vs.fluxo.aceitarProposta(lista.cards[0].id);
  const e = vs.fluxo.congelarEscopo(lista.cards[0].id);
  vs.fluxo.aceitarEscopo(e.escopo.id, 'cliente');
  vs.fluxo.aceitarEscopo(e.escopo.id, 'prestador');
  return e.escopo;
}

test('pagar SEM provedor é recusado — nada de cobrar no escuro', async () => {
  const escopo = await contratar();
  const r = await vs.fluxo.pagar(escopo.id, { metodo: 'PIX', percentualPrestador: 80, cliente: PAGADOR }, null);
  assert.equal(r.ok, false);
  assert.match(r.erro, /nenhum provedor/);
});

test('pagar pelo provedor injetado grava o split que VALEU', async () => {
  const escopo = await contratar();
  const r = await vs.fluxo.pagar(escopo.id, { metodo: 'PIX', percentualPrestador: 70, cliente: PAGADOR }, criarSimulado());
  assert.equal(r.ok, true);
  assert.equal(r.pagamento.provedor, 'simulado');
  assert.equal(r.pagamento.percentualPrestador, 70);
  assert.equal(r.pagamento.prestadorCentavos + r.pagamento.plataformaCentavos, r.pagamento.valorCentavos);
  assert.equal(r.ordem.status, 'PAID');
});

test('repasse é BLOQUEADO enquanto o dinheiro nao liquida', async () => {
  const pg = vs.fluxo.pagamentos().at(-1);
  assert.equal(pg.estado, 'CONFIRMADO');
  const r = vs.fluxo.repassar(pg.id);
  assert.equal(r.ok, false);
  assert.match(r.erro, /ainda NÃO liquidou/);
});

test('evento de liquidacao libera o repasse, e reentrega NAO duplica', () => {
  const pg = vs.fluxo.pagamentos().at(-1);
  const ev = { conhecido: true, estado: 'DISPONIVEL', eventoId: 'evt_unico', cobrancaId: pg.externoId };
  const a = vs.fluxo.aplicarEventoPagamento(ev);
  assert.equal(a.estado, 'DISPONIVEL');
  const b = vs.fluxo.aplicarEventoPagamento(ev);
  assert.equal(b.duplicado, true, 'reentrega tem que ser ignorada — a entrega é at-least-once');
  assert.equal(b.http, 200, 'e responder 200, senao a fila do provedor pausa');

  const r = vs.fluxo.repassar(pg.id);
  assert.equal(r.ok, true);
  assert.equal(vs.fluxo.repassar(pg.id).ok, false, 'nao repassa duas vezes');
});

test('evento de cobranca que nao é nossa responde 200 sem quebrar', () => {
  const r = vs.fluxo.aplicarEventoPagamento({ conhecido: true, estado: 'DISPONIVEL', eventoId: 'e_orfao', cobrancaId: 'de_outro' });
  assert.equal(r.http, 200);
  assert.equal(r.orfao, true);
});

test('evento sem id é recusado — sem ele nao ha idempotencia', () => {
  const r = vs.fluxo.aplicarEventoPagamento({ conhecido: true, estado: 'DISPONIVEL', cobrancaId: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.http, 400);
});


test('pagar sem saber QUEM paga é recusado — o provedor exige um pagador', async () => {
  const escopo = await contratar();
  const r = await vs.fluxo.pagar(escopo.id, { metodo: 'PIX', percentualPrestador: 80 }, criarSimulado());
  assert.equal(r.ok, false);
  assert.match(r.erro, /não sei quem é o pagador/);
});

test('sem CPF/CNPJ a cobranca é recusada com aviso especifico, nao erro generico', async () => {
  const escopo = await contratar();
  const r = await vs.fluxo.pagar(escopo.id, {
    metodo: 'PIX', percentualPrestador: 80,
    cliente: { id: 'c1', nome: 'Sem Documento', telefone: '5531988887777' },
  }, criarSimulado());
  assert.equal(r.ok, false);
  assert.equal(r.pedeDocumento, true, 'a tela precisa saber que é so o documento que falta');
  assert.match(r.erro, /exige CPF ou CNPJ/);
});

test('o documento NAO fica guardado por nos — so a referencia do provedor', async () => {
  const escopo = await contratar();
  let vinculado = null;
  const r = await vs.fluxo.pagar(escopo.id, {
    metodo: 'PIX', percentualPrestador: 80, cliente: { id: 'c2', nome: 'Maria' },
    documento: '11144477735',
    aoGuardarCliente: (id, externo) => { vinculado = { id, externo }; },
  }, criarSimulado());
  assert.equal(r.ok, true);
  const txt = JSON.stringify(r.pagamento);
  assert.ok(!txt.includes('11144477735'), 'o CPF nao pode ficar no nosso pagamento');
  assert.ok(vinculado?.externo, 'guardamos a referencia do provedor');
});

test('cliente ja vinculado nao precisa informar documento de novo', async () => {
  const escopo = await contratar();
  const r = await vs.fluxo.pagar(escopo.id, {
    metodo: 'PIX', percentualPrestador: 80,
    cliente: { id: 'c3', nome: 'Maria', gatewayClienteId: 'cus_ja_existe' },
  }, criarSimulado());
  assert.equal(r.ok, true);
});
