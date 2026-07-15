# QA-Gate / Orquestrar IA — Manual de Uso (passo a passo)

Governança determinística + QA-Gate em browser real para Claude Code. Este manual cobre **instalação, configuração e uso** de ponta a ponta.

> Visão geral e status: ver [README.md](README.md) e [STATUS.md](STATUS.md).

---

## 1. O que faz (resumo)

- **Muro de tarefa** — só abre tarefa com `tarefa <número> <tipo> <origem> <alvo>`.
- **QA-Gate** — antes de cada commit que toca UI, simula o fluxo em **browser real** (Playwright + Chrome do sistema): injeta bug → exige mensagem amigável, console limpo, zero request falho. **Vermelho não commita.**
- **Gate mobile** — `flutter test` (widget/contract) headless.
- **Fluxo fechado** — branch → tarefa → gate → commit → push → **doc obrigatória**.
- **Controle de horas** — `fechamento` coleta início/fim/almoço/dailys e monta o arquivo do mês.
- **MCP** — 6 tools pro modelo dirigir o gate quando quiser.

---

## 2. Pré-requisitos

- **Node 18+** e **Claude Code**.
- **Google Chrome** instalado (o gate usa o Chrome do sistema, não baixa chromium).
- **Playwright** (instalado local no passo abaixo, não global).
- Para gate mobile: **Flutter SDK** no PATH.
- App local rodando com dados (Docker de paridade recomendado).

---

## 3. Instalação (passo a passo)

### 3.1 Clonar / instalar
```bash
git clone https://github.com/VelosoSolutionP/OrquestrarQaGate.git qa-gate
cd qa-gate
npm install                 # instala playwright LOCAL
npx playwright install chromium   # opcional; o padrão usa o Chrome do sistema
```

### 3.2 Registrar os hooks (governança)
Copie o bloco de `hooks/settings.example.json` para **`~/.claude/settings.json`** (global, vale em todos os projetos) **ou** `.claude/settings.json` do projeto. Ajuste o **caminho absoluto** da pasta `qa-gate`:

```json
{
  "hooks": {
    "SessionStart":     [ { "hooks": [ { "type": "command", "command": "node <CAMINHO>/qa-gate/hooks/on-session.mjs" } ] } ],
    "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "node <CAMINHO>/qa-gate/hooks/on-task.mjs" } ] } ],
    "PreToolUse":  [ { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "node <CAMINHO>/qa-gate/hooks/on-commit.mjs" },
        { "type": "command", "command": "node <CAMINHO>/qa-gate/hooks/on-git-guard.mjs" },
        { "type": "command", "command": "node <CAMINHO>/qa-gate/hooks/on-qa-gate.mjs" } ] } ],
    "PostToolUse": [ { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "node <CAMINHO>/qa-gate/hooks/on-doc.mjs" } ] } ]
  }
}
```
> **Reinicie o Claude Code** — hooks carregam no início da sessão.

### 3.3 Registrar o MCP (opcional, pra dirigir o gate manualmente)
Adicione em `~/.claude.json` (ou `.mcp.json` do projeto):
```json
{ "mcpServers": { "qa-gate": { "command": "node", "args": ["<CAMINHO>/qa-gate/mcp/server.mjs"] } } }
```
Confirme com `/mcp` no Claude Code (deve listar `qa-gate`).

---

## 4. Configuração — `qa-gate.config.json`

Crie na raiz do projeto (ou na pasta do front). Exemplo multi-alvo (front browser + mobile flutter):

