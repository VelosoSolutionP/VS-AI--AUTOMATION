/**
 * VSinfluence — coletor. A camada que FALTAVA: quem realmente fala com a API de cada
 * rede. Até aqui o módulo só sabia normalizar um payload que alguém entregava na mão
 * (metricas.mjs) — não existia nenhuma chamada HTTP nem credencial.
 *
 * `fetchImpl` é injetável: o teste roda sem tocar na internet, e o app passa o fetch
 * real. Erro de rede NUNCA vira exceção solta — volta como {ok:false, motivo}, porque
 * rede fora do ar não pode derrubar o painel.
 */
import { normalizar } from './metricas.mjs';

/** Credencial exigida por rede — pro painel dizer o que falta ANTES de tentar. */
export const CREDENCIAL = {
  youtube: { campos: ['apiKey'], nome: 'YouTube Data API v3', ajuda: 'chave de API do Google Cloud' },
  instagram: { campos: ['token', 'userId'], nome: 'Instagram Graph API', ajuda: 'token da página + IG user id' },
  tiktok: { campos: ['token'], nome: 'TikTok Display API', ajuda: 'access token OAuth do app TikTok' },
  facebook: { campos: ['token'], nome: 'Facebook Graph API', ajuda: 'access token da página' },
};

export const REDES_COLETAVEIS = Object.keys(CREDENCIAL);

/** O que falta preencher pra essa rede. Lista vazia = dá pra tentar. */
export function faltaCredencial(rede, cred = {}) {
  const spec = CREDENCIAL[String(rede || '').toLowerCase()];
  if (!spec) { return [`rede sem coletor: "${rede}"`]; }
  return spec.campos.filter((c) => !String(cred[c] || '').trim());
}

/** URL do teste de identidade de cada rede (a chamada mais barata que prova o acesso). */
export function urlTeste(rede, cred = {}) {
  const r = String(rede || '').toLowerCase();
  const enc = encodeURIComponent;
  if (r === 'youtube') {
    // channels?mine exige OAuth; com API key o teste honesto é uma busca simples.
    return { url: `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=@youtube&key=${enc(cred.apiKey)}` };
  }
  if (r === 'instagram') {
    return { url: `https://graph.facebook.com/v21.0/${enc(cred.userId)}?fields=id,username&access_token=${enc(cred.token)}` };
  }
  if (r === 'facebook') {
    return { url: `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${enc(cred.token)}` };
  }
  if (r === 'tiktok') {
    return {
      url: 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
      headers: { authorization: `Bearer ${cred.token}` },
    };
  }
  return { erro: `rede sem coletor: "${rede}"` };
}

/** Traduz a falha da API pra uma frase que diz O QUE fazer, não só o código. */
export function explicarFalha(rede, status, corpo) {
  const txt = typeof corpo === 'string' ? corpo : JSON.stringify(corpo || {});
  const expirou = /expired|expirou/i.test(txt);
  // A Meta responde 400 (nao 401) para token invalido, com OAuthException/code 190.
  // Sem olhar o corpo, o painel mandava conferir "id/campos" quando o problema era o token.
  // Credencial ruim vem com status e texto diferentes em cada rede: a Meta manda 400 com
  // OAuthException/190, o TikTok 401 access_token_invalid, o YouTube 400 "API key not valid".
  const credRuim = /OAuthException|access_token_invalid|"code"\s*:\s*190|invalid.{0,20}(token|key)|(token|key).{0,20}(invalid|not valid)|keyInvalid/i.test(txt);
  if (status === 401 || status === 403 || credRuim) {
    return expirou
      ? 'credencial expirada — gere outra no painel da rede'
      : 'credencial invalida ou sem permissao — confira o token/chave e os escopos';
  }
  // Escopo faltando nao e credencial errada: o token vale, o app so nao pediu a permissao.
  if (/scope_not_authorized|scope|insufficient.{0,15}permission/i.test(txt)) {
    return 'o app nao tem o escopo necessario — autorize a permissao no painel da rede';
  }
  if (status === 400) { return 'requisicao recusada — confira id/campos da conta'; }
  if (status === 404) { return 'conta ou recurso nao encontrado'; }
  if (status === 429) { return 'limite de chamadas atingido — tente mais tarde'; }
  if (status >= 500) { return 'a rede esta com problema no lado dela'; }
  return `resposta inesperada (HTTP ${status})`;
}

/**
 * Testa o acesso de UMA rede. Nunca lança: devolve sempre {ok, ...} com motivo.
 * @param {string} rede
 * @param {object} cred
 * @param {Function} [fetchImpl]
 * @param {number} [timeoutMs]
 */
