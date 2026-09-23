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
];

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

/**
 * O que fazer com esta mensagem.
 * @param {string} texto
 * @param {{avisosDeRespeito?:number, silenciadoAte?:string}} conversa
 * @param {{temContrato?:boolean, agora?:number}} opts
 * @returns {{acao:'segue'|'avisa'|'encerra'|'calado', texto?:string, ate?:string, marcar?:object}}
 */
export function avaliar(texto, conversa = {}, opts = {}) {
  const agora = opts.agora ?? Date.now();

  // Ainda de castigo? Nao responde nada — e o silencio que foi prometido.
  if (conversa.silenciadoAte && new Date(conversa.silenciadoAte).getTime() > agora) {
    return { acao: 'calado', ate: conversa.silenciadoAte };
  }

  if (!ehOfensa(texto)) { return { acao: 'segue' }; }

  const avisos = Number(conversa.avisosDeRespeito || 0);

  /* CONTRATO ATIVO: nao encerra nunca. Marca e segue atendendo — quem decide
     romper um contrato e gente, com o contrato na mao. */
  if (opts.temContrato) {
    return {
      acao: 'avisa',
      texto: 'Vamos manter o respeito, por favor — assim eu consigo te ajudar de verdade.',
      marcar: { avisosDeRespeito: avisos + 1, ofensaComContrato: new Date(agora).toISOString() },
    };
  }

  if (avisos === 0) {
    return {
      acao: 'avisa',
      texto: 'Entendo que você possa estar nervoso, mas vamos manter o respeito — '
        + 'assim eu consigo te ajudar. 🙏',
      marcar: { avisosDeRespeito: 1 },
    };
  }

  const ate = new Date(agora + HORAS_DE_SILENCIO * 3600 * 1000).toISOString();
  return {
    acao: 'encerra',
    texto: `Vou encerrar o atendimento por aqui. Você pode voltar a falar comigo em ${HORAS_DE_SILENCIO} horas.`,
    ate,
    marcar: { avisosDeRespeito: avisos + 1, silenciadoAte: ate },
  };
}
