import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidar, lacunas } from '../engine/vspainel/financeiro.mjs';

const lead = (status, valor) => ({ status, valor, origem: 'manual', criadoEm: '2026-09-01T00:00:00.000Z', atualizadoEm: '2026-09-10T00:00:00.000Z' });

test('receita fechada conta SO lead ganho; aberto vira pipeline', () => {
  const r = consolidar({ leads: [lead('ganho', 1000), lead('aberto', 500), lead('perdido', 300)] });
  assert.equal(r.receitaFechadaCentavos, 100000);
  assert.equal(r.pipelineCentavos, 50000);
  assert.equal(r.perdidoCentavos, 30000);
});

test('pipeline NUNCA entra no total reconhecido — seria prometer o que ninguem pagou', () => {
  const r = consolidar({ leads: [lead('ganho', 100), lead('aberto', 9999)] });
  assert.equal(r.totalReconhecidoCentavos, 10000);
});

test('valor do lead vem em reais e é convertido, nao somado cru', () => {
  const r = consolidar({ leads: [lead('ganho', 79.9)] });
  assert.equal(r.receitaFechadaCentavos, 7990);
  // toLocaleString('pt-BR') separa com espaco NAO SEPARAVEL (U+00A0), nao espaco comum.
  assert.match(r.receitaFechada, /^R\$\s79,90$/);
});

test('sem nenhum valor a receita é null, nao zero', () => {
  const r = consolidar({ leads: [lead('ganho', null), lead('ganho', null)] });
  assert.equal(r.receitaFechadaCentavos, null);
  assert.equal(r.receitaFechada, '—');
});

test('ganho sem valor aparece no detalhe e vira lacuna — a receita esta subestimada', () => {
  const r = consolidar({ leads: [lead('ganho', 100), lead('ganho', null)] });
  assert.match(r.fontes[0].detalhe, /1 sem valor informado/);
  assert.ok(r.lacunas.some((l) => /ganho\(s\) sem valor/.test(l)));
});

test('ticket medio ignora quem nao tem valor, em vez de dividir errado', () => {
  const r = consolidar({ leads: [lead('ganho', 100), lead('ganho', 200), lead('ganho', null)] });
  assert.equal(r.ticketMedioCentavos, 15000, 'media de 2 valores, nao de 3 leads');
  assert.equal(consolidar({ leads: [lead('ganho', null)] }).ticketMedioCentavos, null);
});

test('ganhos de conteudo entram como fonte separada, ja em centavos', () => {
  const r = consolidar({ leads: [], ganhos: [{ centavos: 5000 }, { centavos: 2500 }] });
  assert.equal(r.conteudoCentavos, 7500);
  assert.equal(r.fontes[1].detalhe, '2 lançamento(s)');
});

test('estoque parado é ATIVO, nao receita — fica fora do total', () => {
  const r = consolidar({ leads: [lead('ganho', 100)], estoque: { valorCentavos: 999999 } });
  assert.equal(r.estoqueParadoCentavos, 999999);
  assert.equal(r.totalReconhecidoCentavos, 10000);
});

test('nenhuma fonte se declara confirmada — nada aqui foi conciliado', () => {
  const r = consolidar({ leads: [lead('ganho', 100)], ganhos: [{ centavos: 1 }] });
  for (const f of r.fontes) {
    assert.equal(f.confirmado, false);
    assert.ok(f.ressalva, f.id + ' sem ressalva');
  }
  assert.ok(r.lacunas.some((l) => /conciliação bancária/.test(l)));
});

test('conversao é null sem nada fechado, nao 0%', () => {
  assert.equal(consolidar({ leads: [lead('aberto', 10)] }).conversao, null);
  assert.equal(consolidar({ leads: [lead('ganho', 10), lead('perdido', 10)] }).conversao, 0.5);
});

test('lacunas somem quando o dado existe', () => {
  const l = lacunas([lead('ganho', 10)], { ganhos: [{ centavos: 1 }], stripeConciliado: true });
  assert.deepEqual(l, []);
});
