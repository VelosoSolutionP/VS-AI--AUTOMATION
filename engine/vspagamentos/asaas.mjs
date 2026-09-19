/**
 * VSpagamentos — implementação do gateway para o Asaas.
 *
 * O domínio nunca importa este arquivo direto: ele recebe um objeto que cumpre o
 * contrato. Trocar de provedor é escrever outro arquivo como este.
 *
 * Duas coisas que a documentação do Asaas deixa explícitas e que mudam o desenho:
 *
 *  1) O webhook NÃO é assinado. A validação é um TOKEN ESTÁTICO no header
 *     `asaas-access-token` (32–255 caracteres). Diferente do Stripe, não há HMAC
 *     sobre o corpo — quem descobrir o token forja evento. Por isso: comparação em
 *     tempo constante, token tratado como segredo e NUNCA em log.
 *  2) A entrega é at-least-once, com fila que pausa após 15 falhas consecutivas.
 *     Logo: responder 200 rápido, processar depois, e deduplicar pelo `id` do evento.
 *
 * `fetchImpl` é injetável — o teste roda sem tocar na rede, como no resto da suíte.
 */
import { timingSafeEqual } from 'node:crypto';

export const BASE = {
  producao: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
};

export const COBRANCAS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'UNDEFINED'];

const centavosParaReais = (c) => Number((Number(c) / 100).toFixed(2));

/**
 * Compara o token do webhook sem vazar tempo. `timingSafeEqual` exige buffers do
 * mesmo tamanho, então o tamanho é conferido antes — e um tamanho diferente já é
 * resposta negativa.
 */
export function tokenConfere(recebido, esperado) {
  const a = Buffer.from(String(recebido || ''), 'utf8');
  const b = Buffer.from(String(esperado || ''), 'utf8');
  if (!b.length || a.length !== b.length) { return false; }
  return timingSafeEqual(a, b);
}

/**
 * Valida o webhook ANTES de qualquer processamento.
 * @returns {{ok:boolean, motivo?:string}}
 */
export function validarWebhook(headers = {}, tokenEsperado) {
  if (!tokenEsperado) {
    // Sem token configurado o endpoint aceita qualquer POST da internet. Isso é
    // falha de configuração, não "modo permissivo".
    return { ok: false, motivo: 'ASAAS_WEBHOOK_TOKEN não configurado — o endpoint aceitaria evento forjado' };
  }
  const recebido = headers['asaas-access-token'] || headers['Asaas-Access-Token'];
  if (!recebido) { return { ok: false, motivo: 'header asaas-access-token ausente' }; }
  if (!tokenConfere(recebido, tokenEsperado)) { return { ok: false, motivo: 'token do webhook não confere' }; }
  return { ok: true };
}

/** Traduz a falha da API numa frase que diz o que fazer. */
export function explicarErro(status, corpo) {
  const erros = corpo?.errors || [];
  const primeiro = erros[0] || {};
  const desc = primeiro.description || '';
  if (status === 401) { return 'chave de API do Asaas inválida ou ausente'; }
  if (status === 403) { return 'a chave não tem permissão para esta operação'; }
  if (status === 404) { return 'recurso não encontrado no Asaas'; }
  if (status === 429) { return 'limite de chamadas do Asaas atingido — tente mais tarde'; }
  if (status >= 500) { return 'o Asaas está com problema no lado deles'; }
  if (desc) { return `o Asaas recusou: ${desc}`; }
  return `resposta inesperada do Asaas (HTTP ${status})`;
}

/**
 * Cria o cliente do gateway.
 * @param {{apiKey:string, ambiente?:'producao'|'sandbox', fetchImpl?:Function, timeoutMs?:number}} cfg
 */
