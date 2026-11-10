/**
 * Parecer do 0007 sobre o que as IAs não souberam responder, diagnóstico por
 * parâmetros de treino (nicho, clientes, produtos, preços, agenda, horário,
 * contato, como funciona e limites sem autonomia) e catálogo de modelos free
 * do Ollama Messenger.
 *
 * O 0007 só opina e prepara: a palavra final é sempre do dono, e o 0007 aplica
 * as liberações somente após a revisão humana.
 */
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const termos = (t) => normalizar(t).split(/[^a-z0-9]+/).filter((x) => x.length > 2);

const XINGAMENTO = /\b(porra|caralho|merda|puta|idiota|otario|burr[ao])\b/;
const LINK_SOLTO = /^(https?:\/\/\S+|www\.\S+)$|\b(instagram\.com\/(reel|p|stories)|tiktok\.com\/@|youtube\.com\/shorts)\b/i;
const CONVERSA_SOLTA = /^(oi+|ola+|opa+|bom dia|boa tarde|boa noite|tudo bem|da ideia|fala ai|continuo na rua|to na rua|estou na rua|ta bom|ok+|blz|beleza|sim|nao|obrigad[oa]|valeu|show|top)\b[\s!.,?]*$/i;
const DADO_DA_EMPRESA = /\b(preco|valor|custa|mensalidade|horario|abre|fecha|agenda\w*|marcar|agendar|vaga|disponibilidade|produto\w*|servico\w*|catalogo|cardapio|entrega|frete|pagamento|pix|cartao|endereco|prazo|garantia|troca|devolucao|parcel\w*|desconto|plano\w*)\b/;
const COBERTURA_MINIMA = 0.6;

/** Modelos gratuitos e leves do Ollama recomendados pelo 0007 para atendimento humanizado. */
export const MODELOS_FREE_0007 = Object.freeze([
  {
    id: 'qwen2.5:1.5b',
    nome: 'Qwen 2.5 1.5B — Ollama Messenger Humanizado',
    tamanho: '986 MB',
    papel: 'atendimento-rapido',
    indicacao: 'Conversa humanizada estilo Messenger no WhatsApp: respostas naturais em português, baixa latência em CPU e acolhimento ágil.',
    padraoMessenger: true,
  },
  {
    id: 'qwen2.5:3b',
    nome: 'Qwen 2.5 3B — Vendas, Suporte e Auditoria 0007',
    tamanho: '1.9 GB',
    papel: 'raciocinio-comercial',
    indicacao: 'Atendimento consultivo de vendas, explicação de catálogo/cardápio, suporte técnico e apoio ao 0007.',
    padraoMessenger: false,
  },
  {
    id: 'llama3.2:1b',
    nome: 'Llama 3.2 1B — Triagem, Clientes e Agenda',
    tamanho: '1.3 GB',
    papel: 'triagem-agenda',
    indicacao: 'Qualificação rápida do que o cliente precisa, coleta de dados para agenda e encaminhamento sem enrolação.',
    padraoMessenger: false,
  },
  {
    id: 'qwen2.5:0.5b',
    nome: 'Qwen 2.5 0.5B — Contingência Ultra-rápida',
    tamanho: '397 MB',
    papel: 'contingencia-cpu',
    indicacao: 'Resposta instantânea quando o servidor estiver sob pico de mensagens simultâneas.',
    padraoMessenger: false,
  },
]);

/** O que precisa existir para a IA atender de verdade. `categorias` é o que pode ser ensinado. */
export const REQUISITOS_TREINO = [
  { chave: 'produto', rotulo: 'Produtos ou serviços', categorias: ['produto', 'o-que-a-empresa-faz'] },
  { chave: 'precos', rotulo: 'Preços', categorias: ['precos', 'preco'] },
  { chave: 'horario', rotulo: 'Horário de atendimento', categorias: ['horario', 'horario-de-atendimento'] },
  { chave: 'contato', rotulo: 'Contato', categorias: ['contato'] },
  { chave: 'como-funciona', rotulo: 'Como comprar ou contratar', categorias: ['como-funciona'] },
];

/**
 * Parâmetros completos do treino estruturado pelo 0007:
 * Nicho, Clientes (o que ele precisa), Produtos, Preços, Agenda, Horário,
 * Contato, Como funciona e Limites (peça que o dono precisava, sem autonomia).
 */
