/**
 * VSpagamentos — a máquina de estados do pagamento, em vocabulário NOSSO.
 *
 * O domínio não fala "asaas". Se falasse, trocar de provedor obrigaria a reescrever
 * regra de negócio, e o pior: o vocabulário do provedor mudaria o significado das
 * nossas regras sem ninguém decidir isso.
 *
 * A distinção que sustenta o módulo inteiro:
 *
 *   CONFIRMADO  = o cliente pagou. O dinheiro AINDA NÃO está disponível.
 *   DISPONIVEL  = o dinheiro liquidou e pode ser movimentado.
 *
 * Repassar em cima de CONFIRMADO é o erro mais caro de marketplace: cartão aprovado
 * ainda vira chargeback, e o repasse já saiu. O Asaas separa isso nos próprios
 * eventos (PAYMENT_CONFIRMED x PAYMENT_RECEIVED), o que confirma que a distinção não
 * é preciosismo nosso.
 */

export const ESTADOS = [
  'CRIADO',        // cobrança gerada, ninguém pagou
  'PENDENTE',      // aguardando pagamento
  'CONFIRMADO',    // pago; saldo AINDA NÃO disponível
  'DISPONIVEL',    // liquidado; pode repassar
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
  'CHARGEBACK',
  'CHARGEBACK_DISPUTA',
  'VENCIDO',
  'CANCELADO',
];

/** Estados a partir dos quais o dinheiro pode, em tese, ser repassado. */
export const LIBERA_REPASSE = ['DISPONIVEL'];

/** Estados finais — não evoluem mais sozinhos. */
export const FINAIS = ['ESTORNADO', 'CANCELADO'];

/**
 * Transições permitidas. É lista fechada de propósito: o \`traduzirEvento\` recebe
 * texto de fora, e sem isso um evento inesperado moveria o pagamento pra qualquer
 * lugar.
 */
export const TRANSICOES = {
  // DISPONIVEL direto de CRIADO/PENDENTE nao e atalho: e o caminho NORMAL do Pix,
  // que confirma e liquida no mesmo instante — o PAYMENT_RECEIVED pode ser o
  // primeiro evento que chega sobre essa cobranca. Recusar isso deixava pagamento
  // recebido marcado como "aguardando" pra sempre, que e a pior mentira possivel
  // numa tela de recebimento. Conferido contra o sandbox do Asaas em 19/09/2026.
  CRIADO: ['PENDENTE', 'CONFIRMADO', 'DISPONIVEL', 'VENCIDO', 'CANCELADO'],
  PENDENTE: ['CONFIRMADO', 'DISPONIVEL', 'VENCIDO', 'CANCELADO'],
  CONFIRMADO: ['DISPONIVEL', 'ESTORNADO', 'ESTORNADO_PARCIAL', 'CHARGEBACK'],
  DISPONIVEL: ['ESTORNADO', 'ESTORNADO_PARCIAL', 'CHARGEBACK'],
  ESTORNADO_PARCIAL: ['ESTORNADO', 'CHARGEBACK', 'DISPONIVEL'],
  CHARGEBACK: ['CHARGEBACK_DISPUTA', 'ESTORNADO'],
  CHARGEBACK_DISPUTA: ['DISPONIVEL', 'ESTORNADO'],
  VENCIDO: ['CONFIRMADO', 'CANCELADO'],
  CANCELADO: [],
  ESTORNADO: [],
};

/** A transição é permitida? Devolve motivo em português quando não. */
export function podeIr(de, para) {
  if (!ESTADOS.includes(de)) { return { ok: false, motivo: `estado atual desconhecido: "${de}"` }; }
  if (!ESTADOS.includes(para)) { return { ok: false, motivo: `estado destino desconhecido: "${para}"` }; }
  if (de === para) { return { ok: true, repetido: true }; }
  if (!TRANSICOES[de].includes(para)) {
    return { ok: false, motivo: `não dá pra ir de ${de} para ${para} (permitidos: ${TRANSICOES[de].join(', ') || 'nenhum'})` };
  }
  return { ok: true };
}

/**
 * Aplica a transição. Função pura: devolve o pagamento novo ou o motivo.
 * Transição repetida NÃO é erro — webhook é at-least-once e reentrega acontece.
 */
export function transitar(pagamento, para, opts = {}) {
  const r = podeIr(pagamento?.estado, para);
  if (!r.ok) { return { pagamento: null, erro: r.motivo }; }
  const quando = opts.quando || new Date().toISOString();
  if (r.repetido) { return { pagamento, repetido: true, erro: null }; }
  return {
    pagamento: {
      ...pagamento,
      estado: para,
      atualizadoEm: quando,
      historico: [...(pagamento.historico || []), { de: pagamento.estado, para, quando, origem: opts.origem || null }],
    },
    erro: null,
  };
}

/**
 * Evento do Asaas -> estado nosso. Tudo que não estiver aqui é IGNORADO de
 * propósito: evento desconhecido não pode mover dinheiro.
 *
 * Referência: docs.asaas.com/docs/webhook-para-cobrancas
 */
export const EVENTO_ASAAS = {
  PAYMENT_CREATED: 'CRIADO',
  PAYMENT_AWAITING_RISK_ANALYSIS: 'PENDENTE',
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: 'PENDENTE',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'CANCELADO',
  PAYMENT_UPDATED: null,
  // "pago, mas o valor AINDA NAO esta disponivel na conta" — nao libera repasse.
  PAYMENT_CONFIRMED: 'CONFIRMADO',
  // "cobranca recebida, com valor DISPONIVEL na conta" — este sim libera.
  PAYMENT_RECEIVED: 'DISPONIVEL',
  PAYMENT_OVERDUE: 'VENCIDO',
  PAYMENT_DELETED: 'CANCELADO',
  PAYMENT_REFUNDED: 'ESTORNADO',
  PAYMENT_PARTIALLY_REFUNDED: 'ESTORNADO_PARCIAL',
  PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK',
  PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK_DISPUTA',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'CHARGEBACK_DISPUTA',
};

/**
 * Traduz o evento cru do provedor. É a fronteira: daqui pra dentro ninguém mais vê
 * nome de evento do Asaas.
 * @returns {{conhecido:boolean, estado:string|null, eventoId:string|null, cobrancaId:string|null}}
 */
export function traduzirEvento(corpo = {}) {
  const nome = String(corpo.event || '').toUpperCase();
  const conhecido = Object.prototype.hasOwnProperty.call(EVENTO_ASAAS, nome);
  return {
    conhecido,
    evento: nome || null,
    estado: conhecido ? EVENTO_ASAAS[nome] : null,
    // O id do evento é o que garante idempotência: o Asaas entrega at-least-once.
    eventoId: corpo.id || null,
    cobrancaId: corpo.payment?.id || null,
    valorCentavos: corpo.payment?.value == null ? null : Math.round(Number(corpo.payment.value) * 100),
    liquidoCentavos: corpo.payment?.netValue == null ? null : Math.round(Number(corpo.payment.netValue) * 100),
  };
}
