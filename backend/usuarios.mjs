/**
 * Usuários do console: e-mail + senha, com papel.
 *
 *   admin    — o dono (Veloso Solution). Entra com o e-mail dele e a MESMA senha
 *              que o console já tinha (acesso.mjs): nada muda pra quem já usava.
 *   cliente  — quem assinou. Cria a senha pelo link do convite que chega depois
 *              do pagamento, e entra só na área "Minha conta" — NUNCA no console
 *              do dono, que tem cliente, funil e caixa da Veloso.
 *
 * Senha nunca é guardada: hash scrypt com sal por usuário (mesmo esquema do
 * acesso.mjs). A sessão é um token aleatório; só o hash dele vai pro disco, e a
 * senha deixa de viajar em cada pedido do painel.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { dentroDaCasa } from '../engine/casa.mjs';
import * as acesso from './acesso.mjs';

export const MIN_SENHA = 8;
const SESSAO_HORAS = 12;
const CONVITE_HORAS = 72;
const CONVITES_ATIVOS = 5;

const arq = (n) => (process.env.VSUSUARIOS_DIR ? join(process.env.VSUSUARIOS_DIR, n) : dentroDaCasa('console', n));
const ler = (n, p) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const gravar = (n, d) => {
  mkdirSync(dirname(arq(n)), { recursive: true, mode: 0o700 });
  writeFileSync(arq(n), JSON.stringify(d, null, 2));
  try { chmodSync(arq(n), 0o600); } catch {}
  return d;
};
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const agora = () => new Date().toISOString();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const derivar = (senha, sal) => scryptSync(String(senha), Buffer.from(sal, 'hex'), 32);
const igual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** E-mail do dono. É ele + a senha de sempre que abre o console completo. */
export const emailAdmin = () => normEmail(process.env.CONSOLE_ADMIN_EMAIL || 'velosobil@gmail.com');

const usuarios = () => ler('usuarios.json', []);
export const buscarPorEmail = (email) => usuarios().find((u) => u.email === normEmail(email)) || null;
export const doCliente = (clienteId) => usuarios().find((u) => u.clienteId === clienteId) || null;

/* ---------------- sessão ---------------- */

function abrirSessao(u) {
  const token = randomBytes(24).toString('base64url');
  const todas = ler('sessoes.json', {});
  const limpas = Object.fromEntries(Object.entries(todas).filter(([, s]) => s.expira > agora()));
  limpas[sha(token)] = { email: u.email, papel: u.papel, clienteId: u.clienteId || null, nome: u.nome || null, criada: agora(),
    expira: new Date(Date.now() + SESSAO_HORAS * 3600000).toISOString() };
  gravar('sessoes.json', limpas);
  return { token, papel: u.papel, nome: u.nome || null, email: u.email, clienteId: u.clienteId || null };
}

/**
 * Quem é o dono deste token? Aceita também a SENHA antiga do console no lugar
 * do token — é o que abas já abertas mandam, e derrubar todo mundo na troca
 * seria defeito, não segurança.
 */
export function autenticar(token) {
  const t = String(token || '');
  if (!t) { return null; }
  const s = ler('sessoes.json', {})[sha(t)];
  if (s && s.expira > agora()) { return s; }
  if (acesso.confere(t)) { return { email: emailAdmin(), papel: 'admin', legado: true }; }
  return null;
}

export function sair(token) {
  const todas = ler('sessoes.json', {});
  delete todas[sha(token)];
  gravar('sessoes.json', todas);
  return { ok: true };
}

/** Login. Mensagem igual pra e-mail inexistente e senha errada: não revela quem é cliente. */
export function entrar(email, senha) {
  const e = normEmail(email);
  const falha = { ok: false, motivo: 'e-mail ou senha incorretos' };
  if (!e || !senha) { return falha; }
  if (e === emailAdmin()) {
    if (!acesso.confere(senha)) { return falha; }
    return { ok: true, ...abrirSessao({ email: e, papel: 'admin', nome: 'Administrador' }) };
  }
  const u = buscarPorEmail(e);
  if (!u || !u.hash) { return falha; }
  if (!igual(derivar(senha, u.sal).toString('hex'), u.hash)) { return falha; }
  gravar('usuarios.json', usuarios().map((x) => (x.email === e ? { ...x, ultimoLogin: agora() } : x)));
  return { ok: true, ...abrirSessao(u) };
}

