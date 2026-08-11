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
        const out = await runInstall({ whatsapp: dados.whatsapp, email: dados.email, empresa: dados.empresa, produtos: dados.produtos, respostas: dados.respostas });
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

/** Sobe o servidor. Se a porta estiver ocupada, tenta as próximas. Retorna { server, url }. */
export function start(port = 4599, tentativas = 12) {
  const server = createInstallerServer();
  return new Promise((resolve, reject) => {
    let p = port;
    const tryListen = () => {
      server.removeAllListeners('error');
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && p < port + tentativas) { p += 1; tryListen(); }
        else { reject(e); }
      });
      server.listen(p, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${p}` }));
    };
    tryListen();
  });
}
