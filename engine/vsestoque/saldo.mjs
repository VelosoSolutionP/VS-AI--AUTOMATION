/**
 * VSestoque — movimentação de saldo. É o que a tela de Estoque dizia não existir:
 * "catálogo, não estoque: não tem quantidade nem reserva".
 *
 * Reserva existe porque vender é um processo, não um instante: entre o cliente dizer
 * "quero" e o pagamento cair, a peça não pode ser oferecida a outro. Sem reserva, dois
 * clientes compram a mesma última unidade e alguém leva o cano.
 *
 * Funções PURAS: recebem o produto e devolvem o produto novo. Nada grava aqui.
 */

export const TIPOS = ['entrada', 'saida', 'reserva', 'liberar', 'vender', 'ajuste'];

/** Frase do que cada tipo faz — a tela usa isso no histórico. */
export const EXPLICA = {
  entrada: 'chegou mercadoria',
  saida: 'saiu sem venda (perda, quebra, uso interno)',
  reserva: 'separado para um cliente',
  liberar: 'reserva desfeita, voltou pra prateleira',
  vender: 'venda confirmada: baixa a reserva e o saldo',
  ajuste: 'contagem corrigiu o saldo',
};

const inteiro = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * Aplica um movimento e devolve o produto resultante.
 * Nunca deixa saldo negativo e nunca deixa reservar o que não existe — devolver erro
 * é melhor que gravar um estoque impossível que ninguém consegue explicar depois.
 *
 * @param {object} produto
 * @param {{tipo:string, quantidade:number, motivo?:string, ref?:string}} mov
 * @param {Function} [agora]
 * @returns {{produto:object|null, movimento:object|null, erro:string|null}}
 */
export function aplicar(produto, mov = {}, agora = () => new Date().toISOString()) {
  if (!produto) { return { produto: null, movimento: null, erro: 'produto não encontrado' }; }

  const tipo = String(mov.tipo || '').toLowerCase();
  if (!TIPOS.includes(tipo)) {
    return { produto: null, movimento: null, erro: `tipo desconhecido: "${mov.tipo}" (use ${TIPOS.join(', ')})` };
  }

  const q = inteiro(mov.quantidade);
  if (q == null) { return { produto: null, movimento: null, erro: `quantidade tem que ser inteiro (veio "${mov.quantidade}")` }; }
  // Ajuste é o único que aceita 0 (contagem que zerou a prateleira é informação real).
  if (tipo !== 'ajuste' && q <= 0) { return { produto: null, movimento: null, erro: 'quantidade tem que ser maior que zero' }; }
  if (tipo === 'ajuste' && q < 0) { return { produto: null, movimento: null, erro: 'ajuste não pode ser negativo — informe a contagem real' }; }

  const quantidade = Number(produto.quantidade || 0);
  const reservado = Number(produto.reservado || 0);
  const livre = Math.max(0, quantidade - reservado);

  let novaQtd = quantidade;
  let novaRes = reservado;

  if (tipo === 'entrada') { novaQtd = quantidade + q; }

  if (tipo === 'saida') {
    // Só pode sair o que não está prometido a alguém.
    if (q > livre) { return { produto: null, movimento: null, erro: `só há ${livre} livre(s) (${quantidade} em estoque, ${reservado} reservado(s))` }; }
    novaQtd = quantidade - q;
  }

  if (tipo === 'reserva') {
    if (q > livre) { return { produto: null, movimento: null, erro: `não dá pra reservar ${q}: só há ${livre} livre(s)` }; }
    novaRes = reservado + q;
  }

  if (tipo === 'liberar') {
    if (q > reservado) { return { produto: null, movimento: null, erro: `só há ${reservado} reservado(s) pra liberar` }; }
    novaRes = reservado - q;
  }

  if (tipo === 'vender') {
    if (q > quantidade) { return { produto: null, movimento: null, erro: `não dá pra vender ${q}: há ${quantidade} em estoque` }; }
    novaQtd = quantidade - q;
    // A venda consome a reserva que existir; o que passar disso saiu do saldo livre.
    novaRes = Math.max(0, reservado - q);
  }

  if (tipo === 'ajuste') {
    novaQtd = q;
    // Contagem abaixo do reservado significa que o prometido já não existe: a reserva
    // encolhe junto, senão o disponível ficaria negativo e o feed mentiria.
    if (novaRes > novaQtd) { novaRes = novaQtd; }
  }

  const movimento = {
    tipo,
    quantidade: q,
    motivo: String(mov.motivo || '').trim() || null,
    ref: String(mov.ref || '').trim() || null,
    de: { quantidade, reservado },
    para: { quantidade: novaQtd, reservado: novaRes },
    em: agora(),
  };

  return {
    produto: { ...produto, quantidade: novaQtd, reservado: novaRes, atualizadoEm: movimento.em },
    movimento,
    erro: null,
  };
}

/**
 * Produtos que merecem atenção: acabou, ou está abaixo do mínimo configurado.
 * O mínimo é por produto; sem mínimo definido, só avisa quando zera.
 */
export function alertas(produtos = []) {
  const out = [];
  for (const p of produtos) {
    if (p.ativo === false) { continue; }
    const livre = Math.max(0, Number(p.quantidade || 0) - Number(p.reservado || 0));
    if (livre === 0) { out.push({ sku: p.sku, nome: p.nome, nivel: 'acabou', livre }); }
    else if (p.minimo != null && livre <= Number(p.minimo)) {
      out.push({ sku: p.sku, nome: p.nome, nivel: 'baixo', livre, minimo: Number(p.minimo) });
    }
  }
  return out;
}

/** Valor do estoque parado, em centavos — é dinheiro na prateleira. */
export function valorEmEstoque(produtos = []) {
  return produtos.reduce((a, p) => a + Number(p.quantidade || 0) * Number(p.precoCentavos || 0), 0);
}
