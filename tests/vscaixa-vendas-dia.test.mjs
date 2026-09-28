/**
 * Vendas do dia (por canal) + caixa básico (abertura, sangria/reforço, fechamento).
 *
 * O que estes testes seguram: dia e hora de BRASÍLIA (venda das 22h é de hoje,
 * não de amanhã); vendido = só pagamento confirmado; "na entrega" à parte;
 * WhatsApp e Telegram não se misturam; pico e mais vendidos (sem a taxa de
 * entrega); e o caixa: esperado = troco + reforços − sangrias + entregas −
 * maquininha, fechado não reabre, sangria absurda é recusada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'caixa-iso-'));
process.env.VS_HOME = casa;
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

const res = await import('../engine/vsresultados/index.mjs');
const cx = await import('../engine/vscaixa/index.mjs');

const br = (dia, hhmm) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const item = (nome, reais) => ({ nome, valorCentavos: reais * 100 });
let n = 0;
const pedido = (canal, quando, itens, pagamentoId = null) => res.registrarPedido({
  referencia: `VS${++n}`, pagamentoId, telefone: '553199990000' + n, canal, nome: `Cliente ${n}`, quando,
  valorCentavos: itens.reduce((s, i) => s + i.valorCentavos, 0), itens,
});
const pagamentos = [
  { id: 'p1', estado: 'CONFIRMADO', metodo: 'PIX' },
  { id: 'p2', estado: 'DISPONIVEL', metodo: 'CREDIT_CARD' },
  { id: 'p3', estado: 'PENDENTE', metodo: 'PIX' },
  { id: 'p4', estado: 'CANCELADO', metodo: 'PIX' },
  { id: 'p5', estado: 'CONFIRMADO', metodo: 'PIX' },
];
const D = '2026-09-28';
pedido('whatsapp', br(D, '12:10'), [item('X-Tudo', 28), item('Refri', 6)], 'p1');
pedido('whatsapp', br(D, '12:40'), [item('X-Tudo', 28), { nome: 'Entrega Centro', valorCentavos: 500, taxa: true }], 'p2');
pedido('whatsapp', br(D, '19:05'), [item('Pizza', 50)]); // na entrega
pedido('whatsapp', br(D, '22:30'), [item('X-Tudo', 28)], 'p5'); // 01:30 UTC do dia seguinte
pedido('whatsapp', br(D, '13:00'), [item('Refri', 6)], 'p3'); // aguardando
pedido('whatsapp', br(D, '14:00'), [item('Refri', 6)], 'p4'); // cancelado
pedido('telegram', br(D, '12:15'), [item('Açaí', 20)], 'p1'); // outro canal — não entra no WhatsApp
pedido('whatsapp', br('2026-09-21', '12:00'), [item('X-Tudo', 28)], 'p1'); // semana passada

test('o dia é de Brasília: a venda das 22h30 é de hoje, não de amanhã', () => {
  const d = res.doDia({ canal: 'whatsapp', dia: D, pagamentos });
  assert.equal(d.pedidos, 4, 'pago x3 + entrega x1; aguardando e cancelado não são venda');
  assert.equal(d.lista.find((p) => p.hora === 22)?.situacao, 'pago');
  assert.equal(res.doDia({ canal: 'whatsapp', dia: '2026-09-29', pagamentos }).pedidos, 0);
});

test('vendido = só confirmado; entrega e aguardando à parte; cancelado some', () => {
  const d = res.doDia({ canal: 'whatsapp', dia: D, pagamentos });
  assert.equal(d.vendidoCentavos, 3400 + 3300 + 2800);
  assert.equal(d.naEntregaCentavos, 5000);
  assert.equal(d.aguardandoCentavos, 600);
  assert.equal(d.pedidosAguardando, 1);
  assert.equal(d.ticketMedioCentavos, Math.round((9500 + 5000) / 4));
  assert.equal(d.lista.filter((p) => p.situacao === 'cancelado').length, 1, 'cancelado aparece na lista, marcado');
  assert.equal(d.porHora[14].pedidos, 0, 'mas não conta como venda (14h só tinha o cancelado)');
});

test('WhatsApp e Telegram não se misturam', () => {
  const t = res.doDia({ canal: 'telegram', dia: D, pagamentos });
  assert.equal(t.pedidos, 1);
  assert.equal(t.vendidoCentavos, 2000);
  assert.ok(!res.doDia({ canal: 'whatsapp', dia: D, pagamentos }).maisVendidos.some((i) => i.nome === 'Açaí'));
});

test('pico é a hora com mais pedidos; mais vendidos sem a taxa de entrega', () => {
  const d = res.doDia({ canal: 'whatsapp', dia: D, pagamentos });
  assert.deepEqual({ hora: d.pico.hora, pedidos: d.pico.pedidos }, { hora: 12, pedidos: 2 });
  assert.equal(d.porHora.length, 24);
  assert.deepEqual(d.maisVendidos[0], { nome: 'X-Tudo', qtd: 3, centavos: 8400 });
  assert.ok(!d.maisVendidos.some((i) => /Entrega/.test(i.nome)));
});

test('compara com o mesmo dia da semana passada', () => {
  const d = res.doDia({ canal: 'whatsapp', dia: D, pagamentos });
  assert.equal(d.semanaPassada.dia, '2026-09-21');
  assert.equal(d.semanaPassada.vendidoCentavos, 2800);
});

test('dia sem venda nenhuma: zeros, sem pico, sem quebrar', () => {
  const d = res.doDia({ canal: 'telegram', dia: '2026-01-01', pagamentos });
  assert.equal(d.pedidos, 0);
  assert.equal(d.pico, null);
  assert.equal(d.ticketMedioCentavos, 0);
});

test('centavos: aceita "1.234,56", "150", número inteiro; recusa lixo e negativo', () => {
  assert.equal(cx.centavos('1.234,56'), 123456);
  assert.equal(cx.centavos('150'), 15000);
  assert.equal(cx.centavos('R$ 20,5'), 2050);
  assert.equal(cx.centavos(990), 990);
  assert.equal(cx.centavos('-5'), null);
  assert.equal(cx.centavos('abc'), null);
  assert.equal(cx.centavos(1.5), null);
});

test('caixa: abre, movimenta, fecha com esperado e diferença; fechado não aceita mais nada', () => {
  const quando = new Date(br(D, '08:00'));
  assert.equal(cx.abrir({ canal: 'whatsapp', troco: '100', quem: 'dono@loja', agora: quando }).ok, true);
  assert.equal(cx.abrir({ canal: 'whatsapp', troco: '50' }).ok, false, 'não abre duas vezes');
  assert.equal(cx.estado('telegram').aberto, null, 'abrir o do WhatsApp não abre o do Telegram');
  assert.equal(cx.movimentar({ canal: 'whatsapp', tipo: 'reforco', valor: '50', motivo: 'troco do banco' }).ok, true);
  assert.equal(cx.movimentar({ canal: 'whatsapp', tipo: 'sangria', valor: '30', motivo: 'pagou o motoboy' }).ok, true);
  assert.equal(cx.movimentar({ canal: 'whatsapp', tipo: 'sangria', valor: '30', motivo: '' }).ok, false, 'sem motivo, não');
  assert.equal(cx.movimentar({ canal: 'whatsapp', tipo: 'sangria', valor: '500', motivo: 'x' }).ok, false, 'sangria maior que a gaveta');

  const vendas = res.vendasEntre({ canal: 'whatsapp', de: quando, ate: new Date(br(D, '23:59')), pagamentos });
  assert.equal(cx.estado('whatsapp', { vendas }).aberto.esperadoCentavos, 10000 + 5000 - 3000 + 5000);
  assert.equal(cx.fechar({ canal: 'whatsapp', contado: '100', maquininha: '60', vendas }).ok, false, 'maquininha maior que a entrega');
  const f = cx.fechar({ canal: 'whatsapp', contado: '100,00', maquininha: '20', obs: 'faltou troco', quem: 'dono@loja', vendas, agora: new Date(br(D, '23:00')) });
  assert.equal(f.ok, true);
  const esperado = 10000 + 5000 - 3000 + 5000 - 2000;
  assert.equal(f.fechamento.esperadoCentavos, esperado);
  assert.equal(f.fechamento.diferencaCentavos, 10000 - esperado);
  assert.equal(f.fechamento.vendas.vendidoCentavos, 9500);
  assert.equal(f.fechamento.abertoPor, 'dono@loja');
  assert.equal(cx.estado('whatsapp').aberto, null);
  assert.equal(cx.movimentar({ canal: 'whatsapp', tipo: 'reforco', valor: '5', motivo: 'x' }).ok, false, 'fechado é fechado');
  assert.equal(cx.fechar({ canal: 'whatsapp', contado: '1' }).ok, false);
  assert.equal(cx.historico('whatsapp')[0].id, f.fechamento.id);
  assert.equal(cx.estado('whatsapp').ultimo.id, f.fechamento.id);
  assert.equal(cx.historico('telegram').length, 0);
});

test('canal inventado é recusado', () => {
  assert.equal(cx.abrir({ canal: 'orkut', troco: '1' }).ok, false);
  assert.equal(cx.estado('orkut').ok, false);
});
