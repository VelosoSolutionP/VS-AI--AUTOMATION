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
import { requiredSetsFor, precisaApplyConfig, buildAndValidate, modulosAtivos } from '../installer/onboarding.mjs';
import { applyProfiles } from '../engine/interview/apply.mjs';
import { requiredMissing } from '../engine/interview/install.mjs';
import { buildHooks, mergeHooks, installHooksInto } from '../installer/hooks-config.mjs';

const noop = () => {};
const respVendas = {
  empresa: { empresa_nome: 'ACME' },
  vendas: {
    vende: 'produtos', proposta_valor: 'melhor preço', icp: 'lojista gestor', tom: 'Direto',
    funil: 'Novo\nFechado', canais: ['WhatsApp'], plataformas_anuncio: ['Instagram'],
  },
};

/** Respostas mínimas do set dev — o único sempre obrigatório. */
const respDev = {
  branch_pattern: '<tipo>/<autor>/<numero>', branch_autor: 'nome.sobrenome',
  branch_tipos: ['fix', 'feat'], commit_pattern: '<tipo>(<escopo>): <desc>', commit_escopo: 'numero',
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

/* ---------------- hooks-config ---------------- */

test('buildHooks: cobre os eventos do fluxo e usa caminho absoluto da instalação', () => {
  const h = buildHooks('/opt/vsia/hooks');
  assert.deepEqual(Object.keys(h).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'UserPromptSubmit']);
  // o hook que conduz o fluxo da tarefa (número -> tipo -> origem -> repos)
  assert.equal(h.UserPromptSubmit[0].hooks[0].command, 'node /opt/vsia/hooks/on-task.mjs');
  assert.ok(!('matcher' in h.UserPromptSubmit[0]));
  const bash = h.PreToolUse.find((e) => e.matcher === 'Bash');
  assert.deepEqual(bash.hooks.map((x) => x.command), [
    'node /opt/vsia/hooks/on-commit.mjs',
    'node /opt/vsia/hooks/on-git-guard.mjs',
    'node /opt/vsia/hooks/on-qa-gate.mjs',
  ]);
});

test('mergeHooks: preserva hooks do cliente e não duplica ao reinstalar', () => {
  const doCliente = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node /meu/proprio.mjs' }] };
  const base = { theme: 'dark', hooks: { PreToolUse: [doCliente] } };

  const um = mergeHooks(base, '/opt/vsia/hooks');
  assert.equal(um.theme, 'dark'); // não mexe no resto do settings
  assert.ok(um.hooks.PreToolUse.some((e) => e.hooks[0].command === 'node /meu/proprio.mjs'));

  const dois = mergeHooks(um, '/opt/vsia/hooks'); // reinstalar
  assert.deepEqual(dois.hooks.PreToolUse.length, um.hooks.PreToolUse.length);
  assert.deepEqual(dois, um);
});

test('mergeHooks: trocar a pasta da suite não deixa hook órfão', () => {
  const antigo = mergeHooks({}, '/velho/hooks');
  const novo = mergeHooks(antigo, '/novo/hooks');
  const cmds = JSON.stringify(novo.hooks);
  assert.ok(!cmds.includes('/velho/hooks'));
  assert.ok(cmds.includes('/novo/hooks'));
});

test('installHooksInto: cria/mescla o settings da ferramenta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vshooks-'));
  const cfg = join(dir, 'settings.json');
  writeFileSync(cfg, JSON.stringify({ theme: 'dark' }));
  const r = installHooksInto(cfg, '/opt/vsia/hooks');
  const saved = JSON.parse(readFileSync(cfg, 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.hooks.UserPromptSubmit[0].hooks[0].command, 'node /opt/vsia/hooks/on-task.mjs');
  assert.ok(r.eventos.includes('UserPromptSubmit'));
});

test('detectFromHome: Claude Code expõe settingsPath (hooks); os outros não', () => {
  const found = detectFromHome('/home/x', (p) => p.includes('.claude') || p.includes('.cursor'));
  const cc = found.find((f) => f.tool === 'Claude Code');
  assert.ok(cc.settingsPath.includes('.claude/settings.json'));
  assert.notEqual(cc.settingsPath, cc.configPath); // hooks e MCP vivem em arquivos diferentes
  assert.equal(found.find((f) => f.tool === 'Cursor').settingsPath, null);
});

/* ---------------- trial ---------------- */

