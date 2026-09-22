/**
 * O pedido que se paga sozinho.
 *
 * A regra de negócio do Juarez é clara: se tem preço no catálogo, ninguém
 * precisa falar com gente pra saber quanto é nem pra pagar. Isso só se sustenta
 * se três coisas forem verdade — o preço aparece na opção, a soma bate, e o link
 * só é prometido quando existe de verdade.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'cobranca-iso-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import { valorEmCentavos, desenhar, ACOES, validarFluxo } from '../engine/vsbot/fluxo.mjs';
import { fluxoDeCsv } from '../engine/vsbot/fluxo-csv.mjs';
import * as bot from '../engine/vsbot/index.mjs';
import * as atendimento from '../backend/atendimento.mjs';

const CSV = `passo,mensagem,opcao,texto_opcao,vai_para,acao,valor
inicio,"O que vai ser?",1,"X-Tudo",bebida,,"28,00"
inicio,,2,"Falar com alguem",,encaminhar_humano,
bebida,"Bebida?",1,"Refrigerante lata",fecha,,"6,00"
bebida,,2,"Sem bebida",fecha,,
fecha,"Fechou!",,,,cobrar,
`;

test('preço escrito por gente vira centavos — em qualquer formato de planilha', () => {
  assert.equal(valorEmCentavos('39,90'), 3990);
  assert.equal(valorEmCentavos('R$ 39,90'), 3990);
  assert.equal(valorEmCentavos('39.90'), 3990);
  assert.equal(valorEmCentavos('28'), 2800);
  assert.equal(valorEmCentavos('1.234,50'), 123450);
  assert.equal(valorEmCentavos(62), 6200);
  // O que não é preço não vira preço: melhor recusar a planilha que cobrar NaN.
  assert.equal(valorEmCentavos('combinar'), null);
  assert.equal(valorEmCentavos(''), null);
  assert.equal(valorEmCentavos('-5'), null);
});

test('valor ilegível para a importação em vez de virar cobrança errada', () => {
  const r = fluxoDeCsv(CSV.replace('"28,00"', 'vinte e oito'));
  assert.ok(r.erros.some((e) => /não entendi o valor/.test(e)), r.erros.join('; '));
});

test('o preço aparece junto da opção — é isso que dispensa perguntar quanto é', () => {
  const { fluxo } = fluxoDeCsv(CSV);
  const texto = desenhar(fluxo.passos[0]);
  assert.match(texto, /1 - X-Tudo — R\$ 28,00/);
  // Opção sem preço não ganha traço nenhum pendurado.
  assert.match(texto, /2 - Falar com alguem$/m);
});

test('escolher itens soma o carrinho e a cobrança sai com o total', () => {
  const { fluxo } = fluxoDeCsv(CSV);
  bot.salvarFluxo(fluxo.passos);
  bot.salvarConfig({ ativo: true, assinatura: '' });

  const de = '5531900000001';
  bot.atender('oi', { de });
  bot.atender('1', { de });            // X-Tudo 28,00
  const fim = bot.atender('1', { de }); // lata 6,00 -> cai no passo de cobrança

  assert.ok(fim.cobranca, 'o passo "cobrar" tem que pedir a cobrança: ' + JSON.stringify(fim));
  assert.equal(fim.cobranca.valorCentavos, 3400);
  assert.match(fim.cobranca.descricao, /X-Tudo \+ Refrigerante lata/);
  assert.match(fim.cobranca.referencia, /^VS-/, 'a referência é o protocolo — é por ela que se acha o pedido depois');
});

test('cobrar não fala com gateway nenhum: quem tem rede é o canal', () => {
  const { fluxo } = fluxoDeCsv(CSV);
  bot.salvarFluxo(fluxo.passos);
  const de = '5531900000002';
  bot.atender('oi', { de });
  bot.atender('1', { de });
  const fim = bot.atender('2', { de }); // sem bebida
  assert.equal(fim.cobranca.valorCentavos, 2800);
  // Nenhum link aqui dentro: só o PEDIDO de cobrança.
  assert.equal(fim.cobranca.linkPagamento, undefined);
});

test('pedido sem valor não gera link de R$ 0,00 — diz que não dá', () => {
  const semPreco = validarFluxo([
    { id: 'inicio', mensagem: 'Oi', vaiPara: 'fecha', acao: ACOES.NOTA },
    { id: 'fecha', mensagem: 'Fechou!', acao: ACOES.COBRAR, valorCentavos: 0 },
  ]);
  bot.salvarFluxo(semPreco.fluxo.passos);
  const fim = bot.atender('oi', { de: '5531900000003' });
  assert.equal(fim.cobranca, undefined, 'link de R$ 0,00 faria o cliente achar que o pedido foi de graça');
  assert.equal(fim.cobrancaImpossivel, 'pedido sem valor');
});

test('o cliente só ouve "paga por aqui" quando o link existe mesmo', async () => {
  const { fluxo } = fluxoDeCsv(CSV);
  bot.salvarFluxo(fluxo.passos);
  const enviados = [];
  const enviar = async ({ texto }) => { enviados.push(texto); return { ok: true }; };
  const cobrar = async (e) => ({ ok: true, pagamento: { id: 'pay_1', valorCentavos: e.valorCentavos, linkPagamento: 'https://pague.aqui/1' } });
  const de = '5531900000004';
  for (const t of ['oi', '1', '1']) {
    await atendimento.receberMensagem({ id: 'm' + Math.random(), de, texto: t, tipo: 'texto' }, { enviar, cobrar });
  }
  const ultimo = enviados.at(-1);
  assert.match(ultimo, /Total: R\$ 34,00/);
  assert.match(ultimo, /https:\/\/pague\.aqui\/1/);
});

test('gateway fora do ar não derruba o pedido: vira pagar na entrega', async () => {
  const { fluxo } = fluxoDeCsv(CSV);
  bot.salvarFluxo(fluxo.passos);
  const enviados = [];
  const enviar = async ({ texto }) => { enviados.push(texto); return { ok: true }; };
  const cobrar = async () => ({ ok: false, motivo: 'sem resposta em 15s' });
  const de = '5531900000005';
  for (const t of ['oi', '1', '2']) {
    await atendimento.receberMensagem({ id: 'm' + Math.random(), de, texto: t, tipo: 'texto' }, { enviar, cobrar });
  }
  const ultimo = enviados.at(-1);
  assert.match(ultimo, /Total: R\$ 28,00/);
  assert.match(ultimo, /pagar na entrega/i, 'o pedido não pode evaporar porque o gateway caiu');
  assert.ok(!/https?:\/\//.test(ultimo), 'não se promete link que não existe');
});
