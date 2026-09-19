import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenConfere, validarWebhook, explicarErro } from '../engine/vspagamentos/asaas.mjs';
import { traduzirEvento, podeIr, transitar, EVENTO_ASAAS } from '../engine/vspagamentos/estados.mjs';

const dir = mkdtempSync(join(tmpdir(), 'vspag-'));
process.env.VSPAGAMENTOS_DIR = dir;
const vs = await import('../engine/vspagamentos/index.mjs');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const TOKEN = 'x'.repeat(40);
const ev = (evento, id, extra = {}) => ({ id, event: evento, payment: { id: 'pay_1', value: 100, ...extra } });
const hdr = (t = TOKEN) => ({ 'asaas-access-token': t });

/* ---------------- autenticação do webhook ---------------- */

test('token do webhook é comparado em tempo constante e exige tamanho igual', () => {
  assert.equal(tokenConfere(TOKEN, TOKEN), true);
  assert.equal(tokenConfere('x'.repeat(39), TOKEN), false);
  assert.equal(tokenConfere('', TOKEN), false);
  assert.equal(tokenConfere(TOKEN, ''), false);
});

test('SEM token configurado o endpoint é recusado — nao é "modo permissivo"', () => {
  const r = validarWebhook(hdr(), '');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /aceitaria evento forjado/);
});

test('header ausente ou token errado nao passa', () => {
  assert.match(validarWebhook({}, TOKEN).motivo, /header asaas-access-token ausente/);
  assert.match(validarWebhook(hdr('y'.repeat(40)), TOKEN).motivo, /não confere/);
  assert.equal(validarWebhook(hdr(), TOKEN).ok, true);
});

/* ---------------- tradução de evento ---------------- */

test('CONFIRMED e RECEIVED sao estados DIFERENTES — é a distincao que evita prejuizo', () => {
  assert.equal(EVENTO_ASAAS.PAYMENT_CONFIRMED, 'CONFIRMADO');
  assert.equal(EVENTO_ASAAS.PAYMENT_RECEIVED, 'DISPONIVEL');
  assert.notEqual(EVENTO_ASAAS.PAYMENT_CONFIRMED, EVENTO_ASAAS.PAYMENT_RECEIVED);
});

test('evento desconhecido nao vira estado', () => {
  const t = traduzirEvento({ id: 'e1', event: 'PAYMENT_INVENTADO' });
  assert.equal(t.conhecido, false);
  assert.equal(t.estado, null);
});

test('traducao extrai id do evento, da cobranca e os valores em centavos', () => {
  const t = traduzirEvento({ id: 'evt_9', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_7', value: 100, netValue: 98 } });
  assert.equal(t.eventoId, 'evt_9');
  assert.equal(t.cobrancaId, 'pay_7');
  assert.equal(t.valorCentavos, 10000);
  assert.equal(t.liquidoCentavos, 9800);
});

/* ---------------- máquina de estados ---------------- */

/* Este teste ja afirmou o CONTRARIO — que CRIADO -> DISPONIVEL era pulo proibido.
   Rodando contra o sandbox do Asaas (19/09/2026) o PAYMENT_RECEIVED de um Pix
   chegou com a cobranca ainda em CRIADO, e a recusa deixou um pagamento RECEBIDO
   marcado como "aguardando". O Pix confirma e liquida no mesmo instante: esse
   caminho e normal, nao anomalia. */
test('Pix pode ir de CRIADO direto pra DISPONIVEL — confirma e liquida junto', () => {
  assert.equal(podeIr('CRIADO', 'DISPONIVEL').ok, true);
  assert.equal(podeIr('PENDENTE', 'DISPONIVEL').ok, true);
});

test('o que continua proibido e andar pra TRAS ou sair de estado final', () => {
  assert.equal(podeIr('DISPONIVEL', 'CRIADO').ok, false);
  assert.equal(podeIr('CONFIRMADO', 'PENDENTE').ok, false);
  assert.equal(podeIr('ESTORNADO', 'CONFIRMADO').ok, false);
  assert.equal(podeIr('CANCELADO', 'DISPONIVEL').ok, false);
});

test('CONFIRMADO -> DISPONIVEL é o caminho legitimo', () => {
  assert.equal(podeIr('CONFIRMADO', 'DISPONIVEL').ok, true);
});

test('transicao repetida NAO é erro — webhook é at-least-once', () => {
  const p = { estado: 'CONFIRMADO', historico: [] };
  const r = transitar(p, 'CONFIRMADO');
  assert.equal(r.erro, null);
  assert.equal(r.repetido, true);
});

test('estado final nao volta atras', () => {
  assert.equal(podeIr('ESTORNADO', 'DISPONIVEL').ok, false);
  assert.equal(podeIr('CANCELADO', 'CONFIRMADO').ok, false);
});

/* ---------------- fluxo completo ---------------- */

test('configurar recusa custodia sem aprovacao juridica explicita', () => {
  const r = vs.configurar({ modelo: 'custodia' });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /custodiaAprovadaPorJuridico/.test(e)));
});

