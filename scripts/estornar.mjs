/**
 * Devolve o dinheiro de uma cobrança.
 *
 * Existe por causa de um beco do Mercado Pago: o ambiente de teste deles não
 * registra chave Pix e o checkout de sandbox não abre. Testar recebimento de
 * verdade exige produção — então o teste honesto é cobrar um centavo, pagar, e
 * devolver. Fica provado o ciclo inteiro e o saldo volta ao lugar.
 *
 *   node scripts/estornar.mjs <id-do-pagamento>
 *
 * Estorno é irreversível do lado do Mercado Pago. Por isso ele mostra o que vai
 * devolver e exige confirmação — a não ser que você passe --sim.
 */
import { createInterface } from 'node:readline/promises';
import { criarGateway, conferirCredencial } from '../engine/vspagamentos/mercadopago.mjs';

const id = process.argv[2];
const semPerguntar = process.argv.includes('--sim');
const token = process.env.MP_ACCESS_TOKEN;

if (!id || id.startsWith('--')) {
  console.error('uso: node scripts/estornar.mjs <id-do-pagamento> [--sim]');
  process.exit(1);
}
if (!token) {
  console.error('falta MP_ACCESS_TOKEN no ambiente — carregue o painel.env antes');
  process.exit(1);
}

const quem = await conferirCredencial(token);
if (!quem.ok) { console.error(`a chave não passou: ${quem.motivo}`); process.exit(1); }
console.log(`conta ${quem.conta} (${quem.site}) — ${quem.ambiente.toUpperCase()}`);

const g = criarGateway({ apiKey: token, ambiente: 'producao' });

/* Olha ANTES de devolver. Estornar o pagamento errado é o tipo de erro que não
   tem desfazer — e o id é digitado à mão. */
const antes = await g.consultarCobranca(id);
if (!antes.ok) { console.error(`não achei o pagamento ${id}: ${antes.motivo}`); process.exit(1); }
const p = antes.pagamento || {};
console.log(`\npagamento ${id}`);
console.log(`  estado : ${p.estado} (${p.estadoOriginal})`);
console.log(`  valor  : R$ ${((p.valorCentavos || 0) / 100).toFixed(2)}`);
console.log(`  pago em: ${p.pagoEm || '(ainda não pago)'}`);

if (!p.pagoEm) {
  console.error('\neste pagamento ainda não foi pago — não há o que devolver.');
  process.exit(1);
}

if (!semPerguntar) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const resp = (await rl.question('\ndevolver este valor? (digite SIM) ')).trim();
  rl.close();
  if (resp !== 'SIM') { console.log('nada foi devolvido.'); process.exit(0); }
}

const r = await g.estornar(id);
if (!r.ok) { console.error(`\nnão consegui estornar: ${r.motivo}`); process.exit(1); }
console.log('\nestornado. o valor volta para quem pagou.');
