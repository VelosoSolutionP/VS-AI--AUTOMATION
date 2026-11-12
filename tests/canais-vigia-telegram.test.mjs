/* Vigia x Telegram sem internet (11/11): o laço do Telegram fica "caído" tentando
   sozinho e o conectar responde ok. A vigia não pode chamar de novo sem fim —
   isso estourou a memória do painel de produção 76 vezes num dia. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'canais-vigia-tg-'));
process.env.HOME = casa;
process.env.VS_HOME = join(casa, '.qa-gate');
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
mkdirSync(join(casa, '.qa-gate', 'canais'), { recursive: true });
writeFileSync(join(casa, '.qa-gate', 'canais', 'telegram.json'), JSON.stringify({ ligado: true, token: '123456:' + 'A'.repeat(35) }));

/* Telegram falso: getMe responde, a leitura de mensagens não (internet caiu). */
const tg = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (/getUpdates/.test(req.url)) { res.writeHead(502); return res.end(JSON.stringify({ ok: false, description: 'sem rede' })); }
  res.end(JSON.stringify({ ok: true, result: /getMe/.test(req.url) ? { id: 1, username: 'BotTeste' } : true }));
});
await new Promise((r) => tg.listen(0, '127.0.0.1', r));
process.env.TELEGRAM_API_URL = `http://127.0.0.1:${tg.address().port}`;
delete process.env.WHATSAPP_CANAL;

const canais = await import('../backend/canais.mjs');
test.after(async () => { await canais.desconectar?.().catch(() => {}); tg.close(); rmSync(casa, { recursive: true, force: true }); process.exit(0); });

test('Telegram caído tentando sozinho: a vigia tenta uma vez e para (sem recursão infinita)', async () => {
  await canais.retomar();
  for (let i = 0; i < 50; i++) { if (canais.status?.().telegram?.estado === 'caido') break; await new Promise((r) => setTimeout(r, 20)); }
  const corrida = canais.vigiarCanais({ agora: Date.now() });
  const r = await Promise.race([corrida, new Promise((res) => setTimeout(() => res('travou'), 3000))]);
  assert.notEqual(r, 'travou', 'a vigia terminou');
  assert.ok(r.filter((x) => x.canal === 'telegram').length <= 1, 'no máximo uma tentativa por batida');
});
