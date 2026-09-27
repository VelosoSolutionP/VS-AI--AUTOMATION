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
import * as pagamentos from '../engine/vspagamentos/index.mjs';
import { emReais } from '../engine/vsbot/fluxo.mjs';
import * as resultados from '../engine/vsresultados/index.mjs';
import * as qualif from '../engine/vsqualificacao/index.mjs';
import * as operadores from '../engine/vsoperadores/index.mjs';
import * as proto from '../engine/vsprotocolo/index.mjs';

/**
 * Quem fica com o cliente quando a conversa vai pra gente. Carteira primeiro
 * (a regra "temResponsavel" decidiu), depois rodízio da equipe. Null = a fila
 * geral: qualquer um que assumir vira o responsável.
 */
function escolherResponsavel(decisao, lead, equipe) {
  const ativos = operadores.ativos(operadores.listar());
  const cart = lead?.comercial?.responsavel;
  if (decisao?.destino === 'responsavel' && cart && ativos.some((o) => o.id === cart.operadorId)) {
    return { operadorId: cart.operadorId, nome: cart.nome, equipe: cart.equipe || null, motivo: 'carteira: já era o vendedor deste cliente' };
  }
  if (decisao?.destino === 'tier') { return qualif.distribuir('comercial', ativos, { tier: decisao.tier }); }
  return equipe ? qualif.distribuir(equipe, ativos) : null;
}
/* TODA conversa tem protocolo. So o fluxo em planilha abria um: loja que usa so
   regras (ou bot desligado) ficava sem numero, sem como encerrar e sem
   historico. Com fluxo, o bot ja abriu antes — aqui vira no-op. */
function garantirProtocolo(telefone, endereco, departamento) {
  try {
    if (!proto.aberto(telefone)) { proto.aoChegar(telefone, { endereco: endereco || null, voltarParaFila: false }); }
    const vivo = proto.aberto(telefone);
    if (vivo && bot.estaComGente(telefone) && vivo.estado === proto.ESTADOS.COM_BOT) {
      return proto.anotar(vivo.numero, { estado: proto.ESTADOS.NA_FILA, departamento: departamento || 'humano' });
    }
    return vivo;
  } catch (e) { console.error(`[protocolo] nao garanti o protocolo: ${e.message}`); return null; }
}
const equipesComGente = () => [...new Set(operadores.ativos(operadores.listar()).map((o) => qualif.normEquipe(o.setor)))];
const tiersComGente = () => qualif.tiersComGente(operadores.ativos(operadores.listar()));

/**
 * Confere a assinatura da Meta (X-Hub-Signature-256 = HMAC-SHA256 do corpo CRU
 * com o app secret). Sem isto, qualquer um que descobrisse a URL mandaria
 * mensagem em nome de um cliente e a trilha aceitaria como verdade.
 *
 * Sem `segredo` configurado a conferência é PULADA e quem chama recebe
 * `conferida:false` — pra poder gritar no log em vez de fingir que validou.
 */
