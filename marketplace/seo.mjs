/**
 * Quebra-Galho — páginas públicas indexáveis (/servicos/:categoria/:cidade).
 *
 * Renderizadas NO SERVIDOR porque buscador precisa do conteúdo no HTML, não depois
 * do JavaScript rodar.
 *
 * A regra que não pode ser quebrada: **a página não inventa disponibilidade.** Se
 * não há eletricista ativo em Betim, ela não diz que há. Prometer profissional que
 * não existe gera pedido que ninguém atende, cliente frustrado e canal queimado —
 * e ainda é propaganda enganosa. A página converte assim mesmo: registra o pedido e
 * avisa com honestidade que a região está em expansão.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Cidades da região do MVP. Fora daqui a página existe, mas avisa que é expansão. */
export const CIDADES = [
  'Belo Horizonte', 'Contagem', 'Betim', 'Nova Lima', 'Sabará',
  'Ribeirão das Neves', 'Santa Luzia', 'Ibirité', 'Vespasiano', 'Lagoa Santa',
];

/** Todas as combinações — é o mapa do site. */
export function rotas(categorias = []) {
  const out = [];
  for (const c of categorias) {
    for (const cid of CIDADES) { out.push(`/servicos/${slug(c.nome)}/${slug(cid)}`); }
  }
  return out;
}

export function acharCategoria(categorias, s) {
  return categorias.find((c) => slug(c.nome) === s || c.id === s) || null;
}
export function acharCidade(s) {
  return CIDADES.find((c) => slug(c) === s) || null;
}

/**
 * Conta quem REALMENTE atende. Sem maquiagem: conta prestador ACTIVE cuja cobertura
 * declarada inclui a cidade.
 */
export function quemAtende(prestadores = [], categoriaId, cidade) {
  const alvo = slug(cidade);
  return prestadores.filter((p) => p.status === 'ACTIVE'
    && (p.categorias || []).includes(categoriaId)
    && (p.cidades || []).some((c) => slug(c) === alvo));
}

