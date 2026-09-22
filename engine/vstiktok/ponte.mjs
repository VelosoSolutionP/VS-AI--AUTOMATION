/**
 * Do produto do painel para o produto da TikTok Shop.
 *
 * Tradutor puro: entra o produto canônico do estoque, sai o payload que a Shop
 * API entende. Não conhece disco, rede nem o módulo de estoque — recebe um
 * objeto simples, para que a regra possa ser testada sem nada em volta.
 *
 * O que ele carrega de verdade são as três decisões que separam "integração que
 * funciona" de "integração que vende errado": qual preço vai, quanto estoque
 * vai, e o que fazer quando falta um campo que só a TikTok exige.
 */

/** Campos que a TikTok exige e o estoque do painel não tem como saber. */
export const EXIGIDOS_DA_TIKTOK = ['categoriaId', 'armazemId'];

const txt = (v) => String(v ?? '').trim();

/**
 * Preço que vai para a TikTok.
 *
 * Vai o preço VIGENTE — o que a loja está cobrando hoje. Mandar o cheio faria o
 * cliente da TikTok pagar mais caro que o do site na mesma hora, e mandar o
 * promocional sem avisar é pior: a TikTok não guarda data de fim, então a
 * promoção viraria preço eterno lá. Por isso vai o vigente COM aviso.
 */
export function precoParaTiktok(p = {}) {
  const promo = p.precoPromocionalCentavos;
  const cheio = p.precoCentavos;
  if (promo != null && promo > 0 && promo < cheio) {
    return {
      centavos: promo,
      aviso: 'este produto está em promoção e a TikTok não guarda data de fim — quando a promoção acabar, publique de novo para o preço voltar',
    };
  }
  return { centavos: cheio, aviso: null };
}

/**
 * Quantidade que vai para a TikTok.
 *
 * Vai o DISPONÍVEL (quantidade menos reservado), nunca o bruto. Reservado é
 * item que já tem dono; anunciar ele na TikTok é vender duas vezes a mesma
 * peça, e quem explica para o comprador é o lojista.
 */
export function estoqueParaTiktok(p = {}) {
  const q = Number(p.quantidade || 0);
  const r = Number(p.reservado || 0);
  return Math.max(0, q - r);
}

/**
 * Monta o payload. Devolve `{ produto, erros, avisos }` — nunca lança.
 *
 * Os erros aqui são de CONFIGURAÇÃO, não de produto: a TikTok responderia com
 * um código cru que não ajuda ninguém, e o lojista ficaria olhando "erro 11000"
 * sem saber que faltou escolher a categoria.
 */
export function paraTiktok(p = {}, cfg = {}) {
  const erros = [];
  const avisos = [];

  const categoriaId = txt(cfg.categoriaId || p.tiktokCategoriaId);
  if (!categoriaId) {
    erros.push('escolha a categoria da TikTok para este catálogo — ela é obrigatória lá e não existe no estoque daqui');
  }
  const armazemId = txt(cfg.armazemId);
  if (!armazemId) {
    erros.push('escolha o armazém da TikTok — é dele que sai o estoque informado');
  }

  const imagens = (cfg.imagensUri || []).filter(Boolean);
  if (!imagens.length) {
    erros.push('o produto precisa de ao menos uma imagem enviada à TikTok');
  }

  const preco = precoParaTiktok(p);
  if (preco.aviso) { avisos.push(preco.aviso); }

  const disponivel = estoqueParaTiktok(p);
  if (disponivel === 0) {
    /* Não é erro: produto esgotado pode e deve existir no catálogo, só não
       vende. Barrar aqui obrigaria o lojista a apagar e recriar a cada
       reposição, perdendo avaliações e histórico. */
    avisos.push('estoque disponível é zero — o produto vai para a TikTok, mas sem poder ser vendido até repor');
  }
  if (Number(p.reservado || 0) > 0) {
    avisos.push(`${p.reservado} unidade(s) reservada(s) não foram anunciadas — reservado já tem dono`);
  }

  const descricao = txt(p.descricao) || txt(p.nome);
  if (!txt(p.descricao)) {
    avisos.push('sem descrição no estoque — usei o nome do produto, mas descrição vazia vende menos');
  }

  if (erros.length) { return { produto: null, erros, avisos }; }

  return {
    erros: [],
    avisos,
    produto: {
      titulo: txt(p.nome),
      descricao,
      categoriaId,
      moeda: txt(p.moeda) || 'BRL',
      imagens,
      marca: txt(p.marca) || undefined,
      skus: [{
        sku: txt(p.sku),
        preco: preco.centavos,
        estoque: disponivel,
        armazemId,
      }],
    },
  };
}

/**
 * O que já foi publicado, por SKU.
 *
 * Republicar sem isto criaria um produto NOVO na loja a cada envio — com o
 * mesmo nome, disputando busca com ele mesmo e dividindo as avaliações. Com o
 * id guardado, o segundo envio vira edição.
 */
export function jaPublicado(mapa = {}, sku) {
  const r = mapa[txt(sku)];
  return r ? { produtoId: r.produtoId, em: r.em } : null;
}

export function registrarPublicado(mapa = {}, sku, produtoId, quando = new Date().toISOString()) {
  return { ...mapa, [txt(sku)]: { produtoId: txt(produtoId), em: quando } };
}
