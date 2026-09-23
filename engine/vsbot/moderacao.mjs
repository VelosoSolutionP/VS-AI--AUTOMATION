/**
 * Respeito no atendimento.
 *
 * Existe porque quem atende pelo WhatsApp apanha. Num escritório de advocacia
 * criminal, a pessoa do outro lado costuma estar no pior dia da vida dela — e
 * às vezes isso sai como ofensa. A regra da casa:
 *
 *   1ª vez  — pede calma, UMA vez, sem sermão
 *   2ª vez  — encerra o atendimento e fica em silêncio por 12 horas
 *
 * Com uma trava que não é detalhe: CLIENTE COM CONTRATO NÃO É CALADO POR ROBÔ.
 * Contrato é obrigação assumida; um bot decidir parar de atender quem já pagou
 * cria problema com a OAB e com o cliente. Nesse caso o atendimento continua e
 * o fato fica marcado para uma pessoa decidir.
 *
 * O que NÃO se faz aqui: julgar o mérito. Palavrão de desabafo ("que merda de
 * situação") não é ofensa a ninguém — só conta o que é dirigido a quem atende.
 */

const norm = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  /* "vagabundooooo" e "vagabundo" sao a mesma ofensa. Colapsa repeticao de TRES
     ou mais para UMA: portugues nao tem letra triplicada, entao "arrombado" e
     "nossa" ficam intactos — so o alongamento de teclado some. */
  .replace(/(.)\1{2,}/g, '$1')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Ofensa DIRIGIDA. Xingamento solto sobre a situação não entra. */
const OFENSAS = [
  'vai se foder', 'vai tomar no', 'vai a merda', 'vai pra puta que pariu',
  'filho da puta', 'fdp', 'arrombado', 'otario', 'otaria', 'imbecil', 'idiota',
  'burro', 'burra', 'incompetente', 'lixo de atendimento', 'palhaco', 'palhaca',
  'vagabundo', 'vagabunda', 'ladrao', 'ladra', 'safado', 'safada', 'corno',
  'babaca', 'escroto', 'escrota', 'desgraçado', 'desgracado', 'cuzao', 'cuzão',
  'puta que pariu voce', 'seu merda', 'sua merda',
  /* Diminutivo nao suaviza: "sua cachorrinha" dirigido a quem atende e ofensa
     igual. Passou batido no primeiro teste em campo. */
  'cachorrinha', 'cachorra', 'cadela', 'piranha', 'vaca', 'vadia', 'rapariga',
  'sua besta', 'seu besta', 'analfabeto', 'analfabeta', 'inutil', 'retardado', 'retardada',
];

/**
 * ASSÉDIO e cantada. Categoria propria porque a resposta e outra.
 *
 * Xingamento pede "vamos manter o respeito". Cantada pede uma porta fechada:
 * responder com o menu, como acontecia, e o pior dos mundos — parece que a
 * mensagem passou e convida a insistir. Numa advogada mulher, atendendo homem
 * em situacao criminal, isso nao e hipotese remota.
 */
const ASSEDIO = [
  'quero sair com a advogada', 'quero sair com a doutora', 'quero sair com voce',
  'quer sair comigo', 'vamos sair', 'quero te conhecer melhor', 'quero te conhecer pessoalmente',
  'voce e gostosa', 'voce e linda', 'que gata', 'manda foto sua', 'me manda uma foto sua',
  'quero namorar', 'casa comigo', 'to afim de voce', 'tou afim de voce', 'estou afim de voce',
  'me da seu numero pessoal', 'seu whatsapp pessoal', 'voce e solteira', 'e casada',
  'quero sair com a dra', 'sair com a dra',
];

export function ehAssedio(texto) {
  const t = norm(texto);
  if (!t) { return false; }
  return ASSEDIO.some((p) => t.includes(norm(p)));
}

/** Alvo: quem atende. "que merda de situação" nao conta — nao e com ninguem. */
const DESABAFO = ['que merda', 'que saco', 'que droga', 'puta merda', 'caralho', 'porra'];

export function ehOfensa(texto) {
  const t = norm(texto);
  if (!t) { return false; }
  /* Desabafo primeiro: se a frase INTEIRA e desabafo, nao e ofensa a ninguem. */
  const soDesabafo = DESABAFO.some((d) => t === norm(d) || t === `${norm(d)} `.trim());
  if (soDesabafo) { return false; }
  return OFENSAS.some((p) => {
    const alvo = norm(p);
    return alvo.includes(' ') ? t.includes(alvo) : new RegExp(`\\b${alvo}\\b`).test(t);
  });
}

export const HORAS_DE_SILENCIO = 12;

