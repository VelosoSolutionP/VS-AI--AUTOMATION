/**
 * Instalador — licença TRIAL de 7 dias.
 *
 * Ordem: (1) se a máquina tem a chave privada (dev/VPS), assina um trial fresco de 7d;
 * (2) senão usa a CHAVE GENÉRICA embutida (GENERIC_TRIAL) — cole aqui o token de 7 dias
 * assinado no backend, ou passe via env VS_TRIAL_KEY; (3) sem nada, marca pendente.
 * Assim o cliente ativa na hora, sem depender de backend online.
 */
import { TRIAL_DAYS } from './catalog.mjs';

// Chave genérica embutida (assinada Ed25519 no backend). Plano "trial" com exp LONGO de
// propósito: o verify sempre passa; o CORTE de 7 dias é feito pela trava por data de
// instalação ([[trial-lock]]). Env VS_TRIAL_KEY tem prioridade (permite rotacionar sem build).
const GENERIC_TRIAL = process.env.VS_TRIAL_KEY
  || 'eyJlbWFpbCI6InRyaWFsQHZlbG9zb3NvbHV0aW9uLm9ubGluZSIsInBsYW4iOiJ0cmlhbCIsInNlYXRzIjoxLCJpYXQiOjE3ODY0NTIyMDM5MjcsImV4cCI6MjEwMTgxMjIwMzkyNywiaWQiOiJkSEpwWVd4QWRtVnNiM052In0.091ioRwD_s5eRAW8BqtO4pHDYP63Uvx8xpUHR8xrhAd5MCKIGcbhpx-97TlqmaWbXcsrzkxVgE4mm6XQRbAoAQ';

// Backend que emite a chave POR CLIENTE (env tem prioridade; senão a VPS de produção).
const ISSUER_URL = process.env.VS_ISSUER_URL || 'https://api.velososolution.online';

async function fetchFromBackend(contato, name) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${ISSUER_URL}/trial`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ whatsapp: contato, contato, name }), signal: ctrl.signal,
    });
    if (!r.ok) { return null; }
    const j = await r.json();
    return j && j.token ? { token: j.token, entregue: !!j.entregue } : null;
  } catch { return null; } finally { clearTimeout(t); }
}

export async function issueTrial({ email, plan = 'trial', name } = {}) {
  // 1. assina fresco se a chave privada estiver na máquina (dev/VPS)
  try {
    const { issueLicense } = await import('../license/issue.mjs');
    const token = issueLicense({ email: email || 'trial@velososolution.online', plan, days: TRIAL_DAYS, seats: 1 });
    return { token, pending: false, days: TRIAL_DAYS, fonte: 'assinada' };
  } catch { /* sem chave privada — tenta o backend por cliente */ }

  // 2. backend emite POR CLIENTE (usa o contato como id)
  const doBackend = (email && !process.env.VS_TRIAL_KEY) ? await fetchFromBackend(email, name) : null;
  if (doBackend) { return { token: doBackend.token, pending: false, days: TRIAL_DAYS, fonte: 'backend', entregue: doBackend.entregue }; }

  // 3. chave genérica embutida (offline / backend fora)
  if (GENERIC_TRIAL) { return { token: GENERIC_TRIAL, pending: false, days: TRIAL_DAYS, fonte: 'generica' }; }

  return { token: null, pending: true, days: TRIAL_DAYS, reason: 'sem backend e sem VS_TRIAL_KEY' };
}
