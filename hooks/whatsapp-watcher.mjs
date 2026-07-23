#!/usr/bin/env node
/**
 * Watcher do qa-gate — roda a cada ~10 min (cron/docker/Task Scheduler).
 *
 * Lê os marcadores de bloqueio que a IA deixou (help-state). Para cada pendência
 * NÃO notificada e mais velha que o timeout, manda um pedido de ajuda no WhatsApp
 * e marca como notificada (não spamma). Sem marcador ou WhatsApp desativado: no-op.
 *
 * A IA declara o problema (deixa o bilhete); o cron cobra os 10 min.
 */
import { readMarkers, markNotified } from '../engine/help-state.mjs';
import {
  sendWhatsApp,
  formatMessage,
  whatsappConfig,
  whatsappEnabled,
  devName,
} from '../engine/notify-whatsapp.mjs';

async function main() {
  const wa = whatsappConfig();
  if (!whatsappEnabled(wa)) {
    console.log('[watcher] WhatsApp desativado/placeholder — nada a fazer.');
    return;
  }
  const timeoutMs = (wa.helpTimeoutMin || 10) * 60 * 1000;
  const now = Date.now();
  const markers = readMarkers();
  if (markers.length === 0) {
    console.log('[watcher] sem pendencia.');
    return;
  }
  for (const { file, data } of markers) {
    if (data.notified) {
      continue;
    }
    const age = now - (data.ts || 0);
    if (age < timeoutMs) {
      continue;
    }
    const msg = formatMessage({
      project: data.project,
      task: data.task,
      kind: 'help',
      problem: data.problem,
      dev: data.dev || devName(),
    });
    const r = await sendWhatsApp(msg);
    if (r.ok) {
      markNotified(file, data);
      console.log(`[watcher] avisado: ${data.project} #${data.task || '-'}`);
    } else {
      console.log(`[watcher] falha no envio: ${JSON.stringify(r)}`);
    }
  }
}

main().catch((e) => {
  console.error('[watcher] erro:', e);
  process.exit(1);
});
