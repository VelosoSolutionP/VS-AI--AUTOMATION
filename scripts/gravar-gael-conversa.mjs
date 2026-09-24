/**
 * Vídeo da conversa do Gael, estilo tela de WhatsApp, pra mandar pra avaliação.
 *
 * As respostas são REAIS: rodam pelo mesmo motor que atende cliente, num
 * ambiente isolado. O vídeo é vertical (cara de celular) pra ficar bom mandado
 * no próprio WhatsApp.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const casa = mkdtempSync(join(tmpdir(), 'gael-video-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ok */ } });

const bot = await import('../engine/vsbot/index.mjs');
const { fluxoDeCsv } = await import('../engine/vsbot/fluxo-csv.mjs');
const f = fluxoDeCsv(readFileSync(new URL('../exemplos/fluxo-gael-advocacia.csv', import.meta.url), 'utf8'));
bot.salvarFluxo(f.fluxo.passos);
bot.salvarConfig({ ativo: true, nome: 'Gael', assinarMensagens: false });

// Roteiro: um cliente marcando consulta criminal. Troque à vontade.
const ROTEIRO = ['oi', '2', '1', 'fui indiciado num inquérito e não sei o que fazer', '1', '5', 'Maria Souza', 'amanhã de tarde'];
const de = 'cliente-video';
const turnos = [];
for (const msg of ROTEIRO) {
  const r = bot.atender(msg, { de });
  turnos.push({ eu: msg, bot: String(r.texto || '').replace(/\*/g, '') });
}

const DIR = process.env.SAIDA || 'video-gael';
const MP4 = join(DIR, 'gael-conversa.mp4');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const navegador = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const ctx = await navegador.newContext({ viewport: { width: 440, height: 900 }, locale: 'pt-BR', deviceScaleFactor: 2 });
const pg = await ctx.newPage();

await pg.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{background:#0b141a}
  .topo{background:#005c4b;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px}
  .av{width:40px;height:40px;border-radius:50%;background:#25d366;display:grid;place-items:center;font-weight:700;color:#053d32}
  .nome{font-size:16px;font-weight:600}.st{font-size:12px;opacity:.8}
  .chat{padding:14px;display:flex;flex-direction:column;gap:8px;min-height:100vh;
    background:#0b141a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ccircle cx='30' cy='30' r='1' fill='%23ffffff08'/%3E%3C/svg%3E")}
  .b{max-width:80%;padding:8px 11px;border-radius:9px;font-size:15px;line-height:1.4;white-space:pre-wrap;box-shadow:0 1px 1px #0003}
  .eu{align-self:flex-end;background:#005c4b;color:#e9edef;border-bottom-right-radius:2px}
  .ela{align-self:flex-start;background:#202c33;color:#e9edef;border-bottom-left-radius:2px}
  .h{font-size:11px;opacity:.6;margin-top:3px;text-align:right}
  .dig{align-self:flex-start;background:#202c33;color:#8696a0;font-size:14px;padding:9px 13px;border-radius:9px}
</style></head><body>
  <div class="topo"><div class="av">G</div><div><div class="nome">Gael · Escritório</div><div class="st" id="st">online</div></div></div>
  <div class="chat" id="chat"></div>
</body></html>`);

const quadros = [];
async function quadro(seg) { const n = `q${String(quadros.length).padStart(3, '0')}.png`; await pg.screenshot({ path: join(DIR, n) }); quadros.push({ n, seg }); }
const hora = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

await quadro(1.2);
for (const t of turnos) {
  await pg.evaluate(([txt, h]) => {
    const c = document.getElementById('chat');
    c.insertAdjacentHTML('beforeend', `<div class="b eu">${txt}<div class="h">${h} ✓✓</div></div>`);
    window.scrollTo(0, document.body.scrollHeight);
  }, [t.eu, hora()]);
  await quadro(1.0);
  await pg.evaluate(() => { document.getElementById('st').textContent = 'digitando…';
    document.getElementById('chat').insertAdjacentHTML('beforeend', '<div class="dig" id="dig">digitando…</div>');
    window.scrollTo(0, document.body.scrollHeight); });
  await quadro(1.0);
  await pg.evaluate(([txt, h]) => {
    document.getElementById('dig')?.remove();
    document.getElementById('st').textContent = 'online';
    document.getElementById('chat').insertAdjacentHTML('beforeend', `<div class="b ela">${txt}<div class="h">${h}</div></div>`);
    window.scrollTo(0, document.body.scrollHeight);
  }, [t.bot, hora()]);
  await quadro(Math.min(4.5, 1.8 + t.bot.length / 45));
}
await quadro(2.5);
await ctx.close(); await navegador.close();

const lista = quadros.map((q) => `file '${q.n}'\nduration ${q.seg}`).join('\n') + `\nfile '${quadros[quadros.length - 1].n}'\n`;
writeFileSync(join(DIR, 'lista.txt'), lista);
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(DIR, 'lista.txt'),
  '-vf', 'scale=880:1800:force_original_aspect_ratio=decrease,pad=880:1800:(ow-iw)/2:(oh-ih)/2,fps=25',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '23', MP4], { stdio: 'pipe' });
console.log(`quadros: ${quadros.length}\nvideo  : ${MP4}`);
