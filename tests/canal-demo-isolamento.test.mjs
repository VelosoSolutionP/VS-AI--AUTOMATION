/**
 * Demo nunca encosta no canal da produção.
 *
 * Em 28/09 a demo (DEMO=1, outra casa, outra porta) abriu o WhatsApp do número
 * da produção — a sessão mora em <cwd>/tokens/<WPP_SESSAO>, fora da casa — e
 * disputou o mesmo bot do Telegram, derrubando o canal de verdade. Aqui a
 * produção é uma casa de mentira com um token guardado; nada sai pra rede.
 */
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = mkdtempSync(join(tmpdir(), 'demo-iso-'));
const casaDemo = join(raiz, 'demo');
const casaProducao = join(raiz, 'producao');
const TOKEN_PRODUCAO = '111111111:AAHtokenDaProducaoTokenDaProducao12';
const TOKEN_DEMO = '222222222:AAHtokenDaDemoTokenDaDemoTokenDemo12';

mkdirSync(join(casaProducao, 'canais'), { recursive: true });
writeFileSync(join(casaProducao, 'canais', 'telegram.json'), JSON.stringify({ token: TOKEN_PRODUCAO, ligado: true }));
/* A casa da demo como estava em 28/09: com o token da produção colado nela. */
mkdirSync(join(casaDemo, 'canais'), { recursive: true });
writeFileSync(join(casaDemo, 'canais', 'telegram.json'), JSON.stringify({ token: TOKEN_PRODUCAO, ligado: true }));

process.env.VS_HOME = casaDemo;
process.env.VS_HOME_PRODUCAO = casaProducao;
process.env.VSPROTOCOLO_DIR = join(casaDemo, 'proto');
process.env.DEMO = '1';
delete process.env.WPP_SESSAO;
/* Porta fechada: se a trava falhar, o teste erra rápido em vez de ir à rede. */
process.env.TELEGRAM_API_URL = 'http://127.0.0.1:9';
process.on('exit', () => { try { rmSync(raiz, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const canais = await import('../backend/canais.mjs');

test('demo recusa o bot do Telegram da produção, colado na tela', async () => {
  const r = await canais.conectar({ canal: 'telegram', token: TOKEN_PRODUCAO });
  assert.equal(r.ok, false);
  assert.match(r.erro, /bot do Telegram da produção/);
});

test('demo recusa o bot da produção que já estava guardado na casa dela', async () => {
  const r = await canais.conectar({ canal: 'telegram' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /bot do Telegram da produção/);
});

test('demo recusa abrir a sessão "veloso" do WhatsApp (a da produção)', async () => {
  const r = await canais.conectar({ canal: 'whatsapp-web' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /sessão do WhatsApp da produção/);
});

test('"Trocar número" na demo não desparea a produção', async () => {
  const r = await canais.trocarNumero({ canal: 'whatsapp-web' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /sessão do WhatsApp da produção/);
});

test('no boot a demo não religa o Telegram nem reabre o WhatsApp da produção', async () => {
  writeFileSync(join(casaDemo, 'canais', 'config.json'), JSON.stringify({ ligado: true }));
  const r = await canais.retomar({});
  assert.equal(r.ok, false);
  assert.match(r.erro, /sessão do WhatsApp da produção/);
  assert.equal(canais.telegramInfo().estado, 'desconectado');
});

test('o bot PRÓPRIO da demo passa pela trava (e só falha por não ter rede aqui)', async () => {
  const r = await canais.conectar({ canal: 'telegram', token: TOKEN_DEMO });
  assert.doesNotMatch(String(r.erro || ''), /produção/);
});
