/**
 * VSconsumo — o medidor de banda da instalação (pedido do dono, 2026-09-27).
 *
 * O contrato promete "banda total de consumo mensal (envio e armazenamento de
 * mídia, mensagens e publicações)". Até aqui ninguém media: o número estava no
 * contrato e em lugar nenhum do sistema. Este módulo mede o que de fato passou
 * pela rede, em bytes, NO PONTO onde passa — não estima por mensagem:
 *
 *   - tráfego HTTP do servidor (painel, loja, webhooks): corpo que entra + corpo que sai;
 *   - chamadas que o servidor faz (API do Telegram, da Meta, integrações): corpo enviado + recebido;
 *   - WhatsApp Web: bytes que o navegador da sessão troca (websocket + downloads);
 *   - mídia guardada no mês (arquivos novos nas pastas de mídia).
 *
 * Passou do limite do mês → MODO CONSULTA: vê tudo, não envia, não publica,
 * não edita — até virar o mês ou entrar banda adicional. Quem decide o limite
 * é o plano (+ adendos); este módulo só mede e diz se passou.
 *
 * Grava por mês em <casa>/vsconsumo/<AAAA-MM>.json. Acumula em memória e
 * descarrega a cada poucos segundos: medir não pode custar uma escrita em
 * disco por requisição.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dentroDaCasa } from '../casa.mjs';

export const CATEGORIAS = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  painel: 'Painel (uso da equipe)',
  loja: 'Loja e páginas públicas',
  integracoes: 'Outras integrações',
  midia: 'Mídia guardada',
};
export const GB = 1024 ** 3;
export const AVISO_PCT = 0.8;

const dir = () => process.env.VSCONSUMO_DIR || dentroDaCasa('vsconsumo');
const arqMes = (mes) => join(dir(), `${mes}.json`);
const TZ = 'America/Sao_Paulo';
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const diaDe = (d = new Date()) => fmtDia.format(new Date(d));
export const mesDe = (d = new Date()) => diaDe(d).slice(0, 7);

let pendente = {}; // { mes: { dia: { cat: {e, s, n} } } }
let timer = null;
let relogio = () => new Date();

function lerMes(mes) {
  try { return JSON.parse(readFileSync(arqMes(mes), 'utf8')); } catch { return { mes, dias: {} }; }
}
function somar(alvo, cat, e, s, n) {
  const c = alvo[cat] || (alvo[cat] = { e: 0, s: 0, n: 0 });
  c.e += e; c.s += s; c.n += n;
}

/** Registra tráfego. `entrada`/`saida` em bytes; categoria fora da lista vira integrações. */
export function registrar(cat, { entrada = 0, saida = 0, n = 1 } = {}, quando = relogio()) {
  const e = Math.max(0, Math.round(Number(entrada) || 0));
  const s = Math.max(0, Math.round(Number(saida) || 0));
  if (!e && !s) { return; }
  const k = CATEGORIAS[cat] ? cat : 'integracoes';
  const d = diaDe(quando);
  const m = d.slice(0, 7);
  const pm = pendente[m] || (pendente[m] = {});
  somar(pm[d] || (pm[d] = {}), k, e, s, n);
  if (!timer) { timer = setTimeout(descarregar, 5000); timer.unref?.(); }
}

/** Grava o acumulado. Chamado sozinho a cada 5 s e no encerramento do processo. */
export function descarregar() {
  clearTimeout(timer); timer = null;
  const p = pendente; pendente = {};
  for (const [mes, dias] of Object.entries(p)) {
    const doc = lerMes(mes);
    for (const [d, cats] of Object.entries(dias)) {
      const alvo = doc.dias[d] || (doc.dias[d] = {});
      for (const [cat, v] of Object.entries(cats)) { somar(alvo, cat, v.e, v.s, v.n); }
    }
    try { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arqMes(mes), JSON.stringify(doc)); } catch (e) { console.error('[consumo] não gravei:', e.message); }
  }
}

/** O mês lido do disco + o que ainda está na memória. */
export function doMes(mes = mesDe(relogio())) {
  const doc = lerMes(mes);
  for (const [d, cats] of Object.entries(pendente[mes] || {})) {
    const alvo = doc.dias[d] || (doc.dias[d] = {});
    for (const [cat, v] of Object.entries(cats)) { somar(alvo, cat, v.e, v.s, v.n); }
  }
  return doc;
}

/** Só arquivo de mídia conta como "armazenamento de mídia" — JSON de dado não. */
export const EXT_MIDIA = /\.(jpe?g|png|webp|gif|mp4|mov|webm|ogg|opus|mp3|m4a|pdf)$/i;

