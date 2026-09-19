/**
 * VSpagamentos — orquestrador. Recebimento por Pix e cartão, split e repasse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOIS MODELOS DE REPASSE — e eles têm consequência jurídica diferente
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  SPLIT (automático, no recebimento)
 *    O dinheiro se divide na liquidação: a parte do prestador cai direto na
 *    subconta dele, a comissão fica com a plataforma. O valor de terceiro NUNCA
 *    passa pela conta da plataforma.
 *
 *  CUSTÓDIA (plataforma recebe tudo e repassa depois)
 *    A plataforma recebe o valor inteiro e transfere ao prestador numa data
 *    combinada. Foi este o modelo pedido ("o cliente não recebe, é repassado").
 *
 * O segundo é operacionalmente possível — `transferir()` faz isso. Mas reter valor
 * de terceiro e repassar depois é atividade que, no Brasil, tende a atrair
 * regulação de arranjo/instituição de pagamento. Não sou a fonte dessa resposta:
 * ela é do jurídico. O split existe exatamente para obter o mesmo efeito comercial
 * (a plataforma controla quanto e quando) sem custodiar dinheiro alheio, porque a
 * própria data de liquidação pode ser usada como trava.
 *
 * Por isso o modelo é CONFIGURÁVEL, o padrão é `split`, e `custodia` exige um
 * reconhecimento explícito de que a decisão foi tomada com apoio jurídico.
 * → BDR-04 e BDR-16 no documento de arquitetura.
 */
import { load, save, mascarar } from './store.mjs';
import { criarGateway, validarWebhook } from './asaas.mjs';
import { calcularSplit, paraAsaas, conferir } from './split.mjs';
import { traduzirEvento, transitar, LIBERA_REPASSE } from './estados.mjs';

const CONFIG = 'config';
const PAGAMENTOS = 'pagamentos';
const EVENTOS = 'eventos';

export const MODELOS = ['split', 'custodia'];

export { calcularSplit, paraAsaas, conferir, traduzirEvento, criarGateway };

export function getConfig() {
  return load(CONFIG, { modelo: 'split', ambiente: 'sandbox' });
}

/**
 * Grava a configuração comercial e as credenciais.
 * Recusa `custodia` sem o reconhecimento explícito — não por burocracia, mas porque
 * ninguém deve ligar custódia de dinheiro de terceiro sem saber que decidiu isso.
 */
export function configurar(mudancas = {}) {
  const atual = getConfig();
  const novo = { ...atual, ...mudancas };
  const erros = [];

  if (novo.modelo && !MODELOS.includes(novo.modelo)) {
    erros.push(`modelo inválido: "${novo.modelo}" (use ${MODELOS.join(' ou ')})`);
  }
  if (novo.modelo === 'custodia' && !novo.custodiaAprovadaPorJuridico) {
    erros.push('modelo "custodia" retém dinheiro de terceiro — exige `custodiaAprovadaPorJuridico: true` (ver BDR-16)');
  }
  if (novo.percentualPrestador != null) {
    const p = Number(novo.percentualPrestador);
    if (!Number.isFinite(p) || p <= 0 || p >= 100) { erros.push(`percentual do prestador inválido: "${novo.percentualPrestador}"`); }
  }
  if (novo.baseSplit && !['bruto', 'liquido'].includes(novo.baseSplit)) {
    erros.push('baseSplit deve ser "bruto" (plataforma absorve a taxa) ou "liquido" (taxa dividida)');
  }
  if (novo.webhookToken && String(novo.webhookToken).length < 32) {
    erros.push('o token de webhook do Asaas precisa ter no mínimo 32 caracteres');
  }
  if (erros.length) { return { ok: false, erros }; }

  save(CONFIG, novo);
  return { ok: true, config: { ...novo, apiKey: mascarar(novo.apiKey), webhookToken: mascarar(novo.webhookToken) } };
}

/** Situação da integração — o que falta pra poder cobrar de verdade. */
export function diagnostico() {
  const c = getConfig();
  const faltando = [];
  if (!c.apiKey) { faltando.push('apiKey do Asaas'); }
  if (!c.webhookToken) { faltando.push('token do webhook (sem ele o endpoint aceita evento forjado)'); }
  if (c.percentualPrestador == null) { faltando.push('percentual do prestador (BDR-01)'); }
  if (!c.baseSplit) { faltando.push('base do split: quem absorve a taxa do gateway'); }
  return {
    ambiente: c.ambiente || 'sandbox',
    modelo: c.modelo || 'split',
    custodia: c.modelo === 'custodia',
    percentualPrestador: c.percentualPrestador ?? null,
    baseSplit: c.baseSplit ?? null,
    apiKey: c.apiKey ? mascarar(c.apiKey) : null,
    webhookToken: c.webhookToken ? mascarar(c.webhookToken) : null,
    faltando,
    pronto: faltando.length === 0,
    // Produção é decisão consciente: sandbox não move dinheiro.
    emProducao: (c.ambiente || 'sandbox') === 'producao',
  };
}

