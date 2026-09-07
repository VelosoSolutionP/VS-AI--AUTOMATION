/**
 * VSinfluence — orquestrador. Junta agenda, biblioteca, varredura, cortes, campanhas,
 * ganhos e lives sobre o store local, e monta a visão do dashboard.
 *
 * As funções de decisão vivem nos módulos puros; aqui só tem I/O e composição.
 */
import { load, save } from './store.mjs';
import { montarAgenda, proximasPublicacoes } from './agenda.mjs';
import { listarVideos, naoPublicados, marcarPublicado } from './biblioteca.mjs';
import { varrer, resumo } from './varredura.mjs';
import { planejarCortes, comandoLegivel } from './corte.mjs';
import { normalizarCampanha, desempenho, situacao } from './campanhas.mjs';
import { normalizarGanho, fechamento } from './ganhos.mjs';
import { normalizarLive, situacaoPor, proximas, fechamentoLive } from './lives.mjs';
import { normalizar, agregar } from './metricas.mjs';

const AGENDA = 'agenda';
const PUBLICADOS = 'publicados';
const CAMPANHAS = 'campanhas';
const GANHOS = 'ganhos';
const LIVES = 'lives';
const MEDICOES = 'medicoes';
const ESTADO = 'estado';

/* ---------------- agenda (o cadastro do dashboard) ---------------- */

/** Cadastra a agenda inteira. Devolve os erros SEM gravar se algum slot for inválido. */
export function cadastrarAgenda(entradas) {
  const { agenda, erros } = montarAgenda(entradas);
  if (erros.length) { return { ok: false, erros }; }
  save(AGENDA, agenda);
  return { ok: true, agenda, erros: [] };
}

export function getAgenda() {
  return load(AGENDA, { slots: {} });
}

/* ---------------- varredura (o que o cron chama) ---------------- */

/**
 * Roda a varredura desde a última execução. Grava o novo marco só se pedido —
 * assim dá pra rodar em modo consulta sem "consumir" a janela.
 * @param {Date} agora
 * @param {{persistir?:boolean}} [opts]
 */
export function rodarVarredura(agora, opts = {}) {
  const estado = load(ESTADO, {});
  const desde = estado.ultimaVarredura ? new Date(estado.ultimaVarredura) : new Date(agora.getTime() - 24 * 3600 * 1000);
  const r = varrer(getAgenda(), load(PUBLICADOS, {}), desde, agora);
  if (opts.persistir !== false) { save(ESTADO, { ...estado, ultimaVarredura: agora.toISOString() }); }
  return { ...r, desde, agora, resumo: resumo(r) };
}

/** Marca um vídeo como publicado numa rede. */
export function registrarPublicacao(rede, arquivo, dados = {}) {
  const atual = load(PUBLICADOS, {});
  const novo = marcarPublicado(atual, rede, arquivo, dados);
  save(PUBLICADOS, novo);
  return novo;
}

/** Fila de uma rede: o que ainda não subiu, do mais antigo pro mais novo. */
export function fila(rede) {
  const slot = getAgenda().slots?.[rede];
  if (!slot) { return { fila: [], erro: `rede "${rede}" não está na agenda` }; }
  const { videos, erro } = listarVideos(slot.dir);
  if (erro) { return { fila: [], erro }; }
  return { fila: naoPublicados(rede, videos, load(PUBLICADOS, {})), erro: null };
}

/* ---------------- cortes ---------------- */

/** Planeja os cortes (não executa). Devolve os comandos legíveis pra conferência. */
export function planejarCorte(pedido) {
  const r = planejarCortes(pedido);
  return { ...r, comandos: r.plano.map(comandoLegivel) };
}

/* ---------------- campanhas ---------------- */

export function criarCampanha(dados) {
  const { campanha, erros } = normalizarCampanha(dados);
  if (erros.length) { return { ok: false, erros }; }
  const lista = load(CAMPANHAS, []);
  const semDuplicata = lista.filter((c) => c.id !== campanha.id);
  save(CAMPANHAS, [...semDuplicata, campanha]);
  return { ok: true, campanha, erros: [] };
}

export function listarCampanhas(hoje) {
  return load(CAMPANHAS, []).map((c) => ({ ...c, situacao: situacao(c, hoje) }));
}

export function desempenhoCampanha(id, hoje) {
  const c = load(CAMPANHAS, []).find((x) => x.id === id);
  if (!c) { return { erro: `campanha "${id}" não encontrada` }; }
  const ganhosDela = load(GANHOS, []).filter((g) => g.campanhaId === id);
  return desempenho(c, load(MEDICOES, []), ganhosDela, hoje);
}

/* ---------------- ganhos ---------------- */

export function lancarGanho(dados) {
  const { ganho, erros } = normalizarGanho(dados);
  if (erros.length) { return { ok: false, erros }; }
  const registro = { ...ganho, campanhaId: dados.campanhaId || null };
  save(GANHOS, [...load(GANHOS, []), registro]);
  return { ok: true, ganho: registro, erros: [] };
}

export function fechamentoMes(mes) {
  const views = agregar(load(MEDICOES, [])).totais.views;
  return fechamento(load(GANHOS, []), mes, views);
}

/* ---------------- métricas ---------------- */

/** Guarda uma medição já normalizada a partir do payload cru da API. */
export function registrarMetrica(rede, payload, videoId, coletadoEm) {
  const m = normalizar(rede, payload, videoId, coletadoEm);
  save(MEDICOES, [...load(MEDICOES, []), m]);
  return m;
}

/* ---------------- lives ---------------- */

export function agendarLive(dados) {
  const { live, erros } = normalizarLive(dados);
  if (erros.length) { return { ok: false, erros }; }
  const lista = load(LIVES, []).filter((l) => l.id !== live.id);
  save(LIVES, [...lista, live]);
  return { ok: true, live, erros: [] };
}

export function listarLives(agora) {
  return load(LIVES, []).map((l) => ({ ...l, situacao: situacaoPor(l, agora) }));
}

export function fecharLive(id, dados = {}) {
  const lista = load(LIVES, []);
  const i = lista.findIndex((l) => l.id === id);
  if (i < 0) { return { ok: false, erros: [`live "${id}" não encontrada`] }; }
  const { live, erros } = normalizarLive({ ...lista[i], ...dados, situacao: 'encerrada' });
  if (erros.length) { return { ok: false, erros }; }
  lista[i] = live;
  save(LIVES, lista);
  return { ok: true, live, fechamento: fechamentoLive(live), erros: [] };
}

/* ---------------- dashboard ---------------- */

/**
 * Visão única do dashboard: o que sobe a seguir, o que está pendente, se está
 * faltando conteúdo, campanhas ativas, ganhos do mês e próximas lives.
 * @param {Date} agora
 */
export function dashboard(agora) {
  const hoje = agora.toISOString().slice(0, 10);
  const mes = hoje.slice(0, 7);
  const v = rodarVarredura(agora, { persistir: false });
  const medicoes = load(MEDICOES, []);
  return {
    agora: agora.toISOString(),
    proximasPublicacoes: proximasPublicacoes(getAgenda(), agora),
    pendentes: v.pendentes,
    semVideo: v.semVideo,
    alertas: [
      ...v.erros,
      ...(v.semVideo.length ? [`faltou vídeo em ${v.semVideo.length} horário(s) — a agenda está furada`] : []),
    ],
    campanhasAtivas: listarCampanhas(hoje).filter((c) => c.situacao === 'ativa'),
    metricas: agregar(medicoes),
    ganhosDoMes: fechamentoMes(mes),
    proximasLives: proximas(load(LIVES, []), agora),
  };
}
