/**
 * Backend Postgres/Prisma do banco compartilhado.
 *
 * O gate é `DATABASE_URL` (ver `banco-comum.mjs`); sem ela o banco fica desligado.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { soDigitos, empresaAtual, lojaAtual } from './banco-comum.mjs';

let prisma = null;

export function abrir() {
  if (!prisma) { prisma = new PrismaClient(); }
  return prisma;
}

export async function fechar() {
  if (prisma) {
    try { await prisma.$disconnect(); } catch { /* já fechado */ }
    prisma = null;
  }
}

async function garantirEmpresa(cnpj) {
  const agora = new Date();
  const nome = process.env.VS_EMPRESA_NOME || null;
  await abrir().empresa.upsert({
    where: { cnpj },
    create: { cnpj, nome, criadoEm: agora, atualizadoEm: agora },
    update: { nome: nome || undefined, atualizadoEm: agora },
  });
}

const chaveDocumento = (cnpj, loja, modulo, nome) => ({ cnpj_loja_modulo_nome: { cnpj, loja, modulo, nome } });

/** Lê o documento da empresa e loja atuais, migrando o JSON antigo na primeira leitura. */
export async function ler(modulo, nome, padrao = null, { arquivoAntigo = null, aoMigrar = null } = {}) {
  const cnpj = empresaAtual();
  const loja = lojaAtual();
  const linha = await abrir().bolsoDado.findUnique({ where: chaveDocumento(cnpj, loja, modulo, nome) });
  if (linha) { return linha.dados; }

  if (arquivoAntigo) {
    const arquivo = resolve(arquivoAntigo);
    const jaMigrado = await abrir().bolsoMigracao.findUnique({ where: { arquivo } });
    if (!jaMigrado) {
      let antigo;
      try { antigo = JSON.parse(readFileSync(arquivoAntigo, 'utf8')); } catch { antigo = undefined; }
      if (antigo !== undefined) {
        await gravar(modulo, nome, antigo);
        try {
          await abrir().bolsoMigracao.create({ data: { arquivo, cnpj, loja, em: new Date() } });
        } catch (e) {
          if (e?.code !== 'P2002') { throw e; }
        }
        if (aoMigrar) { await aoMigrar(antigo); }
        return antigo;
      }
    }
  }
  return padrao;
}

export async function gravar(modulo, nome, dados) {
  const cnpj = empresaAtual();
  const loja = lojaAtual();
  await garantirEmpresa(cnpj);
  const agora = new Date();
  await abrir().bolsoDado.upsert({
    where: chaveDocumento(cnpj, loja, modulo, nome),
    create: { cnpj, loja, modulo, nome, dados, atualizadoEm: agora },
    update: { dados, atualizadoEm: agora },
  });
}

export async function existe(modulo, nome) {
  const total = await abrir().bolsoDado.count({
    where: { cnpj: empresaAtual(), loja: lojaAtual(), modulo, nome },
  });
  return total > 0;
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);

/** Reescreve o catálogo achatado da empresa e loja atuais (numa transação). */
export async function espelharCatalogo(produtos = []) {
  const cnpj = empresaAtual();
  const loja = lojaAtual();
  await garantirEmpresa(cnpj);

  const agora = new Date();
  const linhas = [];
  for (const p of produtos) {
    if (!p?.sku || p.excluidoEm) { continue; }
    linhas.push({
      cnpj,
      loja,
      sku: String(p.sku),
      nome: String(p.nome || p.sku),
      descricao: p.descricao || null,
      categoria: p.categoria || null,
      marca: p.marca || null,
      precoCentavos: num(p.precoCentavos),
      precoPromoCentavos: num(p.precoPromocionalCentavos),
      quantidade: num(p.quantidade),
      reservado: num(p.reservado),
      ativo: p.ativo !== false,
      naVitrine: Boolean(p.naVitrine),
      imagem: (p.imagens || [])[0] || null,
      link: p.link || null,
      atualizadoEm: agora,
    });
  }

  await abrir().$transaction(async (tx) => {
    await tx.catalogoProduto.deleteMany({ where: { cnpj, loja } });
    if (linhas.length) { await tx.catalogoProduto.createMany({ data: linhas }); }
  });
}

/** O que o site usa: o catálogo de uma empresa, em formato snake_case (compatível com o SQLite). */
export async function produtosDaEmpresa(cnpj, { loja = null, vitrine = false } = {}) {
  const linhas = await abrir().catalogoProduto.findMany({
    where: {
      cnpj: soDigitos(cnpj),
      ativo: true,
      ...(loja ? { loja } : {}),
      ...(vitrine ? { naVitrine: true } : {}),
    },
    orderBy: { nome: 'asc' },
  });
  return linhas.map((p) => ({
    cnpj: p.cnpj,
    loja: p.loja,
    sku: p.sku,
    nome: p.nome,
    descricao: p.descricao,
    categoria: p.categoria,
    marca: p.marca,
    preco_centavos: p.precoCentavos,
    preco_promo_centavos: p.precoPromoCentavos,
    quantidade: p.quantidade,
    reservado: p.reservado,
    ativo: p.ativo ? 1 : 0,
    na_vitrine: p.naVitrine ? 1 : 0,
    imagem: p.imagem,
    link: p.link,
    atualizado_em: p.atualizadoEm,
  }));
}