function gateway(opts = {}) {
  const c = getConfig();
  return criarGateway({
    apiKey: c.apiKey, ambiente: c.ambiente, webhookToken: c.webhookToken,
    fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs,
  });
}

export const listar = () => load(PAGAMENTOS, []);
export const obter = (id) => listar().find((p) => p.id === String(id)) || null;

/**
 * Cria uma cobrança: calcula o split, manda ao gateway e grava o pagamento local
 * com o split que VALEU neste momento.
 */
export async function cobrar(e = {}, opts = {}) {
  const c = getConfig();
  const d = diagnostico();
  if (!d.pronto) { return { ok: false, motivo: 'integração incompleta: ' + d.faltando.join('; ') }; }

  const calc = calcularSplit({
    brutoCentavos: e.valorCentavos,
    percentualPrestador: c.percentualPrestador,
    base: c.baseSplit,
    politicaVersao: c.politicaVersao,
  });
  if (!calc.ok) { return { ok: false, motivo: calc.motivo }; }

  let splitAsaas;
  if (c.modelo === 'split') {
    const s = paraAsaas(calc.split, e.walletIdPrestador);
    if (!s.ok) { return { ok: false, motivo: s.motivo }; }
    splitAsaas = s.split;
  }

  const g = gateway(opts);
  const r = await g.criarCobranca({
    clienteId: e.clienteId,
    metodo: e.metodo,
    valorCentavos: e.valorCentavos,
    vencimento: e.vencimento,
    descricao: e.descricao,
    referencia: e.referencia,
    split: splitAsaas,
    idempotencyKey: e.idempotencyKey,
  });
  if (!r.ok) { return r; }

  const pagamento = {
    id: r.dados?.id,
    estado: 'CRIADO',
    modelo: c.modelo,
    metodo: String(e.metodo || '').toUpperCase(),
    valorCentavos: e.valorCentavos,
    referencia: e.referencia || null,
    walletIdPrestador: e.walletIdPrestador || null,
    split: calc.split,
    // Link de pagamento (Pix/cartão) vem do gateway — não é construído por nós.
    linkPagamento: r.dados?.invoiceUrl || null,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    historico: [],
    repassado: false,
  };
  save(PAGAMENTOS, [...listar(), pagamento]);
  return { ok: true, pagamento, avisos: calc.avisos };
}

/**
 * Processa um webhook do Asaas, do começo ao fim, com as duas travas que a doc dele
 * exige: token válido e deduplicação pelo id do evento (entrega é at-least-once).
 *
 * Devolve sempre um veredito explícito — inclusive "já processei este" — porque o
 * chamador HTTP precisa responder 200 mesmo em duplicata, senão a fila do Asaas
 * pausa após 15 falhas.
 */
export function processarWebhook(headers = {}, corpo = {}, opts = {}) {
  const c = getConfig();
  const v = validarWebhook(headers, c.webhookToken);
  if (!v.ok) { return { ok: false, http: 401, motivo: v.motivo }; }

  const ev = traduzirEvento(corpo);
  if (!ev.eventoId) { return { ok: false, http: 400, motivo: 'evento sem id — não dá pra garantir idempotência' }; }

  const vistos = load(EVENTOS, {});
  if (vistos[ev.eventoId]) {
    // Duplicata é normal, não erro: responder 200 evita a fila pausar.
    return { ok: true, http: 200, duplicado: true, motivo: 'evento já processado' };
  }

  if (!ev.conhecido) {
    // Registra pra não reprocessar, mas não move dinheiro por evento desconhecido.
    save(EVENTOS, { ...vistos, [ev.eventoId]: { em: new Date().toISOString(), evento: ev.evento, ignorado: true } });
    return { ok: true, http: 200, ignorado: true, motivo: `evento não tratado: "${ev.evento}"` };
  }
  if (ev.estado == null) {
    save(EVENTOS, { ...vistos, [ev.eventoId]: { em: new Date().toISOString(), evento: ev.evento, semEfeito: true } });
    return { ok: true, http: 200, semEfeito: true, motivo: `"${ev.evento}" não muda o estado do pagamento` };
  }

  const todos = listar();
  const i = todos.findIndex((p) => p.id === ev.cobrancaId);
  if (i < 0) {
    save(EVENTOS, { ...vistos, [ev.eventoId]: { em: new Date().toISOString(), evento: ev.evento, orfao: true } });
    return { ok: true, http: 200, orfao: true, motivo: `cobrança "${ev.cobrancaId}" não é nossa` };
  }

  const t = transitar(todos[i], ev.estado, { origem: ev.evento, quando: opts.quando });
  if (t.erro) {
    // Transição impossível é sinal de problema real — não engole.
    save(EVENTOS, { ...vistos, [ev.eventoId]: { em: new Date().toISOString(), evento: ev.evento, recusado: t.erro } });
    return { ok: false, http: 200, motivo: t.erro, pagamento: todos[i] };
  }

  // O líquido só é conhecido quando o gateway informa — aí o split fecha de verdade.
  if (ev.liquidoCentavos != null && t.pagamento.split && t.pagamento.split.liquidoCentavos == null) {
    const refeito = calcularSplit({
      brutoCentavos: t.pagamento.split.brutoCentavos,
      liquidoCentavos: ev.liquidoCentavos,
      percentualPrestador: t.pagamento.split.percentualPrestador,
      base: t.pagamento.split.base,
      politicaVersao: t.pagamento.split.politicaVersao,
    });
    if (refeito.ok) { t.pagamento.split = refeito.split; }
  }

  todos[i] = t.pagamento;
  save(PAGAMENTOS, todos);
  save(EVENTOS, { ...vistos, [ev.eventoId]: { em: new Date().toISOString(), evento: ev.evento, cobranca: ev.cobrancaId } });

  return { ok: true, http: 200, pagamento: t.pagamento, estado: t.pagamento.estado, repetido: t.repetido || false };
}

