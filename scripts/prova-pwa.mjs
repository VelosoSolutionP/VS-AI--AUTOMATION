#!/usr/bin/env node
/* Prova (18/10, plano item 6): o painel instala como aplicativo e avisa quando um cliente fica esperando.
   Instância isolada; a fila é simulada na resposta de /crm/api/atendimentos.   node scripts/prova-pwa.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import('playwright');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const R = []; const ok = (n, c, d = '') => { R.push(!!c); console.log(`${c ? '  PASSOU' : '  FALHOU'}  ${n}${d ? ' — ' + d : ''}`); };
const casa = mkdtempSync(join(tmpdir(), 'bolso-pwa-'));
let srv; process.on('exit', () => { try { srv?.kill('SIGTERM'); } catch {} try { rmSync(casa, { recursive: true, force: true }); } catch {} });
process.env.VS_HOME = casa;
const acesso = await import(join(RAIZ, 'backend/acesso.mjs')); acesso.criar(randomBytes(18).toString('base64url'));
const t = randomBytes(24).toString('base64url'); mkdirSync(join(casa, 'console'), { recursive: true });
writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [createHash('sha256').update(t).digest('hex')]: { email: 'dono@x.prova', papel: 'admin', clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3600e3).toISOString() } }));
const porta = 22600 + Math.floor(Math.random() * 90); const base = `http://127.0.0.1:${porta}`;
srv = spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, stdio: ['ignore', openSync(join(casa, 'p.log'), 'a'), openSync(join(casa, 'p.log'), 'a')], env: { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1', WHATSAPP_PROVIDER: 'log', PAINEL_URL: base } });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { break; } } catch {} await espera(250); }
const man = await (await fetch(`${base}/crm/manifest.webmanifest`)).json();
ok('manifesto: nome, tela cheia, ícones Android e Apple', man.display === 'standalone' && man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.sizes === '180x180'));
const icones = await Promise.all(man.icons.map(async (i) => {
  const r = await fetch(new URL(i.src, base));
  return r.ok && r.headers.get('content-type') === 'image/png';
}));
ok('ícones PNG do manifesto são servidos', icones.every(Boolean));
const nav = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const erros = [];
try {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['notifications'], { origin: base });
  const entrada = await ctx.newPage(); entrada.on('pageerror', (e) => erros.push(e.message));
  await entrada.goto(`${base}/crm`, { waitUntil: 'load' }); await espera(500);
  await entrada.evaluate(() => { if (document.getElementById('modalBg')?.classList.contains('show')) fecharModal(); });
  const instalar = entrada.locator('#pwaInstalarBtn');
  ok('tela de entrada oferece instalação no celular', await instalar.isVisible());
  await instalar.click();
  ok('instrução manual aparece quando o navegador não oferece prompt', await entrada.locator('#pwaInstalarAjuda').isVisible());
  await entrada.evaluate(() => {
    const evento = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(evento, {
      prompt: { value: async () => {} },
      userChoice: { value: Promise.resolve({ outcome: 'accepted' }) },
    });
    window.dispatchEvent(evento);
  });
  await instalar.click();
  ok('botão inicia o prompt nativo de instalação', (await entrada.locator('#pwaInstalarAjuda').textContent()).includes('Instalação iniciada'));
  await entrada.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  ok('botão some depois da instalação', await entrada.locator('#pwaInstalarArea').isHidden());
  await entrada.close();
  let fila = false;
  await ctx.route('**/crm/api/atendimentos', async (route) => {
    const r = await route.fetch(); const j = await r.json();
    if (fila) { j.conversas = [{ id: 'l1', telefone: '5531900001234', canal: 'whatsapp', nome: 'Joana', situacao: 'aguardando', mensagens: 3, ultima: { texto: 'quero encomendar 30 pizzas' } }]; }
    route.fulfill({ response: r, json: j });
  });
  const p = await ctx.newPage(); p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(`${base}/crm?t=${t}#visao`, { waitUntil: 'load' }); await espera(3000);
  const sw = await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/crm')));
  ok('o service worker do aplicativo registra', sw);
  /* Instalável: num perfil normal (o contexto do teste é anônimo, e anônimo nunca instala). */
  const perfil = mkdtempSync(join(tmpdir(), 'bolso-pwa-perfil-'));
  const pc = await chromium.launchPersistentContext(perfil, { executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const pp = await pc.newPage(); await pp.goto(`${base}/crm?t=${t}#visao`, { waitUntil: 'load' }); await espera(3000);
  const inst = await (await pc.newCDPSession(pp)).send('Page.getInstallabilityErrors').catch((e) => ({ erro: e.message }));
  await pc.close(); rmSync(perfil, { recursive: true, force: true });
  ok('o Chrome considera o painel instalável', Array.isArray(inst.installabilityErrors) && inst.installabilityErrors.length === 0, JSON.stringify(inst).slice(0, 200));
  await p.evaluate(() => avisarFila()); fila = true; await p.evaluate(() => avisarFila()); await espera(800);
  const avisos = await p.evaluate(async () => (await (await navigator.serviceWorker.getRegistration('/crm')).getNotifications()).map((n) => `${n.title} | ${n.body}`));
  ok('cliente novo na fila fora da tela de atendimento → aviso do sistema', avisos.some((a) => /Joana está esperando atendimento/.test(a) && /30 pizzas/.test(a)), JSON.stringify(avisos));
  await p.evaluate(() => avisarFila()); await espera(500);
  const avisos2 = await p.evaluate(async () => (await (await navigator.serviceWorker.getRegistration('/crm')).getNotifications()).length);
  ok('a mesma pessoa não gera aviso de novo a cada volta', avisos2 === 1, String(avisos2));
  ok('sem erro de JavaScript', !erros.length, erros.join(' | '));
} finally { await nav.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passaram`); process.exit(R.every(Boolean) ? 0 : 1);
