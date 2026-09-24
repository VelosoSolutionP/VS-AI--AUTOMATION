/**
 * Vitrine — a loja pública do painel.
 *
 * Quem abre é cliente final, quase sempre pelo link que o dono mandou no
 * WhatsApp, quase sempre no celular e quase sempre em rede ruim. Isso define
 * tudo aqui: página montada no servidor, sem framework, sem fonte externa, sem
 * requisição depois do primeiro byte.
 *
 * As metatags Open Graph não são enfeite: sem elas o link colado no WhatsApp
 * aparece como uma URL crua, e ninguém clica em URL crua.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const brl = (centavos) => (Number(centavos || 0) / 100)
  .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Telefone BR em E.164. Sem DDI o link do WhatsApp simplesmente não abre. */
function zap(telefone) {
  const d = String(telefone || '').replace(/\D/g, '');
  if (!d) { return null; }
  return d.startsWith('55') ? d : `55${d}`;
}

function linkWhatsApp(telefone, texto) {
  const d = zap(telefone);
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(texto)}` : null;
}

/** Iniciais pra marca quando não há logo — melhor que um espaço vazio. */
const iniciais = (nome) => String(nome || 'L').trim().split(/\s+/).slice(0, 2)
  .map((p) => p[0]).join('').toUpperCase();

export function pagina(produtos = [], loja = {}) {
  const nome = loja.nome || 'Loja';
  const tel = loja.whatsapp || null;
  const descricao = loja.descricao || `Confira os produtos de ${nome}.`;
  const disponiveis = produtos.filter((p) => !p.esgotado);
  const capa = produtos.find((p) => p.imagem)?.imagem || null;

  // Categorias viram filtro só quando há mais de uma — filtro com uma opção é
  // ruído ocupando a primeira dobra da tela.
  const cats = [...new Set(produtos.map((p) => p.categoria).filter(Boolean))].sort();
  const temFiltro = cats.length > 1;

  const cartao = (p) => {
    const wa = linkWhatsApp(tel, `Olá! Tenho interesse no produto: ${p.nome} (${brl(p.precoCentavos)})`);
    const desconto = p.precoDeCentavos && p.precoDeCentavos > p.precoCentavos
      ? Math.round((1 - p.precoCentavos / p.precoDeCentavos) * 100) : 0;
    const url = `/vitrine/p/${encodeURIComponent(p.sku)}`;
    return `<article class="p${p.esgotado ? ' off' : ''}" data-cat="${esc(p.categoria || '')}">
      <a class="foto" href="${esc(url)}" aria-label="${esc(p.nome)}">
        ${p.imagem
    ? `<img src="${esc(p.imagem)}" alt="${esc(p.nome)}" loading="lazy" decoding="async" onerror="this.closest('.foto').classList.add('vazia');this.remove()">`
    : ''}
        ${p.imagem ? '' : '<span class="semfoto">sem foto</span>'}
        ${desconto > 0 && !p.esgotado ? `<span class="tag-off">−${desconto}%</span>` : ''}
        ${p.esgotado ? '<span class="tag-esg">Esgotado</span>' : ''}
      </a>
      <div class="c">
        ${p.marca ? `<p class="m">${esc(p.marca)}</p>` : ''}
        <h2><a href="${esc(url)}">${esc(p.nome)}</a></h2>
        ${p.descricao ? `<p class="d">${esc(p.descricao)}</p>` : ''}
        <p class="v">${p.precoDeCentavos ? `<s>${brl(p.precoDeCentavos)}</s>` : ''}<b>${brl(p.precoCentavos)}</b></p>
        ${p.esgotado
    ? '<span class="btn off">Esgotado</span>'
    : wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">Quero este</a>`
      : '<span class="btn off" title="a loja ainda não cadastrou o WhatsApp">Consulte a loja</span>'}
      </div></article>`;
  };

  const waGeral = linkWhatsApp(tel, `Olá! Vi a loja ${nome} e quero falar com vocês.`);

  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#18181b" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)">
<title>${esc(nome)}</title>
<meta name="description" content="${esc(descricao)}">
<!-- Sem isto o link colado no WhatsApp vira URL crua, e ninguem clica em URL crua. -->
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(nome)}">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:site_name" content="${esc(nome)}">
${capa ? `<meta property="og:image" content="${esc(capa)}">` : ''}
<meta name="twitter:card" content="${capa ? 'summary_large_image' : 'summary'}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2318181b'/%3E%3Ctext x='16' y='22' font-family='system-ui' font-size='14' font-weight='700' fill='%23fff' text-anchor='middle'%3E${encodeURIComponent(iniciais(nome))}%3C/text%3E%3C/svg%3E">
<style>
:root{
  --bg:#fafafa; --card:#fff; --line:#e4e4e7; --fg:#18181b; --dim:#71717a;
  --ac:#18181b; --ac-fg:#fff; --ok:#15803d; --ok-bg:#f0fdf4; --r:14px;
}
@media(prefers-color-scheme:dark){:root{
  --bg:#09090b; --card:#141417; --line:#27272a; --fg:#fafafa; --dim:#a1a1aa;
  --ac:#fafafa; --ac-fg:#18181b; --ok:#4ade80; --ok-bg:rgba(34,197,94,.12);
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);
  font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}

header{border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:5}
.top{display:flex;align-items:center;gap:12px;padding:14px 0}
.logo{width:42px;height:42px;border-radius:11px;background:var(--ac);color:var(--ac-fg);
  display:grid;place-items:center;font-weight:700;font-size:15px;flex-shrink:0;object-fit:cover}
.marca{flex:1;min-width:0}
.marca h1{margin:0;font-size:17px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.marca p{margin:1px 0 0;color:var(--dim);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zap{display:inline-flex;align-items:center;gap:6px;background:var(--ac);color:var(--ac-fg);
  text-decoration:none;padding:9px 14px;border-radius:10px;font-size:14px;font-weight:600;white-space:nowrap}
.zap svg{width:16px;height:16px}

.filtros{display:flex;gap:7px;overflow-x:auto;padding:0 0 12px;scrollbar-width:none}
.filtros::-webkit-scrollbar{display:none}
.chip{border:1px solid var(--line);background:var(--card);color:var(--dim);border-radius:999px;
  padding:6px 14px;font-size:13px;cursor:pointer;white-space:nowrap;font-family:inherit}
.chip[aria-pressed=true]{background:var(--ac);color:var(--ac-fg);border-color:var(--ac)}

main{padding:18px 0 56px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
@media(max-width:520px){.grid{grid-template-columns:repeat(2,1fr);gap:10px}}

.p{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  overflow:hidden;display:flex;flex-direction:column}
.p.off{opacity:.62}
.foto{position:relative;aspect-ratio:1;background:var(--bg);display:grid;place-items:center;overflow:hidden}
.foto img{width:100%;height:100%;object-fit:cover;display:block}
.semfoto{color:var(--dim);font-size:12.5px}
.tag-off,.tag-esg{position:absolute;top:9px;left:9px;font-size:11.5px;font-weight:700;
  padding:3px 8px;border-radius:999px;letter-spacing:.2px}
.tag-off{background:var(--ok-bg);color:var(--ok)}
.tag-esg{background:var(--fg);color:var(--bg)}
.c{padding:12px;display:flex;flex-direction:column;gap:5px;flex:1}
.m{margin:0;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.c h2{margin:0;font-size:14.5px;line-height:1.35;font-weight:600}
.c h2 a{color:inherit;text-decoration:none}
.d{margin:0;color:var(--dim);font-size:12.5px;line-height:1.45;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.v{margin:4px 0 0;display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}
.v b{font-size:17px}
.v s{color:var(--dim);font-size:13px;font-weight:400}
.btn{margin-top:auto;display:block;text-align:center;background:var(--ac);color:var(--ac-fg);
  text-decoration:none;padding:10px;border-radius:10px;font-weight:600;font-size:14px}
.btn.off{background:transparent;color:var(--dim);border:1px solid var(--line);cursor:default}

.vazio{text-align:center;color:var(--dim);padding:70px 20px}
.vazio b{display:block;color:var(--fg);font-size:17px;margin-bottom:6px}
footer{border-top:1px solid var(--line);color:var(--dim);font-size:12.5px;padding:18px 0 34px;text-align:center}
footer a{color:inherit}
</style></head><body>

<header><div class="wrap top">
  ${loja.logo ? `<img class="logo" src="${esc(loja.logo)}" alt="">` : `<div class="logo">${esc(iniciais(nome))}</div>`}
  <div class="marca"><h1>${esc(nome)}</h1><p>${esc(descricao)}</p></div>
  ${waGeral ? `<a class="zap" href="${esc(waGeral)}" target="_blank" rel="noopener">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.9l-.3-.2-2.5.7.7-2.4-.2-.3A8 8 0 0 1 12 4zm-3.2 4c-.2 0-.5.1-.7.3-.2.3-.8.8-.8 1.9s.8 2.2.9 2.4c.1.2 1.6 2.6 4 3.5 1.9.7 2.3.6 2.7.5.4 0 1.3-.5 1.5-1.1.2-.5.2-1 .1-1.1l-.6-.3-1.4-.7c-.2 0-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5.3-.5v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4z"/></svg>
    Falar</a>` : ''}
</div>
${temFiltro ? `<div class="wrap"><div class="filtros">
  <button class="chip" aria-pressed="true" onclick="filtrar(this,'')">Tudo</button>
  ${cats.map((c) => `<button class="chip" aria-pressed="false" onclick="filtrar(this,'${esc(c)}')">${esc(c)}</button>`).join('')}
