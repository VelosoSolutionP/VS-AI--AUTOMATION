/**
 * Quebra-Galho — a PORTA de pagamento (o contrato), não um provedor.
 *
 * O domínio fala este vocabulário e nada mais. Nenhum arquivo daqui importa Asaas,
 * Stripe ou qualquer outro: quem implementa mora em `marketplace/`, que é a infra
 * do produto. Isso é o que permite trocar de provedor sem tocar em regra de negócio
 * — e é o que mantém a regra 0 de pé (o teste de fronteira falha se alguém importar
 * de fora daqui).
 *
 * A distinção que sustenta tudo:
 *   CONFIRMADO = o cliente pagou. O dinheiro AINDA NÃO está disponível.
 *   DISPONIVEL = liquidou; só agora o repasse pode sair.
 * Repassar em cima de CONFIRMADO é o erro mais caro de marketplace: cartão aprovado
 * ainda vira chargeback, e o repasse já saiu.
 */

export const ESTADOS = ['CRIADO', 'PENDENTE', 'CONFIRMADO', 'DISPONIVEL', 'ESTORNADO', 'CHARGEBACK', 'CANCELADO'];
export const LIBERA_REPASSE = ['DISPONIVEL'];
export const METODOS = ['PIX', 'CARTAO'];

export const TRANSICOES = {
  CRIADO: ['PENDENTE', 'CONFIRMADO', 'CANCELADO'],
  PENDENTE: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['DISPONIVEL', 'ESTORNADO', 'CHARGEBACK'],
  DISPONIVEL: ['ESTORNADO', 'CHARGEBACK'],
  ESTORNADO: [], CHARGEBACK: ['ESTORNADO'], CANCELADO: [],
};

export function podeIr(de, para) {
  if (!ESTADOS.includes(de) || !ESTADOS.includes(para)) { return { ok: false, motivo: 'estado desconhecido' }; }
  if (de === para) { return { ok: true, repetido: true }; }
  if (!TRANSICOES[de].includes(para)) { return { ok: false, motivo: `não dá pra ir de ${de} para ${para}` }; }
  return { ok: true };
}

/**
 * Divide o valor. O percentual é CONFIGURÁVEL — 80/20 é hipótese comercial, não
 * constante técnica, e por isso não tem default aqui.
 *
 * Arredonda o prestador e dá o RESTO à plataforma: o contrário criaria ou sumiria
 * centavo, e centavo sumido em marketplace vira reclamação com razão.
 */
export function dividir(brutoCentavos, percentualPrestador, liquidoCentavos = null) {
  if (!Number.isInteger(brutoCentavos) || brutoCentavos <= 0) {
    return { ok: false, motivo: `valor inválido: "${brutoCentavos}" (centavos, inteiro > 0)` };
  }
  const p = Number(percentualPrestador);
  if (!Number.isFinite(p) || p <= 0 || p >= 100) {
    return { ok: false, motivo: `percentual do prestador inválido: "${percentualPrestador}"` };
  }
  // O que sobra depois da taxa do provedor é o que existe pra dividir de verdade.
  const disponivel = liquidoCentavos ?? brutoCentavos;
  const prestador = Math.round(disponivel * (p / 100));
  if (prestador > disponivel) { return { ok: false, motivo: 'a parte do prestador passa do disponível' }; }
  return {
    ok: true,
    split: {
      percentualPrestador: p,
      brutoCentavos,
      liquidoCentavos,
      taxaGatewayCentavos: liquidoCentavos == null ? null : brutoCentavos - liquidoCentavos,
      prestadorCentavos: prestador,
      plataformaCentavos: disponivel - prestador,
    },
  };
}

/**
 * Pode repassar? Nunca olha "pago": olha DISPONIVEL, sem disputa aberta e sem
 * repasse já feito.
 */
export function podeRepassar(pagamento, opts = {}) {
  if (!pagamento) { return { ok: false, motivo: 'pagamento não encontrado' }; }
  if (pagamento.repassado) { return { ok: false, motivo: 'este pagamento já foi repassado' }; }
  if (opts.disputaAberta) { return { ok: false, motivo: 'há contestação aberta nesta ordem' }; }
  if (!LIBERA_REPASSE.includes(pagamento.estado)) {
    return {
      ok: false,
      motivo: pagamento.estado === 'CONFIRMADO'
        ? 'pago, mas o valor ainda NÃO liquidou — repassar agora corre risco de chargeback'
        : `estado "${pagamento.estado}" não libera repasse`,
    };
  }
  return { ok: true, valorCentavos: pagamento.split?.prestadorCentavos ?? null };
}

/**
 * O contrato que todo provedor precisa cumprir. Quem não cumprir é recusado na
 * partida, e não no meio de uma cobrança de verdade.
 */
export const METODOS_GATEWAY = ['nome', 'criarCobranca', 'consultarCobranca', 'traduzirEvento'];

export function validarGateway(g) {
  if (!g) { return { ok: false, motivo: 'nenhum provedor de pagamento configurado' }; }
  const falta = METODOS_GATEWAY.filter((m) => g[m] === undefined);
  if (falta.length) { return { ok: false, motivo: `o provedor "${g.nome || '?'}" não implementa: ${falta.join(', ')}` }; }
  return { ok: true };
}
