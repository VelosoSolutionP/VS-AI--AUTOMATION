---
description: Roda o QA-Gate no diff staged (simulacao em browser real antes do commit)
---

Rode o QA-Gate no repositório atual usando a tool MCP `qa_run_gate`.

1. Descubra a raiz do repo (`git rev-parse --show-toplevel`).
2. Chame `qa_run_gate` com `{ repo: "<raiz>" }`.
3. Se o status for `green` → diga que pode commitar.
4. Se `red` → mostre o screenshot retornado e os erros; NÃO commite; ajude a corrigir e rode de novo.
5. Se `skip` (backend puro) → informe e siga.
6. Se `error` (app fora do ar) → avise pra subir o ambiente local.

Nunca commite no vermelho.
