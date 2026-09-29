#!/usr/bin/env node
/**
 * Prova do Google Shopping (e Meta/TikTok) SEM token, num Chrome de verdade, em
 * instância ISOLADA com uma CÓPIA do catálogo real (a produção só é lida):
 *
 *   antes:  a tela do Estoque diz O QUE falta (descrição / pôr na vitrine);
 *   depois: descrições (docs/vitrine) + vitrine → Google 10/10 na tela;
 *           Loja: passo a passo; salva o arquivo de verificação e ele responde
 *           na raiz; os 3 feeds públicos saem com os itens, XML válido, CSV com
 *           o link; cada link abre a página do produto; cada foto carrega.
 *
 * Uso: node scripts/prova-google-shopping.mjs [--telas <pasta>]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, openSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import('playwright');
const args = process.argv.slice(2);
const TELAS = args.includes('--telas') ? args[args.indexOf('--telas') + 1] : null;
if (TELAS) { mkdirSync(TELAS, { recursive: true }); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const filhos = [];
process.on('exit', () => { for (const p of filhos) { try { p.kill('SIGTERM'); } catch { /* saiu */ } } });
const R = []; const ok = (nome, cond, det = '') => { R.push(!!cond); console.log(`${cond ? '  PASSOU' : '  FALHOU'}  ${nome}${det ? ' — ' + det : ''}`); };

const casa = mkdtempSync(join(tmpdir(), 'bolso-gshop-'));
const real = join(homedir(), '.qa-gate', 'vsestoque');
if (existsSync(real)) { cpSync(real, join(casa, 'vsestoque'), { recursive: true }); }
process.env.VS_HOME = casa;
const estoque = await import(join(RAIZ, 'engine/vsestoque/index.mjs'));
const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
const total = estoque.listar().filter((p) => p.ativo !== false).length;
ok('cópia do catálogo real carregada (só leitura da produção)', total > 0, `${total} produto(s)`);

acesso.criar(randomBytes(18).toString('base64url'));
const t = randomBytes(24).toString('base64url');
mkdirSync(join(casa, 'console'), { recursive: true });
writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [createHash('sha256').update(t).digest('hex')]:
  { email: 'dono@loja.prova', papel: 'admin', clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3600e3).toISOString() } }));

