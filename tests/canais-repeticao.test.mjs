/**
 * Nao repetir a mesma frase em seguida.
 *
 * Em campo, um cliente mandou varios audios e recebeu a MESMA frase uma vez por
 * audio, e o mesmo menu cinco vezes seguidas. Cada resposta estava
 * individualmente certa — o conjunto parecia defeito. Repetir nao informa nada
 * novo; empilhado na tela do cliente, parece robo quebrado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* Espelha a guarda de backend/canais.mjs. A regra e pequena e o que importa
   sao os limites dela — por isso testada isolada, sem subir canal nenhum. */
function criarGuarda(minutos = 5, relogio = () => Date.now()) {
  const ultima = new Map();
  return function jaDisseAgora(para, texto) {
    const t = String(texto || '').trim();
    if (!t) { return false; }
    const antes = ultima.get(para);
    const agora = relogio();
    if (antes && antes.texto === t && (agora - antes.em) / 60000 < minutos) { return true; }
    ultima.set(para, { texto: t, em: agora });
    if (ultima.size > 500) { ultima.delete(ultima.keys().next().value); }
    return false;
  };
}

test('a mesma frase em seguida NAO sai duas vezes', () => {
  const g = criarGuarda();
  assert.equal(g('5531999', 'Ainda não consigo ouvir áudio'), false, 'a primeira sai');
  assert.equal(g('5531999', 'Ainda não consigo ouvir áudio'), true, 'a segunda nao');
});

test('cinco audios seguidos viram UMA resposta', () => {
  const g = criarGuarda();
  const saiu = [1, 2, 3, 4, 5].filter(() => !g('5531999', 'Ainda não consigo ouvir áudio'));
  assert.equal(saiu.length, 1);
});

test('frase DIFERENTE passa — a guarda nao pode calar conversa de verdade', () => {
  const g = criarGuarda();
  g('5531999', 'Olá! Sou a Micaela.');
  assert.equal(g('5531999', 'Qual é o assunto financeiro?'), false);
});

test('pessoas diferentes nao se atrapalham', () => {
  const g = criarGuarda();
  g('5531999', 'Olá! Sou a Micaela.');
  assert.equal(g('5531888', 'Olá! Sou a Micaela.'), false, 'e a primeira vez PRA ELA');
});

test('passada a janela, a mesma frase pode sair de novo', () => {
  let agora = Date.now();
  const g = criarGuarda(5, () => agora);
  g('5531999', 'Olá! Sou a Micaela.');
  agora += 6 * 60000;
  assert.equal(g('5531999', 'Olá! Sou a Micaela.'), false,
    'quem volta meia hora depois merece a saudacao, nao silencio');
});

test('texto vazio nunca e tratado como repeticao', () => {
  const g = criarGuarda();
  assert.equal(g('5531999', ''), false);
  assert.equal(g('5531999', ''), false);
});

test('alternar entre duas frases nao trava nenhuma das duas', () => {
  const g = criarGuarda();
  assert.equal(g('5531999', 'A'), false);
  assert.equal(g('5531999', 'B'), false);
  assert.equal(g('5531999', 'A'), false, 'a ultima dita foi B: A nao e repeticao imediata');
});

/* ---- o log tem de NOMEAR o silencio ----

   Em campo o log dizia "o fluxo decidiu nao responder esta mensagem" quando a
   conversa estava com um ATENDENTE. Tecnicamente verdade, praticamente inutil:
   quem le precisa saber que ha uma pessoa ali. Log que descreve errado atrasa o
   diagnostico seguinte — e foi exatamente o que aconteceu hoje. */

function motivoDoSilencio(r) {
  if (!r) { return 'o atendimento nao devolveu resultado'; }
  if (r.botDesligado) { return 'o bot esta DESLIGADO na configuracao'; }
  if (r.calado || r.tipo === 'silencio' || r.emSilencio || r.silenciado) {
    return 'conversa esta com uma pessoa (silencio pos-handoff)';
  }
  if (r.respondeu === false) { return 'o fluxo decidiu nao responder esta mensagem'; }
  return 'o fluxo nao produziu resposta';
}

test('silencio pos-handoff e nomeado como tal — os dois formatos que o motor devolve', () => {
  assert.match(motivoDoSilencio({ tipo: 'silencio', calado: true, handoff: true }), /com uma pessoa/);
  assert.match(motivoDoSilencio({ tipo: 'silencio', handoff: true, respondeu: false }), /com uma pessoa/);
});

test('bot desligado continua sendo bot desligado — os dois silencios sao diferentes', () => {
  assert.match(motivoDoSilencio({ botDesligado: true }), /DESLIGADO/);
});

test('o fluxo calado por decisao propria nao vira "esta com uma pessoa"', () => {
  assert.match(motivoDoSilencio({ respondeu: false }), /o fluxo decidiu/);
});

test('sem resultado nenhum, o log diz isso em vez de inventar motivo', () => {
  assert.match(motivoDoSilencio(null), /nao devolveu resultado/);
});
