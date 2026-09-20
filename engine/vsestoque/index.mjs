/**
 * VSestoque — orquestrador. Cadastro de produto, saldo com reserva, exportação pros
 * canais e a ponte pro TikTok Shop.
 *
 * As decisões vivem nos módulos puros (produto.mjs, saldo.mjs, exportar.mjs); aqui só
 * tem I/O e composição, como no VSinfluence.
 */
import { load, save } from './store.mjs';
import { normalizarProduto, disponivel, disponibilidade, precoVigente } from './produto.mjs';
import { aplicar, alertas, valorEmEstoque } from './saldo.mjs';
import { exportar as exportarCanal, prontidao, FORMATOS, CANAIS, decimal } from './exportar.mjs';
import { formatarBRL } from '../vsinfluence/ganhos.mjs';
import * as lote from './lote.mjs';

const PRODUTOS = 'produtos';
const MOVIMENTOS = 'movimentos';

export { FORMATOS, CANAIS, prontidao };

export function listar(opts = {}) {
  const todos = load(PRODUTOS, []);
  if (opts.texto) {
    const t = String(opts.texto).toLowerCase();
    return todos.filter((p) => `${p.nome} ${p.sku} ${p.marca || ''} ${p.categoria || ''}`.toLowerCase().includes(t));
  }
  if (opts.inativos === false) { return todos.filter((p) => p.ativo !== false); }
  return todos;
}

export function obter(sku) {
  return listar().find((p) => p.sku === String(sku)) || null;
}

/** Cadastra. Recusa SKU repetido — id duplicado faz o feed sobrescrever um com o outro. */
export function criar(entrada, opts = {}) {
  const atuais = listar();
  const r = normalizarProduto(entrada, { ...opts, existentes: atuais.map((p) => p.sku) });
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }
  save(PRODUTOS, [...atuais, r.produto]);
  return { ok: true, produto: r.produto, avisos: r.avisos };
}

/** Edita mantendo o que não foi enviado — a tela manda só o que mudou. */
export function editar(sku, mudancas, opts = {}) {
  const atuais = listar();
  const i = atuais.findIndex((p) => p.sku === String(sku));
  if (i < 0) { return { ok: false, erros: [`produto "${sku}" não encontrado`] }; }

  const antigo = atuais[i];
  const bruto = {
    ...antigo,
    // A forma crua usa `preco`; o gravado usa `precoCentavos`. Reconverte pra centavos
    // só o que NÃO veio na edição, senão o valor antigo seria reinterpretado.
    preco: mudancas.preco ?? (antigo.precoCentavos == null ? '' : antigo.precoCentavos / 100),
    precoPromocional: mudancas.precoPromocional
      ?? (antigo.precoPromocionalCentavos == null ? '' : antigo.precoPromocionalCentavos / 100),
    ...mudancas,
    skuOriginal: antigo.sku,
    criadoEm: antigo.criadoEm,
  };

  const r = normalizarProduto(bruto, { ...opts, existentes: atuais.map((p) => p.sku) });
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }
  atuais[i] = r.produto;
  save(PRODUTOS, atuais);
  return { ok: true, produto: r.produto, avisos: r.avisos };
}

/** Tira da vitrine sem apagar — é o que se usa pra parar de anunciar. */
/** Poe ou tira da vitrine publica. */
export function vitrine(sku, expor = true) { return editar(sku, { naVitrine: expor === true }); }

/** O que a loja publica mostra: exposto, ativo e com saldo — nessa ordem. */
export function daVitrine() {
  return listar().filter((p) => p.naVitrine && p.ativo !== false).map((p) => ({
    sku: p.sku,
    nome: p.nome,
    descricao: p.descricao,
    marca: p.marca,
    categoria: p.categoria,
    precoCentavos: precoVigente(p),
    precoDeCentavos: p.precoPromocionalCentavos != null ? p.precoCentavos : null,
    imagem: p.imagens?.[0] || null,
    disponivel: disponivel(p),
    esgotado: disponivel(p) <= 0,
  }));
}

export function inativar(sku) { return editar(sku, { ativo: false }); }
export function reativar(sku) { return editar(sku, { ativo: true }); }

/** Apaga de vez. Separado de inativar porque não tem volta. */
export function excluir(sku) {
  const atuais = listar();
  const restantes = atuais.filter((p) => p.sku !== String(sku));
  if (restantes.length === atuais.length) { return { ok: false, erros: [`produto "${sku}" não encontrado`] }; }
  save(PRODUTOS, restantes);
  return { ok: true, sku };
}