const porta = 19500 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${porta}`;
const log = join(casa, 'painel.log');
filhos.push(spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
  env: { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1', RATE_CRM: '1000000',
    WHATSAPP_PROVIDER: 'log', PAINEL_URL: base, VITRINE_NOME: 'Veloso Solution' } }));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { break; } } catch { /* subindo */ } await espera(250); }

const nav = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const erros = [];
const abrir = async (hash, vp = { width: 1440, height: 900 }) => {
  const pg = await (await nav.newContext({ viewport: vp })).newPage();
  pg.on('pageerror', (e) => erros.push(`${hash}: ${e.message}`));
  await pg.goto(`${base}/crm?t=${t}#${hash}`, { waitUntil: 'load' }); await espera(2500);
  return pg;
};
const tira = async (pg, n) => { if (TELAS) { await pg.screenshot({ path: join(TELAS, `${n}.png`), fullPage: true }); } };
const linhaGoogle = async (pg) => (await pg.locator('.stat-row:has-text("Google Merchant Center")').first().innerText()).replace(/\s+/g, ' ');
try {
  /* ── antes: o que falta, dito na tela ── */
  let pg = await abrir('estoque');
  const antes = await linhaGoogle(pg);
  ok('antes: Estoque diz o que falta (descrição e pôr na vitrine)', /Falta:.*descrição em \d+/.test(antes) && /pôr na vitrine/.test(antes), antes);
  await tira(pg, '1-estoque-antes');

  /* ── preenche (na CÓPIA) com o texto de docs/vitrine e põe na vitrine ── */
  const textos = JSON.parse(readFileSync(join(RAIZ, 'docs/vitrine/descricoes-produtos.json'), 'utf8'));
  let aplicados = 0;
  for (const p of estoque.listar()) {
    if (!textos[p.sku]) { continue; }
    const r = estoque.editar(p.sku, { descricao: textos[p.sku], naVitrine: true });
    if (r?.ok !== false) { aplicados += 1; }
  }
  ok('todo produto real tem descrição no rascunho (docs/vitrine)', aplicados === total, `${aplicados}/${total}`);

  await pg.reload({ waitUntil: 'load' }); await espera(2500);
  const depois = await linhaGoogle(pg);
  ok(`depois: Google ${total} de ${total} prontos, botão Baixar ativo`, new RegExp(`${total} de ${total} produto\\(s\\) prontos`).test(depois)
    && await pg.locator('.stat-row:has-text("Google Merchant Center") .btn-p').isEnabled(), depois);
  for (const nome of ['Meta', 'TikTok']) {
    const l = (await pg.locator(`.stat-row:has-text("${nome}")`).first().innerText()).replace(/\s+/g, ' ');
    ok(`depois: ${nome} ${total} de ${total} prontos`, new RegExp(`${total} de ${total} produto`).test(l), l);
  }
  await tira(pg, '2-estoque-depois');

  /* ── Loja: passo a passo + verificação ── */
  pg = await abrir('loja');
  const card = async () => (await pg.locator('.card:has-text("Aparecer no Google Shopping")').innerText()).replace(/\s+/g, ' ');
  ok('Loja: passo 1 mostra os prontos', new RegExp(`Produtos prontos: ${total} de ${total}`).test(await card()));
  const codes = (await pg.locator('code').allInnerTexts()).join(' ');
  ok('Loja: endereços dos 3 feeds (Google, Meta, TikTok)', ['/vitrine/google.xml', '/vitrine/meta.csv', '/vitrine/tiktok.csv'].every((u) => codes.includes(u)));
  await pg.fill('#gsCodigo', '<meta name="google-site-verification" content="abc" />');
  await pg.click('.gs-verif .btn-p'); await espera(800);
  ok('Loja: tag <meta> recusada com o caminho certo', /Arquivo HTML/.test(await pg.locator('body').innerText()));
  await pg.fill('#gsCodigo', 'google1a2b3c4d5e6f7a8b.html');
  await pg.click('.gs-verif .btn-p'); await espera(1200);
  ok('Loja: arquivo salvo, passo 2 marcado', /Site verificado: google1a2b3c4d5e6f7a8b\.html/.test(await card()));
  await tira(pg, '3-loja');
  const vr = await fetch(`${base}/google1a2b3c4d5e6f7a8b.html`);
  ok('arquivo de verificação responde na RAIZ, sem login, com o conteúdo do Google', vr.status === 200
    && (await vr.text()) === 'google-site-verification: google1a2b3c4d5e6f7a8b.html');
  ok('outro código na raiz não responde', (await fetch(`${base}/google0000000000000000.html`)).status !== 200);

  /* ── feeds públicos ── */
  const gx = await fetch(`${base}/vitrine/google.xml`); const xml = await gx.text();
  ok(`feed Google: ${total} itens, sem login`, gx.status === 200 && gx.headers.get('x-vs-incluidos') === String(total) && (xml.match(/<item>/g) || []).length === total);
  const xmlOk = await pg.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'application/xml'); return !d.querySelector('parsererror') && d.getElementsByTagName('item').length; }, xml);
  ok('feed Google: XML válido (o leitor do Chrome abre sem erro)', xmlOk === total);
  ok('feed Google: todo item com id, título, descrição, link, imagem, preço BRL, disponibilidade, marca', ['g:id', 'g:title', 'g:description', 'g:link', 'g:image_link', 'g:availability', 'g:brand']
    .every((tag) => (xml.match(new RegExp(`<${tag}>`, 'g')) || []).length === total) && (xml.match(/<g:price>\d+\.\d{2} BRL<\/g:price>/g) || []).length === total);
  const links = [...xml.matchAll(/<g:link>([^<]+)<\/g:link>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const paginas = await Promise.all(links.map((l) => fetch(l).then((r) => r.status)));
  ok('cada link do feed abre a página do produto (200)', paginas.every((s) => s === 200), paginas.join(','));
  const fotos = [...xml.matchAll(/<g:image_link>([^<]+)<\/g:image_link>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const fotosSt = await Promise.all(fotos.map((f) => fetch(f, { method: 'HEAD' }).then((r) => r.status).catch(() => 0)));
  ok('cada foto do feed carrega (endereço público)', fotosSt.every((s) => s === 200), fotosSt.join(','));
  for (const [nome, rota] of [['Meta', 'meta.csv'], ['TikTok', 'tiktok.csv']]) {
    const r = await fetch(`${base}/vitrine/${rota}`); const csv = await r.text();
    const linhas = csv.trim().split('\n');
    ok(`feed ${nome}: ${total} linhas + cabeçalho, com o link da vitrine, sem login`, r.status === 200 && linhas.length === total + 1 && linhas.slice(1).every((l) => l.includes(`${base}/vitrine/p/`)), `${linhas.length - 1} linha(s)`);
  }

  const cel = await abrir('loja', { width: 390, height: 844 });
  ok('celular: Loja sem rolagem horizontal', await cel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await tira(cel, '4-loja-celular');
  ok('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));
} finally { await nav.close(); }
const n = R.filter(Boolean).length;
console.log(`\n${n}/${R.length} passaram`);
process.exit(n === R.length ? 0 : 1);
