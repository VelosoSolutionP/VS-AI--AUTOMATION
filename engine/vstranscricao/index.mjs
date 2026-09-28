/**
 * Áudio vira texto — IA LOCAL e gratuita (whisper.cpp), igual o Ollama: nada
 * sai da máquina, nada é pago por mensagem.
 *
 * Por que existe: quem trabalha no campo, na oficina ou dirigindo não digita,
 * manda áudio. Antes, áudio chegava como "(sem texto)" e a Micaela não
 * respondia nada — o cliente falava e ninguém ouvia.
 *
 * O texto transcrito entra no atendimento como se o cliente tivesse digitado:
 * a resposta continua sendo o texto da loja (o fluxo), então a IA não inventa
 * nada — ela só escuta.
 *
 * Falhou, demorou ou o servidor está fora? Devolve null e o atendimento segue
 * como antes. Escutar ajuda; nunca trava.
 *
 * O servidor: backend/subir-transcricao.sh (whisper-server em 127.0.0.1:8178,
 * modelo base, português, --convert pra aceitar o ogg/opus do WhatsApp).
 */
export const PADRAO_TRANSCRICAO = Object.freeze({
  ligado: true,
  url: 'http://127.0.0.1:8178',
  timeoutMs: 45000,
  maxBytes: 8 * 1024 * 1024,
});

const config = () => ({
  ...PADRAO_TRANSCRICAO,
  ...(process.env.TRANSCRICAO_URL ? { url: process.env.TRANSCRICAO_URL } : {}),
  ...(process.env.TRANSCRICAO_DESLIGADA === '1' ? { ligado: false } : {}),
});

/* O whisper escreve [Música], (risos), [BLANK_AUDIO] quando não há fala. Isso
   não é o cliente falando — é silêncio com legenda. */
const RUIDO = /^\s*[[(][^\])]*[\])]\s*$/;
export function limpar(t) {
  const s = String(t || '').replace(/\[BLANK_AUDIO\]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!s || RUIDO.test(s) || s.length < 2) { return ''; }
  return s;
}

/**
 * @param {Buffer|Uint8Array} audio  o arquivo como veio do canal (ogg/opus, mp3, m4a…)
 * @returns {Promise<{texto:string|null, ms:number, erro?:string}>}
 */
export async function transcrever(audio, { mime = 'audio/ogg', nome = 'audio.ogg', cfg = {}, fetch: f = globalThis.fetch } = {}) {
  const c = { ...config(), ...cfg };
  const inicio = Date.now();
  if (!c.ligado) { return { texto: null, ms: 0, erro: 'transcrição desligada' }; }
  const buf = audio ? Buffer.from(audio) : null;
  if (!buf || !buf.length) { return { texto: null, ms: 0, erro: 'áudio vazio' }; }
  if (buf.length > c.maxBytes) { return { texto: null, ms: 0, erro: `áudio grande demais (${Math.round(buf.length / 1024)} KB)` }; }
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), nome);
    fd.append('response_format', 'json');
    fd.append('language', 'pt');
    const r = await f(`${c.url}/inference`, { method: 'POST', body: fd, signal: ctrl.signal });
    if (!r.ok) { return { texto: null, ms: Date.now() - inicio, erro: `servidor de transcrição respondeu HTTP ${r.status}` }; }
    const j = await r.json().catch(() => ({}));
    const texto = limpar(j.text);
    return { texto: texto || null, ms: Date.now() - inicio, ...(texto ? {} : { erro: 'nenhuma fala reconhecida no áudio' }) };
  } catch (e) {
    return { texto: null, ms: Date.now() - inicio, erro: e.name === 'AbortError' ? `demorou mais de ${c.timeoutMs} ms` : (e.cause?.code === 'ECONNREFUSED' ? 'servidor de transcrição fora do ar' : e.message) };
  } finally {
    clearTimeout(relogio);
  }
}

/** O servidor está de pé? (pra tela de integrações e pro log de subida) */
export async function saude({ fetch: f = globalThis.fetch } = {}) {
  const c = config();
  if (!c.ligado) { return { ok: false, motivo: 'desligada' }; }
  try { const r = await f(c.url + '/', { signal: AbortSignal.timeout(3000) }); return { ok: r.status < 500 }; }
  catch { return { ok: false, motivo: 'servidor de transcrição fora do ar' }; }
}
