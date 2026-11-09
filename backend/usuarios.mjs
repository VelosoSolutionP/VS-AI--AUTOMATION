/**
 * Usuários do console: e-mail ou documento associado + senha, com papel.
 *
 *   admin    — o dono (Veloso Solution). Entra com o e-mail dele e a MESMA senha
 *              que o console já tinha (acesso.mjs): nada muda pra quem já usava.
 *   vendedor — atendente da própria empresa (um operador com login). Entra só
 *              no Atendimento: vê a fila e as conversas dele e da equipe dele,
 *              e fica registrado como quem assumiu cada cliente.
 *              O titular pode delegar acesso administrativo temporário a um
 *              vendedor, sempre exigindo a senha dele e um código por e-mail.
 *   cliente  — quem assinou. Cria a senha pelo link do convite que chega depois
 *              do pagamento, e entra só na área "Minha conta" — NUNCA no console
 *              do dono, que tem cliente, funil e caixa da Veloso.
 *
 * Senha nunca é guardada: hash scrypt com sal por usuário (mesmo esquema do
 * acesso.mjs). A sessão é um token aleatório; só o hash dele vai pro disco, e a
 * senha deixa de viajar em cada pedido do painel.
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { dentroDaCasa, empresaAtual } from '../engine/casa.mjs';
import * as acesso from './acesso.mjs';

export const MIN_SENHA = 8;
const SESSAO_HORAS = 12;
const CONVITE_HORAS = 72;
const CONVITES_ATIVOS = 5;
const DELEGACAO_HORAS = 24;
const CODIGO_TENTATIVAS = 5;
const REENVIO_SEGUNDOS = 60;

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

/**
 * Outros e-mails do dono que também abrem o console com a senha dele.
 *
 * Existe porque o e-mail pessoal do dono também é usuário CLIENTE (a assinatura de teste). A
 * primeira regra deixava a SENHA decidir o papel: com a de cliente ele caía na "Minha conta",
 * cuja única saída é "Trocar de plano" — o dono logava e ia parar na tela de compra, sem
 * caminho pro dashboard. Agora e-mail do dono entra como dono com qualquer uma das duas senhas
 * válidas dele; a conta de cliente continua visível em "Clientes e licenças".
 */
const emailsDoDono = () => new Set([
  emailAdmin(),
  ...String(process.env.CONSOLE_ADMIN_EMAILS_EXTRA ?? 'velosobil@gmail.com').split(',').map(normEmail).filter(Boolean),
]);

const usuarios = () => ler('usuarios.json', []);
export const buscarPorEmail = (email) => usuarios().find((u) => u.email === normEmail(email)) || null;
export const doCliente = (clienteId) => usuarios().find((u) => u.clienteId === clienteId) || null;

/** Resolve documento para login sem revelar o e-mail associado. */
export function emailPorDocumento(documento, clientes = []) {
  const digitos = String(documento || '').replace(/\D/g, '');
  if (!/^\d{11}$|^\d{14}$/.test(digitos)) return null;
  const emails = [...new Set(usuarios()
    .filter((u) => (u.papel === 'empresa' && u.empresa === digitos)
      || (u.clienteId && clientes.some((cliente) => cliente.id === u.clienteId && cliente.documento === digitos)))
    .map((u) => u.email))];
  return emails.length === 1 ? emails[0] : null;
}

/* ---------------- sessão ---------------- */

