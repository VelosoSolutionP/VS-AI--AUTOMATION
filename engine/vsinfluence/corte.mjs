/**
 * VSinfluence — corte e melhoria de vídeo. Monta o PLANO (comandos ffmpeg) sem
 * executar nada: quem executa é o CLI, e só quando o usuário mandar.
 *
 * Separar plano de execução é o que deixa isso testável e auditável — dá pra ver
 * exatamente o que vai rodar na máquina do criador antes de rodar.
 */
import { join, extname, basename } from 'node:path';

/** Enquadramento por rede: vertical curto domina Shorts/Reels/TikTok. */
export const FORMATOS = {
  youtube: { w: 1920, h: 1080, maxSeg: null, nome: 'horizontal 16:9' },
  youtube_shorts: { w: 1080, h: 1920, maxSeg: 60, nome: 'vertical 9:16' },
  instagram: { w: 1080, h: 1920, maxSeg: 90, nome: 'vertical 9:16' },
  tiktok: { w: 1080, h: 1920, maxSeg: 180, nome: 'vertical 9:16' },
  kwai: { w: 1080, h: 1920, maxSeg: 60, nome: 'vertical 9:16' },
  facebook: { w: 1080, h: 1350, maxSeg: 90, nome: 'retrato 4:5' },
};

const HMS = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)(?:\.(\d{1,3}))?$/;

/** "1:02:03" | "02:03" | "123" -> segundos. Inválido devolve null. */
export function paraSegundos(t) {
  if (typeof t === 'number' && Number.isFinite(t) && t >= 0) { return t; }
  const s = String(t ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(s)) { return Number(s); }
  const m = HMS.exec(s);
  if (!m) { return null; }
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4] || 0}`);
}

/** Segundos -> "HH:MM:SS.mmm" (formato que o ffmpeg aceita em -ss/-to). */
export function paraHms(seg) {
  const s = Math.max(0, Number(seg) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`;
}

/**
 * Valida um corte pedido pelo usuário.
 * @param {{inicio:string|number, fim:string|number, titulo?:string}} c
 */
export function validarCorte(c = {}) {
  const erros = [];
  const inicio = paraSegundos(c.inicio);
  const fim = paraSegundos(c.fim);
  if (inicio == null) { erros.push(`início inválido: "${c.inicio}"`); }
  if (fim == null) { erros.push(`fim inválido: "${c.fim}"`); }
  if (inicio != null && fim != null && fim <= inicio) { erros.push('o fim tem que ser depois do início'); }
  return { inicio, fim, duracao: (inicio != null && fim != null) ? fim - inicio : null, erros };
}

/** Nome de saída previsível: <base>-<slug|n>.<ext> */
export function nomeSaida(entrada, indice, titulo) {
  const ext = extname(entrada) || '.mp4';
  const base = basename(entrada, ext);
  const slug = String(titulo || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${base}-${slug || `corte${indice + 1}`}${ext}`;
}

/**
 * Filtro de vídeo: escala mantendo proporção e preenche o resto com o próprio vídeo
 * borrado no fundo (em vez de barra preta) — é o que faz um corte de vídeo
 * horizontal não ficar amador quando vira vertical.
 */
export function filtroEnquadramento(fmt) {
  const { w, h } = fmt;
  return [
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2[bg]`,
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg]`,
    '[bg][fg]overlay=(W-w)/2:(H-h)/2',
  ].join(';');
}

/** Filtro de áudio: normaliza volume pro padrão de streaming (EBU R128). */
export const FILTRO_AUDIO = 'loudnorm=I=-14:TP=-1.5:LRA=11';

/**
 * Monta o plano completo: um comando ffmpeg por corte.
 *
 * @param {{entrada:string, saidaDir:string, rede:string, cortes:Array, melhorar?:boolean}} pedido
 * @returns {{plano:Array<{titulo:string, inicio:number, fim:number, duracao:number, saida:string, args:string[], avisos:string[]}>, erros:string[]}}
 */
export function planejarCortes(pedido = {}) {
  const erros = [];
  const entrada = String(pedido.entrada || '').trim();
  if (!entrada) { erros.push('vídeo de entrada é obrigatório'); }
  const rede = String(pedido.rede || 'youtube').toLowerCase();
  const fmt = FORMATOS[rede];
  if (!fmt) { erros.push(`rede sem formato definido: "${pedido.rede}" (use ${Object.keys(FORMATOS).join(', ')})`); }
  const cortes = pedido.cortes || [];
  if (!cortes.length) { erros.push('informe ao menos um corte (início e fim)'); }
  if (erros.length) { return { plano: [], erros }; }

  const melhorar = pedido.melhorar !== false;
  const saidaDir = pedido.saidaDir || join(entrada, '..', 'cortes');
  const plano = [];

  cortes.forEach((c, i) => {
    const v = validarCorte(c);
    if (v.erros.length) { erros.push(`corte ${i + 1}: ${v.erros.join('; ')}`); return; }

    const avisos = [];
    if (fmt.maxSeg && v.duracao > fmt.maxSeg) {
      avisos.push(`${Math.round(v.duracao)}s excede o limite de ${fmt.maxSeg}s do ${rede} — a plataforma pode cortar`);
    }
    const saida = join(saidaDir, nomeSaida(entrada, i, c.titulo));

    // -ss antes do -i faz seek rápido; -to depois do -i conta a partir do corte.
    const args = ['-hide_banner', '-y', '-ss', paraHms(v.inicio), '-i', entrada, '-t', paraHms(v.duracao)];
    if (melhorar) {
      args.push('-filter_complex', filtroEnquadramento(fmt), '-af', FILTRO_AUDIO,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k');
    } else {
      args.push('-c', 'copy');
    }
    args.push('-movflags', '+faststart', saida);

    plano.push({ titulo: c.titulo || `Corte ${i + 1}`, inicio: v.inicio, fim: v.fim, duracao: v.duracao, saida, args, avisos });
  });

  return { plano, erros };
}

/** Linha legível do comando (pra mostrar antes de executar). */
export function comandoLegivel(item) {
  return `ffmpeg ${item.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
}
