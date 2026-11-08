import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { estudarHtml, textoDoHtml, urlPermitida } from '../vsmapa/estudar.mjs';
import { documento as validarDocumento } from '../vsclientes/ofertas.mjs';

const BUSCADORES = [
  {
    nome: 'Google Search',
    criarUrl: (consulta) => `https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(consulta)}`,
    extrair: extrairResultadosGoogle,
  },
  {
    nome: 'Bing',
    criarUrl: (consulta) => `https://www.bing.com/search?q=${encodeURIComponent(consulta)}`,
    extrair: extrairResultadosBing,
  },
  /* Reserva: quando Google e Bing limitam por excesso de buscas (403/429), o
     Yahoo costuma seguir respondendo. */
  {
    nome: 'Yahoo',
    criarUrl: (consulta) => `https://search.yahoo.com/search?p=${encodeURIComponent(consulta)}`,
    extrair: extrairResultadosYahoo,
  },
];
const executar = promisify(execFile);
const MAX_HTML_BYTES = 1_500_000;
const MAX_RESULTADOS = 8;
const MAX_FONTES = 6;
const MAX_FONTES_EMPRESA = 4;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

function decodificarAtributo(texto) {
  return textoDoHtml(texto.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'"));
}

function textoDoBloco(html) {
  return textoDoHtml(html)
    .replace(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairResultadosGoogle(markdown) {
  const resultados = [];
  for (const correspondencia of markdown.matchAll(/\[([^\]]{0,180})\]\((https:\/\/www\.google\.com\/goto\?url=[^)]+)\)/gi)) {
    const url = decodificarAtributo(correspondencia[2]);
    try {
      const destino = new URL(url);
      if (destino.hostname !== 'www.google.com' || destino.pathname !== '/goto' || !urlPermitida(url)) continue;
    } catch {
      continue;
    }
    const contexto = markdown.slice(Math.max(0, correspondencia.index - 900), correspondencia.index);
    const resumo = textoDoBloco(contexto).slice(-700);
    resultados.push({
      url,
      titulo: textoDoBloco(correspondencia[1]).replace(/\+\d+$/, '').slice(0, 180),
      resumo,
    });
    if (resultados.length >= MAX_RESULTADOS) break;
  }
  return resultados;
}

function extrairResultadosBing(html) {
  const resultados = [];
  for (const correspondencia of html.matchAll(/<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>)/gi)) {
    const bloco = correspondencia[0];
    const ancora = bloco.match(/<h2[^>]*>\s*<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!ancora) continue;
    let url = decodificarAtributo(ancora[1]);
    try {
      const resultadoBing = new URL(url);
      if (resultadoBing.hostname === 'www.bing.com' && resultadoBing.pathname === '/ck/a') {
        const destino = resultadoBing.searchParams.get('u') || '';
        url = destino.startsWith('a1')
          ? Buffer.from(destino.slice(2), 'base64').toString('utf8')
          : destino;
      }
    } catch {
      continue;
    }
    const titulo = textoDoBloco(ancora[2]).slice(0, 180);
    const resumo = textoDoBloco(bloco).replace(titulo, '').slice(0, 900);
    if (titulo && urlPermitida(url)) resultados.push({ url, titulo, resumo });
    if (resultados.length >= MAX_RESULTADOS) break;
  }
  return resultados;
}

function extrairResultadosYahoo(html) {
  const resultados = [];
  for (const correspondencia of html.matchAll(/<div class="dd [^"]*algo-sr[^"]*"[\s\S]*?(?=<div class="dd |<\/ol>|$)/gi)) {
    const bloco = correspondencia[0];
    const link = bloco.match(/href="(https:\/\/r\.search\.yahoo\.com\/[^"]+)"/i);
    const destino = link && link[1].match(/\/RU=([^/]+)\//);
    if (!destino) continue;
    let url;
    try { url = decodeURIComponent(destino[1]); new URL(url); } catch { continue; }
    if (/(^|\.)yahoo\.com$/i.test(new URL(url).hostname)) continue;
    const tituloHtml = bloco.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const titulo = textoDoBloco(decodificarAtributo(tituloHtml ? tituloHtml[1] : '')).slice(0, 180);
    const trecho = bloco.match(/class="compText[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const resumo = textoDoBloco(decodificarAtributo(trecho ? trecho[1] : '')).slice(0, 900);
    if (titulo && urlPermitida(url)) resultados.push({ url, titulo, resumo });
    if (resultados.length >= MAX_RESULTADOS) break;
  }
  return resultados;
}

async function lerRespostaLimitada(resposta, maxBytes) {
  const tamanhoDeclarado = Number(resposta.headers?.get?.('content-length') || 0);
  if (tamanhoDeclarado > maxBytes) throw new Error('página acima do limite de tamanho');
  if (!resposta.body?.getReader) {
    const texto = await resposta.text();
    if (Buffer.byteLength(texto) > maxBytes) throw new Error('página acima do limite de tamanho');
    return texto;
  }

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let bytes = 0;
  let texto = '';
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await leitor.cancel();
      throw new Error('página acima do limite de tamanho');
    }
    texto += decodificador.decode(value, { stream: true });
  }
  return texto + decodificador.decode();
}

async function buscarHtml(url, fetchFn, { maxBytes = MAX_HTML_BYTES, timeoutMs = 10_000 } = {}) {
  let atual = url;
  for (let redirecionamento = 0; redirecionamento <= 3; redirecionamento++) {
    const permitida = urlPermitida(atual);
    if (!permitida || !permitida.startsWith('https://')) throw new Error('endereço HTTPS não permitido');
    const destino = new URL(permitida);
    if (destino.username || destino.password) throw new Error('credenciais embutidas na URL não são permitidas');

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const resposta = await fetchFn(permitida, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.6',
        },
        redirect: 'manual',
        signal: controlador.signal,
      });
      if ([301, 302, 303, 307, 308].includes(resposta.status)) {
        if (redirecionamento === 3) throw new Error('muitos redirecionamentos');
        const localizacao = resposta.headers?.get?.('location');
        if (!localizacao) throw new Error('redirecionamento sem destino');
        atual = new URL(localizacao, permitida).toString();
        continue;
      }
      if (!resposta.ok) throw new Error(`respondeu ${resposta.status}`);
      const tipo = resposta.headers?.get?.('content-type') || '';
      if (tipo && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(tipo)) {
        throw new Error('formato de página não suportado para leitura');
      }
      return { html: await lerRespostaLimitada(resposta, maxBytes), url: permitida };
    } finally {
      clearTimeout(temporizador);
    }
  }
  throw new Error('não foi possível abrir o endereço');
}

