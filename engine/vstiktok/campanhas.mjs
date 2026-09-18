/**
 * VStiktok — campanhas de anúncio (TikTok Business/Ads API v1.3).
 *
 * Não confundir com `vsinfluence/campanhas.mjs`: aquele é a campanha ORGÂNICA do
 * criador (agrupa vídeos e calcula ROI local). Este aqui cria campanha PAGA de verdade
 * na conta de anúncios — gasta dinheiro do anunciante.
 *
 * Por isso duas decisões deliberadas:
 *  - toda campanha nasce PAUSADA (`DISABLE`) salvo pedido explícito. Criar já veiculando
 *    por causa de um campo errado é queimar orçamento antes de alguém conferir;
 *  - orçamento entra em CENTAVOS (padrão da suíte) e só vira decimal na borda.
 *
 * A Ads API responde HTTP 200 mesmo em erro; quem separa é `interpretar()` no api.mjs.
 */
import { chamar } from './api.mjs';
import { paraCentavos, formatarBRL } from '../vsinfluence/ganhos.mjs';

export const OBJETIVOS = [
  'REACH', 'TRAFFIC', 'VIDEO_VIEWS', 'ENGAGEMENT', 'LEAD_GENERATION',
  'APP_PROMOTION', 'WEB_CONVERSIONS', 'PRODUCT_SALES', 'CATALOG_SALES',
];

export const MODOS_ORCAMENTO = ['BUDGET_MODE_DAY', 'BUDGET_MODE_TOTAL', 'BUDGET_MODE_INFINITE'];
export const STATUS = ['ENABLE', 'DISABLE', 'DELETE'];

/** Objetivo em português -> constante da API, pra CLI e painel não exigirem decoreba. */
export const APELIDO_OBJETIVO = {
  alcance: 'REACH',
  trafego: 'TRAFFIC',
  visualizacoes: 'VIDEO_VIEWS',
  engajamento: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  app: 'APP_PROMOTION',
  conversoes: 'WEB_CONVERSIONS',
  vendas: 'PRODUCT_SALES',
  catalogo: 'CATALOG_SALES',
};

/**
 * Mínimos que a TikTok pratica, em USD. Viram AVISO, não erro: a conta pode estar em
 * outra moeda e o valor equivalente muda. Bloquear pelo número cru recusaria campanha
 * válida; calar recusaria na API depois de o usuário achar que deu certo.
 */
export const MINIMOS_USD = { campanhaDia: 50, conjuntoDia: 20 };

const txt = (v) => String(v ?? '').trim();

/** Centavos -> número decimal, que é o formato de orçamento da Ads API. */
export function centavosParaValor(centavos) {
  if (!Number.isFinite(Number(centavos))) { return null; }
  return Number((Number(centavos) / 100).toFixed(2));
}

/**
 * Valida e monta o payload da campanha.
 * @returns {{campanha:object|null, erros:string[], avisos:string[]}}
 */
