#!/usr/bin/env node
/**
 * VS-IA MCP — MÓDULO DEV (stdio).
 *
 * Recorte local da suite: só a linha de DEV (triagem de requisito + QA-Gate em
 * browser real + relatório de governança). Fora daqui: vsqa/vsanalista/
 * vsdiretoria/vsvendas e a entrevista de onboarding.
 *
 * SEM licença e SEM entrevista de propósito: a emissão/validação de chave saiu
 * junto com o backend comprometido. Enquanto a chave não volta, a governança
 * (hooks + gate) roda sozinha, offline, sem depender de servidor nenhum.
 * O padrão da empresa vem do company-config (~/.qa-gate/company.json), que a
 * entrevista só preenchia.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { checkApp, ensureUp, simulateFlows, runGate, loadConfig, targetsFor } from '../engine/core.mjs';
import { validateTask } from '../engine/requirements.mjs';
import { loadEvents, aggregate, report } from '../engine/metrics.mjs';
import { hasConsent } from '../engine/consent.mjs';
import { notify, projectLabel, receiptSummary } from '../engine/notify-whatsapp.mjs';

const server = new McpServer({ name: 'vs-ia-dev', version: '1.1.0-dev' });

const text = (t) => ({ type: 'text', text: t });
// Nome do projeto no recibo: MESMA regra dos hooks (projectLabel = pai/base ou
// config.projectName), pra não sair "frontend" no MCP e "Velvet/frontend" no hook.
function projectName(repo) {
  return projectLabel(repo);
}
function taskFromBranch(repo) {
  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    const m = b.match(/(\d{3,})/);
    return m ? m[1] : null;
  } catch { return null; }
}
function imageOf(path) {
  try { return { type: 'image', data: readFileSync(path).toString('base64'), mimeType: 'image/jpeg' }; }
  catch { return null; }
}

/* ---- qa_validate_task — triagem de requisito antes da IA ---- */
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

/* ---- qa_report — dashboard executivo anonimo ---- */
server.tool('qa_report',
  'Gera o relatorio executivo anonimo de governanca (tempo economizado, reducao de tokens, chamadas de IA evitadas, retrabalho, ROI). Agregado, sem nomes.',
  { squad: z.string().optional(), period: z.string().optional() },
  async ({ squad, period }) => {
    if (!hasConsent()) { return { content: [text('[VS-MON-003] Coleta desativada (sem consentimento). Sem telemetria para relatar.')] }; }
    const ev = loadEvents();
    if (!ev.length) { return { content: [text('Sem eventos coletados ainda.')] }; }
    return { content: [text(report(aggregate(ev), { squad, period }))] };
  });

/* ---- qa_check_app ---- */
server.tool('qa_check_app',
  'Verifica se o app local está no ar antes de simular.',
  { baseUrl: z.string(), healthPath: z.string().optional() },
  async ({ baseUrl, healthPath }) => {
    const up = await checkApp(baseUrl, healthPath || '/login');
    return { content: [text(up ? `✔ app no ar em ${baseUrl}` : `✖ app não responde em ${baseUrl}`)] };
  });

/* ---- qa_list_flows ---- */
server.tool('qa_list_flows',
  'Lista os fluxos configurados no qa-gate.config.json do projeto.',
  { configPath: z.string() },
  async ({ configPath }) => {
    const cfg = loadConfig(configPath);
    if (!cfg) { return { content: [text('sem config em ' + configPath)] }; }
    return { content: [text(JSON.stringify((cfg.flows || []).map((f) => ({ name: f.name, path: f.path })), null, 2))] };
  });

/* ---- qa_simulate — multi-alvo (front/mobile/ambos) ---- */
server.tool('qa_simulate',
  'Simula UM fluxo em browser real: injeta bug (submit vazio) e exige mensagem amigável + console limpo. ALVO: front | mobile | (vazio=ambos). Retorna status + screenshot inline por alvo. Use pra DIAGNOSTICAR bug de CRUD/validação: reproduz o erro real.',
  {
    configPath: z.string().describe('caminho do qa-gate.config.json'),
    path: z.string().describe('rota do fluxo, ex: /medico/pacientes/36/editar'),
    alvo: z.enum(['front', 'mobile']).optional().describe('vazio = roda front E mobile'),
    mode: z.enum(['form', 'read']).optional().describe('form=injeta bug via submit + exige msg amigavel (default). read=lista/visualiza sem submit, exige conteudo renderizado'),
    submitText: z.string().optional(),
    submitSelector: z.string().optional(),
    fill: z.record(z.string(), z.string()).optional().describe('form: preenche campos ANTES do submit p/ reproduzir validacao de negocio. Ex: {"#email":"existente@x.com","#nome":"Teste"} (email duplicado, formato invalido)'),
    expectFriendlyError: z.boolean().optional(),
    expectMessageText: z.string().optional().describe('form: exige que a msg amigavel contenha esse texto (ex: "ja cadastrado")'),
    expectSelector: z.string().optional().describe('read: seletor que DEVE renderizar (ex: linha da tabela)'),
    expectMinCount: z.number().optional().describe('read: quantidade minima do expectSelector (ex: 1)'),
    expectText: z.string().optional().describe('read: texto que deve aparecer no DOM'),
  },
  async ({ configPath, path, alvo, mode, submitText, submitSelector, fill, expectFriendlyError, expectMessageText, expectSelector, expectMinCount, expectText }) => {
    const cfg = loadConfig(configPath);
    if (!cfg) { throw new Error('sem config em ' + configPath); }
    const flow = { name: 'adhoc' + path, path, mode, submitText, submitSelector, fill, expectFriendlyError, expectMessageText, expectSelector, expectMinCount, expectText };
    const content = [];
    let anyRed = false;
    for (const { name, tcfg } of targetsFor(cfg, alvo)) {
      const up = tcfg.start ? await ensureUp(tcfg.baseUrl, tcfg.healthPath || cfg.healthPath, tcfg) : await checkApp(tcfg.baseUrl, tcfg.healthPath || cfg.healthPath);
      if (!up) { content.push(text(`⚠ ${name}: app fora do ar (${tcfg.baseUrl}) — não subiu/não testado`)); continue; }
      const [res] = await simulateFlows({ ...tcfg }, [flow], { repo: `${configPath}-${name}` });
      if (res.status === 'red') { anyRed = true; }
      content.push(text(`${res.status === 'green' ? '✔ VERDE' : '✖ VERMELHO'} [${name}] ${path}\n${res.errors.join('\n') || 'bug injetado retornou msg amigável, console limpo'}`));
      const img = res.screenshot && imageOf(res.screenshot);
      if (img) { content.push(img); }
    }
    if (!content.length) { content.push(text('nenhum alvo configurado/no ar')); }
    return { content, isError: anyRed };
  });

