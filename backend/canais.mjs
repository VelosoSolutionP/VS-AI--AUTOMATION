/**
 * Onde o canal encontra o domínio.
 *
 * Este é o único arquivo que conhece os dois lados: de cima ele monta o
 * provider e o gateway (infraestrutura), de baixo ele chama `atendimento`
 * (domínio). O provider continua sem saber o que é lead, e o atendimento
 * continua sem saber o que é WhatsApp Web.
 *
 * Trocar o canal pelo oficial da Meta, quando a conta destravar, é trocar a
 * linha que cria o provider — nada abaixo daqui muda.
 */
import { criarGateway } from '../engine/canais/gateway.mjs';
import { criarWhatsAppWebProvider } from '../engine/canais/whatsapp-web/index.mjs';
import { reservarEvento } from './idempotencia.mjs';
import * as atendimento from './atendimento.mjs';
import * as proto from '../engine/vsprotocolo/index.mjs';
import * as bot from '../engine/vsbot/index.mjs';
import * as vigiaPix from './vigia-pix.mjs';
import * as seguranca from '../engine/vsseguranca/index.mjs';
import * as pagamentos from '../engine/vspagamentos/index.mjs';
import * as fin from '../engine/vsfinanceiro/index.mjs';
import { emReais } from '../engine/vsbot/fluxo.mjs';

/** Pedaco curto da mensagem: o log serve pra diagnosticar, nao pra guardar
    conversa de cliente. */
const trecho = (t) => {
  const x = String(t || '').replace(/\s+/g, ' ').trim();
  if (!x) { return '(sem texto)'; }
  return x.length > 48 ? `${x.slice(0, 48)}…` : x;
};

/** Por que ninguem foi respondido. Cada caso tem conserto diferente. */
function motivoDoSilencio(r) {
  if (!r) { return 'o atendimento nao devolveu resultado'; }
  if (r.botDesligado) { return 'o bot esta DESLIGADO na configuracao'; }
  /* O motor devolve `calado`/`tipo: silencio` quando a conversa esta com uma
     pessoa. Sem conferir esses dois, o log dizia "o fluxo decidiu nao
     responder" — tecnicamente verdade e praticamente inutil: quem le precisa
     saber que ha um ATENDENTE ali, nao que o fluxo se calou por conta propria.
     Foi o que apareceu no teste em campo, e um log que descreve errado atrasa
     o diagnostico seguinte. */
  if (r.calado || r.tipo === 'silencio' || r.emSilencio || r.silenciado) {
    return 'conversa esta com uma pessoa (silencio pos-handoff)';
  }
  if (r.respondeu === false) { return 'o fluxo decidiu nao responder esta mensagem'; }
  return 'o fluxo nao produziu resposta';
}

/**
 * Ultima fala enviada a cada pessoa, pra nao repetir a mesma coisa em seguida.
 *
 * Em campo: o cliente mandou varios audios seguidos e recebeu a MESMA frase
 * ("ainda nao consigo ouvir audio") uma vez por audio, e o mesmo menu cinco
 * vezes. Cada resposta estava individualmente certa; o conjunto parecia defeito.
 * Repetir nao informa nada novo — so faz parecer que o outro lado travou.
 */
const ultimaFala = new Map();
const MIN_SEM_REPETIR = 5;

function jaDisseAgora(para, texto) {
  const t = String(texto || '').trim();
  if (!t) { return false; }
  const antes = ultimaFala.get(para);
  const agora = Date.now();
  if (antes && antes.texto === t && (agora - antes.em) / 60000 < MIN_SEM_REPETIR) { return true; }
  ultimaFala.set(para, { texto: t, em: agora });
  /* Teto: uma sessao fica meses no ar e isto nao pode virar vazamento. */
  if (ultimaFala.size > 500) { ultimaFala.delete(ultimaFala.keys().next().value); }
  return false;
}

let gateway = null;
let whatsappWeb = null;

/**
 * De onde sai o catálogo que a Micaela usa.
 *
 * Vive FORA do `montar` de propósito. Antes, a lista era capturada no primeiro
 * `montar()` e as chamadas seguintes eram ignoradas (a função devolve cedo se o
 * gateway já existe) — então quem montasse o canal antes do catálogo estar
 * pronto ficava com ele vazio para sempre, e todo produto aparecia como
 * "indisponível" até alguém desconectar e conectar de novo. Reconectar não devia
 * ser o jeito de atualizar preço.
 */
