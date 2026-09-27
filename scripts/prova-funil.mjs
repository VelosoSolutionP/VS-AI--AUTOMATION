#!/usr/bin/env node
/**
 * Prova do FUNIL AUTOMÁTICO em navegador de verdade (instância isolada + Telegram falso).
 *
 *   Ana pede pelo bot (X-Tudo + lata) → pedido R$ 34 → lead vai pra "Proposta" com valor
 *   Bruno pede gente → o dono assume e responde pela tela → lead vai pra "Em atendimento"
 *   o pagamento do pedido da Ana é confirmado → ao abrir o CRM ela é Ganho, na coluna "Fechado"
 *   Carla, aberta e sem conversa há 5 dias → selo "parado" e KPI Esfriando
 *   o dono troca uma regra pela tela e ela fica gravada; celular sem rolagem lateral.
 *
 * O gateway de pagamento NÃO existe aqui (nada toca o Mercado Pago): o "pago" é
 * gravado no arquivo de pagamentos da instância de teste, como o webhook faria,
 * e a prova confere que o CRM fecha o lead sozinho a partir disso.
 * Uso: node scripts/prova-funil.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-funil-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-funil-'));
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
  const leadDe = async (nome) => (await api('painel')).leads.find((l) => l.nome === nome);
  try {
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);
    await api('funil', { etapas: ['Novo lead', 'Em atendimento', 'Proposta', 'Fechado'] });
    await api('bot/config', { canal: 'telegram', ativo: true, nome: 'Bia' }).catch(() => {});
    const imp = await api('bot/fluxo-csv', { canal: 'telegram', csv: CSV });
    ok('fluxo de pedido (X-Tudo + bebida → cobrar) importado no bot do Telegram', imp.status === 200 && !imp.erro, imp.erro || '');
    const p0 = await api('painel');
    ok('regras padrão pelo nome das etapas: contato = Em atendimento, proposta = Proposta',
      p0.automacao?.contato === 'Em atendimento' && p0.automacao?.proposta === 'Proposta' && p0.automacao?.ligada, JSON.stringify(p0.automacao));

    for (const t of ['oi', '1', '1']) { await tg.escrever({ chat: 920001, nome: 'Ana Pedido', texto: t }); await espera(700); }
    for (const t of ['oi', '2']) { await tg.escrever({ chat: 920002, nome: 'Bruno Humano', texto: t }); await espera(700); }
    await espera(2500);

    const ana = await leadDe('Ana Pedido');
    ok('pedido pelo bot: Ana foi pra "Proposta" sozinha, com o valor do pedido', ana?.etapa === 'Proposta' && ana?.valor === 34, `${ana?.etapa} · ${ana?.valor}`);
    ok('histórico da Ana marca o movimento como automático', ana?.historico?.some((h) => h.tipo === 'etapa' && h.auto && /cobrança do pedido/.test(h.motivo || '')));
    const bruno0 = await leadDe('Bruno Humano');
    ok('Bruno (só falou com o bot) continua em "Novo lead"', bruno0?.etapa === 'Novo lead', bruno0?.etapa);

    // ── dono responde o Bruno pela tela ──
    const dono = await pagina('tg-atendimento');
    await dono.waitForSelector('.fila-card:has-text("Bruno Humano")');
    await dono.click('.fila-card:has-text("Bruno Humano") .fc-assumir');
    await dono.waitForSelector('.gaveta #respTexto');
    await dono.fill('#respTexto', 'Oi Bruno, aqui é o dono. Em que posso ajudar?');
    await dono.click('#btResponder');
    await espera(1500);
    const bruno = await leadDe('Bruno Humano');
    ok('equipe respondeu pela tela: Bruno foi pra "Em atendimento"', bruno?.etapa === 'Em atendimento', bruno?.etapa);
    await dono.close();

    // ── o pagamento da Ana cai (como o webhook gravaria) ──
    const res = lerJson('vsresultados', 'resultados.json');
    const ped = res.pedidos.find((p) => p.telefone === ana.telefone);
    ok('pedido da Ana registrado (R$ 34,00)', ped?.valorCentavos === 3400, ped?.referencia);
    ped.pagamentoId = 'pg-prova-1';
    gravarJson(res, 'vsresultados', 'resultados.json');
    gravarJson([{ id: 'pg-prova-1', estado: 'CONFIRMADO', valorCentavos: 3400, metodo: 'PIX', referencia: ped.referencia,
      criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(), historico: [{ para: 'CONFIRMADO', quando: new Date().toISOString() }] }], 'vspagamentos', 'pagamentos.json');

    // ── Carla: aberta e parada há 5 dias ──
    await api('leads', { nome: 'Carla Parada', telefone: '5531977776666' });
    const leads = lerJson('vscrm', 'leads.json');
    const velho = new Date(Date.now() - 5 * 86400000).toISOString();
    const carla = leads.find((l) => l.nome === 'Carla Parada');
    carla.criadoEm = velho; carla.historico = carla.historico.map((h) => ({ ...h, quando: velho }));
    gravarJson(leads, 'vscrm', 'leads.json');

    // ── CRM no navegador ──
    const crm = await pagina('crm');
    await crm.waitForSelector('#funilAuto');
    const anaFim = await leadDe('Ana Pedido');
    ok('pagamento confirmado: Ana virou Ganho sozinha, na coluna "Fechado"', anaFim?.status === 'ganho' && anaFim?.etapa === 'Fechado', `${anaFim?.status} · ${anaFim?.etapa}`);
    ok('motivo do ganho aponta o pedido pago', /pagamento confirmado · pedido/.test(anaFim?.historico?.at(-1)?.motivo || ''));
    const kpis = await crm.$$eval('.kpi', (ks) => ks.map((k) => k.innerText.replace(/\s+/g, ' ')));
    ok('KPI Ganhos = 1 e Conversão 100%', kpis.some((k) => /Ganhos 1\b/i.test(k)) && kpis.some((k) => /Conversão 100%/i.test(k)), kpis.join(' | '));
    ok('KPI Esfriando = 1 (Carla)', kpis.some((k) => /Esfriando 1\b/i.test(k)), kpis.find((k) => /Esfriando/i.test(k)));
    ok('cartão Funil automático mostra as etapas escolhidas', (await crm.inputValue('#faContato')) === 'Em atendimento' && (await crm.inputValue('#faProposta')) === 'Proposta');
    ok('Carla com selo "parado há 5 dias" na lista', await crm.isVisible('tr:has-text("Carla Parada") .tag:has-text("parado há 5 dias")'));
    ok('Ana aparece como ganho na lista', await crm.isVisible('tr:has-text("Ana Pedido") .badge:has-text("ganho")'));
    await crm.screenshot({ path: join(FOTOS, '01-crm-funil-automatico.png'), fullPage: true });

    // quadro do funil
    await crm.selectOption('select[title="Como exibir"]', 'funil');
    await crm.waitForSelector('.board');
    const colunas = await crm.$$eval('.board .col', (cs) => cs.map((c) => c.innerText.replace(/\s+/g, ' ')));
    ok('quadro: Bruno em "Em atendimento", Carla em "Novo lead" com selo, Ana fora do aberto',
      colunas.some((c) => /^Em atendimento/.test(c) && c.includes('Bruno Humano')) && colunas.some((c) => /^Novo lead/.test(c) && c.includes('Carla Parada') && c.includes('parado há 5')) && !colunas.some((c) => c.includes('Ana Pedido')), colunas.join(' || '));
    await crm.screenshot({ path: join(FOTOS, '02-quadro.png'), fullPage: true });
    await crm.selectOption('select[title="Como exibir"]', 'tabela');

    // dono troca regra pela tela
    await crm.waitForSelector('#faContato');
    await crm.selectOption('#faContato', '');
    await crm.fill('#faDias', '7');
    await crm.click('#funilAuto button:has-text("Salvar regras")');
    await espera(1200);
    const p1 = await api('painel');
    ok('regra trocada pela tela ficou gravada (contato = não mover, 7 dias)', p1.automacao.contato === null && p1.automacao.diasEsfriar === 7, JSON.stringify(p1.automacao));
    ok('com 7 dias, Carla (5 dias) sai do Esfriando', p1.resumo.esfriando === 0, String(p1.resumo.esfriando));
    const rec = await api('funil/automacao', { contato: 'Coluna que não existe' });
    ok('etapa fora do funil é recusada', rec.status >= 400, rec.erro || rec.motivo || String(rec.status));
    await crm.close();

    // celular
    const cel = await pagina('crm', { width: 390, height: 844 });
    await cel.waitForSelector('#funilAuto');
    const larg = await cel.evaluate(() => document.documentElement.scrollWidth);
    ok('celular: CRM com o cartão do funil sem rolagem lateral', larg <= 390, `${larg}px`);
    await cel.screenshot({ path: join(FOTOS, '03-celular.png'), fullPage: true });

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
