/**
 * VSinfluence — controle de lives. Agenda, acompanha e fecha transmissões ao vivo.
 *
 * Live tem métrica própria que vídeo gravado não tem (pico de espectadores, tempo no
 * ar, doações durante a transmissão), por isso não cabe no mesmo modelo de vídeo.
 */
import { paraCentavos, formatarBRL } from './ganhos.mjs';

export const SITUACOES = ['agendada', 'ao_vivo', 'encerrada', 'cancelada'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d/;

/**
 * Valida e normaliza uma live.
 * @param {{titulo:string, rede:string, inicio:string, duracaoMin?:number, redes?:string[]}} l
 */
export function normalizarLive(l = {}) {
  const erros = [];
  const titulo = String(l.titulo || '').trim();
  if (!titulo) { erros.push('título da live é obrigatório'); }
  const rede = String(l.rede || '').toLowerCase();
  if (!rede) { erros.push('rede da live é obrigatória'); }
  const inicio = String(l.inicio || '');
  if (!ISO_RE.test(inicio)) { erros.push(`início inválido: "${l.inicio}" (use AAAA-MM-DDTHH:MM)`); }
  const duracaoMin = l.duracaoMin == null ? null : Number(l.duracaoMin);
  if (duracaoMin != null && (!Number.isFinite(duracaoMin) || duracaoMin <= 0)) {
    erros.push(`duração inválida: "${l.duracaoMin}"`);
  }
  if (erros.length) { return { live: null, erros }; }
  return {
    live: {
      id: l.id || `${rede}-${inicio.slice(0, 16).replace(/[:T-]/g, '')}`,
      titulo, rede, inicio, duracaoMin,
      situacao: SITUACOES.includes(l.situacao) ? l.situacao : 'agendada',
      picoEspectadores: l.picoEspectadores ?? null,
      espectadoresMedio: l.espectadoresMedio ?? null,
      minutosNoAr: l.minutosNoAr ?? null,
      doacoesCentavos: l.doacoes != null ? paraCentavos(l.doacoes) : null,
      novosSeguidores: l.novosSeguidores ?? null,
    },
    erros: [],
  };
}

/** Situação derivada do relógio — `agendada` vira `ao_vivo` e depois `encerrada`. */
export function situacaoPor(live, agora) {
  if (live.situacao === 'cancelada' || live.situacao === 'encerrada') { return live.situacao; }
  const ini = new Date(live.inicio);
  if (agora < ini) { return 'agendada'; }
  if (live.duracaoMin == null) { return 'ao_vivo'; }
  return agora <= new Date(ini.getTime() + live.duracaoMin * 60000) ? 'ao_vivo' : 'encerrada';
}

/** Próximas lives a partir de `agora`, mais próxima primeiro. */
export function proximas(lives = [], agora, limite = 5) {
  return lives
    .filter((l) => situacaoPor(l, agora) === 'agendada')
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))
    .slice(0, limite);
}

/**
 * Fechamento de uma live encerrada: retenção e ganho por hora no ar.
 * Retenção = média / pico. Sem pico não há retenção (null, não zero).
 */
export function fechamentoLive(live) {
  const retencao = (live.picoEspectadores && live.espectadoresMedio != null)
    ? Number((live.espectadoresMedio / live.picoEspectadores).toFixed(4))
    : null;
  const porHora = (live.doacoesCentavos != null && live.minutosNoAr)
    ? Math.round(live.doacoesCentavos / (live.minutosNoAr / 60))
    : null;
  return {
    id: live.id,
    titulo: live.titulo,
    rede: live.rede,
    minutosNoAr: live.minutosNoAr,
    picoEspectadores: live.picoEspectadores,
    espectadoresMedio: live.espectadoresMedio,
    retencao,
    novosSeguidores: live.novosSeguidores,
    doacoesCentavos: live.doacoesCentavos,
    doacoesFormatado: formatarBRL(live.doacoesCentavos),
    ganhoPorHoraCentavos: porHora,
    ganhoPorHoraFormatado: formatarBRL(porHora),
  };
}
