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
];
const executar = promisify(execFile);
const MAX_HTML_BYTES = 1_500_000;
const MAX_RESULTADOS = 8;
const MAX_FONTES = 6;
const MAX_FONTES_EMPRESA = 2;
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
  return null;
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
  const encontrados = termos.filter((termo) => texto.includes(termo)).length;
  return encontrados >= Math.min(minimoEncontrado, termos.length);
}

function consultasDaEspecialidade({ especialidade, finalidade, profissao, empresa }) {
  const foco = [especialidade, profissao, finalidade].filter(Boolean).join(' ').slice(0, 260);
  const consultas = [{
    escopo: 'profissao',
    texto: `${foco} official standards government university documentation specialist blog community forum YouTube training video best practices`,
  }];
  if (empresa) {
    const nome = empresa.nomeFantasia || empresa.razaoSocial;
    consultas.push({
      escopo: 'empresa',
      texto: `"${nome}" ${empresa.municipio || ''} ${empresa.uf || ''} site oficial produtos serviços atendimento`,
      termos: [empresa.nomeFantasia, empresa.razaoSocial].filter(Boolean),
    });
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
      falhas.push(`${buscador.nome}: ${String(erro.message || erro).slice(0, 160)}`);
      return null;
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

function conhecimentoDaPagina(pagina, consulta) {
  const estudo = estudarHtml(pagina.html, { url: pagina.url });
  const linhasPagina = textoDoHtml(pagina.html).split(/\n+/);
  const linhas = [...estudo.frases, ...linhasPagina]
    .map((frase) => frase.trim())
    .filter((frase) => frase.length >= 35 && frase.length <= 280);
  const trechos = [...new Set([...linhas, estudo.descricao].filter(Boolean))]
    .filter((trecho) => !/^(?:skip to|cookie|privacy policy|sign in|log in)\b/i.test(trecho))
    .slice(0, 2);
  return {
    tipo: tipoFonte(pagina.url, consulta),
    titulo: estudo.titulo || pagina.resultado.titulo,
    url: pagina.url,
    resumo: estudo.descricao || 'Página externa consultada; revise o conteúdo completo antes de homologar.',
    conhecimentos: trechos.map((conteudo, indice) => ({
      categoria: indice === 0 ? 'conhecimento-básico' : 'procedimento-e-limites',
      conteudo,
      fonteUrl: pagina.url,
    })),
  };
}

export async function pesquisarPreparacaoNaWeb(
  { especialidade, finalidade = '', profissao = '', empresaCnpj = '' } = {},
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
  const fontes = [];
  const falhas = [];
  let buscadorUsado = '';
  const consultas = consultasDaEspecialidade({
    especialidade: nicho,
    finalidade,
    profissao,
    empresa: cadastroEmpresa?.empresa,
  });
  const resultadosPorUrl = new Map();
  for (const consulta of consultas) {
    for (const buscador of BUSCADORES) {
      const resultados = await pesquisarResultados(consulta.texto, buscador, fetchFn, curlFn, falhas);
      if (resultados.length) buscadorUsado ||= buscador.nome;
      for (const resultado of resultados) {
        const termosRelevantes = consulta.escopo === 'empresa'
          ? consulta.termos
          : [nicho, profissao];
        if (!resultadoRelevante(resultado, termosRelevantes, consulta.escopo === 'empresa' ? 2 : 1)) continue;
        const tipo = tipoFonte(resultado.url, consulta.texto)
          || (consulta.escopo === 'empresa' ? 'presenca-digital-empresa' : null);
        const chave = `${consulta.escopo}:${resultado.url}`;
        if (tipo && !resultadosPorUrl.has(chave)) {
          resultadosPorUrl.set(chave, { ...resultado, tipo, consulta: consulta.texto, escopo: consulta.escopo });
        }
      }
    }
    const resultadosDaProfissao = [...resultadosPorUrl.values()].filter((item) => item.escopo === 'profissao');
    const categoriasResultados = new Set(resultadosDaProfissao.map((item) => item.tipo));
    const temFontePrimaria = categoriasResultados.has('site-oficial') || categoriasResultados.has('documentacao');
    const temFonteEspecializada = ['blog-especializado', 'comunidade-forum', 'youtube'].some((tipo) => categoriasResultados.has(tipo));
    if (resultadosDaProfissao.length >= 3 && temFontePrimaria && temFonteEspecializada) {
      if (!cadastroEmpresa || [...resultadosPorUrl.values()].some((item) => item.escopo === 'empresa')) break;
    }
  }

  const candidatos = [...resultadosPorUrl.values()];
  const selecionados = [];
  const hostsUsados = new Set();
  const incluirRegistro = (fonte) => {
    if (!fonte || selecionados.length >= 8) return;
    selecionados.push({ ...fonte, escopo: 'empresa-registro' });
  };
  const incluir = (candidato) => {
    const maximo = candidato?.escopo === 'empresa' ? MAX_FONTES_EMPRESA : MAX_FONTES;
    if (!candidato || selecionados.filter((item) => item.escopo === candidato.escopo).length >= maximo) return;
    const host = new URL(candidato.url).hostname;
    const chaveHost = `${candidato.escopo}:${host}`;
    if (hostsUsados.has(chaveHost)) return;
    hostsUsados.add(chaveHost);
    selecionados.push(candidato);
  };
  incluirRegistro(cadastroEmpresa?.fonte);
  for (const tipo of ['site-oficial', 'documentacao', 'blog-especializado', 'comunidade-forum', 'youtube']) {
    incluir(candidatos.find((item) => item.escopo === 'profissao' && item.tipo === tipo));
  }
  for (const candidato of candidatos.filter((item) => item.escopo === 'empresa')) incluir(candidato);
  for (const candidato of candidatos) incluir(candidato);

  const fontesConsultadas = await Promise.all(selecionados.map(async (candidato) => {
    if (candidato.escopo === 'empresa-registro') return { fonte: candidato };
    try {
      const pagina = await buscarHtml(candidato.url, fetchFn);
      const fonte = conhecimentoDaPagina({ ...pagina, resultado: candidato }, candidato.consulta);
      if (!fonte.conhecimentos.length) {
        return { falha: `${fonte.url}: página abriu, mas não trouxe trechos úteis para conhecimento inicial` };
      }
      return { fonte: { ...fonte, tipo: candidato.tipo, escopo: candidato.escopo } };
    } catch (erro) {
      return { falha: `${candidato.url}: ${String(erro.message || erro).slice(0, 160)}` };
    }
  }));
  for (const resultado of fontesConsultadas) {
    if (resultado.fonte) fontes.push(resultado.fonte);
    if (resultado.falha) falhas.push(resultado.falha);
  }

  const fontesProfissao = fontes.filter((fonte) => fonte.escopo === 'profissao');
  const fontesEmpresaWeb = fontes.filter((fonte) => fonte.escopo === 'empresa');
  const categorias = new Set(fontesProfissao.map((fonte) => fonte.tipo));
  const conhecimentos = [
    ...(cadastroEmpresa ? [cadastroEmpresa.conhecimento] : []),
    ...fontes.flatMap((fonte) => fonte.conhecimentos || []),
  ].slice(0, 10);
  if (fontesProfissao.length < 3 || conhecimentos.length < (cadastroEmpresa ? 4 : 3)) {
    return {
      erro: 'a pesquisa automática não conseguiu consultar três fontes relevantes sobre a profissão e registrar os conhecimentos mínimos; nenhuma preparação foi concluída e você pode tentar novamente',
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
    empresa: cadastroEmpresa ? {
      ...cadastroEmpresa.empresa,
      fontesDigitaisConsultadas: fontesEmpresaWeb.length,
    } : null,
    fontes,
    conhecimentos,
    falhas: falhas.slice(0, 12),
    limitacoes: [
      'Pesquisa focada em fontes públicas indexadas; páginas protegidas, inacessíveis ou em formato não suportado podem ficar de fora.',
      'Trechos são extraídos das páginas consultadas e permanecem descobertos, não validados nem homologados.',
      ...(cadastroEmpresa ? [
        'O CNPJ foi consultado em uma API pública de dados cadastrais; CPF pessoal, quadro societário, e-mail e telefone não são pesquisados nem incorporados.',
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
