/**
 * VSqa — reader. Normaliza a US crua do tracker num objeto estável e extrai
 * os critérios de aceite (que viram os passos do cenário).
 * Determinístico, sem IA, ~0 token.
 */

const CRIT_HEADERS = /crit[eé]rios?\s+de\s+aceit(?:e|a[cç][aã]o)|acceptance\s+criteria|defini[cç][aã]o\s+de\s+pronto/i;
const BULLET = /^\s*(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+(?:\[[ xX]\]\s+)?(.*\S)/;
const NEXT_HEADER = /^\s*#{1,6}\s+\S|^\s*\*\*[^*]+\*\*\s*:?\s*$/;

/** Extrai linhas de critério do texto. Prioriza a seção "Critérios de aceite". */
export function extractCriterios(text) {
  const linhas = String(text || '').split(/\r?\n/);
  const idx = linhas.findIndex((l) => CRIT_HEADERS.test(l));
  const scan = (arr) => arr
    .map((l) => { const m = l.match(BULLET); return m ? m[1].trim() : null; })
    .filter(Boolean);

  if (idx >= 0) {
    const bloco = [];
    for (let i = idx + 1; i < linhas.length; i++) {
      if (NEXT_HEADER.test(linhas[i]) && bloco.length) { break; }
      bloco.push(linhas[i]);
    }
    const crit = scan(bloco);
    if (crit.length) { return crit; }
  }
  // fallback: qualquer bullet/checkbox do corpo
  return scan(linhas);
}

/** Tenta inferir o módulo/tela a partir de [colchete] ou "Módulo:" no título/desc. */
export function extractModulo(titulo, descricao, fallback) {
  const braket = String(titulo || '').match(/\[([^\]]+)\]/);
  if (braket) { return braket[1].trim(); }
  const linha = String(descricao || '').match(/m[oó]dulo\s*:\s*(.+)/i);
  if (linha) { return linha[1].trim(); }
  return fallback || null;
}

/**
 * US normalizada -> objeto de trabalho do VSqa.
 * @param {{id,titulo,descricao,modulo,url}} issue  já vem semi-normalizado do adapter
 */
export function normalizeIssue(issue) {
  const titulo = (issue.titulo || '').replace(/\[[^\]]+\]/g, '').trim();
  return {
    id: issue.id,
    titulo,
    descricao: issue.descricao || '',
    criterios: extractCriterios(issue.descricao),
    modulo: extractModulo(issue.titulo, issue.descricao, issue.modulo),
    url: issue.url || null,
  };
}
