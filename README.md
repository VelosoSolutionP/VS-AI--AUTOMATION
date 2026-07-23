# QA-Gate

**Simulação em browser real antes de cada commit.** Injeta o bug, exige que o sistema responda com mensagem amigável no DOM real e console limpo. Só deixa commitar no verde.

> Teste unitário passa e a tela quebra mesmo assim — hidratação errada, lib JS que não subiu, mensagem de erro que não aparece no modal. QA-Gate fecha essa brecha exercendo o fluxo num Chrome de verdade, do jeito que o usuário faz.

Por [Veloso Solution](https://devpointinnovation.com.br/) — Consultoria em IA Aplicada.

📖 **[Manual de uso passo a passo → MANUAL.md](MANUAL.md)** · Status do produto → [STATUS.md](STATUS.md)

---

## Por que usar — plugin + MCP

**IA sozinha entrega ilusão. Orquestrada, entrega resultado.** O QA-Gate é a ponta visível de uma orquestração de IA aplicada ao seu processo de desenvolvimento.

**Vantagens do plugin**
- 🔒 **Governança automatizada** — commit, branch, teste e documentação no mesmo padrão em toda a equipe, sem depender de disciplina manual.
- 🧠 **Contexto preservado** — memory system carrega arquitetura, gotchas e feedback do seu negócio em cada sessão. Sem re-explicar tudo.
- ✅ **Qualidade no commit** — QA-Gate simula o fluxo em browser real e só libera no verde. Bug morre antes de chegar à homologação.
- 💸 **Custo previsível** — tokens são frações de centavos por operação; menos retrabalho, menos bug em produção.

**Vantagens do MCP**
- 🌐 Dirige um **navegador real** e devolve resultado estruturado + screenshot direto ao seu agente.
- 🔎 Pega **lib quebrada e hidratação errada** que o teste unitário deixa passar.
- 🔐 Validação de licença **offline** — seu código não sai da sua máquina.
- 🧩 Editor-agnóstico: Claude Code, Cursor, VS Code ou CI.

**Ganhos esperados — variam conforme a forma de uso**
- 📈 Melhorias expressivas — **de 20% a 70%** em tempo, custo e retrabalho, **dependendo de como a ferramenta é usada**.
- 🧪 Exemplo real: um caso de **N+1 pego em produção** teve forte redução de queries e latência depois da correção guiada pelo gate.
- ♻️ Menos reincidência em homologação e dívida técnica em queda.

> **Não prometemos número fixo.** O resultado real de cada cliente é **medido e comprovado na auditoria ao fim dos 30 dias** (entregue em mãos: processo, forma de uso e, havendo economia, o percentual com evidências). Quer o mesmo na sua squad? Fazemos **diagnóstico + setup + capacitação**: **[devpointinnovation.com.br](https://devpointinnovation.com.br/)**

---

## Camada de governança (Orquestrar IA)

Além do QA-Gate, o produto é uma **camada de governança executável** — o modelo só é acionado quando compensa, e cada etapa é auditada.

- **Triagem de requisito** (`engine/requirements.mjs` + hook `UserPromptSubmit`): tarefa mal-especificada é **bloqueada antes da IA entrar** (`VS-REQ-001`). Fail-open — papo normal passa. Economia de token real. **HU/spec rica** (objetivo + RF + critério de aceitação) é reconhecida como requisito **suficiente** (`VS-REQ-005`) e escala pro modelo — não fica cobrando campo. **Feature que cita "relatório/dashboard/página" NÃO é confundida com documentação** — doc só por intenção real (documentar/redmine/readme).
- **Escalation Engine**: decide `call_ai` — só escala pro modelo em causa raiz, arquitetura, segurança, performance ou bug. O resto trata local.
- **Gate de commit** (hook `PreToolUse`): bloqueia commit fora do padrão e assinatura de IA (`VS-AUD-003`).
- **Gate multi-alvo** (front/mobile): config `targets` (front=web, mobile=Flutter web). **Sem alvo → roda front E mobile**; `front`/`mobile` filtra. Mobile via Flutter web exige renderer HTML/semantics + seletores por role (camera não roda no web) — tuning à parte.
- **QA-Gate OBRIGATÓRIO** (`hooks/on-qa-gate.mjs`, regra absoluta): commit que toca UI **só passa com o gate browser VERDE**. Se o gate não rodar por qualquer motivo (app fora do ar, ambiente/Docker parado, dados ausentes), o **commit fica BLOQUEADO** — sem gate verde, sem commit; **não existe commit liberado enquanto uma pessoa resolve**. A IA é **delegada a resolver** o que impede o gate (sobe o ambiente, semeia, rebuilda) e só commita no verde. Requer o app em **modo dev/live** (o gate valida o código atual, não build antigo). Backend puro pula.
- **Teste unitário obrigatório — camada extra** (`VS-AUD-004`, regra absoluta): se a tarefa **tocou código de produção** (criou/alterou arquivo de código) em **backend, front ou mobile**, exige um **teste unitário válido correspondente** à mudança (cobre o que mudou, não placeholder). **Sem teste → commit BLOQUEADO**, no mesmo nível do "só commita no verde". É responsabilidade da **IA criar** o teste, mesmo que não tenha sido pedido no escopo/alvo — ela não commita código sem ele. Vale pros 3 stacks (backend: PHPUnit/Pest; front: vitest/jest; mobile: flutter test), conforme o projeto.
- **Git-guard** (`hooks/on-git-guard.mjs`): bloqueia `git add .` cego, `--no-verify`, commit/push em branch protegida (main/dev/hml) e criação de branch sem base `origin/<x>` (`VS-BRANCH-002`).
- **Trabalho no ambiente** (`VS-BRANCH-004`): ao criar nova branch, se a branch de tarefa atual tiver commit não enviado ou arquivo não commitado, **bloqueia** e força `git push -u origin <branch>` antes — não inicia tarefa nova deixando a anterior fora do ambiente. Só back/front (base protegida e mobile isentos).
- **Muro de tarefa** (`hooks/on-task.mjs`, `VS-BRANCH-001`): a IA fica **LIVRE** até você abrir tarefa com a palavra **`tarefa` + número** (ex.: `tarefa 36481`). Número solto (porta `:3333`, path, URL, hash), pergunta e desabafo **NÃO** abrem tarefa — evita falso-positivo. Aberta a tarefa, exige **5 campos NA ORDEM** (checklist ✅/❌, regra absoluta — sem todos não cria branch): **① número → ② tipo → ③ origem → ④ repositórios → ⑤ escopo**. `repositórios` = onde criar a branch (`front`/`back`/`mobile`/`todos`; `todos` cria a MESMA branch nos 3 repos). `escopo` = descrição da tarefa (entra no contexto da IA). A IA **ignora** no texto o que não for o campo pedido (ex.: origem só vale dev/hml/main).
- **Gate VERDE obrigatório no commit** (`VS-GATE-001`, regra absoluta): commit com **código de produção** (front/back) exige **recibo do QA-Gate VERDE** desta branch (`.git/qa-gate-green.json`, gravado pelo `qa_run_gate`), recente e posterior à última edição staged — senão **commit BLOQUEADO**. A IA não pula nem "opina" que não precisa; se o app não sobe, é responsabilidade dela subir/seed até verde. **Mobile isento** (gate browser inviável no Flutter — tratado à parte). Escape raro: `.qa-gate-green-ok`.
- **Regra mobile** (`VS-MOBILE-001/002`): mobile **não cria branch de tarefa** e **não faz push** — acumula commits locais; deploy (APK) só no fim do dia, a pedido. Override do push: `touch .qa-gate-mobile-ok`.
- **CRUD/validação → gate diagnostica** (`VS-CRUD`): bug de CRUD/validação (editar/cadastrar/salvar + erro/mensagem/campo) **não trava adivinhando camada** — o QA-Gate reproduz o fluxo (ex.: editar o paciente) e mostra o **erro real** (DOM/console/screenshot); a IA corrige com base nisso. Default front; `mobile` explícito respeitado.
- **Documentação obrigatória** (`hooks/on-doc.mjs`, `VS-DOC-001/002`): após o `git push`, marca pendência e exige a doc (Redmine) — fecha o fluxo atômico **branch → tarefa → gate → commit → push → DOC**. Doc pendente **bloqueia iniciar nova tarefa** até documentar.
- **Janela livre pós-push** (`VS-FREE-001`): depois do push a sessão fica **livre** pra perguntas, dúvidas e confirmações — o muro de tarefa **não engata** em papo normal. A próxima tarefa só re-arma o fluxo quando você mandar o **número** da tarefa, ou disser **"próxima/nova tarefa"** ou **"deploy feito"**. Elimina a brecha de não conseguir confirmar/tirar dúvida com a IA logo após entregar.
- **Report do gate** (`VS-AUD-002`): no verde, o gate **obriga o agente a informar** quais fluxos rodaram e por que passou (msg amigável no DOM, console SEVERE=0, zero request falho) — nada de commit calado.
- **Modo consulta/doc** (`VS-CONSULT-001`): `n`/`esc`/`doc`/`consulta` pula o fluxo de tarefa e libera a sessão só p/ **leitura e geração de documento** — **sem commit/push** (não abre tarefa). Doc que faz parte de uma tarefa (branch criada) sobe normal. Estado por `session_id`. Opt-out por pasta: `.qa-gate-off`.
- **Âncora de fluxo** (`hooks/on-egle-anchor.mjs`, `SessionStart`): injeta o passo-a-passo obrigatório (branch → escopo → QA-Gate → commit → push → doc) pro agente não se perder.
- **Fechamento & relatório de horas** (`catalog/fechamento.json`): checklist com campos obrigatórios (início/fim/almoço/dailys); monta o `.md` diário do git e o PDF mensal.
- **Revisão semanal** (`engine/weekly-review.mjs`): análise determinística (git 7 dias + auditoria de aderência) que sinaliza jornadas longas/churn — sem IA, custo ~0.
- **Telemetria Tier 1** (`engine/metrics.mjs`): tempo economizado, redução de tokens, chamadas de IA evitadas, retrabalho, commits no padrão, ROI — **agregado e anônimo** (LGPD).
- **Consentimento** (`engine/consent.mjs`): coleta técnica só com aceite. Sem consentimento, a governança segue; só a telemetria desativa.
- **Catálogo** (`catalog/`): protocolo executável — mensagens `VS-*` (REQ/AI/AUD/OK/MON) + boas práticas de branch (`branches.json`).

Tools MCP: `qa_validate_task` (triagem, livre), `qa_report` (dashboard executivo), `qa_check_app`, `qa_list_flows`, `qa_simulate` / `qa_run_gate` (QA-Gate). Hooks prontos em `hooks/` + `hooks/settings.example.json` (SessionStart + UserPromptSubmit + PreToolUse).

> Não vendemos Claude Code — vendemos a camada que o transforma em **processo empresarial auditável**.

## O que ele faz

- Sobe o fluxo tocado (form/modal) num **navegador real** (Playwright + Chrome do sistema).
- **Injeta o bug de propósito** (submit inválido/vazio) e exige **mensagem amigável visível**.
- Valida o happy-path (salva + feedback de sucesso).
- Exige **`console SEVERE = 0`** e **zero requisição falha** → pega lib quebrada e hidratação errada que o teste unitário deixa passar.
- **Backend puro** (sem tocar UI) pula o browser — custo zero.
- **Verde** → commita. **Vermelho** → bloqueia, salva screenshot da falha.

Funciona como **hook de pre-commit** (piso duro, inescapável) e como **MCP** (o Claude dirige o browser a qualquer momento e recebe o screenshot inline).

---

## Requisitos

- **Node 18+**
- **Google Chrome** instalado (usa o Chrome do sistema, não baixa chromium)
- App rodando **local com dados** (Docker de paridade ou `php artisan db:seed`)
- Uma **licença** (chave) — compre em [devpointinnovation.com.br](https://devpointinnovation.com.br/)

---

## Instalação

### Opção A — Plugin Claude Code (recomendado)

```bash
# no Claude Code
/plugin marketplace add VelosoSolutionP/OrquestrarQaGate
/plugin install qa-gate
```

Depois exporte sua licença e configure o projeto:

```bash
export QA_GATE_LICENSE="<sua-chave>"
# no Claude Code
/qa-init      # detecta o stack e cria config + hook + seeder
/qa-gate      # roda a simulação
```

### Opção B — CLI / hook (qualquer editor ou CI)

```bash
git clone https://github.com/VelosoSolutionP/OrquestrarQaGate.git qa-gate
cd qa-gate && npm install        # instala playwright LOCAL (não global)
```

No **seu projeto**, crie `qa-gate.config.json` (ver abaixo) e o hook:

```bash
# .githooks/pre-commit  (chama o engine)
node /caminho/para/qa-gate/qa-gate.mjs

git config core.hooksPath .githooks
export QA_GATE_LICENSE="<sua-chave>"
```

A partir daí, cada `git commit` roda o gate. Backend puro pula; UI tocada simula.

---

## Licença

QA-Gate exige uma chave válida (`QA_GATE_LICENSE`). A validação é **offline** (assinatura Ed25519) — não manda seu código pra lugar nenhum, não precisa de internet a cada run.

- Compre em **[devpointinnovation.com.br](https://devpointinnovation.com.br/)**.
- Você recebe um token. Exporte como `QA_GATE_LICENSE` (ou coloque no `.env` do CI).
- Sem chave válida, a simulação não roda.

---

## Configuração da empresa — `qa-gate.company.json`

Define o **padrão de branch/commit/documentação da sua empresa** — a governança lê daqui em vez de assumir um padrão fixo. **Sem este arquivo vale o DEFAULT embutido**, então quem não configurar não quebra. Resolução: `env QA_GATE_COMPANY_CONFIG` → `qa-gate.company.json` subindo a partir do repo → `~/.qa-gate/company.json` → default.

```json
{
  "autor": "nome.sobrenome",
  "branchPattern": "<tipo>/<autor>/<numero>",
  "commitScope": "numero",
  "commitScopeRegex": null,
  "tipos": ["fix", "feat", "perf", "refactor", "hotfix", "chore", "test", "docs"],
  "doc": { "template": "redmine", "required": true }
}
```

| Campo | O que faz |
|---|---|
| `autor` | Segmento de autor do nome da branch (ex.: `fix/nome.sobrenome/36846`). |
| `branchPattern` | Tokens `<tipo>` `<autor>` `<numero>` `<slug>`. Ex.: `<tipo>/<numero>` (Jira), `<tipo>/<autor>/<numero>`. |
| `commitScope` | `numero` (escopo = número da tarefa), `modulo` (escopo = módulo/contexto), `any` (livre). |
| `commitScopeRegex` | Sobrepõe `commitScope` com um regex próprio (ex.: `^[A-Z]+-\\d+$` p/ chave Jira). |
| `tipos` | Tipos de branch/commit aceitos. |
| `doc` | Template/obrigatoriedade da documentação de fechamento. |

O gate de commit (`VS-AUD-003`) e a criação de branch passam a **exigir** o padrão configurado — determinístico, não dá pra burlar. Modelo completo em `qa-gate.company.example.json`.

## Configuração do gate de browser — `qa-gate.config.json`

Colocado na raiz do seu projeto:

```json
{
  "baseUrl": "http://localhost:9080",
  "healthPath": "/login",
  "chromeChannel": "chrome",
  "shotDir": "./qa-shots",
  "blockOnUncovered": false,
  "sessionTtlMin": 25,
  "login": {
    "path": "/login",
    "email": "qa.gate@seu-dominio.local",
    "password": "SuaSenhaQA",
    "emailSel": "input[name=email]",
    "passSel": "input[name=password]",
    "submitSel": "form[action*=login] [type=submit]"
  },
  "uiGlobs": [
    "**/*.blade.php", "resources/views/**",
    "app/Http/Livewire/**", "app/Livewire/**",
    "resources/js/**", "public/js/**"
  ],
  "ignoreFailedRequests": ["favicon", "hot-update"],
  "flows": [
    {
      "name": "cliente-create",
      "watch": ["**cliente**", "**Cliente**"],
      "path": "/clientes/create",
      "submitText": "Salvar",
      "expectFriendlyError": true
    },
    {
      "name": "cliente-lista",
      "watch": ["**cliente**lista**", "**ClienteTable**"],
      "path": "/clientes",
      "mode": "read",
      "expectSelector": "table tbody tr",
      "expectMinCount": 1
    }
  ]
}
```

### Modos de fluxo

- **`form`** (default): injeta bug via submit vazio/inválido e exige **mensagem amigável** visível. Para formulários/modais.
- **`read`**: **sem submit** — carrega a rota e exige o **conteúdo renderizado** (`expectSelector`/`expectMinCount`/`expectText`) + console limpo + zero request falho. Para **listagem/visualização** (ex.: "pacientes não lista", parse quebrado, request 500 na tela). O modo `read` é inferido quando não há submit e há `expect*`.

| Campo | Papel |
|---|---|
| `baseUrl` | URL local do app |
| `login` | rota + seletores + credencial do usuário QA (seed, **só local**) |
| `uiGlobs` | o que conta como "tocou UI" (dispara o browser) |
| `flows[].watch` | globs de arquivos que disparam este fluxo |
| `flows[].path` | rota do form/modal/lista a exercer |
| `flows[].mode` | `form` (default) ou `read` (sem submit) |
| `flows[].submitText` / `submitSelector` | (form) como acionar o submit |
| `flows[].fill` | (form) preenche campos antes do submit — reproduz validação de negócio (ex.: email duplicado): `{"#email":"existente@x.com"}` |
| `flows[].expectFriendlyError` | (form) exige mensagem amigável ao submeter |
| `flows[].expectMessageText` | (form) exige que a msg amigável contenha esse texto (ex.: `"já cadastrado"`) |
| `flows[].expectSelector` / `expectMinCount` / `expectText` | (read) conteúdo que deve renderizar |
| `deps.dockerUp` | comando p/ subir o ambiente quando o app está fora do ar (ex.: `./docker/scripts/dev.sh up`) |
| `deps.seed` | comando p/ semear dados de QA — **idempotente**, NUNCA `migrate:fresh` (apaga dados) |
| `blockOnUncovered` | se `true`, bloqueia commit de UI sem fluxo mapeado |

### Gate mobile (Flutter) — `type: "flutter-test"`

Browser não dirige Flutter 3.44 (canvaskit/headless). O gate mobile roda **`flutter test`** (headless, sem emulador) — pega a classe de bug que volta no mobile: **contrato API↔model** (parse: `created_at:""`, `_JsonMap is not a subtype of List`, null em não-nulo) e **widget** (tela + mensagem amigável).

```json
"targets": {
  "mobile": {
    "type": "flutter-test",
    "testCmd": "flutter test test/contract test/widget",
    "testCwd": "C:/.../mobile",
    "watch": ["lib/**"],
    "deps": { "dockerUp": "...", "seed": "..." }
  }
}
```

- Roda só quando o commit mexe em `.dart`. Vermelho (teste falhou) → **bloqueia commit**.
- **Sem teste cobrindo** → `needs: flutter-test-missing` → a IA escreve o teste que reproduz a correção (contract: joga a resposta REAL da API no `fromJson` do model; widget: pumpa a tela e exige msg/lista) antes de commitar.
- `integration_test`/`patrol` no emulador = só bug de interação real (opt-in, pesado).

### Auto-resolução (a IA resolve até o gate rodar)

Se o gate não conseguir validar, ele **bloqueia o commit** e devolve `needs[]` com o que falta — e a IA **resolve sozinha** até rodar verde, só então commita:

- **Docker/app parado** → roda `deps.dockerUp`, espera subir.
- **Falta dados** → roda `deps.seed` (idempotente de QA).
- **Lib faltando** → `npm i -D playwright` + `npx playwright install chromium`.
- **Flow faltando** → adiciona flow (`form`/`read`) cobrindo a rota tocada.
- **Seletor/rota errado** → ajusta o config.

É **opt-in por config**: sem `deps`/`start`, o gate não mexe no seu Docker; com `deps` declarado, a IA cuida do ambiente pra fechar o gate. Em qualquer caso, a regra é **absoluta**: enquanto o gate não estiver verde o **commit fica bloqueado** — não há commit liberado enquanto alguém resolve o problema, e a IA é delegada a resolver até rodar verde.

Se, mesmo depois de esgotar as tentativas, o bloqueio depender de **pessoas** ou de uma **regra de negócio** que a IA não resolve sozinha, o commit **continua bloqueado** e a IA registra um **impedimento** na documentação de fechamento da tarefa, endereçado ao **tech lead ou gestor**.

**Usuário QA:** crie um seeder guardado por ambiente (`app()->environment('local')`) — **nunca** semeie em homolog/produção.

---

## Comandos (plugin)

| Comando | O que faz |
|---|---|
| `/qa-init` | Detecta o stack e cria `qa-gate.config.json`, hook e seeder |
| `/qa-gate` | Roda o gate no diff staged e mostra verde/vermelho + screenshot |

## Tools (MCP)

| Tool | O que faz |
|---|---|
| `qa_check_app` | App local está no ar? |
| `qa_list_flows` | Lista os fluxos configurados |
| `qa_simulate` | Simula UM fluxo (injeta bug) e devolve status + screenshot inline |
| `qa_run_gate` | Gate completo a partir do diff staged (igual ao pre-commit) |

---

## Como funciona por dentro

```
git commit
   │
   ▼
diff staged → tocou UI? ── não ──► pula browser ✔ (backend puro)
   │ sim
   ▼
app no ar? ── não ──► bloqueia (suba o ambiente)
   │ sim
   ▼
Chrome real: login → abre fluxo → injeta bug (submit vazio)
   │
   ▼
mensagem amigável visível? + console SEVERE=0 + zero request falho?
   ├─ sim → VERDE ✔ commita
   └─ não → VERMELHO ✖ bloqueia + screenshot da falha
```

---

## Emergência

`git commit --no-verify` burla o gate. Use só em emergência real.

---

© Veloso Solution. Uso mediante licença.
