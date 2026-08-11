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

export async function issueTrial({ email, plan = 'trial' } = {}) {
  // 1. assina fresco se a chave privada estiver disponível
  try {
    const { issueLicense } = await import('../license/issue.mjs');
    const token = issueLicense({ email: email || 'trial@velososolution.online', plan, days: TRIAL_DAYS, seats: 1 });
    return { token, pending: false, days: TRIAL_DAYS, fonte: 'assinada' };
  } catch { /* sem chave privada — segue pra genérica embutida */ }

  // 2. chave genérica embutida
  if (GENERIC_TRIAL) {
    return { token: GENERIC_TRIAL, pending: false, days: TRIAL_DAYS, fonte: 'generica' };
  }

  // 3. sem nada configurado
  return { token: null, pending: true, days: TRIAL_DAYS, reason: 'defina VS_TRIAL_KEY (chave genérica de 7 dias) ou a chave privada' };
}
