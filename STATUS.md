# QA-Gate / Orquestrar IA — Status do Produto

Visão do que existe, o que está **funcional** (provado), o que está **em andamento** e as **melhorias** a fazer. Documento interno (IP Veloso Solution).

---

## 1. Arquitetura

- **MCP server** (`mcp/server.mjs`) — camada interativa: o modelo dirige o gate a qualquer momento e recebe resultado estruturado + screenshot inline. Tools licenciadas via Ed25519 offline.
- **Hooks / plugin** (`hooks/*.mjs`) — governança determinística no Claude Code (o agente não ignora; o hook bloqueia de fato).
- **Engine** (`engine/*.mjs`) — lógica compartilhada por MCP, hooks e testes.
- **Catálogo** (`catalog/messages.json`) — mensagens/códigos `VS-*`.

---

## 2. MCP — Tools

| Tool | Função | Licença | Estado |
|---|---|---|---|
| `qa_validate_task` | Triagem de requisito antes da IA (VS-REQ) + escalar modelo | livre | ✅ funcional |
| `qa_check_app` | App local no ar? | livre | ✅ funcional |
| `qa_list_flows` | Lista flows do config | livre | ✅ funcional |
| `qa_simulate` | Simula 1 fluxo em browser real (front/mobile), modo form/read, `fill`, `expectMessageText` | licenciada | ✅ funcional (front) |
| `qa_run_gate` | Gate completo do diff staged, multi-alvo, reporta `needs` | licenciada | ✅ funcional (front) |
| `qa_report` | Dashboard executivo anônimo (tempo/token/ROI) | licenciada | 🟡 implementado, sem dados reais |

---

## 3. Plugin — Hooks (governança)

| Hook | Evento | Faz | Estado |
|---|---|---|---|
| `on-session` | SessionStart | Injeta contexto da governança | ✅ |
| `on-task` | UserPromptSubmit | Muro de tarefa, triagem, janela livre, opt-out por sessão | ✅ |
| `on-git-guard` | PreToolUse (Bash) | Bloqueia `git add .`, branch sem origem/número, push em protegida, mobile no-push | ✅ |
| `on-qa-gate` | PreToolUse (commit) | Gate browser obrigatório; auto-diagnóstico (`needs`) | ✅ (front) |
| `on-doc` | PostToolUse (push) | Documentação obrigatória + abre janela livre | ✅ |
| `on-commit` | PreToolUse (commit) | Padrão de mensagem de commit | ✅ |
| `on-egle-anchor` | SessionStart | Âncora de fluxo específica do Egle | ✅ |

### Regras (códigos `VS-*`)
- **REQ-001..005** — triagem de requisito; HU/spec rica = suficiente (não cobra campo).
- **BRANCH-001** — abre tarefa só com `tarefa` + número (ignora porta/path/URL/pergunta/desabafo).
- **BRANCH-002** — branch a partir de `origin/<origem>` explícita.
- **BRANCH-004** — não cria branch nova com trabalho anterior fora do ambiente (push pendente).
- **BRANCH-005** — número obrigatório no nome da branch.
- **DOC-001/002** — doc obrigatória pós-push; bloqueia nova tarefa com doc pendente.
- **FREE-001** — janela livre pós-push (não pede tarefa até `tarefa <n>`/"deploy feito").
- **CONSULT-001** — modo consulta/doc (sem commit/push).
- **MOBILE-001/002** — mobile não cria branch de tarefa nem faz push (acumula local).
- **ALVO / CRUD** — alvo (front/mobile/back) direciona; bug CRUD chama o gate direto.
- **AUD-001/002/003** — gate obrigatório; verde reporta o que rodou; sem gate verde não commita.
- **Opt-out por sessão** — bancada de conserto não acorda governança em projeto governado.

---

## 4. Engine — Capacidades

