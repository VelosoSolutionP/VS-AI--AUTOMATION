/**
 * Operadores humanos — quem recebe o cliente quando a Micaela passa adiante.
 *
 * O que estes casos protegem, em ordem de estrago:
 *  - setor pra onde se encaminha e que nao tem NINGUEM: o cliente e transferido
 *    pro vazio e ninguem percebe ate ele cobrar;
 *  - teto do contrato virando decoracao (desativa, cadastra, reativa);
 *  - cadastro cheio virando cadastro congelado, sem nem poder corrigir um nome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validar, cabeMais, porSetor, setoresSemGente, uso } from '../engine/vsoperadores/regras.mjs';

/* ---- regras puras ---- */

test('operador sem setor e RECUSADO — existiria sem nunca receber cliente', () => {
  const r = validar({ nome: 'Joana' });
  assert.equal(r.ok, false);
  assert.match(r.erros.join(' '), /setor/);
});

test('sem nome tambem nao passa', () => {
  assert.match(validar({ setor: 'financeiro' }).erros.join(' '), /nome/);
});

test('setor entra normalizado — "Financeiro" e "financeiro" sao o mesmo setor', () => {
  assert.equal(validar({ nome: 'Ana', setor: 'Financeiro' }).operador.setor, 'financeiro');
  assert.equal(validar({ nome: 'Ana', setor: ' Comercial ' }).operador.setor, 'comercial');
});

test('telefone torto e recusado, telefone vazio e aceito', () => {
  assert.match(validar({ nome: 'Ana', setor: 'x', telefone: '123' }).erros.join(' '), /telefone/);
  assert.equal(validar({ nome: 'Ana', setor: 'x' }).ok, true);
});

test('so quem esta ATIVO ocupa vaga — quem saiu da empresa nao pode custar', () => {
  const lista = [
    { id: 'a', nome: 'A', setor: 'x', ativo: true },
    { id: 'b', nome: 'B', setor: 'x', ativo: false },
  ];
  assert.equal(cabeMais(lista, 1).ok, false, 'a vaga unica ja esta com o A');
  assert.equal(cabeMais(lista, 2).ok, true, 'o B desativado nao conta');
});

test('editar quem ja existe NAO consome vaga — senao cadastro cheio congela', () => {
  const lista = [{ id: 'a', nome: 'A', setor: 'x', ativo: true }];
  assert.equal(cabeMais(lista, 1, 'a').ok, true, 'corrigir o nome do A tem de ser possivel');
  assert.equal(cabeMais(lista, 1, 'novo').ok, false);
});

test('sem limite informado, nao bloqueia — falha nossa nao para o cliente', () => {
  assert.equal(cabeMais([{ id: 'a', ativo: true }], null).ok, true);
});

test('quando barra, diz o que fazer', () => {
  const r = cabeMais([{ id: 'a', ativo: true }], 1);
  assert.match(r.motivo, /Amplie o contrato|desative/);
});

test('setor que recebe encaminhamento e nao tem gente e DENUNCIADO', () => {
  const lista = [{ id: 'a', nome: 'A', setor: 'comercial', ativo: true }];
  const buracos = setoresSemGente(lista, ['comercial', 'financeiro', 'suporte']);
  assert.deepEqual(buracos, ['financeiro', 'suporte']);
});

test('"humano" nao conta como setor orfao — e o encaminhamento generico', () => {
  assert.deepEqual(setoresSemGente([], ['humano']), []);
});

test('operador DESATIVADO deixa o setor orfao — cadastro nao e cobertura', () => {
  const lista = [{ id: 'a', nome: 'A', setor: 'financeiro', ativo: false }];
  assert.deepEqual(setoresSemGente(lista, ['financeiro']), ['financeiro']);
});

test('o uso avisa aos 80%, antes de encher', () => {
  assert.equal(uso([{ ativo: true }], 6).alerta, null);
  assert.equal(uso([1, 2, 3, 4, 5].map(() => ({ ativo: true })), 6).alerta, 'quase cheio');
  assert.equal(uso([1, 2, 3, 4, 5, 6].map(() => ({ ativo: true })), 6).alerta, 'cheio');
  assert.match(uso([{ ativo: true }], null).texto, /sem limite/);
});

