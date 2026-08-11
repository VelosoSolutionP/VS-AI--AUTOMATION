/**
 * Entrevista — aplicação dos perfis no company-config (passo de INSTALAÇÃO).
 * Traduz as respostas de dev/analista/qa nas chaves que a suite consome:
 *   dev      -> branchPattern, tipos, commitScope, commitScopeRegex, doc.modelo, autor, testes
 *   analista -> integrations.redmine (baseUrl, apiKey, projectId)
 *   qa       -> integrations.qa (sistema, apiKey, exemplo, padrao)
 *
 * applyProfiles é PURO (company + profiles -> novo company). applyAll faz o I/O.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { loadProfile } from './index.mjs';
import { assertInstalled } from './install.mjs';

/** Puro: aplica os perfis sobre um company-config e devolve o novo objeto + o que mudou. */
export function applyProfiles(company, { dev, analista, qa } = {}) {
  const c = JSON.parse(JSON.stringify(company || {}));
  c.integrations = c.integrations || {};
  const changed = [];

  if (dev && Object.keys(dev).length) {
    if (dev.branch_pattern) { c.branchPattern = dev.branch_pattern; changed.push('branchPattern'); }
    if (dev.branch_tipos?.length) { c.tipos = dev.branch_tipos; changed.push('tipos'); }
    if (dev.commit_pattern) { c.commitPattern = dev.commit_pattern; changed.push('commitPattern'); }
    if (dev.commit_escopo) { c.commitScope = dev.commit_escopo; changed.push('commitScope'); }
    // assinatura do autor (nome <email> do git) — NÃO é o token <autor> da branch, guardo separado
    if (dev.commit_autor) { c.commitAutor = dev.commit_autor; changed.push('commitAutor'); }
    if (dev.doc_modelo) { c.doc = { ...(c.doc || {}), modelo: dev.doc_modelo }; changed.push('doc.modelo'); }
    if (dev.testes_politica) { c.testes = { politica: dev.testes_politica }; changed.push('testes.politica'); }
  }

  if (analista && Object.keys(analista).length && /redmine/i.test(analista.tracker_tipo || 'Redmine')) {
    c.integrations.redmine = {
      ...(c.integrations.redmine || {}),
      enabled: true,
      baseUrl: analista.tracker_url || c.integrations.redmine?.baseUrl,
      apiKey: analista.tracker_apikey || c.integrations.redmine?.apiKey,
      projectId: analista.tracker_projeto ?? c.integrations.redmine?.projectId,
    };
    changed.push('integrations.redmine');
  }

  if (qa && Object.keys(qa).length) {
    c.integrations.qa = {
      ...(c.integrations.qa || {}),
      sistema: qa.qa_sistema || null,
      apiKey: qa.qa_apikey || c.integrations.qa?.apiKey || null,
      exemplo: qa.qa_exemplo || null,
      padrao: qa.qa_padrao || null,
    };
    changed.push('integrations.qa');
  }

  return { company: c, changed };
}

function companyPath() {
  return join(homedir(), '.qa-gate', 'company.json');
}

/** Lê os perfis salvos + o company.json atual, aplica e grava. Retorna { path, changed }. */
export function applyAll() {
  const p = companyPath();
  let current = {};
  try { current = JSON.parse(readFileSync(p, 'utf8')); } catch { current = {}; }
  const { company, changed } = applyProfiles(current, {
    dev: loadProfile('dev'),
    analista: loadProfile('analista'),
    qa: loadProfile('qa'),
  });
  // GATE: sem acessos obrigatórios de analista + qa, NÃO grava nada (sem default silencioso).
  assertInstalled(company);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(company, null, 2));
  return { path: p, changed };
}