/* ---------------- convite (criar o próprio acesso) ---------------- */

/**
 * Link de uso único, 72 h, pra o cliente criar a senha. Reenviar NÃO derruba o
 * link que ele já tem: o reenvio (dele, ou a nova tentativa automática) chega
 * enquanto ele abre o anterior, e ele via "link vencido" num link de minutos
 * atrás. Os links do cliente morrem TODOS quando ele cria a senha — é aí que
 * link velho circulando num print deixa de abrir. Teto de ativos por cliente.
 */
export function convidar({ email, clienteId, nome }) {
  const e = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { return { ok: false, motivo: 'o cliente não tem e-mail válido cadastrado' }; }
  if (e === emailAdmin()) { return { ok: false, motivo: 'este e-mail é o do administrador — use a senha do console' }; }
  const dono = buscarPorEmail(e);
  if (dono && dono.clienteId && dono.clienteId !== clienteId) { return { ok: false, motivo: 'este e-mail já é usuário de outro cliente' }; }
  const token = randomBytes(24).toString('base64url');
  const vivos = ler('convites.json', []).filter((c) => c.expira > agora());
  const doCli = vivos.filter((c) => c.clienteId === clienteId).slice(-(CONVITES_ATIVOS - 1));
  const convites = [...vivos.filter((c) => c.clienteId !== clienteId), ...doCli];
  convites.push({ hash: sha(token), email: e, clienteId, nome: nome || null, criado: agora(),
    expira: new Date(Date.now() + CONVITE_HORAS * 3600000).toISOString() });
  gravar('convites.json', convites);
  return { ok: true, token, email: e, jaTemUsuario: !!dono?.hash };
}

export function lerConvite(token) {
  const c = ler('convites.json', []).find((x) => x.hash === sha(token || ''));
  if (!c || c.expira <= agora()) {
    /* Link de quem JÁ criou a senha: não é erro, é "pode entrar". Mostrar
       "vencido" pra quem acabou de criar o acesso parece que nada funcionou. */
    const usado = ler('convites-usados.json', []).find((x) => x.hash === sha(token || '') && x.expira > agora());
    if (usado) { return { ok: false, usado: true, motivo: 'sua senha já foi criada — é só entrar com o seu e-mail e a senha' }; }
    return { ok: false, motivo: 'link vencido ou já usado — peça um novo' };
  }
  return { ok: true, email: c.email, nome: c.nome, jaTemUsuario: !!buscarPorEmail(c.email)?.hash };
}

/** Cria (ou redefine) a senha do usuário do convite e já abre a sessão. */
export function aceitarConvite(token, senha) {
  const lista = ler('convites.json', []);
  const c = lista.find((x) => x.hash === sha(token || ''));
  if (!c || c.expira <= agora()) { return { ok: false, motivo: 'link vencido ou já usado — peça um novo' }; }
  const s = String(senha || '');
  if (s.length < MIN_SENHA) { return { ok: false, motivo: `a senha precisa de pelo menos ${MIN_SENHA} caracteres` }; }
  const sal = randomBytes(16).toString('hex');
  const todos = usuarios().filter((u) => u.email !== c.email);
  const u = { email: c.email, nome: c.nome, papel: 'cliente', clienteId: c.clienteId, sal, hash: derivar(s, sal).toString('hex'),
    criadoEm: buscarPorEmail(c.email)?.criadoEm || agora(), senhaDefinidaEm: agora() };
  gravar('usuarios.json', [...todos, u]);
  gravar('convites.json', lista.filter((x) => x.clienteId !== c.clienteId));
  /* Só o hash e a validade: basta pra reconhecer o link depois, sem guardar e-mail. */
  const usados = ler('convites-usados.json', []).filter((x) => x.expira > agora());
  gravar('convites-usados.json', [...usados, ...lista.filter((x) => x.clienteId === c.clienteId).map((x) => ({ hash: x.hash, expira: x.expira }))]);
  return { ok: true, ...abrirSessao(u) };
}

