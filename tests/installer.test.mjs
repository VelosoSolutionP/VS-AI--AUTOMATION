import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUTOS, TRIAL_DAYS, validarSelecao, disponiveis } from '../installer/catalog.mjs';
import { detectFromHome } from '../installer/detect.mjs';
import { serverEntry, mergeServer, installIntoTool, SERVER_NAME } from '../installer/mcp-config.mjs';
import { issueTrial } from '../installer/trial.mjs';
import { runInstall } from '../installer/install.mjs';

/* ---------------- catalog ---------------- */

test('catalog: tem 1 coming_soon (falta uma ferramenta) e vários disponíveis', () => {
  assert.ok(PRODUTOS.some((p) => p.status === 'coming_soon'));
  assert.ok(disponiveis().length >= 4);
});

test('validarSelecao: rejeita coming_soon e desconhecido; exige ao menos 1', () => {
  assert.equal(validarSelecao(['vsqa', 'vssuporte']).escolhidos.join(','), 'vsqa');
  assert.equal(validarSelecao(['vssuporte']).ok, false); // só coming_soon -> nada válido
  assert.equal(validarSelecao(['xpto']).ok, false);
  assert.equal(validarSelecao([]).ok, false);
  assert.equal(validarSelecao(['vsqa', 'vsvendas']).ok, true);
});

/* ---------------- detect ---------------- */

test('detectFromHome: acha ferramentas pelo probe', () => {
  const home = '/home/x';
  const exists = (p) => p.includes('.claude') || p.includes('.cursor');
  const found = detectFromHome(home, exists);
  const tools = found.map((f) => f.tool);
  assert.ok(tools.includes('Claude Code'));
  assert.ok(tools.includes('Cursor'));
  assert.ok(!tools.includes('Windsurf'));
  assert.ok(found.find((f) => f.tool === 'Claude Code').configPath.includes('.claude.json'));
});

/* ---------------- mcp-config ---------------- */

test('serverEntry + mergeServer: preserva outros servidores', () => {
  const entry = serverEntry('/x/mcp/server.mjs', 'TOKEN');
  assert.equal(entry.command, 'node');
  assert.equal(entry.env.QA_GATE_LICENSE, 'TOKEN');
  const merged = mergeServer({ mcpServers: { outro: { command: 'x' } } }, entry);
  assert.ok(merged.mcpServers.outro); // preservado
  assert.ok(merged.mcpServers[SERVER_NAME]); // adicionado
});

test('installIntoTool: cria/mescla o arquivo de config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vsinst-'));
  const cfg = join(dir, 'mcp.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: { existente: { command: 'z' } } }));
  installIntoTool(cfg, serverEntry('/s.mjs', 'K'));
  const saved = JSON.parse(readFileSync(cfg, 'utf8'));
  assert.ok(saved.mcpServers.existente);
  assert.equal(saved.mcpServers[SERVER_NAME].args[0], '/s.mjs');
});

/* ---------------- trial ---------------- */

test('trial: 7 dias (não 30)', async () => {
  assert.equal(TRIAL_DAYS, 7);
  const t = await issueTrial({ email: 'x@y.com' });
  assert.equal(t.days, 7);
  // token assinado (se tem chave) ou pendente (cliente sem chave) — ambos válidos
  assert.ok(t.token != null || t.pending === true);
});

test('trial: sem email -> pendente', async () => {
  const t = await issueTrial({ email: '' });
  assert.equal(t.pending, true);
});

/* ---------------- install (impls injetados, sem tocar config real) ---------------- */

test('runInstall: seleção inválida não instala', async () => {
  const r = await runInstall({ email: 'a@b.com', produtos: ['vssuporte'] });
  assert.equal(r.ok, false);
});

test('runInstall: instala nos alvos detectados (injetado)', async () => {
  const escritos = [];
  const r = await runInstall({
    email: 'a@b.com', empresa: 'ACME', produtos: ['vsqa', 'vsvendas'],
    detectImpl: () => [{ tool: 'Claude Code', configPath: '/fake/.claude.json' }],
    installImpl: (path) => { escritos.push(path); return { path, servidor: SERVER_NAME }; },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.escolhidos, ['vsqa', 'vsvendas']);
  assert.equal(r.trial.days, 7);
  assert.equal(r.configurados.length, 1);
  assert.equal(r.configurados[0].tool, 'Claude Code');
  assert.equal(r.treinamento.gratis, true);
  assert.equal(escritos[0], '/fake/.claude.json');
});

test('runInstall: sem ferramenta detectada -> semFerramenta', async () => {
  const r = await runInstall({ email: 'a@b.com', produtos: ['vsqa'], detectImpl: () => [] });
  assert.equal(r.semFerramenta, true);
});