export const PARAMETROS_TREINO = [
  {
    chave: 'nicho',
    rotulo: 'Nicho e papel da IA',
    categorias: ['nicho', 'conhecimento-básico'],
    dica: 'Como a IA deve se posicionar no nicho, tom de conversa e papel de braço direito do negócio.',
  },
  {
    chave: 'clientes',
    rotulo: 'Clientes e o que precisam',
    categorias: ['clientes', 'publico-alvo', 'clientes-condicoes'],
    dica: 'Quem é o cliente ideal, principais dores/dúvidas e o que perguntar para entender o que ele precisa.',
  },
  {
    chave: 'produto',
    rotulo: 'Produtos, serviços e o que pode somar',
    categorias: ['produto', 'o-que-a-empresa-faz', 'o-que-pode-somar', 'diferenciais', 'catalogo-produtos'],
    dica: 'O que a empresa faz, catálogo de produtos/serviços e o que eles podem somar no dia a dia do cliente.',
  },
  {
    chave: 'precos',
    rotulo: 'Preços e condições',
    categorias: ['precos', 'preco', 'precos-promocoes'],
    dica: 'Tabela de preços, planos ou política de "sob consulta" e formas de pagamento (Pix, cartão).',
  },
  {
    chave: 'agenda',
    rotulo: 'Agenda e marcação',
    categorias: ['agenda'],
    dica: 'Como funcionam agendamentos, horários de profissionais, demonstrações ou recados para o dono.',
  },
  {
    chave: 'horario',
    rotulo: 'Horário de atendimento',
    categorias: ['horario', 'horario-de-atendimento'],
    dica: 'Dias e horários de funcionamento humano e o que a IA adianta fora de expediente.',
  },
  {
    chave: 'contato',
    rotulo: 'Contato e encaminhamento',
    categorias: ['contato'],
    dica: 'WhatsApp oficial, site, cidade/endereço e para quem encaminhar fechamento ou suporte.',
  },
  {
    chave: 'como-funciona',
    rotulo: 'Como comprar, contratar ou agendar',
    categorias: ['como-funciona', 'pedidos-vendas-entregas'],
    dica: 'Passo a passo simples do pedido, contratação, entrega, suporte ou marcação.',
  },
  {
    chave: 'limites',
    rotulo: 'Limites (Zero Autonomia)',
    categorias: ['limites', 'limites-de-atuacao', 'autonomia'],
    dica: 'O que a IA nunca faz sozinha: não inventa preço, não dá desconto, não fecha exceção e passa a decisão final ao dono.',
  },
];

const textoDaLinha = (linha) => String(linha).replace(/^[^:]+:\s*/, '').replace(/^Quando perguntarem ".*?":\s*/, '');

export function classificarParametroDaPergunta(pergunta = '') {
  const t = normalizar(pergunta);
  if (/\b(agenda\w*|marcar|agendar|horario livre|vaga|disponibilidade|consulta|reuniao|visita|demonstracao|profissional|corte|escova|manicure|procedimento)\b/.test(t)) {
    return { parametro: 'agenda', parametroRotulo: 'Agenda e marcação' };
  }
  if (/\b(preco|valor|custa|mensalidade|plano|desconto|orcamento|promocao|barato|caro|parcel\w*|pix|cartao|boleto|pagamento)\b/.test(t)) {
    return { parametro: 'precos', parametroRotulo: 'Preços e condições' };
  }
  if (/\b(produto\w*|servico\w*|catalogo|cardapio|tem |vende|trabalha com|sistema|modulo|marca|estoque|item|opcoes)\b/.test(t)) {
    return { parametro: 'produto', parametroRotulo: 'Produtos ou serviços' };
  }
  if (/\b(abre|fecha|expediente|funcionamento|atende que horas|sabado|domingo|feriado)\b/.test(t)) {
    return { parametro: 'horario', parametroRotulo: 'Horário de atendimento' };
  }
  if (/\b(endereco|onde fica|localizacao|telefone|whatsapp|site|email|falar com|humano|atendente|dono|responsavel)\b/.test(t)) {
    return { parametro: 'contato', parametroRotulo: 'Contato e encaminhamento' };
  }
  if (/\b(como funciona|como compro|como contratar|entrega|frete|prazo|troca|devolucao|garantia|instala\w*|passo a passo)\b/.test(t)) {
    return { parametro: 'como-funciona', parametroRotulo: 'Como comprar ou contratar' };
  }
  if (/\b(preciso|busco|meu negocio|minha loja|meu salao|condominio|empresa|atendem)\b/.test(t)) {
    return { parametro: 'clientes', parametroRotulo: 'Clientes e o que precisam' };
  }
  return { parametro: 'nicho', parametroRotulo: 'Nicho e operação' };
}

