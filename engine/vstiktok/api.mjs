/**
 * VStiktok — cliente HTTP das APIs da TikTok. Existe uma camada só porque as três
 * famílias que o módulo usa falam protocolos DIFERENTES e cada uma erra de um jeito:
 *
 *   open     → open.tiktokapis.com (Login Kit, Display, Content Posting).
 *              O erro vem DENTRO do corpo, em `error.code`, e `"ok"` é sucesso.
 *              HTTP 200 carregando erro é rotina aqui, não exceção.
 *   business → business-api.tiktok.com/open_api/v1.3 (Ads/campanhas).
 *              Responde HTTP 200 praticamente sempre; quem manda é `code` (0 = ok).
 *   shop     → open-api.tiktokglobalshop.com (Shop/produtos).
 *              Também usa `code` no corpo e, além do token, exige uma assinatura
 *              HMAC-SHA256 (`sign`) calculada em CADA chamada.
 *
 * Por isso nenhum ponto do módulo olha `res.ok`: quem decide é `interpretar()`.
 * E nada aqui lança por causa de rede — volta {ok:false, motivo}, igual ao resto da
 * suíte, porque API de terceiro fora do ar não pode derrubar o painel.
 */
import { createHmac } from 'node:crypto';

export const BASE = {
  open: 'https://open.tiktokapis.com',
  business: 'https://business-api.tiktok.com/open_api/v1.3',
  shop: 'https://open-api.tiktokglobalshop.com',
};

/** Telas de consentimento e endpoints de token (ficam fora das bases de dados). */
export const AUTH = {
  openAutorizar: 'https://www.tiktok.com/v2/auth/authorize/',
  openToken: 'https://open.tiktokapis.com/v2/oauth/token/',
  openRevogar: 'https://open.tiktokapis.com/v2/oauth/revoke/',
  businessAutorizar: 'https://business-api.tiktok.com/portal/auth',
  businessToken: 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
  shopAutorizar: 'https://services.tiktokshop.com/open/authorize',
  shopToken: 'https://auth.tiktok-shops.com/api/v2/token/get',
  shopRenovar: 'https://auth.tiktok-shops.com/api/v2/token/refresh',
};

export const FAMILIAS = Object.keys(BASE);

const TIMEOUT_PADRAO = 15000;

/**
 * Assinatura exigida pela Shop API. O algoritmo é da TikTok e é sensível a ordem:
 * 1) parâmetros de query em ordem alfabética, SEM `sign` e SEM `access_token`;
 * 2) concatena `chave+valor`, com o CAMINHO da rota na frente;
 * 3) cola o corpo cru no fim (menos em multipart, que a TikTok exclui);
 * 4) embrulha tudo com o app_secret nas duas pontas;
 * 5) HMAC-SHA256 com o próprio app_secret, em hex.
 * Errar um passo devolve 105xxx "invalid sign" — que não diz qual passo falhou, daí
 * o detalhe do comentário.
 */
export function assinarShop({ caminho, query = {}, corpo = null, appSecret, multipart = false }) {
  const chaves = Object.keys(query)
    .filter((k) => k !== 'sign' && k !== 'access_token' && query[k] != null && query[k] !== '')
    .sort();
  let base = caminho;
  for (const k of chaves) { base += k + query[k]; }
  if (corpo != null && !multipart) {
    base += typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  }
  base = appSecret + base + appSecret;
  return createHmac('sha256', appSecret).update(base, 'utf8').digest('hex');
}

/**
 * Traduz a falha para uma frase que diz O QUE fazer. O texto da mensagem vale mais
 * que o código: a TikTok reaproveita código entre causas e muda a numeração por
 * versão, mas a mensagem ("access token is invalid") é estável.
 */
