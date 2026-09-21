/**
 * Catálogo comercial. O que estes casos protegem é o CONTRATO:
 *  - preço de plano já assinado não muda por edição;
 *  - limite ausente não vira "liberado" por acidente;
 *  - falha nossa (plano sumido, licença fora) não bloqueia o cliente.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validarPlano, novaVersao, precoDoCiclo, cabeMais, uso, limitesDe } from '../engine/vsplanos/catalogo.mjs';

const dir = mkdtempSync(join(tmpdir(), 'planos-'));
process.env.VSPLANOS_DIR = dir;
const planos = await import('../engine/vsplanos/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

/* ---- validacao ---- */

test('plano sem codigo, nome, modulo ou preco e recusado', () => {
  assert.match(validarPlano({}).erros.join(' '), /código/);
  assert.match(validarPlano({ code: 'x', module: 'redes', monthly_price: 100 }).erros.join(' '), /nome/);
  assert.match(validarPlano({ code: 'x', nome: 'X', module: 'foo', monthly_price: 1 }).erros.join(' '), /módulo/);
  assert.match(validarPlano({ code: 'x', nome: 'X', module: 'redes' }).erros.join(' '), /preço/);
});

test('limite VAZIO e ilimitado; limite ZERO e proibido — nao sao a mesma coisa', () => {
  const ilimitado = validarPlano({ code: 'a', nome: 'A', module: 'redes', monthly_price: 100, products_limit: '' }).plano;
  const zero = validarPlano({ code: 'b', nome: 'B', module: 'redes', monthly_price: 100, products_limit: 0 }).plano;
  assert.equal(ilimitado.products_limit, null);
  assert.equal(zero.products_limit, 0);
  assert.equal(cabeMais(999, ilimitado.products_limit).ok, true);
  assert.equal(cabeMais(0, zero.products_limit).ok, false);
});

/* ---- preco e ciclo ---- */

test('semestral tira 10% e cobra seis meses', () => {
  const p = { monthly_price: 18900 }; // Combo Prata R$ 189
  const m = precoDoCiclo(p, 'mensal');
  const s = precoDoCiclo(p, 'semestral');
  assert.equal(m.mensal, 18900);
  assert.equal(s.mensal, 17010, 'R$ 170,10/mes');
  assert.equal(s.total, 17010 * 6);
  assert.equal(s.economia, (18900 - 17010) * 6);
});

test('ciclo desconhecido cai no mensal em vez de dar desconto errado', () => {
  assert.equal(precoDoCiclo({ monthly_price: 10000 }, 'decenal').mensal, 10000);
});

/* ---- versionamento: o coracao da regra ---- */

test('nova versao NAO altera o plano antigo — cria outro codigo', () => {
  const antigo = validarPlano({ code: 'bronze', nome: 'Bronze', module: 'redes', monthly_price: 5900 }).plano;
  const r = novaVersao(antigo, { monthly_price: 7900 });
  assert.equal(r.novo.code, 'bronze-v2');
  assert.equal(r.novo.monthly_price, 7900);
  assert.equal(r.novo.substitui, 'bronze');
  assert.equal(r.antigo.active, false, 'o antigo sai de VENDA');
  assert.equal(antigo.monthly_price, 5900, 'o antigo nao pode ter sido alterado');
});

/* ---- catalogo em disco ---- */

test('a tabela de lancamento entra como semente, com os precos combinados', () => {
  const t = planos.tabela();
  assert.equal(t.modulos.redes.length, 3);
  assert.equal(t.modulos.whatsapp.length, 3);
  assert.equal(t.modulos.combo.length, 3);
  assert.equal(planos.buscar('redes-bronze').monthly_price, 5900);
  assert.equal(planos.buscar('whats-prata').monthly_price, 12900);
  assert.equal(planos.buscar('combo-ouro').monthly_price, 29900);
});

test('os limites da tabela batem com o combinado', () => {
  assert.equal(planos.buscar('whats-bronze').products_limit, 100);
  assert.equal(planos.buscar('whats-prata').products_limit, 500);
  assert.equal(planos.buscar('whats-ouro').products_limit, 2000);
  assert.equal(planos.buscar('whats-bronze').attendants, 1);
  assert.equal(planos.buscar('whats-prata').attendants, 3);
  assert.equal(planos.buscar('whats-ouro').attendants, 6);
  assert.equal(planos.buscar('redes-ouro').storage_limit_mb, 15360, '15 GB');
});

