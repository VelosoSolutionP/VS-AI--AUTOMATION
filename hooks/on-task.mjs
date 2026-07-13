#!/usr/bin/env node
/**
 * Hook UserPromptSubmit — triagem de requisito ANTES da IA processar.
 * Determinístico. Se faltar requisito, bloqueia o turno e devolve VS-REQ-001/004.
 * A IA nem é acionada = economia de token.
 *
 * settings.json (ver hooks/settings.example.json):
 *   hooks.UserPromptSubmit -> command: node ${caminho}/hooks/on-task.mjs
 *
 * Contrato: recebe JSON no stdin ({ prompt, ... }); bloqueia com
 * {"decision":"block","reason":"..."} no stdout.
 */
import { validateTask } from '../engine/requirements.mjs';

const raw = await new Promise((res) => {
  let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => res(s));
});

let prompt = '';
try { prompt = (JSON.parse(raw || '{}').prompt) || ''; } catch { prompt = raw || ''; }

// só age em prompts que parecem tarefa (evita bloquear conversa normal). Stems + rótulos.
const looksLikeTask = /(cri[ae]|corrig|arrum|implement|ajust|refator|adicion|remov|cadastr|bug|feature|feat|tarefa|task|#\d{3,}|descri[çc][ãa]o\s*:|objetivo|crit[ée]rio)/i.test(prompt);
if (!prompt || !looksLikeTask) { process.exit(0); }

const r = validateTask(prompt);

if (r.blocked) {
  // bloqueia o turno: a IA não processa a tarefa mal-especificada
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `${r.short}\n\n${r.dev_msg}`,
  }));
  process.exit(0);
}

// liberado: injeta contexto leve (código + decisão de escalonar) para o modelo
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: `[governança] ${r.code} ${r.status}. escalar IA: ${r.escalate.call_ai ? 'sim (' + r.escalate.reason + ')' : 'não — tarefa simples'}.`,
  },
}));
process.exit(0);
