/**
 * Protocolo de atendimento — o fio que liga a conversa de hoje à de amanhã.
 *
 * O problema que isto resolve é velho e todo mundo já sofreu: você conta o
 * problema inteiro, a conversa morre, você volta e tem que contar tudo de novo
 * desde o "digite 1". O protocolo é o que permite dizer "continua de onde
 * paramos" sem depender da memória de ninguém.
 *
 * Regras puras: nada de disco, nada de relógio implícito. O instante entra por
 * parâmetro para os casos de tempo serem testáveis sem esperar.
 */

/* Sem 0/O e sem 1/I: o número vai ser lido em voz alta e digitado por alguém
   com pressa. Trocar O por 0 num protocolo e ele "não existir" é a forma mais
   boba de perder um cliente que estava colaborando. */
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const ESTADOS = {
  COM_BOT: 'com_bot',
  NA_FILA: 'na_fila',
  COM_HUMANO: 'com_humano',
  ENCERRADO: 'encerrado',
};

/** Minutos de silêncio até encerrar. Curto de propósito: ver mais abaixo. */
export const MINUTOS_INATIVIDADE = 5;

/**
 * Janela em que voltar continua sendo A MESMA conversa.
 *
 * Generosa de propósito, e é o contraponto do encerramento curto: fechar em 5
 * minutos só é aceitável porque voltar é indolor. Se o encerramento fosse
 * definitivo, 5 minutos seria crueldade com quem está dirigindo, em reunião,
 * ou simplesmente digita devagar.
 */
export const HORAS_RETOMADA = 24;

/**
 * Tolerância para NÃO perder o lugar na fila.
 *
 * Quem estava esperando um humano e demorou a responder não pode ir para o fim
 * da fila: a demora foi nossa, não dele. Guardar o lugar não é furar fila —
 * quem chegou depois continua depois.
 */
export const MINUTOS_GUARDA_FILA = 30;

const minutos = (de, ate) => (new Date(ate).getTime() - new Date(de).getTime()) / 60000;
const horas = (de, ate) => minutos(de, ate) / 60;

/**
 * Número do protocolo: `VS-AAMMDD-XXXX`.
 *
 * Traz a data porque o cliente costuma dizer "liguei terça" antes de dizer o
 * número, e o atendente acha mais rápido. O sufixo é sorteado no alfabeto sem
 * caracteres ambíguos.
 */