| Recurso | Estado |
|---|---|
| `runGate` multi-alvo (front browser + mobile flutter-test) | ✅ |
| `simulateFlows` — login cacheado, console SEVERE=0, requests falhos, screenshot JPEG | ✅ |
| Modo `form` (injeta bug → exige msg amigável) e `read` (lista → exige render) | ✅ |
| `fill` (preenche campos) + `expectMessageText` (ex.: "já cadastrado") | ✅ |
| `ensureUp` — sobe o app se estiver fora (Flutter/dev server) | ✅ |
| **Auto-diagnóstico `needs`** — flow faltando / playwright / app-up / seletor / flutter / teste faltando | ✅ |
| **Auto-resolução por config** (`deps.dockerUp`, `deps.seed`) | 🟡 implementado, não provado e2e |
| Alvo `disabled` fora do fluxo default | ✅ |
| `runFlutterTest` (gate mobile headless) | ✅ |
| Requisito reconhece HU rica | ✅ |

---

## 5. Testes já feitos (provados nesta bancada)

### ✅ Funcional (provado)
- **Gate front (browser)**: login real + acessa tela + console limpo → **VERDE** (Egle `medico@egle.local`).
- **Muro de tarefa**: só `tarefa`+número engata; porta `:3333`/path/URL/pergunta/desabafo → **livre** (testado e2e).
- **Opt-out por sessão**: bancada não dispara governança dentro de projeto governado.
- **Auto-diagnóstico**: config sem flow → `blocked` + `needs:flow`; app fora → `needs:app-up`.
- **fill + expectMessageText**: reproduz email duplicado com msg amigável.
- **Gate mobile widget/contract** (`flutter test`, headless): 166 testes Egle → **All tests passed** (parse/contrato/lógica).
- **Regressões travadas**: `me_model_privacy_test`, `api_endpoints_paths_test`, `register_page_test` (CT003).

### 🟡 Em andamento / bloqueado
- **Gate mobile e2e (`integration_test` no emulador)** — emulador **não boota nesta máquina** (nested-virt/RDP). Fica pra **CI (GitHub Actions android-emulator-runner)** ou **device USB**.
- **Gate mobile por browser** — **inviável** (Flutter 3.44 = canvaskit, não renderiza headless). Descartado.
- **Auto-resolução `deps`** (dockerUp/seed) — implementada, falta provar e2e.
- **`qa_report` / telemetria / weekly-review** — implementados, sem dados de produção.
- **Licenciamento Stripe** — falta ativar (sk_/price/whsec).
- **npm `@velososolution/qa-gate` 1.1.0** — falta republicar (token).

---

## 6. Melhorias a fazer

1. **CI mobile e2e** — pipeline GitHub Actions com emulador (roda `integration_test` onde a máquina local não deixa).
2. **Auto-resolução e2e** — validar `deps.dockerUp`/`seed` de ponta a ponta (subir Docker + seed → gate verde).
3. **Opt-out por sessão via comando** — hoje é flag em tmpdir; expor `/qa-gate off` amigável.
4. **VS-BRANCH-003 no catálogo** — usado no hook, falta a entrada no `messages.json`.
5. **Catálogo de mensagens amigáveis** (roadmap v2) — biblioteca de mensagens de erro padronizadas.
6. **IA sob demanda + consentimento LGPD** (roadmap v2) — coleta anônima consentida, relatório de aderência.
7. **Report executivo com dados reais** — ligar telemetria consentida ao `qa_report` pra propaganda/ROI.
8. **Suíte de testes do próprio produto** — expandir `tests/engine.test.mjs` cobrindo `needs`, `targetsFor`, `parseBranch`.

---

## 7. Aprendizado-chave da bancada (15/07)

- A instabilidade "tente novamente/convite indisponível" no mobile **não era o app** — era o backend **`.dev` com deploy parcial** (login alterna 200/404, ~metade das instâncias podres). Evidência: `QA/evidencia-dev-intermitente.txt`. Ambiente **`.app` (HML)** é estável.
- Bugs recorrentes de mobile são **contrato API↔model** (parse) — pegos pelo **gate widget/contract** (headless, roda em qualquer lugar), não precisam de emulador.
