/**
 * VScaixa — abertura e fechamento de caixa, UM por canal (WhatsApp e Telegram
 * não se misturam: canais separados, dono, 27/09).
 *
 * Básico de propósito (dono, 28/09: "faz abertura e fechamento de caixa básico"):
 *  - ABRIR com o troco que está na gaveta;
 *  - durante o dia, SANGRIA (tirou dinheiro) e REFORÇO (pôs dinheiro), sempre
 *    com o motivo;
 *  - FECHAR contando a gaveta: o sistema diz quanto DEVERIA ter e a diferença.
 *
 * Dinheiro esperado na gaveta = troco + reforços − sangrias + o que foi pago
 * na ENTREGA menos a parte que foi na maquininha (quem fecha informa). Pix e
 * cartão pelo link caem no banco, não na gaveta — aparecem no resumo, não na
 * conta da gaveta.
 *
 * Fechado é fechado: o registro não se edita. Errou? Anota na observação do
 * próximo — é assim que caixa de loja funciona e é o que dá pra auditar.
 *
 * Valores sempre em CENTAVOS inteiros. O resumo das vendas vem de fora
 * (vsresultados.vendasEntre) — este módulo não lê pedido nem gateway.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { dentroDaCasa } from '../casa.mjs';

export const CANAIS = ['whatsapp', 'telegram'];
export const MOVIMENTOS = { sangria: 'Sangria (tirou da gaveta)', reforco: 'Reforço (pôs na gaveta)' };
/** Quantos fechamentos o histórico guarda por canal (≈ 1 ano de um por dia). */
export const LIMITE_HISTORICO = 400;

const canalOk = (c) => (CANAIS.includes(c) ? c : null);
const arq = (canal) => (process.env.VSCAIXA_DIR ? join(process.env.VSCAIXA_DIR, `caixa.${canal}.json`) : dentroDaCasa('vscaixa', `caixa.${canal}.json`));
const ler = (canal) => { try { return { aberto: null, fechados: [], ...JSON.parse(readFileSync(arq(canal), 'utf8')) }; } catch { return { aberto: null, fechados: [] }; } };
function gravar(canal, d) {
  mkdirSync(dirname(arq(canal)), { recursive: true, mode: 0o700 });
  writeFileSync(arq(canal), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { chmodSync(arq(canal), 0o600); } catch { /* FS sem modo */ }
  return d;
}
/** Centavos inteiros ≥ 0; aceita número (centavos) ou texto em reais ("1.234,56"). */
export function centavos(v) {
  if (typeof v === 'number') { return Number.isInteger(v) && v >= 0 ? v : null; }
  const t = String(v ?? '').trim().replace(/^R\$\s*/i, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) { return null; }
  const [int, dec = ''] = t.replace(/\./g, '').split(',');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}
const soma = (movs, tipo) => movs.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.valorCentavos, 0);

/** Dinheiro que DEVERIA estar na gaveta agora (sem as entregas, que dependem das vendas). */
const gavetaSemVendas = (cx) => cx.trocoCentavos + soma(cx.movimentos, 'reforco') - soma(cx.movimentos, 'sangria');

/**
 * Estado do caixa do canal. `vendas` (opcional) é o vendasEntre() desde a
 * abertura: com ele sai o esperado completo, com as entregas.
 */
export function estado(canal, { vendas } = {}) {
  const c = canalOk(canal);
  if (!c) { return { ok: false, erro: 'canal desconhecido' }; }
  const d = ler(c);
  const cx = d.aberto;
  const ultimo = d.fechados[d.fechados.length - 1] || null;
  if (!cx) { return { ok: true, canal: c, aberto: null, ultimo }; }
  const entrega = vendas?.naEntregaCentavos || 0;
  return {
    ok: true, canal: c, ultimo,
    aberto: {
      ...cx,
      sangriasCentavos: soma(cx.movimentos, 'sangria'),
      reforcosCentavos: soma(cx.movimentos, 'reforco'),
      naEntregaCentavos: entrega,
      vendidoCentavos: vendas?.vendidoCentavos || 0,
      esperadoCentavos: gavetaSemVendas(cx) + entrega,
    },
  };
}

