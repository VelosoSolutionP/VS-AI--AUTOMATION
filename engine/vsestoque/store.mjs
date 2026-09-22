/**
 * VSestoque — persistência local, no mesmo padrão do resto da suíte:
 * ~/.qa-gate/vsestoque/<nome>.json, fora de qualquer repositório.
 *
 * Catálogo é dado da EMPRESA (preço, custo, saldo) — não é coisa pra versionar junto
 * com código.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { dentroDaCasa } from '../casa.mjs';
export function baseDir() {
  return process.env.VSESTOQUE_DIR || dentroDaCasa('vsestoque');
}

export function filePath(nome) {
  return join(baseDir(), `${nome}.json`);
}

/** Arquivo ausente ou corrompido devolve o padrão — o módulo nunca quebra por disco. */
export function load(nome, padrao = null) {
  try {
    return JSON.parse(readFileSync(filePath(nome), 'utf8'));
  } catch {
    return padrao;
  }
}

export function save(nome, dados) {
  const p = filePath(nome);
  mkdirSync(baseDir(), { recursive: true });
  writeFileSync(p, JSON.stringify(dados, null, 2));
  return p;
}

export function has(nome) {
  return existsSync(filePath(nome));
}
