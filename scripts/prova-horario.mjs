#!/usr/bin/env node
/**
 * Prova do horário de funcionamento em calendário, em navegador de verdade,
 * numa instância ISOLADA (pasta temporária, Telegram falso).
 *
 * Liga o horário na tela do bot, usa os atalhos (horário comercial, copiar para
 * os dias úteis, 2º turno, feriados nacionais), marca HOJE como data especial
 * fechada, salva — e confere que o cliente que escreve recebe "fechado" com a
 * data especial na mensagem. Pedir uma pessoa continua indo para a fila.
 *
 * Uso: node scripts/prova-horario.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-horario-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-horario-'));
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
    await api('bot/config', { ativo: true, nome: 'Bia' });
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

    const p = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    p.on('pageerror', (e) => errosJs.push(e.message));
    await p.goto(`${base}/crm?t=${token}#bot-regras`);
    await p.waitForSelector('#bcHorOn');
    await p.check('#bcHorOn');
    await p.waitForSelector('.hr-semana');
    ok('calendário aparece com os 7 dias', (await p.$$('.hr-semana .hr-linha')).length === 7);
    await p.click('button:has-text("Horário comercial")');
    // Segunda com 2º turno (almoço) e copiada para os dias úteis.
    await p.fill('.hr-semana .hr-linha:nth-child(1) input[type=time] >> nth=1', '12:00');
    await p.dispatchEvent('.hr-semana .hr-linha:nth-child(1) input[type=time] >> nth=1', 'change');
    await p.click('.hr-semana .hr-linha:nth-child(1) button:has-text("2º turno")');
    await p.click('button:has-text("Copiar segunda para os dias úteis")');
    ok('sexta ficou igual à segunda (dois turnos)', (await p.$$('.hr-semana .hr-linha:nth-child(5) input[type=time]')).length === 4);
    await p.click('button:has-text("Feriados nacionais")');
    const nFer = (await p.$$('.hr-esp .hr-linha')).length;
    ok('feriados nacionais que faltam no ano entraram como fechado', nFer >= 1, `${nFer} data(s)`);
    await p.click('button:has-text("Adicionar data")');
    const ult = '.hr-esp .hr-linha >> nth=-1';
    await p.fill(`${ult} >> input[type=date]`, hoje);
    await p.dispatchEvent(`${ult} >> input[type=date]`, 'change');
    await p.fill(`${ult} >> .hr-nome`, 'Inventário');
    await p.dispatchEvent(`${ult} >> .hr-nome`, 'input');
    await p.screenshot({ path: join(FOTOS, '01-calendario.png'), fullPage: true });
    await p.click('button:has-text("Salvar"):not(:has-text("regras"))');
    await espera(1200);
    const cfg = (await api('bot')).config;
    ok('salvou no formato do bot: semana com 2 turnos + datas especiais', cfg.horario?.seg === '08:00-12:00, 13:00-18:00' && cfg.horario?.sex === '08:00-12:00, 13:00-18:00' && cfg.horario?.dom === 'fechado' && cfg.horario?.excecoes?.[hoje]?.horario === 'fechado', JSON.stringify({ seg: cfg.horario?.seg, dom: cfg.horario?.dom, hoje: cfg.horario?.excecoes?.[hoje] }));

    await tg.escrever({ chat: 930001, nome: 'Cliente', texto: 'oi, vocês estão abertos?' });
    await espera(2500);
    const r = (await saiuPara(930001)).at(-1) || '';
    ok('hoje (data especial fechada) o bot responde que está fechado e mostra a data', /fechados/.test(r) && /Inventário\): fechado/.test(r), r.split('\n').slice(0, 2).join(' | '));
    ok('a mensagem mostra a semana com os dois turnos', /Segunda: 08:00 às 12:00 e 13:00 às 18:00/.test(r));
    await tg.escrever({ chat: 930002, nome: 'Outro', texto: 'quero falar com um atendente' });
    await espera(2500);
    const at = await api('atendimentos');
    ok('pedir uma pessoa fora do horário vai para a fila', at.conversas.some((c) => c.nome === 'Outro' && c.situacao === 'aguardando'));

    await p.reload(); await p.waitForSelector('#bcHorOn');
    ok('reabrindo a tela, o calendário volta como foi salvo', (await p.$$('.hr-esp .hr-linha')).length === nFer + 1 && (await p.$$eval('.hr-esp .hr-nome', (i) => i.map((x) => x.value))).includes('Inventário'));

    const cel = await navegador.newPage({ viewport: { width: 390, height: 844 } });
    cel.on('pageerror', (e) => errosJs.push(e.message));
    await cel.goto(`${base}/crm?t=${token}#bot-regras`);
    await cel.waitForSelector('.hr-semana');
    const larg = await cel.evaluate(() => document.documentElement.scrollWidth);
    ok('celular: calendário sem rolagem lateral', larg <= 390, `${larg}px`);
    await cel.screenshot({ path: join(FOTOS, '02-celular.png'), fullPage: true });
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
