#!/usr/bin/env node
/**
 * Prova da tela "Vendas do dia" + caixa (layout B), num Chrome de verdade, em
 * instância ISOLADA (pasta temporária, 127.0.0.1, sem canal real):
 *
 *   WhatsApp: números do dia, pico, mais vendidos, pedidos → abre o caixa,
 *   sangria, reforço, esperado certo → fecha e o histórico diz "bateu".
 *   Telegram: só os números DELE e o caixa DELE (nada do WhatsApp vaza).
 *   Celular: sem rolagem de lado, o caixa desce pra baixo do dia.
 *
 * Uso: node scripts/prova-vendas-dia.mjs [--telas <pasta>]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const casa = mkdtempSync(join(tmpdir(), 'bolso-vendas-'));
process.env.VS_HOME = casa;
const res = await import(join(RAIZ, 'engine/vsresultados/index.mjs'));
const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));

/* Um dia de vendas de hoje, nos DOIS canais. */
const hoje = res.diaBr();
const br = (hhmm) => new Date(`${hoje}T${hhmm}:00-03:00`).toISOString();
const it = (nome, reais) => ({ nome, valorCentavos: reais * 100 });
let n = 0;
const ped = (canal, hhmm, itens, pagamentoId = null) => res.registrarPedido({ referencia: `VS${9000 + ++n}`, pagamentoId, telefone: `55319999${String(n).padStart(4, '0')}`,
  canal, nome: `Cliente ${n}`, quando: br(hhmm), valorCentavos: itens.reduce((s, i) => s + i.valorCentavos, 0), itens });
ped('whatsapp', '11:20', [it('X-Tudo', 28)], 'p1');
ped('whatsapp', '12:05', [it('X-Tudo', 28), it('Refri', 6)], 'p2');
ped('whatsapp', '12:30', [it('X-Tudo', 28), { nome: 'Entrega Centro', valorCentavos: 500, taxa: true }], 'p3');
ped('whatsapp', '12:50', [it('Pizza', 50)]); // na entrega
ped('whatsapp', '19:10', [it('Refri', 6)], 'p4'); // aguardando
ped('telegram', '15:00', [it('Açaí', 20)], 'p5');
mkdirSync(join(casa, 'vspagamentos'), { recursive: true });
writeFileSync(join(casa, 'vspagamentos', 'pagamentos.json'), JSON.stringify([
  { id: 'p1', estado: 'CONFIRMADO', metodo: 'PIX' }, { id: 'p2', estado: 'CONFIRMADO', metodo: 'PIX' },
  { id: 'p3', estado: 'DISPONIVEL', metodo: 'CREDIT_CARD' }, { id: 'p4', estado: 'PENDENTE', metodo: 'PIX' },
  { id: 'p5', estado: 'CONFIRMADO', metodo: 'PIX' }]));

acesso.criar(randomBytes(18).toString('base64url'));
const t = randomBytes(24).toString('base64url');
mkdirSync(join(casa, 'console'), { recursive: true });
writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [createHash('sha256').update(t).digest('hex')]:
  { email: 'dono@loja.prova', papel: 'admin', clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3600e3).toISOString() } }));

