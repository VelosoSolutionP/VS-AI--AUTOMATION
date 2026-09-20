/**
 * VStiktok — leitura de perfil e desempenho de vídeo (Display API v2).
 *
 * Aqui mora a correção do furo que a integração antiga tinha: `/v2/video/query/` é
 * POST e exige `{"filters":{"video_ids":[...]}}` no corpo. Chamando por GET sem corpo
 * a TikTok responde, mas nunca com o vídeo pedido — e a métrica chegava toda nula sem
 * ninguém perceber que estava quebrado.
 *
 * A resposta também não é o que o normalizador esperava: os números vêm em
 * `data.videos[]`, não na raiz de `data`.
 */
import { chamar } from './api.mjs';
import { normalizar } from '../vsinfluence/metricas.mjs';

/** Campos de vídeo que o módulo pede. Pedir só o necessário é o que a TikTok recomenda. */
export const CAMPOS_VIDEO = [
  'id', 'title', 'create_time', 'cover_image_url', 'share_url',
  'view_count', 'like_count', 'comment_count', 'share_count',
];

export const CAMPOS_PERFIL = ['open_id', 'union_id', 'display_name', 'avatar_url', 'follower_count', 'following_count', 'likes_count', 'video_count'];

/**
 * Quais campos cada escopo libera. Pedir um campo fora do escopo concedido faz a
 * TikTok RECUSAR a chamada inteira — não é que ela devolva o campo vazio. Ou
 * seja: pedir seguidores com só `user.info.basic` derruba até o nome.
 *
 * Referência: docs da Display API, /v2/user/info/.
 */
export const CAMPOS_POR_ESCOPO = {
  'user.info.basic': ['open_id', 'union_id', 'display_name', 'avatar_url'],
  'user.info.profile': ['profile_deep_link', 'bio_description', 'is_verified', 'username'],
  'user.info.stats': ['follower_count', 'following_count', 'likes_count', 'video_count'],
};

/** Campos permitidos por um escopo concedido ("a,b,c" ou lista). */
export function camposPermitidos(escopo) {
  const lista = Array.isArray(escopo) ? escopo : String(escopo || '').split(',').map((e) => e.trim());
  const campos = lista.flatMap((e) => CAMPOS_POR_ESCOPO[e] || []);
  // Sem escopo conhecido, o basico: e o unico que o Login Kit concede sozinho.
  return campos.length ? [...new Set(campos)] : CAMPOS_POR_ESCOPO['user.info.basic'];
}

const txt = (v) => String(v ?? '').trim();

function req(ctx = {}, caminho, extra = {}) {
  return chamar('open', caminho, {
    token: ctx.token,
    fetchImpl: ctx.fetchImpl,
    esperar: ctx.esperar,
    agora: ctx.agora,
    timeoutMs: ctx.timeoutMs,
    tentativas: ctx.tentativas,
    ...extra,
  });
}

/** Perfil do criador conectado (serve de teste de conexão também). */
export async function perfil(ctx = {}, campos = null) {
  // Sem lista explicita, pede exatamente o que o token concedeu.
  campos = campos || camposPermitidos(ctx.escopo);
  const r = await req(ctx, '/v2/user/info/', { metodo: 'GET', query: { fields: campos.join(',') } });
  if (!r.ok) { return r; }
  const u = r.dados?.user || {};
  return {
    ok: true,
    conta: u.display_name || u.open_id || null,
    perfil: {
      openId: u.open_id ?? null,
      nome: u.display_name ?? null,
      avatar: u.avatar_url ?? null,
      seguidores: u.follower_count ?? null,
      seguindo: u.following_count ?? null,
      curtidas: u.likes_count ?? null,
      videos: u.video_count ?? null,
    },
  };
}

/**
 * Lista os vídeos do criador, paginado por cursor.
 * @param {object} ctx
 * @param {{cursor?:number, quantidade?:number}} opts
 */
export async function listarVideos(ctx = {}, opts = {}) {
  const corpo = { max_count: Math.min(Math.max(Number(opts.quantidade) || 20, 1), 20) };
  if (opts.cursor != null) { corpo.cursor = Number(opts.cursor); }
  const r = await req(ctx, '/v2/video/list/', {
    metodo: 'POST',
    query: { fields: (opts.campos || CAMPOS_VIDEO).join(',') },
    corpo,
  });
  if (!r.ok) { return r; }
  return {
    ok: true,
    videos: r.dados?.videos || [],
    cursor: r.dados?.cursor ?? null,
    temMais: Boolean(r.dados?.has_more),
  };
}

/**
 * Métrica de vídeos específicos — POST com `filters.video_ids`, como a API exige.
 * @param {object} ctx
 * @param {string[]} videoIds  até 20 por chamada (limite da TikTok)
 */
export async function consultarVideos(ctx = {}, videoIds = [], opts = {}) {
  const ids = (Array.isArray(videoIds) ? videoIds : [videoIds]).map(txt).filter(Boolean);
  if (!ids.length) { return { ok: false, motivo: 'informe ao menos um videoId' }; }
  if (ids.length > 20) { return { ok: false, motivo: `a TikTok aceita no máximo 20 ids por chamada (vieram ${ids.length})` }; }

  const r = await req(ctx, '/v2/video/query/', {
    metodo: 'POST',
    query: { fields: (opts.campos || CAMPOS_VIDEO).join(',') },
    corpo: { filters: { video_ids: ids } },
  });
  if (!r.ok) { return r; }
  return { ok: true, videos: r.dados?.videos || [] };
}

/**
 * Métrica de vídeos já na forma canônica da suíte (views/likes/comentários/…).
 * O que a TikTok não devolveu fica `null` — nunca 0.
 */
export async function coletarMetricas(ctx = {}, videoIds = [], opts = {}) {
  const r = await consultarVideos(ctx, videoIds, opts);
  if (!r.ok) { return r; }
  const agora = (opts.agora || (() => new Date().toISOString()))();
  const medicoes = r.videos.map((v) => normalizar('tiktok', v, v.id, agora));
  const pedidos = (Array.isArray(videoIds) ? videoIds : [videoIds]).map(txt).filter(Boolean);
  // A TikTok simplesmente OMITE o id que não existe/não é do criador, em vez de avisar.
  const ausentes = pedidos.filter((id) => !r.videos.some((v) => String(v.id) === id));
  return { ok: true, medicoes, ausentes };
}