let obterProdutos = () => [];

/** Monta na primeira chamada. Sessão só abre quando alguém pedir "Conectar". */
/**
 * Pix do bot pago: some o QR, sai o "pagamento recebido", o pedido vai pra
 * equipe e entra no caixa. Chamado pela vigia (conferência) ou pelo webhook.
 */
async function avisarPixPago(reg, pagamento) {
  for (const id of reg.mensagens || []) {
    const a = await whatsappWeb?.apagarMensagem({ para: reg.para, id });
    if (!a?.ok) { console.warn(`[pix] ${reg.referencia}: nao apaguei a mensagem ${id} — ${a?.erro || 'canal fora'}`); }
  }
  const cfg = bot.getConfig();
  const texto = [
    `${cfg.nome ? `*${cfg.nome}:* ` : ''}✅ *Pagamento recebido!*`,
    '',
    `Pedido *${reg.referencia}* — ${emReais(reg.totalCentavos || 0)}`,
    bot.resumoDoPedido(reg.itens),
    '',
    cfg.mensagemPixPago || 'Seu pedido já foi pra cozinha. Obrigado! 🍔',
  ].join('\n');
  const env = await whatsappWeb?.enviarTexto({ para: reg.para, texto });
  console.log(`[pix] ${reg.referencia}: PAGO — ${env?.ok ? 'avisei o cliente' : 'NAO consegui avisar o cliente: ' + (env?.erro || 'canal fora')}`);
  bot.entregarParaEquipe(reg.de, { departamento: 'comercial', contexto: { itens: reg.itens, totalCentavos: reg.totalCentavos, pago: true, pagamentoId: reg.pagamentoId } });
  proto.anotar(reg.referencia, { estado: proto.ESTADOS.NA_FILA, departamento: 'comercial' });
  const l = fin.lancarPagamento(pagamento);
  if (l?.ok && !l.repetido) { console.log(`[caixa] entrada de ${pagamento.id} lancada`); }
}

/**
 * Alerta de segurança pros responsáveis, pelo WhatsApp conectado. Usado pelo
 * bot (socorro, URGENTE) e pelo painel (SOS, teste). Canal fora = falha
 * registrada, nunca "avisei" de mentira.
 */
export function alertarResponsaveis(evento) {
  return seguranca.alertar(evento, {
    enviar: whatsappWeb ? ({ para, texto }) => whatsappWeb.enviarTexto({ para, texto }) : null,
  }).then((r) => {
    console.log(`[seguranca] alerta ${evento.tipo}: ${r.avisados.length ? 'avisei ' + r.avisados.join(', ') : 'NINGUEM avisado'}${r.falhas?.length ? ' | falhou: ' + r.falhas.map((f) => f.nome + ' (' + f.erro + ')').join(', ') : ''}${r.motivo ? ' — ' + r.motivo : ''}`);
    return r;
  });
}

/** O webhook confirmou um pagamento: se for Pix do bot, o desfecho sai agora. */
export function pixConfirmado(pagamento) {
  return vigiaPix.confirmado(pagamento, { aoConfirmar: avisarPixPago });
}

