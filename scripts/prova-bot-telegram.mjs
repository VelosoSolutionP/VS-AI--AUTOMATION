#!/usr/bin/env node
/**
 * Prova de "um bot por canal" em navegador de verdade, numa instância ISOLADA.
 *
 * O bot do WhatsApp se chama Micaela. A tela Telegram → Bot abre com a cópia,
 * o dono renomeia pra "Tina", salva — e: o WhatsApp continua Micaela, o cliente
 * do Telegram é respondido pela Tina, e a tela de atendimento do Telegram mostra
 * a Tina. Cada bot com as suas configurações.
 *
 * Uso: node scripts/prova-bot-telegram.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-bot-telegram-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-bot-tg-'));
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
  const saiuPara = async (chat) => (await (await fetch(`${tg.url}/bot/_enviados`, { method: 'POST' })).json()).result.filter((m) => m.chat === String(chat)).map((m) => m.texto);
  const errosJs = [];
  try {
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);
    await api('funil', { etapas: ['Novo lead', 'Fechado'] });
    await api('bot/config', { ativo: true, nome: 'Micaela', assinarMensagens: true, mensagemFallback: 'Sou a {assistente} do WhatsApp, não entendi.' });

    const p = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    p.on('pageerror', (e) => errosJs.push(e.message));
    await p.goto(`${base}/crm?t=${token}#tg-bot`);
    await p.waitForSelector('#bcNome');
    const menu = await p.$$eval('.sub-item', (b) => b.map((x) => x.innerText.trim()));
    ok('menu do Telegram tem "Bot do Telegram"', menu.includes('Bot do Telegram'));
    ok('tela é do bot do Telegram e nasce como cópia (Micaela)', (await p.textContent('.page-head')).includes('Telegram · Bot') && (await p.inputValue('#bcNome')) === 'Micaela');
    await p.fill('#bcNome', 'Tina');
    await p.fill('#bcFall', 'Aqui é a Tina, do Telegram. Não entendi — pode repetir?');
    await p.screenshot({ path: join(FOTOS, '01-tela-bot-telegram.png'), fullPage: true });
    await p.click('button:has-text("Salvar"):not(:has-text("regras"))');
    await espera(1500);
    const bTg = await api('bot?canal=telegram'), bWa = await api('bot');
    ok('salvou só no bot do Telegram', bTg.config?.nome === 'Tina' && bWa.config?.nome === 'Micaela', `tg=${bTg.config?.nome} wa=${bWa.config?.nome}`);

    await p.goto(`${base}/crm?t=${token}#bot-regras`); await p.reload();
    await p.waitForSelector('#bcNome');
    ok('tela do bot do WhatsApp continua com a Micaela', (await p.inputValue('#bcNome')) === 'Micaela' && (await p.textContent('.page-head')).includes('Bot do WhatsApp'));

    await tg.escrever({ chat: 940001, nome: 'Ana', texto: 'xyzzy blablabla' });
    await espera(2500);
    const r = (await saiuPara(940001)).at(-1) || '';
    ok('cliente do Telegram é respondido pela Tina, com a mensagem do bot do Telegram', /Tina/.test(r) && /do Telegram/.test(r) && !/Micaela/.test(r), r.slice(0, 120));

    await p.goto(`${base}/crm?t=${token}#tg-atendimento`); await p.reload();
    await p.waitForSelector('.fila-card');
    ok('atendimento do Telegram mostra o bot do Telegram ligado', await p.isVisible('.badge:has-text("Bot ativo")'));
    await p.screenshot({ path: join(FOTOS, '02-atendimento-telegram.png') });
    ok('sem erro de JavaScript na tela', !errosJs.length, errosJs.slice(0, 3).join(' / '));
  } finally {
    await navegador.close().catch(() => {});
    proc.kill('SIGTERM');
    tg.filho.kill('SIGTERM');
    rmSync(casa, { recursive: true, force: true });
  }
  const falhas = verif.filter((v) => !v.ok).length;
  console.log(`\n${verif.length - falhas}/${verif.length} verificações ok · fotos em ${FOTOS}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