export function normalizarCampanha(c = {}) {
  const erros = [];
  const avisos = [];

  const anuncianteId = txt(c.anuncianteId);
  if (!anuncianteId) { erros.push('anuncianteId é obrigatório (liste com `anunciantes`)'); }

  const nome = txt(c.nome);
  if (!nome) { erros.push('nome da campanha é obrigatório'); }
  if (nome.length > 512) { erros.push('nome da campanha passou de 512 caracteres'); }

  const bruto = txt(c.objetivo).toLowerCase();
  const objetivo = APELIDO_OBJETIVO[bruto] || txt(c.objetivo).toUpperCase();
  if (!OBJETIVOS.includes(objetivo)) {
    erros.push(`objetivo desconhecido: "${c.objetivo}" (use ${Object.keys(APELIDO_OBJETIVO).join(', ')})`);
  }

  const modo = txt(c.modoOrcamento).toUpperCase() || 'BUDGET_MODE_DAY';
  if (!MODOS_ORCAMENTO.includes(modo)) {
    erros.push(`modoOrcamento inválido: "${c.modoOrcamento}" (use ${MODOS_ORCAMENTO.join(', ')})`);
  }

  let centavos = null;
  if (modo !== 'BUDGET_MODE_INFINITE') {
    centavos = paraCentavos(c.orcamento);
    if (centavos == null) { erros.push(`orçamento inválido: "${c.orcamento}"`); }
    else if (centavos <= 0) { erros.push('orçamento tem que ser maior que zero'); }
    else if (modo === 'BUDGET_MODE_DAY' && centavos / 100 < MINIMOS_USD.campanhaDia) {
      avisos.push(`orçamento diário de ${formatarBRL(centavos)} está abaixo do mínimo que a TikTok costuma exigir (~${MINIMOS_USD.campanhaDia} na moeda da conta) — ela pode recusar`);
    }
  }

  // Ligar sozinha só se o chamador pedir com todas as letras.
  const status = c.ativar === true ? 'ENABLE' : 'DISABLE';

  if (erros.length) { return { campanha: null, erros, avisos }; }

  const campanha = {
    advertiser_id: anuncianteId,
    campaign_name: nome,
    objective_type: objetivo,
    budget_mode: modo,
    operation_status: status,
  };
  if (centavos != null) { campanha.budget = centavosParaValor(centavos); }
  if (c.appId) { campanha.app_id = txt(c.appId); }
  if (c.catalogoId) { campanha.catalog_id = txt(c.catalogoId); }

  return { campanha, erros: [], avisos };
}

/**
 * Valida o conjunto de anúncios (adgroup) — é a camada que define público, período,
 * lance e onde o anúncio aparece. Campanha sem conjunto não veicula nada.
 */
export function normalizarConjunto(g = {}) {
  const erros = [];
  const avisos = [];

  const anuncianteId = txt(g.anuncianteId);
  if (!anuncianteId) { erros.push('anuncianteId é obrigatório'); }
  const campanhaId = txt(g.campanhaId);
  if (!campanhaId) { erros.push('campanhaId é obrigatório'); }
  const nome = txt(g.nome);
  if (!nome) { erros.push('nome do conjunto é obrigatório'); }

  const locais = (g.locais || []).map(txt).filter(Boolean);
  if (!locais.length) { erros.push('informe ao menos um location_id (ex.: BR) — sem isso a TikTok não sabe onde veicular'); }

  const modo = txt(g.modoOrcamento).toUpperCase() || 'BUDGET_MODE_DAY';
  if (!MODOS_ORCAMENTO.includes(modo)) { erros.push(`modoOrcamento inválido: "${g.modoOrcamento}"`); }

  const centavos = paraCentavos(g.orcamento);
  if (centavos == null || centavos <= 0) { erros.push(`orçamento do conjunto inválido: "${g.orcamento}"`); }
  else if (modo === 'BUDGET_MODE_DAY' && centavos / 100 < MINIMOS_USD.conjuntoDia) {
    avisos.push(`orçamento diário do conjunto (${formatarBRL(centavos)}) está abaixo do mínimo usual (~${MINIMOS_USD.conjuntoDia} na moeda da conta)`);
  }

  const inicio = txt(g.inicio);
  const fim = txt(g.fim);
  const dataHora = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!dataHora.test(inicio)) { erros.push(`início inválido: "${g.inicio}" (use "AAAA-MM-DD HH:MM:SS")`); }
  if (fim && !dataHora.test(fim)) { erros.push(`fim inválido: "${g.fim}" (use "AAAA-MM-DD HH:MM:SS")`); }
  if (dataHora.test(inicio) && dataHora.test(fim) && fim <= inicio) { erros.push('o fim tem que ser depois do início'); }
  // Orçamento total sem data de fim vira campanha que gasta indefinidamente.
  if (modo === 'BUDGET_MODE_TOTAL' && !fim) { erros.push('orçamento total exige data de fim'); }

  const objetivoOtim = txt(g.otimizacao).toUpperCase() || 'CLICK';
  const cobranca = txt(g.cobranca).toUpperCase() || 'CPC';

  let lance = null;
  if (g.lance != null && g.lance !== '') {
    lance = paraCentavos(g.lance);
    if (lance == null || lance <= 0) { erros.push(`lance inválido: "${g.lance}"`); }
  }

  if (erros.length) { return { conjunto: null, erros, avisos }; }

  const conjunto = {
    advertiser_id: anuncianteId,
    campaign_id: campanhaId,
    adgroup_name: nome,
    promotion_type: txt(g.tipoPromocao).toUpperCase() || 'WEBSITE',
    placement_type: txt(g.tipoPosicionamento).toUpperCase() || 'PLACEMENT_TYPE_AUTOMATIC',
    location_ids: locais,
    budget_mode: modo,
    budget: centavosParaValor(centavos),
    schedule_type: fim ? 'SCHEDULE_START_END' : 'SCHEDULE_FROM_NOW',
    schedule_start_time: inicio,
    optimization_goal: objetivoOtim,
    billing_event: cobranca,
    bid_type: lance == null ? 'BID_TYPE_NO_BID' : 'BID_TYPE_CUSTOM',
    operation_status: g.ativar === true ? 'ENABLE' : 'DISABLE',
  };
  if (fim) { conjunto.schedule_end_time = fim; }
  if (lance != null) { conjunto.bid_price = centavosParaValor(lance); }
  if (g.posicionamentos?.length) { conjunto.placements = g.posicionamentos; }
  if (g.idiomas?.length) { conjunto.languages = g.idiomas; }
  if (g.idadeFaixas?.length) { conjunto.age_groups = g.idadeFaixas; }
  if (g.genero) { conjunto.gender = txt(g.genero).toUpperCase(); }
  if (g.interesses?.length) { conjunto.interest_category_ids = g.interesses; }
  if (g.pixelId) { conjunto.pixel_id = txt(g.pixelId); }

  return { conjunto, erros: [], avisos };
}

