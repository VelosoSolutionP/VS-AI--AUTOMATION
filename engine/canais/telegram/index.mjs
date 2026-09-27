/**
 * Provider do Telegram — Bot API oficial (https://core.telegram.org/bots/api).
 *
 * Só capacidade de CANAL, como manda o contrato em ../provider.mjs: conectar,
 * receber, enviar, dizer se está de pé. Lead, bot, fila e trilha moram do outro
 * lado do gateway.
 *
 * Recebe por LONG POLLING (getUpdates), não por webhook. Três motivos:
 *  - não precisa de endereço público nem de certificado: funciona igual atrás
 *    do túnel, na máquina do cliente ou num notebook;
 *  - não existe segredo de webhook pra configurar e esquecer;
 *  - se o painel cair, o Telegram GUARDA as mensagens (até 24h) e entrega
 *    quando ele voltar — nada se perde no reinício.
 *
 * IDENTIDADE. O resto do sistema identifica a pessoa por TELEFONE (lead, fila,
 * protocolo, conversa do bot). O Telegram não entrega telefone, entrega o id da
 * conversa. Em vez de reescrever o domínio, o id vira um "telefone" numa faixa
 * que telefone nenhum usa: 999 + id com 12 dígitos. 999 não é código de país
 * (a UIT deixa reservado), e o tamanho fixo de 15 dígitos impede que um id
 * curto caia na regra de "10 ou 11 dígitos = celular brasileiro" e ganhe um 55
 * na frente. Ver `idTelegram` / `chatDoId`.
 */
import { ESTADOS, mensagem } from '../provider.mjs';

export const PREFIXO = '999';

/** Id de conversa do Telegram -> identidade no formato de telefone do sistema. */
export function idTelegram(chatId) {
  const n = String(chatId ?? '').replace(/\D/g, '');
  return n ? PREFIXO + n.padStart(12, '0') : '';
}

/** O caminho de volta: identidade (ou id cru) -> chat_id que a API aceita. */
export function chatDoId(para) {
  const d = String(para ?? '').replace(/\D/g, '');
  if (ehTelegram(d)) { return String(Number(d.slice(PREFIXO.length))); }
  return d;
}

export function ehTelegram(tel) {
  return /^999\d{12}$/.test(String(tel ?? '').replace(/\D/g, ''));
}

/** Token do @BotFather: "<numero>:<35 caracteres>". Conferir a forma evita uma ida à rede à toa. */
export function tokenValido(t) {
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(t || '').trim());
}

/**
 * O bot escreve no estilo do WhatsApp (*negrito*, _itálico_, ~riscado~). No
 * Telegram o asterisco apareceria cru, então vira HTML — escapando antes, pra
 * que um "<" no nome do produto não quebre a mensagem inteira.
 */
export function paraHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, '$1<i>$2</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

/** O Telegram recusa texto acima de 4096 caracteres: quebra em parágrafos, sem cortar palavra. */
export function fatiar(texto, max = 4000) {
  const t = String(texto ?? '');
  if (t.length <= max) { return [t]; }
  const partes = [];
  let resto = t;
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.5) { corte = resto.lastIndexOf(' ', max); }
    if (corte < max * 0.5) { corte = max; }
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\s+/, '');
  }
  if (resto) { partes.push(resto); }
  return partes;
}

/** Tipo canônico a partir da mensagem do Telegram. */
function tipoDe(m) {
  if (typeof m.text === 'string') { return 'text'; }
  if (m.photo) { return 'image'; }
  if (m.voice || m.audio) { return 'audio'; }
  if (m.video || m.video_note) { return 'video'; }
  if (m.document) { return 'document'; }
  return 'outro';
}

/**
 * Update do Telegram -> mensagem canônica. Função pura; devolve null pro que
 * não é conversa com cliente (grupo, canal, edição, bot).
 */
export function normalizarUpdate(u) {
  const m = u?.message;
  if (!m || !m.chat) { return null; }
  // Grupo e canal ficam de fora: atendimento é conversa de um pra um.
  if (m.chat.type !== 'private') { return null; }
  if (m.from?.is_bot) { return null; }
  const tipo = tipoDe(m);
  let texto = tipo === 'text' ? m.text : '';
  /* Todo mundo chega no bot do Telegram apertando "Começar", que manda /start.
     Pro bot isso e um "oi" — sem traduzir, a primeira coisa que o cliente veria
     seria "nao entendi". O que vem depois do /start e o codigo do link
     (t.me/bot?start=promo-sexta): e ele que diz de qual campanha a pessoa veio. */
  let ref = null;
  const start = /^\/start(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/.exec(texto);
  if (start || /^\/start(\s|$)/.test(texto)) { ref = start?.[1] || null; texto = 'Olá'; }
  const nome = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || null;
  const id = idTelegram(m.chat.id);
  return mensagem({
    id: `${m.chat.id}:${m.message_id}`,
    de: id,
    endereco: id,
    nome,
    tipo,
    texto,
    quando: m.date ? new Date(m.date * 1000).toISOString() : undefined,
    canal: 'telegram',
    ref,
  });
}

function dataUriParaBlob(dataUri) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUri || ''));
  if (!m) { return null; }
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

