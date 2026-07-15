#!/usr/bin/env node
/**
 * Hook UserPromptSubmit
 *
 * Triagem de requisito ANTES da IA processar.
 *
 * Objetivos:
 * - Bloquear tarefas de desenvolvimento mal especificadas.
 * - Não consumir tokens quando faltarem requisitos.
 * - Liberar automaticamente documentação, apresentações e materiais.
 * - Injetar contexto leve para economizar tokens.
 */

import { validateTask } from '../engine/requirements.mjs';
import { parseBranch, loadReq, saveReq, clearReq, setConsult, clearConsult } from '../engine/branch-req.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// =====================================================
// Lê o prompt recebido do Claude Code
// =====================================================

const raw = await new Promise((resolve) => {
  let data = '';

  process.stdin.on('data', (chunk) => {
    data += chunk;
  });

  process.stdin.on('end', () => {
    resolve(data);
  });
});

let prompt = '';
let sid = 'default';

try {
  const j = JSON.parse(raw || '{}');
  prompt = j.prompt || '';
  sid = j.session_id || 'default';
} catch {
  prompt = raw || '';
}

prompt = prompt.trim();

if (!prompt) {
  process.exit(0);
}

// opt-out por pasta: .qa-gate-off no cwd desliga a governança nesta sessão/pasta
// (usado na bancada de conserto do próprio produto)
if (existsSync(join(process.cwd(), '.qa-gate-off'))) {
  process.exit(0);
}

// ESCAPE -> modo CONSULTA/DOC: se o dev bate n/esc/doc/consulta (curto), pula o fluxo
// de tarefa e libera a sessão só p/ leitura e geração de documento. Sem commit/push.
if (/^\s*(n|n[ãa]o|esc|doc|s[óo] ?consulta|consulta|sair|deixa|cancela|cancelar)\s*$/i.test(prompt)) {
  clearReq(sid);
  setConsult(sid);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        '[governança] Sessão em modo CONSULTA/DOC: leitura e geração de documento liberadas. ' +
        'NÃO commita nem faz push (é consulta, não abre tarefa). ' +
        'Pra iniciar tarefa real: informe número + tipo + origem.',
    },
  }));
  process.exit(0);
}

// =====================================================
// Classificação da solicitação
// =====================================================

// Documentação / Marketing / Relatórios
const isDocumentationTask =
  /(html|documenta\w*|redmine|apresenta[cç][aã]o|relat[oó]rio|readme|cat[aá]logo|divulga[cç][aã]o|material|landing\s?page|p[aá]gina|manual|guia|artigo|markdown|md)/i.test(
    prompt
  );

// =====================================================
// DOCUMENTAÇÃO liberada (não valida requisito técnico)
// =====================================================

if (isDocumentationTask) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          '[governança] DOC-001 documentação liberada. Não aplicar validação de requisitos de desenvolvimento. Gerar apenas o artefato solicitado.',
      },
    })
  );

  process.exit(0);
}

