#!/usr/bin/env node
/**
 * Instalador — CLI. Sobe a tela premium no navegador pra o cliente marcar o que
 * instalar. `vs-install` (bin).
 */
import { spawn } from 'node:child_process';
import { start } from './server.mjs';

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* abre manual */ }
}

const port = Number(process.env.VS_INSTALLER_PORT || 4599);
const { url } = await start(port);
console.log(`\n  VelosoSolution — instalador premium`);
console.log(`  Abra no navegador: ${url}\n`);
if (!process.env.VS_INSTALLER_NO_OPEN) { openBrowser(url); }
