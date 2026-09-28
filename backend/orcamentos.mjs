/**
 * O que o orçamento precisa do mundo real: mandar pela conversa (texto + PDF),
 * mover o funil, avisar quando o cliente responde e gerar o Pix do aprovado.
 *
 * A regra de negócio mora em engine/vsorcamentos; aqui só se escolhem as peças
 * de verdade (canal, impressora, gateway) — as mesmas do atendimento, pra que
 * orçamento e pedido do bot contem igual em Resultados e no funil.
 */
import * as orc from '../engine/vsorcamentos/index.mjs';
import * as crm from '../engine/vscrm/index.mjs';
import * as proto from '../engine/vsprotocolo/index.mjs';
import * as pagamentos from '../engine/vspagamentos/index.mjs';
import * as resultados from '../engine/vsresultados/index.mjs';
import * as vigiaPix from './vigia-pix.mjs';
import * as canais from './canais.mjs';
import { imprimirPdf } from './clientes-servicos.mjs';

export const loja = () => process.env.VITRINE_NOME || 'Veloso Solution';
const origem = () => process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
export const urlPublica = (o) => `${origem()}/orcamento/${o.token}`;
const canalDe = (o) => (o.cliente.canal === 'telegram' ? 'telegram' : 'whatsapp-web');
const leadDe = (tel) => crm.listar().find((l) => l.telefone === String(tel || '').replace(/\D/g, ''));

/** Anota na trilha do lead — é por ela que o vendedor vê, na conversa, o que aconteceu. */
function anotar(o, texto, direcao = 'saida', autor = 'atendente') {
  try {
    const lead = leadDe(o.cliente.telefone);
    if (lead) { crm.interagir(lead.id, { canal: o.cliente.canal, direcao, texto, autor }); }
  } catch (e) { console.error(`[orcamento] nao anotei ${o.numero} no lead: ${e.message}`); }
}

/**
 * Envia (ou reenvia) pela MESMA conversa. Ordem: marca enviado (a validade e o
 * texto dependem disso) → texto com o link → PDF. Texto que não sai desfaz o
 * envio; PDF que não sai não desfaz nada — o link já tem o orçamento inteiro.
 */
export async function enviar(id, { por = null, deps = {} } = {}) {
  const env = deps.enviar || canais.enviar;
  const arquivo = deps.enviarArquivo || canais.enviarArquivo;
  const pdf = deps.imprimirPdf || imprimirPdf;
  const m = orc.marcarEnviado(id, { por });
  if (!m.ok) { return m; }
  const o = m.orcamento;
  const para = proto.enderecoDe(o.cliente.telefone);
  const t = await env({ canal: canalDe(o), para, texto: orc.mensagem(o, urlPublica(o), { loja: loja() }) });
  if (!t?.ok) {
    if (!m.reenvio) { orc.desfazerEnvio(id); }
    return { ok: false, motivo: `a mensagem não saiu: ${t?.erro || 'o canal não confirmou'}` };
  }
  let pdfOk = false; let pdfErro = null;
  try {
    const buf = await pdf(orc.html(o, { loja: loja(), publico: false }));
    const a = await arquivo({ canal: canalDe(o), para, nome: `${o.numero}.pdf`, legenda: `Orçamento ${o.numero}`,
      dataUri: `data:application/pdf;base64,${Buffer.from(buf).toString('base64')}` });
    pdfOk = !!a?.ok; if (!a?.ok) { pdfErro = a?.erro || 'o canal não confirmou'; }
  } catch (e) { pdfErro = e.message; }
  if (pdfErro) { console.error(`[orcamento] ${o.numero}: o PDF nao foi (${pdfErro}) — o link foi`); }
  anotar(o, `Orçamento ${o.numero} ${m.reenvio ? 'reenviado' : 'enviado'} — ${orc.emReais(o.totalCentavos)}`);
  /* Funil: orçamento mandado é proposta, com o valor. Mesmo evento da cobrança do bot. */
  if (!m.reenvio) {
    try { crm.eventoDeVenda(o.cliente.telefone, 'cobranca', { referencia: o.numero, valorCentavos: o.totalCentavos }); } catch (e) { console.error(`[orcamento] funil nao andou em ${o.numero}: ${e.message}`); }
  }
  console.log(`[orcamento] ${o.numero} ${m.reenvio ? 'reenviado' : 'enviado'} pra ${o.cliente.nome} (${o.cliente.canal}) — ${orc.emReais(o.totalCentavos)}${pdfOk ? ' + PDF' : ''}`);
  return { ok: true, orcamento: o, pdf: pdfOk, pdfErro };
}

