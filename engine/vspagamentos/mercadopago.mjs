/**
 * Gateway do Mercado Pago — mesmo contrato do Asaas, outro provedor.
 *
 * O que ele cobre: Pix com QR na hora, cartão por link de checkout, consulta,
 * estorno e webhook assinado. O `fetchImpl` é injetável, como no resto do repo:
 * é o que permite testar sem tocar a rede e sem mover dinheiro.
 *
 * TRÊS DIFERENÇAS REAIS PRO ASAAS, E ELAS IMPORTAM:
 *
 *  1. Não existe "criar cliente antes de cobrar". No Asaas a cobrança exige um
 *     `customer`; aqui o pagador vai dentro da própria cobrança. Quem chamar não
 *     precisa mais fazer a dança de buscar-ou-criar cliente.
 *  2. O QR do Pix vem DENTRO da resposta da cobrança, não numa chamada à parte.
 *     `qrPix()` existe pra cumprir o contrato, mas consulta o pagamento.
 *  3. Split é `application_fee` numa cobrança de marketplace, não subconta com
 *     saldo próprio. Então `criarSubconta`, `saldo` e `transferir` NÃO são
 *     suportados — e dizem isso em voz alta em vez de fingir que funcionaram.
 *
 * A assinatura do webhook é HMAC-SHA256 sobre um manifesto montado com id,
 * request-id e timestamp — NÃO é o corpo cru, como quase todo mundo faz. Errar
 * isso significa aceitar evento forjado achando que validou.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = 'https://api.mercadopago.com';
const centavosParaReais = (c) => Math.round(Number(c || 0)) / 100;
const reaisParaCentavos = (r) => Math.round(Number(r || 0) * 100);

/** Formas que este gateway aceita, no vocabulário do módulo. */
export const COBRANCAS = ['PIX', 'CREDIT_CARD', 'BOLETO'];

const METODO_MP = { PIX: 'pix', BOLETO: 'bolbradesco', CREDIT_CARD: null }; // cartão vai por checkout

/**
 * Estados do Mercado Pago → o vocabulário que o módulo já usa.
 * `in_process` é revisão manual: não é pago nem recusado, e tratar como pago
 * libera mercadoria antes do dinheiro entrar.
 */
export const ESTADO_MP = Object.freeze({
  pending: 'PENDENTE',
  in_process: 'PENDENTE',
  authorized: 'PENDENTE',
  approved: 'CONFIRMADO',
  refunded: 'ESTORNADO',
  cancelled: 'CANCELADO',
  rejected: 'CANCELADO',
  charged_back: 'CHARGEBACK',
});

function explicarErro(status, dados) {
  if (status === 401) { return 'Access Token do Mercado Pago inválido ou vencido'; }
  if (status === 403) { return 'o Access Token não tem permissão para esta operação'; }
  if (status === 404) { return 'não encontrado no Mercado Pago'; }
  const msg = dados?.message || dados?.error;
  const causa = (dados?.cause || [])[0]?.description;
  return causa || msg || `Mercado Pago respondeu ${status}`;
}

/**
 * Confere a assinatura do webhook.
 *
 * O manifesto é `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` e o header
 * `x-signature` vem como `ts=...,v1=...`. Sem segredo configurado, devolve
 * `conferida:false` — pra quem chama gritar no log em vez de fingir que validou.
 */
export function validarWebhook(headers = {}, query = {}, segredo) {
  if (!segredo) {
    return { ok: true, conferida: false, motivo: 'MP_WEBHOOK_SECRET ausente — assinatura não conferida' };
  }
  const assinatura = String(headers['x-signature'] || '');
  const requestId = String(headers['x-request-id'] || '');
  if (!assinatura) { return { ok: false, conferida: true, motivo: 'header x-signature ausente' }; }

  const partes = Object.fromEntries(assinatura.split(',').map((p) => p.split('=').map((x) => x.trim())));
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) { return { ok: false, conferida: true, motivo: 'x-signature fora do formato ts=...,v1=...' }; }

  const id = String(query['data.id'] ?? query.id ?? '');
  const manifesto = `id:${id};request-id:${requestId};ts:${ts};`;
  const esperada = createHmac('sha256', segredo).update(manifesto).digest('hex');
  const a = Buffer.from(v1);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, conferida: true, motivo: 'assinatura do webhook não confere' };
  }
  return { ok: true, conferida: true };
}

