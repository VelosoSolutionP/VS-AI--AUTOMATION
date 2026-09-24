/**
 * VSestoque — exportação do catálogo pros canais de fora.
 *
 * Cada canal quer o mesmo produto num formato diferente, e todos são chatos de um
 * jeito próprio: o Google quer XML RSS com namespace `g:`, a Meta quer CSV com
 * cabeçalho exato, o TikTok herdou o formato da Meta mas troca alguns nomes.
 *
 * A decisão que importa aqui: **produto sem campo obrigatório NÃO sai no arquivo** —
 * sai numa lista de recusados, com o que falta. É tentador exportar assim mesmo, mas
 * o Google reprova o item calado e a Meta reprova o FEED INTEIRO; o vendedor fica
 * dias achando que anunciou. Preferimos dizer "estes 3 não foram, faltou foto".
 *
 * Escape é levado a sério: um `&` no nome do produto quebra o XML do Google, e uma
 * vírgula na descrição desloca todas as colunas do CSV da Meta.
 */
import { CONDICAO_FEED, disponibilidade, precoVigente, disponivel } from './produto.mjs';

/** Canais suportados e o que cada um exige pra aceitar o item. */
export const CANAIS = {
  google: {
    nome: 'Google Merchant Center (Shopping)',
    arquivo: 'catalogo-google.xml',
    tipo: 'application/xml; charset=utf-8',
    exige: ['nome', 'descricao', 'link', 'imagens', 'preco', 'marca'],
  },
  meta: {
    nome: 'Meta — catálogo do Facebook e Instagram',
    arquivo: 'catalogo-meta.csv',
    tipo: 'text/csv; charset=utf-8',
    exige: ['nome', 'descricao', 'link', 'imagens', 'preco'],
  },
  tiktok: {
    nome: 'TikTok — catálogo de produtos',
    arquivo: 'catalogo-tiktok.csv',
    tipo: 'text/csv; charset=utf-8',
    exige: ['nome', 'descricao', 'link', 'imagens', 'preco'],
  },
  mercadolivre: {
    nome: 'Mercado Livre / OLX — planilha de importação',
    arquivo: 'catalogo-mercadolivre.csv',
    tipo: 'text/csv; charset=utf-8',
    exige: ['nome', 'preco'],
  },
  crm: {
    nome: 'CRM genérico (HubSpot, RD, Pipedrive)',
    arquivo: 'produtos-crm.csv',
    tipo: 'text/csv; charset=utf-8',
    exige: ['nome', 'preco'],
  },
  json: {
    nome: 'JSON completo (integração própria)',
    arquivo: 'catalogo.json',
    tipo: 'application/json; charset=utf-8',
    exige: [],
  },
};

export const FORMATOS = Object.keys(CANAIS);

/** Nome amigável do campo que falta — o erro tem que dizer o que preencher. */
const ROTULO = {
  nome: 'nome', descricao: 'descrição', link: 'link do produto',
  imagens: 'ao menos 1 imagem', preco: 'preço', marca: 'marca',
};

/** O que impede este produto de ir pra este canal. Lista vazia = pode ir. */
export function faltaPara(produto, canal) {
  const spec = CANAIS[canal];
  if (!spec) { return [`canal desconhecido: "${canal}"`]; }
  const falta = [];
  for (const campo of spec.exige) {
    const v = produto[campo];
    const vazio = campo === 'imagens' ? !(v || []).length
      : campo === 'preco' ? precoVigente(produto) == null
        : !String(v ?? '').trim();
    if (vazio) { falta.push(ROTULO[campo] || campo); }
  }
  return falta;
}

/** Centavos -> "19.90" (os feeds querem ponto decimal, sempre 2 casas). */
export function decimal(centavos) {
  if (centavos == null) { return null; }
  return (Number(centavos) / 100).toFixed(2);
}

/** "19.90 BRL" — formato de preço que Google, Meta e TikTok esperam. */
export function preco(centavos, moeda = 'BRL') {
  const d = decimal(centavos);
  return d == null ? '' : `${d} ${moeda}`;
}

/** Escapa pra XML. Sem isso, um "&" no nome do produto derruba o feed inteiro. */
export function xml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Escapa uma célula de CSV. Campo com vírgula, aspas ou quebra de linha vai entre
 * aspas, e aspas interna vira aspas dupla — é o que o RFC 4180 manda e o que a Meta
 * espera. Sem isso a descrição desloca todas as colunas seguintes.
 */
