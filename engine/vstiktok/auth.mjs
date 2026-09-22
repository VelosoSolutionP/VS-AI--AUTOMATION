/**
 * VStiktok — autorização (OAuth) das três famílias.
 *
 * Por que isso é módulo próprio: o access_token do Login Kit dura ~24h e o do Shop
 * ~7 dias. Colar token na mão, como estava antes, significa que a integração para de
 * funcionar sozinha no dia seguinte e ninguém sabe por quê. Aqui o token é guardado
 * COM a hora em que expira e renovado antes de vencer.
 *
 * Nenhuma função lança: erro de credencial volta em {ok:false, motivo}.
 */
import { chamar, AUTH } from './api.mjs';

/** Escopos do Login Kit que o módulo usa (o app precisa tê-los aprovados). */
export const ESCOPOS = {
  perfil: 'user.info.basic',
  perfilCompleto: 'user.info.profile',
  estatisticas: 'user.info.stats',
  listarVideos: 'video.list',
  publicar: 'video.publish',
  enviar: 'video.upload',
};

export const ESCOPOS_PADRAO = [ESCOPOS.perfil, ESCOPOS.estatisticas, ESCOPOS.listarVideos];

/** Margem pra renovar antes de vencer — token que expira no meio da chamada é falha silenciosa. */
export const MARGEM_RENOVACAO_SEG = 300;

/** Credencial exigida por família — o painel usa pra dizer o que falta ANTES de tentar. */
export const CREDENCIAL = {
  open: {
    campos: ['clientKey', 'clientSecret'],
    nome: 'TikTok Login Kit / Display API',
    ajuda: 'client key e client secret do app em developers.tiktok.com',
  },
  business: {
    campos: ['appId', 'secret'],
    nome: 'TikTok Business (Ads) API',
    ajuda: 'app id e secret do app em business-api.tiktok.com',
  },
  shop: {
    /* `serviceId` entra na lista de OBRIGATORIOS porque sem ele nao existe URL
       de autorizacao — o botao "Conectar" apareceria e quebraria no clique. Um
       revisor de marketplace que clica e recebe erro reprova na hora, e com
       razao: do lado dele, a integracao nao funciona. */
    campos: ['appKey', 'appSecret', 'serviceId'],
    nome: 'TikTok Shop Partner API',
    ajuda: 'app key e app secret do app em partner.tiktokshop.com',
  },
};

/** O que falta preencher. Lista vazia = dá pra tentar. */
export function faltaCredencial(familia, cred = {}) {
  const spec = CREDENCIAL[familia];
  if (!spec) { return [`familia sem suporte: "${familia}"`]; }
  return spec.campos.filter((c) => !String(cred[c] || '').trim());
}

const enc = encodeURIComponent;

/**
 * URL da tela de consentimento do Login Kit.
 * `state` é obrigatório de propósito: sem ele o callback não tem como provar que a
 * volta é da mesma sessão que começou (CSRF).
 */
