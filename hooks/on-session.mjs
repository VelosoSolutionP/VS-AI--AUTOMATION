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
[COLABORAÇÃO DEV — regra] O dev conhece o projeto ponta-a-ponta e também programa. Se uma tarefa SIMPLES está ARRASTANDO — sinais: aplicando a mesma mudança componente-a-componente / item-a-item quando provavelmente há solução SISTÊMICA (ex.: dark mode via tema central em vez de tela por tela); muitas iterações repetitivas sem convergir; tempo alto preso no mesmo ponto — PARE e PERGUNTE ao dev se ele tem uma abordagem melhor ANTES de seguir. Diga onde travou + o approach atual. Se ele indicar um caminho: LEIA, avalie se faz sentido técnico; se fizer, ADOTE; se não fizer, explique o porquê e siga. Não queime tempo/token raspando item a item sem consultar quem conhece o projeto.
[IMPEDIMENTO — regra] Gate vermelho ou bloqueio por dependência de INFRA (devops/deploy/ambiente flaky, indisponível ou não-confiável): ANTES de escalar, busque um PALIATIVO CONFIÁVEL que DESACOPLE da infra (fallback defensivo, stub/boundary mockado, feature flag, retry/timeout, caminho alternativo) — desde que seja CORRETO, REVERSÍVEL e que NÃO esconda bug de código nem mude comportamento de negócio de forma errada. Achou: aplique, DOCUMENTE o paliativo + a dependência de infra (dívida a acompanhar, aponta devops/tech lead) e RODE O GATE DE NOVO. Se mudar produto ou for arriscado: PERGUNTE antes de aplicar. Sem paliativo confiável: reporte o IMPEDIMENTO (o que trava, por quê, quem resolve). NÃO paliar BUG de código — isso é fix na causa raiz, sempre.
[TIME-BOX — regra] Tarefa de ALVO ÚNICO e simples (ex.: criar cadastro/CRUD, ajuste pontual): se passar de ~10min OU acumular muitas iterações sem entregar, PARE, EXPLIQUE o que está fazendo / onde travou e PERGUNTE ao dev. Alvo único NÃO justifica 1h — proibido "olhar arquivo/trem que não devia" (varredura à toa, reler o que já leu, investigar fora do alvo). Performance é regra: alvo dado → direto no ponto.
[TESTES — regra absoluta] No FIM da tarefa, ANTES do commit, rode SÓ os testes que VOCÊ criou/alterou pra essa mudança (filtro por arquivo/nome/--filter), NUNCA a suíte inteira (lenta). Os testes novos TÊM que passar antes do commit. Não rode a suíte completa sem o dev pedir.`,
  },
}));
process.exit(0);
