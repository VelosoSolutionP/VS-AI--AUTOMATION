/**
 * Motor de entrevista — máquina de estado pura (sem I/O). Conduz o Q&A, valida/coerce
 * as respostas e diz quando está completa. Usado pela CLI (readline/arquivo) e pelo MCP
 * (conversacional). Testável.
 */
import { getSet, findQuestion } from './schema.mjs';

export function createState(setId) {
  getSet(setId); // valida
  return { setId, answers: {} };
}

/** Coerce + valida uma resposta conforme o tipo. Retorna { ok, value, error }. */
export function coerce(q, raw) {
  const asList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/\r?\n|;/)).map((s) => String(s).trim()).filter(Boolean);
  switch (q.tipo) {
    case 'text':
    case 'longtext': {
      const v = String(raw ?? '').trim();
      if (q.required && !v) { return { ok: false, error: 'resposta obrigatória' }; }
      return { ok: true, value: v };
    }
    case 'number': {
      if (raw === '' || raw == null) { return q.required ? { ok: false, error: 'informe um número' } : { ok: true, value: null }; }
      const n = parseFloat(String(raw).replace(',', '.').replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n)) { return { ok: false, error: 'número inválido' }; }
      return { ok: true, value: n };
    }
    case 'bool':
      return { ok: true, value: /^(s|sim|y|yes|true|1)$/i.test(String(raw).trim()) };
    case 'choice': {
      const v = String(raw ?? '').trim();
      if (!q.opcoes.includes(v)) { return { ok: false, error: `escolha uma: ${q.opcoes.join(', ')}` }; }
      return { ok: true, value: v };
    }
    case 'multichoice': {
      const arr = asList(raw);
      const invalid = arr.filter((x) => !q.opcoes.includes(x));
      if (invalid.length) { return { ok: false, error: `inválido: ${invalid.join(', ')}. Opções: ${q.opcoes.join(', ')}` }; }
      if (q.required && !arr.length) { return { ok: false, error: 'escolha ao menos uma' }; }
      return { ok: true, value: arr };
    }
    case 'list': {
      const arr = asList(raw);
      if (q.required && !arr.length) { return { ok: false, error: 'liste ao menos um item' }; }
      return { ok: true, value: arr };
    }
    default:
      return { ok: false, error: `tipo desconhecido: ${q.tipo}` };
  }
}

/** Registra uma resposta. Não muta: retorna novo estado. */
export function answer(state, id, raw) {
  const q = findQuestion(state.setId, id);
  if (!q) { return { ok: false, error: `pergunta desconhecida: ${id}`, state }; }
  const r = coerce(q, raw);
  if (!r.ok) { return { ok: false, error: r.error, state }; }
  return { ok: true, state: { ...state, answers: { ...state.answers, [id]: r.value } } };
}

const answered = (state, q) => Object.prototype.hasOwnProperty.call(state.answers, q.id);

/** Próxima pergunta: obrigatórias não respondidas primeiro, depois opcionais. */
export function nextQuestion(state) {
  const set = getSet(state.setId);
  return set.find((q) => q.required && !answered(state, q))
    || set.find((q) => !answered(state, q))
    || null;
}

export function isComplete(state) {
  return getSet(state.setId).filter((q) => q.required).every((q) => answered(state, q));
}

export function progress(state) {
  const set = getSet(state.setId);
  const total = set.length;
  const resp = set.filter((q) => answered(state, q)).length;
  return { respondidas: resp, total, pct: total ? Math.round((resp / total) * 100) : 0, completa: isComplete(state) };
}
