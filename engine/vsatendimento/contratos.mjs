/**
 * VSatendimento — o contrato do cliente.
 *
 * O contrato e a UNICA fonte da verdade sobre o que esse cliente pode pedir.
 * Ele entra ESTRUTURADO de proposito: decidir "acabou a cota" interpretando o
 * paragrafo de um PDF falha em silencio, e falha do lado errado — liberando
 * quem nao tinha direito ou barrando quem tinha. O texto do contrato viaja
 * junto em `documento`, mas so para gente ler; nenhuma decisao sai dele.
 *
 * Dois planos, como combinado:
 *   plano A -> suporte com teto de horas no mes (debita a cada atendimento)
 *   plano B -> suporte livre (nao debita nada, nao ha o que estourar)
 */

export const SETORES = ['suporte', 'comercial', 'financeiro'];

/** Mes de referencia de um instante ISO — a janela em que cota e horas contam. */
export const competencia = (quando = new Date().toISOString()) => quando.slice(0, 7);

/**
 * Valida e normaliza o contrato. Devolve {erro} em vez de lancar: o painel
 * mostra o motivo no campo, e um contrato torto nunca derruba o atendimento.
 */
export function normalizar(dados = {}) {
  const cliente = String(dados.cliente || '').replace(/\D/g, '');
  if (!cliente) { return { erro: 'informe o telefone do cliente' }; }

  const plano = String(dados.plano || '').toUpperCase();
  if (plano !== 'A' && plano !== 'B') { return { erro: 'plano deve ser A (horas) ou B (livre)' }; }

  const horasMes = plano === 'A' ? Number(dados.horasMes) : null;
  if (plano === 'A' && (!Number.isFinite(horasMes) || horasMes <= 0)) {
    return { erro: 'plano A precisa de horasMes maior que zero' };
  }

  /* Cotas por servico: {campanha: 3} = tres por mes. Servico ausente do mapa
     e servico sem teto; servico ausente de `inclusos` nao e vendido a ele. */
  const cotas = {};
  for (const [servico, limite] of Object.entries(dados.cotas || {})) {
    const n = Number(limite);
    if (!Number.isFinite(n) || n < 0) { return { erro: `cota invalida para "${servico}"` }; }
    cotas[servico] = n;
  }

  const inclusos = [...new Set((dados.inclusos || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!inclusos.length) { return { erro: 'diga ao menos um servico incluso no contrato' }; }

  return {
    contrato: {
      cliente,
      nome: String(dados.nome || '').trim() || null,
      plano,
      horasMes,
      cotas,
      inclusos,
      documento: String(dados.documento || '').trim() || null,
      vigenteAte: dados.vigenteAte || null,
      atualizadoEm: new Date().toISOString(),
    },
  };
}

/** O contrato cobre esse servico? Servico nao pedido conta como coberto. */
export const cobre = (contrato, servico) =>
  !servico || Boolean(contrato?.inclusos?.includes(servico));

/** Contrato vencido tambem e motivo de nao atender direto no especialista. */
export function vigente(contrato, quando = new Date().toISOString()) {
  if (!contrato?.vigenteAte) { return true; }
  return String(contrato.vigenteAte) >= quando.slice(0, 10);
}

/**
 * Quanto sobra da cota do servico neste mes. `null` = sem teto.
 * `consumo` e o que ja foi usado na competencia, contado pelo chamador.
 */
export function cotaRestante(contrato, servico, usados = 0) {
  const limite = contrato?.cotas?.[servico];
  if (limite == null) { return null; }
  return Math.max(0, limite - Number(usados || 0));
}

/**
 * Quanto sobra de suporte no mes, em minutos. `null` = livre (plano B).
 *
 * Aqui mora a unica contagem de tempo do sistema, e ela existe por causa do
 * contrato, nao por causa de SLA: ninguem cronometra a pessoa atendendo, o
 * sistema so soma o que ja foi gasto e compara com o que foi vendido.
 */
export function minutosRestantes(contrato, minutosUsados = 0) {
  if (!contrato || contrato.plano !== 'A') { return null; }
  return Math.max(0, contrato.horasMes * 60 - Number(minutosUsados || 0));
}
