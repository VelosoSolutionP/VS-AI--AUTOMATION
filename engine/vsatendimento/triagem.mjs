/**
 * VSatendimento — o filtro da Micaela.
 *
 * A Micaela tenta resolver. Quando NAO resolve, ela nao enrola o cliente e
 * nao empurra qualquer coisa pro especialista: ela decide PARA QUAL SETOR o
 * atendimento vai, e o especialista so recebe quem esta realmente em dia e
 * dentro do contrato. Esse filtro e o que impede o especialista de virar
 * recepcionista.
 *
 * A ordem das regras e deliberada — a primeira que bate decide:
 *
 *   1. pendencia financeira -> financeiro, e o atendimento nasce BLOQUEADO
 *   2. sem contrato         -> comercial
 *   3. contrato vencido     -> comercial
 *   4. servico fora do contrato -> comercial
 *   5. cota do servico estourada -> comercial
 *   6. horas do plano A no fim   -> comercial
 *   7. nada disso -> suporte, na fila do especialista
 *
 * Repare que NENHUM caminho termina em "nao atende". Mesmo fora do contrato o
 * cliente ganha uma janela com gente de verdade — a ideia e dizer na cara o
 * que esta e o que nao esta incluso e oferecer o comercial, nao sumir.
 */

import { cobre, cotaRestante, minutosRestantes, vigente } from './contratos.mjs';

/** Encaminhamento pronto pra virar atendimento. */
const paraSetor = (setor, motivo, mensagem, status = 'aguardando') =>
  ({ setor, status, motivo, mensagem });

/**
 * @param pedido  {cliente, servico?, assunto?}
 * @param contexto {contrato, pendencias?, cotaUsada?, minutosUsados?, quando?}
 */
export function triar(pedido = {}, contexto = {}) {
  const cliente = String(pedido.cliente || '').replace(/\D/g, '');
  if (!cliente) { return { erro: 'informe o telefone do cliente' }; }

  const { contrato = null, pendencias = [], cotaUsada = 0, minutosUsados = 0 } = contexto;
  const quando = contexto.quando || new Date().toISOString();
  const servico = pedido.servico ? String(pedido.servico).trim() : null;

  /* 1. Dinheiro primeiro. E o unico bloqueio que existe: o atendimento fica
     parado no financeiro ate a cobranca resolver, e so entao vale pra suporte. */
  if (pendencias.length) {
    return paraSetor(
      'financeiro',
      `${pendencias.length} pendencia(s) em aberto`,
      'Encontrei uma pendencia financeira na sua conta. Vou te passar para o setor responsavel resolver isso — assim que estiver em dia, seguimos com o atendimento.',
      'bloqueado',
    );
  }

  if (!contrato) {
    return paraSetor('comercial', 'cliente sem contrato cadastrado',
      'Nao localizei um contrato ativo no seu cadastro. Vou te passar para o comercial dar uma olhada nisso com voce.');
  }

  if (!vigente(contrato, quando)) {
    return paraSetor('comercial', `contrato vencido em ${contrato.vigenteAte}`,
      'Seu contrato consta como vencido aqui. Vou te passar para o comercial regularizar.');
  }

  /* 4-6. Daqui pra baixo o cliente esta em dia — o que falta e direito ao que
     ele pediu. O texto fala do CONTRATO, nunca do cliente: "nao esta no seu
     plano" e diferente de "voce nao pode". */
  if (servico && !cobre(contrato, servico)) {
    return paraSetor('comercial', `"${servico}" nao esta no contrato`,
      `O seu plano hoje nao inclui ${servico}. Posso te passar para o comercial ver essa possibilidade?`);
  }

  const restaCota = cotaRestante(contrato, servico, cotaUsada);
  if (servico && restaCota === 0) {
    return paraSetor('comercial', `cota de "${servico}" esgotada no mes`,
      `A sua cota de ${servico} deste mes ja foi usada. Posso te passar para o comercial ver uma ampliacao?`);
  }

  const restaMin = minutosRestantes(contrato, minutosUsados);
  if (restaMin === 0) {
    return paraSetor('comercial', 'horas de suporte do mes esgotadas',
      'As horas de suporte do seu plano deste mes acabaram. Posso te passar para o comercial ver como ampliar?');
  }

  return paraSetor('suporte', 'em dia e dentro do contrato',
    'Nao consegui resolver por aqui. Ja estou te colocando na fila dos especialistas com tudo que voce me contou.');
}
