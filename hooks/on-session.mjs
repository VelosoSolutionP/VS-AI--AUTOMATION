#!/usr/bin/env node
/**
 * Hook SessionStart — CTX: injeta status da camada de governança no início da sessão.
 * Não coleta nada; só informa o que está ativo.
 */
import { hasConsent } from '../engine/consent.mjs';
import { buildSessionContext } from '../engine/session-context.mjs';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: buildSessionContext({ consent: hasConsent() }),
  },
}));
process.exit(0);