/* ---- qa_run_gate — gate completo do diff staged ---- */
server.tool('qa_run_gate',
  'Roda o gate completo a partir do diff staged do repo (igual ao pre-commit). Backend puro pula browser.',
  {
    repo: z.string(),
    configPath: z.string().optional(),
    summary: z.string().optional().describe('solucao/o que foi feito (correcao unica) — vai no comprovante'),
    backend: z.string().optional().describe('o que foi feito no BACK nesta tarefa (card separa por stack)'),
    frontend: z.string().optional().describe('o que foi feito no FRONT nesta tarefa (card separa por stack)'),
    mobile: z.string().optional().describe('o que foi feito no MOBILE nesta tarefa (card separa por stack)'),
  },
  async ({ repo, configPath, summary, backend, frontend, mobile }) => {
    const cfg = configPath || `${repo}/qa-gate.config.json`;
    const r = await runGate(repo, cfg);
    // RECIBO VERDE: prova determinística p/ o git-guard liberar o commit (front/back).
    // Só grava no verde; qualquer edição posterior invalida (git-guard compara com o
    // mtime dos arquivos staged). Sem recibo fresco = commit BLOQUEADO (VS-GATE-001).
    try {
      const receipt = join(repo, '.git', 'qa-gate-green.json');
      if (r.status === 'green') {
        let branch = '';
        try { branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim(); } catch {}
        writeFileSync(receipt, JSON.stringify({ status: 'green', branch, ts: Date.now() }));
      }
    } catch {}
    // COMPROVANTE WhatsApp/Slack — AGUARDA e CAPTURA o status de ENTREGA. Verde no
    // gate != recibo entregue: a IA/dev precisa VER se o aviso saiu. notify() nunca lança.
    let waStatus = null;
    try {
      const project = projectName(repo);
      const task = taskFromBranch(repo);
      const solution = (backend || frontend || mobile) ? { back: backend, front: frontend, mobile } : summary;
      if (r.status === 'green') {
        waStatus = await notify({ project, task, kind: 'green', problem: 'gate verde', solution }, repo);
      } else if (r.status === 'red') {
        const errs = (r.results || [])
          .filter((x) => x.status === 'red')
          .flatMap((x) => x.errors || [])
          .slice(0, 3)
          .join('; ');
        waStatus = await notify({ project, task, kind: 'red', problem: errs || 'gate vermelho', solution }, repo);
      }
    } catch (e) { waStatus = { whatsapp: { ok: false, error: String(e) } }; }
    const lines = [`status: ${r.status}${r.reason ? ' — ' + r.reason : ''}`];
    (r.results || []).forEach((x) => lines.push(`  ${x.status === 'green' ? '✔' : x.status === 'red' ? '✖' : '·'} ${x.name}${x.errors?.length ? ' — ' + x.errors.join('; ') : ''}`));
    if (waStatus) { lines.push(receiptSummary(waStatus)); }
    if (r.needs?.length) {
      lines.push('FALTA pro gate rodar (a IA resolve; commit fica BLOQUEADO até o gate VERDE — não commite nem espere uma pessoa):');
      r.needs.forEach((n) => lines.push(`  → ${n.kind}${n.detail ? ': ' + n.detail : ''}${n.baseUrl ? ' (' + n.baseUrl + ')' : ''}${n.uiFiles ? ' [' + n.uiFiles.slice(0, 6).join(', ') + ']' : ''}`));
    }
    const content = [text(lines.join('\n'))];
    const firstRed = (r.results || []).find((x) => x.status === 'red' && x.screenshot);
    if (firstRed) { const img = imageOf(firstRed.screenshot); if (img) { content.push(img); } }
    return { content, isError: r.status === 'red' || r.status === 'error' || r.status === 'blocked' };
  });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[vs-ia-dev] pronto (stdio) — modulo dev, sem licenca/entrevista');
