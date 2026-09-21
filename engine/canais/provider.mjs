/**
 * IChannelProvider — o contrato de TODO canal (WhatsApp Web, Cloud, Instagram,
 * TikTok, o que vier).
 *
 * A REGRA DESTE ARQUIVO, e ela vale pra qualquer provider novo:
 * aqui só existe capacidade de CANAL. Conectar, mostrar QR, enviar, receber,
 * dizer se está de pé. Nenhuma linha sobre lead, cliente, pedido, carrinho,
 * ticket, fila, departamento, auditoria ou bot — isso é domínio, mora do outro
 * lado do gateway.
 *
 * O motivo é concreto: hoje o canal é WhatsApp Web porque a conta da Meta está
 * travada. Quando destravar, trocar `WhatsAppWebProvider` por
 * `WhatsAppCloudProvider` tem de ser troca de UMA linha no registro — sem
 * encostar em CRM, conversa, cliente, fila, bot ou trilha. Se algum dia der
 * vontade de "só dar um jeitinho" e ler um lead aqui dentro, é essa troca que
 * deixa de ser possível.
 */

/** Estados possíveis de uma sessão de canal. Quem desenha a tela usa isto. */
export const ESTADOS = Object.freeze({
  DESCONECTADO: 'desconectado',
  AGUARDANDO_QR: 'aguardando_qr',
  CONECTANDO: 'conectando',
  CONECTADO: 'conectado',
  CAIDO: 'caido',
});

/** Métodos que todo provider precisa ter. O teste de contrato roda em cima disto. */
export const CONTRATO = Object.freeze([
  'conectar',       // (opcoes) -> Promise<{estado, qr?}>
  'desconectar',    // () -> Promise<void>
  'status',         // () -> {estado, numero, desde, ultimaAtividade, qr, provider, oficial}
  'saude',          // () -> Promise<{ok, detalhe}>
  'enviarTexto',    // ({para, texto}) -> Promise<{ok, id?, erro?}>
  'aoReceber',      // (fn) -> void   — assina mensagem normalizada
  'aoMudarStatus',  // (fn) -> void
]);

/**
 * Confere se um objeto cumpre o contrato. Roda no registro: provider capenga
 * falha na hora de registrar, não na primeira mensagem do cliente.
 */
export function validarProvider(p) {
  if (!p || typeof p !== 'object') { return { ok: false, erro: 'provider não é objeto' }; }
  if (!p.nome) { return { ok: false, erro: 'provider sem nome' }; }
  if (typeof p.oficial !== 'boolean') {
    return { ok: false, erro: `${p.nome}: falta "oficial" (true/false) — a tela precisa avisar quando o canal não é API oficial` };
  }
  const faltando = CONTRATO.filter((m) => typeof p[m] !== 'function');
  if (faltando.length) { return { ok: false, erro: `${p.nome}: falta ${faltando.join(', ')}` }; }
  return { ok: true };
}

/**
 * Formato canônico da mensagem. É o ÚNICO formato que atravessa o gateway —
 * o domínio nunca vê envelope de Meta, de Twilio nem de WhatsApp Web.
 *
 * @typedef {object} MensagemCanal
 * @property {string}  id        id da mensagem no canal (trava de reentrega)
 * @property {string}  de        telefone/identificador de quem falou, só dígitos
 * @property {string?} nome      nome de perfil, quando o canal informa
 * @property {string}  tipo      text | audio | image | video | document | outro
 * @property {string}  texto     vazio quando não é texto
 * @property {string}  quando    ISO
 * @property {string}  canal     nome do provider que trouxe
 */

/** Molde vazio — evita que cada provider invente um formato meio parecido. */
export function mensagem({ id, de, nome = null, tipo = 'text', texto = '', quando, canal }) {
  return {
    id: String(id || ''),
    de: String(de || '').replace(/\D/g, ''),
    nome: nome || null,
    tipo: tipo || 'text',
    texto: String(texto || ''),
    quando: quando || new Date().toISOString(),
    canal: canal || 'desconhecido',
  };
}