/** Limite de legenda de imagem no WhatsApp: acima disso, o texto vai em balão próprio. */
export const LEGENDA_MAX = 1024;

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

  /* De que canal veio. A trilha do lead grava isto em cada interacao — e e
     por ela que o Auditor e o Consumo de cada canal separam o que e de quem. */
  const canal = msg.canal === 'telegram' ? 'telegram' : 'whatsapp';
  const t = normalizarTelefone(msg.de);
  if (!t.telefone) { return { ok: false, motivo: 'telefone inválido: ' + msg.de }; }

  // Reserva ANTES de qualquer efeito: se a Meta reentregar, para aqui.
  if (msg.id && !reservar('wa_' + msg.id, { tipo: 'mensagem' })) {
    return { ok: true, duplicado: true, telefone: t.telefone };
  }

  /* Chegou por um link de campanha: grava a origem ANTES de tudo, pra que o
     pedido que sair desta conversa ja nasca atribuido a ela. */
  if (msg.ref) { resultados.registrarOrigem(t.telefone, { canal, campanha: msg.ref }); }

  const id = leadId(t.telefone);
  let lead = crm.listar().find((l) => l.id === id) || null;
  let leadNovo = false;
  let semCrm = null;
  if (!lead) {
    const r = crm.criar({ nome: msg.nome, telefone: t.telefone, origem: canal });
    if (r.lead) { lead = r.lead; leadNovo = true; }
    // r.erro (tipicamente "sem funil cadastrado") não interrompe: o bot responde
    // mesmo assim e o motivo sobe pra quem chamou colocar no log.
    semCrm = r.erro || null;
  }

  if (lead) {
    crm.interagir(lead.id, { canal, direcao: 'entrada', texto: msg.texto || `[${msg.tipo}]` });
  }

  /* QUALIFICAÇÃO: toda mensagem com texto atualiza a ficha comercial do lead
     (intenção, necessidade, produto, porte, complexidade, prazo) — por regras,
     sem IA. É o que deixa o vendedor começar sabendo com quem está falando. */
  let ficha = null;
  if (lead && msg.texto) {
    try {
      ficha = qualif.qualificar(lead.comercial?.ficha, msg.texto, { produtos: produtos() });
      lead = crm.comercial(lead.id, { ficha }).lead || lead;
    } catch (e) { console.error(`[qualificacao] ficha nao atualizou: ${e.message}`); }
  }

  const cfg = bot.painel().config;

  /* Áudio, foto e figurinha chegam sem texto: o bot não tem o que interpretar.
     A versão anterior ficava CALADA aqui — e no primeiro teste real isso pareceu
     defeito: a pessoa mandou áudio, nada voltou, e ninguém soube dizer por quê.
     Agora ele diz o que consegue fazer e oferece a saída. */
  if (!msg.texto) {
    /* O silencio pos-handoff vale AQUI TAMBEM. Em campo: a pessoa pediu para
       falar com gente, foi encaminhada, mandou um audio em seguida — e o bot
       respondeu por cima do atendente com "nao consigo ouvir audio". Quem
       assumiu a conversa consegue ouvir; o bot entrar ali so atrapalha os dois.

       Este caminho e anterior ao motor do bot, entao a regra tinha de ser
       conferida de novo — foi por isso que passou batido. */
    const calado = bot.estaComGente(t.telefone);
    const aviso = cfg.mensagemSemTexto;
    const envio = cfg.ativo && aviso && !calado ? await enviar({ phone: t.telefone, texto: aviso }) : { ok: false };
    if (lead && envio.ok) { crm.interagir(lead.id, { canal, direcao: 'saida', texto: aviso, autor: 'bot' }); }
    return {
      ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm,
      semTexto: true, tipo: msg.tipo || 'midia', handoff: true, respondeu: envio.ok, envio,
      ...(calado ? { calado: true, motivo: 'atendimento ja esta com uma pessoa' } : {}),
    };
  }

  /* AVALIAÇÃO E ENCERRAMENTO PELO CLIENTE — antes do bot, porque:
     - a nota ("5") logo depois do encerramento NÃO é conversa nova: se fosse
       pro bot, reabria o protocolo e ele respondia "não entendi";
     - "pode encerrar" fecha o atendimento com gente ou com o bot, e já pede
       a avaliação. Vale com o bot ligado ou não: é a casa encerrando. */
  if (msg.texto) {
    const registrar = (texto) => { if (lead) { crm.interagir(lead.id, { canal, direcao: 'saida', texto, autor: 'bot' }); } };
    const pend = proto.avaliacaoPendente(t.telefone);
    if (pend?.avaliacao?.estado === 'aguardando') {
      const nota = proto.lerNota(msg.texto);
      if (nota) {
        proto.registrarNota(pend.numero, nota);
        const txt = proto.textoObrigadoNota(nota);
        const envio = await enviar({ phone: t.telefone, texto: txt });
        if (envio.ok) { registrar(txt); }
        return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, tipo: 'avaliacao:nota', nota, protocolo: pend.numero, respondeu: envio.ok, envio };
      }
      proto.semResposta(pend.numero);
    } else if (pend?.avaliacao?.estado === 'comentario') {
      const pular = /^\s*(0|pular|nao|não|n)\s*[.!]*$/i.test(msg.texto);
      proto.registrarComentario(pend.numero, pular ? null : msg.texto);
      const txt = pular ? 'Tudo bem! Obrigado. 🙏' : proto.textoObrigadoComentario();
      const envio = await enviar({ phone: t.telefone, texto: txt });
      if (envio.ok) { registrar(txt); }
      return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, tipo: 'avaliacao:comentario', protocolo: pend.numero, respondeu: envio.ok, envio };
    }
    /* O atendente perguntou "posso ajudar em algo mais?". "Não" = FINALIZA
       (pelo atendente que perguntou) e pede a nota; qualquer outra coisa = a
       conversa continua com ele, e a mensagem segue o caminho normal. */
    const fin = proto.finalizacaoPendente(t.telefone);
    if (fin) {
      if (proto.clienteNaoPrecisaMais(msg.texto)) {
        const fechado = proto.encerrarPorNumero(fin.numero, { motivo: 'finalizado', desfecho: 'finalizado',
          por: { tipo: 'atendente', ...(fin.finalizacao.por || {}) }, atendidoPor: fin.atendidoPor || fin.finalizacao.por || null,
          motivoTexto: `cliente respondeu “${String(msg.texto).slice(0, 80)}” à pergunta final` });
        bot.devolverAoBot(t.telefone);
        proto.pedirAvaliacao(fechado.numero);
        const txt = `${proto.textoFinalizado(fechado)}\n\n${proto.textoAvaliacao()}`;
        const envio = await enviar({ phone: t.telefone, texto: txt });
        if (envio.ok) { registrar(txt); }
        return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, tipo: 'finalizado', protocolo: fechado.numero, respondeu: envio.ok, envio };
      }
      proto.continuarAtendimento(fin.numero);
    }
    const vivo = proto.aberto(t.telefone);
    if (vivo && proto.clientePediuEncerrar(msg.texto)) {
      const fila = bot.emAtendimento().find((e) => e.telefone === t.telefone);
      /* O cliente FINALIZA — e a frase dele e o motivo que a auditoria le. */
      const fechado = proto.encerrarPorNumero(vivo.numero, { motivo: 'pedido do cliente', desfecho: 'finalizado', motivoTexto: `cliente escreveu “${String(msg.texto).slice(0, 80)}”`,
        por: { tipo: 'cliente', nome: msg.nome || lead?.nome || null },
        atendidoPor: vivo.atendidoPor || fila?.assumidaPor || lead?.comercial?.responsavel || null });
      bot.devolverAoBot(t.telefone);
      proto.pedirAvaliacao(fechado.numero);
      const txt = `${proto.textoDeEncerramento(fechado)}\n\n${proto.textoAvaliacao()}`;
      const envio = await enviar({ phone: t.telefone, texto: txt });
      if (envio.ok) { registrar(txt); }
      return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, tipo: 'encerrado:cliente', protocolo: fechado.numero, respondeu: envio.ok, envio };
    }
  }

  if (!cfg.ativo) {
    // Bot desligado = a equipe atende sozinha; encerrar e historico precisam do protocolo igual.
    garantirProtocolo(t.telefone, msg.endereco);
    return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, botDesligado: true };
  }

  const chave = lead?.id || t.telefone;
  /* Com jogo de cintura: se o fluxo nao entender a escolha, a IA local diz qual
     opcao a pessoa quis. Desligada ou fora do ar, e o atender de sempre. */
  const r = await bot.atenderComCerebro(msg.texto, {
    // `de` e o que permite o fluxo lembrar ONDE esta pessoa parou na arvore.
    de: t.telefone,
    /* Por ONDE responder. Com cliente que chega por LID o telefone nao serve
       pra enviar nada — e a varredura de inatividade precisa avisar o cliente
       DEPOIS, quando nao ha mais mensagem nenhuma na mao. Sem guardar isto, o
       encerramento seria silencioso e o protocolo nunca chegaria a quem
       precisa dele. */
    endereco: msg.endereco || null,
    nome: msg.nome || lead?.nome || 'Cliente',
    empresa,
    produtos: produtos(),
    falhasSeguidas: falhas.get(chave) || 0,
  });

  /* TODA conversa tem protocolo. So o fluxo em planilha abria um: loja que usa
     so regras ficava sem numero, sem como encerrar e sem historico. */
  const vivoP = garantirProtocolo(t.telefone, msg.endereco, r.departamento);
  if (vivoP && !r.protocolo) { r.protocolo = vivoP.numero; }

  /* Bot calado de proposito: o atendimento ja passou pra uma pessoa e ele nao
     vai falar por cima dela. A mensagem fica registrada na trilha do mesmo
     jeito — quem for atender precisa ver o que o cliente escreveu. */
  if (r.calado) {
    return { ok: true, telefone: t.telefone, leadId: lead?.id || null, leadNovo, semCrm, tipo: 'silencio', handoff: true, respondeu: false };
  }
  falhas.set(chave, r.tipo === 'fallback' ? (falhas.get(chave) || 0) + 1 : 0);

  /* SOCORRO / URGENTE: o alerta pros responsáveis sai em paralelo com a
     resposta ao cliente — esperar um pra mandar o outro gasta os segundos que
     mais importam. O resultado de cada envio fica na auditoria de segurança. */
  const alerta = r.alerta && deps.alertar
    ? deps.alertar({ ...r.alerta, cliente: msg.nome || lead?.nome || null, telefone: t.telefone, protocolo: r.protocolo || null })
      .catch((e) => console.error(`[seguranca] alerta nao saiu: ${e.message}`))
    : null;

  // Catálogo vem com produtos: vira uma linha por item, senão o cliente recebe
  // "olha o que temos:" e mais nada.
  let texto = r.produtos?.length
    ? r.texto + '\n\n' + r.produtos.map((p) => `• ${p.nome} — ${p.vigenteFormatado || p.precoFormatado || ''}`.trim()).join('\n')
    : r.texto;

  /* ROTEAMENTO. Duas situações:
     - o bot JÁ passou pra gente (pediu pessoa, fluxo encaminhou): a matriz diz
       PARA QUEM — carteira, equipe da regra, ou a fila que o fluxo escolheu;
     - o bot ia seguir, mas a ficha diz que é Tier 2 (integração, operação
       grande, reclamação): em vez da resposta do bot, sai a transferência.
     Nunca interrompe cobrança em andamento, emergência ou moderação, e não
     transfere de novo pela MESMA regra — senão "devolver ao bot" não teria efeito. */
  let roteamento = null;
  if (lead && ficha) {
    try {
      const resp = lead.comercial?.responsavel || null;
      /* `handoff` vem tambem no "nao entendi, quer falar com alguem?" — que so
         OFERECE. Rotular a fila so quando o bot de fato passou pra gente. */
      if (r.handoff && bot.estaComGente(t.telefone) && !r.emergencia && r.departamento !== 'urgencia') {
        const d = qualif.decidir(ficha, { responsavel: resp, texto: msg.texto, equipesComGente: equipesComGente(), tiersComGente: tiersComGente(), gatilho: 'handoff' });
        const generico = !r.departamento || r.departamento === 'humano';
        const equipe = d.tier >= 2 ? (d.equipe || (generico ? null : qualif.norm(r.departamento))) : (generico ? null : qualif.norm(r.departamento));
        if (d.tier >= 2 && generico && d.equipe) { bot.entregarParaEquipe(t.telefone, { departamento: d.equipe, contexto: r.contexto || {} }); }
        const quem = escolherResponsavel(d, lead, equipe);
        crm.comercial(lead.id, { decisao: d.tier >= 2 ? d : { ...d, tier: 2, destino: equipe ? 'equipe' : 'humano', equipe, motivo: 'o bot passou para gente', proximaAcao: qualif.proximaAcao(ficha) }, ...(quem ? { responsavel: quem } : {}) });
        roteamento = { quando: 'handoff', decisao: d, responsavel: quem };
      } else if (!r.handoff && !r.cobranca && !r.emergencia && !String(r.tipo || '').startsWith('moderacao')) {
        const d = qualif.decidir(ficha, { responsavel: resp, texto: msg.texto, equipesComGente: equipesComGente(), tiersComGente: tiersComGente() });
        const jaFoi = lead.comercial?.decisao?.tier >= 2 && lead.comercial.decisao.regra === d.regra;
        if (d.tier >= 2 && !jaFoi) {
          const quem = escolherResponsavel({ ...d, destino: resp && d.destino !== 'equipe' ? 'responsavel' : d.destino }, lead, d.equipe);
          /* O resumo vai no cartao da oportunidade (lead.comercial), nao no contexto:
             ali ele aparecia duas vezes na mesma conversa. */
          bot.entregarParaEquipe(t.telefone, { departamento: d.equipe || 'humano', contexto: {} });
          if (r.protocolo) { try { proto.anotar(r.protocolo, { estado: proto.ESTADOS.NA_FILA, departamento: d.equipe || 'humano' }); } catch { /* protocolo e complemento */ } }
          crm.comercial(lead.id, { decisao: d, ...(quem ? { responsavel: quem } : {}) });
          const cfgQ = qualif.config();
          texto = String(cfgQ.mensagemTransferencia || qualif.MENSAGEM_PADRAO).replace(/\{equipe\}/g, d.destino === 'tier' ? 'comercial' : (d.equipe || 'de atendimento')).replace(/\{vendedor\}/g, quem?.nome || 'um vendedor');
          r.handoff = true; r.tipo = 'qualificacao:transferir'; r.produtos = null; r.imagem = null;
          // O "nao entendi" que a transferencia substituiu nao conta como falha do bot.
          falhas.set(chave, 0);
          roteamento = { quando: 'mensagem', decisao: d, responsavel: quem };
        } else if (d.tier === 1) {
          /* COLETAR O MINIMO: sem porte e sem saber se e sob medida, a matriz
             nao tem o que decidir — tudo cairia no bot por falta de dado. O bot
             faz UMA pergunta, junto da resposta dele. */
          const cfgQ = qualif.config();
          if (qualif.precisaPerguntar(ficha, cfgQ) && texto && !r.cobranca) {
            texto = `${texto}\n\n${cfgQ.perguntar.texto}`;
            crm.comercial(lead.id, { decisao: d, ficha: { ...ficha, perguntouEm: new Date().toISOString() } });
          } else {
            crm.comercial(lead.id, { decisao: d });
          }
        }
      }
    } catch (e) { console.error(`[qualificacao] roteamento falhou, segue o bot: ${e.message}`); }
  }

  /* PAGAMENTO. O bot pediu a cobrança; quem tem rede é este módulo. A cobrança
     acontece ANTES do envio de propósito: mandar "segue o link" e só depois
     descobrir que o gateway recusou deixaria o cliente esperando um link que
     nunca vem. Se falhar, ele ouve a verdade e o pedido não se perde. */
  let cobranca = null;
  if (r.cobranca) {
    const criar = deps.cobrar || pagamentos.cobrar;
    const c = await criar({
      valorCentavos: r.cobranca.valorCentavos,
      metodo: 'PIX',
      descricao: r.cobranca.descricao,
      referencia: r.cobranca.referencia,
      nome: msg.nome || lead?.nome || undefined,
      webhookUrl: process.env.VS_URL_WEBHOOK_PAGAMENTO || undefined,
    });
    /* Ter FORMA DE PAGAR e o que importa, nao ter link. Exigir link descartava
       uma cobranca Pix que veio so com QR e anunciava "nao consegui gerar o
       link" com o QR na mao — o cliente pagaria na entrega sem precisar. */
    if (c?.ok && (c.pagamento?.linkPagamento || c.pagamento?.pix?.payload)) {
      cobranca = c.pagamento;
      /* O ELO conversa -> pedido -> pagamento. E so aqui que se sabe as tres
         coisas juntas; e sem este registro nenhuma venda poderia ser atribuida
         ao canal com prova. */
      resultados.registrarPedido({ referencia: r.cobranca.referencia, pagamentoId: c.pagamento.id, telefone: t.telefone,
        endereco: msg.endereco || null, canal, valorCentavos: c.pagamento.valorCentavos, nome: msg.nome || lead?.nome || null, itens: r.cobranca.itens });
      /* NUMERO DO PEDIDO na mensagem. Sem ele o cliente nao tem como cobrar
         nada depois — "meu pedido" nao identifica pedido nenhum, e quem atende
         fica perguntando telefone e horario pra achar. E o mesmo numero que vai
         na referencia da cobranca, entao o extrato e a conversa batem. */
      const pix = c.pagamento.pix?.payload;
      texto = [
        texto,
        `Pedido *${r.cobranca.referencia}*`,
        `Total: ${emReais(c.pagamento.valorCentavos)}`,
        '',
        /* Pix com QR: o codigo copia-e-cola vai NA CONVERSA. O cliente segura o
           dedo, copia e paga no banco dele sem sair do WhatsApp. Mandar so link
           quando existe copia-e-cola e jogar fora o melhor do Pix. */
        pix ? 'Copia e cola no seu banco:' : `Paga por aqui: ${c.pagamento.linkPagamento}`,
        pix || null,
        '',
        'Assim que o pagamento cair eu te aviso por aqui. 👍',
      ].filter((l) => l !== null && l !== undefined).join('\n');
    } else {
      /* O pedido NÃO vira fumaça porque o gateway falhou: entrega segue, o
         pagamento fica pra entrega. É o que o dono faria no balcão. */
      console.error(`[pagamento] nao consegui gerar o link de ${r.cobranca.referencia}: ${c?.motivo || 'motivo nao informado'}`);
      // Pedido sem cobranca: conta como pedido, nunca como receita (nao ha pagamento pra comprovar).
      resultados.registrarPedido({ referencia: r.cobranca.referencia, pagamentoId: null, telefone: t.telefone,
        endereco: msg.endereco || null, canal, valorCentavos: r.cobranca.valorCentavos, nome: msg.nome || lead?.nome || null, itens: r.cobranca.itens });
      texto = [texto, `Pedido *${r.cobranca.referencia}*`, `Total: ${emReais(r.cobranca.valorCentavos)}`, '',
        'Não consegui gerar o link de pagamento agora — pode pagar na entrega, combinado?'].filter(Boolean).join('\n');
    }
  }

  /* FOTO DO PASSO: imagem + texto num balão só (o texto vira a legenda). O
     WhatsApp corta legenda acima de 1024 caracteres, então texto longo vai logo
     depois da foto. Se a foto não carregar ou não sair, o TEXTO sai do mesmo
     jeito — foto é enfeite, a resposta não pode depender dela. */
  /* CARDS do cardapio: uma foto por produto, com nome, preco e a tecla pra
     pedir na legenda. Vao ANTES do menu em texto: o cliente ve o lanche e
     responde o numero. Foto que nao sai nao trava nada — o menu vem logo
     depois com tudo que ela diria. */
  if (r.cartoes?.length && deps.enviarImagem) {
    for (const c of r.cartoes) {
      const dataUri = await bot.midiaComoDataUri(c.imagem);
      if (!dataUri) { console.warn(`[bot] foto de "${c.nome}" nao carregou — fica so no menu`); continue; }
      const legenda = [`*${c.tecla} - ${c.nome}* — ${c.preco}`, c.descricao].filter(Boolean).join('\n');
      const img = await deps.enviarImagem({ phone: t.telefone, dataUri, legenda, nome: String(c.imagem).split('/').pop() });
      if (!img?.ok) { console.warn(`[bot] o card de "${c.nome}" nao saiu (${img?.erro || '?'})`); }
    }
  }

  let envio = null;
  if (r.imagem && deps.enviarImagem && !cobranca) {
    const dataUri = await bot.midiaComoDataUri(r.imagem);
    if (!dataUri) { console.warn(`[bot] imagem "${r.imagem}" do passo nao carregou — mando so o texto`); }
    else {
      const junto = texto.length <= LEGENDA_MAX;
      const img = await deps.enviarImagem({ phone: t.telefone, dataUri, legenda: junto ? texto : '', nome: String(r.imagem).split('/').pop() });
      if (img?.ok && junto) { envio = img; }
      else if (!img?.ok) { console.warn(`[bot] a imagem "${r.imagem}" nao saiu (${img?.erro || '?'}) — mando so o texto`); }
    }
  }
  if (!envio) { envio = await enviar({ phone: t.telefone, texto }); }
  // Só registra a saída se saiu mesmo (ver cabeçalho do arquivo).
  if (lead && envio.ok) {
    crm.interagir(lead.id, { canal, direcao: 'saida', texto, autor: 'bot' });
  }

  /* O QR do Pix vai como IMAGEM, depois do texto.
     O copia-e-cola resolve pra quem paga no mesmo aparelho; quem paga com OUTRO
     celular precisa apontar a câmera pra alguma coisa. Sem a imagem, o QR
     simplesmente não existe pro cliente — e QR é como a maioria paga.
     Vai DEPOIS de propósito: se a imagem falhar, o cliente ainda tem o código
     colável na mensagem anterior, em vez de ficar sem nada. */
  let qr = null;
  if (cobranca?.pix?.imagemBase64 && deps.enviarImagem) {
    const img = qr = await deps.enviarImagem({
      phone: t.telefone,
      dataUri: `data:image/png;base64,${cobranca.pix.imagemBase64}`,
      legenda: `Pedido ${r.cobranca.referencia} — ${emReais(cobranca.valorCentavos)}`,
      nome: `pix-${r.cobranca.referencia}.png`,
    });
    if (!img?.ok) {
      console.error(`[pagamento] o QR de ${r.cobranca.referencia} nao foi enviado: ${img?.erro || 'motivo nao informado'}`);
    }
  }

  if (alerta) { await alerta; }

  /* Pix gerado: entra na vigia. Pago, o QR e o copia-e-cola somem da conversa
     e sai o "pagamento recebido" (ver vigia-pix.mjs). */
  if (cobranca && deps.vigiarPix) {
    deps.vigiarPix({
      pagamentoId: cobranca.id,
      referencia: r.cobranca.referencia,
      para: msg.endereco || t.telefone,
      de: t.telefone,
      mensagens: [envio?.id, qr?.id].filter(Boolean),
      itens: r.cobranca.itens || [],
      totalCentavos: cobranca.valorCentavos,
    });
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
    ...(cobranca ? { cobranca: { id: cobranca.id, valorCentavos: cobranca.valorCentavos, linkPagamento: cobranca.linkPagamento } } : {}),
    ...(r.cobrancaImpossivel ? { cobrancaImpossivel: r.cobrancaImpossivel } : {}),
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
