/**
 * Veloso ID no ZEST: o cliente entra pelo Portal, com CPF/CNPJ e passkey.
 * Identidade, contrato e financeiro são decididos lá; aqui só se resgata a
 * autorização de uso único, no servidor. A credencial técnica muda sozinha à
 * meia-noite de Brasília. Sem as variáveis, fica desligado e nada muda.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const b64 = (b) => b.toString('base64url');
const mac = (raiz, msg) => b64(createHmac('sha256', raiz).update(msg).digest());

const VALIDADE_ESTADO_S = 600;
const INTERVALO_MS = () => Number(process.env.VELOSO_ID_INTERVALO_MS) || 300_000;

export const NONCE_COOKIE = 'zest_veloso_nonce';

const cfg = () => ({
  portalWeb: String(process.env.VELOSO_ID_PORTAL_WEB || '').replace(/\/$/, ''),
  portalApi: String(process.env.VELOSO_ID_PORTAL_API || '').replace(/\/$/, ''),
  cliente: process.env.VELOSO_ID_CLIENTE || 'ZEST',
  raiz: process.env.VELOSO_ID_RAIZ || '',
  retorno: process.env.VELOSO_ID_RETORNO || '',
});

export const ativo = () => { const c = cfg(); return Boolean(c.portalWeb && c.portalApi && c.raiz && c.retorno); };
/** Login antigo do cliente. Só desliga depois de validada a migração. */
export const senhaAtiva = () => !ativo() || process.env.VELOSO_ID_SENHA !== '0';
export const retornoSeguro = () => cfg().retorno.startsWith('https:');

const dia = (agora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
export const credencial = (raiz, cliente, agora) => mac(raiz, `${cliente}:${dia(agora)}`);
const verificador = (raiz, aleatorio) => mac(raiz, `pkce:${aleatorio}`);
const desafio = (v) => b64(createHash('sha256').update(v).digest());

function validarEstado(raiz, estado, nonce) {
  const p = String(estado || '').split('.');
  if (p.length !== 3 || !/^\d+$/.test(p[1]) || Number(p[1]) < Math.floor(Date.now() / 1000)) return null;
  const a = Buffer.from(mac(raiz, `state:${p[0]}:${p[1]}:${nonce}`));
  const b = Buffer.from(p[2]);
  return a.length === b.length && timingSafeEqual(a, b) ? p[0] : null;
}

export function iniciar() {
  const c = cfg();
  const nonce = b64(randomBytes(24));
  const aleatorio = b64(randomBytes(24));
  const expira = Math.floor(Date.now() / 1000) + VALIDADE_ESTADO_S;
  const estado = `${aleatorio}.${expira}.${mac(c.raiz, `state:${aleatorio}:${expira}:${nonce}`)}`;
  const q = new URLSearchParams({
    client_id: c.cliente,
    redirect_uri: c.retorno,
    state: estado,
    code_challenge: desafio(verificador(c.raiz, aleatorio)),
    code_challenge_method: 'S256',
  });
  return { url: `${c.portalWeb}/veloso-id?${q}`, nonce };
}

function portal(caminho, corpo) {
  const c = cfg();
  return fetch(`${c.portalApi}/api/v1/identity/apps/${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-veloso-client': c.cliente, 'x-veloso-credential': credencial(c.raiz, c.cliente) },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(8000),
  });
}

/** Devolve { email, handle } ou null. Estado ou nonce errado nem chega ao Portal. */
export async function resgatar(code, state, nonce) {
  const c = cfg();
  if (!ativo() || !code || !nonce) return null;
  const aleatorio = validarEstado(c.raiz, state, nonce);
  if (!aleatorio) return null;
  try {
    const r = await portal('redeem', { code, redirectUri: c.retorno, codeVerifier: verificador(c.raiz, aleatorio) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.sessionHandle && d?.person?.email ? { email: String(d.person.email).toLowerCase(), handle: d.sessionHandle } : null;
  } catch { return null; }
}

export async function encerrar(handle) {
  await portal('session/end', { sessionHandle: handle }).catch(() => undefined);
}

const vistas = new Map();

/** Bloqueio ou revogação alcança quem já está dentro. Portal fora do ar não derruba ninguém. */
export async function sessaoValida(handle) {
  const v = vistas.get(handle);
  if (v && Date.now() - v.em < INTERVALO_MS()) return v.ativa;
  try {
    const r = await portal('session/check', { sessionHandle: handle });
    if (!r.ok) return v?.ativa ?? true;
    const ativa = (await r.json()).active === true;
    vistas.set(handle, { em: Date.now(), ativa });
    return ativa;
  } catch { return v?.ativa ?? true; }
}
