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
import { writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { setFree } from '../engine/branch-req.mjs';
import { clearBlock } from '../engine/help-state.mjs';
import { notify, devName, projectLabel } from '../engine/notify-whatsapp.mjs';
import { resolveGitCwd } from '../engine/git-cwd.mjs';
import { isGitPush } from '../engine/git-cmd.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
let sid = 'default';
let sessionCwd = process.cwd();
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; sid = j.session_id || 'default'; sessionCwd = j.cwd || j.tool_input?.cwd || process.cwd(); } catch { cmd = raw; }

if (!isGitPush(cmd)) { process.exit(0); }

// repo REAL do push (não a pasta da sessão) — fecha o leak de projeto no recibo/branch.
const gitCwd = resolveGitCwd(cmd, sessionCwd);

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
