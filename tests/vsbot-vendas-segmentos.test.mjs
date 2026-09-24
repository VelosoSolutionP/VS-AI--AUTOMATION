/**
 * Bot de vendas para o bloco de comida: o que pizzaria, açaí, hamburgueria,
 * marmitaria e padaria pedem além do cardápio simples.
 * Quantidade numa frase, adicional, meia a meia (vale a mais cara), taxa por
 * bairro (uma só), cardápio do dia pela categoria do estoque, sinal de
 * encomenda e horário de funcionamento (hora de Brasília).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'bot-segmentos-'));
process.env.VSBOT_DIR = join(dir, 'bot');
process.env.VSPROTOCOLO_DIR = join(dir, 'proto');
const bot = await import('../engine/vsbot/index.mjs');
const { fluxoDeCsv } = await import('../engine/vsbot/fluxo-csv.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const produtos = [
  { sku: 'XT', nome: 'X-Tudo', categoria: 'Lanches', precoCentavos: 2800, disponivel: 10 },
  { sku: 'RF', nome: 'Refri', categoria: 'Bebidas', precoCentavos: 600, disponivel: 10 },
  { sku: 'CAL', nome: 'Calabresa', categoria: 'Pizzas', precoCentavos: 4000, disponivel: 10 },
  { sku: 'CAM', nome: 'Camarão', categoria: 'Pizzas', precoCentavos: 6500, disponivel: 10 },
  { sku: 'FEI', nome: 'Feijoada', categoria: 'Prato do dia', precoCentavos: 2500, disponivel: 5 },
  { sku: 'STR', nome: 'Strogonoff', categoria: 'Prato do dia', precoCentavos: 2300, disponivel: 0, esgotado: true },
];

let n = 0;
const nova = (passos) => {
  assert.deepEqual(bot.salvarFluxo(passos).erros, undefined);
  const de = `55319${String(++n).padStart(8, '0')}`;
  return (t) => bot.atender(t, { de, nome: 'Ana', produtos });
};
const menu = (vaiPara = 'mais') => ({ id: 'menu', mensagem: 'Escolha:', opcoes: [
  { tecla: '1', texto: 'X-Tudo', sku: 'XT', vaiPara }, { tecla: '2', texto: 'Refri', sku: 'RF', vaiPara }] });
const mais = { id: 'mais', mensagem: '{pedido}\nTotal: {total}', opcoes: [{ tecla: '1', texto: 'Pagar', vaiPara: 'pagar' }] };
const pagar = { id: 'pagar', mensagem: 'PIX:', acao: 'cobrar' };

test('quantidade numa frase: "2x 1" e "3 refri" entram de uma vez; "2" sozinho e a opcao 2', async () => {
  let f = nova([menu(), mais, pagar]);
  await f('oi');
  let r = await f('2x 1');
  assert.match(r.texto, /2x X-Tudo — R\$ 56,00/);
  f = nova([menu(), mais, pagar]);
  await f('oi');
  r = await f('3 refri');
  assert.match(r.texto, /3x Refri — R\$ 18,00/);
  f = nova([menu(), mais, pagar]);
  await f('oi');
  r = await f('2');
  assert.match(r.texto, /1x Refri/);
  assert.match((await f('1')).cobranca.descricao, /^Refri$/);
});

test('o menu de itens avisa que da pra pedir mais de um', async () => {
  const f = nova([menu(), mais, pagar]);
  assert.match((await f('oi')).texto, /Ex\.: \*2x 1\*/);
});

test('adicional entra no pedido como "+ Bacon" e soma', async () => {
  const f = nova([menu('extra'), { id: 'extra', mensagem: 'Adicional?', opcoes: [
    { tecla: '1', texto: 'Bacon', valorCentavos: 400, adicional: true, vaiPara: 'mais' },
    { tecla: '2', texto: 'Sem adicional', vaiPara: 'mais' }] }, mais, pagar]);
  await f('oi'); await f('1');
  const r = await f('1');
  assert.match(r.texto, /1x \+ Bacon — R\$ 4,00/);
  assert.match(r.texto, /Total: R\$ 32,00/);
});

test('meia a meia: a pizza entra inteira, pelo preco da metade mais cara', async () => {
  const f = nova([
    { id: 'm1', mensagem: 'Primeira metade:', opcoes: [{ tecla: '1', texto: 'Calabresa', sku: 'CAL', meia: true, vaiPara: 'm2' }, { tecla: '2', texto: 'Camarão', sku: 'CAM', meia: true, vaiPara: 'm2' }] },
    { id: 'm2', mensagem: 'Segunda metade:', opcoes: [{ tecla: '1', texto: 'Calabresa', sku: 'CAL', meia: true, vaiPara: 'mais' }, { tecla: '2', texto: 'Camarão', sku: 'CAM', meia: true, vaiPara: 'mais' }] },
    mais, pagar]);
  await f('oi');
  const r1 = await f('1');
  assert.match(r1.texto, /Segunda metade/);
  const r2 = await f('2');
  assert.match(r2.texto, /1x Pizza meia Calabresa \/ meia Camarão — R\$ 65,00/);
  assert.equal((await f('1')).cobranca.valorCentavos, 6500);
});