function abrirSessao(u) {
  const token = randomBytes(24).toString('base64url');
  const todas = ler('sessoes.json', {});
  const limpas = Object.fromEntries(Object.entries(todas).filter(([, s]) => s.expira > agora()));
  const expira = u.expiraDelegacao || new Date(Date.now() + SESSAO_HORAS * 3600000).toISOString();
  limpas[sha(token)] = { email: u.email, papel: u.papel, clienteId: u.clienteId || null, operadorId: u.operadorId || null, nome: u.nome || null, empresa: u.empresa || null, delegada: u.delegada === true, ...(u.velosoHandle ? { velosoHandle: u.velosoHandle } : {}), criada: agora(), expira };
  gravar('sessoes.json', limpas);
  return { token, papel: u.papel, nome: u.nome || null, email: u.email, clienteId: u.clienteId || null, operadorId: u.operadorId || null, empresa: u.empresa || null, delegada: u.delegada === true, expira };
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
  // Sessão de cliente aberta antes da regra acima também vira dono: sem isto, quem já estava
  // logado continuaria preso na "Minha conta" até sair e entrar de novo.
  if (s && s.expira > agora()) {
    if (emailsDoDono().has(s.email)) { return { ...s, papel: 'admin', clienteId: null }; }
    if (s.delegada) {
      const d = delegacao();
      const u = buscarPorEmail(s.email);
      if (d.email !== s.email || !d.codigoExpira || d.codigoExpira <= agora() || u?.papel !== 'vendedor' || travado(s.email, 'vendedor')) { return null; }
      return { ...s, papel: 'admin', clienteId: null, delegada: true };
    }
    /* Travado depois de logado: a sessão para de valer na hora (07/10). */
    return travado(s.email, s.papel) ? null : s;
  }
  if (acesso.confere(t)) { return { email: emailAdmin(), papel: 'admin', legado: true }; }
  return null;
}

export function sair(token) {
  const todas = ler('sessoes.json', {});
  delete todas[sha(token)];
  gravar('sessoes.json', todas);
  return { ok: true };
}

/* ---------------- travas de acesso (07/10) ----------------
   Dono: "tem que ter um menu pra eu travar acessos, só o dono". Duas chaves:
   "só o dono entra" (ninguém mais entra nem continua logado) e a trava por
   pessoa. Vale NA HORA: a sessão de quem foi travado deixa de valer. O dono
   nunca é travado — senão ninguém destrava. */