export function explicarErro(familia, status, code, mensagem = '') {
  const txt = `${code ?? ''} ${mensagem ?? ''}`;
  // Vem ANTES do "expirou" generico de proposito: a troca do OAuth falha com
  // "Authorization code is expired", e mandar renovar o token nesse momento manda
  // a pessoa procurar um token que ainda nem existe. O que ela precisa e clicar
  // em conectar de novo — o code da TikTok vale uma vez so e por pouco tempo.
  if (/invalid_grant|authorization.{0,3}code/i.test(txt)) {
    return 'o codigo de autorizacao nao vale mais — clique em "Conectar conta" de novo (ele expira em segundos e so pode ser usado uma vez)';
  }
  if (/invalid_client|client.{0,3}key|client.{0,3}secret/i.test(txt)) {
    return 'client key ou client secret errados — confira o que foi colado do app da TikTok';
  }
  if (/redirect.{0,3}uri/i.test(txt)) {
    return 'a URL de retorno nao bate com a cadastrada no app da TikTok — cole exatamente a que aparece nesta tela';
  }
  if (/expired|expire/i.test(txt)) {
    return 'credencial expirada — renove o token (o access_token do TikTok dura pouco)';
  }
  if (/invalid.{0,25}(token|sign|signature|client|app_key|secret)|(token|signature).{0,25}invalid|unauthor|revoke/i.test(txt)) {
    return 'credencial invalida ou revogada — refaça a autorização do app';
  }
  if (/scope|permission|not.{0,10}(allow|author)|forbidden/i.test(txt)) {
    return 'o app nao tem escopo/permissao pra essa chamada — confira os escopos autorizados';
  }
  if (/rate.?limit|too many|qps/i.test(txt)) {
    return 'limite de chamadas atingido — tente mais tarde';
  }
  if (/audit|unaudited|not.{0,10}audited/i.test(txt)) {
    return 'app ainda nao auditado pela TikTok — nesse estado a publicacao so sai privada';
  }
  if (status === 401 || status === 403) {
    return 'credencial invalida ou sem permissao — confira o token e os escopos';
  }
  if (status === 404) { return 'recurso nao encontrado'; }
  if (status === 429) { return 'limite de chamadas atingido — tente mais tarde'; }
  if (status >= 500) { return 'a TikTok esta com problema no lado dela'; }
  if (mensagem) { return `a TikTok recusou: ${mensagem}`; }
  return `resposta inesperada (HTTP ${status}${code != null ? `, code ${code}` : ''})`;
}

/**
 * Decide se a resposta foi sucesso e extrai os dados. É AQUI que o "HTTP 200 com
 * erro dentro" é pego — o resto do módulo só recebe {ok, dados, motivo}.
 */
export function interpretar(familia, status, corpo) {
  if (familia === 'open') {
    // O endpoint de token responde no padrão OAuth (error como string); os demais
    // respondem {error:{code,message,log_id}} com code "ok" quando deu certo.
    const e = corpo?.error;
    const code = typeof e === 'string' ? e : (e?.code ?? null);
    const msg = typeof e === 'string' ? (corpo?.error_description || '') : (e?.message || '');
    const logId = (typeof e === 'object' ? e?.log_id : corpo?.log_id) ?? null;
    const falhou = (code != null && code !== 'ok') || status >= 400;
    if (falhou) {
      return { ok: false, status, code: code ?? String(status), motivo: explicarErro('open', status, code, msg), mensagem: msg, logId, corpo };
    }
    // `data` só existe nas rotas de recurso; no token os campos vêm na raiz.
    return { ok: true, status, code: code ?? 'ok', dados: corpo?.data ?? corpo ?? null, logId };
  }

  // business e shop: envelope {code, message, data, request_id}. code 0 = sucesso.
  const code = corpo?.code;
  const msg = corpo?.message || '';
  const reqId = corpo?.request_id || null;
  const falhou = (code != null && Number(code) !== 0) || status >= 400;
  if (falhou) {
    return { ok: false, status, code: code ?? status, motivo: explicarErro(familia, status, code, msg), mensagem: msg, logId: reqId, corpo };
  }
  return { ok: true, status, code: 0, dados: corpo?.data ?? null, logId: reqId };
}

/** Deve tentar de novo? Só o que é transitório — credencial ruim não melhora repetindo. */
export function retentavel(status) {
  return status === 429 || status === 408 || status >= 500;
}