/** Bytes de arquivos de mídia criados/alterados no mês dentro das pastas. */
export function midiaDoMes(pastas = [], mes = mesDe(relogio())) {
  let total = 0; let n = 0;
  const andar = (p, prof = 0) => {
    let itens = [];
    try { itens = readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const f = join(p, it.name);
      if (it.isDirectory()) { if (prof < 4) { andar(f, prof + 1); } continue; }
      if (!EXT_MIDIA.test(it.name)) { continue; }
      try { const st = statSync(f); if (mesDe(st.mtime) === mes) { total += st.size; n++; } } catch { /* sumiu */ }
    }
  };
  for (const p of pastas) { andar(p); }
  return { bytes: total, arquivos: n };
}

/** Primeiro dia do mês seguinte (00:00 de Brasília), quando a banda renova. */
export function renovaEm(mes) {
  const [a, m] = mes.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return new Date(`${prox}-01T00:00:00-03:00`).toISOString();
}

/**
 * Foto do consumo do mês e o veredito.
 * @param {object} o
 * @param {number|null} o.limiteGb   limite do mês (plano + adendos); null = ilimitado
 * @param {{bytes:number,arquivos:number}} [o.midia] mídia guardada no mês
 */
export function estado({ limiteGb = null, midia = { bytes: 0, arquivos: 0 }, mes, agora = relogio() } = {}) {
  const m = mes || mesDe(agora);
  const doc = doMes(m);
  const porCategoria = Object.fromEntries(Object.keys(CATEGORIAS).map((k) => [k, { entrada: 0, saida: 0, total: 0, n: 0 }]));
  const porDia = [];
  for (const [d, cats] of Object.entries(doc.dias).sort(([a], [b]) => a.localeCompare(b))) {
    const linha = { dia: d, total: 0 };
    for (const [cat, v] of Object.entries(cats)) {
      const c = porCategoria[cat] || porCategoria.integracoes;
      c.entrada += v.e; c.saida += v.s; c.total += v.e + v.s; c.n += v.n;
      linha[cat] = (linha[cat] || 0) + v.e + v.s; linha.total += v.e + v.s;
    }
    porDia.push(linha);
  }
  porCategoria.midia.total += midia.bytes; porCategoria.midia.entrada += midia.bytes; porCategoria.midia.n += midia.arquivos;
  const usadoBytes = Object.values(porCategoria).reduce((s, c) => s + c.total, 0);
  const limiteBytes = limiteGb == null ? null : Math.round(limiteGb * GB);
  const pct = limiteBytes ? usadoBytes / limiteBytes : null;
  // Projeção pelo ritmo do mês até agora (dias corridos, com fração do dia de hoje).
  const ini = new Date(`${m}-01T00:00:00-03:00`).getTime();
  const fim = new Date(renovaEm(m)).getTime();
  const t = Math.min(Math.max(new Date(agora).getTime(), ini + 3600e3), fim);
  const projecaoBytes = m === mesDe(agora) ? Math.round(usadoBytes * ((fim - ini) / (t - ini))) : usadoBytes;
  const modoConsulta = limiteBytes != null && usadoBytes >= limiteBytes;
  return {
    mes: m, limiteGb, limiteBytes, usadoBytes, pct, projecaoBytes,
    faixa: modoConsulta ? 'consulta' : pct != null && pct >= AVISO_PCT ? 'atencao' : 'normal',
    modoConsulta, renovaEm: renovaEm(m), porCategoria, porDia,
  };
}

/** Categoria de uma requisição que CHEGA ao servidor. */
export function categoriaDaRota(url = '') {
  const p = String(url).split('?')[0];
  if (/^\/(webhook|wa-webhook|whatsapp)/i.test(p)) { return 'whatsapp'; }
  if (/^\/telegram/i.test(p)) { return 'telegram'; }
  if (/^\/(crm|api\/crm)/.test(p)) { return 'painel'; }
  return 'loja';
}

/** Categoria de uma chamada que o servidor FAZ. */
export function categoriaDoHost(url = '', { telegramApi } = {}) {
  let h = '';
  try { h = new URL(String(url)).host; } catch { return 'integracoes'; }
  if (/(^|\.)telegram\.org$/.test(h) || (telegramApi && url.startsWith(telegramApi))) { return 'telegram'; }
  if (/(^|\.)(facebook\.com|whatsapp\.net|whatsapp\.com|fbcdn\.net)$/.test(h)) { return 'whatsapp'; }
  return 'integracoes';
}

/** Tamanho do corpo de uma chamada fetch (string, Buffer, FormData, Blob, URLSearchParams). */
export async function tamanhoDoCorpo(body) {
  if (body == null) { return 0; }
  if (typeof body === 'string') { return Buffer.byteLength(body); }
  if (body instanceof ArrayBuffer) { return body.byteLength; }
  if (ArrayBuffer.isView(body)) { return body.byteLength; }
  if (typeof Blob !== 'undefined' && body instanceof Blob) { return body.size; }
  if (body instanceof URLSearchParams) { return Buffer.byteLength(body.toString()); }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    let n = 0;
    for (const [k, v] of body.entries()) { n += Buffer.byteLength(k) + 100 + (typeof v === 'string' ? Buffer.byteLength(v) : v.size || 0); }
    return n;
  }
  return 0;
}

