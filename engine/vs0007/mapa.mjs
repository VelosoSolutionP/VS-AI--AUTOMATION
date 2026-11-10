/**
 * VS0007 — Mapa Mental do Agente 0007.
 *
 * Mapa dinâmico, modular e sem limite estrutural fixo. O 0007 não nasce com
 * um mapa infinito — nasce com o mecanismo para construir, pesquisar,
 * organizar, validar e expandir seu próprio conhecimento continuamente.
 *
 * Estrutura:
 * 1. Núcleo       — identidade, missão, responsabilidades, regras, limites.
 * 2. Ecossistema — inventário de agentes, ferramentas, MCPs, modelos, etc.
 * 3. Conhecimento — descobertas, documentação, processos, especialidades.
 * 4. Pesquisa     — investigação de código, docs e fontes em lacunas.
 * 5. Validação   — transição de estados: descoberto -> em validação -> homologado.
 * 6. Expansão    — nós são adicionados conforme o ecossistema cresce.
 * 7. Histórico   — origem, evidência, data, versão e alterações de cada nó.
 */

import { load, save } from '../vscrm/store.mjs';
import * as R from './regras.mjs';

export const DATASET_MAPA = 'vs0007-mapa';

const NUCLEO_PADRAO = {
  missao: 'Conhecer, coordenar e fiscalizar o ecossistema de agentes da ZEST.',
  responsabilidades: ['conhecer agentes', 'coordenar operacoes', 'fiscalizar arquitetura', 'sugerir novos agentes'],
  regras: [
    'informacao descoberta nao e informacao homologada',
    'promocao exige autorizacao do responsavel',
    'bloqueado nao sai da gaiola',
  ],
  limites: ['nao substituir os especialistas', 'nao centralizar artificialmente suas funcoes'],
};

/** Mapa inicial: núcleo populado, nós surgem por descoberta/adição. */
export function mapaInicial() {
  return { versao: 1, nucleo: NUCLEO_PADRAO, nos: [], historico: [] };
}

export function lerMapa() {
  return load(DATASET_MAPA, mapaInicial());
}

export function salvarMapa(mapa) {
  save(DATASET_MAPA, mapa);
  return mapa;
}

/** Nós do mapa — opcionais por agente. */
export function obterNos(agenteId) {
  const mapa = lerMapa();
  const nos = agenteId ? mapa.nos.filter((n) => n.agenteId === agenteId) : [...mapa.nos];
  return { mapa, nos };
}

/**
 * Adiciona um nó de conhecimento. Descobertas nascem em estado 'descoberto'
 * e só podem evoluir para homologado com autorização (via regras do 0007).
 */
export function adicionarNo({ agenteId, categoria, conteudo, estado = 'descoberto', origem, evidencia, autorizado = false, qualidade = null, verificacao = null }) {
  const r = R.registrarConhecimento({ agenteId, conhecimento: conteudo, estado, autorizado });
  if (r.erro) { return r; }
  const mapa = lerMapa();
  const idBase = `${agenteId}:${categoria}:${Date.now()}`;
  let id = idBase;
  let sequencia = 1;
  while (mapa.nos.some((existente) => existente.id === id)) {
    id = `${idBase}:${sequencia++}`;
  }
  const no = {
    id,
    agenteId,
    categoria,
    conteudo,
    estado,
    ...(autorizado ? { autorizado: true } : {}),
    ...(qualidade ? { qualidade } : {}),
    ...(verificacao ? { verificacao } : {}),
    origem: origem || 'sistema',
    evidencia: evidencia || null,
    versao: mapa.versao,
    criadoEm: new Date().toISOString(),
  };
  mapa.nos.push(no);
  mapa.versao += 1;
  mapa.historico.push({
    versao: mapa.versao,
    noId: no.id,
    origem: no.origem,
    evidencia: no.evidencia,
    data: new Date().toISOString(),
    alteracao: `adicionou no de ${categoria} (${agenteId})`,
  });
  salvarMapa(mapa);
  return { no };
}

/**
 * Atualiza um nó existente e versiona + registra no histórico.
 * A transição de estado valida autorização antes de permitir promoção.
 */
export function atualizarNo(id, mudanca, contexto = {}) {
  const mapa = lerMapa();
  const no = mapa.nos.find((n) => n.id === id);
  if (!no) { return { erro: `no nao encontrado: ${id}` }; }
  no.conteudo = mudanca.conteudo ?? no.conteudo;
  no.estado = mudanca.estado ?? no.estado;
  no.versao = (no.versao || 0) + 1;
  no.atualizadoEm = new Date().toISOString();
  mapa.versao += 1;
  mapa.historico.push({
    versao: mapa.versao,
    noId: id,
    origem: contexto.origem || no.origem,
    evidencia: contexto.evidencia || no.evidencia,
    data: new Date().toISOString(),
    alteracao: `atualizou no ${id}`,
  });
  salvarMapa(mapa);
  return { no };
}

/** Transição de estado com as regras de validação do 0007. */
export function transicionarNo(id, novoEstado, contexto = {}) {
  const mapa = lerMapa();
  const no = mapa.nos.find((n) => n.id === id);
  if (!no) { return { erro: `no nao encontrado: ${id}` }; }
  const podePromover = R.podePromover(no.estado, contexto.autorizado);
  if (!podePromover) { return { erro: `transicao negada: ${no.estado} -> ${novoEstado}` }; }
  no.estado = novoEstado;
  no.atualizadoEm = new Date().toISOString();
  mapa.versao += 1;
  mapa.historico.push({
    versao: mapa.versao,
    noId: id,
    origem: contexto.origem || no.origem,
    evidencia: contexto.evidencia || no.evidencia,
    data: new Date().toISOString(),
    alteracao: `transicionou ${no.estado} -> ${novoEstado}`,
  });
  salvarMapa(mapa);
  return { no };
}

/**
 * Pesquisa o mapa mental: por agente, termo ou categoria.
 * Devolve hits ou sinaliza lacuna — nunca confunde descoberta com homologado,
 * pois cada nó carrega seu estado.
 */
export function pesquisar({ agenteId = null, termo = null, categoria = null } = {}) {
  const { nos } = obterNos(agenteId);
  const q = String(termo || '').toLowerCase();
  const lista = nos.filter((n) => (!categoria || n.categoria === categoria))
    .filter((n) => (!q || (n.conteudo || '').toLowerCase().includes(q)));
  return {
    agenteId,
    termo,
    categoria,
    hits: lista,
    total: lista.length,
    lacuna: lista.length === 0,
  };
}

/** Histórico completo do mapa, com versão e origem de cada mudança. */
export function historico() {
  const mapa = lerMapa();
  return { versao: mapa.versao, itens: [...mapa.historico] };
}

/**
 * Remove do mapa todos os nós (e o histórico) de um agente excluído.
 * Usado pela exclusão de uma IA-ZEST no Hotel: nada do perfil fica órfão.
 */
export function removerAgente(agenteId) {
  const mapa = lerMapa();
  const alvo = String(agenteId || '');
  const antes = mapa.nos.length;
  mapa.nos = mapa.nos.filter((no) => no.agenteId !== alvo);
  mapa.historico = mapa.historico.filter((item) => !String(item?.noId || '').startsWith(`${alvo}:`));
  mapa.versao += 1;
  salvarMapa(mapa);
  return { ok: true, nosRemovidos: antes - mapa.nos.length };
}
