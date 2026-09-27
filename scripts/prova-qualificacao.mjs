#!/usr/bin/env node
/**
 * Prova da qualificação e roteamento de leads (WhatsApp + Telegram) em navegador de verdade.
 *
 * Três clientes chegam: um pequeno (fica com o bot), um com integração de ERP
 * (vai para Especialistas → Marta) e uma rede com 12 vendedores pelo WhatsApp
 * (vai para Corporativo → Rui). O dono vê a oportunidade de cada um; a Marta
 * entra com o acesso de vendedora e vê SÓ o cliente dela, assume e responde.
 *
 * (Cabeçalho herdado da prova de campanhas:)
 *
 * Sobe uma instância ISOLADA do painel (pasta temporária, ambiente limpo — nada
 * do painel.env), com o Telegram falso do teste de volume, cadastra um produto
 * de exemplo pela própria API e percorre o assistente clicando na tela:
 *
 *   promoção com preço errado no texto → auditor pede correção e trava →
 *   corrige → auditor libera → aprova → link → /start com o código no
 *   Telegram falso → a tabela mostra entradas e conversa da campanha.
 *
 * Tira fotos em `--fotos <pasta>` (padrão: pasta temporária) e sai com código 1
 * se alguma verificação falhar. Uso: node scripts/prova-qualificacao.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-qualificacao-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-qualificacao-'));
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
  const whatsapp = (de, nome, texto, id) => fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: nome }, wa_id: de }], messages: [{ from: de, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }] } }] }] }) });
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
    await api('funil', { etapas: ['Novo lead', 'Qualificado', 'Fechado'] });
    await api('bot/config', { ativo: true, nome: 'Bia' }).catch(() => {});
    const marta = await api('operadores/salvar', { nome: 'Marta Especialista', setor: 'comercial', tier: 2, email: 'marta@loja.teste' });
    const rui = await api('operadores/salvar', { nome: 'Rui Corporativo', setor: 'comercial', tier: 3 });
    const fin = await api('operadores/salvar', { nome: 'Fábio Financeiro', setor: 'financeiro', tier: 3 });
    ok('comercial com dois tiers (Marta T2, Rui T3); fora do comercial não tem tier', marta.operador?.tier === 2 && rui.operador?.tier === 3 && fin.operador?.tier === null, JSON.stringify([marta.operador?.tier, rui.operador?.tier, fin.operador?.tier]));
    // Empresa com dois níveis: operação grande vai pro Tier 3.
    const q0 = await api('qualificacao');
    const matriz = q0.matriz.map((r) => (r.id === 'porte' ? { ...r, tier: 3, nome: 'Operação com 10+ vendedores vai para o Tier 3' } : r));
    const cfg = await api('qualificacao/salvar', { matriz, tiers: [{ nome: 'Venda consultiva' }, { nome: 'Grandes contas' }] });
    ok('dois tiers humanos configurados', cfg.ok && cfg.tiers.length === 2, (cfg.tiers || []).map((t) => `${t.n}:${t.nome}`).join(', '));
    const acesso = await api('vendedores/acesso', { operadorId: marta.operador.id, email: 'marta@loja.teste', senha: 'senha-marta-1' });
    ok('acesso de vendedora criado para a Marta', acesso.ok, acesso.erro || acesso.email);

    await tg.escrever({ chat: 900001, nome: 'Paula Pequena', texto: 'Quero comprar um bot de vendas, só eu na loja' });
    await tg.escrever({ chat: 900002, nome: 'Carlos Rede', texto: 'Tenho 35 vendedores, três lojas e preciso integrar o CRM ao meu ERP.' });
    await whatsapp('5531990000003', 'Wagner Atacado', 'Somos uma rede com 12 vendedores e queremos o bot de vendas padrão', 'wamid.teste.1');
    await espera(4000);

    const at = await api('atendimentos');
    const por = (n) => at.conversas.find((c) => c.nome === n);
    const paula = por('Paula Pequena'), carlos = por('Carlos Rede'), wagner = por('Wagner Atacado');
    ok('Tier 1: cliente pequeno fica com o bot', paula?.comercial?.decisao?.tier === 1 && paula.situacao === 'com-bot', paula?.comercial?.decisao?.motivo);
    const paraPaula = (await (await fetch(`${tg.url}/bot/_enviados`, { method: 'POST' })).json()).result.filter((m) => m.chat === '900001').map((m) => m.texto);
    ok('faltou dado: o bot perguntou o porte/integração ao cliente pequeno', paraPaula.some((t) => /quantas pessoas ou lojas/.test(t)));
    ok('Tier 2 (Telegram): integração → comercial Tier 2 → Marta', carlos?.comercial?.decisao?.tier === 2 && carlos?.comercial?.responsavel?.nome === 'Marta Especialista' && carlos.situacao === 'aguardando', carlos?.comercial?.resumo);
    ok('Tier 3 (WhatsApp): 12 vendedores → comercial Tier 3 → Rui', wagner?.comercial?.decisao?.tier === 3 && wagner?.comercial?.responsavel?.nome === 'Rui Corporativo', wagner?.comercial?.resumo);
    const saiu = (await (await fetch(`${tg.url}/bot/_enviados`, { method: 'POST' })).json()).result.filter((m) => m.chat === '900002').map((m) => m.texto);
    ok('cliente do Tier 2 recebeu a mensagem de transferência', saiu.some((t) => /equipe comercial/.test(t)), saiu.at(-1));

    // ── dono ──
    const dono = await pagina(token, 'tg-atendimento');
    await dono.waitForSelector('.fila-card');
    ok('fila do Telegram mostra Tier 2 e o responsável no cartão', await dono.isVisible('.fila-col.sit-aguarda .fila-card:has-text("Carlos Rede") .q-tier.t2:has-text("Tier 2")') && await dono.isVisible('.fila-card:has-text("Carlos Rede") .q-resp:has-text("Marta")'));
    await dono.click('.fila-card:has-text("Carlos Rede")');
    await dono.waitForSelector('.gaveta .q-card');
    ok('conversa abre com a oportunidade comercial (resumo, ficha, próxima ação)', (await dono.textContent('.gaveta .q-card')).includes('35 vendedor') && (await dono.textContent('.gaveta .q-card')).includes('Avaliar a integração'));
    ok('linha do tempo registra encaminhamento e responsável', await dono.isVisible('.gaveta .cv-evento:has-text("Encaminhado para comercial")') && await dono.isVisible('.gaveta .cv-evento:has-text("Responsável: Marta")'));
    await dono.screenshot({ path: join(FOTOS, '01-dono-telegram-oportunidade.png') });
    await dono.keyboard.press('Escape');

    await dono.goto(`${base}/crm?t=${token}#wa-atendimento`); await dono.reload();
    await dono.waitForSelector('.conversa');
    await dono.click('.conversa:has-text("Wagner Atacado")');
    await dono.waitForSelector('.inbox-conversa .q-card');
    ok('WhatsApp: mesma oportunidade no inbox, com Rui responsável', (await dono.textContent('.inbox-conversa .q-card')).includes('Rui Corporativo') && await dono.isVisible('.conversa:has-text("Wagner Atacado") .q-resp'));
    await dono.screenshot({ path: join(FOTOS, '02-dono-whatsapp-oportunidade.png') });

    await dono.goto(`${base}/crm?t=${token}#qualificacao`); await dono.reload();
    await dono.waitForSelector('.q-regra');
    ok('tela de regras mostra a matriz e os tiers (T1 bot, T2 Marta, T3 Rui)', (await dono.$$('.q-regra')).length === 6 && (await dono.textContent('.q-tiers')).includes('Marta Especialista') && (await dono.$$eval('.q-tiers input', (i) => i.map((x) => x.value))).includes('Grandes contas'));
    await dono.fill('#qSimTxt', 'sou MEI, só eu, mas preciso integrar com o Bling');
    await dono.click('button:has-text("Testar")');
    await dono.waitForSelector('.q-sim');
    ok('teste da matriz: MEI com integração vai para o comercial Tier 2 (porte não decide sozinho)', (await dono.textContent('.q-sim')).includes('Tier 2 → comercial'));
    await dono.screenshot({ path: join(FOTOS, '03-regras-e-teste.png'), fullPage: true });
    // Cadastro de operador: campo Tier só aparece no setor comercial.
    await dono.goto(`${base}/crm?t=${token}#canais`); await dono.reload();
    await dono.waitForSelector('#opSetor');
    await dono.fill('#opSetor', 'financeiro');
    const tierFin = await dono.isVisible('#opTier');
    await dono.fill('#opSetor', 'Comercial');
    const tierCom = await dono.isVisible('#opTier');
    ok('cadastro: campo Tier só aparece para o setor comercial', !tierFin && tierCom);
    await dono.screenshot({ path: join(FOTOS, '03b-operador-tier.png') });

    // ── vendedora ──
    const ent = await api('entrar', { email: 'marta@loja.teste', senha: 'senha-marta-1' }, '');
    ok('Marta entra com e-mail e senha como vendedora', ent.papel === 'vendedor', ent.erro || '');
    const proib = await api('painel', null, ent.token);
    ok('servidor recusa a vendedora fora do Atendimento', proib.status === 403, `HTTP ${proib.status}`);
    const vAt = await api('atendimentos', null, ent.token);
    ok('Marta vê só o cliente dela (Carlos), não o do Rui nem o do bot', vAt.conversas.map((c) => c.nome).join(',') === 'Carlos Rede', vAt.conversas.map((c) => c.nome).join(','));
    const naoDela = await api('atendimentos/assumir', { telefone: wagner.telefone }, ent.token);
    ok('Marta não consegue assumir cliente da carteira do Rui', naoDela.status === 400 && /Rui/.test(naoDela.erro || ''), naoDela.erro);

    const v = await pagina(ent.token, 'tg-atendimento');
    await v.waitForSelector('.fila-card');
    const menu = await v.$$eval('#nav .nav-item', (b) => b.map((x) => x.innerText.trim()));
    ok('menu da vendedora tem só o Atendimento', menu.join('|') === 'WhatsApp|Telegram', menu.join('|'));
    await v.click('.fila-card:has-text("Carlos Rede") .fc-assumir');
    await espera(800);
    await v.fill('#respTexto', 'Oi Carlos, aqui é a Marta, especialista. Me conta qual ERP vocês usam?');
    await v.click('#btResponder');
    await espera(1500);
    // Assumir já abre a conversa no painel lateral.
    await v.waitForSelector('.gaveta .cv-evento:has-text("assumiu")');
    ok('a conversa registra que foi a Marta quem assumiu', await v.isVisible('.gaveta .cv-evento:has-text("Marta Especialista assumiu")'));
    const saiu2 = (await (await fetch(`${tg.url}/bot/_enviados`, { method: 'POST' })).json()).result.filter((m) => m.chat === '900002').map((m) => m.texto);
    ok('resposta da Marta chegou ao cliente no Telegram', saiu2.some((t) => /aqui é a Marta/.test(t)));
    await v.screenshot({ path: join(FOTOS, '04-vendedora.png') });

    const cel = await pagina(ent.token, 'tg-atendimento', { width: 390, height: 844 });
    await cel.waitForSelector('.fila-card');
    await cel.click('.fila-card:has-text("Carlos Rede")');
    await cel.waitForSelector('.gaveta .q-card');
    ok('celular: cartão nasce fechado e abre no toque', !(await cel.$eval('.gaveta .q-card', (e) => e.open)));
    await cel.click('.gaveta .q-card summary');
    await cel.screenshot({ path: join(FOTOS, '05b-celular-tela.png') });
    const larg = await cel.evaluate(() => document.documentElement.scrollWidth);
    ok('celular: oportunidade cabe sem rolagem lateral', larg <= 390, `${larg}px`);
    await cel.screenshot({ path: join(FOTOS, '05-celular.png'), fullPage: true });

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