```json
{
  "healthPath": "/login",
  "chromeChannel": "chrome",
  "shotDir": "C:/.../QA",
  "uiGlobs": ["src/app/**", "**/*.tsx", "lib/**", "**/*.dart"],
  "ignoreFailedRequests": ["favicon", "_next/", "hot-update", "\\.map$"],
  "deps": {
    "dockerUp": "./docker/scripts/dev.sh up",
    "seed": "docker exec app php artisan db:seed --class=QaSeeder"
  },
  "targets": {
    "front": {
      "baseUrl": "http://localhost:3000",
      "start": "npm run dev",
      "startCwd": "C:/.../frontend",
      "login": { "path": "/login", "email": "qa@local", "password": "senha",
                 "emailSel": "#email", "passSel": "#password", "submitSel": "button[type=submit]", "waitMs": 3500 },
      "flows": [
        { "name": "paciente-novo", "watch": ["**pacientes/novo**"], "path": "/pacientes/novo",
          "submitText": "Cadastrar", "expectFriendlyError": true },
        { "name": "paciente-lista", "watch": ["**PatientsList**"], "path": "/pacientes",
          "mode": "read", "expectSelector": "table tbody tr", "expectMinCount": 1 },
        { "name": "email-duplicado", "watch": ["**cadastro**"], "path": "/pacientes/novo",
          "fill": { "#email": "existente@x.com", "#nome": "Teste" }, "submitText": "Salvar",
          "expectFriendlyError": true, "expectMessageText": "já cadastrado" }
      ]
    },
    "mobile": {
      "type": "flutter-test",
      "testCmd": "flutter test test/contract test/widget",
      "testCwd": "C:/.../mobile",
      "watch": ["lib/**", "**/*.dart"]
    }
  }
}
```

| Campo | Papel |
|---|---|
| `login` | rota + seletores + credencial do usuário QA (seed, **só local**) |
| `flows[].watch` | globs que disparam o flow |
| `flows[].mode` | `form` (default: injeta bug + msg amigável) ou `read` (lista: exige render) |
| `flows[].fill` | (form) preenche campos antes do submit — reproduz validação de negócio |
| `flows[].expectMessageText` | (form) exige texto na msg amigável (ex.: "já cadastrado") |
| `deps.dockerUp` / `deps.seed` | comandos que a IA roda pra subir/semear quando o app está fora |
| `targets.mobile.type: flutter-test` | gate mobile via `flutter test` (headless) |

---

## 5. Uso — fluxo completo (passo a passo)

### Passo 1 — Abrir a tarefa
Digite **`tarefa <número> <tipo> <origem> <alvo>`**. Ex.:
```
tarefa 36481 fix dev front
```
- **tipo:** fix | feat | refactor | perf | hotfix | chore | test | docs
- **origem:** dev | hml | main
- **alvo:** front | mobile | back
- Faltou algum? O muro mostra checklist ✅/❌ e pede o que falta. (Sair: `cancela`.)
- Número solto (porta, path), pergunta ou desabafo **não** abrem tarefa.

### Passo 2 — Criar a branch
A governança injeta o comando:
```bash
git fetch origin dev && git checkout -b fix/fabiano.veloso/36481 origin/dev
```
- Sem `origin/<origem>` → bloqueia (VS-BRANCH-002).
- Nome sem número → bloqueia (VS-BRANCH-005).
- Mobile **não** cria branch de tarefa (acumula local).

### Passo 3 — Desenvolver + gate
Trabalhe normal. Ao **commitar**, o `on-qa-gate` roda o QA-Gate:
- **Backend puro** (sem UI staged) → pula browser, libera.
- **Tocou UI** → sobe o app (se tiver `start`/`deps`), loga, simula os flows.
- **Verde** → informa o que rodou e libera o commit.
- **Vermelho** → bloqueia + screenshot em `shotDir`. Arruma e re-tenta.
- **Faltou algo** (`needs`) → a IA resolve (ver §7) e re-tenta.

### Passo 4 — Commit
```bash
git add <arquivos-da-tarefa>     # git add . é bloqueado
git commit -m "fix(modulo): descricao breve"
```
- `--no-verify` é bloqueado. Commit em branch protegida (main/dev/hml) é bloqueado.

### Passo 5 — Push
```bash
git push -u origin fix/fabiano.veloso/36481
```

### Passo 6 — Documentação (obrigatória)
Após o push, o `on-doc` exige a doc Redmine (template Backend/Frontend). **Não inicia nova tarefa** com doc pendente. Ao concluir:
```bash
rm .git/qa-gate-pending-doc
```

### Passo 7 — Janela livre
Depois do push a sessão fica **livre** pra perguntas/dúvidas. Nova tarefa só re-arma com `tarefa <número>` (ou "próxima tarefa" / "deploy feito").

---

## 6. Controle de horas — fechar o dia
Digite **`fechamento`** (ou "fechar o dia" / "controle de horas"). A IA pergunta, nesta ordem:
1. **Início** · 2. **Fim** · 3. **Almoço** (horário/duração ou "não teve") · 4. **Dailys** (teve/não)