function melhorTrecho(pergunta, conhecimento) {
  const q = termos(pergunta);
  if (!q.length) return null;
  let melhor = null;
  for (const linha of conhecimento) {
    const alvo = new Set(termos(linha));
    const cobertura = q.filter((x) => alvo.has(x)).length / q.length;
    if (cobertura >= COBERTURA_MINIMA && (!melhor || cobertura > melhor.cobertura)) melhor = { linha, cobertura };
  }
  return melhor;
}

/** `conhecimento`: linhas "categoria: texto" do que a IA já tem aprovado sobre a empresa. */
export function parecerDoPendente({ pergunta, vezes = 1, conhecimento = [] } = {}) {
  const bruto = String(pergunta || '').trim();
  const texto = normalizar(bruto);
  const { parametro, parametroRotulo } = classificarParametroDaPergunta(bruto);
  if (XINGAMENTO.test(texto)) {
    return { voto: 'recusar', motivo: 'Xingamento, não é situação de atendimento.', sugestao: '', parametro: 'ruido', parametroRotulo: 'Ruído / bloquear' };
  }
  const semLinks = bruto.replace(/https?:\/\/\S+|www\.\S+/gi, '').trim();
  if (LINK_SOLTO.test(bruto) && !semLinks) {
    return { voto: 'recusar', motivo: 'Link ou mídia solta sem dúvida de atendimento.', sugestao: '', parametro: 'ruido', parametroRotulo: 'Ruído / link solto' };
  }
  if (CONVERSA_SOLTA.test(texto) && vezes < 3) {
    return { voto: 'recusar', motivo: 'Cumprimento ou frase solta de conversa, não é regra de negócio.', sugestao: '', parametro: 'ruido', parametroRotulo: 'Ruído / conversa' };
  }
  const trecho = melhorTrecho(bruto, conhecimento);
  if (trecho) {
    return {
      voto: 'aprovar',
      motivo: `A base já cobre isso (${parametroRotulo}), mas ela não encontrou. Sugiro responder com este trecho.`,
      sugestao: textoDaLinha(trecho.linha).slice(0, 600),
      parametro,
      parametroRotulo,
    };
  }
  if (DADO_DA_EMPRESA.test(texto)) {
    return {
      voto: 'aprovar',
      motivo: `É dado da empresa (${parametroRotulo}) que está faltando. Escreva a resposta certa.`,
      sugestao: '',
      parametro,
      parametroRotulo,
    };
  }
  if (vezes >= 3) {
    return {
      voto: 'aprovar',
      motivo: `Clientes perguntaram isso ${vezes} vezes (${parametroRotulo}).`,
      sugestao: '',
      parametro,
      parametroRotulo,
    };
  }
  if (termos(bruto).length < 2 && vezes < 2) {
    return { voto: 'recusar', motivo: 'Mensagem curta demais para virar regra.', sugestao: '', parametro: 'ruido', parametroRotulo: 'Ruído / curta' };
  }
  return {
    voto: 'revisar',
    motivo: `Dúvida sobre ${parametroRotulo.toLowerCase()}. Revise se vale entrar no mapa; palavra final sua.`,
    sugestao: '',
    parametro,
    parametroRotulo,
  };
}

/** Requisitos sem nenhum conteúdo aprovado, a partir das categorias dos nós homologados. */
export function faltasDeTreino(categorias = []) {
  const tem = new Set(categorias);
  return REQUISITOS_TREINO.filter((r) => !r.categorias.some((c) => tem.has(c))).map(({ chave, rotulo }) => ({ chave, rotulo }));
}