test('taxa de entrega e uma so: trocar o bairro troca a taxa', async () => {
  const bairro = { id: 'bairro', mensagem: 'Bairro?', opcoes: [
    { tecla: '1', texto: 'Centro', valorCentavos: 500, taxa: true, vaiPara: 'conf' },
    { tecla: '2', texto: 'Jardim', valorCentavos: 900, taxa: true, vaiPara: 'conf' }] };
  const conf = { id: 'conf', mensagem: '{pedido}\nTotal: {total}', opcoes: [{ tecla: '1', texto: 'Trocar bairro', vaiPara: 'bairro' }, { tecla: '2', texto: 'Pagar', vaiPara: 'pagar' }] };
  const f = nova([menu('bairro'), bairro, conf, pagar]);
  await f('oi'); await f('1'); await f('1');
  await f('1');
  const r = await f('2');
  assert.match(r.texto, /1x Entrega \(Jardim\) — R\$ 9,00/);
  assert.doesNotMatch(r.texto, /Centro/);
  assert.match(r.texto, /Total: R\$ 37,00/);
});

test('cardapio do dia: o menu sai do estoque pela categoria, sem o esgotado, com as opcoes fixas depois', async () => {
  const f = nova([
    { id: 'dia', mensagem: 'Hoje tem:', categoria: 'prato do dia', vaiPara: 'mais', opcoes: [{ texto: 'Falar com alguém', acao: 'encaminhar' }] },
    mais, pagar]);
  const r = await f('oi');
  assert.match(r.texto, /1 - Feijoada — R\$ 25,00/);
  assert.doesNotMatch(r.texto, /Strogonoff/);
  assert.match(r.texto, /2 - Falar com alguém/);
  assert.match((await f('1')).texto, /1x Feijoada/);
});

test('cardapio do dia vazio avisa em vez de mostrar menu em branco', async () => {
  const f = nova([{ id: 'dia', mensagem: 'Hoje tem:', categoria: 'Sobremesas', vaiPara: 'mais', opcoes: [{ texto: 'Falar com alguém', acao: 'encaminhar' }] }, mais, pagar]);
  assert.match((await f('oi')).texto, /Hoje não tem nada disponível/);
});

test('encomenda com sinal: cobra a porcentagem e o resumo mostra {sinal}', async () => {
  const f = nova([menu('data'), { id: 'data', mensagem: 'Pra que dia?', acao: 'coletar', vaiPara: 'res' },
    { id: 'res', mensagem: '{pedido}\nTotal {total} — sinal {sinal} para {data}', opcoes: [{ tecla: '1', texto: 'Pagar sinal', vaiPara: 'sinal' }] },
    { id: 'sinal', mensagem: 'PIX do sinal:', acao: 'cobrar', sinal: 50 }]);
  await f('oi'); await f('1');
  const r = await f('sábado 15h');
  assert.match(r.texto, /Total R\$ 28,00 — sinal R\$ 14,00 para sábado 15h/);
  const c = (await f('1')).cobranca;
  assert.equal(c.valorCentavos, 1400);
  assert.equal(c.totalPedidoCentavos, 2800);
  assert.match(c.descricao, /^Sinal 50% — X-Tudo/);
});

test('horario: hora de Brasilia, faixa que vira a noite e dia fechado', () => {
  const h = { sex: '18:00-02:00', sab: 'fechado' };
  // Sexta 20h em Brasília = sábado 00h UTC.
  assert.equal(bot.estaAberto(h, new Date('2026-09-26T00:00:00Z')), true);
  // Sábado 01h30 em Brasília (ainda a noite de sexta).
  assert.equal(bot.estaAberto(h, new Date('2026-09-26T04:30:00Z')), true);
  // Sábado 03h em Brasília: já fechou.
  assert.equal(bot.estaAberto(h, new Date('2026-09-26T06:00:00Z')), false);
  // Sexta 17h em Brasília: ainda não abriu.
  assert.equal(bot.estaAberto(h, new Date('2026-09-25T20:00:00Z')), false);
  assert.equal(bot.estaAberto(null), true, 'sem horario = sempre aberto');
  assert.match(bot.horarioLegivel(h), /Sexta: 18:00 às 02:00/);
  assert.match(bot.horarioLegivel(h), /Sábado: fechado/);
});

