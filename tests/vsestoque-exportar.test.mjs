import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportar, faltaPara, prontidao, csvCelula, csvLinha, xml, preco, decimal, FORMATOS, CANAIS,
} from '../engine/vsestoque/exportar.mjs';

/**
 * Parser de CSV (RFC 4180) escrito aqui de proposito: e o que prova que a virgula na
 * descricao NAO deslocou as colunas. Conferir a string na mao passaria batido.
 */
function lerCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') { aspas = false; }
      else { campo += c; }
    } else if (c === '"') { aspas = true; }
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') { campo += c; }
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.length > 1 || l[0] !== '');
}

const completo = {
  sku: 'cam-01', nome: 'Camiseta Veloso', descricao: 'Algodão 100%, corte reto',
  marca: 'Veloso', categoria: 'Vestuário', categoriaGoogle: '1604',
  gtin: '7891234567895', condicao: 'novo',
  precoCentavos: 7990, precoPromocionalCentavos: null, moeda: 'BRL',
  quantidade: 10, reservado: 2, imagens: ['https://cdn.x/1.jpg'],
  link: 'https://loja.x/cam', ativo: true,
};
const incompleto = { sku: 'sem-foto', nome: 'Sem foto', descricao: '', precoCentavos: 1000, moeda: 'BRL', quantidade: 3, reservado: 0, imagens: [], link: '', ativo: true };
const opts = { em: '2026-09-18T00:00:00.000Z', loja: 'Loja Veloso', site: 'https://loja.x' };

test('centavos viram decimal com 2 casas e a moeda que os feeds esperam', () => {
  assert.equal(decimal(7990), '79.90');
  assert.equal(preco(7990, 'BRL'), '79.90 BRL');
  assert.equal(preco(null), '');
});

test('escape de XML — um "&" no nome derruba o feed inteiro do Google', () => {
  assert.equal(xml('Bolso & Cia "top" <b>'), 'Bolso &amp; Cia &quot;top&quot; &lt;b&gt;');
});

test('escape de CSV segue o RFC 4180', () => {
  assert.equal(csvCelula('simples'), 'simples');
  assert.equal(csvCelula('com,virgula'), '"com,virgula"');
  assert.equal(csvCelula('com "aspas"'), '"com ""aspas"""');
  assert.equal(csvCelula('com\nquebra'), '"com\nquebra"');
  assert.equal(csvLinha(['a', 'b,c']), 'a,"b,c"');
});

test('faltaPara diz o que impede o produto de ir pra cada canal', () => {
  assert.deepEqual(faltaPara(completo, 'google'), []);
  const f = faltaPara(incompleto, 'google');
  assert.ok(f.includes('ao menos 1 imagem'));
  assert.ok(f.includes('marca'));
  assert.ok(f.includes('link do produto'));
  // o Mercado Livre exige menos — o mesmo produto passa la
  assert.deepEqual(faltaPara(incompleto, 'mercadolivre'), []);
  assert.match(faltaPara(completo, 'orkut')[0], /canal desconhecido/);
});

test('produto incompleto NAO entra no arquivo — vai pra lista de recusados', () => {
  const r = exportar([completo, incompleto], 'google', opts);
  assert.equal(r.incluidos, 1);
  assert.equal(r.recusados.length, 1);
  assert.equal(r.recusados[0].sku, 'sem-foto');
  assert.ok(!r.conteudo.includes('sem-foto'), 'o item quebrado nao pode sair no feed');
});