/**
 * O bot pode PUBLICAR aqui? Canal: precisa ser administrador com
 * "publicar mensagens". Grupo: ser membro/admin sem restricao de envio.
 */
export function podePublicarCom(tipo, m = {}) {
  if (['left', 'kicked'].includes(m.status) || !m.status) { return false; }
  if (tipo === 'channel') { return m.status === 'creator' || (m.status === 'administrator' && m.can_post_messages === true); }
  if (m.status === 'restricted') { return m.can_send_messages === true; }
  return ['member', 'administrator', 'creator'].includes(m.status);
}

export function criarTelegramProvider({ fetchImpl = globalThis.fetch, api = 'https://api.telegram.org', esperaMs = 25, espera = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let token = null;
  let estado = ESTADOS.DESCONECTADO;
  let bot = null;
  let desde = null;
  let ultimaAtividade = null;
  let ultimoErro = null;
  let rodando = false;
  let offset = 0;
  let ctrl = null;
  let volta = null;
  const aoMsg = [];
  const aoSt = [];
  const aoMembro = [];

  const status = () => ({
    estado,
    numero: bot?.username ? '@' + bot.username : null,
    nomeBot: bot?.first_name || null,
    link: bot?.username ? `https://t.me/${bot.username}` : null,
    desde,
    ultimaAtividade,
    ultimoErro,
    qr: null,
    provider: 'telegram-bot-api',
    oficial: true,
  });

  function mudar(novo, erro = null) {
    const antes = estado;
    estado = novo;
    ultimoErro = erro;
    if (antes !== novo || erro) { for (const fn of aoSt) { try { fn(status()); } catch { /* ouvinte quebrado nao derruba o canal */ } } }
  }

  /** Chamada à API. Erro do Telegram vira exceção com o código dele (401 = token, 409 = conflito). */
  async function chamar(metodo, corpo, { sinal, multipart } = {}) {
    const url = `${api}/bot${token}/${metodo}`;
    const r = multipart
      ? await fetchImpl(url, { method: 'POST', body: multipart, signal: sinal })
      : await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo || {}), signal: sinal });
    const j = await r.json().catch(() => ({ ok: false, description: `resposta fora do formato (HTTP ${r.status})` }));
    if (!j.ok) {
      const e = new Error(j.description || `HTTP ${r.status}`);
      e.codigo = j.error_code || r.status;
      e.depois = j.parameters?.retry_after || null;
      throw e;
    }
    return j.result;
  }

  /** Por que caiu, em português de quem vai consertar. */
  function explicar(e) {
    if (e.codigo === 401) { return 'o Telegram recusou o token — confira no @BotFather (ou gere outro com /token)'; }
    if (e.codigo === 409) { return 'outro programa está lendo este mesmo bot (webhook ou outra instalação) — só um pode ficar ligado'; }
    if (e.name === 'TypeError' || /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT/i.test(e.message)) { return 'sem conexão com o Telegram (internet da máquina)'; }
    return e.message;
  }

  async function ouvir() {
    let falhas = 0;
    while (rodando) {
      try {
        ctrl = new AbortController();
        const ups = await chamar('getUpdates', { offset, timeout: esperaMs, allowed_updates: ['message', 'my_chat_member'] }, { sinal: ctrl.signal });
        falhas = 0;
        if (estado !== ESTADOS.CONECTADO) { mudar(ESTADOS.CONECTADO); }
        for (const u of ups || []) {
          offset = u.update_id + 1;
          /* O bot entrou/saiu de um canal ou grupo, ou mudou de permissao: e
             assim que o Bolso Cheio descobre os DESTINOS de publicacao (a Bot
             API nao lista os canais em que o bot esta). */
          if (u.my_chat_member) {
            const m = u.my_chat_member; const nm = m.new_chat_member || {};
            const ev = { chat: { id: m.chat?.id, titulo: m.chat?.title || m.chat?.username || null, tipo: m.chat?.type, username: m.chat?.username || null },
              status: nm.status, podePublicar: podePublicarCom(m.chat?.type, nm), por: m.from ? { id: m.from.id, nome: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username || null } : null, quando: new Date((m.date || 0) * 1000 || Date.now()).toISOString() };
            for (const fn of aoMembro) { try { await fn(ev); } catch (e) { console.error(`[telegram] quem recebe mudanca de membro quebrou: ${e.message}`); } }
            continue;
          }
          const msg = normalizarUpdate(u);
          if (!msg) { continue; }
          ultimaAtividade = new Date().toISOString();
          for (const fn of aoMsg) {
            try { await fn(msg); } catch (e) { console.error(`[telegram] quem recebe a mensagem quebrou: ${e.message}`); }
          }
        }
      } catch (e) {
        if (!rodando) { break; }
        if (e.codigo === 401) { rodando = false; mudar(ESTADOS.DESCONECTADO, explicar(e)); break; }
        falhas += 1;
        mudar(ESTADOS.CAIDO, explicar(e));
        // Espera crescente, com teto: rede que piscou volta sozinha, sem martelar a API.
        await espera(e.depois ? e.depois * 1000 : Math.min(30000, 1000 * 2 ** Math.min(falhas, 5)));
      }
    }
  }

  return {
    nome: 'telegram',
    oficial: true,

    async conectar({ token: novo } = {}) {
      if (novo !== undefined) { token = String(novo || '').trim(); }
      if (!token) { mudar(ESTADOS.DESCONECTADO, 'falta o token do bot'); return { ...status(), ok: false, erro: 'falta o token do bot' }; }
      if (!tokenValido(token)) {
        mudar(ESTADOS.DESCONECTADO, 'token fora do formato');
        return { ...status(), ok: false, erro: 'esse token não tem a forma de um token do @BotFather (números, dois-pontos e um código longo)' };
      }
      if (rodando) { return { ...status(), ok: true }; }
      mudar(ESTADOS.CONECTANDO);
      try {
        bot = await chamar('getMe');
        /* Webhook ligado bloqueia o getUpdates (409). Tirar o webhook NAO apaga
           as mensagens pendentes: elas chegam na primeira leitura. */
        await chamar('deleteWebhook', { drop_pending_updates: false });
      } catch (e) {
        const motivo = explicar(e);
        mudar(e.codigo === 401 ? ESTADOS.DESCONECTADO : ESTADOS.CAIDO, motivo);
        return { ...status(), ok: false, erro: motivo };
      }
      desde = new Date().toISOString();
      rodando = true;
      mudar(ESTADOS.CONECTADO);
      volta = ouvir();
      return { ...status(), ok: true };
    },

    async desconectar() {
      rodando = false;
      try { ctrl?.abort(); } catch { /* ja parou */ }
      await volta?.catch(() => {});
      volta = null;
      mudar(ESTADOS.DESCONECTADO);
    },

    status,

    async saude() {
      if (estado !== ESTADOS.CONECTADO) { return { ok: false, detalhe: ultimoErro || estado }; }
      try { await chamar('getMe'); return { ok: true, detalhe: status().numero }; } catch (e) { return { ok: false, detalhe: explicar(e) }; }
    },

    async enviarTexto({ para, texto }) {
      if (!token || !bot) { return { ok: false, erro: 'o Telegram não está conectado' }; }
      const chat_id = chatDoId(para);
      if (!chat_id) { return { ok: false, erro: 'conversa do Telegram sem identificador' }; }
      let ultimo = null;
      try {
        for (const parte of fatiar(texto)) {
          try {
            ultimo = await chamar('sendMessage', { chat_id, text: paraHtml(parte), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
          } catch (e) {
            // Formatação que o Telegram não entendeu não pode calar a resposta: vai sem formatação.
            if (e.codigo !== 400 || !/parse|entit/i.test(e.message)) { throw e; }
            ultimo = await chamar('sendMessage', { chat_id, text: parte });
          }
        }
        ultimaAtividade = new Date().toISOString();
        return { ok: true, id: ultimo ? `${chat_id}:${ultimo.message_id}` : null };
      } catch (e) {
        if (e.codigo === 403) { return { ok: false, erro: 'a pessoa bloqueou o bot ou nunca apertou "Começar"' }; }
        return { ok: false, erro: explicar(e) };
      }
    },

    /** Foto com legenda (cardápio, QR do Pix). Legenda acima de 1024 o Telegram recusa. */
    async enviarImagem({ para, dataUri, legenda, nome }) {
      if (!token || !bot) { return { ok: false, erro: 'o Telegram não está conectado' }; }
      const blob = dataUriParaBlob(dataUri);
      if (!blob) { return { ok: false, erro: 'imagem fora do formato' }; }
      const fd = new FormData();
      fd.append('chat_id', chatDoId(para));
      fd.append('photo', blob, nome || 'imagem.png');
      if (legenda) { fd.append('caption', paraHtml(String(legenda).slice(0, 1024))); fd.append('parse_mode', 'HTML'); }
      try {
        const r = await chamar('sendPhoto', null, { multipart: fd });
        return { ok: true, id: `${chatDoId(para)}:${r.message_id}` };
      } catch (e) { return { ok: false, erro: explicar(e) }; }
    },

    /** Documento (contrato em PDF). */
    async enviarArquivo({ para, dataUri, nome, legenda }) {
      if (!token || !bot) { return { ok: false, erro: 'o Telegram não está conectado' }; }
      const blob = dataUriParaBlob(dataUri);
      if (!blob) { return { ok: false, erro: 'arquivo fora do formato' }; }
      const fd = new FormData();
      fd.append('chat_id', chatDoId(para));
      fd.append('document', blob, nome || 'arquivo');
      if (legenda) { fd.append('caption', String(legenda).slice(0, 1024)); }
      try {
        const r = await chamar('sendDocument', null, { multipart: fd });
        return { ok: true, id: `${chatDoId(para)}:${r.message_id}` };
      } catch (e) { return { ok: false, erro: explicar(e) }; }
    },

    /** Apaga uma mensagem que o bot mandou (o QR do Pix depois de pago). `id` = "chat:mensagem". */
    async apagarMensagem({ para, id }) {
      if (!token || !bot) { return { ok: false, erro: 'o Telegram não está conectado' }; }
      const [chat, msgId] = String(id || '').split(':');
      try { await chamar('deleteMessage', { chat_id: chat || chatDoId(para), message_id: Number(msgId) }); return { ok: true }; } catch (e) { return { ok: false, erro: explicar(e) }; }
    },

    /**
     * Consulta um canal/grupo (por @username ou id) e as permissoes do bot nele.
     * E o que valida um destino cadastrado a mao.
     */
    async consultarChat(ref) {
      if (!token || !bot) { return { ok: false, erro: 'o Telegram não está conectado' }; }
      const chat_id = /^-?\d+$/.test(String(ref).trim()) ? Number(String(ref).trim()) : '@' + String(ref).trim().replace(/^@|^https?:\/\/t\.me\//g, '');
      try {
        const c = await chamar('getChat', { chat_id });
        let membro = null;
        try { membro = await chamar('getChatMember', { chat_id: c.id, user_id: bot.id }); } catch { /* bot fora do chat */ }
        return { ok: true, chat: { id: c.id, titulo: c.title || c.username || null, tipo: c.type, username: c.username || null },
          status: membro?.status || 'fora', podePublicar: podePublicarCom(c.type, membro || {}) };
      } catch (e) {
        if (e.codigo === 400) { return { ok: false, erro: 'o Telegram não achou esse canal/grupo — confira o @ (ou adicione o bot nele primeiro)' }; }
        if (e.codigo === 403) { return { ok: false, erro: 'o bot não tem acesso a esse canal/grupo — adicione o bot nele primeiro' }; }
        return { ok: false, erro: explicar(e) };
      }
    },

    /**
     * Publica num canal/grupo: foto com legenda (ou só texto) e um BOTAO de link
     * (o link rastreavel da campanha). Devolve o id da mensagem e, em canal
     * publico, o link da postagem.
     */
    async publicar({ chatId, texto, imagem, botao }) {
      if (!token || !bot) { return { ok: false, erro: 'o Telegram não está conectado' }; }
      const teclado = botao?.url ? { inline_keyboard: [[{ text: String(botao.texto || 'Abrir').slice(0, 64), url: botao.url }]] } : null;
      try {
        let r;
        if (imagem?.buffer || imagem?.url) {
          const fd = new FormData();
          fd.append('chat_id', String(chatId));
          if (imagem.buffer) { fd.append('photo', new Blob([imagem.buffer], { type: imagem.tipo || 'image/jpeg' }), imagem.nome || 'campanha.jpg'); } else { fd.append('photo', imagem.url); }
          if (texto) { fd.append('caption', paraHtml(String(texto).slice(0, 1024))); fd.append('parse_mode', 'HTML'); }
          if (teclado) { fd.append('reply_markup', JSON.stringify(teclado)); }
          r = await chamar('sendPhoto', null, { multipart: fd });
        } else {
          r = await chamar('sendMessage', { chat_id: chatId, text: paraHtml(String(texto || '').slice(0, 4096)), parse_mode: 'HTML', ...(teclado ? { reply_markup: teclado } : {}) });
        }
        const user = r.chat?.username;
        return { ok: true, mensagemId: r.message_id, link: user ? `https://t.me/${user}/${r.message_id}` : null };
      } catch (e) {
        if (e.codigo === 403) { return { ok: false, erro: 'o bot não tem permissão de publicar nesse destino (foi removido ou perdeu a permissão)' }; }
        if (e.codigo === 429) { return { ok: false, erro: `o Telegram pediu para esperar ${e.depois || '?'} s (limite de envio)`, depois: e.depois }; }
        return { ok: false, erro: explicar(e) };
      }
    },

    aoMembro(fn) { aoMembro.push(fn); },
    aoReceber(fn) { aoMsg.push(fn); },
    aoMudarStatus(fn) { aoSt.push(fn); },
  };
}
