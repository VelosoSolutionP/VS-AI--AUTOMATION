/**
 * VSvendas — qualificação de lead. Score determinístico e TRANSPARENTE a partir dos
 * sinais que a própria empresa definiu na entrevista (+ heurística genérica de reforço).
 * O MCP pode refinar a redação/nuance depois; aqui já sai um baseline defensável.
 */

// NFD + strip de diacritico: o sinal cadastrado ("reclamou de bug em producao") e o
// texto do lead ("subiu bug pra produção") quase nunca acentuam igual. Comparando com
// acento, sinal legitimo da empresa nao casava e o lead quente era rebaixado a morno.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const QUENTE_GEN = ['preço', 'preco', 'orçamento', 'orcamento', 'proposta', 'contratar', 'fechar', 'urgente', 'urgência', 'quando pod', 'quanto custa', 'assinar', 'comprar', 'demo'];
const FRIO_GEN = ['só olhando', 'so olhando', 'sem verba', 'sem orçamento', 'caro', 'depois', 'talvez', 'curiosidade', 'pesquisando', 'futuro'];
const STOP = new Set(['de', 'da', 'do', 'em', 'com', 'que', 'uma', 'uns', 'por', 'pra', 'para', 'tem', 'ter', 'seu', 'sua', 'os', 'as', 'no', 'na', 'um', 'ao']);

/** Match por SUBSTRING (termos genéricos de 1 palavra). */
function hits(texto, termos) {
  const t = norm(texto);
  // dedup: com a normalizacao de acento, 'preço' e 'preco' viram o MESMO termo e o
  // motivo saia duplicado na tela ("intenção de compra: preço, preco").
  const vistos = new Set();
  return (termos || []).filter((k) => {
    if (!k || !t.includes(norm(k))) { return false; }
    const chave = norm(k);
    if (vistos.has(chave)) { return false; }
    vistos.add(chave);
    return true;
  });
}

/** Match por SOBREPOSIÇÃO de palavras-chave (frases que a empresa definiu — o lead
 *  raramente repete a frase inteira). Casa se ≥metade das palavras significativas aparece. */
function phraseHits(texto, frases) {
  const t = norm(texto);
  return (frases || []).filter((frase) => {
    const sig = norm(frase).split(/[^\wçãõáéíóúâêô]+/i).filter((w) => w.length >= 4 && !STOP.has(w));
    if (!sig.length) { return norm(frase) && t.includes(norm(frase)); }
    const achou = sig.filter((w) => t.includes(w)).length;
    return achou >= Math.ceil(sig.length / 2);
  });
}

/**
 * @param {string} leadTexto  mensagem/descrição do lead
 * @param {object} profile    saída de mapProfile
 * @returns {{score:number, faixa:string, motivos:string[], proximoPasso:string, etapaSugerida:string}}
 */
export function qualifyLead(leadTexto, profile) {
  const motivos = [];
  let score = 40; // neutro

  const quenteProprio = phraseHits(leadTexto, profile.sinaisQuente);
  const frioProprio = phraseHits(leadTexto, profile.sinaisFrio);
  const quenteGen = hits(leadTexto, QUENTE_GEN);
  const frioGen = hits(leadTexto, FRIO_GEN);
  const icpMatch = hits(leadTexto, (profile.empresa?.icp || '').split(/[\s,;]+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())));

  score += quenteProprio.length * 18;
  score += quenteGen.length * 8;
  score += Math.min(icpMatch.length, 3) * 5;
  score -= frioProprio.length * 18;
  score -= frioGen.length * 10;
  score = Math.max(0, Math.min(100, score));

  if (quenteProprio.length) { motivos.push(`sinais de compra da sua empresa: ${quenteProprio.join(', ')}`); }
  if (quenteGen.length) { motivos.push(`intenção de compra: ${quenteGen.join(', ')}`); }
  if (icpMatch.length) { motivos.push(`bate com o ICP: ${icpMatch.slice(0, 3).join(', ')}`); }
  if (frioProprio.length) { motivos.push(`sinais frios: ${frioProprio.join(', ')}`); }
  if (frioGen.length) { motivos.push(`hesitação: ${frioGen.join(', ')}`); }
  if (!motivos.length) { motivos.push('sem sinais claros — precisa qualificar melhor'); }

  const faixa = score >= 66 ? 'quente' : score >= 33 ? 'morno' : 'frio';
  const etapaSugerida = (profile.funil && profile.funil[faixa === 'quente' ? Math.min(1, profile.funil.length - 1) : 0]) || 'Novo lead';
  const proximoPasso = faixa === 'quente'
    ? 'agir agora: ligar/responder e encaminhar pra proposta'
    : faixa === 'morno'
      ? 'qualificar: fazer 2-3 perguntas de descoberta antes de avançar'
      : 'nutrir: registrar e retomar depois, sem gastar energia de venda agora';

  return { score, faixa, motivos, proximoPasso, etapaSugerida };
}
