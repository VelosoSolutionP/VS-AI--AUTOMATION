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
import { criarGateway as gatewayMercadoPago, conferirCredencial as mpConferirCredencial } from './mercadopago.mjs';

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
export { conferirCredencial as conferirCredencialMercadoPago } from './mercadopago.mjs';

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
  /* Ambiente errado escrito a mao cai CALADO em teste (`ambiente === 'producao'`
     e falso pra qualquer outra coisa). O dono acharia que ligou o recebimento e
     estaria gerando link que nao cobra ninguem. Barra aqui. */
  if (novo.mpAmbiente != null && !['teste', 'producao'].includes(novo.mpAmbiente)) {
    erros.push(`ambiente do Mercado Pago inválido: "${novo.mpAmbiente}" (use "teste" ou "producao", sem acento)`);
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
  /* O que falta e o que falta PRO PROVEDOR ESCOLHIDO. Conferir chave de Asaas
     com o Mercado Pago selecionado travava toda cobranca pedindo a credencial
     de um gateway que nao esta em uso — e nao havia caminho pra sair disso. */
  const faltando = [...prov.faltando];
  if (divideComTerceiro(c.modelo || 'split')) {
    if (c.percentualPrestador == null) { faltando.push('percentual do prestador (BDR-01)'); }
    if (!c.baseSplit) { faltando.push('base do split: quem absorve a taxa do gateway'); }
  }
  return {
    provedor: prov.nome,
    ambiente: prov.ambiente || c.ambiente || 'sandbox',
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
    emProducao: prov.emProducao,
  };
}

