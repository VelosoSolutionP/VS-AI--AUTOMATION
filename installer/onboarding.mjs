/**
 * Instalador — liga a seleção de produtos aos SETS de entrevista obrigatórios e
 * valida/coage as respostas vindas da tela antes de instalar.
 */
import { SETS, getSet } from '../engine/interview/schema.mjs';
import { createState, answer } from '../engine/interview/engine.mjs';

const DEV_FLOW = ['gate', 'vsqa', 'vsanalista', 'vsdiretoria'];

/** Quais sets de entrevista os produtos escolhidos exigem. */
export function requiredSetsFor(ids) {
  const sets = new Set();
  if ((ids || []).some((i) => DEV_FLOW.includes(i))) { ['empresa', 'dev', 'analista', 'qa'].forEach((s) => sets.add(s)); }
  if ((ids || []).includes('vsvendas')) { sets.add('empresa'); sets.add('vendas'); }
  return [...sets];
}

/** Precisa aplicar no company.json (fluxo dev com analista+qa)? */
export function precisaApplyConfig(ids) {
  return (ids || []).some((i) => DEV_FLOW.includes(i));
}

/**
 * Coage/valida as respostas de cada set. Retorna { perfis, erros }.
 * @param {string[]} sets   sets a validar (de requiredSetsFor)
 * @param {Object<string,Object>} respostas  { set: { id: valor } }
 */
export function buildAndValidate(sets, respostas = {}) {
  const perfis = {};
  const erros = [];
  for (const setId of sets) {
    getSet(setId); // valida o set
    let state = createState(setId);
    const dadas = respostas[setId] || {};
    for (const [id, valor] of Object.entries(dadas)) {
      if (valor === '' || valor == null) { continue; }
      const r = answer(state, id, valor);
      if (!r.ok) { erros.push(`${setId}.${id}: ${r.error}`); } else { state = r.state; }
    }
    // obrigatórias não respondidas
    for (const q of SETS[setId].filter((x) => x.required)) {
      if (!Object.prototype.hasOwnProperty.call(state.answers, q.id)) {
        erros.push(`${setId}: falta "${q.pergunta}"`);
      }
    }
    perfis[setId] = state.answers;
  }
  return { perfis, erros };
}
