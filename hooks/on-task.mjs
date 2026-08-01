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

import { parseBranch, loadReq, saveReq, clearReq, setConsult, clearConsult, isFree, clearFree, isSessionOff, setTask, clearTask, getTask, isPreflight, setPreflight } from '../engine/branch-req.mjs';
import { loadCompanyConfig, branchName as buildBranchName } from '../engine/company-config.mjs';
import { timeBoxStatus } from '../engine/timebox.mjs';
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

// MENSAGENS DO HARNESS (não são prompt do Fabiano): resultado de agente
// (<task-notification>), lembretes de sistema, saída de comando local, etc. NÃO engatar
// a governança nisso — senão pede escopo/branch em cima de notificação de agente.
if (/^\s*<\/?(task-notification|system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|task-id|tool-use-id)\b/i.test(prompt)) {
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

// DESTRAVA DO TIME-BOX: tarefa ativa que ESTOUROU o teto trava a sessão inteira
// (on-timebox-guard). Só o dev destrava: a palavra de liberação reinicia a janela e o
// guard volta a liberar. Só age quando a tarefa realmente estourou (evita falso positivo).
{
  let t = null; try { t = getTask(sid); } catch {}
  if (t && t.num && t.ts) {
    const st0 = timeBoxStatus(t, Date.now(), loadCompanyConfig(process.cwd()));
    const libera = /^\s*(liberad[oa]|libera)\b/i.test(prompt);
    if (st0.overdue && libera) {
      setTask(sid, { ...t, ts: Date.now() });
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `[governança] TIME-BOX destravado pelo dev — janela da tarefa #${t.num} reiniciada (+${st0.limitMin}min). Retome de onde parou; diga rápido o que travou e siga.`,
        },
      }));
      process.exit(0);
    }
  }
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