export async function testarConexao(rede, cred = {}, fetchImpl = globalThis.fetch, timeoutMs = 10000) {
  const r = String(rede || '').toLowerCase();
  const falta = faltaCredencial(r, cred);
  if (falta.length) { return { ok: false, rede: r, motivo: 'falta preencher: ' + falta.join(', '), faltando: falta }; }

  const alvo = urlTeste(r, cred);
  if (alvo.erro) { return { ok: false, rede: r, motivo: alvo.erro }; }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(alvo.url, { headers: alvo.headers || {}, signal: ctrl.signal });
    const corpo = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, rede: r, status: res.status, motivo: explicarFalha(r, res.status, corpo), corpo };
    }
    // O TikTok devolve HTTP 200 com o erro dentro de `error.code` ("ok" = sucesso).
    // Sem olhar isso, token revogado passava como conexao boa e a conta vinha vazia.
    if (corpo?.error?.code && corpo.error.code !== 'ok') {
      return { ok: false, rede: r, status: res.status, motivo: explicarFalha(r, res.status, corpo), corpo };
    }
    return { ok: true, rede: r, status: res.status, conta: identificarConta(r, corpo) };
  } catch (e) {
    const abortou = e?.name === 'AbortError';
    return { ok: false, rede: r, motivo: abortou ? `sem resposta em ${timeoutMs / 1000}s` : 'falha de rede: ' + (e?.message || 'desconhecida') };
  } finally {
    clearTimeout(t);
  }
}

/** Puxa um rótulo humano da conta pra tela mostrar COM QUEM conectou. */
export function identificarConta(rede, corpo) {
  if (!corpo) { return null; }
  if (rede === 'youtube') { return corpo.items?.[0]?.id || null; }
  if (rede === 'instagram') { return corpo.username ? '@' + corpo.username : corpo.id || null; }
  if (rede === 'facebook') { return corpo.name || corpo.id || null; }
  if (rede === 'tiktok') { return corpo.data?.user?.display_name || corpo.data?.user?.open_id || null; }
  return null;
}

/**
 * URL da métrica de um vídeo. Devolve também `metodo` e `corpo` porque nem toda rede
 * consulta por GET: o `/v2/video/query/` do TikTok é POST e exige `filters.video_ids`
 * no corpo — chamado por GET ele responde, mas NUNCA com o vídeo pedido, e a métrica
 * chegava toda nula sem ninguém perceber que estava quebrado.
 */
export function urlMetrica(rede, videoId, cred = {}) {
  const r = String(rede || '').toLowerCase();
  const enc = encodeURIComponent;
  if (r === 'youtube') { return { url: `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${enc(videoId)}&key=${enc(cred.apiKey)}` }; }
  if (r === 'instagram') { return { url: `https://graph.facebook.com/v21.0/${enc(videoId)}/insights?metric=plays,likes,comments,shares&access_token=${enc(cred.token)}` }; }
  if (r === 'facebook') { return { url: `https://graph.facebook.com/v21.0/${enc(videoId)}?fields=views,likes.summary(true),comments.summary(true)&access_token=${enc(cred.token)}` }; }
  if (r === 'tiktok') {
    return {
      url: 'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count',
      metodo: 'POST',
      headers: { authorization: `Bearer ${cred.token}`, 'content-type': 'application/json' },
      corpo: { filters: { video_ids: [String(videoId)] } },
    };
  }
  return { erro: `rede sem coletor: "${rede}"` };
}

/**
 * Onde cada rede enfia os números dentro da resposta. O TikTok devolve uma LISTA em
 * `data.videos`, não o objeto na raiz — era por isso que o normalizador só via null.
 */
export function extrairBruto(rede, corpo) {
  if (rede === 'youtube') { return corpo?.items?.[0] ?? null; }
  if (rede === 'tiktok') { return corpo?.data?.videos?.[0] ?? null; }
  return corpo ?? null;
}

/**
 * Busca a métrica de um vídeo e já devolve NORMALIZADA (metricas.mjs).
 * Falha vira medição com erro — nunca número inventado.
 */
export async function coletarMetrica(rede, videoId, cred = {}, fetchImpl = globalThis.fetch, agora = () => new Date().toISOString()) {
  const r = String(rede || '').toLowerCase();
  const falta = faltaCredencial(r, cred);
  if (falta.length) { return { ok: false, rede: r, motivo: 'falta preencher: ' + falta.join(', ') }; }
  const alvo = urlMetrica(r, videoId, cred);
  if (alvo.erro) { return { ok: false, rede: r, motivo: alvo.erro }; }
  try {
    const res = await fetchImpl(alvo.url, {
      method: alvo.metodo || 'GET',
      headers: alvo.headers || {},
      body: alvo.corpo == null ? undefined : JSON.stringify(alvo.corpo),
    });
    const corpo = await res.json().catch(() => null);
    if (!res.ok) { return { ok: false, rede: r, status: res.status, motivo: explicarFalha(r, res.status, corpo) }; }
    // O TikTok responde HTTP 200 com o erro DENTRO do corpo (error.code != "ok").
    const erroNoCorpo = corpo?.error?.code && corpo.error.code !== 'ok';
    if (erroNoCorpo) {
      return { ok: false, rede: r, status: res.status, motivo: explicarFalha(r, res.status, corpo) };
    }
    const bruto = extrairBruto(r, corpo);
    if (!bruto) { return { ok: false, rede: r, status: res.status, motivo: 'a rede nao devolveu esse video (id errado ou fora da conta)' }; }
    return { ok: true, rede: r, medicao: normalizar(r, bruto, videoId, agora()) };
  } catch (e) {
    return { ok: false, rede: r, motivo: 'falha de rede: ' + (e?.message || 'desconhecida') };
  }
}
