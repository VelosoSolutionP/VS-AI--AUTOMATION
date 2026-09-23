#!/usr/bin/env node
/**
 * Backup verificado — e só então a remoção da origem.
 *
 * Feito para um caso concreto: alguém está entrando no aparelho de uma pessoa e
 * os documentos e processos dela estão espalhados em celular, computador e
 * nuvem. A ordem importa e não é negociável:
 *
 *   1. copia
 *   2. CONFERE arquivo por arquivo, pelo hash
 *   3. só se tudo bater, aí sim pode remover da origem
 *
 * Nunca o contrário. "Copiei e apaguei" sem conferir é como se perde um acervo
 * inteiro — o disco diz que gravou, o arquivo está truncado, e ninguém descobre
 * até precisar.
 *
 *   node scripts/backup-seguro.mjs --de ~/Documentos --de ~/Processos --para /mnt/cofre
 *   node scripts/backup-seguro.mjs --de ~/Documentos --para /mnt/cofre --remover-origem
 *
 * O manifesto com os hashes fica junto do backup. É ele que prova, depois, que
 * o que está no cofre é exatamente o que existia — inclusive para um perito.
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const args = process.argv.slice(2);
const origens = [];
let destino = null;
let removerOrigem = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--de') { origens.push(resolve(args[++i] || '')); }
  else if (args[i] === '--para') { destino = resolve(args[++i] || ''); }
  else if (args[i] === '--remover-origem') { removerOrigem = true; }
}

if (!origens.length || !destino) {
  console.error('uso: node scripts/backup-seguro.mjs --de <pasta> [--de <outra>] --para <destino> [--remover-origem]');
  process.exit(1);
}

/* O destino NAO pode estar dentro da origem: seria copiar pra dentro de si
   mesmo e, com --remover-origem, apagar o proprio backup. */
for (const o of origens) {
  if (destino === o || destino.startsWith(o + '/')) {
    console.error(`o destino ${destino} está dentro da origem ${o} — escolha um lugar fora`);
    process.exit(1);
  }
  if (!existsSync(o)) { console.error(`origem não existe: ${o}`); process.exit(1); }
}

const hash = (caminho) => createHash('sha256').update(readFileSync(caminho)).digest('hex');

function listar(raiz, base = raiz, saida = []) {
  for (const nome of readdirSync(raiz)) {
    const p = join(raiz, nome);
    let st;
    try { st = statSync(p); } catch { continue; } // link quebrado nao para o backup
    if (st.isDirectory()) { listar(p, base, saida); }
    else if (st.isFile()) { saida.push({ abs: p, rel: relative(base, p), bytes: st.size }); }
  }
  return saida;
}

const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const pastaBackup = join(destino, `backup-${carimbo}`);
mkdirSync(pastaBackup, { recursive: true });

const manifesto = [];
const falhas = [];
let total = 0;

for (const origem of origens) {
  const nomeOrigem = origem.split('/').filter(Boolean).pop() || 'raiz';
  const arquivos = listar(origem);
  console.log(`\n${origem} — ${arquivos.length} arquivo(s)`);
  for (const a of arquivos) {
    const alvo = join(pastaBackup, nomeOrigem, a.rel);
    try {
      mkdirSync(dirname(alvo), { recursive: true });
      copyFileSync(a.abs, alvo);
      /* CONFERE AGORA, nao no fim: arquivo que copiou torto tem de aparecer
         antes de alguem confiar no backup inteiro. */
      const hOrigem = hash(a.abs);
      const hCopia = hash(alvo);
      if (hOrigem !== hCopia) { falhas.push(`${a.abs}: cópia não confere`); continue; }
      manifesto.push({ origem: a.abs, copia: relative(pastaBackup, alvo), bytes: a.bytes, sha256: hOrigem });
      total += a.bytes;
    } catch (e) {
      falhas.push(`${a.abs}: ${e.message}`);
    }
  }
}

writeFileSync(join(pastaBackup, 'MANIFESTO.json'), JSON.stringify({
  em: new Date().toISOString(),
  origens,
  arquivos: manifesto.length,
  bytes: total,
  falhas,
  itens: manifesto,
}, null, 2));

const mb = (total / 1024 / 1024).toFixed(1);
console.log(`\n${manifesto.length} arquivo(s) · ${mb} MB`);
console.log(`backup: ${pastaBackup}`);
console.log(`manifesto: ${join(pastaBackup, 'MANIFESTO.json')}`);

if (falhas.length) {
  console.error(`\n${falhas.length} arquivo(s) NÃO foram copiados com segurança:`);
  for (const f of falhas.slice(0, 20)) { console.error('  ' + f); }
  console.error('\nNADA será removido da origem — backup incompleto não autoriza apagar nada.');
  process.exit(1);
}

if (!removerOrigem) {
  console.log('\nOrigem intacta. Confira o backup e, se quiser remover depois, rode de novo com --remover-origem.');
  process.exit(0);
}

/* A remocao pede confirmacao digitada mesmo com a opcao na linha de comando:
   apagar documento de processo e irreversivel, e a flag pode ter vindo de um
   comando colado sem ler. */
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\nVou remover os ${manifesto.length} arquivos DA ORIGEM. A cópia verificada fica em ${pastaBackup}.`);
const resp = (await rl.question('Digite REMOVER para confirmar: ')).trim();
rl.close();
if (resp !== 'REMOVER') { console.log('Nada foi removido.'); process.exit(0); }

let removidos = 0;
const naoRemovidos = [];
for (const item of manifesto) {
  // Confere a copia OUTRA VEZ, imediatamente antes de apagar o original.
  try {
    if (hash(join(pastaBackup, item.copia)) !== item.sha256) { naoRemovidos.push(item.origem); continue; }
    rmSync(item.origem);
    removidos += 1;
  } catch (e) { naoRemovidos.push(`${item.origem}: ${e.message}`); }
}
console.log(`\nremovidos da origem: ${removidos}`);
if (naoRemovidos.length) {
  console.error(`mantidos por segurança (${naoRemovidos.length}):`);
  for (const n of naoRemovidos.slice(0, 20)) { console.error('  ' + n); }
}
