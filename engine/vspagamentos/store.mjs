/**
 * VSpagamentos — persistência local. ~/.qa-gate/vspagamentos/.
 *
 * Arquivo 0600 e diretório 0700: aqui ficam chave de API e token de webhook, que
 * dão acesso a dinheiro de verdade.
 *
 * ATENÇÃO: isto é ponte, não destino. Idempotência de webhook em arquivo funciona
 * com UM processo; com duas instâncias, as duas processam o mesmo evento. Quando o
 * Postgres entrar, isto vira UNIQUE(provider_event_id) — igual ao que o
 * backend/idempotencia.mjs já antecipava.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function baseDir() {
  return process.env.VSPAGAMENTOS_DIR || join(homedir(), '.qa-gate', 'vspagamentos');
}

export const filePath = (nome) => join(baseDir(), `${nome}.json`);

export function load(nome, padrao = null) {
  try { return JSON.parse(readFileSync(filePath(nome), 'utf8')); } catch { return padrao; }
}

export function save(nome, dados) {
  const p = filePath(nome);
  mkdirSync(baseDir(), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(dados, null, 2), { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* FS sem modo (Windows) */ }
  return p;
}

export const has = (nome) => existsSync(filePath(nome));

/** Esconde o miolo do segredo pra poder mostrar sem vazar. */
export function mascarar(s) {
  const v = String(s || '');
  if (!v) { return ''; }
  if (v.length <= 8) { return '*'.repeat(v.length); }
  return `${v.slice(0, 4)}${'*'.repeat(Math.min(12, v.length - 8))}${v.slice(-4)}`;
}
