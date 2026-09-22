/**
 * Idempotência de webhook (spec §24).
 *
 * O Stripe reentrega o MESMO evento quando não recebe 2xx a tempo. Sem trava, cada
 * reentrega emitia uma licença nova pro mesmo pagamento.
 *
 * A trava é a criação EXCLUSIVA de um arquivo por id de evento (`flag: 'wx'`), que é
 * atômica no sistema de arquivos: se dois processos tentarem ao mesmo tempo, só um
 * cria e o outro recebe EEXIST. Um `existsSync` seguido de `writeFileSync` teria uma
 * janela entre a checagem e a escrita — os dois passariam.
 *
 * Sem banco ainda; quando o Postgres do P0 entrar, isto vira uma UNIQUE em
 * payment_events.provider_event_id e este módulo sai.
 */
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { dentroDaCasa } from '../engine/casa.mjs';
/** Só o que der pra usar como nome de arquivo — id de evento vem de fora. */
const sanitiza = (s) => String(s || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);

export function baseDir() {
  return process.env.WEBHOOK_EVENTS_DIR || dentroDaCasa('webhook-events');
}

/**
 * Tenta RESERVAR o evento. Devolve true se esta chamada ganhou a corrida (pode
 * processar) e false se o evento já tinha dono (é reentrega — ignore).
 */
export function reservarEvento(eventId, meta = {}) {
  const id = sanitiza(eventId);
  if (!id) { return false; }
  const dir = baseDir();
  try { mkdirSync(dir, { recursive: true }); } catch {}
  try {
    writeFileSync(join(dir, id + '.json'), JSON.stringify({ id: eventId, ...meta, em: new Date().toISOString() }), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e?.code === 'EEXIST') { return false; }
    // Disco cheio ou permissão: não dá pra garantir idempotência. Deixa passar e
    // registra — perder a entrega do cliente é pior que emitir duas chaves, mas o
    // operador precisa ver que a trava não funcionou.
    console.error('[idempotencia] nao consegui reservar', eventId, '-', e?.message);
    return true;
  }
}

/** Já foi processado? (leitura simples, sem reservar) */
export function eventoConhecido(eventId) {
  const id = sanitiza(eventId);
  return !!id && existsSync(join(baseDir(), id + '.json'));
}

/** Remove reservas mais velhas que N dias — o Stripe não reentrega depois disso. */
export function limpar(diasMax = 30, agora = Date.now()) {
  const dir = baseDir();
  let removidos = 0;
  let arquivos = [];
  try { arquivos = readdirSync(dir); } catch { return { removidos: 0 }; }
  for (const f of arquivos) {
    const p = join(dir, f);
    try {
      if (agora - statSync(p).mtimeMs > diasMax * 86400000) { rmSync(p); removidos++; }
    } catch {}
  }
  return { removidos };
}
