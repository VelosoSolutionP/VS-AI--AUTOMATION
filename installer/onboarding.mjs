/**
 * Instalador — liga a seleção de produtos aos SETS de entrevista obrigatórios e
 * valida/coage as respostas vindas da tela antes de instalar.
 */
import { SETS, getSet } from '../engine/interview/schema.mjs';
import { createState, answer } from '../engine/interview/engine.mjs';

const DEV_FLOW = ['gate', 'vsqa', 'vsanalista', 'vsdiretoria'];

/**
 * Cada produto declara SO os sets que ele consome. Antes qualquer produto da linha
 * dev puxava empresa+dev+analista+qa: quem instalava so o Gate respondia tracker do
 * Redmine e sistema de QA que nunca seriam usados. Pergunta que nao vira configuracao
 * e atrito puro na instalacao.
 * @type {Object<string,string[]>}
 */
export const SETS_POR_PRODUTO = {
  gate: ['dev'],
  vsqa: ['dev', 'qa'],
  vsanalista: ['dev', 'analista'],
  vsdiretoria: ['dev', 'analista'],
  vsvendas: ['empresa', 'vendas'],
  vsinfluence: ['influence'],
};

/**
 * Modulos que cada produto liga. O que nao for escolhido entra `false` na config,
 * em vez de ausente — assim o guard le o booleano e nao cobra o modulo.
 * @type {Object<string,string[]>}
 */
export const MODULOS_POR_PRODUTO = {
  vsqa: ['qa'],
  vsanalista: ['analista'],
  vsdiretoria: ['analista'],
};

/** Quais sets de entrevista os produtos escolhidos exigem. */
export function requiredSetsFor(ids) {
  const sets = new Set();
  for (const id of ids || []) {
    for (const s of SETS_POR_PRODUTO[id] || []) { sets.add(s); }
  }
  return [...sets];
}

/**
 * Estado de cada modulo opcional a partir da selecao. Sempre devolve todas as
 * chaves — o que nao foi escolhido vem `false`, nunca ausente.
 * @returns {{analista:boolean, qa:boolean}}
 */
export function modulosAtivos(ids) {
  const ativos = new Set((ids || []).flatMap((id) => MODULOS_POR_PRODUTO[id] || []));
  return { analista: ativos.has('analista'), qa: ativos.has('qa') };
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