/** A saida de emergencia do castigo. Curta e obvia, pra caber numa mensagem so. */
const URGENCIA = ['urgente', 'emergencia', 'e urgente', 'socorro', 'preciso agora', 'me ajuda agora'];
export const pediuUrgencia = (texto) => {
  const t = norm(texto);
  return !!t && URGENCIA.some((u) => t.includes(norm(u)));
};

/**
 * O que fazer com esta mensagem.
 * @param {string} texto
 * @param {{avisosDeRespeito?:number, silenciadoAte?:string}} conversa
 * @param {{temContrato?:boolean, agora?:number}} opts
 * @returns {{acao:'segue'|'avisa'|'encerra'|'calado', texto?:string, ate?:string, marcar?:object}}
 */
export function avaliar(texto, conversa = {}, opts = {}) {
  const agora = opts.agora ?? Date.now();

  /* Ainda de castigo. O bot cala; a PORTA nao tranca.
     Quem esta do outro lado nao e um trote: e alguem num processo criminal, que
     pode ter perdido a linha no pior dia da vida dele. Silencio de 12 horas com
     saida nenhuma seria abandono — entao a palavra "urgente" atravessa e chama
     gente. (Socorro de verdade nem chega aqui: e tratado antes de tudo.) */
  if (conversa.silenciadoAte && new Date(conversa.silenciadoAte).getTime() > agora) {
    if (pediuUrgencia(texto)) {
      return { acao: 'urgencia', texto: 'Entendi que é urgente. Estou chamando uma pessoa do escritório agora.' };
    }
    return { acao: 'calado', ate: conversa.silenciadoAte };
  }

  const assedio = ehAssedio(texto);
  if (!assedio && !ehOfensa(texto)) { return { acao: 'segue' }; }

  const avisos = Number(conversa.avisosDeRespeito || 0);

  /* Cantada: porta fechada na primeira, sem menu junto. Repetir o menu depois
     de uma cantada e o que fazia parecer que a mensagem tinha passado. */
  if (assedio && avisos === 0) {
    return {
      acao: 'avisa',
      tipo: 'assedio',
      texto: 'Aqui é o atendimento do escritório, e é só para assuntos do escritório. '
        + 'Se você precisa de ajuda jurídica, me diz que eu te encaminho.',
      marcar: { avisosDeRespeito: 1, assedio: new Date(agora).toISOString() },
    };
  }

  /* CONTRATO ATIVO: nao encerra nunca. Marca e segue atendendo — quem decide
     romper um contrato e gente, com o contrato na mao. */
  if (opts.temContrato) {
    return {
      acao: 'avisa',
      tipo: assedio ? 'assedio' : 'ofensa',
      texto: assedio
        ? 'Aqui é o atendimento do escritório, e é só para assuntos do escritório.'
        : 'Vamos manter o respeito, por favor — assim eu consigo te ajudar de verdade.',
      marcar: { avisosDeRespeito: avisos + 1, ofensaComContrato: new Date(agora).toISOString() },
    };
  }

  if (avisos === 0) {
    return {
      acao: 'avisa',
      tipo: 'ofensa',
      texto: 'Entendo que você possa estar nervoso, mas vamos manter o respeito — '
        + 'assim eu consigo te ajudar. 🙏',
      marcar: { avisosDeRespeito: 1 },
    };
  }

  /* Caso urgente NAO leva castigo. Quem ja foi encaminhado por urgencia esta
     no meio de um problema serio; calar essa pessoa por 12 horas e o tipo de
     regra que so parece boa no papel. */
  if (opts.emUrgencia) {
    return {
      acao: 'avisa',
      tipo: assedio ? 'assedio' : 'ofensa',
      texto: 'Vamos manter o respeito — estou aqui pra te ajudar com isso.',
      marcar: { avisosDeRespeito: avisos + 1, ofensaEmUrgencia: new Date(agora).toISOString() },
    };
  }

  const ate = new Date(agora + HORAS_DE_SILENCIO * 3600 * 1000).toISOString();
  return {
    acao: 'encerra',
    tipo: assedio ? 'assedio' : 'ofensa',
    /* A saida fica NA PROPRIA mensagem de encerramento. Sem isto, quem tem um
       problema de verdade e perdeu a linha ficaria 12 horas sem caminho. */
    texto: `Vou encerrar o atendimento por aqui. Você pode voltar a falar comigo em ${HORAS_DE_SILENCIO} horas.\n\n`
      + `Se for urgente, escreva *URGENTE* que eu chamo uma pessoa do escritório.`,
    ate,
    /* Uma pessoa fica sabendo. Encerramento automatico que ninguem revisa vira
       cliente perdido em silencio. */
    avisarPessoa: true,
    marcar: { avisosDeRespeito: avisos + 1, silenciadoAte: ate },
  };
}
