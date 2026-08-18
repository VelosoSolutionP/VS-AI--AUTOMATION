/**
 * Instalador — escreve os HOOKS da suite no settings da ferramenta detectada.
 *
 * Motivo: o MCP entrega as tools, mas quem conduz o fluxo multi-turn (número da
 * tarefa -> tipo -> origem -> repositórios) é o hook `on-task` no UserPromptSubmit.
 * Até aqui isso era colado à mão a partir de hooks/settings.example.json — com
 * caminho absoluto da máquina de quem escreveu o exemplo. Agora sai da instalação.
 *
 * Merge não-destrutivo e IDEMPOTENTE: preserva os hooks do cliente e substitui os
 * nossos (identificados pelo diretório de hooks da instalação) em vez de duplicar.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Mapa evento -> matcher -> scripts. Fonte única da verdade do wiring.
 * `matcher: null` = entrada sem matcher (SessionStart/UserPromptSubmit).
 * @type {Array<{evento:string, matcher:string|null, scripts:string[]}>}
 */
export const HOOKS_SPEC = [
  { evento: 'SessionStart', matcher: null, scripts: ['on-session.mjs'] },
  { evento: 'UserPromptSubmit', matcher: null, scripts: ['on-task.mjs'] },
  { evento: 'PreToolUse', matcher: '*', scripts: ['on-timebox-guard.mjs'] },
  { evento: 'PreToolUse', matcher: 'Bash', scripts: ['on-commit.mjs', 'on-git-guard.mjs', 'on-qa-gate.mjs'] },
  { evento: 'PreToolUse', matcher: 'Task|Agent|Dispatch|dispatch_agent', scripts: ['on-agent-guard.mjs'] },
  { evento: 'PreToolUse', matcher: 'Bash|PowerShell', scripts: ['on-bg-guard.mjs'] },
  { evento: 'PreToolUse', matcher: 'Edit|Write|MultiEdit', scripts: ['on-branch-first.mjs'] },
  { evento: 'PostToolUse', matcher: 'Bash|PowerShell', scripts: ['on-doc.mjs'] },
];

/** Comando de um hook, com caminho absoluto da instalação. */
export function hookCommand(hooksDir, script) {
  return `node ${join(hooksDir, script)}`;
}

/**
 * Puro: monta o bloco `hooks` completo apontando pro diretório de hooks informado.
 * @param {string} hooksDir caminho absoluto de .../hooks
 * @returns {Object<string,Array<object>>}
 */
export function buildHooks(hooksDir) {
  const out = {};
  for (const { evento, matcher, scripts } of HOOKS_SPEC) {
    const entrada = { hooks: scripts.map((s) => ({ type: 'command', command: hookCommand(hooksDir, s) })) };
    if (matcher) { entrada.matcher = matcher; }
    (out[evento] = out[evento] || []).push(entrada);
  }
  return out;
}

/** Todos os scripts que a suite instala. */
const NOSSOS_SCRIPTS = [...new Set(HOOKS_SPEC.flatMap((s) => s.scripts))];

/**
 * Uma entrada é nossa quando todos os comandos dela rodam um script NOSSO — por
 * NOME, não por caminho. Casar por diretório deixaria hook órfão quando o cliente
 * move a instalação de pasta (o antigo passaria por "hook do cliente" e sobreviveria).
 */
function ehNossa(entrada) {
  const hs = entrada?.hooks;
  if (!Array.isArray(hs) || !hs.length) { return false; }
  return hs.every((h) => typeof h?.command === 'string'
    && NOSSOS_SCRIPTS.some((s) => h.command.endsWith(s) || h.command.includes(`/${s}`) || h.command.includes(`\\${s}`)));
}

/**
 * Puro: mescla nossos hooks no settings, preservando os do cliente.
 * Remove entradas nossas anteriores (mesmo hooksDir) antes de inserir — reinstalar
 * não duplica, e trocar a suite de pasta não deixa hook órfão apontando pro vazio.
 * @param {object} settings settings.json atual
 * @param {string} hooksDir caminho absoluto de .../hooks
 */
export function mergeHooks(settings, hooksDir) {
  const s = settings && typeof settings === 'object' ? JSON.parse(JSON.stringify(settings)) : {};
  const nossos = buildHooks(hooksDir);
  s.hooks = { ...(s.hooks || {}) };

  for (const [evento, entradas] of Object.entries(nossos)) {
    const atuais = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : [];
    const doCliente = atuais.filter((e) => !ehNossa(e));
    s.hooks[evento] = [...doCliente, ...entradas];
  }
  return s;
}

/**
 * Lê (ou cria) o settings da ferramenta, mescla os hooks e grava.
 * @returns {{path:string, eventos:string[]}}
 */
export function installHooksInto(settingsPath, hooksDir) {
  let current = {};
  try { current = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { current = {}; }
  const merged = mergeHooks(current, hooksDir);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  return { path: settingsPath, eventos: Object.keys(buildHooks(hooksDir)) };
}
