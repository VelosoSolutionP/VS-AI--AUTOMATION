/**
 * CÓPIA DE SEGURANÇA DIÁRIA (18/10, plano "o que falta": item 1 — "cópia diária
 * do banco fora dela, alerta quando algo cair").
 *
 * Uma vez por dia, depois das 3h (Brasília), sozinha — sem botão:
 *   - o banco Postgres (DATABASE_URL) por `pg_dump -Fc` (cópia consistente com o
 *     site e o painel escrevendo ao mesmo tempo; volta com `pg_restore`);
 *   - a casa inteira (<casa>, os JSON de cada módulo) num .tar.gz;
 * em <BACKUP_DIR>/<AAAA-MM-DD>/, permissão 600, guardando as últimas
 * BACKUP_DIAS (14). Se `BACKUP_DESTINO` existir (ex.: `rclone copy {dir}
 * drive:bolso-backups/{dia}` ou `rsync -a {dir} servidor:/backups/`), roda
 * depois — é o "fora da máquina". Falhou: avisa o dono por e-mail.
 *
 * A cópia tem tokens e senhas (painel.env não entra: mora em console/ e entra
 * sim — é o que deixa subir do zero). Por isso 600 e nunca no repositório.
 */
import { mkdirSync, readdirSync, rmSync, statSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { casa } from '../engine/casa.mjs';

export const dirBackups = () => resolve(process.env.BACKUP_DIR || join(homedir(), 'backups-bolso', 'diario'));
const DIAS = () => Math.max(1, Number(process.env.BACKUP_DIAS) || 14);
const diaBR = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const horaBR = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(d));
const arqEstado = () => join(dirBackups(), 'estado.json');
export const estado = () => { try { return JSON.parse(readFileSync(arqEstado(), 'utf8')); } catch { return {}; } };

/** Faz a cópia de hoje (ou de `dia`). Devolve o que gravou. */
export async function fazer({ agora = new Date() } = {}) {
  const dia = diaBR(agora);
  const pasta = join(dirBackups(), dia);
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const feitos = [];
  if (process.env.DATABASE_URL) {
    const destino = join(pasta, 'banco.dump');
    rmSync(destino, { force: true });
    /* O ?schema= é do Prisma; o pg_dump não aceita. A senha vai no ambiente do processo, nunca na tela. */
    const url = process.env.DATABASE_URL.replace(/[?&]schema=[^&]*/g, '');
    execFileSync(process.env.PG_DUMP || 'pg_dump', ['-Fc', '--no-owner', '-f', destino, url], { stdio: 'pipe', timeout: 30 * 60000 });
    chmodSync(destino, 0o600); feitos.push('banco.dump');
  }
  const tar = join(pasta, 'casa.tar.gz');
  /* Fora: cópias antigas de limpeza e a sessão do navegador (refaz-se). */
  execFileSync('tar', ['-czf', tar, '--exclude=backup-limpeza-*', '--exclude=*.antes-*', '-C', casa(), '.'], { stdio: 'pipe' });
  chmodSync(tar, 0o600); feitos.push('casa.tar.gz');
  const tamanho = feitos.reduce((s, f) => s + statSync(join(pasta, f)).size, 0);
  let destino = null;
  if (process.env.BACKUP_DESTINO) {
    const cmd = process.env.BACKUP_DESTINO.replaceAll('{dir}', pasta).replaceAll('{dia}', dia);
    execFileSync('sh', ['-c', cmd], { stdio: 'pipe', timeout: 30 * 60000 });
    destino = 'enviado';
  }
  const apagados = limpar();
  const e = { ultimo: { dia, em: agora.toISOString(), arquivos: feitos, bytes: tamanho, destino }, erro: null };
  writeFileSync(arqEstado(), JSON.stringify(e, null, 2), { mode: 0o600 });
  return { ok: true, dia, pasta, arquivos: feitos, bytes: tamanho, destino, apagados };
}

/** Guarda só as últimas BACKUP_DIAS pastas (nome = data). */
export function limpar() {
  const dias = readdirSync(dirBackups()).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  const sobra = dias.slice(0, Math.max(0, dias.length - DIAS()));
  for (const d of sobra) { rmSync(join(dirBackups(), d), { recursive: true, force: true }); }
  return sobra;
}

/**
 * A batida do relógio (o painel chama de hora em hora): depois das 3h, se a
 * cópia de hoje ainda não existe, faz. `avisar(txt)` recebe a falha.
 */
export async function talvezFazer({ agora = new Date(), avisar = null } = {}) {
  if (horaBR(agora) < 3) { return { ok: true, feito: false, motivo: 'antes das 3h' }; }
  if (estado().ultimo?.dia === diaBR(agora)) { return { ok: true, feito: false, motivo: 'já feito hoje' }; }
  try { return { ...(await fazer({ agora })), feito: true }; }
  catch (e) {
    const msg = String(e.stderr || e.message || e).slice(0, 400);
    try { mkdirSync(dirBackups(), { recursive: true, mode: 0o700 }); writeFileSync(arqEstado(), JSON.stringify({ ...estado(), erro: { em: agora.toISOString(), msg } }, null, 2), { mode: 0o600 }); } catch { /* sem disco, sem estado */ }
    if (avisar) { await avisar(`A cópia de segurança de ${diaBR(agora)} falhou: ${msg}`).catch(() => {}); }
    return { ok: false, feito: false, erro: msg };
  }
}