export function urlAutorizacao({ clientKey, redirectUri, escopos = ESCOPOS_PADRAO, state }) {
  const erros = [];
  if (!clientKey) { erros.push('clientKey é obrigatório'); }
  if (!redirectUri) { erros.push('redirectUri é obrigatório'); }
  if (!/^https:\/\//i.test(String(redirectUri || ''))) { erros.push('a TikTok só aceita redirectUri em https'); }
  if (!state) { erros.push('state é obrigatório (protege o callback contra CSRF)'); }
  if (!escopos.length) { erros.push('informe ao menos um escopo'); }
  if (erros.length) { return { erros }; }
  const url = `${AUTH.openAutorizar}?client_key=${enc(clientKey)}&scope=${enc(escopos.join(','))}`
    + `&response_type=code&redirect_uri=${enc(redirectUri)}&state=${enc(state)}`;
  return { url, erros: [] };
}

/** Tela de consentimento do Business (Ads). Aqui o parâmetro é app_id, não client_key. */
export function urlAutorizacaoBusiness({ appId, redirectUri, state }) {
  const erros = [];
  if (!appId) { erros.push('appId é obrigatório'); }
  if (!state) { erros.push('state é obrigatório (protege o callback contra CSRF)'); }
  if (erros.length) { return { erros }; }
  const url = `${AUTH.businessAutorizar}?app_id=${enc(appId)}&state=${enc(state)}`
    + (redirectUri ? `&redirect_uri=${enc(redirectUri)}` : '');
  return { url, erros: [] };
}

/** Tela de consentimento do Shop. O service_id sai do painel do app, não é o app_key. */
export function urlAutorizacaoShop({ serviceId, state }) {
  const erros = [];
  if (!serviceId) { erros.push('serviceId é obrigatório (está no painel do app do Shop)'); }
  if (!state) { erros.push('state é obrigatório (protege o callback contra CSRF)'); }
  if (erros.length) { return { erros }; }
  return { url: `${AUTH.shopAutorizar}?service_id=${enc(serviceId)}&state=${enc(state)}`, erros: [] };
}

/** Quando o token vence, em ISO. `expiresIn` vem em segundos. */
function vencimento(expiresIn, agora) {
  const seg = Number(expiresIn);
  if (!Number.isFinite(seg) || seg <= 0) { return null; }
  return new Date(agora + seg * 1000).toISOString();
}

/**
 * Troca o `code` do callback por token.
 * @param {'open'|'business'|'shop'} familia
 */
export async function trocarCodigo(familia, cred = {}, code, opts = {}) {
  const falta = faltaCredencial(familia, cred);
  if (falta.length) { return { ok: false, motivo: 'falta preencher: ' + falta.join(', '), faltando: falta }; }
  if (!String(code || '').trim()) { return { ok: false, motivo: 'code do callback ausente' }; }
  const agora = (opts.agora || (() => Date.now()))();

  if (familia === 'open') {
    if (!cred.redirectUri) { return { ok: false, motivo: 'redirectUri é obrigatório e tem que ser o MESMO usado na autorização' }; }
    const r = await chamar('open', '', {
      ...opts,
      urlAbsoluta: AUTH.openToken,
      metodo: 'POST',
      form: true,
      corpo: {
        client_key: cred.clientKey,
        client_secret: cred.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: cred.redirectUri,
      },
    });
    if (!r.ok) { return r; }
    return { ok: true, token: normalizarTokenOpen(r.dados, agora) };
  }

  if (familia === 'business') {
    const r = await chamar('business', '', {
      ...opts,
      urlAbsoluta: AUTH.businessToken,
      metodo: 'POST',
      corpo: { app_id: cred.appId, secret: cred.secret, auth_code: code, grant_type: 'auth_code' },
    });
    if (!r.ok) { return r; }
    const d = r.dados || {};
    return {
      ok: true,
      token: {
        familia: 'business',
        accessToken: d.access_token || null,
        // O token de Ads é de longa duração e a API não devolve prazo — marcar
        // "expira nunca" seria chute; null significa "não sei", e aí não renovamos à toa.
        expiraEm: null,
        refreshToken: null,
        escopo: d.scope || null,
        anunciantes: d.advertiser_ids || [],
        obtidoEm: new Date(agora).toISOString(),
      },
    };
  }

  if (familia === 'shop') {
    const r = await chamar('shop', '', {
      ...opts,
      urlAbsoluta: AUTH.shopToken,
      metodo: 'GET',
      query: {
        app_key: cred.appKey,
        app_secret: cred.appSecret,
        auth_code: code,
        grant_type: 'authorized_code',
      },
    });
    if (!r.ok) { return r; }
    return { ok: true, token: normalizarTokenShop(r.dados, agora) };
  }

  return { ok: false, motivo: `familia sem suporte: "${familia}"` };
}

/** Normaliza o token do Login Kit (campos vêm na raiz, não em `data`). */
export function normalizarTokenOpen(d = {}, agora = Date.now()) {
  return {
    familia: 'open',
    accessToken: d.access_token || null,
    refreshToken: d.refresh_token || null,
    expiraEm: vencimento(d.expires_in, agora),
    refreshExpiraEm: vencimento(d.refresh_expires_in, agora),
    openId: d.open_id || null,
    escopo: d.scope || null,
    obtidoEm: new Date(agora).toISOString(),
  };
}

/** Normaliza o token do Shop (o prazo vem como epoch em segundos, não como duração). */
export function normalizarTokenShop(d = {}, agora = Date.now()) {
  const epoch = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? new Date(Number(v) * 1000).toISOString() : null);
  return {
    familia: 'shop',
    accessToken: d.access_token || null,
    refreshToken: d.refresh_token || null,
    expiraEm: epoch(d.access_token_expire_in),
    refreshExpiraEm: epoch(d.refresh_token_expire_in),
    sellerName: d.seller_name || null,
    obtidoEm: new Date(agora).toISOString(),
  };
}

