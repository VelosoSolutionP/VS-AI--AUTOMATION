/**
 * Banco compartilhado (16/10, no Postgres desde 07/11): o catálogo mora no banco,
 * separado por CNPJ e loja. Duas empresas no mesmo banco nunca se enxergam; o site
 * lê a tabela achatada; o JSON antigo entra sozinho na primeira leitura.
 *
 * Roda num banco Postgres descartável: ZEST_PG_TESTE aponta pro servidor
 * (ex.: postgresql://usuario:senha@127.0.0.1:5434/postgres); o teste cria
 * zest_teste_<n>, aplica as migrações do Prisma e apaga no fim. Sem a variável, pula.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const servidor = process.env.ZEST_PG_TESTE;
if (!servidor) { test('banco-catalogo', { skip: 'defina ZEST_PG_TESTE para rodar contra um Postgres descartável' }, () => {}); }

const nomeBanco = `zest_teste_${process.pid}_${Date.now()}`;
const comBanco = (nome) => { const u = new URL(servidor); u.pathname = `/${nome}`; return u.toString(); };
const admin = async (sql) => { const c = new pg.Client({ connectionString: servidor }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };

const casa = mkdtempSync(join(tmpdir(), 'banco-cat-'));
process.env.VS_HOME = casa;
delete process.env.VSESTOQUE_DIR;
const EMPRESA_A = '53759232000194';
const EMPRESA_B = '11222333000181';
process.env.VS_EMPRESA_CNPJ = EMPRESA_A;

if (servidor) {
  await admin(`CREATE DATABASE ${nomeBanco}`);
  process.env.DATABASE_URL = `${comBanco(nomeBanco)}?schema=public`;
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'pipe', env: process.env });
}

/* JSON antigo da empresa A, como está hoje na produção. */
mkdirSync(join(casa, 'vsestoque'), { recursive: true });
writeFileSync(join(casa, 'vsestoque', 'produtos.json'), JSON.stringify([
  { sku: 'crm', nome: 'CRM e Vendas', precoCentavos: 100, quantidade: 50, ativo: true, naVitrine: true, imagens: ['https://x/crm.png'] },
  { sku: 'velho', nome: 'Apagado', precoCentavos: 1, ativo: true, excluidoEm: '2026-10-01' },
]));

const banco = servidor ? await import('../engine/banco.mjs') : null;
const estoque = servidor ? await import('../engine/vsestoque/index.mjs') : null;
const { comLoja } = await import('../engine/casa.mjs');
test.after(async () => {
  rmSync(casa, { recursive: true, force: true });
  if (!servidor) { return; }
  await banco.fechar();
  await admin(`DROP DATABASE IF EXISTS ${nomeBanco} WITH (FORCE)`);
});
const t = servidor ? test : test.skip;

t('a primeira leitura traz o JSON antigo pro banco e o site enxerga o catálogo', async () => {
  const lista = await estoque.listar();
  assert.deepEqual(lista.map((p) => p.sku), ['crm']);
  const doSite = await banco.produtosDaEmpresa('53.759.232/0001-94', { vitrine: true });
  assert.equal(doSite.length, 1, 'produto apagado não vai pro site');
  assert.equal(doSite[0].sku, 'crm');
  assert.equal(doSite[0].preco_centavos, 100);
  assert.equal(doSite[0].imagem, 'https://x/crm.png');
  assert.ok(readFileSync(join(casa, 'vsestoque', 'produtos.json'), 'utf8').includes('crm'), 'o JSON fica intacto como cópia');
});

t('duas empresas no mesmo banco não se enxergam', async () => {
  process.env.VS_EMPRESA_CNPJ = EMPRESA_B;
  assert.deepEqual(await estoque.listar(), [], 'empresa B nasce com catálogo vazio, não herda o da A');
  const r = await estoque.criar({ sku: 'pizza', nome: 'Pizza', preco: '45,00', quantidade: 10 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual((await banco.produtosDaEmpresa(EMPRESA_B)).map((p) => p.sku), ['pizza']);
  process.env.VS_EMPRESA_CNPJ = EMPRESA_A;
  assert.deepEqual((await estoque.listar()).map((p) => p.sku), ['crm'], 'a A continua só com o dela');
  assert.deepEqual((await banco.produtosDaEmpresa(EMPRESA_A)).map((p) => p.sku), ['crm']);
});

t('loja separada dentro da mesma empresa', async () => {
  await comLoja('padaria', async () => {
    assert.deepEqual(await estoque.listar(), []);
    assert.ok((await estoque.criar({ sku: 'pao', nome: 'Pão', preco: '1,00', quantidade: 5 })).ok);
  });
  assert.deepEqual((await banco.produtosDaEmpresa(EMPRESA_A, { loja: 'padaria' })).map((p) => p.sku), ['pao']);
  assert.deepEqual((await banco.produtosDaEmpresa(EMPRESA_A, { loja: 'principal' })).map((p) => p.sku), ['crm']);
});

t('sem CNPJ válido, o banco recusa em vez de gravar dado sem dono', async () => {
  process.env.VS_EMPRESA_CNPJ = '123';
  await assert.rejects(() => estoque.listar(), /VS_EMPRESA_CNPJ/);
  process.env.VS_EMPRESA_CNPJ = EMPRESA_A;
});
