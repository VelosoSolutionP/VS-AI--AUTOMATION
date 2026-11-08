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
import { segmentoDoNicho, temasCobertos } from './segmentos.mjs';
import { documento as validarDocumento } from '../vsclientes/ofertas.mjs';
import * as R from './regras.mjs';
import * as MAPA from './mapa.mjs';

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
      origem: item.origem === 'pesquisa-automatica-0007' ? item.origem : 'informada-pelo-responsavel',
      verificacao: ['pagina-consultada', 'trecho-do-buscador'].includes(item.verificacao) ? item.verificacao : 'declarada',
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
    conhecimentos.push({
      categoria,
      conteudo,
      origem: fonte.url,
      estado: 'descoberto',
      validado: false,
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

  const modelos = modelosBot.listar()
    .map((modelo) => ({
      ...modelo,
      pontuacao: pontuarNicho(busca, [modelo.nome, modelo.descricao, ...(modelo.categorias || [])]),
    }))
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
    const evidencia = JSON.stringify({
      fonte: c.origem || 'fabrica-0007',
      validacao: 'pendente',
      validado: false,
      aprovadaPeloCriador: Boolean(preparacao),
    });
    const noC = MAPA.adicionarNo({
      agenteId: idFinal,
      categoria: String(c.categoria || 'conhecimento'),
      conteudo,
      estado: 'descoberto',
      origem: 'preparacao-0007',
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
  const pesquisaInicial = {
    estado: 'concluida',
    registradaEm: concluidaEm,
    origemRegistro,
    ...detalhesPesquisa,
    fontes: pesquisa.fontes,
    conhecimentos: pesquisa.conhecimentos,
    limitacoes: [
      ...(origemRegistro === 'pesquisa-automatica-0007'
        ? ['As páginas públicas registradas foram abertas e lidas pelo agente 0007; o conteúdo não foi validado por uma pessoa.']
        : ['As fontes foram declaradas pelo responsável e não verificadas automaticamente pelo sistema.']),
      'Os conhecimentos permanecem descobertos e precisam de validação antes de serem homologados.',
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
    })), ...pesquisa.conhecimentos.map((item) => ({
      categoria: item.categoria,
      conteudo: item.conteudo,
      origem: item.origem,
      estado: 'descoberto',
      validado: false,
    }))],
    notaPesquisa: origemRegistro === 'pesquisa-automatica-0007'
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
  bot.fontes = [...(bot.fontes || []), ...pesquisaInicial.fontes];
  bot.conhecimentos = [...(bot.conhecimentos || []), ...pesquisa.conhecimentos];
  bot.descobertas = [...(bot.descobertas || []), ...nosPerfilPendentes.map((item) => ({
    ...item, origem: 'perfil-minimo-0007', estado: 'descoberto', validado: false,
  })), ...pesquisa.conhecimentos];
  bot.atualizadoEm = concluidaEm;
  save(DATASET_BOTS, bots);

  for (const item of [...nosPerfilPendentes, ...pesquisa.conhecimentos]) {
    const evidencia = JSON.stringify({
      fonte: item.origem || 'perfil-minimo-0007',
      validacao: item.origem === 'perfil-minimo-0007'
        ? 'configuracao-minima'
        : item.estado === 'descoberto' ? 'pagina-consultada-pelo-0007' : 'declarada-pelo-responsavel',
      validado: false,
    });
    const no = MAPA.adicionarNo({
      agenteId,
      categoria: item.categoria,
      conteudo: item.conteudo,
      estado: 'descoberto',
      origem: 'pesquisa-externa-inicial',
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
    empresaNome: cnpjPesquisa ? '' : nomePesquisa,
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
      origem: 'pesquisa-automatica-0007',
      verificacao: fonte.verificacao === 'trecho-do-buscador' ? 'trecho-do-buscador' : 'pagina-consultada',
    })),
    conhecimentos: pesquisa.conhecimentos,
    origemRegistro: 'pesquisa-automatica-0007',
    limitacoesPesquisa: pesquisa.limitacoes,
    detalhesPesquisa: {
      empresa: pesquisa.empresa,
      buscador: pesquisa.buscador,
      pesquisadoEm: pesquisa.pesquisadoEm,
      consultasRealizadas: pesquisa.consultas,
      falhasPesquisa: pesquisa.falhas,
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
    bots: lista.map((b) => ({ ...botSemDocumentoPessoal(b), nos: MAPA.obterNos(b.agenteId).nos })),
    instancias,
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
