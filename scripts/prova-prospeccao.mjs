#!/usr/bin/env node
/**
 * Prova da Prospecção de clientes, num navegador de verdade, em instância ISOLADA
 * (pasta temporária, só 127.0.0.1): plano aprovado → regiões → vendedora registra
 * contatos pela tela → toque → 5 sem resposta → a tela manda trocar a abordagem
 * → o dono troca → contagem recomeça. Vendedora não mexe no plano.
 *
 * Uso: node scripts/prova-prospeccao.mjs [--telas <pasta>]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, openSync } from 'node:fs';
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
const R = []; const ok = (nome, cond, det = '') => { R.push(!!cond); console.log(`${cond ? '  PASSOU' : '  FALHOU'}  ${nome}${det ? ' — ' + det : ''}`); };

const casa = mkdtempSync(join(tmpdir(), 'bolso-prosp-'));
process.env.VS_HOME = casa;
const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
const operadores = await import(join(RAIZ, 'engine/vsoperadores/index.mjs'));
operadores.salvar({ id: 'op-ana', nome: 'Ana', setor: 'comercial' });
acesso.criar(randomBytes(18).toString('base64url'));
const sessao = (papel, extra = {}) => { const t = randomBytes(24).toString('base64url'); return [t, { email: `${papel}@prova`, papel, clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3600e3).toISOString(), ...extra }]; };
const [tAdmin, sAdmin] = sessao('admin'); const [tAna, sAna] = sessao('vendedor', { operadorId: 'op-ana', nome: 'Ana' });
mkdirSync(join(casa, 'console'), { recursive: true });
const hs = (t) => createHash('sha256').update(t).digest('hex');
writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [hs(tAdmin)]: sAdmin, [hs(tAna)]: sAna }));

const porta = 19600 + Math.floor(Math.random() * 90); const base = `http://127.0.0.1:${porta}`;
const log = join(casa, 'painel.log');
/* SMTP FALSO (TLS, certificado gerado na hora): recebe e guarda — nada sai da máquina.
   "recusa@" responde 550, pra provar que falha não vira "enviado". */
