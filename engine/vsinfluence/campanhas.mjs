/**
 * VSinfluence — campanhas de divulgação. Agrupa vídeos/posts sob um objetivo, com
 * período, orçamento e meta, e cruza com métricas e ganhos pra dizer se valeu.
 *
 * Sem essa camada o criador tem números soltos por vídeo; com ela ele sabe se a
 * AÇÃO deu retorno — que é o que decide onde ele investe o próximo mês.
 */
import { paraCentavos, formatarBRL, total as somarGanhos } from './ganhos.mjs';
import { agregar } from './metricas.mjs';

export const OBJETIVOS = ['alcance', 'engajamento', 'vendas', 'inscritos', 'trafego'];

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida e normaliza uma campanha.
 * @param {{nome:string, objetivo:string, inicio:string, fim:string, redes?:string[],
 *   orcamento?:*, meta?:number, videos?:string[]}} c
 */
export function normalizarCampanha(c = {}) {
  const erros = [];
  const nome = String(c.nome || '').trim();
  if (!nome) { erros.push('nome da campanha é obrigatório'); }

  const objetivo = String(c.objetivo || '').toLowerCase();
  if (!OBJETIVOS.includes(objetivo)) { erros.push(`objetivo desconhecido: "${c.objetivo}" (use ${OBJETIVOS.join(', ')})`); }

  const inicio = String(c.inicio || '').slice(0, 10);
  const fim = String(c.fim || '').slice(0, 10);
  if (!DATA_RE.test(inicio)) { erros.push(`início inválido: "${c.inicio}" (use AAAA-MM-DD)`); }
  if (!DATA_RE.test(fim)) { erros.push(`fim inválido: "${c.fim}" (use AAAA-MM-DD)`); }
  if (DATA_RE.test(inicio) && DATA_RE.test(fim) && fim < inicio) { erros.push('o fim tem que ser depois do início'); }

  let orcamento = null;
  if (c.orcamento != null && c.orcamento !== '') {
    orcamento = paraCentavos(c.orcamento);
    if (orcamento == null) { erros.push(`orçamento inválido: "${c.orcamento}"`); }
  }

  if (erros.length) { return { campanha: null, erros }; }
  return {
    campanha: {
      id: c.id || nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      nome, objetivo, inicio, fim,
      redes: (c.redes || []).map((r) => String(r).toLowerCase()),
      orcamentoCentavos: orcamento,
      meta: c.meta ?? null,
      videos: c.videos || [],
    },
    erros: [],
  };
}

/** Situação da campanha na data informada. */
export function situacao(campanha, hoje) {
  const d = String(hoje).slice(0, 10);
  if (d < campanha.inicio) { return 'agendada'; }
  if (d > campanha.fim) { return 'encerrada'; }
  return 'ativa';
}

/**
 * Desempenho da campanha: métricas dos vídeos dela + ganhos atribuídos.
 * ROI só é calculado com orçamento informado — sem custo não existe retorno sobre
 * investimento, e devolver 0 seria mentira.
 *
 * @param {object} campanha
 * @param {object[]} medicoes  medições dos vídeos da campanha
 * @param {object[]} ganhos    lançamentos atribuídos à campanha
 * @param {string} hoje
 */
export function desempenho(campanha, medicoes = [], ganhos = [], hoje = '1970-01-01') {
  const dosVideos = medicoes.filter((m) => !campanha.videos.length || campanha.videos.includes(m.videoId));
  const { totais, indisponiveis } = agregar(dosVideos);
  const receita = somarGanhos(ganhos);
  const custo = campanha.orcamentoCentavos;
  const roi = (custo && custo > 0) ? Number(((receita - custo) / custo).toFixed(4)) : null;

  const alvo = campanha.meta;
  const alcancado = totais.views;
  return {
    id: campanha.id,
    nome: campanha.nome,
    situacao: situacao(campanha, hoje),
    objetivo: campanha.objetivo,
    periodo: `${campanha.inicio} a ${campanha.fim}`,
    videos: dosVideos.length,
    totais,
    indisponiveis,
    receitaCentavos: receita,
    receitaFormatada: formatarBRL(receita),
    custoCentavos: custo,
    custoFormatado: formatarBRL(custo),
    roi,
    meta: alvo,
    metaAtingida: (alvo == null || alcancado == null) ? null : alcancado >= alvo,
    progressoMeta: (alvo && alcancado != null) ? Number((alcancado / alvo).toFixed(4)) : null,
  };
}
