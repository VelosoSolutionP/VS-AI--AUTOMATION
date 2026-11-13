/** Modelos do 0007 (12/11): nome validado, teto de 3B da máquina, download com progresso entra no catálogo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'modelos-0007-'));
process.env.VS_HOME = casa; process.env.VSCRM_DIR = join(casa, 'vscrm');
delete process.env.VS_OLLAMA_MAX_B;
const M = await import('../engine/vs0007/modelos.mjs');
test.after(() => rmSync(casa, { recursive: true, force: true }));

test('recusa modelo maior que 3B e nome sem tamanho', () => {
  assert.match(M.validarNome('qwen2.5:7b').erro, /aguenta até 3B/);
  assert.match(M.validarNome('gemma3').erro, /tamanho/);
  assert.match(M.validarNome('rm -rf /').erro, /inválido/);
  assert.equal(M.validarNome('gemma3:1b').id, 'gemma3:1b');
});

test('download com progresso entra no catálogo e chama aoTerminar', async () => {
  const linhas = [{ status: 'pulling manifest' }, { status: 'pulling x', total: 100, completed: 50 }, { status: 'pulling x', total: 100, completed: 100 }, { status: 'success' }];
  const corpo = (async function* () { for (const l of linhas) yield new TextEncoder().encode(JSON.stringify(l) + '\n'); })();
  const fetchFalso = async () => ({ ok: true, status: 200, body: corpo });
  let terminou = null;
  const r = M.baixar({ modelo: 'gemma3:1b', fetch: fetchFalso, aoTerminar: async (id) => { terminou = id; } });
  assert.ok(r.ok);
  for (let i = 0; i < 50 && M.statusDownloads()[0].estado === 'baixando'; i++) await new Promise((ok) => setTimeout(ok, 10));
  const d = M.statusDownloads()[0];
  assert.equal(d.estado, 'pronto'); assert.equal(d.feito, 100);
  assert.equal(terminou, 'gemma3:1b');
  assert.ok(M.catalogo().some((m) => m.id === 'gemma3:1b' && /Gemma/.test(m.nome)));
});

test('erro do Ollama aparece no status', async () => {
  const corpo = (async function* () { yield new TextEncoder().encode('{"error":"pull model manifest: file does not exist"}\n'); })();
  M.baixar({ modelo: 'naoexiste:1b', fetch: async () => ({ ok: true, status: 200, body: corpo }) });
  for (let i = 0; i < 50 && M.statusDownloads().find((x) => x.id === 'naoexiste:1b').estado === 'baixando'; i++) await new Promise((ok) => setTimeout(ok, 10));
  const d = M.statusDownloads().find((x) => x.id === 'naoexiste:1b');
  assert.equal(d.estado, 'erro'); assert.match(d.erro, /does not exist/);
});
