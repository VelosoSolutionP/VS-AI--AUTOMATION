/**
 * VS0007 — Arquiteto e Guardião do Ecossistema.
 *
 * Fachada do Agente 0007. Conhece os agentes, separa o que é interno da ZEST
 * do que é comercializável, responde quem cuida de cada atividade e fiscaliza
 * a arquitetura antes de coordenar.
 *
 * Persistência segue o padrão das fachadas do engine (~/.qa-gate/...): dados
 * sensíveis de agentes comerciais ficam fora do repositório versionado.
 */

import { load, save } from '../vscrm/store.mjs';
import * as R from './regras.mjs';
import * as MAPA from './mapa.mjs';
import { MODELOS_FREE_0007, PARAMETROS_TREINO } from './auditoria.mjs';
import {
  listarModelosFree0007,
  sincronizarModelosFree,
  baixarModeloFree,
  diagnosticoTreinoBot,
  treinarIAPorParametros,
  revisarERefazerBot,
  revisarERefazerTodosOsBots,
} from './bots.mjs';

export const DATASET_AGENTES = 'vs0007-agentes';

const AGENTES_PADRAO = [
  {
    agenteId: '0007',
    nome: 'Arquiteto e Guardião do Ecossistema',
    tipo: R.TIPO_INTERNAL,
    atividades: ['arquitetura', 'governanca', 'coordenacao'],
    personalidade: 'analitica, criteriosa, propositiva',
    especialidades: ['arquitetura de agentes', 'governanca', 'mapas mentais', 'separation interna/comercial'],
    conhecimento: { estado: 'homologado', fonte: 'auditoria-inicial' },
    ferramentas: ['mcp:*', 'modelos:*'],
    dependencias: [],
  },
  {
    agenteId: 'isis',
    nome: 'Ísis',
    tipo: R.TIPO_INTERNAL,
    atividades: ['relacionamento', 'comunicacao', 'atendimento-comercial'],
    personalidade: 'inteligente, persuasiva, ágil',
    especialidades: ['relacionamento com parceiros', 'comunicação', 'vendas', 'negociação'],
    conhecimento: { estado: 'homologado' },
    ferramentas: [],
    dependencias: [],
  },
  {
    agenteId: 'hera',
    nome: 'Hera',
    tipo: R.TIPO_INTERNAL,
    atividades: ['governanca', 'financeiro', 'contratos', 'auditoria'],
    personalidade: 'firmeza, governança, controles',
    especialidades: ['governança', 'financeiro', 'contratos', 'auditoria', 'riscos'],
    conhecimento: { estado: 'homologado' },
    ferramentas: [],
    dependencias: [],
  },
  {
    agenteId: 'perséfone',
    nome: 'Perséfone',
    tipo: R.TIPO_INTERNAL,
    atividades: ['estrategia', 'inteligencia', 'dados', 'mercado'],
    personalidade: 'estratégica, analítica',
    especialidades: ['inteligência de negócios', 'dados', 'estratégia', 'indicadores'],
    conhecimento: { estado: 'homologado' },
    ferramentas: [],
    dependencias: [],
  },
  {
    agenteId: 'afrodite',
    nome: 'Afrodite',
    tipo: R.TIPO_COMERCIALIZAVEL,
    atividades: ['cardapio', 'catalogo', 'pedidos'],
    personalidade: 'especialista em cardápio digital',
    especialidades: ['cardápio digital', 'produtos', 'categorias', 'carrinho', 'pedidos'],
    conhecimento: { estado: 'em_validacao' },
    ferramentas: [],
    dependencias: [],
  },
  {
    agenteId: 'modelo-base',
    nome: 'Modelo Base (comercializável)',
    tipo: R.TIPO_COMERCIALIZAVEL,
    atividades: ['vendas', 'atendimento', 'automacao'],
    personalidade: 'configurável por instância',
    especialidades: ['modelos reutilizáveis', 'instâncias independentes'],
    conhecimento: { estado: 'homologado' },
    ferramentas: [],
    dependencias: [],
  },
];

