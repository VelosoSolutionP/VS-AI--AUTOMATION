/**
 * VSqa — fábrica de tracker. Interface única; adapters plugáveis.
 * Redmine PRIMEIRO (implementado). Azure/Jira = roadmap, mesmo contrato.
 *
 * Interface Tracker:
 *   getIssue(id)                       -> { id, titulo, descricao, modulo, url, raw }
 *   createTask({subject,description,parentId}) -> { id, url }
 *   comment(id, notes)                 -> true
 *   setStatus(id, statusId, notes?)    -> true
 *   closeTask(id, notes?)              -> true
 *   approve(id, notes)                 -> true
 *   reject(id, notes)                  -> true
 */
import { makeRedmine } from './redmine.mjs';

/**
 * Resolve o tracker a partir do company-config.
 * Prioridade: redmine (implementado) -> azure/jira (roadmap).
 *
 * @param {object} company  saída de loadCompanyConfig()
 * @param {{ fetchImpl?: typeof fetch, force?: 'redmine'|'azure'|'jira' }} [opts]
 */
export function makeTracker(company, opts = {}) {
  const integ = company?.integrations || {};
  const pick = opts.force
    || (integ.redmine?.enabled ? 'redmine'
      : integ.azureDevops?.enabled ? 'azure'
        : integ.jira?.enabled ? 'jira' : null);

  if (pick === 'redmine') { return makeRedmine(integ.redmine, opts); }
  if (pick === 'azure') { throw new Error('VSqa: Azure DevOps é roadmap — habilite integrations.redmine por enquanto'); }
  if (pick === 'jira') { throw new Error('VSqa: Jira é roadmap — habilite integrations.redmine por enquanto'); }
  throw new Error('VSqa: nenhum tracker habilitado. Configure integrations.redmine (enabled/baseUrl/apiKey/projectId).');
}
