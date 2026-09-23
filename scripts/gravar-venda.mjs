/**
 * Vídeo comercial: um pedido que se fecha e se paga sozinho.
 *
 * Feito para o time comercial mostrar em reunião. A história é a de uma
 * lanchonete — o Juarez Tele-Entrega — e o ponto é um só: onde o catálogo tem
 * preço, o cliente pede e PAGA sem ninguém atender.
 *
 * Nada é encenado. É o console de demonstração respondendo, com o catálogo de
 * verdade e um link de pagamento de verdade — no ambiente de TESTE do Mercado
 * Pago, que não cobra ninguém. Encenar aqui seria o jeito mais rápido de o
 * comercial prometer o que o produto não faz.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const URL = process.env.URL_DEMO || 'https://demo.velososolution.com.br';
const SENHA = process.env.SENHA_DEMO || 'TikTokShop2026Demo';
const DIR = process.env.SAIDA || 'video-venda';
const MP4 = join(DIR, 'juarez-pedido-e-pagamento.mp4');

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const navegador = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome',
  args: ['--no-sandbox'],
});
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 720 }, locale: 'pt-BR' });
const pg = await ctx.newPage();

const quadros = [];
const passos = [];

async function quadro(segundos = 3, pagina = pg) {
  const nome = `q${String(quadros.length).padStart(3, '0')}.png`;
  await pagina.screenshot({ path: join(DIR, nome) });
  quadros.push({ nome, segundos });
}

async function legenda(texto, sub = '', pagina = pg) {
  await pagina.evaluate(([t, s]) => {
    document.getElementById('vs-legenda')?.remove();
    const d = document.createElement('div');
    d.id = 'vs-legenda';
    d.style.cssText = `position:fixed;left:0;right:0;bottom:0;z-index:99999;
      background:linear-gradient(transparent,rgba(17,17,27,.95) 40%);color:#fff;
      padding:52px 36px 26px;font:600 23px/1.3 system-ui,-apple-system,sans-serif;
      letter-spacing:-.2px;pointer-events:none`;
    d.innerHTML = `<div>${t}</div>` + (s ? `<div style="font-weight:400;font-size:16.5px;opacity:.84;margin-top:7px">${s}</div>` : '');
    document.body.appendChild(d);
  }, [texto, sub]);
}

async function passo(nome, fn) {
  try { await fn(); passos.push(`ok      ${nome}`); }
  catch (e) { passos.push(`FALHOU  ${nome}: ${e.message.split('\n')[0].slice(0, 90)}`); }
}

async function tela(id, titulo, sub, seg = 4) {
  await pg.evaluate((x) => window.ir?.(x), id);
  await pg.waitForTimeout(1600);
  await legenda(titulo, sub);
  await quadro(seg);
}

await passo('entrar', async () => {
  await pg.goto(`${URL}/crm`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2500);
  await legenda('Juarez Tele-Entrega', 'Uma lanchonete atendendo no WhatsApp — sem ninguém digitando');
  await quadro(4.5);
  await pg.fill('#lgSenha', SENHA);
  await pg.click('#lgBtn');
  await pg.waitForTimeout(3500);
});

await passo('catálogo', () => tela('estoque', 'O catálogo do Juarez',
  'Cinco itens, com preço e saldo — o mesmo catálogo que abastece os canais de venda', 4.5));

/* Os KPIs abrem a tela, mas quem compra quer ver o PRODUTO com preço. Sem este
   quadro o video mostra um numero e nenhuma mercadoria. */
await passo('a lista de produtos', async () => {
  const achou = await pg.evaluate(() => {
    const el = [...document.querySelectorAll('td,th,h3,b')].find((x) => /Mega Blaster|X-Tudo/.test(x.textContent || ''));
    if (!el) { return false; }
    el.scrollIntoView({ block: 'center' });
    return true;
  });
  if (!achou) { throw new Error('nao achei os produtos do Juarez na tela'); }
  await pg.waitForTimeout(1200);
  await legenda('O catálogo manda no preço', 'Mudou aqui, mudou no atendimento na mesma hora — sem reimportar planilha');
  await quadro(5);
});