/**
 * Troca o `fetch` global por um que mede. Resposta é contada conforme o corpo
 * é lido (stream), então chamada que ninguém lê não conta como baixada.
 */
export function medirFetch({ telegramApi } = {}) {
  const original = globalThis.fetch;
  if (!original || original.__medido) { return; }
  const medido = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const cat = categoriaDoHost(url, { telegramApi });
    const saida = await tamanhoDoCorpo(init?.body).catch(() => 0);
    const r = await original(input, init);
    registrar(cat, { saida: saida + url.length + 200 });
    if (!r.body) { return r; }
    let lidos = 0;
    const contador = new TransformStream({
      transform(ch, c) { lidos += ch.byteLength || 0; c.enqueue(ch); },
      flush() { registrar(cat, { entrada: lidos + 200, n: 0 }); },
    });
    const nova = new Response(r.body.pipeThrough(contador), { status: r.status, statusText: r.statusText, headers: r.headers });
    Object.defineProperty(nova, 'url', { value: r.url });
    return nova;
  };
  medido.__medido = true;
  globalThis.fetch = medido;
}

/**
 * Mede uma requisição que chega ao servidor: corpo de entrada (pelo socket) e
 * tudo que a resposta escreve. Chame no começo do handler.
 */
export function medirRequisicao(req, res) {
  const cat = categoriaDaRota(req.url);
  let entrada = 0; let saida = 0;
  req.on('data', (c) => { entrada += c.length; });
  const w = res.write.bind(res); const e = res.end.bind(res);
  const tam = (c, enc) => (c == null || typeof c === 'function' ? 0 : typeof c === 'string' ? Buffer.byteLength(c, typeof enc === 'string' ? enc : 'utf8') : c.length || 0);
  res.write = (c, enc, cb) => { saida += tam(c, enc); return w(c, enc, cb); };
  res.end = (c, enc, cb) => { saida += tam(c, enc); return e(c, enc, cb); };
  res.on('finish', () => registrar(cat, { entrada: entrada + String(req.url).length + 300, saida: saida + 200 }));
}

/**
 * WhatsApp Web: a conversa corre dentro do navegador da sessão, não no Node.
 * Pelo protocolo de depuração do Chrome dá para contar os bytes REAIS do
 * websocket e dos downloads (mídia) daquela aba.
 */
export async function medirNavegador(page, cat = 'whatsapp') {
  if (!page || page.__medido) { return false; }
  const cdp = await (page.createCDPSession ? page.createCDPSession() : page.target().createCDPSession());
  await cdp.send('Network.enable');
  const b64 = (s = '') => Math.floor(s.length * 3 / 4);
  cdp.on('Network.loadingFinished', (ev) => registrar(cat, { entrada: ev.encodedDataLength || 0 }));
  cdp.on('Network.webSocketFrameReceived', (ev) => registrar(cat, { entrada: ev.response?.opcode === 1 ? Buffer.byteLength(ev.response.payloadData || '') : b64(ev.response?.payloadData) }));
  cdp.on('Network.webSocketFrameSent', (ev) => registrar(cat, { saida: ev.response?.opcode === 1 ? Buffer.byteLength(ev.response.payloadData || '') : b64(ev.response?.payloadData) }));
  cdp.on('Network.requestWillBeSent', (ev) => registrar(cat, { saida: (ev.request?.postData?.length || 0) + 300, n: 0 }));
  page.__medido = true;
  return true;
}

/** Só pra teste. */
export function _relogio(fn) { relogio = fn || (() => new Date()); }
export function _zerar() { clearTimeout(timer); timer = null; pendente = {}; }

/* ── Pedidos de banda adicional ──────────────────────────────────────────
   O cliente em modo consulta pede o adendo pelo próprio painel; o pedido
   fica registrado até alguém liberar (ou recusar). */
const arqPedidos = () => join(dir(), 'pedidos-banda.json');
const lerPedidos = () => { try { return JSON.parse(readFileSync(arqPedidos(), 'utf8')); } catch { return []; } };
const gravarPedidos = (l) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arqPedidos(), JSON.stringify(l, null, 2)); };
export const pedidosBanda = () => lerPedidos();
export function pedirBanda({ gb = 10, por, observacao } = {}) {
  const l = lerPedidos();
  if (l.some((p) => p.estado === 'aberto')) { return { ok: true, repetido: true, pedido: l.find((p) => p.estado === 'aberto') }; }
  const pedido = { id: `p${Date.now().toString(36)}`, gb: Number(gb) || 10, por: por || null, observacao: String(observacao || '').slice(0, 300), em: relogio().toISOString(), estado: 'aberto' };
  gravarPedidos([...l, pedido]);
  return { ok: true, pedido };
}
export function fecharPedidosBanda({ estado = 'atendido', por } = {}) {
  const l = lerPedidos().map((p) => (p.estado === 'aberto' ? { ...p, estado, fechadoEm: relogio().toISOString(), fechadoPor: por || null } : p));
  gravarPedidos(l);
}