/** O cliente respondeu pelo link: o vendedor fica sabendo pela conversa, e o cliente recebe a confirmação. */
export async function aoResponder(o, { deps = {} } = {}) {
  const env = deps.enviar || canais.enviar;
  const aprovou = o.situacao === 'aprovado';
  anotar(o, aprovou ? `✅ Cliente APROVOU o orçamento ${o.numero} (${orc.emReais(o.totalCentavos)})`
    : `Cliente recusou o orçamento ${o.numero}${o.motivoRecusa ? ` — "${o.motivoRecusa}"` : ''}`, 'entrada', 'cliente');
  const texto = aprovou
    ? `Recebemos a aprovação do orçamento *${o.numero}* (${orc.emReais(o.totalCentavos)}). Obrigado! A equipe já vai te chamar pra combinar o pagamento e a entrega. 🙌`
    : `Tudo bem, anotamos que o orçamento *${o.numero}* não segue. Se quiser ajustar alguma coisa, é só responder aqui.`;
  try { await env({ canal: canalDe(o), para: proto.enderecoDe(o.cliente.telefone), texto }); } catch (e) { console.error(`[orcamento] nao confirmei ${o.numero} pro cliente: ${e.message}`); }
  console.log(`[orcamento] ${o.numero} ${aprovou ? 'APROVADO' : 'recusado'} pelo cliente`);
}

/**
 * Aprovado → Pix na conversa. Mesmo caminho do pedido do bot: cobrança no
 * gateway, pedido em Resultados (é o que atribui a receita ao canal), vigia do
 * Pix (pagou → "pagamento recebido" e o funil fecha como Ganho).
 */
export async function cobrar(id, { por = null, deps = {} } = {}) {
  const env = deps.enviar || canais.enviar;
  const criar = deps.cobrar || pagamentos.cobrar;
  const o = orc.obter(id);
  if (!o) { return { ok: false, motivo: 'orçamento não encontrado' }; }
  if (o.situacao !== 'aprovado') { return { ok: false, motivo: 'só orçamento aprovado vira cobrança' }; }
  if (o.cobranca) { return { ok: false, motivo: `a cobrança ${o.cobranca.referencia} já foi enviada` }; }
  const c = await criar({ valorCentavos: o.totalCentavos, metodo: 'PIX', descricao: `Orçamento ${o.numero} — ${loja()}`, referencia: o.numero, nome: o.cliente.nome,
    webhookUrl: process.env.VS_URL_WEBHOOK_PAGAMENTO || undefined });
  const pix = c?.pagamento?.pix?.payload; const link = c?.pagamento?.linkPagamento;
  if (!c?.ok || (!pix && !link)) { return { ok: false, motivo: `o gateway não gerou a cobrança: ${c?.motivo || 'motivo não informado'}` }; }
  const para = proto.enderecoDe(o.cliente.telefone);
  const t = await env({ canal: canalDe(o), para, texto: [`Pagamento do orçamento *${o.numero}*`, `Total: ${orc.emReais(c.pagamento.valorCentavos)}`, '',
    pix ? 'Copia e cola no seu banco:' : `Paga por aqui: ${link}`, pix || null, '', 'Assim que o pagamento cair eu te aviso por aqui. 👍'].filter((l) => l !== null).join('\n') });
  if (!t?.ok) { return { ok: false, motivo: `a cobrança foi gerada, mas a mensagem não saiu: ${t?.erro || 'o canal não confirmou'}` }; }
  resultados.registrarPedido({ referencia: o.numero, pagamentoId: c.pagamento.id, telefone: o.cliente.telefone, endereco: para !== o.cliente.telefone ? para : null,
    canal: o.cliente.canal, valorCentavos: c.pagamento.valorCentavos, nome: o.cliente.nome,
    itens: o.itens.map((i) => ({ nome: i.descricao, quantidade: i.quantidade, valorCentavos: i.precoCentavos })) });
  if (pix || c.pagamento.id) {
    vigiaPix.registrar({ pagamentoId: c.pagamento.id, referencia: o.numero, para, de: o.cliente.telefone, mensagens: [t.id].filter(Boolean),
      itens: o.itens.map((i) => ({ nome: i.descricao, quantidade: i.quantidade })), totalCentavos: c.pagamento.valorCentavos });
  }
  const r = orc.marcarCobrado(id, { referencia: o.numero, pagamentoId: c.pagamento.id, por });
  anotar(o, `Pix do orçamento ${o.numero} enviado — ${orc.emReais(c.pagamento.valorCentavos)}`);
  console.log(`[orcamento] ${o.numero}: Pix de ${orc.emReais(c.pagamento.valorCentavos)} enviado`);
  return { ok: true, orcamento: r.orcamento };
}
