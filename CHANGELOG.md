# Changelog

## 1.1.1 — Governança: commit só no verde + teste unitário obrigatório + papéis genéricos (19/07/2026)

- **Commit bloqueado até VERDE (regra absoluta)**: quando o QA-Gate não roda por qualquer motivo (ambiente/Docker fora, serviço indisponível, dados ausentes), o commit fica **BLOQUEADO**. A IA é **delegada a resolver** o que impede o gate (subir ambiente, semear, rebuildar) e só commita no verde — **não existe commit liberado enquanto uma pessoa resolve**. Eliminado o texto que dava a entender que se podia commitar enquanto alguém resolvia o problema. Ajustes em `hooks/on-qa-gate.mjs`, `hooks/on-doc.mjs`, `mcp/server.mjs`, `catalog/messages.json` (VS-AUD-003), `catalog/README.md`, `MANUAL.md`, `README.md`, `commands/qa-gate.md`.
- **Fallback de impedimento**: se o bloqueio depender de **pessoas** ou de **regra de negócio** que a IA não resolve sozinha (após esgotar tentativas), o commit continua bloqueado e um **impedimento** é registrado na documentação de fechamento da tarefa, endereçado ao **tech lead ou gestor**.
- **Teste unitário obrigatório (camada EXTRA de qualidade, regra absoluta — `VS-AUD-004`)**: se a tarefa **tocou código de produção** (criou/alterou arquivo de código) em **backend, front ou mobile**, exige um **teste unitário válido correspondente** à mudança (cobre o que mudou, não placeholder). **Sem teste → commit BLOQUEADO**, no mesmo nível do "só commita no verde". É responsabilidade da **IA criar** o teste — mesmo que não tenha sido pedido no escopo/alvo. Vale pros 3 stacks (backend: PHPUnit/Pest; front: vitest/jest; mobile: flutter test), conforme o projeto. Novo código `VS-AUD-004` em `catalog/messages.json`; reforço em `hooks/on-qa-gate.mjs`, `hooks/on-commit.mjs`, `catalog/README.md`, `MANUAL.md`, `README.md`, `commands/qa-gate.md`.
- **Papéis genéricos (multi-empresa)**: textos de governança deixam de citar papéis internos ("analista", "QA", "dev/desenvolvedor") e passam a usar termos neutros ("o solicitante", "quem usa", "o time", "homologação"). Slug de autoria de branch (`fabiano.veloso`) e códigos `VS-*` preservados. Ajustes em `catalog/messages.json`, `catalog/fechamento.json`, `README.md`.

## 1.1.0 — Camada de governança

- **Requirements Validator** (`engine/requirements.mjs`): triagem determinística de requisito (VS-REQ-001..005); bloqueia tarefa mal-especificada antes de acionar a IA.
- **Escalation Engine**: decide `call_ai` — só escala pro modelo em causa raiz, arquitetura, segurança, performance ou bug.
- **Hooks**: `UserPromptSubmit` (triagem), `PreToolUse` git commit (gate de padrão + bloqueia assinatura de IA), `SessionStart` (contexto). `hooks/settings.example.json`.
- **Telemetria Tier 1** (`engine/metrics.mjs`): tempo economizado, redução de tokens, chamadas de IA evitadas, retrabalho, commits no padrão, ROI — agregado e anônimo. Dashboard executivo.
- **Consentimento LGPD** (`engine/consent.mjs`): coleta técnica só com aceite.
- **Catálogo de mensagens** (`catalog/`): famílias REQ/AI/AUD/OK/MON (14 mensagens `VS-*`).
- **MCP**: novas tools `qa_validate_task` e `qa_report`.
- **Qualidade**: suíte `node:test` (9 casos) + CI GitHub Actions.
- **Fix**: `catalog/` e `hooks/` incluídos no pacote npm (import quebrado corrigido).

## 1.0.0 — QA-Gate

- Simulação em browser real antes do commit (Playwright + Chrome do sistema).
- Plugin Claude Code + MCP server + engine + licenciamento offline (Ed25519).
- Backend de licenciamento (webhook Stripe → emite chave → WhatsApp).