// true SÓ quando a sessão estava FREE (tarefa anterior JÁ finalizada: commit+push) e o
// Fabiano mandou a PRÓXIMA tarefa. Nesse caso a guarda de tarefa-ativa não engata —
// abrir nova tarefa é legítimo. Fora daqui, tarefa ativa não finalizada barra nova.
let openingAfterFinalize = false;
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
        additionalContext: '[governança] Fluxo de tarefa RE-ARMADO. Peça ao Fabiano, NA ORDEM: número → tipo → origem → repositórios (front/back/mobile/todos — pode combinar, ex.: "front back") → escopo (texto livre) pra criar a branch.',
      },
    }));
    process.exit(0);
  }
  // tem número -> tarefa anterior finalizada; abre a nova sem barrar no muro de tarefa-ativa
  openingAfterFinalize = true;
  // cai no muro de branch abaixo
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
  const hasList = (v) => Array.isArray(v) && v.length > 0;
  // 4 campos core já preenchidos em turnos anteriores = estamos ESPERANDO o escopo.
  const coreReadyBefore = !!(pending?.num && pending?.tipo && pending?.origem && hasList(pending?.repositorios));

  // META/PUSHBACK: dev pedindo pra NÃO ser travado, falando da ferramenta/sessão/MCP, ou
  // cancelando. Se há tarefa pendente, ABORTA — NUNCA trata conversa como campo/escopo
  // (bug: "nao me trava em" fechava tarefa #100 capturando a frase como escopo).
  const isMeta = /(n[ãa]o me trava|me trava\b|me destrav|para com|deixa (isso|pra l[áa]|pra depois)|\bno mcp\b|\bna ferramenta\b|ferramenta\b|ness[ae] sess[ãa]o|altera[çc]\w*.{0,6}\bmcp\b|\bno gate\b|governan[çc]a)/i.test(prompt);
  if (pending && (/\b(cancela|cancelar|esquece|aborta|deixa pra l[áa])\b/i.test(prompt) || isMeta)) {
    clearReq(sid);
    clearTask(sid);
    process.exit(0);
  }

  const isQuestion = /\?\s*$/.test(prompt) ||
    /^\s*(por ?que|porqu[eê]|como|o que|qual|quais|quando|onde|pode|consegue|poderia|voc[êe]|vc|e se|ser[áa]|tem como|d[áa] pra|explica|entendi|acho que|n[ãa]o entendi|e o|e a|mas )/i.test(prompt);

  // ABRIR TAREFA: palavra "tarefa"/"task" + número, OU mensagem que é SÓ o número
  // (ex.: "36744" / "#36744"). Número DENTRO de frase (porta :3333, /paths, url, hash)
  // NÃO conta — só aparece acompanhado de outras palavras sem "tarefa". Até isso, LIVRE.
  const temTarefa = /\btarefas?\b|\btask\b/i.test(prompt);
  // mensagem que COMEÇA com número (ex.: "36744", "36744 feat dev todos", "36744 novo modal") = tarefa.
  const iniciaNum = (prompt.match(/^\s*#?(\d{3,6})\b/) || [])[1] || null;
  const limpo = prompt
    .replace(/https?:\/\/\S+/gi, ' ')    // URLs
    .replace(/:\d+/g, ' ')                // :porta
    .replace(/\/\S+/g, ' ')               // /paths
    .replace(/\b[0-9a-f]{7,}\b/gi, ' ');  // hashes
  const numMatch = limpo.match(/#?\b(\d{3,6})\b/);
  // engata com: começa com número, OU "tarefa"+número. Número no MEIO de frase (porta/path) NÃO.
  const numDeliberado = (!isQuestion && (iniciaNum || (temTarefa && numMatch))) ? (iniciaNum || numMatch[1]) : null;
  const emCurso = !!(pending && pending.num);

  // MURO DE TAREFA ATIVA (VS-TASK-001): tarefa já CRIADA e ainda NÃO finalizada
  // (sem commit+push -> sessão não está FREE). Só se pode abrir OUTRA tarefa depois de
  // fechar a atual. Enquanto isso, número na conversa (ex.: "422 ao salvar", "500 no
  // cadastro" — código de erro/qtd/id explicando o problema) NÃO reabre nem cria tarefa.
  // openingAfterFinalize = veio do fluxo pós-push (tarefa anterior já fechada) -> libera.
  const active = openingAfterFinalize ? null : getTask(sid);
  if (active && active.num && !emCurso) {
    const mesmoNum = numDeliberado && String(numDeliberado) === String(active.num);
    if (numDeliberado && !mesmoNum) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason:
          `[VS-TASK-001] BLOCKED — a tarefa #${active.num} ainda NÃO foi finalizada (falta commit + push). ` +
          `Só dá pra abrir OUTRA tarefa depois de fechar a atual: rode o gate (VERDE), commit e push da #${active.num} — aí a sessão libera pra próxima. ` +
          `Se o "${numDeliberado}" acima é só parte da explicação do problema (código de erro, quantidade, id, porta) e NÃO uma tarefa nova, reformule sem começar a mensagem pelo número e siga trabalhando na #${active.num}.`,
      }));
      process.exit(0);
    }
    // mesmo número, ou sem número deliberado = conversa/trabalho da própria tarefa ativa -> livre
    process.exit(0);
  }

  // LIVRE: sem "tarefa <número>" e sem tarefa em curso, a IA faz o que o Fabiano pedir.
  if (!emCurso && !numDeliberado) {
    process.exit(0);
  }

  // TAREFA EM CURSO: só cobra os campos que faltam quando o turno REALMENTE traz dado
  // de branch (tipo/origem/alvo) ou é uma resposta curta. Se o Fabiano só conversa/
  // pergunta no meio da tarefa, NÃO fica nagando — deixa livre e mantém o pendente.
  const trouxeCampo = !!(cur.tipo || cur.origem || cur.repositorios || cur.alvo || cur.target) || !!numDeliberado;
  const respostaCurta = prompt.trim().length <= 25;
  // Conversa longa no meio da tarefa = não naga. MAS se estamos esperando o escopo
  // (coreReadyBefore), a mensagem descritiva longa É o escopo — deixa passar pra captura.
  if (emCurso && !numDeliberado && !trouxeCampo && !respostaCurta && !coreReadyBefore) {
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
    repositorios: hasList(cur.repositorios) ? cur.repositorios : (pending?.repositorios || null),
    escopo: pending?.escopo || null,
    crud: cur.crud || pending?.crud || false,
  };
  // Lista solta (sem rótulo) preenche repositorios quando ainda falta.
  if (!hasList(merged.repositorios) && hasList(cur.target)) { merged.repositorios = cur.target; }
  // ⑤ ESCOPO = descrição da tarefa (TEXTO LIVRE). Assim que os 4 campos core já
  // estavam preenchidos (em turnos ANTERIORES), a PRÓXIMA mensagem é o escopo INTEIRO —
  // NÃO parseia palavra (front/back/tela não trava mais). A IA usa pra saber a tela/fluxo
  // onde corrigir/implementar.
  const cancelou = /^\s*(cancela|cancelar|esquece|aborta)\b/i.test(prompt);
  // Só captura escopo de mensagem DESCRITIVA — nunca de pergunta ou pushback/meta
  // (senão conversa vira escopo e fecha tarefa fantasma, como o bug do #100).
  if (!merged.escopo && coreReadyBefore && !cancelou && !isMeta && !isQuestion && prompt.trim().length >= 3) {
    merged.escopo = prompt.trim();
  }

  // OBRIGATÓRIO e NA ORDEM (absoluto, sem pular): número → tipo → origem →
  // repositorios → ESCOPO. Projeto NÃO é pedido (o Fabiano está nele).
  // repositorios='todos' = cria a MESMA branch em back+front+mobile.
  const missing = [];
  if (!merged.tipo) { missing.push('tipo'); }
  if (!merged.origem) { missing.push('origem'); }
  if (!hasList(merged.repositorios)) { missing.push('repositorios'); }
  if (!merged.escopo) { missing.push('escopo'); }

  if (missing.length) {
    saveReq(sid, merged);
    const check =
      '① ' + (merged.num ? '✅' : '❌') + ' NÚMERO' + (merged.num ? ' ' + merged.num : '') + '\n' +
      '② ' + (merged.tipo ? '✅' : '❌') + ' TIPO' + (merged.tipo ? ' ' + merged.tipo : '') + '\n' +
      '③ ' + (merged.origem ? '✅' : '❌') + ' ORIGEM' + (merged.origem ? ' ' + merged.origem : '') + '\n' +
      '④ ' + (hasList(merged.repositorios) ? '✅' : '❌') + ' REPOSITÓRIOS' + (hasList(merged.repositorios) ? ' ' + merged.repositorios.join('+') : '') + '\n' +
      '⑤ ' + (merged.escopo ? '✅' : '❌') + ' ESCOPO' + (merged.escopo ? ' ✓' : '');
    // SELETOR (chave seletora): a IA apresenta os campos que faltam via AskUserQuestion
    // (botões), NÃO em texto. tipo/origem = single-select; repositorios = multiSelect;
    // escopo = texto livre (não é seletor).
    const OPCOES = {
      tipo: 'TIPO (header "Tipo", single-select): fix, feat, perf, refactor, chore, hotfix, docs',
      origem: 'ORIGEM (header "Origem", single-select): dev, hml, main',
      repositorios: 'REPOSITORIOS (header "Repos", multiSelect=true): front, back, mobile, todos',
    };
    const selavel = missing.filter((k) => k !== 'escopo').map((k) => '  • ' + OPCOES[k]).join('\n');
    const temEscopo = missing.includes('escopo');
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: '[VS-BRANCH-001] Faltam campos pra criar a branch (PROJETO eu já sei — você está nele).\n' +
        'Status: ' + check.replace(/\n/g, '   ') + '\n' +
        'APRESENTE AGORA via a ferramenta **AskUserQuestion** (SELETOR/botões — NÃO em texto, NÃO invente opção) ' +
        'os campos-seletor que faltam, numa ÚNICA chamada (uma question por campo, nesta ordem):\n' +
        (selavel || '  (nenhum campo-seletor pendente)') + '\n' +
        (temEscopo ? 'E o ESCOPO peça em TEXTO livre (não é seletor): o que é, em qual tela/fluxo, comportamento esperado.\n' : '') +
        'Quando o Fabiano selecionar, use os valores escolhidos e o fluxo segue (cria a branch). (ou "cancela")',
    }));
    process.exit(0);
  }

  // completo -> checklist VÁLIDO (num+tipo+origem+repositorios+escopo). Grava estado:
  // git-guard vai EXIGIR que commit/push seja na branch dela (prova da criação).
  clearReq(sid);
  clearConsult(sid);
  // Governança não usa o tipo `test` (decisão Fabiano 23/07/2026): coage para `fix`.
  if (merged.tipo === 'test') merged.tipo = 'fix';
  setTask(sid, { num: merged.num, tipo: merged.tipo, origem: merged.origem, repositorios: merged.repositorios, escopo: merged.escopo });
  // Marcador de tempo da tarefa (relógio de 15min): o watcher pinga no WhatsApp
  // se a tarefa passar do timeout sem fechar (verde/push limpam). É como a IA
  // deixa de rodar "solta" 40min — passou de 15min, avisa o Fabiano.
  try {
    const { reportBlock } = await import('../engine/help-state.mjs');
    const proj = (process.cwd().replace(/[\\/]+$/, '').split(/[\\/]/).pop()) || 'projeto';
    reportBlock({ project: proj, task: merged.num, problem: `tarefa em andamento (passou do tempo)`, tsMs: Date.now() });
  } catch {}
  const repos = merged.repositorios; // lista canônica [front?, back?, mobile?]
  const cfg = loadCompanyConfig(process.cwd());
  const branchName = buildBranchName(cfg, { tipo: merged.tipo, numero: merged.num });
  const cmdOrigin = `git fetch origin ${merged.origem} && git checkout -b ${branchName} origin/${merged.origem}`;
  const cmdAcc = `git checkout -b ${branchName}`; // mobile: sai da branch ATUAL (acumula), SEM origin/
  const escopoLinha = `ESCOPO: ${merged.escopo}`;
  const temMobile = repos.includes('mobile');
  const linhas = repos.map((r) => r === 'mobile'
    ? `• MOBILE → \`${cmdAcc}\` — sai da branch ATUAL (ACUMULA o trabalho anterior; NÃO usa origin/, senão zera o acúmulo). Commits LOCAIS, SEM push até o Fabiano pedir deploy.`
    : `• ${r.toUpperCase()} → \`${cmdOrigin}\` — a partir de origin/${merged.origem}. Commit + push só no gate VERDE.`);
  let ctx = `[governança] TAREFA #${merged.num} (${merged.tipo}) · REPOSITÓRIOS=${repos.join('+').toUpperCase()}.\n${escopoLinha}\n` +
    `⚠️ PASSO 1 OBRIGATÓRIO — ANTES de editar/corrigir QUALQUER arquivo, crie a branch \`${branchName}\` em CADA repo escolhido:\n` +
    linhas.join('\n') + '\n' +
    `Só DEPOIS de criar TODAS as branches, comece a trabalhar. NÃO pule esse passo, NÃO vá direto pro código.` +
    (temMobile ? `\nREGRA MOBILE: branch sai da ATUAL (acumula), commits LOCAIS, SEM push — deploy (APK) só no fim do dia a pedido do Fabiano.` : '');
  // PREFLIGHT 1x na sessão: 1ª tarefa valida ambiente ON antes de codar. Verde -> libera
  // a sessão (não repete). Cair algo depois: a IA resolve na hora e segue (sem re-travar).
  if (!isPreflight(sid)) {
    ctx += `\n⛳ PREFLIGHT (1ª tarefa desta sessão — roda UMA vez): ANTES de codar, garanta o ambiente ON e valide o gate — ` +
      `① docker ON (sobe se off) · ② app/ambiente no ar (qa_check_app no baseUrl) · ③ reverb ON · ④ smoke do QA-Gate. ` +
      `Tudo ON/verde → a SESSÃO fica liberada e o preflight NÃO repete. Se algo cair DEPOIS, resolve na hora e segue — NÃO re-trava por preflight. ` +
      `(Ambiente já ON = passa rápido.)`;
    setPreflight(sid);
  }
  if (merged.crud) {
    ctx += `\nBUG CRUD/VALIDAÇÃO: rode o QA-Gate na rota/fluxo afetado — ele reproduz o erro real. Corrija com base no que o gate mostrar.`;
  }
  // BUG VOLTOU: branch do número já pode existir.
  ctx += `\n⚠️ Antes de criar: se JÁ existir branch com o número #${merged.num} (local/remota) = BUG VOLTOU → NÃO crie nova, faça \`git checkout\` na existente e investigue a regressão (a correção anterior não segurou).`;
  // PADRÃO DE COMMIT conforme a config da empresa (default = número da tarefa).
  const commitEx = (cfg.commitScope === 'modulo')
    ? `${merged.tipo}(<modulo>): <descrição breve>`
    : (cfg.commitScope === 'any' ? `${merged.tipo}(<escopo>): <descrição breve>` : `${merged.tipo}(${merged.num}): <descrição breve>`);
  ctx += `\nCOMMIT (padrão da empresa): \`${commitEx}\`` +
    (cfg.commitScope === 'numero' ? ` — escopo é o NÚMERO da tarefa; módulo/contexto vai NA descrição.` : '') +
    ` Sem assinatura de IA.`;
  // FLUXO ABSOLUTO — na ordem, sem pular:
  ctx += `\nFLUXO (na ordem): ① CRIA a(s) branch(es) → ② trabalha → ③ roda o QA-Gate → ④ VERDE: commit + push das branches (mobile acumula local) → ⑤ documenta (Redmine). ` +
    `Gate faltando/erro = RESPONSABILIDADE SUA: vê o que é, arruma e roda até VERDE (se vira, não peça pro Fabiano subir ambiente). Só prossegue no verde.`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
  }));
  process.exit(0);
}
