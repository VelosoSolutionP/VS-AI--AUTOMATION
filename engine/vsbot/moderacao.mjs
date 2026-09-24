/**
 * Respeito no atendimento.
 *
 * Existe porque quem atende pelo WhatsApp apanha. Num escritório de advocacia
 * criminal, a pessoa do outro lado costuma estar no pior dia da vida dela — e
 * às vezes isso sai como ofensa. A regra da casa:
 *
 *   1ª e 2ª vez — avisa, com textos diferentes; o último aviso diz o que vem
 *   3ª vez      — encerra, sem fila, e pausa (2 h; o cliente configura os dois)
 *   na pausa    — responde UMA vez com a hora de voltar e depois fica calado
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

/**
 * Limites da casa — o CLIENTE configura (tela do bot no CRM). Padrão:
 * dois avisos, e na terceira ofensa encerra com pausa de 2 horas. Pausa curta
 * de propósito: é pra esfriar a cabeça, não pra perder o cliente.
 */
export const PADRAO_LIMITES = { avisosAntesDePausa: 2, horasDePausa: 2, errosDeOpcaoAtePausa: 4 };
export const HORAS_DE_SILENCIO = PADRAO_LIMITES.horasDePausa;
export function limitesDe(cfg = {}) {
  const n = (v, pad, min) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : pad);
  return {
    avisosAntesDePausa: n(cfg.avisosAntesDePausa, PADRAO_LIMITES.avisosAntesDePausa, 0),
    horasDePausa: n(cfg.horasDePausa, PADRAO_LIMITES.horasDePausa, 0.25),
    errosDeOpcaoAtePausa: n(cfg.errosDeOpcaoAtePausa, PADRAO_LIMITES.errosDeOpcaoAtePausa, 2),
  };
}
const horaBr = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const duracao = (h) => (h < 1 ? `${Math.round(h * 60)} minutos` : h === 1 ? '1 hora' : `${h} horas`);

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
  const lim = limitesDe(opts.limites);

  /* EM PAUSA. Responde UMA vez com a hora de voltar — ninguém fica no vácuo
     sem saber por quê — e depois fica calado: repetir a mesma frase a cada
     mensagem é o que deixa o bot chato. A palavra "urgente" atravessa e chama
     gente. (Socorro de verdade nem chega aqui: é tratado antes de tudo.) */
  if (conversa.silenciadoAte && new Date(conversa.silenciadoAte).getTime() > agora) {
    if (pediuUrgencia(texto)) {
      return { acao: 'urgencia', texto: 'Entendi que é urgente. Estou chamando uma pessoa agora.' };
    }
    if (!conversa.avisouPausa) {
      return {
        acao: 'pausa',
        texto: `Este atendimento foi encerrado. Você pode voltar a falar comigo a partir das ${horaBr(conversa.silenciadoAte)}.\n\nSe for urgente, escreva *URGENTE*.`,
        marcar: { avisouPausa: true },
      };
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

  /* Caso urgente NAO leva pausa: quem esta no meio de um problema serio nao e
     calado porque perdeu a linha. */
  if (opts.emUrgencia) {
    return {
      acao: 'avisa',
      tipo: assedio ? 'assedio' : 'ofensa',
      texto: 'Vamos manter o respeito — estou aqui pra te ajudar com isso.',
      marcar: { avisosDeRespeito: avisos + 1, ofensaEmUrgencia: new Date(agora).toISOString() },
    };
  }

  /* AVISOS: cada um com texto proprio — a mesma bronca duas vezes soa robo. O
     ultimo diz com todas as letras o que vem depois. */
  if (avisos < lim.avisosAntesDePausa) {
    const ultimo = avisos + 1 === lim.avisosAntesDePausa;
    return {
      acao: 'avisa',
      tipo: assedio ? 'assedio' : 'ofensa',
      texto: ultimo && avisos > 0
        ? `Último aviso: se continuar, eu encerro o atendimento e você só volta a falar comigo daqui a ${duracao(lim.horasDePausa)}.`
        : ultimo
          ? `Vamos manter o respeito. Se continuar, eu encerro o atendimento por ${duracao(lim.horasDePausa)}.`
          : 'Entendo que você possa estar nervoso, mas vamos manter o respeito — assim eu consigo te ajudar. 🙏',
      marcar: { avisosDeRespeito: avisos + 1 },
    };
  }

  return encerrarComPausa({ agora, lim, tipo: assedio ? 'assedio' : 'ofensa',
    texto: 'Como combinado, vou encerrar o atendimento por aqui. Respire, esfrie a cabeça' });
}

/**
 * Encerrar COM PAUSA — o fim tanto da ofensa quanto da brincadeira com as
 * opções. Encerrou, acabou: sem fila, sem "uma pessoa vai te atender", sem
 * retomar de onde parou. Passada a pausa, é conversa nova.
 */
export function encerrarComPausa({ agora = Date.now(), lim = limitesDe(), tipo, texto }) {
  const ate = new Date(agora + lim.horasDePausa * 3600 * 1000).toISOString();
  return {
    acao: 'encerra',
    tipo,
    texto: `${texto} e volte a falar comigo a partir das ${horaBr(ate)} (daqui a ${duracao(lim.horasDePausa)}).\n\n`
      + 'Se for urgente, escreva *URGENTE*.',
    ate,
    marcar: { silenciadoAte: ate, motivoPausa: tipo },
  };
}

/**
 * Brincadeira com as opções: escolha errada SEGUIDA. Uma antes do limite, avisa;
 * no limite, encerra com a mesma pausa da ofensa. Errar uma ou duas vezes é
 * normal — o menu responde de novo, sem bronca.
 */
export function porErroDeOpcao(erros, { agora = Date.now(), limites } = {}) {
  const lim = limitesDe(limites);
  if (erros >= lim.errosDeOpcaoAtePausa) {
    return encerrarComPausa({ agora, lim, tipo: 'opcoes',
      texto: 'Não consegui entender as suas escolhas, então vou encerrar o atendimento por aqui' });
  }
  if (erros === lim.errosDeOpcaoAtePausa - 1) {
    return { acao: 'avisa', texto: 'Preciso que você responda com o *número* de uma das opções. Se não der certo na próxima, encerro o atendimento por aqui.' };
  }
  return { acao: 'segue' };
}
