/**
 * Pedido de socorro. Ganha de tudo.
 *
 * Em campo, num escritório criminal: depois do encaminhamento o bot entra em
 * silêncio para não falar por cima do atendente. Aí a pessoa escreveu
 *
 *     "tão me agredindo" · "socorro" · "vão me matar"
 *
 * e recebeu SILÊNCIO. O silêncio estava certo pela regra e errado pela vida.
 *
 * Então isto roda ANTES de tudo — antes do silêncio pós-handoff, antes da
 * moderação, antes do fluxo, antes até do castigo de 12 horas. Quem está sendo
 * agredido não perde o direito de resposta porque xingou o atendimento ontem.
 *
 * O que o bot faz aqui é UMA coisa: mandar para quem resolve. Ele não acalma,
 * não pergunta detalhe, não faz triagem. Advogado não é polícia, e cada
 * segundo gasto num menu é um segundo a mais de perigo.
 */

const norm = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/(.)\1{2,}/g, '$1')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Cada sinal traz o telefone certo. Mandar "ligue 190" para quem está sofrendo
 * violência doméstica é pior que não dizer nada: o 180 existe porque o 190 nem
 * sempre é seguro de ligar com o agressor ao lado.
 */
const SINAIS = [
  { tipo: 'violencia_mulher', fone: '180',
    termos: ['meu marido esta me batendo', 'meu marido ta me batendo', 'meu companheiro me bateu',
      'meu ex esta me ameacando', 'violencia domestica', 'ele vai me matar', 'ele ta me batendo',
      'ele esta me batendo', 'medida protetiva urgente'] },
  { tipo: 'violencia', fone: '190',
    termos: ['socorro', 'me ajuda pelo amor de deus', 'estao me agredindo', 'tao me agredindo',
      'estao me batendo', 'tao me batendo', 'me agrediram agora', 'vao me matar', 'vai me matar',
      'querem me matar', 'to sendo ameacado de morte', 'estou sendo ameacado de morte',
      'ameaca de morte', 'invadiram minha casa', 'estao invadindo', 'sequestraram',
      'estao me perseguindo agora', 'tem um homem armado'] },
  { tipo: 'saude', fone: '192',
    termos: ['esta passando mal', 'ta passando mal', 'desmaiou', 'parou de respirar', 'overdose'] },
];

/** Os três tipos que a tela configura, na ordem em que são conferidos. */
export const TIPOS = Object.freeze(['violencia_mulher', 'violencia', 'saude']);

/**
 * @param {object} cfg  a config `emergencia` da empresa: tipos desligados não
 *   disparam, e `termosExtras[tipo]` soma as expressões dela às de fábrica
 *   (o jeito que o público DELA pede socorro).
 * @returns {{emergencia:boolean, tipo?:string, fone?:string, trecho?:string}}
 */
export function detectar(texto, cfg = {}) {
  const t = norm(texto);
  if (!t) { return { emergencia: false }; }
  for (const s of SINAIS) {
    if (cfg.tipos?.[s.tipo]?.ativo === false) { continue; }
    const termos = [...s.termos, ...((cfg.termosExtras || {})[s.tipo] || [])].map(norm).filter((x) => x.length >= 3);
    const achado = termos.find((termo) => t.includes(termo));
    if (achado) { return { emergencia: true, tipo: s.tipo, fone: telefone(cfg, s.tipo), trecho: achado }; }
  }
  return { emergencia: false };
}

/** Telefone do tipo: o que a empresa configurou, senão o oficial. */
export const telefone = (cfg = {}, tipo) => String(cfg.tipos?.[tipo]?.fone || cfg.telefones?.[tipo] || TELEFONES[tipo] || '190');

/**
 * A resposta. Curta de propósito: quem está em perigo não lê parágrafo.
 * O telefone vem na primeira linha, sozinho.
 */
/**
 * Ligado por padrao, e de proposito.
 *
 * Quem atende publico atende gente em todo tipo de situacao — lanchonete,
 * salao, escritorio. O custo de estar ligado e uma mensagem a mais num caso
 * raro; o custo de estar desligado e silencio pra quem pediu socorro. Quem
 * quiser desligar, desliga sabendo disso.
 */
export const PADRAO = Object.freeze({ ativo: true, avisarOperador: true });

export const ligado = (cfg = {}) => (cfg.emergencia?.ativo ?? PADRAO.ativo) === true;

/** Telefones oficiais do Brasil. Configuraveis porque o cliente pode ter o proprio. */
export const TELEFONES = Object.freeze({
  violencia: '190', violencia_mulher: '180', saude: '192',
});

/**
 * `avisando`: só diz que está chamando alguém quando EXISTE alguém cadastrado
 * pra receber o alerta. Antes dizia "já avisei alguém" sem avisar ninguém — a
 * pessoa em perigo esperava um retorno que não vinha.
 */
export function resposta(sinal, { nomeEscritorio, telefones, cfg, avisando = false } = {}) {
  const c = cfg || { telefones };
  const fone = (t) => telefone(c, t);
  const onde = nomeEscritorio ? ` da ${nomeEscritorio}` : '';
  const aviso = avisando
    ? `Estou avisando a equipe${onde} agora, e alguém vai te procurar por aqui.`
    : 'Sua mensagem ficou registrada.';
  if (sinal.tipo === 'violencia_mulher') {
    return `🚨 *LIGUE ${fone('violencia_mulher')}* agora — Central de Atendimento à Mulher.\n`
      + `Se houver perigo imediato, *${fone('violencia')}*.\n\n`
      + `${aviso} Se puder, vá para um lugar seguro.`;
  }
  if (sinal.tipo === 'saude') {
    return `🚨 *LIGUE ${fone('saude')}* agora — SAMU.\n\n${aviso}`;
  }
  return `🚨 *LIGUE ${fone('violencia')}* agora — Polícia Militar.\n\n${aviso}`;
}