export function sitemap(categorias, origem) {
  const hoje = new Date().toISOString().slice(0, 10);
  const urls = ['/'].concat(rotas(categorias))
    .map((u) => `  <url><loc>${esc(origem + u)}</loc><lastmod>${hoje}</lastmod><changefreq>weekly</changefreq></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robots(origem) {
  return `User-agent: *\nAllow: /\nSitemap: ${origem}/sitemap.xml\n`;
}

/**
 * A página. Recebe a contagem REAL e escreve o texto de acordo — nunca o contrário.
 */
export function pagina({ categoria, cidade, prestadores = [], origem = '' }) {
  const n = prestadores.length;
  const titulo = `${categoria.nome} em ${cidade}`;
  const url = `${origem}/servicos/${slug(categoria.nome)}/${slug(cidade)}`;

  // O texto MUDA conforme a realidade. Esta é a parte que não se negocia.
  // "profissional" faz plural em "profissionais": cai o L. Concordância errada numa
  // página pública passa a impressão de site automático — que é o oposto do que
  // "confiança" pede.
  const plural = n > 1;
  const chamada = n > 0
    ? `${n} ${plural ? 'profissionais' : 'profissional'} de ${categoria.nome.toLowerCase()} ${plural ? 'atendem' : 'atende'} ${cidade} pelo Quebra-Galho.`
    : `Ainda estamos formando a rede de ${categoria.nome.toLowerCase()} em ${cidade}.`;
  const subtexto = n > 0
    ? 'Descreva o que precisa e receba propostas com preço, prazo e avaliação.'
    : 'Você pode registrar seu pedido: assim que um profissional da região entrar, ele recebe. Não prometemos prazo que não podemos cumprir.';

  const media = prestadores.filter((p) => p.reputacao != null);
  const nota = media.length ? (media.reduce((a, p) => a + p.reputacao, 0) / media.length).toFixed(1) : null;
  const totalServicos = prestadores.reduce((a, p) => a + (p.servicosConcluidos || 0), 0);

  // Dados estruturados só com o que existe de verdade.
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: categoria.nome,
    name: titulo,
    areaServed: { '@type': 'City', name: cidade },
    provider: { '@type': 'Organization', name: 'Quebra-Galho', url: origem || undefined },
    ...(nota && totalServicos ? {
      aggregateRating: { '@type': 'AggregateRating', ratingValue: nota, reviewCount: totalServicos, bestRating: '5' },
    } : {}),
  };

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} | Quebra-Galho</title>
<meta name="description" content="${esc(chamada + ' ' + subtexto)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:title" content="${esc(titulo)} | Quebra-Galho">
<meta property="og:description" content="${esc(chamada)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
:root{--laranja:#F4511E;--tinta:#1C1917;--tinta2:#57534E;--papel:#FFFDFB;--cartao:#fff;--linha:#EDE9E6}
*{box-sizing:border-box}
body{margin:0;background:var(--papel);color:var(--tinta);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.w{max-width:680px;margin:0 auto;padding:20px 16px 60px}
.topo{display:flex;gap:9px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--linha)}
.qg{width:34px;height:34px;border-radius:10px;background:var(--laranja);color:#fff;display:grid;place-items:center;font-weight:800;font-size:15px}
h1{font-size:28px;line-height:1.2;letter-spacing:-.02em;margin:18px 0 10px}
h2{font-size:19px;margin:28px 0 10px}
a.cta{display:block;text-align:center;background:var(--laranja);color:#fff;text-decoration:none;
  padding:16px;border-radius:10px;font-weight:700;font-size:16px;margin:20px 0;min-height:52px}
.card{background:var(--cartao);border:1px solid var(--linha);border-radius:14px;padding:16px;margin-bottom:10px}
.dim{color:var(--tinta2);font-size:14px}
ul{padding-left:20px}
nav a{color:var(--tinta2);font-size:13px;text-decoration:none;margin-right:10px;white-space:nowrap}
.aviso{background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:14px;margin:16px 0}
</style>
</head>
<body>
<header class="topo"><div class="qg">QG</div><b>Quebra-Galho</b><span class="dim">· Precisou, chamou, resolveu.</span></header>
<main class="w">
  <h1>${esc(titulo)}</h1>
  <p><strong>${esc(chamada)}</strong></p>
  <p class="dim">${esc(subtexto)}</p>
  <a class="cta" href="/#pedido">Pedir orçamento de ${esc(categoria.nome.toLowerCase())}</a>
  ${n === 0 ? `<div class="aviso"><b>Transparência:</b> no momento não temos profissional de
    ${esc(categoria.nome.toLowerCase())} com atendimento declarado em ${esc(cidade)}. Preferimos dizer isso
    a prometer o que não podemos entregar.</div>` : ''}

  ${n > 0 ? `<h2>Profissionais que atendem ${esc(cidade)}</h2>
    ${prestadores.slice(0, 6).map((p) => `<div class="card">
      <b>${esc(p.nome)}</b>
      <div class="dim">${p.reputacao != null ? `★ ${p.reputacao} · ${p.servicosConcluidos} serviços concluídos` : 'Novo no Quebra-Galho'}</div>
      ${p.descricao ? `<p class="dim">${esc(p.descricao)}</p>` : ''}
    </div>`).join('')}` : ''}

  <h2>Como funciona</h2>
  <ul>
    <li>Você conta o que precisa. É grátis.</li>
    <li>Profissionais da região enviam propostas.</li>
    <li>Você compara preço, prazo e avaliação.</li>
    <li>Contrata e paga pela plataforma.</li>
    <li>Avalia no final.</li>
  </ul>
  <p class="dim">Você não paga para procurar, e o profissional não paga para disputar seu pedido.</p>
  <a class="cta" href="/">Começar meu pedido</a>

  <h2>${esc(categoria.nome)} em outras cidades</h2>
  <nav>${CIDADES.filter((c) => c !== cidade).map((c) =>
    `<a href="/servicos/${slug(categoria.nome)}/${slug(c)}">${esc(c)}</a>`).join('')}</nav>
</main>
</body>
</html>`;
}

export { slug };
