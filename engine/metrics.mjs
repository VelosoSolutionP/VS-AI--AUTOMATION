/**
 * Telemetria Tier 1 — o moat: mede desperdício, prova ROI. Anônimo/agregado (LGPD).
 * Coleta só dado técnico do ambiente corporativo; nunca conteúdo/navegação pessoal.
 *
 * Baseline = médias auditadas (60 dias) — o "antes". Recalibrável por projeto.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG = join(HERE, '..', '.metrics', 'metrics.jsonl');

// Baseline auditado (o "antes de orquestrar"). Ajustável em calibração.
export const BASELINE = {
  minutesByType: { bug: 120, feature: 150, refactor: 90, doc: 20, default: 115 },
  tokensAvg: 250000,          // IA sem orquestração, média por tarefa
  reworkRate: 0.40,           // 40% retorno de QA
  commitStdRate: 0.71,        // 29% fora do padrão
  docManualMin: 20,
};
const TOKEN_BRL = 0.000006;   // custo aprox R$/token (Sonnet) — ajustável
const HOURLY_BRL = 70;        // hora-dev pleno — ajustável

/** Registra 1 evento de tarefa. ts injetável p/ testes determinísticos. */
export function recordTask(ev, logPath = DEFAULT_LOG) {
  mkdirSync(dirname(logPath), { recursive: true });
  const row = {
    ts: ev.ts ?? Date.now(),
    type: ev.type || 'default',
    project: ev.project ?? null,
    task: ev.task ?? null,
    durationMin: Number(ev.durationMin) || 0,
    tokens: Number(ev.tokens) || 0,
    aiCalled: !!ev.aiCalled,
    reqBlocked: !!ev.reqBlocked,
    commitInStandard: ev.commitInStandard !== false,
    docAuto: !!ev.docAuto,
    qaReturned: !!ev.qaReturned,
  };
  appendFileSync(logPath, JSON.stringify(row) + '\n');
  return row;
}

export function loadEvents(logPath = DEFAULT_LOG) {
  if (!existsSync(logPath)) { return []; }
  return readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

const pct = (n) => Math.round(n * 1000) / 10;

/** Agrega — tudo anônimo/agregado. */
export function aggregate(events, baseline = BASELINE) {
  const n = events.length || 1;
  const commits = events.filter((e) => e.commitInStandard !== undefined);
  let savedMin = 0, baseTokens = 0, curTokens = 0;
  for (const e of events) {
    const base = baseline.minutesByType[e.type] ?? baseline.minutesByType.default;
    savedMin += Math.max(0, base - e.durationMin);
    baseTokens += baseline.tokensAvg;
    curTokens += e.tokens;
  }
  const aiCalls = events.filter((e) => e.aiCalled).length;
  const reqBlocks = events.filter((e) => e.reqBlocked).length;
  const stdOk = commits.filter((e) => e.commitInStandard).length;
  const docAuto = events.filter((e) => e.docAuto).length;
  const qaRet = events.filter((e) => e.qaReturned).length;
  const roi = (savedMin / 60) * HOURLY_BRL - curTokens * TOKEN_BRL;
  return {
    tasks: events.length,
    timeSavedMin: Math.round(savedMin),
    timeSavedHours: Math.round(savedMin / 6) / 10,
    tokenReductionPct: baseTokens ? pct(1 - curTokens / baseTokens) : 0,
    aiCallsAvoided: events.length - aiCalls,
    aiCallRatePct: pct(aiCalls / n),
    reqBlockRatePct: pct(reqBlocks / n),
    commitStdPct: commits.length ? pct(stdOk / commits.length) : 100,
    docAutoPct: pct(docAuto / n),
    reworkPct: pct(qaRet / n),
    reworkBaselinePct: pct(baseline.reworkRate),
    roiBRL: Math.round(roi),
  };
}

/** Dashboard executivo — anônimo (sem nome de dev). */
export function report(agg, meta = {}) {
  const L = [];
  L.push('╔══════════════════════════════════════════╗');
  L.push('  VELOSO AI GOVERNANCE — Relatório mensal');
  L.push('╚══════════════════════════════════════════╝');
  L.push(`Squad:            ${meta.squad || '—'}`);
  L.push(`Período:          ${meta.period || '—'}`);
  L.push('');
  L.push(`Tarefas analisadas:      ${agg.tasks}`);
  L.push(`Tempo economizado:       ${agg.timeSavedHours} h`);
  L.push(`Redução de tokens:       ${agg.tokenReductionPct}%`);
  L.push(`Chamadas de IA evitadas: ${agg.aiCallsAvoided} (${100 - agg.aiCallRatePct}% resolvido local)`);
  L.push(`Bloqueios por requisito: ${agg.reqBlockRatePct}% das tarefas`);
  L.push(`Commits no padrão:       ${agg.commitStdPct}%`);
  L.push(`Documentação automática: ${agg.docAutoPct}%`);
  L.push(`Retrabalho de QA:        ${agg.reworkPct}% (baseline ${agg.reworkBaselinePct}%)`);
  L.push(`ROI estimado:            R$ ${agg.roiBRL.toLocaleString('pt-BR')}/período`);
  L.push('');
  L.push('* Agregado e anônimo. Baseline = médias auditadas, recalibráveis.');
  return L.join('\n');
}
