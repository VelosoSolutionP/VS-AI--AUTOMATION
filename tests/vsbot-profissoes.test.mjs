import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montar, montarFluxo, PROFISSOES, JEITOS } from '../engine/vsbot/profissoes.mjs';
import { validarFluxo, comPrecosDoCatalogo, avancar } from '../engine/vsbot/fluxo.mjs';

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

const PRODS = [
  { sku: 'a', nome: 'X-Tudo', categoria: 'Lanches', precoCentavos: 3200 },
  { sku: 'b', nome: 'Refri', categoria: 'Bebidas', precoCentavos: 800 },
];

test('fluxo pronto: toda profissão × jeito × catálogo passa na validação do fluxo', () => {
  for (const profissao of Object.keys(PROFISSOES)) {
    for (const jeito of Object.keys(JEITOS)) {
      for (const produtos of [PRODS, [PRODS[0]], [], [{ sku: 'c', nome: 'Sem categoria', precoCentavos: 100 }]]) {
        const r = montarFluxo({ nome: 'Micaela', profissao, jeito, loja: 'Bolso Cheio', produtos });
        assert.equal(r.ok, true);
        assert.deepEqual(validarFluxo(r.passos).erros, [], `${profissao}/${jeito}/${produtos.length}`);
        assert.equal(r.passos[0].id, 'inicio');
        assert.match(r.passos[0].mensagem, /Micaela/);
        assert.ok(!r.passos.some((p) => [p.acao, ...(p.opcoes || []).map((o) => o.acao)].includes('cobrar')), 'nada cobra sem gente');
      }
    }
  }
});

test('fluxo pronto: a abertura não repete a pergunta da saudação', () => {
  for (const jeito of Object.keys(JEITOS)) {
    const m = montarFluxo({ nome: 'Ana', profissao: 'atendente', jeito, produtos: PRODS }).passos[0].mensagem;
    assert.equal((m.match(/\?/g) || []).length <= 2, true, m);
    assert.doesNotMatch(m, /ajudar\?[\s\S]*ajudar\?/);
  }
});

test('fluxo pronto: o menu de produtos é o Estoque da loja, por categoria, com o preço de agora', () => {
  const r = montarFluxo({ nome: 'Mica', profissao: 'vendedora', jeito: 'meio', produtos: PRODS });
  assert.deepEqual(r.categorias, ['Lanches', 'Bebidas']);
  const fx = comPrecosDoCatalogo(validarFluxo(r.passos).fluxo, [{ ...PRODS[0], precoCentavos: 3500 }, PRODS[1]]);
  let s = avancar(fx, {}, 'oi');
  s = avancar(fx, { passo: s.passo }, '1');
  assert.match(s.texto, /1 - Lanches[\s\S]*2 - Bebidas/);
  s = avancar(fx, { passo: s.passo }, '1');
  assert.match(s.texto, /X-Tudo — R\$ 35,00/, 'preço vem do Estoque, não do fluxo');
  s = avancar(fx, { passo: s.passo }, '1');
  assert.deepEqual(s.item, { nome: 'X-Tudo', valorCentavos: 3500 });
  s = avancar(fx, { passo: s.passo }, '1');
  assert.equal(s.coletando, true);
  s = avancar(fx, { passo: s.passo, coletando: true }, 'Fabiano');
  assert.equal(s.handoff, true);
  assert.equal(s.departamento, 'vendas');
});

test('fora do horário não chuta o gênero do nome', () => {
  for (const jeito of Object.keys(JEITOS)) {
    assert.doesNotMatch(montar({ nome: 'Micaela', profissao: 'atendente', jeito }).config.mensagemFechado, /\b[oa] Micaela\b/);
  }
});

test('sem loja não inventa nome de loja', () => {
  const r = montar({ nome: 'Leo', profissao: 'suporte', jeito: 'meio' });
  assert.match(r.config.saudacao, /nossa equipe/);
});
