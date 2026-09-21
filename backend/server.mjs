#!/usr/bin/env node
/**
 * QA-Gate licensing backend (stub). Roda na TUA VPS.
 * Recebe webhook do Stripe -> emite licença assinada -> entrega ao cliente.
 *
 * NÃO faz parte do pacote npm (é server-side, usa a chave privada).
 * A chave privada vem de env QA_GATE_PRIVATE_KEY (VPS) ou license/.keys/private.pem (local).
 *
 * Env:
 *   PORT                     porta (default 8787)
 *   STRIPE_WEBHOOK_SECRET    se setado, valida assinatura do Stripe
 *   QA_GATE_PRIVATE_KEY      chave privada Ed25519 (PEM) — preferir env na VPS
 *   MAIL_FROM / SMTP_*       (TODO) entrega por email
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueLicense } from '../license/issue.mjs';
import { sendLicense } from './whatsapp.mjs';
import * as acesso from './acesso.mjs';
import * as crm from '../engine/vscrm/index.mjs';
import { testarConexao, CREDENCIAL } from '../engine/vsinfluence/coletor.mjs';
import { diagnostico as tiktokDiagnostico } from '../engine/vstiktok/index.mjs';
import { testar as tiktokTestar } from '../engine/vstiktok/conectar.mjs';
import * as estoque from '../engine/vsestoque/index.mjs';
import * as vspainel from '../engine/vspainel/index.mjs';
import { painelQuebraGalho, QG_URL } from './quebragalho.mjs';
import * as tk from '../engine/vstiktok/index.mjs';
import { reservarEvento } from './idempotencia.mjs';
import * as atendimento from './atendimento.mjs';
import * as canais from './canais.mjs';
import * as pagar from '../engine/vspagamentos/index.mjs';
import * as fin from '../engine/vsfinanceiro/index.mjs';
import * as bot from '../engine/vsbot/index.mjs';
import * as docs from '../engine/vsdocumentos/index.mjs';
import * as midia from './midia.mjs';
import { pagina as paginaVitrine } from './vitrine.mjs';
import { lerCorpoLimitado, criarRateLimit, ipDe, segredoIgual, CORPO_MAX_BYTES } from './limites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/* Hora em toda linha de log. Sem isto, `tail` do arquivo mistura o que acabou de
   acontecer com o que quebrou uma hora atras — ja custou um diagnostico errado,
   com linha velha sendo lida como falha nova. */
for (const nivel of ['log', 'warn', 'error']) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args) => original(new Date().toISOString().slice(0, 19).replace('T', ' '), ...args);
}

const PORT = process.env.PORT || 8787;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CHECKOUT_URL = process.env.CHECKOUT_URL || ''; // Stripe Payment Link (opcional)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://api.velososolution.online';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''; // emissão admin on-demand (/issue)
// CRM: DESLIGADO por padrão. Este processo roda exposto na VPS e o CRM guarda nome e
// telefone de cliente — publicar sem querer seria vazamento. Ligar exige CRM_ENABLED=1
// e, se CRM_TOKEN estiver setado, o token em toda chamada.
const CRM_ENABLED = process.env.CRM_ENABLED === '1';
/**
 * Base das URLs de retorno do OAuth. Pode ser DIFERENTE do endereco do painel:
 * a TikTok so aceita redirect dentro de uma propriedade verificada, e a que esta
 * verificada aqui e o dominio raiz — nao o subdominio do painel. Fica gravada no
 * store pra sobreviver a reinicio sem depender de variavel de ambiente.
 */
function baseRedirect() {
  try {
    const c = tk.getConfig();
    if (c?.redirectBase) { return String(c.redirectBase).replace(/\/+$/, ''); }
  } catch { /* store indisponivel: cai no padrao */ }
  return (process.env.TIKTOK_REDIRECT_BASE || process.env.PAINEL_URL || 'https://painel.velososolution.com.br').replace(/\/+$/, '');
}

const HOST_PAINEL = (() => {
  try { return new URL(process.env.PAINEL_URL || 'https://painel.velososolution.com.br').hostname.toLowerCase(); }
  catch { return ''; }
})();
const CRM_TOKEN = process.env.CRM_TOKEN || '';

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://velososolution.online';
function cors(res) {
  res.setHeader('access-control-allow-origin', CORS_ORIGIN);
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/** Sentinela: quando o corpo estoura o teto, o handler responde 413 e para. */
const CORPO_GRANDE = Symbol('corpo-grande');

async function readBody(req) {
  const r = await lerCorpoLimitado(req, CORPO_MAX_BYTES);
  if (r.excedeu) { return CORPO_GRANDE; }
  return r.buffer;
}

/** true se o handler já respondeu por corpo grande demais. */
function corpoEstourou(res, raw) {
  if (raw !== CORPO_GRANDE) { return false; }
  json(res, 413, { error: `corpo acima de ${CORPO_MAX_BYTES} bytes` });
  return true;
}

// Cotas por IP. Emissão de licença é a rota cara: sem teto dava pra mintar chave em
// massa com um laço de shell. Em memória basta com um processo só; com mais de uma
// instância isto precisa ir pro Redis, senão cada uma conta sua própria cota.
const LIM_TRIAL = criarRateLimit({ max: Number(process.env.RATE_TRIAL || 5), janelaMs: 3600000 });
const LIM_CHECKOUT = criarRateLimit({ max: Number(process.env.RATE_CHECKOUT || 20), janelaMs: 3600000 });
const LIM_ISSUE = criarRateLimit({ max: Number(process.env.RATE_ISSUE || 60), janelaMs: 3600000 });
const LIM_CRM = criarRateLimit({ max: Number(process.env.RATE_CRM || 300), janelaMs: 60000 });

/** Aplica a cota; se estourou, responde 429 e devolve true. */
function barrado(res, limitador, req, oque) {
  const r = limitador.checar(ipDe(req));
  if (r.ok) { return false; }
  console.warn(`[rate] ${oque} bloqueado para ${ipDe(req)} — espera ${r.esperaSeg}s`);
  res.setHeader('retry-after', String(r.esperaSeg));
  json(res, 429, { error: `muitas tentativas em ${oque}; tente em ${r.esperaSeg}s` });
  return true;
}

const ALLOW_INSECURE = process.env.ALLOW_INSECURE_WEBHOOK === '1';

/** Verifica assinatura do Stripe (t=..,v1=..). Sem SDK — HMAC SHA256. */
async function verifyStripeSig(rawBody, sigHeader, secret) {
  if (!secret) { return ALLOW_INSECURE; } // prod: sem secret => rejeita (evita mint livre). Local: ALLOW_INSECURE_WEBHOOK=1
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) { return false; }
  const signed = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  try { return timingSafeEqual(Buffer.from(signed), Buffer.from(parts.v1)); } catch { return false; }
}

