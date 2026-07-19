---
description: Roda o QA-Gate no diff staged (simulacao em browser real antes do commit)
---

Rode o QA-Gate no repositório atual usando a tool MCP `qa_run_gate`.

1. Descubra a raiz do repo (`git rev-parse --show-toplevel`).
2. Chame `qa_run_gate` com `{ repo: "<raiz>" }`.
3. Se o status for `green` → diga que pode commitar.
4. Se `red` → mostre o screenshot retornado e os erros; NÃO commite; ajude a corrigir e rode de novo.
5. Se `skip` (backend puro) → informe e siga.
6. Se `error` (app fora do ar / ambiente parado) → NÃO commite; você (a IA) resolve: suba o ambiente local, semeie dados, rebuilde e rode de novo até ficar verde. Só registre um impedimento (endereçado ao tech lead ou gestor) se o bloqueio depender de pessoas ou de regra de negócio depois de esgotar as tentativas — mesmo assim, sem verde, sem commit.

Camada extra (`VS-AUD-004`, regra absoluta): se a tarefa tocou código de produção (back/front/mobile), confirme que existe um teste unitário válido correspondente à mudança (cobre o que mudou, não placeholder). Sem teste → commit bloqueado, no mesmo nível do "só commita no verde". Se faltar, você (a IA) escreve o teste antes de commitar, mesmo que não tenha sido pedido no escopo/alvo.

Nunca commite no vermelho, sem o gate verde, nem sem o teste unitário correspondente.
