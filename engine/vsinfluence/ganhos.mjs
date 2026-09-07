/**
 * VSinfluence — controle de ganhos. Registra o que entrou (plataforma, publi,
 * afiliado) e cruza com as views pra dar RPM real.
 *
 * Dinheiro é guardado em CENTAVOS (inteiro). Float em dinheiro acumula erro de
 * arredondamento e o criador acaba fechando o mês com centavo que não bate.
 */

export const FONTES = ['plataforma', 'publi', 'afiliado', 'doacao', 'assinatura', 'outro'];

/** "R$ 1.234,56" | "1234.56" | 1234.56 -> centavos. Inválido devolve null. */
export function paraCentavos(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) { return Math.round(valor * 100); }
  const s = String(valor ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!s) { return null; }
  // pt-BR: "1.234,56" -> ponto é milhar, vírgula é decimal
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Centavos -> "R$ 1.234,56". */
export function formatarBRL(centavos) {
  if (centavos == null) { return '—'; }
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Valida e normaliza um lançamento de ganho.
 * @param {{data:string, fonte:string, valor:*, rede?:string, videoId?:string, descricao?:string}} e
 */
export function normalizarGanho(e = {}) {
  const erros = [];
  const centavos = paraCentavos(e.valor);
  if (centavos == null) { erros.push(`valor inválido: "${e.valor}"`); }
  const fonte = String(e.fonte || '').toLowerCase();
  if (!FONTES.includes(fonte)) { erros.push(`fonte desconhecida: "${e.fonte}" (use ${FONTES.join(', ')})`); }
  const data = String(e.data || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { erros.push(`data inválida: "${e.data}" (use AAAA-MM-DD)`); }
  if (erros.length) { return { ganho: null, erros }; }
  return {
    ganho: {
      data, fonte, centavos,
      rede: e.rede ? String(e.rede).toLowerCase() : null,
      videoId: e.videoId || null,
      descricao: e.descricao || '',
    },
    erros: [],
  };
}

/** Total em centavos de uma lista de ganhos. */
export function total(ganhos = []) {
  return ganhos.reduce((a, g) => a + (g.centavos || 0), 0);
}

/** Agrupa por uma chave do ganho ('fonte', 'rede', 'data'...). */
export function agruparPor(ganhos = [], chave = 'fonte') {
  const out = {};
  for (const g of ganhos) {
    const k = g[chave] ?? 'sem';
    out[k] = (out[k] || 0) + (g.centavos || 0);
  }
  return out;
}

/** Ganhos de um mês "AAAA-MM". */
export function doMes(ganhos = [], mes) {
  return ganhos.filter((g) => String(g.data).startsWith(mes));
}

/**
 * RPM — receita por mil views. É a métrica que diz se o conteúdo paga o esforço.
 * Sem views não há RPM (null, não zero).
 * @returns {number|null} centavos por mil views
 */
export function rpm(centavos, views) {
  if (!views) { return null; }
  return Math.round((centavos / views) * 1000);
}

/**
 * Fechamento do mês: total, quebra por fonte e por rede, e RPM se houver views.
 * @param {object[]} ganhos
 * @param {string} mes "AAAA-MM"
 * @param {number|null} [views] views do período (de metricas.agregar)
 */
export function fechamento(ganhos, mes, views = null) {
  const doPeriodo = doMes(ganhos, mes);
  const centavos = total(doPeriodo);
  return {
    mes,
    lancamentos: doPeriodo.length,
    centavos,
    formatado: formatarBRL(centavos),
    porFonte: agruparPor(doPeriodo, 'fonte'),
    porRede: agruparPor(doPeriodo, 'rede'),
    views,
    rpm: rpm(centavos, views),
    rpmFormatado: formatarBRL(rpm(centavos, views)),
  };
}
