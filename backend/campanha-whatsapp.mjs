/**
 * Campanha no WhatsApp — Contagem, Betim e BH (03/10).
 *
 * Dono: "faz uma campanha pros clientes de Contagem, Betim, BH, qualquer
 * comércio que seja plausível venda via WhatsApp… texto simples e o vídeo…
 * 80 empresas, principalmente os que já usam Meta" e, avisado de que sai pelo
 * número da produção (Micaela) e pode dar ban: "manda o que der".
 *
 * Exceção À REGRA DA PESCARIA (WhatsApp frio nunca automático), dada por ele.
 * Por isso o freio é daqui, não da tela:
 *  - CONFERE primeiro (só pergunta ao WhatsApp, nada sai): tem conta? é Business?
 *    Business vai primeiro — é comércio que já vende pelo WhatsApp;
 *  - UMA mensagem por empresa: o vídeo com o texto na legenda + link de sair;
 *  - devagar: 4 a 6 min entre uma e outra, só em horário comercial (fora do
 *    almoço), no máximo CAMPANHA_WPP_DIA por dia (padrão 40), META no total (80);
 *  - 3 falhas seguidas = para (sinal de bloqueio) e fica na trilha da vida;
 *  - quem recebe sai da fila do e-mail (vira "contatado" na Prospecção).
 * Desliga: POST /crm/api/prospeccao/campanha-whatsapp {ligado:false}.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dentroDaCasa } from '../engine/casa.mjs';
import * as prosp from '../engine/vsprospeccao/index.mjs';
import * as vida from './vida.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CIDADES = ['CONTAGEM', 'BETIM', 'BELO HORIZONTE'];
const VIDEO = () => process.env.CAMPANHA_WPP_VIDEO || join(RAIZ, 'docs', 'prospeccao', 'video-bolso-cheio-lanchonete.mp4');
export const meta = () => Math.max(1, Number(process.env.CAMPANHA_WPP_META) || 80);
export const porDia = () => Math.max(1, Number(process.env.CAMPANHA_WPP_DIA) || 40);
const intervaloMs = () => {
  const min = Math.max(0, Number(process.env.CAMPANHA_WPP_INTERVALO_MIN ?? 4));
  return Math.round((min + Math.random() * 2) * 60000);
};
const CONSULTAS_POR_TICK = 3;

const arq = () => (process.env.VSPROSPECCAO_DIR ? join(process.env.VSPROSPECCAO_DIR, 'campanha-whatsapp.json') : dentroDaCasa('vsprospeccao', 'campanha-whatsapp.json'));
/* 06/10 (dono): "em atendimentos, não em propagandas" — o número da Micaela é só
   atendimento; propaganda sai do número dele, à mão. DESLIGADA por padrão. */
function ler() {
  try { return { ligado: false, fila: {}, ...JSON.parse(readFileSync(arq(), 'utf8')) }; }
  catch { return { ligado: false, fila: {}, criadaEm: new Date().toISOString() }; }
}
const gravar = (d) => { mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 }); writeFileSync(arq(), JSON.stringify(d, null, 2), { mode: 0o600 }); };

/* Horário de Brasília (UTC-3, sem horário de verão). */
const brt = (d) => new Date(new Date(d).getTime() - 3 * 3600000);
const diaBR = (d) => brt(d).toISOString().slice(0, 10);
/** Seg–sex 9h–11h30 e 14h–17h30; sábado só de manhã; domingo não. */
export function dentroDoHorario(agora = new Date()) {
  const b = brt(agora);
  const wd = b.getUTCDay();
  const m = b.getUTCHours() * 60 + b.getUTCMinutes();
  if (wd === 0) { return false; }
  const manha = m >= 9 * 60 && m < 11 * 60 + 30;
  if (wd === 6) { return manha; }
  return manha || (m >= 14 * 60 && m < 17 * 60 + 30);
}
/* Conferir é invisível pro outro lado, mas fica no horário de gente (7h–21h). */
const horaDeConferir = (agora) => { const h = brt(agora).getUTCHours(); return h >= 7 && h < 21; };

