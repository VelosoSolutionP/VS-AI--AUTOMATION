/**
 * Vitrine — a loja pública do painel.
 *
 * O botão "Vender" no estoque precisava ter um destino de verdade. Feed de canal
 * (Google, Meta, TikTok) depende de aprovação e de conta em cada um; vitrine é o
 * que o dono da loja consegue usar HOJE: uma página com link, que ele manda no
 * WhatsApp, cola no Instagram ou imprime num QR.
 *
 * Página estática montada no servidor de propósito: quem abre é cliente final,
 * muitas vezes em rede ruim — SPA pra mostrar seis produtos é castigo.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const brl = (centavos) => (Number(centavos || 0) / 100)
  .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Link de compra no WhatsApp, com o produto já escrito na mensagem. */
function linkWhatsApp(telefone, nome) {
  const d = String(telefone || '').replace(/\D/g, '');
  if (!d) { return null; }
  const texto = encodeURIComponent(`Olá! Tenho interesse no produto: ${nome}`);
  return `https://wa.me/${d.startsWith('55') ? d : '55' + d}?text=${texto}`;
}

export function pagina(produtos = [], loja = {}) {
  const nome = loja.nome || 'Loja';
  const zap = loja.whatsapp || null;

  const cartoes = produtos.map((p) => {
    const wa = linkWhatsApp(zap, p.nome);
    return `<article class="p${p.esgotado ? ' off' : ''}">
      ${p.imagem ? `<img src="${esc(p.imagem)}" alt="${esc(p.nome)}" loading="lazy" onerror="this.remove()">` : '<div class="semfoto">sem foto</div>'}
      <div class="c">
        <h2>${esc(p.nome)}</h2>
        ${p.marca ? `<p class="m">${esc(p.marca)}</p>` : ''}
        <p class="v">${p.precoDeCentavos ? `<s>${brl(p.precoDeCentavos)}</s> ` : ''}<b>${brl(p.precoCentavos)}</b></p>
        ${p.descricao ? `<p class="d">${esc(p.descricao)}</p>` : ''}
        ${p.esgotado
    ? '<span class="esg">Esgotado</span>'
    : wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">Quero este</a>`
      : '<span class="esg">Fale com a loja</span>'}
      </div></article>`;
  }).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(nome)}</title>
<meta name="description" content="${esc(loja.descricao || `Produtos de ${nome}`)}">
<style>
:root{--bg:#fafafa;--card:#fff;--line:#e4e4e7;--fg:#18181b;--dim:#71717a;--ac:#18181b}
@media(prefers-color-scheme:dark){:root{--bg:#09090b;--card:#141417;--line:#27272a;--fg:#fafafa;--dim:#a1a1aa;--ac:#fafafa}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:32px 16px 20px;text-align:center;border-bottom:1px solid var(--line)}
header h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:var(--dim);font-size:14px}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px;
  display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.p{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.p.off{opacity:.55}
.p img,.semfoto{width:100%;height:190px;object-fit:cover;display:block}
.semfoto{display:grid;place-items:center;color:var(--dim);font-size:13px;background:var(--bg)}
.c{padding:14px;display:flex;flex-direction:column;gap:6px;flex:1}
.c h2{margin:0;font-size:15px;line-height:1.35}
.m{margin:0;color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.4px}
.v{margin:2px 0 0;font-size:17px}.v s{color:var(--dim);font-size:13px;font-weight:400}
.d{margin:0;color:var(--dim);font-size:13px}
.btn{margin-top:auto;display:block;text-align:center;background:var(--ac);color:var(--bg);
  text-decoration:none;padding:9px;border-radius:8px;font-weight:600;font-size:14px}
.esg{margin-top:auto;text-align:center;color:var(--dim);font-size:13px;padding:9px}
.vazio{grid-column:1/-1;text-align:center;color:var(--dim);padding:60px 20px}
footer{text-align:center;color:var(--dim);font-size:12px;padding:0 16px 40px}
</style></head><body>
<header><h1>${esc(nome)}</h1><p>${esc(loja.descricao || 'Nossos produtos')}</p></header>
<main>${cartoes || '<p class="vazio">Nenhum produto na vitrine ainda.</p>'}</main>
<footer>${produtos.length} produto(s) · atualizado em ${new Date().toLocaleDateString('pt-BR')}</footer>
</body></html>`;
}
