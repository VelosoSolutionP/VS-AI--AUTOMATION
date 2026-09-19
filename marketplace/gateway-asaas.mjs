/**
 * Provedor ASAAS — implementação real do contrato de pagamento.
 *
 * Fica em `marketplace/` (infra do produto) e NÃO em `engine/vsmarket/`, porque o
 * domínio não pode conhecer fornecedor. Também não importa o módulo de pagamento do
 * Bolso Cheio: são produtos independentes (regra 0), e acoplar os dois faria o
 * Quebra-Galho parar quando aquele mudasse.
 *
 * Dois fatos da documentação do Asaas que mudam o desenho:
 *
 *  1) O webhook NÃO é assinado. A validação é um token estático no header
 *     `asaas-access-token`. Quem descobrir o token forja evento de pagamento — daí
 *     comparação em tempo constante e recusa quando o token não está configurado.
 *  2) `PAYMENT_CONFIRMED` é "pago, saldo ainda não disponível"; `PAYMENT_RECEIVED`
 *     é "valor disponível na conta". São estados diferentes, e só o segundo libera
 *     repasse.
 */
import { timingSafeEqual } from 'node:crypto';

const BASE = { producao: 'https://api.asaas.com/v3', sandbox: 'https://api-sandbox.asaas.com/v3' };

/** Evento do Asaas -> nosso vocabulário. O que não estiver aqui é ignorado. */
export const EVENTOS = {
  PAYMENT_CREATED: 'CRIADO',
  PAYMENT_AWAITING_RISK_ANALYSIS: 'PENDENTE',
  PAYMENT_CONFIRMED: 'CONFIRMADO',
  PAYMENT_RECEIVED: 'DISPONIVEL',
  PAYMENT_REFUNDED: 'ESTORNADO',
  PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK',
  PAYMENT_DELETED: 'CANCELADO',
};

export function tokenConfere(recebido, esperado) {
  const a = Buffer.from(String(recebido || ''), 'utf8');
  const b = Buffer.from(String(esperado || ''), 'utf8');
  if (!b.length || a.length !== b.length) { return false; }
  return timingSafeEqual(a, b);
}

export function criarAsaas(cfg = {}) {
  const base = BASE[cfg.ambiente || 'sandbox'];
  const fetchImpl = cfg.fetchImpl || globalThis.fetch;

  async function chamar(metodo, caminho, corpo) {
    if (!cfg.apiKey) { return { ok: false, motivo: 'falta a chave de API do Asaas' }; }
    try {
      const res = await fetchImpl(base + caminho, {
        method: metodo,
        headers: { accept: 'application/json', access_token: cfg.apiKey, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const dados = await res.json().catch(() => null);
      if (res.status >= 400) {
        const desc = dados?.errors?.[0]?.description;
        return { ok: false, motivo: desc ? `o Asaas recusou: ${desc}` : `resposta inesperada do Asaas (HTTP ${res.status})` };
      }
      return { ok: true, dados };
    } catch (e) {
      return { ok: false, motivo: 'falha de rede ao falar com o Asaas: ' + (e?.message || 'desconhecida') };
    }
  }

  return {
    nome: 'asaas',
    ambiente: cfg.ambiente || 'sandbox',

    async criarCobranca(e = {}) {
      const r = await chamar('POST', '/payments', {
        customer: e.clienteExternoId,
        billingType: e.metodo === 'PIX' ? 'PIX' : 'CREDIT_CARD',
        // Centavos viram decimal aqui na borda, e só aqui.
        value: Number((e.valorCentavos / 100).toFixed(2)),
        dueDate: e.vencimento,
        description: e.descricao,
        externalReference: e.referencia,
        // O split do Asaas incide sobre o netValue (já sem a taxa). Por isso mandamos
        // VALOR FIXO: percentual pagaria menos que o combinado com o prestador.
        ...(e.walletIdPrestador && e.prestadorCentavos
          ? { split: [{ walletId: e.walletIdPrestador, fixedValue: Number((e.prestadorCentavos / 100).toFixed(2)) }] }
          : {}),
      });
      if (!r.ok) { return r; }
      return {
        ok: true,
        cobranca: {
          id: r.dados?.id,
          estado: EVENTOS[`PAYMENT_${String(r.dados?.status || '').toUpperCase()}`] || 'PENDENTE',
          metodo: e.metodo,
          valorCentavos: e.valorCentavos,
          liquidoCentavos: r.dados?.netValue == null ? null : Math.round(Number(r.dados.netValue) * 100),
          link: r.dados?.invoiceUrl || null,
        },
      };
    },

    async consultarCobranca(id) {
      const r = await chamar('GET', `/payments/${encodeURIComponent(id)}`);
      if (!r.ok) { return r; }
      return { ok: true, cobranca: { id, estado: EVENTOS[`PAYMENT_${String(r.dados?.status || '').toUpperCase()}`] || null } };
    },

    /** Valida o webhook ANTES de qualquer processamento. */
    validarWebhook(headers = {}) {
      if (!cfg.webhookToken) {
        return { ok: false, motivo: 'ASAAS_WEBHOOK_TOKEN não configurado — o endpoint aceitaria evento forjado' };
      }
      const t = headers['asaas-access-token'];
      if (!t) { return { ok: false, motivo: 'header asaas-access-token ausente' }; }
      if (!tokenConfere(t, cfg.webhookToken)) { return { ok: false, motivo: 'token do webhook não confere' }; }
      return { ok: true };
    },

    traduzirEvento(corpo = {}) {
      const nome = String(corpo.event || '').toUpperCase();
      const conhecido = Object.prototype.hasOwnProperty.call(EVENTOS, nome);
      return {
        conhecido,
        evento: nome || null,
        estado: conhecido ? EVENTOS[nome] : null,
        // O id do evento é a trava de idempotência: a entrega é at-least-once.
        eventoId: corpo.id || null,
        cobrancaId: corpo.payment?.id || null,
        liquidoCentavos: corpo.payment?.netValue == null ? null : Math.round(Number(corpo.payment.netValue) * 100),
      };
    },
  };
}
