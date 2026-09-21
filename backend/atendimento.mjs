/**
 * O fio que faltava: a mensagem que o cliente manda no WhatsApp entra aqui, vira
 * lead no CRM, passa pelo bot e a resposta sai pela Cloud API — com tudo indo pra
 * trilha, dos dois lados.
 *
 * Até aqui o módulo do bot era entregável SEM canal (dava pra ver a conversa
 * inteira no simulador), e o canal simplesmente não existia: o painel escrevia
 * "webhook de entrada · não existe" na própria tela. Este arquivo é só a ligação —
 * nenhuma regra de atendimento mora aqui, elas continuam em `vsbot`.
 *
 * Três coisas que este arquivo leva a sério:
 *
 *  - IDEMPOTÊNCIA. A Meta reentrega o mesmo evento quando não recebe 2xx, e uma
 *    reentrega não pode virar segundo lead nem segunda resposta. A trava é o
 *    `id` da mensagem, reservado ANTES de qualquer efeito.
 *  - HONESTIDADE DA TRILHA. A interação de saída só é registrada se a mensagem
 *    saiu de verdade. Registrar antes do envio faria a trilha jurar que o cliente
 *    recebeu uma resposta que ficou no caminho.
 *  - FUNIL PRIMEIRO. Sem funil cadastrado o CRM não inventa etapa (regra do
 *    módulo), então o lead não é criado — mas o bot responde assim mesmo. Não
 *    responder porque falta configuração interna é deixar o cliente no vácuo por
 *    um problema que não é dele.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizarTelefone, leadId } from '../engine/vscrm/leads.mjs';
import * as crm from '../engine/vscrm/index.mjs';
import * as bot from '../engine/vsbot/index.mjs';
import { reservarEvento } from './idempotencia.mjs';
import { enviarTexto } from './whatsapp.mjs';

/**
 * Confere a assinatura da Meta (X-Hub-Signature-256 = HMAC-SHA256 do corpo CRU
 * com o app secret). Sem isto, qualquer um que descobrisse a URL mandaria
 * mensagem em nome de um cliente e a trilha aceitaria como verdade.
 *
 * Sem `segredo` configurado a conferência é PULADA e quem chama recebe
 * `conferida:false` — pra poder gritar no log em vez de fingir que validou.
 */
export function confereAssinatura(corpoCru, header, segredo) {
  if (!segredo) { return { ok: true, conferida: false, motivo: 'WA_APP_SECRET ausente — assinatura não conferida' }; }
  const recebida = String(header || '');
  if (!recebida.startsWith('sha256=')) { return { ok: false, conferida: true, motivo: 'assinatura ausente ou fora do formato' }; }
  const esperada = 'sha256=' + createHmac('sha256', segredo).update(corpoCru).digest('hex');
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  // Comprimento diferente já reprova; timingSafeEqual exige buffers do mesmo tamanho.
  if (a.length !== b.length || !timingSafeEqual(a, b)) { return { ok: false, conferida: true, motivo: 'assinatura não confere' }; }
  return { ok: true, conferida: true };
}

/**
 * Tira as mensagens de texto do envelope da Meta. Função pura — o formato do
 * webhook é aninhado (entry > changes > value > messages) e um payload de
 * status de entrega ("lida", "entregue") chega pelo MESMO endpoint, sem
 * `messages`. Devolver [] nesse caso é o comportamento certo: status não é
 * conversa e não pode virar lead.
 */
