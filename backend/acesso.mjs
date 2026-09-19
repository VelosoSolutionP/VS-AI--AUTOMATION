/**
 * Acesso ao console — a senha que o cliente define na própria tela.
 *
 * Antes só existia CRM_TOKEN, variável de ambiente. Isso funciona para quem
 * sobe o servidor pela linha de comando e é inútil para quem comprou uma
 * licença: o cliente abre o console, cai num campo de senha e não tem como
 * descobrir nem criar a senha sem abrir um terminal. Produto que exige
 * terminal para o primeiro login não tem primeiro login.
 *
 * Como fica:
 *   - sem senha definida  -> o console pede para CRIAR uma (primeiro acesso)
 *   - com senha definida  -> login normal
 *   - CRM_TOKEN definido  -> continua valendo, para quem já subia assim
 *
 * A senha é guardada como hash scrypt com sal por instalação, em
 * ~/.qa-gate/console/acesso.json (mesma convenção das outras engines).
 * Guardar em texto puro num arquivo de config seria trocar "não tem senha"
 * por "tem senha e está escrita ao lado da porta".
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const ARQUIVO = () =>
  process.env.VSCONSOLE_ACESSO || join(homedir(), '.qa-gate', 'console', 'acesso.json');

export const MIN_SENHA = 8;

function ler() {
  try {
    const d = JSON.parse(readFileSync(ARQUIVO(), 'utf8'));
    return d && d.hash && d.sal ? d : null;
  } catch { return null; }
}

function gravar(d) {
  const arq = ARQUIVO();
  mkdirSync(dirname(arq), { recursive: true });
  writeFileSync(arq, JSON.stringify(d, null, 2), 'utf8');
  // 0600: o arquivo guarda hash, não senha, mas sal e parâmetros também não
  // precisam circular. Em máquina compartilhada isso é a diferença entre
  // "difícil" e "é só copiar e atacar offline".
  try { chmodSync(arq, 0o600); } catch { /* sistema sem suporte a modo */ }
}

const derivar = (senha, sal) => scryptSync(String(senha), Buffer.from(sal, 'hex'), 32);

/** Já existe alguma forma de entrar? */
export const temSenha = () => Boolean(ler()) || Boolean(process.env.CRM_TOKEN);

/** É o primeiro acesso — ninguém definiu senha ainda. */
export const precisaCriar = () => !temSenha();

/** Quando a senha foi definida, e por qual caminho. Só metadado, sem segredo. */
export function estado() {
  const d = ler();
  return {
    precisaCriar: precisaCriar(),
    exigeSenha: temSenha(),
    definidaEm: d?.criado_em ?? null,
    // Serve para a tela avisar que a senha do ambiente manda: quem sobe com
    // CRM_TOKEN e depois "cria" outra ficaria sem entender por que a nova
    // não entra.
    porAmbiente: Boolean(process.env.CRM_TOKEN)
  };
}

/**
 * Define a senha. Só no primeiro acesso: sem isso, qualquer um que abrisse a
 * URL trocaria a senha de um console já configurado.
 */
export function criar(senha) {
  if (temSenha()) { throw Object.assign(new Error('o console já tem uma senha definida'), { code: 409 }); }
  const s = String(senha ?? '');
  if (s.length < MIN_SENHA) {
    throw Object.assign(new Error(`a senha precisa de pelo menos ${MIN_SENHA} caracteres`), { code: 422 });
  }
  const sal = randomBytes(16).toString('hex');
  gravar({ v: 1, sal, hash: derivar(s, sal).toString('hex'), criado_em: new Date().toISOString() });
  return true;
}

/** Confere a senha. Aceita a do ambiente e a definida na tela. */
export function confere(senha) {
  const s = String(senha ?? '');
  if (!s) { return false; }

  const env = process.env.CRM_TOKEN || '';
  if (env) {
    const A = Buffer.from(s, 'utf8'), B = Buffer.from(env, 'utf8');
    if (A.length === B.length && timingSafeEqual(A, B)) { return true; }
  }

  const d = ler();
  if (!d) { return false; }
  const esperado = Buffer.from(d.hash, 'hex');
  const veio = derivar(s, d.sal);
  return esperado.length === veio.length && timingSafeEqual(esperado, veio);
}

/** Troca a senha de dentro do console, com a atual na mão. */
export function trocar(atual, nova) {
  if (!confere(atual)) { throw Object.assign(new Error('senha atual incorreta'), { code: 401 }); }
  const s = String(nova ?? '');
  if (s.length < MIN_SENHA) {
    throw Object.assign(new Error(`a senha precisa de pelo menos ${MIN_SENHA} caracteres`), { code: 422 });
  }
  const sal = randomBytes(16).toString('hex');
  gravar({ v: 1, sal, hash: derivar(s, sal).toString('hex'), criado_em: new Date().toISOString() });
  return true;
}

export const caminhoArquivo = ARQUIVO;