Com as 4 respostas, monta sozinho o registro em `ControleHoras/<YYYY-MM>.md` (horas líquidas = (fim − início) − almoço) e descreve a atividade pelo git log do dia. *(Fechamento de tarefa é durante o trabalho, via gate/commit — não pela palavra "fechamento".)*

---

## 7. Gate — como funciona

### Front (browser)
`qa_run_gate` / commit → sobe o app → login cacheado → por flow:
- **form:** clica submit (vazio ou `fill`) → exige `.invalid-feedback`/`.alert-danger`/toast visível (+ `expectMessageText` se definido).
- **read:** carrega a rota → exige `expectSelector`/`expectMinCount`/`expectText`.
- Sempre: **console SEVERE = 0** e **zero request falho**. Screenshot JPEG.

### Mobile (`flutter test`)
`type: flutter-test` → roda `flutter test` (headless, sem emulador). Verde = "All tests passed"; vermelho bloqueia. Cobre contrato API↔model (parse) e widget.
> E2E real (`integration_test` no emulador) roda em **CI** ou **device USB** — não headless comum.

### Auto-diagnóstico (`needs`) — a IA resolve
Se o gate não rodou, ele diz o que falta e a IA resolve **até rodar verde**:
- **flow faltando** → adiciona flow (form/read) no config.
- **playwright** → `npm i -D playwright` + `npx playwright install chromium`.
- **app-up** → roda `deps.dockerUp` / sobe o app; se faltar dado, `deps.seed`.
- **flutter / teste faltando** → escreve o teste da correção.

---

## 8. Modos e escapes

- **Consulta/DOC:** digite `doc`/`consulta`/`n` → sessão só pra leitura/documento, **sem commit/push**.
- **Opt-out por pasta:** crie `.qa-gate-off` na raiz → desliga a governança naquela pasta (bancada de conserto).
- **Opt-out por sessão:** flag em tmpdir (`qa-gate-off-session-<sid>`) → desliga só naquela sessão, mesmo em projeto governado.

---

## 9. MCP — tools

| Tool | Uso |
|---|---|
| `qa_validate_task` | Triagem de requisito antes da IA (retorna VS-REQ + se escala o modelo). |
| `qa_check_app` | App local no ar? (`baseUrl`, `healthPath`) |
| `qa_list_flows` | Lista os flows do config. |
| `qa_simulate` | Simula 1 fluxo em browser. Params: `configPath`, `path`, `alvo` (front/mobile), `mode`, `fill`, `expectMessageText`, `expectSelector`, `expectMinCount`. |
| `qa_run_gate` | Gate completo do diff staged (igual pre-commit). |
| `qa_report` | Dashboard executivo anônimo (tempo/token/ROI). |

---

## 10. Referência — códigos `VS-*`

- **REQ-001..005** — triagem de requisito (001 bloqueia; 005 = suficiente; HU rica = 005).
- **BRANCH-001** — abre tarefa só com `tarefa`+número. **002** — origem explícita. **004** — trabalho anterior não enviado. **005** — número no nome da branch.
- **AUD-002/003** — gate verde reporta / sem gate verde não commita.
- **DOC-001/002** — doc obrigatória pós-push / bloqueia nova tarefa com doc pendente.
- **FREE-001** — janela livre pós-push.
- **CONSULT-001** — modo consulta (sem commit/push).
- **MOBILE-001/002** — mobile não pusha / não cria branch de tarefa.
- **ALVO / CRUD** — alvo direciona a camada; bug CRUD chama o gate direto.

---

## 11. Troubleshooting

| Sintoma | Causa / solução |
|---|---|
| Governança não dispara | Hooks carregam no **início da sessão** — reinicie o Claude Code. |
| `/mcp` não mostra qa-gate | Confira `~/.claude.json` + reinicie. |
| Gate "não rodou" | Veja `needs` (§7): flow/playwright/app-up. A IA resolve. |
| "Vite manifest / Unable to locate" | `npm run build` / `npm run dev` no front. |
| Screenshot preto | Já resolvido — usa JPEG (PNG com alpha some em viewers Windows). |
| Pede tarefa em papo | Só `tarefa`+número abre; se ainda incomodar, use opt-out por sessão/pasta. |