/** Valida o anúncio em si (o criativo que vai ao ar). */
export function normalizarAnuncio(a = {}) {
  const erros = [];
  const anuncianteId = txt(a.anuncianteId);
  if (!anuncianteId) { erros.push('anuncianteId é obrigatório'); }
  const conjuntoId = txt(a.conjuntoId);
  if (!conjuntoId) { erros.push('conjuntoId é obrigatório'); }
  const nome = txt(a.nome);
  if (!nome) { erros.push('nome do anúncio é obrigatório'); }
  const videoId = txt(a.videoId);
  if (!videoId) { erros.push('videoId é obrigatório (suba o vídeo pela API de criativos antes)'); }
  const texto = txt(a.texto);
  if (!texto) { erros.push('texto do anúncio é obrigatório'); }
  if (texto.length > 100) { erros.push(`texto do anúncio passou de 100 caracteres (tem ${texto.length})`); }
  const destino = txt(a.destino);
  if (destino && !/^https?:\/\//i.test(destino)) { erros.push('destino precisa começar com http:// ou https://'); }
  const identidadeId = txt(a.identidadeId);
  if (!identidadeId) { erros.push('identidadeId é obrigatório (é a conta que assina o anúncio; liste com `identidades`)'); }

  if (erros.length) { return { anuncio: null, erros }; }

  const criativo = {
    ad_name: nome,
    ad_format: txt(a.formato).toUpperCase() || 'SINGLE_VIDEO',
    video_id: videoId,
    ad_text: texto,
    identity_id: identidadeId,
    identity_type: txt(a.tipoIdentidade).toUpperCase() || 'CUSTOMIZED_USER',
    call_to_action: txt(a.cta).toUpperCase() || 'LEARN_MORE',
  };
  if (destino) { criativo.landing_page_url = destino; }
  if (a.imagemIds?.length) { criativo.image_ids = a.imagemIds; }

  return {
    anuncio: { advertiser_id: anuncianteId, adgroup_id: conjuntoId, creatives: [criativo] },
    erros: [],
  };
}

/** Atalho: toda rota de Ads é business + Access-Token. */
function req(ctx = {}, caminho, extra = {}) {
  return chamar('business', caminho, {
    token: ctx.token,
    fetchImpl: ctx.fetchImpl,
    esperar: ctx.esperar,
    agora: ctx.agora,
    timeoutMs: ctx.timeoutMs,
    tentativas: ctx.tentativas,
    ...extra,
  });
}

/** Contas de anúncio que o app pode operar — o advertiser_id de tudo sai daqui. */
export async function anunciantes(ctx = {}, cred = {}) {
  if (!cred.appId || !cred.secret) { return { ok: false, motivo: 'falta appId/secret do app de Ads' }; }
  return req(ctx, '/oauth2/advertiser/get/', { metodo: 'GET', query: { app_id: cred.appId, secret: cred.secret } });
}

/** Identidades (contas TikTok) que podem assinar o anúncio. */
export async function identidades(ctx = {}, anuncianteId) {
  if (!txt(anuncianteId)) { return { ok: false, motivo: 'anuncianteId é obrigatório' }; }
  return req(ctx, '/identity/get/', { metodo: 'GET', query: { advertiser_id: anuncianteId } });
}

/** Cria a campanha (pausada por padrão). */
export async function criar(ctx = {}, c = {}) {
  const { campanha, erros, avisos } = normalizarCampanha(c);
  if (erros.length) { return { ok: false, motivo: 'campanha invalida: ' + erros.join('; '), erros, avisos }; }
  const r = await req(ctx, '/campaign/create/', { metodo: 'POST', corpo: campanha });
  return { ...r, avisos, criadaPausada: campanha.operation_status === 'DISABLE' };
}

/** Cria o conjunto de anúncios. */
export async function criarConjunto(ctx = {}, g = {}) {
  const { conjunto, erros, avisos } = normalizarConjunto(g);
  if (erros.length) { return { ok: false, motivo: 'conjunto invalido: ' + erros.join('; '), erros, avisos }; }
  const r = await req(ctx, '/adgroup/create/', { metodo: 'POST', corpo: conjunto });
  return { ...r, avisos };
}

/** Cria o anúncio dentro de um conjunto. */
export async function criarAnuncio(ctx = {}, a = {}) {
  const { anuncio, erros } = normalizarAnuncio(a);
  if (erros.length) { return { ok: false, motivo: 'anuncio invalido: ' + erros.join('; '), erros }; }
  return req(ctx, '/ad/create/', { metodo: 'POST', corpo: anuncio });
}

/** Lista campanhas da conta. `filtros` vai como JSON na query (exigência da Ads API). */
export async function listar(ctx = {}, anuncianteId, opts = {}) {
  if (!txt(anuncianteId)) { return { ok: false, motivo: 'anuncianteId é obrigatório' }; }
  const query = { advertiser_id: anuncianteId, page: opts.pagina || 1, page_size: opts.tamanho || 20 };
  if (opts.ids?.length) { query.filtering = JSON.stringify({ campaign_ids: opts.ids }); }
  else if (opts.status) { query.filtering = JSON.stringify({ primary_status: String(opts.status).toUpperCase() }); }
  return req(ctx, '/campaign/get/', { metodo: 'GET', query });
}

/** Liga, pausa ou apaga campanhas. DELETE não tem volta — por isso é explícito. */
export async function mudarStatus(ctx = {}, anuncianteId, ids, status) {
  const alvo = txt(status).toUpperCase();
  if (!txt(anuncianteId)) { return { ok: false, motivo: 'anuncianteId é obrigatório' }; }
  const campaign_ids = (Array.isArray(ids) ? ids : [ids]).map(txt).filter(Boolean);
  if (!campaign_ids.length) { return { ok: false, motivo: 'informe ao menos uma campanhaId' }; }
  if (!STATUS.includes(alvo)) { return { ok: false, motivo: `status inválido: "${status}" (use ${STATUS.join(', ')})` }; }
  return req(ctx, '/campaign/status/update/', {
    metodo: 'POST',
    corpo: { advertiser_id: anuncianteId, campaign_ids, operation_status: alvo },
  });
}

/** Altera nome/orçamento de uma campanha já criada. */
export async function atualizar(ctx = {}, anuncianteId, campanhaId, mudancas = {}) {
  if (!txt(anuncianteId) || !txt(campanhaId)) { return { ok: false, motivo: 'anuncianteId e campanhaId são obrigatórios' }; }
  const corpo = { advertiser_id: txt(anuncianteId), campaign_id: txt(campanhaId) };
  if (txt(mudancas.nome)) { corpo.campaign_name = txt(mudancas.nome); }
  if (mudancas.orcamento != null && mudancas.orcamento !== '') {
    const centavos = paraCentavos(mudancas.orcamento);
    if (centavos == null || centavos <= 0) { return { ok: false, motivo: `orçamento inválido: "${mudancas.orcamento}"` }; }
    corpo.budget = centavosParaValor(centavos);
  }
  if (Object.keys(corpo).length === 2) { return { ok: false, motivo: 'nada pra atualizar (informe nome e/ou orcamento)' }; }
  return req(ctx, '/campaign/update/', { metodo: 'POST', corpo });
}

export const METRICAS_PADRAO = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversion', 'cost_per_conversion'];

/**
 * Relatório por campanha no período. As listas vão JSON-encodadas na query porque a
 * Ads API não aceita array repetido em GET.
 */
export async function relatorio(ctx = {}, anuncianteId, periodo = {}, opts = {}) {
  if (!txt(anuncianteId)) { return { ok: false, motivo: 'anuncianteId é obrigatório' }; }
  const data = /^\d{4}-\d{2}-\d{2}$/;
  if (!data.test(txt(periodo.inicio))) { return { ok: false, motivo: `início inválido: "${periodo.inicio}" (use AAAA-MM-DD)` }; }
  if (!data.test(txt(periodo.fim))) { return { ok: false, motivo: `fim inválido: "${periodo.fim}" (use AAAA-MM-DD)` }; }
  if (txt(periodo.fim) < txt(periodo.inicio)) { return { ok: false, motivo: 'o fim tem que ser depois do início' }; }

  const r = await req(ctx, '/report/integrated/get/', {
    metodo: 'GET',
    query: {
      advertiser_id: anuncianteId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id']),
      metrics: JSON.stringify(opts.metricas || METRICAS_PADRAO),
      start_date: txt(periodo.inicio),
      end_date: txt(periodo.fim),
      page: opts.pagina || 1,
      page_size: opts.tamanho || 50,
    },
  });
  if (!r.ok) { return r; }
  return { ...r, linhas: (r.dados?.list || []).map(normalizarLinhaRelatorio) };
}

/**
 * Deixa a linha do relatório na forma da suíte. Métrica que a TikTok não devolveu
 * vira `null`, NUNCA 0 — senão o painel afirma "zero clique" quando a verdade é
 * "não veio no relatório", e alguém corta uma campanha que estava funcionando.
 */
export function normalizarLinhaRelatorio(linha = {}) {
  const m = linha.metrics || {};
  const num = (v) => {
    if (v == null || v === '') { return null; }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const gasto = num(m.spend);
  return {
    campanhaId: linha.dimensions?.campaign_id ?? null,
    nome: m.campaign_name ?? null,
    gastoCentavos: gasto == null ? null : Math.round(gasto * 100),
    gastoFormatado: gasto == null ? '—' : formatarBRL(Math.round(gasto * 100)),
    impressoes: num(m.impressions),
    cliques: num(m.clicks),
    ctr: num(m.ctr),
    cpc: num(m.cpc),
    cpm: num(m.cpm),
    conversoes: num(m.conversion),
    custoPorConversao: num(m.cost_per_conversion),
  };
}
