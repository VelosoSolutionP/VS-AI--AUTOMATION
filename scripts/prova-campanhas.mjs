#!/usr/bin/env node
/**
 * Prova da tela Telegram · Campanhas (V1) em navegador de verdade.
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
 * se alguma verificação falhar. Uso: node scripts/prova-campanhas.mjs [--fotos dir]
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
const FOTOS = args.includes('--fotos') ? args[args.indexOf('--fotos') + 1] : mkdtempSync(join(tmpdir(), 'prova-campanhas-fotos-'));
mkdirSync(FOTOS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const verif = [];
const ok = (nome, cond, det = '') => { verif.push({ ok: !!cond, nome, det }); console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${det ? ' — ' + det : ''}`); };

async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-campanhas-'));
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
  return { url, filho, escrever: (d) => post('_escrever', d), membro: (d) => post('_membro', d), enviados: () => post('_enviados') };
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
  const api = async (rota, corpo, cru) => {
    const r = await fetch(`${base}/crm/api/${rota}`, { method: corpo || cru ? 'POST' : 'GET', headers: { 'content-type': cru ? 'image/png' : 'application/json', 'x-crm-token': token }, body: cru || (corpo ? JSON.stringify(corpo) : undefined) });
    return r.json();
  };
  try {
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);

    // Foto de produto de verdade (PNG 1080×1080), gerada pelo próprio navegador.
    const pg0 = await navegador.newPage({ viewport: { width: 1080, height: 1080 } });
    await pg0.setContent('<body style="margin:0;display:grid;place-items:center;height:100vh;background:linear-gradient(135deg,#1f2937,#4f46e5);font:700 120px system-ui;color:#fff">CAMISETA</body>');
    const png = await pg0.screenshot({ type: 'png' });
    await pg0.close();
    const up = await api('midia?tipo=imagem&nome=camiseta.png', null, png);
    ok('imagem do produto subiu pela rota de mídia', up.arquivo, up.url);
    const cad = await api('estoque/produto', { sku: 'CAM-PRETA', nome: 'Camiseta preta', descricao: 'Algodão 100%, P ao GG.', preco: '49,90', imagens: [up.url] });
    ok('produto de exemplo cadastrado', cad.ok, (cad.erros || []).join('; '));
    await api('estoque/movimentar', { sku: 'CAM-PRETA', tipo: 'entrada', quantidade: 10 });

    const page = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    const errosJs = [];
    page.on('pageerror', (e) => errosJs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|status of 400/.test(m.text())) { errosJs.push(m.text()); } }); // 400 = recusa esperada (regra), não erro de JS
    await page.goto(`${base}/crm?t=${token}#tg-campanhas`);
    await page.waitForSelector('text=Acompanhamento');
    await page.screenshot({ path: join(FOTOS, '01-vazio.png'), fullPage: true });
    ok('tela abre com a lista vazia e o convite', await page.isVisible('text=Nenhuma campanha ainda'));

    await page.click('button:has-text("Nova campanha")');
    await page.click('.cp-obj:has-text("Criar promoção")');
    await page.selectOption('#cpSku', 'CAM-PRETA');
    ok('produto puxou nome e foto do catálogo', (await page.inputValue('#cpNome')) === 'Promo Camiseta preta' && await page.isVisible('.cp-img img'));
    await page.fill('#cpPromoPreco', '39,90');
    await page.fill('#cpPromoAte', '2026-12-31');
    await page.fill('#cpComo', 'Toque no botão e diga PROMO.');
    await page.click('button:has-text("Montar texto a partir dos dados")');
    const texto = await page.inputValue('#cpTexto');
    ok('texto montado com o preço de/por', /De R\$ 49,90 por R\$ 39,90/.test(texto), texto.split('\n')[2]);
    // Erro de propósito: preço que não é o do catálogo nem o promocional.
    await page.fill('#cpTexto', texto.replace('R$ 39,90', 'R$ 29,90'));
    ok('prévia acompanha o texto enquanto digita', (await page.textContent('.tgp-txt')).includes('R$ 29,90'));
    await page.screenshot({ path: join(FOTOS, '02-conteudo.png'), fullPage: true });

    await page.click('#btCpAuditar');
    await page.waitForSelector('text=Relatório do auditor');
    ok('auditor pediu correção do preço', await page.isVisible('.cp-aud li:has-text("R$ 29,90")'));
    ok('“Continuar” travado enquanto há correção', await page.isDisabled('button:has-text("Continuar")'));
    await page.screenshot({ path: join(FOTOS, '03-auditoria-corrigir.png'), fullPage: true });

    await page.click('button:has-text("Voltar e ajustar")');
    await page.click('button:has-text("Montar texto a partir dos dados")');
    await page.click('#btCpAuditar');
    await page.waitForSelector('.cp-veredito');
    ok('auditor liberou depois do ajuste', await page.isEnabled('button:has-text("Continuar")'), await page.textContent('.cp-veredito'));
    ok('relatório mostra imagem dentro dos limites', await page.isVisible('.cp-aud li:has-text("1080×1080")'));
    ok('relatório mostra o link rastreável', await page.isVisible('.cp-aud li:has-text("t.me/loja_teste_bot?start=promo-camiseta-preta")'));
    await page.screenshot({ path: join(FOTOS, '04-auditoria-ok.png'), fullPage: true });

    await page.click('button:has-text("Continuar")');
    await page.screenshot({ path: join(FOTOS, '05-aprovacao.png'), fullPage: true });
    await page.click('#btCpAprovar');
    await page.waitForSelector('text=Campanha ativa');
    const link = await page.textContent('.linkbox span');
    ok('aprovada: link gerado', link === 'https://t.me/loja_teste_bot?start=promo-camiseta-preta', link);
    await page.screenshot({ path: join(FOTOS, '06-divulgacao.png'), fullPage: true });

    // Duas entradas da mesma pessoa pelo link: 2 entradas, 1 conversa.
    await tg.escrever({ chat: 555001, nome: 'Ana', texto: '/start promo-camiseta-preta' });
    await espera(1500);
    await tg.escrever({ chat: 555001, nome: 'Ana', texto: '/start promo-camiseta-preta' });
    await espera(2500);
    await page.click('button:has-text("Ver no acompanhamento")');
    await page.waitForSelector('tbody tr');
    const cel = await page.$$eval('tbody tr:first-child td', (tds) => tds.map((t) => t.innerText.trim()));
    ok('tabela: campanha ativa com 2 entradas e 1 conversa', cel[1] === 'Ativa' && cel[2] === '2' && cel[3] === '1', cel.slice(0, 6).join(' | '));
    await page.screenshot({ path: join(FOTOS, '07-acompanhamento.png'), fullPage: true });

    await page.click('tbody tr:first-child');
    await page.waitForSelector('.cp-det');
    ok('detalhe abre com prévia, resultados e relatório', await page.isVisible('.modal .tgp') && await page.isVisible('.modal .cp-nums') && await page.isVisible('.modal .cp-aud'));
    await page.screenshot({ path: join(FOTOS, '08-detalhe.png') });
    await page.keyboard.press('Escape');

    // Rascunho que nunca foi aprovado não conta: /start com o código dele não vira entrada.
    const rasc = await api('campanhas/salvar', { objetivo: 'captar', nome: 'Lista VIP', texto: 'Entre na lista VIP', codigo: 'lista-vip' });
    await tg.escrever({ chat: 555002, nome: 'Beto', texto: '/start lista-vip' });
    await espera(2500);
    const lista = await api('campanhas?dias=30');
    const vip = lista.campanhas.find((c) => c.id === rasc.campanha.id);
    ok('rascunho não atribui (sem métricas)', vip && vip.estado === 'rascunho' && vip.metricas === null);

    // ── 2ª entrega: destinos e publicação ──
    await tg.membro({ chat: { id: -100123, title: 'Ofertas da Loja', type: 'channel', username: 'ofertas_loja' }, status: 'administrator', podePostar: true });
    await tg.membro({ chat: { id: -100456, title: 'Canal Sem Post', type: 'channel', username: 'sem_post' }, status: 'administrator', podePostar: false });
    await espera(2500);
    await page.reload();
    await page.waitForSelector('.cp-dest');
    ok('bot adicionado ao canal: destino aparece PENDENTE para confirmar', await page.isVisible('.cp-dest:has-text("Ofertas da Loja") button:has-text("Confirmar")'));
    await page.click('.cp-dest:has-text("Ofertas da Loja") button:has-text("Confirmar")');
    await page.waitForSelector('.cp-dest:has-text("Ofertas da Loja") .badge:has-text("Confirmado")');
    await page.click('.cp-dest:has-text("Canal Sem Post") button:has-text("Confirmar")');
    await page.waitForSelector('.cp-dest:has-text("Canal Sem Post") .badge:has-text("Sem permissão")');
    ok('canal sem permissão de publicar fica marcado', true);
    await page.fill('#cpDestRef', '@nao_existe_isso');
    await page.click('button:has-text("Verificar e adicionar")');
    await page.waitForSelector('.toast.t-err');
    ok('cadastro manual de canal inexistente é recusado com o motivo', (await page.textContent('.toast.t-err')).includes('não achou'));
    await page.screenshot({ path: join(FOTOS, '08b-destinos.png'), fullPage: true });

    await page.click('tbody tr:has-text("Promo Camiseta preta")');
    await page.waitForSelector('.modal .cpPubDest');
    ok('publicar: só o destino confirmado e com permissão aparece', (await page.$$('.modal .cpPubDest')).length === 1);
    await page.check('.modal .cpPubDest');
    await page.click('.modal button:has-text("Publicar")');
    await page.waitForSelector('.modal .cp-pub .badge:has-text("Publicada")', { timeout: 15000 });
    const envs = (await tg.enviados()).filter((m) => m.chat === '-100123');
    const post = envs.at(-1) || {};
    ok('Telegram recebeu a FOTO com legenda e o botão do link rastreável', post.foto === true && /Camiseta preta/.test(post.texto) && post.botao?.url === 'https://t.me/loja_teste_bot?start=promo-camiseta-preta', JSON.stringify({ foto: post.foto, botao: post.botao }));
    ok('publicação guarda o link da postagem', await page.isVisible('.modal .cp-pub a:has-text("ver postagem")'));
    await page.locator('.modal').screenshot({ path: join(FOTOS, '08c-publicada.png') });
    // Política: outra publicação no mesmo destino em menos de 4 h é barrada.
    await page.check('.modal .cpPubDest');
    await page.check('.modal input[name=cpQuando][value=agendar]');
    const daqui1h = new Date(Date.now() + 3600e3 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.fill('#cpQuandoEm', daqui1h);
    await page.click('.modal button:has-text("Publicar")');
    await page.waitForSelector('.toast.t-err:has-text("entre campanhas")');
    ok('política de frequência barra 2ª publicação no mesmo destino em menos de 4 h', true);
    const daqui6h = new Date(Date.now() + 6 * 3600e3 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.fill('#cpQuandoEm', daqui6h);
    await page.click('.modal button:has-text("Publicar")');
    await page.waitForSelector('.modal .cp-pub .badge:has-text("Agendada")');
    ok('agendar para depois do intervalo: fica Agendada, com cancelar', await page.isVisible('.modal .cp-pub:has-text("Agendada") button'));
    await page.keyboard.press('Escape');

    const cel2 = await navegador.newPage({ viewport: { width: 390, height: 844 } });
    await cel2.goto(`${base}/crm?t=${token}#tg-campanhas`);
    await cel2.waitForSelector('tbody tr');
    await cel2.click('button:has-text("Nova campanha")');
    await cel2.click('.cp-obj:has-text("Divulgar produto")');
    await cel2.selectOption('#cpSku', 'CAM-PRETA');
    const larg = await cel2.evaluate(() => document.documentElement.scrollWidth);
    ok('celular: sem rolagem lateral no assistente', larg <= 390, `${larg}px`);
    await cel2.screenshot({ path: join(FOTOS, '09-celular.png'), fullPage: true });

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
