/**
 * VStiktok — orquestrador. Junta credencial + token + store e entrega um `ctx` pronto
 * pros módulos de produto, campanha, conteúdo e métrica.
 *
 * Regra da casa: ninguém fora daqui pega `token.accessToken` na mão. Todo acesso passa
 * por `contexto()`, que renova o token quando está perto de vencer e REGRAVA o novo.
 * Sem isso a integração funciona no dia da configuração e morre calada no dia seguinte.
 *
 * As funções de decisão vivem nos módulos puros; aqui só tem I/O e composição.
 */
import { load, save, mascarar } from './store.mjs';
import * as auth from './auth.mjs';
import * as produtos from './produtos.mjs';
import * as campanhas from './campanhas.mjs';
import * as conteudo from './conteudo.mjs';
import * as metricas from './metricas.mjs';
import * as ponte from './ponte.mjs';

const CREDENCIAIS = 'credenciais';
const TOKENS = 'tokens';
const CONFIG = 'config';
/* Mapa SKU -> id do produto na loja. Mora junto dos tokens porque e estado da
   INTEGRACAO, nao do catalogo: o estoque nao tem por que saber que existe
   TikTok. */
const PUBLICADOS = 'publicados';
/* Ultima sincronizacao com a loja: quando, se deu certo e quantos itens vieram.
   Um revisor de marketplace precisa ver PROVA de chamada real — e prova sem
   carimbo de hora e so uma tela bonita. */
const SINCRONIA = 'sincronizacao';

export { produtos, campanhas, conteudo, metricas, auth, ponte };

/* ---------------- credenciais do app ---------------- */

export function getCredenciais() {
  return load(CREDENCIAIS, {});
}

/**
 * Guarda a credencial do app de uma família. Não valida contra a TikTok aqui —
 * quem prova que a credencial serve é a autorização.
 */
export function salvarCredencial(familia, cred = {}) {
  if (!auth.CREDENCIAL[familia]) { return { ok: false, erros: [`familia sem suporte: "${familia}"`] }; }
  const atual = getCredenciais();
  const nova = { ...(atual[familia] || {}), ...cred };
  /* GRAVA o que veio, mesmo incompleto, e diz o que ainda falta. Recusar o
     parcial fazia quem tinha duas das tres chaves perder as duas ao salvar — e
     essas chaves vem de telas diferentes do painel da TikTok, entao chegar em
     partes e o normal, nao a excecao.

     O que impede de autorizar cedo demais nao e esta gravacao: e
     `faltaCredencial`, conferido de novo na hora de montar a URL. */
  save(CREDENCIAIS, { ...atual, [familia]: nova });
  const falta = auth.faltaCredencial(familia, nova);
  return { ok: true, familia, campos: Object.keys(nova), faltando: falta, completo: falta.length === 0 };
}

export function getTokens() {
  return load(TOKENS, {});
}

export function getConfig() {
  return load(CONFIG, {});
}

/** Guarda escolhas que o resto do módulo precisa (loja ativa, conta de anúncio ativa). */
export function salvarConfig(mudancas = {}) {
  const novo = { ...getConfig(), ...mudancas };
  save(CONFIG, novo);
  return novo;
}

/* ---------------- verificação de domínio ---------------- */

/**
 * Antes de aceitar a URL de retorno, a TikTok manda PROVAR que o dominio e seu:
 * ela da um arquivo `tiktok<numeros>.txt` pra colocar na raiz do site. Quem nao
 * tem acesso ao servidor trava aqui — e esse e justamente o perfil de quem compra
 * o console. Entao o proprio painel serve o arquivo: a pessoa cola nome e
 * conteudo na tela e a URL passa a responder.
 *
 * O nome e restrito a um arquivo .txt sem caminho de proposito: isto vira uma rota
 * publica na raiz, e aceitar barra ou ".." deixaria escolher qualquer endereco do
 * painel — inclusive sombrear rota de verdade.
 */
