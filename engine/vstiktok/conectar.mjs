/**
 * VStiktok — conexão em um comando.
 *
 * Junta túnel + receptor de callback + troca de token + teste real contra a API. É o
 * que transforma "uma tarde configurando" em `vstiktok conectar open`.
 *
 * A ordem importa e não é óbvia: o túnel tem que subir ANTES de gerar a URL de
 * autorização, porque o `redirect_uri` da autorização precisa ser byte a byte o mesmo
 * que está cadastrado no painel do app — e o quick tunnel só revela a URL depois de
 * conectar. Gerar a autorização primeiro dá `redirect_uri mismatch`, que é o erro que
 * mais custa tempo aqui.
 */
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { abrirTunel } from './tunel.mjs';
import { servidorCallback, CAMINHO } from './callback.mjs';
import * as vs from './index.mjs';

/** Onde cada família cadastra a URL de retorno — é o que o usuário precisa colar. */
export const ONDE_COLAR = {
  open: 'developers.tiktok.com → seu app → Login Kit → "Redirect URI"',
  business: 'business-api.tiktok.com → seu app → "Advertiser redirect URL"',
  shop: 'partner.tiktokshop.com → seu app → "Callback URL"',
};

/**
 * A saida é injetavel: `conectar` fala muito com o usuario, e biblioteca que escreve
 * em stdout sem pedir licenca atrapalha quem a chama de dentro de outro processo.
 */
const saidaPadrao = (...a) => console.log(...a);

async function confirmar(pergunta) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question(pergunta); } finally { rl.close(); }
}

