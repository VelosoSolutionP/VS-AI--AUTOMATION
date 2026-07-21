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
    additionalContext: `[Orquestrar IA] Governança ativa: triagem de requisito (REQ) bloqueia tarefa mal-especificada antes da IA; gate de commit (AUD) valida padrão. Telemetria: ${consent ? 'ON (consentida, anônima)' : 'OFF (sem consentimento — só governança)'}. Códigos VS-* no catálogo.\n[ECONOMIA DE TOKEN — regra] Alvo dado = corrige DIRETO, sem subagente (VS-AGENT-001). Buscar: grep com padrão preciso (files_with_matches antes de conteúdo). Ler: Read com offset/limit (fatia, não arquivo inteiro). NÃO reler o que já leu. Alvo não claro = PERGUNTA, não chuta.`,
  },
}));
process.exit(0);
