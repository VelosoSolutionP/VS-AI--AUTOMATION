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
    additionalContext: `[Orquestrar IA] Governança ativa: triagem de requisito (REQ) bloqueia tarefa mal-especificada antes da IA; gate de commit (AUD) valida padrão. Telemetria: ${consent ? 'ON (consentida, anônima)' : 'OFF (sem consentimento — só governança)'}. Códigos VS-* no catálogo.\n[ECONOMIA DE TOKEN — regra] Alvo dado = corrige DIRETO, sem subagente (VS-AGENT-001). Buscar: grep com padrão preciso (files_with_matches antes de conteúdo). Ler: Read com offset/limit (fatia, não arquivo inteiro). NÃO reler o que já leu. Alvo não claro = PERGUNTA, não chuta.
[COLABORAÇÃO DEV — regra] O dev conhece o projeto ponta-a-ponta e também programa. Se uma tarefa SIMPLES está ARRASTANDO — sinais: aplicando a mesma mudança componente-a-componente / item-a-item quando provavelmente há solução SISTÊMICA (ex.: dark mode via tema central em vez de tela por tela); muitas iterações repetitivas sem convergir; tempo alto preso no mesmo ponto — PARE e PERGUNTE ao dev se ele tem uma abordagem melhor ANTES de seguir. Diga onde travou + o approach atual. Se ele indicar um caminho: LEIA, avalie se faz sentido técnico; se fizer, ADOTE; se não fizer, explique o porquê e siga. Não queime tempo/token raspando item a item sem consultar quem conhece o projeto.`,
  },
}));
process.exit(0);