export function gerarNumero(quando = new Date().toISOString(), sorteio = Math.random) {
  const d = new Date(quando);
  const dia = [
    String(d.getUTCFullYear()).slice(2),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('');
  let sufixo = '';
  for (let i = 0; i < 4; i += 1) { sufixo += ALFABETO[Math.floor(sorteio() * ALFABETO.length)]; }
  return `VS-${dia}-${sufixo}`;
}

/** Aceita o que a pessoa digitar: minúscula, sem traço, com espaço. */
export const normalizarNumero = (t) => String(t ?? '')
  .toUpperCase().replace(/[^0-9A-Z]/g, '');

export const ehNumeroDeProtocolo = (t) => /^VS[0-9]{6}[0-9A-Z]{4}$/.test(normalizarNumero(t));

export function abrir({ de, quando = new Date().toISOString(), numero, sorteio } = {}) {
  return {
    numero: numero || gerarNumero(quando, sorteio),
    de: String(de || ''),
    estado: ESTADOS.COM_BOT,
    abertoEm: quando,
    ultimaAtividade: quando,
    encerradoEm: null,
    /* Guardado para o caso de voltar: é o que evita "conte tudo de novo". */
    passo: null,
    contexto: {},
    departamento: null,
    filaDesde: null,
  };
}

/** Passou tempo demais em silêncio? */
export function inativo(p, agora = new Date().toISOString(), limite = MINUTOS_INATIVIDADE) {
  if (!p || p.estado === ESTADOS.ENCERRADO) { return false; }
  return minutos(p.ultimaAtividade, agora) >= limite;
}

/**
 * Encerra por silêncio. NÃO apaga nada: encerrado é um estado, não um sumiço —
 * é isso que permite continuar depois.
 */
export function encerrar(p, { quando = new Date().toISOString(), motivo = 'inatividade', por = null, atendidoPor = null } = {}) {
  return {
    ...p,
    /* QUEM encerrou (cliente, atendente, inatividade, moderacao) e quem
       atendeu: e o que o historico precisa pra auditar depois. */
    encerradoPor: por || { tipo: ['inatividade', 'moderacao'].includes(motivo) ? motivo : 'atendente', nome: null },
    atendidoPor: atendidoPor || p.atendidoPor || null,
    /* De ONDE se encerrou muda tudo no retorno: quem estava na fila volta pra
       fila, quem estava com o bot volta pro passo. Sem guardar isto, todo mundo
       voltava como se estivesse com o bot — e quem ja tinha falado com gente
       era jogado no menu outra vez, que e o insulto que este modulo existe pra
       acabar. */
    estadoAntes: p.estado,
    estado: ESTADOS.ENCERRADO,
    encerradoEm: quando,
    motivoEncerramento: motivo,
  };
}

/**
 * A pessoa voltou. O que fazer com ela?
 *
 * As três respostas são diferentes e misturar é o que estraga o atendimento:
 *  - fora da janela → assunto novo, começa do zero (e o protocolo antigo fica
 *    no histórico, não se apaga);
 *  - estava com o bot → volta no passo em que parou, com o que já contou;
 *  - estava na fila ou com um atendente → volta PARA A FILA, sem passar pela
 *    Micaela de novo. Perguntar tudo outra vez a quem já falou com gente é o
 *    insulto clássico do atendimento automatizado.
 */
export function aoVoltar(p, agora = new Date().toISOString(), { voltarParaFila = true } = {}) {
  if (!p || p.estado !== ESTADOS.ENCERRADO) { return { acao: 'seguir' }; }
  /* Encerrado pela moderação (ofensa, ou brincadeira com as opções) ACABOU:
     passada a pausa, é conversa nova. Reabrir o protocolo mandaria de volta pra
     fila quem foi encerrado justamente pra esfriar a cabeça. */
  if (p.motivoEncerramento === 'moderacao') {
    return { acao: 'novo', motivo: `o protocolo ${p.numero} foi encerrado pela moderação` };
  }
  if (horas(p.encerradoEm, agora) > HORAS_RETOMADA) {
    return { acao: 'novo', motivo: `o protocolo ${p.numero} é de mais de ${HORAS_RETOMADA}h atrás` };
  }

  const estavaComGente = [ESTADOS.NA_FILA, ESTADOS.COM_HUMANO].includes(p.estadoAntes || p.estado);
  /* Encerrou, acabou — quando a casa quer assim. Voltar pra fila sozinho, sem
     ninguem pra atender, e deixar a pessoa no vacuo: o bot cala esperando gente
     e gente nao vem. Com isto desligado, quem volta e atendido do zero. */
  if (estavaComGente && !voltarParaFila) {
    return { acao: 'novo', motivo: `o protocolo ${p.numero} foi encerrado; a casa não reabre fila sozinha` };
  }
  if (!estavaComGente) {
    return { acao: 'retomar_bot', passo: p.passo, contexto: p.contexto || {}, numero: p.numero };
  }

  /* Guardar o lugar na fila não é furar fila: quem chegou depois continua
     depois. O que seria injusto é mandar para o fim quem parou de responder
     porque ESTAVA ESPERANDO A GENTE. */
  const guardaOLugar = p.filaDesde != null
    && minutos(p.encerradoEm, agora) <= MINUTOS_GUARDA_FILA;

  return {
    acao: 'voltar_fila',
    numero: p.numero,
    contexto: p.contexto || {},
    departamento: p.departamento || 'humano',
    filaDesde: guardaOLugar ? p.filaDesde : agora,
    lugarGuardado: guardaOLugar,
  };
}

/** Marca atividade e, de quebra, guarda onde a conversa está. */
export function tocar(p, { quando = new Date().toISOString(), passo, contexto, estado, departamento, atendidoPor } = {}) {
  const novo = { ...p, ultimaAtividade: quando };
  if (atendidoPor !== undefined) { novo.atendidoPor = atendidoPor; }
  if (passo !== undefined) { novo.passo = passo; }
  if (contexto !== undefined) { novo.contexto = { ...(p.contexto || {}), ...contexto }; }
  if (departamento !== undefined) { novo.departamento = departamento; }
  if (estado !== undefined) {
    /* `estadoAntes` sobrevive ao encerramento: sem ele, quem estava na fila
       voltaria como se estivesse com o bot e perderia o lugar e o contexto. */
    if (estado === ESTADOS.ENCERRADO) { novo.estadoAntes = p.estado; }
    novo.estado = estado;
    if (estado === ESTADOS.NA_FILA && !p.filaDesde) { novo.filaDesde = quando; }
  }
  return novo;
}

/** A frase que o cliente recebe ao ser encerrado — com o número em destaque. */
export function textoDeEncerramento(p) {
  return `Vou encerrar este atendimento por aqui, mas não se preocupe: guardei tudo.\n\n`
    + `*Protocolo ${p.numero}*\n\n`
    + `Se precisar, é só me chamar de novo — a gente continua de onde parou, `
    + `sem você ter que repetir nada.`;
}

/** A frase de quem voltou. Dizer que reconheceu é metade do valor. */
export function textoDeRetomada(p, volta) {
  if (volta.acao === 'voltar_fila') {
    return `Oi de novo! Achei seu atendimento *${p.numero}*.\n\n`
      + (volta.lugarGuardado
        ? 'Você já estava na fila para falar com uma pessoa do time — guardei seu lugar. Já já te chamam.'
        : 'Vou te colocar de volta na fila para falar com uma pessoa do time. Não precisa repetir nada, eles já têm o que você me contou.');
  }
  return `Oi de novo! Achei seu atendimento *${p.numero}* e vamos continuar de onde paramos.`;
}

/* ── encerramento pelo cliente e avaliação ────────────────────────────────── */

/**
 * O cliente pediu pra encerrar? Frases curtas e explícitas de propósito: "pode
 * encerrar" fecha; "quero encerrar minha conta" NÃO (é assunto, não despedida).
 */
const DESPEDIDAS = [
  /^(pode )?(encerrar|finalizar|fechar)( o)?( (meu )?atendimento)?( por favor| pfv| pf)?[.!]*$/,
  /^(pode|podem) (encerrar|finalizar|fechar)( aqui| por aqui| o atendimento)?[.!]*( obrigad[oa])?[.!]*$/,
  /^(era|e) so isso( mesmo)?[,.!]*( obrigad[oa]| valeu)?[.!]*$/,
  /^so isso( mesmo)?[,.!]*( obrigad[oa]| valeu)[.!]*$/,
  /^(ja )?(resolvido|resolveu|resolvi)[,.!]*( obrigad[oa]| valeu)?[.!]*$/,
  /^encerra( o atendimento| ai| aí)?[.!]*$/,
  /^(quero|pode) encerrar o atendimento[.!]*$/,
];
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
export const clientePediuEncerrar = (texto) => DESPEDIDAS.some((re) => re.test(semAcento(texto)));

/** Minutos que a avaliação fica esperando resposta. Depois disso, mensagem nova é conversa nova. */
export const MINUTOS_AVALIACAO = 120;
export const MINUTOS_COMENTARIO = 30;

/**
 * Nota de 1 a 5 no que a pessoa escrever: "5", "nota 4", "⭐⭐⭐", "ótimo".
 * Qualquer outra coisa não é nota — e aí a conversa segue normal.
 */
export function lerNota(texto) {
  const t = semAcento(texto).replace(/[.!]+$/, '');
  const estrelas = (String(texto).match(/⭐|★/g) || []).length;
  if (estrelas >= 1 && estrelas <= 5 && !/[a-z0-9]/.test(t.replace(/⭐|★/g, ''))) { return estrelas; }
  const m = t.match(/^(?:nota\s*)?([1-5])(?:\s*(?:de 5|\/5|estrelas?))?$/);
  if (m) { return Number(m[1]); }
  const palavras = { pessimo: 1, horrivel: 1, ruim: 2, regular: 3, 'mais ou menos': 3, razoavel: 3, bom: 4, boa: 4, 'muito bom': 5, otimo: 5, otima: 5, excelente: 5, perfeito: 5, 'nota 10': 5, '10': 5 };
  return palavras[t] ?? null;
}

export const textoAvaliacao = () => 'Antes de ir: de *1 a 5*, que nota você dá para este atendimento? (1 = muito ruim, 5 = excelente)\n\nÉ só responder com o número.';
export const textoObrigadoNota = (nota) => (nota <= 3
  ? `Obrigado pela nota ${nota}. Quer contar o que faltou? É só escrever — ou mande *0* para pular.`
  : `Obrigado pela nota ${nota}! 🙏 Se precisar, é só chamar.`);
export const textoObrigadoComentario = () => 'Anotado — vai direto para quem cuida do atendimento. Obrigado! 🙏';