test('fechado: quem chega ouve o horario; quem ja esta no pedido termina', async () => {
  const f = nova([menu(), mais, pagar]);
  await f('oi');
  bot.salvarConfig({ horario: { dom: 'fechado', seg: 'fechado', ter: 'fechado', qua: 'fechado', qui: 'fechado', sex: 'fechado', sab: 'fechado' } });
  try {
    assert.match((await f('1')).texto, /1x X-Tudo/, 'no meio do pedido o fechamento nao corta a venda');
    const g = nova([menu(), mais, pagar]);
    const r = await g('oi');
    assert.equal(r.tipo, 'fechado');
    assert.match(r.texto, /Estamos fechados agora/);
    assert.match(r.texto, /Segunda: fechado/);
  } finally { bot.salvarConfig({ horario: null }); }
});

test('planilha: categoria, tipo (meia/adicional/taxa) e sinal entram pelo CSV', () => {
  const csv = [
    'passo,mensagem,opcao,texto_opcao,vai_para,acao,valor,sku,categoria,tipo,sinal',
    'dia,"Hoje tem:",,,fim_dia,,,,Prato do dia,,',
    'fim_dia,"Adicional?",1,Ovo,pagar,,2,,,adicional,',
    'fim_dia,,2,Centro,pagar,,5,,,taxa,',
    'pagar,"PIX:",,,,cobrar,,,,,30%',
  ].join('\n');
  const r = fluxoDeCsv(csv);
  assert.deepEqual(r.erros, []);
  const [dia, extra, pg] = r.fluxo.passos;
  assert.equal(dia.categoria, 'Prato do dia');
  assert.equal(extra.opcoes[0].adicional, true);
  assert.equal(extra.opcoes[1].taxa, true);
  assert.equal(pg.sinal, 30);
  assert.match(fluxoDeCsv(csv.replace('adicional,', 'bebida,')).erros[0], /tipo "bebida" não existe/);
});

/* Os fluxos de exemplo de cada segmento (exemplos/) são o que se entrega pro
   cliente começar. Cada um tem que carregar e fechar um pedido até a cobrança. */
const { readFileSync } = await import('node:fs');
const vitrine = [
  ...produtos,
  { sku: 'MON', nome: 'Monstrão', categoria: 'Lanches', precoCentavos: 3200, disponivel: 5 },
  { sku: 'A500', nome: 'Açaí 500 ml', categoria: 'Açaí', precoCentavos: 1800, disponivel: 50 },
  { sku: 'BOLO', nome: 'Bolo de pote', categoria: 'Encomendas', precoCentavos: 12000, disponivel: 9 },
];
const roteiros = {
  hamburgueria: [['oi'], ['1'], ['1'], ['1'], ['4'], ['2'], ['sem cebola'], ['1'], ['1'], ['Rua A, 10'], ['1']],
  pizzaria: [['oi'], ['2'], ['1'], ['2'], ['1'], ['2'], ['não'], ['2'], ['1']],
  acai: [['oi'], ['1'], ['1'], ['1'], ['3'], ['5'], ['2'], ['não'], ['2'], ['1']],
  marmitaria: [['oi'], ['1'], ['1'], ['2'], ['2'], ['não'], ['2'], ['1']],
  'padaria-encomenda': [['oi'], ['1'], ['1'], ['2'], ['sábado 15h'], ['tema futebol'], ['1']],
};
for (const [nome, passos] of Object.entries(roteiros)) {
  test(`exemplo ${nome}: carrega e fecha um pedido ate a cobranca`, async () => {
    const fluxo = JSON.parse(readFileSync(new URL(`../exemplos/fluxo-${nome}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(bot.salvarFluxo(fluxo).erros, undefined);
    const de = `55318${String(++n).padStart(8, '0')}`;
    let r;
    for (const [t] of passos) { r = await bot.atender(t, { de, nome: 'Ana', produtos: vitrine }); }
    assert.ok(r.cobranca?.valorCentavos > 0, `${nome}: o pedido nao chegou na cobranca — ultima resposta: ${r.texto}`);
  });
}

test('exemplo pizzaria: "quero mais" volta ao menu SEM perder o que ja estava no pedido', async () => {
  const fluxo = JSON.parse(readFileSync(new URL('../exemplos/fluxo-pizzaria.json', import.meta.url), 'utf8'));
  bot.salvarFluxo(fluxo);
  const de = `55317${String(++n).padStart(8, '0')}`;
  const f = (t) => bot.atender(t, { de, nome: 'Ana', produtos: vitrine });
  for (const t of ['oi', '1', '1', '3', '1']) { await f(t); } // pizza Calabresa sem borda → mais → quero mais
  const r = await f('3'); // bebidas
  assert.match(r.texto, /Refri/);
  const fim = await f('1');
  assert.match(fim.texto, /1x Calabresa/);
  assert.match(fim.texto, /1x Refri/);
});

test('horario escrito errado e recusado ao salvar, dizendo o dia', () => {
  const r = bot.salvarConfig({ horario: { seg: '18h as 23h' } });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /Segunda/);
  assert.notEqual(bot.salvarConfig({ horario: { seg: '11:00-14:00, 18:00-23:30', dom: 'fechado', sab: '' } }).ok, false);
  bot.salvarConfig({ horario: null });
});
