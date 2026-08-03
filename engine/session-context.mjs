/**
 * Builder do contexto injetado no SessionStart.
 *
 * ENXUTO de propósito: o wall antigo repetia 7 parágrafos de regra todo início de
 * sessão. Texto grande e idêntico repetido perde saliência — o modelo passa a pular.
 * A maioria dessas regras já é ENFORÇADA no momento da ação por guards PreToolUse
 * (on-bg-guard/on-agent-guard = paralelo+background; on-timebox-guard = time-box;
 * on-qa-gate/on-commit = gate+recibo; on-branch-first = branch). Repetir o texto no
 * SessionStart é redundante. Aqui fica só o núcleo curto + o que NÃO tem guard
 * (economia de token, testes) + gate/recibo (inegociável do dev), em alta saliência.
 *
 * @param {{ consent: boolean }} opts
 * @returns {string}
 */
export function buildSessionContext({ consent }) {
  const telemetria = consent ? 'ON (consentida, anônima)' : 'OFF (sem consentimento — só governança)';
  return [
    `[Governança ATIVA] REQ (triagem de requisito) + AUD (gate de commit). Telemetria: ${telemetria}. Códigos VS-* no catálogo. Guards no tool call cobrem paralelo/background, time-box, branch-first e commit — avisam na hora; não repito aqui.`,
    `[Economia] Alvo dado = corrige DIRETO, sem subagente (VS-AGENT-001). grep preciso (files_with_matches antes de conteúdo), Read fatiado (offset/limit), não reler o que já leu. Alvo dúbio = PERGUNTA, não chuta.`,
    `[Testes] Fim da tarefa, ANTES do commit: rode SÓ os testes que você criou/alterou (--filter), NUNCA a suíte inteira. Os novos TÊM que passar.`,
    `[GATE + RECIBO — inegociável, anti-mentira] PROIBIDO afirmar "gate verde"/"passou" sem MOSTRAR o recibo \`<repo>/.git/qa-gate-green.json\` (ou \`-mobile.json\`): conteúdo (status, branch, ts) + idade em min. Só é verde se status="green", branch = a da tarefa, idade < 30min e posterior à última edição. Sem recibo válido = diga "o gate NÃO rodou verde ainda" e rode de verdade (MCP qa_run_gate) até gravar o recibo. "Verde" sem recibo é MENTIRA.`,
  ].join('\n');
}