test('XML do Google sai com a estrutura e o namespace certos', () => {
  const r = exportar([completo], 'google', opts);
  assert.match(r.conteudo, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(r.conteudo, /xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0"/);
  assert.match(r.conteudo, /<g:id>cam-01<\/g:id>/);
  assert.match(r.conteudo, /<g:price>79\.90 BRL<\/g:price>/);
  assert.match(r.conteudo, /<g:availability>in_stock<\/g:availability>/);
  assert.match(r.conteudo, /<g:quantity>8<\/g:quantity>/, 'quantidade do feed é o DISPONIVEL (10-2), nao o total');
  assert.equal(r.arquivo, 'catalogo-google.xml');
});

test('em promocao o Google recebe o preco cheio E o promocional', () => {
  const r = exportar([{ ...completo, precoPromocionalCentavos: 5990 }], 'google', opts);
  assert.match(r.conteudo, /<g:price>79\.90 BRL<\/g:price>/);
  assert.match(r.conteudo, /<g:sale_price>59\.90 BRL<\/g:sale_price>/);
});

test('sem GTIN nem MPN o Google precisa ouvir que nao existe identificador', () => {
  const r = exportar([{ ...completo, gtin: null, mpn: null }], 'google', opts);
  assert.match(r.conteudo, /<g:identifier_exists>no<\/g:identifier_exists>/);
  assert.doesNotMatch(exportar([completo], 'google', opts).conteudo, /identifier_exists/);
});

test('CSV da Meta: cabecalho exato e colunas que nao deslocam com virgula', () => {
  const r = exportar([completo], 'meta', opts);
  const linhas = lerCsv(r.conteudo);
  assert.equal(linhas[0][0], 'id');
  assert.equal(linhas[0].length, 13);
  assert.equal(linhas[1].length, 13, 'a virgula da descricao nao pode criar coluna');
  const reg = Object.fromEntries(linhas[0].map((c, i) => [c, linhas[1][i]]));
  assert.equal(reg.id, 'cam-01');
  assert.equal(reg.description, 'Algodão 100%, corte reto');
  assert.equal(reg.availability, 'in stock', 'a Meta usa com espaço, o Google com underline');
  assert.equal(reg.price, '79.90 BRL');
  assert.equal(reg.quantity_to_sell_on_facebook, '8');
});

test('CSV do TikTok usa sku_id e landing_page_url, nao os nomes da Meta', () => {
  const linhas = lerCsv(exportar([completo], 'tiktok', opts).conteudo);
  assert.equal(linhas[0][0], 'sku_id');
  assert.ok(linhas[0].includes('landing_page_url'));
  assert.ok(linhas[0].includes('video_link'));
});

test('planilha do Mercado Livre usa virgula decimal — Excel pt-BR leria 19.90 como 1990', () => {
  const linhas = lerCsv(exportar([completo], 'mercadolivre', opts).conteudo);
  const reg = Object.fromEntries(linhas[0].map((c, i) => [c, linhas[1][i]]));
  assert.equal(reg.preco, '79,90');
  assert.equal(reg.quantidade, '8');
});

test('CSV de CRM sai com os nomes que HubSpot/RD esperam', () => {
  const linhas = lerCsv(exportar([completo], 'crm', opts).conteudo);
  assert.deepEqual(linhas[0], ['name', 'sku', 'price', 'currency', 'description', 'category', 'brand', 'in_stock', 'url']);
  assert.equal(linhas[1][2], '79.90', 'CRM usa ponto decimal');
});

test('aspas e virgula sobrevivem ao round-trip em TODOS os CSVs', () => {
  const chato = { ...completo, nome: 'Caneca "Bolso Cheio" & Cia', descricao: 'Cerâmica, 300ml. Micro-ondas & lava-louças' };
  for (const canal of ['meta', 'tiktok', 'mercadolivre', 'crm']) {
    const linhas = lerCsv(exportar([chato], canal, opts).conteudo);
    assert.equal(linhas[1].length, linhas[0].length, `${canal}: colunas deslocaram`);
    assert.ok(linhas[1].includes('Caneca "Bolso Cheio" & Cia'), `${canal}: nome nao sobreviveu`);
  }
});

test('inativo nao é recusa: fica de fora por escolha, e é contado a parte', () => {
  const r = exportar([completo, { ...incompleto, ativo: false }], 'crm', opts);
  assert.equal(r.incluidos, 1);
  assert.equal(r.recusados.length, 0);
  assert.equal(r.ignoradosInativos, 1);
  assert.equal(exportar([{ ...completo, ativo: false }], 'crm', { ...opts, incluirInativos: true }).incluidos, 1);
});

test('tudo reservado vira "sem estoque" no feed — senao vende o que nao pode entregar', () => {
  const r = exportar([{ ...completo, reservado: 10 }], 'meta', opts);
  const linhas = lerCsv(r.conteudo);
  const reg = Object.fromEntries(linhas[0].map((c, i) => [c, linhas[1][i]]));
  assert.equal(reg.availability, 'out of stock');
  assert.equal(reg.quantity_to_sell_on_facebook, '0');
});

test('JSON leva o produto inteiro, com data de geracao', () => {
  const d = JSON.parse(exportar([completo], 'json', opts).conteudo);
  assert.equal(d.total, 1);
  assert.equal(d.geradoEm, opts.em);
  assert.equal(d.produtos[0].sku, 'cam-01');
});

test('formato desconhecido lista os que existem', () => {
  const r = exportar([], 'planilhao');
  assert.equal(r.ok, false);
  for (const f of FORMATOS) { assert.ok(r.motivo.includes(f)); }
});

test('todo canal declara nome, arquivo e tipo', () => {
  for (const c of FORMATOS) {
    assert.ok(CANAIS[c].nome, c + ' sem nome');
    assert.ok(CANAIS[c].arquivo, c + ' sem arquivo');
    assert.ok(CANAIS[c].tipo, c + ' sem content-type');
  }
});

test('prontidao conta por canal quantos estao prontos', () => {
  const p = prontidao([completo, incompleto]);
  assert.equal(p.google.prontos, 1);
  assert.equal(p.google.faltando, 1);
  assert.equal(p.crm.prontos, 2);
});
