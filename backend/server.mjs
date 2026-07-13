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
import { issueLicense } from '../license/issue.mjs';

const PORT = process.env.PORT || 8787;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) { chunks.push(c); }
  return Buffer.concat(chunks);
}

/** Verifica assinatura do Stripe (t=..,v1=..). Sem SDK — HMAC SHA256. */
async function verifyStripeSig(rawBody, sigHeader, secret) {
  if (!secret) { return true; } // stub: sem secret, aceita (só local)
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) { return false; }
  const signed = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  try { return timingSafeEqual(Buffer.from(signed), Buffer.from(parts.v1)); } catch { return false; }
}

const planToDays = { pro: 365, mensal: 30, trial: 14 };

async function deliverLicense(email, token, plan) {
  // TODO: enviar por email (SMTP/Resend/etc). Por ora, loga.
  console.log(`[licenca] emitida para ${email} (${plan}):`);
  console.log(token);
  // ex.: await sendMail({ to: email, subject: 'Sua licença QA-Gate', text: token })
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { return json(res, 200, { ok: true }); }

  if (req.method === 'POST' && req.url === '/webhook') {
    const raw = (await readBody(req)).toString('utf8');
    const ok = await verifyStripeSig(raw, req.headers['stripe-signature'] || '', WEBHOOK_SECRET);
    if (!ok) { return json(res, 400, { error: 'assinatura Stripe inválida' }); }

    let event;
    try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'payload inválido' }); }

    if (event.type === 'checkout.session.completed') {
      const s = event.data?.object || {};
      const email = s.customer_details?.email || s.customer_email || 'sem-email';
      const plan = (s.metadata?.plan || 'pro').toLowerCase();
      const token = issueLicense({ email, plan, days: planToDays[plan] ?? 365 });
      await deliverLicense(email, token, plan);
      return json(res, 200, { received: true, issued: true, email, plan });
    }
    return json(res, 200, { received: true, issued: false });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`[qa-gate-backend] ouvindo em :${PORT} (webhook /webhook, health /health)`));
