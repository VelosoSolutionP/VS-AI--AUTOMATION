import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montar, PROFISSOES, JEITOS } from '../engine/vsbot/profissoes.mjs';

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