</div></div>` : ''}</header>

<main class="wrap">
${produtos.length
    ? `<div class="grid" id="grid">${produtos.map(cartao).join('')}</div>`
    : `<div class="vazio"><b>Ainda não há produtos aqui</b>
        Volte em breve — a loja está montando a vitrine.</div>`}
</main>

<footer class="wrap">
  ${produtos.length ? `${disponiveis.length} de ${produtos.length} produto(s) disponíveis · ` : ''}atualizado em ${new Date().toLocaleDateString('pt-BR')}
  ${waGeral ? `<br><a href="${esc(waGeral)}" target="_blank" rel="noopener">Falar com ${esc(nome)} no WhatsApp</a>` : ''}
</footer>

${temFiltro ? `<script>
/* Filtro no cliente: a vitrine inteira já veio no HTML, e ir ao servidor pra
   esconder card seria pagar uma viagem de rede por um display:none. */
function filtrar(botao,cat){
  document.querySelectorAll('.chip').forEach(function(c){c.setAttribute('aria-pressed',String(c===botao));});
  document.querySelectorAll('#grid .p').forEach(function(p){
    p.style.display=(!cat||p.dataset.cat===cat)?'':'none';
  });
}
</script>` : ''}
</body></html>`;
}


/**
 * A página de UM produto. É ela que o Google exige no feed (link do produto) e
 * confere: preço e disponibilidade daqui têm que bater com os do feed, senão o
 * item é reprovado. Por isso os dois saem do MESMO estoque, no mesmo instante,
 * e a página leva os dados estruturados (schema.org/Product) que o robô lê.
 *
 * Também é o link que o dono cola no status ou na bio: abre com foto no
 * WhatsApp (Open Graph) e o botão já cai na conversa com o bot.
 */
