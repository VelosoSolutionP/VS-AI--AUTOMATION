# Changelog

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
