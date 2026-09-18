/**
 * VStiktok — publicação de vídeo (Content Posting API).
 *
 * É a peça que a auditoria marcava como faltando: até aqui o módulo só LIA da TikTok.
 *
 * Dois cuidados que existem por causa de como a TikTok se comporta de verdade:
 *
 *  1) App NÃO auditado só consegue postar como SELF_ONLY (privado). Se deixássemos
 *     passar "PUBLIC_TO_EVERYONE", a API aceitaria a chamada e o vídeo subiria privado
 *     — e o criador juraria que publicou. Por isso a privacidade é conferida contra o
 *     `creator_info` ANTES do envio.
 *  2) O upload é em pedaços com regra rígida (mínimo 5 MB por pedaço, último pode ser
 *     maior, teto de 1000 pedaços). Fatiar errado dá erro genérico no fim do upload,
 *     depois de já ter gasto a banda toda.
 */
import { chamar } from './api.mjs';

export const PRIVACIDADES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

/** Regras de fatiamento do upload, como a TikTok documenta. */
export const CHUNK = {
  min: 5 * 1024 * 1024,
  max: 64 * 1024 * 1024,
  maxPedacos: 1000,
  videoMax: 4 * 1024 * 1024 * 1024,
};

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

/**
 * Dados do criador conectado: apelido, limites e — o que importa aqui — quais
 * privacidades o app pode usar hoje.
 */
export async function infoCriador(ctx = {}) {
  return req(ctx, '/v2/post/publish/creator_info/query/', { metodo: 'POST', corpo: {} });
}

/**
 * Calcula o fatiamento de um vídeo. Vídeo menor que o pedaço mínimo vai inteiro,
 * num pedaço só — que é o que a TikTok espera, e não "um pedaço de 5 MB com padding".
 */
export function fatiar(tamanhoBytes) {
  const n = Number(tamanhoBytes);
  if (!Number.isFinite(n) || n <= 0) { return { erro: 'tamanho do vídeo inválido' }; }
  if (n > CHUNK.videoMax) { return { erro: `vídeo passou de ${CHUNK.videoMax / 1024 ** 3} GB` }; }
  if (n <= CHUNK.min) { return { tamanhoPedaco: n, pedacos: 1 }; }

  let tamanhoPedaco = CHUNK.min;
  // Com muitos pedaços a TikTok recusa; sobe o pedaço até caber no teto de 1000.
  while (Math.floor(n / tamanhoPedaco) > CHUNK.maxPedacos && tamanhoPedaco < CHUNK.max) {
    tamanhoPedaco = Math.min(tamanhoPedaco * 2, CHUNK.max);
  }
  const pedacos = Math.floor(n / tamanhoPedaco);
  if (pedacos > CHUNK.maxPedacos) { return { erro: 'vídeo grande demais pro limite de pedaços da TikTok' }; }
  // O último pedaço ABSORVE a sobra (a TikTok não aceita um pedaço final menor que o mínimo).
  return { tamanhoPedaco, pedacos };
}

/**
 * Valida a publicação contra o que o criador realmente pode fazer agora.
 * @param {object} post  {titulo, privacidade, desabilitarComentario, ...}
 * @param {object} info  data do `infoCriador`
 */
export function validarPost(post = {}, info = null) {
  const erros = [];
  const avisos = [];

  const titulo = txt(post.titulo);
  if (!titulo) { erros.push('título é obrigatório'); }
  if (titulo.length > 2200) { erros.push(`título passou de 2200 caracteres (tem ${titulo.length})`); }

  const privacidade = txt(post.privacidade).toUpperCase();
  if (!PRIVACIDADES.includes(privacidade)) {
    erros.push(`privacidade inválida: "${post.privacidade}" (use ${PRIVACIDADES.join(', ')})`);
  }

  if (info) {
    const permitidas = info.privacy_level_options || [];
    if (permitidas.length && privacidade && !permitidas.includes(privacidade)) {
      erros.push(
        `esta conta não pode publicar como ${privacidade} agora (permitidas: ${permitidas.join(', ')}). `
        + 'App não auditado pela TikTok só posta como SELF_ONLY',
      );
    }
    if (permitidas.length === 1 && permitidas[0] === 'SELF_ONLY') {
      avisos.push('o app ainda não foi auditado: o vídeo vai subir PRIVADO, visível só pra você');
    }
    if (post.duracaoSeg && info.max_video_post_duration_sec && post.duracaoSeg > info.max_video_post_duration_sec) {
      erros.push(`vídeo de ${post.duracaoSeg}s passa do limite da conta (${info.max_video_post_duration_sec}s)`);
    }
    // Quem já tem a interação bloqueada no perfil não pode "liberar" pelo post.
    if (info.comment_disabled && post.desabilitarComentario === false) {
      avisos.push('a conta tem comentário desativado no perfil — o post não consegue reativar');
    }
  }

  if (erros.length) { return { post: null, erros, avisos }; }

  return {
    post: {
      title: titulo,
      privacy_level: privacidade,
      disable_comment: Boolean(post.desabilitarComentario),
      disable_duet: Boolean(post.desabilitarDueto),
      disable_stitch: Boolean(post.desabilitarStitch),
      ...(post.capaMs != null ? { video_cover_timestamp_ms: Number(post.capaMs) } : {}),
    },
    erros: [],
    avisos,
  };
}

/**
 * Publica a partir de uma URL pública (PULL_FROM_URL). É o caminho mais simples, mas
 * exige que o domínio esteja verificado no painel do app — senão a TikTok recusa.
 */
