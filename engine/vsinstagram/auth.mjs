/**
 * Autorização do Instagram (Login do Facebook → token de página → IG Business).
 *
 * A cadeia é longa e cada elo tem um jeito próprio de falhar. Traduzir cada
 * falha importa mais do que parece: a mensagem crua da Meta manda "olhar a
 * documentação", e quem está do outro lado é o dono de uma loja, não um
 * desenvolvedor.
 *
 * Nada aqui toca a rede por conta própria: `fetchImpl` é injetado, como no
 * resto do repositório.
 */

export const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Permissões mínimas. Pedir a mais atrasa a revisão do app e assusta o cliente
 * na tela de consentimento — ele lê "gerenciar sua página" e desiste.
 */
export const ESCOPOS = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
];

/** Dias antes do vencimento em que o token já é tratado como problema. */
export const DIAS_AVISO = 7;

export function urlAutorizacao({ appId, redirect, estado }) {
  if (!appId) { return { erro: 'falta o ID do aplicativo Meta' }; }
  if (!redirect) { return { erro: 'falta a URL de retorno (redirect URI)' }; }
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    scope: ESCOPOS.join(','),
    response_type: 'code',
    /* `state` não é enfeite: sem ele, qualquer um pode induzir o dono a
       autorizar uma conta que não é dele. */
    state: estado || '',
  });
  return { url: `https://www.facebook.com/v21.0/dialog/oauth?${q}` };
}

/** Frase útil a partir do erro cru da Meta. */
export function explicar(status, corpo) {
  const txt = typeof corpo === 'string' ? corpo : JSON.stringify(corpo || {});
  const m = (corpo && corpo.error) || {};
  if (status === 401 || /OAuthException|token.*(expired|invalid)|Session has expired/i.test(txt)) {
    return 'o token da Meta expirou ou foi revogado — é preciso autorizar de novo';
  }
  if (/\(#10\)|requires.*permission|not been granted/i.test(txt)) {
    return `falta permissão no app Meta: ${m.message || 'o app não tem o escopo necessário'}`;
  }
  if (/\(#100\).*instagram|media_type|IG.*not.*(business|professional)/i.test(txt)) {
    return 'a conta do Instagram precisa ser Comercial ou de Criador de conteúdo, vinculada a uma Página do Facebook';
  }
  if (status === 429 || /rate limit|too many/i.test(txt)) {
    return 'a Meta limitou as chamadas por agora — espere alguns minutos';
  }
  if (status >= 500) { return 'a Meta está com problema no servidor dela — vale tentar de novo'; }
  return m.message || `a Meta recusou (HTTP ${status})`;
}

async function chamar(url, { fetchImpl = fetch, metodo = 'GET', corpo, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: metodo,
      ...(corpo ? { body: new URLSearchParams(corpo) } : {}),
      signal: ctrl.signal,
    });
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) { return { ok: false, status: res.status, motivo: explicar(res.status, dados), corpo: dados }; }
    return { ok: true, dados };
  } catch (e) {
    const abortou = e?.name === 'AbortError';
    return { ok: false, motivo: abortou ? `a Meta não respondeu em ${timeoutMs / 1000}s` : `falha de rede: ${e.message}` };
  } finally { clearTimeout(t); }
}

/**
 * Código → token de LONGA duração, em um passo só para quem chama.
 *
 * O token curto vale ~1h: guardar ele seria integração que morre no mesmo dia,
 * e o cliente descobriria quando a publicação falhasse. Por isso a troca pelo
 * longo acontece aqui, e não "depois".
 */
export async function trocarCodigo({ appId, appSecret, redirect, code }, opts = {}) {
  const q = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirect, code });
  const curto = await chamar(`${GRAPH}/oauth/access_token?${q}`, opts);
  if (!curto.ok) { return curto; }

  const q2 = new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret,
    fb_exchange_token: curto.dados.access_token,
  });
  const longo = await chamar(`${GRAPH}/oauth/access_token?${q2}`, opts);
  if (!longo.ok) { return longo; }

  const segundos = Number(longo.dados.expires_in || 0) || 60 * 24 * 3600;
  return {
    ok: true,
    token: longo.dados.access_token,
    expiraEm: new Date(Date.now() + segundos * 1000).toISOString(),
  };
}

/**
 * Do token do usuário até a conta do Instagram, passando pela Página.
 *
 * Três coisas podem não existir, e cada uma tem conserto diferente: não há
 * Página, a Página não tem Instagram vinculado, ou o Instagram não é
 * Comercial. Devolver "não deu" para os três seria empurrar o cliente para o
 * suporte sem pista nenhuma.
 */
export async function descobrirConta({ token }, opts = {}) {
  const paginas = await chamar(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(token)}`, opts);
  if (!paginas.ok) { return paginas; }

  const lista = paginas.dados.data || [];
  if (!lista.length) {
    return { ok: false, motivo: 'esta conta do Facebook não administra nenhuma Página — o Instagram comercial precisa estar vinculado a uma Página' };
  }

  const semIg = [];
  for (const pag of lista) {
    const r = await chamar(`${GRAPH}/${pag.id}?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(pag.access_token)}`, opts);
    const ig = r.ok ? r.dados.instagram_business_account : null;
    if (ig?.id) {
      return {
        ok: true,
        conta: {
          igId: ig.id,
          usuario: ig.username || null,
          nome: ig.name || pag.name,
          foto: ig.profile_picture_url || null,
          paginaId: pag.id,
          paginaNome: pag.name,
          /* O token que PUBLICA é o da Página, não o do usuário. Guardar o
             errado dá erro só na hora de postar — tarde demais. */
          tokenPagina: pag.access_token,
        },
      };
    }
    semIg.push(pag.name);
  }

  return {
    ok: false,
    motivo: `nenhuma das Páginas (${semIg.join(', ')}) tem um Instagram Comercial vinculado`,
    comoResolver: 'No app do Instagram: Configurações → Conta → mudar para Comercial, e vincular à Página do Facebook.',
  };
}

/** Quanto falta para o token virar abóbora. */
export function saudeDoToken(expiraEm, agora = Date.now()) {
  if (!expiraEm) { return { ok: false, motivo: 'sem data de validade guardada — autorize de novo' }; }
  const dias = Math.floor((new Date(expiraEm).getTime() - agora) / 86400000);
  if (dias < 0) { return { ok: false, vencido: true, dias, motivo: `o token venceu há ${Math.abs(dias)} dia(s) — autorize de novo` }; }
  if (dias <= DIAS_AVISO) {
    return { ok: true, alerta: true, dias, motivo: `o token vence em ${dias} dia(s) — renove antes que as publicações parem` };
  }
  return { ok: true, dias };
}

/**
 * Renova o token longo antes de vencer.
 *
 * A Meta não renova sozinha, e token vencido não avisa: a publicação
 * simplesmente falha no dia da campanha. Renovar cedo é barato; descobrir
 * tarde, não.
 */
export async function renovar({ appId, appSecret, token }, opts = {}) {
  const q = new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token,
  });
  const r = await chamar(`${GRAPH}/oauth/access_token?${q}`, opts);
  if (!r.ok) { return r; }
  const segundos = Number(r.dados.expires_in || 0) || 60 * 24 * 3600;
  return { ok: true, token: r.dados.access_token, expiraEm: new Date(Date.now() + segundos * 1000).toISOString() };
}

export { chamar };
