/**
 * Quebra-Galho — escopo contratado, ordem de serviço, avaliação e contestação.
 *
 * O ESCOPO é congelado ANTES do pagamento e versionado. Não é burocracia: quando
 * alguém contesta, a única pergunta que importa é "o que foi combinado?". Se o
 * escopo pudesse ser alterado depois, essa pergunta não teria resposta.
 *
 * A ORDEM DE SERVIÇO tem máquina de estados fechada: pular de "contratado" direto
 * para "concluído" apagaria a prova de que o serviço aconteceu.
 */
import { randomBytes, createHash } from 'node:crypto';

/* ---------------- escopo ---------------- */

/**
 * Snapshot imutável. O hash é o que prova, numa disputa, que o documento não mudou
 * depois do aceite das duas partes.
 */
export function congelarEscopo(e = {}) {
  const erros = [];
  if (!e.pedidoId) { erros.push('pedidoId é obrigatório'); }
  if (!e.propostaId) { erros.push('propostaId é obrigatório'); }
  if (!Number.isInteger(e.valorCentavos) || e.valorCentavos <= 0) { erros.push('valor do escopo inválido'); }
  if (!String(e.incluido || '').trim()) { erros.push('descreva o que ESTÁ incluído'); }
  if (erros.length) { return { escopo: null, erros }; }

  const corpo = {
    pedidoId: e.pedidoId,
    propostaId: e.propostaId,
    prestadorId: e.prestadorId || null,
    clienteId: e.clienteId || null,
    incluido: String(e.incluido).trim(),
    naoIncluido: String(e.naoIncluido || '').trim() || null,
    materiais: String(e.materiais || '').trim() || null,
    materiaisInclusos: Boolean(e.materiaisInclusos),
    valorCentavos: e.valorCentavos,
    prazoDias: e.prazoDias ?? null,
    endereco: e.endereco || null,
    dataDesejada: e.dataDesejada || null,
    observacoes: e.observacoes || null,
    versao: e.versao || 1,
  };
  const hash = createHash('sha256').update(JSON.stringify(corpo)).digest('hex');

  return {
    escopo: {
      id: 'esc_' + randomBytes(6).toString('hex'),
      ...corpo,
      hash,
      // Os dois aceites são registrados separados: um só não fecha contrato.
      aceiteCliente: null,
      aceitePrestador: null,
      criadoEm: e.quando || new Date().toISOString(),
    },
    erros: [],
  };
}

export function aceitarEscopo(escopo, quem, quando = new Date().toISOString()) {
  if (!escopo) { return { escopo: null, erro: 'escopo não encontrado' }; }
  if (quem !== 'cliente' && quem !== 'prestador') { return { escopo: null, erro: 'quem aceita deve ser cliente ou prestador' }; }
  const campo = quem === 'cliente' ? 'aceiteCliente' : 'aceitePrestador';
  if (escopo[campo]) { return { escopo, repetido: true, erro: null }; }
  const novo = { ...escopo, [campo]: quando };
  return { escopo: novo, fechado: Boolean(novo.aceiteCliente && novo.aceitePrestador), erro: null };
}

/** Mudança depois do aceite exige CHANGE_REQUEST e novo aceite — nunca edição. */
export function pedirMudanca(escopo, e = {}) {
  if (!escopo) { return { pedido: null, erro: 'escopo não encontrado' }; }
  const motivo = String(e.motivo || '').trim();
  if (!motivo) { return { pedido: null, erro: 'explique o que mudou e por quê' }; }
  return {
    pedido: {
      id: 'chg_' + randomBytes(6).toString('hex'),
      escopoId: escopo.id,
      versaoBase: escopo.versao,
      motivo,
      novoValorCentavos: e.novoValorCentavos ?? null,
      novoPrazoDias: e.novoPrazoDias ?? null,
      novoIncluido: String(e.novoIncluido || '').trim() || null,
      status: 'AGUARDANDO_ACEITE',
      criadoEm: e.quando || new Date().toISOString(),
    },
    erro: null,
  };
}

/* ---------------- ordem de serviço ---------------- */

export const OS_STATUS = ['CREATED', 'PAID', 'SCHEDULED', 'PROVIDER_ON_THE_WAY', 'IN_PROGRESS',
  'AWAITING_CUSTOMER_ACCEPTANCE', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'UNDER_REVIEW', 'REWORK_REQUIRED', 'REFUNDED'];

