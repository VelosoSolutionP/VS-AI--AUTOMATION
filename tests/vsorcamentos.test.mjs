import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vsorc-'));
process.env.VSORCAMENTOS_DIR = dir;
const orc = await import('../engine/vsorcamentos/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('nasce DESLIGADO: loja de pronta entrega não orça; o dono liga', () => {
  assert.equal(orc.config().ligado, false);
  const r = orc.salvar({ cliente: { nome: 'X', telefone: '5531900000009' }, itens: [{ descricao: 'a', quantidade: 1, preco: 1 }] });
  assert.equal(r.ok, false);
  assert.equal(r.desligado, true);
  assert.equal(orc.configurar({ ligado: true }, { por: 'dono' }).config.ligado, true);
  assert.equal(orc.config().ligado, true);
});

const CLI = { nome: 'Marina Souza', telefone: '5531900000001', canal: 'whatsapp' };
const AGORA = new Date('2026-09-28T12:00:00Z');
const base = (extra = {}) => ({ cliente: CLI, itens: [{ descricao: 'Cadeira de ferro', quantidade: 3, preco: '10,10' }], ...extra });

test('dinheiro em centavos inteiros: 3 × R$ 10,10 = R$ 30,30, sem resto de float', () => {
  const c = orc.calcular(base());
  assert.deepEqual(c.erros, []);
  assert.equal(c.itens[0].totalCentavos, 3030);
  assert.equal(c.totalCentavos, 3030);
  assert.equal(orc.emReais(123456), 'R$ 1.234,56');
});

test('valores aceitam o jeito brasileiro de escrever', () => {
  assert.equal(orc.centavos('1.234,56'), 123456);
  assert.equal(orc.centavos('R$ 10'), 1000);
  assert.equal(orc.centavos('10.5'), 1050);
  assert.equal(orc.centavos('abc'), null);
  assert.equal(orc.centavos('-5'), null);
});

test('desconto em valor e em %, frete somado; desconto maior que os itens é recusado', () => {
  const v = orc.calcular(base({ desconto: { tipo: 'valor', valor: '5,30' }, frete: '20' }));
  assert.equal(v.totalCentavos, 3030 - 530 + 2000);
  const p = orc.calcular(base({ desconto: { tipo: 'percentual', valor: '10' } }));
  assert.equal(p.descontoCentavos, 303);
  assert.equal(p.totalCentavos, 2727);
  assert.match(orc.calcular(base({ desconto: { tipo: 'valor', valor: '999' } })).erros.join(), /maior que o valor/);
  assert.match(orc.calcular(base({ desconto: { tipo: 'percentual', valor: '150' } })).erros.join(), /entre 0 e 100/);
});

test('item sem descrição, quantidade zero ou valor inválido não passa; orçamento vazio também não', () => {
  const r = orc.calcular({ itens: [{ descricao: '', quantidade: 0, preco: 'x' }] });
  assert.equal(r.erros.length, 3);
  assert.match(orc.calcular({ itens: [] }).erros[0], /pelo menos um item/);
  assert.equal(orc.salvar({ itens: [{ descricao: 'a', quantidade: 1, preco: 1 }] }).ok, false, 'sem cliente não salva');
});

test('numeração por ano, sem repetir, e link com código secreto (não é o número)', () => {
  const a = orc.salvar(base(), { agora: AGORA }).orcamento;
  const b = orc.salvar(base(), { agora: AGORA }).orcamento;
  assert.equal(a.numero, 'ORC-2026-0001');
  assert.equal(b.numero, 'ORC-2026-0002');
  assert.notEqual(a.token, b.token);
  assert.ok(a.token.length >= 20);
  assert.ok(!a.token.includes('ORC'));
  assert.equal(orc.porToken(a.token).id, a.id);
  assert.equal(orc.porToken('ORC-2026-0001'), null, 'pelo número não se acha nada');
});

test('rascunho se edita; enviado não muda — e duplicar gera um rascunho novo com os mesmos itens', () => {
  const o = orc.salvar(base(), { agora: AGORA }).orcamento;
  const ed = orc.salvar({ id: o.id, cliente: CLI, itens: [{ descricao: 'Mesa', quantidade: 1, preco: 200 }] }, { agora: AGORA });
  assert.equal(ed.ok, true);
  assert.equal(ed.orcamento.numero, o.numero, 'editar não troca o número');
  assert.equal(ed.orcamento.totalCentavos, 20000);
  orc.marcarEnviado(o.id, { agora: AGORA });
  const tenta = orc.salvar({ id: o.id, cliente: CLI, itens: [{ descricao: 'Mesa', quantidade: 1, preco: 1 }] });
  assert.equal(tenta.ok, false);
  assert.match(tenta.motivo, /não muda/);
  const d = orc.duplicar(o.id, { agora: AGORA });
  assert.equal(d.ok, true);
  assert.equal(d.orcamento.situacao, 'rascunho');
  assert.notEqual(d.orcamento.numero, o.numero);
  assert.equal(d.orcamento.totalCentavos, 20000);
});

