/**
 * Instalador — licença TRIAL de 7 dias. Em produção quem assina é o backend do
 * fornecedor (chave privada nunca vai pra máquina do cliente). Aqui: se a chave
 * estiver disponível (dev/demo ou VPS), assina na hora; senão devolve pendente
 * pra ser emitida pelo backend.
 */
import { TRIAL_DAYS } from './catalog.mjs';

/**
 * @param {{email:string, plan?:string}} dados
 * @returns {Promise<{token:string|null, pending:boolean, days:number, reason?:string}>}
 */
export async function issueTrial({ email, plan = 'trial' }) {
  if (!email) { return { token: null, pending: true, days: TRIAL_DAYS, reason: 'email obrigatório' }; }
  try {
    const { issueLicense } = await import('../license/issue.mjs');
    const token = issueLicense({ email, plan, days: TRIAL_DAYS, seats: 1 });
    return { token, pending: false, days: TRIAL_DAYS };
  } catch (e) {
    // sem chave privada na máquina (caso normal do cliente) -> backend emite
    return { token: null, pending: true, days: TRIAL_DAYS, reason: 'chave de emissão indisponível localmente (backend emite o trial)' };
  }
}
