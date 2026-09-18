/**
 * VSestoque — o produto. Funções PURAS: validam e normalizam, quem grava é o store.
 *
 * Este é o cadastro que faltava na suíte. O VSvendas lê uma pasta de fotos e escreve
 * o TEXTO do anúncio; isso é copy, não catálogo — não tem SKU, preço, saldo nem GTIN.
 * Sem esses campos nenhum feed de Google, Meta ou TikTok aceita o produto.
 *
 * Duas regras que vêm do resto da casa:
 *  - dinheiro em CENTAVOS (inteiro). Float em preço acumula erro e o feed sai com
 *    "19.989999999" — o Google recusa e você descobre uma semana depois.
 *  - o que não se sabe fica `null`, nunca 0. Produto sem GTIN não é "GTIN 0".
 */
import { paraCentavos } from '../vsinfluence/ganhos.mjs';

export const CONDICOES = ['novo', 'usado', 'recondicionado'];

/** Como cada condição se chama nos feeds (a nossa palavra é em português). */
export const CONDICAO_FEED = { novo: 'new', usado: 'used', recondicionado: 'refurbished' };

export const LIMITES = { nomeMax: 150, descricaoMax: 5000, imagensMax: 10 };

const txt = (v) => String(v ?? '').trim();

const slug = (s) => txt(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Valida GTIN/EAN pelo dígito verificador (mod 10). Feed com GTIN inventado é o
 * motivo nº 1 de produto reprovado no Google Merchant — e o erro de lá não diz qual
 * produto, só que o feed tem problema. Melhor barrar aqui.
 * Aceita GTIN-8, 12, 13 e 14.
 */
export function gtinValido(gtin) {
  const d = txt(gtin).replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length)) { return false; }
  const digitos = d.split('').map(Number);
  const verificador = digitos.pop();
  // Da direita pra esquerda, alterna peso 3 e 1.
  const soma = digitos.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === verificador;
}

/** Saldo que pode ser vendido = o que tem menos o que já está reservado. */
export function disponivel(p = {}) {
  const q = Number(p.quantidade);
  const r = Number(p.reservado || 0);
  if (!Number.isFinite(q)) { return null; }
  return Math.max(0, q - (Number.isFinite(r) ? r : 0));
}

/**
 * Disponibilidade é DERIVADA do saldo, nunca digitada. Se fosse um campo livre, o
 * vendedor esqueceria de mudar e o feed anunciaria como disponível o que já acabou —
 * e aí vem pedido que não dá pra atender.
 */
export function disponibilidade(p = {}) {
  if (p.ativo === false) { return 'out_of_stock'; }
  const d = disponivel(p);
  if (d == null) { return 'out_of_stock'; }
  return d > 0 ? 'in_stock' : 'out_of_stock';
}

/** Preço que vale hoje: o promocional quando existe e é menor. */
export function precoVigente(p = {}) {
  const cheio = p.precoCentavos;
  const promo = p.precoPromocionalCentavos;
  if (promo != null && cheio != null && promo < cheio) { return promo; }
  return cheio ?? null;
}

/**
 * Valida e normaliza um produto.
 * @param {object} e entrada crua (da tela ou da CLI)
 * @param {{agora?:Function, existentes?:string[]}} [opts]
 * @returns {{produto:object|null, erros:string[], avisos:string[]}}
 */
