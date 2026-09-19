/**
 * Quebra-Galho — qualidade: incidentes, strikes e a política que decide consequência.
 *
 * A regra que atravessa o arquivo inteiro, e que a spec repete três vezes:
 * **avaliação ruim NÃO é infração.** Nota baixa é opinião do cliente; incidente é
 * ocorrência apurada. Se fossem a mesma coisa, alguém acabaria desativando um
 * profissional por causa de três clientes mal-humorados.
 *
 * E a política é CONFIGURÁVEL, não escrita no código. "10 notas abaixo de 3 = banido"
 * e "2 graves = desativado" são propostas comerciais que dependem de aprovação
 * jurídica. Codificar isso direto significaria aplicar punição que ninguém aprovou —
 * e defender isso depois, num processo, seria impossível.
 */
import { randomBytes } from 'node:crypto';

export const SEVERIDADES = ['LOW', 'MEDIUM', 'HIGH'];

export const ORIGENS = [
  'CUSTOMER_COMPLAINT', 'PROVIDER_COMPLAINT', 'DISPUTE_RESULT', 'FRAUD',
  'NO_SHOW', 'ABANDONMENT', 'DAMAGE', 'CONTRACT_VIOLATION',
];

export const ROTULO_ORIGEM = {
  CUSTOMER_COMPLAINT: 'Reclamação do cliente',
  PROVIDER_COMPLAINT: 'Reclamação do profissional',
  DISPUTE_RESULT: 'Resultado de contestação',
  FRAUD: 'Suspeita de fraude',
  NO_SHOW: 'Não compareceu',
  ABANDONMENT: 'Abandonou o serviço',
  DAMAGE: 'Dano causado',
  CONTRACT_VIOLATION: 'Descumpriu o combinado',
};

/** Fluxo do §22. Só FINAL gera consequência definitiva. */
export const ESTADOS = ['INCIDENT_OPEN', 'UNDER_ANALYSIS', 'CONFIRMED', 'DISMISSED', 'APPEALED', 'FINAL'];

export const TRANSICOES = {
  INCIDENT_OPEN: ['UNDER_ANALYSIS', 'DISMISSED'],
  UNDER_ANALYSIS: ['CONFIRMED', 'DISMISSED'],
  CONFIRMED: ['APPEALED', 'FINAL'],
  DISMISSED: [],
  APPEALED: ['FINAL', 'DISMISSED'],
  FINAL: [],
};

export const ROTULO_ESTADO = {
  INCIDENT_OPEN: 'Aberto', UNDER_ANALYSIS: 'Em análise', CONFIRMED: 'Confirmado',
  DISMISSED: 'Descartado', APPEALED: 'Em recurso', FINAL: 'Definitivo',
};

/**
 * Política padrão — valores de PARTIDA, não decididos. Cada um carrega o que
 * depende de aprovação, para a tela poder mostrar isso ao operador.
 */
export const POLITICA_PADRAO = {
  versao: 'rascunho-1',
  aprovadaPorJuridico: false,
  gravesParaDesativar: 2,
  janelaDias: 180,
  notaMinima: 3,
  servicosParaRevisao: 10,
  // O que a política FAZ quando dispara. "sugerir" não pune ninguém sozinho.
  acao: 'sugerir_revisao',
};

const txt = (v) => String(v ?? '').trim();

export function podeIr(de, para) {
  if (!ESTADOS.includes(de) || !ESTADOS.includes(para)) { return { ok: false, motivo: 'estado desconhecido' }; }
  if (de === para) { return { ok: true, repetido: true }; }
  if (!TRANSICOES[de].includes(para)) {
    return { ok: false, motivo: `não dá pra ir de "${ROTULO_ESTADO[de]}" para "${ROTULO_ESTADO[para]}"` };
  }
  return { ok: true };
}

/** Abre um incidente. Nasce ABERTO — nada é confirmado por quem reclama. */
export function abrirIncidente(e = {}) {
  const erros = [];
  const severidade = txt(e.severidade).toUpperCase();
  if (!SEVERIDADES.includes(severidade)) { erros.push(`severidade inválida: "${e.severidade}" (use ${SEVERIDADES.join(', ')})`); }
  const origem = txt(e.origem).toUpperCase();
  if (!ORIGENS.includes(origem)) { erros.push(`origem desconhecida: "${e.origem}"`); }
  if (!txt(e.alvoId)) { erros.push('informe quem é o alvo do incidente'); }
  const alvoTipo = txt(e.alvoTipo).toLowerCase() || 'prestador';
  // §23: o cliente também tem reputação operacional. Não se assume que ele sempre tem razão.
  if (!['prestador', 'cliente'].includes(alvoTipo)) { erros.push('alvo deve ser prestador ou cliente'); }
  const descricao = txt(e.descricao);
  if (descricao.length < 15) { erros.push('descreva a ocorrência com um pouco mais de detalhe'); }
  if (erros.length) { return { incidente: null, erros }; }

  const agora = e.quando || new Date().toISOString();
  return {
    incidente: {
      id: 'inc_' + randomBytes(6).toString('hex'),
      alvoTipo, alvoId: txt(e.alvoId),
      severidade, origem, rotuloOrigem: ROTULO_ORIGEM[origem],
      descricao,
      ordemId: e.ordemId || null,
      disputaId: e.disputaId || null,
      abertoPor: e.abertoPor || null,
      estado: 'INCIDENT_OPEN',
      historico: [{ estado: 'INCIDENT_OPEN', em: agora, por: e.abertoPor || null }],
      criadoEm: agora,
    },
    erros: [],
  };
}