/* ---------------- esqueci a senha ---------------- */

const REDEFINIR_MIN = 60;

/**
 * Link de 1 hora pra trocar a senha SEM a atual. Vale pro dono e pro cliente:
 * quem prova que lê o e-mail cadastrado prova que é o dono da conta. E-mail
 * desconhecido devolve `ok:false` só pra quem chama no servidor — a rota
 * responde igual nos dois casos, pra não revelar quem tem conta.
 */
export function pedirRedefinicao(email) {
  const e = normEmail(email);
  const admin = e && e === emailAdmin();
  const u = admin ? null : buscarPorEmail(e);
  if (!admin && !u?.hash) { return { ok: false }; }
  const token = randomBytes(24).toString('base64url');
  const vivos = ler('redefinicoes.json', []).filter((r) => r.expira > agora() && r.email !== e);
  gravar('redefinicoes.json', [...vivos, { hash: sha(token), email: e, criado: agora(),
    expira: new Date(Date.now() + REDEFINIR_MIN * 60000).toISOString() }]);
  return { ok: true, token, email: e, nome: admin ? 'Administrador' : (u.nome || null), clienteId: u?.clienteId || null };
}

export function lerRedefinicao(token) {
  const r = ler('redefinicoes.json', []).find((x) => x.hash === sha(token || ''));
  if (!r || r.expira <= agora()) { return { ok: false, motivo: 'link vencido ou já usado — peça outro em "Esqueci minha senha"' }; }
  return { ok: true, email: r.email };
}

/** Grava a senha nova, derruba as sessões abertas daquele e-mail e já entra. */
export function redefinirSenha(token, senha) {
  const lista = ler('redefinicoes.json', []);
  const r = lista.find((x) => x.hash === sha(token || ''));
  if (!r || r.expira <= agora()) { return { ok: false, motivo: 'link vencido ou já usado — peça outro em "Esqueci minha senha"' }; }
  const s = String(senha || '');
  if (s.length < MIN_SENHA) { return { ok: false, motivo: `a senha precisa de pelo menos ${MIN_SENHA} caracteres` }; }
  let u;
  if (r.email === emailAdmin()) {
    acesso.definir(s);
    u = { email: r.email, papel: 'admin', nome: 'Administrador' };
  } else {
    u = buscarPorEmail(r.email);
    if (!u) { return { ok: false, motivo: 'usuário não encontrado' }; }
    u = { ...u, ...novaSenha(s) };
    gravar('usuarios.json', usuarios().map((x) => (x.email === r.email ? u : x)));
  }
  gravar('redefinicoes.json', lista.filter((x) => x.email !== r.email && x.expira > agora()));
  derrubarSessoes(r.email);
  return { ok: true, ...abrirSessao(u) };
}

/** Troca de dentro do console, com a atual na mão. Dono cai no acesso.mjs. */
export function trocarSenha(email, atual, nova) {
  const e = normEmail(email);
  if (e === emailAdmin()) {
    try { acesso.trocar(atual, nova); return { ok: true }; }
    catch (x) { return { ok: false, code: x.code || 400, motivo: x.message }; }
  }
  const u = buscarPorEmail(e);
  if (!u?.hash || !igual(derivar(atual, u.sal).toString('hex'), u.hash)) { return { ok: false, code: 401, motivo: 'senha atual incorreta' }; }
  const s = String(nova || '');
  if (s.length < MIN_SENHA) { return { ok: false, code: 422, motivo: `a senha precisa de pelo menos ${MIN_SENHA} caracteres` }; }
  gravar('usuarios.json', usuarios().map((x) => (x.email === e ? { ...x, ...novaSenha(s) } : x)));
  return { ok: true };
}

function novaSenha(s) {
  const sal = randomBytes(16).toString('hex');
  return { sal, hash: derivar(s, sal).toString('hex'), senhaDefinidaEm: agora() };
}

function derrubarSessoes(email) {
  const todas = ler('sessoes.json', {});
  gravar('sessoes.json', Object.fromEntries(Object.entries(todas).filter(([, s]) => s.email !== email)));
}