async function resolverDestinoPesquisa(url, fetchFn) {
  let atual = url;
  for (let redirecionamento = 0; redirecionamento <= 3; redirecionamento++) {
    const permitida = urlPermitida(atual);
    if (!permitida || !permitida.startsWith('https://')) throw new Error('destino da pesquisa não permitido');
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 10_000);
    try {
      const resposta = await fetchFn(permitida, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'manual',
        signal: controlador.signal,
      });
      if ([301, 302, 303, 307, 308].includes(resposta.status)) {
        if (redirecionamento === 3) throw new Error('muitos redirecionamentos');
        const localizacao = resposta.headers?.get?.('location');
        if (!localizacao) throw new Error('redirecionamento sem destino');
        atual = new URL(localizacao, permitida).toString();
        if (resposta.body?.cancel) await resposta.body.cancel();
        continue;
      }
      if (!resposta.ok) throw new Error(`respondeu ${resposta.status}`);
      if (resposta.body?.cancel) await resposta.body.cancel();
      return permitida;
    } finally {
      clearTimeout(temporizador);
    }
  }
  throw new Error('não foi possível resolver o destino da pesquisa');
}

function tipoFonte(url, consulta) {
  const pagina = new URL(url);
  const host = pagina.hostname.toLowerCase();
  const caminho = pagina.pathname.toLowerCase();
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)gov\.[a-z]{2,}$|(^|\.)edu\.[a-z]{2,}$|(^|\.)ac\.[a-z]{2,}$|(^|\.)gov$|(^|\.)edu$/.test(host)) return 'site-oficial';
  if (/(^|\.)docs?\./.test(host) || /\/(docs?|documentation|documentacao|manual|standards)(\/|$)/.test(caminho)) return 'documentacao';
  if (/(reddit\.com|stackexchange\.com|stackoverflow\.com|quora\.com|discourse|forum|community)/.test(host + caminho)) return 'comunidade-forum';
  if (/blog|medium\.com|substack\.com/.test(host + caminho) || /\/(r|resources?|guides?|articles?)\//.test(caminho)) return 'blog-especializado';
  if (/youtube/.test(consulta) && /youtube\.com|youtu\.be/.test(host)) return 'youtube';
  /* Página relevante do setor que não é governo, documentação, fórum, blog
     nem vídeo (portal, guia, marketplace, empresa do ramo): conta como fonte
     do setor. Sem isso, nicho comum (faxina, açaí, oficina) nunca fechava. */
  return 'site-do-setor';
}

