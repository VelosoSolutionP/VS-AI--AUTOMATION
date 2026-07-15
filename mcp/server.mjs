#!/usr/bin/env node
/**
 * QA-Gate MCP server (stdio). Camada interativa: o modelo dirige o browser
 * a qualquer momento, recebe resultado estruturado + screenshot inline.
 * Tools de simulação exigem licença válida (validação offline Ed25519).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { checkApp, simulateFlows, runGate, loadConfig, targetsFor } from '../engine/core.mjs';
import { validateTask } from '../engine/requirements.mjs';
import { loadEvents, aggregate, report } from '../engine/metrics.mjs';
import { hasConsent } from '../engine/consent.mjs';
import { verifyLicense, currentLicenseToken } from '../license/license.mjs';

const server = new McpServer({ name: 'qa-gate', version: '1.0.0' });

function requireLicense() {
  const res = verifyLicense(currentLicenseToken());
  if (!res.valid) { throw new Error('QA-Gate licença inválida: ' + res.reason); }
  return res.license;
}
const text = (t) => ({ type: 'text', text: t });
function imageOf(path) {
  try { return { type: 'image', data: readFileSync(path).toString('base64'), mimeType: 'image/jpeg' }; }
  catch { return null; }
}

/* ---- qa_validate_task (livre — triagem de requisito antes da IA) ---- */
server.tool('qa_validate_task',
  'Valida se uma tarefa tem requisito suficiente ANTES de acionar a IA. Retorna codigo REQ (VS-REQ-001..005), o que falta e se deve escalar pro modelo (causa raiz/arquitetura/seguranca). Deterministico, ~0 token.',
  { task: z.string().describe('texto/descricao da tarefa'), pending: z.boolean().optional().describe('true se o dev deixou a tarefa aguardando requisito') },
  async ({ task, pending }) => {
    const r = validateTask(task, { pending });
    const lines = [
      `${r.short}`,
      r.blocked ? '► BLOQUEADO (IA nao acionada)' : '► liberado para o fluxo',
      r.missing.length ? `► falta: ${r.missing.join(', ')}` : '► requisito completo',
      `► escalar IA: ${r.escalate.call_ai ? 'SIM (' + r.escalate.reason + ')' : 'nao — trata local'}`,
      '',
      r.dev_msg,
    ];
    return { content: [text(lines.join('\n'))], isError: r.blocked };
  });

/* ---- qa_report (dashboard executivo anonimo, licenciado) ---- */
server.tool('qa_report',
  'Gera o relatorio executivo anonimo de governanca (tempo economizado, reducao de tokens, chamadas de IA evitadas, retrabalho, ROI). Agregado, sem nomes.',
  { squad: z.string().optional(), period: z.string().optional() },
  async ({ squad, period }) => {
    requireLicense();
    if (!hasConsent()) { return { content: [text('[VS-MON-003] Coleta desativada (sem consentimento). Sem telemetria para relatar.')] }; }
    const ev = loadEvents();
    if (!ev.length) { return { content: [text('Sem eventos coletados ainda.')] }; }
    return { content: [text(report(aggregate(ev), { squad, period }))] };
  });

/* ---- qa_check_app (livre) ---- */
server.tool('qa_check_app',
  'Verifica se o app local está no ar antes de simular.',
  { baseUrl: z.string(), healthPath: z.string().optional() },
  async ({ baseUrl, healthPath }) => {
    const up = await checkApp(baseUrl, healthPath || '/login');
    return { content: [text(up ? `✔ app no ar em ${baseUrl}` : `✖ app não responde em ${baseUrl}`)] };
  });

/* ---- qa_list_flows (livre) ---- */
server.tool('qa_list_flows',
  'Lista os fluxos configurados no qa-gate.config.json do projeto.',
  { configPath: z.string() },
  async ({ configPath }) => {
    const cfg = loadConfig(configPath);
    if (!cfg) { return { content: [text('sem config em ' + configPath)] }; }
    return { content: [text(JSON.stringify((cfg.flows || []).map((f) => ({ name: f.name, path: f.path })), null, 2))] };
  });

/* ---- qa_simulate (licenciado) — multi-alvo (front/mobile/ambos) ---- */
server.tool('qa_simulate',
  'Simula UM fluxo em browser real: injeta bug (submit vazio) e exige mensagem amigável + console limpo. ALVO: front | mobile | (vazio=ambos). Retorna status + screenshot inline por alvo. Use pra DIAGNOSTICAR bug de CRUD/validação: reproduz o erro real.',
  {
    configPath: z.string().describe('caminho do qa-gate.config.json'),
    path: z.string().describe('rota do fluxo, ex: /medico/pacientes/36/editar'),
    alvo: z.enum(['front', 'mobile']).optional().describe('vazio = roda front E mobile'),
    submitText: z.string().optional(),
    submitSelector: z.string().optional(),
    expectFriendlyError: z.boolean().optional(),
  },
  async ({ configPath, path, alvo, submitText, submitSelector, expectFriendlyError }) => {
    requireLicense();
    const cfg = loadConfig(configPath);
    if (!cfg) { throw new Error('sem config em ' + configPath); }
    const flow = { name: 'adhoc' + path, path, submitText, submitSelector, expectFriendlyError };
    const content = [];
    let anyRed = false;
    for (const { name, tcfg } of targetsFor(cfg, alvo)) {
      const up = await checkApp(tcfg.baseUrl, tcfg.healthPath || cfg.healthPath);
      if (!up) { content.push(text(`⚠ ${name}: app fora do ar (${tcfg.baseUrl}) — não testado`)); continue; }
      const [res] = await simulateFlows({ ...tcfg }, [flow], { repo: `${configPath}-${name}` });
      if (res.status === 'red') { anyRed = true; }
      content.push(text(`${res.status === 'green' ? '✔ VERDE' : '✖ VERMELHO'} [${name}] ${path}\n${res.errors.join('\n') || 'bug injetado retornou msg amigável, console limpo'}`));
      const img = res.screenshot && imageOf(res.screenshot);
      if (img) { content.push(img); }
    }
    if (!content.length) { content.push(text('nenhum alvo configurado/no ar')); }
    return { content, isError: anyRed };
  });

/* ---- qa_run_gate (licenciado) ---- */
server.tool('qa_run_gate',
  'Roda o gate completo a partir do diff staged do repo (igual ao pre-commit). Backend puro pula browser.',
  { repo: z.string(), configPath: z.string().optional() },
  async ({ repo, configPath }) => {
    requireLicense();
    const cfg = configPath || `${repo}/qa-gate.config.json`;
    const r = await runGate(repo, cfg);
    const lines = [`status: ${r.status}${r.reason ? ' — ' + r.reason : ''}`];
    (r.results || []).forEach((x) => lines.push(`  ${x.status === 'green' ? '✔' : '✖'} ${x.name}${x.errors?.length ? ' — ' + x.errors.join('; ') : ''}`));
    const content = [text(lines.join('\n'))];
    const firstRed = (r.results || []).find((x) => x.status === 'red' && x.screenshot);
    if (firstRed) { const img = imageOf(firstRed.screenshot); if (img) { content.push(img); } }
    return { content, isError: r.status === 'red' || r.status === 'error' };
  });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[qa-gate-mcp] pronto (stdio)');
