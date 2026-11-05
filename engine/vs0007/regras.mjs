/**
 * VS0007 — Arquiteto e Guardião do Ecossistema.
 *
 * Regras puras do domínio do Agente 0007. Sem disco, sem side-effects:
 * estados de conhecimento, classificação interno/comercializável e
 * detecção de conflitos moram aqui, testáveis em isolamento.
 */

export const ESTADOS_CONHECIMENTO = [
  'descoberto',
  'em_validacao',
  'homologado',
  'alternativo_aprovado',
  'bloqueado',
  'desatualizado',
];

export const CLASSIFICACAO_INTERNOS = ['isis', 'hera', 'perséfone', '0007'];
export const CLASSIFICACAO_COMERCIAIS = ['afrodite', 'modelo-base'];

export const ESTADOS_HOMOLOGAVEIS = ['homologado', 'alternativo_aprovado'];

export const TIPO_INTERNAL = 'interno';
export const TIPO_COMERCIALIZAVEL = 'comercializavel';
export const TIPO_NAO_CLASSIFICADO = 'nao-classificado';

/** Classificação de um agente: interno da ZEST ou modelo comercializável. */
export function classificar(agenteId) {
  if (CLASSIFICACAO_INTERNOS.includes(agenteId)) { return TIPO_INTERNAL; }
  if (CLASSIFICACAO_COMERCIAIS.includes(agenteId)) { return TIPO_COMERCIALIZAVEL; }
  return TIPO_NAO_CLASSIFICADO;
}

export function estadoValido(estado) {
  return ESTADOS_CONHECIMENTO.includes(estado);
}

/**
 * Conhecimento novo nasce 'descoberto'. Só pode ser homologado (ou aprovado
 * como alternativo) com autorização explícita — o 0007 não promove sem isso.
 */
export function registrarConhecimento({ agenteId, conhecimento, estado = 'descoberto', autorizado = false }) {
  if (!estadoValido(estado)) { return { erro: `estado de conhecimento invalido: ${estado}` }; }
  if ((estado === 'homologado' || estado === 'alternativo_aprovado') && !autorizado) {
    return { erro: `conhecimento nao pode ser homologado sem autorizacao (${agenteId})` };
  }
  return {
    conhecimento: { agenteId, conhecimento, estado, autorizado, registradoEm: new Date().toISOString() },
  };
}

/**
 * Promover conhecimento exige autorização e estado anterior em fluxo de
 * aprendizado (descoberto/em_validacao). 'bloqueado' não sai da gaiola.
 */
export function podePromover(estadoAnterior, autorizado) {
  const emFluxo = ['descoberto', 'em_validacao'];
  return Boolean(autorizado) && emFluxo.includes(estadoAnterior);
}

/**
 * Conflito de responsabilidade: dois agentes disputando a mesma atividade.
 * O 0007 fiscaliza isso antes de coordenar qualquer operação.
 */
export function conflitosEntre(agentes = []) {
  const conflitos = [];
  for (let i = 0; i < agentes.length; i++) {
    for (let j = i + 1; j < agentes.length; j++) {
      const a = agentes[i];
      const b = agentes[j];
      const disputa = (a.atividades || []).some((at) => (b.atividades || []).includes(at));
      if (disputa) {
        conflitos.push({
          agenteA: a.agenteId,
          agenteB: b.agenteId,
          atividade: (a.atividades || []).find((at) => (b.atividades || []).includes(at)),
        });
      }
    }
  }
  return conflitos;
}
