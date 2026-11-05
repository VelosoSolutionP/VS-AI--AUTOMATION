/**
 * WhatsAppEvolutionProvider — canal do WhatsApp pela Evolution API (NÃO oficial,
 * Baileys por baixo). É o canal do SALÃO (20/10, dono: "Meta é só pro Bolso
 * Cheio; salão usa não-oficial"). Ocupa o mesmo contrato de ../provider.mjs, então
 * o domínio (conversa, fila, atendimento, bot) não sabe que é Evolution.
 *
 * Por que Evolution e não o wppconnect: cada número no Evolution é uma instância
 * leve (WebSocket, sem navegador) — um salão tem o número do dono + o do barbeiro
 * que só aluga a cadeira, e vários salões. wppconnect abriria um Chromium por
 * número (pesa); Evolution escala muito mais no mesmo servidor. UM provider = UMA
 * instância = UM número; vários números = vários providers (o salão orquestra).
 *
 * ENTRADA: webhook do Evolution (event 'messages.upsert') → receberEvento → mensagem
 * canônica. SAÍDA: POST /message/sendText|sendMedia. Conectar cria a instância e
 * devolve o QR; quando o aparelho lê, o estado vira 'open' = conectado.
 *
 * Não-oficial = risco de ban se abusar (massa/apitar demais). oficial:false pra a
 * tela sempre avisar. env/opcoes: baseUrl, apiKey, instance (nome da instância).
 */
import { ESTADOS, mensagem } from '../provider.mjs';

const agora = () => new Date().toISOString();
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
/* remoteJid vem "5531...@s.whatsapp.net" (pessoa) ou "...@g.us" (grupo, ignora). */
const ehGrupo = (jid) => String(jid || '').endsWith('@g.us');
const numeroDoJid = (jid) => soDigitos(String(jid || '').split('@')[0]).replace(/^0+/, '');

