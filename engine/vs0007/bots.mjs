/**
 * VS0007 — Fábrica de Modelos e Hotel dos Bots.
 *
 * Este módulo é o coração operacional da etapa "Agente 0007, Hotel dos Bots e
 * Fábrica de Modelos": o que faltava no cérebro do 0007 para a criação de um bot
 * comercial ser um FLUXO com estado, e não só um caderno de agentes.
 *
 *  1. O 0007 cria um bot comercial (criarBotComercial) — nasce em 'em_preparacao',
 *     e o mapa mental ganha o primeiro nó do conhecimento (via mapa.mjs).
 *  2. As deusas (Ísis, Hera, Perséfone) derivam modelos comerciais de suas
 *     especialidades (registrarModeloDerivado) — somente com autorização expressa
 *     do criador; o modelo nasce independente e NÃO copia memórias/privacidade.
 *  3. O 0007 prepara, testa e homologa (homologarBot) — a promoção passa pela
 *     máquina de estados do mapa ('descoberto' -> 'homologado'), com autorização.
 *  4. Só homologado entra no catálogo como disponível; o cliente contrata
 *     (criarInstancia) e recebe uma instância própria (nascimento inativo).
 *
 * Persistência segue o padrão das fachadas do engine (vscrm/store.mjs); estado e
 * autorização seguem as regras puras de ./regras.mjs.
 */

import { load, save } from '../vscrm/store.mjs';
import * as modelosBot from '../vsbot/modelos.mjs';
import * as profissoesBot from '../vsbot/profissoes.mjs';
import { validarFluxo } from '../vsbot/fluxo.mjs';
import { pesquisarPreparacaoNaWeb, falaDoNicho } from './pesquisa.mjs';
import { selecionarBase, validarIdentidadeBase, obterBasePorId, baseParaPesquisa } from './base-empresa.mjs';
import { segmentoDoNicho, temasCobertos } from './segmentos.mjs';
import { documento as validarDocumento } from '../vsclientes/ofertas.mjs';
import * as R from './regras.mjs';
import * as MAPA from './mapa.mjs';
import {
  MODELOS_FREE_0007,
  PARAMETROS_TREINO,
  diagnosticoParametros,
  categoriaDoRequisito,
  sugerirTreinoPorParametro,
} from './auditoria.mjs';

export const DATASET_BOTS = 'vs0007-bots';
export const DATASET_INSTANCIAS = 'vs0007-instancias';

/** Estados do ciclo de vida de um bot comercial. */
export const ESTADOS_BOT = Object.freeze(['em_preparacao', 'em_validacao', 'homologado', 'bloqueado']);
/** Estados em que o bot pode ser submetido à homologação. */
export const ESTADOS_FLUXO_HOMOLOGACAO = Object.freeze(['em_preparacao', 'em_validacao']);

const HOJE = () => new Date().toISOString();
const TIPOS_FONTE_EXTERNA = Object.freeze([
  'site-oficial',
  'documentacao',
  'blog-especializado',
  'site-do-setor',
  'youtube',
  'comunidade-forum',
  'cadastro-publico-empresa',
  'presenca-digital-empresa',
]);
const REGRAS_PERFIL_PADRAO = Object.freeze([
  'Usar somente informações confirmadas nas fontes e configurações disponíveis.',
  'Não inventar preços, prazos, disponibilidade, políticas ou dados da empresa.',
  'Informar quando não souber e encaminhar dúvidas fora do escopo para uma pessoa.',
  'Não executar ações nem solicitar dados além das permissões configuradas.',
]);

/* Especialidades que não podem ser homologadas só por teste automático: a
   missão 007 exige validação humana em risco financeiro, jurídico, fiscal ou
   que afete direitos e saúde das pessoas. */
const RISCO_FINANCEIRO = /financ|fiscal|tribut|contab|banc|investiment|cr[eé]dito|imposto|previden|empr[eé]stim|c[aâ]mbio/i;
const RISCO_JURIDICO = /jur[ií]dic|advocacia|advogad|direito|trabalhista|contratual|contratos?\b|processual|peti[cç][aã]o/i;
const RISCO_SAUDE = /sa[uú]de|m[eé]dic|cl[ií]nic|hospital|farm[aá]cia|diagn[oó]stic|terapia|psicolog|nutri|enfermag/i;
const RISCO_DIREITOS = /seguro|direitos|lgpd|privacidade|biometr|reconhecimento facial/i;

/**
 * Classifica o risco da especialidade para decidir se a homologação pode ser
 * automática (baixo risco) ou se precisa de aprovação humana (alto risco).
 */
export function classificarRisco({ especialidade = '', profissao = '', finalidade = '' } = {}) {
  const texto = `${especialidade} ${profissao} ${finalidade}`;
  const motivos = [];
  if (RISCO_FINANCEIRO.test(texto)) motivos.push('tema financeiro, fiscal, tributário ou de crédito');
  if (RISCO_JURIDICO.test(texto)) motivos.push('tema jurídico ou que envolve direitos');
  if (RISCO_SAUDE.test(texto)) motivos.push('tema de saúde');
  if (RISCO_DIREITOS.test(texto)) motivos.push('tema de dados pessoais, privacidade ou seguros');
  return { nivel: motivos.length ? 'alto' : 'baixo', motivos };
}

