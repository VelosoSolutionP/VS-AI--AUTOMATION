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
try {
  const { url } = await start(port);
  console.log(`\n  VelosoSolution — instalador premium`);
  console.log(`  >> Abra no navegador: ${url}`);
  console.log('  (deixe esta janela aberta; feche pra parar o servidor)\n');
  if (!process.env.VS_INSTALLER_NO_OPEN) { openBrowser(url); }
} catch (e) {
  console.error('\n  ✖ Não consegui subir o instalador: ' + (e?.message || e));
  console.error('  Dica: feche outras janelas do instalador ou rode com outra porta:');
  console.error('        VS_INSTALLER_PORT=4700 node installer/cli.mjs\n');
  process.exit(1);
}