function montarUrl(url, query = {}) {
  const qs = Object.entries(query)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

/**
 * Faz UMA chamada (com retry no que é transitório) e devolve sempre {ok, ...}.
 *
 * @param {'open'|'business'|'shop'} familia
 * @param {string} caminho  rota a partir da base (ex.: '/v2/video/query/')
 * @param {object} [opts]
 * @param {string} [opts.metodo]
 * @param {object} [opts.query]
 * @param {object|string} [opts.corpo]
 * @param {string} [opts.token]      access token da família
 * @param {string} [opts.appKey]     só shop
 * @param {string} [opts.appSecret]  só shop (assina a chamada)
 * @param {string} [opts.shopCipher] só shop (identifica a loja do vendedor)
 * @param {boolean} [opts.form]      manda o corpo como x-www-form-urlencoded (OAuth)
 * @param {string} [opts.urlAbsoluta] ignora a base (endpoints de token moram fora)
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.esperar]  injetável pro teste não dormir de verdade
 */
export async function chamar(familia, caminho, opts = {}) {
  const {
    metodo = 'GET', query = {}, corpo = null, token = null,
    appKey = null, appSecret = null, shopCipher = null,
    timeoutMs = TIMEOUT_PADRAO, tentativas = 3, form = false, multipart = false, urlAbsoluta = null,
    fetchImpl = globalThis.fetch,
    esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
    agora = () => Date.now(),
  } = opts;

  if (!urlAbsoluta && !BASE[familia]) {
    return { ok: false, motivo: `familia desconhecida: "${familia}"`, status: 0, code: null };
  }

  const q = { ...query };
  const headers = { accept: 'application/json' };
  let payload = corpo;

  if (familia === 'shop' && !urlAbsoluta) {
    if (!appKey || !appSecret) {
      return { ok: false, motivo: 'falta app_key/app_secret do TikTok Shop', status: 0, code: null };
    }
    q.app_key = appKey;
    q.timestamp = Math.floor(agora() / 1000);
    if (shopCipher) { q.shop_cipher = shopCipher; }
    // A assinatura tem que ser calculada sobre o corpo EXATO que vai no fio — e
    // multipart fica de fora dela por regra da TikTok.
    payload = (corpo == null || multipart) ? corpo : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    q.sign = assinarShop({ caminho, query: q, corpo: payload, appSecret, multipart });
    if (token) { headers['x-tts-access-token'] = token; }
  } else if (familia === 'business' && token) {
    headers['Access-Token'] = token;
  } else if (familia === 'open' && token) {
    headers.authorization = `Bearer ${token}`;
  }

  let corpoFio;
  if (payload != null) {
    if (multipart) {
      // FormData monta o próprio boundary: definir content-type na mão quebra o parse.
      corpoFio = payload;
    } else if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      corpoFio = typeof payload === 'string' ? payload : new URLSearchParams(payload).toString();
    } else {
      headers['content-type'] = 'application/json';
      corpoFio = typeof payload === 'string' ? payload : JSON.stringify(payload);
    }
  }

  const url = montarUrl(urlAbsoluta || BASE[familia] + caminho, q);
  let ultima = null;

  for (let n = 1; n <= Math.max(1, tentativas); n++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: metodo, headers, body: corpoFio, signal: ctrl.signal });
      const bruto = await res.json().catch(() => null);
      const r = interpretar(familia, res.status, bruto);
      if (!r.ok && retentavel(res.status) && n < tentativas) {
        // Retry-After vem em segundos quando a TikTok se dá ao trabalho de mandar.
        const espera = Number(res.headers?.get?.('retry-after')) * 1000 || 500 * 2 ** (n - 1);
        ultima = { ...r, tentativas: n };
        await esperar(espera);
        continue;
      }
      return { ...r, familia, tentativas: n };
    } catch (e) {
      const abortou = e?.name === 'AbortError';
      ultima = {
        ok: false, familia, status: 0, code: null, tentativas: n,
        motivo: abortou ? `sem resposta em ${timeoutMs / 1000}s` : 'falha de rede: ' + (e?.message || 'desconhecida'),
      };
      if (n < tentativas) { await esperar(500 * 2 ** (n - 1)); continue; }
      return ultima;
    } finally {
      clearTimeout(t);
    }
  }
  return ultima || { ok: false, familia, status: 0, code: null, motivo: 'nenhuma tentativa executada' };
}
