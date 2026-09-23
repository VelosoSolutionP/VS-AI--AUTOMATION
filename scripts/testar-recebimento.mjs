/**
 * Prova de recebimento: uma cobrança de R$ 1,00 na conta de PRODUÇÃO.
 *
 * Existe porque "a integração está pronta" só vale depois que um real entra na
 * conta. Tudo antes disso é link bonito.
 *
 * Roda à parte de propósito: mexer com dinheiro de verdade é decisão de quem é
 * dono da conta, não efeito colateral de um teste automático.
 *
 *   set -a; . ~/.qa-gate/console/painel.env; set +a
 *   node scripts/testar-recebimento.mjs
 *
 * Nada é cobrado de ninguém enquanto o QR não for pago. Para desistir, é só não
 * pagar: cobrança Pix não paga não gera lançamento.
 */
import { writeFileSync } from 'node:fs';
import { conferirCredencial, criarGateway } from '../engine/vspagamentos/mercadopago.mjs';

const token = process.env.MP_ACCESS_TOKEN;
const CENTAVOS = Number(process.env.VALOR_CENTAVOS || 100);

if (!token) {
  console.error('falta MP_ACCESS_TOKEN no ambiente — carregue o painel.env antes');
  process.exit(1);
}

/* Confere ANTES de cobrar. Descobrir que a chave era de teste depois de
   esperar o dinheiro cair é o pior jeito de descobrir. */
const quem = await conferirCredencial(token);
if (!quem.ok) {
  console.error(`a chave de produção não passou: ${quem.motivo}`);
  process.exit(1);
}
console.log(`conta ${quem.conta} (${quem.site}) — ${quem.ambiente.toUpperCase()}`);
if (quem.ehTeste) {
  console.error('ESTA CHAVE É DE TESTE. Ela não cobra ninguém — não adianta pagar o QR.');
  process.exit(1);
}

const g = criarGateway({ apiKey: token, ambiente: 'producao' });
const r = await g.criarCobranca({
  valorCentavos: CENTAVOS,
  metodo: 'PIX',
  descricao: 'Veloso Solution — teste de recebimento',
  referencia: `TESTE-PIX-${Date.now()}`,
  email: process.env.MP_EMAIL_TESTE || undefined,
  webhookUrl: process.env.VS_URL_WEBHOOK_PAGAMENTO || undefined,
});

if (!r.ok) {
  console.error(`não consegui criar a cobrança: ${r.motivo}`);
  process.exit(1);
}

const p = r.pagamento;
console.log(`\nid     : ${p.id}`);
console.log(`valor  : R$ ${(p.valorCentavos / 100).toFixed(2)}`);
console.log(`caminho: ${r.viaCheckout ? 'Checkout Pro (o QR nasce na página do MP)' : 'PIX DIRETO — QR gerado aqui'}`);

if (p.pix?.imagemBase64) {
  const arquivo = 'pix-teste.png';
  writeFileSync(arquivo, Buffer.from(p.pix.imagemBase64, 'base64'));
  console.log(`QR     : ${arquivo}  (abra e pague pelo celular)`);
}
if (p.pix?.payload) {
  console.log(`\ncopia-e-cola:\n${p.pix.payload}`);
}
if (p.linkPagamento) { console.log(`\nlink   : ${p.linkPagamento}`); }

if (!p.pix?.payload && !p.linkPagamento) {
  console.error('\na cobrança nasceu sem QR e sem link — não há como pagar. Isto é falha.');
  process.exit(1);
}
console.log(`\nDepois de pagar, confira se o aviso chegou:  tail -30 .painel.log | grep mercadopago`);
