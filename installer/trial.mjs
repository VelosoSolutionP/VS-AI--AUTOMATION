/**
 * Instalador — licença TRIAL de 7 dias.
 *
 * Ordem: (1) se a máquina tem a chave privada (dev/VPS), assina um trial fresco de 7d;
 * (2) senão usa a CHAVE GENÉRICA embutida (GENERIC_TRIAL) — cole aqui o token de 7 dias
 * assinado no backend, ou passe via env VS_TRIAL_KEY; (3) sem nada, marca pendente.
 * Assim o cliente ativa na hora, sem depender de backend online.
 */
import { TRIAL_DAYS } from './catalog.mjs';

// Chave genérica de 7 dias (assinada no backend). Env tem prioridade; senão o literal abaixo.
const GENERIC_TRIAL = process.env.VS_TRIAL_KEY || '';

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
