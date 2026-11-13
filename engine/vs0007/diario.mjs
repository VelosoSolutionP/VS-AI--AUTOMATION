/**
 * DIÁRIO DO 0007 (12/11, dono: "quero ver em tempo real o que o 0007 está fazendo"
 * + auditor quinzenal só com o que importa).
 *
 * Cada coisa que o 0007 faz vira uma linha: homologou, tentou, mudou uma IA (e por
 * quê), ficou fora do ar (e por quê), não homologou no prazo. A tela lê ao vivo; o
 * auditor de 15 dias separa o relevante, na ordem que o dono pediu:
 *   1. prazo  — IA que não homologou no prazo (o mais importante)
 *   2. inoperante — 0007 fora do ar e o motivo
 *   3. mudou-ia — o 0007 mudou uma IA e o motivo (a falha que ele viu)
 * Só registra; não decide nada (comportamento dos bots é do 0007).
 */
import { load, save } from '../vscrm/store.mjs';

export const DATASET_DIARIO = 'vs0007-diario';
const LIMITE = 3000;
export const DIAS_AUDITORIA = 15;

/** tipo → peso no auditor (quanto menor, mais importante) e se entra no auditor. */
export const TIPOS = Object.freeze({
  prazo: { rotulo: 'Não homologou no prazo', peso: 1, relevante: true, nivel: 'critico' },
  inoperante: { rotulo: '0007 inoperante', peso: 2, relevante: true, nivel: 'critico' },
  'mudou-ia': { rotulo: 'Mudou uma IA', peso: 3, relevante: true, nivel: 'alerta' },
  falha: { rotulo: 'Tentativa falhou', peso: 4, relevante: true, nivel: 'alerta' },
  voltou: { rotulo: '0007 voltou', peso: 5, relevante: false, nivel: 'ok' },
  homologou: { rotulo: 'Homologou', peso: 6, relevante: false, nivel: 'ok' },
  correcao: { rotulo: 'Corrigiu registro', peso: 6, relevante: false, nivel: 'info' },
  modelos: { rotulo: 'Modelos free', peso: 7, relevante: false, nivel: 'info' },
  info: { rotulo: 'Atividade', peso: 8, relevante: false, nivel: 'info' },
});

const corta = (v, n) => (v == null ? null : String(v).slice(0, n));

/** Grava uma linha. Nunca derruba quem chamou. */
export function registrar({ tipo = 'info', titulo, detalhe = null, agenteId = null, nome = null, motivo = null, em = new Date() } = {}) {
  try {
    const t = TIPOS[tipo] ? tipo : 'info';
    const linhas = load(DATASET_DIARIO, []);
    const item = {
      id: `${Date.parse(em) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      em: new Date(em).toISOString(),
      tipo: t,
      nivel: TIPOS[t].nivel,
      titulo: corta(titulo || TIPOS[t].rotulo, 200),
      detalhe: corta(detalhe, 600),
      motivo: corta(motivo, 400),
      agenteId: corta(agenteId, 80),
      nome: corta(nome, 120),
    };
    linhas.push(item);
    save(DATASET_DIARIO, linhas.length > LIMITE ? linhas.slice(-LIMITE) : linhas);
    return item;
  } catch {
    return null;
  }
}

/** Últimas linhas, mais nova primeiro. `depois` (ISO) traz só o que chegou depois. */
export function listar({ limite = 80, depois = null } = {}) {
  let linhas = load(DATASET_DIARIO, []);
  if (depois) { const t = Date.parse(depois); if (Number.isFinite(t)) linhas = linhas.filter((l) => Date.parse(l.em) > t); }
  return linhas.slice(-Math.max(1, Math.min(500, limite))).reverse();
}

/** Estado atual do 0007: no ar ou inoperante (última linha inoperante/voltou decide). */
export function estado() {
  const linhas = load(DATASET_DIARIO, []);
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i];
    if (l.tipo === 'inoperante') return { noAr: false, desde: l.em, motivo: l.motivo || l.detalhe || l.titulo };
    if (l.tipo === 'voltou') return { noAr: true, desde: l.em };
  }
  return { noAr: true, desde: null };
}

/**
 * Marca o 0007 inoperante ou de volta, só quando o estado MUDA (o relógio chama a cada
 * rodada; sem isso o diário enchia de "continua fora").
 */
export function marcarSaude(noAr, motivo = null, em = new Date()) {
  const atual = estado();
  if (noAr && !atual.noAr) return registrar({ tipo: 'voltou', titulo: '0007 voltou a operar', detalhe: `Ficou fora desde ${atual.desde}`, em });
  if (!noAr && atual.noAr) return registrar({ tipo: 'inoperante', titulo: '0007 inoperante', motivo, em });
  return null;
}

/** Auditor quinzenal: só o relevante dos últimos 15 dias, na ordem de importância. */
export function auditoria({ agora = new Date(), dias = DIAS_AUDITORIA } = {}) {
  const desde = agora.getTime() - dias * 86400000;
  const linhas = load(DATASET_DIARIO, []).filter((l) => Date.parse(l.em) >= desde);
  const contagem = {};
  for (const l of linhas) contagem[l.tipo] = (contagem[l.tipo] || 0) + 1;
  const relevantes = linhas
    .filter((l) => TIPOS[l.tipo]?.relevante)
    .sort((a, b) => (TIPOS[a.tipo].peso - TIPOS[b.tipo].peso) || (Date.parse(b.em) - Date.parse(a.em)));
  return {
    dias,
    desde: new Date(desde).toISOString(),
    total: linhas.length,
    contagem,
    relevantes: relevantes.slice(0, 60),
    estado: estado(),
  };
}
