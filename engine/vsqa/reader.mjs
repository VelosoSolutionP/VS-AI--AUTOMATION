/**
 * VSqa — reader. Normaliza a US crua do tracker num objeto estável e extrai
 * os critérios de aceite (que viram os passos do cenário).
 * Determinístico, sem IA, ~0 token.
 */

const CRIT_HEADERS = /crit[eé]rios?\s+de\s+aceit(?:e|a[cç][aã]o)|acceptance\s+criteria|defini[cç][aã]o\s+de\s+pronto/i;

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ccedil: 'ç', atilde: 'ã', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', otilde: 'õ', ntilde: 'ñ' };

/** Descrição do Redmine costuma vir em HTML. Converte <li>/<p>/<br> em linhas de texto. */
export function htmlToText(input) {
  let s = String(input || '');
  if (!/<[a-z/][^>]*>/i.test(s)) { return s; } // já é texto puro
  s = s.replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|h[1-6]|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
const BULLET = /^\s*(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+(?:\[[ xX]\]\s+)?(.*\S)/;
const NEXT_HEADER = /^\s*#{1,6}\s+\S|^\s*\*\*[^*]+\*\*\s*:?\s*$/;

/** Extrai linhas de critério do texto. Prioriza a seção "Critérios de aceite". */
export function extractCriterios(text) {
  const linhas = htmlToText(text).split(/\r?\n/);
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
