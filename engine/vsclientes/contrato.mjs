/**
 * O contrato de prestação — montado a partir do cadastro, nunca digitado à mão.
 *
 * Função PURA: recebe cliente, contratada e preço; devolve HTML. O PDF é esse
 * HTML impresso pelo Chrome (ver index.mjs). Tudo que o cliente vai pagar e
 * receber está NESTE texto: produto, valor, ciclo, operadores, campanhas,
 * auditor, bot de funil, banda. Se algum número mudar, nasce outra versão do
 * contrato — a versão assinada fica como estava.
 *
 * O texto é um MODELO de partida. Não é parecer jurídico: a última cláusula de
 * cada contrato gerado não diz isso ao cliente, mas a tela diz ao dono.
 */
import { brl, formatarDocumento, formatarWhatsapp, NOME_REDE, oferta } from './ofertas.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const lim = (v, suf = '') => (v == null ? 'ilimitado' : `${v}${suf}`);
const simNao = (v) => (v ? 'Incluído' : 'Não incluído');

/** Dados da CONTRATADA. Vêm do cartão CNPJ; a tela permite corrigir. */
export const CONTRATADA_PADRAO = Object.freeze({
  nomeFantasia: 'Veloso Solution',
  razaoSocial: 'FABIANO LUCIO VELOSO',
  cnpj: '53759232000194',
  endereco: 'Rua Teodoro Sampaio, 2763, Bloco A6 Apto 62, Pinheiros, São Paulo/SP, CEP 05405-250',
  email: 'velosobil@gmail.com',
  foro: 'São Paulo/SP',
});