export function normalizarProduto(e = {}, opts = {}) {
  const erros = [];
  const avisos = [];
  const agora = (opts.agora || (() => new Date().toISOString()))();

  const nome = txt(e.nome);
  if (!nome) { erros.push('nome é obrigatório'); }
  if (nome.length > LIMITES.nomeMax) { erros.push(`nome passou de ${LIMITES.nomeMax} caracteres (tem ${nome.length})`); }

  const descricao = txt(e.descricao);
  if (descricao.length > LIMITES.descricaoMax) { erros.push(`descrição passou de ${LIMITES.descricaoMax} caracteres`); }

  // SKU sai do nome quando não vier — mas colidir é erro, não "resolve sozinho":
  // dois produtos com o mesmo id fazem o feed sobrescrever um com o outro.
  let sku = txt(e.sku) || slug(nome).slice(0, 40);
  if (!sku) { erros.push('não consegui derivar um SKU do nome — informe `sku`'); }
  if (opts.existentes?.includes(sku) && sku !== txt(e.skuOriginal)) {
    erros.push(`já existe produto com o SKU "${sku}"`);
  }

  const precoCentavos = e.preco == null || e.preco === '' ? null : paraCentavos(e.preco);
  if (precoCentavos == null) { erros.push(`preço inválido: "${e.preco}"`); }
  else if (precoCentavos <= 0) { erros.push('preço tem que ser maior que zero'); }

  let promo = null;
  if (e.precoPromocional != null && e.precoPromocional !== '') {
    promo = paraCentavos(e.precoPromocional);
    if (promo == null || promo <= 0) { erros.push(`preço promocional inválido: "${e.precoPromocional}"`); }
    else if (precoCentavos != null && promo >= precoCentavos) {
      erros.push('o preço promocional tem que ser MENOR que o preço cheio');
    }
  }

  const quantidade = e.quantidade == null || e.quantidade === '' ? 0 : Number(e.quantidade);
  if (!Number.isInteger(quantidade) || quantidade < 0) { erros.push(`quantidade tem que ser inteiro >= 0 (veio "${e.quantidade}")`); }

  const reservado = e.reservado == null || e.reservado === '' ? 0 : Number(e.reservado);
  if (!Number.isInteger(reservado) || reservado < 0) { erros.push(`reservado tem que ser inteiro >= 0 (veio "${e.reservado}")`); }
  if (Number.isInteger(quantidade) && Number.isInteger(reservado) && reservado > quantidade) {
    erros.push(`não dá pra reservar ${reservado} tendo ${quantidade} em estoque`);
  }

  const condicao = txt(e.condicao).toLowerCase() || 'novo';
  if (!CONDICOES.includes(condicao)) { erros.push(`condição desconhecida: "${e.condicao}" (use ${CONDICOES.join(', ')})`); }

  const gtin = txt(e.gtin).replace(/\D/g, '');
  if (gtin && !gtinValido(gtin)) { erros.push(`GTIN/EAN "${e.gtin}" não passa no dígito verificador — confira o código de barras`); }

  const imagens = (e.imagens || []).map(txt).filter(Boolean);
  for (const img of imagens) {
    if (!/^https?:\/\//i.test(img)) { erros.push(`imagem precisa ser URL http(s): "${img}"`); }
  }
  if (imagens.length > LIMITES.imagensMax) { erros.push(`no máximo ${LIMITES.imagensMax} imagens`); }

  const link = txt(e.link);
  if (link && !/^https?:\/\//i.test(link)) { erros.push('link precisa começar com http:// ou https://'); }

  const moeda = (txt(e.moeda) || 'BRL').toUpperCase();
  if (!/^[A-Z]{3}$/.test(moeda)) { erros.push(`moeda inválida: "${e.moeda}"`); }

  // Avisos: não impedem gravar, mas impedem EXPORTAR pra alguns canais.
  if (!imagens.length) { avisos.push('sem imagem — Google, Meta e TikTok não aceitam produto sem foto'); }
  if (!link) { avisos.push('sem link do produto — os feeds de compra exigem a página de destino'); }
  if (!gtin && !txt(e.mpn)) { avisos.push('sem GTIN e sem MPN — o Google costuma pedir um dos dois'); }
  if (!txt(e.marca)) { avisos.push('sem marca — campo obrigatório no feed do Google'); }

  if (erros.length) { return { produto: null, erros, avisos }; }

  return {
    produto: {
      sku,
      nome,
      descricao,
      marca: txt(e.marca) || null,
      categoria: txt(e.categoria) || null,
      categoriaGoogle: txt(e.categoriaGoogle) || null,
      gtin: gtin || null,
      mpn: txt(e.mpn) || null,
      condicao,
      precoCentavos,
      precoPromocionalCentavos: promo,
      moeda,
      quantidade,
      reservado,
      imagens,
      link: link || null,
      peso: e.peso ? { valor: Number(e.peso.valor), unidade: txt(e.peso.unidade).toLowerCase() || 'g' } : null,
      variantes: (e.variantes || []).map((v) => ({
        sku: txt(v.sku) || `${sku}-${slug(Object.values(v.atributos || {}).join('-'))}`,
        atributos: v.atributos || {},
        precoCentavos: v.preco == null ? null : paraCentavos(v.preco),
        quantidade: Number.isInteger(Number(v.quantidade)) ? Number(v.quantidade) : 0,
      })),
      ativo: e.ativo !== false,
      criadoEm: e.criadoEm || agora,
      atualizadoEm: agora,
    },
    erros: [],
    avisos,
  };
}
