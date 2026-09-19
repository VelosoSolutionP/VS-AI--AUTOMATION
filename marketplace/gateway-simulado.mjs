/**
 * Provedor SIMULADO — para demonstração e teste.
 *
 * Cumpre o mesmo contrato do provedor real (engine/vsmarket/pagamento.mjs). Trocar
 * por Asaas é injetar outra implementação, sem tocar em regra de negócio.
 *
 * Ele NÃO finge que liquidou: a cobrança nasce CONFIRMADO e só vira DISPONIVEL
 * quando alguém chama `liquidar()`. Pular isso esconderia justamente o risco que a
 * separação entre confirmado e disponível existe para expor.
 */
import { randomBytes } from 'node:crypto';

export function criarSimulado() {
  return {
    nome: 'simulado',
    simulado: true,

    async criarCobranca(e = {}) {
      return {
        ok: true,
        cobranca: {
          id: 'sim_' + randomBytes(6).toString('hex'),
          estado: 'CONFIRMADO',
          metodo: e.metodo,
          valorCentavos: e.valorCentavos,
          // Sem taxa de provedor na simulação: o líquido é igual ao bruto.
          liquidoCentavos: e.valorCentavos,
          link: null,
        },
      };
    },

    async consultarCobranca(id) {
      return { ok: true, cobranca: { id, estado: 'CONFIRMADO' } };
    },

    /** Não há webhook aqui — a liquidação é disparada à mão na demonstração. */
    traduzirEvento(corpo = {}) {
      return { conhecido: true, estado: corpo.estado || null, eventoId: corpo.id || null, cobrancaId: corpo.cobranca || null };
    },
  };
}