// =====================================================
// MURO DE BRANCH (multi-turn) — roda ANTES do gate de sinal, pois follow-ups
// ("origem dev", "fix") não são sinal forte sozinhos. Acumula número+tipo+origem;
// só libera com os 3. Estado em .git/qa-gate-branch-req.json (TTL 15min).
// =====================================================
{
  const cur = parseBranch(prompt);
  const pending = loadReq(sid);

  if (pending && /\b(cancela|cancelar|esquece|aborta|deixa pra l[áa])\b/i.test(prompt)) {
    clearReq(sid);
  } else if (pending || cur.num || /\bbranch\b/i.test(prompt)) {
    const merged = {
      num: cur.num || pending?.num || null,
      tipo: cur.tipo || pending?.tipo || null,
      origem: cur.origem || pending?.origem || null,
    };
    const missing = [];
    if (!merged.num) { missing.push('NÚMERO da tarefa'); }
    if (!merged.tipo) { missing.push('TIPO (fix/feat/refactor/perf/hotfix/chore/test/docs)'); }
    if (!merged.origem) { missing.push('ORIGEM (dev/hml/main)'); }

    if (missing.length) {
      saveReq(sid, merged);
      const providedThisTurn = !!(cur.num || cur.tipo || cur.origem) || /\bbranch\b/i.test(prompt);
      if (providedThisTurn) {
        const check =
          (merged.num ? '✅' : '❌') + ' NÚMERO' + (merged.num ? ' ' + merged.num : '') + '   ' +
          (merged.tipo ? '✅' : '❌') + ' TIPO' + (merged.tipo ? ' ' + merged.tipo : '') + '   ' +
          (merged.origem ? '✅' : '❌') + ' ORIGEM' + (merged.origem ? ' ' + merged.origem : '');
        const next = !merged.num ? 'o NÚMERO da tarefa'
          : !merged.tipo ? 'o TIPO → fix | feat | refactor | perf | hotfix | chore | test | docs'
            : 'a ORIGEM → dev | hml | main';
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason:
            '[VS-BRANCH-001] Falta pra criar a branch:\n' +
            check + '\n\n' +
            '→ Responda ' + next + '   (ou "cancela" pra sair)',
        }));
        process.exit(0);
      }
      // pendente mas sem dado novo neste turno -> não bloqueia o chat; git-guard segura a criação
    } else {
      clearReq(sid);
      clearConsult(sid); // entrou em modo TAREFA -> commit/push/doc liberados
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: '[governança] branch OK: ' + merged.tipo + '/fabiano.veloso/' + merged.num + ' a partir de origin/' + merged.origem + '. Modo TAREFA (commit/push/doc liberados). Crie: git fetch origin ' + merged.origem + ' && git checkout -b ' + merged.tipo + '/fabiano.veloso/' + merged.num + ' origin/' + merged.origem,
        },
      }));
      process.exit(0);
    }
  }
}

// =====================================================
// FAIL-OPEN: só bloqueia com SINAL FORTE de tarefa de dev.
// Papo normal, dúvida, comentário -> passa direto (nunca bloqueia).
// Sinal forte: número de tarefa (#123), /task, verbo de dev no INÍCIO,
// ou tarefa estruturada (descrição: + objetivo/critério).
// =====================================================

const strongDevSignal =
  /#\d{3,}/.test(prompt) ||
  /^\s*#?\d{3,6}\b/.test(prompt) ||
  /^\s*\/task\b/i.test(prompt) ||
  /^\s*(corrig\w*|arrum\w*|implement\w*|refator\w*|cri[ae]\w*|ajust\w*|adicion\w*|remov\w*|desenvolv\w*|fix\b)\b/i.test(prompt) ||
  (/descri[çc][ãa]o\s*:/i.test(prompt) && /(objetivo|crit[ée]rio)/i.test(prompt));

if (!strongDevSignal) {
  process.exit(0);
}

// =====================================================
// DOC PENDENTE — não inicia nova tarefa com doc da anterior pendente.
// (a doc em si é DOC-001 e passa pelo bypass de documentação acima)
// =====================================================

if (existsSync(join(process.cwd(), '.git', 'qa-gate-pending-doc'))) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        '[VS-DOC-002] BLOCKED — documentação da tarefa anterior pendente.\n' +
        'Fluxo atômico: branch → tarefa → gate → commit → push → DOC. Documente a tarefa anterior (Redmine) antes de iniciar outra.\n' +
        'Após documentar, limpe: rm .git/qa-gate-pending-doc',
    })
  );
  process.exit(0);
}

// =====================================================
// DESENVOLVIMENTO — valida requisitos obrigatórios
// =====================================================

const result = validateTask(prompt);

if (result.blocked) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: `${result.short}\n\n${result.dev_msg}`,
    })
  );

  process.exit(0);
}

// =====================================================
// Tarefa liberada
// =====================================================

const aiMessage = result.escalate.call_ai
  ? `sim (${result.escalate.reason})`
  : 'não — tarefa simples';

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[governança] ${result.code} ${result.status}. Escalar IA: ${aiMessage}.`,
    },
  })
);

process.exit(0);