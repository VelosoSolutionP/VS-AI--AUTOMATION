/**
 * Instalador — escreve o servidor MCP da suite no config da ferramenta detectada.
 * Merge não-destrutivo: preserva os outros mcpServers do cliente.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SERVER_NAME = 'veloso-solution';

/** Monta a entrada do servidor MCP apontando pro server.mjs instalado. */
export function serverEntry(serverPath, license) {
  return {
    command: 'node',
    args: [serverPath],
    env: { QA_GATE_LICENSE: license || '${QA_GATE_LICENSE}' },
  };
}

/** Puro: mescla a entrada no objeto de config, preservando o resto. */
export function mergeServer(config, entry, name = SERVER_NAME) {
  const c = config && typeof config === 'object' ? { ...config } : {};
  c.mcpServers = { ...(c.mcpServers || {}), [name]: entry };
  return c;
}

/** Lê (ou cria) o config da ferramenta, mescla e grava. Retorna { path, servidor }. */
export function installIntoTool(configPath, entry, name = SERVER_NAME) {
  let current = {};
  try { current = JSON.parse(readFileSync(configPath, 'utf8')); } catch { current = {}; }
  const merged = mergeServer(current, entry, name);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return { path: configPath, servidor: name };
}
