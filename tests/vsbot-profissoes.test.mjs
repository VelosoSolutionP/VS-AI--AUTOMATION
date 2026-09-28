import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montar, PROFISSOES, JEITOS } from '../engine/vsbot/profissoes.mjs';
import { responder, cumprimento } from '../engine/vsbot/regras.mjs';

const CAMPOS = ['persona', 'saudacao', 'mensagemFallback', 'mensagemHandoff', 'mensagemCatalogo', 'mensagemSemTexto', 'mensagemFechado'];

test('toda profissão × jeito gera todos os textos, com nome e sem sobra de variável', () => {
  for (const profissao of Object.keys(PROFISSOES)) {
    for (const jeito of Object.keys(JEITOS)) {
      const r = montar({ nome: 'Micaela', profissao, jeito, loja: 'Bolso Cheio' });
      assert.equal(r.ok, true);
      for (const c of CAMPOS) { assert.ok(r.config[c]?.length > 10, `${profissao}/${jeito}/${c}`); }
      assert.match(r.config.saudacao, /Micaela/);
      assert.match(r.config.saudacao, /Bolso Cheio/);
      assert.match(r.config.mensagemFechado, /\{horario\}/, 'o bot troca {horario} na hora');
      assert.doesNotMatch(Object.values(r.config).join(' '), /undefined|null/);
    }
  }
});

test('sério não usa emoji; brincalhão usa', () => {
  const emoji = /\p{Extended_Pictographic}/u;
  const s = montar({ nome: 'Ana', profissao: 'recepcionista', jeito: 'serio' }).config;
  const b = montar({ nome: 'Ana', profissao: 'recepcionista', jeito: 'brincalhao' }).config;
  for (const c of CAMPOS) { assert.doesNotMatch(s[c], emoji, c); }
  assert.match(b.saudacao, emoji);
});

test('sem nome, profissão ou jeito válido: recusa com o motivo', () => {
  assert.equal(montar({ profissao: 'vendedora', jeito: 'meio' }).ok, false);
  assert.equal(montar({ nome: 'X', profissao: 'astronauta', jeito: 'meio' }).ok, false);
  assert.equal(montar({ nome: 'X', profissao: 'vendedora', jeito: 'grosso' }).ok, false);
});

test('sem loja não inventa nome de loja', () => {
  const r = montar({ nome: 'Leo', profissao: 'suporte', jeito: 'meio' });
  assert.match(r.config.saudacao, /nossa equipe/);
});

test('cada profissão fala da sua profissão: textos diferentes no mesmo jeito', () => {
  for (const jeito of Object.keys(JEITOS)) {
    const vistos = new Set();
    for (const profissao of Object.keys(PROFISSOES)) {
      const c = montar({ nome: 'Ana', profissao, jeito }).config;
      const chave = c.mensagemFallback + c.mensagemSemTexto;
      assert.ok(!vistos.has(chave), `${profissao}/${jeito} repete outra profissão`);
      vistos.add(chave);
    }
  }
  assert.match(montar({ nome: 'Leo', profissao: 'suporte', jeito: 'serio' }).config.saudacao, /número do pedido/);
  assert.match(montar({ nome: 'Leo', profissao: 'consultor', jeito: 'serio' }).config.saudacao, /marca e modelo/);
});

test('o "não entendi" do atendente não cita opções (só vale na loja sem fluxo)', () => {
  for (const profissao of Object.keys(PROFISSOES)) {
    for (const jeito of Object.keys(JEITOS)) {
      assert.doesNotMatch(montar({ nome: 'Ana', profissao, jeito }).config.mensagemFallback, /número d[ae] uma das opç|uma das opções/i,`${profissao}/${jeito}`);
    }
  }
});

test('saudação começa com {cumprimento}, e ele sai pela hora de Brasília', () => {
  const br = (hhmm) => new Date(`2026-09-28T${hhmm}:00-03:00`);
  assert.equal(cumprimento(br('08:00')), 'Bom dia');
  assert.equal(cumprimento(br('11:59')), 'Bom dia');
  assert.equal(cumprimento(br('12:00')), 'Boa tarde');
  assert.equal(cumprimento(br('17:59')), 'Boa tarde');
  assert.equal(cumprimento(br('18:00')), 'Boa noite');
  assert.equal(cumprimento(br('02:00')), 'Boa noite', 'madrugada é boa noite, não bom dia');
  for (const jeito of Object.keys(JEITOS)) {
    assert.match(montar({ nome: 'Ana', profissao: 'vendedora', jeito }).config.saudacao, /^\{cumprimento\}!/);
  }
});

test('sem fluxo: "oi" recebe a saudação do atendente, não o "não entendi"; regra da loja pra "oi" vence', () => {
  const cfg = montar({ nome: 'Micaela', profissao: 'vendedora', jeito: 'meio', loja: 'Bolso Cheio' }).config;
  for (const oi of ['oi', 'Olá!', 'bom dia', 'boa tarde, tudo bem?']) {
    const r = responder(oi, cfg, { cumprimento: 'Boa tarde' });
    assert.equal(r.tipo, 'saudacao', oi);
    assert.match(r.texto, /^Boa tarde! Eu sou Micaela, vendedora da equipe Bolso Cheio/);
    assert.doesNotMatch(r.texto, /\{/, 'nenhuma variável sobrando');
  }
  assert.equal(responder('oi, tem ração de cachorro?', cfg).tipo, 'fallback', 'pedido com "oi" na frente não é só saudação');
  const comRegra = { ...cfg, regras: [{ id: 'r1', termos: ['oi'], resposta: 'Oi da loja', ativa: true }] };
  assert.equal(responder('oi', comRegra).texto, 'Oi da loja');
});
