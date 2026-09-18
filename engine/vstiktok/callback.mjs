/**
 * VStiktok — receptor do callback OAuth.
 *
 * Sobe um HTTP local que só existe durante a conexão: a TikTok redireciona o
 * navegador pra cá (via túnel), a gente pega o `code` e mata o servidor. Nada fica
 * escutando depois.
 *
 * Detalhe que custa tempo quando não se sabe: a família `business` devolve o
 * parâmetro como `auth_code`, enquanto `open` e `shop` devolvem `code`. Quem espera
 * só por `code` fica olhando pra uma tela em branco sem entender.
 */
import { createServer } from 'node:http';
import { PING } from './tunel.mjs';

export const CAMINHO = '/tiktok/callback';

/** O nome do parâmetro muda por família — aceitar os dois evita o silêncio. */
export function extrairCode(params) {
  return params.get('code') || params.get('auth_code') || null;
}

function pagina(titulo, mensagem, ok) {
  const cor = ok ? '#16a34a' : '#dc2626';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b0b0c;color:#e5e5e5;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:32rem;padding:2rem;text-align:center">
<div style="font-size:3rem;color:${cor}">${ok ? '✓' : '✖'}</div>
<h1 style="font-size:1.25rem;margin:.5rem 0">${titulo}</h1>
<p style="color:#a1a1aa;line-height:1.5">${mensagem}</p>
</div></body></html>`;
}

/**
 * Sobe o receptor. Devolve `esperar(familia)`, que resolve quando o callback daquela
 * família chega.
 *
 * @param {{porta?:number}} [opts]  porta 0 = o SO escolhe uma livre
 */
export function servidorCallback(opts = {}) {
  const pendentes = new Map();
  const recebidos = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const html = (codigo, corpo) => {
      res.writeHead(codigo, { 'content-type': 'text/html; charset=utf-8' });
      res.end(corpo);
    };

    // Ping do tunel: é como `abrirTunel` prova que a URL publica chega ATE AQUI,
    // antes de o usuario colar esse endereco no painel da TikTok.
    if (url.pathname === PING) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('pong');
    }

    if (!url.pathname.startsWith(CAMINHO)) {
      return html(404, pagina('Rota desconhecida', 'Este servidor só existe pra receber o retorno da TikTok.', false));
    }

    const familia = url.pathname.slice(CAMINHO.length).replace(/^\//, '') || 'open';
    const erro = url.searchParams.get('error');
    const code = extrairCode(url.searchParams);
    const state = url.searchParams.get('state');

    const resultado = erro
      ? { ok: false, familia, motivo: url.searchParams.get('error_description') || erro }
      : (code ? { ok: true, familia, code, state } : { ok: false, familia, motivo: 'a TikTok voltou sem code' });

    recebidos.set(familia, resultado);
    const espera = pendentes.get(familia);
    if (espera) { pendentes.delete(familia); espera(resultado); }

    if (resultado.ok) {
      return html(200, pagina('Conta conectada', 'Pode fechar esta aba e voltar pro terminal — o resto é comigo.', true));
    }
    return html(400, pagina('Não deu', `A TikTok recusou: ${resultado.motivo}. Volte pro terminal.`, false));
  });

  return new Promise((resolve) => {
    server.on('error', (e) => resolve({ ok: false, motivo: `nao consegui abrir a porta: ${e.message}` }));
    server.listen(opts.porta ?? 0, '127.0.0.1', () => {
      const porta = server.address().port;
      resolve({
        ok: true,
        porta,
        caminho: (familia) => `${CAMINHO}/${familia}`,
        fechar: () => new Promise((r) => server.close(r)),
        /** Espera o callback de uma família (ou devolve na hora, se já chegou). */
        esperar(familia, timeoutMs = 300000) {
          if (recebidos.has(familia)) { return Promise.resolve(recebidos.get(familia)); }
          return new Promise((r) => {
            const t = setTimeout(() => {
              pendentes.delete(familia);
              r({ ok: false, familia, motivo: `ninguem autorizou em ${Math.round(timeoutMs / 60000)} min — rode de novo` });
            }, timeoutMs);
            pendentes.set(familia, (v) => { clearTimeout(t); r(v); });
          });
        },
      });
    });
  });
}
