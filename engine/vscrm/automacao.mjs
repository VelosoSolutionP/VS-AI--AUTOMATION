/**
 * Funil que anda sozinho — por REGRAS, sem IA.
 *
 * Antes daqui o lead entrava na 1ª etapa e ficava lá até alguém trocar na mão.
 * O Pix caía, o pedido ficava pago e o lead continuava "aberto": a conversão do
 * painel mentia e o valor do funil era quase sempre "—". As regras são três
 * fatos que o sistema JÁ sabe, sem adivinhar nada:
 *
 *  - a EQUIPE respondeu o cliente        → etapa de contato
 *  - saiu COBRANÇA na conversa           → etapa de proposta (e o valor vem junto)
 *  - o PAGAMENTO foi confirmado          → Ganho
 *
 * Duas travas: o lead só anda PRA FRENTE (regra nunca desfaz o que o vendedor
 * moveu adiante) e lead fechado não se mexe — exceto pagamento, que vence um
 * "perdido" dado antes de o dinheiro cair.
 *
 * Funções puras: quem grava é o index.mjs.
 */
import { moverEtapa, fechar } from './leads.mjs';

export const DIAS_ESFRIAR_PADRAO = 3;

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RX_CONTATO = /contat|atend|convers|qualific|primeiro|respond/;
const RX_PROPOSTA = /propost|orcam|negoci|cobran|pagament|checkout|pedido/;
const RX_GANHO = /ganh|fechad|vend|conclu|pago/;
const RX_PERDIDO = /perd|cancel|desist/;

const acha = (funil, rx, desde = 1) => funil.slice(desde).find((e) => rx.test(sem(e))) || null;
/** Etapas "de fim" (ganho/perdido como coluna) não servem de destino pra contato/proposta. */
const doMeio = (funil) => funil.filter((e, i) => i > 0 && !RX_GANHO.test(sem(e)) && !RX_PERDIDO.test(sem(e)));

/**
 * Qual etapa cada regra usa. Palpite pelo NOME da etapa; sem nome que ajude,
 * pela posição (2ª e 3ª etapas do meio). O dono troca na tela.
 */
export function padrao(funil = []) {
  const meio = doMeio(funil);
  const contato = acha(meio, RX_CONTATO, 0) || meio[0] || null;
  const proposta = acha(meio, RX_PROPOSTA, 0) || meio.find((e) => funil.indexOf(e) > funil.indexOf(contato)) || null;
  return { ligada: true, contato, proposta: proposta === contato ? null : proposta, diasEsfriar: DIAS_ESFRIAR_PADRAO };
}

/** Config salva + padrão. Etapa que saiu do funil vira null (não move pra coluna que não existe). */
export function resolver(salva, funil = []) {
  const p = padrao(funil);
  const c = { ...p, ...(salva || {}) };
  const ok = (e) => (e && funil.includes(e) ? e : null);
  const dias = Number(c.diasEsfriar);
  return { ligada: c.ligada !== false, contato: ok(c.contato), proposta: ok(c.proposta),
    diasEsfriar: Number.isFinite(dias) && dias >= 1 && dias <= 60 ? Math.round(dias) : DIAS_ESFRIAR_PADRAO };
}

/** Valida o que veio da tela. */
export function validar(d = {}, funil = []) {
  const erros = [];
  for (const k of ['contato', 'proposta']) {
    if (d[k] != null && d[k] !== '' && !funil.includes(d[k])) { erros.push(`etapa "${d[k]}" não está no funil`); }
  }
  const dias = Number(d.diasEsfriar);
  if (d.diasEsfriar != null && !(Number.isFinite(dias) && dias >= 1 && dias <= 60)) { erros.push('dias para esfriar: de 1 a 60'); }
  if (erros.length) { return { erros }; }
  return { config: { ligada: d.ligada !== false, contato: d.contato || null, proposta: d.proposta || null,
    diasEsfriar: d.diasEsfriar == null ? DIAS_ESFRIAR_PADRAO : Math.round(dias) } };
}

/** Anda pra `alvo` se estiver à frente. Devolve o lead (igual, se não andou). */
function avancar(lead, alvo, funil, motivo, quando) {
  if (!alvo || lead.status !== 'aberto') { return lead; }
  if (funil.indexOf(alvo) <= funil.indexOf(lead.etapa)) { return lead; }
  const r = moverEtapa(lead, alvo, funil, quando);
  if (r.erro) { return lead; }
  const h = r.lead.historico;
  h[h.length - 1] = { ...h[h.length - 1], auto: true, motivo };
  return r.lead;
}

function comValor(lead, centavos, referencia, quando) {
  const v = Math.round(Number(centavos) || 0) / 100;
  if (!v || lead.valor === v) { return lead; }
  return { ...lead, valor: v, atualizadoEm: quando,
    historico: [...(lead.historico || []), { tipo: 'valor', de: lead.valor ?? null, para: v, auto: true, motivo: `pedido ${referencia}`, quando }] };
}

/**
 * Aplica a regra do evento. `tipo`: 'resposta-equipe' | 'cobranca' | 'pago'.
 * @returns {object} o lead (o mesmo objeto se nada mudou)
 */
export function aplicar(lead, tipo, dados = {}, { funil = [], config } = {}, quando = new Date().toISOString()) {
  const c = config || resolver(null, funil);
  if (!lead || !c.ligada) { return lead; }
  if (tipo === 'resposta-equipe') { return avancar(lead, c.contato, funil, 'a equipe respondeu o cliente', quando); }
  if (tipo === 'cobranca') {
    if (lead.status !== 'aberto') { return lead; }
    const ref = dados.referencia || '?';
    return avancar(comValor(lead, dados.valorCentavos, ref, quando), c.proposta, funil, `cobrança do pedido ${ref} enviada`, quando);
  }
  if (tipo === 'pago') {
    if (lead.status === 'ganho') { return lead; }
    const ref = dados.referencia || '?';
    let l = comValor(lead, dados.valorCentavos, ref, quando);
    /* Funil com coluna "Ganho"/"Fechado": o lead vai pra ela também — senão o
       quadro mostraria o ganho parado em "proposta". */
    const colunaGanho = acha(funil, RX_GANHO);
    if (colunaGanho && l.etapa !== colunaGanho) {
      const m = moverEtapa({ ...l, status: 'aberto' }, colunaGanho, funil, quando);
      if (!m.erro) { l = { ...m.lead, status: l.status }; l.historico[l.historico.length - 1].auto = true; }
    }
    const f = fechar(l, 'ganho', `pagamento confirmado · pedido ${ref}`, quando);
    const h = f.lead.historico;
    h[h.length - 1] = { ...h[h.length - 1], auto: true };
    return f.lead;
  }
  return lead;
}

/** Última conversa (entrada ou saída) do lead — é o que diz se ele esfriou. */
export function ultimaConversa(lead) {
  const h = lead?.historico || [];
  for (let i = h.length - 1; i >= 0; i--) { if (h[i].tipo === 'interacao' || h[i].tipo === 'criado') { return h[i].quando; } }
  return lead?.criadoEm || null;
}

/** Dias sem conversa, só de lead aberto. Null quando não se aplica. */
export function diasParado(lead, agora = Date.now()) {
  if (lead?.status !== 'aberto') { return null; }
  const t = Date.parse(ultimaConversa(lead));
  return Number.isFinite(t) ? Math.floor((agora - t) / 86400000) : null;
}
