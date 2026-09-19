# VS-IA — instalação global, módulo DEV

Origem: https://github.com/VelosoSolutionP/VS-IA.git (recorte local, não é clone do repo).

## O que está ativo

| Peça | Onde |
|---|---|
| MCP `vs-ia-dev` (6 tools) | escopo **user** em `~/.claude.json` — vale em todas as sessões |
| Hooks de governança (10) | `~/.claude/settings.json` → `hooks` |
| Padrão de branch/commit/doc | `~/.qa-gate/company.json` |
| Slash commands | `~/.claude/commands/qa-gate.md`, `qa-init.md` |
| Código | `~/.vs-ia/{engine,hooks,mcp,catalog}` |

Tools MCP: `qa_validate_task`, `qa_check_app`, `qa_list_flows`, `qa_simulate`,
`qa_run_gate`, `qa_report`.

Hooks: `on-session`, `on-task`, `on-timebox-guard`, `on-commit`, `on-git-guard`,
`on-qa-gate`, `on-agent-guard`, `on-bg-guard`, `on-branch-first`, `on-doc`.

## O que foi DEIXADO DE FORA (e por quê)

1. **Licença / emissão de chave** — o backend/VPS que assinava e validava o token
   foi comprometido. `requireLicense()` sumiu do servidor: as tools rodam offline,
   sem bater em servidor nenhum. Não copiei `license/`, `installer/trial.mjs`,
   `engine/trial-lock.mjs` nem `installer/schedule-lock.mjs` — a trava de 7 dias
   não existe nesta instalação.
2. **Entrevista de onboarding** — `vs_interview` e `vs_apply_config` saíram. O que
   a entrevista preenchia foi escrito direto em `~/.qa-gate/company.json`.
3. **Outros módulos** — `vsqa`, `vsanalista`, `vsdiretoria` e `vsvendas` não foram
   instalados (dependem de tracker/chave/entrevista).

## Dependências

`~/.vs-ia/node_modules` tem só `@modelcontextprotocol/sdk` e `zod`.
**Playwright NÃO está aqui**: `engine/core.mjs` carrega por `await import('playwright')`
sob demanda, resolvido no node_modules do PROJETO. Em cada repo que for usar
`qa_simulate` / `qa_run_gate` com browser:

```bash
npm i -D playwright && npx playwright install chromium
```

## Quando a infra voltar

Para religar chave/entrevista, comparar com o repo original e repor
`license/`, `engine/interview/`, `installer/` e as chamadas `requireLicense()`.
Para religar os recibos (WhatsApp/Slack), editar `notify` em `~/.qa-gate/company.json`.

## Desinstalar

```bash
claude mcp remove vs-ia-dev -s user
# e remover o bloco "hooks" de ~/.claude/settings.json
rm -rf ~/.vs-ia ~/.qa-gate
```