test('trial: 7 dias (não 30)', async () => {
  assert.equal(TRIAL_DAYS, 7);
  const t = await issueTrial({ email: 'x@y.com' });
  assert.equal(t.days, 7);
  // token assinado (se tem chave) ou pendente (cliente sem chave) — ambos válidos
  assert.ok(t.token != null || t.pending === true);
});

test('trial: chave genérica embutida ativa (assinada, plano trial)', async () => {
  const t = await issueTrial({ email: '' });
  assert.equal(t.pending, false);
  assert.ok(t.token && t.token.length > 100);
  assert.ok(t.fonte === 'generica' || t.fonte === 'assinada');
});

/* ---------------- install (impls injetados, sem tocar config real) ---------------- */

/* ---------------- onboarding (entrevista inline) ---------------- */

test('requiredSetsFor: cada produto puxa só os sets que consome', () => {
  assert.deepEqual(requiredSetsFor(['gate']).sort(), ['dev']);
  assert.deepEqual(requiredSetsFor(['vsqa']).sort(), ['dev', 'qa']);
  assert.deepEqual(requiredSetsFor(['vsanalista']).sort(), ['analista', 'dev']);
  assert.deepEqual(requiredSetsFor(['vsvendas']).sort(), ['empresa', 'vendas']);
  assert.equal(precisaApplyConfig(['vsvendas']), false);
  assert.equal(precisaApplyConfig(['vsdiretoria']), true);
});

test('requiredSetsFor: só o Gate não pergunta tracker nem sistema de QA', () => {
  const sets = requiredSetsFor(['gate']);
  assert.ok(!sets.includes('analista'));
  assert.ok(!sets.includes('qa'));
  assert.ok(!sets.includes('empresa'));
});

test('modulosAtivos: devolve todas as chaves, false pro que não foi escolhido', () => {
  assert.deepEqual(modulosAtivos(['gate']), { analista: false, qa: false });
  assert.deepEqual(modulosAtivos(['gate', 'vsqa']), { analista: false, qa: true });
  assert.deepEqual(modulosAtivos(['vsdiretoria']), { analista: true, qa: false });
  assert.deepEqual(modulosAtivos([]), { analista: false, qa: false });
});

test('applyProfiles: grava enabled do módulo sem apagar credencial já existente', () => {
  const base = { integrations: { redmine: { enabled: true, baseUrl: 'https://r', apiKey: 'k', projectId: 7 } } };
  const { company } = applyProfiles(base, { dev: respDev, modulos: { analista: false, qa: false } });
  assert.equal(company.integrations.redmine.enabled, false);
  assert.equal(company.integrations.redmine.apiKey, 'k'); // credencial preservada
  assert.equal(company.integrations.qa.enabled, false);
});

test('requiredMissing: módulo desligado não cobra credencial; ligado cobra', () => {
  const so = (sel) => applyProfiles({}, { dev: respDev, modulos: modulosAtivos(sel) }).company;
  assert.deepEqual(requiredMissing(so(['gate'])), []); // Gate puro instala
  assert.ok(requiredMissing(so(['gate', 'vsqa'])).some((m) => m.startsWith('qa:')));
  assert.ok(requiredMissing(so(['gate', 'vsanalista'])).some((m) => m.startsWith('analista:')));
});

test('buildAndValidate: aponta obrigatórias faltando; ok quando completo', () => {
  const faltou = buildAndValidate(['vendas'], { vendas: { funil: 'Novo' } });
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
    trialImpl: async () => ({ token: 'tk', days: 7, fonte: 'test' }),
    markImpl: () => ({}), scheduleImpl: () => ({ scheduled: true, tool: 'test' }),
    detectImpl: () => [{ tool: 'Claude Code', configPath: '/fake/.claude.json' }],
    installImpl: (path) => { escritos.push(path); return { path, servidor: SERVER_NAME }; },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.escolhidos, ['vsvendas']);
  assert.equal(r.trial.days, 7);
  assert.equal(r.trava.scheduled, true);
  assert.ok(salvos.includes('empresa') && salvos.includes('vendas'));
  assert.equal(r.configurados[0].tool, 'Claude Code');
  assert.equal(r.treinamento.gratis, true);
  assert.equal(escritos[0], '/fake/.claude.json');
});

test('runInstall: sem ferramenta detectada -> semFerramenta', async () => {
  const r = await runInstall({ email: 'a@b.com', produtos: ['vsvendas'], respostas: respVendas, saveImpl: noop, trialImpl: async () => ({ token: 'tk', days: 7 }), markImpl: () => ({}), scheduleImpl: () => ({}), detectImpl: () => [] });
  assert.equal(r.semFerramenta, true);
});