const travasCfg = () => ({ soDono: false, travados: [], ...ler('travas.json', {}) });
export const travas = () => travasCfg();
const delegacao = () => ({ email: null, codigoHash: null, codigoSalt: null, codigoExpira: null, tentativas: 0, enviadoEm: null, ...ler('delegacao.json', {}) });
export const statusDelegacao = () => {
  const d = delegacao();
  return { email: d.email || null, codigoExpira: d.codigoExpira && d.codigoExpira > agora() ? d.codigoExpira : null };
};
export function configurarDelegacao(email, { por = null } = {}) {
  const e = normEmail(email);
  if (e) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { return { ok: false, motivo: 'informe um e-mail válido' }; }
    const u = buscarPorEmail(e);
    if (!u || u.papel !== 'vendedor' || !u.hash) { return { ok: false, motivo: 'a pessoa precisa ter um acesso de atendente ativo no painel' }; }
    if (emailsDoDono().has(e)) { return { ok: false, motivo: 'o e-mail do administrador não pode ser delegado' }; }
    if (travado(e, 'vendedor')) { return { ok: false, motivo: 'libere o acesso do atendente antes de delegar a administração' }; }
  }
  const anterior = delegacao().email;
  gravar('delegacao.json', { email: e || null, codigoHash: null, codigoSalt: null, codigoExpira: null, tentativas: 0, enviadoEm: null, mudouPor: por, mudouEm: agora() });
  if (anterior) derrubarSessoesDelegadas(anterior);
  return { ok: true, delegacao: statusDelegacao() };
}
export function emitirCodigoDelegacao(email, { reenviar = false } = {}) {
  const e = normEmail(email), d = delegacao();
  if (!e || d.email !== e || buscarPorEmail(e)?.papel !== 'vendedor' || travado(e, 'vendedor')) {
    return { ok: false, motivo: 'acesso delegado indisponível' };
  }
  const ativo = d.codigoHash && d.codigoExpira > agora();
  if (ativo && !reenviar) { return { ok: true, novo: false, email: e, expira: d.codigoExpira }; }
  if (d.enviadoEm && Date.now() - Date.parse(d.enviadoEm) < REENVIO_SEGUNDOS * 1000) {
    return { ok: false, aguarde: true, motivo: 'aguarde um minuto antes de pedir outro código' };
  }
  const codigo = String(randomInt(10000000, 100000000));
  const codigoSalt = randomBytes(16).toString('hex');
  const expira = new Date(Date.now() + DELEGACAO_HORAS * 3600000).toISOString();
  gravar('delegacao.json', { ...d, codigoHash: derivar(codigo, codigoSalt).toString('hex'), codigoSalt, codigoExpira: expira, tentativas: 0, enviadoEm: agora() });
  return { ok: true, novo: true, codigo, email: e, expira };
}
export function cancelarCodigoDelegacao(email) {
  const d = delegacao();
  if (d.email === normEmail(email)) {
    gravar('delegacao.json', { ...d, codigoHash: null, codigoSalt: null, codigoExpira: null, tentativas: 0 });
  }
}
export function entrarComCodigoDelegacao(email, codigo) {
  const e = normEmail(email), d = delegacao();
  if (!e || d.email !== e || !d.codigoHash || !d.codigoExpira || d.codigoExpira <= agora()
    || buscarPorEmail(e)?.papel !== 'vendedor' || travado(e, 'vendedor')) {
    return { ok: false, motivo: 'código inválido ou expirado — entre novamente para receber outro' };
  }
  const informado = String(codigo || '').trim();
  const saltValido = /^[a-f0-9]{32}$/i.test(d.codigoSalt || '');
  if (!/^\d{8}$/.test(informado) || !saltValido || !igual(derivar(informado, d.codigoSalt).toString('hex'), d.codigoHash)) {
    const tentativas = Number(d.tentativas || 0) + 1;
    gravar('delegacao.json', tentativas >= CODIGO_TENTATIVAS
      ? { ...d, codigoHash: null, codigoSalt: null, codigoExpira: null, tentativas }
      : { ...d, tentativas });
    return { ok: false, motivo: tentativas >= CODIGO_TENTATIVAS
      ? 'limite de tentativas atingido — entre novamente para receber outro código'
      : 'código inválido ou expirado' };
  }
  const u = buscarPorEmail(e);
  gravar('usuarios.json', usuarios().map((x) => (x.email === e ? { ...x, ultimoLogin: agora() } : x)));
  return { ok: true, ...abrirSessao({ ...u, papel: 'admin', clienteId: null, delegada: true, expiraDelegacao: d.codigoExpira }) };
}
function derrubarSessoesDelegadas(email) {
  const todas = ler('sessoes.json', {});
  gravar('sessoes.json', Object.fromEntries(Object.entries(todas).filter(([, s]) => !(s.email === email && s.delegada))));
}
const travado = (email, papel) => {
  if (papel === 'admin' || emailsDoDono().has(normEmail(email))) { return false; }
  const t = travasCfg();
  return t.soDono || t.travados.includes(normEmail(email));
};
export const MSG_TRAVADO = 'acesso travado pelo administrador — fale com o dono da conta';
export function travarTudo(ligado, { por = null } = {}) {
  const t = { ...travasCfg(), soDono: !!ligado, mudouPor: por, mudouEm: agora() };
  gravar('travas.json', t);
  if (t.soDono) {
    const todas = ler('sessoes.json', {});
    gravar('sessoes.json', Object.fromEntries(Object.entries(todas).filter(([, s]) => !s.delegada && (s.papel === 'admin' || emailsDoDono().has(s.email)))));
    const d = delegacao();
    if (d.email) gravar('delegacao.json', { ...d, codigoHash: null, codigoSalt: null, codigoExpira: null, tentativas: 0 });
  }
  return { ok: true, travas: t };
}
export function travarPessoa(email, sim, { por = null } = {}) {
  const e = normEmail(email);
  if (!e) { return { ok: false, motivo: 'informe o e-mail' }; }
  if (emailsDoDono().has(e)) { return { ok: false, motivo: 'o acesso do dono não se trava' }; }
  const t = travasCfg();
  const lista = new Set(t.travados);
  if (sim) { lista.add(e); } else { lista.delete(e); }
  const novo = { ...t, travados: [...lista], mudouPor: por, mudouEm: agora() };
  gravar('travas.json', novo);
  if (sim) {
    derrubarSessoes(e);
    const d = delegacao();
    if (d.email === e) gravar('delegacao.json', { ...d, codigoHash: null, codigoSalt: null, codigoExpira: null, tentativas: 0 });
  }
  return { ok: true, travas: novo };
}

