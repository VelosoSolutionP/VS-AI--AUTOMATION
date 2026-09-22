/**
 * VSinfluence — persistência local. Tudo do módulo (agenda, publicações, campanhas,
 * métricas, ganhos, lives) mora em ~/.qa-gate/vsinfluence/<nome>.json.
 *
 * Fora de qualquer repositório de propósito: o cadastro é da MÁQUINA do criador e
 * carrega caminho de pasta e ID de canal — não é coisa pra versionar.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { dentroDaCasa } from '../casa.mjs';
/** Diretório raiz dos dados do módulo. */
export function baseDir() {
  return process.env.VSINFLUENCE_DIR || dentroDaCasa('vsinfluence');
}

/** Caminho do arquivo de um dataset. */
export function filePath(nome) {
  return join(baseDir(), `${nome}.json`);
}

/**
 * Lê um dataset. Arquivo ausente ou corrompido devolve o padrão — o módulo nunca
 * quebra por causa de disco; no pior caso opera vazio.
 * @param {string} nome
 * @param {*} [padrao]
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
