/**
 * VStiktok — catálogo (TikTok Shop). Cadastro, edição, estoque, preço e publicação
 * de produto.
 *
 * A validação é feita ANTES de chamar a API de propósito. A Shop API recusa o produto
 * inteiro com um `code` genérico quando qualquer campo está fora do formato, sem dizer
 * qual — então o vendedor mandaria 5 vezes sem entender. Aqui o erro sai em português,
 * apontando o campo, e a chamada nem chega a sair.
 *
 * Dinheiro entra em centavos (padrão da suíte) e só vira string decimal na borda,
 * porque é assim que a TikTok quer ("19.99").
 */
import { chamar } from './api.mjs';
import { paraCentavos } from '../vsinfluence/ganhos.mjs';

/** Versão da Shop API usada nas rotas. Fica visível pra troca ser consciente. */
export const V = '202309';

export const UNIDADES_PESO = ['GRAM', 'KILOGRAM', 'POUND'];
export const UNIDADES_DIMENSAO = ['CENTIMETER', 'INCH'];

/** Limites documentados pela TikTok — validar aqui evita um round-trip perdido. */
export const LIMITES = {
  tituloMax: 255,
  descricaoMax: 10000,
  imagensMin: 1,
  imagensMax: 9,
  skusMax: 100,
};

const txt = (v) => String(v ?? '').trim();

/** Centavos -> "19.99" (a Shop API só aceita decimal em string). */
export function centavosParaDecimal(centavos) {
  if (!Number.isFinite(Number(centavos))) { return null; }
  return (Number(centavos) / 100).toFixed(2);
}

/**
 * Valida e monta o payload de um produto.
 *
 * @param {object} p
 * @param {string} p.titulo
 * @param {string} p.descricao        aceita HTML simples (a TikTok renderiza)
 * @param {string} p.categoriaId
 * @param {string[]} p.imagens        URIs já enviadas por `enviarImagem`
 * @param {Array} p.skus              [{sku, preco, estoque, armazemId, atributos?}]
 * @param {string} p.moeda            ISO-4217 da loja (BRL, USD...)
 * @param {object} [p.peso]           {valor, unidade}
 * @param {object} [p.dimensoes]      {comprimento, largura, altura, unidade}
 * @param {string} [p.marcaId]
 */