export function diagnosticoParametros(nosHomologados = []) {
  const porCategoria = new Map();
  for (const no of nosHomologados) {
    const cat = String(no?.categoria || '');
    if (!cat) continue;
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat).push(String(no.conteudo || '').trim());
  }
  return PARAMETROS_TREINO.map((p) => {
    const itens = p.categorias.flatMap((c) => porCategoria.get(c) || []).filter(Boolean);
    return {
      chave: p.chave,
      rotulo: p.rotulo,
      dica: p.dica,
      ok: itens.length > 0,
      quantidade: itens.length,
      resumo: itens[0] ? itens[0].slice(0, 220) : '',
      itens: itens.slice(0, 5),
    };
  });
}

export function categoriaDoRequisito(chave) {
  const req = REQUISITOS_TREINO.find((r) => r.chave === chave) || PARAMETROS_TREINO.find((p) => p.chave === chave);
  return req?.categorias[0] || null;
}

/**
 * Gera sugestão de treino por parâmetro para o 0007 preencher ou revisar junto ao dono,
 * sempre respeitando o nicho, o que o cliente precisa, produtos, agenda e Zero Autonomia.
 */
export function sugerirTreinoPorParametro({
  nome = 'IA',
  nicho = '',
  especialidade = '',
  empresaNome = 'nossa empresa',
  produtos = [],
  horario = '',
  contato = '',
} = {}) {
  const ramo = String(especialidade || nicho || 'atendimento ao cliente').trim();
  const norm = normalizar(ramo);
  const listaProdutos = produtos.filter(Boolean).slice(0, 6).join('; ');
  const ehSalao = /salao|barbearia|estetica|manicure|cabeleireir|cilios|sobrancelha|depilac|bronzeamento/.test(norm);
  const ehAlimentos = /aliment|bebida|distribui|cardapio|rango|restaurante|lanchonete|acai|pizzaria|hamburgueria|delivery/.test(norm);
  const ehMultifuncao = /secretari|dono|fabiano|yasmin/.test(`${norm} ${normalizar(nome)}`);
  const ehSuporte = !ehMultifuncao && /suporte|assistencia|tecnic|manutencao|ti\b|help ?desk/.test(norm);

  return {
    nicho: ehSalao
      ? `Atuação em ${ramo}: recepcionar clientes de beleza e estética com simpatia, apresentar serviços e durações, consultar vagas reais na agenda e preparar o agendamento sem inventar procedimentos.`
      : ehAlimentos
        ? `Atuação em ${ramo}: atender pedidos e dúvidas de cardápio/catálogo digital com agilidade, informar itens, adicionais, entrega e pagamento Pix/cartão conforme cadastrado.`
        : ehMultifuncao
          ? `Atuação em ${ramo} da ${empresaNome}: atuar como vendedora consultiva, suporte técnico de plataformas e secretária executiva do Fabiano (dono), qualificando oportunidades, registrando chamados de sistemas e organizando recados/agenda com zero autonomia.`
          : ehSuporte
            ? `Atuação em ${ramo}: acolher o cliente com dúvida de uso ou chamado técnico nos sistemas da ${empresaNome}, coletar nome, empresa/plataforma e sintoma, orientar passos confirmados na base e acionar a equipe técnica.`
            : `Atuação em ${ramo}: ser o braço direito comercial de ${empresaNome}, acolhendo o cliente de forma humanizada, entendendo a necessidade, apresentando os produtos e destacando o que podem somar no negócio com zero autonomia para inventar condições.`,
    clientes: ehSalao
      ? 'Clientes que buscam agendar corte, barba, coloração, manicure, pedicure, sobrancelhas, unhas de gel ou bronzeamento e consultar valores e horários livres. Identificar qual procedimento deseja, preferência de profissional e melhor dia/turno.'
      : ehAlimentos
        ? 'Donos de distribuidoras de alimentos e bebidas, restaurantes, lanchonetes, açaiterias e clientes que buscam catálogo digital sem app, pedido rápido no WhatsApp com Pix automático e controle de estoque/entrega.'
        : ehMultifuncao
          ? 'Empresários e clientes que entram em contato com a Veloso Solution para: 1) conhecer ou contratar sistemas e IA no WhatsApp; 2) pedir suporte técnico de uma plataforma ativa; 3) falar, deixar recado ou agendar horário com o Fabiano.'
          : ehSuporte
            ? 'Clientes e estabelecimentos parceiros que precisam resolver dúvidas de uso, configuração, conexão de WhatsApp ou instabilidade nas plataformas da empresa. Identificar quem fala, qual sistema utiliza e o que aconteceu.'
            : 'Empresários e comércios que procuram organizar o atendimento no WhatsApp, vender com catálogo/cardápio digital, controlar agenda, estoque e financeiro. Descobrir em 1 ou 2 perguntas o ramo do cliente e o que ele precisa resolver.',
    produto: listaProdutos
      || (ehSalao
        ? 'Serviços de salão, barbearia e estética conforme catálogo oficial conectado à agenda no Cadê Você (cabelo, barbearia, manicure, pedicure, unhas de gel, sobrancelhas e bronzeamento). Soma atendimento imediato no WhatsApp sem interromper o profissional.'
        : ehAlimentos
          ? 'To-No-Rango (da Veloso Solution): catálogo e cardápio digital no navegador sem app, atendimento com IA ZEST no WhatsApp, Pix/cartão via Mercado Pago com baixa automática, fila de separação/cozinha e entrega, estoque por XML de NF-e e financeiro.'
          : 'Veloso Solution (engenharia de software e IA): 1) ZEST / Suíte VS-IA (assistentes humanizadas no WhatsApp com auditoria 0007 e zero autonomia); 2) To-No-Rango (cardápio/catálogo digital, pedidos, Pix Mercado Pago, estoque NF-e e financeiro); 3) Cadê Você (gestão e agenda inteligente para salão e estética); 4) Dobrão e Quebra-Galho; 5) Sistemas e integrações sob medida. Soma atendimento 24h, organização operacional e fim de vendas perdidas por demora.'),
    precos: 'Valores seguem estritamente a tabela comercial ou catálogo cadastrado. Para planos das plataformas e projetos (ZEST, To-No-Rango, Cadê Você ou sob medida), informar que o investimento é sob consulta conforme módulos e operação, sem inventar preços ou descontos.',
    agenda: ehSalao
      ? 'Consultar apenas horários realmente livres na agenda conectada do salão, confirmar serviço, profissional, data e hora com o cliente antes de registrar.'
      : 'Para demonstrações comerciais, reuniões ou falar com o Fabiano (responsável), anotar nome, empresa/ramo, assunto e melhor dia/horário para confirmação na agenda.',
    horario: horario || 'Atendimento inicial, qualificação comercial, registro de suporte e recados 24h pela assistente virtual no WhatsApp; retorno humano, suporte de segundo nível e aprovação comercial com o Fabiano e equipe em horário comercial.',
    contato: contato || `WhatsApp oficial +55 31 7553-6010 (wa.me/553175536010), sites velososolution.com.br e to-no-rango.velososolution.com.br. Empresa registrada em São Paulo/SP com atuação em Belo Horizonte/MG e encaminhamento direto para o Fabiano (${empresaNome}).`,
    'como-funciona': ehSalao
      ? '1) O cliente diz o procedimento que procura; 2) a IA consulta a agenda real do salão e mostra os horários livres; 3) o cliente escolhe e confirma nome para concluir o agendamento.'
      : ehMultifuncao
        ? '1) Identificamos se o contato é Comercial/Vendas, Suporte de Sistemas ou Recado/Agenda para o Fabiano; 2) em Vendas, entendemos o ramo e mostramos o que a Veloso Solution soma; em Suporte, coletamos empresa/sistema e sintoma; em Secretariado, anotamos nome, assunto e horário; 3) encaminhamos tudo organizado para decisão final.'
        : ehSuporte
          ? '1) O cliente relata a dúvida ou ocorrência no sistema; 2) a IA verifica se há orientação homologada na base; 3) coleta nome, empresa/sistema e print/detalhe e encaminha o chamado organizado para a equipe técnica.'
          : '1) Entendemos o ramo do cliente e o que ele precisa melhorar; 2) apresentamos a solução ideal da Veloso Solution e como ela soma na operação; 3) coletamos os dados básicos e passamos para o responsável demonstrar ou enviar proposta.',
    limites: `Zero autonomia: ${nome} é o braço direito do atendimento, mas nunca inventa preço, não concede desconto, não altera horário sem agenda, não promete prazo fora da base, nunca atua como assistência de conserto de celulares/eletrodomésticos e submete qualquer decisão final ao dono.`,
  };
}
