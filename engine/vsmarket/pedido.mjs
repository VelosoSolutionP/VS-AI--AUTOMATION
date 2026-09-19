/**
 * Quebra-Galho — pedido de serviço (SERVICE_REQUEST).
 *
 * É o começo de tudo: o cliente conta o que precisa, e o pedido caminha por estados
 * até virar contratação. A máquina é fechada porque pular estado aqui significa
 * apresentar proposta de um pedido que ninguém publicou.
 */
import { randomBytes } from 'node:crypto';
import { validarCoordenada } from './geo.mjs';

export const STATUS = ['DRAFT', 'OPEN', 'MATCHING', 'RECEIVING_QUOTES', 'SELECTING', 'CONVERTED', 'EXPIRED', 'CANCELLED'];

export const TRANSICOES = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['MATCHING', 'CANCELLED', 'EXPIRED'],
  MATCHING: ['RECEIVING_QUOTES', 'CANCELLED', 'EXPIRED'],
  RECEIVING_QUOTES: ['SELECTING', 'CANCELLED', 'EXPIRED'],
  SELECTING: ['CONVERTED', 'RECEIVING_QUOTES', 'CANCELLED', 'EXPIRED'],
  CONVERTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/** Como a tela fala de cada estado — o cliente não lê "RECEIVING_QUOTES". */
export const ROTULO = {
  DRAFT: 'Rascunho',
  OPEN: 'Publicado',
  MATCHING: 'Procurando profissionais',
  RECEIVING_QUOTES: 'Recebendo propostas',
  SELECTING: 'Escolhendo profissional',
  CONVERTED: 'Contratado',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

export const URGENCIAS = ['hoje', 'esta_semana', 'sem_pressa'];
export const ROTULO_URGENCIA = { hoje: 'Hoje', esta_semana: 'Esta semana', sem_pressa: 'Sem pressa' };

const txt = (v) => String(v ?? '').trim();

export function podeIr(de, para) {
  if (!STATUS.includes(de)) { return { ok: false, motivo: `estado desconhecido: "${de}"` }; }
  if (!STATUS.includes(para)) { return { ok: false, motivo: `estado desconhecido: "${para}"` }; }
  if (de === para) { return { ok: true, repetido: true }; }
  if (!TRANSICOES[de].includes(para)) {
    return { ok: false, motivo: `não dá pra ir de ${ROTULO[de]} para ${ROTULO[para]}` };
  }
  return { ok: true };
}

export function transitar(pedido, para, quando = new Date().toISOString()) {
  const r = podeIr(pedido?.status, para);
  if (!r.ok) { return { pedido: null, erro: r.motivo }; }
  if (r.repetido) { return { pedido, erro: null }; }
  return {
    pedido: {
      ...pedido, status: para, atualizadoEm: quando,
      linha: [...(pedido.linha || []), { status: para, em: quando }],
    },
    erro: null,
  };
}

/**
 * Valida o pedido. Descrição tem mínimo porque "quebrou" não dá pra orçar — e um
 * pedido sem informação vira proposta chutada, que vira disputa depois.
 */
export function normalizarPedido(e = {}) {
  const erros = [];
  const avisos = [];

  const categoria = txt(e.categoria);
  if (!categoria) { erros.push('escolha a categoria do serviço'); }

  const descricao = txt(e.descricao);
  if (descricao.length < 15) { erros.push('conte um pouco mais do que precisa (mínimo 15 caracteres) — sem isso ninguém consegue orçar'); }
  if (descricao.length > 2000) { erros.push('descrição muito longa (máximo 2000 caracteres)'); }

  const coord = validarCoordenada({ lat: e.lat, lng: e.lng });
  if (!coord.ok) { erros.push('localização: ' + coord.motivo); }

  const cidade = txt(e.cidade);
  if (!cidade) { erros.push('informe a cidade'); }

  const urgencia = txt(e.urgencia) || 'sem_pressa';
  if (!URGENCIAS.includes(urgencia)) { erros.push(`urgência inválida: "${e.urgencia}"`); }

  const fotos = (e.fotos || []).filter(Boolean);
  if (fotos.length > 6) { erros.push('no máximo 6 fotos'); }
  if (!fotos.length) { avisos.push('sem fotos: com foto o profissional acerta melhor o orçamento'); }

  if (erros.length) { return { pedido: null, erros, avisos }; }

  const agora = e.quando || new Date().toISOString();
  return {
    pedido: {
      id: 'ped_' + randomBytes(6).toString('hex'),
      clienteId: e.clienteId || null,
      clienteNome: txt(e.clienteNome) || null,
      categoria,
      descricao,
      lat: coord.coordenada.lat,
      lng: coord.coordenada.lng,
      endereco: txt(e.endereco) || null,
      bairro: txt(e.bairro) || null,
      cidade,
      fotos,
      urgencia,
      dataDesejada: txt(e.dataDesejada) || null,
      janela: txt(e.janela) || null,
      observacoes: txt(e.observacoes) || null,
      status: 'DRAFT',
      // Quem foi convidado (§9) — guardar permite auditar o matching depois.
      convidados: [],
      escolhidaId: null,
      criadoEm: agora,
      atualizadoEm: agora,
      linha: [{ status: 'DRAFT', em: agora }],
    },
    erros: [],
    avisos,
  };
}

/** Resumo curto pro card do prestador. */
export function resumo(p) {
  return {
    id: p.id,
    categoria: p.categoria,
    descricao: p.descricao.length > 140 ? p.descricao.slice(0, 137) + '…' : p.descricao,
    bairro: p.bairro,
    cidade: p.cidade,
    urgencia: p.urgencia,
    rotuloUrgencia: ROTULO_URGENCIA[p.urgencia],
    fotos: p.fotos.length,
    status: p.status,
    rotulo: ROTULO[p.status],
    criadoEm: p.criadoEm,
  };
}