const porta = 19700 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${porta}`;
const log = join(casa, 'painel.log');
filhos.push(spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
  env: { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1', RATE_CRM: '1000000',
    WHATSAPP_PROVIDER: 'log', PAINEL_URL: base, VITRINE_NOME: 'Loja Prova' } }));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { break; } } catch { /* subindo */ } await espera(250); }

const nav = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const erros = [];
const abrirTela = async (vp, hash) => {
  const pg = await (await nav.newContext({ viewport: vp })).newPage();
  pg.on('pageerror', (e) => erros.push(`${hash}: ${e.message}`));
  await pg.goto(`${base}/crm?t=${t}#${hash}`, { waitUntil: 'load' }); await espera(2500);
  return pg;
};
const tira = async (pg, nome) => { if (TELAS) { await pg.screenshot({ path: join(TELAS, `${nome}.png`), fullPage: true }); } };
const confirmarModal = async (pg) => { await pg.locator('#modalF .btn-p').click(); await espera(1200); };
const texto = async (pg, sel) => (await pg.locator(sel).first().innerText()).replace(/\s+/g, ' ');
try {
  /* ── WhatsApp, desktop ── */
  const pg = await abrirTela({ width: 1440, height: 900 }, 'wa-vendas');
  const menu = await pg.locator('nav, .side, aside').first().innerText().catch(() => '');
  ok('menu: "Vendas do dia" dentro do WhatsApp', /Vendas do dia/.test(menu) || (await pg.locator('text=Vendas do dia').count()) >= 1);
  const kp = await texto(pg, '.vd-kpis');
  ok('vendido = só confirmado (28 + 34 + 33 = R$ 95,00)', /Vendido R\$\s?95,00/i.test(kp), kp.slice(0, 80));
  ok('pedidos 4 (+1 aguardando)', /Pedidos 4/i.test(kp) && /1 aguardando/i.test(kp));
  ok('a receber na entrega R$ 50,00', /A receber na entrega R\$\s?50,00/i.test(kp));
  ok('ticket médio R$ 36,25 ((95 + 50) / 4)', /R\$\s?36,25/.test(kp));
  ok('pico: 12h–13h com 3 pedidos', /Pico: 12h–13h · 3 pedido/.test(await texto(pg, '.vd-centro')));
  ok('gráfico com a barra do pico destacada', (await pg.locator('.g-barra.vd-pico').count()) === 1);
  const top = await pg.locator('.vd-top').allInnerTexts();
  ok('mais vendido: X-Tudo, 3 un; sem a taxa de entrega', /X-Tudo/.test(top[0] || '') && /3 un/.test(top[0] || '') && !top.some((x) => /Entrega/.test(x)));
  ok('pedidos do dia: 5 na lista, com situação', (await pg.locator('.vd-lista .stat-row').count()) === 5 && /na entrega/.test(await texto(pg, '.vd-lista')));
  ok('layout B: caixa na lateral, à direita do dia', await pg.evaluate(() => {
    const a = document.querySelector('.vd-centro').getBoundingClientRect(); const b = document.querySelector('.vd-lado').getBoundingClientRect();
    return b.left >= a.right - 1 && Math.abs(b.top - a.top) < 4; }));
  ok('desktop: data e botões do dia numa linha só', await pg.evaluate(() => { const bs = [...document.querySelectorAll('.vd-dia > *')].map((e) => e.getBoundingClientRect().top); return Math.max(...bs) - Math.min(...bs) < 12; }));
  ok('caixa começa fechado', /Caixa fechado/.test(await texto(pg, '.vd-caixa')));
  await tira(pg, 'wa-1-dia');

  await pg.click('.vd-caixa .btn:has-text("Abrir caixa")'); await espera(300);
  await pg.fill('#vdTroco', '100,00'); await confirmarModal(pg);
  ok('abriu o caixa com R$ 100 de troco', /Caixa aberto/.test(await texto(pg, '.vd-caixa')) && /Troco inicial R\$\s?100,00/.test(await texto(pg, '.vd-caixa')));
  /* Venda na entrega DEPOIS de abrir: é essa que entra na gaveta (as de antes são de antes da abertura). */
  res.registrarPedido({ referencia: 'VS9100', telefone: '5531988887777', canal: 'whatsapp', nome: 'Cliente da noite', valorCentavos: 5000, itens: [it('Pizza', 50)] });
  await pg.click('.vd-dia .btn:has-text("Atualizar")'); await espera(1200);
  await pg.click('.vd-caixa .btn:has-text("Sangria")'); await espera(300);
  await pg.fill('#vdValor', '30'); await pg.fill('#vdMotivo', 'pagou o motoboy'); await confirmarModal(pg);
  await pg.click('.vd-caixa .btn:has-text("Reforço")'); await espera(300);
  await pg.fill('#vdValor', '50'); await pg.fill('#vdMotivo', 'troco do banco'); await confirmarModal(pg);
  const cxTxt = await texto(pg, '.vd-caixa');
  ok('esperado na gaveta = 100 + 50 − 30 + 50 (entrega) = R$ 170,00', /Deveria ter na gaveta R\$\s?170,00/.test(cxTxt), cxTxt.slice(0, 160));
  ok('movimentos listados com o motivo', /pagou o motoboy/.test(cxTxt) && /troco do banco/.test(cxTxt));
  await pg.click('.vd-caixa .btn:has-text("Sangria")'); await espera(300);
  await pg.fill('#vdValor', '9999'); await pg.fill('#vdMotivo', 'erro de digitação'); await pg.locator('#modalF .btn-p').click(); await espera(900);
  ok('sangria maior que a gaveta é recusada', (await pg.locator('body').innerText()).includes('maior que o dinheiro'));
  await pg.evaluate(() => fecharModal());
  await tira(pg, 'wa-2-caixa-aberto');

  await pg.click('.vd-caixa .btn:has-text("Fechar caixa")'); await espera(300);
  await pg.fill('#vdContado', '150,00'); await pg.fill('#vdMaq', '20,00'); await espera(200);
  ok('prévia do fechamento: bateu (170 − 20 da maquininha = 150)', /Bateu certinho: R\$\s?150,00/.test(await pg.locator('#vdPrevia').innerText()));
  await pg.fill('#vdContado', '145,00'); await espera(200);
  ok('prévia avisa quando falta', /Faltando R\$\s?5,00/.test(await pg.locator('#vdPrevia').innerText()));
  await pg.fill('#vdContado', '150,00');
  await tira(pg, 'wa-3-fechando');
  await confirmarModal(pg);
  const fechado = await texto(pg, '.vd-caixa');
  ok('fechou: caixa volta a fechado e o histórico diz "bateu"', /Caixa fechado/.test(fechado) && /bateu/.test(fechado), fechado.slice(0, 160));
  ok('sem rolagem horizontal (desktop)', await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await tira(pg, 'wa-4-fechado');

  /* ── Telegram: só o que é dele ── */
  const tg = await abrirTela({ width: 1440, height: 900 }, 'tg-vendas');
  const tgTxt = await texto(tg, 'main, .main, #app');
  ok('Telegram: título do Telegram', /Telegram · Vendas do dia/.test(tgTxt));
  ok('Telegram: vendido só dele (R$ 20,00), 1 pedido', /Vendido R\$\s?20,00/i.test(await texto(tg, '.vd-kpis')) && /Pedidos 1/i.test(await texto(tg, '.vd-kpis')));
  ok('Telegram: mais vendido é o Açaí; nada do WhatsApp', /Açaí/.test(await texto(tg, '.vd-centro')) && !/X-Tudo|Pizza/.test(await texto(tg, '.vd-centro')));
  ok('Telegram: caixa próprio, fechado, sem histórico do WhatsApp', /Caixa fechado/.test(await texto(tg, '.vd-caixa')) && !/bateu/.test(await texto(tg, '.vd-caixa')));
  await tira(tg, 'tg-1-dia');

  /* ── dia anterior: vazio, sem quebrar ── */
  await tg.click('.vd-dia .btn:has-text("Dia anterior")'); await espera(1500);
  ok('dia anterior sem venda: zeros e mensagem, sem erro', /Vendido R\$\s?0,00/i.test(await texto(tg, '.vd-kpis')) && /Nenhuma venda neste dia/.test(await texto(tg, '.vd-centro')));

  /* ── celular ── */
  const cel = await abrirTela({ width: 390, height: 844 }, 'wa-vendas');
  ok('celular: sem rolagem horizontal', await cel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('celular: caixa desce pra baixo do dia', await cel.evaluate(() => {
    const a = document.querySelector('.vd-centro').getBoundingClientRect(); const b = document.querySelector('.vd-lado').getBoundingClientRect(); return b.top >= a.bottom - 1 && b.left >= 0 && b.right <= innerWidth + 1 && b.width > 300; }));
  ok('celular: botão Abrir caixa visível e clicável', await cel.locator('.vd-caixa .btn:has-text("Abrir caixa")').isVisible());
  await tira(cel, 'cel-1-dia');

  ok('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));
} finally { await nav.close(); }
const ok_ = R.filter(Boolean).length;
console.log(`\n${ok_}/${R.length} passaram`);
process.exit(ok_ === R.length ? 0 : 1);
