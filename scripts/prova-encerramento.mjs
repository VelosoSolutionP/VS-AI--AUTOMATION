#!/usr/bin/env node
/**
 * Prova do encerramento (cliente ou atendente), avaliação e histórico — WhatsApp
 * e Telegram — em navegador de verdade, numa instância ISOLADA (pasta
 * temporária, Telegram falso, WhatsApp por webhook simulado no formato da Meta).
 *
 *   Ana (Telegram) pede gente → a vendedora Marta assume, responde e ENCERRA →
 *   Ana dá nota 2 e comenta · Bruno (Telegram) escreve "pode encerrar" e dá 5 ·
 *   Clara (WhatsApp) "era só isso" e dá 4 → os três saem da fila e aparecem no
 *   Histórico com quem encerrou, quem atendeu, nota e conversa; a Marta vê só
 *   o dela.
 *
 * Uso: node scripts/prova-encerramento.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-encerramento-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-encerramento-'));
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
  const api = async (rota, corpo, tk = token) => {
    const r = await fetch(`${base}/crm/api/${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crm-token': tk }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  let wid = 0;
  const whatsapp = (de, nome, texto) => fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: nome }, wa_id: de }], messages: [{ from: de, id: `wamid.t${wid++}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }] } }] }] }) });
  const saiuPara = async (chat) => (await (await fetch(`${tg.url}/bot/_enviados`, { method: 'POST' })).json()).result.filter((m) => m.chat === String(chat)).map((m) => m.texto);
  const errosJs = [];
  const pagina = async (tk, rotaIni, vp = { width: 1366, height: 900 }) => {
    const p = await navegador.newPage({ viewport: vp });
    p.on('pageerror', (e) => errosJs.push(e.message));
    await p.goto(`${base}/crm?t=${tk}#${rotaIni}`);
    return p;
  };
  try {
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);
    await api('funil', { etapas: ['Novo lead', 'Fechado'] });
    await api('bot/config', { ativo: true, nome: 'Bia' });
    await api('bot/config', { canal: 'telegram', ativo: true, nome: 'Tina' });
    const marta = await api('operadores/salvar', { nome: 'Marta Vendas', setor: 'vendas', email: 'marta@loja.teste' });
    await api('vendedores/acesso', { operadorId: marta.operador.id, email: 'marta@loja.teste', senha: 'senha-marta-1' });
    const ent = await api('entrar', { email: 'marta@loja.teste', senha: 'senha-marta-1' }, '');

    // Ana pede gente; Bruno e Clara ficam com o bot.
    await tg.escrever({ chat: 910001, nome: 'Ana Souza', texto: 'oi' });
    await tg.escrever({ chat: 910001, nome: 'Ana Souza', texto: 'quero falar com um atendente' });
    await tg.escrever({ chat: 910002, nome: 'Bruno Lima', texto: 'oi, vocês abrem sábado?' });
    await whatsapp('5531988880003', 'Clara Dias', 'bom dia');
    await espera(3500);
    const at0 = await api('atendimentos');
    ok('todas as conversas têm protocolo (loja sem fluxo em planilha)', at0.conversas.length === 3 && at0.conversas.every((c) => c.protocolo), at0.conversas.map((c) => `${c.nome}:${c.protocolo}`).join(' '));

    // ── Marta assume a Ana, responde e encerra pela tela ──
    const v = await pagina(ent.token, 'tg-atendimento');
    await v.waitForSelector('.fila-card:has-text("Ana Souza")');
    await v.click('.fila-card:has-text("Ana Souza") .fc-assumir');
    await v.waitForSelector('.gaveta #respTexto');
    await v.fill('#respTexto', 'Oi Ana, aqui é a Marta. Já resolvi o seu pedido!');
    await v.click('#btResponder');
    await espera(1200);
    await v.click('.gaveta button:has-text("Finalizar")');
    await v.waitForSelector('.modal:has-text("Posso ajudar em algo mais?")');
    await v.screenshot({ path: join(FOTOS, '01-finalizar-confirmacao.png') });
    await v.click('.modal button:has-text("Perguntar e finalizar")');
    await espera(1500);
    ok('Ana recebeu “Posso ajudar em algo mais?”', /algo mais/.test((await saiuPara(910001)).at(-1) || ''));
    await v.waitForSelector('.gaveta .cv-final');
    ok('tela mostra “Esperando o cliente responder”', await v.isVisible('.gaveta .cv-final'));
    await tg.escrever({ chat: 910001, nome: 'Ana Souza', texto: 'não, obrigada' });
    await espera(2000);
    const paraAna = await saiuPara(910001);
    ok('“não” finalizou: Ana recebeu protocolo + pedido de nota', /finalizado[\s\S]*Protocolo[\s\S]*1 a 5/.test(paraAna.at(-1) || ''), (paraAna.at(-1) || '').split('\n')[0]);
    await tg.escrever({ chat: 910001, nome: 'Ana Souza', texto: '2' });
    await espera(1500);
    ok('nota baixa: Ana foi convidada a comentar', /o que faltou/.test((await saiuPara(910001)).at(-1) || ''));
    await tg.escrever({ chat: 910001, nome: 'Ana Souza', texto: 'Demorou para alguém me responder' });
    // Bruno encerra sozinho e dá 5.
    await tg.escrever({ chat: 910002, nome: 'Bruno Lima', texto: 'pode encerrar' });
    await espera(1500);
    ok('Bruno encerrou escrevendo "pode encerrar" e recebeu o pedido de nota', /1 a 5/.test((await saiuPara(910002)).at(-1) || ''));
    await tg.escrever({ chat: 910002, nome: 'Bruno Lima', texto: '5' });
    // Clara encerra pelo WhatsApp e dá 4.
    await whatsapp('5531988880003', 'Clara Dias', 'era só isso, obrigada');
    await espera(1200);
    await whatsapp('5531988880003', 'Clara Dias', '4');
    await espera(2500);

    const at1 = await api('atendimentos');
    ok('encerrados saíram da fila (nada ativo)', at1.conversas.length === 0, at1.conversas.map((c) => c.nome).join(','));
    const ht = await api('atendimentos/historico?canal=telegram&dias=30');
    const por = (n) => ht.atendimentos.find((a) => a.nome === n);
    const ana = por('Ana Souza'), bruno = por('Bruno Lima');
    ok('histórico: Ana — FINALIZADO pela Marta, com motivo, nota 2 com comentário',
      ana?.desfecho === 'finalizado' && /pergunta final/.test(ana.motivoTexto || '') && ana?.encerradoPor?.tipo === 'atendente' && ana.encerradoPor.nome === 'Marta Vendas' && ana.atendidoPor?.nome === 'Marta Vendas' && ana.avaliacao?.nota === 2 && /Demorou/.test(ana.avaliacao?.comentario || ''),
      JSON.stringify({ por: ana?.encerradoPor, at: ana?.atendidoPor?.nome, av: ana?.avaliacao?.nota }));
    ok('histórico: Bruno — finalizado pelo cliente (frase como motivo), nota 5', bruno?.desfecho === 'finalizado' && bruno?.encerradoPor?.tipo === 'cliente' && /pode encerrar/.test(bruno.motivoTexto || '') && bruno.avaliacao?.nota === 5);
    ok('histórico: nota média 3,5 no Telegram', ht.resumo.media === 3.5, String(ht.resumo.media));
    const hw = await api('atendimentos/historico?canal=whatsapp&dias=30');
    ok('histórico do WhatsApp: Clara encerrou e deu 4', hw.atendimentos[0]?.nome === 'Clara Dias' && hw.atendimentos[0].encerradoPor?.tipo === 'cliente' && hw.atendimentos[0].avaliacao?.nota === 4);
    const hv = await api('atendimentos/historico?canal=telegram&dias=30', null, ent.token);
    ok('vendedora vê só os atendimentos dela no histórico', hv.atendimentos.map((a) => a.nome).join(',') === 'Ana Souza', hv.atendimentos.map((a) => a.nome).join(','));

    // ── dono na tela ──
    const d = await pagina(token, 'tg-atendimento');
    await d.waitForSelector('button:has-text("Histórico")');
    await d.click('button:has-text("Histórico")');
    await d.waitForSelector('.h-kpis');
    ok('tela Histórico (Telegram) com resumo e as duas linhas', (await d.$$('tbody tr')).length === 2 && (await d.textContent('.h-kpis')).includes('3,5 / 5'));
    await d.screenshot({ path: join(FOTOS, '02-historico-telegram.png'), fullPage: true });
    await d.click('.h-filtros button:has-text("Nota até 3")');
    ok('filtro "Nota até 3" mostra só a Ana', (await d.$$eval('tbody tr', (t) => t.map((x) => x.innerText))).join('|').includes('Ana Souza') && (await d.$$('tbody tr')).length === 1);
    await d.click('tbody tr:first-child');
    await d.waitForSelector('.modal .h-conversa');
    const modal = await d.textContent('.modal');
    ok('detalhe: desfecho, motivo, comentário e a conversa inteira', modal.includes('Finalizado') && modal.includes('pergunta final') && modal.includes('Demorou para alguém me responder') && modal.includes('Marta Vendas') && modal.includes('Já resolvi o seu pedido'));
    await d.screenshot({ path: join(FOTOS, '03-historico-detalhe.png') });
    await d.keyboard.press('Escape');
    await d.goto(`${base}/crm?t=${token}#wa-atendimento`); await d.reload();
    await d.waitForSelector('button:has-text("Histórico")');
    await d.click('button:has-text("Histórico")');
    await d.waitForSelector('tbody tr');
    ok('tela Histórico (WhatsApp) mostra a Clara com 4 estrelas', (await d.textContent('tbody')).includes('Clara Dias') && (await d.$$eval('.h-estrelas', (e) => e.map((x) => x.getAttribute('title')))).includes('nota 4 de 5'));
    await d.screenshot({ path: join(FOTOS, '04-historico-whatsapp.png') });

    const cel = await pagina(token, 'tg-atendimento', { width: 390, height: 844 });
    await cel.waitForSelector('button:has-text("Histórico")');
    await cel.click('button:has-text("Histórico")');
    await cel.waitForSelector('tbody tr');
    const larg = await cel.evaluate(() => document.documentElement.scrollWidth);
    ok('celular: histórico sem rolagem lateral da página', larg <= 390, `${larg}px`);
    await cel.screenshot({ path: join(FOTOS, '05-celular.png'), fullPage: true });

    // WhatsApp: o dono encerra pela TELA (botão no topo da conversa).
    await whatsapp('5531988880004', 'Diego Reis', 'oi, preciso de ajuda com meu pedido');
    await espera(2500);
    await d.goto(`${base}/crm?t=${token}#wa-atendimento`); await d.reload();
    await d.waitForSelector('.conversa:has-text("Diego Reis")');
    await d.click('.conversa:has-text("Diego Reis")');
    ok('sem assumir: Finalizar e Encerrar desabilitados', await d.isDisabled('.inbox-conversa .cv-cab button:has-text("Finalizar")') && await d.isDisabled('.inbox-conversa .cv-cab button:has-text("Encerrar")'));
    const semAssumir = await api('atendimentos/encerrar', { telefone: '5531988880004', motivo: 'teste' });
    ok('servidor também recusa encerrar sem assumir', semAssumir.status === 400 && /assuma/.test(semAssumir.erro || ''), semAssumir.erro);
    await d.click('.inbox-conversa .cv-cab button:has-text("Assumir atendimento")');
    await d.waitForSelector('.inbox-conversa .cv-cab button:has-text("Encerrar"):not([disabled])');
    await d.screenshot({ path: join(FOTOS, '06-whatsapp-botoes.png') });
    await d.click('.inbox-conversa .cv-cab button:has-text("Encerrar")');
    await d.waitForSelector('#encMotivo');
    await d.click('.modal button.btn-d');
    ok('encerrar sem motivo é recusado na tela', await d.isVisible('.toast.t-err:has-text("Diga o motivo")'));
    await d.selectOption('#encMotivo', 'Conversa ofensiva ou pesada');
    await d.screenshot({ path: join(FOTOS, '07-encerrar-motivo.png') });
    await d.click('.modal button.btn-d');
    // O aviso ao cliente espera o WhatsApp responder (aqui ele nem está conectado): aguarda o resultado.
    let diego = null;
    for (let i = 0; i < 40 && !diego; i++) {
      await espera(500);
      diego = (await api('atendimentos/historico?canal=whatsapp&dias=30')).atendimentos.find((a) => a.nome === 'Diego Reis');
    }
    ok('WhatsApp: encerrado à força, com motivo, sem pedir nota, saiu da fila', diego?.desfecho === 'encerrado' && diego.motivoTexto === 'Conversa ofensiva ou pesada' && !diego.avaliacao && !(await api('atendimentos')).conversas.some((c) => c.nome === 'Diego Reis'), JSON.stringify({ d: diego?.desfecho, m: diego?.motivoTexto }));
    ok('aviso que não chegou diz o porquê', await d.isVisible('.toast.t-err:has-text("o aviso não chegou ao cliente")'));

    // Conversa antiga, de antes de todo atendimento ter protocolo: encerra do mesmo jeito.
    const antigo = await api('leads', { nome: 'Cliente Antigo', telefone: '31977776666' });
    const telA = antigo.lead?.telefone || '5531977776666';
    await api('atendimentos/assumir', { telefone: telA });
    const encA = await api('atendimentos/encerrar', { telefone: telA, avisar: false, motivo: 'Engano / spam' });
    ok('conversa antiga sem protocolo também encerra (ganha protocolo na hora)', encA.ok && /^VS-/.test(encA.protocolo || ''), encA.erro || encA.protocolo);

    // Sem atendimento: a tela mostra bot, canal, equipe e o dia — não um vazio.
    for (const [r0, nomeC] of [['tg-atendimento', 'Telegram'], ['wa-atendimento', 'WhatsApp']]) {
      await d.goto(`${base}/crm?t=${token}#${r0}`); await d.reload();
      await d.waitForSelector('.tranq');
      await d.waitForSelector('.tranq-card:has-text("finalizado")');
      if (nomeC === 'Telegram') { await d.waitForSelector('.tranq-equipe li'); }
      const t = await d.textContent('.tranq');
      if (nomeC === 'Telegram') {
        ok('Telegram sem atendimento: dados do Telegram (bot do Telegram, quem atendeu pelo Telegram), nada do WhatsApp',
          t.includes('Tina ativo') && t.includes('@loja_teste_bot') && t.includes('Marta Vendas') && /1 atendimento/.test(t) && !t.includes('Bia') && !/whatsapp/i.test(t) && await d.isVisible('.tranq-ic.tg'), t.replace(/\s+/g, ' ').slice(0, 160));
      } else {
        ok(`${nomeC} sem atendimento: mostra bot ativo, a equipe (Marta) e o resumo do dia`, t.includes('Bia ativo') && t.includes('Marta Vendas') && /\d+ finalizado/.test(t), t.replace(/\s+/g, ' ').slice(0, 120));
      }
      await d.screenshot({ path: join(FOTOS, `08-vazio-${nomeC.toLowerCase()}.png`) });
    }

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