// tiers por porte = chave ETERNA (exp null) + atualizacoes. Compat: pro/mensal/trial.
const planToDays = { pequena: null, medio: null, grande: null, pro: null, mensal: 30, trial: 14 };
const PRICE_MAP = {
  pequena: process.env.STRIPE_PRICE_PEQUENA || '',
  medio: process.env.STRIPE_PRICE_MEDIO || '',
  grande: process.env.STRIPE_PRICE_GRANDE || '',
};

async function deliverLicense({ email, phone, name, token, plan }) {
  console.log(`[licenca] emitida para ${name || email} (${plan})`);
  const res = await sendLicense({ phone, key: token, name, plan });
  console.log(`[entrega] provider=${res.provider} ok=${res.ok}${res.link ? ' link=' + res.link : ''}`);
  return res;
}

/**
 * Traduz a entrega pra resposta HTTP. `entregue` só é true quando a mensagem SAIU
 * pela rede (spec §6). Quando fica pendente, devolve o motivo e o link manual, pra
 * ninguém achar que o cliente recebeu a chave quando ela só foi pro console.
 */
function entregaResumo(entrega) {
  if (!entrega) { return { entregue: false, entrega: { pendente: true, motivo: 'sem telefone valido para entrega' } }; }
  if (entrega.ok) { return { entregue: true, entrega: { provider: entrega.provider, id: entrega.id || null } }; }
  return {
    entregue: false,
    entrega: {
      pendente: true,
      provider: entrega.provider,
      motivo: entrega.error || 'entrega falhou',
      linkManual: entrega.link || null,
    },
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { return json(res, 200, { ok: true }); }

  /**
   * No host do PAINEL, a raiz e o console — nao a pagina de venda do QA-Gate.
   * O mesmo processo serve os dois, e quem digita "painel.velososolution.com.br"
   * esperando o CRM caia na landing page e conclui, com razao, que o console nao
   * carregou. O host vem de PAINEL_URL pra isto nao virar regra escondida no codigo.
   */
  if (req.method === 'GET' && req.url === '/' && CRM_ENABLED && HOST_PAINEL
      && String(req.headers.host || '').split(':')[0].toLowerCase() === HOST_PAINEL) {
    res.writeHead(302, { location: '/crm' });
    return res.end();
  }

  if (req.method === 'GET' && (req.url === '/' || req.url.split('?')[0] === '/comprar')) {
    try {
      let html = readFileSync(join(HERE, 'sales.html'), 'utf8');
      html = html.split('{{CHECKOUT_URL}}').join(CHECKOUT_URL || '#');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch (e) { return json(res, 500, { error: 'sales page: ' + e.message }); }
  }

  if (req.method === 'GET' && req.url.split('?')[0] === '/obrigado') {
    // A página prometia "a caminho do seu WhatsApp" mesmo com o provider em `log`,
    // quando nada era enviado. Agora o texto segue o que o servidor consegue fazer.
    const envia = process.env.WHATSAPP_PROVIDER === 'cloud' && !!process.env.WA_TOKEN && !!process.env.WA_PHONE_ID;
    const recado = envia
      ? 'Sua licença QA-Gate está a caminho do seu WhatsApp.'
      : 'Sua licença QA-Gate já foi emitida e será enviada em instantes.';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<meta charset=utf-8><body style="font-family:system-ui;background:#0b1220;color:#f2f4f7;text-align:center;padding:80px 20px"><h1>Pagamento confirmado ✅</h1><p style="color:#cfd6e4">${recado} Qualquer coisa: velososolution.online</p></body>`);
  }

  // preflight CORS do checkout (form vindo do site)
  if (req.method === 'OPTIONS' && req.url === '/checkout') {
    cors(res); res.writeHead(204); return res.end();
  }

  // cadastro (nome + WhatsApp) -> cria sessão de checkout no Stripe
  if (req.method === 'POST' && req.url === '/checkout') {
    cors(res);
    if (barrado(res, LIM_CHECKOUT, req, '/checkout')) { return; }
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    const name = String(data.name || '').trim().slice(0, 80);
    const phone = String(data.phone || '').replace(/\D/g, '').slice(0, 20);
    const plan = String(data.plan || 'pro').toLowerCase();
    if (!name || phone.length < 10) { return json(res, 400, { error: 'Informe nome e WhatsApp com DDD.' }); }
    const priceId = PRICE_MAP[plan] || STRIPE_PRICE_ID;
    if (!STRIPE_SECRET_KEY || !priceId) { return json(res, 503, { error: 'Pagamento ainda não configurado. Volte em breve.' }); }
    const p = new URLSearchParams();
    p.set('mode', 'payment');
    p.set('line_items[0][price]', priceId);
    p.set('line_items[0][quantity]', '1');
    p.set('phone_number_collection[enabled]', 'true');
    p.set('success_url', PUBLIC_URL + '/obrigado');
    p.set('cancel_url', PUBLIC_URL + '/');
    p.set('metadata[name]', name);
    p.set('metadata[phone]', phone);
    p.set('metadata[plan]', plan);
    try {
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: p,
      });
      const j = await r.json();
      if (!r.ok) { return json(res, 502, { error: 'Stripe: ' + (j.error?.message || 'erro') }); }
      return json(res, 200, { url: j.url });
    } catch (e) { return json(res, 502, { error: 'checkout: ' + e.message }); }
  }

  // ADMIN: emite chave de QUALQUER plano on-demand (protegido por ADMIN_TOKEN).
  // Ex.: curl -H "authorization: Bearer $ADMIN_TOKEN" -d '{"contato":"5531...","plan":"grande"}' .../issue
  if (req.method === 'POST' && req.url === '/issue') {
    cors(res);
    if (!ADMIN_TOKEN) { return json(res, 403, { error: 'emissão admin desativada (defina ADMIN_TOKEN)' }); }
    if (barrado(res, LIM_ISSUE, req, '/issue')) { return; }
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    // Comparacao em tempo constante: `!==` vaza pelo tempo quantos caracteres do
    // token ja estao certos, e o token do /issue emite licenca de qualquer plano.
    if (!segredoIgual(auth, ADMIN_TOKEN) && !segredoIgual(data.token, ADMIN_TOKEN)) {
      return json(res, 401, { error: 'token admin inválido' });
    }
    const plan = String(data.plan || 'pro').toLowerCase();
    const name = String(data.name || '').trim().slice(0, 80);
    const phone = String(data.whatsapp || data.phone || '').replace(/\D/g, '').slice(0, 20);
    const contato = phone || String(data.email || data.contato || '').trim().slice(0, 120);
    if (!contato) { return json(res, 400, { error: 'informe contato (whatsapp/email)' }); }
    const days = data.days != null ? Number(data.days) : (planToDays[plan] ?? 365);
    const token = issueLicense({ email: contato, plan, days });
    let entrega = null;
    if (phone.length >= 10 && data.entregar !== false) {
      // catch vazio escondia a falha e a resposta saia igual a de um envio bem-sucedido.
      try { entrega = await deliverLicense({ email: contato, phone, name, token, plan }); }
      catch (e) { console.error('[entrega] erro inesperado:', e.message); entrega = { ok: false, provider: 'erro', error: e.message }; }
    }
    return json(res, 200, { token, plan, days, ...entregaResumo(entrega) });
  }

  // preflight do trial (instalador)
  if (req.method === 'OPTIONS' && (req.url === '/trial' || req.url === '/issue')) { cors(res); res.writeHead(204); return res.end(); }

  // cadastro do TESTE -> emite chave trial POR CLIENTE (exp longo; o corte de 7 dias é
  // feito pela trava por data de instalação no cliente). Entrega best-effort no WhatsApp.
  if (req.method === 'POST' && req.url === '/trial') {
    cors(res);
    if (barrado(res, LIM_TRIAL, req, '/trial')) { return; }
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    const name = String(data.name || '').trim().slice(0, 80);
    const phone = String(data.whatsapp || data.phone || data.contato || '').replace(/\D/g, '').slice(0, 20);
    const contato = phone || String(data.email || data.contato || '').trim().slice(0, 120);
    if (!contato) { return json(res, 400, { error: 'Informe WhatsApp ou e-mail.' }); }
    const token = issueLicense({ email: contato, plan: 'trial', days: 3650 });
    let entrega = null;
    if (phone.length >= 10) {
      try { entrega = await deliverLicense({ email: contato, phone, name, token, plan: 'trial' }); }
      catch (e) { console.error('[entrega] erro inesperado:', e.message); entrega = { ok: false, provider: 'erro', error: e.message }; }
    }
    return json(res, 200, { token, plan: 'trial', ...entregaResumo(entrega) });
  }

  /**
   * Webhook do Asaas. Publico de proposito — quem chama e o servidor deles.
   * A trava e o token estatico no header `asaas-access-token` (eles NAO assinam
   * o corpo como o Stripe), conferido em tempo constante dentro do modulo.
   * Responde 200 tambem na reentrega: 4xx repetido faz a fila do Asaas PAUSAR
   * depois de 15 falhas, e ai nenhum pagamento e confirmado.
   */
  /**
   * Webhook de ENTRADA do WhatsApp (Meta Cloud API). E o canal do bot.
   *
   * GET  = aperto de mao da Meta: ela chama uma vez com hub.challenge e so
   *        registra a URL se o desafio voltar CRU, em texto puro.
   * POST = mensagem do cliente.
   *
   * Fica FORA do /crm de proposito: quem chama e a Meta, sem sessao do painel.
   * Quem protege aqui e a assinatura (WA_APP_SECRET), nao o token do console.
   */
  if (req.method === 'GET' && req.url.split('?')[0] === '/webhook/whatsapp') {
    const q = new URL(req.url, 'http://x').searchParams;
    const esperado = process.env.WA_VERIFY_TOKEN || '';
    if (!esperado) {
      console.error('[whatsapp] verificacao recusada: WA_VERIFY_TOKEN nao esta no ambiente');
      return json(res, 503, { erro: 'WA_VERIFY_TOKEN ausente no servidor' });
    }
    // segredoIgual: comparacao em tempo constante, igual ao resto do backend.
    if (q.get('hub.mode') === 'subscribe' && segredoIgual(q.get('hub.verify_token') || '', esperado)) {
      console.log('[whatsapp] webhook verificado pela Meta');
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(String(q.get('hub.challenge') || ''));
    }
    /* Diz o BASTANTE pra achar o erro de digitacao sem imprimir o segredo: quase
       sempre o token foi copiado pela metade (selecao de duplo clique para no
       separador) e o tamanho entrega isso na hora. */
    const rec = String(q.get('hub.verify_token') || '');
    console.error(`[whatsapp] verificacao recusada: token nao confere `
      + `(recebido ${rec.length} caracteres, esperado ${esperado.length}; `
      + `comeca "${rec.slice(0, 2)}", termina "${rec.slice(-2)}")`);
    return json(res, 403, { erro: 'verify_token nao confere' });
  }

  if (req.method === 'POST' && req.url.split('?')[0] === '/webhook/whatsapp') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const cru = buf.toString('utf8');

    const ass = atendimento.confereAssinatura(cru, req.headers['x-hub-signature-256'], process.env.WA_APP_SECRET || '');
    if (!ass.ok) {
      console.error(`[whatsapp] payload RECUSADO: ${ass.motivo}`);
      return json(res, 401, { erro: ass.motivo });
    }
    if (!ass.conferida) { console.warn(`[whatsapp] ${ass.motivo} — qualquer um que souber a URL consegue escrever na trilha`); }

    let evento; try { evento = JSON.parse(cru); } catch { return json(res, 400, { erro: 'payload invalido' }); }

    /* Responde 200 JA. A Meta reentrega tudo que nao receber 2xx rapido, e
       processar antes de responder transformaria uma resposta lenta do bot numa
       enxurrada de reentregas. A reentrega que vier mesmo assim para na trava de
       idempotencia, que e feita pelo id da mensagem la dentro. */
    json(res, 200, { received: true });

    atendimento.processarEvento(evento, { produtos: () => estoque.daVitrine().slice(0, 10) })
      .then((r) => {
        for (const x of r.resultados) {
          if (x.duplicado) { console.log(`[whatsapp] reentrega ignorada (${x.telefone})`); continue; }
          if (!x.ok) { console.error(`[whatsapp] ${x.motivo}`); continue; }
          if (x.semCrm) { console.warn(`[whatsapp] lead NAO criado para ${x.telefone}: ${x.semCrm}`); }
          if (x.leadNovo) { console.log(`[whatsapp] lead novo: ${x.leadId}`); }
          if (x.botDesligado) { console.log(`[whatsapp] bot desligado — mensagem de ${x.telefone} so registrada`); continue; }
          if (x.semTexto) { console.log(`[whatsapp] ${x.telefone} mandou algo sem texto — precisa de gente`); continue; }
          console.log(`[whatsapp] ${x.telefone}: ${x.tipo}${x.handoff ? ' (chamar gente)' : ''} -> ${x.respondeu ? 'respondido' : 'NAO enviado: ' + (x.envio?.error || '?')}`);
        }
      })
      .catch((e) => console.error('[whatsapp] falha ao processar evento:', e.message));
    return;
  }

  if (req.method === 'POST' && req.url === '/webhook/asaas') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    let evento; try { evento = JSON.parse(buf.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    const r = pagar.processarWebhook(req.headers, evento);
    /* Pagamento confirmado vira LANCAMENTO no caixa. E idempotente pela
       referencia: o mesmo pagamento reentregue nao entra duas vezes. Sem isto, o
       financeiro so mostrava promessa do funil e nunca o dinheiro que entrou. */
    if (r.ok && ['CONFIRMADO', 'DISPONIVEL'].includes(r.estado) && r.pagamento) {
      const l = fin.lancarPagamento(r.pagamento);
      if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${r.pagamento.id} lancada`); }
    }
    console.log(`[asaas] ${evento.event || '?'} ${evento.payment?.id || ''} -> ${r.ok ? r.estado : 'recusado: ' + r.motivo}`);
    return json(res, r.http || (r.ok ? 200 : 400), r);
  }

  if (req.method === 'POST' && req.url === '/webhook') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    const ok = await verifyStripeSig(raw, req.headers['stripe-signature'] || '', WEBHOOK_SECRET);
    if (!ok) { return json(res, 400, { error: 'assinatura Stripe inválida' }); }

    let event;
    try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'payload inválido' }); }

    // Idempotência (spec §24): o Stripe reentrega o mesmo evento quando não recebe 2xx.
    // Sem esta trava, cada reentrega emitia OUTRA licença pro mesmo pagamento.
    // Responde 200 na reentrega — 4xx faria o Stripe insistir para sempre.
    if (event.id && !reservarEvento(event.id, { tipo: event.type })) {
      console.log(`[webhook] evento ${event.id} ja processado — reentrega ignorada`);
      return json(res, 200, { received: true, duplicado: true, issued: false });
    }

    if (event.type === 'checkout.session.completed') {
      const s = event.data?.object || {};
      const email = s.customer_details?.email || s.customer_email || 'sem-email';
      const phone = s.customer_details?.phone || s.metadata?.phone || '';
      const name = s.customer_details?.name || s.metadata?.name || '';
      const plan = (s.metadata?.plan || 'pro').toLowerCase();
      const token = issueLicense({ email, plan, days: planToDays[plan] ?? 365 });
      const entrega = await deliverLicense({ email, phone, name, token, plan });
      return json(res, 200, { received: true, issued: true, email, phone: !!phone, plan, ...entregaResumo(entrega) });
    }
    return json(res, 200, { received: true, issued: false });
  }

  /**
   * Retorno do OAuth das redes sociais. Fica FORA do /crm de proposito: quem chega
   * aqui e o navegador redirecionado pela rede, sem o header de sessao do painel.
   * O `state` e conferido dentro de `concluirAutorizacao` — e o que impede alguem
   * mandar um `code` forjado.
   */
  /* Arquivo de verificacao de dominio da TikTok. Fica na RAIZ porque e la que ela
     procura, e antes do resto do roteamento porque o nome vem deles — nao da pra
     reservar um prefixo nosso. So responde o arquivo exatamente cadastrado. */
  if (req.method === 'GET' && /^(\/[A-Za-z0-9._-]{1,64}){0,6}\/[A-Za-z0-9._-]{1,64}\.txt$/.test(req.url.split('?')[0])) {
    const v = tk.servirVerificacao(req.url);
    if (v) {
      res.writeHead(200, { 'content-type': v.tipo });
      return res.end(v.conteudo);
    }
  }

  /* Vitrine — loja PUBLICA. Sem sessao de proposito: quem abre e cliente final,
     pelo link que o dono manda no WhatsApp. So produto marcado como exposto e
     ativo aparece; esgotado aparece marcado, nao sumido — sumir da a impressao
     de que a loja e menor do que e. */
  if (req.method === 'GET' && (req.url === '/vitrine' || req.url.split('?')[0] === '/vitrine')) {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
      return res.end(paginaVitrine(estoque.daVitrine(), {
        nome: process.env.VITRINE_NOME || 'Veloso Solution',
        descricao: process.env.VITRINE_DESCRICAO,
        whatsapp: process.env.VITRINE_WHATSAPP,
      }));
    } catch (e) { return json(res, 500, { erro: 'vitrine: ' + e.message }); }
  }

  /* Arquivo de midia. Publico porque quem baixa e o servidor da TikTok, sem
     sessao nenhuma: o `PULL_FROM_URL` manda ELA buscar o video. O nome e gerado
     por nos e conferido antes de tocar no disco. */
  if (req.method === 'GET' && req.url.split('?')[0].startsWith('/midia/')) {
    const nome = decodeURIComponent(req.url.split('?')[0].slice('/midia/'.length));
    if (midia.servir(req, res, nome)) { return; }
    return json(res, 404, { erro: 'midia nao encontrada' });
  }

  if (req.url.split('?')[0].startsWith('/oauth/callback/')) {
    const u = new URL(req.url, 'http://x');
    const familia = u.pathname.split('/')[3] || '';
    const code = u.searchParams.get('code') || u.searchParams.get('auth_code');
    const erro = u.searchParams.get('error');
    /* Registra TODA chegada. Sem isto, "nao apareceu token" e indistinguivel de
       "a rede nem chamou de volta" — e sao problemas opostos: um e nosso, o outro
       e do app la. O code nao vai pro log; so o fato de ter vindo. */
    console.log(`[oauth] ${familia} <- code:${code ? 'sim' : 'nao'} erro:${erro || '-'} `
      + `descricao:${u.searchParams.get('error_description') || '-'} state:${u.searchParams.get('state') ? 'veio' : 'faltou'}`);
    const pagina = (titulo, texto, ok) => {
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="font-family:system-ui,sans-serif;background:#fafafa;color:#18181b;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:30rem;padding:2rem;text-align:center">
<div style="font-size:2.6rem;color:${ok ? '#15803d' : '#b91c1c'}">${ok ? '✓' : '✖'}</div>
<h1 style="font-size:1.2rem;margin:.6rem 0">${titulo}</h1>
<p style="color:#52525b;line-height:1.55">${texto}</p>
<p style="margin-top:1.4rem"><a href="/crm#redes" style="color:#18181b">Voltar ao painel</a></p>
</div></body></html>`);
    };

    if (erro) { return pagina('A rede recusou', `Motivo: ${erro}. Nada foi salvo.`, false); }
    /* Visita SECA (sem code, sem erro, sem state) nao e um retorno falhado: e o
       verificador da rede conferindo se a URL existe, ou alguem abrindo o link na
       mao. Respondia 400, e pro verificador da TikTok 400 significa "essa URL nao
       presta" — a verificacao de propriedade falhava por causa do nosso codigo de
       status, com a pagina certa na tela. */
    if (!code && !u.search) {
      return pagina('URL de retorno do TikTok', 'Esta página existe para receber a volta da autorização. '
        + 'Não há nada a fazer aqui — a conexão começa no painel, em Conexões com redes sociais.', true);
    }
    if (!code) { return pagina('Retorno sem código', 'A rede voltou sem o código de autorização.', false); }
    try {
      const r = await tk.concluirAutorizacao(familia, code, { state: u.searchParams.get('state') });
      console.log(`[oauth] ${familia} troca do code -> ${r.ok ? 'OK, token guardado' : 'FALHOU: ' + r.motivo}`);
      if (!r.ok) { return pagina('Não consegui concluir', r.motivo, false); }
      return pagina('Conta conectada', `A conta do TikTok (${familia}) está ligada ao painel. Pode fechar esta aba.`, true);
    } catch (e) {
      return pagina('Erro ao concluir', e.message, false);
    }
  }

  // ---- VScrm (opt-in: CRM_ENABLED=1) ----
  if (CRM_ENABLED && req.url.split('?')[0].startsWith('/crm')) {
    const rota = req.url.split('?')[0];
    if (req.method === 'GET' && rota === '/crm') {
      try {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(readFileSync(join(HERE, 'crm.html'), 'utf8'));
      } catch (e) { return json(res, 500, { erro: 'crm page: ' + e.message }); }
    }
    // O token do painel chega no header; o ?t= da URL só alimenta o header no front.
    if (barrado(res, LIM_CRM, req, '/crm')) { return; }

    /**
     * Login do painel. Existe para o dashboard NAO aparecer antes de alguem provar
     * que pode ve-lo — sem isso, qualquer um com a URL via nome e telefone de cliente.
     * A comparacao e em tempo constante (segredoIgual), e a rota diz quando o
     * CRM_TOKEN nao esta configurado em vez de deixar o painel aberto em silencio.
     */
    if (req.method === 'GET' && rota === '/crm/api/auth') {
      return json(res, 200, acesso.estado());
    }

    /* Primeiro acesso. Quem comprou a licenca abre o console e define a
       propria senha aqui — sem terminal, sem variavel de ambiente, sem
       ninguem ter que "passar" credencial. So funciona enquanto nao houver
       senha: depois disso a rota fecha, senao qualquer um com a URL
       trocaria a senha de um console ja configurado. */
    if (req.method === 'POST' && rota === '/crm/api/criar-acesso') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      try {
        acesso.criar(d.senha);
        console.log(`[${new Date().toISOString()}] senha do console definida no primeiro acesso`);
        return json(res, 201, { ok: true });
      } catch (e) {
        return json(res, e.code || 400, { erro: e.message });
      }
    }

    if (req.method === 'POST' && rota === '/crm/api/entrar') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      if (acesso.precisaCriar()) {
        return json(res, 409, { erro: 'primeiro acesso', precisaCriar: true });
      }
      if (!acesso.confere(d.senha)) { return json(res, 401, { erro: 'senha incorreta' }); }
      return json(res, 200, { ok: true });
    }

    /* Troca de senha, ja de dentro do console e com a atual na mao. */
    if (req.method === 'POST' && rota === '/crm/api/trocar-senha') {
      if (!acesso.confere(req.headers['x-crm-token'])) {
        return json(res, 403, { erro: 'sessao invalida' });
      }
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      try { acesso.trocar(d.atual, d.nova); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, e.code || 400, { erro: e.message }); }
    }

    /* Daqui para baixo e dado de cliente. Sem senha definida, o console fica
       fechado: antes, CRM_TOKEN vazio liberava o painel inteiro em silencio
       para quem tivesse a URL. */
    if (!acesso.confere(req.headers['x-crm-token'])) {
      return json(res, 403, acesso.precisaCriar()
        ? { erro: 'console sem senha definida', precisaCriar: true }
        : { erro: 'senha ausente ou invalida' });
    }
    if (req.method === 'GET' && rota === '/crm/api/painel') { return json(res, 200, crm.painel()); }
    if (req.method === 'GET' && rota === '/crm/api/status') { return json(res, 200, crm.statusIntegracoes()); }
    if (req.method === 'GET' && rota === '/crm/api/indicacao') { return json(res, 200, crm.painelIndicacao()); }
    if (req.method === 'GET' && rota === '/crm/api/redes') { return json(res, 200, { credenciais: CREDENCIAL }); }
    // TikTok: o painel LE o estado e MANDA testar, mas nao grava credencial por HTTP.
    // Gravar token via endpoint web contradiz a regra desta tela ("a credencial nao
    // fica gravada") e poria app_secret num POST. A configuracao mora na CLI, que
    // guarda em ~/.qa-gate/vstiktok com arquivo 0600. O diagnostico ja sai mascarado.
    if (req.method === 'GET' && rota === '/crm/api/tiktok') { return json(res, 200, tiktokDiagnostico()); }
    if (req.method === 'GET' && rota === '/crm/api/estoque') { return json(res, 200, estoque.painel()); }
    // Telas que eram casca: leem recibo do gate, dinheiro e cruzamento de dado real.
    if (req.method === 'GET' && rota === '/crm/api/auditor') { return json(res, 200, await vspainel.painelAuditor()); }
    if (req.method === 'GET' && rota === '/crm/api/financeiro') { return json(res, 200, await vspainel.painelFinanceiro()); }
    if (req.method === 'GET' && rota === '/crm/api/relatorios') { return json(res, 200, await vspainel.painelRelatorios()); }
    if (req.method === 'GET' && rota === '/crm/api/conta') { return json(res, 200, await vspainel.painelConta()); }
    // O Quebra-Galho é produto separado, com servidor proprio. O painel fala com ele
    // por HTTP — nao por import. Assim ele aparece aqui dentro sem que um vire
    // dependencia de compilacao do outro, e fora do ar vira aviso, nao tela quebrada.
    if (req.method === 'GET' && rota === '/crm/api/quebragalho') { return json(res, 200, await painelQuebraGalho()); }
    if (req.method === 'GET' && rota === '/crm/api/tiktok/app') {
      // O redirect e FIXO e derivado do dominio do painel — nao ha o que o usuario
      // digitar errado, e ele so cola esse valor uma vez no painel do TikTok.
      const origem = baseRedirect();
      return json(res, 200, {
        diagnostico: tk.diagnostico(),
        redirects: ['open', 'business', 'shop'].reduce((a, f) => ({ ...a, [f]: `${origem}/oauth/callback/${f}` }), {}),
        origem,
        verificacao: tk.getVerificacao(),
      });
    }
    /* Upload do video. NAO passa pelo leitor de JSON (teto de 256 KB): vai
       direto pro disco em streaming, com teto proprio. */
    if (req.method === 'POST' && rota === '/crm/api/midia') {
      if (!acesso.confere(req.headers['x-crm-token'])) { return json(res, 403, { erro: 'senha ausente ou invalida' }); }
      const u = new URL(req.url, 'http://x');
      const nome = u.searchParams.get('nome') || '';
      /* Foto e video entram pela mesma porta mas com tetos diferentes: 256 MB de
         JPEG numa vitrine so serve pra deixar a loja lenta pro cliente. */
      const imagem = u.searchParams.get('tipo') === 'imagem'
        || String(req.headers['content-type'] || '').startsWith('image/');
      const r = await midia.receber(req, nome, imagem
        ? { padrao: '.jpg', maxBytes: midia.MAX_IMAGEM_BYTES }
        : { padrao: '.mp4', maxBytes: midia.MAX_BYTES });
      if (!r.ok) { return json(res, 413, { erro: r.motivo }); }
      const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
      return json(res, 201, { ...r, imagem, url: `${origem}/midia/${r.arquivo}` });
    }
    if (req.method === 'GET' && rota === '/crm/api/midia') {
      if (!acesso.confere(req.headers['x-crm-token'])) { return json(res, 403, { erro: 'senha ausente ou invalida' }); }
      const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
      return json(res, 200, { arquivos: midia.listar().map((a) => ({ ...a, url: `${origem}/midia/${a.arquivo}` })), maxBytes: midia.MAX_BYTES });
    }
    if (req.method === 'GET' && rota === '/crm/api/tiktok/publicacao') {
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      return json(res, 200, await tk.statusPublicacao(id));
    }
    /* `/financeiro` ja era o consolidado do VSpainel (receita do funil, estoque
       parado). O livro-caixa e outra coisa e ganha nome proprio — duas rotas com
       o mesmo caminho fazem a segunda nunca responder, calada. */
    /* Canais. O QR vai junto do status de proposito: a tela pergunta "como esta
       o canal" e recebe o que precisa desenhar, sem uma segunda rota so pro QR
       que poderia responder um codigo ja vencido. */
    if (req.method === 'GET' && rota === '/crm/api/canais') {
      return json(res, 200, { ...canais.estado(), saude: await canais.saude() });
    }
    if (req.method === 'GET' && rota === '/crm/api/bot') { return json(res, 200, bot.painel()); }
    if (req.method === 'GET' && rota === '/crm/api/documentos') { return json(res, 200, docs.painel()); }
    if (req.method === 'GET' && rota === '/crm/api/caixa') {
      const u = new URL(req.url, 'http://x');
      return json(res, 200, fin.painel({ de: u.searchParams.get('de'), ate: u.searchParams.get('ate') }));
    }
    if (req.method === 'GET' && rota === '/crm/api/pagamentos') {
      const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
      return json(res, 200, {
        painel: pagar.painel(),
        pagamentos: pagar.listar().slice(-40).reverse(),
        urlWebhook: `${origem}/webhook/asaas`,
      });
    }
    /* Um produto so — a tela de ver/editar nao deve baixar o catalogo inteiro. */
    if (req.method === 'GET' && rota === '/crm/api/estoque/produto') {
      const sku = new URL(req.url, 'http://x').searchParams.get('sku') || '';
      const p = estoque.obter(sku);
      if (!p) { return json(res, 404, { erro: `produto "${sku}" nao encontrado` }); }
      return json(res, 200, { produto: p, historico: estoque.historico(sku, 20) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/publicados') {
      const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
      return json(res, 200, { publicados: estoque.publicados(), urlVitrine: `${origem}/vitrine`, reservas: estoque.reservas().slice(0, 100) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/reservas') {
      return json(res, 200, { reservas: estoque.reservas(), excluidos: estoque.excluidos().map(estoque.resumir) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/lotes') {
      const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
      return json(res, 200, {
        lotes: estoque.lotes(),
        canais: estoque.FORMATOS,
        urlVitrine: `${origem}/vitrine`,
        vitrineConfigurada: Boolean(process.env.VITRINE_WHATSAPP),
      });
    }
    /* Download do lote: sai como ARQUIVO, com o conteudo CONGELADO no momento da
       criacao — regerar agora daria outro resultado, e ai "reimportar o lote 7"
       nao quer dizer mais nada. */
    if (req.method === 'GET' && rota === '/crm/api/estoque/lote') {
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      const l = estoque.obterLote(id);
      if (!l) { return json(res, 404, { erro: `lote "${id}" nao encontrado` }); }
      res.writeHead(200, {
        'content-type': l.tipo,
        'content-disposition': `attachment; filename="${l.id}-${l.arquivo}"`,
        'x-vs-incluidos': String(l.incluidos),
        'x-vs-recusados': String(l.recusados.length),
      });
      return res.end(l.conteudo);
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/historico') {
      return json(res, 200, { movimentos: estoque.historico(new URL(req.url, 'http://x').searchParams.get('sku')) });
    }
    // Download do feed: sai como ARQUIVO, nao como JSON — e o que o Google e a Meta
    // consomem. Os recusados vao no header, pra tela poder avisar sem baixar duas vezes.
    if (req.method === 'GET' && rota === '/crm/api/estoque/exportar') {
      const canal = new URL(req.url, 'http://x').searchParams.get('canal') || 'json';
      const r = estoque.exportar(canal, { loja: process.env.VSESTOQUE_LOJA, site: process.env.VSESTOQUE_SITE });
      if (!r.ok) { return json(res, 400, { erro: r.motivo }); }
      res.writeHead(200, {
        'content-type': r.tipo,
        'content-disposition': `attachment; filename="${r.arquivo}"`,
        'x-vs-incluidos': String(r.incluidos),
        'x-vs-recusados': String(r.recusados.length),
      });
      return res.end(r.conteudo);
    }
    if (req.method === 'POST' && rota === '/crm/api/tiktok/testar') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const familia = String(d.familia || '').toLowerCase();
      if (!['open', 'business', 'shop'].includes(familia)) { return json(res, 400, { erro: 'familia invalida' }); }
      return json(res, 200, await tiktokTestar(familia));
    }
    // Teste de conexao: a credencial e USADA e descartada — nao gravamos token aqui.
    if (req.method === 'POST' && rota === '/crm/api/redes/testar') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = await testarConexao(d.rede, d.cred || {});
      return json(res, 200, r);
    }
    if (req.method === 'POST' && rota.startsWith('/crm/api/')) {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      let r;
      switch (rota) {
        case '/crm/api/perfil': r = vspainel.salvarPerfil(d); break;
        case '/crm/api/tiktok/verificacao':
          r = d.limpar ? tk.limparVerificacao() : tk.salvarVerificacao(d);
          break;
        case '/crm/api/tiktok/app': {
          r = tk.salvarCredencial(d.familia, { ...d.cred, redirectUri: `${baseRedirect()}/oauth/callback/${d.familia}` });
          break;
        }
        /* Onde a rede vai devolver a pessoa. So aceita o que RESPONDE de verdade:
           salvar um endereco que nao existe faria a autorizacao falhar la na
           frente, longe de quem digitou. */
        case '/crm/api/tiktok/redirect-base': {
          const base = String(d.base || '').trim().replace(/\/+$/, '');
          if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) { r = { ok: false, motivo: 'informe um endereco https, so o dominio' }; break; }
          try {
            const teste = await fetch(`${base}/oauth/callback/open`, { redirect: 'manual' });
            if (!teste.ok) { r = { ok: false, motivo: `${base}/oauth/callback/open respondeu ${teste.status} — esse endereco nao serve` }; break; }
          } catch (e) { r = { ok: false, motivo: `nao consegui alcancar ${base}: ${e.message}` }; break; }
          tk.salvarConfig({ redirectBase: base });
          r = { ok: true, base };
          break;
        }
        case '/crm/api/tiktok/autorizar': {
          const origem = baseRedirect();
          /* Pede o MINIMO por padrao. Escopo que o app ainda nao teve aprovado
             derruba a autorizacao inteira com "access_denied" — e o erro nao diz
             qual escopo foi, entao quem pede tudo de uma vez fica sem saber se o
             problema e a conta, o app ou o redirect. A tela marca o que quer a
             mais; aqui so passa o que esta na lista conhecida. */
          const permitidos = new Set(Object.values(tk.auth.ESCOPOS));
          const pedidos = Array.isArray(d.escopos) ? d.escopos.filter((e) => permitidos.has(e)) : [];
          const escopos = [tk.auth.ESCOPOS.perfil, ...pedidos.filter((e) => e !== tk.auth.ESCOPOS.perfil)];
          r = tk.iniciarAutorizacao(d.familia, {
            redirectUri: `${origem}/oauth/callback/${d.familia}`,
            escopos,
            serviceId: d.serviceId,
          });
          break;
        }
        /* A chave do Asaas ENTRA por aqui e nunca mais sai: o diagnostico so
           devolve mascarado. Guardar e inevitavel — cobranca e chamada autenticada. */
        case '/crm/api/pagamentos/config': r = pagar.configurar(d); break;
        case '/crm/api/pagamentos/cobrar': {
          // Cliente primeiro: o Asaas recusa cobranca sem `customer`, e o
          // documento e obrigatorio do lado dele.
          const c = await pagar.garantirCliente({ nome: d.nome, cpfCnpj: d.cpfCnpj, email: d.email, telefone: d.telefone });
          if (!c.ok) { r = { ok: false, erro: c.motivo }; break; }
          const cob = await pagar.cobrar({
            clienteId: c.clienteId,
            metodo: d.metodo,
            valorCentavos: Number(d.valorCentavos),
            vencimento: d.vencimento,
            descricao: d.descricao,
            referencia: d.referencia,
          });
          if (!cob.ok) { r = { ok: false, erro: cob.motivo }; break; }
          // Pix so tem QR depois de criada a cobranca — por isso vem aqui, nao antes.
          const qr = String(d.metodo).toUpperCase() === 'PIX' ? await pagar.qrPix(cob.pagamento.id) : null;
          r = { ...cob, clienteReusado: c.reusado, pix: qr?.ok ? qr.pix : null, pixErro: qr && !qr.ok ? qr.motivo : null };
          break;
        }
        case '/crm/api/tiktok/publicar': {
          // App ainda nao auditado so publica privado. Mandar publico nesse estado
          // faz a TikTok recusar — melhor avisar do que deixar falhar la.
          r = await tk.publicarVideo({
            videoUrl: d.videoUrl,
            titulo: d.titulo,
            privacidade: d.privacidade || 'SELF_ONLY',
          });
          break;
        }
        case '/crm/api/documentos/rascunho': r = docs.salvarRascunho(d.tipo, d.texto, { vigenteDe: d.vigenteDe }); break;
        case '/crm/api/documentos/publicar': r = docs.publicar(d.tipo, { vigenteDe: d.vigenteDe }); break;
        case '/crm/api/documentos/descartar': r = docs.descartarRascunho(d.tipo); break;
        case '/crm/api/documentos/aceite': r = docs.registrarAceite(d.tipo, d.quem || {}); break;
        case '/crm/api/documentos/conferir': r = docs.conferirAceite(d.id); break;
        case '/crm/api/canais/conectar':
          r = await canais.conectar({ canal: d.canal, produtos: () => estoque.daVitrine().slice(0, 10) });
          break;
        case '/crm/api/canais/desconectar': r = await canais.desconectar({ canal: d.canal }); break;
        case '/crm/api/canais/enviar': r = await canais.enviar(d); break;
        case '/crm/api/bot/config': r = bot.salvarConfig(d); break;
        case '/crm/api/bot/regra': r = bot.salvarRegra(d); break;
        case '/crm/api/bot/regra-excluir': r = bot.excluirRegra(d.id); break;
        case '/crm/api/bot/fluxo-csv': r = bot.importarFluxoCsv(String(d.csv || '')); break;
        case '/crm/api/bot/fluxo-apagar': r = bot.apagarFluxo(); break;
        /* Simulador: o catalogo real entra como contexto, entao o teste mostra o
           que o cliente veria de verdade — nao um exemplo inventado. */
        case '/crm/api/bot/simular': {
          r = { ok: true, ...bot.simular(d.mensagens || [], {
            nome: d.nome || 'Cliente',
            empresa: process.env.VITRINE_NOME || 'nossa loja',
            produtos: estoque.daVitrine().slice(0, 10),
          }) };
          break;
        }
        case '/crm/api/caixa': r = fin.criar(d); break;
        case '/crm/api/caixa/editar': r = fin.editar(d.id, d.mudancas || {}); break;
        case '/crm/api/caixa/excluir': r = fin.excluir(d.id, { motivo: d.motivo }); break;
        case '/crm/api/caixa/restaurar': r = fin.restaurar(d.id); break;
        case '/crm/api/estoque/produto': r = estoque.criar(d); break;
        case '/crm/api/estoque/editar': r = estoque.editar(d.sku, d.mudancas || {}); break;
        case '/crm/api/estoque/movimentar': r = estoque.movimentar(d.sku, d); break;
        case '/crm/api/estoque/excluir': r = estoque.excluir(d.sku); break;
        case '/crm/api/estoque/restaurar': r = estoque.restaurar(d.sku); break;
        case '/crm/api/estoque/esquecer-canal': r = estoque.esquecerCanal(d.sku, d.canal); break;
        /* Comprar = entrada de mercadoria. Fica separado de `movimentar` porque
           carrega custo e fornecedor, que vao pro historico. */
        case '/crm/api/estoque/comprar': {
          r = estoque.movimentar(d.sku, {
            tipo: 'entrada',
            quantidade: Number(d.quantidade),
            motivo: d.fornecedor ? `compra — ${d.fornecedor}` : 'compra',
            ref: d.nota || null,
          });
          break;
        }
        case '/crm/api/estoque/reservar': r = estoque.reservar(d.sku, Number(d.quantidade), { chave: d.chave, canal: d.canal }); break;
        case '/crm/api/estoque/confirmar': r = estoque.confirmarReserva(d.chave); break;
        case '/crm/api/estoque/cancelar-reserva': r = estoque.cancelarReserva(d.chave); break;
        case '/crm/api/estoque/vitrine': r = estoque.vitrine(d.sku, d.expor !== false); break;
        /* "Vender" = mandar pro TikTok Shop. Enquanto a loja nao esta ligada, a
           resposta diz O QUE falta em vez de um erro seco — o produto ja fica
           marcado pra vitrine, que e o canal que funciona sem aprovacao. */
        /* VENDER, na ordem que a especificacao manda: valida -> RESERVA idempotente
           -> encaminha pro canal. A baixa do saldo NAO acontece aqui; ela espera a
           confirmacao do canal (POST /crm/api/estoque/confirmar). */
        case '/crm/api/estoque/vender': {
          const p = estoque.obter(d.sku);
          if (!p) { r = { ok: false, motivo: `produto "${d.sku}" nao encontrado` }; break; }
          const qtd = Number(d.quantidade) || 1;
          // Chave estavel: o mesmo clique repetido nao reserva de novo.
          const chave = String(d.chave || `${d.sku}:${d.canal || 'tiktok'}:${qtd}:${new Date().toISOString().slice(0, 13)}`);
          const res = estoque.reservar(d.sku, qtd, { chave, canal: d.canal || 'tiktok' });
          if (!res.ok) { r = { ok: false, motivo: res.erro || res.motivo }; break; }

          const shop = tk.diagnostico().familias.shop;
          if (!shop.autorizado) {
            estoque.vitrine(d.sku, true);
            r = {
              ok: false,
              motivo: 'a loja do TikTok ainda não está conectada',
              falta: shop.appConfigurado
                ? ['autorizar a conta em Conexões com redes sociais']
                : ['cadastrar o app do TikTok Shop em Conexões com redes sociais: ' + (shop.faltando || []).join(', ')],
              naVitrine: true,
              reserva: res.reserva,
            };
            break;
          }
          const env = await estoque.publicarNoTiktok(d.sku, {
            armazemId: d.armazemId || process.env.TIKTOK_ARMAZEM_ID,
            categoriaId: d.categoriaId || process.env.TIKTOK_CATEGORIA_ID,
          });
          r = { ...env, reserva: res.reserva };
          break;
        }
        case '/crm/api/estoque/lote': r = estoque.criarLote(d); break;
        case '/crm/api/estoque/lote-excluir': r = estoque.excluirLote(d.id); break;
        case '/crm/api/funil': r = crm.setFunil(d.etapas); break;
        case '/crm/api/leads': r = crm.criar(d); break;
        case '/crm/api/mover': r = crm.mover(d.id, d.etapa); break;
        case '/crm/api/fechar': r = crm.encerrar(d.id, d.status, d.motivo); break;
        case '/crm/api/indicacao': r = crm.setRegraIndicacao(d); break;
        case '/crm/api/parceiros': r = crm.criarParceiro(d); break;
        case '/crm/api/parceiros/remover': r = crm.removerParceiro(d.id); break;
        default: return json(res, 404, { erro: 'rota de CRM desconhecida' });
      }
      /* Tres formatos de recusa convivem aqui: {erros:[...]} nos modulos de
         cadastro, {motivo:'...'} nos de integracao (pagamentos, lote, tiktok) e
         {erro} nos antigos. Faltava o `motivo`: a recusa virava o generico "nao
         foi possivel concluir" e a pessoa perdia a unica frase que dizia O QUE
         estava errado — "nenhum produto alterado nesse periodo" virava nada. */
      if (r && r.ok === false && !r.erro) {
        r = { ...r, erro: (r.erros || []).join('; ') || r.motivo || 'nao foi possivel concluir' };
      }
      return json(res, (r?.erro || r?.ok === false) ? 400 : 200, r);
    }
    return json(res, 404, { erro: 'rota de CRM desconhecida' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`[qa-gate-backend] ouvindo em :${PORT} (webhook /webhook, health /health)`));
