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
import { criarGateway as gatewayAsaas, validarWebhook as validarAsaas } from './asaas.mjs';
import { criarGateway as gatewayMercadoPago } from './mercadopago.mjs';

/* Dois provedores de recebimento, mesmo contrato. O cliente escolhe qual usa —
   quem ja tem conta no Mercado Pago nao precisa abrir uma no Asaas so por causa
   do nosso codigo. */
export const PROVEDORES = ['asaas', 'mercadopago'];
import { calcularSplit, paraAsaas, conferir } from './split.mjs';
import { traduzirEvento, transitar, LIBERA_REPASSE } from './estados.mjs';

const inteiroPositivo = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

const CONFIG = 'config';
const PAGAMENTOS = 'pagamentos';
const EVENTOS = 'eventos';
const RECUSADOS = 'recusados';

/**
 * `direto` é o caso sem terceiro: a própria empresa cobra do próprio cliente
 * (mensalidade, licença, serviço dela). Não existe prestador, logo não existe
 * percentual nem base de split — exigir isso obrigava a inventar um sócio pra
 * poder emitir um Pix, e número inventado em cobrança é o começo de conciliação
 * errada. Split e custódia continuam como estavam.
 */
export const MODELOS = ['split', 'custodia', 'direto'];

/** O modelo divide o valor com alguém de fora? */
export const divideComTerceiro = (modelo) => modelo !== 'direto';

/* `criarGateway` continua exportado com o nome antigo (o do Asaas) pra nao
   quebrar quem ja importava daqui; o do Mercado Pago sai com nome proprio. */
export { calcularSplit, paraAsaas, conferir, traduzirEvento };
export { gatewayAsaas as criarGateway, gatewayMercadoPago };

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

  if (novo.provedor && !PROVEDORES.includes(novo.provedor)) {
    erros.push(`provedor inválido: "${novo.provedor}" (use ${PROVEDORES.join(' ou ')})`);
  }
  /* Custódia retém dinheiro de terceiro e exige saldo próprio na conta — o
     Mercado Pago não faz isso. Deixar passar seria prometer o que não existe. */
  if (novo.provedor === 'mercadopago' && novo.modelo === 'custodia') {
    erros.push('o Mercado Pago não suporta o modelo "custódia": ele não tem subconta com saldo próprio. Use "direto" ou "split".');
  }
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
  const prov = provedorAtual();
  const c = getConfig();
  const faltando = [];
  if (!c.apiKey) { faltando.push('apiKey do Asaas'); }
  if (!c.webhookToken) { faltando.push('token do webhook (sem ele o endpoint aceita evento forjado)'); }
  if (divideComTerceiro(c.modelo || 'split')) {
    if (c.percentualPrestador == null) { faltando.push('percentual do prestador (BDR-01)'); }
    if (!c.baseSplit) { faltando.push('base do split: quem absorve a taxa do gateway'); }
  }
  return {
    ambiente: c.ambiente || 'sandbox',
    modelo: c.modelo || 'split',
    custodia: c.modelo === 'custodia',
    divideComTerceiro: divideComTerceiro(c.modelo || 'split'),
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
  const comum = { ambiente: c.ambiente, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs };
  if ((c.provedor || 'asaas') === 'mercadopago') {
    const mp = credenciaisMercadoPago(c);
    return gatewayMercadoPago({ ...comum, apiKey: mp.token, webhookSecret: mp.segredo, ambiente: mp.ambiente });
  }
  return gatewayAsaas({ ...comum, apiKey: c.apiKey, webhookToken: c.webhookToken });
}

/**
 * Qual par de chaves usar.
 *
 * O padrão é TESTE, de propósito: produção move dinheiro de verdade e tem de ser
 * escolha consciente de quem digitou, não o que acontece quando ninguém decidiu.
 * O Mercado Pago tem dois pares de credenciais — o de teste não cobra ninguém.
 */
export function credenciaisMercadoPago(c = {}) {
  const ambiente = c.mpAmbiente || process.env.MP_AMBIENTE || 'teste';
  const producao = ambiente === 'producao';
  const token = producao
    ? (c.mpAccessToken || process.env.MP_ACCESS_TOKEN)
    : (c.mpAccessTokenTeste || process.env.MP_ACCESS_TOKEN_TESTE);
  return {
    ambiente,
    producao,
    token: token || null,
    publicKey: producao ? process.env.MP_PUBLIC_KEY : process.env.MP_PUBLIC_KEY_TESTE,
    segredo: c.mpWebhookSecret || process.env.MP_WEBHOOK_SECRET,
  };
}

