import { test } from 'node:test';
import assert from 'node:assert/strict';
import { painelQuebraGalho, QG_URL } from '../backend/quebragalho.mjs';

const resposta = (status, corpo) => async () => ({ ok: status < 400, status, json: async () => corpo });

test('sem QG_TOKEN a integracao fica desligada, com instrucao do que fazer', async () => {
  const r = await painelQuebraGalho(resposta(200, { ok: true }));
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /QG_TOKEN não está configurado/);
  assert.match(r.comoResolver, /QG_INTEGRACAO_TOKEN/);
});

test('marketplace fora do ar vira AVISO com instrucao, nao tela quebrada', async () => {
  process.env.QG_TOKEN = 'segredo';
  const mod = await import('../backend/quebragalho.mjs?fora');
  const r = await mod.painelQuebraGalho(async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /não consegui falar com o Quebra-Galho/);
  assert.match(r.comoResolver, /marketplace\/server\.mjs|QG_URL/);
  delete process.env.QG_TOKEN;
});

test('token recusado diz exatamente isso — nao "erro generico"', async () => {
  process.env.QG_TOKEN = 'segredo';
  const mod = await import('../backend/quebragalho.mjs?401');
  let n = 0;
  const r = await mod.painelQuebraGalho(async () => {
    n += 1;
    return n === 1 ? { ok: true, status: 200, json: async () => ({ ok: true }) } : { ok: false, status: 401, json: async () => ({}) };
  });
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /token de integração recusado/);
  delete process.env.QG_TOKEN;
});

test('integracao desligada do OUTRO lado é reportada como tal', async () => {
  process.env.QG_TOKEN = 'segredo';
  const mod = await import('../backend/quebragalho.mjs?503');
  let n = 0;
  const r = await mod.painelQuebraGalho(async () => {
    n += 1;
    return n === 1 ? { ok: true, status: 200, json: async () => ({ ok: true }) } : { ok: false, status: 503, json: async () => ({}) };
  });
  assert.match(r.motivo, /desligada no Quebra-Galho/);
  delete process.env.QG_TOKEN;
});

test('com token, o resumo chega e leva o cabecalho de integracao', async () => {
  process.env.QG_TOKEN = 'segredo';
  const mod = await import('../backend/quebragalho.mjs?ok');
  const headers = [];
  const r = await mod.painelQuebraGalho(async (u, o) => {
    headers.push(o?.headers || {});
    if (u.endsWith('/api/saude')) { return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return {
      ok: true, status: 200,
      json: async () => ({
        numeros: { gmvCentavos: 20500, receitaCentavos: 4100, contestacoesAbertas: 0 },
        regiao: { nome: 'BH', raioKm: 60 }, categorias: 6,
        prestadores: { total: 5, ativos: 5, emAnalise: 0 }, clientes: 2,
      }),
    };
  });
  assert.equal(r.disponivel, true);
  assert.equal(r.numeros.gmvCentavos, 20500);
  assert.equal(r.prestadores.ativos, 5);
  assert.ok(headers.every((h) => h['x-qg-token'] === 'segredo'), 'toda chamada precisa levar o token');
  delete process.env.QG_TOKEN;
});

test('NENHUM dado pessoal atravessa a fronteira entre os produtos (§31, §39)', async () => {
  process.env.QG_TOKEN = 'segredo';
  const mod = await import('../backend/quebragalho.mjs?priv');
  const r = await mod.painelQuebraGalho(async (u) => {
    if (u.endsWith('/api/saude')) { return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return {
      ok: true, status: 200,
      json: async () => ({
        numeros: { gmvCentavos: 1 }, prestadores: { total: 1, ativos: 1, emAnalise: 0 }, clientes: 1,
      }),
    };
  });
  const txt = JSON.stringify(r).toLowerCase();
  for (const proibido of ['telefone', 'email', 'documento', 'endereco', 'cpf', 'nome']) {
    assert.ok(!txt.includes(proibido), `vazou "${proibido}" para o painel do outro produto`);
  }
  delete process.env.QG_TOKEN;
});

test('a ponte fala por HTTP e nao importa codigo do marketplace', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('backend/quebragalho.mjs', 'utf8');
  assert.ok(!/from\s+'\.\.\/engine\/vsmarket/.test(src), 'o painel nao pode importar o marketplace');
  assert.ok(src.includes('QG_URL'), 'a ponte é por endereço HTTP');
  assert.equal(typeof QG_URL, 'string');
});