export function montarContrato({ cliente, contratada = CONTRATADA_PADRAO, preco, numero, emitidoEm = new Date().toISOString() }) {
  const l = cliente.liberacoes;
  const redes = (l.redes || []).map((r) => NOME_REDE[r] || r).join(' e ') || 'Nenhuma';
  /* Qualquer ciclo com mais de um mês é pago de uma vez e tem fidelidade. */
  const anual = preco.meses > 1;
  const periodo = { 1: '1 (um) mês', 6: '6 (seis) meses', 12: '12 (doze) meses' }[preco.meses] || `${preco.meses} meses`;
  const produtos = preco.itens.map((i) => {
    const o = oferta(i.code);
    return `<tr><td><b>${esc(o?.nome || i.nome)}</b><br><small>${esc(o?.descricao || '')}</small></td>
      <td class="num">${brl(i.mensal)}/mês${anual && i.mensalCheio !== i.mensal ? `<br><small>(mensal avulso: ${brl(i.mensalCheio)})</small>` : ''}</td></tr>`;
  }).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Contrato ${esc(numero)} — ${esc(cliente.nome)}</title>
<style>
  @page { size: A4; margin: 22mm 20mm 20mm; }
  body { font-family: 'DejaVu Serif', Georgia, serif; font-size: 10.5pt; line-height: 1.5; color: #111; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 4px; letter-spacing: .02em; }
  .sub { text-align: center; font-size: 9pt; color: #444; margin-bottom: 18px; }
  h2 { font-size: 10.5pt; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .03em; }
  p { margin: 0 0 7px; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 10pt; }
  td, th { border: 1px solid #999; padding: 5px 8px; vertical-align: top; text-align: left; }
  th { background: #eee; }
  .num { text-align: right; white-space: nowrap; }
  .total td { font-weight: bold; background: #f4f4f4; }
  .ass { margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
  .ass div { border-top: 1px solid #111; padding-top: 6px; font-size: 9.5pt; text-align: center; }
  .rodape { margin-top: 22px; font-size: 8.5pt; color: #555; border-top: 1px solid #ccc; padding-top: 8px; }
</style></head><body>

<h1>CONTRATO DE LICENÇA DE USO E PRESTAÇÃO DE SERVIÇOS — BOLSO CHEIO</h1>
<div class="sub">Contrato nº ${esc(numero)} · emitido em ${dataBR(emitidoEm)}</div>

<h2>1. Partes</h2>
<p><b>CONTRATADA:</b> ${esc(contratada.razaoSocial)}, nome fantasia <b>${esc(contratada.nomeFantasia)}</b>,
inscrita no CNPJ sob o nº ${esc(formatarDocumento(contratada.cnpj))}, com sede em ${esc(contratada.endereco)},
e-mail ${esc(contratada.email)}.</p>
<p><b>CONTRATANTE:</b> ${esc(cliente.nome)}, inscrito(a) no ${esc(cliente.tipoDocumento)} sob o nº
${esc(formatarDocumento(cliente.documento))}${cliente.endereco ? `, com endereço em ${esc(cliente.endereco)}` : ''}${cliente.cidadeUf ? ` — ${esc(cliente.cidadeUf)}` : ''},
WhatsApp ${esc(formatarWhatsapp(cliente.whatsapp))}${cliente.email ? `, e-mail ${esc(cliente.email)}` : ''}${cliente.responsavel ? `, neste ato representado(a) por ${esc(cliente.responsavel)}` : ''}.</p>

<h2>2. Objeto</h2>
<p>Licença de uso, não exclusiva e intransferível, da plataforma <b>Bolso Cheio</b>, com os produtos abaixo,
nos limites da cláusula 3:</p>
<table><tr><th>Produto</th><th class="num">Valor</th></tr>${produtos}</table>

<h2>3. O que está liberado</h2>
<table>
  <tr><th>Item</th><th>Liberado</th></tr>
  <tr><td>Operadores (pessoas atendendo no WhatsApp)</td><td>${lim(l.operadores)}</td></tr>
  <tr><td>Campanhas por mês</td><td>${lim(l.campanhasMes)}</td></tr>
  <tr><td>Auditor (conferência do que o bot e as campanhas fizeram)</td><td>${simNao(l.auditor)}</td></tr>
  <tr><td>Bot para funil de vendas</td><td>${simNao(l.botFunil)}</td></tr>
  <tr><td>Redes sociais conectadas</td><td>${esc(redes)}</td></tr>
  <tr><td>Banda total de consumo mensal (envio e armazenamento de mídia, mensagens e publicações)</td><td>${lim(l.bandaGbMes, ' GB/mês')}</td></tr>
</table>
<p>3.1. A banda é contada por ciclo mensal e não acumula para o mês seguinte. Atingido o limite, novos envios de
mídia e publicações ficam pausados até o início do ciclo seguinte ou até a contratação de pacote adicional,
sem perda de dados já armazenados.</p>
<p>3.2. Ampliar qualquer item deste quadro é feito por novo contrato ou aditivo, com o valor correspondente.</p>

<h2>4. Valor e pagamento</h2>
<table>
  <tr><td>Ciclo de cobrança</td><td>${esc(preco.nomeCiclo)}${anual ? ` (${preco.meses} meses pagos de uma vez)` : ''}</td></tr>
  <tr><td>Valor mensal</td><td>${brl(preco.mensal)}</td></tr>
  <tr class="total"><td>Valor por ciclo</td><td>${brl(preco.total)}${anual && preco.economia ? ` — economia de ${brl(preco.economia)} em relação ao mensal` : ''}</td></tr>
</table>
<p>4.1. O pagamento é feito por <b>Pix ou cartão</b>, pelo link de cobrança enviado ao WhatsApp da
CONTRATANTE informado na cláusula 1, processado pelo Mercado Pago.</p>
<p>4.2. Confirmado o pagamento, a CONTRATADA envia ao mesmo WhatsApp a <b>chave de ativação</b>, pessoal e
intransferível, válida pelo ciclo pago. A renovação segue o mesmo caminho: nova cobrança, nova validade.</p>
<p>4.3. Sem pagamento da renovação até o vencimento, o acesso é suspenso. Os dados da CONTRATANTE ficam
guardados por 30 dias após a suspensão e podem ser exportados nesse prazo.</p>

<h2>5. Vigência e cancelamento</h2>
<p>5.1. Este contrato vigora a partir da confirmação do primeiro pagamento, por ${periodo},
renovando-se pelo mesmo período a cada pagamento.</p>
<p>5.2. A CONTRATANTE pode desistir em até 7 (sete) dias da contratação, com devolução integral do valor pago
(art. 49 do Código de Defesa do Consumidor).</p>
<p>5.3. ${anual
    ? `No ciclo ${esc(preco.nomeCiclo.toLowerCase())}, o cancelamento após o prazo de arrependimento encerra a renovação; o período já pago segue liberado até o fim.`
    : 'No ciclo mensal, o cancelamento pode ser feito a qualquer tempo, sem multa, e vale a partir do ciclo seguinte.'}</p>

<h2>6. Obrigações</h2>
<p>6.1. A CONTRATADA mantém a plataforma disponível, presta suporte pelo WhatsApp em horário comercial e
comunica com antecedência qualquer manutenção programada.</p>
<p>6.2. A CONTRATANTE usa a plataforma dentro da lei e das regras das redes e do WhatsApp, não envia mensagem a
quem não autorizou o contato e é responsável pelo conteúdo que publica.</p>

<h2>7. Dados pessoais (LGPD)</h2>
<p>A CONTRATADA trata os dados de clientes da CONTRATANTE somente para executar este contrato, como operadora,
nos termos da Lei nº 13.709/2018. Os dados não são vendidos nem compartilhados fora do necessário ao serviço.</p>

<h2>8. Assinatura e foro</h2>
<p>8.1. As partes assinam este contrato eletronicamente pelo <b>gov.br</b> (Assinador do ITI), com assinatura
eletrônica avançada nos termos da Lei nº 14.063/2020, que reconhecem como válida.</p>
<p>8.2. Fica eleito o foro de ${esc(contratada.foro)} para dirimir qualquer questão deste contrato.</p>

<div class="ass">
  <div>${esc(contratada.razaoSocial)}<br>CONTRATADA — ${esc(formatarDocumento(contratada.cnpj))}</div>
  <div>${esc(cliente.nome)}<br>CONTRATANTE — ${esc(formatarDocumento(cliente.documento))}</div>
</div>

<div class="rodape">Contrato nº ${esc(numero)}. Assine em assinador.iti.br com a sua conta gov.br e devolva o
PDF assinado. A autenticidade da assinatura pode ser conferida em validar.iti.gov.br.</div>
</body></html>`;
}