test('configurar valida percentual, base e tamanho do token', () => {
  assert.ok(vs.configurar({ percentualPrestador: 150 }).erros.some((e) => /percentual/.test(e)));
  assert.ok(vs.configurar({ baseSplit: 'meio a meio' }).erros.some((e) => /baseSplit/.test(e)));
  assert.ok(vs.configurar({ webhookToken: 'curto' }).erros.some((e) => /32 caracteres/.test(e)));
});

test('diagnostico diz o que falta antes de tentar cobrar', () => {
  const d = vs.diagnostico();
  assert.equal(d.pronto, false);
  assert.ok(d.faltando.some((f) => /apiKey/.test(f)));
  assert.ok(d.faltando.some((f) => /evento forjado/.test(f)));
});

test('configuracao completa deixa pronto, e o segredo volta mascarado', () => {
  const r = vs.configurar({ apiKey: 'chave-secreta-de-verdade', webhookToken: TOKEN, percentualPrestador: 80, baseSplit: 'liquido' });
  assert.equal(r.ok, true);
  assert.ok(!r.config.apiKey.includes('secreta'), 'chave nao pode voltar inteira');
  assert.equal(vs.diagnostico().pronto, true);
});

test('cobranca grava o split que valeu e o link do gateway', async () => {
  const r = await vs.cobrar({
    clienteId: 'cus_1', metodo: 'PIX', valorCentavos: 10000, walletIdPrestador: 'w1', referencia: 'OS-1',
  }, {
    fetchImpl: async () => ({ status: 200, json: async () => ({ id: 'pay_1', invoiceUrl: 'https://asaas/x' }) }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.pagamento.id, 'pay_1');
  assert.equal(r.pagamento.estado, 'CRIADO');
  assert.equal(r.pagamento.split.percentualPrestador, 80);
  assert.equal(r.pagamento.linkPagamento, 'https://asaas/x');
});

test('webhook com token errado é 401 e nao move nada', () => {
  const r = vs.processarWebhook(hdr('z'.repeat(40)), ev('PAYMENT_CONFIRMED', 'e1'));
  assert.equal(r.ok, false);
  assert.equal(r.http, 401);
  assert.equal(vs.obter('pay_1').estado, 'CRIADO');
});

test('CONFIRMED move pra CONFIRMADO, e o repasse continua BLOQUEADO', () => {
  const r = vs.processarWebhook(hdr(), ev('PAYMENT_CONFIRMED', 'e2'));
  assert.equal(r.http, 200);
  assert.equal(r.estado, 'CONFIRMADO');
  const pode = vs.podeRepassar(vs.obter('pay_1'));
  assert.equal(pode.ok, false);
  assert.match(pode.motivo, /ainda NÃO está disponível/);
});

test('evento REENTREGUE devolve 200 e nao processa de novo (senao a fila do Asaas pausa)', () => {
  const r = vs.processarWebhook(hdr(), ev('PAYMENT_CONFIRMED', 'e2'));
  assert.equal(r.ok, true);
  assert.equal(r.http, 200);
  assert.equal(r.duplicado, true);
});

test('RECEIVED libera o repasse e fecha o split com o liquido real', () => {
  const r = vs.processarWebhook(hdr(), ev('PAYMENT_RECEIVED', 'e3', { netValue: 98 }));
  assert.equal(r.estado, 'DISPONIVEL');
  const p = vs.obter('pay_1');
  assert.equal(p.split.liquidoCentavos, 9800, 'o liquido so é conhecido quando o gateway informa');
  assert.equal(p.split.prestadorCentavos, 7840);
  assert.equal(vs.podeRepassar(p).ok, true);
});

test('disputa aberta segura o repasse mesmo com dinheiro disponivel', () => {
  const r = vs.podeRepassar(vs.obter('pay_1'), { disputaAberta: true });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /disputa aberta/);
});

test('no modelo split nao existe transferencia a fazer', async () => {
  const r = await vs.repassar('pay_1');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /repasse é automático na liquidação/);
});

test('evento de cobranca que nao é nossa nao quebra — responde 200', () => {
  const r = vs.processarWebhook(hdr(), { id: 'e4', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_de_outro' } });
  assert.equal(r.http, 200);
  assert.equal(r.orfao, true);
});

test('evento sem id é recusado — sem ele nao ha idempotencia', () => {
  const r = vs.processarWebhook(hdr(), { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
  assert.equal(r.ok, false);
  assert.equal(r.http, 400);
});

test('erro do Asaas vira frase acionavel', () => {
  assert.match(explicarErro(401, {}), /chave de API/);
  assert.match(explicarErro(429, {}), /limite de chamadas/);
  assert.match(explicarErro(400, { errors: [{ description: 'customer inválido' }] }), /customer inválido/);
});