const VERIFICACAO = 'verificacao';
const NOME_VALIDO = /^[A-Za-z0-9._-]{1,64}\.txt$/;

export function getVerificacao() {
  return load(VERIFICACAO, null);
}

export function salvarVerificacao({ arquivo, conteudo } = {}) {
  const nome = String(arquivo || '').trim().replace(/^\/+/, '');
  const texto = String(conteudo ?? '').trim();
  if (!nome) { return { ok: false, motivo: 'informe o nome do arquivo que a TikTok pediu (ex.: tiktok1a2b3c.txt)' }; }
  if (!NOME_VALIDO.test(nome)) { return { ok: false, motivo: `nome invalido: "${arquivo}" — use so o nome do arquivo .txt, sem barra nem caminho` }; }
  if (!texto) { return { ok: false, motivo: 'cole tambem o conteudo do arquivo' }; }
  save(VERIFICACAO, { arquivo: nome, conteudo: texto, em: new Date().toISOString() });
  return { ok: true, arquivo: nome };
}

export function limparVerificacao() {
  save(VERIFICACAO, null);
  return { ok: true };
}

/**
 * Resolve um pedido HTTP de raiz. Devolve null quando nao e o arquivo cadastrado —
 * quem chama segue o roteamento normal.
 */
export function servirVerificacao(caminho) {
  const v = getVerificacao();
  if (!v?.arquivo) { return null; }
  const pedido = String(caminho || '').split('?')[0].replace(/^\/+/, '');
  // A TikTok verifica a "propriedade", que pode ser o dominio OU um caminho:
  // cadastrando .../oauth/callback/open/ ela procura o arquivo DENTRO dele, nao
  // na raiz. Como o nome do arquivo e unico e vem deles, responder em qualquer
  // caminho que TERMINE nesse nome cobre os dois casos sem abrir nada: continua
  // sendo um nome so, e so ele.
  const ultimo = pedido.split('/').pop();
  if (pedido !== v.arquivo && ultimo !== v.arquivo) { return null; }
  return { conteudo: v.conteudo, tipo: 'text/plain; charset=utf-8' };
}

/* ---------------- autorização ---------------- */