function montar({ produtos } = {}) {
  // Sempre a mais recente, mesmo com o gateway já montado.
  if (typeof produtos === 'function') { obterProdutos = produtos; }
  if (gateway) { return gateway; }

  gateway = criarGateway({
    reservar: reservarEvento,
    /**
     * A ponte. Recebe mensagem canônica, entrega pro atendimento e devolve a
     * resposta PELO MESMO canal de onde ela veio — por isso o `enviar` é o
     * `responder` do contexto, e não um envio global.
     */
    entregar: async (msg, ctx) => {
      const quem = msg.nome ? `${msg.de} (${msg.nome})` : msg.de;
      console.log(`[canais] chegou de ${quem} — ${msg.tipo || 'texto'}: ${trecho(msg.texto)}`);

      let respondidas = 0;
      let falha = null;
      const r = await atendimento.receberMensagem(
        /* `endereco` TEM de atravessar. Sem ele o protocolo nasce sem saber por
           onde falar com a pessoa, e o encerramento por silencio tenta avisar
           usando o LID como se fosse telefone — recusado, e o cliente fica sem
           o numero do protocolo. Visto em producao:
             "179340671226006" nao e um telefone valido (15 digitos)
           A montagem manual deste objeto foi o que engoliu o campo. */
        { id: msg.id, de: msg.de, endereco: msg.endereco, nome: msg.nome, texto: msg.texto, tipo: msg.tipo },
        {
          /* O ENVIO e o unico passo que some quando falha: a mensagem entrou, a
             trilha registrou, e o cliente nunca viu nada. Do lado de ca o log
             ficava mudo e a conclusao virava "o bot nao funciona". Cada tentativa
             passa a deixar rastro — a que deu certo e, principalmente, a que nao. */
          enviar: async ({ texto }) => {
            /* Dizer a mesma coisa de novo, em seguida, nao acrescenta nada — e
               empilhado na tela do cliente parece robo quebrado. */
            if (jaDisseAgora(msg.endereco || msg.de, texto)) {
              console.log(`[canais] nao repeti a mesma frase pra ${quem}: ${trecho(texto)}`);
              respondidas += 1;
              return { ok: true, repetida: true };
            }
            const env = await ctx.responder(texto);
            if (env && env.ok === false) {
              falha = env.erro || env.motivo || 'motivo nao informado';
              console.error(`[canais] NAO consegui responder ${quem}: ${falha}`);
            } else {
              respondidas += 1;
              console.log(`[canais] respondi ${quem}: ${trecho(texto)}`);
            }
            return env;
          },
          /* O canal e quem sabe mandar imagem; o atendimento so pede. E por
             aqui que o QR do Pix chega na tela de quem vai pagar. */
          enviarImagem: async ({ dataUri, legenda, nome }) => {
            const para = msg.endereco || msg.de;
            const env = await whatsappWeb.enviarImagem({ para, dataUri, legenda, nome });
            /* Foto com legenda E a resposta: conta como respondida, senão o log
               diria "nada respondido" pra quem recebeu a mensagem. */
            if (env?.ok) { if (legenda) { respondidas += 1; } console.log(`[canais] mandei imagem${legenda ? ' com legenda' : ''} pra ${quem}: ${trecho(legenda || nome)}`); }
            else { console.error(`[canais] NAO consegui mandar a imagem pra ${quem}: ${env?.erro || 'motivo nao informado'}`); }
            return env;
          },
          alertar: (evento) => alertarResponsaveis(evento),
          vigiarPix: (reg) => { vigiaPix.registrar(reg); console.log(`[pix] ${reg.referencia}: conferindo o pagamento de ${emReais(reg.totalCentavos)} a cada 10s`); },
          /* Lê pelo ponteiro, não pela cópia: preço mudado no catálogo vale na
             próxima mensagem, sem reconectar nada. */
          produtos: () => {
            const lista = obterProdutos();
            /* QUANTOS produtos a Micaela enxergou nesta mensagem. Sem este
               numero, "item indisponivel" nao diz se o catalogo esta vazio, se
               o SKU esta errado ou se o item acabou — tres consertos
               diferentes. Custou tempo demais adivinhar isso. */
            console.log(`[canais] catalogo visto nesta mensagem: ${lista.length} produto(s)${lista.length ? ' — ' + lista.slice(0, 6).map((p) => p.sku).join(', ') : ''}`);
            return lista;
          },
        },
      );
      // O atendimento já respondeu por dentro (ele decide se responde e o quê).
      // Não devolvo `responder` aqui pra não mandar duas vezes.
      if (r?.handoff) { console.log(`[canais] ${msg.de} precisa de gente`); }
      /* Silencio tambem e resultado, e precisa de nome. Sem esta linha, "o bot
         decidiu nao responder" e "o bot quebrou" saem iguais no log: nada. */
      if (!respondidas && !falha) {
        console.log(`[canais] nada respondido a ${quem} — ${motivoDoSilencio(r)}`);
      }
      return null;
    },
  });

  whatsappWeb = criarWhatsAppWebProvider();
  vigiaPix.iniciar({ consultar: (id) => pagamentos.atualizarEstado(id), aoConfirmar: avisarPixPago });

  /* TODA mudanca de estado no log. Antes so a queda e a retomada no boot
     apareciam: quando a sessao se reerguia sozinha no meio do caminho, o log
     parava na "tentativa 3/5" e ficava por isso mesmo. Quem lia nao sabia se
     tinha voltado ou se tinha morrido calada — e as duas coisas exigem reacao
     diferente. */
  /* O dono entrou na conversa: a Micaela sai de cena ali.
     Nao existe jeito mais rapido de queimar a confianca do cliente do que ver
     duas pessoas respondendo a mesma pergunta — e uma delas e um robo cortando
     o assunto com um menu. Reusa o MESMO silencio pos-handoff: a regra ja
     existia, so nunca tinha sido ligada neste gatilho. */
  /**
   * TOMADA DE CONTA: registra e avisa.
   *
   * Quando a sessao cai como UNPAIRED ou CONFLICT, alguem entrou na conta e
   * derrubou quem estava. O evento vira REGISTRO em disco, com hora, tipo e
   * qual numero estava pareado — e o registro sobrevive ao reinicio, porque e
   * isto que se leva pro WhatsApp, pra delegacia ou pro advogado.
   *
   * O que NAO da pra saber daqui, e nao vou fingir que da: QUEM entrou. O
   * WhatsApp nao entrega o aparelho invasor pra sessao que acabou de ser
   * derrubada. Esse dado esta em "Aparelhos conectados", no celular do dono —
   * e e a primeira coisa que ele tem de abrir.
   */
  whatsappWeb.aoSuspeitarInvasao((ev) => {
    const registro = {
      em: ev.em,
      tipo: ev.estadoLib,
      motivo: ev.motivo,
      numeroPareado: whatsappWeb.status?.().numero || null,
      /* Quanto tempo a sessao durou antes de cair ajuda a separar "derrubaram
         agora" de "estava fora do ar ha dias". */
      sessaoDesde: whatsappWeb.status?.().desde || null,
      ultimaAtividade: whatsappWeb.status?.().ultimaAtividade || null,
    };
    const cfg = lerConfig();
    const lista = [...(cfg.invasoes || []), registro].slice(-50);
    gravarConfig({ ...cfg, invasoes: lista });
    console.error('[canais] ⚠ POSSIVEL TOMADA DE CONTA — registrado:', JSON.stringify(registro));
    console.error('[canais]   abra o WhatsApp do numero -> Aparelhos conectados -> desconecte o que nao for seu,');
    console.error('[canais]   e ligue a verificacao em duas etapas. Registro em ' + arqConfig());
  });

  whatsappWeb.aoDonoEscrever(({ de, endereco }) => {
    const chave = de || endereco;
    if (!chave) { return; }
    const r = bot.assumirConversa(chave, { endereco });
    /* Nome vem da configuracao tambem no LOG: numa instalacao de cliente, ler
       "a Micaela fica quieta" sobre um bot chamado Paulao e confuso pra quem
       esta lendo o log pra entender um atendimento. */
    if (r?.novo) {
      const quem = bot.painel?.().config?.nome || 'o atendimento';
      console.log(`[canais] voce assumiu a conversa com ${chave} — ${quem} fica quieto ate devolver`);
    }
  });

  whatsappWeb.aoMudarStatus((st) => {
    const e = st?.estado || '?';
    if (e === 'conectado') { console.log(`[canais] whatsapp CONECTADO${st.numero ? ' — ' + st.numero : ''}`); }
    else if (e === 'aguardando_qr') { console.warn('[canais] whatsapp esperando QR — o canal esta mudo ate alguem ler no painel'); }
    else if (e === 'caido') { console.error(`[canais] whatsapp CAIU${st.ultimoErro ? ' — ' + st.ultimoErro : ''}`); }
    else { console.log(`[canais] whatsapp ${e}`); }
  });

  gateway.registrar(whatsappWeb);
  return gateway;
}

