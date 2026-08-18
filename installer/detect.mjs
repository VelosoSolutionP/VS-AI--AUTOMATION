/**
 * Instalador — detecta a IDE / ferramenta de IA que o cliente usa, pra instalar o
 * MCP no lugar certo. Todas usam o bloco `mcpServers` num JSON.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Ferramentas conhecidas: pasta-sonda + arquivo de config MCP (relativo ao HOME).
 * `settings` é o arquivo que aceita o bloco `hooks` — hoje só o Claude Code tem esse
 * contrato, e num arquivo DIFERENTE do MCP (.claude/settings.json vs .claude.json).
 */
export const TOOLS = [
  { tool: 'Claude Code', probe: '.claude', config: '.claude.json', settings: '.claude/settings.json' },
  { tool: 'Cursor', probe: '.cursor', config: '.cursor/mcp.json', settings: null },
  { tool: 'Windsurf', probe: '.codeium/windsurf', config: '.codeium/windsurf/mcp_config.json', settings: null },
  { tool: 'Cline (VS Code)', probe: '.vscode', config: '.vscode/mcp.json', settings: null },
];

/** Puro: dado um HOME e um verificador de existência, retorna as ferramentas achadas. */
export function detectFromHome(home, exists = existsSync) {
  return TOOLS
    .filter((t) => exists(join(home, t.probe)))
    .map((t) => ({
      tool: t.tool,
      configPath: join(home, t.config),
      settingsPath: t.settings ? join(home, t.settings) : null,
    }));
}

/** Detecta na máquina atual. */
export function detect() {
  return detectFromHome(homedir());
}
