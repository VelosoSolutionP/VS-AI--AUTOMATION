/**
 * VSvendas — follow-up. Rascunho de mensagem no tom da empresa e no momento do funil.
 * Determinístico (template com variáveis); o MCP pode personalizar a redação depois.
 */

const STAGE_CAT = [
  { re: /(novo|lead|prospec|abordagem|primeiro)/i, cat: 'novo' },
  { re: /(qualif|descoberta|diagn|demo|reuni|apresenta|call)/i, cat: 'qualificado' },
  { re: /(proposta|orçamento|orcamento|cota)/i, cat: 'proposta' },
  { re: /(negocia|fechamento|desconto)/i, cat: 'negociacao' },
  { re: /(fechad|ganho|cliente|onboard)/i, cat: 'fechado' },
];

function categoria(etapa) {
  return (STAGE_CAT.find((s) => s.re.test(etapa || '')) || { cat: 'novo' }).cat;
}

const SAUDACAO = {
  Formal: 'Prezado(a) {nome}, tudo bem?',
  Consultivo: 'Oi {nome}, tudo certo?',
  Amigável: 'Opa {nome}, beleza?',
  Direto: '{nome}, tudo bem?',
};

const CORPO = {
  novo: 'vi seu interesse em {produto}. Posso te mostrar em 10 min como isso resolve {dor}?',
  qualificado: 'pra eu te indicar o melhor caminho com {produto}: hoje como você resolve {dor}?',
  proposta: 'te enviei a proposta de {produto}. Conseguiu ver? Fico à disposição pra ajustar o que precisar.',
  negociacao: 'sobre a proposta de {produto} — o que falta pra fecharmos? Se for condição, a gente conversa.',
  fechado: 'seja bem-vindo(a)! Vou acompanhar seu início com {produto} pra garantir que dê certo.',
};

/**
 * @param {object} profile   saída de mapProfile
 * @param {object} ctx  { nome, etapa, dor, canal }
 * @returns {{mensagem:string, canaisSugeridos:string[], variaveis:string[], categoria:string}}
 */
/**
 * Nome curto do produto a partir do texto livre da entrevista. Pega o que vem antes do
 * primeiro ':' (padrao "Produto: explicacao") ou a primeira frase, corta em 60 e tira a
 * pontuacao final. Sem nada aproveitavel, cai no nome da empresa.
 */
function rotuloCurto(vende, nomeEmpresa) {
  const bruto = String(vende || '').trim();
  if (!bruto) { return nomeEmpresa || '{produto}'; }
  const antesDosDoisPontos = bruto.split(':')[0].trim();
  const base = (antesDosDoisPontos && antesDosDoisPontos.length <= 60)
    ? antesDosDoisPontos
    : bruto.split(/(?<=[.!?])\s/)[0].trim();
  const curto = base.length <= 60 ? base : base.slice(0, 59).trim() + '…';
  return curto.replace(/[.,;:\s]+$/, '') || nomeEmpresa || '{produto}';
}

export function draftFollowup(profile, ctx = {}) {
  const tom = profile.empresa?.tom || 'Consultivo';
  const cat = categoria(ctx.etapa);
  // {produto} entra no meio da frase ("vi seu interesse em {produto}"), entao precisa
  // ser um NOME curto. Vinha o texto inteiro do "o que a empresa vende" — que a propria
  // entrevista pede em 1-2 FRASES — e a mensagem saia impublicavel, com o ponto final
  // do texto colidindo com a pontuacao do template ("...documentacao.. Posso te mostrar").
  const produto = rotuloCurto(profile.empresa?.vende, profile.empresa?.nome);
  const nome = ctx.nome || '{nome}';
  const dor = ctx.dor || 'seu desafio atual';

  const saud = (SAUDACAO[tom] || SAUDACAO.Consultivo).replace('{nome}', nome);
  const corpo = (CORPO[cat]).replace('{produto}', produto).replace('{dor}', dor);
  const fecho = tom === 'Formal' ? 'Atenciosamente.' : tom === 'Direto' ? '' : 'Abraço!';
  const mensagem = [saud, corpo, fecho].filter(Boolean).join('\n\n');

  const variaveis = [];
  if (!ctx.nome) { variaveis.push('nome'); }
  if (!ctx.dor && /\{dor\}|desafio atual/.test(corpo)) { variaveis.push('dor'); }

  return { mensagem, categoria: cat, canaisSugeridos: profile.canais || [], variaveis };
}
