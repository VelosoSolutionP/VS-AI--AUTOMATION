/**
 * VSqa — adapter Redmine (REST). PRIMEIRO tracker suportado.
 * Sem lib externa: usa `fetch` global (Node >=18). `fetchImpl` injetável p/ teste.
 *
 * Config esperada (company.integrations.redmine):
 *   { enabled, baseUrl, apiKey, projectId, trackerId?,
 *     statusMap: { approved, rejected, closed } }  // ids de status do Redmine
 *
 * Todas as chamadas usam o header oficial X-Redmine-API-Key (token do próprio
 * usuário). Nada de scraping — API oficial. Ver guardrails em [[project-vsqa-arquitetura]].
 */

const AUTOMATION_TAG = '_(gerado por VSqa — automação de QA)_';

function assertConfig(cfg) {
  if (!cfg || !cfg.baseUrl || !cfg.apiKey) {
    throw new Error('VSqa Redmine: falta baseUrl/apiKey em integrations.redmine');
  }
}

/**
 * Cria o adapter Redmine.
 *
 * @param {object} cfg  bloco integrations.redmine
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export function makeRedmine(cfg, opts = {}) {
  assertConfig(cfg);
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const base = String(cfg.baseUrl).replace(/\/+$/, '');
  const statusMap = cfg.statusMap || {};

  async function api(method, path, body) {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        'X-Redmine-API-Key': cfg.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Redmine ${method} ${path} -> HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    if (res.status === 204) { return null; }
    return res.json();
  }

  return {
    name: 'redmine',

    /** Lê a US/tarefa com histórico (journals). */
    async getIssue(id) {
      const data = await api('GET', `/issues/${id}.json?include=journals`);
      const it = data.issue || {};
      return {
        id: it.id,
        titulo: it.subject || '',
        descricao: it.description || '',
        modulo: it.project?.name || null,
        url: `${base}/issues/${it.id}`,
        raw: it,
      };
    },

    /**
     * Create genérico — usado pelo VSanalista (épico/HU/tarefa técnica com
     * tracker, assignee e campos custom) e pelo createTask do VSqa.
     * @param {object} f
     * @param {number} [f.projectId]
     * @param {number} [f.trackerId]
     * @param {string} f.subject
     * @param {string} [f.description]
     * @param {number} [f.parentId]
     * @param {number} [f.assignedToId]
     * @param {number} [f.statusId]
     * @param {Array<{id:number,value:any}>} [f.customFields]
     * @param {boolean} [f.inheritParentProject]  usa o projeto do pai (subtarefa não cruza projeto)
     * @param {boolean} [f.tagAutomation]         anexa a marca "gerado por VSqa/VSanalista"
     */
    async createIssue(f) {
      let projectId = f.projectId != null ? f.projectId : cfg.projectId;
      if (f.inheritParentProject && f.parentId) {
        try {
          const parent = await api('GET', `/issues/${f.parentId}.json`);
          if (parent.issue?.project?.id) { projectId = parent.issue.project.id; }
        } catch { /* mantém projectId */ }
      }
      const issue = { project_id: projectId, subject: f.subject };
      const desc = f.description || '';
      issue.description = f.tagAutomation ? `${desc}\n\n${AUTOMATION_TAG}`.trim() : desc;
      if (f.trackerId != null) { issue.tracker_id = f.trackerId; }
      if (f.parentId != null) { issue.parent_issue_id = f.parentId; }
      if (f.assignedToId != null) { issue.assigned_to_id = f.assignedToId; }
      if (f.statusId != null) { issue.status_id = f.statusId; }
      if (f.estimatedHours != null) { issue.estimated_hours = f.estimatedHours; }
      if (f.customFields?.length) { issue.custom_fields = f.customFields.map((c) => ({ id: c.id, value: c.value })); }
      const data = await api('POST', '/issues.json', { issue });
      const id = data.issue?.id;
      return { id, url: `${base}/issues/${id}` };
    },

    /** Apaga uma issue (exige permissão "Excluir" no Redmine). */
    async deleteIssue(id) {
      await api('DELETE', `/issues/${id}.json`);
      return true;
    },

    /** Membros do projeto com seus papéis (p/ sugerir dev/QA). */
    async getMembers(projectId) {
      const data = await api('GET', `/projects/${projectId}/memberships.json?limit=100`);
      return (data.memberships || []).map((m) => ({
        id: (m.user || m.group || {}).id,
        name: (m.user || m.group || {}).name,
        roles: (m.roles || []).map((r) => r.name),
      }));
    },

    /**
     * Cria subtarefa (cenário/execução) filha da US. Retorna { id, url }.
     * Herda o PROJETO da US pai (subtarefa não cruza projeto); cai no cfg.projectId sem pai.
     */
    async createTask({ subject, description, parentId }) {
      return this.createIssue({
        subject, description, parentId,
        trackerId: cfg.trackerId != null ? cfg.trackerId : undefined,
        inheritParentProject: true,
        tagAutomation: true,
      });
    },

    /** Comentário público na tarefa (sempre marcado como automação). */
    async comment(id, notes) {
      await api('PUT', `/issues/${id}.json`, {
        issue: { notes: `${notes}\n\n${AUTOMATION_TAG}` },
      });
      return true;
    },

    /** Troca o status por id (statusMap). */
    async setStatus(id, statusId, notes) {
      const issue = { status_id: statusId };
      if (notes) { issue.notes = `${notes}\n\n${AUTOMATION_TAG}`; }
      await api('PUT', `/issues/${id}.json`, { issue });
      return true;
    },

    /** Fecha a tarefa (status "closed" do statusMap). */
    async closeTask(id, notes) {
      if (statusMap.closed == null) { throw new Error('VSqa Redmine: statusMap.closed não configurado'); }
      return this.setStatus(id, statusMap.closed, notes);
    },

    /** Marca a US como aprovada em QA. */
    async approve(id, notes) {
      if (statusMap.approved == null) { return this.comment(id, notes); }
      return this.setStatus(id, statusMap.approved, notes);
    },

    /** Devolve a US pro dev (reprovada em QA). */
    async reject(id, notes) {
      if (statusMap.rejected == null) { return this.comment(id, notes); }
      return this.setStatus(id, statusMap.rejected, notes);
    },
  };
}
