/**
 * E-mail de saída do Bolso Cheio — SMTP direto, sem dependência.
 *
 * Por que não uma biblioteca: é UM remetente (contato@), um tipo de mensagem
 * (texto + HTML) e TLS implícito na 465. Um cliente de 100 linhas cobre isso, e
 * cada dependência nova é mais uma coisa pra atualizar num servidor que roda
 * sozinho.
 *
 * Config por ambiente (painel.env), nunca no código:
 *   SMTP_HOST (padrão smtp.zoho.com) · SMTP_PORT (465) · SMTP_USER · SMTP_PASS
 *   SMTP_FROM (padrão = SMTP_USER) · SMTP_NOME (padrão "Bolso Cheio")
 */
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

export const configurado = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
/* Cabeçalho com acento precisa ir codificado (RFC 2047), senão chega "SolicitaÃ§Ã£o". */
const cab = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** Conversa SMTP linha a linha: manda, espera o código, segue. */
function sessao(sock) {
  let buf = '';
  const fila = [];
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    // resposta completa = linha "NNN " (com espaço) no fim
    while ((i = buf.search(/^\d{3} .*\r?\n/m)) >= 0) {
      const fim = buf.indexOf('\n', i) + 1;
      const resp = buf.slice(0, fim);
      buf = buf.slice(fim);
      const f = fila.shift();
      if (f) { f(resp); }
    }
  });
  const esperar = () => new Promise((ok) => fila.push(ok));
  async function cmd(linha, espera) {
    if (linha != null) { sock.write(linha + '\r\n'); }
    const r = await esperar();
    const cod = Number(r.slice(0, 3));
    if (espera && !espera.includes(cod)) {
      const e = new Error(`SMTP recusou (${cod}): ${r.trim().split('\n').pop().slice(4, 200)}`);
      e.codigo = cod;
      throw e;
    }
    return r;
  }
  return { cmd };
}

async function conectar() {
  let sockRef = null;
  try { return await conectarDe((x) => { sockRef = x; }); }
  catch (e) { try { sockRef?.destroy(); } catch {} throw e; }
}
async function conectarDe(guardar) {
  const host = process.env.SMTP_HOST || 'smtp.zoho.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const sock = tls.connect({ host, port, servername: host, timeout: 20000 });
  guardar(sock);
  /* Escuta ANTES de conectar: o servidor manda o "220" logo depois do TLS, e
     quem só começa a ouvir depois perde a saudação e espera pra sempre. */
  const s = sessao(sock);
  const saudacao = s.cmd(null, [220]);
  await new Promise((ok, falha) => { sock.once('secureConnect', ok); sock.once('error', falha); sock.once('timeout', () => falha(new Error('SMTP sem resposta em 20s'))); });
  await saudacao;
  await s.cmd('EHLO bolsocheio.velososolution.com.br', [250]);
  await s.cmd('AUTH LOGIN', [334]);
  await s.cmd(b64(process.env.SMTP_USER), [334]);
  await s.cmd(b64(process.env.SMTP_PASS), [235]);
  return { s, sock };
}

/** Só confere se a conta autentica — não manda nada. */
export async function testarLogin() {
  if (!configurado()) { return { ok: false, erro: 'SMTP_USER/SMTP_PASS não configurados' }; }
  try { const { s, sock } = await conectar(); await s.cmd('QUIT', [221]).catch(() => {}); sock.end(); return { ok: true }; }
  catch (e) { return { ok: false, erro: e.message }; }
}

/**
 * Envia. `ok:true` só quando o servidor ACEITOU a mensagem (250 após o DATA) —
 * mesma regra do WhatsApp: nada de "enviado" por gentileza.
 */
/**
 * `anexos`: [{ nome, tipo, conteudo: Buffer }] — o portfólio da prospecção vai assim.
 * `responderPara`: pra onde a resposta do destinatário vai (Reply-To).
 */
export async function enviarEmail({ para, assunto, texto, html, anexos = [], responderPara = null }) {
  if (!configurado()) { return { ok: false, erro: 'e-mail não configurado no servidor (SMTP_USER/SMTP_PASS)' }; }
  const destino = String(para || '').trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(destino)) { return { ok: false, erro: `e-mail inválido: "${destino}"` }; }
  const de = process.env.SMTP_FROM || process.env.SMTP_USER;
  const nome = process.env.SMTP_NOME || 'Bolso Cheio';
  const limite = 'bc' + randomBytes(12).toString('hex');
  const misto = 'bm' + randomBytes(12).toString('hex');
  const temAnexo = Array.isArray(anexos) && anexos.length > 0;
  const quebra = (b) => b.replace(/.{76}/g, '$&\r\n');
  const corpo = [
    `From: ${cab(nome)} <${de}>`,
    `To: <${destino}>`,
    ...(responderPara ? [`Reply-To: <${String(responderPara).replace(/[<>\r\n]/g, '')}>`] : []),
    `Subject: ${cab(assunto)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(10).toString('hex')}@velososolution.com.br>`,
    'MIME-Version: 1.0',
    ...(temAnexo ? [`Content-Type: multipart/mixed; boundary="${misto}"`, '', `--${misto}`] : []),
    `Content-Type: multipart/alternative; boundary="${limite}"`,
    '',
    `--${limite}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(texto || '').replace(/.{76}/g, '$&\r\n'),
    `--${limite}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html || String(texto || '').replace(/\n/g, '<br>')).replace(/.{76}/g, '$&\r\n'),
    `--${limite}--`,
    ...(temAnexo ? anexos.flatMap((a) => ['', `--${misto}`,
      `Content-Type: ${a.tipo || 'application/octet-stream'}; name="${cab(a.nome)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${cab(a.nome)}"`,
      '',
      quebra(Buffer.from(a.conteudo).toString('base64'))]).concat(['', `--${misto}--`]) : []),
    '',
  ].join('\r\n');
  try {
    const { s, sock } = await conectar();
    await s.cmd(`MAIL FROM:<${de}>`, [250]);
    await s.cmd(`RCPT TO:<${destino}>`, [250, 251]);
    await s.cmd('DATA', [354]);
    const r = await s.cmd(corpo.replace(/^\./gm, '..') + '\r\n.', [250]);
    await s.cmd('QUIT', [221]).catch(() => {});
    sock.end();
    return { ok: true, id: r.trim().slice(4, 80) };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}
