/**
 * Quebra-Galho — propostas, comparação e aceite do prestador.
 *
 * Três regras que vêm dos requisitos e não são detalhe de tela:
 *
 *  1) O card NUNCA mostra só preço. Preço sozinho empurra o cliente pro mais barato
 *     sem saber de quem. Nota, serviços concluídos, distância e prazo vão junto.
 *  2) Informação negativa relevante NÃO é escondida. Se o escolhido tem nota abaixo
 *     da média, o cliente vê o aviso antes de confirmar — e decide mesmo assim.
 *  3) O aceite do prestador tem prazo (5 min, configurável). Se estourar, o cliente
 *     NÃO recomeça: a próxima melhor proposta é oferecida na hora.
 */
import { randomBytes } from 'node:crypto';

export const STATUS = ['ENVIADA', 'SELECIONADA', 'AGUARDANDO_ACEITE', 'ACEITA', 'EXPIRADA_ACEITE', 'RECUSADA', 'NAO_ESCOLHIDA', 'RETIRADA'];

/** Janela de aceite, em segundos. Configurável por categoria. */
export const ACEITE_SEG = 300;

/** Quantas propostas o cliente vê. Configurável. */
export const MAX_APRESENTADAS = 5;

/** Abaixo disso, o cliente recebe a segunda sugestão antes de confirmar. */
export const NOTA_LIMITE = 4.0;

const txt = (v) => String(v ?? '').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Valida a proposta do prestador. */
export function normalizarProposta(e = {}) {
  const erros = [];

  if (!txt(e.pedidoId)) { erros.push('pedidoId é obrigatório'); }
  if (!txt(e.prestadorId)) { erros.push('prestadorId é obrigatório'); }

  const valor = num(e.valorCentavos);
  if (valor == null || !Number.isInteger(valor) || valor <= 0) {
    erros.push(`valor inválido: "${e.valorCentavos}" (centavos, inteiro maior que zero)`);
  }

  const prazo = num(e.prazoDias);
  if (prazo == null || prazo <= 0) { erros.push('informe em quantos dias consegue fazer'); }

  const escopo = txt(e.escopo);
  if (escopo.length < 10) { erros.push('descreva o que está incluído (mínimo 10 caracteres)'); }

  const validadeHoras = num(e.validadeHoras) ?? 48;
  if (validadeHoras <= 0) { erros.push('validade da proposta precisa ser maior que zero'); }

  if (erros.length) { return { proposta: null, erros }; }

  const agora = e.quando || new Date().toISOString();
  return {
    proposta: {
      id: 'prp_' + randomBytes(6).toString('hex'),
      pedidoId: txt(e.pedidoId),
      prestadorId: txt(e.prestadorId),
      valorCentavos: valor,
      prazoDias: prazo,
      escopo,
      // Material incluído ou não é a origem clássica de briga. Fica explícito.
      materiaisInclusos: Boolean(e.materiaisInclusos),
      materiais: txt(e.materiais) || null,
      naoIncluso: txt(e.naoIncluso) || null,
      disponibilidade: txt(e.disponibilidade) || null,
      observacoes: txt(e.observacoes) || null,
      status: 'ENVIADA',
      validaAte: new Date(new Date(agora).getTime() + validadeHoras * 3600000).toISOString(),
      criadaEm: agora,
      aceiteAte: null,
    },
    erros: [],
  };
}

/** A proposta ainda vale? */
export function valida(p, agora = Date.now()) {
  if (!p) { return false; }
  if (!['ENVIADA', 'SELECIONADA', 'AGUARDANDO_ACEITE'].includes(p.status)) { return false; }
  return new Date(p.validaAte).getTime() > agora;
}

/**
 * Monta o card que o cliente vê. Junta a proposta com o prestador — é aqui que a
 * regra "nunca só preço" se materializa.
 */
export function montarCard(proposta, prestador, distanciaKm) {
  return {
    id: proposta.id,
    prestadorId: prestador.id,
    nome: prestador.nome,
    // Sem avaliação ainda é "novo por aqui", não nota zero: zero puniria quem
    // acabou de entrar e nunca teve chance.
    nota: prestador.reputacao ?? null,
    novo: prestador.reputacao == null,
    servicos: prestador.servicosConcluidos ?? 0,
    distanciaKm: distanciaKm ?? null,
    valorCentavos: proposta.valorCentavos,
    prazoDias: proposta.prazoDias,
    disponibilidade: proposta.disponibilidade,
    escopo: proposta.escopo,
    materiaisInclusos: proposta.materiaisInclusos,
    naoIncluso: proposta.naoIncluso,
    categorias: prestador.categorias || [],
    validaAte: proposta.validaAte,
    status: proposta.status,
  };
}

/**
 * Ordena e corta as melhores. Não é só preço: equilibra valor, nota e distância.
 * Quem não tem nota entra no meio — nem premiado nem punido por ser novo.
 */
