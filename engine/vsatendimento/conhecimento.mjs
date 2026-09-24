/**
 * VSatendimento — o que a Micaela sabe.
 *
 * DUAS bases, de proposito separadas:
 *
 *   regras   — restricao conhecida da plataforma. Curada por gente, semeada da
 *              documentacao. Responde "isso nao e bug, e regra, faca assim".
 *   solucoes — nasce VAZIA e engorda de atendimento resolvido. Responde
 *              "ja vimos isso, foi consertado assim".
 *
 * Misturar as duas e o que faz suporte automatico ficar ruim: documentacao diz
 * como DEVERIA funcionar, e quem abriu chamado esta vendo o que NAO funciona.
 *
 * Tres travas contra o pior defeito possivel aqui, que e responder com
 * confianca uma coisa errada e tomar o tempo do cliente:
 *
 *   1. LIMIAR — casamento fraco nao vira sugestao. Ela diz que nao sabe.
 *   2. ORIGEM — toda entrada carrega de onde veio, pra rastrear veneno.
 *   3. PLACAR — resolveu/nao resolveu contado sempre. Entrada que erra seguido
 *               cai no ranking e para de ser oferecida, sem ninguem lembrar.
 *
 * A base NAO fica no caminho da escalacao: `sugerir` e uma chamada separada de
 * `escalar`. Nao existe caminho de codigo em que uma sugestao errada impeca um
 * bug real de chegar no especialista.
 */

export const TIPOS = ['regra', 'solucao'];

/** Limiar de confianca: abaixo disso ela NAO sugere. */
export const LIMIAR = 0.5;

/** Placar a partir do qual a entrada e considerada queimada. */
export const PLACAR_MINIMO = -2;

const STOP = new Set([
  'a', 'as', 'o', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'para', 'pra', 'por', 'com', 'sem', 'que', 'nao', 'sim', 'ao', 'aos', 'se',
  'meu', 'minha', 'seu', 'sua', 'ele', 'ela', 'esta', 'este', 'essa', 'esse', 'isso', 'aqui',
  'ta', 'to', 'foi', 'ser', 'estou', 'quando', 'onde', 'como', 'mais', 'muito', 'ja',
]);

/** Sem acento, sem pontuacao, minusculo — o cliente nunca digita igual a base. */
export const normalizar = (t) =>
  String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const termos = (t) =>
  [...new Set(normalizar(t).split(' ').filter((p) => p.length > 2 && !STOP.has(p)))];

/** Codigo de erro: a unica parte de documentacao ruim que costuma estar certa. */
const CODIGO = /\b(?:[a-z]{2,6}[-_]?\d{2,6}|\d{3,6})\b/gi;
export const codigos = (t) => [...new Set((normalizar(t).match(CODIGO) || []))];

/* ----------------------------------------------------------------- cadastro */

export function novaEntrada(dados = {}, quando = new Date().toISOString()) {
  const tipo = dados.tipo === 'regra' ? 'regra' : 'solucao';
  const titulo = String(dados.titulo || '').trim();
  if (titulo.length < 5) { return { erro: 'de um titulo que descreva o sintoma' }; }

  const resposta = String(dados.resposta || '').trim();
  if (resposta.length < 10) { return { erro: 'escreva o que o cliente deve fazer' }; }

  const origem = String(dados.origem || '').trim();
  if (!origem) { return { erro: 'toda entrada precisa de origem (doc oficial, atendimento #, quem escreveu)' }; }

  return {
    entrada: {
      id: dados.id || `${tipo}-${quando.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`,
      tipo,
      titulo,
      /* Sintomas sao as palavras do CLIENTE, nao as nossas. "nao entra",
         "da erro", "trava" — e assim que o chamado chega. */
      sintomas: termos([titulo, (dados.sintomas || []).join(' ')].join(' ')),
      codigo: dados.codigo ? normalizar(dados.codigo) : null,
      produto: dados.produto || null,
      resposta,
      origem,
      autor: dados.autor || null,
      resolveu: 0,
      naoResolveu: 0,
      criadoEm: quando,
    },
  };
}

/** Placar: quanto a entrada ja ajudou menos quanto ja atrapalhou. */
export const placar = (e) => Number(e.resolveu || 0) - Number(e.naoResolveu || 0);

/* -------------------------------------------------------------------- busca */

/**
 * Confianca de 0 a 1: quanto dos sintomas da entrada aparecem no que o cliente
 * escreveu. Codigo de erro batendo e quase certeza e passa na frente de tudo.
 */
