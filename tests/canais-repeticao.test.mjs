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
