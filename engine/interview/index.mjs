/**
 * Entrevista — persistência do perfil. Guarda as respostas por set (empresa, vendas, ...)
 * em ~/.qa-gate/vs-profiles.json (nível máquina/instalação), separado do código.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export function profilesPath() {
  return join(homedir(), '.qa-gate', 'vs-profiles.json');
}

function readAll() {
  try { return JSON.parse(readFileSync(profilesPath(), 'utf8')); } catch { return {}; }
}

/** Salva as respostas de um set. Mescla com o que já existe. */
export function saveProfile(setId, answers) {
  const all = readAll();
  all[setId] = { ...(all[setId] || {}), ...answers, _updatedAt: null };
  const p = profilesPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(all, null, 2));
  return p;
}

/** Lê as respostas de um set (ou {}). */
export function loadProfile(setId) {
  return readAll()[setId] || {};
}

/** True se o perfil do set existe (foi entrevistado). */
export function hasProfile(setId) {
  const p = readAll()[setId];
  return !!p && Object.keys(p).some((k) => k !== '_updatedAt');
}

export { existsSync };
