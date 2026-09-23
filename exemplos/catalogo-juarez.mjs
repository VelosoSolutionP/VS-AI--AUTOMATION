/**
 * Catálogo de demonstração do Juarez Tele-Entrega — 5 itens.
 *
 * Existe para que o fluxo venda a partir do CATÁLOGO, não de preço cravado na
 * planilha: mudar o preço aqui muda o que a Mica cobra, sem reimportar nada.
 *
 * Idempotente de propósito: rodar duas vezes atualiza, não duplica. Semeador que
 * duplica é o jeito mais rápido de estourar o teto do plano com lixo.
 *
 *   VS_HOME=~/.qa-gate node exemplos/catalogo-juarez.mjs
 */
import * as estoque from '../engine/vsestoque/index.mjs';

const ITENS = [
  { sku: 'JZ-XTUDO', nome: 'X-Tudo', preco: 28.00, quantidade: 40, categoria: 'Lanches',
    descricao: 'Hambúrguer, ovo, presunto, queijo, alface, tomate e batata palha.' },
  { sku: 'JZ-XSALADA', nome: 'X-Salada', preco: 22.00, quantidade: 40, categoria: 'Lanches',
    descricao: 'Hambúrguer, queijo, alface e tomate.' },
  { sku: 'JZ-MEGABLASTER', nome: 'Mega Blaster (serve 3)', preco: 62.00, quantidade: 8, categoria: 'Porções',
    descricao: 'Três carnes, bacon, cheddar, calabresa e fritas. A lenda da casa. 🔥' },
  { sku: 'JZ-LASANHA', nome: 'Lasanha (serve 2)', preco: 45.00, quantidade: 12, categoria: 'Massas',
    descricao: 'Lasanha à bolonhesa gratinada, serve 2 pessoas.' },
  { sku: 'JZ-REFRI-LATA', nome: 'Refrigerante lata', preco: 6.00, quantidade: 120, categoria: 'Bebidas',
    descricao: 'Lata 350 ml gelada.' },
];

let criados = 0;
let atualizados = 0;
const falhas = [];

for (const item of ITENS) {
  const existe = estoque.obter(item.sku);
  const r = existe
    ? estoque.editar(item.sku, { ...item, naVitrine: true, ativo: true })
    : estoque.criar({ ...item, marca: 'Juarez Tele-Entrega', naVitrine: true });
  if (!r.ok) { falhas.push(`${item.sku}: ${(r.erros || []).join('; ')}`); continue; }
  if (existe) { atualizados += 1; } else { criados += 1; estoque.vitrine(item.sku, true); }
}

const vitrine = estoque.daVitrine().filter((p) => p.sku.startsWith('JZ-'));
console.log(`catálogo Juarez: ${criados} criado(s), ${atualizados} atualizado(s), ${vitrine.length} na vitrine`);
for (const p of vitrine) {
  console.log(`  ${p.sku.padEnd(16)} ${p.nome.padEnd(24)} R$ ${(p.precoCentavos / 100).toFixed(2)}  saldo ${p.disponivel}`);
}
if (falhas.length) {
  console.error('FALHOU:\n  ' + falhas.join('\n  '));
  /* Sair 0 com o catálogo incompleto é o erro que já me pegou: a tela mostra
     "semeado" e a demo roda com metade dos produtos. */
  process.exit(1);
}
if (vitrine.length !== ITENS.length) {
  console.error(`esperava ${ITENS.length} itens na vitrine, achei ${vitrine.length}`);
  process.exit(1);
}