export function criarGateway(cfg = {}) {
  const base = BASE[cfg.ambiente || 'sandbox'];
  const fetchImpl = cfg.fetchImpl || globalThis.fetch;
  const timeoutMs = cfg.timeoutMs || 15000;

  async function chamar(metodo, caminho, corpo, opts = {}) {
    if (!cfg.apiKey) { return { ok: false, motivo: 'falta a chave de API do Asaas' }; }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = { accept: 'application/json', access_token: cfg.apiKey };
    if (corpo) { headers['content-type'] = 'application/json'; }
    // Idempotência do NOSSO lado: repetir a criação não pode cobrar duas vezes.
    if (opts.idempotencyKey) { headers['idempotency-key'] = opts.idempotencyKey; }
    try {
      const res = await fetchImpl(base + caminho, {
        method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, signal: ctrl.signal,
      });
      const dados = await res.json().catch(() => null);
      if (res.status >= 400) {
        return { ok: false, status: res.status, motivo: explicarErro(res.status, dados), corpo: dados };
      }
      return { ok: true, status: res.status, dados };
    } catch (e) {
      const abortou = e?.name === 'AbortError';
      return { ok: false, motivo: abortou ? `sem resposta em ${timeoutMs / 1000}s` : 'falha de rede: ' + (e?.message || 'desconhecida') };
    } finally {
      clearTimeout(t);
    }
  }

  return {
    nome: 'asaas',
    ambiente: cfg.ambiente || 'sandbox',

    /**
     * Cria a cobrança. `split` já vem pronto de `split.paraAsaas`.
     * Valor vai em REAIS decimais — a conversão de centavos morre aqui na borda.
     */
    async criarCobranca(e = {}) {
      const metodo = String(e.metodo || 'UNDEFINED').toUpperCase();
      if (!COBRANCAS.includes(metodo)) {
        return { ok: false, motivo: `forma de pagamento inválida: "${e.metodo}" (use ${COBRANCAS.join(', ')})` };
      }
      if (!e.clienteId) { return { ok: false, motivo: 'clienteId do Asaas é obrigatório' }; }
      if (!Number.isInteger(e.valorCentavos) || e.valorCentavos <= 0) {
        return { ok: false, motivo: `valor inválido: "${e.valorCentavos}" (centavos, inteiro > 0)` };
      }
      const corpo = {
        customer: e.clienteId,
        billingType: metodo,
        value: centavosParaReais(e.valorCentavos),
        dueDate: e.vencimento,
        description: e.descricao,
        externalReference: e.referencia,
      };
      if (e.split?.length) { corpo.split = e.split; }
      return chamar('POST', '/payments', corpo, { idempotencyKey: e.idempotencyKey });
    },

    consultarCobranca(id) {
      return chamar('GET', `/payments/${encodeURIComponent(id)}`);
    },

    /** Estorno. Atenção: estornar cobrança com split estorna os repasses junto. */
    estornar(id, e = {}) {
      const corpo = {};
      if (e.valorCentavos != null) { corpo.value = centavosParaReais(e.valorCentavos); }
      if (e.motivo) { corpo.description = e.motivo; }
      return chamar('POST', `/payments/${encodeURIComponent(id)}/refund`, corpo);
    },

    /** Subconta do prestador — é dela que sai o `walletId` usado no split. */
    criarSubconta(e = {}) {
      const falta = ['nome', 'email', 'cpfCnpj'].filter((c) => !String(e[c] || '').trim());
      if (falta.length) { return Promise.resolve({ ok: false, motivo: 'falta preencher: ' + falta.join(', ') }); }
      return chamar('POST', '/accounts', {
        name: e.nome, email: e.email, cpfCnpj: e.cpfCnpj,
        mobilePhone: e.telefone, birthDate: e.nascimento,
        companyType: e.tipoEmpresa, incomeValue: e.rendaMensal,
        address: e.endereco, addressNumber: e.numero, province: e.bairro,
        postalCode: e.cep,
      });
    },

    consultarSubconta(id) {
      return chamar('GET', `/accounts/${encodeURIComponent(id)}`);
    },

    /** Saldo da conta — usado para conferir se há caixa antes de prometer repasse. */
    saldo() {
      return chamar('GET', '/finance/balance');
    },

    /**
     * Transferência avulsa. É o caminho do modelo "plataforma retém e repassa
     * depois", que NÃO é o mesmo que split automático — ver o aviso no index.
     */
    transferir(e = {}) {
      if (!Number.isInteger(e.valorCentavos) || e.valorCentavos <= 0) {
        return Promise.resolve({ ok: false, motivo: 'valor de transferência inválido' });
      }
      if (!e.walletId && !e.chavePix) {
        return Promise.resolve({ ok: false, motivo: 'informe walletId (conta Asaas) ou chavePix do destinatário' });
      }
      const corpo = { value: centavosParaReais(e.valorCentavos) };
      if (e.walletId) { corpo.walletId = e.walletId; }
      if (e.chavePix) { corpo.pixAddressKey = e.chavePix; corpo.operationType = 'PIX'; }
      return chamar('POST', '/transfers', corpo, { idempotencyKey: e.idempotencyKey });
    },

    validarWebhook: (headers) => validarWebhook(headers, cfg.webhookToken),
  };
}