test('validade conta do ENVIO; vencido não aprova', () => {
  const o = orc.salvar(base({ validadeDias: 5 }), { agora: AGORA }).orcamento;
  assert.equal(o.validoAte, undefined, 'rascunho ainda não tem validade marcada');
  const e = orc.marcarEnviado(o.id, { agora: AGORA }).orcamento;
  assert.equal(e.validoAte, '2026-10-03');
  assert.equal(orc.situacaoDe(e, new Date('2026-10-03T20:00:00Z')), 'enviado', 'no último dia ainda vale');
  const depois = new Date('2026-10-04T09:00:00Z');
  assert.equal(orc.situacaoDe(e, depois), 'vencido');
  const r = orc.responder(e.token, 'aprovar', { agora: depois });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /vencido/);
});

test('o cliente aprova ou recusa pelo link; aprovar de novo não duplica nada', () => {
  const a = orc.marcarEnviado(orc.salvar(base(), { agora: AGORA }).orcamento.id, { agora: AGORA }).orcamento;
  const ap = orc.responder(a.token, 'aprovar', { agora: AGORA });
  assert.equal(ap.orcamento.situacao, 'aprovado');
  const de = orc.responder(a.token, 'aprovar', { agora: AGORA });
  assert.equal(de.jaEstava, true);
  assert.equal(orc.obter(a.id).historico.filter((h) => h.evento === 'aprovado pelo cliente').length, 1);
  assert.equal(orc.responder(a.token, 'recusar').ok, false, 'aprovado não vira recusado');
  const b = orc.marcarEnviado(orc.salvar(base(), { agora: AGORA }).orcamento.id, { agora: AGORA }).orcamento;
  const re = orc.responder(b.token, 'recusar', { motivo: 'achei caro', agora: AGORA });
  assert.equal(re.orcamento.situacao, 'recusado');
  assert.equal(re.orcamento.motivoRecusa, 'achei caro');
  assert.equal(orc.responder(orc.salvar(base(), { agora: AGORA }).orcamento.token, 'aprovar').ok, false, 'rascunho não se aprova');
});

test('cancelar não vale pra aprovado; resumo conta só o que foi mandado', () => {
  const r = orc.resumo({ dias: 30, agora: AGORA });
  assert.ok(r.quantidade.aprovado >= 1);
  assert.ok(r.orcadoCentavos >= r.aprovadoCentavos);
  assert.ok(r.taxaAprovacao !== null);
  const ap = orc.listar({ situacao: 'aprovado', agora: AGORA })[0];
  assert.equal(orc.cancelar(ap.id).ok, false);
  const ras = orc.salvar(base(), { agora: AGORA }).orcamento;
  assert.equal(orc.cancelar(ras.id).orcamento.situacao, 'cancelado');
});

test('mensagem e documento: número, total, validade e o link; documento escapa HTML', () => {
  const o = orc.marcarEnviado(orc.salvar(base({ cliente: { ...CLI, nome: '<b>Zé</b>' }, condicoes: '50% na entrada' }), { agora: AGORA }).orcamento.id, { agora: AGORA }).orcamento;
  const m = orc.mensagem(o, 'https://x/orcamento/abc', { loja: 'Loja Demo' });
  assert.match(m, new RegExp(o.numero));
  assert.match(m, /Total: R\$ 30,30/);
  assert.match(m, /https:\/\/x\/orcamento\/abc/);
  const h = orc.html(o, { loja: 'Loja Demo', url: 'https://x/orcamento/abc', agora: AGORA });
  assert.doesNotMatch(h, /<b>Zé<\/b>/);
  assert.match(h, /&lt;b&gt;Zé/);
  assert.match(h, /Aprovar orçamento/);
  assert.match(h, /50% na entrada/);
  assert.doesNotMatch(orc.html(o, { loja: 'L', publico: false }), /Aprovar orçamento/, 'o PDF não leva botão');
});

test('arquivo gravado com permissão restrita', () => {
  assert.equal(statSync(join(dir, 'orcamentos.json')).mode & 0o777, 0o600);
  assert.ok(JSON.parse(readFileSync(join(dir, 'orcamentos.json'), 'utf8')).length > 0);
});

test('desconto e frete em branco valem zero, não "inválido"', () => {
  const c = orc.calcular(base({ desconto: { tipo: 'valor', valor: '' }, frete: '' }));
  assert.deepEqual(c.erros, []);
  assert.equal(c.totalCentavos, 3030);
});

/* Em campo (28/09): "vendo hambúrguer e faço orçamento de camisa — lógica
   nenhuma". Com o catálogo da loja, só entra o que ela vende. */
test('com catálogo: só entra produto cadastrado, com nome e preço de lá', () => {
  const cat = [{ sku: 'x-tudo', nome: 'X-Tudo', precoCentavos: 2890 }];
  const ok = orc.calcular({ itens: [{ sku: 'x-tudo', quantidade: 2, preco: '1,00', descricao: 'qualquer coisa' }] }, { catalogo: cat });
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.itens[0].descricao, 'X-Tudo', 'o nome vem do catálogo');
  assert.equal(ok.itens[0].precoCentavos, 2890, 'o preço vem do catálogo, não do que foi digitado');
  const fora = orc.calcular({ itens: [{ descricao: 'Camisa polo', quantidade: 1, preco: 80 }] }, { catalogo: cat });
  assert.match(fora.erros.join(), /escolha um produto do catálogo/);
  assert.match(orc.salvar(base(), { catalogo: [] }).motivo, /catálogo está vazio/);
});
