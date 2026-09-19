/**
 * VSpainel — orquestrador das telas que eram casca: Auditor, Financeiro e Relatórios.
 *
 * Só I/O e composição: busca o dado de cada módulo (VScrm, VSestoque, VSinfluence,
 * recibos do gate) e entrega pronto pro painel. As decisões vivem nos módulos puros.
 *
 * Importa em runtime e tolera ausência de propósito: quem roda só o CRM não deve
 * quebrar a tela porque não configurou VSinfluence nem VSestoque.
 */
import { auditar, reposConfigurados, docPendente } from './auditor.mjs';
import { consolidar } from './financeiro.mjs';
import { montar } from './relatorios.mjs';
import { perfil, configuracao, plano, salvarPerfil } from './perfil.mjs';

/** Roda um carregador e devolve o padrão se o módulo não estiver em uso. */
async function tentar(fn, padrao = null) {
  try {
    return await fn();
  } catch {
    return padrao;
  }
}

async function dadosCrm() {
  const crm = await import('../vscrm/index.mjs');
  return crm.painel();
}

async function dadosEstoque() {
  const est = await import('../vsestoque/index.mjs');
  return est.painel();
}

/** Ganhos lançados no VSinfluence (dataset próprio, fora deste repositório). */
async function dadosGanhos() {
  const { load } = await import('../vsinfluence/store.mjs');
  return load('ganhos', []) || [];
}

async function dadosMedicoes() {
  const { load } = await import('../vsinfluence/store.mjs');
  return load('medicoes', []) || [];
}

/** Métricas de governança agregadas (tempo, retrabalho, ROI). */
async function dadosGovernanca() {
  const { loadEvents, aggregate } = await import('../metrics.mjs');
  const eventos = loadEvents();
  return eventos.length ? { ...aggregate(eventos), eventos: eventos.length } : { eventos: 0 };
}

/** Tela do Auditor: recibos do gate + governança. */
export async function painelAuditor(opts = {}) {
  const repos = reposConfigurados(opts.repos || []);
  const agora = opts.agora || Date.now();
  const auditoria = auditar(repos, agora);
  return {
    ...auditoria,
    itens: auditoria.itens.map((i) => ({ ...i, docPendente: i.existe ? docPendente(i.repo) : null })),
    governanca: await tentar(dadosGovernanca, { eventos: 0 }),
    validadeMin: 30,
  };
}

/** Tela do Financeiro: as fontes reais consolidadas. */
export async function painelFinanceiro() {
  const crm = await tentar(dadosCrm, { leads: [] });
  return consolidar({
    leads: crm?.leads || [],
    ganhos: await tentar(dadosGanhos, []),
    estoque: await tentar(dadosEstoque, null),
    stripeConciliado: false,
  });
}

/** Tela de Relatórios: o cruzamento entre CRM, catálogo e conteúdo. */
export async function painelRelatorios(opts = {}) {
  const crm = await tentar(dadosCrm, { leads: [], funil: [] });
  return montar({
    leads: crm?.leads || [],
    funil: crm?.funil || [],
    estoque: await tentar(dadosEstoque, null),
    medicoes: await tentar(dadosMedicoes, []),
    diasEsquecido: opts.diasEsquecido,
  }, opts.agora || Date.now());
}

/** Tela de Perfil / Configurações / Plano: tudo que vem do company.json e da licença. */
export async function painelConta() {
  return { perfil: perfil(), configuracao: configuracao(), plano: await plano() };
}

export { auditar, consolidar, montar, reposConfigurados, perfil, configuracao, plano, salvarPerfil };
