---
description: Configura o QA-Gate num projeto (detecta stack, cria config, hook e seeder)
---

Configure o QA-Gate no repositório atual. Objetivo: zero config manual.

1. **Detecte o stack:**
   - `docker-compose*.yml` / `.env` → ache a porta local (baseUrl).
   - Framework: Laravel/Livewire (blade), Vue, etc → defina `uiGlobs`.
   - Ache a rota de login e os seletores de email/senha/submit.

2. **Crie `qa-gate.config.json`** na raiz com: `baseUrl`, `login`, `uiGlobs`, `ignoreFailedRequests`, e um `flows` inicial (peça ao usuário 1 fluxo de form pra começar, ou infira de rotas `*/create`).

3. **User QA (só local):** crie um seeder guardado por `app()->environment('local')` que faz `updateOrCreate` de um usuário de teste. Rode-o.

4. **Hook:** crie `.githooks/pre-commit` chamando o engine, e rode `git config core.hooksPath .githooks`.

5. **Licença:** instrua o usuário a exportar `QA_GATE_LICENSE` (compra em velososolution.online).

6. **Valide:** rode `qa_check_app` e um `qa_simulate` no fluxo criado. Mostre verde/vermelho.

Confirme cada passo com o usuário quando houver ambiguidade (rota de login, fluxo inicial).
