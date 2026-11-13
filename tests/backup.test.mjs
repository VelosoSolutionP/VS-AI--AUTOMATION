/**
 * Cópia de segurança diária (18/10): banco Postgres por pg_dump + casa em tar.gz,
 * permissão 600, guarda as últimas N, roda o destino de fora e avisa na falha.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync, readdirSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const raiz = mkdtempSync(join(tmpdir(), 'backup-'));
process.env.VS_HOME = join(raiz, 'casa');
process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5434/zest?schema=public';
/* pg_dump de mentira: grava os argumentos no arquivo pedido em -f. */
process.env.PG_DUMP = join(raiz, 'pg_dump');
writeFileSync(process.env.PG_DUMP, '#!/bin/sh\nwhile [ "$1" != "-f" ]; do shift; done; echo "$@" > "$2"\n');
chmodSync(process.env.PG_DUMP, 0o755);
process.env.BACKUP_DIR = join(raiz, 'copias');
process.env.BACKUP_DIAS = '3';
mkdirSync(join(raiz, 'casa', 'vsbot'), { recursive: true });
writeFileSync(join(raiz, 'casa', 'vsbot', 'config.json'), '{"nome":"Micaela"}');
const backup = await import('../backend/backup.mjs');
test.after(() => rmSync(raiz, { recursive: true, force: true }));

const as5h = (dia) => new Date(`${dia}T08:00:00Z`); // 5h em Brasília

test('faz banco (pg_dump do Postgres) + casa, com permissão 600', async () => {
  const r = await backup.fazer({ agora: as5h('2026-10-18') });
  assert.deepEqual(r.arquivos, ['banco.dump', 'casa.tar.gz']);
  const pasta = join(raiz, 'copias', '2026-10-18');
  for (const f of r.arquivos) { assert.equal(statSync(join(pasta, f)).mode & 0o777, 0o600, f); }
  const args = readFileSync(join(pasta, 'banco.dump'), 'utf8');
  assert.match(args, /postgresql:\/\/u:p@127\.0\.0\.1:5434\/zest/);
  assert.doesNotMatch(args, /schema=/, 'o ?schema= do Prisma não vai pro pg_dump');
  assert.match(execFileSync('tar', ['-tzf', join(pasta, 'casa.tar.gz')]).toString(), /vsbot\/config\.json/);
});

test('antes das 3h não faz; depois, uma vez por dia', async () => {
  assert.equal((await backup.talvezFazer({ agora: new Date('2026-10-19T04:00:00Z') })).feito, false, '1h em Brasília');
  assert.equal((await backup.talvezFazer({ agora: as5h('2026-10-19') })).feito, true);
  assert.equal((await backup.talvezFazer({ agora: as5h('2026-10-19') })).motivo, 'já feito hoje');
});

test('guarda só as últimas 3', async () => {
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) { await backup.fazer({ agora: as5h(d) }); }
  assert.deepEqual(readdirSync(join(raiz, 'copias')).filter((n) => /^\d/.test(n)).sort(), ['2026-10-20', '2026-10-21', '2026-10-22']);
});

test('roda o destino de fora com {dir} e {dia}', async () => {
  process.env.BACKUP_DESTINO = `echo "{dia} {dir}" > ${join(raiz, 'destino.txt')}`;
  await backup.fazer({ agora: as5h('2026-10-23') });
  assert.match(readFileSync(join(raiz, 'destino.txt'), 'utf8'), /2026-10-23 .*copias\/2026-10-23/);
  delete process.env.BACKUP_DESTINO;
});

test('falhou: avisa o dono e guarda o erro', async () => {
  process.env.BACKUP_DESTINO = 'exit 7';
  let aviso = null;
  const r = await backup.talvezFazer({ agora: as5h('2026-10-24'), avisar: async (t) => { aviso = t; } });
  assert.equal(r.ok, false);
  assert.match(aviso, /falhou/);
  assert.ok(backup.estado().erro);
  delete process.env.BACKUP_DESTINO;
});