export function criarGateway(cfg = {}) {
  const fetchImpl = cfg.fetchImpl || globalThis.fetch;
  const timeoutMs = cfg.timeoutMs ?? 15000;

  async function chamar(metodo, caminho, corpo, extra = {}) {
    if (!cfg.apiKey) { return { ok: false, motivo: 'falta o Access Token do Mercado Pago' }; }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(BASE + caminho, {
        method: metodo,
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json',
          /* Sem chave de idempotência, uma reentrega de rede vira DUAS cobranças
             para o mesmo cliente — e quem descobre é ele, na fatura. */
          ...(extra.idempotencia ? { 'X-Idempotency-Key': extra.idempotencia } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: ctrl.signal,
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) { return { ok: false, status: res.status, motivo: explicarErro(res.status, dados), corpo: dados }; }
      return { ok: true, status: res.status, dados };
    } catch (e) {
      const abortou = e?.name === 'AbortError';
      return { ok: false, motivo: abortou ? `sem resposta em ${timeoutMs / 1000}s` : 'falha de rede: ' + (e?.message || e) };
    } finally { clearTimeout(t); }
  }

  /** Resposta do MP → o formato que o módulo de pagamentos já entende. */
  const traduzir = (d = {}) => ({
    id: String(d.id ?? ''),
    estado: ESTADO_MP[d.status] || 'PENDENTE',
    estadoOriginal: d.status,
    valorCentavos: reaisParaCentavos(d.transaction_amount),
    liquidoCentavos: d.transaction_details?.net_received_amount != null
      ? reaisParaCentavos(d.transaction_details.net_received_amount) : null,
    metodo: d.payment_method_id === 'pix' ? 'PIX' : (d.payment_type_id === 'credit_card' ? 'CREDIT_CARD' : (d.payment_method_id || null)),
    referencia: d.external_reference || null,
    criadoEm: d.date_created || null,
    pagoEm: d.date_approved || null,
    linkPagamento: d.point_of_interaction?.transaction_data?.ticket_url || null,
    pix: d.point_of_interaction?.transaction_data
      ? { payload: d.point_of_interaction.transaction_data.qr_code || null,
          imagemBase64: d.point_of_interaction.transaction_data.qr_code_base64 || null }
      : null,
  });

  const naoSuportado = (o) => ({
    ok: false,
    motivo: `o Mercado Pago não faz "${o}" como o Asaas: lá é subconta com saldo, aqui é taxa de marketplace na própria cobrança. `
      + 'Use o modelo "direto" ou o split por application_fee.',
  });

  /** 401/403 no pagamento direto = conta sem Pix direto liberado, nao chave ruim. */
  const podeCairNoCheckout = (r) => [401, 403].includes(r.status)
    && /live credentials|not.*authorized|permission/i.test(String(r.motivo || '') + JSON.stringify(r.corpo || {}));

  /**
   * Checkout Pro: uma pagina do Mercado Pago onde o cliente escolhe a forma.
   * Serve pra cartao sempre, e pra Pix quando a conta nao faz Pix direto.
   */
  async function checkout(e, metodo) {
    const pref = await chamar('POST', '/checkout/preferences', {
      items: [{ title: e.descricao || 'Pagamento', quantity: 1, unit_price: centavosParaReais(e.valorCentavos), currency_id: 'BRL' }],
      external_reference: e.referencia,
      payer: e.email ? { email: e.email, name: e.nome } : undefined,
      notification_url: e.webhookUrl || undefined,
      // Pix pedido explicitamente: o checkout abre só com ele em vez do menu inteiro.
      payment_methods: metodo === 'PIX'
        ? { excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }] }
        : undefined,
    }, { idempotencia: e.referencia });
    if (!pref.ok) { return pref; }
    return {
      ok: true,
      viaCheckout: true,
      pagamento: {
        id: String(pref.dados.id), estado: 'CRIADO', estadoOriginal: 'preference',
        valorCentavos: e.valorCentavos, metodo, referencia: e.referencia || null,
        linkPagamento: pref.dados.init_point || pref.dados.sandbox_init_point || null,
        pix: null,
        /* A tela precisa saber que o QR nasce no MP, nao aqui — senao ela mostra
           "aguardando QR" pra sempre. */
        aviso: metodo === 'PIX' ? 'esta conta não gera o QR do Pix direto: o cliente abre o link e o Mercado Pago mostra o QR' : null,
      },
    };
  }

  return {
    nome: 'mercadopago',
    ambiente: cfg.ambiente || 'producao', // o MP não tem sandbox por chave: é outra credencial

    async criarCobranca(e = {}) {
      const metodo = String(e.metodo || 'PIX').toUpperCase();
      if (!COBRANCAS.includes(metodo)) {
        return { ok: false, motivo: `forma de pagamento inválida: "${e.metodo}" (use ${COBRANCAS.join(', ')})` };
      }
      if (!e.valorCentavos || e.valorCentavos <= 0) { return { ok: false, motivo: 'valor da cobrança é obrigatório' }; }

      /* Cartão não nasce como pagamento: nasce como preferência de checkout, e o
         cliente escolhe a forma lá. Forçar cartão aqui exigiria o token do cartão
         do navegador — que este backend não tem e nem deve ter. */
      if (metodo === 'CREDIT_CARD') { return checkout(e, metodo); }

      /* Pix DIRETO (QR na hora) exige a conta habilitada pra isso. Conta de
         teste e boa parte das contas novas recebem 401 "Unauthorized use of
         live credentials" — e ai a saida certa nao e falhar: e usar o Checkout,
         que a mesma credencial cria sem reclamar. O cliente escolhe Pix la e
         paga igual; o que muda e que o QR nasce na tela do MP, nao na nossa. */
      const r = await chamar('POST', '/v1/payments', {
        transaction_amount: centavosParaReais(e.valorCentavos),
        description: e.descricao || 'Pagamento',
        payment_method_id: METODO_MP[metodo],
        external_reference: e.referencia,
        notification_url: e.webhookUrl || undefined,
        date_of_expiration: e.expiraEm || undefined,
        payer: {
          email: e.email || 'sem-email@exemplo.com',
          first_name: e.nome || undefined,
          identification: e.cpfCnpj
            ? { type: String(e.cpfCnpj).replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF', number: String(e.cpfCnpj).replace(/\D/g, '') }
            : undefined,
        },
      }, { idempotencia: e.referencia });
      if (!r.ok) {
        if (podeCairNoCheckout(r)) { return checkout(e, metodo); }
        return r;
      }
      return { ok: true, pagamento: traduzir(r.dados) };
    },

    async consultarCobranca(id) {
      const r = await chamar('GET', `/v1/payments/${encodeURIComponent(id)}`);
      return r.ok ? { ok: true, pagamento: traduzir(r.dados) } : r;
    },

    /* O QR já vem na criação; aqui é releitura, pra cumprir o contrato. */
    async qrPix(id) {
      const r = await chamar('GET', `/v1/payments/${encodeURIComponent(id)}`);
      if (!r.ok) { return r; }
      const p = traduzir(r.dados);
      if (!p.pix?.payload) { return { ok: false, motivo: 'esta cobrança não tem Pix (só cobrança Pix gera QR)' }; }
      return { ok: true, pix: p.pix };
    },

    async estornar(id, e = {}) {
      const corpo = e.valorCentavos ? { amount: centavosParaReais(e.valorCentavos) } : undefined;
      const r = await chamar('POST', `/v1/payments/${encodeURIComponent(id)}/refunds`, corpo, { idempotencia: `estorno-${id}` });
      return r.ok ? { ok: true, estorno: r.dados } : r;
    },

    /* No MP o pagador vai dentro da cobrança. Mantido pra não quebrar quem
       chama, e dizendo a verdade em vez de inventar um id. */
    async criarCliente(e = {}) {
      return { ok: true, cliente: { id: null, email: e.email || null, embutido: true },
        aviso: 'o Mercado Pago não exige cliente cadastrado: o pagador vai na própria cobrança' };
    },
    async buscarClientePorDocumento() {
      return { ok: true, cliente: null, aviso: 'o Mercado Pago não busca cliente por documento nesta integração' };
    },

    async criarSubconta() { return naoSuportado('subconta'); },
    async consultarSubconta() { return naoSuportado('subconta'); },
    async saldo() { return naoSuportado('saldo de subconta'); },
    async transferir() { return naoSuportado('transferência entre contas'); },

    validarWebhook: (headers, query) => validarWebhook(headers, query, cfg.webhookSecret),
  };
}
