/**
 * Requirements Validator — coração do Orquestrar IA.
 * Determinístico: dado o texto de uma tarefa, decide se há requisito suficiente
 * ANTES de acionar o modelo. Retorna código REQ + o que falta + decisão de escalonar IA.
 *
 * Sem dependências, sem modelo. Consumido por hook (UserPromptSubmit) e MCP.
 */
import { createRequire } from 'node:module';

// require() do JSON: em dev resolve relativo a este arquivo; no build protegido
// o esbuild INLINA o catálogo no bundle (sem depender de path em runtime).
const CATALOG = createRequire(import.meta.url)('../catalog/messages.json');
const MSG = Object.fromEntries(CATALOG.messages.map((m) => [m.code, m]));

/** Campos e como detectá-los (rótulo explícito OU heurística). */
const FIELDS = {
  descricao: { label: 'Descrição da tarefa', required: true,
    labels: [/descri[çc][ãa]o/i, /tarefa\s*:/i, /o que\b/i],
    heuristic: (t) => t.trim().length >= 25 },
  objetivo: { label: 'Objetivo / resultado esperado', required: true,
    labels: [/objetivo/i, /resultado\s*esperado/i, /espera-se/i, /para que/i, /deve (fazer|exibir|permitir|retornar|salvar|validar)/i] },
  criterio_aceite: { label: 'Critério de aceite', required: true,
    labels: [/crit[ée]rio\s*:?/i, /aceite\s*:/i, /quando\b.{0,40}\bent[ãa]o/i, /dado que/i, /deve (mostrar|bloquear|impedir|aceitar|rejeitar|abrir|carregar|retornar)/i] },
  arquivo_afetado: { label: 'Arquivo(s)/módulo afetado', required: false,
    labels: [/arquivo/i, /m[óo]dulo/i, /componente/i, /\.(php|js|jsx|ts|tsx|vue|blade\.php)\b/i, /controller|service|model|livewire/i] },
  regra_negocio: { label: 'Regra de negócio', required: false,
    labels: [/regra.{0,10}neg[óo]cio/i, /somente se/i, /apenas quando/i, /n[ãa]o pode/i, /obrigat[óo]ri/i] },
  origem: { label: 'Origem (dev/main/hml) p/ branch', required: false,
    labels: [/\borigem\b/i, /\b(dev|main|master|hml|homolog|homologa[çc][ãa]o|produ[çc][ãa]o|prod)\b/i] },
};

// Ambiguidade = DECISÃO DE PRODUTO (não "não sei a causa", que é sinal de bug → escala).
const AMBIGUOUS = [/\bou\b.{0,25}\bou\b/i, /qualquer um serve/i, /voc[êe] (que )?decide/i, /tanto faz/i, /como (voc[êe]|achar) melhor/i];

/** Tarefas que JUSTIFICAM escalar pro modelo completo. */
const ESCALATE = [
  { re: /causa\s*(raiz)?|n[ãa]o (sei|identifi)|intermitente|persistente|[àa]s vezes|do nada/i, reason: 'causa não identificada' },
  { re: /arquitetura|refatora|redesenh|acopla|design de|estrutura do projeto/i, reason: 'decisão de arquitetura' },
  { re: /seguran[çc]a|vulnerab|inje[çc][ãa]o|xss|csrf|auth|token|senha|permiss[ãa]o/i, reason: 'segurança' },
  { re: /performance|n\+1|lento|otimiz|gargalo|query lenta/i, reason: 'análise de performance' },
  { re: /bug|erro|falha|quebr|exce[çc][ãa]o|stack ?trace/i, reason: 'investigação de bug' },
];

function detect(text, field) {
  if (field.labels?.some((re) => re.test(text))) { return true; }
  if (field.heuristic) { return field.heuristic(text); }
  return false;
}

function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString());
}

/**
 * @param {string} text  texto da tarefa
 * @param {{pending?:boolean}} [opts]  pending=true força VS-REQ-002 (dev deixou aguardando)
 * @returns {{code,status,title,dev_msg,short,present:string[],missing:string[],escalate:{call_ai:boolean,reason:string|null},task_hint:string}}
 */
export function validateTask(text, opts = {}) {
  const t = (text || '').trim();
  const present = [], missing = [];
  for (const [key, f] of Object.entries(FIELDS)) {
    (detect(t, f) ? present : missing).push({ key, label: f.label, required: f.required });
  }
  const missReq = missing.filter((m) => m.required);
  const missOpt = missing.filter((m) => !m.required);
  const ambiguous = AMBIGUOUS.some((re) => re.test(t));

  // HU/spec RICA: objetivo + RF + critério de aceitação + descrição da solução.
  // Quando o texto tem estrutura de história de usuário, é requisito SUFICIENTE —
  // não fica cobrando campo; passa e escala pro modelo interpretar/implementar.
  const specMarkers = [
    /requisitos?\s+funciona|\bRF\s*0?\d/i,
    /crit[ée]rios?\s+de\s+aceita|crit[ée]rio\s*:/i,
    /descri[çc][ãa]o\s+da\s+solu/i,
    /requisitos?\s+n[ãa]o\s+funciona|\bRNF/i,
    /objetivo\b/i,
    /impacto\s+esperado|regras?\s+de\s+neg[óo]cio/i,
  ].filter((re) => re.test(t)).length;
  const wellSpecified = specMarkers >= 3 || (t.length >= 400 && specMarkers >= 2);

  const esc = ESCALATE.find((e) => e.re.test(t));
  // spec rica sempre escala pro modelo (é feature real p/ interpretar/implementar)
  const escalate = { call_ai: !!esc || wellSpecified, reason: esc ? esc.reason : (wellSpecified ? 'feature especificada (HU)' : null) };

  let code;
  if (opts.pending) { code = 'VS-REQ-002'; }
  else if (wellSpecified) { code = 'VS-REQ-005'; } // requisito suficiente -> não cobra campo
  else if (missReq.length) { code = 'VS-REQ-001'; }
  else if (ambiguous) { code = 'VS-REQ-004'; }
  else if (missOpt.length) { code = 'VS-REQ-003'; }
  else { code = 'VS-REQ-005'; }

  const m = MSG[code];
  const vars = {
    faltando: missing.map((x) => '- ' + x.label).join('\n'),
    presente: present.map((x) => x.label).join(', '),
    ponto: 'ver descrição',
    resumo: t.slice(0, 80),
  };
  return {
    code, status: m.status, title: m.title,
    short: m.short,
    dev_msg: fill(m.dev_msg, vars),
    present: present.map((x) => x.key),
    missing: missing.map((x) => x.key),
    blocked: code === 'VS-REQ-001' || code === 'VS-REQ-004',
    escalate,
    task_hint: escalate.reason || 'tarefa simples',
  };
}
