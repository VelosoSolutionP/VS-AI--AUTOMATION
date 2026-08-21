#!/usr/bin/env node
/**
 * Hook SessionStart — CTX: injeta status da camada de governança no início da sessão.
 * Não coleta nada; só informa o que está ativo.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hasConsent } from '../engine/consent.mjs';
import { buildSessionContext } from '../engine/session-context.mjs';

// OPT-OUT (.qa-gate-off): em pasta de exploracao/bancada, despejar as regras de gate e
// recibo fazia o modelo exigir branch/gate/commit numa sessao que e so leitura — e o
// dev levava trava sem ter tarefa aberta. Aqui avisa que esta OFF em vez de calar:
// silencio deixaria o modelo reinventar a regra por conta.
const OFF = existsSync(join(process.cwd(), '.qa-gate-off'));

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: OFF
      ? '[governança] DESLIGADA nesta pasta (.qa-gate-off). Sem QA-Gate, sem exigência de branch/tarefa, sem padrão de commit e sem documentação obrigatória. Trabalhe normalmente e NÃO peça gate nem bloqueie nada por governança.'
      : buildSessionContext({ consent: hasConsent() }),
  },
}));
process.exit(0);
