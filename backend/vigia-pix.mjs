/**
 * Vigia do Pix do bot: pagou, a conversa fica sabendo.
 *
 * O aviso do Mercado Pago (webhook) é o caminho oficial, e em campo ele não
 * chegava — ou chegava e era recusado pela assinatura. Resultado visto: o
 * cliente pagou, o QR continuou na tela e ninguém disse nada. Todo app de
 * pagamento confere sozinho enquanto a tela do Pix está aberta; este módulo é
 * isso: cada Pix gerado pelo bot entra numa lista, e a lista é conferida no
 * gateway a cada poucos segundos até pagar ou vencer.
 *
 * O webhook, quando funcionar, só adianta: `confirmado()` dispara o mesmo
 * desfecho, e o registro sai da lista — ninguém recebe "pago" duas vezes.
 *
 * A lista mora em disco: reiniciar o painel no meio da espera não pode fazer
 * um pagamento sumir.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { dentroDaCasa } from '../engine/casa.mjs';

export const MINUTOS_VALIDADE = 60;
const PAGO = ['CONFIRMADO', 'DISPONIVEL'];

const arq = () => (process.env.VSPIX_DIR ? join(process.env.VSPIX_DIR, 'pix-pendentes.json') : dentroDaCasa('vsbot', 'pix-pendentes.json'));
const ler = () => { try { return JSON.parse(readFileSync(arq(), 'utf8')); } catch { return []; } };
const gravar = (l) => {
  mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 });
  writeFileSync(arq(), JSON.stringify(l, null, 2));
  try { chmodSync(arq(), 0o600); } catch { /* sem chmod no Windows */ }
};

/**
 * @param {{pagamentoId:string, referencia:string, para:string, de:string,
 *          mensagens:string[], itens:object[], totalCentavos:number}} reg
 */
export function registrar(reg, agora = Date.now()) {
  if (!reg?.pagamentoId) { return { ok: false, motivo: 'sem id de pagamento' }; }
  /* O mesmo pedido pode gerar o Pix de novo (cliente pediu outra vez): o
     mais novo substitui, e as mensagens do anterior também somem quando pagar. */
  const antigo = ler().find((r) => r.pagamentoId === String(reg.pagamentoId));
  const resto = ler().filter((r) => r.pagamentoId !== String(reg.pagamentoId));
  const novo = { ...reg, pagamentoId: String(reg.pagamentoId),
    mensagens: [...new Set([...(antigo?.mensagens || []), ...(reg.mensagens || [])].filter(Boolean).map(String))],
    criadoEm: new Date(agora).toISOString(), venceEm: new Date(agora + MINUTOS_VALIDADE * 60000).toISOString() };
  gravar([...resto, novo]);
  return { ok: true };
}

export const pendentes = () => ler();

/** Uma passada: confere cada Pix pendente; pago → desfecho; vencido → sai. */
export async function conferir({ consultar, aoConfirmar, agora = Date.now() }) {
  const feitos = [];
  for (const reg of ler()) {
    if (Date.parse(reg.venceEm) <= agora) {
      gravar(ler().filter((r) => r.pagamentoId !== reg.pagamentoId));
      console.log(`[pix] ${reg.referencia}: venceu sem pagamento — parei de conferir`);
      continue;
    }
    let r;
    try { r = await consultar(reg.pagamentoId); } catch (e) { r = { ok: false, motivo: e.message }; }
    if (r?.ok && PAGO.includes(r.pagamento?.estado)) {
      feitos.push(await concluir(reg, r.pagamento, aoConfirmar));
    }
  }
  return feitos;
}

/** O webhook confirmou: se o Pix é do bot, o desfecho sai agora. */
export async function confirmado(pagamento, { aoConfirmar }) {
  const reg = ler().find((r) => r.pagamentoId === String(pagamento?.id));
  if (!reg) { return { ok: false, naoEDoBot: true }; }
  return concluir(reg, pagamento, aoConfirmar);
}

async function concluir(reg, pagamento, aoConfirmar) {
  /* Sai da lista ANTES do desfecho: se a passada seguinte chegar enquanto o
     aviso ainda está saindo, ela não encontra o registro e não avisa de novo. */
  gravar(ler().filter((r) => r.pagamentoId !== reg.pagamentoId));
  try {
    await aoConfirmar(reg, pagamento);
    return { ok: true, referencia: reg.referencia };
  } catch (e) {
    console.error(`[pix] ${reg.referencia}: pago, mas o aviso falhou — ${e.message}`);
    return { ok: false, referencia: reg.referencia, erro: e.message };
  }
}

let relogio = null;
/** Liga a conferência periódica (uma vez por processo). */
export function iniciar(deps, ms = 10000) {
  if (relogio) { return; }
  let rodando = false;
  relogio = setInterval(async () => {
    if (rodando || !ler().length) { return; }
    rodando = true;
    try { await conferir(deps); } finally { rodando = false; }
  }, ms);
  relogio.unref?.();
}