export function normalizarProduto(p = {}) {
  const erros = [];

  const titulo = txt(p.titulo);
  if (!titulo) { erros.push('título é obrigatório'); }
  if (titulo.length > LIMITES.tituloMax) { erros.push(`título passou de ${LIMITES.tituloMax} caracteres (tem ${titulo.length})`); }

  const descricao = txt(p.descricao);
  if (!descricao) { erros.push('descrição é obrigatória'); }
  if (descricao.length > LIMITES.descricaoMax) { erros.push(`descrição passou de ${LIMITES.descricaoMax} caracteres (tem ${descricao.length})`); }

  const categoriaId = txt(p.categoriaId);
  if (!categoriaId) { erros.push('categoriaId é obrigatório (liste com `categorias`)'); }

  const moeda = txt(p.moeda).toUpperCase();
  if (!/^[A-Z]{3}$/.test(moeda)) { erros.push(`moeda inválida: "${p.moeda}" (use o código de 3 letras da loja, ex.: BRL)`); }

  const imagens = (p.imagens || []).map(txt).filter(Boolean);
  if (imagens.length < LIMITES.imagensMin) { erros.push('envie ao menos 1 imagem (use `enviarImagem` antes e passe o URI devolvido)'); }
  if (imagens.length > LIMITES.imagensMax) { erros.push(`no máximo ${LIMITES.imagensMax} imagens (tem ${imagens.length})`); }

  const skusEntrada = p.skus || [];
  if (!skusEntrada.length) { erros.push('o produto precisa de ao menos 1 SKU'); }
  if (skusEntrada.length > LIMITES.skusMax) { erros.push(`no máximo ${LIMITES.skusMax} SKUs (tem ${skusEntrada.length})`); }

  const skus = [];
  skusEntrada.forEach((s, i) => {
    const rot = `SKU ${i + 1}`;
    const centavos = paraCentavos(s.preco);
    if (centavos == null) { erros.push(`${rot}: preço inválido ("${s.preco}")`); }
    else if (centavos <= 0) { erros.push(`${rot}: preço tem que ser maior que zero`); }

    const estoque = Number(s.estoque);
    if (!Number.isInteger(estoque) || estoque < 0) { erros.push(`${rot}: estoque tem que ser inteiro >= 0 (veio "${s.estoque}")`); }

    const armazemId = txt(s.armazemId);
    if (!armazemId) { erros.push(`${rot}: armazemId é obrigatório (liste com \`armazens\`)`); }

    skus.push({
      seller_sku: txt(s.sku) || undefined,
      sales_attributes: s.atributos || [],
      inventory: [{ warehouse_id: armazemId, quantity: Number.isInteger(estoque) ? estoque : 0 }],
      price: { amount: centavosParaDecimal(centavos ?? 0), currency: moeda },
    });
  });

  const peso = p.peso || {};
  const unidadePeso = txt(peso.unidade).toUpperCase() || 'GRAM';
  if (!UNIDADES_PESO.includes(unidadePeso)) { erros.push(`unidade de peso inválida: "${peso.unidade}" (use ${UNIDADES_PESO.join(', ')})`); }
  if (peso.valor != null && !(Number(peso.valor) > 0)) { erros.push('peso tem que ser maior que zero'); }

  let dimensoes;
  if (p.dimensoes) {
    const d = p.dimensoes;
    const un = txt(d.unidade).toUpperCase() || 'CENTIMETER';
    if (!UNIDADES_DIMENSAO.includes(un)) { erros.push(`unidade de dimensão inválida: "${d.unidade}" (use ${UNIDADES_DIMENSAO.join(', ')})`); }
    for (const [k, v] of [['comprimento', d.comprimento], ['largura', d.largura], ['altura', d.altura]]) {
      if (!(Number(v) > 0)) { erros.push(`${k} tem que ser maior que zero`); }
    }
    dimensoes = {
      length: String(d.comprimento), width: String(d.largura), height: String(d.altura), unit: un,
    };
  }

  if (erros.length) { return { produto: null, erros }; }

  const produto = {
    title: titulo,
    description: descricao,
    category_id: categoriaId,
    main_images: imagens.map((uri) => ({ uri })),
    skus,
    package_weight: { value: String(peso.valor ?? 1), unit: unidadePeso },
  };
  if (dimensoes) { produto.package_dimensions = dimensoes; }
  if (txt(p.marcaId)) { produto.brand_id = txt(p.marcaId); }
  if (p.permiteCod != null) { produto.is_cod_allowed = Boolean(p.permiteCod); }

  return { produto, erros: [] };
}

/** Atalho: toda rota de produto é shop + os mesmos parâmetros de assinatura. */
function req(ctx = {}, caminho, extra = {}) {
  return chamar('shop', caminho, {
    token: ctx.token,
    appKey: ctx.appKey,
    appSecret: ctx.appSecret,
    shopCipher: ctx.shopCipher,
    fetchImpl: ctx.fetchImpl,
    esperar: ctx.esperar,
    agora: ctx.agora,
    timeoutMs: ctx.timeoutMs,
    tentativas: ctx.tentativas,
    ...extra,
  });
}

/** Lojas que autorizaram o app — é daqui que sai o shop_cipher de todas as outras chamadas. */
export async function lojas(ctx = {}) {
  return req(ctx, `/authorization/${V}/shops`, { metodo: 'GET', shopCipher: null });
}

/** Árvore de categorias. Sem categoria válida a TikTok recusa o produto inteiro. */
export async function categorias(ctx = {}, opts = {}) {
  return req(ctx, `/product/${V}/categories`, { metodo: 'GET', query: { locale: opts.locale || 'pt-BR' } });
}

