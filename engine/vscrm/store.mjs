/**
 * VScrm — persistência local. O cadastro de leads mora em
 * ~/.qa-gate/vscrm/<nome>.json, fora de qualquer repositório.
 *
 * Fora do repo de propósito: lead carrega nome e telefone de cliente real — é dado
 * da MÁQUINA do vendedor, não coisa pra versionar nem subir pro git por descuido.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { dentroDaCasa } from '../casa.mjs';
/** Diretório raiz dos dados do módulo. */
export function baseDir() {
  return process.env.VSCRM_DIR || dentroDaCasa('vscrm');
}

/** Caminho do arquivo de um dataset. */
export function filePath(nome) {
  return join(baseDir(), `${nome}.json`);
}

/**
 * Lê um dataset. Arquivo ausente ou corrompido devolve o padrão — o CRM nunca
 * quebra por causa de disco; no pior caso abre vazio.
 */
export function load(nome, padrao = null) {
  try {
    return JSON.parse(readFileSync(filePath(nome), 'utf8'));
  } catch {
    return padrao;
  }
}

/** Grava um dataset (cria o diretório se preciso). Devolve o caminho. */
export function save(nome, dados) {
  const p = filePath(nome);
  mkdirSync(baseDir(), { recursive: true });
  writeFileSync(p, JSON.stringify(dados, null, 2));
  return p;
}

/** Existe dataset gravado? */
export function has(nome) {
  return existsSync(filePath(nome));
}