export function paginaProduto(p, loja = {}) {
  const nome = loja.nome || 'Loja';
  const origem = String(loja.origem || '').replace(/\/$/, '');
  const url = `${origem}/vitrine/p/${encodeURIComponent(p.sku)}`;
  const wa = linkWhatsApp(loja.whatsapp, `Olá! Quero pedir: ${p.nome} (${brl(p.precoCentavos)})`);
  const fotos = (p.imagens?.length ? p.imagens : [p.imagem]).filter(Boolean);
  const desconto = p.precoDeCentavos && p.precoDeCentavos > p.precoCentavos
    ? Math.round((1 - p.precoCentavos / p.precoDeCentavos) * 100) : 0;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.nome,
    sku: p.sku,
    ...(p.descricao ? { description: p.descricao } : {}),
    ...(fotos.length ? { image: fotos } : {}),
    ...(p.marca ? { brand: { '@type': 'Brand', name: p.marca } } : {}),
    ...(p.categoria ? { category: p.categoria } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'BRL',
      price: (Number(p.precoCentavos || 0) / 100).toFixed(2),
      availability: p.esgotado ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: nome },
    },
  };
  const desc = p.descricao || `${p.nome} — ${nome}`;
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(p.nome)} — ${esc(nome)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(p.nome)} — ${esc(brl(p.precoCentavos))}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="${esc(nome)}">
${fotos[0] ? `<meta property="og:image" content="${esc(fotos[0])}">` : ''}
<meta name="twitter:card" content="${fotos[0] ? 'summary_large_image' : 'summary'}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
:root{--bg:#fafafa;--card:#fff;--line:#e4e4e7;--fg:#18181b;--dim:#71717a;--ac:#18181b;--ac-fg:#fff;--ok:#15803d;--ok-bg:#f0fdf4;--zap:#128c4a}
@media(prefers-color-scheme:dark){:root{--bg:#09090b;--card:#141417;--line:#27272a;--fg:#fafafa;--dim:#a1a1aa;--ac:#fafafa;--ac-fg:#18181b;--ok:#4ade80;--ok-bg:rgba(34,197,94,.12);--zap:#22c55e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line);background:var(--card)}
header .wrap{display:flex;align-items:center;gap:10px;padding:12px 16px}
header a{color:var(--dim);text-decoration:none;font-size:14px}
header b{font-size:15px}
main{padding:20px 0 60px}
.prod{display:grid;gap:24px;grid-template-columns:1fr 1fr;align-items:start}
@media(max-width:720px){.prod{grid-template-columns:1fr;gap:16px}}
.galeria{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.galeria img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.miniaturas{display:flex;gap:8px;padding:8px;overflow-x:auto}
.miniaturas img{width:64px;height:64px;border-radius:8px;object-fit:cover;cursor:pointer;border:1px solid var(--line)}
.semfoto{aspect-ratio:1;display:grid;place-items:center;color:var(--dim)}
.m{margin:0;color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
h1{margin:4px 0 8px;font-size:26px;line-height:1.2;letter-spacing:-.01em}
.v{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:6px 0 4px}
.v b{font-size:28px}
.v s{color:var(--dim)}
.off{background:var(--ok-bg);color:var(--ok);font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px}
.estoque{font-size:13px;color:var(--dim);margin:0 0 16px}
.estoque.esg{color:#b91c1c;font-weight:600}
.d{color:var(--fg);opacity:.85;white-space:pre-line;margin:0 0 20px}
.pedir{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--zap);color:#fff;text-decoration:none;padding:14px;border-radius:12px;font-weight:700;font-size:16px}
.pedir.desl{background:transparent;color:var(--dim);border:1px solid var(--line)}
.pedir svg{width:20px;height:20px}
.nota{font-size:12.5px;color:var(--dim);margin:10px 0 0;text-align:center}
.voltar{display:inline-block;margin-top:24px;color:var(--dim);font-size:14px}
</style></head><body>
<header><div class="wrap"><a href="/vitrine">← Vitrine</a><span style="color:var(--line)">|</span><b>${esc(nome)}</b></div></header>
<main class="wrap"><div class="prod">
  <div class="galeria">
    ${fotos.length ? `<img id="principal" src="${esc(fotos[0])}" alt="${esc(p.nome)}" decoding="async">` : '<div class="semfoto">sem foto</div>'}
    ${fotos.length > 1 ? `<div class="miniaturas">${fotos.map((f) => `<img src="${esc(f)}" alt="" loading="lazy" onclick="document.getElementById('principal').src=this.src">`).join('')}</div>` : ''}
  </div>
  <div>
    ${p.marca ? `<p class="m">${esc(p.marca)}</p>` : ''}
    <h1>${esc(p.nome)}</h1>
    <div class="v">${p.precoDeCentavos ? `<s>${brl(p.precoDeCentavos)}</s>` : ''}<b>${brl(p.precoCentavos)}</b>${desconto > 0 ? `<span class="off">−${desconto}%</span>` : ''}</div>
    <p class="estoque${p.esgotado ? ' esg' : ''}">${p.esgotado ? 'Esgotado no momento' : 'Disponível'}</p>
    ${p.descricao ? `<p class="d">${esc(p.descricao)}</p>` : ''}
    ${p.esgotado
    ? '<span class="pedir desl">Esgotado</span>'
    : wa ? `<a class="pedir" href="${esc(wa)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.9l-.3-.2-2.5.7.7-2.4-.2-.3A8 8 0 0 1 12 4z"/></svg>Pedir no WhatsApp</a>
          <p class="nota">Abre a conversa com a gente já com este produto na mensagem.</p>`
      : '<span class="pedir desl">Consulte a loja</span>'}
    <a class="voltar" href="/vitrine">Ver todos os produtos</a>
  </div>
</div></main></body></html>`;
}

/** Página de "não está mais aqui" — produto tirado da vitrine não pode dar erro cru. */
export function paginaSumiu(loja = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Produto indisponível — ${esc(loja.nome || 'Loja')}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#fafafa;color:#18181b;padding:16px;text-align:center}
@media(prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}}a{color:inherit}</style></head>
<body><div><h1 style="font-size:20px">Este produto não está mais na vitrine</h1><p><a href="/vitrine">Ver os produtos disponíveis</a></p></div></body></html>`;
}