function normalizarTermos(texto) {
  return String(texto || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((termo) => termo.length > 2 && !['empresa', 'comercio', 'comercial', 'ltda', 'me', 'epp'].includes(termo));
}

function resultadoRelevante(resultado, termosBusca, minimoEncontrado = 1) {
  const termos = [...new Set(termosBusca.flatMap(normalizarTermos))];
  if (!termos.length) return false;
  const texto = `${resultado.titulo} ${resultado.resumo} ${resultado.url}`.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  /* Radical tolera erro de digitação/flexão ("faxineura" acha "faxineira";
     "advogado" acha "advogados"): o buscador já corrige a consulta. */
  const casa = (termo) => texto.includes(termo) || (termo.length >= 6 && texto.includes(termo.slice(0, Math.max(5, termo.length - 3))));
  const encontrados = termos.filter(casa).length;
  return encontrados >= Math.min(minimoEncontrado, termos.length);
}

/*
 * Qualquer nicho tem de render fontes: a busca é em português e em várias
 * frentes (o que é, como funciona, dúvidas de clientes, guia do setor) antes da
 * consulta técnica de normas/documentação. A empresa, quando informada, é um
 * parâmetro a mais: site, redes e avaliações dela entram como presença digital.
 */
/* A página fala mesmo do nicho? Pelo menos 60% das palavras dele, em algum dos
   nomes informados, com tolerância de radical. Um termo só ("assistente")
   deixava entrar Google Assistant e previsão de pôr do sol. */
export function falaDoNicho(texto, nomes, proporcao = 0.6) {
  const alvo = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return nomes.map(normalizarTermos).filter((t) => t.length).some((termos) => {
    const achados = [...new Set(termos)].filter((t) => alvo.includes(t) || (t.length >= 6 && alvo.includes(t.slice(0, Math.max(5, t.length - 3))))).length;
    return achados >= Math.ceil(new Set(termos).size * proporcao);
  });
}
const SITE_BUSCA = /(^|\.)google(\.[a-z.]+)?$|(^|\.)bing\.com$/i;
const SITE_GENERICO = /(^|\.)google$|(^|\.)(google|apple|microsoft|amazon|mercadolivre|magazineluiza|americanas|shopee|aliexpress|facebook|instagram|tiktok|twitter|x|pinterest)\.[a-z.]+$/i;
const CADASTRO_EMPRESA = /cnpj|serasa|econodata|casadosdados|consultas?ocio|advdinamico|informecadastral|receitaws|telelistas/i;
const TRECHO_LIXO = /- youtube$|\?|cookie|javascript|inscrev|deixe seu like|clique|acesse o conte|fa[cç]a login|todos os direitos|my ad center|resultados da web|\]\(|##|fale com a gente|entrevista|\bvagas?\b|sal[aá]rio|curr[ií]culo|como se tornar|por que ser|aproveite v[ií]deos|followers|following|seguidores|»|\*\*|in[ií]cio \/|^\W/i;
const ENTIDADES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ordm: 'º', ordf: 'ª' };
const MARCAS = { acute: '\u0301', grave: '\u0300', tilde: '\u0303', circ: '\u0302', uml: '\u0308', cedil: '\u0327' };
/* Algumas páginas chegam com acento em entidade HTML (op&ccedil;&otilde;es). */
const decodificarEntidades = (t) => String(t || '')
  .replace(/&([a-z])(acute|grave|tilde|circ|uml|cedil);/gi, (_, l, m) => l + MARCAS[m.toLowerCase()])
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
  .normalize('NFC');
const emIngles = (t) => (String(t).toLowerCase().match(/\b(the|what|how|should|your|during|with|from|this|are)\b/g) || []).length >= 2;
/* Frase de verdade termina com pontuação; título solto e menu, não. */
const trechoBom = (f) => f.length >= 50 && f.length <= 280 && f.split(/\s+/).length >= 8 && /[.!]$/.test(f.trim()) && !TRECHO_LIXO.test(f) && !emIngles(f);

/* Produtos do site: dados estruturados (schema.org) e, sem eles, linhas com preço. */
export function extrairProdutos(html) {
  const achados = [];
  const visitar = (no) => {
    if (Array.isArray(no)) { no.forEach(visitar); return; }
    if (!no || typeof no !== 'object') return;
    const tipos = [no['@type']].flat().map(String);
    if (tipos.some((t) => /^(Product|Service|Offer)$/i.test(t)) && no.name) {
      const oferta = [no.offers].flat()[0];
      const preco = oferta?.price || oferta?.lowPrice;
      const desc = decodificarEntidades(textoDoHtml(String(no.description || ''))).replace(/\s+/g, ' ').trim();
      achados.push(`${decodificarEntidades(String(no.name)).trim()}${preco ? ` — R$ ${preco}` : ''}${desc ? `: ${desc.slice(0, 140)}` : ''}`);
    }
    Object.values(no).forEach(visitar);
  };
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visitar(JSON.parse(m[1])); } catch { /* JSON ruim de um site não derruba a leitura */ }
  }
  if (!achados.length) {
    achados.push(...decodificarEntidades(textoDoHtml(String(html))).split(/\n+/).map((l) => l.trim())
      .filter((l) => l.length >= 8 && l.length <= 200 && /R\$\s?\d/.test(l) && !TRECHO_LIXO.test(l)));
  }
  return [...new Set(achados)].slice(0, 6);
}