/** Abre o navegador sem quebrar se não houver ambiente gráfico. */
function abrirNavegador(url) {
  const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open');
  try {
    const p = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch { /* sem navegador: a URL ja foi impressa */ }
}

/**
 * Conecta uma família de ponta a ponta.
 * @param {'open'|'business'|'shop'} familia
 * @param {object} [opts]
 * @param {boolean} [opts.semConfirmar]  não espera ENTER (uso automatizado)
 * @param {number} [opts.timeoutMs]      quanto esperar o usuário autorizar
 */
export async function conectar(familia, opts = {}) {
  const log = opts.log || saidaPadrao;
  const cred = vs.getCredenciais()[familia] || {};
  const falta = vs.auth.faltaCredencial(familia, cred);
  if (falta.length) {
    return { ok: false, motivo: `falta a credencial do app (${falta.join(', ')}) — rode: vstiktok app ${familia} ${falta.map((f) => f + '=...').join(' ')}` };
  }
  if (familia === 'shop' && !cred.serviceId && !opts.serviceId) {
    return { ok: false, motivo: 'o Shop precisa do serviceId — rode: vstiktok app shop serviceId=...' };
  }

  const srv = await servidorCallback({ porta: opts.porta });
  if (!srv.ok) { return srv; }

  log('  ⏳ abrindo o túnel público (a TikTok não aceita localhost)…');
  const tunel = await abrirTunel({
    porta: srv.porta,
    provedor: opts.provedor,
    spawnImpl: opts.spawnImpl,
    timeoutMs: opts.tunelTimeoutMs,
    fetchImpl: opts.fetchImpl,
  });
  if (!tunel.ok) { await srv.fechar(); return tunel; }
  // Provedor que falhou no meio do caminho vira aviso, nao silencio: da a pista de
  // onde olhar se o proximo tambem der problema.
  for (const t of tunel.tentados || []) { log(`     (${t.provedor} não serviu: ${t.motivo})`); }

  const redirectUri = `${tunel.url}${CAMINHO}/${familia}`;
  const encerrar = async () => { tunel.fechar(); await srv.fechar(); };

  try {
    log(`\n  Túnel no ar via ${tunel.provedor}: ${tunel.url}  (testado de fora, respondendo)`);
    log('\n  1) Cole ESTE endereço como URL de retorno do app:\n');
    log(`       ${redirectUri}\n`);
    log(`     Em: ${ONDE_COLAR[familia]}`);
    log('     (o endereço muda a cada execução — é túnel temporário)\n');

    if (!opts.semConfirmar) { await confirmar('  2) Colou e salvou? Aperte ENTER pra abrir a autorização… '); }

    // O redirect entra na credencial ANTES da troca: a TikTok confere se é o mesmo.
    vs.salvarCredencial(familia, { redirectUri, ...(opts.serviceId ? { serviceId: opts.serviceId } : {}) });

    const ini = vs.iniciarAutorizacao(familia, { redirectUri, escopos: opts.escopos, serviceId: opts.serviceId });
    if (!ini.ok) { await encerrar(); return { ok: false, motivo: (ini.erros || []).join('; ') }; }

    log('\n  3) Autorize nesta URL (já tentei abrir no navegador):\n');
    log(`       ${ini.url}\n`);
    if (!opts.semNavegador) { abrirNavegador(ini.url); }
    log('  ⏳ esperando você autorizar…');

    const volta = await srv.esperar(familia, opts.timeoutMs);
    if (!volta.ok) { await encerrar(); return volta; }

    const r = await vs.concluirAutorizacao(familia, volta.code, { state: volta.state, fetchImpl: opts.fetchImpl });
    await encerrar();
    if (!r.ok) { return r; }

    return { ok: true, familia, token: r.token, redirectUri };
  } catch (e) {
    await encerrar();
    return { ok: false, motivo: `falhou no meio da conexao: ${e.message}` };
  }
}

/**
 * Bate na API DE VERDADE e mostra o que voltou. É o "prova que funciona" — sem isso o
 * módulo só prova que compila.
 */
export async function testar(familia, opts = {}) {
  const provas = [];
  const c = await vs.contexto(familia, opts);
  if (!c.ok) { return { ok: false, familia, motivo: c.motivo, provas }; }

  if (familia === 'open') {
    const p = await vs.metricas.perfil(c.ctx);
    provas.push({ chamada: 'GET /v2/user/info/', ok: p.ok, detalhe: p.ok ? `conta: ${p.conta} · seguidores ${p.perfil.seguidores ?? '—'}` : p.motivo });
    if (p.ok) {
      const v = await vs.metricas.listarVideos(c.ctx, { quantidade: 5 });
      provas.push({
        chamada: 'POST /v2/video/list/',
        ok: v.ok,
        detalhe: v.ok ? `${v.videos.length} vídeo(s) — ${v.videos.map((x) => x.id).join(', ') || 'nenhum'}` : v.motivo,
      });
      // Só dá pra provar a consulta de métrica se existir vídeo na conta.
      if (v.ok && v.videos.length) {
        const m = await vs.metricas.coletarMetricas(c.ctx, [v.videos[0].id]);
        provas.push({
          chamada: 'POST /v2/video/query/',
          ok: m.ok,
          detalhe: m.ok ? `views ${m.medicoes[0]?.views ?? '—'} · likes ${m.medicoes[0]?.likes ?? '—'}` : m.motivo,
        });
      }
    }
  }

  if (familia === 'business') {
    const cred = vs.getCredenciais().business || {};
    const a = await vs.campanhas.anunciantes(c.ctx, cred);
    const lista = a.dados?.list || [];
    provas.push({ chamada: 'GET /oauth2/advertiser/get/', ok: a.ok, detalhe: a.ok ? `${lista.length} conta(s) de anúncio` : a.motivo });
    const anuncianteId = vs.getConfig().anuncianteId || lista[0]?.advertiser_id;
    if (a.ok && anuncianteId) {
      const cam = await vs.campanhas.listar(c.ctx, anuncianteId, { tamanho: 5 });
      provas.push({ chamada: 'GET /campaign/get/', ok: cam.ok, detalhe: cam.ok ? `${(cam.dados?.list || []).length} campanha(s)` : cam.motivo });
    }
  }

  if (familia === 'shop') {
    const l = await vs.produtos.lojas(c.ctx);
    const lojas = l.dados?.shops || [];
    provas.push({ chamada: 'GET /authorization/202309/shops', ok: l.ok, detalhe: l.ok ? `${lojas.length} loja(s): ${lojas.map((s) => s.name).join(', ')}` : l.motivo });
    if (l.ok && lojas.length) {
      const ctx2 = { ...c.ctx, shopCipher: vs.getConfig().shopCipher || lojas[0].cipher };
      const w = await vs.produtos.armazens(ctx2);
      provas.push({ chamada: 'GET /logistics/202309/warehouses', ok: w.ok, detalhe: w.ok ? `${(w.dados?.warehouses || []).length} armazém(ns)` : w.motivo });
      const p = await vs.produtos.buscar(ctx2, { tamanho: 5 });
      provas.push({ chamada: 'POST /product/202309/products/search', ok: p.ok, detalhe: p.ok ? `${(p.dados?.products || []).length} produto(s)` : p.motivo });
    }
  }

  return { ok: provas.length > 0 && provas.every((p) => p.ok), familia, provas };
}
