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
import { checkApp, simulateFlows, runGate, loadConfig } from '../engine/core.mjs';
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

/* ---- qa_simulate (licenciado) ---- */
server.tool('qa_simulate',
  'Simula UM fluxo em browser real: injeta bug (submit vazio) e exige mensagem amigável + console limpo. Retorna status + screenshot inline.',
  {
    configPath: z.string().describe('caminho do qa-gate.config.json (login/baseUrl)'),
    path: z.string().describe('rota do fluxo, ex: /clientes/create'),
    submitText: z.string().optional(),
    submitSelector: z.string().optional(),
    expectFriendlyError: z.boolean().optional(),
  },
  async ({ configPath, path, submitText, submitSelector, expectFriendlyError }) => {
    requireLicense();
    const cfg = loadConfig(configPath);
    if (!cfg) { throw new Error('sem config em ' + configPath); }
    const flow = { name: 'adhoc' + path, path, submitText, submitSelector, expectFriendlyError };
    const [res] = await simulateFlows(cfg, [flow], { repo: configPath });
    const content = [text(`${res.status === 'green' ? '✔ VERDE' : '✖ VERMELHO'} ${path}\n${res.errors.join('\n') || 'bug injetado retornou msg amigável, console limpo'}`)];
    const img = res.screenshot && imageOf(res.screenshot);
    if (img) { content.push(img); }
    return { content, isError: res.status === 'red' };
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
