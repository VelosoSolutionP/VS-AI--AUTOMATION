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
import * as pagar from '../engine/vspagamentos/index.mjs';
import { lerCorpoLimitado, criarRateLimit, ipDe, segredoIgual, CORPO_MAX_BYTES } from './limites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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
  if (req.method === 'POST' && req.url === '/webhook/asaas') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    let evento; try { evento = JSON.parse(buf.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    const r = pagar.processarWebhook(req.headers, evento);
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
  if (req.method === 'GET' && /^\/[A-Za-z0-9._-]{1,64}\.txt$/.test(req.url.split('?')[0])) {
    const v = tk.servirVerificacao(req.url);
    if (v) {
      res.writeHead(200, { 'content-type': v.tipo });
      return res.end(v.conteudo);
    }
  }

  if (req.url.split('?')[0].startsWith('/oauth/callback/')) {
    const u = new URL(req.url, 'http://x');
    const familia = u.pathname.split('/')[3] || '';
    const code = u.searchParams.get('code') || u.searchParams.get('auth_code');
    const erro = u.searchParams.get('error');
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
    if (!code) { return pagina('Retorno sem código', 'A rede voltou sem o código de autorização.', false); }
    try {
      const r = await tk.concluirAutorizacao(familia, code, { state: u.searchParams.get('state') });
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
      const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
      return json(res, 200, {
        diagnostico: tk.diagnostico(),
        redirects: ['open', 'business', 'shop'].reduce((a, f) => ({ ...a, [f]: `${origem}/oauth/callback/${f}` }), {}),
        origem,
        verificacao: tk.getVerificacao(),
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/pagamentos') {
      const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
      return json(res, 200, {
        painel: pagar.painel(),
        pagamentos: pagar.listar().slice(-40).reverse(),
        urlWebhook: `${origem}/webhook/asaas`,
      });
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
          const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
          r = tk.salvarCredencial(d.familia, { ...d.cred, redirectUri: `${origem}/oauth/callback/${d.familia}` });
          break;
        }
        case '/crm/api/tiktok/autorizar': {
          const origem = process.env.PAINEL_URL || 'https://painel.velososolution.com.br';
          r = tk.iniciarAutorizacao(d.familia, {
            redirectUri: `${origem}/oauth/callback/${d.familia}`,
            escopos: d.publicar ? [...tk.auth.ESCOPOS_PADRAO, tk.auth.ESCOPOS.publicar, tk.auth.ESCOPOS.enviar] : undefined,
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
        case '/crm/api/estoque/produto': r = estoque.criar(d); break;
        case '/crm/api/estoque/editar': r = estoque.editar(d.sku, d.mudancas || {}); break;
        case '/crm/api/estoque/movimentar': r = estoque.movimentar(d.sku, d); break;
        case '/crm/api/estoque/excluir': r = estoque.excluir(d.sku); break;
        case '/crm/api/funil': r = crm.setFunil(d.etapas); break;
        case '/crm/api/leads': r = crm.criar(d); break;
        case '/crm/api/mover': r = crm.mover(d.id, d.etapa); break;
        case '/crm/api/fechar': r = crm.encerrar(d.id, d.status, d.motivo); break;
        case '/crm/api/indicacao': r = crm.setRegraIndicacao(d); break;
        case '/crm/api/parceiros': r = crm.criarParceiro(d); break;
        case '/crm/api/parceiros/remover': r = crm.removerParceiro(d.id); break;
        default: return json(res, 404, { erro: 'rota de CRM desconhecida' });
      }
      // Os modulos novos recusam com {ok:false, erros:[...]}; os antigos com {erro}.
      // Sem unificar aqui, uma recusa voltaria HTTP 200 e a tela mostraria "salvo".
      if (r && r.ok === false && !r.erro) { r = { ...r, erro: (r.erros || []).join('; ') || 'nao foi possivel concluir' }; }
      return json(res, (r?.erro || r?.ok === false) ? 400 : 200, r);
    }
    return json(res, 404, { erro: 'rota de CRM desconhecida' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`[qa-gate-backend] ouvindo em :${PORT} (webhook /webhook, health /health)`));
