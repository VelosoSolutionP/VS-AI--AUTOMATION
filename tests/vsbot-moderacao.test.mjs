/**
 * Respeito no atendimento — e os limites dele.
 *
 * O caso que mais importa aqui não é o xingamento: é o cliente COM CONTRATO.
 * Um robô decidir parar de atender quem já pagou cria problema com a OAB e com
 * o cliente, e é o tipo de regra que só se descobre quebrada depois.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'moderacao-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import { ehOfensa, avaliar, HORAS_DE_SILENCIO } from '../engine/vsbot/moderacao.mjs';

test('ofensa dirigida a quem atende conta; desabafo sobre a situacao nao', () => {
  assert.equal(ehOfensa('vai se foder'), true);
  assert.equal(ehOfensa('seu imbecil'), true);
  assert.equal(ehOfensa('FDP'), true);
  assert.equal(ehOfensa('f  d  p'), false, 'sem exagerar: separado por espaco vira falso positivo facil');
  assert.equal(ehOfensa('vagabundoooooo'), true, 'letra repetida e a mesma ofensa');

  // Estes NAO sao ofensa a ninguem — e barrar aqui calaria gente no pior dia dela.
  assert.equal(ehOfensa('que merda'), false);
  assert.equal(ehOfensa('caralho'), false);
  assert.equal(ehOfensa('preciso de ajuda urgente'), false);
  assert.equal(ehOfensa(''), false);
});

test('palavra dentro de outra nao dispara', () => {
  assert.equal(ehOfensa('vou pegar o burro de carga amanha'), true, 'sanidade: "burro" isolado conta');
  assert.equal(ehOfensa('moro em Burrolandia'), false, 'nao pode casar no meio da palavra');
});

test('avisa duas vezes (textos diferentes) e na terceira encerra com a pausa padrao de 2 horas', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const um = avaliar('seu idiota', {}, { agora });
  assert.equal(um.acao, 'avisa');
  assert.ok(!um.marcar.silenciadoAte, 'primeira vez nao cala ninguem');
  const dois = avaliar('seu idiota', um.marcar, { agora });
  assert.equal(dois.acao, 'avisa');
  assert.notEqual(dois.texto, um.texto, 'a mesma bronca duas vezes soa robo');
  assert.match(dois.texto, /Último aviso/);
  const tres = avaliar('seu idiota', dois.marcar, { agora });
  assert.equal(tres.acao, 'encerra');
  assert.equal(HORAS_DE_SILENCIO, 2);
  assert.equal((Date.parse(tres.marcar.silenciadoAte) - agora) / 3600000, 2);
  assert.match(tres.texto, /2 horas/);
});

test('avisos e horas de pausa sao os que o CLIENTE configurou', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const limites = { avisosAntesDePausa: 0, horasDePausa: 5 };
  const r = avaliar('seu idiota', {}, { agora, limites });
  assert.equal(r.acao, 'encerra', 'zero avisos = encerra na primeira');
  assert.equal((Date.parse(r.marcar.silenciadoAte) - agora) / 3600000, 5);
});

test('na pausa responde UMA vez com a hora de voltar e depois fica calado', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const ate = new Date(agora + 3600 * 1000).toISOString();
  const r = avaliar('oi, desculpa', { silenciadoAte: ate }, { agora });
  assert.equal(r.acao, 'pausa', 'ninguem fica no vacuo sem saber por que');
  assert.match(r.texto, /a partir das \d{2}:\d{2}/);
  const r2 = avaliar('oi?', { silenciadoAte: ate, ...r.marcar }, { agora });
  assert.equal(r2.acao, 'calado', 'repetir a mesma frase a cada mensagem e ser chato');
  assert.equal(r2.texto, undefined);
});

test('passado o prazo, volta a atender normalmente', () => {
  const agora = Date.parse('2026-09-24T10:00:00.000Z');
  const ate = new Date(Date.parse('2026-09-23T22:00:00.000Z')).toISOString();
  assert.equal(avaliar('oi, quero marcar consulta', { silenciadoAte: ate }, { agora }).acao, 'segue');
});

test('cliente COM CONTRATO nunca e encerrado por robo', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  let estado = {};
  for (let i = 0; i < 4; i += 1) {
    const r = avaliar('seu incompetente', estado, { agora, temContrato: true });
    assert.equal(r.acao, 'avisa', `na ${i + 1}a vez ainda nao pode encerrar`);
    assert.ok(!r.marcar.silenciadoAte, 'contrato ativo nao vira silencio');
    assert.ok(r.marcar.ofensaComContrato, 'mas fica marcado pra uma pessoa decidir');
    estado = r.marcar;
  }
  assert.equal(estado.avisosDeRespeito, 4, 'as vezes sao contadas do mesmo jeito');
});

/* ---- o que o teste em campo pegou e o codigo nao ---- */

import { ehAssedio } from '../engine/vsbot/moderacao.mjs';
import { detectar, resposta } from '../engine/vsbot/emergencia.mjs';

