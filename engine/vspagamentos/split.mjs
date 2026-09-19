/**
 * VSpagamentos — a conta do split.
 *
 * Aqui mora a armadilha mais cara dessa integração: **o split do Asaas incide sobre o
 * `netValue`**, que é o valor JÁ DESCONTADA a taxa do gateway — não sobre o bruto.
 * Combinar "o prestador fica com 80%" e mandar `percentualValue: 80` paga 80% de um
 * número menor do que o combinado, e a diferença só aparece quando o prestador
 * conferir. Por isso a base é explícita e obrigatória.
 *
 * Duas bases possíveis, e elas respondem a uma pergunta comercial de verdade:
 * **quem absorve a taxa do gateway?**
 *
 *   base 'liquido' — os dois dividem a taxa proporcionalmente.
 *                    O prestador recebe 80% do que sobrou.
 *   base 'bruto'   — a plataforma absorve a taxa inteira.
 *                    O prestador recebe 80% do preço cheio, taxa por nossa conta.
 *
 * Nenhuma das duas é "a certa": é decisão comercial. O módulo não escolhe.
 *
 * Dinheiro em CENTAVOS inteiros, como no resto da suíte.
 */

export const BASES = ['bruto', 'liquido'];

const inteiro = (v) => (Number.isInteger(Number(v)) ? Number(v) : null);

/**
 * Calcula quanto vai pra cada lado.
 *
 * @param {object} e
 * @param {number} e.brutoCentavos     preço que o cliente pagou
 * @param {number} [e.liquidoCentavos] o que o gateway devolve depois da taxa
 * @param {number} e.percentualPrestador  ex.: 80 (sem default — ver BDR-01)
 * @param {'bruto'|'liquido'} e.base
 * @returns {{ok:boolean, motivo?:string, split?:object, avisos:string[]}}
 */
export function calcularSplit(e = {}) {
  const avisos = [];
  const bruto = inteiro(e.brutoCentavos);
  if (bruto == null || bruto <= 0) {
    return { ok: false, motivo: `valor bruto inválido: "${e.brutoCentavos}" (centavos, inteiro > 0)`, avisos };
  }

  const pct = Number(e.percentualPrestador);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    // Sem default de propósito: 80/20 é hipótese comercial, não constante técnica.
    return { ok: false, motivo: `percentual do prestador inválido: "${e.percentualPrestador}" (esperado entre 0 e 100, exclusivo)`, avisos };
  }

  const base = String(e.base || '').toLowerCase();
  if (!BASES.includes(base)) {
    return { ok: false, motivo: `base do split não informada: use "bruto" (plataforma absorve a taxa) ou "liquido" (taxa dividida)`, avisos };
  }

  const liquido = inteiro(e.liquidoCentavos);
  if (liquido == null) {
    // Antes de o gateway responder não se sabe a taxa. Dá pra planejar, não pra fechar.
    avisos.push('valor líquido ainda desconhecido — o split final só fecha quando o gateway informar a taxa');
  } else if (liquido > bruto) {
    return { ok: false, motivo: 'valor líquido maior que o bruto — conferir o retorno do gateway', avisos };
  }

  const taxa = liquido == null ? null : bruto - liquido;
  const sobre = base === 'liquido' ? (liquido ?? bruto) : bruto;

  // Arredonda o prestador e dá o RESTO pra plataforma. O contrário criaria ou sumiria
  // centavo, e centavo sumido em marketplace vira reclamação.
  const prestador = Math.round(sobre * (pct / 100));
  const disponivel = liquido ?? bruto;

  if (prestador > disponivel) {
    return {
      ok: false,
      motivo: `o repasse (${(prestador / 100).toFixed(2)}) passa do líquido disponível (${(disponivel / 100).toFixed(2)}) — `
        + 'com base "bruto" a plataforma absorve a taxa, e aqui ela é maior que a comissão',
      avisos,
    };
  }

  const plataforma = disponivel - prestador;
  if (plataforma < 0) { return { ok: false, motivo: 'split resultaria em comissão negativa', avisos }; }
  if (taxa != null && plataforma < taxa && base === 'bruto') {
    avisos.push(`a taxa do gateway (${(taxa / 100).toFixed(2)}) consome a maior parte da comissão (${(plataforma / 100).toFixed(2)})`);
  }

  return {
    ok: true,
    avisos,
    split: {
      base,
      percentualPrestador: pct,
      brutoCentavos: bruto,
      liquidoCentavos: liquido,
      taxaGatewayCentavos: taxa,
      prestadorCentavos: prestador,
      plataformaCentavos: plataforma,
      // Guardar o que valeu NESTE pagamento: mudar a política em março não pode
      // reescrever o que foi combinado em janeiro.
      politicaVersao: e.politicaVersao || null,
      calculadoEm: e.quando || new Date().toISOString(),
    },
  };
}

/**
 * Converte o split calculado no formato que o Asaas espera no corpo da cobrança.
 *
 * Usa `fixedValue` quando a base é "bruto", porque percentual ali seria aplicado
 * sobre o líquido pelo Asaas e pagaria menos que o combinado. Com base "liquido",
 * percentual é exato e sobrevive a variação de taxa.
 *
 * @param {object} split saída de `calcularSplit`
 * @param {string} walletId carteira do prestador no Asaas
 */
export function paraAsaas(split, walletId) {
  if (!walletId) { return { ok: false, motivo: 'walletId do prestador é obrigatório (vem da criação da subconta)' }; }
  if (!split) { return { ok: false, motivo: 'split não calculado' }; }

  if (split.base === 'liquido') {
    return { ok: true, split: [{ walletId, percentualValue: split.percentualPrestador }] };
  }
  return { ok: true, split: [{ walletId, fixedValue: Number((split.prestadorCentavos / 100).toFixed(2)) }] };
}

/**
 * Confere o que o gateway realmente repassou contra o que a gente calculou.
 * Existe porque taxa e arredondamento do provedor podem divergir da nossa conta, e
 * descobrir isso no fechamento do mês é tarde.
 */
export function conferir(split, repassadoCentavos) {
  const esperado = split?.prestadorCentavos;
  const real = inteiro(repassadoCentavos);
  if (esperado == null || real == null) { return { ok: false, motivo: 'faltam valores para conferir' }; }
  const diff = real - esperado;
  return {
    ok: diff === 0,
    diferencaCentavos: diff,
    motivo: diff === 0 ? null
      : `repassado ${(real / 100).toFixed(2)}, esperado ${(esperado / 100).toFixed(2)} (diferença ${(diff / 100).toFixed(2)})`,
  };
}
