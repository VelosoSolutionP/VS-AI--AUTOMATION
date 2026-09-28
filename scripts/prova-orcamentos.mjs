#!/usr/bin/env node
/**
 * Prova do Orçamento, de ponta a ponta, num navegador de verdade.
 *
 * Instância ISOLADA do painel (pasta temporária, só 127.0.0.1, sem credencial
 * herdada) ligada num Telegram FALSO — o mesmo do teste de volume. O cliente é
 * simulado; tudo o mais é o código de produção clicado no Chrome:
 *
 *   cliente pede orçamento → vendedora assume → monta pelo catálogo → envia →
 *   chega texto + link + PDF na conversa → cliente abre o link e aprova →
 *   confirmação na conversa, funil em proposta com o valor, painel "Aprovado"
 *   → cobrar sem gateway configurado mostra o erro (não finge que cobrou).
 *
 * Uso: node scripts/prova-orcamentos.mjs [--telas <pasta>]
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, openSync } from 'node:fs';
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
const limpar = () => { for (const p of filhos) { try { p.kill('SIGTERM'); } catch { /* saiu */ } } };
process.on('exit', limpar);

const R = []; const ok = (nome, cond, det = '') => { R.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  PASSOU' : '  FALHOU'}  ${nome}${det ? ' — ' + det : ''}`); };

/* ── Telegram falso ── */
const arq = join(tmpdir(), `tg-falso-orc-${process.pid}.json`);
filhos.push(spawn(process.execPath, [join(RAIZ, 'scripts/teste-volume-telegram.mjs'), '--servir-telegram-falso', arq], { stdio: 'ignore' }));
for (let i = 0; i < 50 && !existsSync(arq); i++) { await espera(100); }
const TG = JSON.parse(readFileSync(arq, 'utf8')).url; rmSync(arq, { force: true });
const tg = async (m, corpo) => (await (await fetch(`${TG}/bot/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo || {}) })).json()).result;

/* ── casa isolada ── */
const casa = mkdtempSync(join(tmpdir(), 'bolso-orc-'));
process.env.VS_HOME = casa;
const bot = await import(join(RAIZ, 'engine/vsbot/index.mjs'));
const crm = await import(join(RAIZ, 'engine/vscrm/index.mjs'));
const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
const operadores = await import(join(RAIZ, 'engine/vsoperadores/index.mjs'));
const estoque = await import(join(RAIZ, 'engine/vsestoque/index.mjs'));
crm.setFunil(['Novo lead', 'Em atendimento', 'Proposta', 'Fechado']);
bot.salvarConfig({ ativo: true, nome: 'Bia', falhasAteHumano: 3 });
bot.salvarRegra({ id: 'p-gente', termos: ['orcamento', 'vendedor'], resposta: 'Já chamei alguém da equipe pra montar seu orçamento!', handoff: true, prioridade: 5 });
estoque.criar({ sku: 'cad-ferro', nome: 'Cadeira de ferro', descricao: 'Cadeira dobrável', preco: '45,00', quantidade: 200, marca: 'Demo', categoria: 'Eventos' });
estoque.criar({ sku: 'mesa-6', nome: 'Mesa para 6 pessoas', descricao: 'Mesa retangular', preco: '120,00', quantidade: 40, marca: 'Demo', categoria: 'Eventos' });
const op = operadores.salvar({ id: 'op-ana', nome: 'Ana', setor: 'comercial' });
acesso.criar(randomBytes(18).toString('base64url'));
const sessao = (papel, extra = {}) => { const t = randomBytes(24).toString('base64url'); return [t, { email: `${papel}@loja.prova`, papel, clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3 * 3600e3).toISOString(), ...extra }]; };
const [tAdmin, sAdmin] = sessao('admin');
const [tAna, sAna] = sessao('vendedor', { operadorId: 'op-ana', nome: 'Ana' });
const [tBeto, sBeto] = sessao('vendedor', { operadorId: 'op-beto', nome: 'Beto', email: 'beto@loja.prova' });
mkdirSync(join(casa, 'console'), { recursive: true });
const hs = (t) => createHash('sha256').update(t).digest('hex');
writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [hs(tAdmin)]: sAdmin, [hs(tAna)]: sAna, [hs(tBeto)]: sBeto }));
ok('ambiente isolado montado (operador, catálogo, bot)', op.ok && estoque.listar().length === 2);

/* ── painel isolado ── */
const porta = 19900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${porta}`;
const log = join(casa, 'painel.log');
const painel = spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
  env: { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1', TELEGRAM_API_URL: TG, RATE_CRM: '1000000',
    PAINEL_URL: base, VITRINE_NOME: 'Loja Prova', CHROME_PATH: process.env.CHROME_PATH || '/usr/bin/google-chrome' } });
filhos.push(painel);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { break; } } catch { /* subindo */ } await espera(250); }
const api = async (rota, corpo, tok = tAdmin) => { const r = await fetch(`${base}/crm/api/${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crm-token': tok }, body: corpo ? JSON.stringify(corpo) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
ok('painel isolado conectou no Telegram falso', (await api('canais/conectar', { canal: 'telegram', token: '123456789:AAHprovaOrcamento0000000000000000000' })).ok);

const MARINA = { chat: 820000001, nome: 'Marina Eventos' };
const idTg = '999' + String(MARINA.chat).padStart(12, '0');
await tg('_escrever', { chat: MARINA.chat, nome: MARINA.nome, texto: 'Oi, preciso de um orçamento pra festa de sábado' });

const nav = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const erros = [];
try {
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => erros.push(e.message));
  await pg.goto(`${base}/crm?t=${tAna}#tg-atendimento`, { waitUntil: 'load' });
  const cartao = pg.locator('.fila-card', { hasText: MARINA.nome }).first();
  await cartao.locator('.fc-assumir').waitFor({ timeout: 30000 });
  ok('pedido de orçamento caiu na fila da equipe', true);
  await cartao.locator('.fc-assumir').click(); await espera(1500);
  if (!(await pg.locator('.gaveta #respTexto').isVisible())) { await cartao.click(); await espera(800); }
  ok('orçamento desligado (padrão): sem botão na conversa e sem item no menu da vendedora',
    await pg.locator('.gaveta button', { hasText: 'Orçamento' }).count() === 0 && !(await pg.locator('#nav').innerText()).includes('Orçamentos'));
  const vLiga = await api('orcamentos/config', { ligado: true }, tAna);
  ok('vendedora não consegue ligar o orçamento', vLiga.status === 403, `HTTP ${vLiga.status}`);
  const dLiga = await api('orcamentos/config', { ligado: true }, tAdmin);
  ok('o dono liga o orçamento do negócio', dLiga.ok === true && dLiga.config?.ligado === true);
  await pg.reload({ waitUntil: 'load' }); await espera(2500);
  await pg.locator('.fila-card', { hasText: MARINA.nome }).first().click(); await espera(1200);
  const btOrc = pg.locator('.gaveta button', { hasText: 'Orçamento' });
  ok('botão "Orçamento" dentro da conversa do Telegram', await btOrc.isVisible());
  ok('menu da vendedora tem "Orçamentos"', await pg.locator('#nav', { hasText: 'Orçamentos' }).isVisible());
  await btOrc.click();
  await pg.locator('.modal-orc').waitFor({ timeout: 10000 });
  ok('janela do orçamento abre por cima da tela', await pg.locator('#modalT', { hasText: 'Novo orçamento' }).isVisible());

  // erro: enviar vazio
  await pg.locator('#modalF button', { hasText: 'Salvar e enviar' }).click(); await espera(800);
  ok('orçamento vazio é recusado com o motivo na janela', /pelo menos um item/.test(await pg.locator('#orcErro').innerText()), await pg.locator('#orcErro').innerText());

  const itens = pg.locator('.orc-itens tbody tr');
  ok('item só se escolhe do catálogo (lista, sem campo livre)', await itens.nth(0).locator('select').count() === 1 && await itens.nth(0).locator('input[list]').count() === 0
    && (await itens.nth(0).locator('select option').allInnerTexts()).join('|') === 'Escolha do catálogo…|Cadeira de ferro|Mesa para 6 pessoas');
  await itens.nth(0).locator('select').selectOption('cad-ferro'); await espera(200);
  ok('escolher do catálogo traz o preço de lá', (await pg.locator('#orcP0').innerText()).includes('45,00'));
  await itens.nth(0).locator('input').nth(0).fill('30');
  await pg.locator('#modalB button', { hasText: 'Adicionar item' }).click(); await espera(300);
  await itens.nth(1).locator('select').selectOption('mesa-6');
  await itens.nth(1).locator('input').nth(0).fill('2');
  await pg.locator('.orc-par select').selectOption('percentual');
  await pg.locator('.orc-par input').fill('10');
  await pg.locator('.orc-grade input').nth(1).fill('50');
  await pg.locator('.orc-grade2 textarea').first().fill('50% na aprovação, restante na entrega.');
  await espera(300);
  // 30 × 45 = 1350 + 2 × 120 = 1590; −10% = 1431; + 50 frete = 1481
  const tot = await pg.locator('#orcTot').innerText();
  ok('total na tela: 30×45 + 2×120, −10%, + frete 50 = R$ 1.481,00', /1\.481,00/.test(tot), tot.replace(/\s+/g, ' '));
  if (TELAS) { await pg.screenshot({ path: join(TELAS, 'orc-1-janela.png') }); }
  await pg.locator('#modalF button', { hasText: 'Salvar e enviar' }).click();
  await pg.locator('#modalBg.show').waitFor({ state: 'detached', timeout: 1 }).catch(() => {});
  await espera(6000);

  const env = (await tg('_enviados')).filter((e) => e.chat === String(MARINA.chat));
  const msg = env.find((e) => /ORC-\d{4}-0001/.test(e.texto));
  ok('texto do orçamento chegou na conversa, com número, total e link', !!msg && /Total: R\$ 1\.481,00/.test(msg.texto) && /\/orcamento\//.test(msg.texto), msg ? msg.texto.split('\n').slice(0, 1).join('') : 'nada');
  const doc = env.find((e) => e.documento);
  ok('PDF chegou na conversa', !!doc && doc.pdf && /ORC-\d{4}-0001\.pdf/.test(doc.documento), doc ? `${doc.documento} · PDF de verdade: ${doc.pdf}` : 'nenhum documento');
  const link = (msg?.texto.match(/https?:\/\/\S+\/orcamento\/[A-Za-z0-9_-]+/) || [])[0];

  const lista1 = await api('orcamentos', null, tAna);
  const o1 = lista1.orcamentos?.[0];
  ok('painel: orçamento "Enviado", validade de 7 dias, vendedora Ana', o1?.situacao === 'enviado' && !!o1?.validoAte && o1?.vendedor?.nome === 'Ana', `${o1?.numero} ${o1?.situacao} até ${o1?.validoAte}`);
  const lead = (await api('crm')).leads?.find((l) => l.telefone === idTg) || crm.listar().find((l) => l.telefone === idTg);
  ok('funil: lead foi pra "Proposta" com o valor do orçamento', lead?.etapa === 'Proposta' && lead?.valor === 1481, `${lead?.etapa} · R$ ${lead?.valor}`);
  const fora = await api('orcamentos/salvar', { cliente: { telefone: idTg }, itens: [{ descricao: 'Camisa polo', quantidade: 1, preco: 80 }] }, tAna);
  ok('pela API também: item fora do catálogo é recusado', fora.ok === false && /catálogo/.test(fora.motivo), fora.motivo);
  const beto = await api('orcamentos', null, tBeto);
  ok('outro vendedor não vê o orçamento da Ana', (beto.orcamentos || []).length === 0);
  const betoEnv = await api('orcamentos/enviar', { id: o1?.id }, tBeto);
  ok('outro vendedor não consegue reenviar o orçamento da Ana', betoEnv.ok === false, betoEnv.motivo);

  // cliente abre o link (em outro navegador, sem login) e aprova
  const cli = await nav.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR' });
  const pc = await cli.newPage();
  await pc.goto(link, { waitUntil: 'load' });
  const corpo = await pc.locator('body').innerText();
  ok('página do orçamento abre sem login e mostra itens e total', /Cadeira de ferro/.test(corpo) && /Mesa para 6 pessoas/.test(corpo) && /R\$ 1\.481,00/.test(corpo) && /Loja Prova/.test(corpo));
  ok('página não aparece em busca (noindex)', await pc.locator('meta[name="robots"][content*="noindex"]').count() === 1);
  if (TELAS) { await pc.screenshot({ path: join(TELAS, 'orc-2-cliente.png'), fullPage: true }); }
  await pc.locator('button', { hasText: 'Aprovar orçamento' }).click(); await pc.waitForLoadState('load');
  ok('cliente aprovou: a página confirma', /Orçamento aprovado/.test(await pc.locator('body').innerText()));
  if (TELAS) { await pc.screenshot({ path: join(TELAS, 'orc-3-aprovado.png') }); }
  await espera(2500);
  const conf = (await tg('_enviados')).filter((e) => e.chat === String(MARINA.chat)).find((e) => /Recebemos a aprovação/.test(e.texto));
  ok('confirmação da aprovação chegou pro cliente na conversa', !!conf);
  const falso = await fetch(base + '/orcamento/' + 'x'.repeat(24)); ok('código inventado no link dá "não encontrado"', falso.status === 404);

  // painel: tela Orçamentos
  await pg.evaluate(() => { location.hash = 'orcamentos'; }); await espera(2500);
  const tela = await pg.locator('#view').innerText();
  ok('tela Orçamentos: linha "Aprovado" e total aprovado R$ 1.481,00', /Aprovado/.test(tela) && /R\$\s?1\.481,00/.test(tela));
  if (TELAS) { await pg.screenshot({ path: join(TELAS, 'orc-4-lista.png') }); }
  await pg.locator('.orc-lista button', { hasText: 'Cobrar por Pix' }).first().click(); await espera(400);
  await pg.locator('#modalF button', { hasText: 'Gerar e enviar' }).click(); await espera(3000);
  const aviso = await pg.locator('body').innerText();
  ok('sem gateway configurado, cobrar mostra o erro (não finge que cobrou)', /gateway não gerou|Não consegui/.test(aviso));
  const o2 = (await api('orcamentos', null, tAna)).orcamentos?.[0];
  ok('orçamento continua sem cobrança registrada', o2?.situacao === 'aprovado' && !o2?.cobranca);

  // duplicar vira rascunho novo
  const dup = await api('orcamentos/duplicar', { id: o1.id }, tAna);
  ok('duplicar gera um rascunho novo com o mesmo total', dup.ok && dup.orcamento.situacao === 'rascunho' && dup.orcamento.totalCentavos === 148100, dup.orcamento?.numero);
  const edAprov = await api('orcamentos/salvar', { id: o1.id, cliente: { telefone: idTg }, itens: [{ descricao: 'x', quantidade: 1, preco: 1 }] }, tAna);
  ok('orçamento aprovado não pode ser editado', edAprov.ok === false, edAprov.motivo);

  // celular: a janela do orçamento cabe
  const cel = await nav.newContext({ viewport: { width: 375, height: 800 }, locale: 'pt-BR' });
  const pm = await cel.newPage(); pm.on('pageerror', (e) => erros.push('celular: ' + e.message));
  await pm.goto(`${base}/crm?t=${tAna}#orcamentos`, { waitUntil: 'load' }); await espera(2500);
  await pm.locator('.orc-lista button', { hasText: 'Editar' }).first().click(); await espera(1500);
  const larg = await pm.evaluate(() => [document.querySelector('.modal-orc')?.getBoundingClientRect().width, innerWidth]);
  ok('celular: janela do orçamento abre e cabe na tela', larg[0] && larg[0] <= larg[1], `${Math.round(larg[0])} de ${larg[1]} px`);
  if (TELAS) { await pm.screenshot({ path: join(TELAS, 'orc-5-celular.png') }); }
} finally {
  await nav.close();
}
const quebras = readFileSync(log, 'utf8').split('\n').filter((l) => /TypeError|ReferenceError|quebrou|Unhandled/.test(l));
ok('sem erro de JavaScript no navegador', !erros.length, erros.slice(0, 2).join(' | '));
ok('sem erro no servidor', !quebras.length, quebras.slice(0, 2).join(' | '));
const pdfLog = readFileSync(log, 'utf8').split('\n').filter((l) => /\[orcamento\]/.test(l));
console.log('\n  log do orçamento:\n' + pdfLog.map((l) => '    ' + l.slice(20)).join('\n'));
limpar();
rmSync(casa, { recursive: true, force: true });
const f = R.filter((x) => !x.ok).length;
console.log(`\n${f ? '✗ ' + f + ' de ' + R.length + ' verificações falharam' : '✓ ' + R.length + '/' + R.length + ' verificações passaram'}`);
process.exit(f ? 1 : 0);
