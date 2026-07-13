#!/usr/bin/env node
/**
 * Hook SessionStart — CTX: injeta status da camada de governança no início da sessão.
 * Não coleta nada; só informa o que está ativo.
 */
import { hasConsent } from '../engine/consent.mjs';

const consent = hasConsent();
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `[Orquestrar IA] Governança ativa: triagem de requisito (REQ) bloqueia tarefa mal-especificada antes da IA; gate de commit (AUD) valida padrão. Telemetria: ${consent ? 'ON (consentida, anônima)' : 'OFF (sem consentimento — só governança)'}. Códigos VS-* no catálogo.`,
  },
}));
process.exit(0);
