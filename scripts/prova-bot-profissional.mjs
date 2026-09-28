#!/usr/bin/env node
/**
 * Prova do "atendente profissional pronto" (Bot — personalizar), num Chrome de
 * verdade, em instância ISOLADA (pasta temporária, 127.0.0.1, sem canal real):
 *
 *   ① foto + nome + profissão → ② jeito → ③ prévia da conversa (nada no ar)
 *   → "Ligar atendente" grava os textos no bot do WhatsApp e o FLUXO não muda.
 *
 * Uso: node scripts/prova-bot-profissional.mjs [--telas <pasta>]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
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

const casa = mkdtempSync(join(tmpdir(), 'bolso-prof-'));
process.env.VS_HOME = casa;
const bot = await import(join(RAIZ, 'engine/vsbot/index.mjs'));
const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
bot.salvarConfig({ ativo: true, nome: 'Bia', saudacao: 'texto antigo' });
/* O fluxo de verdade da Micaela (cópia da demo) — é ele que não pode mudar. */
const fx = JSON.parse(readFileSync(join(homedir(), '.qa-gate-demo', 'vsbot', 'fluxo.json'), 'utf8'));
const gravou = bot.salvarFluxo(fx.passos || fx);
const fluxoAntes = JSON.stringify(bot.getFluxo());
acesso.criar(randomBytes(18).toString('base64url'));
const t = randomBytes(24).toString('base64url');
mkdirSync(join(casa, 'console'), { recursive: true });
writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [createHash('sha256').update(t).digest('hex')]:
  { email: 'admin@loja.prova', papel: 'admin', clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3600e3).toISOString() } }));

ok('fluxo real da Micaela carregado na casa isolada', gravou.ok && bot.getFluxo()?.passos?.length > 3, `${gravou.passos || gravou.erros} passos`);

