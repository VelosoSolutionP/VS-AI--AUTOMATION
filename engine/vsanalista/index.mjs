/**
 * VSanalista — orquestrador. Cria no Redmine o Épico + HUs + 3 Tarefas Técnicas por HU,
 * no MESMO padrão dos analistas do RURAP. Atribui HU/Codificar ao DEV; Especificar/Execução ao QA.
 *
 * Guardrail: `dryRun` (default TRUE) só mostra o que criaria — não escreve no Redmine de
 * produção sem OK explícito (dryRun:false).
 */
import { TRACKERS, CUSTOM_FIELDS, HU_TASKS, huSubject, renderHUDescription, renderEpicDescription } from './template.mjs';
import { normalizeEpicSpec, validateEpicSpec, previewEpic } from './builder.mjs';

/**
 * @param {object} rawSpec  { titulo, hus:[{modulo,titulo,como,solicito,para,...,criteriosTeste,pontos,devId?,qaId?}] }
 * @param {object} opts
 * @param {object} opts.tracker    adapter Redmine (com createIssue)
 * @param {number} opts.projectId
 * @param {number} [opts.devId]    dev padrão do projeto (assignee da HU + Codificar)
 * @param {number} [opts.qaId]     QA padrão do projeto (assignee de Especificar/Execução)
 * @param {boolean} [opts.dryRun=true]
 */
export async function createEpic(rawSpec, opts = {}) {
  const { tracker, projectId, devId, qaId } = opts;
  const spec = normalizeEpicSpec(rawSpec);
  const check = validateEpicSpec(spec, { devId, qaId });
  if (!check.ok) { return { stage: 'invalid', errors: check.errors }; }

  if (opts.dryRun !== false) {
    return { stage: 'preview', preview: previewEpic(spec, { devId, qaId }) };
  }

  if (!tracker?.createIssue) { throw new Error('VSanalista: tracker sem createIssue'); }

  // 1. Épico
  const epic = await tracker.createIssue({
    projectId,
    trackerId: TRACKERS.epico,
    subject: spec.titulo,
    description: renderEpicDescription(spec.hus),
    customFields: [{ id: CUSTOM_FIELDS.tarefaPlanejada, value: '1' }],
    tagAutomation: true,
  });

  // 2. HUs + 3 tarefas cada
  const hus = [];
  for (const h of spec.hus) {
    const dev = h.devId ?? devId;
    const qa = h.qaId ?? qaId;
    const cf = [{ id: CUSTOM_FIELDS.tarefaPlanejada, value: '1' }];
    if (h.pontos) { cf.push({ id: CUSTOM_FIELDS.pontosMsb, value: h.pontos }); }

    const hu = await tracker.createIssue({
      projectId,
      trackerId: TRACKERS.hu,
      parentId: epic.id,
      subject: huSubject(h),
      description: renderHUDescription(h),
      assignedToId: dev,
      customFields: cf,
      tagAutomation: true,
    });

    const tarefas = [];
    for (const t of HU_TASKS) {
      const task = await tracker.createIssue({
        trackerId: TRACKERS.tarefaTecnica,
        parentId: hu.id,
        subject: t.name,
        assignedToId: t.role === 'dev' ? dev : qa,
        inheritParentProject: true,
        tagAutomation: true,
      });
      tarefas.push({ ...task, name: t.name, role: t.role });
    }
    hus.push({ ...hu, subject: huSubject(h), tarefas });
  }

  return { stage: 'done', epic, hus };
}
