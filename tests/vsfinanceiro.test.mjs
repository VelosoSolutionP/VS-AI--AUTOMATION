/**
 * Livro-caixa. Dois cuidados que dinheiro exige e que o resto do sistema não:
 * valor nunca vira 0 calado, e o mesmo dinheiro nunca entra duas vezes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vsfin-'));
process.env.VSFINANCEIRO_DIR = dir;
const fin = await import('../engine/vsfinanceiro/index.mjs');
const L = await import('../engine/vsfinanceiro/lancamento.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

/* ---- dinheiro ---- */

test('valor digitado por gente vira centavos, no padrao BR', () => {
  assert.equal(L.paraCentavos('R$ 1.299,90'), 129990, 'ponto e separador de milhar quando ha virgula');
  assert.equal(L.paraCentavos('1299,90'), 129990);
  assert.equal(L.paraCentavos('1299.90'), 129990, 'sem virgula, o ponto e decimal');
  assert.equal(L.paraCentavos('79,9'), 7990);
  assert.equal(L.paraCentavos(79.9), 7990);
  assert.equal(L.paraCentavos('1.299'), 129900, '1.299 e mil duzentos e noventa e nove, nao 1,29');
});

test('valor que nao da pra ler vira null, NUNCA zero', () => {
  for (const v of ['', null, undefined, 'abc', 'R$', '   ']) {
    assert.equal(L.paraCentavos(v), null, `"${v}" virou numero`);
  }
});

test('data invalida NAO vira hoje calado', () => {
  assert.equal(L.paraData('31/09/2026'), null);
  assert.equal(L.paraData('2026-13-45'), null, 'mes 13 nao existe');
  assert.equal(L.paraData('2026-09-20'), '2026-09-20');
  assert.equal(fin.criar({ tipo: 'entrada', valor: '10', descricao: 'x', data: 'ontem' }).ok, false);
});

/* ---- validacao ---- */

test('recusa o que nao da pra auditar depois', () => {
  assert.match(fin.criar({ tipo: 'entrada', valor: '10' }).erros.join(), /descri/, 'sem descricao');
  assert.match(fin.criar({ tipo: 'voar', valor: '10', descricao: 'x' }).erros.join(), /tipo inv/);
  assert.match(fin.criar({ tipo: 'saida', valor: '0', descricao: 'x' }).erros.join(), /maior que zero/);
});

test('saida e valor POSITIVO com tipo saida — dois sinais brigando dariam entrada', () => {
  const r = fin.criar({ tipo: 'saida', valor: '-50', descricao: 'tentativa' });
  assert.equal(r.ok, false);
  assert.match(r.erros.join(), /maior que zero/);
  const ok = fin.criar({ tipo: 'saida', valor: '50', descricao: 'aluguel', categoria: 'aluguel' });
  assert.equal(ok.ok, true);
  assert.equal(ok.lancamento.valorCentavos, 5000);
  assert.equal(ok.lancamento.tipo, 'saida');
});

test('categoria fora da lista entra, mas avisa', () => {
  const r = fin.criar({ tipo: 'entrada', valor: '10', descricao: 'x', categoria: 'inventada' });
  assert.equal(r.ok, true);
  assert.match(r.avisos.join(), /nao e uma das padrao|não é uma das padrão/);
});

/* ---- idempotencia ---- */

test('o mesmo pagamento do gateway NAO entra duas vezes no caixa', () => {
  const pg = { id: 'pay_abc', valorCentavos: 19990, referencia: 'Mensalidade', metodo: 'PIX', criadoEm: '2026-09-20T10:00:00Z' };
  const a = fin.lancarPagamento(pg);
  const b = fin.lancarPagamento(pg);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.repetido, true);
  assert.equal(fin.listar().filter((l) => l.ref === 'pay_abc').length, 1, 'lancou duas vezes');
});

test('lancamento manual repetido NAO e bloqueado — duas vendas iguais acontecem', () => {
  const e = { tipo: 'entrada', valor: '30', descricao: 'Cafe', categoria: 'venda' };
  fin.criar(e); fin.criar(e);
  assert.equal(fin.listar().filter((l) => l.descricao === 'Cafe').length, 2);
});

/* ---- edicao e exclusao ---- */

test('editar recalcula e mantem o id', () => {
  const c = fin.criar({ tipo: 'saida', valor: '100', descricao: 'Energia', categoria: 'outra' });
  const r = fin.editar(c.lancamento.id, { valor: '250,50' });
  assert.equal(r.ok, true, (r.erros || []).join());
  assert.equal(r.lancamento.id, c.lancamento.id);
  assert.equal(r.lancamento.valorCentavos, 25050);
});

test('excluir e logico — caixa nao perde historico', () => {
  const c = fin.criar({ tipo: 'entrada', valor: '11', descricao: 'Some' });
  assert.equal(fin.excluir(c.lancamento.id).ok, true);
  assert.equal(fin.obter(c.lancamento.id), null);
  assert.ok(fin.listar({ incluirExcluidos: true }).some((l) => l.id === c.lancamento.id));
  assert.equal(fin.excluir(c.lancamento.id).repetido, true);
  assert.equal(fin.editar(c.lancamento.id, { valor: '1' }).ok, false, 'excluido nao se edita');
  assert.equal(fin.restaurar(c.lancamento.id).ok, true);
  assert.ok(fin.obter(c.lancamento.id));
  fin.excluir(c.lancamento.id);
});

/* ---- resumo ---- */

test('saldo e entrada menos saida, e excluido nao conta', () => {
  const r = fin.resumir(fin.listar());
  const entrou = fin.listar().filter((l) => l.tipo === 'entrada').reduce((a, l) => a + l.valorCentavos, 0);
  const saiu = fin.listar().filter((l) => l.tipo === 'saida').reduce((a, l) => a + l.valorCentavos, 0);
  assert.equal(r.entrouCentavos, entrou);
  assert.equal(r.saiuCentavos, saiu);
  assert.equal(r.saldoCentavos, entrou - saiu);
});

test('filtro por periodo inclui as DUAS pontas', () => {
  fin.criar({ tipo: 'entrada', valor: '1', descricao: 'A', data: '2026-01-01' });
  fin.criar({ tipo: 'entrada', valor: '1', descricao: 'B', data: '2026-01-15' });
  fin.criar({ tipo: 'entrada', valor: '1', descricao: 'C', data: '2026-01-31' });
  const r = fin.filtrar(fin.listar(), { de: '2026-01-01', ate: '2026-01-31' });
  assert.equal(r.length, 3, 'dia inicial e final tem que entrar');
  assert.equal(fin.filtrar(fin.listar(), { de: '2026-01-02', ate: '2026-01-30' }).length, 1);
});

test('painel separa periodo, mes e total', () => {
  const p = fin.painel({ de: '2026-01-01', ate: '2026-01-31' });
  assert.equal(p.periodo.entradas, 3);
  assert.ok(p.total.entradas >= 3);
  assert.ok(Array.isArray(p.periodo.porCategoria));
  assert.ok(p.categorias.entrada.includes('venda'));
});
