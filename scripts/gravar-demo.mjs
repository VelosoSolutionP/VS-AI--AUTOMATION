/**
 * Vídeo de demonstração do produto — o que a TikTok pede na revisão do app.
 *
 * Navega a instância de DEMONSTRAÇÃO num navegador de verdade, captura os
 * quadros e monta o MP4 com o ffmpeg do sistema. Nada é encenado: o que aparece
 * é o produto respondendo, com os dados fictícios que o semeador plantou.
 *
 * Roda contra a demo de propósito. Filmar produção poria cliente real, telefone
 * e valor de verdade num arquivo que vai para uma empresa de fora.
 *
 * Quadros em vez da gravação do Playwright porque ela exige um ffmpeg próprio,
 * baixado à parte — e porque assim o tempo de leitura de cada tela é decidido
 * aqui, não pelo relógio do navegador. Vídeo que corre rápido demais não
 * demonstra nada.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const URL = process.env.URL_DEMO || 'https://demo.velososolution.com.br';
const SENHA = process.env.SENHA_DEMO || 'TikTokShop2026Demo';
const DIR = process.env.SAIDA || 'video-demo';
const MP4 = join(DIR, 'veloso-solution-demo.mp4');

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const navegador = await chromium.launch({
  /* Chrome do sistema: o "headless shell" do Playwright nem sempre está
     instalado, e não vale baixar navegador para gravar um vídeo. */
  executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome',
  args: ['--no-sandbox'],
});
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 720 }, locale: 'pt-BR' });
const pg = await ctx.newPage();

const quadros = [];
const passos = [];

/** Guarda um quadro e por quantos segundos ele fica na tela. */
async function quadro(segundos = 3) {
  const nome = join(DIR, `q${String(quadros.length).padStart(3, '0')}.png`);
  await pg.screenshot({ path: nome });
  quadros.push({ nome: `q${String(quadros.length).padStart(3, '0')}.png`, segundos });
}

/** Legenda fixa no rodapé: sem narração, é o texto que guia quem assiste. */
async function legenda(texto, sub = '') {
  await pg.evaluate(([t, s]) => {
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
  catch (e) { passos.push(`FALHOU  ${nome}: ${e.message.split('\n')[0].slice(0, 80)}`); }
}

await passo('abrir e entrar', async () => {
  await pg.goto(`${URL}/crm`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2500);
  await legenda('Veloso Solution — Console', 'Atendimento, catálogo e canais de venda em um lugar só');
  await quadro(4);
  await pg.fill('#lgSenha', SENHA);
  await legenda('Acesso ao console');
  await quadro(2);
  await pg.click('#lgBtn');
  await pg.waitForTimeout(3500);
});

/* Navega pelo MENU, como um usuário faria — é o "passo a passo na perspectiva
   do usuário" que o formulário pede, não um passeio por URLs. */
async function tela(id, titulo, sub, seg = 4) {
  await pg.evaluate((x) => window.ir?.(x), id);
  await pg.waitForTimeout(1600);
  await legenda(titulo, sub);
  await quadro(seg);
}

/**
 * Rola até um texto e filma. Existe porque a tela de Conexões abre no resumo, e
 * o bloco do TikTok — o que o revisor da TikTok veio ver — fica abaixo da
 * dobra. Video que nao mostra o que o avaliador procura nao ajuda em nada.
 */
async function rolarAte(texto, titulo, sub, seg = 4.5) {
  const achou = await pg.evaluate((t) => {
    const el = [...document.querySelectorAll('h3,h2,b,.card')]
      .find((x) => x.textContent?.includes(t));
    if (!el) { return false; }
    el.scrollIntoView({ block: 'center' });
    return true;
  }, texto);
  if (!achou) { throw new Error(`nao achei "${texto}" na tela`); }
  await pg.waitForTimeout(1200);
  await legenda(titulo, sub);
  await quadro(seg);
}

await passo('visão geral', () => tela('visao', 'Visão geral', 'Os números da operação em uma tela'));
await passo('estoque', () => tela('estoque', 'Catálogo de produtos', 'O mesmo catálogo que abastece os canais de venda'));
await passo('conexões', () => tela('redes-canal', 'Conexões com canais', 'TikTok: login, anúncios e loja — cada um com autorização própria', 5));
await passo('tiktok — os tres apps', () => rolarAte('TikTok · Loja (produtos)',
  'Integração com o TikTok Shop', 'App key, app secret e a autorização da loja — o painel guarda e renova o token', 5.5));
await passo('tiktok — publicar video', () => rolarAte('Publicar vídeo',
  'Publicação de vídeo pelo painel', 'Arquivo, legenda e privacidade — a TikTok busca o vídeo no nosso domínio verificado', 5));
await passo('incluso', () => tela('redes-planos', 'Canais do plano e adendos', 'Marketplaces entram como adendo de contrato'));
await passo('marketplaces', () => rolarAte('Marketplaces',
  'Canais adicionais', 'Mercado Livre, Shopee, iFood e outros entram como adendo de contrato', 4.5));
await passo('bot', () => tela('bot-regras', 'Assistente de atendimento', 'Responde sozinha e passa para uma pessoa quando precisa'));

await passo('simular conversa', async () => {
  await legenda('Testando o atendimento', 'A conversa acontece de verdade, aqui no painel');
  for (const msg of ['oi', '1']) {
    await pg.fill('#simTxt', msg);
    await pg.waitForTimeout(500);
    await pg.press('#simTxt', 'Enter');
    await pg.waitForTimeout(2800);
    await quadro(3.5);
  }
});

await passo('atendimento', () => tela('wa-atendimento', 'Caixa de entrada', 'O atendente responde pelo painel, com o histórico do cliente'));
await passo('planos', () => tela('pl-planos', 'Planos e limites', 'Produtos, atendentes e canais vêm do contrato'));

await passo('encerrar', async () => {
  await legenda('Veloso Solution', 'demo.velososolution.com.br');
  await quadro(4);
});

await ctx.close();
await navegador.close();

/* Monta o MP4. `-vf scale` com divisível por 2 e yuv420p porque player de
   terceiro é exigente: vídeo que não abre no revisor é vídeo que não existe. */
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