export const OS_ROTULO = {
  CREATED: 'Contratado', PAID: 'Pago', SCHEDULED: 'Agendado',
  PROVIDER_ON_THE_WAY: 'A caminho', IN_PROGRESS: 'Em execução',
  AWAITING_CUSTOMER_ACCEPTANCE: 'Aguardando sua confirmação', COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado', DISPUTED: 'Em contestação', UNDER_REVIEW: 'Em análise',
  REWORK_REQUIRED: 'Precisa de correção', REFUNDED: 'Reembolsado',
};

/** O caminho normal, na ordem em que a timeline mostra. */
export const OS_CAMINHO = ['CREATED', 'PAID', 'SCHEDULED', 'PROVIDER_ON_THE_WAY', 'IN_PROGRESS', 'AWAITING_CUSTOMER_ACCEPTANCE', 'COMPLETED'];

export const OS_TRANSICOES = {
  CREATED: ['PAID', 'CANCELLED'],
  PAID: ['SCHEDULED', 'CANCELLED', 'REFUNDED'],
  SCHEDULED: ['PROVIDER_ON_THE_WAY', 'IN_PROGRESS', 'CANCELLED'],
  PROVIDER_ON_THE_WAY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_CUSTOMER_ACCEPTANCE', 'CANCELLED'],
  AWAITING_CUSTOMER_ACCEPTANCE: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['UNDER_REVIEW', 'COMPLETED', 'REWORK_REQUIRED', 'REFUNDED'],
  UNDER_REVIEW: ['COMPLETED', 'REWORK_REQUIRED', 'REFUNDED'],
  REWORK_REQUIRED: ['IN_PROGRESS', 'REFUNDED'],
  COMPLETED: [], CANCELLED: [], REFUNDED: [],
};

export function osPodeIr(de, para) {
  if (!OS_STATUS.includes(de)) { return { ok: false, motivo: `estado desconhecido: "${de}"` }; }
  if (!OS_STATUS.includes(para)) { return { ok: false, motivo: `estado desconhecido: "${para}"` }; }
  if (de === para) { return { ok: true, repetido: true }; }
  if (!OS_TRANSICOES[de].includes(para)) {
    return { ok: false, motivo: `não dá pra ir de "${OS_ROTULO[de]}" para "${OS_ROTULO[para]}"` };
  }
  return { ok: true };
}

export function criarOrdem(e = {}) {
  const erros = [];
  if (!e.escopoId) { erros.push('a OS exige um escopo congelado'); }
  if (!e.pedidoId) { erros.push('pedidoId é obrigatório'); }
  if (erros.length) { return { ordem: null, erros }; }
  const agora = e.quando || new Date().toISOString();
  return {
    ordem: {
      id: 'os_' + randomBytes(6).toString('hex'),
      pedidoId: e.pedidoId,
      propostaId: e.propostaId || null,
      escopoId: e.escopoId,
      clienteId: e.clienteId || null,
      prestadorId: e.prestadorId || null,
      valorCentavos: e.valorCentavos ?? null,
      pagamentoId: null,
      status: 'CREATED',
      evidencias: [],
      timeline: [{ status: 'CREATED', em: agora, nota: 'Contratação registrada' }],
      criadaEm: agora,
      atualizadaEm: agora,
    },
    erros: [],
  };
}

export function moverOrdem(ordem, para, opts = {}) {
  const r = osPodeIr(ordem?.status, para);
  if (!r.ok) { return { ordem: null, erro: r.motivo }; }
  const quando = opts.quando || new Date().toISOString();
  if (r.repetido) { return { ordem, erro: null }; }
  return {
    ordem: {
      ...ordem, status: para, atualizadaEm: quando,
      timeline: [...ordem.timeline, { status: para, em: quando, nota: opts.nota || null, por: opts.por || null }],
    },
    erro: null,
  };
}

/** Timeline pronta pra tela: o que já passou, o que é agora, o que falta. */
export function timeline(ordem) {
  const feitos = new Set(ordem.timeline.map((t) => t.status));
  const atual = ordem.status;
  const desvio = !OS_CAMINHO.includes(atual);
  const passos = OS_CAMINHO.map((s) => ({
    status: s,
    rotulo: OS_ROTULO[s],
    feito: feitos.has(s),
    atual: s === atual,
    em: ordem.timeline.find((t) => t.status === s)?.em || null,
  }));
  return {
    passos,
    atual: { status: atual, rotulo: OS_ROTULO[atual] },
    // Contestação e afins não entram no trilho: aparecem como desvio, com destaque.
    desvio: desvio ? { status: atual, rotulo: OS_ROTULO[atual] } : null,
  };
}

/* ---------------- avaliação ---------------- */