test('porSetor conta so os ativos', () => {
  const lista = [
    { setor: 'comercial', ativo: true }, { setor: 'comercial', ativo: true },
    { setor: 'financeiro', ativo: false },
  ];
  assert.deepEqual(porSetor(lista), { comercial: 2 });
});

/* ---- com disco e com o contrato de verdade ---- */

const dirOp = mkdtempSync(join(tmpdir(), 'ops-'));
const dirPl = mkdtempSync(join(tmpdir(), 'plan-'));
process.env.VSOPERADORES_DIR = dirOp;
process.env.VSPLANOS_DIR = dirPl;
const planos = await import('../engine/vsplanos/index.mjs');
const ops = await import('../engine/vsoperadores/index.mjs');
test.after(() => { rmSync(dirOp, { recursive: true, force: true }); rmSync(dirPl, { recursive: true, force: true }); });

test('o teto vem do CONTRATO, nao do codigo', () => {
  planos.assinar({ plano: 'whats-ouro' }); // 6 atendentes na tabela de lancamento
  assert.equal(ops.painel().uso.limite, 6);
  planos.assinar({ plano: 'whats-bronze' }); // 1
  assert.equal(ops.painel().uso.limite, 1);
});

test('cadastrar alem do contrato e recusado, com o motivo', () => {
  planos.assinar({ plano: 'whats-bronze' }); // 1 atendente
  assert.equal(ops.salvar({ nome: 'Ana', setor: 'comercial' }).ok, true);
  const r = ops.salvar({ nome: 'Bruno', setor: 'financeiro' });
  assert.equal(r.ok, false);
  assert.match(r.erros.join(' '), /contrato libera 1 operador/);
});

test('atendente extra comprado amplia o teto na hora', () => {
  planos.assinar({ plano: 'whats-bronze', atendentesExtras: 2 }); // 1 + 2
  assert.equal(ops.salvar({ nome: 'Bruno', setor: 'financeiro' }).ok, true);
  assert.equal(ops.painel().uso.texto, '2 de 3 do contrato');
});

test('desativar, cadastrar e REATIVAR nao fura o teto', () => {
  planos.assinar({ plano: 'whats-bronze' }); // volta pra 1 — e ja tem 2 ativos
  const ana = ops.listar().find((o) => o.nome === 'Ana');
  const bruno = ops.listar().find((o) => o.nome === 'Bruno');
  ops.salvar({ ...ana, ativo: false });
  ops.salvar({ ...bruno, ativo: false });
  assert.equal(ops.salvar({ nome: 'Carla', setor: 'suporte' }).ok, true, 'as vagas vagaram');
  const r = ops.salvar({ ...ana, ativo: true });
  assert.equal(r.ok, false, 'reativar ocupa vaga igual a cadastrar');
});

test('corrigir o nome de quem ja esta ativo funciona mesmo com o contrato cheio', () => {
  const carla = ops.listar().find((o) => o.nome === 'Carla');
  const r = ops.salvar({ ...carla, nome: 'Carla Souza' });
  assert.equal(r.ok, true);
  assert.equal(ops.listar().find((o) => o.id === carla.id).nome, 'Carla Souza');
});

test('o painel entrega os setores do fluxo que ficaram sem ninguem', () => {
  const p = ops.painel(['comercial', 'financeiro', 'suporte', 'humano']);
  assert.ok(p.setoresSemGente.includes('comercial'), 'a Ana foi desativada');
  assert.ok(p.setoresSemGente.includes('financeiro'), 'o Bruno tambem');
  assert.ok(!p.setoresSemGente.includes('suporte'), 'a Carla atende suporte');
  assert.ok(!p.setoresSemGente.includes('humano'));
});

test('remover o que nao existe devolve erro em vez de fingir que deu certo', () => {
  assert.equal(ops.remover('nao-existe').ok, false);
});