/** O texto que vai na legenda do vídeo. Simples, diz quem é, por quê, de onde veio, e como sair. */
export function texto(c, { agora = new Date(), origem = null } = {}) {
  const sair = prosp.linkSair(c, origem);
  return `${prosp.saudacao(agora)}! Aqui é o Fabiano, da Veloso Solution, de BH.\n\n`
    + 'Vi que vocês atendem pelo WhatsApp. O ZEST atende seus clientes no WhatsApp 24 horas: tira o pedido, calcula a entrega e manda o link de pagamento, sem trocar o sistema que vocês já usam. No vídeo (1 minuto) dá pra ver funcionando numa lanchonete.\n\n'
    + 'Se fizer sentido, me responde aqui.\n\n'
    + (sair ? `Se não tiver interesse, toque aqui e tiramos seu contato: ${sair}\n\n` : 'Se não tiver interesse, responda SAIR e tiramos seu contato.\n\n')
    + 'Seu contato veio dos dados públicos de empresas da Receita Federal.';
}

/** Comércio das 3 cidades, ainda não contatado, com telefone e sem pedido de sair. Contagem e Betim antes de BH. */
function candidatos() {
  const ordem = (c) => CIDADES.indexOf(c.cidade);
  return prosp.contatosParaCampanha({ cidades: CIDADES }).sort((a, b) => ordem(a) - ordem(b));
}

export function estado({ agora = new Date() } = {}) {
  const d = ler();
  const itens = Object.values(d.fila);
  const conta = (s) => itens.filter((x) => x.status === s).length;
  const hoje = itens.filter((x) => x.status === 'enviado' && diaBR(x.enviadoEm) === diaBR(agora)).length;
  return {
    ligado: d.ligado, parou: d.parou || null, meta: meta(), porDia: porDia(), hoje,
    conferidos: itens.filter((x) => x.conferidoEm).length,
    business: itens.filter((x) => x.business).length,
    comWhatsApp: itens.filter((x) => x.existe).length,
    semWhatsApp: conta('sem-whatsapp'), enviados: conta('enviado'), falhas: conta('falhou'),
    faltaConferir: candidatos().filter((c) => !d.fila[c.id]).length,
    proximoEnvioEm: d.proximoEnvioEm || null, dentroDoHorario: dentroDoHorario(agora),
    ultimos: itens.filter((x) => x.status === 'enviado').sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm))).slice(0, 5)
      .map((x) => ({ nome: x.nome, cidade: x.cidade, business: x.business, enviadoEm: x.enviadoEm })),
  };
}

export function ligar(ligado, { por = null } = {}) {
  const d = ler();
  d.ligado = !!ligado; d.mudouPor = por; d.mudouEm = new Date().toISOString();
  if (ligado) { d.parou = null; d.falhasSeguidas = 0; }
  gravar(d);
  vida.registrar('campanha-whatsapp:' + (ligado ? 'ligada' : 'desligada'), { por });
  return { ok: true, ...estado() };
}

let rodando = false;
let videoCache = null;
const video = () => (videoCache ||= `data:video/mp4;base64,${readFileSync(VIDEO()).toString('base64')}`);

/**
 * Um passo, chamado pelo relógio do servidor (30 s): confere alguns números
 * e, se for hora, manda UMA mensagem. deps = { conectado, consultar, enviar, origem }.
 */
export async function tick({ agora = new Date(), deps } = {}) {
  if (rodando) { return { ok: false, motivo: 'passo anterior ainda rodando' }; }
  rodando = true;
  try { return await passo(agora, deps); } finally { rodando = false; }
}