const porta = 19800 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${porta}`;
const log = join(casa, 'painel.log');
filhos.push(spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
  env: { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1', RATE_CRM: '1000000',
    WHATSAPP_PROVIDER: 'log', PAINEL_URL: base, VITRINE_NOME: 'Loja Prova' } }));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { break; } } catch { /* subindo */ } await espera(250); }

const nav = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const erros = [];
try {
  for (const [nomeVp, vp] of [['desktop', { width: 1366, height: 860 }], ['celular', { width: 390, height: 844 }]]) {
    const pg = await (await nav.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => erros.push(`${nomeVp}: ${e.message}`));
    await pg.goto(`${base}/crm?t=${t}#wa-personalizar`, { waitUntil: 'load' }); await espera(2500);
    const tira = async (n) => { if (TELAS) { await pg.screenshot({ path: join(TELAS, `${nomeVp}-${n}.png`), fullPage: true }); } };
    ok(`${nomeVp}: passo 1 mostra as 5 profissões`, (await pg.locator('.pz-op').count()) === 5);
    ok(`${nomeVp}: sem rolagem horizontal`, await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await pg.fill('#pzwNome', 'Micaela');
    await pg.click('.pz-op:has-text("Vendedora")');
    ok(`${nomeVp}: nome sobrevive à escolha da profissão`, (await pg.inputValue('#pzwNome')) === 'Micaela');
    await tira('1-quem');
    await pg.click('.pz-nav .btn:has-text("Próximo")'); await espera(300);
    ok(`${nomeVp}: passo 2 mostra os 3 jeitos`, (await pg.locator('.pz-op').count()) === 3);
    await pg.click('.pz-op:has-text("Brincalhão")');
    await tira('2-jeito');
    await pg.click('.pz-nav .btn:has-text("Ver como fica")'); await espera(800);
    const conversa = await pg.locator('.pz-conversa').innerText();
    ok(`${nomeVp}: com fluxo, a prévia diz que a 1ª resposta é a do fluxo`, /a do seu fluxo de atendimento \(21 passos\)/.test(conversa));
    ok(`${nomeVp}: prévia no jeito escolhido (passar pra gente)`, /Bora chamar reforço/.test(conversa));
    ok(`${nomeVp}: horário da prévia preenchido`, !/\{horario\}/.test(conversa));
    ok(`${nomeVp}: prévia NÃO mexe no bot no ar`, bot.getConfig().saudacao === (nomeVp === 'desktop' ? 'texto antigo' : bot.getConfig().saudacao));
    await tira('3-previa');
    if (nomeVp === 'desktop') {
      await pg.click('.pz-nav .btn:has-text("Ligar atendente")'); await espera(400);
      await pg.locator('.modal .btn-p, [role=dialog] .btn-p').last().click(); await espera(2000);
      await tira('4-ligado');
      const c = bot.getConfig();
      ok('ligar grava os textos no bot do WhatsApp (nome, profissão, jeito)', c.nome === 'Micaela' && /Micaela, vendedora/.test(c.saudacao) && c.jeito === 'brincalhao' && c.profissao === 'vendedora');
      ok('ligar NÃO mexe no fluxo', JSON.stringify(bot.getFluxo()) === fluxoAntes);
      ok('ajuste fino continua lá, recolhido', (await pg.locator('details.pz-avancado').count()) === 1 && !(await pg.locator('details.pz-avancado').evaluate((d) => d.open)));
    }
  }
  /* FLUXO PRONTO (o "preenche automático"). A: loja COM fluxo e a caixa
     "Trocar" marcada → troca e guarda cópia. B: loja SEM fluxo → o fluxo da
     profissão entra sozinho, com os produtos do Estoque dela. */
  const estoque = await import(join(RAIZ, 'engine/vsestoque/index.mjs'));
  const semeou = [['crm', 'Bolso Cheio CRM', 'Sistemas', '199,00'], ['bot', 'Bot 24h', 'Sistemas', '99,00'], ['camiseta', 'Camiseta da marca', 'Brindes', '45,00']]
    .map(([sku, nome, categoria, preco]) => estoque.criar({ sku, nome, categoria, preco, quantidade: 10 }));
  ok('Estoque da loja de prova com 3 produtos em 2 categorias', semeou.every((s) => s.ok), semeou.filter((s) => !s.ok).map((s) => s.erros).join('; '));
  const pg = await (await nav.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  pg.on('pageerror', (e) => erros.push(`fluxo pronto: ${e.message}`));
  const tira = async (n) => { if (TELAS) { await pg.screenshot({ path: join(TELAS, `fluxo-${n}.png`), fullPage: true }); } };
  const atePrevia = async (profissao, jeito) => {
    await pg.goto(`${base}/crm?t=${t}#wa-personalizar`, { waitUntil: 'load' }); await espera(2500);
    await pg.evaluate(() => { PZ = null; render(); }); await espera(300);
    await pg.fill('#pzwNome', 'Micaela');
    await pg.click(`.pz-op:has-text("${profissao}")`);
    await pg.click('.pz-nav .btn:has-text("Próximo")'); await espera(300);
    await pg.click(`.pz-op:has-text("${jeito}")`);
    await pg.click('.pz-nav .btn:has-text("Ver como fica")'); await espera(900);
  };
  const ligar = async () => {
    await pg.click('.pz-nav .btn:has-text("Ligar atendente")'); await espera(400);
    await pg.locator('.modal .btn-p, .modal .btn-d').last().click(); await espera(2000);
  };

  await atePrevia('Vendedora', 'Meio a meio');
  ok('A: com fluxo, a caixa "Trocar pelo fluxo pronto" aparece desmarcada', (await pg.locator('#pzTrocar').count()) === 1 && !(await pg.isChecked('#pzTrocar')));
  await pg.check('#pzTrocar'); await espera(300);
  const previaA = await pg.locator('.pz-conversa').innerText();
  ok('A: marcada, a prévia mostra o menu pronto com os produtos do Estoque', /Ver os produtos e preços/.test(previaA) && /Sistemas/.test(previaA) && /Brindes/.test(previaA));
  ok('A: prévia com a caixa marcada ainda não troca nada', JSON.stringify(bot.getFluxo()) === fluxoAntes);
  await tira('A-trocar');
  await ligar();
  const fxA = bot.getFluxo();
  const copias = readdirSync(join(casa, 'vsbot')).filter((n) => n.startsWith('fluxo.antes-profissional-'));
  ok('A: ligar com "Trocar" põe o fluxo pronto no ar', fxA.inicio === 'inicio' && /Micaela, vendedora/.test(fxA.passos[0].mensagem));
  ok('A: o fluxo anterior ficou guardado como cópia, igual ao que era', copias.length === 1
    && JSON.stringify(JSON.parse(readFileSync(join(casa, 'vsbot', copias[0]), 'utf8'))) === fluxoAntes, copias.join(', '));

  bot.apagarFluxo();
  await atePrevia('Atendente de loja', 'Sério');
  const previaB = await pg.locator('.pz-conversa').innerText();
  ok('B: sem fluxo, não aparece a caixa de trocar', (await pg.locator('#pzTrocar').count()) === 0);
  ok('B: prévia mostra o menu pronto da profissão', /Acompanhar um pedido/.test(previaB) && /Micaela, atendente/.test(previaB));
  ok('B: prévia avisa que o fluxo é montado com o Estoque', /montado pra você/.test(await pg.locator('.pz-card').innerText()));
  ok('B: prévia não grava fluxo', bot.getFluxo() === null);
  await tira('B-previa');
  await ligar();
  const fxB = bot.getFluxo();
  ok('B: ligar grava o fluxo pronto sozinho', fxB?.passos?.some((p) => p.categoria === 'Sistemas') && fxB.passos.some((p) => p.categoria === 'Brindes'));
  const sim = await pg.evaluate(() => apiCru('bot/simular', { canal: 'whatsapp', mensagens: ['oi', '1', '1', '2'] })).catch((e) => ({ erro: e.message }));
  const falas = (sim.turnos || []).map((x) => [x.resposta?.texto, x.texto, x.bot].filter((s) => typeof s === 'string').join(' ')).join('\n---\n');
  ok('B: conversa simulada abre com o menu pronto', /Olá! Eu sou Micaela, atendente/.test(falas), falas.slice(0, 120) || JSON.stringify(sim).slice(0, 200));
  ok('B: "1" mostra as categorias do Estoque; a categoria mostra o produto com o preço de agora', /Sistemas/.test(falas) && /Bot 24h — R\$ 99,00/.test(falas));
  ok('B: escolher o produto pergunta se quer mais', /Deseja mais alguma coisa/.test(falas));
  await tira('B-ligado');

  ok('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));
} finally { await nav.close(); }
const n = R.filter(Boolean).length;
console.log(`\n${n}/${R.length} passaram`);
process.exit(n === R.length ? 0 : 1);