const { execFileSync } = await import('node:child_process');
const tls = await import('node:tls');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', join(casa, 'k.pem'), '-out', join(casa, 'c.pem')], { stdio: 'ignore' });
const caixa = [];
const smtp = tls.createServer({ key: readFileSync(join(casa, 'k.pem')), cert: readFileSync(join(casa, 'c.pem')) }, (sock) => {
  let buf = '', dados = false, msg = { para: null, corpo: '' };
  const w = (l) => sock.write(l + '\r\n');
  w('220 falso ESMTP');
  sock.on('data', (d) => {
    buf += d.toString('latin1');
    if (dados) { const f = buf.indexOf('\r\n.\r\n'); if (f < 0) { return; } msg.corpo = buf.slice(0, f); buf = buf.slice(f + 5); dados = false; caixa.push(msg); msg = { para: null, corpo: '' }; w('250 OK id-' + caixa.length); }
    let i;
    while (!dados && (i = buf.indexOf('\r\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^EHLO/i.test(l)) { w('250 ok'); } else if (/^AUTH LOGIN/i.test(l)) { w('334 VXNlcm5hbWU6'); msg.auth = 1; }
      else if (msg.auth === 1) { w('334 UGFzc3dvcmQ6'); msg.auth = 2; } else if (msg.auth === 2) { w('235 ok'); msg.auth = 0; }
      else if (/^MAIL FROM/i.test(l)) { w('250 ok'); } else if (/^RCPT TO:<(.+)>/i.test(l)) { msg.para = /<(.+)>/.exec(l)[1]; w(/^recusa@/.test(msg.para) ? '550 recusado' : '250 ok'); }
      else if (/^DATA/i.test(l)) { w('354 manda'); dados = true; } else if (/^QUIT/i.test(l)) { w('221 tchau'); sock.end(); } else { w('250 ok'); }
    }
  });
});
await new Promise((ok) => smtp.listen(0, '127.0.0.1', ok));
process.on('exit', () => smtp.close());
const painel = spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
  env: { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1', RATE_CRM: '1000000', PAINEL_URL: base, TRANSCRICAO_DESLIGADA: '1',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_USER: 'contato@prova', SMTP_PASS: 'x', NODE_TLS_REJECT_UNAUTHORIZED: '0', PROSP_EMAIL_DIA: '3', PROSP_EMAIL_PAUSA_MS: '0' } });
process.on('exit', () => { try { painel.kill('SIGTERM'); } catch { /* saiu */ } });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { break; } } catch { /* subindo */ } await espera(250); }
const api = async (rota, corpo, tok = tAdmin) => { const r = await fetch(`${base}/crm/api/${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crm-token': tok }, body: corpo ? JSON.stringify(corpo) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };

const pl = await api('prospeccao/plano', { nome: 'Interior — 6 regiões', proposito: 'Descobrir em 30 dias quais regiões do interior compram o Bolso Cheio, e investir só nelas.', inicio: new Date().toISOString().slice(0, 10), fim: new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10), meta: 5, aprovadoPor: 'Fabiano Veloso — tech lead do projeto' });
ok('dono cria o plano aprovado', pl.ok && /Fabiano/.test(pl.plano?.aprovacao?.por));
ok('vendedora NÃO muda o plano', (await api('prospeccao/plano', { nome: 'x', proposito: 'y', inicio: '2026-01-01', fim: '2026-01-02', meta: 1 }, tAna)).status === 403);
for (const [nome, uf, cidades] of [['Vale do Jequitinhonha', 'MG', 'Araçuaí, Diamantina, Almenara'], ['Norte de Minas', 'MG', 'Montes Claros, Janaúba'], ['Oeste Baiano', 'BA', 'Barreiras, LEM']]) {
  await api('prospeccao/regiao', { nome, uf, cidades });
}
ok('vendedora NÃO troca a abordagem', (await api('prospeccao/abordagem', { regiaoId: 'x', abordagem: 'visita' }, tAna)).status === 403);

const nav = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const erros = [];
try {
  const pg = await (await nav.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' })).newPage();
  pg.on('pageerror', (e) => erros.push(e.message));
  await pg.goto(`${base}/crm?t=${tAna}#prospeccao`, { waitUntil: 'load' }); await espera(2500);
  const v = await pg.locator('#view').innerText();
  ok('vendedora vê a tela com a aprovação do tech lead', /Aprovado por Fabiano Veloso — tech lead do projeto/.test(v));
  ok('propósito, duração (dia 1 de 30) e meta (0 de 5) na tela', /Descobrir em 30 dias/.test(v) && /dia 1 de 30/.test(v) && /0 de 5/.test(v));
  ok('3 regiões, abordagem inicial = mensagem direta', (await pg.locator('.prosp-regs tbody tr').count()) === 3 && /Mensagem direta no WhatsApp/.test(v));
  ok('menu da vendedora tem Prospecção', (await pg.locator('#nav').innerText()).includes('Prospecção'));
  // registrar 5 contatos pela tela no Jequitinhonha
  for (let i = 1; i <= 5; i++) {
    await pg.locator('button', { hasText: 'Registrar contato' }).first().click(); await espera(400);
    await pg.locator('#pcReg').selectOption({ label: 'Vale do Jequitinhonha (MG)' });
    await pg.fill('#pcNome', `Comércio ${i}`); await pg.fill('#pcCid', 'Araçuaí'); await pg.fill('#pcWa', `3399990000${i}`);
    await pg.locator('#modalF button', { hasText: 'Registrar' }).click(); await espera(900);
  }
  let d = await api('prospeccao', null, tAna);
  ok('5 contatos registrados pela tela, com próximo toque marcado', d.contatos.length === 5 && d.contatos.every((c) => c.proximo?.quando), `${d.contatos.length} contatos`);
  ok('sem o menu "Mudar etapa" (a etapa anda pelo que aconteceu)', (await pg.locator('.prosp-sel').count()) === 0);
  /* Regra do dono (28/09): 1ª e 2ª mensagem são AUTOMÁTICAS — nessas etapas não há botão
     de envio nem de ligação; "Ligar" só quando é a vez de gente (dia 10 ou quem respondeu). */
  ok('etapas automáticas sem botão de envio nem de ligação', (await pg.locator('.prosp-cts .prosp-ligar').count()) === 0 && (await pg.locator('.prosp-cts a', { hasText: 'WhatsApp' }).count()) === 0);
  ok('nada rosa: o destaque da tela é verde', await pg.evaluate(() => { const b = document.querySelector('.prosp-tela .btn-p'); return !!b && /21, 128, 61|26, 145, 66/.test(getComputedStyle(b).backgroundImage + getComputedStyle(b).backgroundColor); }));
  d = await api('prospeccao', null, tAna);
  await api('prospeccao/mover', { id: d.contatos[0].id, etapa: 'toque' }, tAna);
  d = await api('prospeccao', null, tAna);
  const t2 = d.contatos.find((c) => c.toques === 2);
  ok('2º toque registrado (a 2ª mensagem do dia 5) com a vendedora no histórico', t2 && t2.historico.at(-1).por === 'Ana');
  if (TELAS) { await pg.screenshot({ path: join(TELAS, 'prosp-1-contatos.png'), fullPage: true }); }
  // marcar os 5 como sem resposta pelo seletor
  for (const c of d.contatos) { await api('prospeccao/mover', { id: c.id, etapa: 'sem-resposta' }, tAna); }
  await pg.reload({ waitUntil: 'load' }); await espera(2500);
  const v2 = await pg.locator('#view').innerText();
  ok('5 sem resposta e ninguém respondeu: a região pede "Trocar abordagem"', /Trocar abordagem/.test(v2) && (await pg.locator('.prosp-alerta').count()) === 1);
  ok('vendedora vê o alerta mas não tem o botão de trocar', (await pg.locator('.prosp-regs button').count()) === 0);
  if (TELAS) { await pg.screenshot({ path: join(TELAS, 'prosp-2-trocar.png'), fullPage: true }); }
  // dono troca
  const pa = await (await nav.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' })).newPage();
  pa.on('pageerror', (e) => erros.push('dono: ' + e.message));
  await pa.goto(`${base}/crm?t=${tAdmin}#prospeccao`, { waitUntil: 'load' }); await espera(2500);
  const bt = pa.locator('.prosp-alerta button');
  ok('dono vê a sugestão da próxima abordagem (grupo da cidade)', /Trocar p\/ Grupo de WhatsApp\/Telegram da cidade/.test(await bt.innerText()), await bt.innerText());
  await bt.click(); await espera(400);
  await pa.fill('#ptMot', 'mensagem direta não teve retorno'); await pa.locator('#modalF button', { hasText: 'Trocar' }).click(); await espera(1200);
  d = await api('prospeccao');
  const jq = d.regioes.find((r) => r.nome === 'Vale do Jequitinhonha');
  ok('abordagem trocada, alerta some e o histórico guarda o motivo', jq.abordagem === 'grupo-local' && !jq.trocar && jq.tentadas[0].motivo === 'mensagem direta não teve retorno');
  ok('tela do dono mostra "já tentado: mensagem direta"', /já tentado: Mensagem direta/.test(await pa.locator('#view').innerText()));
  // base pública: 1ª mensagem pelo botão, resposta, e um que pede pra sair
  const imp = await import(join(RAIZ, 'engine/vsprospeccao/index.mjs'));
  const oeste = d.regioes.find((r) => r.nome === 'Oeste Baiano');
  process.env.VSPROSPECCAO_DIR = join(casa, 'vsprospeccao');
  imp.importarLista(oeste.id, [{ cnpj: '11111111000191', nome: 'AGRO BARREIRAS', cidade: 'BARREIRAS', whatsapp: '77999990001', email: 'comercio@gmail.com' },
    { cnpj: '22222222000191', nome: 'PECAS LEM', cidade: 'LEM', whatsapp: '61999990002', email: 'comercio@gmail.com' }], { fonte: 'Receita Federal — dados abertos do CNPJ (2026-09)' });
  await pa.reload({ waitUntil: 'load' }); await espera(2500);
  const vi = await pa.locator('#view').innerText();
  ok('importados aparecem como "não contatado", sem etapa "Na lista"', /não contatado/.test(vi) && !/Na lista \(não contatado\)/.test(vi));
  ok('alertas de qualidade: DDD de fora e e-mail repetido', /DDD 61 é de fora de BA/.test(vi) && /e-mail repetido/.test(vi));
  const agro = (await api('prospeccao')).contatos.find((c) => c.cnpj === '11111111000191');
  const em1 = imp.emailApresentacao(agro, readFileSync(join(RAIZ, 'docs/prospeccao/email-1a-mensagem.txt'), 'utf8'));
  ok('1º contato (e-mail automático) diz que o contato veio da Receita Federal e tem SAIR', /AGRO BARREIRAS/.test(em1.assunto) && /Receita Federal/.test(em1.texto) && /SAIR/.test(em1.texto));
  for (const cnpj of ['11111111000191', '22222222000191']) { const c = (await api('prospeccao')).contatos.find((x) => x.cnpj === cnpj); await api('prospeccao/mover', { id: c.id, etapa: 'contatado' }); }
  await pa.reload({ waitUntil: 'load' }); await espera(2500);
  await pa.locator('tr', { hasText: 'AGRO BARREIRAS' }).locator('button', { hasText: 'Respondeu' }).click(); await espera(1200);
  const lig = pa.locator('tr', { hasText: 'AGRO BARREIRAS' }).locator('a.prosp-ligar');
  ok('quem respondeu ganha "Ligar" (tel:) e WhatsApp — é a vez de gente', (await lig.count()) === 1 && /^tel:\+5577999990001$/.test(await lig.getAttribute('href')), await lig.getAttribute('href').catch(() => ''));
  await pa.locator('tr', { hasText: 'PECAS LEM' }).locator('button', { hasText: 'Pediu pra sair' }).click(); await espera(400);
  await pa.locator('#modalF button', { hasText: 'Apagar e bloquear' }).click(); await espera(1200);
  d = await api('prospeccao');
  const saiu = d.contatos.find((c) => c.cnpj === '22222222000191');
  ok('pediu pra sair: contato apagado e marcado', saiu && saiu.optout && !saiu.whatsapp && !saiu.email);
  const re = imp.importarLista(oeste.id, [{ cnpj: '33333333000191', nome: 'MESMO NUMERO', whatsapp: '61999990002' }], { fonte: 'Receita' });
  ok('número bloqueado não volta numa importação nova', re.bloqueados === 1 && re.novos === 0);
  // paginação 10/50/100
  imp.importarLista(oeste.id, Array.from({ length: 25 }, (_, i) => ({ cnpj: String(44000000000100 + i), nome: `LOJA PAGINA ${i + 1}`, cidade: 'BARREIRAS' })), { fonte: 'Receita' });
  await pa.reload({ waitUntil: 'load' }); await espera(2500);
  const nLin = async () => pa.locator('.prosp-cts tbody tr').count();
  const pagTxt = async () => pa.locator('.prosp-pag').innerText();
  ok('paginação: 10 por página por padrão', (await nLin()) === 10 && /página 1 de \d+/.test(await pagTxt()), (await pagTxt()).replace(/\s+/g, ' '));
  await pa.locator('.prosp-pag button', { hasText: 'Próxima' }).click(); await espera(1500);
  ok('paginação: "Próxima" vai pra página 2', /página 2 de/.test(await pagTxt()));
  await pa.locator('.prosp-pag select').selectOption('50'); await espera(1500);
  ok('paginação: escolher 50 mostra até 50 e volta pra página 1', (await nLin()) > 10 && (await nLin()) <= 50 && /página 1 de/.test(await pagTxt()));
  ok('fonte das empresas com o site oficial (dados.gov.br) no topo da lista', (await pa.locator('.prosp-fontes a[href^="https://dados.gov.br/"]').count()) === 1 && /Receita Federal/.test(await pa.locator('.prosp-fontes').innerText()));
  if (TELAS) { await pa.locator('.prosp-fontes').screenshot({ path: join(TELAS, 'prosp-6-fontes.png') }).catch(() => {}); }
  // balanço
  ok('vendedora não abre o balanço', (await api('prospeccao/balanco', null, tAna)).status === 403);
  await pa.locator('button', { hasText: 'Balanço da prospecção' }).first().click(); await espera(1800);
  const vb = await pa.locator('#view').innerText();
  ok('balanço mostra parcial, funil e quem pode fechar', /Parcial · dia 1 de \d+/.test(vb) && /Podem fechar/.test(vb) && /AGRO BARREIRAS/.test(vb) && /Por região/.test(vb), vb.slice(0, 120));
  ok('balanço explica por que não tem "visualizaram"', /não informa leitura/.test(vb));
  if (TELAS) { await pa.screenshot({ path: join(TELAS, 'prosp-4-balanco.png'), fullPage: true }); }
  const pdf = await fetch(`${base}/crm/api/prospeccao/balanco/pdf`, { headers: { 'x-crm-token': tAdmin } });
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  ok('PDF do balanço sai', pdf.ok && pdfBuf.subarray(0, 4).toString() === '%PDF', `${pdf.status} · ${pdfBuf.length} bytes`);
  if (TELAS && pdf.ok) { writeFileSync(join(TELAS, 'balanco.pdf'), pdfBuf); }
  // ── e-mail do dia 0 (regra do dono) ──
  imp.importarLista(oeste.id, [['MAIL UM', 'um@lojas.com'], ['MAIL DOIS', 'recusa@lojas.com'], ['MAIL TRES', 'tres@lojas.com'], ['MAIL QUATRO', 'quatro@lojas.com']]
    .map(([nome, email], i) => ({ cnpj: String(66000000000100 + i), nome, cidade: 'BARREIRAS', email, whatsapp: `7799997000${i}` })), { fonte: 'Receita Federal — dados abertos do CNPJ (2026-09)' });
  await pa.goto(`${base}/crm?t=${tAdmin}#prospeccao`, { waitUntil: 'load' }); await espera(2500);
  const env0 = await api('prospeccao/envio');
  ok('cartão de envio: configurado, limite do dia 3, ninguém enviado ainda', env0.configurado && env0.limiteDia === 3 && env0.hoje === 0 && (await pa.locator('.prosp-envio').count()) === 1);
  ok('vendedora não vê nem dispara o envio', (await api('prospeccao/envio', null, tAna)).status === 403 && (await api('prospeccao/envio', { quantos: 3, confirmar: true }, tAna)).status === 403);
  await pa.locator('.prosp-envio button', { hasText: 'Ver o e-mail' }).click(); await espera(500);
  const pv = await pa.locator('.prosp-mail').innerText();
  ok('prévia do e-mail: modelo do dono, com o nome da empresa, sem campo em aberto', /Parceria para a /.test(pv) && /sou CEO da VDG Sistemas/.test(pv) && /18 anos de estrada/.test(pv) && /Receita Federal/.test(pv) && /SAIR/.test(pv) && !/\{/.test(pv));
  ok('nada rosa nem na janela', await pa.evaluate(() => { const b = document.querySelector('#modalF .btn-p'); return !b || /21, 128, 61|26, 145, 66/.test(getComputedStyle(b).backgroundImage); }));
  await pa.locator('#modalF button').first().click(); await espera(300);
  await pa.locator('.prosp-envio button', { hasText: 'Enviar lote de 3' }).click(); await espera(400);
  await pa.locator('#modalF button', { hasText: 'Enviar agora' }).click();
  for (let i = 0; i < 40 && (await api('prospeccao/envio')).job?.rodando !== false; i++) { await espera(300); }
  const env1 = await api('prospeccao/envio');
  ok('lote: 3 tentativas, a recusada NÃO conta como enviada', env1.job.total === 3 && env1.job.falhas >= 0 && env1.job.enviados + env1.job.falhas === 3, JSON.stringify({ e: env1.job.enviados, f: env1.job.falhas }));
  const aceitos = caixa.filter((m) => !/^recusa@/.test(m.para));
  ok('e-mails chegaram ao servidor com o PDF do portfólio anexado', aceitos.length === env1.job.enviados && aceitos.every((m) => /multipart\/mixed/.test(m.corpo) && /filename="portfolio-bolso-cheio-agro\.pdf"/.test(m.corpo) && /JVBER/.test(m.corpo)), `${aceitos.length} na caixa`);
  const dEnv = await api('prospeccao');
  const enviadas = dEnv.contatos.filter((c) => c.historico?.some((h) => h.canal === 'email'));
  ok('quem recebeu virou "contatado" pelo e-mail; a recusada continua na lista', enviadas.length === env1.job.enviados && enviadas.every((c) => c.etapa === 'contatado'));
  ok('limite do dia respeitado: não cabe mais nenhum hoje', env1.hoje === env1.job.enviados && (await api('prospeccao/envio', { quantos: 10, confirmar: true })).ok === (env1.cabe > 0));
  const futuro = imp.painel({ agora: new Date(Date.now() + 5 * 86400000 + 60000), limite: 100 }).contatos.find((c) => c.id === enviadas[0]?.id);
  ok('dia 5: WhatsApp da última tentativa, com o texto do dono', futuro?.proximo?.vencido && /Te enviei um e-mail apresentando o Bolso Cheio/.test(decodeURIComponent(futuro?.wa?.url || '')) && /Fico no aguardo/.test(decodeURIComponent(futuro?.wa?.url || '')));
  // respostas prontas
  await pa.reload({ waitUntil: 'load' }); await espera(2500);
  const linha = pa.locator('tr', { hasText: enviadas[0].nome });
  await linha.locator('button', { hasText: 'Respostas prontas' }).click(); await espera(800);
  const rp = await pa.locator('#modalB').innerText();
  ok('respostas prontas: grosseria, "de onde veio o número" e sem interesse, cordiais', /Foi grosso/.test(rp) && /pedimos desculpas pelo transtorno/.test(rp) && /dados públicos de empresas da Receita Federal/.test(rp) && /agradecemos pelo seu tempo/.test(rp) && /A Veloso Solution deseja/.test(rp));
  await Promise.all([pa.context().waitForEvent('page', { timeout: 5000 }).then((pp) => pp.close()).catch(() => {}), pa.locator('#modalB button', { hasText: 'Mandar no WhatsApp' }).first().click()]);
  await espera(1500);
  const gro = (await api('prospeccao')).contatos.find((c) => c.id === enviadas[0].id);
  ok('resposta à grosseria apaga o contato e bloqueia o número', gro.optout && !gro.whatsapp && !gro.email);
  const cel = await (await nav.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await cel.goto(`${base}/crm?t=${tAna}#prospeccao`, { waitUntil: 'load' }); await espera(2500);
  ok('celular: sem rolagem lateral na página', await cel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (TELAS) { await cel.screenshot({ path: join(TELAS, 'prosp-3-celular.png') }); }
} finally { await nav.close(); }
ok('sem erro de JavaScript', !erros.length, erros.slice(0, 2).join(' | '));
ok('sem erro no servidor', !/TypeError|ReferenceError|quebrou|Unhandled/.test(readFileSync(log, 'utf8')));
painel.kill('SIGTERM'); rmSync(casa, { recursive: true, force: true });
const f = R.filter((x) => !x).length;
console.log(`\n${f ? '✗ ' + f + ' de ' + R.length + ' falharam' : '✓ ' + R.length + '/' + R.length + ' verificações passaram'}`);
process.exit(f ? 1 : 0);