/* Config do canal: numero previsto, apelido e setores. Fica em disco junto do
   resto — e o que o contrato promete, nao o que a sessao descobriu. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import { dentroDaCasa } from '../engine/casa.mjs';
const arqConfig = () => dentroDaCasa('canais', 'config.json');
const lerConfig = () => { try { return JSON.parse(readFileSync(arqConfig(), 'utf8')); } catch { return {}; } };
/* Grava a config do canal. Existe separado porque o registro de invasao precisa
   escrever SEM passar pela validacao de numero do formulario. */
const gravarConfig = (cfg) => {
  try { mkdirSync(dirname(arqConfig()), { recursive: true }); } catch { /* ja existe */ }
  writeFileSync(arqConfig(), JSON.stringify(cfg, null, 2));
};

/** O que foi registrado de tomada de conta, do mais recente pro mais antigo. */
export const invasoes = () => [...(lerConfig().invasoes || [])].reverse();

export function salvarConfigCanal(d = {}) {
  const numero = String(d.numero || '').replace(/\D/g, '');
  if (numero && numero.length < 10) { return { ok: false, motivo: 'número curto demais — informe com DDD' }; }
  const cfg = {
    ...lerConfig(),
    numero: numero || null,
    apelido: String(d.apelido || '').trim() || null,
    setores: (d.setores || []).map((x) => String(x).trim()).filter(Boolean),
    atualizadoEm: new Date().toISOString(),
  };
  mkdirSync(dirname(arqConfig()), { recursive: true, mode: 0o700 });
  writeFileSync(arqConfig(), JSON.stringify(cfg, null, 2));
  return { ok: true, config: cfg };
}

