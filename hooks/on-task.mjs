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

import { parseBranch, loadReq, saveReq, clearReq, setConsult, clearConsult, isFree, clearFree, isSessionOff } from '../engine/branch-req.mjs';
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

// opt-out por SESSÃO: bancada trabalha dentro de projeto governado sem acordar a governança
if (isSessionOff(sid)) {
  process.exit(0);
}

// FECHAMENTO = o DIA (controle de horas). "fechamento"/"fechar"/"encerramento"
// sozinho, ou "...dia"/"controle de horas" -> SEMPRE dia. (Tarefa fecha durante o
// trabalho pelo gate/commit, não por essa palavra.) Só pede início/fim/almoço/dailys;
// o resto a IA monta.
if (/^\s*(fechamento|fechar|encerramento|encerrar)\s*[.!]?\s*$/i.test(prompt) ||
    /\b(fech(a|ar|amento)|encerr\w*)\b[\s\wçãáéíóú]{0,14}\bdia\b/i.test(prompt) ||
    /\bfim do dia\b/i.test(prompt) || /\bcontrole de horas\b/i.test(prompt)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        '[governança] FECHAMENTO DE DIA (controle de horas). NÃO registre ainda — PERGUNTE ao Fabiano, nesta ordem: ' +
        '(1) início, (2) fim, (3) almoço (horário/duração ou "não teve"), (4) dailys (teve/não). ' +
        'Com as 4 respostas, monte tudo sozinho: registre em C:/Veloso/ProjetosMsb/ControleHoras/<YYYY-MM>.md — ' +
        'horas líquidas = (fim − início) − almoço; descreva a atividade puxando o git log dos projetos do dia. ' +
        'NÃO é fechamento de tarefa (isso é durante o trabalho, via gate/commit).',
    },
  }));
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

  // cancelar tarefa em curso
  if (pending && /\b(cancela|cancelar|esquece|aborta|deixa pra l[áa])\b/i.test(prompt)) {
    clearReq(sid);
    process.exit(0);
  }

  const isQuestion = /\?\s*$/.test(prompt) ||
    /^\s*(por ?que|porqu[eê]|como|o que|qual|quais|quando|onde|pode|consegue|poderia|voc[êe]|vc|e se|ser[áa]|tem como|d[áa] pra|explica|entendi|acho que|n[ãa]o entendi|e o|e a|mas )/i.test(prompt);

  // ABRIR TAREFA = palavra "tarefa"/"task" + NÚMERO deliberado. Número solto
  // (porta :3333, /paths, versão, hash) NÃO conta. Até isso, a IA fica LIVRE.
  const temTarefa = /\btarefas?\b|\btask\b/i.test(prompt);
  const limpo = prompt
    .replace(/https?:\/\/\S+/gi, ' ')    // URLs
    .replace(/:\d+/g, ' ')                // :porta
    .replace(/\/\S+/g, ' ')               // /paths
    .replace(/\b[0-9a-f]{7,}\b/gi, ' ');  // hashes
  const numMatch = limpo.match(/#?\b(\d{3,6})\b/);
  const numDeliberado = (temTarefa && numMatch && !isQuestion) ? numMatch[1] : null;
  const emCurso = !!(pending && pending.num);

  // LIVRE: sem "tarefa <número>" e sem tarefa em curso, a IA faz o que o Fabiano pedir.
  if (!emCurso && !numDeliberado) {
    process.exit(0);
  }

  // TAREFA EM CURSO: só cobra os campos que faltam quando o turno REALMENTE traz dado
  // de branch (tipo/origem/alvo) ou é uma resposta curta. Se o Fabiano só conversa/
  // pergunta no meio da tarefa, NÃO fica nagando — deixa livre e mantém o pendente.
  const trouxeCampo = !!(cur.tipo || cur.origem || cur.alvo) || !!numDeliberado;
  const respostaCurta = prompt.trim().length <= 25;
  if (emCurso && !numDeliberado && !trouxeCampo && !respostaCurta) {
    process.exit(0);
  }

  // abrindo tarefa nova: doc da anterior tem que estar feita
  if (numDeliberado && !emCurso && existsSync(join(process.cwd(), '.git', 'qa-gate-pending-doc'))) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason:
        '[VS-DOC-002] BLOCKED — documentação da tarefa anterior pendente.\n' +
        'Documente (Redmine) antes de iniciar outra. Após documentar: rm .git/qa-gate-pending-doc',
    }));
    process.exit(0);
  }

  const merged = {
    num: numDeliberado || pending?.num || null,
    tipo: cur.tipo || pending?.tipo || null,
    origem: cur.origem || pending?.origem || null,
    alvo: cur.alvo || pending?.alvo || null,
    crud: cur.crud || pending?.crud || false,
  };

  // OBRIGATÓRIO: só número + tipo + origem. ALVO é OPCIONAL — default 'todos'
  // (cria branch em back+front, e mobile se houver). Projeto NÃO é pedido (o Fabiano está nele).
  const missing = [];
  if (!merged.tipo) { missing.push('tipo'); }
  if (!merged.origem) { missing.push('origem'); }

  if (missing.length) {
    saveReq(sid, merged);
    const check =
      '① ' + (merged.num ? '✅' : '❌') + ' NÚMERO' + (merged.num ? ' ' + merged.num : '') + '\n' +
      '② ' + (merged.tipo ? '✅' : '❌') + ' TIPO' + (merged.tipo ? ' ' + merged.tipo : '') + '\n' +
      '③ ' + (merged.origem ? '✅' : '❌') + ' ORIGEM' + (merged.origem ? ' ' + merged.origem : '');
    const OPTS = {
      tipo: '② TIPO → fix | feat | refactor | perf | hotfix | chore | test | docs',
      origem: '③ ORIGEM → dev | hml | main',
    };
    const pedir = missing.map((k) => '• ' + OPTS[k]).join('\n');
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: '[VS-BRANCH-001] Pra criar a tarefa (PROJETO eu já sei; ALVO default = todos, não precisa dizer):\n' +
        check + '\n\nResponda o que falta (opções EXATAS, NÃO invente, NÃO pergunte repo/módulo):\n' + pedir + '\n\n(ou "cancela")',
    }));
    process.exit(0);
  }

  // ALVO default = 'todos' (back+front, +mobile se tiver) quando o Fabiano não especificou.
  if (!merged.alvo) { merged.alvo = 'todos'; }

  // completo -> injeta contexto da tarefa
  clearReq(sid);
  clearConsult(sid);
  let ctx;
  if (merged.alvo === 'mobile') {
    ctx = `[governança] TAREFA #${merged.num} (${merged.tipo}) · ALVO=MOBILE. REGRA MOBILE: NÃO cria branch de tarefa, NÃO faz push. Acumula commits LOCAIS; deploy (APK) só no fim do dia, quando o Fabiano pedir. Vá DIRETO no código Flutter/dart — NÃO investigue front/back.`;
  } else if (merged.alvo === 'todos') {
    ctx = `[governança] TAREFA #${merged.num} (${merged.tipo}) · ALVO=TODOS (cross-repo). Em cada repo tocado crie a branch ${merged.tipo}/fabiano.veloso/${merged.num} a partir de origin/${merged.origem} (git fetch origin ${merged.origem} && git checkout -b ...). NÃO se restrinja a uma camada. REGRA: no repo MOBILE acumula commit local sem push; front/back commit+push normal. O gate roda o alvo aplicável em cada commit.`;
  } else {
    ctx = `[governança] branch OK: ${merged.tipo}/fabiano.veloso/${merged.num} a partir de origin/${merged.origem}. ALVO=${merged.alvo.toUpperCase()} — trabalhe SÓ na camada ${merged.alvo}, vá direto no alvo. Crie: git fetch origin ${merged.origem} && git checkout -b ${merged.tipo}/fabiano.veloso/${merged.num} origin/${merged.origem}`;
  }
  if (merged.crud) {
    ctx += ` | BUG CRUD/VALIDAÇÃO: rode o QA-Gate na rota/fluxo afetado PRIMEIRO — ele reproduz o erro real (DOM/console/screenshot). Corrija com base no que o gate mostrar.`;
  }
  // FLUXO ABSOLUTO — executar agora, sem parar no meio:
  ctx += ` | FLUXO (execute JÁ, não pare): 1) CRIE a branch agora (nos repos do alvo); 2) faça o trabalho; ` +
    `3) rode o QA-Gate; 4) VERDE → commit dos arquivos + push das branches alteradas (mobile acumula local, sem push); ` +
    `5) documente (Redmine). Se o gate faltar algo/der erro, RESPONSABILIDADE É SUA: veja o que é, arruma e roda o gate — ` +
    `só prossegue no VERDE. Não peça pro Fabiano subir ambiente; se vira.`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
  }));
  process.exit(0);
}
