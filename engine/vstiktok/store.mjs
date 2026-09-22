/**
 * VStiktok — persistência local. Mesma casa do resto da suíte
 * (~/.qa-gate/vstiktok/<nome>.json), fora de qualquer repositório.
 *
 * Diferença importante pro store do VSinfluence: aqui moram ACCESS TOKENS e
 * app_secret. Por isso o arquivo nasce 0600 e o diretório 0700 — token de Shop dá
 * acesso a produto e pedido de verdade, não é config de tela.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { dentroDaCasa } from '../casa.mjs';
export function baseDir() {
  return process.env.VSTIKTOK_DIR || dentroDaCasa('vstiktok');
}

export function filePath(nome) {
  return join(baseDir(), `${nome}.json`);
}

/** Lê um dataset; arquivo ausente/corrompido devolve o padrão (nunca quebra). */
export function load(nome, padrao = null) {
  try {
    return JSON.parse(readFileSync(filePath(nome), 'utf8'));
  } catch {
    return padrao;
  }
}

/** Grava um dataset com permissão restrita. Devolve o caminho. */
export function save(nome, dados) {
  const p = filePath(nome);
  mkdirSync(baseDir(), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(dados, null, 2), { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* FS sem suporte a modo (Windows) — segue */ }
  return p;
}

export function has(nome) {
  return existsSync(filePath(nome));
}

/**
 * Esconde o miolo de um segredo pra poder mostrar na tela/log sem vazar.
 * Guardar o token é necessário; imprimir inteiro não é.
 */
export function mascarar(segredo) {
  const s = String(segredo || '');
  if (!s) { return ''; }
  if (s.length <= 8) { return '*'.repeat(s.length); }
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}
