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
      const r = await atendimento.receberMensagem(
        { id: msg.id, de: msg.de, nome: msg.nome, texto: msg.texto, tipo: msg.tipo },
        {
          enviar: async ({ texto }) => ctx.responder(texto),
          produtos: produtos || (() => []),
        },
      );
      // O atendimento já respondeu por dentro (ele decide se responde e o quê).
      // Não devolvo `responder` aqui pra não mandar duas vezes.
      if (r?.handoff) { console.log(`[canais] ${msg.de} precisa de gente`); }
      return null;
    },
  });

  whatsappWeb = criarWhatsAppWebProvider();
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

  // Dispara e NAO aguarda: a promessa so termina quando a sessao estiver pareada.
  p.conectar().catch((e) => console.error('[canais] sessao falhou:', e.message));

  const s = await esperarQr(p);
  return { ok: true, ...s };
}

export async function desconectar({ canal = 'whatsapp-web' } = {}) {
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
