/**
 * Consentimento (LGPD) para coleta técnica. Sem aceite → telemetria desativada.
 * Governança (requisito/gate) NÃO depende de consentimento — só a coleta de métricas.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT = join(HERE, '..', '.consent', 'consent.json');

export function hasConsent(path = DEFAULT) {
  try { return existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).granted === true; }
  catch { return false; }
}

export function setConsent(granted, meta = {}, path = DEFAULT) {
  mkdirSync(dirname(path), { recursive: true });
  const rec = { granted: !!granted, ts: meta.ts ?? Date.now(), scope: 'tecnico-corporativo-anonimo', by: meta.by || 'equipe' };
  writeFileSync(path, JSON.stringify(rec, null, 2));
  return rec;
}

/** Só coleta se houver consentimento. Retorna true se coletou. */
export function collectIfConsented(recordFn, event, path = DEFAULT) {
  if (!hasConsent(path)) { return false; }
  recordFn(event);
  return true;
}
