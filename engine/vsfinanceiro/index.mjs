/**
 * VSfinanceiro — livro-caixa da operação.
 *
 * Existe porque a tela Financeira só CONSOLIDAVA (receita do funil, estoque
 * parado) e não registrava nada: não dava pra lançar uma despesa, nem ver o que
 * entrou de verdade contra o que foi prometido.
 *
 * Não é contabilidade: é caixa operacional. A diferença está escrita na tela, pra
 * ninguém usar isto como fechamento fiscal.
 */
import { load, save } from './store.mjs';
import { normalizar, resumir, filtrar, TIPOS, CATEGORIAS, FORMAS, paraCentavos, paraData, hoje } from './lancamento.mjs';

const LANC = 'lancamentos';

export { TIPOS, CATEGORIAS, FORMAS, paraCentavos, resumir, filtrar };

/** Excluído sai de tudo por padrão — mesmo contrato do estoque. */
export function listar(opts = {}) {
  const todos = load(LANC, []);
  return opts.incluirExcluidos ? todos : todos.filter((l) => !l.excluidoEm);
}

export const obter = (id) => listar().find((l) => l.id === String(id)) || null;

export function criar(entrada, opts = {}) {
  const r = normalizar(entrada, opts);
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }

  // Mesma origem + mesma referência = mesmo dinheiro. Sem isto, o webhook do
  // Asaas reentregue lançaria a mesma venda duas vezes no caixa.
  if (r.lancamento.ref && r.lancamento.origem !== 'manual') {
    const igual = listar().find((l) => l.origem === r.lancamento.origem && l.ref === r.lancamento.ref);
    if (igual) { return { ok: true, lancamento: igual, repetido: true }; }
  }

  save(LANC, [...load(LANC, []), r.lancamento]);
  return { ok: true, lancamento: r.lancamento, avisos: r.avisos };
}

export function editar(id, mudancas = {}) {
  const todos = load(LANC, []);
  const i = todos.findIndex((l) => l.id === String(id));
  if (i < 0) { return { ok: false, erros: [`lançamento "${id}" não encontrado`] }; }
  if (todos[i].excluidoEm) { return { ok: false, erros: ['lançamento excluído não pode ser editado; restaure antes'] }; }

  const r = normalizar({ ...todos[i], ...mudancas, id: todos[i].id, criadoEm: todos[i].criadoEm });
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }
  todos[i] = r.lancamento;
  save(LANC, todos);
  return { ok: true, lancamento: r.lancamento, avisos: r.avisos };
}

/** Exclusão lógica: caixa não perde histórico. */
export function excluir(id, opts = {}) {
  const todos = load(LANC, []);
  const i = todos.findIndex((l) => l.id === String(id));
  if (i < 0) { return { ok: false, erros: [`lançamento "${id}" não encontrado`] }; }
  if (todos[i].excluidoEm) { return { ok: true, id: String(id), repetido: true }; }
  todos[i] = { ...todos[i], excluidoEm: opts.quando || new Date().toISOString(), motivoExclusao: opts.motivo || null };
  save(LANC, todos);
  return { ok: true, id: String(id), lancamento: todos[i] };
}

export function restaurar(id) {
  const todos = load(LANC, []);
  const i = todos.findIndex((l) => l.id === String(id));
  if (i < 0) { return { ok: false, erros: [`lançamento "${id}" não encontrado`] }; }
  const { excluidoEm, motivoExclusao, ...limpo } = todos[i];
  todos[i] = limpo;
  save(LANC, todos);
  return { ok: true, id: String(id) };
}

/**
 * Lança um pagamento confirmado pelo gateway. Idempotente pela referência: o
 * mesmo pagamento reentregue não vira dinheiro dobrado no caixa.
 */
export function lancarPagamento(pagamento = {}) {
  if (!pagamento.id) { return { ok: false, erros: ['pagamento sem id'] }; }
  return criar({
    tipo: 'entrada',
    valorCentavos: pagamento.valorCentavos,
    categoria: 'venda',
    descricao: pagamento.referencia || pagamento.descricao || `Cobrança ${pagamento.id}`,
    data: (pagamento.atualizadoEm || pagamento.criadoEm || '').slice(0, 10) || hoje(),
    forma: pagamento.metodo === 'PIX' ? 'pix' : pagamento.metodo === 'CREDIT_CARD' ? 'cartao' : 'outra',
    origem: 'asaas',
    ref: pagamento.id,
  });
}

/** Painel do mês corrente + o período pedido. */
export function painel({ de, ate } = {}) {
  const todos = listar();
  const periodo = filtrar(todos, { de, ate });
  const mes = hoje().slice(0, 7);
  const doMes = todos.filter((l) => String(l.data).startsWith(mes));
  return {
    periodo: { de: de || null, ate: ate || null, ...resumir(periodo) },
    mes: { referencia: mes, ...resumir(doMes) },
    total: resumir(todos),
    lancamentos: periodo.sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 300),
    categorias: CATEGORIAS,
    formas: FORMAS,
  };
}