/**
 * Guarda a INTENCAO: o canal deve estar no ar? E diferente de estar no ar.
 * Sem isso, todo reinicio do painel — um deploy, uma queda, um kill — deixava
 * o WhatsApp do cliente mudo ate alguem abrir a tela e clicar em Conectar.
 * Ninguem clica no que nao sabe que caiu: quem descobria era o cliente dele,
 * mandando mensagem e nao sendo atendido.
 */
function marcarLigado(ligado) {
  const cfg = { ...lerConfig(), ligado, [ligado ? 'ligadoEm' : 'desligadoEm']: new Date().toISOString() };
  mkdirSync(dirname(arqConfig()), { recursive: true, mode: 0o700 });
  writeFileSync(arqConfig(), JSON.stringify(cfg, null, 2));
}

/**
 * Chamado no boot do painel. Se o canal estava ligado, reabre a sessao sozinho.
 *
 * O login fica salvo no perfil do navegador, entao na maioria das vezes ela
 * volta SEM QR nenhum. Quando o WhatsApp tiver expirado o pareamento, volta
 * pedindo QR — e isso precisa aparecer GRITANDO no log, porque e o unico caso
 * em que so um humano com o celular na mao resolve.
 */
export async function retomar({ produtos } = {}) {
  const cfg = lerConfig();
  if (!cfg.ligado) {
    return { ok: true, retomado: false, motivo: 'o canal estava desligado quando o painel parou' };
  }
  console.log('[canais] o canal estava ligado — reabrindo a sessao do WhatsApp');
  const g = montar({ produtos });
  const p = g.obter('whatsapp-web');
  if (!p) { return { ok: false, erro: 'canal whatsapp-web nao existe' }; }

  p.conectar().catch((e) => console.error(`[canais] nao consegui reabrir a sessao: ${e.message}`));
  const st = await esperarQr(p);
  if (st.estado === 'conectado') {
    console.log('[canais] WhatsApp de volta no ar — o login estava salvo, nao precisou de QR');
  } else if (st.estado === 'aguardando_qr') {
    console.warn('[canais] ATENCAO: o pareamento expirou — PRECISA ler o QR de novo no painel, o canal esta mudo ate la');
  } else {
    console.warn(`[canais] sessao em "${st.estado}" depois de retomar — acompanhar`);
  }
  return { ok: true, retomado: true, ...st };
}

/**
 * Varre os atendimentos parados e encerra, avisando o cliente com o protocolo.
 *
 * Chamada de tempos em tempos pelo painel. O aviso e a metade que importa: um
 * atendimento que fecha em silencio deixa a pessoa achando que foi ignorada —
 * e sem o numero ela nao tem como voltar pro mesmo lugar.
 *
 * Quem nao tem por onde ser avisado (protocolo antigo, sem endereco guardado)
 * e encerrado do mesmo jeito: melhor fechar calado do que deixar atendimento
 * fantasma ocupando a fila pra sempre.
 */
export async function encerrarParados({ agora } = {}) {
  const encerrados = proto.varrerInativos(agora ? { quando: agora } : {});
  if (!encerrados.length) { return { encerrados: 0 }; }

  let avisados = 0;
  for (const p of encerrados) {
    /* A conversa do bot tambem se fecha: sem isso a pessoa voltaria e cairia no
       meio da arvore antiga, com o protocolo dizendo outra coisa. */
    bot.devolverAoBot(p.de);
    const para = p.endereco || p.de;
    if (!para || !whatsappWeb) { continue; }
    try {
      const r = await whatsappWeb.enviarTexto({ para, texto: proto.textoDeEncerramento(p) });
      if (r?.ok) { avisados += 1; } else {
        console.warn(`[protocolo] ${p.numero} encerrado, mas nao avisei: ${r?.erro || 'sem motivo'}`);
      }
    } catch (e) {
      console.warn(`[protocolo] ${p.numero} encerrado, mas nao avisei: ${e.message}`);
    }
  }
  console.log(`[protocolo] ${encerrados.length} atendimento(s) encerrado(s) por silencio, ${avisados} avisado(s)`);
  return { encerrados: encerrados.length, avisados };
}