test('so um plano por modulo leva o destaque', () => {
  for (const m of ['redes', 'whatsapp', 'combo']) {
    assert.equal(planos.tabela().modulos[m].filter((p) => p.destaque).length, 1);
  }
});

test('marketplace entra SEM preco — sob consulta, porque o custo muda', () => {
  const mk = planos.adicionais().find((a) => a.code === 'canal-marketplace');
  assert.equal(mk.monthly_price, null);
  assert.equal(mk.sob_consulta, true);
  const extra = planos.adicionais().find((a) => a.code === 'atendente-extra');
  assert.equal(extra.monthly_price, 1990, 'R$ 19,90');
});

/* ---- assinatura ---- */

test('sem assinatura, nada e bloqueado', () => {
  const a = planos.assinatura();
  assert.equal(a.semPlano, true);
  assert.equal(a.limites.produtos, null);
  assert.equal(cabeMais(99999, a.limites.produtos).ok, true);
});

test('assinar aplica os limites do plano', () => {
  assert.equal(planos.assinar({ plano: 'whats-bronze' }).ok, true);
  const a = planos.assinatura();
  assert.equal(a.limites.produtos, 100);
  assert.equal(a.limites.atendentes, 1);
  assert.equal(a.preco.mensal, 7900);
});

test('atendente adicional soma ao limite do plano', () => {
  planos.assinar({ plano: 'whats-bronze', atendentesExtras: 2 });
  assert.equal(planos.limiteDeAtendentes(), 3, '1 do plano + 2 comprados');
});

test('nao da pra assinar plano que nao existe nem plano fora de venda', () => {
  assert.equal(planos.assinar({ plano: 'nao-existe' }).ok, false);
  planos.versionarPlano('redes-bronze', { monthly_price: 6900 });
  assert.equal(planos.assinar({ plano: 'redes-bronze' }).ok, false, 'saiu de venda ao ser versionado');
  assert.equal(planos.assinar({ plano: 'redes-bronze-v2' }).ok, true);
});

test('mudar o preco de plano JA ASSINADO e recusado — isso e mudar contrato', () => {
  planos._resemear();
  planos.assinar({ plano: 'combo-prata' });
  const r = planos.salvarPlano({ ...planos.buscar('combo-prata'), monthly_price: 24900 });
  assert.equal(r.ok, false);
  assert.match(r.erros.join(' '), /contrato assinado|nova versão/i);
  assert.equal(planos.buscar('combo-prata').monthly_price, 18900, 'o preco nao pode ter mudado');
});

test('versionar deixa quem ja assinou no plano antigo', () => {
  planos._resemear();
  planos.assinar({ plano: 'combo-prata' });
  planos.versionarPlano('combo-prata', { monthly_price: 24900 });
  assert.equal(planos.assinatura().plano, 'combo-prata', 'contrato antigo continua de pe');
  assert.equal(planos.assinatura().preco.mensal, 18900, 'e no preco antigo');
  assert.equal(planos.buscar('combo-prata-v2').monthly_price, 24900);
  assert.equal(planos.listar().some((p) => p.code === 'combo-prata'), false, 'o antigo sai da vitrine');
});

/* ---- avisos ---- */

test('a tela avisa aos 80%, antes de encher', () => {
  assert.equal(uso(79, 100, 'produtos').alerta, null);
  assert.equal(uso(80, 100, 'produtos').alerta, 'quase cheio');
  assert.equal(uso(100, 100, 'produtos').alerta, 'cheio');
  assert.match(uso(10, null, 'produtos').texto, /sem limite/);
});

test('quando barra, diz o que fazer — nao so que nao pode', () => {
  const r = cabeMais(100, 100, 'produtos');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Amplie o plano|desativando/);
});

test('limitesDe sem plano devolve tudo nulo, nao tudo zero', () => {
  const l = limitesDe(null);
  assert.equal(l.produtos, null);
  assert.equal(l.atendentes, null);
});
