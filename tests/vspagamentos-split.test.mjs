import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSplit, paraAsaas, conferir, BASES } from '../engine/vspagamentos/split.mjs';

test('base "liquido": os dois dividem a taxa do gateway', () => {
  // cliente paga 100,00; gateway fica com 2,00; sobram 98,00
  const r = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 9800, percentualPrestador: 80, base: 'liquido' });
  assert.equal(r.ok, true);
  assert.equal(r.split.prestadorCentavos, 7840, '80% de 98,00');
  assert.equal(r.split.plataformaCentavos, 1960);
  assert.equal(r.split.taxaGatewayCentavos, 200);
  assert.equal(r.split.prestadorCentavos + r.split.plataformaCentavos, 9800, 'não pode sobrar nem sumir centavo');
});

test('base "bruto": a plataforma absorve a taxa inteira', () => {
  const r = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 9800, percentualPrestador: 80, base: 'bruto' });
  assert.equal(r.split.prestadorCentavos, 8000, '80% do PREÇO CHEIO, não do líquido');
  assert.equal(r.split.plataformaCentavos, 1800, 'a comissão encolhe pela taxa');
  assert.equal(r.split.prestadorCentavos + r.split.plataformaCentavos, 9800);
});

test('a diferença entre as bases é dinheiro real — não é detalhe', () => {
  const l = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 9800, percentualPrestador: 80, base: 'liquido' });
  const b = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 9800, percentualPrestador: 80, base: 'bruto' });
  assert.equal(b.split.prestadorCentavos - l.split.prestadorCentavos, 160, 'R$1,60 por cobrança de R$100');
});

test('base é OBRIGATORIA — escolher por conta seria decidir quem paga a taxa', () => {
  const r = calcularSplit({ brutoCentavos: 10000, percentualPrestador: 80 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /base do split não informada/);
  for (const b of BASES) {
    assert.equal(calcularSplit({ brutoCentavos: 10000, percentualPrestador: 80, base: b }).ok, true);
  }
});

test('percentual NAO tem default — 80/20 é hipotese comercial (BDR-01)', () => {
  const r = calcularSplit({ brutoCentavos: 10000, base: 'bruto' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /percentual do prestador inválido/);
});

test('percentual fora da faixa é recusado', () => {
  for (const p of [0, 100, -5, 120, 'oitenta']) {
    assert.equal(calcularSplit({ brutoCentavos: 10000, percentualPrestador: p, base: 'bruto' }).ok, false, `aceitou ${p}`);
  }
});

test('sem o liquido o split é PROVISORIO e avisa', () => {
  const r = calcularSplit({ brutoCentavos: 10000, percentualPrestador: 80, base: 'liquido' });
  assert.equal(r.ok, true);
  assert.equal(r.split.liquidoCentavos, null);
  assert.equal(r.split.taxaGatewayCentavos, null);
  assert.ok(r.avisos.some((a) => /líquido ainda desconhecido/.test(a)));
});

test('taxa maior que a comissao é BARRADA, nao paga do proprio bolso calado', () => {
  // taxa de 30,00 numa cobranca de 100,00 com 80% pro prestador
  const r = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 7000, percentualPrestador: 80, base: 'bruto' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /passa do líquido disponível/);
});

test('taxa que come quase toda a comissao passa, mas avisa', () => {
  const r = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 8200, percentualPrestador: 80, base: 'bruto' });
  assert.equal(r.ok, true);
  assert.ok(r.avisos.some((a) => /consome a maior parte da comissão/.test(a)));
});

test('liquido maior que o bruto é erro do gateway, nao arredondamento', () => {
  const r = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 11000, percentualPrestador: 80, base: 'bruto' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /líquido maior que o bruto/);
});

test('arredondamento nunca cria nem some centavo', () => {
  for (const bruto of [3333, 999, 10007, 1, 77777]) {
    const r = calcularSplit({ brutoCentavos: bruto, liquidoCentavos: bruto, percentualPrestador: 70, base: 'liquido' });
    if (!r.ok) { continue; }
    assert.equal(r.split.prestadorCentavos + r.split.plataformaCentavos, bruto, `quebrou em ${bruto}`);
  }
});

test('o split guarda a politica que valeu NAQUELE pagamento', () => {
  const r = calcularSplit({ brutoCentavos: 10000, percentualPrestador: 80, base: 'bruto', politicaVersao: 'v3' });
  assert.equal(r.split.politicaVersao, 'v3');
  assert.equal(r.split.percentualPrestador, 80);
});

test('para o Asaas: base "liquido" vira percentualValue', () => {
  const { split } = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 9800, percentualPrestador: 80, base: 'liquido' });
  const r = paraAsaas(split, 'wallet-1');
  assert.deepEqual(r.split, [{ walletId: 'wallet-1', percentualValue: 80 }]);
});

test('para o Asaas: base "bruto" vira fixedValue — percentual pagaria MENOS que o combinado', () => {
  const { split } = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 9800, percentualPrestador: 80, base: 'bruto' });
  const r = paraAsaas(split, 'wallet-1');
  assert.deepEqual(r.split, [{ walletId: 'wallet-1', fixedValue: 80 }]);
  assert.ok(!('percentualValue' in r.split[0]), 'percentual no Asaas incide sobre o netValue');
});

test('sem walletId nao monta split — o Asaas exige conta do recebedor', () => {
  const { split } = calcularSplit({ brutoCentavos: 10000, percentualPrestador: 80, base: 'bruto' });
  assert.match(paraAsaas(split, '').motivo, /walletId do prestador/);
});

test('conferir pega divergencia entre o calculado e o repassado', () => {
  const { split } = calcularSplit({ brutoCentavos: 10000, liquidoCentavos: 9800, percentualPrestador: 80, base: 'liquido' });
  assert.equal(conferir(split, 7840).ok, true);
  const d = conferir(split, 7800);
  assert.equal(d.ok, false);
  assert.equal(d.diferencaCentavos, -40);
  assert.match(d.motivo, /esperado 78,40|esperado 78\.40/);
});
