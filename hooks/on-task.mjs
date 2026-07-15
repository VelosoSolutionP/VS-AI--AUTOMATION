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

try {
  prompt = (JSON.parse(raw || '{}').prompt) || '';
} catch {
  prompt = raw || '';
}

prompt = prompt.trim();

if (!prompt) {
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
// MURO — criação de branch exige NÚMERO + TIPO + ORIGEM.
// Origem é bloqueio DURO: sem ela não cria (evita branch de ambiente
// errado -> merge puxa lixo de outro ambiente e quebra).
// =====================================================

const pedeBranch = /#?\d{3,6}\b/.test(prompt) || /\bbranch\b/i.test(prompt);
const temOrigem = /\b(dev|develop|hml|homolog\w*|main|master|prod|produ[çc][ãa]o|staging)\b/i.test(prompt);

if (pedeBranch && !temOrigem) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        '[VS-BRANCH-001] BLOCKED — origem OBRIGATÓRIA para criar branch.\n' +
        'Pra criar a branch preciso das 3: número da tarefa + tipo (fix|feat|refactor|perf|hotfix|chore|test|docs) + ORIGEM (dev/hml/main).\n' +
        'Sem a origem NÃO crio — branch de ambiente errado quebra no merge. Informe a origem.',
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