export function ranquear(cards = [], limite = MAX_APRESENTADAS) {
  if (!cards.length) { return []; }
  const precos = cards.map((c) => c.valorCentavos);
  const min = Math.min(...precos);
  const max = Math.max(...precos);
  const dists = cards.map((c) => c.distanciaKm ?? 0);
  const maxD = Math.max(...dists, 1);

  const pontuado = cards.map((c) => {
    const preco = max === min ? 1 : 1 - (c.valorCentavos - min) / (max - min);
    const nota = c.nota == null ? 0.7 : c.nota / 5;
    const perto = 1 - Math.min(c.distanciaKm ?? 0, maxD) / maxD;
    const exp = Math.min((c.servicos || 0) / 50, 1);
    return { ...c, pontos: Number((preco * 0.35 + nota * 0.35 + perto * 0.15 + exp * 0.15).toFixed(4)) };
  });

  return pontuado.sort((a, b) => b.pontos - a.pontos).slice(0, limite);
}

/**
 * A escolha do cliente merece um aviso? Só quando existe alternativa concreta e
 * melhor — aviso genérico vira ruído e o cliente para de ler.
 *
 * Importante: isto INFORMA, não bloqueia. Se o risco fosse alto a ponto de não
 * dever ser contratado, o prestador deveria estar suspenso, não "acompanhado de
 * um aviso".
 */
export function segundaSugestao(escolhido, todos = [], limite = NOTA_LIMITE) {
  if (!escolhido) { return null; }
  // Quem é novo não leva aviso: não há histórico ruim, há ausência de histórico.
  if (escolhido.nota == null || escolhido.nota >= limite) { return null; }

  const melhores = todos
    .filter((c) => c.id !== escolhido.id && c.nota != null && c.nota > escolhido.nota)
    .sort((a, b) => (b.nota - a.nota) || (a.valorCentavos - b.valorCentavos));

  const alt = melhores[0];
  if (!alt) { return null; }

  const dif = alt.valorCentavos - escolhido.valorCentavos;
  return {
    escolhido: { nome: escolhido.nome, nota: escolhido.nota, servicos: escolhido.servicos },
    alternativa: { id: alt.id, nome: alt.nome, nota: alt.nota, servicos: alt.servicos, valorCentavos: alt.valorCentavos },
    diferencaCentavos: dif,
    // A frase é neutra de propósito: informa sem acusar quem foi escolhido.
    texto: dif > 0
      ? `Por ${(dif / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} a mais, ${alt.nome} tem nota ${alt.nota} e ${alt.servicos} serviços concluídos.`
      : `${alt.nome} tem nota ${alt.nota} e ${alt.servicos} serviços concluídos, pelo mesmo valor ou menos.`,
  };
}

/** Cliente escolheu: abre a janela de aceite do prestador. */
export function selecionar(proposta, agora = Date.now(), segundos = ACEITE_SEG) {
  if (!proposta) { return { proposta: null, erro: 'proposta não encontrada' }; }
  if (!valida(proposta, agora)) { return { proposta: null, erro: 'esta proposta não está mais válida' }; }
  return {
    proposta: {
      ...proposta,
      status: 'AGUARDANDO_ACEITE',
      selecionadaEm: new Date(agora).toISOString(),
      aceiteAte: new Date(agora + segundos * 1000).toISOString(),
    },
    erro: null,
  };
}

/** Quanto falta da janela, em segundos. Zero quando acabou. */
export function segundosRestantes(proposta, agora = Date.now()) {
  if (!proposta?.aceiteAte) { return null; }
  return Math.max(0, Math.ceil((new Date(proposta.aceiteAte).getTime() - agora) / 1000));
}

export function expirouAceite(proposta, agora = Date.now()) {
  return proposta?.status === 'AGUARDANDO_ACEITE' && segundosRestantes(proposta, agora) === 0;
}

/** Prestador confirma dentro da janela. */
export function aceitar(proposta, agora = Date.now()) {
  if (!proposta) { return { proposta: null, erro: 'proposta não encontrada' }; }
  if (proposta.status !== 'AGUARDANDO_ACEITE') { return { proposta: null, erro: 'esta proposta não está aguardando aceite' }; }
  if (expirouAceite(proposta, agora)) {
    return { proposta: { ...proposta, status: 'EXPIRADA_ACEITE' }, erro: 'o prazo de confirmação acabou' };
  }
  return { proposta: { ...proposta, status: 'ACEITA', aceitaEm: new Date(agora).toISOString() }, erro: null };
}

/**
 * Janela estourada. Devolve também a PRÓXIMA melhor — o cliente não recomeça.
 */
export function expirar(proposta, outras = [], agora = Date.now()) {
  const expirada = { ...proposta, status: 'EXPIRADA_ACEITE', expiradaEm: new Date(agora).toISOString() };
  const proxima = ranquear(outras.filter((c) => c.id !== proposta.id && c.status === 'ENVIADA'), 1)[0] || null;
  return { proposta: expirada, proxima };
}