/** Login. Mensagem igual pra e-mail inexistente e senha errada: não revela quem é cliente. */
export function entrar(email, senha) {
  const e = normEmail(email);
  const falha = { ok: false, motivo: 'e-mail ou senha incorretos' };
  if (!e || !senha) { return falha; }
  if (emailsDoDono().has(e) && acesso.confere(senha)) {
    return { ok: true, ...abrirSessao({ email: e, papel: 'admin', nome: 'Administrador' }) };
  }
  if (e === emailAdmin()) { return falha; }
  const u = buscarPorEmail(e);
  if (!u || !u.hash) { return falha; }
  if (!igual(derivar(senha, u.sal).toString('hex'), u.hash)) { return falha; }
  /* Senha certa, mas travado: diz o motivo (quem tem a senha certa pode saber). */
  if (travado(e, u.papel)) { return { ok: false, motivo: MSG_TRAVADO, travado: true }; }
  if (delegacao().email === e) { return { ok: true, exigeCodigo: true, email: e, nome: u.nome || null }; }
  gravar('usuarios.json', usuarios().map((x) => (x.email === e ? { ...x, ultimoLogin: agora() } : x)));
  if (emailsDoDono().has(e)) { return { ok: true, ...abrirSessao({ email: e, papel: 'admin', nome: 'Administrador' }) }; }
  return { ok: true, ...abrirSessao(u) };
}

/**
 * Entrada pelo Veloso ID: o Portal já confirmou a pessoa, o contrato e o
 * financeiro. Só vale para cliente e empresa: o dono e a equipe seguem com senha,
 * senão uma conta de cliente com o e-mail do dono abriria o painel da plataforma.
 */
export function entrarPeloVelosoId(email, handle) {
  const e = normEmail(email);
  const u = buscarPorEmail(e);
  if (!u || emailsDoDono().has(e) || !['cliente', 'empresa'].includes(u.papel)) { return { ok: false, motivo: 'conta não encontrada no ZEST' }; }
  if (travado(e, u.papel)) { return { ok: false, motivo: MSG_TRAVADO, travado: true }; }
  gravar('usuarios.json', usuarios().map((x) => (x.email === e ? { ...x, ultimoLogin: agora() } : x)));
  return { ok: true, ...abrirSessao({ ...u, velosoHandle: handle }) };
}

/** Com a senha desligada (VELOSO_ID_SENHA=0), quem é de cliente só entra pelo Portal. */
export const entraSoPeloPortal = (email) => ['cliente', 'empresa'].includes(buscarPorEmail(email)?.papel) && !emailsDoDono().has(normEmail(email));

/* ---------------- acesso de EMPRESA CLIENTE (18/10) ----------------
   Dono: "vendi, o cara ganhou login e senha, vem limpo o CRM, separa por CNPJ".
   O login da empresa (papel 'empresa') entra SÓ nos dados dela: a sessão leva o
   CNPJ e o servidor abre tudo dentro de comEmpresa(cnpj). É o dono da empresa
   cliente — administra o painel dela, nunca o da plataforma. */
