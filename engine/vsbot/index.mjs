/**
 * VSbot — orquestrador. Guarda as regras e a persona, e responde.
 *
 * O canal (WhatsApp, Instagram, site) é de fora: aqui entra texto e sai texto.
 * É o que permite o bot funcionar HOJE, testado, antes de qualquer token da Meta.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { responder, conversar, validarRegra, escolher, GATILHOS, pediuHumano, preencher } from './regras.mjs';
import { validarFluxo, avancar, ACOES, comPrecosDoCatalogo, opcoesPendentes, emReais } from './fluxo.mjs';
import * as moderacao from './moderacao.mjs';
import * as emergencia from './emergencia.mjs';
import * as seguranca from '../vsseguranca/index.mjs';
import * as cerebro from './cerebro.mjs';
import { entender } from './entender.mjs';
import { fluxoDeCsv } from './fluxo-csv.mjs';

const dir = () => process.env.VSBOT_DIR || dentroDaCasa('vsbot');
const arq = (n) => join(dir(), `${n}.json`);
const load = (n, p = null) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const save = (n, d) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arq(n), JSON.stringify(d, null, 2), { mode: 0o600 }); };

export { responder, conversar, GATILHOS };

import * as proto from '../vsprotocolo/index.mjs';

import { dentroDaCasa } from '../casa.mjs';
const PADRAO = {
  nome: 'Atendente',
  persona: 'Atende de forma direta e educada, sem prometer o que a loja não faz.',
  saudacao: 'Oi! Sou o atendimento automático. Como posso ajudar?',
  mensagemFallback: 'Não entendi. Quer falar com uma pessoa do time?',
  mensagemHandoff: 'Já chamo uma pessoa do time pra te atender. Um instante.',
  mensagemCatalogo: 'Olha o que temos disponível:',
  /* Audio, foto e figurinha chegam sem texto. Ficar calado parece defeito pra
     quem mandou — e e o que acontecia. Responder o que da pra fazer e mais
     honesto que silencio, e custa zero: transcrever audio exige IA paga. */
  mensagemSemTexto: 'Ainda não consigo ouvir áudio nem ler imagem — me escreve em texto, por favor? Se preferir falar com uma pessoa, escreva *atendente*.',
  /* Assina enquanto o numero for compartilhado com gente de verdade. No dia em
     que o atendimento ganhar linha propria, com a foto e o nome dela na conta,
     a assinatura vira repeticao — e ai e so desligar aqui. */
  assinarMensagens: true,
  usarCatalogo: true,
  limiteCatalogo: 5,
  falhasAteHumano: 2,
  /* Moderação: quantos avisos antes de encerrar, quanto tempo de pausa, e
     quantas escolhas erradas seguidas contam como brincadeira. O cliente ajusta. */
  avisosAntesDePausa: 2,
  horasDePausa: 2,
  errosDeOpcaoAtePausa: 4,
  /* Quem volta depois de encerrado NAO e jogado de volta na fila sozinho: o bot
     calaria esperando uma pessoa que talvez nem esteja la. Liga quem tem gente
     de plantao e quer que o cliente volte pro lugar dele. */
  voltarParaFilaAoRetornar: false,
  /* IA local (Ollama) que só entende qual opção a pessoa quis — ver cerebro.mjs. */
  cerebro: { ...cerebro.PADRAO_CEREBRO },
  /* HORÁRIO de funcionamento. null = sempre aberto. Formato por dia:
     { seg: '18:00-23:30', sab: '11:00-14:00,18:00-00:30', dom: 'fechado' }.
     Faixa que passa da meia-noite vale até a madrugada seguinte. */
  horario: null,
  mensagemFechado: 'Estamos fechados agora. 😴\n\nNosso horário:\n{horario}\n\nMe chama nesse horário que eu anoto seu pedido!',
  ativo: false,
};

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const NOME_DIA = { dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado' };
const minutosDe = (hhmm) => { const [h, m] = String(hhmm).trim().split(':').map(Number); return h * 60 + (m || 0); };
const faixas = (txt) => String(txt || '').split(',').map((f) => f.trim()).filter((f) => /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(f))
  .map((f) => f.split('-').map(minutosDe));

/**
 * Aberto agora? Hora de Brasília, não do servidor: a máquina pode estar em UTC
 * e o bot diria "fechado" às 20h de sexta.
 */
export function estaAberto(horario, quando = new Date()) {
  if (!horario) { return true; }
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(quando).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
  const agora = Number(partes.hour) * 60 + Number(partes.minute);
  // Hoje, dentro de alguma faixa (a que vira a noite vale até meia-noite aqui).
  if (faixas(horario[DIAS[dia]]).some(([a, b]) => (b > a ? agora >= a && agora < b : agora >= a))) { return true; }
  // Madrugada: faixa de ONTEM que passou da meia-noite.
  return faixas(horario[DIAS[(dia + 6) % 7]]).some(([a, b]) => b <= a && agora < b);
}

export const horarioLegivel = (horario) => DIAS.slice(1).concat('dom')
  .map((d) => `${NOME_DIA[d]}: ${faixas(horario?.[d]).length ? String(horario[d]).replace(/\s+/g, '').replace(/,/g, ' e ').replace(/-/g, ' às ') : 'fechado'}`).join('\n');

export const getConfig = () => ({ ...PADRAO, ...(load('config', {}) || {}) });

export function salvarConfig(mudancas = {}) {
  const novo = { ...getConfig(), ...mudancas };
  if (novo.falhasAteHumano != null && (!Number.isInteger(Number(novo.falhasAteHumano)) || Number(novo.falhasAteHumano) < 1)) {
    return { ok: false, erros: ['“falhas até chamar humano” precisa ser um inteiro maior que zero'] };
  }
  const inteiro = (v, min) => Number.isInteger(Number(v)) && Number(v) >= min;
  /* Horário escrito errado vira "fechado" calado e o bot recusa cliente em
     pleno expediente. Melhor recusar na hora de salvar, dizendo qual dia. */
  if (novo.horario) {
    for (const [d, txt] of Object.entries(novo.horario)) {
      const t = String(txt || '').trim().toLowerCase();
      if (!DIAS.includes(d)) { return { ok: false, erros: [`dia "${d}" não existe no horário`] }; }
      if (!t || t === 'fechado') { continue; }
      const partes = t.split(',').map((x) => x.trim());
      const ok = partes.every((f) => /^([01]?\d|2[0-3]):[0-5]\d\s*-\s*([01]?\d|2[0-3]):[0-5]\d$/.test(f));
      if (!ok) { return { ok: false, erros: [`horário de ${NOME_DIA[d]} ("${txt}") não está no formato 18:00-23:30 (use vírgula para mais de uma faixa, ou deixe vazio para fechado)`] }; }
    }
  }
  if (novo.avisosAntesDePausa != null && !inteiro(novo.avisosAntesDePausa, 0)) {
    return { ok: false, erros: ['“avisos antes de encerrar” precisa ser um inteiro (0 encerra na primeira ofensa)'] };
  }
  if (novo.horasDePausa != null && !(Number(novo.horasDePausa) >= 0.25 && Number(novo.horasDePausa) <= 72)) {
    return { ok: false, erros: ['“horas de pausa” precisa ficar entre 0,25 (15 min) e 72'] };
  }
  if (novo.errosDeOpcaoAtePausa != null && !inteiro(novo.errosDeOpcaoAtePausa, 2)) {
    return { ok: false, erros: ['“escolhas erradas até encerrar” precisa ser um inteiro a partir de 2'] };
  }
  save('config', novo);
  return { ok: true, config: novo };
}

export const regras = () => load('regras', []) || [];

export function salvarRegra(entrada = {}) {
  const r = validarRegra(entrada);
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  const todas = regras();
  const i = todas.findIndex((x) => x.id === r.regra.id);
  if (i >= 0) { todas[i] = { ...todas[i], ...r.regra }; } else { todas.push(r.regra); }
  save('regras', todas);
  return { ok: true, regra: r.regra, novo: i < 0 };
}

export function excluirRegra(id) {
  const todas = regras();
  const restantes = todas.filter((r) => r.id !== String(id));
  if (restantes.length === todas.length) { return { ok: false, erros: [`regra "${id}" não encontrada`] }; }
  save('regras', restantes);
  return { ok: true, id: String(id) };
}

/**
 * Testa o bot sem canal nenhum. É isto que faz o módulo ser entregável antes da
 * Meta: dá pra ver a conversa inteira acontecendo, com as regras reais.
 */
export function simular(mensagens = [], ctx = {}) {
  const cfg = { ...getConfig(), regras: regras() };
  // O simulador tem de ver os MESMOS preços que o cliente veria.
  const fx = comPrecosDoCatalogo(getFluxo(), ctx.produtos || []);

  /* O simulador testava so as REGRAS por palavra — nunca a arvore. Quem abria a
     tela pra conferir a Micaela via uma Micaela que nao existe, e so descobria o
     comportamento de verdade com um cliente do outro lado. Agora ele passa pelo
     MESMO `atender` do WhatsApp: mesma arvore, mesmo entendimento, mesmo
     silencio pos-handoff.

     A conversa e de RASCUNHO e some no fim. Testar nao pode mexer no lugar da
     conversa de um cliente real, nem deixar o proprio teste pela metade — na
     proxima simulacao a Micaela responderia no meio do assunto anterior. */
  if (fx) {
    const rascunho = `simulacao-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const turnos = [];
    try {
      for (const m of mensagens) {
        const r = atender(m, { ...ctx, de: rascunho });
        turnos.push({ recebida: m, ...r });
        if (r.handoff) { break; }
      }
    } finally {
      salvarConversa(rascunho, null);
      /* O rascunho gera protocolo como qualquer conversa — e assim que o
         simulador mostra o que o cliente veria. Mas ele nao pode ficar: encheria
         o historico de protocolo de mentira e faria a simulacao seguinte
         "retomar" a anterior. */
      proto.apagarDe(rascunho);
    }
    return { ok: true, persona: { nome: cfg.nome, saudacao: cfg.saudacao }, turnos, comFluxo: true };
  }

  return {
    ok: true,
    persona: { nome: cfg.nome, saudacao: cfg.saudacao },
    turnos: conversar(mensagens, cfg, ctx),
  };
}

/* ---------------- fluxo (arvore de atendimento) ---------------- */

export const getFluxo = () => load('fluxo', null);

/* ---------------- imagens do fluxo ----------------
   O passo pode ter foto. Ela mora aqui (enviada pela tela do bot) ou num link
   https. Tipo e tamanho travados: é imagem de atendimento, não depósito. */
const MIDIA_MAX = 5 * 1024 * 1024;
const TIPOS_MIDIA = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const pastaMidia = () => join(dir(), 'midia');
const nomeMidia = (n) => String(n || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export function salvarMidia({ nome, dataUri } = {}) {
  const m = String(dataUri || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) { return { ok: false, motivo: 'mande uma imagem JPG, PNG ou WEBP' }; }
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MIDIA_MAX) { return { ok: false, motivo: 'imagem maior que 5 MB — diminua antes de enviar' }; }
  const ext = m[1] === 'image/jpeg' ? 'jpg' : m[1].split('/')[1];
  let base = nomeMidia(nome).replace(/\.(jpe?g|png|webp)$/, '') || 'imagem';
  const n = `${base}.${ext}`;
  mkdirSync(pastaMidia(), { recursive: true });
  writeFileSync(join(pastaMidia(), n), buf);
  return { ok: true, nome: n, bytes: buf.length };
}

export function listarMidias() {
  try {
    return readdirSync(pastaMidia()).filter((n) => /\.(jpe?g|png|webp)$/i.test(n))
      .map((n) => ({ nome: n, bytes: statSync(join(pastaMidia(), n)).size }));
  } catch { return []; }
}

export function apagarMidia(nome) {
  const n = nomeMidia(nome);
  try { unlinkSync(join(pastaMidia(), n)); return { ok: true }; } catch { return { ok: false, motivo: 'imagem não encontrada' }; }
}

/** A imagem do passo pronta pra ir pelo WhatsApp. null = não deu (o texto sai assim mesmo). */
export async function midiaComoDataUri(ref, { fetch: f = globalThis.fetch } = {}) {
  const r = String(ref || '').trim();
  if (!r) { return null; }
  if (/^https:\/\//i.test(r)) {
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await f(r, { signal: ctrl.signal });
      const tipo = String(res.headers?.get?.('content-type') || '').split(';')[0].trim();
      if (!res.ok || !Object.values(TIPOS_MIDIA).includes(tipo)) { return null; }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length <= MIDIA_MAX ? `data:${tipo};base64,${buf.toString('base64')}` : null;
    } catch { return null; } finally { clearTimeout(relogio); }
  }
  const n = nomeMidia(r);
  const tipo = TIPOS_MIDIA[n.split('.').pop()];
  if (!tipo) { return null; }
  try { return `data:${tipo};base64,${readFileSync(join(pastaMidia(), n)).toString('base64')}`; } catch { return null; }
}

export function salvarFluxo(passos = []) {
  const v = validarFluxo(passos);
  if (v.erros.length) { return { ok: false, erros: v.erros }; }
  save('fluxo', v.fluxo);
  return { ok: true, fluxo: v.fluxo, passos: v.fluxo.passos.length };
}

export function importarFluxoCsv(texto) {
  const r = fluxoDeCsv(texto);
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  save('fluxo', r.fluxo);
  return { ok: true, ...r.resumo };
}

export function apagarFluxo() { save('fluxo', null); save('conversas', {}); return { ok: true }; }

/* Onde cada pessoa parou na arvore. Fica em disco (e nao so em memoria) porque
   restart do painel no meio de um atendimento nao pode jogar o cliente de volta
   pro comeco do menu. */
const conversas = () => load('conversas', {}) || {};
const salvarConversa = (de, dados) => {
  const todas = conversas();
  if (!dados) { delete todas[de]; } else { todas[de] = { ...dados, em: new Date().toISOString() }; }
  save('conversas', todas);
};

/**
 * Quem está esperando gente, e com o que já foi contado.
 *
 * É isto que faz o especialista NÃO começar perguntando "qual é o problema?" —
 * ele abre a conversa já sabendo o que a pessoa disse pra Micaela.
 */
export function emAtendimento() {
  const todas = conversas();
  return Object.entries(todas)
    .filter(([, c]) => c?.handoffEm)
    .map(([telefone, c]) => ({
      telefone,
      desde: c.handoffEm,
      departamento: c.departamento || 'humano',
      contexto: c.contexto || {},
      /* "Aguardando vendedor" e "com vendedor" sao situacoes diferentes na tela
         de atendimento: uma pede acao, a outra ja tem dono. */
      assumida: Boolean(c.assumidaPeloDono),
      assumidaEm: c.assumidaEm || (c.assumidaPeloDono ? c.handoffEm : null),
      // Quando o BOT passou pra gente. Conversa antiga (sem o campo) usa o handoffEm.
      transferidaEm: c.transferidaEm || (!c.assumidaPeloDono ? c.handoffEm : null),
    }))
    .sort((a, b) => String(b.desde).localeCompare(String(a.desde)));
}

/**
 * O DONO assumiu esta conversa — o bot sai de cena.
 *
 * Mesmo mecanismo do handoff, disparado por outro gatilho: ali a Micaela decide
 * chamar gente; aqui a gente simplesmente entra e ela precisa perceber. Sem
 * isto, ela responde POR CIMA de quem está atendendo, e o cliente vê os dois
 * falando ao mesmo tempo sobre coisas diferentes.
 *
 * É idempotente de propósito: cada mensagem que o dono digita passa por aqui, e
 * renovar o silêncio a cada uma é exatamente o comportamento certo — enquanto
 * ele estiver digitando, ela continua fora.
 */
export function assumirConversa(de, { endereco } = {}) {
  if (!de) { return { ok: false, erro: 'sem remetente' }; }
  const atual = conversas()[de] || null;
  const novo = !atual?.handoffEm;
  const agora = new Date().toISOString();
  salvarConversa(de, {
    ...(atual || {}),
    // Renovado a cada mensagem de quem atende: e ele que segura o silencio do bot.
    handoffEm: agora,
    departamento: atual?.departamento || 'humano',
    contexto: atual?.contexto || {},
    assumidaPeloDono: true,
    /* Os dois marcos NAO se renovam: sao o que o historico mostra ("transferido
       as 14:02", "vendedor assumiu as 14:05"). Renovar o handoffEm apagava a
       hora da transferencia. */
    assumidaEm: atual?.assumidaEm || agora,
    transferidaEm: atual?.transferidaEm || (atual?.handoffEm && !atual?.assumidaPeloDono ? atual.handoffEm : null),
  });
  try {
    const p = proto.aberto(de);
    if (p) { proto.anotar(p.numero, { estado: proto.ESTADOS.COM_HUMANO, departamento: 'humano', endereco }); }
  } catch { /* protocolo e complemento: se falhar, o silencio ja esta valendo */ }
  return { ok: true, novo };
}

/**
 * Esta conversa está com uma pessoa agora?
 *
 * Existe porque o caminho de áudio/imagem é anterior ao motor do fluxo e
 * precisava conferir a mesma regra — sem isto, mídia furava o silêncio e o bot
 * falava por cima do atendente.
 */
export function estaComGente(de) {
  const c = conversas()[de] || null;
  return Boolean(c?.handoffEm) && aindaEmSilencio(c);
}

/**
 * Quem está esperando gente há tempo demais, e ninguém resgatou ainda.
 *
 * O desenho tinha um buraco do tamanho do cliente: ela passava para a fila,
 * calava por quatro horas e NINGUÉM era avisado — o único aviso era uma linha
 * de log. Sem atendente olhando o painel naquele minuto, a pessoa ficava
 * falando sozinha achando que o atendimento morreu. E morria mesmo.
 *
 * `handoffEm` é renovado sempre que alguém de casa escreve na conversa, então
 * "antigo" aqui significa de verdade: ninguém respondeu.
 */
export function aguardandoHaMais(minutos = 10, agora = Date.now()) {
  const todas = conversas();
  return Object.entries(todas)
    /* `assumidaPeloDono` fica DE FORA para sempre, nao por dez minutos: se uma
       pessoa de carne e osso entrou na conversa, o bot nao volta a falar ali
       por conta propria. Reiniciar so o relogio deixava ela interromper o
       atendente dez minutos depois — que e o defeito que este modulo inteiro
       existe para evitar. Quem devolve a conversa pro bot e o botao "Devolver
       pra Micaela", conscientemente. */
    .filter(([, c]) => c?.handoffEm && !c.resgatadoEm && !c.assumidaPeloDono)
    .filter(([, c]) => (agora - new Date(c.handoffEm).getTime()) / 60000 >= minutos)
    .map(([de, c]) => ({
      de,
      desde: c.handoffEm,
      departamento: c.departamento || 'humano',
      contexto: c.contexto || {},
      minutos: Math.floor((agora - new Date(c.handoffEm).getTime()) / 60000),
    }));
}

/**
 * Marca que a pessoa já foi avisada da espera.
 *
 * Uma vez só. Bot que repete "ainda estou procurando alguém" a cada dez minutos
 * não tranquiliza: vira alarme, e o cliente bloqueia o número.
 */
export function marcarResgatada(de, quando = new Date().toISOString()) {
  const atual = conversas()[de];
  if (!atual) { return { ok: false, erro: 'conversa não existe' }; }
  salvarConversa(de, { ...atual, resgatadoEm: quando });
  return { ok: true };
}

/** Devolve a conversa pro bot: o atendente terminou e o fluxo pode recomeçar. */
export function devolverAoBot(telefone) {
  if (!telefone) { return { ok: false, erro: 'telefone vazio' }; }
  salvarConversa(telefone, null);
  return { ok: true, telefone };
}

/* Depois que o atendimento vai pra uma pessoa, o bot CALA A BOCA por um tempo.
   Bot respondendo por cima do atendente humano e o jeito mais rapido de fazer o
   cliente perder a confianca nos dois. */
const HORAS_SILENCIO = 4;
const aindaEmSilencio = (c) => c?.handoffEm && (Date.now() - new Date(c.handoffEm).getTime()) < HORAS_SILENCIO * 3600 * 1000;

/* Conversa parada ha muito tempo nao e conversa em andamento: e assunto novo.
   Sem este corte, quem voltasse no dia seguinte caia no meio da triagem de
   ontem — respondendo a um menu que nao esta mais na tela dele. */
const HORAS_ATE_ESQUECER = 12;
const esfriou = (c) => c?.em && (Date.now() - new Date(c.em).getTime()) > HORAS_ATE_ESQUECER * 3600 * 1000;

/**
 * Uma mensagem só — é o que o canal chama.
 *
 * Tem fluxo cadastrado? A arvore conduz. Nao tem? Vale a regra por palavra,
 * como antes. Os dois nunca disputam a mesma mensagem.
 */
/**
 * Quem esta falando, quando o numero e compartilhado.
 *
 * No WhatsApp a foto e o nome sao DA CONTA, nao da mensagem. Enquanto a Micaela
 * mora no numero pessoal do dono, o cliente ve a cara dele em tudo que ela
 * escreve — e acha que e ele digitando. Assinar e o que empresa seria faz
 * quando gente e robo dividem a mesma linha.
 *
 * Nao assina quando o proprio texto ja se apresenta (a saudacao diz o nome),
 * pra nao ficar "Micaela: Ola! Sou a Micaela". E some inteiro quando o canal
 * ganhar numero proprio: e so desligar.
 */
function assinar(texto, cfg) {
  const t = String(texto || '').trim();
  const nome = String(cfg.nome || '').trim();
  if (!t || !nome || cfg.assinarMensagens === false) { return texto; }
  const semAcento = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (semAcento(t).includes(semAcento(nome))) { return texto; }
  return `*${nome}:* ${t}`;
}

/**
 * Encerrou, acabou: fecha o protocolo (marcado como moderação, pra nao ser
 * retomado nem voltar pra fila) e a conversa guarda SO a pausa. Sem handoff —
 * ninguem e jogado numa fila por ter sido encerrado.
 */
function encerrarPorModeracao(de, numeroProtocolo, mod, cfg) {
  if (numeroProtocolo) { proto.encerrarPorNumero(numeroProtocolo, { motivo: 'moderacao' }); }
  salvarConversa(de, { ...mod.marcar });
  return {
    tipo: 'moderacao:encerrou',
    texto: assinar(mod.texto, cfg),
    moderacao: 'encerra',
    motivoModeracao: mod.tipo,
    silenciadoAte: mod.ate,
    encerrado: true,
  };
}

/**
 * A IA local tem algo a decidir aqui? Só quando o fluxo não entendeu uma
 * escolha de menu — e nunca por cima do que tem regra própria: socorro,
 * ofensa, urgência, pedido de gente, pausa e conversa que está com uma pessoa
 * seguem pelo caminho de sempre.
 */
function pendenteParaCerebro(texto, ctx) {
  const fx = comPrecosDoCatalogo(getFluxo(), ctx.produtos || []);
  if (!fx || !ctx.de) { return null; }
  const cfg = getConfig();
  if (emergencia.ligado(cfg) && emergencia.detectar(texto, cfg.emergencia || {}).emergencia) { return null; }
  if (moderacao.ehOfensa(texto) || moderacao.ehAssedio(texto) || moderacao.pediuUrgencia(texto) || pediuHumano(texto)) { return null; }
  const g = conversas()[ctx.de] || null;
  if (g?.silenciadoAte && Date.parse(g.silenciadoAte) > Date.now()) { return null; }
  const atual = esfriou(g) && !g?.handoffEm ? null : g;
  if (aindaEmSilencio(atual)) { return null; }
  return opcoesPendentes(fx, atual, texto);
}

/**
 * `atender` com jogo de cintura. Quando o fluxo não entende, pergunta à IA local
 * qual opção a pessoa quis e responde como se ela tivesse digitado o número —
 * com o TEXTO DO FLUXO, não com texto da IA. Se a IA não souber, estiver fora do
 * ar ou demorar, é exatamente o `atender` de sempre.
 */
export async function atenderComCerebro(texto, ctx = {}, { escolher = cerebro.escolherOpcao } = {}) {
  const cc = { ...cerebro.PADRAO_CEREBRO, ...(getConfig().cerebro || {}) };
  if (!cc.ligado) { return atender(texto, ctx); }
  const q = pendenteParaCerebro(texto, ctx);
  if (!q) { return atender(texto, ctx); }
  /* Dicionario primeiro: se a palavra esta na opcao ("o que e esse bolso
     cheio"), e instantaneo e nao erra. A IA fica pro que o dicionario nao pega. */
  const dic = q.primeira ? entender(texto, q.opcoes) : {};
  const r = dic.escolhida ? { tecla: String(dic.escolhida.tecla), ms: 0, via: 'dicionario' } : await escolher(texto, q.opcoes, cc);
  const trecho = String(texto).replace(/\s+/g, ' ').slice(0, 48);
  if (!r.tecla) {
    if (r.erro) { console.warn(`[cerebro] sem resposta da IA local (${r.erro}) — segue o fluxo normal`); }
    return atender(texto, ctx);
  }
  console.log(`[cerebro] "${trecho}" -> opção ${r.tecla} (${r.via === 'dicionario' ? 'dicionário' : `${r.ms} ms`})`);
  /* Primeira mensagem: abre a conversa no início (protocolo, passo) e já segue
     pela opção — quem chegou dizendo o que quer não precisa ver o menu antes. */
  if (q.primeira) {
    /* Abrir a conversa pode ter dito algo que NAO pode ser engolido: retomada de
       atendimento, fila, moderacao. So segue pela opcao se a abertura foi o menu
       inicial puro; senao, a abertura e a resposta. Engolir isso foi o que deixou
       o dono sem resposta nenhuma. */
    const abertura = atender(texto, ctx);
    if (abertura.tipo !== 'fluxo' || abertura.handoff || abertura.calado || abertura.moderacao) { return abertura; }
    /* Retomou em OUTRO passo: a opcao que a IA escolheu era do menu inicial e
       nao vale ali. A retomada e a resposta. */
    if (conversas()[ctx.de]?.passo !== getFluxo()?.inicio) { return abertura; }
  }
  const saida = atender(r.tecla, ctx);
  return { ...saida, entendidoPorIA: { tecla: r.tecla, ms: r.ms, via: r.via || 'ia' } };
}

export function atender(texto, ctx = {}) {
  const cfg = { ...getConfig(), regras: regras() };

  /* SOCORRO GANHA DE TUDO — e fica no topo desta funcao de proposito.
     Em campo, num escritorio criminal: depois do encaminhamento o bot entra em
     silencio pra nao falar por cima do atendente. A pessoa escreveu "tao me
     agredindo", "socorro", "vao me matar" — e recebeu SILENCIO. A regra estava
     certa; a consequencia, nao.
     Fica antes do silencio pos-handoff, antes da moderacao e antes do castigo:
     quem esta sendo agredido nao perde o direito de resposta porque xingou o
     atendimento ontem. */
  const sos = emergencia.ligado(cfg) ? emergencia.detectar(texto, cfg.emergencia || {}) : { emergencia: false };
  if (sos.emergencia) {
    const de0 = ctx.de || null;
    if (de0) {
      const atualSos = conversas()[de0] || {};
      salvarConversa(de0, {
        ...atualSos,
        handoffEm: new Date().toISOString(),
        departamento: 'urgencia',
        emergencia: { tipo: sos.tipo, em: new Date().toISOString(), trecho: sos.trecho },
      });
    }
    const avisando = cfg.emergencia?.alertar !== false && seguranca.responsaveis().length > 0;
    seguranca.auditar({ tipo: `emergencia:${sos.tipo}`, detalhe: `reconheci "${sos.trecho}" e respondi com o ${sos.fone}${avisando ? '' : ' — sem responsável cadastrado para alertar'}`,
      cliente: ctx.nome || de0 || null, resultado: 'respondido' });
    return {
      tipo: 'emergencia',
      /* SEM assinatura: "*Gael:*" antes de "LIGUE 190" rouba a primeira linha,
         que e a unica que alguem em perigo vai ler. */
      texto: emergencia.resposta(sos, { nomeEscritorio: ctx.empresa, cfg: cfg.emergencia || {}, avisando }),
      /* Quem tem rede (o canal) manda o alerta pros responsáveis. */
      ...(avisando ? { alerta: { tipo: sos.tipo, trecho: String(texto).slice(0, 200) } } : {}),
      emergencia: sos.tipo,
      handoff: true,
      departamento: 'urgencia',
      prioridade: 'maxima',
    };
  }

  /* O preço entra AQUI, uma vez, antes de qualquer decisão: assim o menu que o
     cliente lê, o item que entra no carrinho e o total da cobrança olham todos
     para o mesmo catálogo, no mesmo instante. */
  const fx = comPrecosDoCatalogo(getFluxo(), ctx.produtos || []);
  const de = ctx.de || null;

  if (fx && de) {
    /* PAUSA vem antes do protocolo: quem esta em pausa nao abre atendimento a
       cada mensagem. Acabou a pausa? Conversa do zero — encerrou, acabou. */
    const conv0 = conversas()[de] || null;
    const emPausa = !!conv0?.silenciadoAte && Date.parse(conv0.silenciadoAte) > Date.now();
    if (conv0?.silenciadoAte && !emPausa) { salvarConversa(de, null); }
    if (emPausa) {
      const m = moderacao.avaliar(texto, conv0, { limites: cfg });
      if (m.acao === 'calado') { return { tipo: 'silencio', texto: '', calado: true, motivo: `em pausa até ${m.ate}` }; }
      if (m.acao === 'pausa') {
        salvarConversa(de, { ...conv0, ...m.marcar });
        return { tipo: 'moderacao:pausa', texto: assinar(m.texto, cfg), silenciadoAte: conv0.silenciadoAte };
      }
      /* "URGENTE" segue o caminho normal: abre protocolo e chama gente. */
    }

    /* O PROTOCOLO nasce na primeira mensagem, nao no fim. Protocolo criado no
       encerramento nao existe justamente quando a pessoa precisa dele — no meio
       da espera, quando ela pergunta "qual e o meu numero?". E se o sistema cair
       no meio, atendimento sem protocolo e atendimento que nao aconteceu. */
    const ap = proto.aoChegar(de, { quando: new Date().toISOString(), endereco: ctx.endereco || null, voltarParaFila: cfg.voltarParaFilaAoRetornar === true });
    /* Protocolo NOVO com a conversa ainda marcada "com uma pessoa": essa marca e
       do atendimento que ja foi encerrado. Sem limpar, o bot ficava calado por
       horas esperando um atendente de um caso que nem existe mais — vacuo. */
    if (ap.novo && conversas()[de]?.handoffEm) { salvarConversa(de, null); }

    /* Voltou depois de encerrado por silencio. Aqui esta a promessa inteira
       deste modulo: ninguem repete o que ja contou. */
    if (ap.retomado && ap.volta.acao === 'voltar_fila') {
      /* Quem ja tinha falado com gente NAO passa pela Micaela outra vez. Volta
         pra fila, com o contexto — e o atendente abre a conversa sabendo tudo. */
      salvarConversa(de, {
        handoffEm: ap.volta.filaDesde,
        contexto: { ...(ap.volta.contexto || {}), protocolo: ap.protocolo.numero },
        departamento: ap.volta.departamento,
      });
      return {
        tipo: 'fluxo:encaminhar',
        texto: proto.textoDeRetomada(ap.protocolo, ap.volta),
        handoff: true,
        acao: 'encaminhar',
        departamento: ap.volta.departamento,
        protocolo: ap.protocolo.numero,
        contexto: ap.volta.contexto || {},
      };
    }
    /* Retomar so faz sentido se o passo ainda existe. Trocaram o fluxo (outro
       roteiro, outro negocio) e a pessoa voltava "de onde parou" num passo que
       nem existe mais — em campo: o bot de vendas novo respondendo com a
       pergunta do roteiro velho, a cada "oi". Passo sumiu = conversa do zero. */
    const retomou = ap.retomado && ap.volta.acao === 'retomar_bot'
      && (fx.passos || []).some((p) => String(p.id).trim() === String(ap.volta.passo || '').trim());
    if (retomou) {
      /* Volta pro passo em que parou. A mensagem que ela acabou de mandar NAO e
         descartada: e respondida a seguir, ja de dentro do passo certo. */
      salvarConversa(de, { passo: ap.volta.passo, coletando: false, contexto: ap.volta.contexto || {} });
    } else if (ap.retomado && ap.volta.acao === 'retomar_bot') {
      salvarConversa(de, null);
    }

    /* RESPEITO vem antes de tudo — antes do fluxo, antes do protocolo, antes do
       handoff. Responder um menu pra quem acabou de xingar quem atende e o
       comportamento que faz o dono desligar o bot. */
    const conv = conversas()[de] || null;
    const mod = moderacao.avaliar(texto, conv || {}, {
      limites: cfg,
      empresa: ctx.empresa && ctx.empresa !== 'nossa loja' ? ctx.empresa : null,
      ofensa: cfg.moderacao?.ofensa !== false,
      assedio: cfg.moderacao?.assedio !== false,
      temContrato: ctx.temContrato === true,
      /* Ja encaminhado por urgencia = no meio de um problema serio. Nao se cala
         essa pessoa por 12 horas porque ela perdeu a linha. */
      emUrgencia: conv?.departamento === 'urgencia' || !!conv?.emergencia,
    });
    if (mod.acao === 'calado') {
      return { tipo: 'silencio', texto: '', calado: true, motivo: `em silêncio até ${mod.ate}` };
    }
    /* A palavra "urgente" atravessa o castigo e chama gente. Castigo de robo nao
       pode virar porta trancada pra quem tem um problema de verdade. */
    if (mod.acao === 'urgencia') {
      salvarConversa(de, { ...(conv || {}), handoffEm: new Date().toISOString(), departamento: 'humano' });
      seguranca.auditar({ tipo: 'urgente', detalhe: 'escreveu URGENTE durante a pausa — chamei uma pessoa', protocolo: ap.protocolo.numero, cliente: ctx.nome || de });
      return {
        tipo: 'moderacao:urgencia',
        texto: assinar(mod.texto, cfg),
        handoff: true,
        departamento: 'humano',
        ...(seguranca.responsaveis().length ? { alerta: { tipo: 'urgente', trecho: String(texto).slice(0, 200) } } : {}),
        protocolo: ap.protocolo.numero,
      };
    }
    if (mod.acao === 'encerra') {
      seguranca.auditar({ tipo: `moderacao:${mod.tipo || 'encerra'}`, detalhe: `encerrei o atendimento com pausa (${mod.tipo === 'assedio' ? 'assédio' : mod.tipo === 'opcoes' ? 'brincadeira com as opções' : 'ofensa'})`, protocolo: ap.protocolo.numero, cliente: ctx.nome || de });
      return encerrarPorModeracao(de, ap.protocolo.numero, mod, cfg);
    }
    if (mod.acao === 'avisa') {
      salvarConversa(de, { ...(conv || {}), ...mod.marcar });
      return {
        tipo: 'moderacao:aviso',
        texto: assinar(mod.texto, cfg),
        moderacao: mod.acao,
        ...(mod.tipo ? { motivoModeracao: mod.tipo } : {}),
      };
    }

    const guardada = conversas()[de] || null;
    /* O silencio pos-handoff continua valendo mesmo em conversa fria: ele
       protege o atendente humano, e 4h e sempre menos que 12h. */
    const atual = esfriou(guardada) && !guardada?.handoffEm ? null : guardada;
    if (aindaEmSilencio(atual)) {
      return { tipo: 'silencio', texto: '', calado: true, handoff: true };
    }
    /* PORTA DE SAIDA. Pedir gente ganha de qualquer menu, em qualquer ponto da
       arvore — a regra da casa e "nunca deixar cliente preso no bot", e com o
       fluxo ligado ela nao valia: quem escrevia "quero falar com uma pessoa" no
       meio da triagem so recebia "nao entendi a escolha" de volta.
       EXCECAO: quando a pergunta e aberta, o que a pessoa escreve e RESPOSTA, nao
       comando — "quero cancelar meu plano" ali e a descricao do problema dela. */
    if (!atual?.coletando && pediuHumano(texto)) {
      salvarConversa(de, { handoffEm: new Date().toISOString(), contexto: atual?.contexto || {}, departamento: 'humano' });
      proto.anotar(ap.protocolo.numero, { estado: proto.ESTADOS.NA_FILA, departamento: 'humano', contexto: atual?.contexto || {} });
      return {
        tipo: 'fluxo:encaminhar',
        texto: assinar(preencher(cfg.mensagemHandoff, { assistente: cfg.nome, ...ctx }), cfg),
        protocolo: ap.protocolo.numero,
        handoff: true,
        acao: 'encaminhar',
        departamento: 'humano',
        contexto: atual?.contexto || {},
      };
    }

    /* FECHADO: quem chega fora do horário ouve o horário, em vez de montar um
       pedido que ninguém vai preparar. Quem já está no meio do pedido termina —
       cortar alguém no resumo porque deu 23h30 é perder a venda. */
    if (!atual?.passo && !estaAberto(cfg.horario)) {
      return { tipo: 'fechado', texto: assinar(preencher(cfg.mensagemFechado, { horario: horarioLegivel(cfg.horario) }), cfg), protocolo: ap.protocolo.numero };
    }

    const r = avancar(fx, atual, texto);

    /* Escolha errada SEGUIDA: errar uma ou duas vezes e normal e o menu volta
       sem bronca; no limite, e brincadeira e encerra com pausa. Cliente com
       contrato nao e encerrado por robo — so recebe o menu de novo. */
    const errosDeOpcao = r.erroDeEscolha ? Number(atual?.errosDeOpcao || 0) + 1 : 0;
    if (r.erroDeEscolha && ctx.temContrato !== true) {
      const po = moderacao.porErroDeOpcao(errosDeOpcao, { limites: cfg });
      if (po.acao === 'encerra') { return encerrarPorModeracao(de, ap.protocolo.numero, po, cfg); }
      if (po.acao === 'avisa') { r.texto = `${po.texto}\n\n${r.texto}`; }
    }

    /* O que a pessoa escreve numa pergunta aberta VIRA CONTEXTO do atendimento.
       E isso que faz o especialista receber "importacao travando desde cedo" em
       vez de comecar perguntando "qual e o problema?" — o §22 do desenho: nao
       perguntar de novo o que ja foi dito. */
    const contexto = { ...(atual?.contexto || {}) };
    if (r.coleta) { contexto[r.coleta.chave] = r.coleta.valor; }
    /* CARRINHO. Cada opção com preço que a pessoa escolhe entra aqui, e é a soma
       disto que vira a cobrança lá na frente. Guardar no contexto (e não numa
       variável) é o que faz o pedido sobreviver a ela sumir e voltar depois. */
    if (r.meia !== undefined) { if (r.meia) { contexto.meia = r.meia; } else { delete contexto.meia; } }
    if (r.item) {
      const { qtd = 1, ...um } = r.item;
      /* Uma linha por unidade: o resumo agrupa ("3x Refri") e a soma fica certa
         sem ninguém multiplicar nada. Taxa de entrega é uma só — o bairro novo
         substitui o anterior. */
      const base = um.taxa ? (contexto.itens || []).filter((i) => !i.taxa) : (contexto.itens || []);
      contexto.itens = [...base, ...Array.from({ length: qtd }, () => um)];
    }
    contexto.totalCentavos = (contexto.itens || []).reduce((a, i) => a + (i.valorCentavos || 0), 0);
    /* Voltou pro comeco = pedido novo. Sem isto, "comecar de novo" somava o
       carrinho de antes no total do pedido seguinte. */
    if (r.passo && r.passo === fx.inicio) { delete contexto.itens; delete contexto.totalCentavos; delete contexto.meia; }
    /* O fluxo fala do pedido: {pedido}, {total}, {nome} e o que foi coletado
       ({endereco}...). Sem isto o resumo antes de pagar era texto fixo, e o
       cliente confirmava um pedido que nao via. */
    const pctSinal = Number(fx.passos.find((p) => p.sinal)?.sinal || 0);
    r.texto = preencher(r.texto, {
      ...contexto,
      sinal: pctSinal ? emReais(Math.round((contexto.totalCentavos || 0) * pctSinal / 100)) : null,
      assistente: cfg.nome,
      nome: ctx.nome,
      empresa: ctx.empresa,
      pedido: resumoDoPedido(contexto.itens),
      total: emReais(contexto.totalCentavos || 0),
    });

    salvarConversa(de, r.passo
      ? { passo: r.passo, coletando: r.coletando === true, contexto, ...(errosDeOpcao ? { errosDeOpcao } : {}) }
      : (r.handoff ? { handoffEm: new Date().toISOString(), contexto, departamento: r.departamento || null } : null));

    /* CARDS: passo cujo menu e de produtos do estoque manda a foto de cada um
       (nome, preco, descricao e a tecla pra pedir). Quem envia e o canal; aqui
       so se diz o que mostrar. O menu em texto continua saindo depois — foto
       e vitrine, a escolha nao pode depender dela. */
    const passoNovo = r.passo ? fx.passos.find((p) => p.id === r.passo) : null;
    const porSku = new Map((ctx.produtos || []).map((p) => [String(p.sku).trim(), p]));
    /* Uma vez por conversa: mandar as mesmas 5 fotos a cada "quero mais um
       item" vira spam. Da segunda vez em diante, so o menu em texto. */
    const jaViuCards = (contexto.cardsVistos || []).includes(r.passo);
    const cartoes = jaViuCards ? [] : (passoNovo?.opcoes || []).map((o, i) => ({ o, i, p: porSku.get(String(o.sku || '').trim()) }))
      .filter(({ o, p }) => p?.imagem && !o.indisponivel)
      .map(({ o, i, p }) => ({ tecla: String(o.tecla || i + 1), nome: o.texto || p.nome, preco: emReais(o.valorCentavos || p.precoCentavos || 0),
        descricao: p.descricao || '', imagem: p.imagem }));

    if (cartoes.length) {
      contexto.cardsVistos = [...(contexto.cardsVistos || []), r.passo];
      salvarConversa(de, { ...(conversas()[de] || {}), contexto });
    }

    const saida = {
      ...(cartoes.length ? { cartoes } : {}),
      tipo: r.acao ? `fluxo:${r.acao}` : 'fluxo',
      /* Foto do passo: sai junto com o texto, num balão só (legenda). */
      ...(r.imagem ? { imagem: r.imagem } : {}),
      texto: r.texto,
      handoff: r.handoff === true,
      acao: r.acao || null,
      departamento: r.departamento || null,
      contexto,
      /* Como a arvore chegou nesta resposta interessa a quem esta ajustando o
         fluxo: "nao entendeu", "pulou pro galho certo" e "seguiu o menu" sao
         tres coisas diferentes, e sem estes sinais o simulador mostrava as tres
         iguais. */
      ...(r.erroDeEscolha ? { erroDeEscolha: true } : {}),
      ...(r.saltou ? { saltou: true } : {}),
      ...(r.desambiguando ? { desambiguando: true } : {}),
    };
    /* COBRAR nao cobra aqui. Este modulo nao fala com gateway nenhum — ele so
       diz "cobre isto", e quem tem rede (o canal) executa e devolve o link. Sem
       essa separacao, simular uma conversa criaria cobranca de verdade. */
    if (r.acao === ACOES.COBRAR) {
      const cheio = r.valorCentavos ?? contexto.totalCentavos ?? 0;
      /* SINAL de encomenda: cobra a porcentagem agora, o resto na retirada. */
      const total = r.sinalPercent ? Math.round(cheio * r.sinalPercent / 100) : cheio;
      if (total > 0) {
        saida.cobranca = {
          valorCentavos: total,
          ...(r.sinalPercent ? { sinalPercent: r.sinalPercent, totalPedidoCentavos: cheio } : {}),
          descricao: `${r.sinalPercent ? `Sinal ${r.sinalPercent}% — ` : ''}${resumoCurto(contexto.itens) || (cfg.nomeEmpresa || 'Pedido')}`,
          itens: contexto.itens || [],
          referencia: `${ap.protocolo.numero}`,
        };
      } else {
        /* Sem valor nao se manda link: manda-se a verdade. Link de R$ 0,00 faz o
           cliente achar que o pedido foi de graca. */
        saida.cobrancaImpossivel = 'pedido sem valor';
      }
    }
    // Catalogo no meio do fluxo usa a mesma vitrine das regras.
    if (r.acao === ACOES.CATALOGO) {
      saida.produtos = (ctx.produtos || []).slice(0, cfg.limiteCatalogo || 5);
      if (!saida.texto) { saida.texto = cfg.mensagemCatalogo; }
    }
    saida.texto = assinar(saida.texto, cfg);

    /* Anota ONDE parou. E isto que o retorno vai ler daqui a cinco minutos ou
       daqui a vinte horas — e sem isto o protocolo seria so um numero bonito. */
    proto.anotar(ap.protocolo.numero, {
      passo: r.passo || null,
      contexto,
      departamento: saida.departamento || undefined,
      estado: saida.handoff ? proto.ESTADOS.NA_FILA : proto.ESTADOS.COM_BOT,
    });
    saida.protocolo = ap.protocolo.numero;
    if (retomou) {
      saida.texto = `${proto.textoDeRetomada(ap.protocolo, ap.volta)}\n\n${saida.texto}`;
    }
    return saida;
  }

  return responder(texto, cfg, ctx);
}

/** Pedido pago (ou resolvido fora do fluxo): a conversa passa pra equipe, com o contexto. */
export function entregarParaEquipe(de, { departamento = 'humano', contexto = {} } = {}) {
  const agora = new Date().toISOString();
  salvarConversa(de, { handoffEm: agora, transferidaEm: agora, contexto, departamento });
  return { ok: true };
}

/** "2x X-Tudo + 1x Refri" — cabe na descrição da cobrança. */
const resumoCurto = (itens = []) => {
  const g = new Map();
  for (const i of itens || []) { g.set(i.nome, (g.get(i.nome) || 0) + 1); }
  return [...g].map(([n, q]) => (q > 1 ? `${q}x ${n}` : n)).join(' + ').slice(0, 200);
};

/** "2x X-Tudo — R$ 56,00", um por linha. O carrinho guarda item a item. */
export function resumoDoPedido(itens = []) {
  const grupos = new Map();
  for (const i of itens || []) {
    const g = grupos.get(i.nome) || { nome: i.nome, qtd: 0, centavos: 0 };
    g.qtd += 1; g.centavos += i.valorCentavos || 0;
    grupos.set(i.nome, g);
  }
  return [...grupos.values()].map((g) => `${g.qtd}x ${g.nome} — ${emReais(g.centavos)}`).join('\n') || '(nenhum item ainda)';
}

export function painel() {
  const cfg = getConfig();
  const rs = regras();
  const fx = getFluxo();
  return {
    config: cfg,
    regras: rs,
    midias: listarMidias(),
    total: rs.length,
    ativas: rs.filter((r) => r.ativa !== false).length,
    comHandoff: rs.filter((r) => r.handoff).length,
    // O bot pode estar "ligado" e sem regra nenhuma: isso e um bot que so sabe
    // dizer que nao entendeu. A tela precisa falar isso em voz alta.
    fluxo: fx ? {
      passos: fx.passos.length,
      inicio: fx.inicio,
      passos_lista: fx.passos.map((p) => ({ id: p.id, opcoes: (p.opcoes || []).length })),
    } : null,
    /* Com fluxo cadastrado o bot ja tem o que dizer mesmo sem regra nenhuma —
       a arvore conduz a conversa inteira. */
    pronto: cfg.ativo && (!!fx || rs.some((r) => r.ativa !== false)),
    aviso: cfg.ativo && !fx && !rs.some((r) => r.ativa !== false)
      ? 'o bot está ligado e não tem nenhuma regra ativa — ele só vai saber dizer que não entendeu'
      : null,
  };
}