/** Monta a URL da tela de consentimento. `state` é gerado aqui e guardado pra conferência. */
export function iniciarAutorizacao(familia, opts = {}) {
  const cred = getCredenciais()[familia] || {};
  const falta = auth.faltaCredencial(familia, cred);
  if (falta.length) { return { ok: false, erros: [`falta preencher: ${falta.join(', ')}`] }; }

  const state = opts.state || `vs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let r;
  if (familia === 'open') { r = auth.urlAutorizacao({ ...cred, redirectUri: opts.redirectUri || cred.redirectUri, escopos: opts.escopos, state }); }
  else if (familia === 'business') { r = auth.urlAutorizacaoBusiness({ ...cred, redirectUri: opts.redirectUri || cred.redirectUri, state }); }
  else if (familia === 'shop') { r = auth.urlAutorizacaoShop({ serviceId: opts.serviceId || cred.serviceId, state }); }
  else { return { ok: false, erros: [`familia sem suporte: "${familia}"`] }; }

  if (r.erros?.length) { return { ok: false, erros: r.erros }; }
  salvarConfig({ [`state_${familia}`]: state });
  return { ok: true, url: r.url, state };
}

/**
 * Fecha o ciclo: troca o `code` do callback por token e guarda.
 * Confere o `state` porque callback sem essa checagem aceita code de qualquer origem.
 */
export async function concluirAutorizacao(familia, code, opts = {}) {
  const cred = getCredenciais()[familia] || {};
  const esperado = getConfig()[`state_${familia}`];
  if (esperado && opts.state && opts.state !== esperado) {
    return { ok: false, motivo: 'state nao confere — recomece a autorizacao (pode ser callback forjado)' };
  }
  const r = await auth.trocarCodigo(familia, cred, code, opts);
  if (!r.ok) { return r; }
  save(TOKENS, { ...getTokens(), [familia]: r.token });
  return { ok: true, familia, token: { ...r.token, accessToken: mascarar(r.token.accessToken), refreshToken: mascarar(r.token.refreshToken) } };
}

/**
 * Contexto pronto pra usar numa família: token válido + o que a família exige.
 * Renova e regrava o token quando necessário.
 */
export async function contexto(familia, opts = {}) {
  const cred = getCredenciais()[familia] || {};
  const falta = auth.faltaCredencial(familia, cred);
  if (falta.length) { return { ok: false, motivo: `falta preencher a credencial do app: ${falta.join(', ')}` }; }

  const guardado = getTokens()[familia];
  const g = await auth.garantirToken(familia, cred, guardado || {}, opts);
  if (!g.ok) { return g; }
  if (g.renovado) { save(TOKENS, { ...getTokens(), [familia]: g.token }); }

  const cfg = getConfig();
  return {
    ok: true,
    renovado: g.renovado,
    ctx: {
      token: g.token.accessToken,
      // O escopo concedido anda junto do token: quem chama a API precisa saber o
      // que pode pedir. Pedir campo fora do escopo faz a TikTok recusar a
      // chamada INTEIRA, nao devolver o campo vazio.
      escopo: g.token.escopo || null,
      appKey: cred.appKey,
      appSecret: cred.appSecret,
      shopCipher: opts.shopCipher || cfg.shopCipher,
      fetchImpl: opts.fetchImpl,
      esperar: opts.esperar,
      timeoutMs: opts.timeoutMs,
      tentativas: opts.tentativas,
    },
  };
}

/* ---------------- diagnóstico (o que a tela mostra) ---------------- */

/**
 * Situação de cada família: o que falta, se há token e quando vence. É o que faz o
 * painel dizer "expira em 3h" em vez de só quebrar quando expirar.
 */
export function diagnostico(agora = Date.now()) {
  const creds = getCredenciais();
  const tokens = getTokens();
  const cfg = getConfig();
  const familias = {};

  for (const familia of Object.keys(auth.CREDENCIAL)) {
    const cred = creds[familia] || {};
    const faltando = auth.faltaCredencial(familia, cred);
    const tk = tokens[familia] || null;
    const venceEm = tk?.expiraEm ? Math.round((new Date(tk.expiraEm).getTime() - agora) / 60000) : null;
    familias[familia] = {
      nome: auth.CREDENCIAL[familia].nome,
      ajuda: auth.CREDENCIAL[familia].ajuda,
      faltando,
      appConfigurado: faltando.length === 0,
      autorizado: Boolean(tk?.accessToken),
      expirado: tk ? auth.expirado(tk, agora, 0) : null,
      venceEmMin: venceEm,
      podeRenovar: Boolean(tk?.refreshToken),
      conta: tk?.openId || tk?.sellerName || null,
      /* A chave PUBLICA fica visivel (mascarada) de proposito: quando a
         autorizacao falha, a primeira pergunta e "qual chave esta gravada aqui?"
         — e nao poder responder isso na tela custa uma rodada inteira. */
      chave: (() => {
        const c = creds[familia] || {};
        const v = c.clientKey || c.appId || c.appKey || null;
        return v ? mascarar(v) : null;
      })(),
      token: tk?.accessToken ? mascarar(tk.accessToken) : null,
    };
  }

  return {
    familias,
    lojaAtiva: cfg.shopCipher ? mascarar(cfg.shopCipher) : null,
    anuncianteAtivo: cfg.anuncianteId || null,
    pronto: {
      publicar: Boolean(tokens.open?.accessToken),
      produtos: Boolean(tokens.shop?.accessToken && cfg.shopCipher),
      campanhas: Boolean(tokens.business?.accessToken && cfg.anuncianteId),
    },
  };
}

/* ---------------- atalhos de alto nível ---------------- */

async function comCtx(familia, opts, fn) {
  const c = await contexto(familia, opts);
  if (!c.ok) { return c; }
  return fn(c.ctx);
}

/** Lojas autorizadas; grava o shop_cipher da primeira se ainda não houver uma ativa. */
export async function descobrirLoja(opts = {}) {
  return comCtx('shop', opts, async (ctx) => {
    const r = await produtos.lojas(ctx);
    if (!r.ok) { return r; }
    const lista = r.dados?.shops || [];
    if (lista.length && !getConfig().shopCipher) { salvarConfig({ shopCipher: lista[0].cipher, shopId: lista[0].id, shopNome: lista[0].name }); }
    return { ok: true, lojas: lista };
  });
}

/** Contas de anúncio; grava a primeira como ativa se ainda não houver uma. */
export async function descobrirAnunciante(opts = {}) {
  const cred = getCredenciais().business || {};
  return comCtx('business', opts, async (ctx) => {
    const r = await campanhas.anunciantes(ctx, cred);
    if (!r.ok) { return r; }
    const lista = r.dados?.list || [];
    if (lista.length && !getConfig().anuncianteId) { salvarConfig({ anuncianteId: lista[0].advertiser_id, anuncianteNome: lista[0].advertiser_name }); }
    return { ok: true, anunciantes: lista };
  });
}

/** Categorias e armazens da loja — o que a TikTok exige e o estoque nao sabe. */
export async function categoriasDaLoja(opts = {}) {
  return comCtx('shop', opts, (ctx) => produtos.categorias(ctx, opts));
}
export async function armazensDaLoja(opts = {}) {
  return comCtx('shop', opts, (ctx) => produtos.armazens(ctx));
}

/**
 * Publica um produto DO ESTOQUE na TikTok Shop.
 *
 * Ciclo inteiro: envia as imagens, traduz o produto, cria (ou EDITA, se este
 * SKU ja foi publicado antes) e guarda o id. Publicar duas vezes sem guardar o
 * id criaria dois produtos iguais na loja, disputando busca entre si e
 * dividindo as avaliacoes.
 */
export async function publicarProdutoDoEstoque(prod, opts = {}) {
  const cfg = getConfig();
  return comCtx('shop', opts, async (ctx) => {
    /* As imagens vao ANTES: a TikTok so aceita URI dela propria, e descobrir
       isso depois de montar o resto e refazer tudo. */
    const uris = [];
    const baixar = opts.baixarImagem;
    for (const url of (prod.imagens || []).slice(0, 9)) {
      if (!baixar) { break; }
      const bytes = await baixar(url).catch(() => null);
      if (!bytes) { return { ok: false, motivo: `nao consegui ler a imagem ${url}` }; }
      const env = await produtos.enviarImagem(ctx, bytes, opts);
      if (!env.ok) { return { ok: false, motivo: `a TikTok recusou a imagem: ${env.motivo}` }; }
      uris.push(env.dados?.uri || env.uri);
    }

    const t = ponte.paraTiktok(prod, {
      categoriaId: cfg.categoriaId,
      armazemId: cfg.armazemId,
      imagensUri: uris,
    });
    if (t.erros.length) { return { ok: false, motivo: t.erros.join('; '), erros: t.erros, avisos: t.avisos }; }

    const mapa = load(PUBLICADOS, {});
    const antes = ponte.jaPublicado(mapa, prod.sku);
    const r = antes
      ? await produtos.editar(ctx, antes.produtoId, t.produto)
      : await produtos.criar(ctx, t.produto);
    if (!r.ok) { return { ...r, avisos: t.avisos }; }

    const id = r.dados?.product_id || antes?.produtoId || null;
    if (id) { save(PUBLICADOS, ponte.registrarPublicado(mapa, prod.sku, id)); }
    return { ok: true, produtoId: id, editado: Boolean(antes), avisos: t.avisos };
  });
}

/**
 * Puxa os produtos da loja DE VERDADE e registra o resultado.
 *
 * Registra tanto o sucesso quanto a falha. Guardar so o sucesso faria a tela
 * mostrar para sempre a ultima vez que deu certo, escondendo que hoje nao
 * conecta — que e exatamente a informacao que importa.
 *
 * NUNCA inventa item. Se a TikTok nao respondeu, a lista volta vazia com o
 * motivo; dado fabricado numa tela de integracao e o tipo de coisa que passa
 * numa revisao e quebra no cliente.
 */
export async function sincronizarProdutos(opts = {}) {
  const quando = new Date().toISOString();
  const cfg = getConfig();
  if (!cfg.shopCipher) {
    const reg = { em: quando, ok: false, total: 0, motivo: 'nenhuma loja selecionada — autorize a loja primeiro' };
    save(SINCRONIA, reg);
    return { ok: false, ...reg };
  }
  const r = await listarProdutos({ tamanho: 50 }, opts);
  const itens = r.ok ? (r.dados?.products || r.produtos || []) : [];
  const reg = {
    em: quando,
    ok: r.ok === true,
    total: itens.length,
    loja: cfg.shopNome || cfg.shopId || null,
    ...(r.ok ? {} : { motivo: r.motivo || 'a TikTok recusou a consulta' }),
  };
  save(SINCRONIA, reg);
  return { ...reg, produtos: itens };
}

/** O carimbo da ultima sincronizacao — null se nunca houve. */
export const ultimaSincronizacao = () => load(SINCRONIA, null);

/** O que ja foi publicado na loja, por SKU. */
export const publicados = () => load(PUBLICADOS, {});

export async function cadastrarProduto(p, opts = {}) {
  return comCtx('shop', opts, (ctx) => produtos.criar(ctx, p));
}

export async function listarProdutos(filtros = {}, opts = {}) {
  return comCtx('shop', opts, (ctx) => produtos.buscar(ctx, filtros));
}

export async function criarCampanha(c, opts = {}) {
  const anuncianteId = c.anuncianteId || getConfig().anuncianteId;
  return comCtx('business', opts, (ctx) => campanhas.criar(ctx, { ...c, anuncianteId }));
}

export async function listarCampanhas(opts = {}) {
  const anuncianteId = opts.anuncianteId || getConfig().anuncianteId;
  return comCtx('business', opts, (ctx) => campanhas.listar(ctx, anuncianteId, opts));
}

export async function relatorioCampanhas(periodo, opts = {}) {
  const anuncianteId = opts.anuncianteId || getConfig().anuncianteId;
  return comCtx('business', opts, (ctx) => campanhas.relatorio(ctx, anuncianteId, periodo, opts));
}

export async function publicarVideo(dados, opts = {}) {
  return comCtx('open', opts, async (ctx) => {
    const r = dados.videoUrl ? await conteudo.publicarPorUrl(ctx, dados) : await conteudo.publicarArquivo(ctx, dados);
    if (!r.ok || !opts.aguardar) { return r; }
    const fim = await conteudo.aguardarPublicacao(ctx, r.publishId, opts);
    return { ...fim, avisos: r.avisos };
  });
}

/** Situacao de uma publicacao. A TikTok processa o video depois do envio: sem
    consultar isto, a tela diria "publicado" com o video ainda em fila la. */
export async function statusPublicacao(publishId, opts = {}) {
  if (!String(publishId || '').trim()) { return { ok: false, motivo: 'informe o id da publicacao' }; }
  return comCtx('open', opts, (ctx) => conteudo.status(ctx, publishId));
}

export async function metricasDeVideos(videoIds, opts = {}) {
  return comCtx('open', opts, (ctx) => metricas.coletarMetricas(ctx, videoIds, opts));
}

export async function meuPerfil(opts = {}) {
  return comCtx('open', opts, (ctx) => metricas.perfil(ctx));
}
