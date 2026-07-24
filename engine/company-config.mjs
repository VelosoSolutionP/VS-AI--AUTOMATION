/**
 * CONFIG DE EMPRESA (produto multi-empresa).
 *
 * Cada instalação define SEU padrão de branch/commit/doc num `qa-gate.company.json`.
 * Sem arquivo => DEFAULT embutido (padrão Fabiano) — então nada muda pra quem não
 * configurar, e a empresa que compra ajusta no install sem tocar em código.
 *
 * Resolução (primeiro que existir):
 *   1. env QA_GATE_COMPANY_CONFIG (caminho explícito)
 *   2. qa-gate.company.json subindo a partir de baseDir (repo/projeto)
 *   3. ~/.qa-gate/company.json (nível instalação/máquina)
 *   4. DEFAULT embutido
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_CONFIG = {
  autor: 'fabiano.veloso',
  branchPattern: '<tipo>/<autor>/<numero>',
  commitScope: 'numero',        // 'numero' | 'modulo' | 'any'
  commitScopeRegex: null,       // opcional: string de regex; se setado, sobrepõe commitScope
  tipos: ['fix', 'feat', 'feature', 'perf', 'refactor', 'hotfix', 'chore', 'test', 'docs', 'build', 'ci', 'style', 'revert'],
  doc: { template: 'redmine', required: true },
  push: { setUpstream: true },
  // Anti-desperdício: por padrão a IA NÃO abre subagente pra investigar/corrigir —
  // pesquisa direto (Serena/grep/read). Agente só p/ feature extensa REAL (escape .qa-gate-agents-ok).
  allowAgents: false,
  // Auditoria via WhatsApp (opt-in na instalação). Desligado por padrão; placeholders
  // 'xxx' pra não vazar credencial de quem instala. Preenche no company.json local.
  notify: {
    whatsapp: {
      enabled: false,
      provider: 'callmebot',
      phone: 'xxx',
      apikey: 'xxx',
      helpTimeoutMin: 15,
    },
    // Slack: GRATIS (incoming webhook). Cole a URL do webhook e enabled:true.
    slack: {
      enabled: false,
      webhookUrl: 'xxx',
    },
  },
  // Integracoes/recursos opcionais — CONFIGURAVEIS, desligados por padrao.
  // O que e free (slack, auditoria local) roda ao ligar; o resto (jira/azure)
  // exige credencial/endpoint e e roadmap ate ser implementado.
  integrations: {
    promptAudit: { enabled: false, hashOnly: true, retentionDays: 30 },
    dashboard: { enabled: false },
    jira: { enabled: false, baseUrl: 'xxx', token: 'xxx' },
    azureDevops: { enabled: false, org: 'xxx', token: 'xxx' },
  },
};

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function findUp(baseDir, name) {
  try {
    let dir = baseDir;
    const root = parse(dir).root;
    for (let i = 0; i < 40; i++) {
      const p = join(dir, name);
      if (existsSync(p)) { return p; }
      if (dir === root) { break; }
      const up = dirname(dir);
      if (up === dir) { break; }
      dir = up;
    }
  } catch {}
  return null;
}

export function resolveConfigPath(baseDir) {
  const base = baseDir || process.cwd();
  if (process.env.QA_GATE_COMPANY_CONFIG && existsSync(process.env.QA_GATE_COMPANY_CONFIG)) {
    return process.env.QA_GATE_COMPANY_CONFIG;
  }
  const up = findUp(base, 'qa-gate.company.json');
  if (up) { return up; }
  const home = join(homedir(), '.qa-gate', 'company.json');
  if (existsSync(home)) { return home; }
  return null;
}

export function loadCompanyConfig(baseDir) {
  const file = resolveConfigPath(baseDir);
  const user = file ? readJson(file) : null;
  return {
    ...DEFAULT_CONFIG,
    ...(user || {}),
    doc: { ...DEFAULT_CONFIG.doc, ...(user?.doc || {}) },
    push: { ...DEFAULT_CONFIG.push, ...(user?.push || {}) },
    notify: {
      ...DEFAULT_CONFIG.notify,
      ...(user?.notify || {}),
      whatsapp: {
        ...DEFAULT_CONFIG.notify.whatsapp,
        ...(user?.notify?.whatsapp || {}),
      },
      slack: {
        ...DEFAULT_CONFIG.notify.slack,
        ...(user?.notify?.slack || {}),
      },
    },
    integrations: {
      ...DEFAULT_CONFIG.integrations,
      ...(user?.integrations || {}),
    },
    _source: file || 'default',
  };
}

const escapeRe = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// O pattern usa o segmento de número?
export function patternUsesNumero(cfg) {
  return /<numero>/.test(cfg.branchPattern || DEFAULT_CONFIG.branchPattern);
}

// Monta o nome da branch a partir do pattern configurado.
export function branchName(cfg, { tipo, numero, slug } = {}) {
  return String(cfg.branchPattern || DEFAULT_CONFIG.branchPattern)
    .replace(/<tipo>/g, tipo || '')
    .replace(/<autor>/g, cfg.autor || '')
    .replace(/<numero>/g, numero != null ? String(numero) : '')
    .replace(/<slug>/g, slug || '');
}

// Regex do nome de branch da tarefa (detecção/validação), derivada de tipos + autor.
export function branchRegex(cfg) {
  const tipos = (cfg.tipos || DEFAULT_CONFIG.tipos).join('|');
  if (/<autor>/.test(cfg.branchPattern || DEFAULT_CONFIG.branchPattern) && cfg.autor) {
    return new RegExp(`^(${tipos})\\/${escapeRe(cfg.autor)}\\/.+`, 'i');
  }
  return new RegExp(`^(${tipos})\\/.+`, 'i');
}

// Glob p/ procurar branch existente do número (bug voltou), respeitando o autor.
export function branchGlobsForNumber(cfg, numero) {
  const n = String(numero);
  if (cfg.autor && /<autor>/.test(cfg.branchPattern || DEFAULT_CONFIG.branchPattern)) {
    return [`*${cfg.autor}/${n}`, `*${cfg.autor}/${n}-*`, `*${n}`];
  }
  return [`*${n}`, `*${n}-*`];
}

// Valida o escopo do commit conforme a regra da empresa. Retorna {ok, expected}.
export function checkCommitScope(cfg, scope, numero) {
  const rule = cfg.commitScope || 'numero';
  if (cfg.commitScopeRegex) {
    try {
      return { ok: new RegExp(cfg.commitScopeRegex).test(scope || ''), expected: `escopo casando /${cfg.commitScopeRegex}/` };
    } catch {}
  }
  if (rule === 'any') { return { ok: true, expected: 'qualquer escopo' }; }
  if (rule === 'modulo') { return { ok: !!scope && !/^\d+$/.test(scope), expected: 'um módulo/contexto (ex.: auth, chat) — não o número' }; }
  return { ok: scope === String(numero), expected: `o número da tarefa (${numero})` };
}