/**
 * Move o incidente. CONFIRMED e FINAL exigem justificativa: tirar o sustento de
 * alguém sem registrar o porquê é indefensável depois.
 */
export function mover(incidente, para, opts = {}) {
  const r = podeIr(incidente?.estado, para);
  if (!r.ok) { return { incidente: null, erro: r.motivo }; }
  if (r.repetido) { return { incidente, erro: null }; }
  const just = txt(opts.justificativa);
  if (['CONFIRMED', 'FINAL', 'DISMISSED'].includes(para) && !just) {
    return { incidente: null, erro: `mudar para "${ROTULO_ESTADO[para]}" exige justificativa registrada` };
  }
  const quando = opts.quando || new Date().toISOString();
  return {
    incidente: {
      ...incidente, estado: para, atualizadoEm: quando,
      historico: [...incidente.historico, { estado: para, em: quando, por: opts.por || null, justificativa: just || null }],
    },
    erro: null,
  };
}

/** Só incidente FINAL e grave vira strike. É o que o §22 manda. */
export function viraStrike(incidente) {
  return incidente?.estado === 'FINAL' && incidente?.severidade === 'HIGH';
}

export function strikesDe(incidentes = [], alvoId, politica = POLITICA_PADRAO, agora = Date.now()) {
  const limite = agora - (politica.janelaDias || 180) * 86400000;
  return incidentes.filter((i) => i.alvoId === alvoId && viraStrike(i)
    && new Date(i.criadoEm).getTime() >= limite);
}

/**
 * Avalia a política e RECOMENDA. Nunca aplica sozinha.
 *
 * Devolve sempre `aplicavel`: falso enquanto a política não tiver aprovação
 * jurídica. Assim a tela mostra "isto ainda não vale" em vez de o operador achar
 * que o sistema já está punindo.
 */
export function avaliarPolitica({ incidentes = [], avaliacoes = [], alvoId, politica = POLITICA_PADRAO, agora = Date.now() }) {
  const strikes = strikesDe(incidentes, alvoId, politica, agora);
  const minhas = avaliacoes.filter((a) => a.prestadorId === alvoId);
  const ruins = minhas.filter((a) => a.estrelas < (politica.notaMinima ?? 3));

  const gatilhos = [];
  if (strikes.length >= (politica.gravesParaDesativar ?? 2)) {
    gatilhos.push({
      tipo: 'strikes',
      texto: `${strikes.length} ocorrência(s) grave(s) confirmada(s) em ${politica.janelaDias} dias`,
      sugestao: 'desativacao',
    });
  }
  if (minhas.length >= (politica.servicosParaRevisao ?? 10) && ruins.length >= (politica.servicosParaRevisao ?? 10)) {
    gatilhos.push({
      tipo: 'avaliacoes',
      texto: `${ruins.length} avaliação(ões) abaixo de ${politica.notaMinima} estrelas`,
      sugestao: 'revisao',
    });
  }

  return {
    alvoId,
    strikes: strikes.length,
    avaliacoesRuins: ruins.length,
    totalAvaliacoes: minhas.length,
    gatilhos,
    disparou: gatilhos.length > 0,
    // A trava que impede punição não aprovada de acontecer sozinha.
    aplicavel: Boolean(politica.aprovadaPorJuridico),
    politicaVersao: politica.versao,
    recomendacao: gatilhos.length === 0 ? null
      : politica.aprovadaPorJuridico
        ? gatilhos[0].sugestao
        : 'nenhuma — a política ainda não foi aprovada juridicamente (§20, §22)',
  };
}

/** Reputação operacional do CLIENTE (§23) — nunca por só ter reclamado. */
export function reputacaoCliente(incidentes = [], clienteId) {
  const meus = incidentes.filter((i) => i.alvoTipo === 'cliente' && i.alvoId === clienteId && i.estado === 'FINAL');
  return {
    clienteId,
    incidentesConfirmados: meus.length,
    // Contestar não é infração. Só entra aqui o que foi apurado e virou FINAL.
    porOrigem: meus.reduce((a, i) => ({ ...a, [i.origem]: (a[i.origem] || 0) + 1 }), {}),
  };
}
