/**
 * VSinfluence — agenda de publicação. É o que o dashboard cadastra: para cada rede,
 * a PASTA de onde saem os vídeos e os HORÁRIOS em que sobem.
 *
 * Tudo aqui é PURO e recebe `agora` por parâmetro — o cron precisa ser testável sem
 * depender do relógio da máquina.
 */

/** Redes suportadas hoje. */
export const REDES = ['youtube', 'instagram', 'tiktok', 'kwai', 'facebook'];

/** Dias da semana, índice igual ao de Date#getDay (0 = domingo). */
export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

const HORARIO_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Um "HH:MM" válido? */
export function horarioValido(h) {
  return HORARIO_RE.test(String(h || ''));
}

/** Converte "HH:MM" em minutos desde a meia-noite. Inválido devolve null. */
export function emMinutos(h) {
  const m = HORARIO_RE.exec(String(h || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Normaliza a entrada do dashboard num slot de agenda.
 * Horário inválido e dia desconhecido são DESCARTADOS com o motivo — cadastro do
 * usuário não pode derrubar o cron nem subir vídeo em horário que ninguém pediu.
 *
 * @param {{rede:string, dir:string, horarios:string[], dias?:string[], ativo?:boolean}} entrada
 * @returns {{slot:object|null, erros:string[]}}
 */
export function normalizarSlot(entrada = {}) {
  const erros = [];
  const rede = String(entrada.rede || '').toLowerCase().trim();
  if (!REDES.includes(rede)) { erros.push(`rede desconhecida: "${entrada.rede}" (use ${REDES.join(', ')})`); }
  const dir = String(entrada.dir || '').trim();
  if (!dir) { erros.push('diretório dos vídeos é obrigatório'); }

  const horarios = [];
  for (const h of entrada.horarios || []) {
    if (horarioValido(h)) { horarios.push(h); } else { erros.push(`horário inválido: "${h}" (use HH:MM)`); }
  }
  if (!horarios.length) { erros.push('informe ao menos um horário de publicação'); }

  const dias = [];
  for (const d of entrada.dias || DIAS) {
    const k = String(d).toLowerCase().slice(0, 3);
    if (DIAS.includes(k)) { dias.push(k); } else { erros.push(`dia desconhecido: "${d}"`); }
  }

  if (erros.length) { return { slot: null, erros }; }
  return {
    slot: {
      rede,
      dir,
      horarios: [...new Set(horarios)].sort(),
      dias: [...new Set(dias)],
      ativo: entrada.ativo !== false,
    },
    erros: [],
  };
}

/**
 * Monta a agenda a partir da lista do dashboard. Um slot por rede: cadastrar a mesma
 * rede duas vezes SUBSTITUI, em vez de duplicar publicação.
 * @param {object[]} entradas
 */
export function montarAgenda(entradas = []) {
  const slots = {};
  const erros = [];
  for (const e of entradas) {
    const r = normalizarSlot(e);
    if (r.slot) { slots[r.slot.rede] = r.slot; } else { erros.push(...r.erros); }
  }
  return { agenda: { slots }, erros };
}

/** O slot publica neste dia da semana? */
export function publicaNoDia(slot, data) {
  return !!slot?.ativo && (slot.dias || []).includes(DIAS[data.getDay()]);
}

/**
 * Horários do slot que já venceram entre `desde` e `agora` (exclusivo/inclusivo).
 * É o coração do cron: em vez de exigir que o processo esteja de pé no minuto exato,
 * pergunta "o que deveria ter subido desde a última varredura?". Máquina desligada
 * na hora marcada não perde a publicação.
 *
 * @param {object} slot
 * @param {Date} desde  última varredura
 * @param {Date} agora
 * @returns {Array<{rede:string, horario:string, quando:Date}>}
 */
export function vencidosDesde(slot, desde, agora) {
  const out = [];
  if (!slot?.ativo) { return out; }
  const dia = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const limite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  while (dia <= limite) {
    if (publicaNoDia(slot, dia)) {
      for (const h of slot.horarios) {
        const min = emMinutos(h);
        const quando = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(min / 60), min % 60);
        if (quando > desde && quando <= agora) { out.push({ rede: slot.rede, horario: h, quando }); }
      }
    }
    dia.setDate(dia.getDate() + 1);
  }
  return out.sort((a, b) => a.quando - b.quando);
}

/** Próxima publicação de um slot a partir de `agora` (olha até 8 dias à frente). */
export function proximaDe(slot, agora) {
  if (!slot?.ativo) { return null; }
  for (let i = 0; i < 8; i += 1) {
    const dia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + i);
    if (!publicaNoDia(slot, dia)) { continue; }
    for (const h of slot.horarios) {
      const min = emMinutos(h);
      const quando = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(min / 60), min % 60);
      if (quando > agora) { return { rede: slot.rede, horario: h, quando }; }
    }
  }
  return null;
}

/** Próxima publicação de cada rede — o "o que sobe a seguir" do dashboard. */
export function proximasPublicacoes(agenda, agora) {
  return Object.values(agenda?.slots || {})
    .map((s) => proximaDe(s, agora))
    .filter(Boolean)
    .sort((a, b) => a.quando - b.quando);
}
