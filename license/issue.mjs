/**
 * QA-Gate licensing — EMISSÃO (backend). Assina uma licença com a chave privada.
 * Chamado pelo webhook do Stripe após pagamento confirmado.
 *
 *   node license/issue.mjs cliente@email.com pro 365
 *   -> imprime o token pra enviar ao cliente
 */
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function issueLicense({ email, plan = 'pro', days = 365, seats = 1 }) {
  // VPS: chave via env (nunca em arquivo no repo). Local: fallback pro arquivo.
  const priv = process.env.QA_GATE_PRIVATE_KEY || readFileSync(join(HERE, '.keys', 'private.pem'), 'utf8');
  const payload = {
    email, plan, seats,
    iat: Date.now(),
    exp: days ? Date.now() + days * 86400000 : null,
    id: b64url(Buffer.from(email + ':' + Date.now())).slice(0, 16),
  };
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = sign(null, payloadBuf, priv);
  return b64url(payloadBuf) + '.' + b64url(sig);
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [email, plan, days] = process.argv.slice(2);
  if (!email) { console.error('uso: node license/issue.mjs <email> [plan] [days]'); process.exit(1); }
  console.log(issueLicense({ email, plan: plan || 'pro', days: days ? Number(days) : 365 }));
}