export async function publicarPorUrl(ctx = {}, dados = {}) {
  const info = ctx.infoCriador ?? (await infoCriador(ctx)).dados;
  const { post, erros, avisos } = validarPost(dados, info);
  if (erros.length) { return { ok: false, motivo: erros.join('; '), erros, avisos }; }
  const url = txt(dados.videoUrl);
  if (!/^https:\/\//i.test(url)) { return { ok: false, motivo: 'videoUrl precisa ser https e de domínio verificado no app' }; }

  const r = await req(ctx, '/v2/post/publish/video/init/', {
    metodo: 'POST',
    corpo: { post_info: post, source_info: { source: 'PULL_FROM_URL', video_url: url } },
  });
  if (!r.ok) { return { ...r, avisos }; }
  return { ok: true, publishId: r.dados?.publish_id || null, avisos, dados: r.dados };
}

/**
 * Publica um arquivo local: init + envio dos pedaços.
 * @param {object} ctx
 * @param {object} dados  {titulo, privacidade, bytes|caminho}
 */
export async function publicarArquivo(ctx = {}, dados = {}) {
  let bytes = dados.bytes;
  if (!bytes && txt(dados.caminho)) {
    try {
      const { readFileSync } = await import('node:fs');
      bytes = readFileSync(dados.caminho);
    } catch (e) {
      return { ok: false, motivo: `não consegui ler o arquivo: ${e.message}` };
    }
  }
  if (!bytes?.length) { return { ok: false, motivo: 'informe `bytes` ou `caminho` do vídeo' }; }

  const corte = fatiar(bytes.length);
  if (corte.erro) { return { ok: false, motivo: corte.erro }; }

  const info = ctx.infoCriador ?? (await infoCriador(ctx)).dados;
  const { post, erros, avisos } = validarPost(dados, info);
  if (erros.length) { return { ok: false, motivo: erros.join('; '), erros, avisos }; }

  const init = await req(ctx, '/v2/post/publish/video/init/', {
    metodo: 'POST',
    corpo: {
      post_info: post,
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: bytes.length,
        chunk_size: corte.tamanhoPedaco,
        total_chunk_count: corte.pedacos,
      },
    },
  });
  if (!init.ok) { return { ...init, avisos }; }

  const envio = await enviarPedacos(init.dados?.upload_url, bytes, corte, ctx);
  if (!envio.ok) { return { ...envio, publishId: init.dados?.publish_id || null, avisos }; }

  return { ok: true, publishId: init.dados?.publish_id || null, pedacos: corte.pedacos, avisos };
}

/**
 * Sobe os pedaços no upload_url. Não passa por `chamar()` de propósito: esse endpoint
 * é armazenamento cru, sem envelope `error` — quem vale aqui é o status HTTP.
 */
export async function enviarPedacos(uploadUrl, bytes, corte, ctx = {}) {
  if (!uploadUrl) { return { ok: false, motivo: 'a TikTok nao devolveu upload_url' }; }
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  const total = bytes.length;

  for (let i = 0; i < corte.pedacos; i++) {
    const inicio = i * corte.tamanhoPedaco;
    // O último pedaço leva a sobra: a TikTok recusa pedaço final abaixo do mínimo.
    const fim = i === corte.pedacos - 1 ? total : inicio + corte.tamanhoPedaco;
    const pedaco = bytes.subarray(inicio, fim);
    try {
      const res = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(pedaco.length),
          'content-range': `bytes ${inicio}-${fim - 1}/${total}`,
        },
        body: pedaco,
      });
      if (res.status >= 400) {
        return { ok: false, motivo: `falha ao enviar o pedaço ${i + 1}/${corte.pedacos} (HTTP ${res.status})`, pedaco: i + 1 };
      }
    } catch (e) {
      return { ok: false, motivo: `falha de rede no pedaço ${i + 1}/${corte.pedacos}: ${e.message || 'desconhecida'}`, pedaco: i + 1 };
    }
  }
  return { ok: true, pedacos: corte.pedacos };
}

/** Situação da publicação. `publish_id` é o que o init devolveu. */
export async function status(ctx = {}, publishId) {
  if (!txt(publishId)) { return { ok: false, motivo: 'publishId é obrigatório' }; }
  return req(ctx, '/v2/post/publish/status/fetch/', { metodo: 'POST', corpo: { publish_id: publishId } });
}

/** Estados finais — depois deles não adianta continuar perguntando. */
const FINAIS = ['PUBLISH_COMPLETE', 'FAILED'];

/**
 * Espera a publicação terminar. Precisa existir porque o init só ENFILEIRA: o vídeo
 * ainda passa por processamento e pode falhar depois de a chamada ter dado ok.
 */
export async function aguardarPublicacao(ctx = {}, publishId, opts = {}) {
  const tentativas = opts.tentativas || 20;
  const intervalo = opts.intervaloMs || 3000;
  const esperar = ctx.esperar || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let ultima = null;

  for (let i = 0; i < tentativas; i++) {
    const r = await status(ctx, publishId);
    if (!r.ok) { return r; }
    ultima = r.dados?.status || null;
    if (FINAIS.includes(ultima)) {
      return {
        ok: ultima === 'PUBLISH_COMPLETE',
        status: ultima,
        publishId,
        motivo: ultima === 'FAILED' ? `a TikTok recusou no processamento: ${r.dados?.fail_reason || 'sem motivo informado'}` : undefined,
        dados: r.dados,
      };
    }
    if (i < tentativas - 1) { await esperar(intervalo); }
  }
  return { ok: false, status: ultima, publishId, motivo: `ainda em "${ultima}" depois de ${tentativas} consultas — consulte de novo mais tarde` };
}
