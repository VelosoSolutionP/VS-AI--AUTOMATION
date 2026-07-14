#!/usr/bin/env node
/**
 * Hook SessionStart — ancora o fluxo obrigatório do Fabiano no início da sessão.
 * Mantém o agente no trilho (não se perde no fluxo). Injeta contexto, não bloqueia.
 */
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: [
      '[FLUXO OBRIGATÓRIO — respeitar à risca]',
      '1) Branch da tarefa: git checkout -b fix|feat|perf|refactor/fabiano.veloso/<numero> a partir da origem (dev/hml/main). NUNCA trabalhar/commitar em main/dev/hml.',
      '2) Escopo: git add SÓ os arquivos da tarefa. `git add .` é PROIBIDO.',
      '3) Se tocou UI (blade/Livewire/JS/tsx/componente): QA-Gate em BROWSER real antes de commitar — injeta bug, exige mensagem amigável + console limpo. Só commita no VERDE.',
      '4) Backend puro: valida (php -l / sintaxe) + pint nos arquivos tocados. NÃO rodar suíte de testes automaticamente (só quando o Fabiano pedir); mas ESCREVER o teste é obrigatório.',
      '5) Commit: <tipo>(<módulo>): <descrição> — SEM número da tarefa no título, SEM assinatura de IA (nada de Co-Authored-By/Generated). NUNCA --no-verify.',
      '6) Push na mesma branch. Depois: documentação Redmine (Backend/Frontend conforme o que tocou).',
      'Requisito insuficiente? PARE e peça (VS-REQ). Ambiguidade de produto? PERGUNTE, não chute.',
    ].join('\n'),
  },
}));
process.exit(0);