export function abrir({ canal, troco, quem, agora = new Date() } = {}) {
  const c = canalOk(canal);
  if (!c) { return { ok: false, erro: 'canal desconhecido' }; }
  const t = centavos(troco ?? 0);
  if (t == null) { return { ok: false, erro: 'troco inválido — use um valor como 100 ou 150,50' }; }
  const d = ler(c);
  if (d.aberto) { return { ok: false, erro: `o caixa já está aberto desde ${d.aberto.abertoEm}` }; }
  d.aberto = { id: `cx_${c.slice(0, 2)}_${agora.getTime().toString(36)}`, canal: c, abertoEm: agora.toISOString(), abertoPor: quem || null, trocoCentavos: t, movimentos: [] };
  gravar(c, d);
  return { ok: true, caixa: d.aberto };
}

export function movimentar({ canal, tipo, valor, motivo, quem, agora = new Date() } = {}) {
  const c = canalOk(canal);
  if (!c) { return { ok: false, erro: 'canal desconhecido' }; }
  if (!MOVIMENTOS[tipo]) { return { ok: false, erro: 'escolha sangria ou reforço' }; }
  const v = centavos(valor);
  if (!v) { return { ok: false, erro: 'valor inválido — maior que zero, como 50 ou 20,00' }; }
  const m = String(motivo || '').trim().slice(0, 120);
  if (!m) { return { ok: false, erro: 'diga o motivo (ex.: "pagou o motoboy", "troco do banco")' }; }
  const d = ler(c);
  if (!d.aberto) { return { ok: false, erro: 'abra o caixa primeiro' }; }
  /* Sangria maior que o dinheiro que a gaveta tem (sem contar as entregas, que
     podem ter sido na maquininha) é erro de digitação quase sempre. */
  if (tipo === 'sangria' && v > gavetaSemVendas(d.aberto)) {
    return { ok: false, erro: 'essa sangria é maior que o dinheiro da gaveta (troco + reforços − sangrias). Confira o valor.' };
  }
  const mov = { tipo, valorCentavos: v, motivo: m, quando: agora.toISOString(), quem: quem || null };
  d.aberto.movimentos.push(mov);
  gravar(c, d);
  return { ok: true, movimento: mov };
}

/**
 * Fecha o caixa. `contado` = dinheiro contado na gaveta; `maquininha` = quanto
 * das entregas foi pago no cartão da maquininha (sai do esperado em dinheiro).
 * `vendas` = vendasEntre() desde a abertura, gravado junto como retrato do dia.
 */
export function fechar({ canal, contado, maquininha, obs, quem, vendas, agora = new Date() } = {}) {
  const c = canalOk(canal);
  if (!c) { return { ok: false, erro: 'canal desconhecido' }; }
  const cont = centavos(contado);
  if (cont == null) { return { ok: false, erro: 'informe quanto de dinheiro você contou na gaveta' }; }
  const maq = centavos(maquininha ?? 0);
  if (maq == null) { return { ok: false, erro: 'valor da maquininha inválido' }; }
  const d = ler(c);
  const cx = d.aberto;
  if (!cx) { return { ok: false, erro: 'o caixa não está aberto' }; }
  const entrega = vendas?.naEntregaCentavos || 0;
  if (maq > entrega) { return { ok: false, erro: `a maquininha não pode passar do total pago na entrega (${(entrega / 100).toFixed(2).replace('.', ',')})` }; }
  const esperado = gavetaSemVendas(cx) + entrega - maq;
  const fechado = {
    ...cx,
    fechadoEm: agora.toISOString(),
    fechadoPor: quem || null,
    sangriasCentavos: soma(cx.movimentos, 'sangria'),
    reforcosCentavos: soma(cx.movimentos, 'reforco'),
    naEntregaCentavos: entrega,
    maquininhaCentavos: maq,
    esperadoCentavos: esperado,
    contadoCentavos: cont,
    diferencaCentavos: cont - esperado,
    obs: String(obs || '').trim().slice(0, 300) || null,
    vendas: vendas ? { vendidoCentavos: vendas.vendidoCentavos, naEntregaCentavos: vendas.naEntregaCentavos, aguardandoCentavos: vendas.aguardandoCentavos, pedidos: vendas.pedidos, ticketMedioCentavos: vendas.ticketMedioCentavos, pico: vendas.pico } : null,
  };
  d.fechados = [...d.fechados, fechado].slice(-LIMITE_HISTORICO);
  d.aberto = null;
  gravar(c, d);
  return { ok: true, fechamento: fechado };
}

/** Fechamentos do canal, do mais novo pro mais velho. */
export function historico(canal, { limite = 30 } = {}) {
  const c = canalOk(canal);
  if (!c) { return []; }
  return ler(c).fechados.slice(-Math.max(1, Math.min(LIMITE_HISTORICO, limite))).reverse();
}