/** Movimenta o saldo e guarda o histórico — quem mexeu no estoque e por quê. */
export function movimentar(sku, mov, agora) {
  const atuais = listar();
  const i = atuais.findIndex((p) => p.sku === String(sku));
  if (i < 0) { return { ok: false, erro: `produto "${sku}" não encontrado` }; }

  const r = aplicar(atuais[i], mov, agora);
  if (r.erro) { return { ok: false, erro: r.erro }; }

  atuais[i] = r.produto;
  save(PRODUTOS, atuais);
  save(MOVIMENTOS, [{ sku: r.produto.sku, ...r.movimento }, ...load(MOVIMENTOS, [])].slice(0, 2000));
  return { ok: true, produto: r.produto, movimento: r.movimento };
}

export function historico(sku, limite = 50) {
  const todos = load(MOVIMENTOS, []);
  return (sku ? todos.filter((m) => m.sku === String(sku)) : todos).slice(0, limite);
}

/** Exporta o catálogo num canal. */
/* ---------------- lotes de exportação ---------------- */

export function criarLote(e = {}) {
  return lote.criarLote(listar(), e);
}
export const lotes = () => lote.resumirLotes();
export const obterLote = (id) => lote.obterLote(id);
export const excluirLote = (id) => lote.excluirLote(id);

export function exportar(canal, opts = {}) {
  return exportarCanal(listar(), canal, opts);
}

/** Visão da tela: números, alertas e o que está pronto pra cada canal. */
export function painel() {
  const produtos = listar();
  const ativos = produtos.filter((p) => p.ativo !== false);
  const valor = valorEmEstoque(produtos);
  return {
    total: produtos.length,
    ativos: ativos.length,
    semEstoque: ativos.filter((p) => (disponivel(p) ?? 0) === 0).length,
    unidades: produtos.reduce((a, p) => a + Number(p.quantidade || 0), 0),
    reservadas: produtos.reduce((a, p) => a + Number(p.reservado || 0), 0),
    valorCentavos: valor,
    valorFormatado: formatarBRL(valor),
    alertas: alertas(produtos),
    canais: prontidao(produtos),
    produtos: produtos.map(resumir),
  };
}

/** Forma enxuta pra tela e pra API — sem despejar o objeto inteiro. */
export function resumir(p) {
  return {
    sku: p.sku,
    nome: p.nome,
    marca: p.marca,
    categoria: p.categoria,
    precoCentavos: p.precoCentavos,
    precoFormatado: formatarBRL(p.precoCentavos),
    promocionalFormatado: p.precoPromocionalCentavos == null ? null : formatarBRL(p.precoPromocionalCentavos),
    vigenteFormatado: formatarBRL(precoVigente(p)),
    quantidade: p.quantidade,
    reservado: p.reservado,
    disponivel: disponivel(p),
    disponibilidade: disponibilidade(p),
    imagens: p.imagens?.length || 0,
    ativo: p.ativo !== false,
    naVitrine: p.naVitrine === true,
  };
}

/**
 * Manda um produto do catálogo local pro TikTok Shop.
 *
 * O import é dinâmico de propósito: quem só usa estoque e exportação por arquivo não
 * deve carregar (nem precisar configurar) o módulo do TikTok.
 */
export async function publicarNoTiktok(sku, opts = {}) {
  const p = obter(sku);
  if (!p) { return { ok: false, motivo: `produto "${sku}" não encontrado` }; }
  if (!opts.armazemId) { return { ok: false, motivo: 'informe o armazemId do TikTok Shop (liste com `vstiktok armazens`)' }; }
  if (!opts.categoriaId) { return { ok: false, motivo: 'informe a categoriaId do TikTok Shop (liste com `vstiktok categorias`)' }; }
  if (!p.imagens?.length) { return { ok: false, motivo: 'o TikTok Shop não aceita produto sem imagem' }; }

  const vs = await import('../vstiktok/index.mjs');
  return vs.cadastrarProduto({
    titulo: p.nome,
    descricao: p.descricao || p.nome,
    categoriaId: opts.categoriaId,
    marcaId: opts.marcaId,
    moeda: p.moeda,
    // O TikTok Shop exige URI de imagem JÁ ENVIADA pela API dele — a URL pública do
    // nosso catálogo não serve. Quem chama sobe antes e passa os URIs aqui.
    imagens: opts.imagensUri || [],
    peso: p.peso ? { valor: p.peso.valor, unidade: p.peso.unidade === 'kg' ? 'KILOGRAM' : 'GRAM' } : undefined,
    skus: [{
      sku: p.sku,
      preco: (precoVigente(p) || 0) / 100,
      estoque: disponivel(p) ?? 0,
      armazemId: opts.armazemId,
    }],
  }, opts);
}

export { decimal, disponivel, disponibilidade, precoVigente };
