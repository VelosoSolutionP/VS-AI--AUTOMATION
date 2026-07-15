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
import { parseBranch, loadReq, saveReq, clearReq, setConsult, clearConsult, isFree, clearFree } from '../engine/branch-req.mjs';
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
// JANELA LIVRE pós-push — depois de commit+push a sessão fica liberada p/
// perguntas, dúvidas e confirmações. O muro de branch NÃO engata em papo normal.
// Só re-arma quando o Fabiano manda a PRÓXIMA TAREFA: número de tarefa, ou as
// frases "próxima/nova/outra tarefa" ou "deploy feito/concluído/ok".
// =====================================================

if (isFree(sid)) {
  const cur = parseBranch(prompt);
  const saidNext = /\b(pr[óo]xima tarefa|nova tarefa|outra tarefa|deploy\s+(feito|conclu[íi]do|ok|pronto|realizado))\b/i.test(prompt);
  const reArm = saidNext || !!cur.num;
  if (!reArm) {
    process.exit(0); // livre: pergunta/dúvida/confirmação passam direto
  }
  // vai iniciar tarefa nova: não deixa entrar com doc da anterior pendente
  if (existsSync(join(process.cwd(), '.git', 'qa-gate-pending-doc'))) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason:
        '[VS-DOC-002] BLOCKED — documente a tarefa anterior (Redmine) antes de iniciar outra.\n' +
        'Após documentar, limpe: rm .git/qa-gate-pending-doc',
    }));
    process.exit(0);
  }
  clearFree(sid); // Fabiano mandou nova tarefa -> re-arma o fluxo
  if (saidNext && !cur.num) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '[governança] Fluxo de tarefa RE-ARMADO. Peça ao Fabiano: número + tipo + origem + alvo (mobile/front/back) pra criar a branch.',
      },
    }));
    process.exit(0);
  }
  // tem número -> cai no muro de branch abaixo
}

// =====================================================
// Classificação da solicitação
// =====================================================

// DOC = intenção de PRODUZIR documento/material (não palavra de domínio).
// "relatório"/"dashboard"/"página" numa FEATURE não é doc — é o que implementar.
// Se o texto tem cara de FEATURE (RF, critério de aceite, implementar/adequar,
// endpoint, migration, drill-down...), NÃO é doc, mesmo citando relatório.
const looksLikeFeature =
  /(requisitos?\s+funciona|\bRF\s*0?\d|crit[ée]rios?\s+de\s+aceita|\bimplementar\b|\badequar\b|\bdesenvolver\b|\bendpoint\b|\bmigration\b|drill-?down|hist[óo]ria de usu[áa]rio|\bHU\b)/i.test(prompt);
const isDocumentationTask =
  !looksLikeFeature &&
  /(documenta[çc]\w*|redmine|readme|changelog|release\s*notes|markdown|apresenta[çc][ãa]o|landing\s?page|\bgerar?\s+(a\s+)?doc|escrever?\s+(o\s+|a\s+)?(doc|manual|guia|artigo|readme))/i.test(prompt);

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
      alvo: cur.alvo || pending?.alvo || null,
      crud: cur.crud || pending?.crud || false,
    };
    // bug de CRUD/validação: não trava adivinhando camada — o gate reproduz e mostra o erro.
    // default alvo=front (gate browser diagnostica); se o dev disse mobile, respeita.
    if (merged.crud && !merged.alvo) { merged.alvo = 'front'; }
    const missing = [];
    if (!merged.num) { missing.push('num'); }
    if (!merged.tipo) { missing.push('tipo'); }
    if (!merged.origem) { missing.push('origem'); }
    if (!merged.alvo) { missing.push('alvo'); }

    if (missing.length) {
      saveReq(sid, merged);
      const providedThisTurn = !!(cur.num || cur.tipo || cur.origem || cur.alvo) || /\bbranch\b/i.test(prompt);
      if (providedThisTurn) {
        const check =
          (merged.num ? '✅' : '❌') + ' NÚMERO' + (merged.num ? ' ' + merged.num : '') + '   ' +
          (merged.tipo ? '✅' : '❌') + ' TIPO' + (merged.tipo ? ' ' + merged.tipo : '') + '   ' +
          (merged.origem ? '✅' : '❌') + ' ORIGEM' + (merged.origem ? ' ' + merged.origem : '') + '   ' +
          (merged.alvo ? '✅' : '❌') + ' ALVO' + (merged.alvo ? ' ' + merged.alvo : '');
        const next = !merged.num ? 'o NÚMERO da tarefa'
          : !merged.tipo ? 'o TIPO → fix | feat | refactor | perf | hotfix | chore | test | docs'
            : !merged.origem ? 'a ORIGEM → dev | hml | main'
              : 'o ALVO → mobile | front | back (onde atacar)';
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason:
            '[VS-BRANCH-001] Falta pra criar a tarefa:\n' +
            check + '\n\n' +
            '→ Responda ' + next + '   (ou "cancela" pra sair)',
        }));
        process.exit(0);
      }
      // pendente mas sem dado novo neste turno -> não bloqueia o chat; git-guard segura a criação
    } else {
      clearReq(sid);
      clearConsult(sid); // entrou em modo TAREFA
      let ctx;
      if (merged.alvo === 'mobile') {
        ctx = `[governança] TAREFA #${merged.num} (${merged.tipo}) · ALVO=MOBILE. REGRA MOBILE: NÃO cria branch de tarefa, NÃO faz push. Acumula commits LOCAIS; deploy (APK) só no fim do dia, quando o Fabiano pedir. Vá DIRETO no código Flutter/dart do alvo — NÃO investigue front/back (o alvo é mobile).`;
      } else {
        ctx = `[governança] branch OK: ${merged.tipo}/fabiano.veloso/${merged.num} a partir de origin/${merged.origem}. ALVO=${merged.alvo.toUpperCase()} — trabalhe SÓ na camada ${merged.alvo}, vá direto no alvo, NÃO vasculhe outras camadas. Crie: git fetch origin ${merged.origem} && git checkout -b ${merged.tipo}/fabiano.veloso/${merged.num} origin/${merged.origem}`;
      }
      if (merged.crud) {
        ctx += ` | BUG CRUD/VALIDAÇÃO: NÃO fique adivinhando a camada. Rode o QA-Gate na rota/fluxo afetado PRIMEIRO — ele reproduz o erro (ex.: tenta editar o paciente), e você vê o erro REAL no DOM/console/screenshot. Corrija com base no que o gate mostrar, depois re-simula.`;
      }
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
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