await passo('bot', () => tela('bot-regras', 'A árvore de atendimento',
  'Cardápio, pedido, endereço e pagamento. Um único caminho chama uma pessoa: bairro fora da área', 5));

await passo('ligar cobrança no teste', async () => {
  const caixa = await pg.$('#simCobrar');
  if (!caixa) { throw new Error('nao achei a caixa de cobranca'); }
  await caixa.scrollIntoViewIfNeeded();
  await caixa.check();
  await pg.waitForTimeout(700);
  await legenda('Link de pagamento de verdade', 'Ambiente de teste do Mercado Pago — não cobra ninguém');
  await quadro(4);
});

const CONVERSA = [
  ['oi', 'O cliente chega', 'Nenhum atendente foi acionado'],
  ['1', 'O cardápio, com preço', 'Preço na tela é o que dispensa perguntar "quanto é?"'],
  ['4', 'Mega Blaster — R$ 62,00', 'O item entra no pedido pelo preço do catálogo'],
  ['1', 'Bebida', 'Cada escolha soma no mesmo pedido'],
  ['sem cebola', 'Observação', 'Texto livre vira contexto do pedido'],
  ['Rua das Flores 120 - ref padaria', 'Endereço', 'Ninguém pergunta duas vezes'],
  ['1', 'Taxa de entrega', 'Entra no total como qualquer item'],
  ['1', 'Pix agora', 'É aqui que o pedido vira dinheiro'],
];

await passo('a conversa', async () => {
  for (const [msg, titulo, sub] of CONVERSA) {
    await pg.fill('#simTxt', msg);
    await pg.waitForTimeout(400);
    await pg.press('#simTxt', 'Enter');
    await pg.waitForTimeout(3200);
    await pg.evaluate(() => {
      const s = document.getElementById('simSaida');
      s?.scrollIntoView({ block: 'end' });
      window.scrollTo(0, document.body.scrollHeight);
    });
    await legenda(titulo, sub);
    await quadro(3.6);
  }
});

/* O link tem de aparecer na TELA e ABRIR. Mostrar só o texto "gerei um link"
   é exatamente o tipo de prova que ninguém compra. */
let link = null;
await passo('o link na tela', async () => {
  link = await pg.evaluate(() => document.querySelector('#simSaida a[href*="mercadopago"]')?.href || null);
  if (!link) { throw new Error('o simulador nao devolveu link de pagamento'); }
  await pg.evaluate(() => document.querySelector('#simSaida a[href*="mercadopago"]')?.scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(900);
  await legenda('O pedido fechou sozinho', 'Sete mensagens, nenhum atendente, link de pagamento na mão do cliente');
  await quadro(5.5);
});

/* O checkout NAO entra no video. A conta de teste do Mercado Pago e um
   `test_user`: a pagina dele so abre pra quem esta logado como comprador de
   teste, e filmar aquele erro em espanhol seria pior que nao filmar nada. O
   link e real e foi criado pela API deles — o que falta e a credencial de
   producao, que e decisao do dono, nao deste script. */
await passo('o que o cliente recebe', async () => {
  await legenda('O cliente abre e paga', 'Pix ou cartão, pela página do Mercado Pago — e a Micaela avisa quando cair');
  await quadro(5);
});

await passo('encerrar', async () => {
  await legenda('Veloso Solution', 'O atendimento que fecha a venda — velososolution.com.br');
  await quadro(4.5);
});

await ctx.close();
await navegador.close();

const lista = quadros.map((q) => `file '${q.nome}'\nduration ${q.segundos}`).join('\n')
  + `\nfile '${quadros[quadros.length - 1].nome}'\n`;
writeFileSync(join(DIR, 'lista.txt'), lista);

execFileSync('ffmpeg', [
  '-y', '-f', 'concat', '-safe', '0', '-i', join(DIR, 'lista.txt'),
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '23',
  MP4,
], { stdio: 'pipe' });

console.log(passos.join('\n'));
console.log(`\nquadros: ${quadros.length}`);
console.log(`video  : ${MP4}`);
/* Um passo que falhou vira vídeo com buraco — e o comercial só descobre na
   frente do cliente. */
if (passos.some((p) => p.startsWith('FALHOU'))) { process.exit(1); }
