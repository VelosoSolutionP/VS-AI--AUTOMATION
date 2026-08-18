/**
 * VSinfluence — varredura do cron. Roda de tempos em tempos e responde:
 * "algum horário venceu desde a última passada e existe vídeo novo pra subir?".
 *
 * Puro e com I/O injetável: o cron só junta as peças, a decisão toda é testável.
 */
import { vencidosDesde } from './agenda.mjs';
import { listarVideos, naoPublicados } from './biblioteca.mjs';

/**
 * @param {object} agenda      { slots: { rede: slot } }
 * @param {object} publicados  registro de já publicados
 * @param {Date} desde         última varredura
 * @param {Date} agora
 * @param {{listarImpl?:Function}} [io]
 * @returns {{pendentes:Array, semVideo:Array, erros:string[]}}
 *   pendentes = horário venceu E tem vídeo disponível
 *   semVideo  = horário venceu mas a pasta não tem nada novo (o criador está devendo conteúdo)
 */
export function varrer(agenda, publicados, desde, agora, io = {}) {
  const listar = io.listarImpl || listarVideos;
  const pendentes = [];
  const semVideo = [];
  const erros = [];
  const cacheFila = {};

  for (const slot of Object.values(agenda?.slots || {})) {
    const vencidos = vencidosDesde(slot, desde, agora);
    if (!vencidos.length) { continue; }

    if (!cacheFila[slot.rede]) {
      const { videos, erro } = listar(slot.dir);
      if (erro) { erros.push(`${slot.rede}: ${erro}`); cacheFila[slot.rede] = []; continue; }
      cacheFila[slot.rede] = naoPublicados(slot.rede, videos, publicados);
    }

    // Cada horário vencido consome UM vídeo da fila — dois horários vencidos com um
    // único vídeo na pasta geram uma publicação e uma cobrança de conteúdo.
    for (const v of vencidos) {
      const proximo = cacheFila[slot.rede].shift();
      if (proximo) {
        pendentes.push({ rede: slot.rede, horario: v.horario, quando: v.quando, video: proximo, dir: slot.dir });
      } else {
        semVideo.push({ rede: slot.rede, horario: v.horario, quando: v.quando, dir: slot.dir });
      }
    }
  }

  pendentes.sort((a, b) => a.quando - b.quando);
  semVideo.sort((a, b) => a.quando - b.quando);
  return { pendentes, semVideo, erros };
}

/**
 * Linha de resumo pra notificação (Slack/WhatsApp) — o criador bate o olho e sabe
 * se tem coisa subindo e se está devendo vídeo.
 */
export function resumo({ pendentes, semVideo, erros }) {
  const partes = [];
  partes.push(pendentes.length ? `${pendentes.length} vídeo(s) prontos pra subir` : 'nada pra subir');
  if (semVideo.length) {
    const redes = [...new Set(semVideo.map((s) => s.rede))].join(', ');
    partes.push(`SEM VÍDEO em ${semVideo.length} horário(s) (${redes})`);
  }
  if (erros.length) { partes.push(`${erros.length} erro(s) de pasta`); }
  return partes.join(' — ');
}
