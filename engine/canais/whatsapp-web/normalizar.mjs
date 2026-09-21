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
 * Evento do WPPConnect -> MensagemCanal.
 *
 * Legenda de imagem/vídeo entra como texto de propósito: quem manda foto com
 * "quanto custa esse?" escreveu uma pergunta, e ignorá-la seria jogar fora a
 * única parte que o bot consegue responder.
 */
export function normalizar(m, canal = 'whatsapp-web') {
  const tipo = TIPOS[m.type] || 'outro';
  const texto = m.type === 'chat' ? (m.body || '') : (m.caption || '');
  return mensagem({
    id: m.id?.id || m.id || '',
    de: soDigitos(m.from),
    nome: m.notifyName || m.sender?.pushname || m.sender?.name || null,
    tipo,
    texto,
    quando: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
    canal,
  });
}
