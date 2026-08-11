/**
 * Instalador — servidor local. Sobe a UI premium em localhost e trata /install.
 * Só escuta em 127.0.0.1 (nada exposto na rede).
 */
import { createServer } from 'node:http';
import { renderInstaller } from './ui.mjs';
import { runInstall } from './install.mjs';

function body(req) {
  return new Promise((res) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) { req.destroy(); } });
    req.on('end', () => res(b));
  });
}

export function createInstallerServer() {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderInstaller());
      }
      if (req.method === 'POST' && req.url === '/install') {
        const dados = JSON.parse(await body(req) || '{}');
        const out = await runInstall({ email: dados.email, empresa: dados.empresa, produtos: dados.produtos });
        res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(out));
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erros: [String(e.message)] }));
    }
  });
}

/** Sobe o servidor. Retorna { server, url }. */
export function start(port = 4599) {
  const server = createInstallerServer();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${port}` }));
  });
}
