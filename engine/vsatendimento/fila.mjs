/**
 * VSatendimento — a fila por setor e o atendimento humano.
 *
 * Nao existe "distribuir para quem esta livre", e isso e de proposito: rastrear
 * presenca de gente sempre mente (a aba fica aberta, a pessoa saiu pro almoco).
 * Aqui a fila e PUXADA — o especialista termina um atendimento e chama
 * `assumir`, que entrega o mais antigo do setor dele. Quem esta ocupado
 * simplesmente nao puxa.
 *
 * Tempo: `encerrar` mede a duracao para DEBITAR do contrato (plano A). Nao ha
 * SLA, nao ha relogio correndo contra ninguem, e nada aqui cobra pressa.
 */

const agora = () => new Date().toISOString();

export const STATUS = ['aguardando', 'em_atendimento', 'bloqueado', 'encerrado'];

/** Id estavel e legivel: quem le o log sabe de quem e quando sem abrir o JSON. */
const novoId = (cliente, quando) =>
  `${cliente}-${quando.replace(/[-:.TZ]/g, '').slice(0, 14)}`;

/**
 * Abre o atendimento com o veredito da triagem ja aplicado.
 * A conversa que a Micaela ja teve entra como historico — o especialista NAO
 * pede pro cliente repetir o que ele acabou de contar.
 */
export function abrir({ cliente, setor, status = 'aguardando', motivo, assunto, servico = null, conversa = [], evidencias = [] }, quando = agora()) {
  const tel = String(cliente || '').replace(/\D/g, '');
  if (!tel) { return { erro: 'informe o telefone do cliente' }; }
  if (!setor) { return { erro: 'triagem nao definiu setor' }; }
  if (!STATUS.includes(status)) { return { erro: `status invalido: ${status}` }; }

  return {
    atendimento: {
      id: novoId(tel, quando),
      cliente: tel,
      setor,
      status,
      motivo: motivo || null,
      assunto: assunto || null,
      servico,
      especialista: null,
      criadoEm: quando,
      assumidoEm: null,
      encerradoEm: null,
      minutos: null,
      mensagens: conversa.map((m) => ({
        autor: m.autor || 'micaela',
        texto: String(m.texto || ''),
        quando: m.quando || quando,
      })),
      evidencias: evidencias.map((e) => ({
        tipo: e.tipo || 'texto',
        conteudo: String(e.conteudo || ''),
        de: e.de || 'cliente',
        quando: e.quando || quando,
      })),
    },
  };
}

export const TIPOS_EVIDENCIA = ['texto', 'imagem', 'audio', 'log', 'codigo', 'video'];

/**
 * Anexa evidencia. O suporte pede SEMPRE, e o maximo que o cliente tiver:
 * print, codigo do erro, log, audio. Achar bug sem evidencia e adivinhacao,
 * e adivinhacao e o que faz o especialista gastar hora a toa.
 */
export function anexar(atendimento, { tipo = 'texto', conteudo, de = 'cliente' }, quando = agora()) {
  if (!TIPOS_EVIDENCIA.includes(tipo)) { return { erro: `tipo de evidencia invalido: ${tipo}` }; }
  const c = String(conteudo || '').trim();
  if (!c) { return { erro: 'evidencia vazia' }; }
  if (atendimento.status === 'encerrado') { return { erro: 'atendimento ja encerrado' }; }
  return {
    atendimento: {
      ...atendimento,
      evidencias: [...(atendimento.evidencias || []), { tipo, conteudo: c, de, quando }],
    },
  };
}

/**
 * Marcado na fila pro especialista ver ANTES de abrir: chegou sem nada nas
 * maos. Nao impede o atendimento — so avisa que a primeira coisa a fazer e
 * pedir evidencia.
 */
export const semEvidencia = (a) => !(a.evidencias || []).length;

/** Quem esta esperando nesse setor, do mais antigo pro mais novo. */
export const aguardando = (lista, setor) =>
  lista
    .filter((a) => a.status === 'aguardando' && (!setor || a.setor === setor))
    .sort((x, y) => x.criadoEm.localeCompare(y.criadoEm));

/**
 * O especialista puxa o proximo do seu setor. Sem ninguem na fila devolve
 * {vazio:true} em vez de erro: fila vazia e o estado bom, nao uma falha.
 */
export function assumir(lista, setor, especialista, quando = agora()) {
  if (!especialista) { return { erro: 'informe quem esta assumindo' }; }
  const proximo = aguardando(lista, setor)[0];
  if (!proximo) { return { vazio: true, setor }; }
  return {
    atendimento: { ...proximo, status: 'em_atendimento', especialista, assumidoEm: quando },
  };
}

/** Mensagem na conversa. `autor` e quem falou: 'cliente', 'micaela' ou o id da pessoa. */
export function falar(atendimento, { autor, texto }, quando = agora()) {
  if (!autor) { return { erro: 'toda mensagem precisa de autor' }; }
  const t = String(texto || '').trim();
  if (!t) { return { erro: 'mensagem vazia' }; }
  if (atendimento.status === 'encerrado') { return { erro: 'atendimento ja encerrado' }; }
  return {
    atendimento: {
      ...atendimento,
      mensagens: [...atendimento.mensagens, { autor, texto: t, quando }],
    },
  };
}

/**
 * Cobranca resolvida: o atendimento bloqueado vira fila normal do setor certo.
 * E o unico caminho de volta do bloqueio — nao ha como "desbloquear" sem que
 * alguem do financeiro diga que resolveu.
 */
export function liberar(atendimento, { setor = 'suporte', por }, quando = agora()) {
  if (atendimento.status !== 'bloqueado') { return { erro: 'so um atendimento bloqueado pode ser liberado' }; }
  if (!por) { return { erro: 'informe quem liberou' }; }
  return {
    atendimento: {
      ...atendimento,
      status: 'aguardando',
      setor,
      especialista: null,
      motivo: `liberado por ${por}`,
      mensagens: [...atendimento.mensagens, {
        autor: 'sistema', texto: `Pendencia resolvida por ${por}. Atendimento liberado para ${setor}.`, quando,
      }],
    },
  };
}

/**
 * Encerra e calcula os minutos gastos — o numero que o plano A debita.
 * Conta de `assumidoEm`, nao de `criadoEm`: o tempo que o cliente passou na
 * fila nao e hora de especialista e nao pode sair da cota dele.
 */
export function encerrar(atendimento, { desfecho = 'resolvido' } = {}, quando = agora()) {
  if (atendimento.status === 'encerrado') { return { erro: 'atendimento ja encerrado' }; }
  const base = atendimento.assumidoEm;
  const minutos = base
    ? Math.max(1, Math.round((Date.parse(quando) - Date.parse(base)) / 60000))
    : 0;
  return {
    atendimento: { ...atendimento, status: 'encerrado', encerradoEm: quando, minutos, desfecho },
  };
}

/** Minutos ja gastos por esse cliente na competencia — entra na triagem seguinte. */
export const minutosNoMes = (lista, cliente, mes) =>
  lista
    .filter((a) => a.cliente === cliente && a.encerradoEm?.startsWith(mes))
    .reduce((s, a) => s + Number(a.minutos || 0), 0);

/** Quantas vezes o cliente usou esse servico na competencia. */
export const usosNoMes = (lista, cliente, servico, mes) =>
  lista.filter((a) => a.cliente === cliente && a.servico === servico && a.criadoEm.startsWith(mes)).length;