/** Minutos de espera até a Micaela voltar para dizer que ainda está esperando. */
const MIN_ATE_RESGATE = Number(process.env.MINUTOS_RESGATE_FILA || 10);

/**
 * Resgata quem ficou esperando gente e não foi atendido.
 *
 * O silêncio pós-handoff existe para o bot não falar por cima do atendente. Só
 * que, sem atendente, ele virava abandono: a pessoa escrevia, era encaminhada,
 * e sumia todo mundo por quatro horas. Do lado dela, o atendimento morreu.
 *
 * A mensagem é honesta de propósito: não promete prazo, não inventa que "já
 * estão te atendendo". Diz que ainda não conseguiu alguém, entrega o número do
 * protocolo e deixa claro que a conversa continua de onde parou.
 */
export async function resgatarFila({ agora, minutos } = {}) {
  const espera = minutos ?? MIN_ATE_RESGATE;
  const parados = bot.aguardandoHaMais(espera, agora ? new Date(agora).getTime() : Date.now());
  if (!parados.length) { return { resgatados: 0 }; }

  let avisados = 0;
  for (const p of parados) {
    const proto_ = proto.aberto(p.de) || proto.ultimoEncerrado(p.de);
    const numero = proto_?.numero;
    const texto = `Ainda não consegui falar com alguém do time — peço desculpa pela espera.\n\n`
      + (numero ? `*Protocolo ${numero}*\n\n` : '')
      + `Não se preocupe: guardei tudo o que você me contou. Assim que alguém assumir, a conversa continua `
      + `daqui, sem você precisar repetir nada. Se preferir, pode escrever mais detalhes agora que eu registro.`;

    /* Marca ANTES de enviar. Se o envio falhar, a pessoa nao e avisada duas
       vezes na proxima varredura — e aviso repetido de espera vira alarme, nao
       tranquilidade. */
    bot.marcarResgatada(p.de);

    const para = proto_?.endereco || p.de;
    if (!whatsappWeb) { continue; }
    try {
      const r = await whatsappWeb.enviarTexto({ para, texto });
      if (r?.ok) { avisados += 1; } else {
        console.warn(`[fila] ${p.de} espera ha ${p.minutos} min e nao consegui avisar: ${r?.erro || 'sem motivo'}`);
      }
    } catch (e) {
      console.warn(`[fila] ${p.de} espera ha ${p.minutos} min e nao consegui avisar: ${e.message}`);
    }
  }

  /* Este aviso e para o DONO, e por isso e barulhento: alguem esta esperando
     atendimento humano e ninguem assumiu. */
  console.warn(`[fila] ATENCAO: ${parados.length} pessoa(s) esperando atendimento ha mais de ${espera} min `
    + `(${parados.map((x) => `${x.de} ha ${x.minutos}min`).join(', ')}) — ${avisados} avisada(s) da espera`);
  return { resgatados: parados.length, avisados };
}

export function estado() {
  const config = lerConfig();
  /* O limite de atendentes vem do PLANO, nao daqui: ampliar e adendo de
     contrato. Enquanto o modulo de plano nao informa, some. */
  const plano = { atendentes: config.atendentesContratados ?? null };
  if (!gateway) { return { canais: [], montado: false, config, plano }; }
  return { canais: gateway.listar(), montado: true, config, plano };
}

/**
 * Espera o QR aparecer — ou desistir de esperar. NAO espera a sessao ficar
 * pronta: `create()` do WPPConnect so resolve DEPOIS que alguem le o QR, e
 * segurar a resposta HTTP ate la e o que fazia o proxy derrubar a requisicao
 * com 524 e matar o QR junto. Quem termina o trabalho e o polling da tela.
 */
