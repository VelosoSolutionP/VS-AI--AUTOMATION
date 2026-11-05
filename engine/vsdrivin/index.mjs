/**
 * VSdrivin — integração com a DrivIn (roteirização e última milha), 29/09.
 *
 * Perfil de cliente novo: quem entrega com frota própria (distribuidora,
 * atacadista, transportadora urbana, loja online). A DrivIn cuida da ROTA; o
 * Bolso Cheio cuida da CONVERSA. Complementa, não concorre.
 *
 *  1. Pedido PAGO no WhatsApp/Telegram vira pedido na DrivIn (POST /orders), com
 *     o endereço que o cliente digitou no fluxo, telefone e itens. Também dá pra
 *     mandar à mão (pedido pago na entrega).
 *  2. Webhook de ROTA (rota aprovada/iniciada) → "seu pedido saiu pra entrega",
 *     com a previsão de chegada.
 *  3. Webhook de PROVA DE ENTREGA → "entregue ✅" (com o link do comprovante) ou
 *     "não conseguimos entregar: motivo" (e a equipe é avisada).
 *  4. "Cadê meu pedido?" → o bot responde com o último status que a DrivIn mandou.
 *
 * Autenticação da DrivIn: cabeçalho X-API-Key (uma chave por organização,
 * pedida ao soporte@driv.in). Os webhooks também são ligados por eles: a gente
 * dá o endereço com um segredo na URL e confere o segredo em cada chamada.
 * Sem IA, sem custo por mensagem: tudo por regra.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dentroDaCasa } from '../casa.mjs';

const dir = () => process.env.VSDRIVIN_DIR || dentroDaCasa('vsdrivin');
const ler = (n, p) => { try { return JSON.parse(readFileSync(join(dir(), n), 'utf8')); } catch { return p; } };
const gravar = (n, d) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(join(dir(), n), JSON.stringify(d, null, 2), { mode: 0o600 }); };
const agora = () => new Date().toISOString();
const txt = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const BASE_PADRAO = 'https://external.driv.in/api/external/v2';

/* ───────── configuração ───────── */
const PADRAO = { ligado: false, apiKey: null, schemaCode: null, base: null, segredo: null,
  avisos: { saiu: true, entregue: true, naoEntregue: true }, enviarAoPagar: true };
const cfgBruta = () => { const c = { ...PADRAO, ...ler('config.json', {}) }; c.avisos = { ...PADRAO.avisos, ...(c.avisos || {}) }; return c; };
const mascarar = (k) => (k ? `${'•'.repeat(6)}${String(k).slice(-4)}` : null);

/** O que a tela vê: a chave nunca volta inteira. */
export function config() {
  const c = cfgBruta();
  return { ...c, apiKey: undefined, temChave: !!c.apiKey, chave: mascarar(c.apiKey), segredo: undefined, temSegredo: !!c.segredo };
}

export function salvarConfig(d = {}) {
  const c = cfgBruta();
  if (d.apiKey !== undefined && String(d.apiKey).trim()) { c.apiKey = String(d.apiKey).trim().slice(0, 200); }
  if (d.apagarChave === true) { c.apiKey = null; c.ligado = false; }
  if (d.schemaCode !== undefined) { c.schemaCode = txt(d.schemaCode, 60) || null; }
  if (d.base !== undefined) { c.base = /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(String(d.base || '')) ? String(d.base).replace(/\/$/, '') : null; }
  if (d.avisos && typeof d.avisos === 'object') { for (const k of Object.keys(PADRAO.avisos)) { if (typeof d.avisos[k] === 'boolean') { c.avisos[k] = d.avisos[k]; } } }
  if (typeof d.enviarAoPagar === 'boolean') { c.enviarAoPagar = d.enviarAoPagar; }
  if (typeof d.ligado === 'boolean') {
    if (d.ligado && !c.apiKey) { return { ok: false, motivo: 'coloque a chave da API da DrivIn antes de ligar' }; }
    if (d.ligado && !c.schemaCode) { return { ok: false, motivo: 'escolha o esquema (plano de rotas) antes de ligar — use "Testar a chave"' }; }
    c.ligado = d.ligado;
  }
  if (!c.segredo) { c.segredo = randomBytes(18).toString('base64url'); }
  gravar('config.json', c);
  return { ok: true, config: config() };
}