export function criarAcessoEmpresa({ empresa, email, nome, senha } = {}) {
  const e = normEmail(email);
  const cnpj = String(empresa || '').replace(/\D/g, '');
  if (!/^\d{11}$|^\d{14}$/.test(cnpj)) { return { ok: false, motivo: 'empresa inválida' }; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { return { ok: false, motivo: 'informe um e-mail válido' }; }
  if (emailsDoDono().has(e)) { return { ok: false, motivo: 'este e-mail é o do administrador da plataforma' }; }
  const s = String(senha || '');
  if (s.length < MIN_SENHA) { return { ok: false, motivo: `a senha inicial precisa de pelo menos ${MIN_SENHA} caracteres` }; }
  const outro = buscarPorEmail(e);
  if (outro && !(outro.papel === 'empresa' && outro.empresa === cnpj)) { return { ok: false, motivo: 'este e-mail já tem outro acesso no painel' }; }
  const sal = randomBytes(16).toString('hex');
  const u = { email: e, nome: String(nome || '').trim() || null, papel: 'empresa', empresa: cnpj, sal, hash: derivar(s, sal).toString('hex'), criadoEm: outro?.criadoEm || agora(), senhaDefinidaEm: agora() };
  gravar('usuarios.json', [...usuarios().filter((x) => x.email !== e), u]);
  derrubarSessoes(e);
  return { ok: true, email: e, empresa: cnpj };
}
export const acessosDaEmpresa = (cnpj) => usuarios().filter((u) => u.papel === 'empresa' && u.empresa === String(cnpj)).map((u) => ({ email: u.email, nome: u.nome, ultimoLogin: u.ultimoLogin || null }));
export function removerAcessoEmpresa(email) {
  const e = normEmail(email);
  const u = usuarios().find((x) => x.email === e && x.papel === 'empresa');
  if (!u) { return { ok: false, motivo: 'acesso não encontrado' }; }
  gravar('usuarios.json', usuarios().filter((x) => x !== u));
  derrubarSessoes(e);
  return { ok: true };
}

/* ---------------- acesso de vendedor ---------------- */

/**
 * O dono dá acesso a um operador: e-mail + senha inicial, que ele troca depois
 * em "Trocar senha". Um operador, um acesso. Sem convite por e-mail de
 * propósito: é gente da casa, o dono entrega a senha em mãos.
 */
export function criarAcessoVendedor({ email, nome, senha, operadorId } = {}) {
  const e = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { return { ok: false, motivo: 'informe um e-mail válido para o vendedor entrar' }; }
  if (emailsDoDono().has(e)) { return { ok: false, motivo: 'este e-mail é o do administrador' }; }
  if (!String(operadorId || '').trim()) { return { ok: false, motivo: 'acesso de vendedor precisa de um operador cadastrado' }; }
  const s = String(senha || '');
  if (s.length < MIN_SENHA) { return { ok: false, motivo: `a senha inicial precisa de pelo menos ${MIN_SENHA} caracteres` }; }
  const outro = buscarPorEmail(e);
  if (outro && !(outro.papel === 'vendedor' && outro.operadorId === operadorId)) { return { ok: false, motivo: 'este e-mail já tem outro acesso no painel' }; }
  const sal = randomBytes(16).toString('hex');
  const resto = usuarios().filter((u) => u.email !== e && !(u.papel === 'vendedor' && u.operadorId === operadorId && (u.empresa || null) === (empresaAtual() || null)));
  /* Atendente criado dentro de uma empresa cliente é dela: a sessão dele abre nos dados dela. */
  const u = { email: e, nome: String(nome || '').trim() || null, papel: 'vendedor', operadorId: String(operadorId), empresa: empresaAtual() || null, sal, hash: derivar(s, sal).toString('hex'),
    criadoEm: outro?.criadoEm || agora(), senhaDefinidaEm: agora() };
  gravar('usuarios.json', [...resto, u]);
  derrubarSessoes(e);
  return { ok: true, email: e, operadorId: u.operadorId };
}

/** Tira o acesso e derruba a sessão aberta: quem saiu da empresa sai do painel na hora. */
export function removerAcessoVendedor(operadorId) {
  const u = usuarios().find((x) => x.papel === 'vendedor' && x.operadorId === String(operadorId || '') && (x.empresa || null) === (empresaAtual() || null));
  if (!u) { return { ok: false, motivo: 'este operador não tem acesso' }; }
  gravar('usuarios.json', usuarios().filter((x) => x !== u && x.email !== u.email));
  derrubarSessoes(u.email);
  if (delegacao().email === u.email) configurarDelegacao('');
  return { ok: true };
}

/** Vendedores com sessão aberta agora (logados e não expirados): é o "no painel" da tela vazia. */
export function vendedoresNoPainel() {
  const agoraIso = agora();
  return new Set(Object.values(ler('sessoes.json', {})).filter((x) => x.papel === 'vendedor' && x.expira > agoraIso && x.operadorId && (x.empresa || null) === (empresaAtual() || null)).map((x) => x.operadorId));
}

export const acessosVendedores = () => usuarios().filter((u) => u.papel === 'vendedor' && (u.empresa || null) === (empresaAtual() || null))
  .map((u) => ({ email: u.email, nome: u.nome, operadorId: u.operadorId, ultimoLogin: u.ultimoLogin || null }));
/** Clientes com "Minha conta" (pra tela de Acessos). Sem senha nem hash. */
export const acessosClientes = () => usuarios().filter((u) => u.papel === 'cliente' && !emailsDoDono().has(u.email))
  .map((u) => ({ email: u.email, nome: u.nome || u.email, clienteId: u.clienteId || null }));

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
