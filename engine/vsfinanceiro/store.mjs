/** Persistência do financeiro. Mesma casa do resto (~/.qa-gate/vsfinanceiro). */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { dentroDaCasa } from '../casa.mjs';
export const baseDir = () => process.env.VSFINANCEIRO_DIR || dentroDaCasa('vsfinanceiro');
export const filePath = (nome) => join(baseDir(), `${nome}.json`);

export function load(nome, padrao = null) {
  try { return JSON.parse(readFileSync(filePath(nome), 'utf8')); } catch { return padrao; }
}
export function save(nome, dados) {
  mkdirSync(baseDir(), { recursive: true, mode: 0o700 });
  writeFileSync(filePath(nome), JSON.stringify(dados, null, 2), { mode: 0o600 });
  return filePath(nome);
}
export const has = (nome) => existsSync(filePath(nome));
