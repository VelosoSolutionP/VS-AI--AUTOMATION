/**
 * VSpainel — financeiro. Junta o dinheiro que a suíte já conhece, em um lugar só.
 *
 * A tela dizia "Sem fonte financeira". Não é mais verdade: existem TRÊS fontes reais —
 * leads ganhos no CRM, ganhos de conteúdo do VSinfluence e o valor parado no estoque.
 * O que continua não existindo é conciliação bancária (Stripe), e isso a tela diz com
 * todas as letras em vez de somar como se fosse caixa confirmado.
 *
 * Distinção que não pode se perder: RECEITA FECHADA é lead com status "ganho";
 * PIPELINE é o que ainda está aberto. Somar os dois num "total" faria o painel
 * prometer dinheiro que ninguém pagou.
 *
 * Dinheiro aqui é CENTAVOS, como no resto da suíte. O `valor` do lead é digitado em
 * reais pela tela do CRM, então é convertido na entrada — não somado cru.
 */
import { paraCentavos, formatarBRL } from '../vsinfluence/ganhos.mjs';

const centavosDoLead = (l) => (l.valor == null ? null : paraCentavos(l.valor));

function soma(valores) {
  const validos = valores.filter((v) => v != null);
  return validos.length ? validos.reduce((a, b) => a + b, 0) : null;
}

/**
 * Consolida. Cada fonte é declarada com o que ela é e o que ela NÃO é — o painel
 * precisa poder dizer de onde veio cada número.
 *
 * @param {object} dados
 * @param {object[]} dados.leads      leads do VScrm
 * @param {object[]} [dados.ganhos]   lançamentos do VSinfluence (já em centavos)
 * @param {object} [dados.estoque]    painel do VSestoque
 */
export function consolidar(dados = {}) {
  const leads = dados.leads || [];

  const ganhos = leads.filter((l) => l.status === 'ganho');
  const perdidos = leads.filter((l) => l.status === 'perdido');
  const abertos = leads.filter((l) => l.status === 'aberto');

  const receitaFechada = soma(ganhos.map(centavosDoLead));
  const pipeline = soma(abertos.map(centavosDoLead));
  const perdido = soma(perdidos.map(centavosDoLead));

  const conteudo = soma((dados.ganhos || []).map((g) => g.centavos ?? null));
  const estoqueParado = dados.estoque?.valorCentavos ?? null;

  // Ticket médio só existe com lead ganho E com valor. Dividir por zero ou por
  // "quantos ganhamos" ignorando os sem valor daria um número bonito e falso.
  const ganhosComValor = ganhos.filter((l) => l.valor != null);
  const ticketMedio = ganhosComValor.length
    ? Math.round(soma(ganhosComValor.map(centavosDoLead)) / ganhosComValor.length)
    : null;

  const fechados = ganhos.length + perdidos.length;

  return {
    fontes: [
      {
        id: 'crm', nome: 'Vendas fechadas (CRM)',
        centavos: receitaFechada,
        detalhe: `${ganhos.length} lead(s) ganho(s)` + (ganhos.length !== ganhosComValor.length ? `, ${ganhos.length - ganhosComValor.length} sem valor informado` : ''),
        confirmado: false,
        ressalva: 'marcado como ganho no CRM — não é pagamento conciliado',
      },
      {
        id: 'conteudo', nome: 'Ganhos de conteúdo (VSinfluence)',
        centavos: conteudo,
        detalhe: `${(dados.ganhos || []).length} lançamento(s)`,
        confirmado: false,
        ressalva: 'lançado à mão no VSinfluence',
      },
    ],
    receitaFechadaCentavos: receitaFechada,
    receitaFechada: formatarBRL(receitaFechada),
    pipelineCentavos: pipeline,
    pipeline: formatarBRL(pipeline),
    perdidoCentavos: perdido,
    perdido: formatarBRL(perdido),
    conteudoCentavos: conteudo,
    conteudo: formatarBRL(conteudo),
    estoqueParadoCentavos: estoqueParado,
    estoqueParado: formatarBRL(estoqueParado),
    ticketMedioCentavos: ticketMedio,
    ticketMedio: formatarBRL(ticketMedio),
    conversao: fechados ? Number((ganhos.length / fechados).toFixed(4)) : null,
    // Entra tudo que é receita reconhecida; estoque NÃO entra — é ativo, não receita.
    totalReconhecidoCentavos: soma([receitaFechada, conteudo]),
    totalReconhecido: formatarBRL(soma([receitaFechada, conteudo])),
    lacunas: lacunas(leads, dados),
  };
}

/**
 * O que o número NÃO está contando. Existe pra tela nunca passar a impressão de
 * fechamento contábil — ela é um consolidado operacional.
 */
export function lacunas(leads = [], dados = {}) {
  const out = [];
  const ganhosSemValor = leads.filter((l) => l.status === 'ganho' && l.valor == null).length;
  if (ganhosSemValor) {
    out.push(`${ganhosSemValor} lead(s) ganho(s) sem valor informado — a receita fechada está subestimada`);
  }
  const abertosSemValor = leads.filter((l) => l.status === 'aberto' && l.valor == null).length;
  if (abertosSemValor) {
    out.push(`${abertosSemValor} lead(s) aberto(s) sem valor — o pipeline está subestimado`);
  }
  if (!dados.stripeConciliado) {
    out.push('sem conciliação bancária: nada aqui foi confirmado contra o Stripe ou extrato');
  }
  if (!(dados.ganhos || []).length) {
    out.push('nenhum ganho de conteúdo lançado no VSinfluence');
  }
  return out;
}
