#!/usr/bin/env node
/**
 * Prova da CENTRAL DE INTEGRAÇÕES (Configurações), em navegador de verdade,
 * numa instância ISOLADA com Telegram falso:
 *
 *   só integrações do Bolso Cheio (nada de Jira/Redmine/Slack do QA-Gate) →
 *   resumo bate com o servidor → Telegram conectado e o teste responde → "Testar
 *   tudo" → o Telegram cai → faixa "Uma integração parou" nas outras telas →
 *   dispensar o aviso → a faixa some. Celular sem rolagem lateral.
 *
 * Uso: node scripts/prova-integracoes.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-integracoes-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-integracoes-'));
  if (casa.startsWith(join(homedir(), '.qa-gate'))) { throw new Error('recusado: a pasta de teste não pode ser a de produção'); }
  const antes = process.env.VS_HOME;
  process.env.VS_HOME = casa;
  const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
  acesso.criar(randomBytes(18).toString('base64url'));
  const planos = await import(join(RAIZ, 'engine/vsplanos/index.mjs'));
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
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);
    const d = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    d.on('pageerror', (e) => errosJs.push(e.message));
    await d.goto(`${base}/crm?t=${token}#config`);
    await d.waitForSelector('.int-l');
    const nomes = await d.locator('.int-l .int-txt b').allTextContents();
    ok('só integrações do Bolso Cheio (nada do QA-Gate)', !nomes.some((n) => /jira|redmine|azure|slack|prompt|dashboard/i.test(n)) && nomes.includes('WhatsApp Web') && nomes.includes('Telegram'), nomes.join(', '));
    ok('agrupadas: Canais, Pagamentos, Redes e loja, Avisos e e-mail', ['Canais de atendimento', 'Pagamentos', 'Redes e loja', 'Avisos e e-mail'].every((g) => d.locator(`.card h3:has-text("${g}")`)) && await d.locator('.card h3:has-text("Avisos e e-mail")').count() === 1);
    const srv = await api('integracoes');
    const res = await d.textContent('.int-resumo');
    ok('resumo no topo bate com o servidor', res.includes(`${srv.resumo.ok}funcionando`) && res.includes(`${srv.resumo.desligadas}desligada`), res.replace(/\s+/g, ' '));
    ok('Telegram funcionando, com o bot; WhatsApp desligado com o motivo', /conectado/.test(await d.textContent('.int-l[data-int=telegram]')) && /desconectado|não montado/.test(await d.textContent('.int-l[data-int=whatsapp]')));
    ok('cada item tem botão para a tela onde se configura', await d.locator('.int-l[data-int=telegram] button:has-text("Gerenciar")').count() === 1 && await d.locator('.int-l[data-int=pagamento] button:has-text("Configurar")').count() === 1);
    await d.click('.int-l[data-int=telegram] button:has-text("Testar")');
    await d.waitForSelector('.int-l[data-int=telegram] .int-t.ok');
    ok('Testar Telegram: o serviço respondeu', /✔/.test(await d.textContent('.int-l[data-int=telegram] .int-t')), (await d.textContent('.int-l[data-int=telegram] .int-t')).trim());
    await d.click('button:has-text("Testar tudo")');
    await d.waitForSelector('.toast:has-text("teste")');
    ok('Testar tudo: resume quantos passaram', /teste\(s\) falharam|testes passaram/.test(await d.textContent('.toast')), (await d.textContent('.toast')).trim().slice(0, 100));
    await d.screenshot({ path: join(FOTOS, '01-integracoes.png'), fullPage: true });

    // O Telegram cai → faixa nas outras telas.
    await api('canais/desconectar', { canal: 'telegram' });
    await api('integracoes?forcar=1');
    await d.goto(`${base}/crm?t=${token}#visao`); await d.reload();
    await d.waitForSelector('.cons-faixa:has-text("parou")', { timeout: 15000 });
    ok('faixa "Uma integração parou" aparece nas outras telas', /Telegram/.test(await d.textContent('.cons-faixa')), (await d.textContent('.cons-faixa')).trim().slice(0, 120));
    await d.screenshot({ path: join(FOTOS, '02-faixa-parou.png') });
    await d.click('.cons-faixa button:has-text("Ver integrações")');
    await d.waitForSelector('.int-l[data-int=telegram].caiu');
    ok('na central, o Telegram aparece como "parou"', /parou/.test(await d.textContent('.int-l[data-int=telegram]')));
    await d.click('.int-l[data-int=telegram] button:has-text("Dispensar aviso")');
    await espera(800);
    await d.goto(`${base}/crm?t=${token}#visao`); await d.reload(); await espera(2500);
    ok('dispensado: a faixa some', await d.locator('.cons-faixa:has-text("parou")').count() === 0);

    const cel = await navegador.newPage({ viewport: { width: 390, height: 844 } });
    cel.on('pageerror', (e) => errosJs.push(e.message));
    await cel.goto(`${base}/crm?t=${token}#config`); await cel.waitForSelector('.int-l');
    ok('celular: sem rolagem lateral', await cel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await cel.screenshot({ path: join(FOTOS, '03-celular.png'), fullPage: true });
    ok('sem erro de JavaScript na tela', !errosJs.length, errosJs.slice(0, 3).join(' / '));
  } finally {
    await navegador.close().catch(() => {});
    proc.kill('SIGTERM');
    tg.filho.kill('SIGTERM');
    if (verif.some((v) => !v.ok)) { try { console.log('\n--- log da instância (fim) ---\n' + readFileSync(join(casa, 'painel-teste.log'), 'utf8').split('\n').slice(-25).join('\n')); } catch { /* sem log */ } }
    rmSync(casa, { recursive: true, force: true });
  }
  const falhas = verif.filter((v) => !v.ok).length;
  console.log(`\n${verif.length - falhas}/${verif.length} verificações ok · fotos em ${FOTOS}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