export function extrairMensagens(evento) {
  const out = [];
  for (const entry of evento?.entry || []) {
    for (const ch of entry?.changes || []) {
      const v = ch?.value || {};
      const nomes = new Map((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        // Áudio, imagem e figurinha chegam sem `text`. Não dá pra responder ao
        // conteúdo, mas dá pra registrar que a pessoa falou — e é o que o
        // atendente humano precisa ver quando abrir a conversa.
        const texto = m.type === 'text' ? (m.text?.body || '') : '';
        out.push({
          id: m.id,
          de: m.from,
          nome: nomes.get(m.from) || null,
          tipo: m.type,
          texto,
          quando: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return out;
}

/* Contador de "não entendi" seguidos, por lead. Vive em memória de propósito:
   serve pra decidir quando chamar uma pessoa DENTRO de uma conversa, e conversa
   que ficou parada tempo suficiente pro processo reiniciar merece recomeçar do
   zero mesmo. */
const falhas = new Map();

/** Uma mensagem. Devolve o que aconteceu — quem chama decide o que logar. */
export async function receberMensagem(msg, deps = {}) {
  const enviar = deps.enviar || enviarTexto;
  const reservar = deps.reservar || reservarEvento;
  const produtos = deps.produtos || (() => []);
  const empresa = deps.empresa || process.env.VITRINE_NOME || 'nossa loja';

  const t = normalizarTelefone(msg.de);
  if (!t.telefone) { return { ok: false, motivo: 'telefone inválido: ' + msg.de }; }

  // Reserva ANTES de qualquer efeito: se a Meta reentregar, para aqui.
  if (msg.id && !reservar('wa_' + msg.id, { tipo: 'mensagem' })) {
    return { ok: true, duplicado: true, telefone: t.telefone };
  }

  const id = leadId(t.telefone);
  let lead = crm.listar().find((l) => l.id === id) || null;
  let leadNovo = false;
  let semCrm = null;
  if (!lead) {
    const r = crm.criar({ nome: msg.nome, telefone: t.telefone, origem: 'whatsapp' });
    if (r.lead) { lead = r.lead; leadNovo = true; }
    // r.erro (tipicamente "sem funil cadastrado") não interrompe: o bot responde
    // mesmo assim e o motivo sobe pra quem chamou colocar no log.
    semCrm = r.erro || null;
  }

  if (lead) {
    crm.interagir(lead.id, { canal: 'whatsapp', direcao: 'entrada', texto: msg.texto || `[${msg.tipo}]` });
  }

  const cfg = bot.painel().config;

  /* Áudio, foto e figurinha chegam sem texto: o bot não tem o que interpretar.
     A versão anterior ficava CALADA aqui — e no primeiro teste real isso pareceu
     defeito: a pessoa mandou áudio, nada voltou, e ninguém soube dizer por quê.
     Agora ele diz o que consegue fazer e oferece a saída. */
  if (!msg.texto) {
    const aviso = cfg.mensagemSemTexto;
    const envio = cfg.ativo && aviso ? await enviar({ phone: t.telefone, texto: aviso }) : { ok: false };
    if (lead && envio.ok) { crm.interagir(lead.id, { canal: 'whatsapp', direcao: 'saida', texto: aviso }); }
    return {
      ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm,
      semTexto: true, tipo: msg.tipo || 'midia', handoff: true, respondeu: envio.ok, envio,
    };
  }

  if (!cfg.ativo) {
    return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, botDesligado: true };
  }

  const chave = lead?.id || t.telefone;
  const r = bot.atender(msg.texto, {
    // `de` e o que permite o fluxo lembrar ONDE esta pessoa parou na arvore.
    de: t.telefone,
    nome: msg.nome || lead?.nome || 'Cliente',
    empresa,
    produtos: produtos(),
    falhasSeguidas: falhas.get(chave) || 0,
  });

  /* Bot calado de proposito: o atendimento ja passou pra uma pessoa e ele nao
     vai falar por cima dela. A mensagem fica registrada na trilha do mesmo
     jeito — quem for atender precisa ver o que o cliente escreveu. */
  if (r.calado) {
    return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, tipo: 'silencio', handoff: true, respondeu: false };
  }
  falhas.set(chave, r.tipo === 'fallback' ? (falhas.get(chave) || 0) + 1 : 0);

  // Catálogo vem com produtos: vira uma linha por item, senão o cliente recebe
  // "olha o que temos:" e mais nada.
  const texto = r.produtos?.length
    ? r.texto + '\n\n' + r.produtos.map((p) => `• ${p.nome} — ${p.vigenteFormatado || p.precoFormatado || ''}`.trim()).join('\n')
    : r.texto;

  const envio = await enviar({ phone: t.telefone, texto });
  // Só registra a saída se saiu mesmo (ver cabeçalho do arquivo).
  if (lead && envio.ok) {
    crm.interagir(lead.id, { canal: 'whatsapp', direcao: 'saida', texto });
  }

  return {
    ok: true,
    telefone: t.telefone,
    leadId: lead?.id || null,
    leadNovo,
    semCrm,
    tipo: r.tipo,
    handoff: r.handoff === true,
    respondeu: envio.ok,
    envio,
  };
}

/** O evento inteiro do webhook (pode trazer mais de uma mensagem). */
export async function processarEvento(evento, deps = {}) {
  const msgs = extrairMensagens(evento);
  const resultados = [];
  for (const m of msgs) { resultados.push(await receberMensagem(m, deps)); }
  return { ok: true, mensagens: msgs.length, resultados };
}

/** Só pra teste: zera o contador de falhas entre um caso e outro. */
export function _zerarFalhas() { falhas.clear(); }
