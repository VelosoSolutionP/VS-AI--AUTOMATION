/**
 * Jogo de cintura: a IA local so ENTENDE qual opcao a pessoa quis. Quem fala com
 * o cliente continua sendo o fluxo. Aqui a IA e um duble — o teste nao depende
 * do Ollama estar no ar, e prova o que importa: quando ela e consultada, o que
 * acontece com a resposta dela, e que ela nunca passa por cima das regras.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'cerebro-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

const bot = await import('../engine/vsbot/index.mjs');
const { escolherOpcao } = await import('../engine/vsbot/cerebro.mjs');

bot.salvarFluxo([
  { id: 'inicio', mensagem: 'Oi! Escolha:', opcoes: [
    { tecla: '1', texto: 'Suporte técnico', vaiPara: 'sup' },
    { tecla: '2', texto: 'Financeiro', vaiPara: 'fin' },
  ] },
  { id: 'sup', mensagem: 'Me conta o problema.', acao: 'coletar', vaiPara: 'fin' },
  { id: 'fin', mensagem: 'Passando pro financeiro.', acao: 'encaminhar', departamento: 'financeiro' },
]);
const ligar = (extra = {}) => bot.salvarConfig({ ativo: true, nome: 'Mica', assinarMensagens: false, cerebro: { ligado: true }, ...extra });

const duble = (tecla) => {
  const chamadas = [];
  const escolher = async (texto, opcoes) => { chamadas.push({ texto, opcoes }); return { tecla, ms: 5 }; };
  return { chamadas, escolher };
};

test('no meio do menu, frase que o fluxo nao entende vira a opcao que a IA escolheu — com o texto DO FLUXO', async () => {
  ligar();
  const de = '5531900000401';
  await bot.atenderComCerebro('oi', { de }, duble('1'));
  const d = duble('1');
  const r = await bot.atenderComCerebro('o sistema ta dando pau', { de }, d);
  assert.equal(d.chamadas.length, 1);
  assert.deepEqual(d.chamadas[0].opcoes.map((o) => o.tecla), ['1', '2'], 'so as opcoes DAQUELE passo');
  assert.match(r.texto, /Me conta o problema/, 'quem responde e o fluxo, nao a IA');
  assert.equal(r.entendidoPorIA.tecla, '1');
  assert.ok(!r.erroDeEscolha);
});

test('primeira mensagem que ja diz o que quer pula o menu', async () => {
  ligar();
  const r = await bot.atenderComCerebro('minha fatura veio errada', { de: '5531900000402' }, duble('2'));
  assert.match(r.texto, /financeiro/i);
});

test('IA diz "nenhuma" ou esta fora do ar: e o fluxo de sempre, com o menu', async () => {
  ligar();
  const de = '5531900000403';
  await bot.atenderComCerebro('oi', { de }, duble(null));
  const r = await bot.atenderComCerebro('banana', { de }, duble(null));
  assert.equal(r.erroDeEscolha, true);
  const fora = await escolherOpcao('qualquer', [{ tecla: '1', texto: 'x' }], { url: 'http://127.0.0.1:9', timeoutMs: 500 });
  assert.equal(fora.tecla, null);
  assert.ok(fora.erro, 'fora do ar devolve null com o motivo, nao quebra');
});

test('a IA nunca e consultada por cima das regras: tecla, saudacao, ofensa, pedido de gente, pausa', async () => {
  ligar();
  const de = '5531900000404';
  const d = duble('2');
  await bot.atenderComCerebro('oi', { de }, d);
  await bot.atenderComCerebro('1', { de: '5531900000405' }, d);
  await bot.atenderComCerebro('sua vaca', { de }, d);
  await bot.atenderComCerebro('quero falar com um atendente', { de: '5531900000406' }, d);
  assert.equal(d.chamadas.length, 0);
});

test('desligada na configuracao: nem consulta', async () => {
  bot.salvarConfig({ cerebro: { ligado: false } });
  const d = duble('1');
  await bot.atenderComCerebro('o sistema ta dando pau', { de: '5531900000407' }, d);
  assert.equal(d.chamadas.length, 0);
});

test('escolherOpcao so aceita opcao que EXISTE no passo', async () => {
  const falso = async () => ({ ok: true, json: async () => ({ message: { content: '{"opcao":"Opção inventada"}' } }) });
  const r = await escolherOpcao('x', [{ tecla: '1', texto: 'Suporte' }], {}, { fetch: falso });
  assert.equal(r.tecla, null);
  const certo = async () => ({ ok: true, json: async () => ({ message: { content: '{"opcao":"Suporte"}' } }) });
  assert.equal((await escolherOpcao('x', [{ tecla: '1', texto: 'Suporte' }], {}, { fetch: certo })).tecla, '1');
});

test('voltou depois de encerrado com fila: NAO volta pra fila sozinho, e a resposta nao some', async () => {
  ligar();
  const proto = await import('../engine/vsprotocolo/index.mjs');
  const de = '5531900000410';
  await bot.atenderComCerebro('oi', { de }, duble(null));
  // estava na fila esperando gente e o atendimento foi encerrado (inatividade)
  const p = proto.aberto(de);
  proto.anotar(p.numero, { estado: proto.ESTADOS.NA_FILA, departamento: 'humano' });
  proto.encerrarPorNumero(p.numero, { motivo: 'inatividade' });
  const r = await bot.atenderComCerebro('minha fatura veio errada', { de }, duble('2'));
  assert.ok(!r.calado, 'resposta nao pode sumir');
  assert.match(r.texto, /financeiro/i, 'conversa nova, e a IA leva pra opcao certa');
});

test('quem LIGA voltar pra fila recebe a retomada, e ela nao e engolida', async () => {
  ligar({ voltarParaFilaAoRetornar: true });
  const proto = await import('../engine/vsprotocolo/index.mjs');
  const de = '5531900000411';
  await bot.atenderComCerebro('oi', { de }, duble(null));
  const p = proto.aberto(de);
  proto.anotar(p.numero, { estado: proto.ESTADOS.NA_FILA, departamento: 'humano' });
  proto.encerrarPorNumero(p.numero, { motivo: 'inatividade' });
  const r = await bot.atenderComCerebro('minha fatura veio errada', { de }, duble('2'));
  assert.match(r.texto, /Achei seu atendimento/, 'a frase de retomada chega ao cliente');
  bot.salvarConfig({ voltarParaFilaAoRetornar: false });
});

test('primeira mensagem com a palavra da opcao: o dicionario resolve na hora, sem gastar a IA', async () => {
  ligar();
  const d = duble('1');
  const r = await bot.atenderComCerebro('preciso resolver uma coisa do financeiro', { de: '5531900000420' }, d);
  assert.equal(d.chamadas.length, 0, 'palavra que esta na opcao nao precisa de IA');
  assert.match(r.texto, /financeiro/i);
  assert.equal(r.entendidoPorIA.via, 'dicionario');
});

test('a IA recebe o que cada opcao INCLUI (as sub-opcoes do caminho), nao so o titulo', async () => {
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Oi!', opcoes: [
      { tecla: '1', texto: 'Outras soluções', vaiPara: 'sol' },
      { tecla: '2', texto: 'Já sou cliente', vaiPara: 'cli' },
    ] },
    { id: 'sol', mensagem: 'O que procura?', opcoes: [{ tecla: '1', texto: 'Sistema para salão', vaiPara: 'fim' }] },
    { id: 'cli', mensagem: 'O que precisa?', opcoes: [{ tecla: '1', texto: 'Erro no sistema', vaiPara: 'fim' }] },
    { id: 'fim', mensagem: 'Ok!', acao: 'fim' },
  ]);
  ligar();
  const d = duble('1');
  await bot.atenderComCerebro('tem algo pro meu negocio de beleza?', { de: '5531900000421' }, d);
  assert.equal(d.chamadas.length, 1);
  assert.match(d.chamadas[0].opcoes[0].sobre, /Sistema para salão/);
  assert.match(d.chamadas[0].opcoes[1].sobre, /Erro no sistema/);
});
