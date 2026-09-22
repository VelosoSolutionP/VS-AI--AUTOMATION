/**
 * Tradutor do WhatsApp Web para o formato canônico. Função PURA — é o que
 * permite testar o canal inteiro sem abrir navegador nem escanear QR.
 */
import { mensagem } from '../provider.mjs';

const TIPOS = {
  chat: 'text',
  ptt: 'audio',
  audio: 'audio',
  image: 'image',
  video: 'video',
  document: 'document',
  sticker: 'image',
  location: 'outro',
  vcard: 'outro',
};

/**
 * Decide se uma mensagem do WhatsApp Web deve virar conversa.
 *
 * Fica de fora, e cada um por um motivo diferente:
 *  - `fromMe`: é a nossa própria resposta voltando pelo eco da sessão. Sem este
 *    filtro o bot responde a si mesmo em laço infinito — e cobra do cliente uma
 *    conversa que ele não teve.
 *  - grupo (`@g.us`): atendimento 1-a-1 não trata grupo, e entrar em grupo
 *    respondendo todo mundo é o jeito mais rápido de tomar banimento.
 *  - status/broadcast: não é alguém falando com a loja.
 *  - notificação de sistema (entrou no grupo, mudou o assunto, e2e): não é conversa.
 */
export function deveAtender(m) {
  if (!m || typeof m !== 'object') { return { ok: false, motivo: 'mensagem vazia' }; }
  if (m.fromMe) { return { ok: false, motivo: 'eco da propria resposta' }; }
  const de = String(m.from || '');
  if (!de) { return { ok: false, motivo: 'sem remetente' }; }
  if (de.endsWith('@g.us')) { return { ok: false, motivo: 'grupo' }; }
  if (de === 'status@broadcast' || de.endsWith('@broadcast')) { return { ok: false, motivo: 'status/broadcast' }; }
  if (m.isNotification || m.type === 'e2e_notification' || m.type === 'notification_template') {
    return { ok: false, motivo: 'notificacao de sistema' };
  }
  return { ok: true };
}

/** `5531975127978@c.us` -> `5531975127978`. */
export function soDigitos(jid) {
  return String(jid || '').split('@')[0].replace(/\D/g, '');
}

/**
 * O WhatsApp passou a entregar o remetente como LID (`...@lid`) em vez do
 * telefone — identidade que preserva o numero, comum em conta Business.
 *
 * O LID PARECE um telefone (so digito, 15 casas) e nao e: mandar resposta pra
 * ele e falar com o vazio. Foi exatamente o que aconteceu no primeiro teste
 * real — a mensagem do cliente entrou, o bot respondeu, e a resposta saiu pra um
 * numero que nao existe.
 */
export const ehLid = (jid) => String(jid || '').endsWith('@lid');

/** Telefone plausivel no Brasil: 12 ou 13 digitos com DDI 55, ou 10/11 sem. */
export function pareceTelefone(d) {
  const n = String(d || '').replace(/\D/g, '');
  if (n.startsWith('55')) { return n.length === 12 || n.length === 13; }
  return n.length === 10 || n.length === 11;
}

/**
 * Evento do WPPConnect -> MensagemCanal.
 *
 * Legenda de imagem/vídeo entra como texto de propósito: quem manda foto com
 * "quanto custa esse?" escreveu uma pergunta, e ignorá-la seria jogar fora a
 * única parte que o bot consegue responder.
 */
/**
 * Identidade de uma mensagem sem id: de quem, quando e o que veio.
 *
 * Nao e aleatoria — precisa repetir para a MESMA mensagem, senao a reentrega
 * do WhatsApp viraria atendimento em dobro.
 */
export function chaveSintetica(m = {}) {
  const de = String(m.from || m.chatId?._serialized || m.chatId || '?');
  const quando = String(m.t || m.timestamp || '0');
  const corpo = String(m.body || m.caption || m.type || '');
  let h = 0;
  for (let i = 0; i < corpo.length; i += 1) { h = ((h * 31) + corpo.charCodeAt(i)) | 0; }
  return `sem-id:${de}:${quando}:${(h >>> 0).toString(36)}`;
}

export function normalizar(m, canal = 'whatsapp-web') {
  const tipo = TIPOS[m.type] || 'outro';
  const texto = m.type === 'chat' ? (m.body || '') : (m.caption || '');
  return mensagem({
    /* O id e so pra nao responder duas vezes a MESMA mensagem. Quando o
       WhatsApp nao manda um — e ele as vezes nao manda, visto em producao com
       audio e com mensagem encaminhada — o codigo descartava a mensagem
       inteira, calado. Cliente ignorado por falta de um numero de controle
       NOSSO e o pior tipo de silencio: ele escreveu, chegou, e ninguem
       respondeu.

       Entao a gente monta um. Deterministico de proposito: a mesma mensagem
       reentregue gera a mesma chave e continua sendo barrada como duplicata. */
    id: m.id?.id || m.id || chaveSintetica(m),
    de: soDigitos(m.from),
    /* O jid cru, do jeito que o WhatsApp mandou — e pra ELE que se responde.
       Pode ser telefone@c.us ou LID@lid; o canal nao precisa saber qual, so
       precisa devolver a mensagem na mesma conversa. */
    endereco: m.from || null,
    nome: m.notifyName || m.sender?.pushname || m.sender?.name || null,
    tipo,
    texto,
    quando: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
    canal,
  });
}
