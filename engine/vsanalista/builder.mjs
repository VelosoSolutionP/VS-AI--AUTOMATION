/**
 * VSanalista — builder. Normaliza/valida a especificação do épico antes de criar.
 */
import { huSubject } from './template.mjs';

/** Normaliza a spec do épico ({ titulo, hus:[...] }). */
export function normalizeEpicSpec(spec) {
  const hus = (spec?.hus || []).map((h) => ({
    modulo: (h.modulo || '').trim(),
    titulo: (h.titulo || '').trim(),
    como: h.como, solicito: h.solicito, para: h.para,
    preCondicoes: h.preCondicoes || [],
    posCondicoes: h.posCondicoes || [],
    fluxos: h.fluxos || [],
    regras: h.regras || [],
    atributos: h.atributos || {},
    integra: !!h.integra,
    criteriosTeste: h.criteriosTeste || [],
    criteriosSprint: h.criteriosSprint || [],
    pontos: h.pontos != null ? String(h.pontos) : '',
    horas: h.horas != null ? h.horas : null,
    devId: h.devId != null ? h.devId : null,
    qaId: h.qaId != null ? h.qaId : null,
  }));
  return { titulo: (spec?.titulo || '').trim(), hus };
}

/** Valida a spec. Retorna { ok, errors }. */
export function validateEpicSpec(spec, opts = {}) {
  const errors = [];
  if (!spec.titulo) { errors.push('épico sem título'); }
  if (!spec.hus.length) { errors.push('épico sem HUs'); }
  spec.hus.forEach((h, i) => {
    if (!h.titulo) { errors.push(`HU ${i + 1}: sem título`); }
    if (!h.modulo) { errors.push(`HU ${i + 1}: sem módulo (ex.: [Planejamento])`); }
    const dev = h.devId ?? opts.devId;
    const qa = h.qaId ?? opts.qaId;
    if (dev == null) { errors.push(`HU ${i + 1} ("${h.titulo}"): sem dev (devId) — aponte o dev do projeto`); }
    if (qa == null) { errors.push(`HU ${i + 1} ("${h.titulo}"): sem QA (qaId) — aponte o QA do projeto`); }
  });
  return { ok: errors.length === 0, errors };
}

/** Monta o preview textual do que será criado (pro dryRun). */
export function previewEpic(spec, opts = {}) {
  return {
    epico: spec.titulo,
    hus: spec.hus.map((h) => ({
      subject: huSubject(h),
      dev: h.devId ?? opts.devId,
      qa: h.qaId ?? opts.qaId,
      tarefas: ['Codificar História do Usuário → dev', 'Especificar Testes → QA', 'Execução dos testes → QA'],
      pontos: h.pontos || null,
    })),
  };
}
