#!/usr/bin/env node
/**
 * Prova do botão "Pôr na vitrine" do Estoque (instância isolada): o produto vai
 * pra loja e pro feed do Google SEM reservar saldo e sem passar pelo TikTok;
 * "Tirar da vitrine" na mesma linha tira. Uso: node scripts/prova-vitrine.mjs [--fotos dir]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, openSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_BOT = '123456789:AAHtesteDeVolumeSomenteLocal0000000000';
const args = process.argv.slice(2);
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-vitrine-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-vitrine-'));
  if (casa.startsWith(join(homedir(), '.qa-gate'))) { throw new Error('recusado: a pasta de teste não pode ser a de produção'); }
  const antes = process.env.VS_HOME;
  process.env.VS_HOME = casa;
  const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
  acesso.criar(randomBytes(18).toString('base64url'));
  process.env.VS_HOME = antes;
  const token = randomBytes(24).toString('base64url');
  mkdirSync(join(casa, 'console'), { recursive: true });
  writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [createHash('sha256').update(token).digest('hex')]: {
    email: 'dono@teste.local', papel: 'admin', clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3 * 3600e3).toISOString() } }));
  return { casa, token };
}

async function telegramFalso() {
  const arq = join(tmpdir(), `bolso-telegram-falso-${process.pid}.json`);
  const filho = spawn(process.execPath, [join(RAIZ, 'scripts/teste-volume-telegram.mjs'), '--servir-telegram-falso', arq], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !existsSync(arq); i++) { await espera(100); }
  const { url } = JSON.parse(readFileSync(arq, 'utf8'));
  rmSync(arq, { force: true });
  const post = async (m, corpo) => (await (await fetch(`${url}/bot/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo || {}) })).json()).result;
  return { url, filho, escrever: (d) => post('_escrever', d) };
}

async function subirPainel({ casa, telegramUrl }) {
  const porta = 20000 + Math.floor(Math.random() * 2000);
  const env = { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1',
    TELEGRAM_API_URL: telegramUrl, RATE_CRM: '1000000', PAINEL_URL: `http://127.0.0.1:${porta}` };
  const fd = openSync(join(casa, 'painel-teste.log'), 'a');
  const proc = spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, env, stdio: ['ignore', fd, fd] });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) { return { proc, base }; } } catch { /* subindo */ }
    await espera(250);
  }
  proc.kill('SIGKILL');
  throw new Error('a instância de teste não subiu — veja ' + join(casa, 'painel-teste.log'));
}


async function main() {
  const { chromium } = await import('playwright');
  const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
  const tg = await telegramFalso();
  const { casa, token } = await montarCasa();
  const { proc, base } = await subirPainel({ casa, telegramUrl: tg.url });
  const navegador = await chromium.launch(exe ? { executablePath: exe } : {});
  const api = async (rota, corpo) => {
    const r = await fetch(`${base}/crm/api/${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crm-token': token }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const errosJs = [];
  try {
    const cad = await api('estoque/produto', { sku: 'CAM-AZUL', nome: 'Camiseta azul', descricao: 'Algodão, P ao GG.', preco: '59,90', marca: 'Loja Teste' });
    ok('produto cadastrado', cad.ok !== false && !cad.erros?.length, (cad.erros || []).join('; '));
    await api('estoque/movimentar', { sku: 'CAM-AZUL', tipo: 'entrada', quantidade: 10 });
    const antes = (await api('estoque')).produtos.find((p) => p.sku === 'CAM-AZUL');
    const saldo = (p) => JSON.stringify({ saldo: p.saldo, reservado: p.reservado, disponivel: p.disponivel, movimentos: (p.movimentos || p.historico || []).length });
    ok('fora da vitrine no começo', antes && !antes.naVitrine, saldo(antes));

    const page = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => errosJs.push(e.message));
    await page.goto(`${base}/crm?t=${token}#estoque`);
    const linha = 'tr:has-text("Camiseta azul")';
    await page.waitForSelector(`${linha} button[title^="Pôr na vitrine"]`);
    await page.click(`${linha} button[title^="Pôr na vitrine"]`);
    await page.waitForSelector(`${linha} button[title="Tirar da vitrine"]`);
    ok('botão vira "Tirar da vitrine" e a linha ganha o selo vitrine', await page.isVisible(`${linha} .badge:has-text("vitrine")`));
    const depois = (await api('estoque')).produtos.find((p) => p.sku === 'CAM-AZUL');
    ok('não reservou saldo nem criou movimento', depois.naVitrine === true && saldo(depois) === saldo(antes), `${saldo(antes)} → ${saldo(depois)}`);
    const loja = await (await fetch(`${base}/vitrine`)).text();
    ok('aparece na loja pública', loja.includes('Camiseta azul'));
    const rf = await fetch(`${base}/vitrine/google.xml`);
    ok('chega ao feed do Google (sem foto: recusado com motivo, como o Google exige)', rf.headers.get('x-vs-recusados') === '1' && rf.headers.get('x-vs-incluidos') === '0', `incluídos ${rf.headers.get('x-vs-incluidos')} · recusados ${rf.headers.get('x-vs-recusados')}`);
    await page.screenshot({ path: join(FOTOS, '01-estoque-na-vitrine.png') });
    await page.click(`${linha} button[title="Tirar da vitrine"]`);
    await page.waitForSelector(`${linha} button[title^="Pôr na vitrine"]`);
    ok('"Tirar da vitrine" tira da loja', !(await (await fetch(`${base}/vitrine`)).text()).includes('Camiseta azul'));
    ok('sem erro de JavaScript na tela', !errosJs.length, errosJs.slice(0, 3).join(' / '));
  } finally {
    await navegador.close().catch(() => {});
    proc.kill('SIGTERM');
    tg.filho.kill('SIGTERM');
    await new Promise((r) => proc.once('exit', r)).catch(() => {});
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
  const falhas = verif.filter((x) => !x.ok).length;
  console.log(`\n${verif.length - falhas}/${verif.length} verificações ok · fotos em ${FOTOS}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
