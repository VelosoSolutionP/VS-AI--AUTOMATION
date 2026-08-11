/**
 * Trava do teste de 7 dias — por DATA DE INSTALAÇÃO (runtime, não depende de cron) +
 * ANTI-ADULTERAÇÃO. O registro é gravado em 3 lugares e ASSINADO (HMAC). Se um sumir,
 * a assinatura não bater, ou as datas divergirem => adulteração => TRAVA NA HORA
 * (fail-closed). Licença paga (plano != trial) ignora tudo isso.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHmac } from 'node:crypto';

const DAY = 86400000;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // pasta qa-gate/
// Segredo embutido (levanta a barra; ofuscar no build). Não é sigilo perfeito — é anti-espertinho.
const SECRET = 'vs-' + 'trial' + '-9f3a' + 'c1' + 'e7' + '-guard';

/** 3 locais redundantes do registro do teste. */
export function guardPaths() {
  return [
    join(homedir(), '.qa-gate', 'trial.json'),
    join(homedir(), '.vs-guard.json'),
    join(ROOT, '.vsguard'),
  ];
}
export function lockFile() { return join(homedir(), '.qa-gate', 'locked.json'); }

const sign = (installedAt, days, plan) => createHmac('sha256', SECRET).update(`${installedAt}|${days}|${plan}`).digest('hex');

/** Trava forte (cron/tarefa agendada ou adulteração). */
export function hardLock(motivo = 'trial') {
  const f = lockFile();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ lockedAt: Date.now(), motivo }, null, 2));
  return true;
}
export function isHardLocked() { return existsSync(lockFile()); }
export function unlock() { try { for (const p of [lockFile()]) { if (existsSync(p)) { unlinkSync(p); } } } catch {} }

/** Marca a instalação (1ª vez) nos 3 locais, assinado. Não reseta se já íntegro. */
export function markInstalled({ days = 7, plan = 'trial' } = {}) {
  const ic = integrity();
  if (ic.managed && !ic.tamper) { return { installedAt: ic.installedAt, days: ic.days, plan: ic.plan }; }
  const installedAt = Date.now();
  const rec = { installedAt, days, plan, sig: sign(installedAt, days, plan) };
  const body = JSON.stringify(rec, null, 2);
  for (const p of guardPaths()) { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); } catch {} }
  return rec;
}

function readOne(p) {
  if (!existsSync(p)) { return { exists: false }; }
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const sigValid = d && d.sig === sign(d.installedAt, d.days, d.plan);
    return { exists: true, data: d, sigValid };
  } catch { return { exists: true, data: null, sigValid: false }; }
}

/** Núcleo puro da checagem de integridade (testável). */
export function integrityCore(records) {
  const existing = records.filter((r) => r.exists);
  if (existing.length === 0) { return { managed: false, tamper: false }; }
  if (existing.some((r) => !r.sigValid || !r.data)) { return { managed: true, tamper: true, motivo: 'assinatura inválida' }; }
  if (existing.length < records.length) { return { managed: true, tamper: true, motivo: 'registro removido' }; }
  const datas = [...new Set(existing.map((r) => r.data.installedAt))];
  if (datas.length > 1) { return { managed: true, tamper: true, motivo: 'datas divergentes' }; }
  const d = existing[0].data;
  return { managed: true, tamper: false, installedAt: d.installedAt, days: d.days, plan: d.plan };
}

export function integrity() {
  return integrityCore(guardPaths().map(readOne));
}

/** Estado do teste (dias restantes, expirado, adulterado). */
export function trialStatus(now = Date.now()) {
  if (isHardLocked()) { return { gerenciado: true, expirado: true, travado: true, diasRestantes: 0 }; }
  const ic = integrity();
  if (!ic.managed) { return { gerenciado: false, expirado: false, diasRestantes: null }; }
  if (ic.tamper) { return { gerenciado: true, expirado: true, tamper: true, motivo: ic.motivo, diasRestantes: 0 }; }
  const fim = ic.installedAt + (ic.days || 7) * DAY;
  return { gerenciado: true, plan: ic.plan, expirado: now > fim, diasRestantes: Math.max(0, Math.ceil((fim - now) / DAY)), fim };
}

/** Lança se o teste travou (expirou por data, adulteração, ou trava forte). Paga ignora. */
export function assertNotExpired(licensePlan) {
  if (licensePlan && licensePlan !== 'trial') { return true; }
  if (isHardLocked()) { throw trialError(); }
  const ic = integrity();
  if (ic.managed && ic.tamper) { hardLock('tamper:' + (ic.motivo || '')); throw trialError('Detectada adulteração da licença de teste. Sistema travado.'); }
  const s = trialStatus();
  if (s.gerenciado && s.plan === 'trial' && s.expirado) { throw trialError(); }
  return true;
}

function trialError(msg) {
  const e = new Error(msg || 'Teste de 7 dias expirou. Ative a licença — WhatsApp (31) 97512-7978.');
  e.trialExpired = true;
  return e;
}
