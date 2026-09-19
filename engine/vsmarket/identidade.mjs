/**
 * VSmarket — identidade: login, papéis e sessão.
 *
 * Senha com **scrypt** e sal por usuário. Não é preferência: hash rápido (md5/sha)
 * cai em ataque de dicionário em minutos com GPU, e sal único impede que dois
 * usuários com a mesma senha tenham o mesmo hash — o que entregaria a base inteira
 * a partir de uma senha descoberta.
 *
 * A comparação é em tempo constante. Comparar hash com `===` vaza, pelo tempo de
 * resposta, quantos bytes iniciais bateram.
 *
 * O que NUNCA sai daqui: hash, sal e token de sessão em claro. O §39 é explícito
 * sobre não registrar senha nem token.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/** Papéis do §2 da spec. */
export const PAPEIS = ['cliente', 'prestador', 'admin', 'suporte', 'analista_disputa', 'perito', 'parceiro'];

/** Quem pode operar o marketplace por dentro — exige MFA no §40. */
export const PAPEIS_INTERNOS = ['admin', 'suporte', 'analista_disputa'];

export const SESSAO_HORAS = 12;

const CUSTO = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Gera hash + sal. Sal novo a cada chamada, sempre. */
export function hashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  const hash = scryptSync(String(senha), sal, CUSTO.keylen, { N: CUSTO.N, r: CUSTO.r, p: CUSTO.p }).toString('hex');
  return { hash, sal, algoritmo: 'scrypt' };
}

/** Confere em tempo constante. Nunca lança — entrada de fora pode ser qualquer coisa. */
export function senhaConfere(senha, hash, sal) {
  try {
    if (!hash || !sal) { return false; }
    const calc = scryptSync(String(senha), sal, CUSTO.keylen, { N: CUSTO.N, r: CUSTO.r, p: CUSTO.p });
    const guardado = Buffer.from(String(hash), 'hex');
    if (calc.length !== guardado.length) { return false; }
    return timingSafeEqual(calc, guardado);
  } catch {
    return false;
  }
}

/**
 * Política de senha. Recusa com motivo em português — "senha fraca" não ajuda
 * ninguém a escolher outra.
 */
export function validarSenha(senha) {
  const s = String(senha || '');
  const erros = [];
  if (s.length < 10) { erros.push('use ao menos 10 caracteres'); }
  if (!/[a-zA-Z]/.test(s)) { erros.push('inclua ao menos uma letra'); }
  if (!/[0-9]/.test(s)) { erros.push('inclua ao menos um número'); }
  // Lista curta do que aparece em todo vazamento — não substitui uma lista real.
  if (/^(senha|123456|password|qwerty|admin)/i.test(s)) { erros.push('essa senha está em toda lista de vazamento'); }
  return { ok: erros.length === 0, erros };
}

const email = (v) => String(v || '').trim().toLowerCase();

/** Normaliza e valida um cadastro de usuário. */
export function normalizarUsuario(e = {}, existentes = []) {
  const erros = [];
  const mail = email(e.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { erros.push(`e-mail inválido: "${e.email}"`); }
  if (existentes.some((u) => u.email === mail)) { erros.push('já existe conta com este e-mail'); }

  const papel = String(e.papel || '').toLowerCase();
  if (!PAPEIS.includes(papel)) { erros.push(`papel desconhecido: "${e.papel}" (use ${PAPEIS.join(', ')})`); }

  const nome = String(e.nome || '').trim();
  if (!nome) { erros.push('nome é obrigatório'); }

  const v = validarSenha(e.senha);
  if (!v.ok) { erros.push('senha: ' + v.erros.join('; ')); }

  if (erros.length) { return { usuario: null, erros }; }

  const { hash, sal, algoritmo } = hashSenha(e.senha);
  return {
    usuario: {
      id: 'usr_' + randomBytes(8).toString('hex'),
      email: mail, nome, papel,
      hash, sal, algoritmo,
      // Papel interno nasce exigindo MFA (§40). Cliente e prestador não.
      mfaObrigatorio: PAPEIS_INTERNOS.includes(papel),
      mfaConfigurado: false,
      ativo: true,
      criadoEm: e.quando || new Date().toISOString(),
      ultimoLogin: null,
      tentativasFalhas: 0,
      bloqueadoAte: null,
    },
    erros: [],
  };
}

/** Forma pública do usuário: sem hash, sem sal, nunca. */
export function publico(u) {
  if (!u) { return null; }
  const { hash, sal, algoritmo, ...resto } = u;
  return resto;
}

/** Token de sessão: aleatório de verdade. Guardamos só o hash dele. */
export function novoToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hashToken: createHash('sha256').update(token).digest('hex') };
}