async function passo(agora, deps) {
  const d = ler();
  if (!d.ligado) { return { ok: false, motivo: 'desligada' }; }
  if (d.parou) { return { ok: false, motivo: d.parou }; }
  if (!deps.conectado()) { return { ok: false, motivo: 'WhatsApp desconectado' }; }
  const itens = Object.values(d.fila);
  const enviados = itens.filter((x) => x.status === 'enviado').length;
  if (enviados >= meta()) { return { ok: false, motivo: 'meta atingida', fim: true }; }
  const lista = candidatos();

  /* 1) Conferir: até termos Business suficiente pra meta (ou acabar a lista). */
  const business = itens.filter((x) => x.business).length;
  const faltam = lista.filter((c) => !d.fila[c.id]);
  if (faltam.length && business < meta() && horaDeConferir(agora)) {
    for (const c of faltam.slice(0, CONSULTAS_POR_TICK)) {
      const r = await deps.consultar(c.telefone);
      if (!r?.ok) { gravar(d); return { ok: false, motivo: `consulta falhou: ${r?.erro}` }; }
      d.fila[c.id] = { id: c.id, nome: c.nome, cidade: c.cidade, segmento: c.segmento, tel: c.telefone, existe: r.existe, business: r.business,
        nomeVerificado: r.nomeVerificado || null, conferidoEm: new Date(agora).toISOString(), status: r.existe ? 'na-fila' : 'sem-whatsapp' };
    }
    gravar(d);
  }

  /* 2) Enviar: no horário, respeitando o intervalo e o limite do dia. */
  if (!dentroDoHorario(agora)) { return { ok: true, motivo: 'fora do horário de envio' }; }
  if (d.proximoEnvioEm && new Date(agora) < new Date(d.proximoEnvioEm)) { return { ok: true, motivo: 'esperando o intervalo' }; }
  const hoje = Object.values(d.fila).filter((x) => x.status === 'enviado' && diaBR(x.enviadoEm) === diaBR(agora)).length;
  if (hoje >= porDia()) { return { ok: true, motivo: 'limite do dia' }; }
  const vivos = new Map(lista.map((c) => [c.id, c]));
  const naFila = Object.values(d.fila).filter((x) => x.status === 'na-fila' && vivos.has(x.id));
  /* Business primeiro; WhatsApp comum só depois de conferida a lista inteira. */
  const alvo = naFila.find((x) => x.business) || (faltam.length && business < meta() ? null : naFila[0]);
  if (!alvo) { return { ok: true, motivo: 'ninguém pronto pra receber ainda' }; }
  const c = vivos.get(alvo.id);
  const r = await deps.enviar({ canal: 'whatsapp-web', para: c.telefone, dataUri: video(), nome: 'bolso-cheio.mp4', tipo: 'video', mimetype: 'video/mp4',
    legenda: texto(c, { agora, origem: deps.origem }) }).catch((e) => ({ ok: false, erro: e.message }));
  const quando = new Date(agora).toISOString();
  d.proximoEnvioEm = new Date(new Date(agora).getTime() + intervaloMs()).toISOString();
  const item = d.fila[alvo.id];
  if (r?.ok) {
    Object.assign(item, { status: 'enviado', enviadoEm: quando, msg: r.id || null });
    d.falhasSeguidas = 0;
    prosp.mover(c.id, 'contatado', { por: 'campanha WhatsApp', canal: 'whatsapp', nota: 'vídeo + texto da campanha Contagem/Betim/BH', agora });
    console.log(`[campanha-wpp] enviado para ${c.nome} (${c.cidade}${item.business ? ', Business' : ''}) — ${Object.values(d.fila).filter((x) => x.status === 'enviado').length}/${meta()}`);
  } else if (/não tem WhatsApp/.test(r?.erro || '')) {
    Object.assign(item, { status: 'sem-whatsapp', erro: r.erro });
  } else {
    Object.assign(item, { status: 'falhou', erro: r?.erro || 'sem detalhe', falhouEm: quando });
    d.falhasSeguidas = (d.falhasSeguidas || 0) + 1;
    console.warn(`[campanha-wpp] NÃO saiu para ${c.nome}: ${item.erro}`);
    if (d.falhasSeguidas >= 3) {
      d.parou = `3 envios seguidos recusados (último: ${item.erro}) — campanha parada`;
      console.warn(`[campanha-wpp] ${d.parou}`);
      vida.registrar('campanha-whatsapp:parou', { motivo: d.parou });
    }
  }
  gravar(d);
  return { ok: !!r?.ok, enviado: r?.ok ? c.nome : null };
}