export function normalizarAvaliacao(e = {}) {
  const erros = [];
  const estrelas = Number(e.estrelas);
  if (!Number.isInteger(estrelas) || estrelas < 1 || estrelas > 5) {
    erros.push('dê de 1 a 5 estrelas');
  }
  if (!e.ordemId) { erros.push('ordemId é obrigatório'); }
  const comentario = String(e.comentario || '').trim();
  if (comentario.length > 1000) { erros.push('comentário muito longo'); }
  if (erros.length) { return { avaliacao: null, erros }; }
  return {
    avaliacao: {
      id: 'av_' + randomBytes(6).toString('hex'),
      ordemId: e.ordemId,
      prestadorId: e.prestadorId || null,
      clienteId: e.clienteId || null,
      categoria: e.categoria || null,
      estrelas,
      comentario: comentario || null,
      criadaEm: e.quando || new Date().toISOString(),
    },
    erros: [],
  };
}

/**
 * Média do prestador. Sem avaliação devolve null — nunca 0: prestador novo não é
 * prestador ruim, e zero o esconderia do matching para sempre.
 */
export function media(avaliacoes = []) {
  if (!avaliacoes.length) { return null; }
  const s = avaliacoes.reduce((a, b) => a + b.estrelas, 0);
  return Number((s / avaliacoes.length).toFixed(2));
}

/* ---------------- contestação ---------------- */

export const MOTIVOS_DISPUTA = [
  'nao_compareceu', 'servico_incompleto', 'fora_do_escopo',
  'qualidade_ruim', 'dano', 'cobranca_indevida', 'outro',
];

export const ROTULO_MOTIVO = {
  nao_compareceu: 'O profissional não apareceu',
  servico_incompleto: 'O serviço ficou incompleto',
  fora_do_escopo: 'Fizeram diferente do combinado',
  qualidade_ruim: 'A qualidade não ficou boa',
  dano: 'Houve dano a algo meu',
  cobranca_indevida: 'Cobrança que não combinamos',
  outro: 'Outro motivo',
};

export const DISPUTA_STATUS = ['ABERTA', 'NIVEL_1', 'NIVEL_2', 'NIVEL_3', 'RESOLVIDA'];
export const RESULTADOS = ['CUSTOMER_FAVOR', 'PROVIDER_FAVOR', 'PARTIAL', 'REWORK', 'AGREEMENT', 'INCONCLUSIVE'];

export function abrirDisputa(e = {}) {
  const erros = [];
  if (!e.ordemId) { erros.push('ordemId é obrigatório'); }
  const motivo = String(e.motivo || '');
  if (!MOTIVOS_DISPUTA.includes(motivo)) { erros.push('escolha o motivo da contestação'); }
  const descricao = String(e.descricao || '').trim();
  if (descricao.length < 20) { erros.push('conte o que aconteceu com um pouco mais de detalhe (mínimo 20 caracteres)'); }
  if (erros.length) { return { disputa: null, erros }; }

  return {
    disputa: {
      id: 'dsp_' + randomBytes(6).toString('hex'),
      ordemId: e.ordemId,
      escopoId: e.escopoId || null,
      abertaPor: e.abertaPor || 'cliente',
      motivo,
      rotuloMotivo: ROTULO_MOTIVO[motivo],
      descricao,
      evidenciasCliente: e.evidencias || [],
      evidenciasPrestador: [],
      status: 'ABERTA',
      // A plataforma COMPARA o combinado com o entregue. Não acusa ninguém de saída.
      resultado: null,
      laudo: null,
      responsavel: null,
      criadaEm: e.quando || new Date().toISOString(),
    },
    erros: [],
  };
}

/**
 * Registra o resultado. A consequência FINANCEIRA não é decidida aqui: depende de
 * política aprovada juridicamente (BDR-05). O módulo grava o resultado e para.
 */
export function resolverDisputa(disputa, e = {}) {
  if (!disputa) { return { disputa: null, erro: 'contestação não encontrada' }; }
  if (!RESULTADOS.includes(e.resultado)) {
    return { disputa: null, erro: `resultado inválido (use ${RESULTADOS.join(', ')})` };
  }
  if (!String(e.laudo || '').trim()) { return { disputa: null, erro: 'o laudo é obrigatório — decisão sem justificativa não se sustenta' }; }
  return {
    disputa: {
      ...disputa,
      status: 'RESOLVIDA',
      resultado: e.resultado,
      laudo: String(e.laudo).trim(),
      responsavel: e.responsavel || null,
      resolvidaEm: e.quando || new Date().toISOString(),
      consequenciaFinanceira: null,
      pendenteDePolitica: true,
    },
    erro: null,
  };
}
