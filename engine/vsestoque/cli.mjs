#!/usr/bin/env node
/**
 * VSestoque — CLI. Cadastro de produto, movimentação de saldo e exportação pros
 * canais, sem abrir o painel.
 */
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import * as vs from './index.mjs';
import { EXPLICA, TIPOS } from './saldo.mjs';

const [cmd, ...args] = process.argv.slice(2);

/** `chave=valor` vira objeto; o resto sobra como posicional. */
function pares(lista) {
  const opts = {};
  const soltos = [];
  for (const a of lista) {
    const i = a.indexOf('=');
    if (i > 0 && !/^https?:/.test(a)) {
      const k = a.slice(0, i);
      const v = a.slice(i + 1);
      // `imagens` aceita várias separadas por vírgula.
      opts[k] = k === 'imagens' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
    } else { soltos.push(a); }
  }
  return { opts, soltos };
}

const falhou = (r) => { console.error('  ✖', r.motivo || (r.erros || []).join('; ') || r.erro || 'falhou'); process.exit(1); };
const avisar = (r) => { for (const a of r.avisos || []) { console.log('  ⚠ ', a); } };

function ajuda() {
  console.log(`
  VSestoque — catálogo, saldo e exportação

  Produtos
    listar [texto]                     lista o catálogo
    ver <sku>                          detalhe de um produto
    novo nome="..." preco=... [k=v]    cadastra
         campos: sku descricao marca categoria categoriaGoogle gtin mpn
                 condicao quantidade minimo link imagens=a,b precoPromocional
    editar <sku> k=v...                altera só o que você mandar
    inativar <sku> | reativar <sku>    tira/põe na vitrine
    excluir <sku>                      apaga de vez

  Saldo
    entrada <sku> <qtd> [motivo]       chegou mercadoria
    saida <sku> <qtd> [motivo]         perda, quebra, uso interno
    reservar <sku> <qtd> [ref]         separa pra um cliente
    liberar <sku> <qtd>                desfaz a reserva
    vender <sku> <qtd> [ref]           baixa reserva e saldo
    ajustar <sku> <contagem>           a contagem real vira o saldo
    historico [sku]                    o que mexeu no estoque

  Exportação
    canais                             o que está pronto pra cada canal
    exportar <canal> [arquivo]         ${vs.FORMATOS.join(' | ')}
    tiktok-publicar <sku> categoriaId=... armazemId=...

  Painel
    painel                             números, alertas e prontidão
`);
}