function consultasDaEspecialidade({ especialidade, finalidade, profissao, empresa, nichoInformado = '' }) {
  const termo = [...new Set([nichoInformado, especialidade].map((t) => String(t || '').trim()).filter(Boolean))].join(' ').slice(0, 120);
  const foco = [termo, profissao, finalidade].filter(Boolean).join(' ').slice(0, 260);
  const consultas = [
    { escopo: 'profissao', texto: `${termo} o que é como funciona atendimento ao cliente` },
    { escopo: 'profissao', texto: `${termo} guia completo dicas blog` },
    { escopo: 'profissao', texto: `${termo} perguntas frequentes dúvidas de clientes preços` },
    { escopo: 'profissao', texto: `${termo} fórum comunidade profissionais` },
    { escopo: 'profissao', texto: `${foco} official standards government university documentation specialist blog community forum YouTube training video best practices` },
  ];
  if (empresa) {
    const nome = empresa.nomeFantasia || empresa.razaoSocial;
    const local = `${empresa.municipio || ''} ${empresa.uf || ''}`.trim();
    const termos = [empresa.nomeFantasia, empresa.razaoSocial].filter(Boolean);
    consultas.push(
      { escopo: 'empresa', texto: `"${nome}" ${local} site oficial produtos serviços atendimento`, termos },
      { escopo: 'empresa', texto: `"${nome}" ${local} instagram facebook whatsapp`, termos },
      { escopo: 'empresa', texto: `"${nome}" ${local} avaliações endereço horário ${termo}`, termos },
    );
  }
  return consultas;
}

async function consultarCadastroEmpresa(cnpj, fetchFn) {
  const documento = validarDocumento(cnpj);
  if (!documento.ok || documento.tipo !== 'CNPJ') {
    return { erro: 'para personalizar o bot, informe um CNPJ válido da empresa; CPF pessoal não é enviado à pesquisa externa' };
  }
  const url = `https://brasilapi.com.br/api/cnpj/v1/${documento.digitos}`;
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 10_000);
  try {
    const resposta = await fetchFn(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: controlador.signal,
    });
    if (!resposta.ok) throw new Error(`cadastro público respondeu HTTP ${resposta.status}`);
    const registro = await resposta.json();
    const cnpjRegistro = String(registro.cnpj || '').replace(/\D/g, '');
    if (cnpjRegistro !== documento.digitos) throw new Error('o cadastro público não confirmou o CNPJ informado');
    const atividades = Array.isArray(registro.cnaes_secundarios)
      ? registro.cnaes_secundarios.slice(0, 4).map((item) => item.descricao).filter(Boolean)
      : [];
    const dados = {
      cnpj: documento.digitos,
      razaoSocial: String(registro.razao_social || '').trim().slice(0, 180),
      nomeFantasia: String(registro.nome_fantasia || '').trim().slice(0, 180),
      situacao: String(registro.descricao_situacao_cadastral || '').trim().slice(0, 80),
      municipio: String(registro.municipio || '').trim().slice(0, 100),
      uf: String(registro.uf || '').trim().slice(0, 2),
      atividadePrincipal: String(registro.cnae_fiscal_descricao || registro.cnae_fiscal || '').trim().slice(0, 240),
      atividadesSecundarias: atividades,
      porte: String(registro.porte || '').trim().slice(0, 80),
      inicioAtividade: String(registro.data_inicio_atividade || '').trim().slice(0, 10),
    };
    if (!dados.razaoSocial && !dados.nomeFantasia) throw new Error('o cadastro público não retornou a identificação da empresa');
    const fatos = [
      `Razão social: ${dados.razaoSocial || 'não informada'}.`,
      `Nome fantasia: ${dados.nomeFantasia || 'não informado'}.`,
      `Situação cadastral: ${dados.situacao || 'não informada'}.`,
      `Atividade principal: ${dados.atividadePrincipal || 'não informada'}.`,
      `Atividades secundárias: ${dados.atividadesSecundarias.join('; ') || 'não informadas'}.`,
      `Município/UF: ${[dados.municipio, dados.uf].filter(Boolean).join('/') || 'não informado'}.`,
      `Porte: ${dados.porte || 'não informado'}.`,
      `Início da atividade: ${dados.inicioAtividade || 'não informado'}.`,
    ].join(' ');
    return {
      empresa: dados,
      fonte: {
        tipo: 'cadastro-publico-empresa',
        titulo: 'Consulta cadastral pública de CNPJ',
        url,
        resumo: 'Dados cadastrais empresariais consultados via API pública; não inclui quadro societário, CPF, e-mail ou telefone.',
      },
      conhecimento: {
        categoria: 'perfil-publico-da-empresa',
        conteudo: fatos.slice(0, 1000),
        fonteUrl: url,
      },
    };
  } catch (erro) {
    return { erro: `não foi possível consultar os dados públicos do CNPJ: ${String(erro.message || erro).slice(0, 180)}` };
  } finally {
    clearTimeout(temporizador);
  }
}

function buscarComCurl(url, maxBytes) {
  const destino = new URL(url);
  if (destino.hostname !== 'r.jina.ai' || destino.protocol !== 'https:') {
    throw new Error('a contingência de pesquisa aceita somente o buscador configurado');
  }
  return executar('curl', [
    '--silent',
    '--show-error',
    '--fail',
    '--max-time', '12',
    '--max-filesize', String(maxBytes),
    '--user-agent', USER_AGENT,
    '--',
    url,
  ], {
    encoding: 'utf8',
    maxBuffer: maxBytes,
    timeout: 13_000,
  }).then(({ stdout }) => stdout);
}

