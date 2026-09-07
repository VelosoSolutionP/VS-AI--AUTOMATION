/**
 * VSinfluence — métricas de desempenho. Normaliza o retorno de cada API numa forma
 * única (views / likes / dislikes / comentários / compartilhamentos).
 *
 * REGRA IMPORTANTE: métrica que a plataforma NÃO entrega vira `null`, nunca 0.
 * O YouTube removeu o dislike público da API em dez/2021 e Instagram/TikTok nem têm
 * o conceito. Gravar 0 faria o dashboard afirmar "nenhum dislike" quando a verdade é
 * "não dá pra saber" — e aí o criador toma decisão em cima de número inventado.
 */

/** Forma canônica de uma medição. */
export function medicaoVazia(rede, videoId) {
  return {
    rede, videoId,
    views: null, likes: null, dislikes: null, comentarios: null, compartilhamentos: null,
    coletadoEm: null,
  };
}

const num = (v) => {
  if (v == null || v === '') { return null; }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalizadores por rede. Cada um recebe o payload cru da API e devolve a forma
 * canônica. Campo ausente permanece null.
 */
export const NORMALIZADORES = {
  /** YouTube Data API v3 — videos.list(part=statistics). */
  youtube(payload, videoId) {
    const s = payload?.statistics || payload || {};
    return {
      views: num(s.viewCount),
      likes: num(s.likeCount),
      // dislikeCount saiu da API pública em dez/2021 — indisponível, não zero.
      dislikes: null,
      comentarios: num(s.commentCount),
      compartilhamentos: null,
      videoId: videoId ?? payload?.id ?? null,
    };
  },

  /** Instagram Graph API — media insights. */
  instagram(payload, videoId) {
    const m = payload?.insights || payload || {};
    return {
      views: num(m.video_views ?? m.plays ?? m.impressions),
      likes: num(m.like_count ?? m.likes),
      dislikes: null, // a plataforma não tem dislike
      comentarios: num(m.comments_count ?? m.comments),
      compartilhamentos: num(m.shares),
      videoId: videoId ?? payload?.id ?? null,
    };
  },

  /** TikTok Display API — video query. */
  tiktok(payload, videoId) {
    const v = payload?.data ?? payload ?? {};
    return {
      views: num(v.view_count),
      likes: num(v.like_count),
      dislikes: null,
      comentarios: num(v.comment_count),
      compartilhamentos: num(v.share_count),
      videoId: videoId ?? v.id ?? null,
    };
  },
};

/**
 * Normaliza o payload cru de uma rede.
 * @param {string} rede
 * @param {object} payload
 * @param {string} [videoId]
 * @param {string} [coletadoEm] ISO; passe explícito pra manter a função testável
 */
export function normalizar(rede, payload, videoId, coletadoEm = null) {
  const r = String(rede || '').toLowerCase();
  const fn = NORMALIZADORES[r];
  if (!fn) { return { ...medicaoVazia(r, videoId ?? null), erro: `rede sem normalizador: "${rede}"` }; }
  return { ...medicaoVazia(r, videoId ?? null), ...fn(payload, videoId), rede: r, coletadoEm };
}

/** Soma ignorando null — se TODAS forem null, o total continua null (não vira 0). */
export function somar(valores) {
  const validos = valores.filter((v) => v != null);
  return validos.length ? validos.reduce((a, b) => a + b, 0) : null;
}

/**
 * Agrega uma lista de medições. Devolve totais + o que ficou indisponível, pra o
 * dashboard poder escrever "—" em vez de "0".
 * @param {object[]} medicoes
 */
export function agregar(medicoes = []) {
  const campos = ['views', 'likes', 'dislikes', 'comentarios', 'compartilhamentos'];
  const totais = {};
  const indisponiveis = [];
  for (const c of campos) {
    totais[c] = somar(medicoes.map((m) => m[c]));
    if (totais[c] == null) { indisponiveis.push(c); }
  }
  return { totais, indisponiveis, amostras: medicoes.length };
}

/**
 * Engajamento = (likes + comentários + compartilhamentos) / views.
 * Sem views não há taxa — devolve null em vez de dividir por zero.
 */
export function engajamento(m = {}) {
  if (!m.views) { return null; }
  const interacoes = somar([m.likes, m.comentarios, m.compartilhamentos]);
  return interacoes == null ? null : Number((interacoes / m.views).toFixed(4));
}

/**
 * Compara duas medições do MESMO vídeo e devolve o delta — é o que mostra se o
 * vídeo ainda está crescendo ou já morreu.
 */
export function delta(anterior = {}, atual = {}) {
  const campos = ['views', 'likes', 'dislikes', 'comentarios', 'compartilhamentos'];
  const out = {};
  for (const c of campos) {
    out[c] = (anterior[c] == null || atual[c] == null) ? null : atual[c] - anterior[c];
  }
  return out;
}