switch (cmd) {
  case 'listar': {
    const l = vs.listar({ texto: args[0] }).map(vs.resumir);
    if (!l.length) { console.log('  (catálogo vazio — cadastre com `novo`)'); break; }
    console.log('\n  SKU                  preço        disp.  situação   nome');
    for (const p of l) {
      console.log(`  ${p.sku.padEnd(20)} ${p.vigenteFormatado.padEnd(12)} ${String(p.disponivel).padStart(5)}  `
        + `${(p.ativo ? (p.disponibilidade === 'in_stock' ? 'à venda' : 'sem saldo') : 'inativo').padEnd(10)} ${p.nome}`);
    }
    console.log('');
    break;
  }

  case 'ver': {
    const p = vs.obter(args[0]);
    if (!p) { falhou({ motivo: `produto "${args[0]}" não encontrado` }); }
    console.log(JSON.stringify(p, null, 2));
    break;
  }

  case 'novo': {
    const { opts } = pares(args);
    const r = vs.criar(opts);
    avisar(r);
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ "${r.produto.nome}" cadastrado com SKU ${r.produto.sku}`);
    break;
  }

  case 'editar': {
    const [sku, ...resto] = args;
    const { opts } = pares(resto);
    const r = vs.editar(sku, opts);
    avisar(r);
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ ${sku} atualizado`);
    break;
  }

  case 'inativar':
  case 'reativar': {
    const r = cmd === 'inativar' ? vs.inativar(args[0]) : vs.reativar(args[0]);
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ ${args[0]} ${cmd === 'inativar' ? 'fora da vitrine' : 'de volta à vitrine'}`);
    break;
  }

  case 'excluir': {
    const r = vs.excluir(args[0]);
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ ${args[0]} apagado`);
    break;
  }

  case 'entrada': case 'saida': case 'reservar': case 'liberar': case 'vender': case 'ajustar': {
    const tipo = { reservar: 'reserva', ajustar: 'ajuste' }[cmd] || cmd;
    const [sku, qtd, ...resto] = args;
    const r = vs.movimentar(sku, { tipo, quantidade: Number(qtd), motivo: resto.join(' '), ref: resto.join(' ') });
    if (!r.ok) { falhou(r); }
    const p = r.produto;
    console.log(`  ✓ ${EXPLICA[tipo]} — ${sku}: ${p.quantidade} em estoque, ${p.reservado} reservado(s), ${vs.disponivel(p)} disponível(is)`);
    break;
  }

  case 'historico': {
    const h = vs.historico(args[0]);
    if (!h.length) { console.log('  (sem movimento registrado)'); break; }
    for (const m of h) {
      console.log(`  ${m.em.slice(0, 16).replace('T', ' ')}  ${m.tipo.padEnd(8)} ${String(m.quantidade).padStart(4)}  `
        + `${m.sku.padEnd(18)} ${m.de.quantidade}→${m.para.quantidade}  ${m.motivo || ''}`);
    }
    break;
  }

  case 'canais': {
    const p = vs.prontidao(vs.listar());
    console.log('\n  canal                pronto/total   o que falta resolver');
    for (const [c, s] of Object.entries(p)) {
      console.log(`  ${c.padEnd(20)} ${String(s.prontos + '/' + s.total).padEnd(14)} ${s.faltando ? s.faltando + ' produto(s) incompleto(s)' : '—'}`);
    }
    console.log('');
    break;
  }

  case 'exportar': {
    const [canal, arquivo] = args;
    const r = vs.exportar(canal, { loja: process.env.VSESTOQUE_LOJA, site: process.env.VSESTOQUE_SITE });
    if (!r.ok) { falhou(r); }
    const destino = arquivo || r.arquivo;
    writeFileSync(destino, r.conteudo);
    console.log(`  ✓ ${r.incluidos} produto(s) em ${destino}`);
    if (r.ignoradosInativos) { console.log(`    ${r.ignoradosInativos} inativo(s) ficaram de fora (escolha sua)`); }
    for (const x of r.recusados) { console.log(`  ⚠  ${x.sku} não foi: falta ${x.faltando.join(', ')}`); }
    break;
  }

  case 'tiktok-publicar': {
    const [sku, ...resto] = args;
    const { opts } = pares(resto);
    const r = await vs.publicarNoTiktok(sku, opts);
    if (!r.ok) { falhou(r); }
    console.log('  ✓ enviado ao TikTok Shop:', r.dados?.product_id || '(sem id no retorno)');
    break;
  }

  case 'painel': {
    const d = vs.painel();
    console.log(`\n  VSestoque — ${d.total} produto(s), ${d.ativos} à venda`);
    console.log(`  ${d.unidades} unidade(s) · ${d.reservadas} reservada(s) · valor parado ${d.valorFormatado}`);
    if (d.semEstoque) { console.log(`  ${d.semEstoque} produto(s) ativo(s) SEM saldo — estão anunciados e não dá pra entregar`); }
    for (const a of d.alertas) { console.log(`  ⚠  ${a.sku}: ${a.nivel === 'acabou' ? 'acabou' : `baixo (${a.livre}, mínimo ${a.minimo})`}`); }
    console.log('\n  Pronto pra exportar:');
    for (const [c, s] of Object.entries(d.canais)) { console.log(`    ${c.padEnd(14)} ${s.prontos}/${s.total}`); }
    console.log('');
    break;
  }

  default:
    ajuda();
    if (cmd) { process.exit(1); }
}