function gateway(opts = {}) {
  const c = getConfig();
  const comum = { ambiente: c.ambiente, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs };
  if ((c.provedor || 'asaas') === 'mercadopago') {
    /* `opts.mpAmbiente` deixa o CAMINHO do webhook mandar no ambiente. Sem isso,
       um aviso de producao seria conferido e consultado com as chaves de teste,
       onde aquele pagamento nao existe — e viraria orfao, calado. */
    const mp = credenciaisMercadoPago(opts.mpAmbiente ? { ...c, mpAmbiente: opts.mpAmbiente } : c);
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
    /* O segredo de assinatura tambem e POR AMBIENTE — o Mercado Pago gera um
       para o modo de teste e outro para o de producao. Usar o de teste para
       conferir um aviso de producao da 401 em pagamento de verdade: o dinheiro
       entra na conta e nunca vira lancamento aqui. O segredo unico continua
       valendo como reserva, pra nao quebrar quem ja configurou so ele. */
    segredo: (producao
      ? (c.mpWebhookSecretProducao || process.env.MP_WEBHOOK_SECRET_PRODUCAO)
      : (c.mpWebhookSecretTeste || process.env.MP_WEBHOOK_SECRET_TESTE))
      || c.mpWebhookSecret || process.env.MP_WEBHOOK_SECRET,
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

/**
 * As duas chaves do Mercado Pago, conferidas NA FONTE.
 *
 * Responde a pergunta que estava custando caro: "a chave que eu colei no campo
 * de produção é mesmo de produção?". Quem responde é o Mercado Pago, e a
 * resposta vem com o que cada conta CONSEGUE fazer — porque conta de teste não
 * faz Pix direto nem abre o checkout pra quem não está logado, e descobrir isso
 * no meio de um teste parece defeito do produto.
 */
export async function conferirCredenciais(opts = {}) {
  const c = getConfig();
  const alvos = [
    { campo: 'teste', esperado: 'teste', token: c.mpAccessTokenTeste || process.env.MP_ACCESS_TOKEN_TESTE },
    { campo: 'producao', esperado: 'producao', token: c.mpAccessToken || process.env.MP_ACCESS_TOKEN },
  ];
  const chaves = [];
  for (const alvo of alvos) {
    if (!alvo.token) { chaves.push({ campo: alvo.campo, preenchido: false }); continue; }
    const r = await mpConferirCredencial(alvo.token, opts);
    chaves.push({
      campo: alvo.campo,
      preenchido: true,
      ...r,
      /* O erro que mais custou tempo: chave certa, campo errado. Em vez de
         "não funciona", a tela passa a dizer QUAL campo está trocado. */
      noCampoErrado: r.ok === true && r.ambiente !== alvo.esperado,
    });
  }
  const trocadas = chaves.filter((k) => k.noCampoErrado).map((k) => k.campo);
  return {
    ok: true,
    chaves,
    ambienteAtivo: (c.mpAmbiente || process.env.MP_AMBIENTE || 'teste'),
    trocadas,
    avisos: [
      trocadas.length === 2 ? 'as duas chaves estão trocadas de campo: a de teste está no lugar da de produção e vice-versa' : null,
      trocadas.length === 1 ? `a chave do campo "${trocadas[0]}" é de ${chaves.find((k) => k.noCampoErrado).ambiente}` : null,
    ].filter(Boolean),
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
    /* O Mercado Pago precisa destes pra montar o checkout e pra saber onde
       avisar que pagaram. Sem passar, nascia cobranca sem aviso de retorno. */
    nome: e.nome,
    email: e.email,
    webhookUrl: e.webhookUrl,
  });
  if (!r.ok) { return r; }

  /* Os dois gateways respondem em formatos diferentes: o Asaas devolve o corpo
     cru em `dados`, o Mercado Pago devolve `pagamento` ja traduzido. Ler so o
     formato do Asaas fazia toda cobranca do MP nascer SEM id e SEM link — com
     `ok: true` na cara de quem pediu. Cobranca que ninguem consegue pagar e
     pior que erro: o erro pelo menos aparece. */
  const doGateway = r.pagamento || null;
  const id = doGateway?.id || r.dados?.id || null;
  const link = doGateway?.linkPagamento || r.dados?.invoiceUrl || null;
  const pix = doGateway?.pix || null;
  /* SEM ID nao da pra seguir: e por ele que o webhook reconhece o pagamento e
     que o repasse acha a cobranca. Cobranca anonima vira dinheiro que entra e
     nunca aparece na tela. */
  if (!id) {
    return {
      ok: false,
      motivo: 'o gateway aceitou a cobrança mas não devolveu identificador — sem ele o pagamento nunca seria reconhecido aqui',
      respostaDoGateway: doGateway || r.dados || null,
    };
  }
  /* Sem link NEM QR o cliente ainda nao tem como pagar. Nem sempre e defeito: no
     Asaas o Pix nasce assim e o QR vem depois, por `qrPix`. Entao isto vira
     AVISO, e quem fala com o cliente confere antes de prometer link. */
  const semFormaDePagamento = !link && !pix?.payload;

  const pagamento = {
    id: String(id),
    estado: doGateway?.estado || 'CRIADO',
    modelo: c.modelo,
    metodo: String(e.metodo || '').toUpperCase(),
    valorCentavos: e.valorCentavos,
    referencia: e.referencia || null,
    vencimento: r.dados?.dueDate || e.vencimento || null,
    descricao: e.descricao || null,
    walletIdPrestador: e.walletIdPrestador || null,
    split: calc.split,
    // Link de pagamento (Pix/cartão) vem do gateway — não é construído por nós.
    linkPagamento: link,
    // Quando o QR nasce no gateway (Pix direto), ele ja vem aqui.
    pix: doGateway?.pix || null,
    viaCheckout: !!r.viaCheckout,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    historico: [],
    repassado: false,
  };
  save(PAGAMENTOS, [...listar(), pagamento]);
  return {
    ok: true,
    pagamento,
    ...(semFormaDePagamento ? { semFormaDePagamento: true } : {}),
    avisos: [...calc.avisos, doGateway?.aviso,
      semFormaDePagamento ? 'o gateway ainda não devolveu link nem QR: o cliente só consegue pagar depois que um dos dois existir' : null].filter(Boolean),
  };
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
/**
 * A assinatura confere com o segredo do ambiente VIZINHO? Devolve qual e qual,
 * ou null. Se os dois ambientes caem no mesmo segredo (a reserva), nao ha o que
 * denunciar — seria acusar troca onde nao houve.
 */
function segredoDoOutroAmbiente(headers, corpo, opts, c) {
  if ((c.provedor || 'asaas') !== 'mercadopago') { return null; }
  const base = opts.mpAmbiente ? { ...c, mpAmbiente: opts.mpAmbiente } : c;
  const atual = credenciaisMercadoPago(base);
  const outro = atual.ambiente === 'producao' ? 'teste' : 'producao';
  const cred = credenciaisMercadoPago({ ...c, mpAmbiente: outro });
  if (!cred.segredo || cred.segredo === atual.segredo) { return null; }
  const g = gatewayMercadoPago({ apiKey: cred.token, webhookSecret: cred.segredo, ambiente: outro });
  return g.validarWebhook(headers, opts.query || {}).ok ? { atual: atual.ambiente, outro } : null;
}

export async function processarWebhook(headers = {}, corpo = {}, opts = {}) {
  const c = getConfig();

  /* Cada provedor assina de um jeito: o Asaas manda um token no header, o
     Mercado Pago manda HMAC sobre um manifesto com id, request-id e timestamp.
     Conferir com o validador ERRADO e o mesmo que nao conferir. */
  const v = (c.provedor === 'mercadopago')
    ? gateway(opts).validarWebhook(headers, opts.query || {})
    : validarAsaas(headers, c.webhookToken);
  if (!v.ok) {
    /* Um 401 aqui e caro: e pagamento REAL nao virando lancamento. Antes de
       devolver so "nao confere", descobre se a assinatura confere com o segredo
       do OUTRO ambiente. E o erro de cadastro mais comum — copiar a assinatura
       da aba de teste para o webhook de producao, ou o contrario — e o mais
       dificil de enxergar, porque os dois lados parecem certos. Continua 401
       (nao vamos processar aviso que nao confere), mas dizendo ONDE consertar. */
    const trocado = segredoDoOutroAmbiente(headers, corpo, opts, c);
    if (trocado) {
      const aviso = `a assinatura confere com o segredo de ${trocado.outro}, e este endereço é de ${trocado.atual}`
        + ` — no painel do Mercado Pago, a assinatura secreta é uma por modo`;
      console.warn(`[pagamentos] ${aviso}`);
      return { ok: false, http: 401, motivo: `${v.motivo}: ${aviso}`, segredoTrocado: trocado };
    }
    return { ok: false, http: 401, motivo: v.motivo };
  }
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
  /* O Mercado Pago avisa "houve algo com o pagamento X" e NAO diz o que. Se a
     gente parasse aqui, pagamento aprovado nunca viraria lancamento no caixa —
     que e justamente o unico motivo de existir este webhook. Entao vamos buscar.

     A consulta e feita ANTES de marcar o evento como visto: se a rede falhar, o
     Mercado Pago reentrega e a gente tenta de novo, em vez de dar o evento por
     processado tendo perdido o estado. */
  if (ev.estado == null && ev.precisaConsultar && ev.cobrancaId) {
    const consulta = await gateway(opts).consultarCobranca(ev.cobrancaId);
    if (!consulta.ok) {
      /* 404 nao melhora com o tempo: o pagamento nao e nosso ou nao existe. Pedir
         reentrega ai faria o Mercado Pago bater na nossa porta pra sempre pelo
         mesmo evento. Falha de REDE, sim: essa merece nova tentativa. */
      if (consulta.status === 404) {
        save(EVENTOS, { ...vistos, [ev.eventoId]: { em: new Date().toISOString(), evento: ev.evento, orfao: true } });
        return { ok: true, http: 200, orfao: true, motivo: `pagamento "${ev.cobrancaId}" não existe no Mercado Pago desta conta` };
      }
      return { ok: false, http: 500, motivo: `não consegui consultar o pagamento ${ev.cobrancaId}: ${consulta.motivo}`, podeReentregar: true };
    }
    ev.estado = consulta.pagamento.estado;
    ev.valorCentavos = consulta.pagamento.valorCentavos ?? ev.valorCentavos;
    ev.liquidoCentavos = consulta.pagamento.liquidoCentavos ?? ev.liquidoCentavos;
    ev.consultado = true;
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