test('cantada fecha a porta em vez de repetir o menu', () => {
  /* Em campo: "Quero sair com a Advogada" recebeu "nao achei nas opcoes" e o
     menu de volta. Parece que a mensagem passou, e convida a insistir. */
  assert.equal(ehAssedio('Quero sair com a Advogada'), true);
  assert.equal(ehAssedio('voce e gostosa'), true);
  assert.equal(ehAssedio('me manda uma foto sua'), true);
  assert.equal(ehAssedio('quero marcar uma consulta'), false);

  const r = avaliar('Quero sair com a Advogada', {}, {});
  assert.equal(r.tipo, 'assedio');
  assert.match(r.texto, /assuntos do escritório/i);
  assert.ok(!/\d\s*-\s/.test(r.texto), 'nao pode vir menu junto');
});

test('diminutivo nao suaviza ofensa', () => {
  // "Sua cachorrinha" passou batido no primeiro teste real.
  assert.equal(ehOfensa('Sua cachorrinha'), true);
  assert.equal(ehOfensa('sua cadela'), true);
});

/* ---- socorro: o silencio que quase custou caro ---- */

test('pedido de socorro e reconhecido, com o telefone certo pra cada caso', () => {
  assert.equal(detectar('socorro').tipo, 'violencia');
  assert.equal(detectar('tão me agredindo').tipo, 'violencia');
  assert.equal(detectar('vão me matar').tipo, 'violencia');
  // Violencia domestica tem 180: mandar ligar 190 com o agressor ao lado e pior.
  assert.equal(detectar('meu marido está me batendo').tipo, 'violencia_mulher');
  assert.equal(detectar('ele vai me matar').tipo, 'violencia_mulher');
  assert.equal(detectar('está passando mal').tipo, 'saude');
  assert.equal(detectar('quero marcar consulta').emergencia, false);
  assert.equal(detectar('').emergencia, false);
});

test('a resposta poe o telefone na PRIMEIRA linha', () => {
  const t = resposta(detectar('socorro'));
  assert.match(t.split('\n')[0], /190/, 'quem esta em perigo le uma linha, nao um paragrafo');
  assert.match(resposta(detectar('meu marido está me batendo')).split('\n')[0], /180/);
  assert.match(resposta(detectar('desmaiou')).split('\n')[0], /192/);
});

test('socorro ganha do castigo de 12 horas', async () => {
  /* Quem esta sendo agredido nao perde o direito de resposta porque xingou o
     atendimento ontem. Este e o caso que justifica a ordem no `atender`. */
  const bot = await import('../engine/vsbot/index.mjs');
  bot.salvarFluxo([{ id: 'inicio', mensagem: 'Oi', acao: 'fim' }]);
  bot.salvarConfig({ ativo: true, nome: 'Gael', assinatura: '' });
  const de = '5531900000099';
  bot.atender('seu idiota', { de });
  bot.atender('seu idiota', { de });
  const castigo = bot.atender('seu imbecil', { de });
  assert.equal(castigo.moderacao, 'encerra');
  assert.equal(bot.atender('oi', { de }).tipo, 'moderacao:pausa', 'sanidade: a pausa esta valendo');
  assert.equal(bot.atender('oi', { de }).calado, true);

  const sos = bot.atender('socorro, vão me matar', { de });
  assert.equal(sos.tipo, 'emergencia');
  assert.equal(sos.prioridade, 'maxima');
  assert.match(sos.texto, /190/);
});

test('a resposta de emergencia nao leva assinatura na frente', async () => {
  const bot = await import('../engine/vsbot/index.mjs');
  bot.salvarConfig({ ativo: true, nome: 'Gael', assinarMensagens: true });
  const r = bot.atender('socorro', { de: '5531900000098' });
  assert.ok(!r.texto.startsWith('*Gael:*'), 'assinatura roubaria a linha que a pessoa vai ler');
  assert.match(r.texto.split('\n')[0], /LIGUE 190/);
});

/* ---- castigo nao pode virar porta trancada ---- */

test('"urgente" atravessa o castigo e chama gente', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const ate = new Date(agora + 6 * 3600 * 1000).toISOString();
  assert.equal(avaliar('oi', { silenciadoAte: ate, avisouPausa: true }, { agora }).acao, 'calado');
  const r = avaliar('URGENTE, preciso de ajuda', { silenciadoAte: ate, avisouPausa: true }, { agora });
  assert.equal(r.acao, 'urgencia', 'do outro lado nao ha um trote: ha alguem num processo criminal');
});

test('quem ja foi encaminhado por urgencia nao leva castigo', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const r = avaliar('seu imbecil', { avisosDeRespeito: 3 }, { agora, emUrgencia: true });
  assert.equal(r.acao, 'avisa');
  assert.ok(!r.marcar.silenciadoAte, 'calar alguem no meio de uma urgencia e abandono');
  assert.ok(r.marcar.ofensaEmUrgencia);
});

test('o encerramento carrega a saida URGENTE e nao joga ninguem na fila', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const r = avaliar('seu idiota', { avisosDeRespeito: 2 }, { agora });
  assert.equal(r.acao, 'encerra');
  assert.match(r.texto, /URGENTE/, 'a saida tem de estar na propria mensagem');
  assert.ok(!r.avisarPessoa && !r.handoff, 'encerrou, acabou: sem fila');
});

