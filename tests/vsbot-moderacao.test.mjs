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

test('primeira vez avisa, segunda encerra por 12 horas', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const um = avaliar('seu idiota', {}, { agora });
  assert.equal(um.acao, 'avisa');
  assert.equal(um.marcar.avisosDeRespeito, 1);
  assert.ok(!um.marcar.silenciadoAte, 'primeira vez nao cala ninguem');

  const dois = avaliar('seu idiota', um.marcar, { agora });
  assert.equal(dois.acao, 'encerra');
  assert.match(dois.texto, new RegExp(`${HORAS_DE_SILENCIO} horas`));
  const horas = (Date.parse(dois.marcar.silenciadoAte) - agora) / 3600000;
  assert.equal(horas, HORAS_DE_SILENCIO);
});

test('durante o castigo o bot fica CALADO — nao repete a bronca', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const ate = new Date(agora + 3600 * 1000).toISOString();
  const r = avaliar('oi, desculpa', { silenciadoAte: ate }, { agora });
  assert.equal(r.acao, 'calado');
  assert.equal(r.texto, undefined, 'silencio prometido e silencio cumprido');
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
  const castigo = bot.atender('seu imbecil', { de });
  assert.equal(castigo.moderacao, 'encerra');
  assert.equal(bot.atender('oi', { de }).calado, true, 'sanidade: o castigo esta valendo');

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
  assert.equal(avaliar('oi', { silenciadoAte: ate }, { agora }).acao, 'calado');
  const r = avaliar('URGENTE, preciso de ajuda', { silenciadoAte: ate }, { agora });
  assert.equal(r.acao, 'urgencia', 'do outro lado nao ha um trote: ha alguem num processo criminal');
});

test('quem ja foi encaminhado por urgencia nao leva castigo', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const r = avaliar('seu imbecil', { avisosDeRespeito: 3 }, { agora, emUrgencia: true });
  assert.equal(r.acao, 'avisa');
  assert.ok(!r.marcar.silenciadoAte, 'calar alguem no meio de uma urgencia e abandono');
  assert.ok(r.marcar.ofensaEmUrgencia);
});

test('o encerramento carrega a saida e avisa uma pessoa', () => {
  const agora = Date.parse('2026-09-23T10:00:00.000Z');
  const um = avaliar('seu idiota', {}, { agora });
  const dois = avaliar('seu idiota', um.marcar, { agora });
  assert.equal(dois.acao, 'encerra');
  assert.match(dois.texto, /URGENTE/, 'a saida tem de estar na propria mensagem');
  assert.equal(dois.avisarPessoa, true, 'encerramento que ninguem revisa vira cliente perdido');
});
