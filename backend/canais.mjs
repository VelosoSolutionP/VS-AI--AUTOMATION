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
  if (r.emSilencio || r.silenciado) { return 'conversa em silencio pos-handoff'; }
  if (r.respondeu === false) { return 'o fluxo decidiu nao responder esta mensagem'; }
  return 'o fluxo nao produziu resposta';
}

let gateway = null;
let whatsappWeb = null;

/** Monta na primeira chamada. Sessão só abre quando alguém pedir "Conectar". */
function montar({ produtos } = {}) {
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
        { id: msg.id, de: msg.de, nome: msg.nome, texto: msg.texto, tipo: msg.tipo },
        {
          /* O ENVIO e o unico passo que some quando falha: a mensagem entrou, a
             trilha registrou, e o cliente nunca viu nada. Do lado de ca o log
             ficava mudo e a conclusao virava "o bot nao funciona". Cada tentativa
             passa a deixar rastro — a que deu certo e, principalmente, a que nao. */
          enviar: async ({ texto }) => {
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
          produtos: produtos || (() => []),
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
  whatsappWeb.aoDonoEscrever(({ de, endereco }) => {
    const chave = de || endereco;
    if (!chave) { return; }
    const r = bot.assumirConversa(chave, { endereco });
    if (r?.novo) { console.log(`[canais] voce assumiu a conversa com ${chave} — a Micaela fica quieta ate devolver`); }
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

const arqConfig = () => join(homedir(), '.qa-gate', 'canais', 'config.json');
const lerConfig = () => { try { return JSON.parse(readFileSync(arqConfig(), 'utf8')); } catch { return {}; } };

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

export async function desconectar({ canal = 'whatsapp-web' } = {}) {
  marcarLigado(false);
  if (!gateway) { return { ok: true, estado: 'desconectado' }; }
  const p = gateway.obter(canal);
  if (!p) { return { ok: false, erro: `canal "${canal}" não existe` }; }
  await p.desconectar();
  return { ok: true, ...p.status() };
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
  return p.personalizar({ foto, nome, recado });
}

/** Usado quando o atendente responde pelo painel, fora do fluxo do bot. */
export async function enviar({ canal = 'whatsapp-web', para, texto }) {
  if (!gateway) { return { ok: false, erro: 'nenhum canal conectado' }; }
  return gateway.enviarPor(canal, { para, texto });
}