async function resolverResultados(encontrados, buscador, fetchFn, falhas) {
  return (await Promise.all(encontrados.map(async (resultado) => {
    try {
      return { ...resultado, url: await resolverDestinoPesquisa(resultado.url, fetchFn) };
    } catch (erro) {
      const motivo = String(erro.message || erro);
      falhas.push(`${buscador.nome}: ${motivo.slice(0, 160)}`);
      /* Site que recusa robô (403/429/5xx) ainda é um resultado real do
         buscador: fica com a URL que o buscador deu e o trecho que ele mostrou.
         Só o destino proibido (rede interna, não HTTPS) é descartado. */
      if (/não permitido|redirecionamento/.test(motivo) || !/^https:\/\//.test(resultado.url)) return null;
      if (/google\.com\/goto|bing\.com\/ck\//.test(resultado.url)) return null;
      return { ...resultado, paginaRecusou: true };
    }
  }))).filter(Boolean);
}

async function pesquisarResultados(consulta, buscador, fetchFn, curlFn, falhas) {
  const url = buscador.criarUrl(consulta);
  try {
    const resposta = await buscarHtml(url, fetchFn, { maxBytes: 800_000 });
    const encontrados = buscador.extrair(resposta.html);
    if (encontrados.length) return resolverResultados(encontrados, buscador, fetchFn, falhas);
    falhas.push(`${buscador.nome}: nenhum resultado legível`);
  } catch (erro) {
    falhas.push(`${buscador.nome}: ${String(erro.message || erro).slice(0, 160)}`);
  }

  if (curlFn && buscador.nome === 'Google Search') {
    try {
      const encontrados = buscador.extrair(await curlFn(url, 800_000));
      if (encontrados.length) return resolverResultados(encontrados, buscador, fetchFn, falhas);
      falhas.push(`${buscador.nome} (contingência): nenhum resultado legível`);
    } catch (erro) {
      falhas.push(`${buscador.nome} (contingência): ${String(erro.message || erro).slice(0, 160)}`);
    }
  }
  return [];
}

function conhecimentoDaPagina(pagina, consulta, { escopo = 'profissao', nomes = [] } = {}) {
  const estudo = estudarHtml(pagina.html, { url: pagina.url });
  const linhasPagina = decodificarEntidades(textoDoHtml(pagina.html)).split(/\n+/);
  const linhas = [...estudo.frases.map(decodificarEntidades), ...linhasPagina]
    .map((frase) => frase.trim())
    .filter(trechoBom)
    .filter((frase) => escopo === 'empresa' || falaDoNicho(frase, nomes));
  const trechos = [...new Set([...linhas, trechoBom(decodificarEntidades(estudo.descricao)) && (escopo === 'empresa' || falaDoNicho(decodificarEntidades(estudo.descricao), nomes)) ? decodificarEntidades(estudo.descricao) : ''].filter(Boolean))]
    .filter((trecho) => !/^(?:skip to|cookie|privacy policy|sign in|log in)\b/i.test(trecho))
    .slice(0, escopo === 'empresa' ? 3 : 2);
  return {
    tipo: tipoFonte(pagina.url, consulta),
    titulo: estudo.titulo || pagina.resultado.titulo,
    url: pagina.url,
    resumo: estudo.descricao || 'Página externa consultada; revise o conteúdo completo antes de homologar.',
    conhecimentos: trechos.map((conteudo, indice) => ({
      categoria: escopo === 'empresa' ? 'o-que-a-empresa-faz' : (indice === 0 ? 'conhecimento-básico' : 'procedimento-e-limites'),
      conteudo,
      fonteUrl: pagina.url,
    })),
  };
}

export async function pesquisarPreparacaoNaWeb(
  { especialidade, finalidade = '', profissao = '', empresaCnpj = '', empresaNome = '', nicho: nichoInformado = '', siteEmpresa = '' } = {},
  { fetch: fetchFn = globalThis.fetch, curl: curlFn = buscarComCurl } = {},
) {
  const nicho = String(especialidade || '').trim();
  if (nicho.length < 2) return { erro: 'informe uma especialidade válida para pesquisar' };
  if (typeof fetchFn !== 'function') return { erro: 'a pesquisa na internet não está disponível neste servidor' };

  let cadastroEmpresa = null;
  if (empresaCnpj) {
    cadastroEmpresa = await consultarCadastroEmpresa(empresaCnpj, fetchFn);
    if (cadastroEmpresa.erro) return cadastroEmpresa;
  }
  /* Sem CNPJ, o nome informado ainda permite pesquisar a presença pública da
     empresa. É só um termo de busca: não há consulta cadastral nem envio de
     documento pessoal. */
  const empresaConsulta = cadastroEmpresa?.empresa
    || (empresaNome ? { nomeFantasia: String(empresaNome).trim().slice(0, 180) } : null);
  const fontes = [];
  const falhas = [];
  let buscadorUsado = '';
  const consultas = consultasDaEspecialidade({
    especialidade: nicho,
    finalidade,
    profissao,
    empresa: empresaConsulta,
    nichoInformado,
  });
  const resultadosPorUrl = new Map();
  const bloqueados = new Set();
  for (const consulta of consultas) {
    for (const buscador of BUSCADORES) {
      /* Buscador que bloqueou (403/429) sai da rodada: insistir só gasta tempo. */
      if (bloqueados.has(buscador.nome)) continue;
      const antes = falhas.length;
      const resultados = await pesquisarResultados(consulta.texto, buscador, fetchFn, curlFn, falhas);
      if (!resultados.length && falhas.slice(antes).some((f) => /respondeu 4(03|29)|Command failed/.test(f))) bloqueados.add(buscador.nome);
      /* Buscador sob bloqueio anti-robô às vezes responde 200 com resultados
         aleatórios: só conta como resposta o que é relevante ao nicho. */
      const relevantes = resultados.filter((resultado) =>
        (consulta.escopo === 'empresa'
          ? falaDoNicho(`${resultado.titulo} ${resultado.resumo} ${resultado.url}`, consulta.termos, 1) && !CADASTRO_EMPRESA.test(new URL(resultado.url).hostname) && !SITE_BUSCA.test(new URL(resultado.url).hostname)
          : falaDoNicho(`${resultado.titulo} ${resultado.resumo} ${resultado.url}`, [nicho, nichoInformado]) && !SITE_GENERICO.test(new URL(resultado.url).hostname))
        /* Página de verificação anti-robô (captcha) não é fonte. */
        && !/perfdrive\.com|captcha|challenge|cloudflare/i.test(new URL(resultado.url).hostname)
        /* Dicionário não é fonte do setor. */
        && !/(^|\.)(dicio|sinonimos|significados|priberam|dicionario|michaelis\.uol)\.com(\.br)?$|(^|\.)priberam\.org$|(^|\.)aulete\.com\.br$/i.test(new URL(resultado.url).hostname));
      if (!relevantes.length) {
        if (resultados.length) falhas.push(`${buscador.nome}: nenhum resultado relevante para "${consulta.texto.slice(0, 60)}"`);
        continue;
      }
      buscadorUsado ||= buscador.nome;
      for (const resultado of relevantes) {
        const tipoBruto = tipoFonte(resultado.url, consulta.texto);
        const tipo = consulta.escopo === 'empresa' && tipoBruto === 'site-do-setor' ? 'presenca-digital-empresa' : tipoBruto;
        const chave = `${consulta.escopo}:${resultado.url}`;
        if (tipo && !resultadosPorUrl.has(chave)) {
          resultadosPorUrl.set(chave, { ...resultado, tipo, consulta: consulta.texto, escopo: consulta.escopo });
        }
      }
      /* Um buscador que respondeu basta para esta consulta: perguntar aos
         três em toda consulta é o que fazia Google/Bing bloquearem (403/429). */
      break;
    }
    const resultadosDaProfissao = [...resultadosPorUrl.values()].filter((item) => item.escopo === 'profissao');
    const categoriasResultados = new Set(resultadosDaProfissao.map((item) => item.tipo));
    const temFontePrimaria = categoriasResultados.has('site-oficial') || categoriasResultados.has('documentacao');
    const temFonteEspecializada = ['blog-especializado', 'comunidade-forum', 'youtube'].some((tipo) => categoriasResultados.has(tipo));
    const suficientes = resultadosDaProfissao.length >= 6 || (resultadosDaProfissao.length >= 3 && temFontePrimaria && temFonteEspecializada);
    if (suficientes) {
      if (!empresaConsulta || [...resultadosPorUrl.values()].some((item) => item.escopo === 'empresa')) break;
    }
  }

  const candidatos = [...resultadosPorUrl.values()];
  const selecionados = [];
  const hostsUsados = new Set();
  const incluirRegistro = (fonte) => {
    if (!fonte || selecionados.length >= 8) return;
    selecionados.push({ ...fonte, escopo: 'empresa-registro' });
  };
  /* Total cabe no registro (máx. 8): com empresa, a profissão fica com até 4
     e a empresa com o restante. */
  const maxProfissao = empresaConsulta ? 4 : MAX_FONTES;
  const incluir = (candidato) => {
    const maximo = candidato?.escopo === 'empresa' ? MAX_FONTES_EMPRESA : maxProfissao;
    if (!candidato || selecionados.length >= 8 || selecionados.filter((item) => item.escopo === candidato.escopo).length >= maximo) return;
    /* A mesma página pode aparecer na busca do nicho e na busca da empresa.
       Registrar duas vezes a mesma URL invalida a preparação, então cada
       endereço entra uma única vez. */
    if (selecionados.some((item) => item.url === candidato.url)) return;
    const host = new URL(candidato.url).hostname;
    const chaveHost = `${candidato.escopo}:${host}`;
    if (hostsUsados.has(chaveHost)) return;
    hostsUsados.add(chaveHost);
    selecionados.push(candidato);
  };
  incluirRegistro(cadastroEmpresa?.fonte);
  for (const tipo of ['site-oficial', 'documentacao', 'blog-especializado', 'comunidade-forum', 'youtube', 'site-do-setor']) {
    incluir(candidatos.find((item) => item.escopo === 'profissao' && item.tipo === tipo));
  }
  for (const candidato of candidatos.filter((item) => item.escopo === 'profissao')) incluir(candidato);
  for (const candidato of candidatos.filter((item) => item.escopo === 'empresa')) incluir(candidato);

  /* Página que não abre (anti-robô) ou não rende trecho: o resumo que o
     buscador exibiu é usado como conhecimento, marcado como trecho do buscador
     — nada inventado, só o que a busca pública mostrou. */
  const fonteDoTrecho = (candidato, motivo) => {
    const resumo = decodificarEntidades(candidato.resumo).replace(/\s+/g, ' ').trim();
    if (!trechoBom(resumo.slice(0, 280)) || (candidato.escopo !== 'empresa' && !falaDoNicho(resumo, [nicho, nichoInformado]))) return { falha: `${candidato.url}: ${motivo}` };
    return {
      fonte: {
        tipo: candidato.tipo,
        escopo: candidato.escopo,
        titulo: String(candidato.titulo || new URL(candidato.url).hostname).slice(0, 160),
        url: candidato.url,
        resumo: resumo.slice(0, 1200),
        verificacao: 'trecho-do-buscador',
        conhecimentos: [{ categoria: candidato.escopo === 'empresa' ? 'o-que-a-empresa-faz' : 'conhecimento-básico', conteudo: resumo.slice(0, 280), fonteUrl: candidato.url }],
      },
      falha: `${candidato.url}: ${motivo} — usado o trecho exibido pelo buscador`,
    };
  };
  const fontesConsultadas = await Promise.all(selecionados.map(async (candidato) => {
    if (candidato.escopo === 'empresa-registro') return { fonte: candidato };
    if (candidato.paginaRecusou) return fonteDoTrecho(candidato, 'a página recusou acesso automático');
    try {
      const pagina = await buscarHtml(candidato.url, fetchFn);
      const fonte = conhecimentoDaPagina({ ...pagina, resultado: candidato }, candidato.consulta, { escopo: candidato.escopo, nomes: [nicho, nichoInformado] });
      /* A fundo: no site da empresa, lê também as páginas de serviços, sobre e atendimento. */
      if (candidato.escopo === 'empresa' && !/facebook|instagram|linkedin|youtube/i.test(new URL(candidato.url).hostname)) {
        const internas = [...new Set([...String(pagina.html).matchAll(/href="([^"#]+)"/gi)].map((m) => { try { return new URL(m[1], candidato.url); } catch { return null; } })
          .filter((u) => u && u.hostname === new URL(candidato.url).hostname && u.protocol === 'https:' && /servi|sobre|quem-somos|atendimento|precos|tratamentos|procedimentos|cardapio|produtos/i.test(u.pathname)).map((u) => u.href))].slice(0, 2);
        for (const interna of internas) {
          try {
            const extra = conhecimentoDaPagina({ ...(await buscarHtml(interna, fetchFn)), resultado: candidato }, candidato.consulta, { escopo: 'empresa' });
            fonte.conhecimentos.push(...extra.conhecimentos.map((k) => ({ ...k, fonteUrl: fonte.url })));
          } catch { /* página interna é bônus */ }
        }
        fonte.conhecimentos = fonte.conhecimentos.filter((k, i, l) => l.findIndex((o) => o.conteudo === k.conteudo) === i).slice(0, 6);
      }
      if (!fonte.conhecimentos.length) {
        return fonteDoTrecho(candidato, 'página abriu, mas não trouxe trechos úteis para conhecimento inicial');
      }
      return { fonte: { ...fonte, tipo: candidato.tipo, escopo: candidato.escopo } };
    } catch (erro) {
      return fonteDoTrecho(candidato, String(erro.message || erro).slice(0, 160));
    }
  }));
  for (const resultado of fontesConsultadas) {
    if (resultado.fonte) fontes.push(resultado.fonte);
    if (resultado.falha) falhas.push(resultado.falha);
  }

  const fontesProfissao = fontes.filter((fonte) => fonte.escopo === 'profissao');
  const fontesEmpresaWeb = fontes.filter((fonte) => fonte.escopo === 'empresa');
  const categorias = new Set(fontesProfissao.map((fonte) => fonte.tipo));
  /* Produtos: o site informado na criação ou, sem ele, o site achado na pesquisa. */
  const produtos = [];
  const redes = /facebook|instagram|linkedin|youtube|tiktok/i;
  const informado = String(siteEmpresa || '').trim();
  const siteAlvo = informado ? (/^https?:\/\//i.test(informado) ? informado : `https://${informado}`) : fontesEmpresaWeb.find((f) => !redes.test(new URL(f.url).hostname))?.url;
  if (siteAlvo && urlPermitida(siteAlvo)) {
    try {
      const inicio = await buscarHtml(siteAlvo, fetchFn);
      const paginas = [inicio, ...(await Promise.all([...new Set([...String(inicio.html).matchAll(/href="([^"#]+)"/gi)].map((m) => { try { return new URL(m[1], siteAlvo); } catch { return null; } })
        .filter((u) => u && u.hostname === new URL(siteAlvo).hostname && u.protocol === 'https:' && /produto|loja|catalogo|servi|planos|precos|shop/i.test(u.pathname)).map((u) => u.href))].slice(0, 3)
        .map((u) => buscarHtml(u, fetchFn).catch(() => null)))).filter(Boolean)];
      const lista = [...new Set(paginas.flatMap((p) => extrairProdutos(p.html)))].slice(0, 6);
      let fonteSite = fontes.find((f) => f.url === siteAlvo) || fontesEmpresaWeb[0];
      if (!fonteSite && lista.length && fontes.length < 8) {
        fonteSite = { tipo: 'presenca-digital-empresa', escopo: 'empresa', titulo: new URL(siteAlvo).hostname, url: siteAlvo, resumo: 'Site da empresa consultado para os produtos.', conhecimentos: [] };
        fontes.push(fonteSite);
      }
      if (fonteSite) produtos.push(...lista.map((conteudo) => ({ categoria: 'produto', conteudo: conteudo.slice(0, 300), fonteUrl: fonteSite.url })));
    } catch (erro) { falhas.push(`site da empresa: ${String(erro.message || erro).slice(0, 120)}`); }
  }
  /* Sem reserva, o nicho consumia as 10 vagas e o que a empresa faz ficava de fora. */
  const daEmpresa = [...(cadastroEmpresa ? [cadastroEmpresa.conhecimento] : []), ...fontesEmpresaWeb.flatMap((fonte) => fonte.conhecimentos || [])].slice(0, produtos.length ? 3 : 5);
  const conhecimentos = [...produtos.slice(0, 4), ...daEmpresa, ...fontesProfissao.flatMap((fonte) => fonte.conhecimentos || [])].slice(0, 10);
  if (fontesProfissao.length < 3 || conhecimentos.length < (cadastroEmpresa ? 4 : 3)) {
    return {
      erro: `a pesquisa automática não conseguiu consultar três fontes relevantes sobre a profissão e registrar os conhecimentos mínimos; nenhuma preparação foi concluída e você pode tentar novamente. Impedimento: não achei conteúdo confiável sobre o nicho "${nichoInformado || nicho}"`,
      buscador: buscadorUsado || 'indisponível',
      fontes,
      conhecimentos,
      falhas: falhas.slice(0, 12),
    };
  }

  return {
    ok: true,
    buscador: buscadorUsado,
    pesquisadoEm: new Date().toISOString(),
    consultas: consultas.length,
    empresa: cadastroEmpresa
      ? {
        ...cadastroEmpresa.empresa,
        fontesDigitaisConsultadas: fontesEmpresaWeb.length,
      }
      : (empresaConsulta ? {
        nomeFantasia: empresaConsulta.nomeFantasia,
        fontesDigitaisConsultadas: fontesEmpresaWeb.length,
        identificacao: 'nome-informado',
      } : null),
    fontes,
    conhecimentos,
    falhas: falhas.slice(0, 12),
    limitacoes: [
      'Pesquisa focada em fontes públicas indexadas; páginas protegidas, inacessíveis ou em formato não suportado podem ficar de fora.',
      'Trechos são extraídos das páginas consultadas e permanecem descobertos, não validados nem homologados.',
      ...(cadastroEmpresa?.empresa?.situacao && !/ativa/i.test(cadastroEmpresa.empresa.situacao) ? [`Atenção: a empresa consta como ${cadastroEmpresa.empresa.situacao} no cadastro público.`] : []),
      ...(empresaConsulta ? [
        ...(cadastroEmpresa
          ? ['O CNPJ foi consultado em uma API pública de dados cadastrais; CPF pessoal, quadro societário, e-mail e telefone não são pesquisados nem incorporados.']
          : ['A empresa foi identificada apenas pelo nome informado; não houve consulta cadastral por CNPJ e nenhum documento pessoal foi enviado a buscadores.']),
        ...(fontesEmpresaWeb.length ? [] : ['Não foram localizadas páginas públicas da presença digital da empresa; o perfil cadastral consultado está registrado como conhecimento descoberto.']),
      ] : []),
      ...['site-oficial', 'documentacao'].filter((tipo) => !categorias.has(tipo)).map((tipo) =>
        `Nenhuma fonte consultável do tipo ${tipo === 'site-oficial' ? 'oficial/institucional' : 'documentação técnica'} foi encontrada nesta pesquisa.`,
      ),
      ...['youtube', 'comunidade-forum'].filter((tipo) => !categorias.has(tipo)).map((tipo) =>
        `Nenhuma fonte consultável do tipo ${tipo === 'youtube' ? 'YouTube' : 'comunidade/fórum'} foi encontrada nesta pesquisa.`,
      ),
    ],
  };
}