/**
 * O token está vencido (ou perto disso)?
 * `expiraEm: null` = prazo desconhecido → devolve false, porque renovar um token que
 * talvez não expire gastaria o refresh à toa.
 */
export function expirado(token = {}, agora = Date.now(), margemSeg = MARGEM_RENOVACAO_SEG) {
  if (!token.expiraEm) { return false; }
  return new Date(token.expiraEm).getTime() - margemSeg * 1000 <= agora;
}

/** Renova pelo refresh_token. Business não tem refresh — exige nova autorização. */
export async function renovar(familia, cred = {}, token = {}, opts = {}) {
  const agora = (opts.agora || (() => Date.now()))();
  if (!token.refreshToken) {
    return {
      ok: false,
      motivo: familia === 'business'
        ? 'o token de Ads nao tem refresh — refaça a autorizacao do app'
        : 'sem refresh_token guardado — refaça a autorizacao do app',
      reautorizar: true,
    };
  }
  if (token.refreshExpiraEm && new Date(token.refreshExpiraEm).getTime() <= agora) {
    return { ok: false, motivo: 'o refresh_token tambem venceu — refaça a autorizacao do app', reautorizar: true };
  }

  if (familia === 'open') {
    const r = await chamar('open', '', {
      ...opts,
      urlAbsoluta: AUTH.openToken,
      metodo: 'POST',
      form: true,
      corpo: {
        client_key: cred.clientKey,
        client_secret: cred.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      },
    });
    if (!r.ok) { return r; }
    return { ok: true, token: normalizarTokenOpen(r.dados, agora) };
  }

  if (familia === 'shop') {
    const r = await chamar('shop', '', {
      ...opts,
      urlAbsoluta: AUTH.shopRenovar,
      metodo: 'GET',
      query: {
        app_key: cred.appKey,
        app_secret: cred.appSecret,
        refresh_token: token.refreshToken,
        grant_type: 'refresh_token',
      },
    });
    if (!r.ok) { return r; }
    return { ok: true, token: normalizarTokenShop(r.dados, agora) };
  }

  return { ok: false, motivo: `familia sem renovacao: "${familia}"`, reautorizar: true };
}

/**
 * Devolve um token válido, renovando se estiver perto de vencer. É o que todo
 * chamador deve usar — ninguém no módulo pega `token.accessToken` direto.
 * @returns {{ok:boolean, token?:object, renovado?:boolean, motivo?:string}}
 */
export async function garantirToken(familia, cred = {}, token = {}, opts = {}) {
  const agora = (opts.agora || (() => Date.now()))();
  if (!token?.accessToken) { return { ok: false, motivo: 'nenhum token guardado — autorize o app primeiro', reautorizar: true }; }
  if (!expirado(token, agora, opts.margemSeg ?? MARGEM_RENOVACAO_SEG)) {
    return { ok: true, token, renovado: false };
  }
  const r = await renovar(familia, cred, token, opts);
  if (!r.ok) { return r; }
  return { ok: true, token: r.token, renovado: true };
}
