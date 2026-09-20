/**
 * VSfinanceiro — validação pura do lançamento. Sem disco, sem rede.
 *
 * Dinheiro em CENTAVOS, inteiro. Float em dinheiro erra: 0.1 + 0.2 não dá 0.3, e
 * o erro aparece no fechamento do mês, não no teste.
 */

export const TIPOS = ['entrada', 'saida'];

/** Categorias que existem de fábrica. A empresa acrescenta as dela. */
export const CATEGORIAS = {
  entrada: ['venda', 'servico', 'mensalidade', 'repasse', 'outra'],
  saida: ['fornecedor', 'imposto', 'salario', 'aluguel', 'marketing', 'taxa', 'outra'],
};

export const FORMAS = ['pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outra'];

const txt = (v) => String(v ?? '').trim();

/** "R$ 1.299,90", "1299,90", "1299.90", 1299.9 -> 129990. Nunca devolve 0 calado. */
export function paraCentavos(bruto) {
  if (bruto == null || bruto === '') { return null; }
  if (typeof bruto === 'number') {
    return Number.isFinite(bruto) ? Math.round(bruto * 100) : null;
  }
  const limpo = String(bruto).replace(/[^\d,.-]/g, '').trim();
  if (!limpo) { return null; }

  /* "1.299" é ambíguo: mil duzentos e noventa e nove no Brasil, um vírgula
     duzentos e noventa e nove nos EUA. Aqui é R$, então ponto seguido de
     EXATAMENTE três dígitos é separador de milhar. Com uma ou duas casas
     ("12.50") continua sendo decimal, que é como a maioria dos sistemas exporta.
     Sem essa regra, R$ 1.299 virava R$ 1,30 — e ninguém confere centavo a
     centavo um extrato que "está lá". */
  let norm;
  if (limpo.includes(',')) {
    norm = limpo.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpo)) {
    norm = limpo.replace(/\./g, '');
  } else {
    norm = limpo;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Data em YYYY-MM-DD. Data inválida devolve null — nunca vira "hoje" calado. */
export function paraData(bruto) {
  const s = txt(bruto).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { return null; }
  const d = new Date(`${s}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

export const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Normaliza e valida. Devolve {lancamento, erros, avisos}.
 * @param {object} e  {tipo, valor, categoria, descricao, data, forma, contato, ref}
 */
export function normalizar(e = {}, opts = {}) {
  const erros = [];
  const avisos = [];

  const tipo = txt(e.tipo).toLowerCase();
  if (!TIPOS.includes(tipo)) { erros.push(`tipo inválido: "${e.tipo}" (use ${TIPOS.join(' ou ')})`); }

  /* `valorCentavos` é o que a integração manda (já em centavos); `valor` é o que
     a pessoa digita. Quando vêm os dois, o DIGITADO ganha — é sempre o mais
     recente, e foi por confiar no outro que editar não mudava o valor. */
  const valorCentavos = e.valor != null && e.valor !== ''
    ? paraCentavos(e.valor)
    : (e.valorCentavos != null ? Number(e.valorCentavos) : null);
  if (valorCentavos == null || !Number.isInteger(valorCentavos)) {
    erros.push(`valor inválido: "${e.valor ?? e.valorCentavos}"`);
  } else if (valorCentavos <= 0) {
    // Saída é lançada com valor POSITIVO e tipo "saida". Valor negativo com tipo
    // saida daria entrada no relatório — dois sinais brigando.
    erros.push('o valor tem que ser maior que zero; para saída, use tipo "saida"');
  }

  const descricao = txt(e.descricao);
  if (!descricao) { erros.push('descrição é obrigatória — extrato sem descrição não se audita'); }

  const data = paraData(e.data) || (e.data ? null : (opts.hoje || hoje()));
  if (e.data && !data) { erros.push(`data inválida: "${e.data}" (use AAAA-MM-DD)`); }

  const categoria = txt(e.categoria).toLowerCase() || 'outra';
  if (tipo && CATEGORIAS[tipo] && !CATEGORIAS[tipo].includes(categoria)) {
    avisos.push(`categoria "${categoria}" não é uma das padrão de ${tipo} — vai entrar assim mesmo`);
  }

  const forma = txt(e.forma).toLowerCase();
  if (forma && !FORMAS.includes(forma)) { avisos.push(`forma "${forma}" fora da lista padrão`); }

  if (erros.length) { return { erros, avisos }; }

  return {
    erros: [],
    avisos,
    lancamento: {
      id: txt(e.id) || `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      tipo,
      valorCentavos,
      categoria,
      descricao,
      data,
      forma: forma || null,
      contato: txt(e.contato) || null,
      // De onde veio: 'manual', 'asaas', 'crm'... Serve pra não lançar duas vezes
      // o mesmo dinheiro quando a integração também registra.
      origem: txt(e.origem) || 'manual',
      ref: txt(e.ref) || null,
      criadoEm: e.criadoEm || new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    },
  };
}

/** Soma por tipo, em centavos. Lista vazia devolve 0 — aqui zero é a verdade. */
export function resumir(lancamentos = []) {
  const entradas = lancamentos.filter((l) => l.tipo === 'entrada');
  const saidas = lancamentos.filter((l) => l.tipo === 'saida');
  const soma = (xs) => xs.reduce((a, l) => a + (l.valorCentavos || 0), 0);
  const entrou = soma(entradas);
  const saiu = soma(saidas);
  return {
    entradas: entradas.length,
    saidas: saidas.length,
    entrouCentavos: entrou,
    saiuCentavos: saiu,
    saldoCentavos: entrou - saiu,
    porCategoria: agrupar(lancamentos),
  };
}

function agrupar(lancamentos = []) {
  const m = new Map();
  for (const l of lancamentos) {
    const k = `${l.tipo}:${l.categoria}`;
    m.set(k, (m.get(k) || 0) + (l.valorCentavos || 0));
  }
  return [...m.entries()]
    .map(([k, centavos]) => ({ tipo: k.split(':')[0], categoria: k.split(':')[1], centavos }))
    .sort((a, b) => b.centavos - a.centavos);
}

/** Filtra por período (inclusivo nas duas pontas) e por tipo. */
export function filtrar(lancamentos = [], { de, ate, tipo, categoria } = {}) {
  const d = paraData(de), a = paraData(ate);
  return lancamentos.filter((l) => {
    if (d && l.data < d) { return false; }
    if (a && l.data > a) { return false; }
    if (tipo && l.tipo !== tipo) { return false; }
    if (categoria && l.categoria !== categoria) { return false; }
    return true;
  });
}