/**
 * Pode repassar? Nunca olha "pago": olha DISPONIVEL e mais nada pendente.
 * É a regra que impede repassar em cima de dinheiro que ainda pode virar chargeback.
 */
export function podeRepassar(pagamento, opts = {}) {
  if (!pagamento) { return { ok: false, motivo: 'pagamento não encontrado' }; }
  if (pagamento.repassado) { return { ok: false, motivo: 'este pagamento já foi repassado' }; }
  if (!LIBERA_REPASSE.includes(pagamento.estado)) {
    return {
      ok: false,
      motivo: pagamento.estado === 'CONFIRMADO'
        ? 'pago, mas o valor ainda NÃO está disponível — repassar agora corre risco de chargeback'
        : `estado "${pagamento.estado}" não libera repasse`,
    };
  }
  if (opts.disputaAberta) { return { ok: false, motivo: 'há disputa aberta nesta ordem de serviço' }; }
  if (pagamento.split?.prestadorCentavos == null) { return { ok: false, motivo: 'split ainda não fechado (líquido desconhecido)' }; }
  return { ok: true, valorCentavos: pagamento.split.prestadorCentavos };
}

/**
 * Repassa no modelo de custódia. No modelo `split` isto não existe: o gateway já
 * dividiu na liquidação.
 */
export async function repassar(id, opts = {}) {
  const c = getConfig();
  if (c.modelo !== 'custodia') {
    return { ok: false, motivo: 'no modelo "split" o repasse é automático na liquidação — não há transferência a fazer' };
  }
  const todos = listar();
  const i = todos.findIndex((p) => p.id === String(id));
  if (i < 0) { return { ok: false, motivo: `pagamento "${id}" não encontrado` }; }

  const pode = podeRepassar(todos[i], opts);
  if (!pode.ok) { return pode; }

  const g = gateway(opts);
  const r = await g.transferir({
    valorCentavos: pode.valorCentavos,
    walletId: todos[i].walletIdPrestador,
    chavePix: opts.chavePix,
    idempotencyKey: `repasse-${todos[i].id}`,
  });
  if (!r.ok) { return r; }

  todos[i] = { ...todos[i], repassado: true, repasseEm: new Date().toISOString(), repasseId: r.dados?.id || null };
  save(PAGAMENTOS, todos);
  return { ok: true, pagamento: todos[i], valorCentavos: pode.valorCentavos };
}

/** Visão do painel. */
export function painel() {
  const todos = listar();
  const soma = (f) => todos.filter(f).reduce((a, p) => a + (p.valorCentavos || 0), 0);
  return {
    total: todos.length,
    aguardando: todos.filter((p) => ['CRIADO', 'PENDENTE'].includes(p.estado)).length,
    confirmadosCentavos: soma((p) => p.estado === 'CONFIRMADO'),
    disponiveisCentavos: soma((p) => p.estado === 'DISPONIVEL'),
    aRepassar: todos.filter((p) => podeRepassar(p).ok).length,
    problemas: todos.filter((p) => ['CHARGEBACK', 'CHARGEBACK_DISPUTA', 'ESTORNADO'].includes(p.estado)).length,
    integracao: diagnostico(),
  };
}