function esperarQr(p, limiteMs = 20000) {
  const t0 = Date.now();
  return new Promise((res) => {
    const olhar = () => {
      const s = p.status();
      if (s.estado !== 'conectando' || Date.now() - t0 > limiteMs) { return res(s); }
      setTimeout(olhar, 250);
    };
    olhar();
  });
}

export async function conectar({ canal = 'whatsapp-web', produtos } = {}) {
  const g = montar({ produtos });
  const p = g.obter(canal);
  if (!p) { return { ok: false, erro: `canal "${canal}" não existe` }; }
  marcarLigado(true);

  // Dispara e NAO aguarda: a promessa so termina quando a sessao estiver pareada.
  p.conectar().catch((e) => console.error('[canais] sessao falhou:', e.message));

  const s = await esperarQr(p);
  return { ok: true, ...s };
}

/**
 * Trocar o número que atende.
 *
 * Esquece o aparelho pareado e sobe a sessão de novo, que aí nasce pedindo QR.
 * Sem isto, "desconectar e conectar" voltava sempre para o MESMO número —
 * silenciosamente, porque o login mora no perfil do navegador. Quem queria ligar
 * outro chip não tinha caminho nenhum na tela.
 */
export async function trocarNumero({ canal = 'whatsapp-web', produtos } = {}) {
  const g = montar({ produtos });
  const p = g.obter(canal);
  if (!p) { return { ok: false, erro: `canal "${canal}" não existe` }; }
  if (typeof p.esquecerAparelho !== 'function') {
    return { ok: false, erro: `o canal "${canal}" não permite trocar de número` };
  }

  console.log('[canais] TROCANDO o numero que atende — o pareamento atual sera esquecido');
  const r = await p.esquecerAparelho();
  if (!r.ok) { return r; }

  /* Marca ligado ANTES de conectar: quem pediu para trocar de número quer o
     canal no ar, e sem isto um reinício no meio do pareamento deixaria tudo
     desligado sem ninguém entender por quê. */
  marcarLigado(true);
  p.conectar().catch((e) => console.error(`[canais] falhei ao subir a sessao nova: ${e.message}`));
  const st = await esperarQr(p);
  console.log(`[canais] sessao nova em "${st.estado}"${st.qr ? ' — QR pronto para leitura' : ''}`);
  return { ok: true, ...st, anterior: r.guardadoEm || null, tinhaSessao: r.tinhaSessao };
}

export async function desconectar({ canal = 'whatsapp-web' } = {}) {
  marcarLigado(false);
  if (!gateway) { return { ok: true, estado: 'desconectado' }; }
  const p = gateway.obter(canal);
  if (!p) { return { ok: false, erro: `canal "${canal}" não existe` }; }
  await p.desconectar();
  return { ok: true, ...p.status() };
}

/** Sai da conta do telefone (o aparelho deixa de listar a sessão). Religar pede QR. */
export async function desparear({ canal = 'whatsapp-web' } = {}) {
  marcarLigado(false);
  if (!gateway) { return { ok: true, estado: 'desconectado' }; }
  const p = gateway.obter(canal);
  if (!p) { return { ok: false, erro: `canal "${canal}" não existe` }; }
  if (typeof p.desparear !== 'function') { await p.desconectar(); return { ok: true, saiu: false, ...p.status() }; }
  console.log('[canais] DESPAREANDO o telefone — religar vai pedir QR');
  const r = await p.desparear();
  return { ok: true, saiu: r.saiu, ...p.status() };
}

export async function saude() {
  if (!gateway) { return []; }
  return gateway.saudeGeral();
}

/**
 * Foto, nome e recado do numero — a cara que o cliente ve no topo da conversa.
 * So o canal por WhatsApp Web faz isso; provider que nao souber devolve o motivo
 * em vez de estourar.
 */