/** Responsável por cada atividade do ecossistema. Fonte oficial do mapeamento. */
const RESPONSABILIDADES = [
  { atividade: 'arquitetura', agenteId: '0007' },
  { atividade: 'governanca', agenteId: 'hera' },
  { atividade: 'relacionamento', agenteId: 'isis' },
  { atividade: 'comunicacao', agenteId: 'isis' },
  { atividade: 'atendimento-comercial', agenteId: 'isis' },
  { atividade: 'estrategia', agenteId: 'perséfone' },
  { atividade: 'inteligencia', agenteId: 'perséfone' },
  { atividade: 'cardapio', agenteId: 'afrodite' },
  { atividade: 'catalogo', agenteId: 'afrodite' },
  { atividade: 'pedidos', agenteId: 'afrodite' },
  { atividade: 'vendas', agenteId: 'modelo-base' },
];

/* ---------------------------------------------------------------- fachada */

export function listarAgentes() {
  return load(DATASET_AGENTES, AGENTES_PADRAO);
}

export function buscarAgente(agenteId) {
  const lista = listarAgentes();
  return lista.find((a) => a.agenteId === agenteId) || null;
}

/** Cadastra/atualiza um agente na config central. Retorna erro ou agente. */
export function salvarAgente(dados) {
  const r = validarAgente(dados);
  if (r.erro) { return r; }
  const lista = listarAgentes().filter((a) => a.agenteId !== r.agente.agenteId);
  const agente = { ...r.agente };
  save(DATASET_AGENTES, [...lista, agente]);
  return { agente };
}

function validarAgente(dados) {
  const agenteId = String(dados?.agenteId || '').trim();
  if (!agenteId) { return { erro: 'agenteId obrigatorio' }; }
  const tipo = R.classificar(agenteId);
  if (tipo === R.TIPO_NAO_CLASSIFICADO) { return { erro: `agente nao-classificado: ${agenteId}` }; }
  return { agente: { ...dados, agenteId, tipo, atividades: dados.atividades || [] } };
}

export function agentesInternos() {
  return listarAgentes().filter((a) => R.classificar(a.agenteId) === R.TIPO_INTERNAL);
}

export function modelosComerciais() {
  return listarAgentes().filter((a) => R.classificar(a.agenteId) === R.TIPO_COMERCIALIZAVEL);
}

/**
 * Fiscaliza a separação entre agentes internos da ZEST e modelos
 * comercializáveis. Devolve o panorama e se a arquitetura está íntegra.
 */
export function fiscalizar() {
  const agentes = listarAgentes();
  const internos = agentesInternos();
  const comerciais = modelosComerciais();
  const desconhecidos = agentes.filter((a) => R.classificar(a.agenteId) === R.TIPO_NAO_CLASSIFICADO);
  return {
    total: agentes.length,
    internos: internos.length,
    comerciais: comerciais.length,
    desconhecidos,
    ok: desconhecidos.length === 0,
  };
}

/** Qual agente responde por uma atividade. O 0007 consulte antes de escalar. */
export function agenteResponsavel(atividade) {
  const regra = RESPONSABILIDADES.find((r) => r.atividade === atividade);
  const agenteId = regra?.agenteId || null;
  const agente = agenteId ? buscarAgente(agenteId) : null;
  if (!agente) { return { erro: `sem agente mapeado para atividade: ${atividade}` }; }
  return { atividade, agenteId: agente.agenteId };
}

/* --------------------------------------------------- mapa mental do 0007 */

export const { mapaInicial, lerMapa, salvarMapa, obterNos, adicionarNo, atualizarNo, transicionarNo, pesquisar, historico } = MAPA;
export {
  MODELOS_FREE_0007,
  PARAMETROS_TREINO,
  listarModelosFree0007,
  sincronizarModelosFree,
  baixarModeloFree,
  diagnosticoTreinoBot,
  treinarIAPorParametros,
  revisarERefazerBot,
  revisarERefazerTodosOsBots,
};
