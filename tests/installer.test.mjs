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
import { requiredSetsFor, precisaApplyConfig, buildAndValidate } from '../installer/onboarding.mjs';

const noop = () => {};
const respVendas = {
  empresa: { empresa_nome: 'ACME', vende: 'produtos', proposta_valor: 'melhor preço', icp: 'lojista gestor', tom: 'Direto' },
  vendas: { funil: 'Novo\nFechado', canais: ['WhatsApp'], plataformas_anuncio: ['Instagram'] },
};

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

/* ---------------- onboarding (entrevista inline) ---------------- */

test('requiredSetsFor: dev-flow puxa empresa+dev+analista+qa; vendas puxa empresa+vendas', () => {
  assert.deepEqual(requiredSetsFor(['vsqa']).sort(), ['analista', 'dev', 'empresa', 'qa']);
  assert.deepEqual(requiredSetsFor(['vsvendas']).sort(), ['empresa', 'vendas']);
  assert.equal(precisaApplyConfig(['vsvendas']), false);
  assert.equal(precisaApplyConfig(['vsdiretoria']), true);
});

test('buildAndValidate: aponta obrigatórias faltando; ok quando completo', () => {
  const faltou = buildAndValidate(['empresa'], { empresa: { empresa_nome: 'X' } });
  assert.ok(faltou.erros.length > 0);
  const ok = buildAndValidate(['empresa', 'vendas'], respVendas);
  assert.equal(ok.erros.length, 0);
  assert.deepEqual(ok.perfis.vendas.funil, ['Novo', 'Fechado']); // list coagida
});

/* ---------------- install ---------------- */

test('runInstall: seleção inválida não instala', async () => {
  const r = await runInstall({ email: 'a@b.com', produtos: ['vssuporte'] });
  assert.equal(r.ok, false);
});

test('runInstall: entrevista incompleta bloqueia', async () => {
  const r = await runInstall({ email: 'a@b.com', produtos: ['vsvendas'], respostas: {}, saveImpl: noop });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /empresa|vendas/.test(e)));
});

test('runInstall: instala nos alvos detectados (vendas, injetado)', async () => {
  const salvos = [];
  const escritos = [];
  const r = await runInstall({
    email: 'a@b.com', empresa: 'ACME', produtos: ['vsvendas'], respostas: respVendas,
    saveImpl: (set) => salvos.push(set),
    detectImpl: () => [{ tool: 'Claude Code', configPath: '/fake/.claude.json' }],
    installImpl: (path) => { escritos.push(path); return { path, servidor: SERVER_NAME }; },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.escolhidos, ['vsvendas']);
  assert.equal(r.trial.days, 7);
  assert.ok(salvos.includes('empresa') && salvos.includes('vendas'));
  assert.equal(r.configurados[0].tool, 'Claude Code');
  assert.equal(r.treinamento.gratis, true);
  assert.equal(escritos[0], '/fake/.claude.json');
});

test('runInstall: sem ferramenta detectada -> semFerramenta', async () => {
  const r = await runInstall({ email: 'a@b.com', produtos: ['vsvendas'], respostas: respVendas, saveImpl: noop, detectImpl: () => [] });
  assert.equal(r.semFerramenta, true);
});