export async function personalizar({ canal = 'whatsapp-web', foto, nome, recado } = {}) {
  if (!gateway) { return { ok: false, erro: 'nenhum canal conectado' }; }
  const p = gateway.obter(canal);
  if (!p) { return { ok: false, erro: `canal "${canal}" não existe` }; }
  if (typeof p.personalizar !== 'function') { return { ok: false, erro: `o canal "${canal}" não permite mudar foto e nome` }; }

  /* Isto muda a CARA PUBLICA do numero, pra todos os contatos da pessoa — e nao
     deixava rastro nenhum. Quando o dono perguntou "essa foto vai pro meu
     perfil ou e so preview?", o log nao soube responder, e essa e justamente a
     pergunta que um registro existe pra responder. */
  const oQue = [foto ? 'foto' : null, nome ? 'nome' : null, recado ? 'recado' : null].filter(Boolean);
  console.log(`[canais] TROCANDO o perfil do numero (${oQue.join(', ') || 'nada'}) — isto aparece para todos os contatos`);

  const r = await p.personalizar({ foto, nome, recado });
  const feito = (r?.feito || []).join(', ') || 'nada';
  const falhas = (r?.falhas || []).join('; ');
  console.log(`[canais] perfil: aplicado ${feito}${falhas ? ` | recusado pelo WhatsApp: ${falhas}` : ''}`);

  /* Guarda a cara ANTERIOR — e so a primeira vez. Salvar a cada aplicacao
     faria o backup virar a Micaela depois da segunda troca, e aí nao haveria
     mais pra onde voltar. O que se quer guardar e o perfil de ANTES do produto
     entrar no numero. */
  if ((r?.feito || []).length && r.anterior && !lerConfig().perfilAnterior) {
    const cfg = { ...lerConfig(), perfilAnterior: r.anterior };
    mkdirSync(dirname(arqConfig()), { recursive: true, mode: 0o700 });
    writeFileSync(arqConfig(), JSON.stringify(cfg, null, 2));
    console.log('[canais] perfil anterior guardado — da pra voltar pelo painel');
  }
  return r;
}

/** Existe um perfil guardado pra onde voltar? A tela pergunta isto. */
/**
 * O perfil que esta NO NUMERO agora.
 *
 * A tela de perfil nascia vazia: so placeholder, e o preview caia num "Micaela"
 * fixo. Quem abria nao sabia o que estava valendo, e ao sair do campo sem
 * digitar nada o preview voltava pro texto inventado — parecia que os dados
 * tinham sumido. Nao tinham: nunca chegaram.
 */
export async function perfilAtual() {
  if (!whatsappWeb || typeof whatsappWeb.perfilAtual !== 'function') { return null; }
  try { return await whatsappWeb.perfilAtual(); } catch { return null; }
}

export function perfilAnterior() {
  const a = lerConfig().perfilAnterior || null;
  return a ? { em: a.em, temFoto: Boolean(a.foto), nome: a.nome || null, recado: a.recado || null } : null;
}

/**
 * Devolve o numero a cara que ele tinha antes.
 *
 * Aplicar era automatico e voltar era tarefa manual no celular — meio caminho,
 * e meio caminho deixa a pessoa com medo de clicar. Agora as duas pontas vivem
 * no mesmo lugar.
 */
export async function restaurarPerfil({ canal = 'whatsapp-web' } = {}) {
  const a = lerConfig().perfilAnterior;
  if (!a) { return { ok: false, erro: 'não tenho a cara anterior guardada — ela só é salva na primeira vez que o painel troca o perfil' }; }
  if (!a.foto && !a.nome && !a.recado) {
    return { ok: false, erro: 'a cara anterior foi guardada vazia — não tenho o que devolver. Troque a foto pelo celular.' };
  }
  if (!gateway) { return { ok: false, erro: 'nenhum canal conectado' }; }
  const p = gateway.obter(canal);
  if (!p) { return { ok: false, erro: `canal "${canal}" não existe` }; }

  console.log('[canais] RESTAURANDO o perfil anterior do numero');
  const r = await p.personalizar({ foto: a.foto || null, nome: a.nome || null, recado: a.recado || null });
  console.log(`[canais] perfil restaurado: ${(r?.feito || []).join(', ') || 'nada'}${(r?.falhas || []).length ? ` | recusado: ${r.falhas.join('; ')}` : ''}`);
  return r;
}

/** Usado quando o atendente responde pelo painel, fora do fluxo do bot. */
export async function enviar({ canal = 'whatsapp-web', para, texto }) {
  if (!gateway) { return { ok: false, erro: 'nenhum canal conectado' }; }
  return gateway.enviarPor(canal, { para, texto });
}

/** Documento (contrato em PDF) pelo canal conectado. */
export async function enviarArquivo({ canal = 'whatsapp-web', para, dataUri, nome, legenda }) {
  if (!gateway) { return { ok: false, erro: 'nenhum canal conectado' }; }
  return gateway.enviarArquivoPor(canal, { para, dataUri, nome, legenda });
}
