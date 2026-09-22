/**
 * VSbot — orquestrador. Guarda as regras e a persona, e responde.
 *
 * O canal (WhatsApp, Instagram, site) é de fora: aqui entra texto e sai texto.
 * É o que permite o bot funcionar HOJE, testado, antes de qualquer token da Meta.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { responder, conversar, validarRegra, escolher, GATILHOS, pediuHumano, preencher } from './regras.mjs';
import { validarFluxo, avancar, ACOES } from './fluxo.mjs';
import { fluxoDeCsv } from './fluxo-csv.mjs';

const dir = () => process.env.VSBOT_DIR || join(homedir(), '.qa-gate', 'vsbot');
const arq = (n) => join(dir(), `${n}.json`);
const load = (n, p = null) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const save = (n, d) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arq(n), JSON.stringify(d, null, 2), { mode: 0o600 }); };

export { responder, conversar, GATILHOS };

import * as proto from '../vsprotocolo/index.mjs';

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
  ativo: false,
};

export const getConfig = () => ({ ...PADRAO, ...(load('config', {}) || {}) });

export function salvarConfig(mudancas = {}) {
  const novo = { ...getConfig(), ...mudancas };
  if (novo.falhasAteHumano != null && (!Number.isInteger(Number(novo.falhasAteHumano)) || Number(novo.falhasAteHumano) < 1)) {
    return { ok: false, erros: ['“falhas até chamar humano” precisa ser um inteiro maior que zero'] };
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
  const fx = getFluxo();

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
  salvarConversa(de, {
    ...(atual || {}),
    handoffEm: new Date().toISOString(),
    departamento: 'humano',
    contexto: atual?.contexto || {},
    assumidaPeloDono: true,
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

export function atender(texto, ctx = {}) {
  const cfg = { ...getConfig(), regras: regras() };
  const fx = getFluxo();
  const de = ctx.de || null;

  if (fx && de) {
    /* O PROTOCOLO nasce na primeira mensagem, nao no fim. Protocolo criado no
       encerramento nao existe justamente quando a pessoa precisa dele — no meio
       da espera, quando ela pergunta "qual e o meu numero?". E se o sistema cair
       no meio, atendimento sem protocolo e atendimento que nao aconteceu. */
    const ap = proto.aoChegar(de, { quando: new Date().toISOString(), endereco: ctx.endereco || null });

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
    if (ap.retomado && ap.volta.acao === 'retomar_bot') {
      /* Volta pro passo em que parou. A mensagem que ela acabou de mandar NAO e
         descartada: e respondida a seguir, ja de dentro do passo certo. */
      salvarConversa(de, { passo: ap.volta.passo, coletando: false, contexto: ap.volta.contexto || {} });
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
        texto: assinar(preencher(cfg.mensagemHandoff, ctx), cfg),
        protocolo: ap.protocolo.numero,
        handoff: true,
        acao: 'encaminhar',
        departamento: 'humano',
        contexto: atual?.contexto || {},
      };
    }

    const r = avancar(fx, atual, texto);

    /* O que a pessoa escreve numa pergunta aberta VIRA CONTEXTO do atendimento.
       E isso que faz o especialista receber "importacao travando desde cedo" em
       vez de comecar perguntando "qual e o problema?" — o §22 do desenho: nao
       perguntar de novo o que ja foi dito. */
    const contexto = { ...(atual?.contexto || {}) };
    if (r.coleta) { contexto[r.coleta.chave] = r.coleta.valor; }

    salvarConversa(de, r.passo
      ? { passo: r.passo, coletando: r.coletando === true, contexto }
      : (r.handoff ? { handoffEm: new Date().toISOString(), contexto, departamento: r.departamento || null } : null));

    const saida = {
      tipo: r.acao ? `fluxo:${r.acao}` : 'fluxo',
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
    if (ap.retomado && ap.volta.acao === 'retomar_bot') {
      saida.texto = `${proto.textoDeRetomada(ap.protocolo, ap.volta)}\n\n${saida.texto}`;
    }
    return saida;
  }

  return responder(texto, cfg, ctx);
}

export function painel() {
  const cfg = getConfig();
  const rs = regras();
  const fx = getFluxo();
  return {
    config: cfg,
    regras: rs,
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