/* ---- ponta a ponta no atendimento: a regra da casa inteira ---- */

const fluxoMenu = [
  { id: 'inicio', mensagem: 'Oi! Escolha:', opcoes: [
    { tecla: '1', texto: 'Suporte', vaiPara: 'sup' },
    { tecla: '2', texto: 'Comercial', vaiPara: 'com' },
  ] },
  { id: 'sup', mensagem: 'Me conta o problema.', acao: 'coletar', vaiPara: 'com' },
  { id: 'com', mensagem: 'Passando pro comercial.', acao: 'encaminhar', departamento: 'comercial' },
];

test('3a ofensa encerra SEM fila, a pausa responde uma vez, e depois dela comeca do zero', async () => {
  const bot = await import('../engine/vsbot/index.mjs');
  const proto = await import('../engine/vsprotocolo/index.mjs');
  bot.salvarFluxo(fluxoMenu);
  bot.salvarConfig({ ativo: true, nome: 'Mica', assinarMensagens: false, avisosAntesDePausa: 2, horasDePausa: 2 });
  const de = '5531900000301';
  bot.atender('oi', { de });
  assert.equal(bot.atender('sua vaca', { de }).tipo, 'moderacao:aviso');
  assert.equal(bot.atender('sua vaca', { de }).tipo, 'moderacao:aviso');
  const fim = bot.atender('sua vaca', { de });
  assert.equal(fim.moderacao, 'encerra');
  assert.ok(!fim.handoff, 'encerrado nao vai pra fila');
  assert.equal(proto.aberto(de), null, 'o protocolo foi fechado');

  const antes = proto.listar().filter((p) => p.de === de).length;
  const p1 = bot.atender('oi?', { de });
  assert.equal(p1.tipo, 'moderacao:pausa');
  assert.match(p1.texto, /a partir das/);
  assert.equal(bot.atender('alo', { de }).calado, true, 'nao repete');
  assert.equal(proto.listar().filter((p) => p.de === de).length, antes, 'pausa nao abre protocolo a cada mensagem');

  const real = Date.now;
  Date.now = () => real() + 3 * 3600 * 1000;
  try {
    const volta = bot.atender('oi', { de });
    assert.match(volta.texto, /Escolha/, 'passada a pausa, atende do zero, com o menu');
    assert.ok(!volta.handoff, 'e nao volta pra fila');
    assert.equal(bot.atender('sua vaca', { de }).tipo, 'moderacao:aviso', 'contagem zerada: comeca pelo primeiro aviso');
  } finally { Date.now = real; }
});

test('opcao errada seguida: menu sem bronca, aviso antes do limite, e no limite encerra com pausa', async () => {
  const bot = await import('../engine/vsbot/index.mjs');
  bot.salvarFluxo(fluxoMenu);
  bot.salvarConfig({ ativo: true, nome: 'Mica', assinarMensagens: false, errosDeOpcaoAtePausa: 4, horasDePausa: 2 });
  const de = '5531900000302';
  bot.atender('oi', { de });
  const e1 = bot.atender('banana', { de });
  assert.ok(e1.erroDeEscolha && !/encerro/.test(e1.texto), 'errar uma vez e normal');
  bot.atender('abacaxi', { de });
  const e3 = bot.atender('xyz', { de });
  assert.match(e3.texto, /encerro o atendimento/, 'avisa antes de encerrar');
  const e4 = bot.atender('kkkk', { de });
  assert.equal(e4.moderacao, 'encerra');
  assert.equal(e4.motivoModeracao, 'opcoes');
  assert.ok(!e4.handoff);

  // acertar zera a contagem
  const de2 = '5531900000303';
  bot.atender('oi', { de: de2 });
  bot.atender('banana', { de: de2 });
  bot.atender('banana', { de: de2 });
  bot.atender('3', { de: de2 });
  assert.ok(!bot.atender('1', { de: de2 }).moderacao, 'escolheu certo: segue o fluxo');
});

test('cliente com contrato nao e encerrado por errar as opcoes', async () => {
  const bot = await import('../engine/vsbot/index.mjs');
  bot.salvarFluxo(fluxoMenu);
  bot.salvarConfig({ ativo: true, nome: 'Mica', assinarMensagens: false, errosDeOpcaoAtePausa: 2 });
  const de = '5531900000304';
  bot.atender('oi', { de, temContrato: true });
  for (let i = 0; i < 4; i += 1) {
    assert.ok(!bot.atender('banana', { de, temContrato: true }).moderacao);
  }
});

test('configuracao recusa limite absurdo', async () => {
  const bot = await import('../engine/vsbot/index.mjs');
  assert.equal(bot.salvarConfig({ horasDePausa: 0 }).ok, false);
  assert.equal(bot.salvarConfig({ errosDeOpcaoAtePausa: 1 }).ok, false);
  assert.equal(bot.salvarConfig({ avisosAntesDePausa: -1 }).ok, false);
  assert.equal(bot.salvarConfig({ avisosAntesDePausa: 3, horasDePausa: 1.5, errosDeOpcaoAtePausa: 5 }).ok, true);
});
