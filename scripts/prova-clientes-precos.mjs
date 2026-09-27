#!/usr/bin/env node
/**
 * Prova de CLIENTES E LICENÇAS + PREÇOS, em navegador de verdade, numa
 * instância ISOLADA:
 *
 *   cadastro pela tela com UM plano (módulo Telegram → Prata) → detalhe com as
 *   etapas e o que foi liberado → contrato gerado → aba Preços: Telegram Prata
 *   (com contrato) vira versão nova e Bronze (sem cliente) muda no lugar → quem
 *   assinou continua no preço do contrato → vitrine e cadastro novo já saem com
 *   o preço novo → adendo de banda com preço → filtros e busca da carteira.
 *
 * Uso: node scripts/prova-clientes-precos.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-clientes-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-clientes-'));
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
    await api('clientes/salvar', { nome: 'Maria Souza', documento: '52998224725', whatsapp: '11977776666', produtos: ['whats-bronze'], ciclo: 'mensal' });
    const d = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    d.on('pageerror', (e) => errosJs.push(e.message));
    await d.goto(`${base}/crm?t=${token}#clientes`);
    await d.waitForSelector('button[role=tab]:has-text("Preços")');
    ok('Clientes e licenças tem as abas Carteira e Preços', await d.isVisible('button[role=tab]:has-text("Carteira")'));
    await d.click('button:has-text("Novo cliente")');
    await d.waitForSelector('.cli-planos');
    const cards0 = await d.locator('.cli-plano').count();
    ok('cadastro mostra UM módulo por vez (3 planos), não 15 caixas', cards0 === 3, `${cards0} cartões`);
    await d.click('.seg button:has-text("Telegram")');
    await d.waitForSelector('.cli-plano:has-text("Prata").on');
    ok('módulo Telegram: Bronze, Prata e Gold; Prata (mais escolhido) já vem marcado', (await d.locator('.cli-plano').allTextContents()).map((t) => t.trim().split(/\s/)[0]).join(',') === 'Bronze,Prata,Gold');
    ok('ciclos do catálogo: Mensal e Semestral', await d.isVisible('input[name=clCiclo][value=semestral]') && !(await d.isVisible('input[name=clCiclo][value=anual]')));
    await d.check('input[name=clCiclo][value=semestral]');
    ok('semestral mostra o total do semestre com desconto', /cobrança semestral de/.test(await d.textContent('#clPreco')), (await d.textContent('#clPreco')).trim());
    await d.check('input[name=clCiclo][value=mensal]');
    await d.fill('#clNome', 'Padaria Pão Quente LTDA'); await d.fill('#clDoc', '11222333000181'); await d.fill('#clWa', '31988887777');
    await d.screenshot({ path: join(FOTOS, '01-cadastro.png'), fullPage: true });
    await d.click('#btSalvarCliente');
    await d.waitForSelector('.cli-etapas');
    const det = await d.textContent('#view');
    ok('detalhe: Telegram Prata, etapas no topo e liberado em cartões (3 operadores, 5 GB)', /Telegram Prata/.test(det) && await d.locator('.cli-etapa').count() === 4 && /Operadores\s*3/.test(await d.textContent('.cli-lib')) && /5 GB/.test(await d.textContent('.cli-lib')));
    await d.screenshot({ path: join(FOTOS, '02-detalhe.png'), fullPage: true });
    const cli = (await api('clientes')).clientes.find((c) => c.nome.startsWith('Padaria'));
    const k = await api('clientes/contrato', { id: cli.id });
    ok('contrato gerado no preço da tabela (R$ 129/mês)', k.ok && k.contrato.valorCiclo === 12900, k.erro || k.contrato?.valorCiclo);

    // ── Preços ──
    await d.goto(`${base}/crm?t=${token}#clientes`); await d.reload();
    await d.click('button[role=tab]:has-text("Preços")');
    await d.waitForSelector('.pr-mod[data-mod=telegram]');
    ok('Preços: um bloco por módulo (WhatsApp, Telegram, Redes, Combo) + adendos', await d.locator('.pr-mod').count() === 4 && /Adendos/.test(await d.textContent('#view')));
    ok('Telegram Prata avisa que tem cliente com contrato', /1 cliente\(s\) com contrato/.test(await d.textContent('.pr-mod[data-mod=telegram] tr[data-code="telegram-prata"]')));
    await d.fill('.pr-mod[data-mod=telegram] tr[data-code="telegram-prata"] [data-k=monthly_price]', '149,00');
    await d.fill('.pr-mod[data-mod=telegram] tr[data-code="telegram-bronze"] [data-k=monthly_price]', '89,00');
    await d.fill('.pr-mod[data-mod=telegram] tr[data-code="telegram-bronze"] [data-k=storage_limit_mb]', '2');
    await d.screenshot({ path: join(FOTOS, '03-precos.png'), fullPage: true });
    await d.click('.pr-mod[data-mod=telegram] button:has-text("Salvar Telegram")');
    await d.waitForSelector('.toast:has-text("versão nova")');
    ok('salvar: Prata vira versão nova (quem assinou fica no preço antigo)', /Prata: versão nova/.test(await d.textContent('.toast')), (await d.textContent('.toast')).trim().slice(0, 140));
    const pr = await api('precos');
    const tgp = pr.planos.filter((p) => p.module === 'telegram');
    ok('catálogo: Prata v2 a R$ 149 à venda, Bronze a R$ 89 com 2 GB no lugar', tgp.some((p) => p.code === 'telegram-prata-v2' && p.monthly_price === 14900 && p.destaque) && tgp.some((p) => p.code === 'telegram-bronze' && p.monthly_price === 8900 && p.storage_limit_mb === 2048) && !tgp.some((p) => p.code === 'telegram-prata'));
    const cli2 = (await api('clientes')).clientes.find((c) => c.id === cli.id);
    ok('quem assinou continua no preço do contrato (R$ 129)', cli2.contratos.at(-1).valorCiclo === 12900 && !cli2.contratoDesatualizado && cli2.produtos[0] === 'telegram-prata');
    await d.fill('#prBd', '29,90'); await d.fill('#prBdGb', '20');
    await d.click('button:has-text("Salvar adendos")');
    await d.waitForSelector('.toast:has-text("Adendos salvos")');
    const bd = (await api('precos')).adicionais.find((a) => a.code === 'banda-extra');
    ok('adendo de banda com preço (R$ 29,90, +20 GB) — deixa de ser sob consulta', bd.monthly_price === 2990 && bd.gb === 20 && bd.sob_consulta === false, bd.name);

    // Vitrine e cadastro novo já com o preço novo.
    await d.goto(`${base}/crm?t=${token}#pl-planos`); await d.reload();
    await d.waitForSelector('.seg-mod button:has-text("Telegram")');
    await d.click('.seg-mod button:has-text("Telegram")');
    await d.waitForSelector('.tier');
    const vit = await d.textContent('.tier-grade');
    ok('vitrine Planos e preços: Telegram com Bronze R$ 89 e Prata R$ 149', /R\$\s*89,00/.test(vit) && /R\$\s*149,00/.test(vit) && !/R\$\s*129,00/.test(vit), vit.replace(/\s+/g, ' ').slice(0, 120));
    await d.screenshot({ path: join(FOTOS, '04-vitrine-telegram.png'), fullPage: true });
    await d.goto(`${base}/crm?t=${token}#clientes`); await d.reload();
    await d.waitForSelector('button:has-text("Novo cliente")');
    await d.click('button:has-text("Novo cliente")'); await d.click('.seg button:has-text("Telegram")');
    await d.waitForSelector('.cli-plano.on');
    ok('cadastro novo: Prata já no preço novo', /149,00/.test(await d.textContent('.cli-plano.on')));
    await d.click('button:has-text("Cancelar")');

    // Carteira: filtros e busca.
    await d.waitForSelector('#cliBusca');
    const carteira = await d.textContent('#view');
    ok('carteira: colunas Valor/mês (do contrato) e Vence em', /Valor\/mês/.test(carteira) && /Vence em/.test(carteira) && /R\$\s*129,00[\s\S]*do contrato/.test(carteira));
    await d.fill('#cliBusca', 'padaria'); await espera(200);
    ok('busca por nome filtra a carteira', await d.locator('tbody tr').count() === 1 && /Padaria/.test(await d.textContent('tbody')));
    await d.fill('#cliBusca', ''); await d.click('.seg button:has-text("Ativos")'); await espera(200);
    ok('filtro Ativos: ninguém (ainda sem chave)', /Nenhum cliente neste filtro/.test(await d.textContent('#view')));
    await d.click('.seg button:has-text("Todos")');
    await d.screenshot({ path: join(FOTOS, '05-carteira.png'), fullPage: true });

    const cel = await navegador.newPage({ viewport: { width: 390, height: 844 } });
    cel.on('pageerror', (e) => errosJs.push(e.message));
    await cel.goto(`${base}/crm?t=${token}#clientes`); await cel.waitForSelector('#cliBusca');
    const semRolagem1 = await cel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    await cel.click('button[role=tab]:has-text("Preços")'); await cel.waitForSelector('.pr-mod');
    const semRolagem2 = await cel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    ok('celular: carteira e preços sem rolagem lateral da página', semRolagem1 && semRolagem2);
    await cel.screenshot({ path: join(FOTOS, '06-precos-celular.png'), fullPage: true });
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
