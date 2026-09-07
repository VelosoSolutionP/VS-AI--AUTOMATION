#!/usr/bin/env node
/**
 * Hook PostToolUse (git push) — DOCUMENTAÇÃO OBRIGATÓRIA (fecha o fluxo atômico).
 * Fluxo: branch -> tarefa -> gate -> commit -> push -> DOC.
 * Após o push, marca pendência de doc e injeta ordem obrigatória.
 * A pendência bloqueia abrir nova branch (ver on-task VS-DOC-002) até documentar.
 * Marcador vive em .git/ (nunca commitado). Limpar após documentar:
 *   rm .git/qa-gate-pending-doc
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { setFree, isSessionOff } from '../engine/branch-req.mjs';
import { clearBlock } from '../engine/help-state.mjs';
import { notify, devName, projectLabel } from '../engine/notify-whatsapp.mjs';
import { resolveGitCwd } from '../engine/git-cwd.mjs';
import { isGitPush } from '../engine/git-cmd.mjs';
import { pushFoiAceito } from '../engine/push-outcome.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
let sid = 'default';
let sessionCwd = process.cwd();
let payload = {};
try { payload = JSON.parse(raw || '{}'); cmd = payload.tool_input?.command || payload.command || ''; sid = payload.session_id || 'default'; sessionCwd = payload.cwd || payload.tool_input?.cwd || process.cwd(); } catch { cmd = raw; }

if (!isGitPush(cmd)) { process.exit(0); }
// opt-out por SESSÃO (VS-SESSION-001): sessão desarmada não cobra doc nem cria pendência.
if (isSessionOff(sid)) { process.exit(0); }

// repo REAL do push (não a pasta da sessão) — fecha o leak de projeto no recibo/branch.
const gitCwd = resolveGitCwd(cmd, sessionCwd);

// OPT-OUT (bancada / projeto em exploracao): .qa-gate-off desliga a governanca.
// Era o unico hook sem essa saida — num repo com governanca off o push ainda
// abria pendencia de documentacao e mandava recibo de entrega.
if (existsSync(join(gitCwd, '.qa-gate-off')) || existsSync(join(sessionCwd, '.qa-gate-off'))) { process.exit(0); }

// PostToolUse roda com sucesso OU com falha. Push recusado (403, branch protegida,
// rejected, sem rede) NÃO é entrega: marcar pendência de doc travaria a próxima
// tarefa por causa de algo que não aconteceu, e o recibo avisaria o tech lead de
// uma entrega inexistente. Só segue quando o push foi de fato aceito.
const entrega = pushFoiAceito(cmd, payload, gitCwd);
if (!entrega.ok) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `[VS-DOC-000] O push NÃO foi concluído (${entrega.motivo}). Nenhuma pendência de ` +
        'documentação foi aberta e nenhum recibo de entrega foi enviado. Resolva a causa e ' +
        'refaça o push — não relate a tarefa como entregue.',
    },
  }));
  process.exit(0);
}

// push feito -> janela LIVRE: perguntas/confirmações liberadas até a próxima tarefa.
setFree(sid);

// Tarefa ENTREGUE (subiu): encerra o relogio de ajuda (limpa o marcador). A
// contagem/tempo por tarefa é gravada POR COMMIT (on-qa-gate) — pro modo pacotao
// (N tarefas, N commits, 1 push) a auditoria contar N, não 1.
try {
  const proj = projectLabel(gitCwd);
  clearBlock(proj);
} catch {}

let branch = '';
try { branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: gitCwd }).trim(); } catch {}
try {
  const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8', cwd: gitCwd }).trim();
  const absGitDir = isAbsolute(gitDir) ? gitDir : join(gitCwd, gitDir);
  writeFileSync(join(absGitDir, 'qa-gate-pending-doc'), branch || 'branch');
} catch {}

// MURO: todo push (tarefa entregue) dispara o COMPROVANTE DE TAREFA CONCLUIDA no
// WhatsApp — prova pro tech lead/gestor, a IA nao pula (hook determinístico).
// Numero da tarefa sai da BRANCH (padrao <tipo>/<autor>/<numero>). Serve pro recibo
// e, principalmente, pra ordem de documentacao: doc sem numero nao fecha tarefa no
// Redmine, e quem le nao sabe do que se trata.
const task = (branch.match(/(\d{3,})/) || [])[1] || null;

try {
  const proj = projectLabel(gitCwd);
  await notify({ project: proj, task, kind: 'done', dev: devName() });
} catch {}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      `[VS-DOC-001] Push feito${branch ? ' na branch ' + branch : ''}. DOCUMENTAÇÃO Redmine é OBRIGATÓRIA agora (fechamento atômico) — ` +
      'gere no template (Backend/Frontend conforme o que tocou). NÃO inicie outra tarefa antes de documentar. ' +
      (task
        ? `NÚMERO DA TAREFA: #${task} — é OBRIGATÓRIO no cabeçalho de cada seção, exatamente como "### Backend (#${task})" e/ou "### Frontend (#${task})". Doc sem número não fecha tarefa no Redmine. Se o back e o front têm números DIFERENTES, use o de cada um e me pergunte o que faltar.`
        : 'A BRANCH NÃO TEM NÚMERO de tarefa. NÃO invente e NÃO escreva "s/n": PERGUNTE o número antes de gerar a doc.') + ' ' +
      'Em "Testes Implementados" declare o RESULTADO REAL: quantos rodaram, quantos passaram, quantos falharam e o nome de cada falha. Se algo ficou quebrado, diga que ficou — doc que só mostra o que passou esconde erro e o revisor descobre em produção. ' +
      'Se a tarefa teve IMPEDIMENTO (algo que dependeu de pessoas ou de uma regra de negócio e que você não resolveu sozinho — ex.: o QA-Gate não fechou em verde), registre-o na doc endereçado ao TECH LEAD ou GESTOR pra que resolvam. ' +
      'Ao concluir a doc, limpe a pendência: rm .git/qa-gate-pending-doc',
  },
}));
process.exit(0);