/** Segredo dos webhooks (o servidor monta as URLs e confere cada chamada). */
export function segredo() { const c = cfgBruta(); if (!c.segredo) { salvarConfig({}); return cfgBruta().segredo; } return c.segredo; }
export function segredoConfere(t) {
  const s = Buffer.from(String(segredo())); const r = Buffer.from(String(t || ''));
  return s.length === r.length && timingSafeEqual(s, r);
}

/* ───────── chamada à API ───────── */
async function chamar(caminho, { method = 'GET', corpo, fetch: f = globalThis.fetch } = {}) {
  const c = cfgBruta();
  if (!c.apiKey) { return { ok: false, motivo: 'sem chave da API da DrivIn' }; }
  let r;
  try {
    r = await f(`${c.base || process.env.DRIVIN_API_URL || BASE_PADRAO}${caminho}`, { method,
      headers: { 'X-API-Key': c.apiKey, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (e) { return { ok: false, motivo: `a DrivIn não respondeu: ${e.message}` }; }
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 401 || r.status === 403) { return { ok: false, motivo: 'a DrivIn recusou a chave (confira a api_key com o suporte deles)', http: r.status }; }
  if (!r.ok || j?.success === false || (j?.status && j.status !== 'OK')) { return { ok: false, motivo: txt(j?.message || j?.error || j?.response?.message || `HTTP ${r.status}`, 300), http: r.status, resposta: j }; }
  return { ok: true, resposta: j?.response ?? j };
}

/** Testa a chave e traz os esquemas (planos de rota) pra escolher. */
export async function testar(opts = {}) {
  const r = await chamar('/schemas', opts);
  if (!r.ok) { return r; }
  const esquemas = (Array.isArray(r.resposta) ? r.resposta : []).map((s) => ({ code: String(s.code ?? ''), nome: s.name || s.code, deposito: s.deposit?.name || null })).filter((s) => s.code);
  return { ok: true, esquemas };
}

/* ───────── envios (pedido Bolso Cheio → pedido DrivIn) ───────── */
const envios = () => ler('envios.json', {});
const gravarEnvios = (e) => gravar('envios.json', e);
export const listarEnvios = ({ limite = 50 } = {}) => Object.values(envios()).sort((a, b) => String(b.enviadoEm || b.tentouEm).localeCompare(String(a.enviadoEm || a.tentouEm))).slice(0, limite);
export const envioDe = (referencia) => envios()[String(referencia)] || null;

/* Data de hoje em Brasília (a DrivIn usa AAAA-MM-DD). */
const hojeBR = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

/** Pedido do Bolso Cheio → corpo do POST /orders da DrivIn. */
export function montarPedido(p) {
  const tel = String(p.telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  /* O carrinho do bot tem uma linha por unidade e a taxa de entrega marcada: agrupa
     pelo nome ("3x Refri") e deixa a taxa fora — ela não é mercadoria. */
  const grupos = new Map();
  for (const i of p.itens || []) {
    const nome = txt(i.nome || i.descricao || 'item', 120);
    if (i.taxa || /^entrega\b|^taxa\b/i.test(nome)) { continue; }
    const q = Math.max(1, Math.round(Number(i.quantidade ?? i.qtd ?? 1)) || 1);
    const g = grupos.get(nome) || { code: txt(i.sku || i.codigo || `item-${grupos.size + 1}`, 60), description: nome, units: 0 };
    g.units += q; grupos.set(nome, g);
  }
  const itens = [...grupos.values()];
  return { clients: [{
    code: `bc-${tel || p.referencia}`, name: txt(p.nome || 'Cliente', 80), client_name: txt(p.nome || 'Cliente', 80), contact_name: txt(p.nome || 'Cliente', 80),
    contact_phone: tel || null, address: txt(p.entrega?.endereco, 200), reference: txt(p.entrega?.referencia || p.entrega?.obs, 120) || null,
    orders: [{ code: String(p.referencia), delivery_date: hojeBR(), custom_1: txt(p.entrega?.obs, 120) || null, supplier_name: 'ZEST', items: itens }] }] };
}

/** Manda UM pedido pra DrivIn. Idempotente: pedido já aceito não vai de novo. */
export async function enviar(p, opts = {}) {
  const ref = String(p?.referencia || '');
  if (!ref) { return { ok: false, motivo: 'pedido sem número' }; }
  const e = envios();
  if (e[ref]?.enviadoEm) { return { ok: true, repetido: true, envio: e[ref] }; }
  const c = cfgBruta();
  if (!c.apiKey || !c.schemaCode) { return { ok: false, motivo: 'integração DrivIn não configurada (chave e esquema)' }; }
  if (!txt(p.entrega?.endereco)) { return { ok: false, motivo: 'o pedido não tem endereço de entrega (o fluxo precisa perguntar o endereço)' }; }
  const r = await chamar(`/orders?schema_code=${encodeURIComponent(c.schemaCode)}`, { method: 'POST', corpo: montarPedido(p), fetch: opts.fetch });
  const aceito = r.ok && [...(r.resposta?.added || []), ...(r.resposta?.edited || [])].map(String).includes(ref);
  const base = { referencia: ref, telefone: p.telefone, endereco: p.endereco || null, canal: p.canal || 'whatsapp', nome: p.nome || null, entrega: p.entrega?.endereco || null };
  e[ref] = aceito
    ? { ...base, ...(e[ref] || {}), enviadoEm: agora(), erro: null, status: 'enviado', historico: [...(e[ref]?.historico || []), { em: agora(), evento: 'enviado à DrivIn' }] }
    : { ...base, ...(e[ref] || {}), tentouEm: agora(), erro: r.ok ? `a DrivIn não aceitou (${JSON.stringify(r.resposta?.skipped || []).slice(0, 120)})` : r.motivo };
  gravarEnvios(e);
  return aceito ? { ok: true, envio: e[ref] } : { ok: false, motivo: e[ref].erro };
}

/**
 * Pedidos PAGOS que ainda não foram pra DrivIn. Roda a cada pagamento confirmado
 * (o servidor chama junto com o funil). Pedido sem endereço não é tentado de novo
 * em loop: fica com o erro na tela até alguém mandar à mão.
 */
export async function sincronizar(pedidos = [], pagamentos = [], { pagos = ['CONFIRMADO', 'DISPONIVEL'], fetch } = {}) {
  const c = cfgBruta();
  if (!c.ligado || !c.enviarAoPagar) { return { enviados: 0 }; }
  const porId = new Map((pagamentos || []).map((p) => [String(p.id), p]));
  const e = envios(); let enviados = 0; const falhas = [];
  for (const p of pedidos || []) {
    if (!p.pagamentoId || !pagos.includes(porId.get(String(p.pagamentoId))?.estado)) { continue; }
    if (e[p.referencia]?.enviadoEm || e[p.referencia]?.tentouEm) { continue; }
    if (Date.now() - new Date(p.criadoEm || 0) > 3 * 86400000) { continue; } // pedido antigo (antes de ligar) não entra sozinho
    const r = await enviar(p, { fetch });
    if (r.ok && !r.repetido) { enviados++; } else if (!r.ok) { falhas.push(`${p.referencia}: ${r.motivo}`); }
  }
  return { enviados, falhas };
}

/* ───────── webhooks da DrivIn → mensagens pro cliente ───────── */
const hora = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); };
export const TEXTOS = {
  saiu: (e) => `🚚 Seu pedido *${e.referencia}* saiu pra entrega!${e.eta ? ` Previsão de chegada: por volta das *${hora(e.eta)}*.` : ''}${e.motorista ? ` Quem leva: ${e.motorista}.` : ''}`,
  entregue: (e) => `✅ Pedido *${e.referencia}* entregue${e.recebidoPor ? ` (recebido por ${e.recebidoPor})` : ''}. Obrigado pela preferência!${e.comprovante ? `\nComprovante: ${e.comprovante}` : ''}`,
  naoEntregue: (e) => `⚠️ Não conseguimos entregar o pedido *${e.referencia}*${e.motivo ? `: ${e.motivo}` : ''}. Responda aqui que a nossa equipe combina uma nova entrega com você.`,
};

function atualizar(ref, mudar) {
  const e = envios(); if (!e[ref]) { return null; }
  const antes = e[ref].status; e[ref] = mudar({ ...e[ref] }); gravarEnvios(e);
  return { envio: e[ref], mudou: antes !== e[ref].status };
}

/** Webhook de ROTA: cada pedido nosso na rota vira "saiu pra entrega" (uma vez). */
export function webhookRota(corpo = {}) {
  const c = cfgBruta(); const avisos = []; let achados = 0;
  const motorista = txt(corpo.driver?.full_name, 60) || null;
  for (const trip of corpo.trips || []) {
    for (const res of trip.results || []) {
      for (const o of res.orders || []) {
        const u = atualizar(String(o.code), (e) => (['entregue', 'nao-entregue', 'parcial'].includes(e.status) ? e : {
          ...e, status: 'em-rota', eta: res.eta_started || res.eta_approved || res.eta || e.eta || null, motorista: motorista || e.motorista || null,
          historico: [...(e.historico || []), { em: agora(), evento: `rota ${corpo.started_at ? 'iniciada' : 'aprovada'}${res.eta ? ` · previsão ${hora(res.eta)}` : ''}` }] }));
        if (!u) { continue; }
        achados++;
        if (u.mudou && c.avisos.saiu && !u.envio.avisouSaiu) { avisos.push({ referencia: u.envio.referencia, tipo: 'saiu', para: u.envio.endereco || u.envio.telefone, canal: u.envio.canal, texto: TEXTOS.saiu(u.envio) }); atualizar(u.envio.referencia, (e) => ({ ...e, avisouSaiu: agora() })); }
      }
    }
  }
  return { ok: true, achados, avisos };
}

const STATUS_POD = { approved: 'entregue', delivered: 'entregue', partial: 'parcial', rejected: 'nao-entregue', failed: 'nao-entregue', not_delivered: 'nao-entregue' };

/** Webhook de PROVA DE ENTREGA: entregue / não entregue (com motivo) / parcial. */
export function webhookProva(corpo = {}) {
  const c = cfgBruta(); const avisos = []; let achados = 0;
  const visitas = Array.isArray(corpo.response) ? corpo.response : Array.isArray(corpo) ? corpo : [corpo];
  for (const v of visitas) {
    const recebido = (v.custom_fields || []).find((f) => /firmado|recebido|assinado/i.test(f.title || ''))?.value || null;
    for (const o of v.orders || []) {
      const st = STATUS_POD[String(o.status || o.customer_status || '').toLowerCase()];
      if (!st) { continue; }
      const u = atualizar(String(o.code), (e) => ({ ...e, status: st, motivo: txt(o.reason || v.comment, 160) || null, recebidoPor: txt(recebido, 60) || null,
        comprovante: v.pdf_pod || v.tracking_url || null, entregueEm: o.pod_arrival || v.visit_leave || agora(),
        historico: [...(e.historico || []), { em: agora(), evento: st === 'entregue' ? 'entregue' : st === 'parcial' ? 'entrega parcial' : `não entregue${o.reason ? ` · ${o.reason}` : ''}` }] }));
      if (!u) { continue; }
      achados++;
      const tipo = st === 'nao-entregue' ? 'naoEntregue' : 'entregue';
      if (u.mudou && c.avisos[tipo]) { avisos.push({ referencia: u.envio.referencia, tipo, para: u.envio.endereco || u.envio.telefone, canal: u.envio.canal, texto: TEXTOS[tipo](u.envio), equipe: st !== 'entregue' }); }
    }
  }
  return { ok: true, achados, avisos };
}

/* ───────── "cadê meu pedido?" ───────── */
/* Sem acento antes de comparar: o \b do JavaScript não vê "ê" como letra. */
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const PERGUNTA = /\b(cade|onde (esta|ta)|ja saiu|vai chegar|quando chega|previsao|rastre\w*|status)\b.*\b(pedido|entrega|encomenda|compra|lanche)\b|\b(meu pedido|minha entrega|meu lanche)\b.*\b(cade|onde|chega|saiu|demora)\b/;
export const perguntouDoPedido = (texto) => PERGUNTA.test(semAcento(texto));

/** Resposta pro "cadê meu pedido?" com o último status da DrivIn (null = não sabemos; segue o bot). */
export function respostaStatus(telefone) {
  if (!cfgBruta().ligado) { return null; }
  const tel = String(telefone || '').replace(/\D/g, '');
  const e = Object.values(envios()).filter((x) => String(x.telefone || '').replace(/\D/g, '') === tel && x.enviadoEm).sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm))[0];
  if (!e) { return null; }
  if (e.status === 'em-rota') { return TEXTOS.saiu(e); }
  if (e.status === 'entregue' || e.status === 'parcial') { return TEXTOS.entregue(e); }
  if (e.status === 'nao-entregue') { return TEXTOS.naoEntregue(e); }
  return `📦 Seu pedido *${e.referencia}* já está com a nossa logística e entra na próxima rota de entrega. Assim que sair, eu te aviso por aqui.`;
}

/** Endereço de entrega a partir do que o fluxo coletou (chaves mais comuns dos modelos). */
export function entregaDoContexto(ctx = {}) {
  const endereco = ctx.endereco || ctx.end || ctx.endereco_entrega || ctx.enderecoEntrega || null;
  if (!endereco) { return null; }
  return { endereco: txt(endereco, 200), obs: txt(ctx.obs || ctx.observacao, 160) || null };
}