export function csvCelula(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLinha(valores) {
  return valores.map(csvCelula).join(',');
}

/** Disponibilidade no dialeto de cada canal. */
function disponibilidadeCanal(p, canal) {
  const d = disponibilidade(p);
  if (canal === 'google') { return d; }              // in_stock / out_of_stock
  return d === 'in_stock' ? 'in stock' : 'out of stock'; // Meta e TikTok usam com espaço
}

/* ---------------- um gerador por canal ---------------- */

function paraGoogle(itens, opts) {
  const linhas = itens.map((p) => {
    const promo = p.precoPromocionalCentavos;
    return [
      '    <item>',
      `      <g:id>${xml(p.sku)}</g:id>`,
      `      <g:title>${xml(p.nome)}</g:title>`,
      `      <g:description>${xml(p.descricao)}</g:description>`,
      `      <g:link>${xml(p.link)}</g:link>`,
      `      <g:image_link>${xml(p.imagens[0])}</g:image_link>`,
      ...p.imagens.slice(1, 10).map((i) => `      <g:additional_image_link>${xml(i)}</g:additional_image_link>`),
      `      <g:availability>${disponibilidadeCanal(p, 'google')}</g:availability>`,
      `      <g:condition>${CONDICAO_FEED[p.condicao] || 'new'}</g:condition>`,
      // Em promoção o Google quer o preço CHEIO em `price` e o promocional em
      // `sale_price` — mandar só o promocional apaga o selo de desconto.
      `      <g:price>${preco(p.precoCentavos, p.moeda)}</g:price>`,
      ...(promo != null ? [`      <g:sale_price>${preco(promo, p.moeda)}</g:sale_price>`] : []),
      `      <g:brand>${xml(p.marca)}</g:brand>`,
      ...(p.gtin ? [`      <g:gtin>${xml(p.gtin)}</g:gtin>`] : []),
      ...(p.mpn ? [`      <g:mpn>${xml(p.mpn)}</g:mpn>`] : []),
      // Sem GTIN nem MPN o Google exige dizer que o item não tem identificador.
      ...(!p.gtin && !p.mpn ? ['      <g:identifier_exists>no</g:identifier_exists>'] : []),
      ...(p.categoriaGoogle ? [`      <g:google_product_category>${xml(p.categoriaGoogle)}</g:google_product_category>`] : []),
      ...(p.categoria ? [`      <g:product_type>${xml(p.categoria)}</g:product_type>`] : []),
      `      <g:quantity>${disponivel(p) ?? 0}</g:quantity>`,
      '    </item>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    `    <title>${xml(opts.loja || 'Catálogo')}</title>`,
    `    <link>${xml(opts.site || '')}</link>`,
    `    <description>${xml(`Catálogo gerado em ${opts.em}`)}</description>`,
    ...linhas,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

const CAB_META = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price',
  'link', 'image_link', 'brand', 'google_product_category', 'quantity_to_sell_on_facebook', 'item_group_id'];

function paraMeta(itens) {
  const linhas = itens.map((p) => csvLinha([
    p.sku, p.nome, p.descricao,
    disponibilidadeCanal(p, 'meta'),
    CONDICAO_FEED[p.condicao] || 'new',
    preco(p.precoCentavos, p.moeda),
    p.precoPromocionalCentavos != null ? preco(p.precoPromocionalCentavos, p.moeda) : '',
    p.link, p.imagens[0] || '', p.marca || '',
    p.categoriaGoogle || '',
    disponivel(p) ?? 0,
    p.variantes?.length ? p.sku : '',
  ]));
  return [csvLinha(CAB_META), ...linhas].join('\n') + '\n';
}

const CAB_TIKTOK = ['sku_id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price',
  'landing_page_url', 'image_link', 'brand', 'google_product_category', 'quantity', 'video_link'];

function paraTiktok(itens) {
  const linhas = itens.map((p) => csvLinha([
    p.sku, p.nome, p.descricao,
    disponibilidadeCanal(p, 'tiktok'),
    CONDICAO_FEED[p.condicao] || 'new',
    preco(p.precoCentavos, p.moeda),
    p.precoPromocionalCentavos != null ? preco(p.precoPromocionalCentavos, p.moeda) : '',
    p.link, p.imagens[0] || '', p.marca || '',
    p.categoriaGoogle || '',
    disponivel(p) ?? 0,
    p.videoLink || '',
  ]));
  return [csvLinha(CAB_TIKTOK), ...linhas].join('\n') + '\n';
}

function paraMercadoLivre(itens) {
  const cab = ['titulo', 'sku', 'preco', 'quantidade', 'condicao', 'descricao', 'categoria', 'marca', 'foto_1', 'link'];
  const linhas = itens.map((p) => csvLinha([
    p.nome, p.sku,
    // Planilha brasileira: decimal com vírgula, senão o Excel pt-BR lê 19.90 como 1990.
    decimal(precoVigente(p))?.replace('.', ',') ?? '',
    disponivel(p) ?? 0,
    p.condicao, p.descricao, p.categoria || '', p.marca || '', p.imagens[0] || '', p.link || '',
  ]));
  return [csvLinha(cab), ...linhas].join('\n') + '\n';
}

function paraCrm(itens) {
  const cab = ['name', 'sku', 'price', 'currency', 'description', 'category', 'brand', 'in_stock', 'url'];
  const linhas = itens.map((p) => csvLinha([
    p.nome, p.sku, decimal(precoVigente(p)) ?? '', p.moeda, p.descricao,
    p.categoria || '', p.marca || '', disponivel(p) ?? 0, p.link || '',
  ]));
  return [csvLinha(cab), ...linhas].join('\n') + '\n';
}

function paraJson(itens, opts) {
  return JSON.stringify({ geradoEm: opts.em, total: itens.length, produtos: itens }, null, 2) + '\n';
}

const GERADOR = {
  google: paraGoogle, meta: paraMeta, tiktok: paraTiktok,
  mercadolivre: paraMercadoLivre, crm: paraCrm, json: paraJson,
};

/**
 * Exporta o catálogo num formato.
 *
 * @param {object[]} produtos
 * @param {string} canal
 * @param {{loja?:string, site?:string, incluirInativos?:boolean, em?:string}} [opts]
 * @returns {{ok:boolean, conteudo?:string, arquivo?:string, tipo?:string,
 *            incluidos?:number, recusados?:Array<{sku:string,nome:string,faltando:string[]}>}}
 */
export function exportar(produtos = [], canal = 'json', opts = {}) {
  const spec = CANAIS[canal];
  if (!spec) { return { ok: false, motivo: `formato desconhecido: "${canal}" (use ${FORMATOS.join(', ')})` }; }

  const em = opts.em || new Date().toISOString();
  /* `linkDe`: quem publica a página do produto (a vitrine) diz o endereço dela.
     Link é o campo que mais derruba produto no Google e na Meta, e cobrar do
     dono uma URL que o próprio sistema tem é trabalho à toa. Link escrito à mão
     no produto continua valendo. */
  const comLink = (p) => (!String(p.link || '').trim() && opts.linkDe ? { ...p, link: opts.linkDe(p.sku) } : p);
  const candidatos = (opts.incluirInativos ? produtos : produtos.filter((p) => p.ativo !== false)).map(comLink);

  const itens = [];
  const recusados = [];
  for (const p of candidatos) {
    const falta = faltaPara(p, canal);
    if (falta.length) { recusados.push({ sku: p.sku, nome: p.nome, faltando: falta }); continue; }
    itens.push(p);
  }

  return {
    ok: true,
    canal,
    conteudo: GERADOR[canal](itens, { ...opts, em }),
    arquivo: spec.arquivo,
    tipo: spec.tipo,
    incluidos: itens.length,
    recusados,
    // Inativo não é recusa: foi escolha de não anunciar.
    ignoradosInativos: produtos.length - candidatos.length,
  };
}

/** Prévia pra tela: o que sai e o que fica de fora em CADA canal, sem gerar arquivo. */
export function prontidao(produtos = []) {
  const out = {};
  for (const canal of FORMATOS) {
    const ativos = produtos.filter((p) => p.ativo !== false);
    const prontos = ativos.filter((p) => !faltaPara(p, canal).length);
    out[canal] = {
      nome: CANAIS[canal].nome,
      prontos: prontos.length,
      total: ativos.length,
      faltando: ativos.length - prontos.length,
    };
  }
  return out;
}