export const hashDeToken = (t) => createHash('sha256').update(String(t || '')).digest('hex');

/**
 * Tenta autenticar. Devolve SEMPRE a mesma mensagem para e-mail inexistente e senha
 * errada: distinguir os dois entrega ao atacante a lista de quem tem conta.
 *
 * Bloqueio temporário após 5 tentativas — freia força bruta sem travar de vez quem
 * só esqueceu a senha.
 */
export function autenticar(usuario, senha, agora = Date.now()) {
  const generico = 'e-mail ou senha incorretos';
  if (!usuario) { return { ok: false, motivo: generico }; }
  if (!usuario.ativo) { return { ok: false, motivo: 'esta conta está desativada' }; }
  if (usuario.bloqueadoAte && new Date(usuario.bloqueadoAte).getTime() > agora) {
    const min = Math.ceil((new Date(usuario.bloqueadoAte).getTime() - agora) / 60000);
    return { ok: false, motivo: `muitas tentativas — tente de novo em ${min} min`, bloqueado: true };
  }
  if (!senhaConfere(senha, usuario.hash, usuario.sal)) {
    const n = (usuario.tentativasFalhas || 0) + 1;
    const bloqueia = n >= 5;
    return {
      ok: false, motivo: generico,
      usuario: { ...usuario, tentativasFalhas: n, bloqueadoAte: bloqueia ? new Date(agora + 15 * 60000).toISOString() : usuario.bloqueadoAte },
    };
  }
  if (usuario.mfaObrigatorio && !usuario.mfaConfigurado) {
    // Não é falha de senha: é acesso interno sem segundo fator.
    return {
      ok: false, exigeMfa: true,
      motivo: 'conta interna exige segundo fator, ainda não configurado',
      usuario: { ...usuario, tentativasFalhas: 0 },
    };
  }
  const { token, hashToken } = novoToken();
  return {
    ok: true,
    token,
    sessao: {
      hashToken,
      usuarioId: usuario.id,
      papel: usuario.papel,
      criadaEm: new Date(agora).toISOString(),
      expiraEm: new Date(agora + SESSAO_HORAS * 3600000).toISOString(),
    },
    usuario: { ...usuario, tentativasFalhas: 0, bloqueadoAte: null, ultimoLogin: new Date(agora).toISOString() },
  };
}

/** A sessão ainda vale? */
export function sessaoValida(sessao, agora = Date.now()) {
  if (!sessao) { return { ok: false, motivo: 'sessão não encontrada' }; }
  if (new Date(sessao.expiraEm).getTime() <= agora) { return { ok: false, motivo: 'sessão expirada — entre de novo' }; }
  return { ok: true };
}

/**
 * Autorização: papel MAIS vínculo. Papel sozinho não basta — um prestador ACTIVE
 * não pode ler a ordem de serviço de outro prestador.
 */
export function autorizado(sessao, { papeis, dono } = {}) {
  if (!sessao) { return { ok: false, motivo: 'não autenticado' }; }
  if (papeis?.length && !papeis.includes(sessao.papel)) {
    return { ok: false, motivo: `seu papel (${sessao.papel}) não tem acesso a isto` };
  }
  // Admin não é exceção ao vínculo por padrão: quem precisa ver tudo declara papel.
  if (dono !== undefined && dono !== sessao.usuarioId) {
    return { ok: false, motivo: 'este recurso é de outra conta' };
  }
  return { ok: true };
}