function novoCicloVida(iniciadoEm = HOJE()) {
  const inicio = new Date(iniciadoEm);
  return {
    etapa: 'preparacao-inicial',
    criacaoConfiguracao: { estado: 'concluida', concluidaEm: iniciadoEm },
    preparacaoConhecimentoInicial: {
      estado: 'pendente',
      iniciadaEm: iniciadoEm,
      prazoIdealEm: new Date(inicio.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      prazoMaximoEm: new Date(inicio.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      escopo: 'pesquisa proporcional para conhecimento básico, sem treinamento profundo',
    },
    evolucaoEspecializacao: { estado: 'continua', iniciadaEm: iniciadoEm },
  };
}

function normalizarPesquisaExterna(fontesEntrada = [], conhecimentosEntrada = [], limites = { fontes: 8, conhecimentos: 10 }) {
  if (!Array.isArray(fontesEntrada) || !Array.isArray(conhecimentosEntrada)) {
    return { erro: 'fontes externas e conhecimentos devem ser listas' };
  }
  if (fontesEntrada.length > limites.fontes || conhecimentosEntrada.length > limites.conhecimentos) {
    return { erro: `limite excedido: informe no máximo ${limites.fontes} fontes e ${limites.conhecimentos} conhecimentos` };
  }

  const fontes = [];
  for (const [indice, item] of fontesEntrada.entries()) {
    const tipo = String(item?.tipo || '').trim();
    const titulo = String(item?.titulo || '').trim();
    const referencia = String(item?.url || item?.referencia || '').trim();
    const resumo = String(item?.resumo || '').trim();
    let url;
    try {
      url = new URL(referencia);
    } catch {
      return { erro: `a fonte ${indice + 1} precisa ter uma URL HTTPS válida` };
    }
    if (!TIPOS_FONTE_EXTERNA.includes(tipo)) return { erro: `tipo de fonte inválido na fonte ${indice + 1}` };
    if (url.protocol !== 'https:' || url.username || url.password || referencia.length > 1500) {
      return { erro: `a fonte ${indice + 1} precisa usar uma URL HTTPS pública` };
    }
    if (!titulo || titulo.length > 160 || !resumo || resumo.length > 1200) {
      return { erro: `informe título e resumo (até 1200 caracteres) para a fonte ${indice + 1}` };
    }
    if (fontes.some((fonte) => fonte.url === url.href)) return { erro: 'não repita a mesma URL nas fontes' };
    fontes.push({
      tipo,
      titulo,
      url: url.href,
      resumo,
      ...(item.escopo === 'profissao' || item.escopo === 'empresa' || item.escopo === 'empresa-registro'
        ? { escopo: item.escopo } : {}),
      origem: ['pesquisa-automatica-0007', 'base-curada'].includes(item.origem) ? item.origem : 'informada-pelo-responsavel',
      verificacao: ['pagina-consultada', 'trecho-do-buscador', 'base-curada'].includes(item.verificacao) ? item.verificacao : 'declarada',
    });
  }

  const conhecimentos = [];
  for (const [indice, item] of conhecimentosEntrada.entries()) {
    const categoria = String(item?.categoria || '').trim();
    const conteudo = String(item?.conteudo || '').trim();
    const fonteUrl = String(item?.fonteUrl || item?.origem || '').trim();
    if (!categoria || categoria.length > 80 || !conteudo || conteudo.length > 1000) {
      return { erro: `informe categoria e conteúdo (até 1000 caracteres) no conhecimento ${indice + 1}` };
    }
    let urlConhecimento;
    try {
      urlConhecimento = new URL(fonteUrl);
    } catch {
      return { erro: `vincule o conhecimento ${indice + 1} a uma URL HTTPS válida` };
    }
    if (urlConhecimento.protocol !== 'https:' || urlConhecimento.username || urlConhecimento.password) {
      return { erro: `vincule o conhecimento ${indice + 1} a uma URL HTTPS válida` };
    }
    const fonte = fontes.find((registro) => registro.url === urlConhecimento.href);
    if (!fonte) return { erro: `vincule o conhecimento ${indice + 1} a uma das fontes registradas` };
    const curado = item.validado === true || item.origemTipo === 'base-curada' || item.verificacao === 'base-curada';
    conhecimentos.push({
      categoria,
      conteudo,
      origem: fonte.url,
      origemTipo: curado ? 'base-curada' : (item.origemTipo || 'pesquisa-externa'),
      estado: curado ? 'homologado' : 'descoberto',
      validado: curado,
      verificacao: curado ? 'base-curada' : (item.verificacao || 'declarada'),
    });
  }

  /* Qualquer nicho: fonte oficial/documentação é desejável, mas não existe
     para todo ramo (faxina, açaí, oficina). Exigimos 3 fontes distintas e 3
     conhecimentos vinculados; a ausência de fonte oficial fica nas limitações. */
  if (fontes.length < 3 || conhecimentos.length < 3) {
    return {
      erro: 'a preparação inicial exige 3 fontes distintas e 3 conhecimentos vinculados às fontes',
    };
  }

  return { fontes, conhecimentos };
}

function noDeConhecimento(item) {
  const curado = item.verificacao === 'base-curada';
  return {
    categoria: item.categoria,
    conteudo: item.conteudo,
    origem: item.origem,
    origemTipo: item.origemTipo || 'pesquisa-externa',
    estado: curado ? 'homologado' : 'descoberto',
    validado: curado,
    autorizado: curado,
    qualidade: curado ? 'curada' : 'descoberta',
    verificacao: item.verificacao || 'declarada',
  };
}

const novoId = (especialidade = '') => {
  const slug = String(especialidade || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `bot-${slug || `auto-${Date.now()}`}`;
};

const normalizarBusca = (texto) => String(texto || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

/* Nome é como a pessoa reconhece a IA no Hotel: dois bots com o mesmo nome
   (ignorando maiúsculas, acentos e espaços) confundem quem contrata e quem
   conecta ao Salão. */
const chaveNome = (nome) => normalizarBusca(nome);
export function nomeEmUso(nome, { excetoId = null, bots = null } = {}) {
  const chave = chaveNome(nome);
  if (!chave) return null;
  return (bots || load(DATASET_BOTS, [])).find((b) => b.agenteId !== excetoId && chaveNome(b.nome) === chave) || null;
}
function nomeLivre(nome, bots) {
  if (!nomeEmUso(nome, { bots })) return nome;
  const base = nome.slice(0, 74).trim();
  for (let n = 2; n < 1000; n++) {
    const candidato = `${base} ${n}`;
    if (!nomeEmUso(candidato, { bots })) return candidato;
  }
  return `${base} ${Date.now().toString(36)}`;
}

const STOPWORDS_NICHO = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'por', 'com', 'um', 'uma']);
const PROFISSAO_POR_MODELO = Object.freeze({
  hamburgueria: 'delivery',
  pizzaria: 'delivery',
  'pizzaria-robusta': 'delivery',
  'comida-japonesa': 'delivery',
  acai: 'delivery',
  marmitaria: 'delivery',
  'padaria-encomenda': 'delivery',
  acougue: 'delivery',
  mercado: 'delivery',
  distribuidora: 'delivery',
  'loja-varejo': 'vendedora',
  farmacia: 'vendedora',
  'pet-shop': 'recepcionista',
  'materiais-construcao': 'vendedora',
  'moveis-eletro': 'vendedora',
  otica: 'vendedora',
  'floricultura': 'vendedora',
  'autopecas-oficina': 'consultor',
  'agro-revenda': 'consultor',
  'cadevc-barbearia': 'agenda',
  'recepcao-servicos': 'agenda',
  'clinica-saude': 'clinica',
  academia: 'prevendas',
  'escola-cursos': 'recepcionista',
  'assistencia-tecnica': 'suporte',
  grafica: 'prevendas',
  lavanderia: 'atendente',
  'frete-mudanca': 'prevendas',
  'festas-eventos': 'prevendas',
  'hotel-pousada': 'recepcionista',
  'agencia-viagens': 'prevendas',
  imobiliaria: 'corretora',
  contabilidade: 'financeiro',
  'software-tecnologia': 'prevendas',
});

function pontuarNicho(nicho, textos) {
  const consulta = normalizarBusca(nicho);
  const termos = consulta.split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS_NICHO.has(t));
  const corpusTermos = normalizarBusca(textos.join(' ')).split(/\s+/);
  const corpus = corpusTermos.join(' ');
  if (!termos.length) return 0;
  const exato = corpus.includes(consulta) ? 5 : 0;
  return exato + termos.reduce((total, termo) => {
    if (corpusTermos.includes(termo)) return total + (termo.length > 4 ? 2 : 1);
    if (termo.length >= 5 && corpusTermos.some((t) => t.length >= 4 && (t.startsWith(termo) || termo.startsWith(t)))) return total + 1;
    return total;
  }, 0);
}

/**
 * O chefe 0007 pesquisa o nicho no catálogo de modelos homologados e nos bots
 * já cadastrados. Retorna sugestões para o criador revisar antes de criar.
 */
export function pesquisarNicho({ nicho } = {}) {
  const busca = String(nicho || '').trim();
  if (busca.length < 2) return { erro: 'informe um nicho com pelo menos 2 caracteres' };

  const consultaNorm = normalizarBusca(busca);
  const ehMultifuncaoOuSoftware = /\b(vended\w*|comercial|secretar\w*|dono|sistema\w*|software|plataforma\w*|ia|zest|tecnologia)\b/.test(consultaNorm)
    && !/\b(celular\w*|notebook\w*|aparelho\w*|conserto|eletrodomestico\w*|brastemp|electrolux)\b/.test(consultaNorm);

  const modelos = modelosBot.listar()
    .map((modelo) => {
      let pontuacao = pontuarNicho(busca, [modelo.nome, modelo.descricao, ...(modelo.categorias || [])]);
      if (ehMultifuncaoOuSoftware && modelo.id === 'software-tecnologia') pontuacao += 5;
      if (ehMultifuncaoOuSoftware && modelo.id === 'assistencia-tecnica' && /\b(vended\w*|comercial|secretar\w*|dono|sistema\w*|software)\b/.test(consultaNorm)) {
        pontuacao = Math.max(0, pontuacao - 3);
      }
      return { ...modelo, pontuacao };
    })
    .filter((modelo) => modelo.pontuacao > 0)
    .sort((a, b) => b.pontuacao - a.pontuacao || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 6);

  const existentes = listarBots()
    .map((bot) => ({
      agenteId: bot.agenteId,
      nome: bot.nome,
      especialidade: bot.especialidade,
      finalidade: bot.finalidade,
      estado: bot.estado,
      pontuacao: pontuarNicho(busca, [bot.nome, bot.especialidade, bot.finalidade]),
    }))
    .filter((bot) => bot.pontuacao > 0)
    .sort((a, b) => b.pontuacao - a.pontuacao || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 5);

  return {
    ok: true,
    pesquisadoPor: '0007',
    nicho: busca,
    modelos,
    existentes,
    encontrouModelo: modelos.length > 0,
  };
}

const unicos = (itens) => [...new Set((itens || []).map((item) => String(item || '').trim()).filter(Boolean))];
const primeiraLinha = (texto) => String(texto || '').split('\n')[0].trim();

function ferramentaSugerida(nome, justificativa, origem) {
  return { nome, justificativa, origem, estado: 'sugerido', validado: false };
}

/**
 * O 0007 prepara uma proposta usando somente fontes internas do sistema.
 * Conteúdos copiados ou inferidos da especialidade continuam descobertos até
 * passarem por validação e homologação.
 */
export function prepararEspecialidade({ especialidadeId, especialidade, profissao, finalidade } = {}) {
  const idModelo = String(especialidadeId || '').trim();
  const modelo = modelosBot.MODELOS.find((item) => item.id === idModelo) || null;
  if (idModelo && !modelo) return { erro: 'especialidade do catalogo nao encontrada; atualize o Hotel e tente novamente' };
  const esp = String(especialidade || modelo?.nome || '').trim();
  const pf = profissoesBot.PROFISSOES[String(profissao || '').trim()];
  const final = String(finalidade || '').trim();
  if (!esp) return { erro: 'selecione uma especialidade' };
  if (!pf) return { erro: 'selecione uma profissao' };
  if (!final) return { erro: 'informe a finalidade do bot' };

  const fonteProfissao = `engine/vsbot/profissoes.mjs#${profissao}`;
  const fontes = [{
    id: 'catalogo-profissoes',
    tipo: 'profissao',
    titulo: pf.nome,
    referencia: fonteProfissao,
    validacao: 'catalogo-interno',
  }];
  fontes.push(
    {
      id: 'regras-iniciais-0007',
      tipo: 'politica-inicial',
      titulo: 'Regras e limites conservadores do 0007',
      referencia: 'engine/vs0007/bots.mjs#prepararEspecialidade',
      validacao: 'proposta-pendente-de-revisao',
    },
    {
      id: 'dados-da-empresa',
      tipo: 'lacuna-de-contexto',
      titulo: 'Dados operacionais da empresa ainda não informados',
      referencia: 'contexto-da-empresa-nao-fornecido',
      validacao: 'pendente-de-configuracao',
    },
  );
  const fonteEspecialidade = modelo
    ? `engine/vsbot/modelos.mjs#${modelo.id}`
    : 'proposta-generica-0007';
  if (modelo) {
    fontes.push({
      id: 'catalogo-modelos',
      tipo: 'especialidade',
      titulo: modelo.nome,
      referencia: fonteEspecialidade,
      validacao: 'catalogo-interno-nao-homologado',
    });
    fontes.push({
      id: 'fluxo-base',
      tipo: 'fluxo-base',
      titulo: `Fluxo ${modelo.nome}`,
      referencia: modelosBot.fonteDe(modelo.id),
      validacao: 'pendente-de-validacao',
    });
  } else {
    fontes.push({
      id: 'preparacao-generica',
      tipo: 'estrutura',
      titulo: 'Estrutura inicial gerada pelo 0007',
      referencia: 'engine/vs0007/bots.mjs#prepararEspecialidade',
      validacao: 'pendente-de-validacao',
    });
  }

  const aprovada = listarBots().find((bot) =>
    bot.estado === 'homologado'
    && normalizarBusca(bot.especialidade) === normalizarBusca(esp));
  const nosHomologados = aprovada
    ? MAPA.obterNos(aprovada.agenteId).nos.filter((no) => no.estado === 'homologado')
    : [];
  const passosHomologados = aprovada?.preparacao?.modeloBase?.passos || [];
  const usaModeloHomologado = passosHomologados.length > 0;
  const origemFluxo = usaModeloHomologado
    ? `hotel:${aprovada.agenteId}/preparacao.modeloBase`
    : (modelo ? modelosBot.fonteDe(modelo.id) : 'preparacao-generica');
  if (aprovada) {
    fontes.push({
      id: 'modelo-homologado',
      tipo: 'modelo-homologado',
      titulo: aprovada.nome,
      referencia: `hotel:${aprovada.agenteId}`,
      validacao: 'homologado-na-origem',
    });
  }
  if (usaModeloHomologado) {
    const fonteFluxo = fontes.find((fonte) => fonte.id === 'fluxo-base');
    if (fonteFluxo) {
      fonteFluxo.titulo = `Fluxo homologado: ${aprovada.nome}`;
      fonteFluxo.referencia = origemFluxo;
      fonteFluxo.validacao = 'homologado-na-origem';
    } else {
      fontes.push({
        id: 'fluxo-base',
        tipo: 'fluxo-base',
        titulo: `Fluxo homologado: ${aprovada.nome}`,
        referencia: origemFluxo,
        validacao: 'homologado-na-origem',
      });
    }
  }

  const passos = usaModeloHomologado
    ? passosHomologados
    : (modelo ? (modelosBot.passosDe(modelo.id) || []) : []);
  const ehSalao = ['cadevc-barbearia', 'recepcao-servicos'].includes(modelo?.id);
  const resultadoFluxo = passos.length ? validarFluxo(passos) : { erros: [] };
  const etapas = passos.map((passo) => `${passo.id}: ${primeiraLinha(passo.mensagem)}`);
  const categorias = unicos(passos.map((passo) => passo.categoria));
  if (passos.length) {
    fontes.push({
      id: 'validacao-fluxo',
      tipo: 'validacao',
      titulo: 'Verificação estrutural do fluxo-base',
      referencia: 'engine/vsbot/fluxo.mjs#validarFluxo',
      validacao: resultadoFluxo.erros.length ? 'falhas-identificadas' : 'estrutura-pendente-de-homologacao',
    });
  }
  const perfilProfissao = profissoesBot.montar({ nome: pf.nome, profissao, jeito: 'meio' });
  if (!perfilProfissao.ok) return { erro: `nao foi possivel montar a profissao: ${perfilProfissao.motivo}` };
  const orientacaoProfissao = perfilProfissao.config.persona;
  const perfil = {
    funcao: pf.nome,
    objetivoPrincipal: final,
    limitesAtuacao: 'Usar informações confirmadas, não executar ações sem permissão e encaminhar solicitações fora do escopo ou sem dados suficientes.',
    persona: orientacaoProfissao.replaceAll(pf.nome, '{nome}'),
    mensagemInicial: perfilProfissao.config.saudacao.replaceAll(pf.nome, '{nome}'),
    mensagemFallback: perfilProfissao.config.mensagemFallback,
    regrasAdicionais: [...REGRAS_PERFIL_PADRAO],
  };
  const atividadeProfissao = `${pf.nome}: ${pf.foco}`;
  const atividades = unicos([
    atividadeProfissao,
    modelo ? `Conduzir o fluxo inicial de ${modelo.nome}` : `Atender solicitações relacionadas a ${esp}`,
    ...etapas.map((etapa) => `Executar etapa do fluxo: ${etapa}`),
    ...(ehSalao ? [
      'Consultar serviços, profissionais e horários reais na agenda conectada do Salão.',
      'Agendar um horário após o cliente escolher o serviço, profissional e horário.',
      'Consultar e cancelar agendamentos somente após identificar a escolha do cliente.',
    ] : []),
  ]);
  const responsabilidades = unicos([
    pf.foco,
    orientacaoProfissao,
    `Seguir as regras e os limites de autonomia definidos para ${esp}.`,
    'Encaminhar para uma pessoa quando faltar informação, autorização ou integração.',
    ...(aprovada?.responsabilidades || []),
  ]);

  const textoFluxo = [modelo?.descricao, ...passos.map((passo) => `${passo.id} ${passo.mensagem}`)].join(' ').toLowerCase();
  const ferramentas = [];
  if (categorias.length) ferramentas.push(ferramentaSugerida(
    'catalogo/estoque',
    `O fluxo consulta as categorias: ${categorias.join(', ')}.`,
    origemFluxo,
  ));
  if (/pedido|carrinho|confirmar/.test(textoFluxo)) ferramentas.push(ferramentaSugerida(
    'pedidos',
    'O fluxo coleta ou confirma os itens do pedido.',
    origemFluxo,
  ));
  if (/pix|pagamento|cobran[cç]a|pagar/.test(textoFluxo)) ferramentas.push(ferramentaSugerida(
    'pagamentos',
    'A descrição ou o fluxo menciona pagamento; credenciais e operação precisam ser configuradas.',
    origemFluxo,
  ));
  if (/entrega|retirada|endere[cç]o|bairro/.test(textoFluxo)) ferramentas.push(ferramentaSugerida(
    'entrega/retirada',
    'O fluxo trata de entrega, endereço ou retirada.',
    origemFluxo,
  ));
  if (!ferramentas.length) ferramentas.push(ferramentaSugerida(
    'canal de atendimento',
    'Definir o canal e as integrações disponíveis durante a implantação.',
    'preparacao-generica',
  ));
  for (const ferramenta of aprovada?.ferramentas || []) {
    ferramentas.push(ferramentaSugerida(
      ferramenta,
      'Ferramenta registrada no modelo homologado de origem.',
      'modelo-homologado',
    ));
  }

  const regras = unicos([
    'Usar somente informações confirmadas no catálogo e nas configurações da empresa.',
    'Não inventar preço, disponibilidade, prazo, horário ou condição comercial.',
    'Confirmar com o cliente os dados da solicitação antes de concluir.',
    'Encaminhar para uma pessoa quando a resposta não estiver nas fontes disponíveis.',
    ...(ehSalao ? [
      'Consultar serviços, profissionais, preços, horários e disponibilidade somente na agenda Cadê Você conectada.',
      'Não confirmar um agendamento ou cancelamento sem a escolha explícita do cliente.',
      'Não alterar serviços, preços, horários de funcionamento ou cadastro de profissionais.',
    ] : []),
    ...(aprovada?.regras || []),
  ]);
  const permissoes = unicos([
    'Permitido: explicar a finalidade e conduzir as etapas revisadas do fluxo.',
    'Permitido: coletar os dados necessários para encaminhamento ou pedido.',
    ...(ehSalao ? [
      'Permitido: consultar a agenda conectada e informar serviços, profissionais e horários retornados por ela.',
      'Permitido: criar ou cancelar agendamento somente após confirmação explícita do cliente.',
      'Bloqueado: alterar catálogo, preços, expediente ou cadastro de profissionais.',
      'Bloqueado: cobrar, conceder descontos, reembolsar ou autorizar exceções.',
    ] : [
      'Exige confirmação da empresa: cobranças, descontos, reembolsos, cancelamentos e exceções.',
    ]),
    'Bloqueado até configuração: confirmar disponibilidade, preço ou prazo sem consultar a integração correspondente.',
    ...(aprovada?.permissoes || []),
  ]);
  const horarios = [
    'Expediente não informado; usar o horário cadastrado pela empresa e não inventar horários.',
    'Fora do expediente: informar o horário configurado e registrar a solicitação para retorno.',
  ];
  const autonomia = [
    'Autonomia inicial limitada às respostas e etapas do fluxo revisado.',
    'Não concluir ações financeiras ou exceções comerciais sem confirmação e integração configurada.',
    'Pausar e encaminhar quando faltar dado, fonte confiável ou permissão.',
    ...(ehSalao ? [
      'A agenda conectada é a fonte de verdade; sem conexão ou retorno válido, não oferecer horários.',
      'Não modificar dados operacionais do salão por mensagem.',
    ] : []),
    ...(aprovada?.autonomia || []),
  ];
  const conhecimentos = [
    { categoria: 'profissao', conteudo: atividadeProfissao, origem: fonteProfissao },
    { categoria: 'orientacao-profissional', conteudo: orientacaoProfissao, origem: fonteProfissao },
    { categoria: 'limites', conteudo: 'Informações ausentes devem ser tratadas como desconhecidas e encaminhadas para validação.', origem: fonteProfissao },
  ];
  if (categorias.length) conhecimentos.push({
    categoria: 'categorias-do-fluxo',
    conteudo: `Categorias referenciadas pelo fluxo: ${categorias.join(', ')}.`,
    origem: origemFluxo,
  });
  if (etapas.length) conhecimentos.push({
    categoria: 'etapas-do-fluxo',
    conteudo: `O fluxo-base contém ${etapas.length} etapas: ${etapas.map((etapa) => etapa.split(':')[0]).join(', ')}.`,
    origem: origemFluxo,
  });
  for (const no of nosHomologados) {
    conhecimentos.push({
      categoria: no.categoria,
      conteudo: no.conteudo,
      origem: `hotel:${aprovada.agenteId}`,
      estadoOrigem: 'homologado',
    });
  }
  for (const conhecimento of aprovada?.conhecimentos || []) {
    if (typeof conhecimento === 'string') {
      conhecimentos.push({
        categoria: 'conhecimento-de-modelo',
        conteudo: conhecimento,
        origem: `hotel:${aprovada.agenteId}`,
        estadoOrigem: 'homologado',
      });
    } else if (conhecimento?.conteudo) {
      conhecimentos.push({
        ...conhecimento,
        origem: `hotel:${aprovada.agenteId}`,
        estadoOrigem: 'homologado',
      });
    }
  }

  const lacunas = [
    'Horário real de funcionamento da empresa.',
    'Produtos/serviços, preços e disponibilidade atuais.',
    'Regras comerciais e contatos para encaminhamento.',
  ];
  if (/entrega|retirada|endere[cç]o|bairro/.test(textoFluxo)) {
    lacunas.push('Áreas atendidas, taxas e prazos de entrega ou retirada.');
  }
  if (/pix|pagamento|cobran[cç]a|pagar/.test(textoFluxo)) {
    lacunas.push('Meios de pagamento e credenciais da integração.');
  }
  const falhas = resultadoFluxo.erros || [];
  const validacao = {
    estado: passos.length && !falhas.length ? 'pendente' : (falhas.length ? 'com_falhas' : 'nao_executada'),
    validado: false,
    escopo: passos.length ? 'validacao estrutural do fluxo-base' : 'estrutura generica, sem fluxo executavel',
    verificacaoEstrutural: passos.length ? 'executada' : 'nao_executada',
    falhas,
    runtime: 'nao_executado',
    homologacao: 'pendente',
  };
  const mapaMental = [
    ...responsabilidades.map((conteudo) => ({ categoria: 'responsabilidades', conteudo, origem: fonteProfissao })),
    ...atividades.map((conteudo) => ({ categoria: 'atividades', conteudo, origem: origemFluxo })),
    ...unicos([...etapas, ...(aprovada?.fluxos || [])]).map((conteudo) => ({ categoria: 'fluxos', conteudo, origem: origemFluxo })),
    ...conhecimentos.map((item) => ({ categoria: item.categoria, conteudo: item.conteudo, origem: item.origem })),
    ...ferramentas.map((item) => ({ categoria: 'ferramentas-e-integracoes', conteudo: `${item.nome}: ${item.justificativa}`, origem: item.origem })),
    ...regras.map((conteudo) => ({ categoria: 'regras', conteudo, origem: 'regras-iniciais-0007' })),
    ...permissoes.map((conteudo) => ({ categoria: 'permissoes', conteudo, origem: 'regras-iniciais-0007' })),
    ...horarios.map((conteudo) => ({ categoria: 'horarios', conteudo, origem: 'regras-iniciais-0007' })),
    ...autonomia.map((conteudo) => ({ categoria: 'autonomia', conteudo, origem: 'regras-iniciais-0007' })),
    ...falhas.map((conteudo) => ({ categoria: 'falhas-de-preparacao', conteudo, origem: 'validacao-fluxo' })),
    ...lacunas.map((conteudo) => ({ categoria: 'lacunas', conteudo, origem: 'dados-da-empresa' })),
  ];
  const descobertas = [
    ...conhecimentos.map((item) => ({ ...item, estado: 'descoberto', validado: false })),
    ...etapas.map((conteudo) => ({ categoria: 'fluxo', conteudo, origem: origemFluxo, estado: 'descoberto', validado: false })),
  ];

  return {
    ok: true,
    pesquisadoPor: '0007',
    especialidadeId: modelo?.id || null,
    especialidade: esp,
    profissao: { id: profissao, nome: pf.nome, foco: pf.foco },
    finalidade: final,
    modeloBase: usaModeloHomologado ? {
      id: aprovada.agenteId,
      nome: aprovada.nome,
      status: 'homologado_na_origem',
      descricao: `Adaptação do modelo homologado ${aprovada.nome} para a finalidade informada.`,
      arquivo: origemFluxo,
      passos,
      agenteOrigemId: aprovada.agenteId,
    } : modelo ? {
      id: modelo.id,
      nome: modelo.nome,
      status: 'nao_homologado',
      descricao: modelo.descricao,
      arquivo: modelosBot.fonteDe(modelo.id),
      passos,
      agenteOrigemId: aprovada?.agenteId || null,
    } : {
      id: null,
      nome: 'Estrutura inicial criada pelo 0007',
      status: 'sem_modelo_base',
      descricao: 'Estrutura genérica baseada na profissão e na finalidade informadas.',
      arquivo: null,
      passos: [],
      agenteOrigemId: null,
    },
    responsabilidades,
    atividades: unicos([...atividades, ...(aprovada?.atividades || [])]),
    fluxos: etapas.length ? etapas : (aprovada?.fluxos?.length ? aprovada.fluxos : [
      `Receber solicitações relacionadas a ${esp}.`,
      'Identificar as informações necessárias e registrar o pedido de atendimento.',
      'Encaminhar para a equipe quando a solicitação exigir dados ou ação não configurados.',
    ]),
    ferramentas,
    regras,
    permissoes,
    horarios,
    autonomia,
    conhecimentos,
    perfil,
    mapaMental,
    lacunas,
    falhas,
    fontes,
    descobertas,
    validacao,
    notaPesquisa: 'Esta proposta usa fontes internas; a pesquisa externa do 0007 ocorre depois da aprovação da criação.',
    previsao: preverHomologacao({ falhas, lacunas, validacao }),
  };
}

/**
 * Cria uma preparação completa a partir do único dado que o criador precisa
 * informar: o nicho. A correspondência usa apenas modelos e fluxos locais.
 */
export function prepararNicho({ nicho } = {}) {
  const busca = String(nicho || '').trim();
  if (busca.length < 2) return { erro: 'informe um nicho com pelo menos 2 caracteres' };
  const segmento = segmentoDoNicho(busca);
  if (segmento) return prepararSegmento(segmento, busca);
  const pesquisa = pesquisarNicho({ nicho: busca });
  if (pesquisa.erro) return pesquisa;
  const modelo = pesquisa.modelos[0] || null;
  const especialidade = modelo?.nome || busca;
  const profissao = PROFISSAO_POR_MODELO[modelo?.id] || 'atendente';
  const finalidade = modelo
    ? `Atender clientes de ${especialidade}, orientar com base no catálogo e no fluxo aprovado e encaminhar dúvidas fora das informações cadastradas.`
    : `Atender solicitações relacionadas a ${especialidade}, usar somente informações confirmadas e encaminhar o que ainda não estiver configurado.`;
  const preparacao = prepararEspecialidade({
    especialidadeId: modelo?.id || '',
    especialidade,
    profissao,
    finalidade,
  });
  if (preparacao.erro) return preparacao;
  /* Sem modelo pronto, a IA é do nicho que a pessoa pediu, não "Atendente de loja". */
  const preparada = modelo ? preparacao
    : JSON.parse(JSON.stringify(preparacao).replaceAll('Atendente de loja', JSON.stringify(`Atendente de ${especialidade}`).slice(1, -1)));
  return {
    ...preparada,
    nicho: busca,
    nomeSugerido: `Atendente ${especialidade}`,
    pesquisaLocal: {
      fontes: ['catálogo de nichos', 'fluxos e dados do sistema', 'mapa mental do 0007'],
      internetConsultada: false,
      melhorCorrespondencia: modelo?.id || null,
    },
  };
}

/* O nicho é um ramo de negócio: não casa com modelo de comida nem vira profissão.
   A profissão-base só dá o tom da conversa; a função mostrada é a do segmento. */
function prepararSegmento(segmento, nicho) {
  const base = prepararEspecialidade({ especialidade: segmento.nome, profissao: segmento.profissaoBase, finalidade: segmento.finalidade });
  if (base.erro) return base;
  const nomeProfissao = base.profissao.nome;
  const preparacao = JSON.parse(JSON.stringify(base).replaceAll(nomeProfissao, segmento.funcao));
  const operacoes = segmento.temas.map((tema) => `Conhecer e orientar sobre: ${tema.nome}`);
  return {
    ...preparacao,
    atividades: unicos([...preparacao.atividades, ...operacoes]),
    mapaMental: [...preparacao.mapaMental, ...operacoes.map((conteudo) => ({ categoria: 'atividades', conteudo, origem: `segmento:${segmento.id}` }))],
    nicho,
    segmento: { id: segmento.id, nome: segmento.nome, especialidade: segmento.especialidadeDigital, temas: segmento.temas.map((tema) => tema.nome), minimoTemas: segmento.minimoTemas },
    nomeSugerido: segmento.nomeSugerido,
    pesquisaLocal: {
      fontes: ['perfil de segmento do 0007'],
      internetConsultada: false,
      melhorCorrespondencia: null,
    },
  };
}

export function revisarPreparacao(preparacao, revisao = {}) {
  if (!preparacao?.ok) return { erro: 'preparacao do 0007 invalida' };
  const listas = ['responsabilidades', 'atividades', 'fluxos', 'ferramentas', 'regras', 'permissoes', 'horarios', 'autonomia', 'falhas', 'lacunas'];
  const resultado = { ...preparacao };
  for (const chave of listas) {
    if (Array.isArray(revisao[chave])) resultado[chave] = unicos(revisao[chave]);
  }
  for (const chave of ['conhecimentos', 'mapaMental']) {
    if (Array.isArray(revisao[chave])) {
      resultado[chave] = revisao[chave]
        .filter((item) => item && String(item.conteudo || '').trim())
        .map((item) => ({
          categoria: String(item.categoria || 'conhecimento').trim(),
          conteudo: String(item.conteudo).trim(),
          origem: 'revisao-do-criador',
          estado: 'descoberto',
          validado: false,
        }));
    }
  }
  const mapaOriginal = preparacao.mapaMental || [];
  const mapaRevisado = resultado.mapaMental || [];
  const mapaIntocado = mapaOriginal.length === mapaRevisado.length
    && mapaOriginal.every((item, index) =>
      item.categoria === mapaRevisado[index].categoria
      && item.conteudo === mapaRevisado[index].conteudo);
  if (mapaIntocado && Array.isArray(revisao.mapaMental)) {
    const origem = 'revisao-do-criador';
    const itens = (categoria, valores) => valores.map((conteudo) => ({ categoria, conteudo, origem }));
    const ferramentas = resultado.ferramentas.map((item) =>
      typeof item === 'string' ? item : `${item.nome}: ${item.justificativa}`);
    resultado.mapaMental = [
      ...itens('responsabilidades', resultado.responsabilidades),
      ...itens('atividades', resultado.atividades),
      ...itens('fluxos', resultado.fluxos),
      ...resultado.conhecimentos.map((item) => ({ ...item, origem })),
      ...itens('ferramentas-e-integracoes', ferramentas),
      ...itens('regras', resultado.regras),
      ...itens('permissoes', resultado.permissoes),
      ...itens('horarios', resultado.horarios),
      ...itens('autonomia', resultado.autonomia),
      ...itens('falhas-de-preparacao', resultado.falhas),
      ...itens('lacunas', resultado.lacunas),
    ];
  }
  resultado.descobertas = resultado.conhecimentos.map((item) => ({
    ...item,
    estado: 'descoberto',
    validado: false,
  }));
  resultado.validacao = {
    ...preparacao.validacao,
    estado: 'pendente',
    validado: false,
    falhas: resultado.falhas,
    homologacao: 'pendente',
    revisaoDoCriador: true,
  };
  return resultado;
}

/* ═════════ 1. CRIAÇÃO (0007) ═════════ */

function normalizarPerfil(entrada = {}, nome = 'Atendente', contexto = {}) {
  const dados = entrada && typeof entrada === 'object' ? entrada : {};
  const regras = Array.isArray(dados.regrasAdicionais) ? dados.regrasAdicionais : [];
  if (regras.some((regra) => typeof regra !== 'string')) return { erro: 'as regras adicionais devem ser textos' };
  const perfil = {
    foto: String(dados.foto || ''),
    funcao: String(dados.funcao || contexto.funcao || contexto.especialidade || 'Atendente').trim(),
    objetivoPrincipal: String(dados.objetivoPrincipal || contexto.objetivoPrincipal || contexto.finalidade || 'Atender com segurança dentro do escopo configurado.').trim(),
    limitesAtuacao: String(dados.limitesAtuacao || contexto.limitesAtuacao || 'Usar apenas informações confirmadas; não executar ações sem permissão; encaminhar o que estiver fora do escopo.').trim(),
    persona: String(dados.persona || `Você é ${nome}, atende com educação e usa apenas informações confirmadas.`).trim(),
    mensagemInicial: String(dados.mensagemInicial || `Olá! Sou {nome}. Como posso ajudar?`).trim(),
    mensagemFallback: String(dados.mensagemFallback || 'Não encontrei essa informação. Vou encaminhar sua dúvida para a equipe.').trim(),
    regrasAdicionais: unicos([...REGRAS_PERFIL_PADRAO, ...regras]),
  };
  if (perfil.foto.length > 180_000 || (perfil.foto && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(perfil.foto))) {
    return { erro: 'foto invalida ou acima do limite; use JPEG, PNG ou WebP de ate 130 KB' };
  }
  if (!perfil.persona || perfil.persona.length > 1200) return { erro: 'a personalidade deve ter entre 1 e 1200 caracteres' };
  if (!perfil.funcao || perfil.funcao.length > 160) return { erro: 'a função deve ter entre 1 e 160 caracteres' };
  if (!perfil.objetivoPrincipal || perfil.objetivoPrincipal.length > 600) return { erro: 'o objetivo principal deve ter entre 1 e 600 caracteres' };
  if (!perfil.limitesAtuacao || perfil.limitesAtuacao.length > 1200) return { erro: 'os limites de atuação devem ter entre 1 e 1200 caracteres' };
  if (!perfil.mensagemInicial || perfil.mensagemInicial.length > 600) return { erro: 'a mensagem inicial deve ter entre 1 e 600 caracteres' };
  if (!perfil.mensagemFallback || perfil.mensagemFallback.length > 600) return { erro: 'a mensagem de fallback deve ter entre 1 e 600 caracteres' };
  if (perfil.regrasAdicionais.length > 20 || perfil.regrasAdicionais.some((regra) => regra.length > 300)) {
    return { erro: 'adicione no maximo 20 regras, com ate 300 caracteres cada' };
  }
  return { perfil };
}

function nosDoPerfil(perfil) {
  return [
    { categoria: 'personalidade', conteudo: perfil.persona },
    { categoria: 'funcao', conteudo: perfil.funcao },
    { categoria: 'objetivo-principal', conteudo: perfil.objetivoPrincipal },
    { categoria: 'limites-de-atuacao', conteudo: perfil.limitesAtuacao },
    { categoria: 'mensagens', conteudo: `Saudacao: ${perfil.mensagemInicial}` },
    { categoria: 'mensagens', conteudo: `Fallback: ${perfil.mensagemFallback}` },
    ...perfil.regrasAdicionais.map((conteudo) => ({ categoria: 'regras-adicionais', conteudo })),
  ].filter((no) => String(no.conteudo || '').trim());
}

/**
 * Cria um bot comercial novo, em preparação. A criação exige a autorização
 * expressa do criador: o 0007 propõe, o dono (criador) autoriza.
 * Retorna { bot, noId } ou { erro }.
 */
export function criarBotComercial({ nome, finalidade, especialidade, profissao, empresaCnpj = '', empresaNome = '', empresaCpf = '', empresaSite = '', autorizado = false, atividades = [], ferramentas = [], falhas = [], lacunas = [], conhecimentos = [], preparacao = null, perfil = null, donoId = '0007', identificadorUnico = false } = {}) {
  const final = String(finalidade || '').trim();
  const esp = String(especialidade || '').trim();
  let nomeBot = String(nome || final).trim();
  if (!final) { return { erro: 'finalidade obrigatoria' }; }
  if (!esp) { return { erro: 'especialidade obrigatoria' }; }
  if (!nomeBot || nomeBot.length > 80) { return { erro: 'o nome deve ter entre 1 e 80 caracteres' }; }
  if (!autorizado) { return { erro: 'a criacao de um bot comercial exige autorizacao expressa do criador' }; }
  const bots = load(DATASET_BOTS, []);
  const repetido = nomeEmUso(nomeBot, { bots });
  if (repetido) {
    if (!identificadorUnico) { return { erro: `já existe uma IA-ZEST com o nome "${repetido.nome}"; escolha outro nome` }; }
    nomeBot = nomeLivre(nomeBot, bots);
  }
  const cnpj = empresaCnpj ? validarDocumento(empresaCnpj) : null;
  if (empresaCnpj && (!cnpj.ok || cnpj.tipo !== 'CNPJ')) {
    return { erro: 'a personalização exige um CNPJ válido da empresa; CPF pessoal não é enviado à pesquisa externa' };
  }
  /* Base conhecida também serve de trava: CNPJ de uma empresa com site de outra
     criava IA falando do negócio errado (salão em bot de cardápio). */
  const baseConhecida = selecionarBase({ cnpj: cnpj?.digitos || '', site: empresaSite, nome: empresaNome });
  if (baseConhecida) {
    const identidade = validarIdentidadeBase(baseConhecida, { cnpj: cnpj?.digitos || '', site: empresaSite, nome: empresaNome });
    if (!identidade.ok) return { erro: identidade.motivo };
  }
  const perfilValidado = normalizarPerfil(perfil || preparacao?.perfil, nomeBot, {
    funcao: preparacao?.profissao?.nome || profissao || esp,
    finalidade: final,
    limitesAtuacao: (preparacao?.autonomia || []).join(' '),
  });
  if (perfilValidado.erro) return perfilValidado;
  const id = novoId(esp);
  let idFinal = id;
  if (bots.some((b) => b.agenteId === idFinal)) {
    if (!identificadorUnico) { return { erro: `ja existe um bot com esse identificador: ${idFinal}` }; }
    let sequencia = 1;
    while (bots.some((b) => b.agenteId === idFinal)) { idFinal = `${id}-${sequencia++}`; }
  }
  const criadoEm = HOJE();
  const cicloVida = novoCicloVida(criadoEm);
  const bot = {
    agenteId: idFinal,
    nome: nomeBot,
    perfil: perfilValidado.perfil,
    finalidade: final,
    especialidade: esp,
    ...(cnpj ? { empresaCnpj: cnpj.digitos } : {}),
    ...(empresaNome ? { empresaNome: String(empresaNome).trim().slice(0, 180) } : {}),
    ...(empresaCpf ? { empresaCpf: String(empresaCpf).replace(/\D/g, '') } : {}),
    ...(empresaSite ? { empresaSite: String(empresaSite).trim().slice(0, 300) } : {}),
    tipo: R.TIPO_COMERCIALIZAVEL,
    estado: 'em_preparacao',
    autorizadoCriador: true,
    donoId,
    profissao: profissao || preparacao?.profissao?.id || null,
    responsabilidades: [...(preparacao?.responsabilidades || [])],
    atividades: [...(atividades || [])],
    ferramentas: [...(ferramentas || [])],
    fluxos: [...(preparacao?.fluxos || [])],
    regras: [...(preparacao?.regras || [])],
    permissoes: [...(preparacao?.permissoes || [])],
    horarios: [...(preparacao?.horarios || [])],
    autonomia: [...(preparacao?.autonomia || [])],
    testado: false,
    falhas: [...(falhas || [])],
    lacunas: [...(lacunas || [])],
    conhecimentos: [...(conhecimentos || [])],
    fontes: [...(preparacao?.fontes || [])],
    descobertas: [...(preparacao?.descobertas || [])],
    validacao: preparacao?.validacao || { estado: 'pendente', validado: false, runtime: 'nao_executado', homologacao: 'pendente' },
    preparacao: preparacao ? {
      ...preparacao,
      aprovadaPeloCriador: true,
      aprovadaEm: HOJE(),
      estado: 'aprovada_para_criacao',
    } : null,
    criadoEm,
    cicloVida,
  };
  bot.preparacao = preparacao ? {
    ...bot.preparacao,
    pesquisaInicial: { estado: 'pendente', fontes: [], conhecimentos: [], limitacoes: ['A pesquisa externa ainda não foi registrada.'] },
    cicloVida,
  } : {
    ok: true,
    pesquisadoPor: '0007',
    responsabilidades: [],
    atividades: [...(atividades || [])],
    ferramentas: [...(ferramentas || [])],
    regras: [...REGRAS_PERFIL_PADRAO],
    permissoes: [],
    horarios: [],
    autonomia: [perfilValidado.perfil.limitesAtuacao],
    conhecimentos: [...(conhecimentos || [])],
    mapaMental: [],
    falhas: [...(falhas || [])],
    lacunas: [...(lacunas || [])],
    fontes: [],
    descobertas: [],
    notaPesquisa: 'A proposta interna foi criada; a pesquisa externa do 0007 ainda está pendente.',
    pesquisaInicial: { estado: 'pendente', fontes: [], conhecimentos: [], limitacoes: ['A pesquisa externa ainda não foi registrada.'] },
    cicloVida,
    aprovadaPeloCriador: true,
    aprovadaEm: criadoEm,
    estado: 'aprovada_para_criacao',
  };
  bot.cicloVida = cicloVida;
  save(DATASET_BOTS, [...bots, bot]);
  /* O cérebro nasce com o mapa mental explorável: primeiro nó em 'descoberto',
     que só pode evoluir (com autorização) rumo ao conhecimento homologado. */
  const evidenciaInicial = JSON.stringify({
    fonte: preparacao?.fontes?.map((fonte) => fonte.id) || ['fabrica-0007'],
    validacao: 'pendente',
    validado: false,
    aprovadaPeloCriador: Boolean(preparacao),
  });
  const no = MAPA.adicionarNo({
    agenteId: idFinal,
    categoria: 'especialidade',
    conteudo: final,
    estado: 'descoberto',
    origem: 'preparacao-0007',
    evidencia: evidenciaInicial,
  });
  if (no.erro) { return no; }
  const nos = [no.no];
  /* A proposta aprovada nasce no mapa como descoberta, nunca homologada. */
  const nosMapa = preparacao?.mapaMental?.length
    ? [...preparacao.mapaMental, ...nosDoPerfil(perfilValidado.perfil)]
    : [...(conhecimentos || []).map((c) => ({ categoria: c.categoria, conteudo: c.conteudo, origem: c.origem || 'fabrica-0007' })), ...nosDoPerfil(perfilValidado.perfil)];
  for (const c of nosMapa) {
    const conteudo = String(c?.conteudo || '').trim();
    if (!conteudo) { continue; }
    const curado = c?.verificacao === 'base-curada' || c?.qualidade === 'curada';
    const evidencia = JSON.stringify({
      fonte: c.origem || 'fabrica-0007',
      validacao: curado ? 'base-curada' : 'pendente',
      validado: curado,
      aprovadaPeloCriador: Boolean(preparacao),
    });
    const noC = MAPA.adicionarNo({
      agenteId: idFinal,
      categoria: String(c.categoria || 'conhecimento'),
      conteudo,
      estado: curado ? 'homologado' : 'descoberto',
      autorizado: curado,
      qualidade: curado ? 'curada' : (c.qualidade || 'descoberta'),
      verificacao: c.verificacao || null,
      origem: curado ? 'base-curada' : (c.origem || 'preparacao-0007'),
      evidencia,
    });
    if (noC && !noC.erro) { nos.push(noC.no); }
  }
  return {
    ok: true,
    bot: { ...bot, previsao: preverHomologacao(bot) },
    relatorio: relatorioPreparacao(bot),
    noId: no.no.id,
    nos,
  };
}

/** Atualiza o cartão do bot e registra cada mudança comportamental no mapa. */
export function atualizarPerfilBot({ agenteId, nome, perfil, autorizado = false } = {}) {
  if (!autorizado) return { erro: 'editar o perfil do bot exige autorizacao do criador' };
  const bots = load(DATASET_BOTS, []);
  const bot = bots.find((item) => item.agenteId === agenteId);
  if (!bot) return { erro: `bot nao encontrado: ${agenteId}` };
  if (bot.estado === 'bloqueado') return { erro: 'um bot bloqueado nao pode ser editado antes de ser desbloqueado' };
  const nomeNovo = String(nome || '').trim();
  if (!nomeNovo || nomeNovo.length > 80) return { erro: 'o nome deve ter entre 1 e 80 caracteres' };
  const repetido = nomeEmUso(nomeNovo, { excetoId: agenteId, bots });
  if (repetido) return { erro: `já existe outra IA-ZEST com o nome "${repetido.nome}"; escolha outro nome` };
  const contextoPerfil = {
    funcao: bot.perfil?.funcao || bot.profissao || bot.especialidade,
    finalidade: bot.finalidade,
    objetivoPrincipal: bot.perfil?.objetivoPrincipal || bot.finalidade,
    limitesAtuacao: bot.perfil?.limitesAtuacao || (bot.autonomia || []).join(' '),
  };
  const validado = normalizarPerfil(perfil, nomeNovo, contextoPerfil);
  if (validado.erro) return validado;
  const perfilAntigo = normalizarPerfil(bot.perfil, bot.nome, contextoPerfil).perfil || normalizarPerfil({}, bot.nome, contextoPerfil).perfil;
  const perfilNovo = validado.perfil;
  const chavesTexto = ['funcao', 'objetivoPrincipal', 'limitesAtuacao', 'persona', 'mensagemInicial', 'mensagemFallback', 'regrasAdicionais'];
  const comportamentoMudou = nomeNovo !== bot.nome
    || chavesTexto.some((chave) => JSON.stringify(perfilAntigo[chave]) !== JSON.stringify(perfilNovo[chave]));
  const mudou = nomeNovo !== bot.nome || JSON.stringify(perfilAntigo) !== JSON.stringify(perfilNovo);
  if (!mudou) return { ok: true, alterado: false, bot };

  if (comportamentoMudou) {
    const nos = nomeNovo !== bot.nome ? [{ categoria: 'identidade', conteudo: nomeNovo }] : [];
    if (perfilAntigo.funcao !== perfilNovo.funcao) nos.push({ categoria: 'funcao', conteudo: perfilNovo.funcao });
    if (perfilAntigo.objetivoPrincipal !== perfilNovo.objetivoPrincipal) nos.push({ categoria: 'objetivo-principal', conteudo: perfilNovo.objetivoPrincipal });
    if (perfilAntigo.limitesAtuacao !== perfilNovo.limitesAtuacao) nos.push({ categoria: 'limites-de-atuacao', conteudo: perfilNovo.limitesAtuacao });
    if (perfilAntigo.persona !== perfilNovo.persona) nos.push({ categoria: 'personalidade', conteudo: perfilNovo.persona });
    if (perfilAntigo.mensagemInicial !== perfilNovo.mensagemInicial) nos.push({ categoria: 'mensagens', conteudo: `Saudacao: ${perfilNovo.mensagemInicial}` });
    if (perfilAntigo.mensagemFallback !== perfilNovo.mensagemFallback) nos.push({ categoria: 'mensagens', conteudo: `Fallback: ${perfilNovo.mensagemFallback}` });
    if (JSON.stringify(perfilAntigo.regrasAdicionais) !== JSON.stringify(perfilNovo.regrasAdicionais)) {
      nos.push(...perfilNovo.regrasAdicionais.map((conteudo) => ({ categoria: 'regras-adicionais', conteudo })));
      nos.push(...perfilAntigo.regrasAdicionais.filter((regra) => !perfilNovo.regrasAdicionais.includes(regra))
        .map((conteudo) => ({ categoria: 'regras-adicionais', conteudo: `Regra removida: ${conteudo}` })));
    }
    for (const no of nos) {
      const resultado = MAPA.adicionarNo({
        agenteId,
        categoria: no.categoria,
        conteudo: no.conteudo,
        estado: 'descoberto',
        origem: 'edicao-do-cartao',
        evidencia: JSON.stringify({ validado: false, origem: 'revisao-do-criador' }),
      });
      if (resultado.erro) return resultado;
    }
    bot.estado = 'em_validacao';
    bot.testado = false;
    bot.validacao = {
      ...(bot.validacao || {}),
      estado: 'pendente',
      validado: false,
      homologacao: 'pendente',
      motivo: 'perfil alterado; requer nova validação',
    };
  }
  bot.nome = nomeNovo;
  bot.perfil = perfilNovo;
  if (bot.preparacao) {
    bot.preparacao = {
      ...bot.preparacao,
      perfil: perfilNovo,
      ...(comportamentoMudou ? { validacao: { ...bot.validacao } } : {}),
    };
  }
  bot.versao = String(Number.parseFloat(bot.versao || '1.0') + 0.1).slice(0, 5);
  bot.atualizadoEm = HOJE();
  save(DATASET_BOTS, bots);
  return { ok: true, alterado: true, bot };
}

/* ═════════ 2. LISTA E BUSCA ═════════ */

export function listarBots() {
  return load(DATASET_BOTS, []);
}

export function obterBot(agenteId) {
  return load(DATASET_BOTS, []).find((b) => b.agenteId === agenteId) || null;
}

export function relatorioPreparacao(bot) {
  const perfil = bot?.perfil || {};
  const pesquisa = bot?.preparacao?.pesquisaInicial || { estado: 'pendente', fontes: [], conhecimentos: [] };
  const cicloVida = bot?.cicloVida || bot?.preparacao?.cicloVida || novoCicloVida(bot?.criadoEm || HOJE());
  const prazo = cicloVida.preparacaoConhecimentoInicial || {};
  const atrasada = pesquisa.estado !== 'concluida' && prazo.prazoMaximoEm && Date.now() > Date.parse(prazo.prazoMaximoEm);
  return {
    identidade: {
      nome: bot?.nome || '',
      funcao: perfil.funcao || bot?.profissao || bot?.especialidade || '',
      especialidade: bot?.especialidade || '',
      comportamento: perfil.persona || '',
      objetivoPrincipal: perfil.objetivoPrincipal || bot?.finalidade || '',
      limitesAtuacao: perfil.limitesAtuacao || '',
    },
    mensagens: {
      inicial: perfil.mensagemInicial || '',
      fallback: perfil.mensagemFallback || '',
    },
    regras: [...(perfil.regrasAdicionais || [])],
    fontesRegistradas: [...(pesquisa.fontes || [])],
    conhecimentosIniciais: [...(pesquisa.conhecimentos || [])],
    limitacoes: [...(pesquisa.limitacoes || (pesquisa.estado === 'concluida' ? [] : ['Pesquisa externa inicial pendente.']))],
    preparacao: {
      estado: atrasada ? 'atrasada' : (pesquisa.estado || 'pendente'),
      prazoIdealEm: prazo.prazoIdealEm || null,
      prazoMaximoEm: prazo.prazoMaximoEm || null,
      concluidaEm: cicloVida.preparacaoConhecimentoInicial?.concluidaEm || null,
    },
    cicloVida: {
      configuracao: cicloVida.criacaoConfiguracao?.estado || 'concluida',
      etapa: cicloVida.etapa || 'preparacao-inicial',
      evolucao: cicloVida.evolucaoEspecializacao?.estado || 'continua',
    },
  };
}

/** Registra fontes e conhecimento externo sem homologá-los automaticamente. */
function registrarPesquisaInicial({
  agenteId,
  autorizado = false,
  fontes = [],
  conhecimentos = [],
  origemRegistro = 'informada-pelo-responsavel',
  limitacoesPesquisa = [],
  detalhesPesquisa = null,
} = {}) {
  if (!autorizado) return { erro: 'registrar a preparação inicial exige autorização do criador' };
  const bots = load(DATASET_BOTS, []);
  const bot = bots.find((item) => item.agenteId === agenteId);
  if (!bot) return { erro: `bot nao encontrado: ${agenteId}` };
  if (bot.estado === 'bloqueado') return { erro: 'um bot bloqueado nao pode receber preparacao antes de ser desbloqueado' };
  if (bot.preparacao?.pesquisaInicial?.estado === 'concluida') {
    return { erro: 'a preparação inicial já foi registrada; use o ciclo de evolução para novos conhecimentos' };
  }
  const pesquisa = normalizarPesquisaExterna(fontes, conhecimentos, segmentoDoNicho(bot.preparacao?.nicho)?.limites);
  if (pesquisa.erro) return pesquisa;
  const perfilNormalizado = normalizarPerfil(bot.perfil, bot.nome || bot.especialidade, {
    funcao: bot.profissao || bot.especialidade,
    finalidade: bot.finalidade,
    objetivoPrincipal: bot.finalidade,
    limitesAtuacao: (bot.autonomia || []).join(' '),
  });
  if (perfilNormalizado.erro) return { erro: `corrija o perfil antes de registrar a preparação: ${perfilNormalizado.erro}` };
  const mapaExistente = MAPA.obterNos(agenteId).nos;
  const nosPerfilPendentes = nosDoPerfil(perfilNormalizado.perfil).filter((item) =>
    !mapaExistente.some((no) => no.categoria === item.categoria && no.conteudo === item.conteudo));

  const concluidaEm = HOJE();
  const eraHomologado = bot.estado === 'homologado';
  const cicloVida = bot.cicloVida || bot.preparacao?.cicloVida || novoCicloVida(bot.criadoEm || concluidaEm);
  cicloVida.etapa = 'evolucao-especializacao';
  cicloVida.preparacaoConhecimentoInicial = {
    ...cicloVida.preparacaoConhecimentoInicial,
    estado: 'concluida',
    concluidaEm,
    fontesRegistradas: pesquisa.fontes.length,
    conhecimentosRegistrados: pesquisa.conhecimentos.length,
  };
  const curados = pesquisa.conhecimentos.filter((item) => item.verificacao === 'base-curada').length;
  const descobertos = pesquisa.conhecimentos.length - curados;
  const pesquisaInicial = {
    estado: 'concluida',
    registradaEm: concluidaEm,
    origemRegistro,
    ...detalhesPesquisa,
    fontes: pesquisa.fontes,
    conhecimentos: pesquisa.conhecimentos,
    limitacoes: [
      ...(origemRegistro === 'base-curada'
        ? ['As fontes e os fatos vieram da base curada da empresa, revisada com fonte antes de entrar no mapa.']
        : origemRegistro === 'pesquisa-automatica-0007'
          ? ['As páginas públicas registradas foram abertas e lidas pelo agente 0007; o conteúdo não foi validado por uma pessoa.']
          : ['As fontes foram declaradas pelo responsável e não verificadas automaticamente pelo sistema.']),
      ...(curados ? [`${curados} conhecimento(s) vieram da base curada da empresa e já estão homologados com fonte revisada.`] : []),
      ...(descobertos ? [`${descobertos} conhecimento(s) descoberto(s) na pesquisa ainda precisam de validação antes de serem homologados.`] : []),
      ...(eraHomologado ? ['O perfil anteriormente homologado voltou à validação para revisar a preparação registrada.'] : []),
      ...limitacoesPesquisa,
    ],
  };
  bot.cicloVida = cicloVida;
  bot.perfil = perfilNormalizado.perfil;
  bot.preparacao = {
    ...(bot.preparacao || {}),
    ok: true,
    perfil: perfilNormalizado.perfil,
    cicloVida,
    pesquisaInicial,
    fontes: [...(bot.preparacao?.fontes || []), ...pesquisa.fontes.map((fonte, indice) => ({
      id: `pesquisa-externa-${indice + 1}`,
      tipo: fonte.tipo,
      titulo: fonte.titulo,
      referencia: fonte.url,
      resumo: fonte.resumo,
      validacao: fonte.verificacao === 'pagina-consultada' ? 'pagina-consultada-pelo-0007' : 'declarada-pelo-responsavel',
    }))],
    conhecimentos: [...(bot.preparacao?.conhecimentos || []), ...pesquisa.conhecimentos],
    mapaMental: [...(bot.preparacao?.mapaMental || []), ...nosPerfilPendentes.map((item) => ({
      ...item,
      origem: 'perfil-minimo-0007',
      estado: 'descoberto',
      validado: false,
    })), ...pesquisa.conhecimentos.map((item) => noDeConhecimento(item))],
    notaPesquisa: origemRegistro === 'base-curada'
      ? 'Base curada da empresa aplicada: fatos revisados, com fonte, sem trecho aleatório de busca.'
      : origemRegistro === 'pesquisa-automatica-0007'
        ? 'Pesquisa externa realizada pelo agente 0007. As páginas foram consultadas e os trechos incorporados ao mapa como descobertas pendentes de validação.'
        : 'Preparação inicial registrada com fontes externas declaradas pelo responsável; verificação automática indisponível.',
  };
  if (eraHomologado) {
    bot.estado = 'em_validacao';
    bot.validacao = {
      ...(bot.validacao || {}),
      estado: 'pendente',
      validado: false,
      runtime: 'nao_executado',
      homologacao: 'pendente',
      motivo: 'preparação inicial registrada; requer nova validação',
    };
    bot.preparacao.validacao = { ...bot.validacao };
  }
  if (pesquisaInicial.baseConhecimento) bot.baseConhecimento = pesquisaInicial.baseConhecimento;
  bot.fontes = [...(bot.fontes || []), ...pesquisaInicial.fontes];
  bot.conhecimentos = [...(bot.conhecimentos || []), ...pesquisa.conhecimentos];
  bot.descobertas = [...(bot.descobertas || []), ...nosPerfilPendentes.map((item) => ({
    ...item, origem: 'perfil-minimo-0007', estado: 'descoberto', validado: false,
  })), ...pesquisa.conhecimentos.map((item) => noDeConhecimento(item))];
  bot.atualizadoEm = concluidaEm;
  save(DATASET_BOTS, bots);

  for (const item of [...nosPerfilPendentes.map((no) => ({ ...no, origem: 'perfil-minimo-0007' })), ...pesquisa.conhecimentos]) {
    const curado = item.verificacao === 'base-curada';
    const evidencia = JSON.stringify({
      fonte: item.origem || 'perfil-minimo-0007',
      validacao: curado
        ? 'base-curada'
        : item.origem === 'perfil-minimo-0007'
          ? 'configuracao-minima'
          : item.estado === 'descoberto' ? 'pagina-consultada-pelo-0007' : 'declarada-pelo-responsavel',
      validado: curado,
    });
    const no = MAPA.adicionarNo({
      agenteId,
      categoria: item.categoria,
      conteudo: item.conteudo,
      estado: curado ? 'homologado' : 'descoberto',
      autorizado: curado,
      qualidade: curado ? 'curada' : (item.origem === 'perfil-minimo-0007' ? 'configuracao' : 'descoberta'),
      verificacao: item.verificacao || (item.origem === 'perfil-minimo-0007' ? 'configuracao-minima' : 'pagina-consultada-pelo-0007'),
      origem: curado ? 'base-curada' : (item.origem === 'perfil-minimo-0007' ? 'perfil-minimo-0007' : 'pesquisa-externa-inicial'),
      evidencia,
    });
    if (no.erro) return no;
  }
  return { ok: true, bot, relatorio: relatorioPreparacao(bot) };
}

export async function pesquisarERegistrarPreparacaoInicial({ agenteId, autorizado = false, empresaCnpj = '', empresaNome = '', empresaCpf = '', fetch: fetchFn, curl: curlFn } = {}) {
  if (!autorizado) return { erro: 'a pesquisa inicial exige autorização do criador' };
  const bot = obterBot(agenteId);
  if (!bot) return { erro: `bot nao encontrado: ${agenteId}` };
  if (bot.estado === 'bloqueado') return { erro: 'um bot bloqueado nao pode receber preparacao antes de ser desbloqueado' };
  if (bot.preparacao?.pesquisaInicial?.estado === 'concluida') {
    return { erro: 'a preparação inicial já foi registrada; use o ciclo de evolução para novos conhecimentos' };
  }
  const cnpjPesquisa = empresaCnpj || bot.empresaCnpj || '';
  const nomePesquisa = empresaNome || bot.empresaNome || '';
  const cpfPesquisa = empresaCpf || bot.empresaCpf || '';
  if (cnpjPesquisa) {
    const validacaoCnpj = validarDocumento(cnpjPesquisa);
    if (!validacaoCnpj.ok || validacaoCnpj.tipo !== 'CNPJ') {
      return { erro: 'a personalização exige um CNPJ válido da empresa' };
    }
    bot.empresaCnpj = validacaoCnpj.digitos;
  }
  if (nomePesquisa) bot.empresaNome = String(nomePesquisa).trim().slice(0, 180);
  if (cpfPesquisa) {
    const validacaoCpf = validarDocumento(cpfPesquisa);
    if (!validacaoCpf.ok || validacaoCpf.tipo !== 'CPF') {
      return { erro: 'o CPF informado não é válido' };
    }
    /* CPF é documento pessoal: fica só no cadastro local e nunca vai a buscador. */
    bot.empresaCpf = validacaoCpf.digitos;
  }

  const dependenciasPesquisa = {};
  if (fetchFn) dependenciasPesquisa.fetch = fetchFn;
  if (curlFn) dependenciasPesquisa.curl = curlFn;
  const pesquisa = await pesquisarPreparacaoNaWeb({
    especialidade: bot.especialidade,
    nicho: bot.preparacao?.nicho || '',
    siteEmpresa: bot.empresaSite || '',
    parcial: bot.preparacao?.pesquisaParcial || [],
    finalidade: bot.finalidade,
    profissao: bot.perfil?.funcao || bot.profissao,
    empresaCnpj: cnpjPesquisa,
    empresaNome: nomePesquisa,
  }, dependenciasPesquisa);
  if (pesquisa.erro) {
    if (segmentoDoNicho(bot.preparacao?.nicho)) {
      const todos = load(DATASET_BOTS, []);
      const alvo = todos.find((item) => item.agenteId === agenteId);
      if (alvo?.preparacao) { alvo.preparacao.pesquisaParcial = (pesquisa.fontes || []).filter((fonte) => fonte.tema); save(DATASET_BOTS, todos); }
    }
    return {
      ...pesquisa,
      mensagem: 'O bot foi criado, mas a pesquisa externa ainda está pendente. Nenhuma fonte foi inventada; tente novamente quando a busca estiver disponível.',
    };
  }

  const resultado = registrarPesquisaInicial({
    agenteId,
    autorizado,
    fontes: pesquisa.fontes.map((fonte) => ({
      ...fonte,
      origem: fonte.verificacao === 'base-curada' ? 'base-curada' : 'pesquisa-automatica-0007',
      verificacao: fonte.verificacao === 'base-curada'
        ? 'base-curada'
        : fonte.verificacao === 'trecho-do-buscador' ? 'trecho-do-buscador' : 'pagina-consultada',
    })),
    conhecimentos: pesquisa.conhecimentos,
    origemRegistro: pesquisa.buscador === 'base-curada' ? 'base-curada' : 'pesquisa-automatica-0007',
    limitacoesPesquisa: pesquisa.limitacoes,
    detalhesPesquisa: {
      empresa: pesquisa.empresa,
      buscador: pesquisa.buscador,
      pesquisadoEm: pesquisa.pesquisadoEm,
      consultasRealizadas: pesquisa.consultas,
      falhasPesquisa: pesquisa.falhas,
      baseConhecimento: pesquisa.baseConhecimento || null,
    },
  });
  if (resultado.erro) return resultado;
  return { ...resultado, pesquisa: { buscador: pesquisa.buscador, falhas: pesquisa.falhas } };
}

/* ═════════ 3. DERIVAÇÃO DE MODELO PELOLA DEUSAS ═════════ */

/**
 * A deusa (Ísis, Hera ou Perséfone) propõe um modelo comercial derivado da sua
 * especialidade. Só com autorização expressa do criador. O modelo derivado nasce
 * independente: guarda a especialidade, as instruções funcionais e os conhecimentos
 * aprovados — NUNCA memórias, conversas, dados pessoais ou histórico da deusa.
 */
export function registrarModeloDerivado({ deusaId, especialidade, autorizado = false, modeloOrigemId = null, donoId = '0007' } = {}) {
  const esp = String(especialidade || '').trim();
  if (!deusaId) { return { erro: 'deusa origem obrigatoria' }; }
  if (!esp) { return { erro: 'especialidade obrigatoria' }; }
  if (!autorizado) { return { erro: `a derivacao de modelo pela deusa ${deusaId} exige autorizacao expressa do criador` }; }
  const id = novoId(esp);
  const bots = load(DATASET_BOTS, []);
  if (bots.some((b) => b.agenteId === id)) { return { erro: `ja existe um bot com esse identificador: ${id}` }; }
  const finalidade = `Especialidade comercial derivada de ${deusaId}: ${esp}`;
  const preparacao = prepararEspecialidade({ especialidade: esp, profissao: 'atendente', finalidade });
  if (preparacao.erro) return preparacao;
  const criadoEm = HOJE();
  const cicloVida = novoCicloVida(criadoEm);
  const perfilValidado = normalizarPerfil(preparacao.perfil, `Modelo ${esp}`, {
    funcao: preparacao.profissao.nome,
    finalidade,
    limitesAtuacao: preparacao.autonomia.join(' '),
  });
  if (perfilValidado.erro) return perfilValidado;
  const modelo = {
    agenteId: id,
    nome: String(`Modelo ${esp}`),
    finalidade,
    especialidade: esp,
    profissao: preparacao.profissao.id,
    perfil: perfilValidado.perfil,
    tipo: R.TIPO_COMERCIALIZAVEL,
    estado: 'em_preparacao',
    autorizadoCriador: true,
    donoId,
    derivadoDe: { deusaId, modeloOrigemId, copiandoMemorias: false },
    responsabilidades: [...preparacao.responsabilidades],
    atividades: [...preparacao.atividades],
    ferramentas: preparacao.ferramentas.map((item) => item.nome),
    fluxos: [...preparacao.fluxos],
    regras: [...preparacao.regras],
    permissoes: [...preparacao.permissoes],
    horarios: [...preparacao.horarios],
    autonomia: [...preparacao.autonomia],
    conhecimentos: [...preparacao.conhecimentos],
    fontes: [...preparacao.fontes],
    descobertas: [...preparacao.descobertas],
    falhas: [...preparacao.falhas],
    lacunas: [...preparacao.lacunas],
    validacao: preparacao.validacao,
    preparacao: {
      ...preparacao,
      pesquisaInicial: { estado: 'pendente', fontes: [], conhecimentos: [], limitacoes: ['A pesquisa externa ainda não foi registrada.'] },
      cicloVida,
      estado: 'aprovada_para_criacao',
      aprovadaPeloCriador: true,
      aprovadaEm: criadoEm,
    },
    cicloVida,
    criadoEm,
  };
  save(DATASET_BOTS, [...bots, modelo]);
  const no = MAPA.adicionarNo({ agenteId: id, categoria: 'especialidade', conteudo: esp, estado: 'descoberto', origem: `derivacao-${deusaId}` });
  if (no.erro) { return no; }
  const nos = [no.no];
  for (const item of [...preparacao.mapaMental, ...nosDoPerfil(perfilValidado.perfil)]) {
    const conteudo = String(item?.conteudo || '').trim();
    if (!conteudo) continue;
    const registro = MAPA.adicionarNo({
      agenteId: id,
      categoria: String(item.categoria || 'conhecimento'),
      conteudo,
      estado: 'descoberto',
      origem: `derivacao-${deusaId}`,
      evidencia: JSON.stringify({ fonte: item.origem || 'preparacao-0007', validado: false, copiandoMemorias: false }),
    });
    if (registro.erro) return registro;
    nos.push(registro.no);
  }
  return { ok: true, modelo: { ...modelo }, independente: true, noId: no.no.id, nos };
}

/* Previsão de homologação: o que ainda falta para o bot (proposta ou bot já
   criado) ficar apto a ser homologado pelo chefe. A resposta não decide nada —
   só informa o que está em aberto, pra o dono não precisar adivinhar se o bot
   vai ficar preso na fábrica ou pronto pra aprovação. */
export function preverHomologacao(bot) {
  const fonte = bot?.preparacao || bot || {};
  const falhas = unicos([...(bot?.falhas || []), ...(fonte.falhas || [])]);
  const lacunas = unicos([...(bot?.lacunas || []), ...(fonte.lacunas || [])]);
  const validacao = fonte.validacao || {};
  const pesquisaInicialPendente = fonte.pesquisaInicial?.estado !== 'concluida';
  const faltaValidar = validacao.validado !== true;
  const podeHomologarAgora = !falhas.length && !lacunas.length && !faltaValidar && !pesquisaInicialPendente;
  const motivos = [];
  if (pesquisaInicialPendente) motivos.push('preparação inicial pendente — registrar pesquisa externa proporcional e conhecimentos básicos');
  if (faltaValidar) motivos.push('validação do fluxo pendente — o chefe só homologa depois de validar');
  if (falhas.length) motivos.push(`falhas na preparação (${falhas.length}) — resolver antes de homologar`);
  if (lacunas.length) motivos.push(`lacunas de conhecimento/configuração (${lacunas.length}) — preencher antes de homologar`);
  return {
    podeHomologarAgora,
    previa: podeHomologarAgora ? 'pronto-para-homologar' : (motivos.length ? 'em-curso' : 'pronto-para-homologar'),
    falhas: falhas.length,
    lacunas: lacunas.length,
    validacaoConcluida: validacao.validado === true,
    preparacaoInicialConcluida: !pesquisaInicialPendente,
    estadoValidacao: String(validacao.estado || 'pendente'),
    runtime: String(validacao.runtime || 'nao_executado'),
    homologacao: String(validacao.homologacao || 'pendente'),
    motivos,
    mensagem: motivos.length ? `Ainda não homologa agora: ${motivos.join('; ')}.` : 'Pronto para homologar: sem falhas e sem lacunas pendentes.',
  };
}

/** Registra a revisão explícita do criador antes da homologação. */
export function validarBot({ agenteId, autorizado = false, confirmado = false, lacunasConfirmadas = [], homologarAutomaticamente = true, automatico = false } = {}) {
  if (!autorizado) return { erro: 'a revisão do bot exige autorização do criador' };
  const bots = load(DATASET_BOTS, []);
  const bot = bots.find((item) => item.agenteId === agenteId);
  if (!bot) return { erro: `bot nao encontrado: ${agenteId}` };
  if (!bot.preparacao) return { erro: 'este bot nao possui uma preparacao para revisar' };
  if (bot.estado === 'bloqueado') return { erro: 'um bot bloqueado nao pode ser validado antes de ser desbloqueado' };
  if (bot.preparacao.pesquisaInicial?.estado !== 'concluida') {
    return { erro: 'registre a pesquisa externa e os conhecimentos iniciais antes da validação' };
  }
  if (!confirmado) return { erro: 'confirme a revisao do fluxo e dos dados da empresa' };

  const falhas = unicos([...(bot.falhas || []), ...(bot.preparacao.falhas || [])]);
  if (falhas.length) return { erro: `resolva as falhas antes de validar: ${falhas.join('; ')}` };

  const lacunas = unicos([...(bot.lacunas || []), ...(bot.preparacao.lacunas || [])]);
  const confirmadas = unicos(lacunasConfirmadas);
  if (lacunas.length !== confirmadas.length || lacunas.some((lacuna) => !confirmadas.includes(lacuna))) {
    return { erro: 'confirme cada lacuna de configuração antes de concluir a revisão', lacunas };
  }

  const passos = bot.preparacao.modeloBase?.passos || [];
  if (passos.length) {
    const fluxo = validarFluxo(passos);
    if (fluxo.erros?.length) return { erro: `o fluxo ainda tem falhas: ${fluxo.erros.join('; ')}` };
  }

  const validacao = {
    ...(bot.validacao || bot.preparacao.validacao || {}),
    estado: 'validado',
    validado: true,
    falhas: [],
    runtime: automatico ? 'verificacao-automatica' : 'revisao-manual',
    revisadoPor: automatico ? '0007' : 'criador',
    revisadoEm: HOJE(),
    lacunasConfirmadas: confirmadas,
    homologacao: 'pendente',
  };
  bot.estado = 'em_validacao';
  bot.testado = false;
  bot.lacunas = [];
  bot.preparacao = { ...bot.preparacao, falhas: [], lacunas: [], validacao };
  bot.falhas = [];
  bot.validacao = validacao;
  bot.atualizadoEm = HOJE();
  save(DATASET_BOTS, bots);
  if (homologarAutomaticamente === false) {
    /* Risco alto: a revisão fica registrada, mas a homologação aguarda uma
       pessoa. Nunca homologamos sozinhos tema financeiro, jurídico, fiscal,
       de saúde ou que afete direitos. */
    const emValidacao = obterBot(agenteId);
    return {
      ok: true,
      bot: emValidacao,
      homologado: false,
      aguardandoAprovacao: true,
      previsao: preverHomologacao(emValidacao),
    };
  }
  const homologacao = homologarBot({ agenteId, autorizado: true, aprovado: true });
  if (homologacao.erro) {
    return { erro: `a revisão foi registrada, mas a homologação automática falhou: ${homologacao.erro}`, bot: obterBot(agenteId) };
  }
  return {
    ok: true,
    bot: homologacao.bot,
    homologado: homologacao.homologado,
    previsao: preverHomologacao(homologacao.bot),
  };
}

/* ═════════ 4. HOMOLOGAÇÃO (0007) ═════════ */

/**
 * Homologa um bot: exige autorização e estado em fluxo (via máquina de estados do
 * mapa mental). Com `aprovado` e autorização, o nó do mapa transiciona para
 * 'homologado' — e o bot entra no estado homologado. Sem aprovação (falhas/lacunas
 * encontradas na preparação), nada é homologado.
 */
export function homologarBot({ agenteId, noId, autorizado = false, aprovado = false, falhas = [], lacunas = [] } = {}) {
  if (!agenteId) { return { erro: 'agenteId obrigatorio' }; }
  const botAtual = obterBot(agenteId);
  if (botAtual?.estado === 'homologado') {
    return autorizado
      ? { ok: true, homologado: true, bot: botAtual }
      : { erro: 'consultar a homologação exige autorização do criador' };
  }
  const { nos } = MAPA.obterNos(agenteId);
  const no = (noId && nos.find((n) => n.id === noId)) || (nos[nos.length - 1] || null);
  if (!no) { return { erro: `mapa mental sem nos para o bot: ${agenteId}` }; }
  const pode = R.podePromover(no.estado, autorizado);
  if (!pode) { return { erro: `transicao negada: ${no.estado} -> homologado (autorizacao: ${autorizado ? 'sim' : 'nao'})` }; }
  const falhasEfetivas = unicos([...(botAtual?.falhas || []), ...falhas]);
  const lacunasEfetivas = unicos([...(botAtual?.lacunas || []), ...lacunas]);
  const validacaoPendente = Boolean(botAtual?.preparacao) && botAtual.validacao?.validado !== true;
  const pesquisaInicialPendente = Boolean(botAtual) && botAtual.preparacao?.pesquisaInicial?.estado !== 'concluida';
  if (!aprovado || falhasEfetivas.length || lacunasEfetivas.length || validacaoPendente || pesquisaInicialPendente) {
    return {
      ok: true, homologado: false, bot: obterBot(agenteId),
      motivo: `homologacao pendente — falhas: ${falhasEfetivas.length}, lacunas: ${lacunasEfetivas.length}, validacao concluida: ${!validacaoPendente}, preparação inicial concluída: ${!pesquisaInicialPendente}`,
      previsao: preverHomologacao(botAtual),
    };
  }
  const alvos = botAtual?.preparacao
    ? nos.filter((item) => ['descoberto', 'em_validacao'].includes(item.estado))
    : [no];
  for (const alvo of alvos) {
    const promo = MAPA.transicionarNo(alvo.id, 'homologado', { autorizado });
    if (promo.erro) { return promo; }
  }
  const bots = load(DATASET_BOTS, []);
  const bot = bots.find((b) => b.agenteId === agenteId);
  if (bot) {
    bot.estado = 'homologado';
    bot.testado = bot.validacao?.runtime === 'execucao-real';
    if (bot.validacao) {
      bot.validacao = { ...bot.validacao, estado: 'homologado', homologacao: 'homologado' };
    }
    save(DATASET_BOTS, bots);
  }
  const homologado = obterBot(agenteId);
  return { ok: true, homologado: true, bot: homologado, no: MAPA.obterNos(agenteId).nos.at(-1) || no };
}

/* ═════════ 4.1 CRIAÇÃO AUTOMÁTICA (MISSÃO 007) ═════════ */

/**
 * Verificações objetivas feitas antes de homologar sem uma pessoa. Só reprova
 * o que é estrutural e verificável: pesquisa concluída, fontes suficientes,
 * limites definidos, fluxo sem falhas, conhecimento vinculado e nenhum CPF
 * vazando para fonte pública.
 */
function avaliarTestesAutomaticos(bot) {
  const pesquisa = bot?.preparacao?.pesquisaInicial || {};
  const fontes = pesquisa.fontes || [];
  const conhecimentos = pesquisa.conhecimentos || [];
  const tipos = new Set(fontes.map((fonte) => fonte.tipo));
  const temPrimaria = ['site-oficial', 'documentacao', 'cadastro-publico-empresa'].some((tipo) => tipos.has(tipo));
  const temEspecializada = ['blog-especializado', 'youtube', 'comunidade-forum', 'site-do-setor'].some((tipo) => tipos.has(tipo));
  const cpfNoBot = String(bot?.empresaCpf || '');
  const cpfVazou = Boolean(cpfNoBot) && fontes.some((fonte) => JSON.stringify(fonte).includes(cpfNoBot));
  const falhas = unicos(bot?.falhas || []);
  const segmento = segmentoDoNicho(bot?.preparacao?.nicho);
  const testes = [
    {
      id: 'pesquisa-concluida',
      nome: 'Pesquisa do nicho concluída',
      critico: true,
      ok: pesquisa.estado === 'concluida',
      evidencia: `${fontes.length} fonte(s), ${conhecimentos.length} conhecimento(s)`,
    },
    {
      id: 'fontes-suficientes',
      nome: 'Pelo menos 3 fontes públicas, com fonte primária ou especializada',
      critico: true,
      ok: fontes.length >= 3 && (temPrimaria || temEspecializada),
      evidencia: `primária=${temPrimaria ? 'sim' : 'não'}, especializada=${temEspecializada ? 'sim' : 'não'}`,
    },
    {
      id: 'limites-definidos',
      nome: 'Permissões e autonomia definidas',
      critico: true,
      ok: (bot?.permissoes || []).length > 0 && (bot?.autonomia || []).length > 0,
      evidencia: `${(bot?.permissoes || []).length} permissão(ões), ${(bot?.autonomia || []).length} limite(s)`,
    },
    {
      id: 'fluxo-estrutural',
      nome: 'Fluxo sem falhas estruturais',
      critico: true,
      ok: falhas.length === 0,
      evidencia: falhas.length ? falhas.join('; ') : 'sem falhas',
    },
    {
      id: 'conhecimento-vinculado',
      nome: 'Conhecimento inicial vinculado a fontes',
      critico: true,
      ok: conhecimentos.length >= 3,
      evidencia: `${conhecimentos.length} conhecimento(s)`,
    },
    segmento ? {
      id: 'temas-do-segmento',
      nome: `Pelo menos ${segmento.minimoTemas} dos ${segmento.temas.length} temas do segmento com fonte registrada`,
      critico: true,
      ok: temasCobertos(segmento, conhecimentos).length >= segmento.minimoTemas,
      evidencia: `${temasCobertos(segmento, conhecimentos).length} tema(s) coberto(s)`,
    } : {
      id: 'conteudo-do-nicho',
      nome: 'Conhecimento fala de fato sobre o nicho',
      critico: true,
      ok: conhecimentos.filter((c) => falaDoNicho(c.conteudo, [bot?.especialidade, bot?.preparacao?.nicho].filter(Boolean))).length >= 2,
      evidencia: `${conhecimentos.filter((c) => falaDoNicho(c.conteudo, [bot?.especialidade, bot?.preparacao?.nicho].filter(Boolean))).length} trecho(s) sobre o nicho`,
    },
    {
      id: 'documento-pessoal',
      nome: 'Nenhum documento pessoal enviado a fonte pública',
      critico: true,
      ok: !cpfVazou,
      evidencia: cpfVazou ? 'CPF apareceu em fonte pesquisada' : 'CPF mantido apenas no cadastro local',
    },
  ];
  const criticos = testes.filter((teste) => teste.critico);
  const aprovados = testes.filter((teste) => teste.ok).length;
  return {
    testes,
    aprovados,
    total: testes.length,
    aproveitamento: Math.round((aprovados / testes.length) * 100),
    criticosOk: criticos.every((teste) => teste.ok),
    pendentes: criticos.filter((teste) => !teste.ok).map((teste) => teste.nome),
  };
}

function mascararCpf(digitos) {
  const d = String(digitos || '').replace(/\D/g, '');
  return d.length === 11 ? `***.***.***-${d.slice(-2)}` : '';
}

/* Respostas de API nunca devolvem o CPF inteiro; o número completo fica só no
   armazenamento local, para o cadastro da empresa. */
function botSemDocumentoPessoal(bot) {
  if (!bot) return bot;
  const copia = { ...bot };
  if (copia.empresaCpf) copia.empresaCpf = mascararCpf(copia.empresaCpf);
  return copia;
}

/**
 * MISSÃO 007 — o fluxo de um clique. A pessoa informa só o nicho, como a
 * empresa se identifica (CNPJ, nome ou CPF) e aceita. O 0007 pesquisa, cria o
 * perfil, registra fontes, roda os testes e homologa sozinho quando o risco é
 * baixo. Risco financeiro/jurídico/fiscal/saúde/direitos fica em validação,
 * aguardando uma pessoa.
 */
export async function criarIAZestAutomatica({ nicho, empresaTipo = '', empresaIdentificador = '', empresaSite = '', aceite = false, autorizado = false, fetch: fetchFn, curl: curlFn, donoId = '0007', pesquisarAgora = true } = {}) {
  const busca = String(nicho || '').trim();
  if (busca.length < 2) return { erro: 'informe o nicho com pelo menos 2 caracteres' };
  if (aceite !== true || autorizado !== true) {
    return { erro: 'é preciso aceitar a criação automática: pesquisar, criar, testar e homologar quando o risco for baixo' };
  }
  const identificador = String(empresaIdentificador || '').trim();
  if (!identificador) return { erro: 'identifique a empresa com CNPJ, nome ou CPF' };

  const digitos = identificador.replace(/\D/g, '');
  let tipo = String(empresaTipo || '').trim().toLowerCase();
  if (!['cnpj', 'cpf', 'nome'].includes(tipo)) {
    tipo = digitos.length === 14 ? 'cnpj' : digitos.length === 11 ? 'cpf' : 'nome';
  }
  const empresa = { empresaCnpj: '', empresaNome: '', empresaCpf: '' };
  if (tipo === 'nome') {
    if (/^\d{11}$|^\d{14}$/.test(digitos)) {
      return { erro: 'o identificador parece um documento; selecione CNPJ ou CPF para que ele não seja enviado à busca' };
    }
    if (identificador.length < 2) return { erro: 'informe o nome da empresa' };
    empresa.empresaNome = identificador.slice(0, 180);
  } else {
    const doc = validarDocumento(identificador);
    if (!doc.ok) return { erro: doc.motivo };
    if (tipo === 'cnpj' && doc.tipo !== 'CNPJ') return { erro: 'o identificador informado não é um CNPJ' };
    if (tipo === 'cpf' && doc.tipo !== 'CPF') return { erro: 'o identificador informado não é um CPF' };
    if (doc.tipo === 'CNPJ') empresa.empresaCnpj = doc.digitos;
    else empresa.empresaCpf = doc.digitos;
  }

  const preparacao = prepararNicho({ nicho: busca });
  if (preparacao.erro) return preparacao;
  const risco = classificarRisco({
    especialidade: `${preparacao.especialidade} ${busca}`,
    profissao: preparacao.profissao?.nome || '',
    finalidade: preparacao.finalidade,
  });

  const criado = criarBotComercial({
    nome: preparacao.nomeSugerido,
    finalidade: preparacao.finalidade,
    especialidade: preparacao.especialidade,
    profissao: preparacao.profissao.id,
    ...empresa,
    empresaSite,
    autorizado: true,
    atividades: preparacao.atividades,
    ferramentas: (preparacao.ferramentas || []).map((item) => item.nome || String(item)),
    falhas: preparacao.falhas,
    lacunas: preparacao.lacunas,
    conhecimentos: preparacao.conhecimentos,
    preparacao,
    perfil: preparacao.perfil,
    donoId,
    identificadorUnico: true,
  });
  if (criado.erro) return criado;
  const agenteId = criado.bot.agenteId;
  /* Onze temas com pausa entre as buscas passam dos 100 s do túnel: a pesquisa começa
     agora, mas sem segurar a tela. A marca de tentativa evita o relógio rodar junto. */
  if (segmentoDoNicho(busca) && !fetchFn) {
    const andamento = { ok: true, pendencia: 'pesquisa', pesquisando: true, risco, testes: null, homologado: false, aguardandoAprovacao: false, mensagem: 'pesquisa dos 11 temas iniciada; o 0007 cobre até 5 por rodada, a cada 30 minutos' };
    registrarTentativaPrazo(agenteId, andamento, new Date());
    if (pesquisarAgora) {
      concluirPreparacaoAutomatica({ agenteId, empresa, risco })
        .then((r) => registrarTentativaPrazo(agenteId, r, new Date()))
        .catch((e) => registrarTentativaPrazo(agenteId, { erro: e.message }, new Date()));
    }
    return { ...andamento, bot: botSemDocumentoPessoal(obterBot(agenteId)) };
  }
  const resultado = await concluirPreparacaoAutomatica({ agenteId, empresa, risco, fetch: fetchFn, curl: curlFn });
  if (resultado.pendencia) { registrarTentativaPrazo(agenteId, resultado, new Date()); return { ...resultado, bot: botSemDocumentoPessoal(obterBot(agenteId)) }; }
  return {
    ...resultado,
    empresa: tipo === 'cpf'
      ? { tipo, identificador: mascararCpf(empresa.empresaCpf) }
      : { tipo, identificador: empresa.empresaCnpj || empresa.empresaNome },
  };
}

/**
 * Pesquisa (se faltar), testes automáticos, revisão e homologação. É o mesmo
 * caminho da criação automática, reaproveitado pelo relógio do prazo de 12h.
 * Risco alto fica validado, aguardando uma pessoa.
 */
export async function concluirPreparacaoAutomatica({ agenteId, empresa = {}, risco = null, fetch: fetchFn, curl: curlFn } = {}) {
  const inicial = obterBot(agenteId);
  if (!inicial) return { erro: `bot nao encontrado: ${agenteId}` };
  const riscoBot = risco || classificarRisco({
    especialidade: `${inicial.especialidade} ${inicial.preparacao?.nicho || ''}`,
    profissao: inicial.preparacao?.profissao?.nome || inicial.profissao || '',
    finalidade: inicial.finalidade,
  });
  if (inicial.preparacao?.pesquisaInicial?.estado !== 'concluida') {
    const pesquisa = await pesquisarERegistrarPreparacaoInicial({
      agenteId,
      autorizado: true,
      ...empresa,
      fetch: fetchFn,
      curl: curlFn,
    });
    if (pesquisa.erro) {
      return {
        ok: true,
        pendencia: 'pesquisa',
        pesquisando: pesquisa.emAndamento === true,
        erroPesquisa: pesquisa.erro,
        mensagem: pesquisa.mensagem,
        bot: botSemDocumentoPessoal(obterBot(agenteId)),
        risco: riscoBot,
        testes: null,
        homologado: false,
        aguardandoAprovacao: false,
      };
    }
  }

  const botPesquisado = obterBot(agenteId);
  const testes = avaliarTestesAutomaticos(botPesquisado);
  if (!testes.criticosOk) {
    return {
      ok: true,
      pendencia: 'testes',
      bot: botSemDocumentoPessoal(botPesquisado),
      risco: riscoBot,
      testes,
      homologado: false,
      aguardandoAprovacao: false,
      mensagem: `a IA-ZEST foi criada, mas ainda tem pendências: ${testes.pendentes.join('; ')}`,
    };
  }

  const validacao = botPesquisado.validacao?.validado === true && riscoBot.nivel === 'baixo'
    ? homologarBot({ agenteId, autorizado: true, aprovado: true })
    : validarBot({
      agenteId,
      autorizado: true,
      confirmado: true,
      lacunasConfirmadas: unicos([...(botPesquisado.lacunas || []), ...(botPesquisado.preparacao?.lacunas || [])]),
      homologarAutomaticamente: riscoBot.nivel === 'baixo',
      automatico: true,
    });
  if (validacao.erro || (riscoBot.nivel === 'baixo' && validacao.homologado === false)) {
    return {
      ok: true,
      pendencia: 'validacao',
      bot: botSemDocumentoPessoal(obterBot(agenteId)),
      risco: riscoBot,
      testes,
      homologado: false,
      aguardandoAprovacao: false,
      mensagem: validacao.erro || validacao.motivo || 'homologação pendente',
    };
  }

  const botFinal = obterBot(agenteId);
  return {
    ok: true,
    pendencia: null,
    bot: botSemDocumentoPessoal(botFinal),
    risco: riscoBot,
    testes,
    relatorio: relatorioPreparacao(botFinal),
    homologado: botFinal.estado === 'homologado',
    aguardandoAprovacao: botFinal.estado === 'em_validacao',
  };
}

/* ═════════ 4.2 PRAZO DE 12H ═════════ */

/** Intervalo mínimo entre duas tentativas automáticas no mesmo bot. */
export const INTERVALO_TENTATIVA_MS = 30 * 60 * 1000;

function registrarTentativaPrazo(agenteId, resultado, agora) {
  const bots = load(DATASET_BOTS, []);
  const bot = bots.find((item) => item.agenteId === agenteId);
  if (!bot) return;
  const ciclo = bot.cicloVida || bot.preparacao?.cicloVida || novoCicloVida(bot.criadoEm || agora.toISOString());
  const prep = ciclo.preparacaoConhecimentoInicial || {};
  ciclo.preparacaoConhecimentoInicial = {
    ...prep,
    tentativas: (prep.tentativas || 0) + 1,
    ultimaTentativaEm: agora.toISOString(),
    ultimoResultado: resultado.erro || (resultado.pesquisando ? 'pesquisando' : resultado.pendencia) || (resultado.homologado ? 'homologado' : 'aguardando-aprovacao-humana'),
    ultimaMensagem: String(resultado.erro || resultado.erroPesquisa || resultado.mensagem || '').slice(0, 400) || null,
    prazoIdealVencido: Boolean(prep.prazoIdealEm) && agora > new Date(prep.prazoIdealEm) && bot.estado !== 'homologado',
    prazoMaximoVencido: Boolean(prep.prazoMaximoEm) && agora > new Date(prep.prazoMaximoEm) && bot.estado !== 'homologado',
  };
  bot.cicloVida = ciclo;
  if (bot.preparacao) bot.preparacao = { ...bot.preparacao, cicloVida: ciclo };
  save(DATASET_BOTS, bots);
}

/**
 * Relógio do Hotel: todo bot ainda em preparação/validação é empurrado pelo
 * 0007 até a homologação dentro do prazo ideal de 12h — sem esperar alguém
 * clicar. Bots antigos sem ciclo de vida ganham um a partir de criadoEm.
 * Risco alto termina validado e aguardando uma pessoa (nunca homologa sozinho).
 */
export async function processarPrazosHomologacao({ agora = new Date(), fetch: fetchFn, curl: curlFn, forcar = false } = {}) {
  const resumo = { verificados: 0, homologados: 0, aguardandoAprovacao: 0, pendentes: 0, ignorados: 0, itens: [] };
  for (const bot of load(DATASET_BOTS, [])) {
    if (!ESTADOS_FLUXO_HOMOLOGACAO.includes(bot.estado)) continue;
    const prep = (bot.cicloVida || bot.preparacao?.cicloVida)?.preparacaoConhecimentoInicial || {};
    const risco = classificarRisco({
      especialidade: `${bot.especialidade} ${bot.preparacao?.nicho || ''}`,
      profissao: bot.preparacao?.profissao?.nome || bot.profissao || '',
      finalidade: bot.finalidade,
    });
    const jaAguardaPessoa = risco.nivel !== 'baixo' && bot.validacao?.validado === true
      && bot.preparacao?.pesquisaInicial?.estado === 'concluida';
    const recente = prep.ultimaTentativaEm && agora - new Date(prep.ultimaTentativaEm) < INTERVALO_TENTATIVA_MS;
    if (jaAguardaPessoa || (recente && !forcar)) { resumo.ignorados++; continue; }
    resumo.verificados++;
    let r;
    try {
      r = await concluirPreparacaoAutomatica({ agenteId: bot.agenteId, risco, fetch: fetchFn, curl: curlFn });
    } catch (e) {
      r = { erro: e.message };
    }
    registrarTentativaPrazo(bot.agenteId, r, agora);
    if (r.homologado) resumo.homologados++;
    else if (r.aguardandoAprovacao) resumo.aguardandoAprovacao++;
    else resumo.pendentes++;
    resumo.itens.push({ agenteId: bot.agenteId, nome: bot.nome, resultado: r.erro || r.pendencia || (r.homologado ? 'homologado' : 'aguardando-aprovacao-humana'), mensagem: r.erro || r.erroPesquisa || r.mensagem || null });
  }
  return resumo;
}

/* ═════════ 5. INSTÂNCIAS (CLIENTES) ═════════ */

/**
 * Cliente contrata um modelo homologado e recebe uma instância própria — nascida
 * inativa. A instância guarda a configuração dela (idioma, procedimentos, horários,
 * autonomia); as atualizações dela não contaminam o modelo original.
 */
export function criarInstancia({ modeloId, clienteId, autorizado = false } = {}) {
  const bot = obterBot(modeloId);
  if (!bot) { return { erro: `modelo nao encontrado: ${modeloId}` }; }
  if (bot.estado !== 'homologado') { return { erro: `modelo so pode gerar instancia apos homologacao: ${bot.estado}` }; }
  if (bot.preparacao?.pesquisaInicial?.estado !== 'concluida') {
    return { erro: 'modelo sem preparação inicial registrada não pode gerar novas instâncias' };
  }
  if (!autorizado) { return { erro: 'a contratacao de uma instancia exige autorizacao do criador' }; }
  const instancias = load(DATASET_INSTANCIAS, []);
  const instancia = {
    id: `inst-${Date.now().toString(36)}`,
    modeloId: bot.agenteId,
    botAgenteId: bot.agenteId,
    clienteId: String(clienteId || ''),
    status: 'inativo',
    configuracoes: {
      idioma: 'pt-BR',
      procedimentos: [],
      horario: null,
      autonomia: null,
      perfil: JSON.parse(JSON.stringify(bot.perfil || normalizarPerfil({}, bot.nome).perfil)),
    },
    criadoEm: HOJE(),
  };
  save(DATASET_INSTANCIAS, [...instancias, instancia]);
  return { ok: true, instancia, ativa: false };
}

/** Liga a instância autorizada — só entra em operação com autorização (contratação + configuração + conexão). */
export function ativarInstancia({ id, autorizado = false } = {}) {
  const instancias = load(DATASET_INSTANCIAS, []);
  const inst = instancias.find((i) => i.id === id);
  if (!inst) { return { erro: `instancia nao encontrada: ${id}` }; }
  if (inst.status !== 'inativo') { return { erro: `instancia ja esta: ${inst.status}` }; }
  if (!autorizado) { return { erro: 'a ativacao de uma instancia exige autorizacao' }; }
  const bot = obterBot(inst.modeloId);
  if (bot?.estado !== 'homologado' || bot.preparacao?.pesquisaInicial?.estado !== 'concluida') {
    return { erro: 'a instância só pode ser ativada com modelo homologado e preparação inicial concluída' };
  }
  inst.status = 'ativo';
  save(DATASET_INSTANCIAS, instancias);
  return { ok: true, instancia: inst };
}

/* ═════════ 6. HOTEL (PANEL) ═════════ */

/**
 * O painel do Hotel dos Bots: totais, catálogo em preparação/homologado/
 * disponível e as instâncias contratadas. É isto que a tela do hotel renderiza.
 */
export function painel() {
  const bots = load(DATASET_BOTS, []);
  const instancias = load(DATASET_INSTANCIAS, []);
  const comContratado = new Set(instancias.filter((i) => i.status === 'ativo').map((i) => i.modeloId));
  const lista = bots.map((b) => {
    const { itens } = MAPA.historico();
    const hist = (itens || []).filter((i) => String(i?.noId || '').startsWith(`${b.agenteId}:`));
    return { ...b, contratado: comContratado.has(b.agenteId), historico: hist };
  });
  const homologados = lista.filter((b) => b.estado === 'homologado');
  const disponiveis = homologados.filter((b) => b.preparacao?.pesquisaInicial?.estado === 'concluida');
  const emPreparacao = lista.filter((b) => ESTADOS_FLUXO_HOMOLOGACAO.includes(b.estado)).length;
  const ativas = instancias.filter((i) => i.status === 'ativo');
  return {
    totais: {
      total: lista.length,
      emPreparacao,
      homologados: homologados.length,
      disponiveis: disponiveis.filter((b) => !comContratado.has(b.agenteId)).length,
      contratados: ativas.length,
    },
    modelosFree0007: listarModelosFree0007(),
    bots: lista.map((b) => {
      const nos = MAPA.obterNos(b.agenteId).nos;
      const nosHomologados = nos.filter((n) => n.estado === 'homologado' && n.qualidade !== 'ruido');
      return {
        ...botSemDocumentoPessoal(b),
        nos,
        parametrosTreino: diagnosticoParametros(nosHomologados),
        sugestaoParametros: sugerirTreinoPorParametro({
          nome: b.nome,
          nicho: b.preparacao?.nicho || b.especialidade,
          especialidade: b.especialidade,
          empresaNome: b.empresaNome || b.preparacao?.pesquisaInicial?.empresa?.nomeFantasia || 'Veloso Solution',
        }),
      };
    }),
    instancias,
  };
}

/* ═════════ 7. MODELOS FREE DO 0007 (OLLAMA MESSENGER) E TREINO POR PARÂMETRO ═════════ */

const urlOllamaPadrao = () => (process.env.OLLAMA_URL || process.env.VS_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');

export function listarModelosFree0007() {
  const nos0007 = MAPA.obterNos('0007').nos.filter((n) => n.categoria === 'modelo-free' && n.estado === 'homologado');
  return MODELOS_FREE_0007.map((m) => {
    const no = nos0007.find((n) => String(n.conteudo || '').toLowerCase().includes(m.id.toLowerCase()));
    return {
      ...m,
      noMapaId: no?.id || null,
      registradoNoMapa: Boolean(no),
      atualizadoEm: no?.atualizadoEm || null,
    };
  });
}

export async function sincronizarModelosFree({ url = urlOllamaPadrao(), fetch: fetchFn = globalThis.fetch, autorizado = true } = {}) {
  const tagsInstaladas = new Set();
  let ollamaOnline = false;
  if (typeof fetchFn === 'function') {
    try {
      const r = await fetchFn(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        ollamaOnline = true;
        const j = await r.json();
        for (const mod of j?.models || []) {
          if (mod?.name) tagsInstaladas.add(String(mod.name).toLowerCase());
        }
      }
    } catch { /* se offline, registra o catálogo padrão como referência */ }
  }
  const existentes = MAPA.obterNos('0007').nos.filter((n) => n.categoria === 'modelo-free');
  const registrados = [];
  for (const m of MODELOS_FREE_0007) {
    const instalado = tagsInstaladas.has(m.id.toLowerCase());
    if (ollamaOnline && !instalado) continue;
    const conteudo = `${m.id} — ${m.nome} (${m.tamanho}): ${m.indicacao}`;
    const jaExiste = existentes.find((n) => String(n.conteudo || '').toLowerCase().startsWith(m.id.toLowerCase()));
    if (jaExiste) {
      if (jaExiste.estado !== 'homologado' && autorizado) {
        MAPA.transicionarNo(jaExiste.id, 'homologado', { autorizado: true, origem: 'ollama-messenger-0007' });
      }
      registrados.push({ id: m.id, noId: jaExiste.id, instalado: true, novo: false });
      continue;
    }
    const criado = MAPA.adicionarNo({
      agenteId: '0007',
      categoria: 'modelo-free',
      conteudo,
      estado: autorizado ? 'homologado' : 'descoberto',
      autorizado: Boolean(autorizado),
      qualidade: 'curada',
      origem: 'ollama-messenger-0007',
      evidencia: JSON.stringify({ modelo: m.id, papel: m.papel, padraoMessenger: m.padraoMessenger, instalado: true }),
    });
    if (criado.no) registrados.push({ id: m.id, noId: criado.no.id, instalado: true, novo: true });
  }
  return {
    ok: true,
    ollamaOnline,
    instalados: [...tagsInstaladas],
    registrados,
    modelos: listarModelosFree0007(),
  };
}

export async function baixarModeloFree({ modelo = 'qwen2.5:1.5b', url = urlOllamaPadrao(), fetch: fetchFn = globalThis.fetch, autorizado = false } = {}) {
  if (!autorizado) return { erro: 'baixar modelo no Ollama e registrar no mapa do 0007 exige autorização' };
  const id = String(modelo || '').trim();
  const catalogo = MODELOS_FREE_0007.find((m) => m.id.toLowerCase() === id.toLowerCase());
  if (!catalogo) {
    return { erro: `modelo "${id}" não está no catálogo de modelos free homologados pelo 0007 (${MODELOS_FREE_0007.map((m) => m.id).join(', ')})` };
  }
  let baixou = false;
  if (typeof fetchFn === 'function') {
    try {
      const r = await fetchFn(`${url}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: catalogo.id, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
      baixou = r.ok;
    } catch { /* se o pull HTTP falhar em ambiente de teste, ainda sincroniza no mapa */ }
  }
  const sync = await sincronizarModelosFree({ url, fetch: fetchFn, autorizado: true });
  const jaNoMapa = MAPA.obterNos('0007').nos.find((n) => n.categoria === 'modelo-free' && String(n.conteudo || '').toLowerCase().startsWith(catalogo.id.toLowerCase()));
  if (!jaNoMapa) {
    MAPA.adicionarNo({
      agenteId: '0007',
      categoria: 'modelo-free',
      conteudo: `${catalogo.id} — ${catalogo.nome} (${catalogo.tamanho}): ${catalogo.indicacao}`,
      estado: 'homologado',
      autorizado: true,
      qualidade: 'curada',
      origem: 'ollama-messenger-0007',
      evidencia: JSON.stringify({ modelo: catalogo.id, papel: catalogo.papel, padraoMessenger: catalogo.padraoMessenger, instalado: baixou }),
    });
  }
  return { ok: true, modelo: catalogo.id, baixou, modelos: listarModelosFree0007(), sincronizacao: sync };
}

export function diagnosticoTreinoBot(agenteId) {
  const bot = obterBot(agenteId);
  if (!bot) return { erro: `bot nao encontrado: ${agenteId}` };
  const nos = MAPA.obterNos(agenteId).nos.filter((n) => n.estado === 'homologado' && n.qualidade !== 'ruido');
  const parametros = diagnosticoParametros(nos);
  const sugestoes = sugerirTreinoPorParametro({
    nome: bot.nome,
    nicho: bot.preparacao?.nicho || bot.especialidade,
    especialidade: bot.especialidade,
    empresaNome: bot.empresaNome || bot.preparacao?.pesquisaInicial?.empresa?.nomeFantasia || 'Veloso Solution',
  });
  return {
    ok: true,
    agenteId: bot.agenteId,
    nome: bot.nome,
    especialidade: bot.especialidade,
    parametros,
    faltam: parametros.filter((p) => !p.ok).map(({ chave, rotulo, dica }) => ({ chave, rotulo, dica, sugestao: sugestoes[chave] || '' })),
    sugestoes,
  };
}

/**
 * Treina uma IA por parâmetros estruturados (nicho, clientes, produto, precos,
 * agenda, horario, contato, como-funciona, limites) com zero autonomia.
 */
export function treinarIAPorParametros({ agenteId, parametros = {}, usarSugestao0007 = false, LimparRuido = true, autorizado = false, por = 'dono' } = {}) {
  if (!autorizado) return { erro: 'treinar IA por parâmetros exige autorização do dono' };
  const bot = obterBot(agenteId);
  if (!bot) return { erro: `bot nao encontrado: ${agenteId}` };

  const sugestoes = sugerirTreinoPorParametro({
    nome: bot.nome,
    nicho: bot.preparacao?.nicho || bot.especialidade,
    especialidade: bot.especialidade,
    empresaNome: bot.empresaNome || bot.preparacao?.pesquisaInicial?.empresa?.nomeFantasia || 'Veloso Solution',
  });

  const entrada = usarSugestao0007 ? { ...sugestoes, ...parametros } : parametros;
  const gravados = [];
  const existentes = MAPA.obterNos(agenteId).nos;

  if (LimparRuido) {
    const padraoContaminado = /sal[aá]rio m[eé]dio|catho|gupy|querobolsa|o que faz um vendedor|itapeva|luiz carriel|dan[cç]a de sal[aã]o|ana botafogo|thank you for reading|don't forget to subscribe|shampoos da marca xyz|\bkbna\b|avalia[cç][aã]o neuropsicol[oó]gica|brastemp|oxefruit|trabajar con un distribuidor|sal[aã]o da glau|sal[aã]o miau|samsung a15|notebook dell|ordem de servi[cç]o|sua assist[eê]ncia/i;
    for (const no of existentes) {
      if (no.estado === 'homologado' && padraoContaminado.test(String(no.conteudo || ''))) {
        MAPA.transicionarNo(no.id, 'bloqueado', { autorizado: true, origem: 'treino-estruturado-0007' });
      }
    }
  }

  for (const def of PARAMETROS_TREINO) {
    const texto = String(entrada[def.chave] || '').trim().slice(0, 800);
    if (texto.length < 4) continue;
    const categoria = categoriaDoRequisito(def.chave) || def.categorias[0];
    const jaTemIgual = MAPA.obterNos(agenteId).nos.find(
      (n) => n.estado === 'homologado' && n.categoria === categoria && String(n.conteudo || '').trim() === texto,
    );
    if (jaTemIgual) {
      gravados.push({ parametro: def.chave, categoria, noId: jaTemIgual.id, atualizado: false });
      continue;
    }
    const r = MAPA.adicionarNo({
      agenteId: bot.agenteId,
      categoria,
      conteudo: texto,
      estado: 'homologado',
      autorizado: true,
      qualidade: 'dono',
      origem: `treino-parametro:${por}`,
      evidencia: JSON.stringify({ parametro: def.chave, rotulo: def.rotulo, treinadoPor: por, zeroAutonomia: true }),
    });
    if (r.no) gravados.push({ parametro: def.chave, categoria, noId: r.no.id, atualizado: true });
  }

  /* Garante sempre a trava de Zero Autonomia mesmo se o parâmetro limites não veio preenchido */
  const atuais = MAPA.obterNos(agenteId).nos.filter((n) => n.estado === 'homologado');
  if (!atuais.some((n) => ['limites', 'limites-de-atuacao', 'autonomia'].includes(n.categoria))) {
    const rLim = MAPA.adicionarNo({
      agenteId: bot.agenteId,
      categoria: 'limites',
      conteudo: sugestoes.limites,
      estado: 'homologado',
      autorizado: true,
      qualidade: 'dono',
      origem: `treino-parametro:${por}`,
      evidencia: JSON.stringify({ parametro: 'limites', zeroAutonomia: true }),
    });
    if (rLim.no) gravados.push({ parametro: 'limites', categoria: 'limites', noId: rLim.no.id, atualizado: true });
  }

  return {
    ok: true,
    agenteId: bot.agenteId,
    nome: bot.nome,
    gravados,
    diagnostico: diagnosticoTreinoBot(bot.agenteId),
  };
}

const PADRAO_CONTAMINADO_REVISAO = /sal[aá]rio m[eé]dio|catho|gupy|querobolsa|o que faz um vendedor|itapeva|luiz carriel|dan[cç]a de sal[aã]o|ana botafogo|thank you for reading|don't forget to subscribe|shampoos da marca xyz|\bkbna\b|avalia[cç][aã]o neuropsicol[oó]gica|brastemp|electrolux|oxefruit|trabajar con un distribuidor|sal[aã]o da glau|sal[aã]o miau|samsung a15|notebook dell|ordem de servi[cç]o|sua assist[eê]ncia|trinks|booksy|gendo/i;

function planoDeRevisao0007(bot) {
  const id = String(bot.agenteId || '').trim();
  const nomeNorm = normalizarBusca(bot.nome || '');
  const contexto = normalizarBusca(`${bot.nome || ''} ${bot.especialidade || ''} ${bot.finalidade || ''} ${bot.preparacao?.nicho || ''} ${bot.perfil?.funcao || ''}`);

  const ehYasmin = id === 'bot-assistencia-e-suporte-tecnico-1'
    || /\b(yasmin|yasmim)\b/.test(nomeNorm)
    || (/\bvended\w*/.test(contexto) && /\b(secretar\w*|dono|fabiano)\b/.test(contexto));
  const ehIsis = !ehYasmin && (id === 'bot-vendas-comercial-e-atendimento' || /\bisis\b/.test(nomeNorm));
  const ehMicaela = !ehYasmin && (id === 'bot-assistencia-e-suporte-tecnico' || /\bmicaela\b/.test(nomeNorm));
  const ehDany = id === 'bot-salao-barbearia-e-estetica'
    || /\bdany\b/.test(nomeNorm)
    || /\b(salao|barbearia|manicure|pedicure|sobrancelha\w*|bronzeamento)\b/.test(contexto);
  const ehCadu = !ehDany && (id === 'bot-distribuicao-e-comercio-de-alimentos-e-bebidas'
    || /\bcadu\b/.test(nomeNorm)
    || /\b(aliment\w*|bebida\w*|distribui\w*|rango|cardapio)\b/.test(contexto));

  if (ehYasmin) {
    return {
      papel: 'yasmin-executiva-veloso',
      baseId: 'veloso-solution',
      modeloId: 'software-tecnologia',
      nicho: 'Vendas Consultivas, Suporte de Sistemas e Secretariado Executivo do Dono',
      especialidade: 'Vendas Consultivas, Suporte de Sistemas e Secretária Executiva',
      profissao: {
        id: 'vendedora',
        nome: 'Vendedora, Suporte de Sistemas e Secretária Executiva',
        foco: 'apresentar soluções da Veloso Solution, apoiar suporte de sistemas e organizar recados e agenda do Fabiano',
      },
      finalidade: 'Atender clientes e parceiros da Veloso Solution em três frentes: 1) Vendas consultivas das plataformas (ZEST / Suíte VS-IA, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho e engenharia de software sob medida), explicando o que a empresa faz e o que pode somar no negócio; 2) Suporte técnico inicial dos sistemas da Veloso Solution; 3) Secretariado executivo e organização de recados e agenda do Fabiano (dono), sempre com zero autonomia.',
      perfil: {
        funcao: 'Vendedora, Suporte de Sistemas e Secretária do Fabiano (Veloso Solution)',
        objetivoPrincipal: 'Apresentar o que a Veloso Solution faz, seus produtos e o que podem somar ao negócio do cliente, prestar suporte inicial aos sistemas da empresa e organizar recados e agenda do Fabiano com zero autonomia.',
        limitesAtuacao: 'Zero autonomia: usar somente a base curada da Veloso Solution; nunca inventar preços, descontos, prazos ou diagnósticos; nunca pedir modelo de celular/notebook nem número de ordem de serviço de assistência técnica de aparelhos; encaminhar decisões finais ao Fabiano.',
        persona: 'Você é {nome}, braço direito comercial, suporte de sistemas e secretária executiva do Fabiano na Veloso Solution. Fale em português do Brasil natural, acolhedor, ágil e inteligente no WhatsApp (2 a 3 frases curtas, máximo 1 emoji). Identifique logo se a pessoa quer conhecer/contratar sistemas e IA para o negócio, se precisa de suporte técnico em uma plataforma da Veloso Solution ou se quer falar/agendar com o Fabiano.',
        mensagemInicial: '{cumprimento}! Sou a {nome}, da Veloso Solution 😊 Posso te apresentar nossas soluções de IA e gestão para somar no seu negócio, apoiar no suporte dos nossos sistemas ou anotar um recado/agenda para o Fabiano. Como posso te ajudar hoje?',
        mensagemFallback: 'Vou alinhar essa informação diretamente com o Fabiano e a equipe da Veloso Solution e já te retorno por aqui.',
        regrasAdicionais: [
          'Atuar nas 3 frentes da Veloso Solution: Comercial/Vendas, Suporte de Sistemas e Secretariado Executivo do Fabiano.',
          'Explicar com clareza o que a Veloso Solution faz (engenharia de software, IA ZEST e plataformas digitais), os produtos (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho) e o que somam no negócio.',
          'Zero autonomia comercial: preços são sob consulta conforme módulo e operação; nunca inventar valores, descontos ou prazos.',
          'Nunca atuar como assistência técnica de conserto de celulares, computadores ou eletrodomésticos e nunca pedir número de pedido ou ordem de serviço de aparelhos.',
          'Em suporte de sistemas, pedir apenas nome, empresa/sistema e descrição ou print do que aconteceu.',
          'Em recados ou agenda para o Fabiano, coletar nome, empresa/assunto e melhor dia/horário.',
        ],
      },
      responsabilidades: [
        'Recepcionar contatos da Veloso Solution com postura executiva, acolhedora e objetiva.',
        'Apresentar o que a Veloso Solution faz, seus produtos (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho e engenharia sob medida) e o que somam para o cliente.',
        'Qualificar oportunidades comerciais identificando ramo da empresa, principal dor e melhor horário para demonstração.',
        'Acolher chamados de suporte técnico das plataformas da Veloso Solution coletando nome, empresa/sistema e sintoma.',
        'Organizar recados, solicitações de reunião e assuntos direcionados ao Fabiano (dono).',
      ],
      atividades: [
        'Identificar na primeira troca se a demanda é Comercial/Vendas, Suporte de Sistemas ou Secretariado/Agenda do Fabiano.',
        'Explicar os benefícios práticos e o que cada solução da Veloso Solution soma na operação do cliente.',
        'Coletar nome, empresa, ramo e contato para demonstração comercial ou proposta sob medida.',
        'Registrar ocorrências de suporte de sistemas com nome, plataforma utilizada e print/descrição do erro.',
        'Anotar recados estruturados para o Fabiano com assunto, urgência e disponibilidade de horário.',
      ],
      fluxos: [
        'inicio: Olá! Aqui é a Yasmin, da Veloso Solution. Você busca conhecer nossos sistemas e IA para o seu negócio, suporte de uma plataforma ou falar com o Fabiano?',
        'comercial: Entender o ramo do cliente, apresentar o produto ideal (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho ou projeto sob medida), destacar o que soma e agendar demonstração.',
        'suporte_sistema: Identificar empresa e qual plataforma da Veloso Solution utiliza, coletar descrição/print do que ocorreu e acionar a equipe técnica.',
        'secretariado_fabiano: Coletar nome, empresa, assunto e melhor dia/turno para deixar registrado na agenda do Fabiano.',
        'encaminhamento: Entregar o resumo organizado para o Fabiano ou equipe responsável concluir.',
      ],
      ferramentas: [
        { nome: 'Base curada Veloso Solution', justificativa: 'Consultar portfólio oficial de produtos, diferenciais e regras da empresa.', origem: 'revisao-0007', estado: 'validado', validado: true },
        { nome: 'Qualificação comercial e agenda executiva', justificativa: 'Registrar oportunidades, demonstrações e recados para o Fabiano.', origem: 'revisao-0007', estado: 'validado', validado: true },
        { nome: 'Triagem de suporte de sistemas', justificativa: 'Registrar chamados técnicos das plataformas da Veloso Solution.', origem: 'revisao-0007', estado: 'validado', validado: true },
      ],
      regras: [
        'Atender em português do Brasil com mensagens curtas (2 a 3 frases) e tom natural de WhatsApp.',
        'Explicar sempre o que a Veloso Solution faz e o que suas soluções podem somar antes de pedir dados.',
        'Nunca pedir modelo de celular/notebook, defeito de eletrodoméstico ou número de pedido/OS de assistência técnica.',
        'Manter zero autonomia para fechar preços, descontos, prazos ou compromissos não validados pelo Fabiano.',
      ],
      permissoes: [
        'Pode apresentar o portfólio completo da Veloso Solution (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho e engenharia de software).',
        'Pode qualificar leads comerciais, registrar chamados de suporte de sistemas e anotar recados/solicitações de agenda para o Fabiano.',
        'Não pode informar preços fechados, conceder descontos, prometer prazos de entrega/desenvolvimento ou confirmar reuniões sem validação do Fabiano.',
      ],
      horarios: [
        'Acolhimento, qualificação comercial, registro de suporte e recados 24h no WhatsApp; retorno humano e aprovações em horário comercial com o Fabiano e equipe.',
      ],
      autonomia: [
        'Zero autonomia comercial, técnica ou executiva: atua como braço direito que organiza e adianta o atendimento, mas toda decisão final pertence ao Fabiano.',
      ],
    };
  }

  if (ehIsis) {
    return {
      papel: 'isis-comercial-veloso',
      baseId: 'veloso-solution',
      modeloId: 'software-tecnologia',
      nicho: 'Vendas Consultivas, Automação Comercial e Soluções Digitais',
      especialidade: 'Vendas, comercial e atendimento consultivo',
      profissao: {
        id: 'vendedora',
        nome: 'Consultora Comercial e Vendas',
        foco: 'qualificar necessidades do cliente, demonstrar o que a Veloso Solution faz e o que seus produtos somam na operação',
      },
      finalidade: 'Atender clientes e empresários interessados nas soluções da Veloso Solution (ZEST / Suíte VS-IA, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho e engenharia sob medida), entender o ramo do cliente, apresentar os produtos e o que podem somar no negócio e encaminhar para demonstração ou proposta comercial com zero autonomia.',
      perfil: {
        funcao: 'Consultora Comercial da Veloso Solution',
        objetivoPrincipal: 'Descobrir em poucas mensagens o ramo e a necessidade do cliente, recomendar a solução ideal da Veloso Solution destacando o que ela soma no negócio e conduzir para demonstração ou proposta comercial.',
        limitesAtuacao: 'Zero autonomia comercial: usar somente a base curada da Veloso Solution; informar que valores são sob consulta conforme módulo e operação; nunca inventar preços, descontos, prazos ou integrações não confirmadas.',
        persona: 'Você é {nome}, consultora comercial da Veloso Solution. Converse de forma humana, simpática e consultiva no WhatsApp (2 a 3 frases curtas, máximo 1 emoji). Faça uma pergunta por vez para descobrir o ramo do cliente, recomende um produto da base mostrando o que ele soma em vendas e organização e proponha o próximo passo.',
        mensagemInicial: '{cumprimento}! Eu sou a {nome}, consultora comercial da Veloso Solution 😊 Me conta qual é o ramo do seu negócio hoje para eu te mostrar como nossas soluções de IA e gestão podem somar nas suas vendas e atendimento?',
        mensagemFallback: 'Vou confirmar esse detalhe comercial com o Fabiano e nossa equipe da Veloso Solution e já te retorno.',
        regrasAdicionais: [
          'Descobrir o ramo do cliente e o que ele precisa resolver antes de detalhar módulos.',
          'Recomendar o produto certo da Veloso Solution (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho ou projeto sob medida) destacando o que soma no dia a dia.',
          'Preços e planos são sempre sob consulta; nunca inventar valores ou descontos.',
          'Conduzir o cliente interessado para uma demonstração prática ou proposta com o responsável.',
        ],
      },
      responsabilidades: [
        'Recepcionar leads e empresários interessados nas plataformas e serviços da Veloso Solution.',
        'Apresentar com clareza o que a Veloso Solution faz, seus produtos e o que cada solução soma no negócio do cliente.',
        'Qualificar o ramo de atuação, a dor principal e o interesse em demonstração ou orçamento.',
        'Encaminhar oportunidades qualificadas para fechamento humano com o resumo completo.',
      ],
      atividades: [
        'Levantar o ramo do cliente e o principal gargalo de atendimento, vendas ou gestão.',
        'Recomendar a plataforma adequada (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho ou sistema sob medida).',
        'Explicar como a solução soma resultados (atendimento 24h, catálogo digital, Pix Mercado Pago, agenda, estoque NF-e e financeiro).',
        'Coletar nome, empresa e melhor horário para demonstração guiada.',
      ],
      fluxos: [
        'inicio: Saudar o cliente, apresentar a Veloso Solution em uma frase e perguntar qual é o ramo do negócio.',
        'diagnostico: Identificar se a necessidade é atendimento por IA no WhatsApp (ZEST), cardápio/catálogo e pedidos (To-No-Rango), agenda de estética/salão (Cadê Você) ou sistema sob medida.',
        'proposta_valor: Explicar o que a solução recomendada soma na operação e responder dúvidas com base no conhecimento homologado.',
        'fechamento_demo: Coletar nome, empresa e melhor dia/horário para demonstração ou proposta comercial com o responsável.',
      ],
      ferramentas: [
        { nome: 'Catálogo oficial Veloso Solution', justificativa: 'Apresentar produtos, módulos e diferenciais homologados.', origem: 'revisao-0007', estado: 'validado', validado: true },
        { nome: 'Qualificação e agendamento de demonstração', justificativa: 'Registrar oportunidades comerciais para a equipe.', origem: 'revisao-0007', estado: 'validado', validado: true },
      ],
      regras: [
        'Atendimento consultivo em português do Brasil, em frases curtas (2 a 3 frases) e sem listas robóticas.',
        'Sempre relacionar o produto recomendado ao que ele soma na rotina do cliente.',
        'Zero autonomia para criar preços, descontos, prazos ou promessas fora da base.',
      ],
      permissoes: [
        'Pode apresentar todos os produtos da Veloso Solution e qualificar interessados.',
        'Pode registrar pedidos de demonstração e orçamento.',
        'Não pode fechar contrato, conceder desconto ou prometer prazo sem aprovação humana.',
      ],
      horarios: [
        'Atendimento e qualificação comercial 24h no WhatsApp; demonstrações e propostas finais em horário comercial.',
      ],
      autonomia: [
        'Zero autonomia comercial: qualifica e prepara a oportunidade, deixando preços e condições finais para o responsável.',
      ],
    };
  }

  if (ehMicaela) {
    return {
      papel: 'micaela-suporte-veloso',
      baseId: 'veloso-solution',
      modeloId: 'software-tecnologia',
      nicho: 'Suporte Técnico de Sistemas, Plataformas Digitais e Atendimento ao Cliente',
      especialidade: 'Suporte técnico de sistemas e atendimento ao cliente',
      profissao: {
        id: 'suporte',
        nome: 'Especialista de Suporte Técnico de Sistemas',
        foco: 'acolher chamados de clientes das plataformas da Veloso Solution, orientar passos homologados e acionar a equipe técnica',
      },
      finalidade: 'Prestar suporte técnico inicial e atendimento aos clientes das plataformas da Veloso Solution (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho e sistemas sob medida), coletando empresa, sistema e descrição/print do ocorrido e orientando apenas com procedimentos confirmados na base, com zero autonomia.',
      perfil: {
        funcao: 'Suporte Técnico de Sistemas da Veloso Solution',
        objetivoPrincipal: 'Identificar rapidamente qual plataforma da Veloso Solution o cliente utiliza e o que aconteceu, orientar apenas passos confirmados na base e registrar o chamado técnico para a equipe.',
        limitesAtuacao: 'Zero autonomia técnica ou comercial: orientar apenas procedimentos homologados da Veloso Solution; nunca inventar diagnóstico, prazo de correção ou preço; nunca atuar como assistência de conserto de celulares, computadores ou eletrodomésticos.',
        persona: 'Você é {nome}, especialista de suporte técnico de sistemas da Veloso Solution. Seja acolhedora, calma e objetiva no WhatsApp (2 a 3 frases curtas, máximo 1 emoji). Peça apenas o necessário (nome, empresa/sistema e descrição ou print do que aconteceu) e oriente com segurança.',
        mensagemInicial: '{cumprimento}! Sou a {nome}, do suporte técnico de sistemas da Veloso Solution 😊 Me conta de qual empresa você fala, qual plataforma está usando e o que aconteceu para eu te ajudar?',
        mensagemFallback: 'Já anotei os detalhes por aqui e vou acionar nossa equipe técnica da Veloso Solution para verificar e te retornar.',
        regrasAdicionais: [
          'Atender exclusivamente suporte de sistemas e plataformas da Veloso Solution (ZEST, To-No-Rango, Cadê Você, Dobrão, Quebra-Galho e sistemas sob medida).',
          'Nunca pedir marca/modelo de celular, notebook ou eletrodoméstico para conserto e nunca pedir número de ordem de serviço de aparelhos.',
          'Coletar nome, empresa, sistema utilizado, descrição do que ocorreu e se a operação está parada (urgência).',
          'Orientar somente passos que estejam na base homologada; o que exigir análise técnica vai para a equipe.',
        ],
      },
      responsabilidades: [
        'Acolher clientes da Veloso Solution com dúvidas operacionais ou chamados técnicos nas plataformas.',
        'Identificar a empresa, o sistema utilizado e o impacto na operação (urgente ou rotina).',
        'Orientar dúvidas frequentes homologadas na base (conexão de WhatsApp por QR Code, Mercado Pago, painel administrativo).',
        'Registrar e encaminhar chamados técnicos estruturados para a equipe de engenharia e sustentação.',
      ],
      atividades: [
        'Coletar nome, estabelecimento/empresa e plataforma utilizada (ZEST, To-No-Rango, Cadê Você ou sistema sob medida).',
        'Solicitar descrição objetiva ou print da tela quando houver mensagem de erro.',
        'Classificar se o incidente está parando a operação para priorização imediata.',
        'Encaminhar o resumo técnico para a equipe da Veloso Solution.',
      ],
      fluxos: [
        'inicio: Acolher o cliente e perguntar qual sistema da Veloso Solution utiliza e o que está acontecendo.',
        'coleta_contexto: Solicitar nome da empresa, descrição do ocorrido e print da tela se houver.',
        'classificacao_urgencia: Verificar se o problema está parando o atendimento/vendas no momento.',
        'encaminhamento_suporte: Registrar o chamado e acionar a equipe técnica da Veloso Solution.',
      ],
      ferramentas: [
        { nome: 'Base técnica Veloso Solution', justificativa: 'Consultar orientações homologadas sobre as plataformas.', origem: 'revisao-0007', estado: 'validado', validado: true },
        { nome: 'Registro de chamado técnico', justificativa: 'Encaminhar contexto completo e urgência para a equipe técnica.', origem: 'revisao-0007', estado: 'validado', validado: true },
      ],
      regras: [
        'Responder em português do Brasil com clareza, empatia e mensagens curtas (2 a 3 frases).',
        'Jamais inventar causa raiz, prazo de manutenção ou solução técnica não homologada.',
        'Nunca confundir suporte de software da Veloso Solution com assistência técnica de aparelhos físicos.',
      ],
      permissoes: [
        'Pode orientar procedimentos básicos homologados na base da Veloso Solution e registrar chamados.',
        'Não pode alterar configurações críticas, prometer prazos de correção ou executar ações financeiras.',
      ],
      horarios: [
        'Recepção e triagem de chamados 24h no WhatsApp; atuação da equipe técnica conforme prioridade e horário de suporte.',
      ],
      autonomia: [
        'Zero autonomia para diagnósticos fora da base ou alterações contratuais: registra e aciona a equipe técnica.',
      ],
    };
  }

  if (ehDany) {
    return {
      papel: 'dany-salao-cadevc',
      baseId: 'cade-voce-salao',
      modeloId: 'cadevc-barbearia',
      nicho: 'Salão de beleza, cabelo, barbearia, manicure, pedicure, sobrancelhas, unhas de gel, bronzeamento e estética',
      especialidade: 'Salão, cabelo, barbearia, manicure, pedicure, sobrancelhas, unhas e bronzeamento',
      profissao: {
        id: 'agenda',
        nome: 'Recepcionista e Agendamento de Salão, Barbearia e Estética',
        foco: 'recepcionar clientes no WhatsApp, informar serviços e consultar horários reais na agenda conectada do Cadê Você',
      },
      finalidade: 'Recepcionar clientes de salão de beleza, barbearia, manicure, pedicure, unhas, sobrancelhas e bronzeamento no WhatsApp, apresentar procedimentos e valores cadastrados no Cadê Você, consultar horários livres reais por profissional e realizar agendamentos ou remarcações com zero autonomia fora da agenda.',
      perfil: {
        funcao: 'Recepcionista e Agendamento — Salão, Barbearia e Estética',
        objetivoPrincipal: 'Acolher clientes com simpatia, informar procedimentos e valores da tabela do salão, consultar horários livres reais na agenda conectada do Cadê Você e confirmar agendamentos ou remarcações.',
        limitesAtuacao: 'Zero autonomia: consultar somente serviços, profissionais e horários reais da agenda conectada no Cadê Você; nunca confirmar horário sem vaga disponível, não alterar preços ou durações e encaminhar avaliações químicas ou encaixes para o profissional.',
        persona: 'Você é {nome}, recepcionista virtual do espaço de beleza e estética integrado ao Cadê Você. Seja simpática, acolhedora e organizada no WhatsApp (2 a 3 frases curtas, máximo 1 emoji). Descubra qual procedimento a pessoa deseja, o dia/turno de preferência e consulte a agenda real antes de confirmar.',
        mensagemInicial: '{cumprimento}! Eu sou a {nome}, recepcionista aqui do espaço ✨ Qual procedimento você gostaria de agendar ou consultar hoje?',
        mensagemFallback: 'Vou confirmar essa disponibilidade direto com a profissional responsável e já te retorno por aqui.',
        regrasAdicionais: [
          'Consultar exclusivamente os procedimentos, durações, preços e horários livres reais da agenda conectada no Cadê Você.',
          'Perguntar uma informação por vez: 1) procedimento desejado; 2) profissional e dia/turno; 3) confirmação do nome.',
          'Nunca confirmar agendamento sem verificar horário livre real na agenda.',
          'Encaminhar pedidos de encaixe, pacotes especiais ou avaliação capilar/química para a profissional responsável.',
        ],
      },
      responsabilidades: [
        'Recepcionar clientes do salão, barbearia ou studio de estética com simpatia e agilidade no WhatsApp.',
        'Apresentar procedimentos de cabelo, barbearia, manicure, pedicure, unhas de gel, sobrancelhas e bronzeamento conforme catálogo.',
        'Consultar horários livres reais na agenda conectada do Cadê Você e registrar agendamentos ou remarcações.',
        'Encaminhar dúvidas técnicas de procedimentos ou pedidos de encaixe para a equipe do salão.',
      ],
      atividades: [
        'Consultar serviços, profissionais e horários reais na agenda conectada do salão.',
        'Identificar o procedimento desejado (cabelo, barba, manicure, pedicure, unhas, sobrancelhas ou bronzeamento).',
        'Apresentar opções de data e horário disponíveis e confirmar nome e telefone do cliente.',
        'Apoiar remarcações e cancelamentos dentro das regras configuradas pelo salão.',
      ],
      fluxos: [
        'inicio: Saudar com simpatia e perguntar se o cliente deseja agendar horário, consultar valores/serviços ou remarcar.',
        'servico: Identificar qual procedimento do catálogo o cliente procura e se tem profissional de preferência.',
        'agenda: Consultar os horários realmente livres na agenda conectada e apresentar as opções.',
        'confirmacao: Confirmar procedimento, profissional, dia, hora e nome do cliente para registrar na agenda.',
      ],
      ferramentas: [
        { nome: 'Agenda conectada Cadê Você', justificativa: 'Consultar serviços, profissionais e horários livres em tempo real.', origem: 'revisao-0007', estado: 'validado', validado: true },
      ],
      regras: [
        'Atendimento leve, simpático e objetivo em português do Brasil (2 a 3 frases curtas).',
        'Usar apenas valores, tempos e vagas reais da agenda do salão conectado.',
        'Zero autonomia para criar descontos, inventar pacotes ou confirmar vaga ocupada.',
      ],
      permissoes: [
        'Pode consultar serviços, profissionais e horários livres na agenda conectada.',
        'Pode criar ou cancelar agendamento somente após confirmação explícita do cliente nos horários livres.',
        'Não pode alterar catálogo, preços, expediente ou confirmar encaixes fora da agenda.',
      ],
      horarios: [
        'Recepção digital 24h no WhatsApp; agendamentos respeitam rigorosamente os dias e turnos de cada profissional na agenda.',
      ],
      autonomia: [
        'Zero autonomia fora da agenda conectada: não inventa preços nem promete horários sem disponibilidade real.',
      ],
    };
  }

  /* Cadu (To-No-Rango / Distribuição e Comércio de Alimentos e Bebidas) ou fallback comercial */
  return {
    papel: ehCadu ? 'cadu-tonorango-alimentos' : 'consultor-veloso',
    baseId: ehCadu ? 'to-no-rango' : 'veloso-solution',
    modeloId: ehCadu ? 'distribuidora' : 'software-tecnologia',
    nicho: ehCadu
      ? 'Distribuição e Comércio de Alimentos e Bebidas, Cardápio e Catálogo Digital'
      : (bot.preparacao?.nicho || bot.especialidade || 'Tecnologia e Atendimento Comercial'),
    especialidade: ehCadu
      ? 'Distribuição e comércio de alimentos e bebidas, cardápio digital e pedidos no WhatsApp'
      : (bot.especialidade || 'Atendimento comercial consultivo'),
    profissao: {
      id: 'vendedora',
      nome: ehCadu ? 'Consultor To-No-Rango — Alimentos, Bebidas e Delivery' : 'Consultoria Comercial Veloso Solution',
      foco: ehCadu
        ? 'ajudar distribuidoras, depósitos, restaurantes, lanchonetes e negócios de alimentação a vender pelo catálogo digital e WhatsApp com a IA ZEST'
        : 'atender clientes da Veloso Solution com base curada e zero autonomia',
    },
    finalidade: ehCadu
      ? 'Atender clientes da Veloso Solution interessados no To-No-Rango e negócios de distribuição e comércio de alimentos, bebidas e delivery: apresentar o catálogo/cardápio digital sem app, atendimento pela IA ZEST no WhatsApp, Pix/cartão Mercado Pago, separação/cozinha, entrega, estoque com NF-e e gestão financeira, mostrando o que soma na operação com zero autonomia.'
      : 'Atender clientes da Veloso Solution apresentando o que a empresa faz, seus produtos e o que somam ao negócio, com zero autonomia.',
    perfil: {
      funcao: ehCadu ? 'Consultor Comercial To-No-Rango (Alimentos, Bebidas e Delivery)' : 'Consultor Comercial Veloso Solution',
      objetivoPrincipal: ehCadu
        ? 'Entender o ramo do estabelecimento (distribuidora, bebidas, restaurante, açaí, pizzaria ou delivery), mostrar como o To-No-Rango e a IA ZEST organizam catálogo, pedidos no WhatsApp, Pix automático, estoque NF-e e entregas, e conduzir para demonstração.'
        : 'Apresentar as soluções da Veloso Solution, explicar o que somam ao cliente e encaminhar para demonstração.',
      limitesAtuacao: 'Zero autonomia: usar somente a base curada da Veloso Solution / To-No-Rango; preços sob consulta conforme módulo e operação; nunca inventar preço, frete, estoque ou prazo; encaminhar demonstrações e propostas para a equipe pelo WhatsApp oficial +55 31 7553-6010.',
      persona: ehCadu
        ? 'Você é {nome}, consultor especialista do To-No-Rango (plataforma da Veloso Solution para distribuição e comércio de alimentos, bebidas e delivery). Fale em português do Brasil direto, cordial e prático (2 a 3 frases curtas, máximo 1 emoji). Pergunte o ramo do cliente, mostre o que o To-No-Rango soma no dia a dia e convide para ver o catálogo de demonstração.'
        : 'Você é {nome}, consultor da Veloso Solution. Fale em português do Brasil cordial e direto (2 a 3 frases curtas).',
      mensagemInicial: ehCadu
        ? '{cumprimento}! Eu sou o {nome}, consultor do To-No-Rango na Veloso Solution 😊 Você trabalha com distribuidora de bebidas/alimentos, restaurante ou delivery? Me conta seu ramo que te mostro como organizar catálogo digital, pedidos no WhatsApp e estoque num só lugar!'
        : '{cumprimento}! Eu sou {nome}, da Veloso Solution 😊 Como posso ajudar seu negócio hoje?',
      mensagemFallback: 'Vou confirmar esse detalhe com a equipe da Veloso Solution e já te retorno por aqui.',
      regrasAdicionais: [
        'Usar somente a base curada e as configurações confirmadas da Veloso Solution / To-No-Rango.',
        'Explicar o que o To-No-Rango faz (catálogo/cardápio digital sem app, IA ZEST no WhatsApp, Pix/cartão Mercado Pago, fila de separação/cozinha e entrega, estoque com NF-e e financeiro) e o que soma na operação.',
        'Preço do To-No-Rango é sob consulta conforme módulo e uso; nunca inventar valor, taxa ou condição comercial.',
        'Convidar o cliente para conhecer o catálogo de demonstração ou falar no WhatsApp oficial +55 31 7553-6010.',
      ],
    },
    responsabilidades: [
      'Atender donos de distribuidoras de alimentos e bebidas, restaurantes, lanchonetes, açaiterias, pizzarias e delivery.',
      'Explicar como o To-No-Rango une catálogo digital, IA ZEST no WhatsApp, Pix automático, estoque NF-e e financeiro.',
      'Demonstrar o que a plataforma soma para parar de perder pedidos no WhatsApp e organizar o giro de estoque.',
      'Conduzir interessados para demonstração prática ou proposta comercial com a equipe da Veloso Solution.',
    ],
    atividades: [
      'Identificar o ramo de alimentação ou bebidas do cliente e seu volume/forma de venda atual.',
      'Apresentar o catálogo digital no navegador (sem instalar app) e o atendimento da IA ZEST no WhatsApp.',
      'Explicar o recebimento via Pix e cartão no Mercado Pago com confirmação automática na conta da loja.',
      'Destacar a gestão de compras por XML de NF-e, baixa de estoque por ficha técnica e controle de entregas.',
      'Encaminhar para demonstração guiada no WhatsApp oficial +55 31 7553-6010.',
    ],
    fluxos: [
      'inicio: Saudar o cliente, apresentar o To-No-Rango e perguntar se atua com distribuidora, restaurante, lanchonete, açaí ou delivery.',
      'solucao: Mostrar como o catálogo digital + IA ZEST no WhatsApp + Pix Mercado Pago + estoque NF-e resolvem a operação.',
      'demonstracao: Enviar o link do cardápio de demonstração e coletar nome/estabelecimento para apresentação guiada.',
    ],
    ferramentas: [
      { nome: 'Base curada To-No-Rango', justificativa: 'Consultar módulos, fluxos operacionais e diferenciais homologados.', origem: 'revisao-0007', estado: 'validado', validado: true },
      { nome: 'Catálogo de demonstração To-No-Rango', justificativa: 'Demonstrar na prática o pedido digital e o painel administrativo.', origem: 'revisao-0007', estado: 'validado', validado: true },
    ],
    regras: [
      'Responder em português do Brasil, em frases curtas (2 a 3 frases), com no máximo 1 emoji.',
      'Destacar sempre o que o To-No-Rango soma na operação (fim da perda de pedidos, Pix confirmado na hora, estoque e financeiro integrados).',
      'Zero autonomia para inventar preços, prazos de implantação ou integrações fora da base.',
    ],
    permissoes: [
      'Pode apresentar todos os módulos do To-No-Rango, enviar link de demonstração e qualificar estabelecimentos.',
      'Não pode informar preço fechado sem tabela comercial, conceder desconto ou alterar contratos.',
    ],
    horarios: [
      'Atendimento consultivo 24h pela IA no WhatsApp; demonstrações e liberações comerciais com a equipe da Veloso Solution.',
    ],
    autonomia: [
      'Zero autonomia comercial: apresenta, tira dúvidas com base curada e encaminha o fechamento para a equipe.',
    ],
  };
}

/**
 * O Agente 0007 revê e refaz completamente um bot do Hotel:
 * - Corrige nicho, especialidade, finalidade, empresa, o que faz, produtos e o que pode somar;
 * - Refaz as frases (mensagemInicial, mensagemFallback, persona) e a forma de agir (responsabilidades,
 *   atividades, fluxos, regras, permissões, horários e zero autonomia);
 * - Substitui qualquer pesquisa básica poluída pela base curada oficial com fontes verificadas;
 * - Reconstrói o mapa mental (vs0007-mapa.json e preparacao.mapaMental) limpando nós contaminados
 *   e mantendo a foto do perfil e aprendizados validados pelo dono.
 */
export function revisarERefazerBot({ agenteId, autorizado = false, por = '0007' } = {}) {
  if (!autorizado) return { erro: 'rever e refazer bot pelo 0007 exige autorização do dono' };
  const bots = load(DATASET_BOTS, []);
  const indice = bots.findIndex((b) => b.agenteId === agenteId);
  if (indice < 0) return { erro: `bot nao encontrado: ${agenteId}` };
  const bot = bots[indice];

  const plano = planoDeRevisao0007(bot);
  const base = obterBasePorId(plano.baseId)
    || selecionarBase({
      id: plano.baseId,
      cnpj: bot.empresaCnpj || '53759232000194',
      site: bot.empresaSite || 'https://velososolution.com.br',
      nome: bot.empresaNome || 'Veloso Solution',
      nicho: plano.nicho,
      especialidade: plano.especialidade,
    });
  if (!base) return { erro: `base curada "${plano.baseId}" não encontrada para revisar ${bot.nome}` };

  const curada = baseParaPesquisa(base);
  const agora = HOJE();
  const fotoPreservada = String(bot.perfil?.foto || '');

  const perfilValidado = normalizarPerfil(
    { ...plano.perfil, foto: fotoPreservada },
    bot.nome,
    {
      funcao: plano.perfil.funcao,
      finalidade: plano.finalidade,
      objetivoPrincipal: plano.perfil.objetivoPrincipal,
      limitesAtuacao: plano.perfil.limitesAtuacao,
    },
  );
  if (perfilValidado.erro) return perfilValidado;
  const perfil = perfilValidado.perfil;

  const passosModelo = modelosBot.passosDe(plano.modeloId, { empresa: base.empresa.nomeFantasia || 'Veloso Solution' }) || [];
  const segmento = segmentoDoNicho(plano.nicho);
  const operacoesSegmento = segmento ? segmento.temas.map((tema) => `Conhecer e orientar sobre: ${tema.nome}`) : [];
  const atividades = unicos([...plano.atividades, ...operacoesSegmento]);

  const fontesPreparacao = curada.fontes.map((fonte, idx) => ({
    id: `base-curada-${idx + 1}`,
    tipo: fonte.tipo,
    titulo: fonte.titulo,
    referencia: fonte.url,
    resumo: fonte.resumo,
    validacao: 'base-curada',
  }));

  const conhecimentos = curada.conhecimentos.map((item) => ({
    categoria: item.categoria,
    conteudo: item.conteudo,
    fonteUrl: item.fonteUrl,
    origem: item.fonteUrl,
    origemTipo: 'base-curada',
    estado: 'homologado',
    validado: true,
    verificacao: 'base-curada',
  }));

  const itensEstruturaMapa = [
    ...plano.responsabilidades.map((conteudo) => ({ categoria: 'responsabilidades', conteudo })),
    ...atividades.map((conteudo) => ({ categoria: 'atividades', conteudo })),
    ...plano.fluxos.map((conteudo) => ({ categoria: 'fluxos', conteudo })),
    ...plano.regras.map((conteudo) => ({ categoria: 'regras', conteudo })),
    ...plano.permissoes.map((conteudo) => ({ categoria: 'permissoes', conteudo })),
    ...plano.horarios.map((conteudo) => ({ categoria: 'horarios', conteudo })),
    ...plano.autonomia.map((conteudo) => ({ categoria: 'autonomia', conteudo })),
  ];

  const mapaMental = [
    ...conhecimentos.map((item) => ({
      categoria: item.categoria,
      conteudo: item.conteudo,
      origem: item.origem,
      origemTipo: 'base-curada',
      estado: 'homologado',
      validado: true,
      autorizado: true,
      qualidade: 'curada',
      verificacao: 'base-curada',
    })),
    ...itensEstruturaMapa.map((item) => ({
      categoria: item.categoria,
      conteudo: item.conteudo,
      origem: 'revisao-0007',
      origemTipo: 'configuracao',
      estado: 'homologado',
      validado: true,
      autorizado: true,
      qualidade: 'configuracao',
      verificacao: 'revisao-0007',
    })),
  ];

  const cicloVida = bot.cicloVida || novoCicloVida(bot.criadoEm || agora);
  cicloVida.etapa = 'evolucao-especializacao';
  cicloVida.preparacaoConhecimentoInicial = {
    ...(cicloVida.preparacaoConhecimentoInicial || {}),
    estado: 'concluida',
    concluidaEm: agora,
    fontesRegistradas: curada.fontes.length,
    conhecimentosRegistrados: conhecimentos.length,
    ultimoResultado: 'homologado',
    ultimaMensagem: null,
  };

  const validacao = {
    estado: 'homologado',
    validado: true,
    escopo: 'base-curada-revisao-0007',
    verificacaoEstrutural: 'base-curada',
    falhas: [],
    runtime: 'verificacao-automatica',
    homologacao: 'homologado',
    revisadoPor: por,
    revisadoEm: agora,
    lacunasConfirmadas: [],
    motivo: `revisão completa pelo 0007 (${plano.papel})`,
  };

  const botRevisado = {
    ...bot,
    empresaCnpj: base.empresa.cnpj,
    empresaNome: base.empresa.nomeFantasia,
    empresaSite: base.empresa.site,
    especialidade: plano.especialidade,
    finalidade: plano.finalidade,
    profissao: plano.profissao.id,
    perfil,
    estado: 'homologado',
    responsabilidades: [...plano.responsabilidades],
    atividades,
    ferramentas: plano.ferramentas.map((f) => f.nome),
    fluxos: [...plano.fluxos],
    regras: [...plano.regras],
    permissoes: [...plano.permissoes],
    horarios: [...plano.horarios],
    autonomia: [...plano.autonomia],
    fontes: [...curada.fontes],
    conhecimentos: [...conhecimentos],
    descobertas: [...mapaMental],
    lacunas: [],
    falhas: [],
    baseConhecimento: curada.baseConhecimento,
    validacao,
    cicloVida,
    atualizadoEm: agora,
    preparacao: {
      ...(bot.preparacao || {}),
      ok: true,
      pesquisadoPor: '0007',
      nicho: plano.nicho,
      especialidade: plano.especialidade,
      especialidadeId: plano.modeloId,
      finalidade: plano.finalidade,
      profissao: plano.profissao,
      perfil,
       ...(segmento ? {
        segmento: {
          id: segmento.id,
          nome: segmento.nome,
          especialidade: segmento.especialidadeDigital,
          temas: segmento.temas.map((t) => t.nome),
          minimoTemas: segmento.minimoTemas,
        },
      } : {}),
      modeloBase: {
        id: plano.modeloId,
        nome: plano.especialidade,
        status: 'homologado_na_origem',
        passos: passosModelo,
        etapas: passosModelo.map((p) => `${p.id}: ${primeiraLinha(p.mensagem)}`),
        categorias: unicos(passosModelo.map((p) => p.categoria)),
      },
      responsabilidades: [...plano.responsabilidades],
      atividades,
      ferramentas: [...plano.ferramentas],
      fluxos: [...plano.fluxos],
      regras: [...plano.regras],
      permissoes: [...plano.permissoes],
      horarios: [...plano.horarios],
      autonomia: [...plano.autonomia],
      falhas: [],
      lacunas: [],
      fontes: fontesPreparacao,
      conhecimentos: [...conhecimentos],
      descobertas: [...mapaMental],
      mapaMental: [...mapaMental],
      validacao,
      cicloVida,
      pesquisaInicial: {
        estado: 'concluida',
        registradaEm: agora,
        origemRegistro: 'base-curada',
        buscador: 'base-curada',
        pesquisadoEm: agora,
        consultas: 0,
        empresa: curada.empresa,
        baseConhecimento: curada.baseConhecimento,
        fontes: curada.fontes,
        conhecimentos,
        limitacoes: [
          'Conhecimento revisado pelo 0007 a partir da base curada oficial da empresa, com fontes verificadas e zero autonomia.',
          ...curada.limitacoes,
        ],
      },
      notaPesquisa: 'Revisão completa executada pelo 0007: nicho, o que a empresa faz, produtos, o que pode somar, frases, forma de agir e mapa mental reconstruídos sem ruído.',
    },
  };

  /* Reconstrói os nós do agente no mapa mental preservando aprendizados limpos validados pelo dono */
  const mapa = MAPA.lerMapa();
  const antigosDoAgente = mapa.nos.filter((no) => no.agenteId === agenteId);
  const aprendizadosDono = antigosDoAgente.filter(
    (no) => no.estado === 'homologado'
      && no.categoria === 'aprendizado-validado'
      && no.qualidade === 'dono'
      && !PADRAO_CONTAMINADO_REVISAO.test(String(no.conteudo || '')),
  );
  mapa.nos = mapa.nos.filter((no) => no.agenteId !== agenteId);

  const novosNos = [];
  const chavesInseridas = new Set();
  const inserirNo = (categoria, conteudo, qualidade = 'curada', verificacao = 'base-curada', origem = 'base-curada') => {
    const texto = String(conteudo || '').trim();
    if (!texto) return;
    const chave = `${categoria}::${texto}`;
    if (chavesInseridas.has(chave)) return;
    chavesInseridas.add(chave);
    mapa.versao += 1;
    const no = {
      id: `${agenteId}:${categoria}:${Date.now()}:${novosNos.length}`,
      agenteId,
      categoria,
      conteudo: texto,
      estado: 'homologado',
      autorizado: true,
      qualidade,
      verificacao,
      origem,
      evidencia: JSON.stringify({ fonte: origem, validacao: verificacao, validado: true, revisadoPor: por }),
      versao: mapa.versao,
      criadoEm: agora,
    };
    mapa.nos.push(no);
    novosNos.push(no);
  };

  inserirNo('identidade', botRevisado.nome, 'configuracao', 'revisao-0007', 'revisao-0007');
  inserirNo('especialidade', botRevisado.especialidade, 'configuracao', 'revisao-0007', 'revisao-0007');
  for (const item of nosDoPerfil(perfil)) {
    inserirNo(item.categoria, item.conteudo, 'configuracao', 'revisao-0007', 'revisao-0007');
  }
  for (const item of conhecimentos) {
    inserirNo(item.categoria, item.conteudo, 'curada', 'base-curada', 'base-curada');
  }
  for (const item of itensEstruturaMapa) {
    inserirNo(item.categoria, item.conteudo, 'configuracao', 'revisao-0007', 'revisao-0007');
  }
  for (const apr of aprendizadosDono) {
    inserirNo(apr.categoria, apr.conteudo, 'dono', 'auditoria-dono', apr.origem || 'auditoria');
  }

  mapa.historico.push({
    versao: mapa.versao,
    noId: `${agenteId}:revisao-0007`,
    origem: `revisao-0007:${por}`,
    evidencia: JSON.stringify({ papel: plano.papel, baseId: base.id, removidos: antigosDoAgente.length, adicionados: novosNos.length }),
    data: agora,
    alteracao: `0007 revisou e refez mapa mental, pesquisa básica, frases e forma de agir de ${botRevisado.nome} (${agenteId})`,
  });

  bots[indice] = botRevisado;
  save(DATASET_BOTS, bots);
  MAPA.salvarMapa(mapa);

  const testes = avaliarTestesAutomaticos(botRevisado);
  const diagnostico = diagnosticoTreinoBot(agenteId);

  return {
    ok: true,
    agenteId,
    nome: botRevisado.nome,
    papel: plano.papel,
    base: { id: base.id, nome: base.nome, versao: base.versao },
    nicho: plano.nicho,
    especialidade: botRevisado.especialidade,
    funcao: perfil.funcao,
    mapa: {
      removidos: antigosDoAgente.length,
      adicionados: novosNos.length,
      aprendizadosDonoPreservados: aprendizadosDono.length,
    },
    testes,
    diagnostico,
    bot: botSemDocumentoPessoal(botRevisado),
  };
}

/**
 * Pede ao Agente 0007 para rever e refazer TODOS os bots do Hotel:
 * reconstrói pesquisa básica, nicho, o que a empresa faz, produtos, o que pode somar,
 * mapa mental, frases e forma de agir de cada bot.
 */
export function revisarERefazerTodosOsBots({ autorizado = false, por = '0007' } = {}) {
  if (!autorizado) return { erro: 'rever e refazer todos os bots pelo 0007 exige autorização do dono' };
  const todos = listarBots();
  const resultados = [];
  for (const b of todos) {
    const r = revisarERefazerBot({ agenteId: b.agenteId, autorizado: true, por });
    resultados.push(r);
  }
  return {
    ok: resultados.every((r) => r.ok),
    revisadoPor: '0007',
    total: resultados.length,
    resultados,
    painel: painel(),
  };
}

/**
 * Exclui uma IA-ZEST do Hotel. Ação destrutiva: exige autorização explícita.
 * Instâncias ativas impedem a exclusão (é preciso desativar antes) para não
 * derrubar um atendimento em andamento. Instâncias inativas são removidas
 * junto, e o mapa mental da agente é limpo para não deixar nó órfão.
 */
export function excluirBot({ agenteId, autorizado = false } = {}) {
  if (!autorizado) return { erro: 'excluir uma IA-ZEST exige autorização do criador' };
  const id = String(agenteId || '').trim();
  if (!id) return { erro: 'agenteId obrigatorio' };
  const bots = load(DATASET_BOTS, []);
  const bot = bots.find((item) => item.agenteId === id);
  if (!bot) return { erro: `bot nao encontrado: ${id}` };
  const instancias = load(DATASET_INSTANCIAS, []);
  const vinculadas = instancias.filter((item) => item.modeloId === id || item.botAgenteId === id);
  const ativas = vinculadas.filter((item) => item.status === 'ativo');
  if (ativas.length) {
    return { erro: `esta IA-ZEST tem ${ativas.length} instância(s) ativa(s); desative antes de excluir` };
  }
  save(DATASET_BOTS, bots.filter((item) => item.agenteId !== id));
  const mantidas = instancias.filter((item) => !vinculadas.includes(item));
  save(DATASET_INSTANCIAS, mantidas);
  const mapa = MAPA.removerAgente(id);
  return {
    ok: true,
    excluido: { agenteId: id, nome: bot.nome, estado: bot.estado },
    instanciasRemovidas: vinculadas.length,
    nosRemovidos: mapa?.nosRemovidos || 0,
  };
}
