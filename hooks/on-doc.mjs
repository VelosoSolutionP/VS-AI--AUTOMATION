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
import { join } from 'node:path';
import { setFree } from '../engine/branch-req.mjs';

const raw = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
let cmd = '';
let sid = 'default';
try { const j = JSON.parse(raw || '{}'); cmd = j.tool_input?.command || j.command || ''; sid = j.session_id || 'default'; } catch { cmd = raw; }

if (!/\bgit\b[\s\S]*\bpush\b/.test(cmd)) { process.exit(0); }

// push feito -> janela LIVRE: perguntas/confirmações liberadas até a próxima tarefa.
setFree(sid);

let branch = '';
try { branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(); } catch {}
try {
  const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  writeFileSync(join(gitDir, 'qa-gate-pending-doc'), branch || 'branch');
} catch {}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      `[VS-DOC-001] Push feito${branch ? ' na branch ' + branch : ''}. DOCUMENTAÇÃO Redmine é OBRIGATÓRIA agora (fechamento atômico) — ` +
      'gere no template (Backend/Frontend conforme o que tocou). NÃO inicie outra tarefa antes de documentar. ' +
      'Se a tarefa teve IMPEDIMENTO (algo que dependeu de pessoas ou de uma regra de negócio e que você não resolveu sozinho — ex.: o QA-Gate não fechou em verde), registre-o na doc endereçado ao TECH LEAD ou GESTOR pra que resolvam. ' +
      'Ao concluir a doc, limpe a pendência: rm .git/qa-gate-pending-doc',
  },
}));
process.exit(0);
