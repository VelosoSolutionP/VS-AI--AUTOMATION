/**
 * VSmarket — persistência local, em ~/.qa-gate/vsmarket/.
 *
 * PONTE, não destino. O documento de arquitetura é claro: este produto precisa de
 * Postgres no P0, e por cinco motivos concretos (concorrência, transação, unicidade,
 * consulta geográfica e auditoria não editável). Isto aqui existe para o MVP andar e
 * ser visto funcionando — e some quando o banco entrar.
 *
 * Arquivo 0600: guarda hash de senha e documento.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function baseDir() {
  return process.env.VSMARKET_DIR || join(homedir(), '.qa-gate', 'vsmarket');
}

export const filePath = (nome) => join(baseDir(), `${nome}.json`);

export function load(nome, padrao = null) {
  try { return JSON.parse(readFileSync(filePath(nome), 'utf8')); } catch { return padrao; }
}

export function save(nome, dados) {
  const p = filePath(nome);
  mkdirSync(baseDir(), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(dados, null, 2), { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* FS sem modo */ }
  return p;
}

export const has = (nome) => existsSync(filePath(nome));