/* Estado do Evolution → estado do contrato. */
const MAPA_ESTADO = { open: ESTADOS.CONECTADO, connecting: ESTADOS.CONECTANDO, close: ESTADOS.DESCONECTADO };
/* Tipo da mensagem do Baileys → tipo canônico. */
function tipoDe(m) {
  if (m.conversation || m.extendedTextMessage) { return 'text'; }
  if (m.audioMessage) { return 'audio'; }
  if (m.imageMessage) { return 'image'; }
  if (m.videoMessage) { return 'video'; }
  if (m.documentMessage) { return 'document'; }
  if (m.buttonsResponseMessage || m.listResponseMessage || m.templateButtonReplyMessage) { return 'text'; }
  return 'outro';
}
function textoDe(m) {
  return m.conversation || m.extendedTextMessage?.text
    || m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title
    || m.templateButtonReplyMessage?.selectedDisplayText
    || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

export function criarWhatsAppEvolutionProvider(opcoes = {}) {
  /* Multi-empresa/salão: a casa do salão guarda baseUrl/apiKey/instance dele. */
  const ctx = () => (typeof opcoes.credenciais === 'function' ? opcoes.credenciais() : null);
  const baseUrl = () => String(ctx()?.baseUrl || opcoes.baseUrl || process.env.EVOLUTION_URL || '').replace(/\/$/, '');
  const apiKey = () => ctx()?.apiKey || opcoes.apiKey || process.env.EVOLUTION_KEY || '';
  const instancia = () => ctx()?.instance || opcoes.instance || process.env.EVOLUTION_INSTANCE || '';
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;
  const janelaMin = opcoes.janelaMinutos ?? 10;
  const nome = opcoes.nome || 'whatsapp-web';   // ocupa o lugar do "canal do WhatsApp"

  let estado = ESTADOS.DESCONECTADO;
  let numero = null; let desde = null; let ultimaAtividade = null; let ultimoErro = null; let qr = null;
  const ouvintesMsg = []; const ouvintesStatus = []; const vistos = new Set();

  const status = () => ({ provider: 'whatsapp-evolution', oficial: false, estado, numero, desde, ultimaAtividade, qr, ultimoErro, instancia: instancia() || null });
  const mudar = (novo) => { estado = novo; for (const fn of ouvintesStatus) { try { fn(status()); } catch (e) { console.error('[whatsapp-evolution] ouvinte de status quebrou:', e.message); } } };

  async function api(caminho, { method = 'GET', body } = {}) {
    if (!baseUrl() || !apiKey()) { throw new Error('EVOLUTION_URL/EVOLUTION_KEY ausentes'); }
    let r;
    try {
      r = await fetchImpl(`${baseUrl()}/${caminho}`, {
        method, headers: { apikey: apiKey(), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const codigo = e?.cause?.code || e?.code;
      throw new Error(
        `Evolution inacessível${codigo ? ` (${codigo})` : ''}. Confira URL, porta e acesso a partir do servidor do CRM.`,
        { cause: e },
      );
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detalhe = j?.message || j?.error;
      const contexto = r.status === 404
        ? 'Evolution não encontrou a rota ou a instância; confira a URL base e o nome da instância.'
        : '';
      throw new Error([
        `Evolution ${method} /${caminho}: HTTP ${r.status}`,
        detalhe,
        contexto,
      ].filter(Boolean).join(' — '));
    }
    return j;
  }

  /* Lê o estado remoto da instância e atualiza número/estado. Usado no conectar e
     num polling do servidor (o QR vira 'open' quando o aparelho lê). */
  async function sincronizar() {
    try {
      const j = await api(`instance/connectionState/${encodeURIComponent(instancia())}`);
      const st = j?.instance?.state || j?.state || 'close';
      if (st === 'open') {
        qr = null; if (!desde) { desde = agora(); } ultimoErro = null;
        try {
          const arr = await api(`instance/fetchInstances?instanceName=${encodeURIComponent(instancia())}`);
          const inst = Array.isArray(arr) ? (arr[0]?.instance || arr[0]) : (arr?.instance || arr);
          numero = numeroDoJid(inst?.owner || inst?.ownerJid || inst?.wuid) || numero;
        } catch { /* número é um luxo; o estado é o que importa */ }
      }
      /* 'connecting' com QR na mão = ainda esperando o aparelho ler — não rebaixa. */
      let alvo = MAPA_ESTADO[st];
      if (st === 'connecting' && qr) { alvo = ESTADOS.AGUARDANDO_QR; }
      if (alvo && alvo !== estado) { mudar(alvo); }
      return st;
    } catch (e) { ultimoErro = e.message; return null; }
  }

  async function conectar() {
    if (!baseUrl() || !apiKey() || !instancia()) { ultimoErro = 'baseUrl/apiKey/instance ausentes'; mudar(ESTADOS.CAIDO); return { ok: false, erro: ultimoErro, ...status() }; }
    qr = null; ultimoErro = null;
    mudar(ESTADOS.CONECTANDO);
    /* Cria a instância se ainda não existe (idempotente: já existir não é erro). */
    try { await api('instance/create', { method: 'POST', body: { instanceName: instancia(), integration: 'WHATSAPP-BAILEYS', qrcode: true } }); }
    catch (e) {
      if (!/already|exists|in use|forbidden|403|409/i.test(e.message)) {
        ultimoErro = e.message; mudar(ESTADOS.CAIDO);
        return { ok: false, erro: ultimoErro, ...status() };
      }
    }
    /* Pede a conexão → QR (ou já estava aberta). */
    try {
      const j = await api(`instance/connect/${encodeURIComponent(instancia())}`);
      const imagemQr = j?.base64 || j?.qrcode?.base64;
      qr = typeof imagemQr === 'string' && imagemQr
        ? (imagemQr.startsWith('data:image/') ? imagemQr : `data:image/png;base64,${imagemQr}`)
        : null;
      if (qr) { mudar(ESTADOS.AGUARDANDO_QR); }
    } catch (e) { ultimoErro = e.message; }
    const st = await sincronizar();
    if (st === 'open') { return { ok: true, ...status() }; }
    if (qr) { return { ok: true, qr, ...status() }; }
    mudar(ESTADOS.CAIDO);
    return { ok: false, erro: ultimoErro || 'Evolution não retornou a imagem do QR.', ...status() };
  }

  async function desconectar() {
    try { await api(`instance/logout/${encodeURIComponent(instancia())}`, { method: 'DELETE' }); } catch { /* já estava fora */ }
    qr = null; numero = null; desde = null; mudar(ESTADOS.DESCONECTADO);
  }

  async function saude() {
    try { const st = await sincronizar(); return { ok: st === 'open', detalhe: st === 'open' ? 'instância conectada' : `instância ${st || 'sem resposta'}`, estado }; }
    catch (e) { return { ok: false, detalhe: e.message }; }
  }

  const destino = (para) => soDigitos(String(para || '').split('@')[0]);
  async function mandar(caminho, corpo, para) {
    if (estado !== ESTADOS.CONECTADO) { return { ok: false, erro: `canal ${estado} — nada foi enviado` }; }
    const to = destino(para);
    if (to.length < 10) { return { ok: false, erro: `"${para}" não é um telefone válido` }; }
    try {
      const j = await api(`${caminho}/${encodeURIComponent(instancia())}`, { method: 'POST', body: { number: to, ...corpo } });
      ultimaAtividade = agora();
      return { ok: true, id: j?.key?.id || j?.messageId || null };
    } catch (e) {
      console.error(`[whatsapp-evolution] envio NAO saiu para ••••${to.slice(-4)}: ${e.message}`);
      return { ok: false, erro: e.message };
    }
  }
  async function enviarTexto({ para, texto }) { return mandar('message/sendText', { text: String(texto ?? '') }, para); }
  async function enviarMidia({ para, dataUri, nome: nomeArq, legenda, tipo }) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUri || ''));
    const media = m ? m[2] : String(dataUri || '');   // aceita base64 puro ou URL
    const mediatype = tipo === 'document' ? 'document' : tipo === 'video' ? 'video' : tipo === 'audio' ? 'audio' : 'image';
    return mandar('message/sendMedia', { mediatype, media, caption: legenda || undefined, fileName: nomeArq || undefined, mimetype: m ? m[1] : undefined }, para);
  }
  const enviarImagem = (o) => enviarMidia({ ...o, tipo: 'image' });
  const enviarArquivo = (o) => enviarMidia({ ...o, tipo: 'document' });
  async function atualizarFotoPerfil(dataUri) {
    if (estado !== ESTADOS.CONECTADO) { throw new Error(`WhatsApp do salão está ${estado}; conecte antes de trocar a foto.`); }
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUri || ''));
    if (!m) { throw new Error('Envie uma foto JPG, PNG ou WEBP válida.'); }
    await api(`chat/updateProfilePicture/${encodeURIComponent(instancia())}`, {
      method: 'POST',
      body: { picture: m[1] },
    });
    return { ok: true };
  }

  /**
   * Webhook do Evolution (event 'messages.upsert') → mensagens canônicas.
   * Aceita 1 evento ou o formato em lote. Devolve quantas passaram.
   */
  function receberEvento(evento, { agoraMs = Date.now() } = {}) {
    const itens = Array.isArray(evento) ? evento : [evento];
    let n = 0;
    for (const ev of itens) {
      const nomeEvento = String(ev?.event || '').toLowerCase().replaceAll('_', '.');
      if (nomeEvento && nomeEvento !== 'messages.upsert') { continue; }
      if (ev?.instance && instancia() && String(ev.instance) !== String(instancia())) {
        console.log(`[whatsapp-evolution] ignorada (evento de outra instância: ${ev.instance})`); continue;
      }
      const dados = Array.isArray(ev?.data) ? ev.data : [ev?.data].filter(Boolean);
      for (const d of dados) {
        const key = d?.key || {};
        if (key.fromMe) { continue; }                    // eco do que a gente mandou
        if (ehGrupo(key.remoteJid)) { continue; }        // salão é 1 a 1
        const id = key.id;
        if (!id || vistos.has(id)) { continue; }
        vistos.add(id); if (vistos.size > 2000) { vistos.delete(vistos.values().next().value); }
        const quando = Number(d.messageTimestamp || 0) * 1000;
        if (quando && (agoraMs - quando) / 60000 > janelaMin) {
          console.log(`[whatsapp-evolution] ignorada (mensagem de ${Math.round((agoraMs - quando) / 60000)} min atrás)`); continue;
        }
        const de = numeroDoJid(key.remoteJid);
        const c = mensagem({ id, de, endereco: de, nome: d.pushName || null, tipo: tipoDe(d.message || {}),
          texto: textoDe(d.message || {}), quando: new Date(quando || agoraMs).toISOString(), canal: nome });
        ultimaAtividade = agora(); n++;
        for (const fn of ouvintesMsg) { try { fn(c); } catch (e) { console.error('[whatsapp-evolution] ouvinte de mensagem quebrou:', e.message); } }
      }
    }
    return n;
  }

  return {
    nome, oficial: false,
    conectar, desconectar, status, saude, sincronizar,
    enviarTexto, enviarImagem, enviarArquivo, atualizarFotoPerfil,
    receberEvento,
    aoReceber: (fn) => { ouvintesMsg.push(fn); },
    aoMudarStatus: (fn) => { ouvintesStatus.push(fn); },
  };
}
