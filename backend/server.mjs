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

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CHECKOUT_URL = process.env.CHECKOUT_URL || ''; // Stripe Payment Link

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) { chunks.push(c); }
  return Buffer.concat(chunks);
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

const planToDays = { pro: 365, mensal: 30, trial: 14 };

async function deliverLicense({ email, phone, name, token, plan }) {
  console.log(`[licenca] emitida para ${name || email} (${plan})`);
  const res = await sendLicense({ phone, key: token, name, plan });
  console.log(`[entrega] provider=${res.provider} ok=${res.ok}${res.link ? ' link=' + res.link : ''}`);
  return res;
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

  if (req.method === 'POST' && req.url === '/webhook') {
    const raw = (await readBody(req)).toString('utf8');
    const ok = await verifyStripeSig(raw, req.headers['stripe-signature'] || '', WEBHOOK_SECRET);
    if (!ok) { return json(res, 400, { error: 'assinatura Stripe inválida' }); }

    let event;
    try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'payload inválido' }); }

    if (event.type === 'checkout.session.completed') {
      const s = event.data?.object || {};
      const email = s.customer_details?.email || s.customer_email || 'sem-email';
      const phone = s.customer_details?.phone || s.metadata?.phone || '';
      const name = s.customer_details?.name || s.metadata?.name || '';
      const plan = (s.metadata?.plan || 'pro').toLowerCase();
      const token = issueLicense({ email, plan, days: planToDays[plan] ?? 365 });
      await deliverLicense({ email, phone, name, token, plan });
      return json(res, 200, { received: true, issued: true, email, phone: !!phone, plan });
    }
    return json(res, 200, { received: true, issued: false });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`[qa-gate-backend] ouvindo em :${PORT} (webhook /webhook, health /health)`));
