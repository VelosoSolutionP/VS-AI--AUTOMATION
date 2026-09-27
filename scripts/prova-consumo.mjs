#!/usr/bin/env node
/**
 * Prova do CONSUMO (banda geral da instalação) e do MODO CONSULTA, em navegador
 * de verdade, numa instância ISOLADA com Telegram falso:
 *
 *   plano WhatsApp Bronze (1 GB/mês) → Telegram conversa → o medidor conta os
 *   bytes do Telegram e do painel → tela Telegram · Consumo mostra o geral e o
 *   recorte do canal → a banda estoura → faixa "Modo consulta" em todas as
 *   telas, escrita recusada (402), bot NÃO responde mas a mensagem que chega é
 *   gravada → cliente pede o adendo de banda → dono libera +10 GB → volta ao
 *   normal e o bot responde de novo. WhatsApp · Consumo com os dados dele.
 *
 * Uso: node scripts/prova-consumo.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-consumo-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-consumo-'));
  if (casa.startsWith(join(homedir(), '.qa-gate'))) { throw new Error('recusado: a pasta de teste não pode ser a de produção'); }
  const antes = process.env.VS_HOME;
  process.env.VS_HOME = casa;
  const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
  acesso.criar(randomBytes(18).toString('base64url'));
  const planos = await import(join(RAIZ, 'engine/vsplanos/index.mjs'));
  planos.assinar({ plano: 'whats-bronze' }); // 1 GB de banda por mês
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
  const api = async (rota, corpo, tk = token) => {
    const r = await fetch(`${base}/crm/api/${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crm-token': tk }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const saiuPara = async (chat) => (await (await fetch(`${tg.url}/bot/_enviados`, { method: 'POST' })).json()).result.filter((m) => m.chat === String(chat)).map((m) => m.texto);
  const errosJs = [];
  const GB = 1024 ** 3;
  try {
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);
    await api('funil', { etapas: ['Novo lead', 'Fechado'] });
    await api('bot/config', { canal: 'telegram', ativo: true, nome: 'Tina' });
    await tg.escrever({ chat: 920001, nome: 'Ana Souza', texto: 'oi' });
    await espera(2500);
    ok('bot respondeu no Telegram (normal)', (await saiuPara(920001)).length >= 1);
    await espera(5500); // o medidor descarrega a cada 5 s
    const c1 = await api('consumo?canal=telegram');
    ok('medidor contou bytes reais do Telegram e do painel', c1.porCategoria.telegram.total > 0 && c1.porCategoria.painel.total > 0,
      `telegram ${c1.porCategoria.telegram.total} B · painel ${c1.porCategoria.painel.total} B`);
    ok('limite = plano (1 GB), faixa normal', c1.limiteBytes === GB && c1.faixa === 'normal', `${c1.banda?.plano} ${c1.banda?.planoGb} GB`);

    const d = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    d.on('pageerror', (e) => errosJs.push(e.message));
    await d.goto(`${base}/crm?t=${token}#tg-consumo`);
    await d.waitForSelector('.cons-medidor');
    const t1 = await d.textContent('.viz.aud');
    ok('Telegram · Consumo: banda geral + recorte do Telegram + custo por mensagem', /BANDA DO MÊS · GERAL DO SISTEMA/.test(t1) && /Banda do Telegram/.test(t1) && /de 1 GB/.test(t1) && /não cobra por mensagem/.test(t1), t1.replace(/\s+/g, ' ').slice(0, 160));
    ok('Telegram · Consumo: "Para onde foi a banda" mostra as categorias', /Painel \(uso da equipe\)/.test(t1) && /Mídia guardada/.test(t1));
    await d.screenshot({ path: join(FOTOS, '01-consumo-normal.png'), fullPage: true });

    // ── A banda estoura: 1,2 GB de loja no mês (arquivo do medidor) ──
    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const arq = join(casa, 'vsconsumo', `${mes.slice(0, 7)}.json`);
    const doc = JSON.parse(readFileSync(arq, 'utf8'));
    (doc.dias[mes] ||= {}).loja = { e: 200 * 1024 ** 2, s: Math.round(1.0 * GB), n: 1 };
    writeFileSync(arq, JSON.stringify(doc));
    const c2 = await api('consumo?canal=telegram');
    ok('passou de 1 GB → modo consulta', c2.modoConsulta === true && c2.faixa === 'consulta', `${(c2.usadoBytes / GB).toFixed(2)} GB`);
    const w = await api('campanhas/politica', { intervaloHoras: 4, maxPorDia: 3 });
    ok('escrita recusada no servidor (402) com o motivo', w.status === 402 && /modo consulta/.test(w.erro || ''), w.erro);
    const antes = (await saiuPara(920001)).length;
    await tg.escrever({ chat: 920001, nome: 'Ana Souza', texto: 'vocês estão aí?' });
    await espera(2500);
    ok('modo consulta: o bot NÃO respondeu', (await saiuPara(920001)).length === antes);
    const leads = await api('painel');
    const ana = (leads.leads || []).find((l) => l.nome === 'Ana Souza' || String(l.telefone).endsWith('920001'));
    const hist = (await api('leads')).leads?.find?.((l) => l.id === ana?.id)?.historico || ana?.historico || [];
    ok('modo consulta: a mensagem que chegou ficou gravada', JSON.stringify(leads).includes('vocês estão aí?') || hist.some((h) => /estão aí/.test(h.texto || '')));

    await d.goto(`${base}/crm?t=${token}#tg-atendimento`); await d.reload();
    await d.waitForSelector('.cons-faixa.consulta');
    ok('faixa "Modo consulta" aparece nas outras telas', /Modo consulta/.test(await d.textContent('.cons-faixa')));
    await d.screenshot({ path: join(FOTOS, '02-faixa-consulta.png') });
    await d.click('.cons-faixa button');
    await d.waitForSelector('.cons-consulta');
    await d.screenshot({ path: join(FOTOS, '03-consumo-consulta.png'), fullPage: true });
    await d.click('.cons-consulta button:has-text("Contratar")');
    await espera(800);
    const c3 = await api('consumo?canal=telegram');
    ok('cliente pediu o adendo de banda (fica registrado)', c3.pedidos.some((p) => p.estado === 'aberto' && p.gb === 10));
    await d.waitForSelector('.cons-ped');
    await d.click('.cons-consulta button:has-text("Liberar banda adicional")');
    await d.waitForSelector('#bdGb');
    await d.fill('#bdMot', 'adendo de banda pago');
    await d.screenshot({ path: join(FOTOS, '04-liberar-banda.png') });
    await d.click('#modalF button:has-text("Liberar")');
    await d.waitForSelector('.cons-selo.atencao, .cons-selo.normal');
    const c4 = await api('consumo?canal=telegram');
    ok('dono liberou +10 GB: sai do modo consulta, pedido atendido', !c4.modoConsulta && c4.limiteBytes === 11 * GB && !c4.pedidos.some((p) => p.estado === 'aberto'), c4.faixa);
    // Cliente novo: a Ana já foi para a equipe (duas mensagens que o bot não entendeu).
    await tg.escrever({ chat: 920002, nome: 'Bruno Lima', texto: 'oi' });
    await espera(2500);
    ok('fora do modo consulta o bot volta a responder', (await saiuPara(920002)).length >= 1);
    await d.screenshot({ path: join(FOTOS, '05-consumo-liberado.png'), fullPage: true });

    await d.goto(`${base}/crm?t=${token}#wa-consumo`); await d.reload();
    await d.waitForSelector('.cons-medidor');
    const tw = await d.textContent('.viz.aud');
    ok('WhatsApp · Consumo: mesma banda geral, recorte do WhatsApp', /Banda do WhatsApp/.test(tw) && /WhatsApp Web/.test(tw) && !/Banda do Telegram/.test(tw) && !/Publicações/.test(tw));
    await d.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await espera(200);
    await d.screenshot({ path: join(FOTOS, '06-consumo-whatsapp-escuro.png'), fullPage: true });
    const cel = await navegador.newPage({ viewport: { width: 390, height: 844 } });
    await cel.goto(`${base}/crm?t=${token}#tg-consumo`); await cel.waitForSelector('.cons-medidor');
    ok('celular: sem rolagem lateral', await cel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await cel.screenshot({ path: join(FOTOS, '07-consumo-celular.png'), fullPage: true });
    ok('sem erro de JavaScript na tela', !errosJs.length, errosJs.slice(0, 3).join(' / '));
  } finally {
    await navegador.close().catch(() => {});
    proc.kill('SIGTERM');
    tg.filho.kill('SIGTERM');
    if (verif.some((v) => !v.ok)) { try { console.log('\n--- log da instância (fim) ---\n' + readFileSync(join(casa, 'painel-teste.log'), 'utf8').split('\n').slice(-40).join('\n')); } catch { /* sem log */ } }
    rmSync(casa, { recursive: true, force: true });
  }
  const falhas = verif.filter((v) => !v.ok).length;
  console.log(`\n${verif.length - falhas}/${verif.length} verificações ok · fotos em ${FOTOS}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