export function confianca(entrada, consulta) {
  if (entrada.codigo && codigos(consulta).includes(entrada.codigo)) { return 1; }
  if (!entrada.sintomas?.length) { return 0; }
  const ditos = new Set(termos(consulta));
  const acertos = entrada.sintomas.filter((s) => ditos.has(s)).length;
  if (acertos < 2) { return 0; }
  return acertos / entrada.sintomas.length;
}

/**
 * O que ela sabe sobre isso. Devolve SO o que passou do limiar e nao esta
 * queimado — lista vazia e resposta legitima, e no comeco e a resposta normal.
 */
export function buscar(base, consulta, { produto = null, limiar = LIMIAR } = {}) {
  return base
    .filter((e) => !produto || !e.produto || e.produto === produto)
    .filter((e) => placar(e) > PLACAR_MINIMO)
    .map((e) => ({ entrada: e, confianca: confianca(e, consulta) }))
    .filter((r) => r.confianca >= limiar)
    /* Regra da plataforma ganha de solucao no empate: "nao e bug, e regra"
       economiza o especialista inteiro. */
    .sort((a, b) =>
      b.confianca - a.confianca
      || (a.entrada.tipo === 'regra' ? -1 : 1) - (b.entrada.tipo === 'regra' ? -1 : 1)
      || placar(b.entrada) - placar(a.entrada))
    .slice(0, 3);
}

/**
 * O que a Micaela oferece ao cliente. Sem achado, ela NAO inventa — diz que
 * nao sabe. Escalar sem sugestao e o caminho bom, nao a falha.
 */
export function sugerir(base, consulta, opcoes = {}) {
  const achados = buscar(base, consulta, opcoes);
  if (!achados.length) {
    return {
      sugestao: null,
      mensagem: 'Nao encontrei nada parecido na nossa base ainda. Nao vou te fazer perder tempo tentando adivinhar — ja estou passando para um especialista com tudo que voce me contou.',
    };
  }
  const { entrada, confianca: c } = achados[0];
  return {
    sugestao: entrada,
    confianca: c,
    alternativas: achados.slice(1).map((a) => a.entrada),
    mensagem: entrada.tipo === 'regra'
      ? `Isso costuma ser uma regra da plataforma, nao um defeito: ${entrada.resposta} Quer tentar antes de eu chamar um especialista?`
      : `Ja vimos esse caso antes. ${entrada.resposta} Quer tentar antes de eu chamar um especialista?`,
  };
}

/* ------------------------------------------------------------- aprendizado */

/**
 * Atendimento resolvido vira RASCUNHO de entrada — nunca entrada publicada.
 * Quem escreve a base e gente: um rascunho automatico virando resposta oficial
 * sem alguem ler e como a base se enche de lixo com cara de verdade.
 */
export function aprender(atendimento, { autor = null } = {}) {
  if (atendimento.status !== 'encerrado') { return { erro: 'so atendimento encerrado vira conhecimento' }; }
  if (atendimento.desfecho !== 'resolvido') { return { erro: 'so atendimento resolvido vira conhecimento' }; }

  const doCliente = atendimento.mensagens
    .filter((m) => m.autor === 'cliente').map((m) => m.texto).join(' ');
  const daEquipe = atendimento.mensagens
    .filter((m) => m.autor !== 'cliente' && m.autor !== 'micaela' && m.autor !== 'sistema')
    .map((m) => m.texto).join(' ');

  return {
    rascunho: {
      tipo: 'solucao',
      titulo: atendimento.assunto || doCliente.slice(0, 80) || 'sem assunto',
      sintomas: termos(doCliente),
      produto: atendimento.servico || null,
      resposta: daEquipe || '',
      origem: `atendimento ${atendimento.id}`,
      autor: autor || atendimento.especialista || null,
      /* Sem o que a equipe escreveu nao ha solucao pra guardar — o rascunho
         nasce pedindo que alguem complete, em vez de virar entrada vazia. */
      precisaRevisao: !daEquipe,
    },
  };
}

/** O placar. `resolveu:false` e tao importante quanto true — e o que aposenta entrada ruim. */
export function registrarResultado(entrada, resolveu) {
  return {
    entrada: resolveu
      ? { ...entrada, resolveu: Number(entrada.resolveu || 0) + 1 }
      : { ...entrada, naoResolveu: Number(entrada.naoResolveu || 0) + 1 },
  };
}
