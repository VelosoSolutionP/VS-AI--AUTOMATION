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

/** @returns {{emergencia:boolean, tipo?:string, fone?:string, trecho?:string}} */
export function detectar(texto) {
  const t = norm(texto);
  if (!t) { return { emergencia: false }; }
  for (const s of SINAIS) {
    const achado = s.termos.find((termo) => t.includes(norm(termo)));
    if (achado) { return { emergencia: true, tipo: s.tipo, fone: s.fone, trecho: achado }; }
  }
  return { emergencia: false };
}

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

export function resposta(sinal, { nomeEscritorio, telefones } = {}) {
  const fone = (t, padrao) => String((telefones || {})[t] || padrao);
  const onde = nomeEscritorio ? ` do ${nomeEscritorio}` : ' do escritório';
  if (sinal.tipo === 'violencia_mulher') {
    return `🚨 *LIGUE ${fone('violencia_mulher', '180')}* agora — Central de Atendimento à Mulher.\n`
      + `Se houver perigo imediato, *${fone('violencia', '190')}*.\n\n`
      + `Já avisei alguém${onde} e estão te procurando por aqui. Se puder, vá para um lugar seguro.`;
  }
  if (sinal.tipo === 'saude') {
    return `🚨 *LIGUE ${fone('saude', '192')}* agora — SAMU.\n\nJá avisei alguém${onde}.`;
  }
  return `🚨 *LIGUE ${fone('violencia', '190')}* agora — Polícia Militar.\n\n`
    + `Já avisei alguém${onde} e estão te procurando por aqui. Sua mensagem ficou registrada.`;
}
