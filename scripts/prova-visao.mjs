#!/usr/bin/env node
/**
 * Prova da VISÃO GERAL (painel do negócio) em navegador de verdade — instância
 * isolada + Telegram falso, nada toca produção nem gateway.
 *
 *   Ana pede pelo bot do Telegram e o pagamento é confirmado (gravado como o webhook faria)
 *   Bruno pede gente e fica na fila sem ninguém · Wagner fala pelo WhatsApp
 *   Carla está aberta e parada há 5 dias
 *
 * Confere na tela: receita, pedidos, leads novos por canal, conversão, "Precisa
 * de atenção agora", os quatro gráficos (com dica no hover e tabela "ver dados"),
 * troca de período, o atalho levando à tela certa, tema claro e celular.
 * Uso: node scripts/prova-visao.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-visao-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-visao-'));
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

const CSV = `passo,mensagem,opcao,texto_opcao,vai_para,acao,valor
inicio,"O que vai ser?",1,"X-Tudo",bebida,,"28,00"
inicio,,2,"Falar com alguem",,encaminhar_humano,
bebida,"Bebida?",1,"Refrigerante lata",fecha,,"6,00"
bebida,,2,"Sem bebida",fecha,,
fecha,"Fechou!",,,,cobrar,`;



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
  const whatsapp = (de, nome, texto, id) => fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: nome }, wa_id: de }], messages: [{ from: de, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }] } }] }] }) });
  const errosJs = [];
  const pagina = async (rotaIni, vp = { width: 1366, height: 900 }) => {
    const p = await navegador.newPage({ viewport: vp });
    p.on('pageerror', (e) => errosJs.push(e.message));
    await p.goto(`${base}/crm?t=${token}#${rotaIni}`);
    return p;
  };
  const arqJson = (...p) => join(casa, ...p);
  const lerJson = (...p) => JSON.parse(readFileSync(arqJson(...p), 'utf8'));
  const gravarJson = (dados, ...p) => { mkdirSync(dirname(arqJson(...p)), { recursive: true }); writeFileSync(arqJson(...p), JSON.stringify(dados, null, 2)); };
  try {
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);
    await api('funil', { etapas: ['Novo lead', 'Em atendimento', 'Proposta', 'Fechado'] });
    await api('bot/config', { canal: 'telegram', ativo: true, nome: 'Bia' }).catch(() => {});
    await api('bot/fluxo-csv', { canal: 'telegram', csv: CSV });

    // Tela vazia antes de tudo: nada inventado.
    const v0 = await pagina('visao');
    await v0.waitForSelector('.vis-kpis');
    const k0 = await v0.$$eval('.vis-kpis .aud-kpi', (ks) => ks.map((k) => k.innerText.replace(/\s+/g, ' ')));
    ok('sem dado: receita R$ 0,00, conversão e TPR “—” (nunca 0%)', /R\$ 0,00/.test(k0[0]) && /CONVERSÃO —|Conversão —/i.test(k0[3]) && /—/.test(k0[4]), k0.join(' | '));
    await v0.close();

    for (const t of ['oi', '1', '1']) { await tg.escrever({ chat: 930001, nome: 'Ana Pedido', texto: t }); await espera(700); }
    for (const t of ['oi', '2']) { await tg.escrever({ chat: 930002, nome: 'Bruno Fila', texto: t }); await espera(700); }
    await whatsapp('5531990000003', 'Wagner Zap', 'oi, bom dia', 'wamid.visao.1');
    await espera(2500);
    const res = lerJson('vsresultados', 'resultados.json');
    const ped = res.pedidos.find((p) => p.nome === 'Ana Pedido') || res.pedidos[0];
    ok('pedido da Ana registrado', ped?.valorCentavos === 3400, ped?.referencia);
    ped.pagamentoId = 'pg-visao-1';
    gravarJson(res, 'vsresultados', 'resultados.json');
    const agora = new Date().toISOString();
    gravarJson([{ id: 'pg-visao-1', estado: 'CONFIRMADO', valorCentavos: 3400, metodo: 'PIX', referencia: ped.referencia, criadoEm: agora, atualizadoEm: agora, historico: [{ para: 'CONFIRMADO', quando: agora }] }], 'vspagamentos', 'pagamentos.json');
    await api('leads', { nome: 'Carla Parada', telefone: '5531977776666' });
    const leads = lerJson('vscrm', 'leads.json');
    const velho = new Date(Date.now() - 5 * 86400000).toISOString();
    const carla = leads.find((l) => l.nome === 'Carla Parada');
    carla.criadoEm = velho; carla.historico = carla.historico.map((h) => ({ ...h, quando: velho }));
    gravarJson(leads, 'vscrm', 'leads.json');

    const v = await pagina('visao');
    await v.waitForSelector('.vis-kpis');
    const k = await v.$$eval('.vis-kpis .aud-kpi', (ks) => ks.map((x) => x.innerText.replace(/\s+/g, ' ')));
    ok('Receita confirmada R$ 34,00 · 1 pedido pago', /R\$ 34,00/.test(k[0]) && /1 pedido\(s\) pago/.test(k[0]), k[0]);
    ok('Pedidos = 1', /^PEDIDOS 1\b/i.test(k[1]), k[1]);
    ok('Leads novos = 4 (WhatsApp 2 · Telegram 2)', /LEADS NOVOS 4\b/i.test(k[2]) && /WhatsApp 2 · Telegram 2/.test(k[2]), k[2]);
    ok('Conversão 100% (Ana ganha pelo pagamento)', /100%/.test(k[3]), k[3]);
    const at = await v.$$eval('.vis-atencao .vis-at', (xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ')));
    ok('atenção: 1 na fila do Telegram, 0 no WhatsApp', at.some((t) => /^1 Na fila do Telegram/.test(t)) && at.some((t) => /^0 Na fila do WhatsApp/.test(t)), at.join(' | '));
    ok('atenção: 1 lead esfriando (Carla)', at.some((t) => /^1 Leads esfriando/.test(t)));
    const cores = await v.$$eval('.vis .aud-svg rect[fill^="var(--c-"]', (rs) => [...new Set(rs.map((r) => r.getAttribute('fill')))]);
    ok('gráfico de leads com as duas cores de canal', cores.includes('var(--c-wa)') && cores.includes('var(--c-tg)'), cores.join(','));
    ok('gráfico de receita desenhou a barra do dia', (await v.$$('.vis .grafico .g-barra')).length === 1);
    ok('funil com as etapas e barras', (await v.$$eval('.vis .aud-hb-l', (xs) => xs.map((x) => x.innerText))).some((t) => /Novo lead/.test(t)));
    await v.hover('.vis .aud-card:has-text("Leads novos por dia") .aud-hit:last-of-type');
    const dica = await v.textContent('.aud-tip').catch(() => '');
    ok('hover no gráfico mostra a dica do dia', /lead\(s\)/.test(dica || ''), dica);
    await v.click('.vis .aud-card:has-text("Leads novos por dia") details summary');
    ok('tabela "ver dados" abre com os números', /Telegram/.test(await v.textContent('.vis .aud-card:has-text("Leads novos por dia") details table')));
    await v.screenshot({ path: join(FOTOS, '01-visao-escuro.png'), fullPage: true });

    await v.click('.seg button:has-text("7 dias")');
    await v.waitForFunction(() => /7 dias anteriores/.test(document.querySelector('.aud-per')?.textContent || ''));
    ok('troca de período para 7 dias recarrega os números', /7 dias anteriores/.test(await v.textContent('.aud-per')));

    await v.click('.vis-at:has-text("Na fila do Telegram")');
    await v.waitForFunction(() => location.hash === '#tg-atendimento');
    ok('atalho da atenção leva à fila do Telegram', true);
    await v.close();

    const claro = await pagina('visao');
    await claro.waitForSelector('.vis-kpis');
    await claro.click('button:has-text("Claro")').catch(() => {});
    await espera(400);
    await claro.screenshot({ path: join(FOTOS, '02-visao-claro.png'), fullPage: true });
    await claro.close();

    const cel = await pagina('visao', { width: 390, height: 844 });
    await cel.waitForSelector('.vis-kpis');
    const larg = await cel.evaluate(() => document.documentElement.scrollWidth);
    ok('celular: Visão geral sem rolagem lateral', larg <= 390, `${larg}px`);
    await cel.screenshot({ path: join(FOTOS, '03-celular.png'), fullPage: true });

    ok('sem erro de JavaScript na tela', !errosJs.length, errosJs.slice(0, 3).join(' / '));
  } finally {
    await navegador.close().catch(() => {});
    proc.kill('SIGTERM');
    tg.filho.kill('SIGTERM');
    rmSync(casa, { recursive: true, force: true });
  }
  const falhas = verif.filter((x) => !x.ok).length;
  console.log(`\n${verif.length - falhas}/${verif.length} verificações ok · fotos em ${FOTOS}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
