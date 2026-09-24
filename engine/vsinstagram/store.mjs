/**
 * VSinstagram — persistência local (~/.qa-gate/vsinstagram/*.json).
 *
 * Aqui moram ACCESS TOKENS de página, que dão acesso a publicar em nome do
 * cliente. Nasce 0600/0700 pelo mesmo motivo do VStiktok: isto não é config de
 * tela, é credencial que move a conta de outra pessoa.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { dentroDaCasa } from '../casa.mjs';
export const baseDir = () => process.env.VSINSTAGRAM_DIR || dentroDaCasa('vsinstagram');
export const filePath = (nome) => join(baseDir(), `${nome}.json`);

export function load(nome, padrao = null) {
  try { return JSON.parse(readFileSync(filePath(nome), 'utf8')); } catch { return padrao; }
}

export function save(nome, dados) {
  mkdirSync(baseDir(), { recursive: true, mode: 0o700 });
  writeFileSync(filePath(nome), JSON.stringify(dados, null, 2), { mode: 0o600 });
  return filePath(nome);
}