/** Atributos obrigatórios/opcionais de uma categoria (varia por categoria). */
export async function atributosDaCategoria(ctx = {}, categoriaId) {
  if (!txt(categoriaId)) { return { ok: false, motivo: 'categoriaId é obrigatório' }; }
  return req(ctx, `/product/${V}/categories/${encodeURIComponent(categoriaId)}/attributes`, { metodo: 'GET' });
}

/** Marcas cadastradas (brand_id é opcional, mas algumas categorias exigem). */
export async function marcas(ctx = {}, opts = {}) {
  return req(ctx, `/product/${V}/brands`, {
    metodo: 'GET',
    query: { page_size: opts.tamanho || 50, page_token: opts.cursor || undefined },
  });
}

/** Armazéns da loja — o warehouse_id de cada SKU sai daqui. */
export async function armazens(ctx = {}) {
  return req(ctx, `/logistics/${V}/warehouses`, { metodo: 'GET' });
}

/**
 * Sobe uma imagem e devolve o `uri` que o cadastro do produto consome.
 * A TikTok NÃO aceita URL de imagem no produto: tem que passar por aqui antes.
 * @param {Buffer|Uint8Array} bytes
 */
export async function enviarImagem(ctx = {}, bytes, opts = {}) {
  if (!bytes || !bytes.length) { return { ok: false, motivo: 'imagem vazia' }; }
  if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    return { ok: false, motivo: 'este Node nao tem FormData/Blob — use Node 18+' };
  }
  const fd = new FormData();
  fd.append('data', new Blob([bytes]), opts.nome || 'imagem.jpg');
  fd.append('use_case', opts.uso || 'MAIN_IMAGE');
  // multipart fica FORA da assinatura (regra da TikTok) — por isso o corpo vai cru.
  return req(ctx, `/product/${V}/images/upload`, { metodo: 'POST', corpo: fd, multipart: true });
}

/** Cria o produto. Valida primeiro; erro de campo nem chega a virar chamada. */
export async function criar(ctx = {}, p = {}) {
  const { produto, erros } = normalizarProduto(p);
  if (erros.length) { return { ok: false, motivo: 'produto invalido: ' + erros.join('; '), erros }; }
  return req(ctx, `/product/${V}/products`, { metodo: 'POST', corpo: produto });
}

/** Edita um produto existente (payload completo, igual ao create). */
export async function editar(ctx = {}, produtoId, p = {}) {
  if (!txt(produtoId)) { return { ok: false, motivo: 'produtoId é obrigatório' }; }
  const { produto, erros } = normalizarProduto(p);
  if (erros.length) { return { ok: false, motivo: 'produto invalido: ' + erros.join('; '), erros }; }
  return req(ctx, `/product/${V}/products/${encodeURIComponent(produtoId)}`, { metodo: 'PUT', corpo: produto });
}

/** Detalhe de um produto. */
export async function detalhe(ctx = {}, produtoId) {
  if (!txt(produtoId)) { return { ok: false, motivo: 'produtoId é obrigatório' }; }
  return req(ctx, `/product/${V}/products/${encodeURIComponent(produtoId)}`, { metodo: 'GET' });
}

/**
 * Busca produtos da loja. `cursor` é o page_token da página anterior — a Shop API
 * pagina por token, não por número de página.
 */
export async function buscar(ctx = {}, filtros = {}) {
  const corpo = {};
  if (txt(filtros.texto)) { corpo.title_keyword = txt(filtros.texto); }
  if (filtros.status) { corpo.status = String(filtros.status).toUpperCase(); }
  if (filtros.ids?.length) { corpo.product_ids = filtros.ids; }
  return req(ctx, `/product/${V}/products/search`, {
    metodo: 'POST',
    query: { page_size: filtros.tamanho || 20, page_token: filtros.cursor || undefined },
    corpo,
  });
}