/** Qual provedor está valendo, e se ele tem o mínimo pra cobrar. */
export function provedorAtual() {
  const c = getConfig();
  const nome = c.provedor || 'asaas';
  if (nome === 'mercadopago') {
    const mp = credenciaisMercadoPago(c);
    return {
      nome, rotulo: 'Mercado Pago',
      pronto: !!mp.token,
      ambiente: mp.ambiente,
      faltando: [
        !mp.token ? `Access Token do Mercado Pago (${mp.ambiente})` : null,
        /* Sem o segredo a rota ATENDE, mas sem conferir assinatura — e isso
           precisa aparecer como pendencia, nao ficar escondido num log. */
        !mp.segredo ? 'segredo de assinatura do webhook (a rota aceitaria evento forjado)' : null,
      ].filter(Boolean),
      emProducao: mp.producao,
      /* Subconta/saldo/transferencia nao existem no MP: o split dele e taxa na
         propria cobranca. Custodia exigiria saldo proprio — nao da. */
      suportaCustodia: false,
    };
  }
  return {
    nome, rotulo: 'Asaas', pronto: !!c.apiKey,
    faltando: [!c.apiKey ? 'chave de API do Asaas' : null, !c.webhookToken ? 'token do webhook' : null].filter(Boolean),
    emProducao: (c.ambiente || 'sandbox') === 'producao',
    suportaCustodia: true,
  };
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

  // No modelo direto o valor inteiro é da própria empresa: não há rateio a
  // calcular nem a gravar. `split: null` diz isso — diferente de um split zerado,
  // que sugeriria um repasse de zero pra alguém.
  const calc = divideComTerceiro(c.modelo)
    ? calcularSplit({
      brutoCentavos: e.valorCentavos,
      percentualPrestador: c.percentualPrestador,
      base: c.baseSplit,
      politicaVersao: c.politicaVersao,
    })
    : { ok: inteiroPositivo(e.valorCentavos), split: null, avisos: [], motivo: `valor inválido: "${e.valorCentavos}" (centavos, inteiro > 0)` };
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
    vencimento: r.dados?.dueDate || e.vencimento || null,
    descricao: e.descricao || null,
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
 * Garante um cliente no Asaas a partir do documento: reusa o que já existe em vez
 * de criar um novo a cada cobrança. Cliente duplicado não quebra o pagamento, mas
 * transforma o extrato deles em lixo — e é lá que se confere o que entrou.
 */
export async function garantirCliente(e = {}, opts = {}) {
  const g = gateway(opts);
  const achado = await g.buscarClientePorDocumento(e.cpfCnpj);
  if (achado.ok && achado.dados?.data?.length) {
    return { ok: true, clienteId: achado.dados.data[0].id, reusado: true };
  }
  const novo = await g.criarCliente(e);
  if (!novo.ok) { return novo; }
  return { ok: true, clienteId: novo.dados?.id, reusado: false };
}

/**
 * QR do Pix de uma cobrança já criada. Guarda no pagamento local pra tela não ter
 * que bater no Asaas toda vez que alguém reabre a página.
 */
export async function qrPix(id, opts = {}) {
  const pg = obter(id);
  if (!pg) { return { ok: false, motivo: 'pagamento não encontrado' }; }
  if (pg.pix?.payload) { return { ok: true, pix: pg.pix, doCache: true }; }
  const r = await gateway(opts).qrPix(id);
  if (!r.ok) { return r; }
  const pix = { payload: r.dados?.payload || null, imagemBase64: r.dados?.encodedImage || null, expiraEm: r.dados?.expirationDate || null };
  if (!pix.payload) { return { ok: false, motivo: 'o Asaas respondeu sem o copia-e-cola do Pix' }; }
  save(PAGAMENTOS, listar().map((p) => (p.id === id ? { ...p, pix } : p)));
  return { ok: true, pix, doCache: false };
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

  /* Cada provedor assina de um jeito: o Asaas manda um token no header, o
     Mercado Pago manda HMAC sobre um manifesto com id, request-id e timestamp.
     Conferir com o validador ERRADO e o mesmo que nao conferir. */
  const v = (c.provedor === 'mercadopago')
    ? gateway(opts).validarWebhook(headers, opts.query || {})
    : validarAsaas(headers, c.webhookToken);
  if (!v.ok) { return { ok: false, http: 401, motivo: v.motivo }; }
  if (v.conferida === false) { console.warn(`[pagamentos] ${v.motivo}`); }

  const ev = traduzirEvento(corpo, { provedor: c.provedor || 'asaas' });
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
    /* NAO marca como processado. O Asaas reentrega justamente pra consertar
       ordem trocada; gravar em `vistos` fazia a reentrega voltar como
       "duplicado" e o evento morria ali — pagamento recebido preso em CRIADO
       pra sempre, sem segunda chance. Fica registrado em `recusados` pra tela
       poder mostrar, e responde 200 porque 4xx repetido PAUSA a fila deles
       depois de 15 falhas, e ai nenhum pagamento e confirmado. */
    const recusados = load(RECUSADOS, []);
    save(RECUSADOS, [...recusados.slice(-199), {
      em: new Date().toISOString(), eventoId: ev.eventoId, evento: ev.evento,
      cobrancaId: ev.cobrancaId, estadoAtual: todos[i].estado, estadoPedido: ev.estado, motivo: t.erro,
    }]);
    return { ok: false, http: 200, motivo: t.erro, pagamento: todos[i], podeReentregar: true };
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
  // Sem esta linha o recebimento direto cairia na frase de "split não fechado",
  // mandando procurar um rateio que nunca existiu.
  if (pagamento.modelo === 'direto') { return { ok: false, motivo: 'recebimento direto: o valor já é da empresa, não há terceiro pra repassar' }; }
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
    // Evento que o Asaas mandou e nao coube no estado atual. Fica visivel porque
    // e exatamente o caso em que o dinheiro entrou e a tela pode nao saber.
    recusados: load(RECUSADOS, []).slice(-10).reverse(),
    integracao: diagnostico(),
  };
}
