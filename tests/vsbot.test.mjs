/**
 * Motor do bot. O ponto do módulo é funcionar SEM canal: se estes testes passam,
 * o WhatsApp só troca por onde a mensagem entra e sai.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../engine/vsbot/regras.mjs';

const dir = mkdtempSync(join(tmpdir(), 'vsbot-'));
process.env.VSBOT_DIR = dir;
const bot = await import('../engine/vsbot/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

/* ---- casamento ---- */

test('acento e caixa nao atrapalham', () => {
  const r = { termos: ['preco'] };
  assert.equal(R.casa(r, 'Qual o PREÇO?'), true);
  assert.equal(R.casa(r, 'preço'), true);
  assert.equal(R.casa(r, '  Preco  '), true);
});

test('termo curto NAO casa dentro de outra palavra', () => {
  const r = { termos: ['oi'] };
  assert.equal(R.casa(r, 'oi, tudo bem?'), true);
  assert.equal(R.casa(r, 'moita'), false, '"oi" dentro de "moita" nao pode disparar');
  assert.equal(R.casa(r, 'foi voce?'), false);
});

test('gatilho exato e comeca fazem o que dizem', () => {
  assert.equal(R.casa({ termos: ['oi'], gatilho: 'exato' }, 'oi'), true);
  assert.equal(R.casa({ termos: ['oi'], gatilho: 'exato' }, 'oi tudo bem'), false);
  assert.equal(R.casa({ termos: ['quero'], gatilho: 'comeca' }, 'quero dois'), true);
  assert.equal(R.casa({ termos: ['quero'], gatilho: 'comeca' }, 'eu quero dois'), false);
});

test('mensagem vazia nao casa com nada', () => {
  assert.equal(R.casa({ termos: ['oi'] }, ''), false);
  assert.equal(R.casa({ termos: ['oi'] }, null), false);
});

/* ---- escolha ---- */

test('prioridade decide, e empate fica com a primeira cadastrada', () => {
  const regras = [
    { id: 'a', termos: ['entrega'], resposta: 'A', prioridade: 0 },
    { id: 'b', termos: ['entrega'], resposta: 'B', prioridade: 5 },
    { id: 'c', termos: ['entrega'], resposta: 'C', prioridade: 5 },
  ];
  assert.equal(R.escolher(regras, 'como e a entrega?').id, 'b');
  assert.equal(R.escolher([regras[0]], 'entrega').id, 'a');
});

test('regra desativada nao responde', () => {
  const regras = [{ id: 'x', termos: ['oi'], resposta: 'oi!', ativa: false }];
  assert.equal(R.escolher(regras, 'oi'), null);
});

/* ---- resposta ---- */

test('pedir gente GANHA de qualquer regra', () => {
  const cfg = { regras: [{ id: 'x', termos: ['atendente'], resposta: 'resposta automatica', prioridade: 99 }] };
  const r = R.responder('quero falar com um atendente', cfg);
  assert.equal(r.tipo, 'humano');
  assert.equal(r.handoff, true);
});

test('variavel sem valor fica VISIVEL em vez de virar vazio', () => {
  assert.equal(R.preencher('Olá {nome}!', { nome: 'Ana' }), 'Olá Ana!');
  assert.equal(R.preencher('Olá {nome}!', {}), 'Olá {nome}!', '"Olá !" esconde o erro');
  assert.equal(R.preencher('Olá {nome}!', { nome: '' }), 'Olá {nome}!');
});

test('catalogo so responde se houver produto', () => {
  const cfg = { usarCatalogo: true, regras: [] };
  const semProduto = R.responder('qual o preco?', cfg, { produtos: [] });
  assert.equal(semProduto.tipo, 'fallback', 'catalogo vazio e pior que nao responder');
  const comProduto = R.responder('qual o preco?', cfg, { produtos: [{ nome: 'Camiseta' }] });
  assert.equal(comProduto.tipo, 'catalogo');
  assert.equal(comProduto.produtos.length, 1);
});

test('fallback repetido chama gente — bot perdido nao segura cliente', () => {
  const cfg = { regras: [], falhasAteHumano: 2 };
  assert.equal(R.responder('xyz', cfg, { falhasSeguidas: 0 }).handoff, false);
  assert.equal(R.responder('xyz', cfg, { falhasSeguidas: 1 }).handoff, true);
});

test('conversa inteira para no handoff', () => {
  const cfg = { regras: [{ id: 'oi', termos: ['oi'], resposta: 'Olá!' }], falhasAteHumano: 2 };
  const t = R.conversar(['oi', 'abacaxi', 'banana', 'melancia'], cfg);
  assert.equal(t[0].tipo, 'regra');
  assert.equal(t.at(-1).handoff, true);
  assert.equal(t.length, 3, 'parou assim que chamou gente');
});

/* ---- persistencia ---- */

test('regra sem termo ou sem resposta e recusada', () => {
  assert.equal(bot.salvarRegra({ resposta: 'oi' }).ok, false);
  assert.equal(bot.salvarRegra({ termos: ['oi'] }).ok, false);
  assert.equal(bot.salvarRegra({ termos: ['oi'], resposta: 'x', gatilho: 'voar' }).ok, false);
});

test('salvar, editar e excluir regra', () => {
  const a = bot.salvarRegra({ termos: ['horario', 'aberto'], resposta: 'Das 9h às 18h.' });
  assert.equal(a.ok, true);
  assert.equal(a.novo, true);
  const b = bot.salvarRegra({ id: a.regra.id, termos: ['horario'], resposta: 'Das 8h às 18h.' });
  assert.equal(b.novo, false);
  assert.equal(bot.regras().length, 1);
  assert.equal(bot.regras()[0].resposta, 'Das 8h às 18h.');
  assert.equal(bot.excluirRegra('nao-existe').ok, false);
  assert.equal(bot.excluirRegra(a.regra.id).ok, true);
  assert.equal(bot.regras().length, 0);
});

test('o simulador responde com as regras gravadas, sem canal nenhum', () => {
  bot.salvarRegra({ termos: ['horario'], resposta: 'Das 9h às 18h, {nome}.' });
  const s = bot.simular(['qual o horario?'], { nome: 'Ana' });
  assert.equal(s.turnos[0].tipo, 'regra');
  assert.equal(s.turnos[0].texto, 'Das 9h às 18h, Ana.');
});

test('bot ligado e sem regra ativa e denunciado no painel', () => {
  bot.regras().forEach((r) => bot.excluirRegra(r.id));
  bot.salvarConfig({ ativo: true });
  const p = bot.painel();
  assert.equal(p.pronto, false);
  assert.match(p.aviso, /nenhuma regra ativa/);
  bot.salvarRegra({ termos: ['oi'], resposta: 'Olá!' });
  assert.equal(bot.painel().pronto, true);
  assert.equal(bot.painel().aviso, null);
});

test('config recusa numero sem sentido', () => {
  assert.equal(bot.salvarConfig({ falhasAteHumano: 0 }).ok, false);
  assert.equal(bot.salvarConfig({ falhasAteHumano: 3 }).ok, true);
});
