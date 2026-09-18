import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VSCRM_DIR = mkdtempSync(join(tmpdir(), 'vscrm-p-'));

import {
  gerarCodigo, validarRegra, normalizarRegra, comissao, linkDe, novoParceiro, resumoParceiros,
} from '../engine/vscrm/parceiros.mjs';
import { normalizarTelefone } from '../engine/vscrm/leads.mjs';

const REGRA_PCT = { modelo: 'percentual', percentual: 20, quando: 'primeira', linkBase: 'https://velososolution.online' };

test('codigo sai do nome, sem acento nem espaco', () => {
  assert.equal(gerarCodigo('João Vendas Ltda'), 'joao-vendas-ltda');
  assert.equal(gerarCodigo('Ana', ['ana']), 'ana-2');
  assert.equal(gerarCodigo('', []), 'parceiro');
});

test('regra invalida e recusada com o motivo', () => {
  assert.match(validarRegra({}).erros.join(), /modelo/);
  assert.match(validarRegra({ modelo: 'percentual', percentual: 0, quando: 'sempre' }).erros.join(), /entre 0 e 100/);
  assert.match(validarRegra({ modelo: 'percentual', percentual: 150, quando: 'sempre' }).erros.join(), /entre 0 e 100/);
  assert.match(validarRegra({ modelo: 'fixo', valorFixo: -5, quando: 'sempre' }).erros.join(), /maior que zero/);
  assert.match(validarRegra({ modelo: 'fixo', valorFixo: 50, quando: 'talvez' }).erros.join(), /primeira.*sempre/);
  assert.match(validarRegra({ ...REGRA_PCT, linkBase: 'velososolution.online' }).erros.join(), /http/);
  assert.equal(validarRegra(REGRA_PCT).ok, true);
});

test('normalizar limpa a barra final do link e tipa os numeros', () => {
  const { regra } = normalizarRegra({ ...REGRA_PCT, linkBase: 'https://velososolution.online/', percentual: '20' });
  assert.equal(regra.linkBase, 'https://velososolution.online');
  assert.equal(regra.percentual, 20);
  assert.equal(regra.valorFixo, null);
});

test('comissao percentual e fixa', () => {
  assert.equal(comissao(1000, REGRA_PCT, 1).valor, 200);
  assert.equal(comissao(1490, { modelo: 'fixo', valorFixo: 100, quando: 'sempre' }, 3).valor, 100);
});

test('sem regra a comissao e null com motivo — nunca um palpite', () => {
  const r = comissao(1000, null);
  assert.equal(r.valor, null);
  assert.match(r.motivo, /nao definida/);
  assert.equal(comissao(null, REGRA_PCT).valor, null);
});

test('regra "primeira" nao paga a partir da segunda venda', () => {
  assert.equal(comissao(1000, REGRA_PCT, 2).valor, 0);
  assert.equal(comissao(1000, { ...REGRA_PCT, quando: 'sempre' }, 2).valor, 200);
});

test('link exige linkBase cadastrado', () => {
  assert.equal(linkDe({ codigo: 'ana' }, { modelo: 'fixo' }).link, null);
  assert.equal(linkDe({ codigo: 'ana' }, REGRA_PCT).link, 'https://velososolution.online/?ref=ana');
});

test('parceiro exige nome e normaliza o telefone com DDI', () => {
  assert.match(novoParceiro({ nome: '' }, [], normalizarTelefone).erro, /nome/);
  const { parceiro } = novoParceiro({ nome: 'Ana', telefone: '31975127978' }, [], normalizarTelefone);
  assert.equal(parceiro.codigo, 'ana');
  assert.equal(parceiro.telefone, '5531975127978');
});

test('codigo duplicado e recusado', () => {
  const existentes = [{ codigo: 'ana' }];
  assert.match(novoParceiro({ nome: 'Ana', codigo: 'ana' }, existentes, normalizarTelefone).erro, /ja existe/);
});

test('resumo nao inventa zero quando ninguem tem ganho lancado', () => {
  assert.equal(resumoParceiros([{ indicados: 2 }, { indicados: 1 }]).aPagar, null);
  assert.equal(resumoParceiros([{ indicados: 2, ganhoAcumulado: 200 }]).aPagar, 200);
  assert.equal(resumoParceiros([]).parceiros, 0);
});