function listaIds(ids) {
  const arr = (Array.isArray(ids) ? ids : [ids]).map(txt).filter(Boolean);
  return arr.length ? arr : null;
}

/** Publica (ativa) produtos. */
export async function ativar(ctx = {}, ids) {
  const product_ids = listaIds(ids);
  if (!product_ids) { return { ok: false, motivo: 'informe ao menos um produtoId' }; }
  return req(ctx, `/product/${V}/products/activate`, { metodo: 'POST', corpo: { product_ids } });
}

/** Tira da vitrine sem excluir — é o que se usa pra pausar venda. */
export async function desativar(ctx = {}, ids) {
  const product_ids = listaIds(ids);
  if (!product_ids) { return { ok: false, motivo: 'informe ao menos um produtoId' }; }
  return req(ctx, `/product/${V}/products/deactivate`, { metodo: 'POST', corpo: { product_ids } });
}

/** Exclui de vez. Separado de `desativar` porque não tem volta. */
export async function excluir(ctx = {}, ids) {
  const product_ids = listaIds(ids);
  if (!product_ids) { return { ok: false, motivo: 'informe ao menos um produtoId' }; }
  return req(ctx, `/product/${V}/products`, { metodo: 'DELETE', corpo: { product_ids } });
}

/**
 * Atualiza só o estoque — rota própria, bem mais barata que reenviar o produto.
 * @param {Array<{skuId:string, armazemId:string, quantidade:number}>} itens
 */
export async function atualizarEstoque(ctx = {}, produtoId, itens = []) {
  if (!txt(produtoId)) { return { ok: false, motivo: 'produtoId é obrigatório' }; }
  const erros = [];
  const skus = itens.map((it, i) => {
    if (!txt(it.skuId)) { erros.push(`item ${i + 1}: skuId é obrigatório`); }
    if (!txt(it.armazemId)) { erros.push(`item ${i + 1}: armazemId é obrigatório`); }
    if (!Number.isInteger(Number(it.quantidade)) || Number(it.quantidade) < 0) {
      erros.push(`item ${i + 1}: quantidade tem que ser inteiro >= 0`);
    }
    return { id: txt(it.skuId), inventory: [{ warehouse_id: txt(it.armazemId), quantity: Number(it.quantidade) }] };
  });
  if (!skus.length) { erros.push('informe ao menos um SKU'); }
  if (erros.length) { return { ok: false, motivo: erros.join('; '), erros }; }
  return req(ctx, `/product/${V}/products/${encodeURIComponent(produtoId)}/inventory/update`, { metodo: 'POST', corpo: { skus } });
}

/**
 * Atualiza só o preço. Preço entra em centavos e sai decimal, como no cadastro.
 * @param {Array<{skuId:string, preco:*}>} itens
 */
export async function atualizarPreco(ctx = {}, produtoId, itens = [], moeda) {
  if (!txt(produtoId)) { return { ok: false, motivo: 'produtoId é obrigatório' }; }
  const cur = txt(moeda).toUpperCase();
  const erros = [];
  if (!/^[A-Z]{3}$/.test(cur)) { erros.push(`moeda inválida: "${moeda}"`); }
  const skus = itens.map((it, i) => {
    const centavos = paraCentavos(it.preco);
    if (!txt(it.skuId)) { erros.push(`item ${i + 1}: skuId é obrigatório`); }
    if (centavos == null || centavos <= 0) { erros.push(`item ${i + 1}: preço inválido ("${it.preco}")`); }
    return { id: txt(it.skuId), price: { amount: centavosParaDecimal(centavos ?? 0), currency: cur } };
  });
  if (!skus.length) { erros.push('informe ao menos um SKU'); }
  if (erros.length) { return { ok: false, motivo: erros.join('; '), erros }; }
  return req(ctx, `/product/${V}/products/${encodeURIComponent(produtoId)}/prices/update`, { metodo: 'POST', corpo: { skus } });
}
