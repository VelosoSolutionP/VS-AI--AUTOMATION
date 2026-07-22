# Changelog

## 1.6.0 — Fix falso-positivo de tarefa + regra de impedimento paliativo (21/07/2026)

- **FIX falso-positivo (on-task.mjs)**: mensagem de conversa/pushback fechava tarefa fantasma. Ex.: "nao me trava em" era capturada como ESCOPO e completava uma tarefa #100 travada. Agora: (a) `isMeta` — pushback/meta ("não me trava", "no mcp", "na ferramenta", "nessa sessão", "governança"…) com tarefa pendente **ABORTA** o pending (não vira campo/escopo); (b) captura de escopo só de mensagem descritiva (nunca pergunta/meta); (c) escopo LONGO agora é capturado corretamente quando se espera o escopo (`coreReadyBefore`) — antes a regra de "conversa longa" derrubava escopos grandes.
- **Regra IMPEDIMENTO (on-session)**: bloqueio por dependência de INFRA (devops/deploy/ambiente flaky/não-confiável) — antes de escalar, a IA busca um **paliativo CONFIÁVEL que desacople da infra** (fallback defensivo, boundary mockado, feature flag, retry/timeout, caminho alternativo), desde que CORRETO, REVERSÍVEL e sem esconder bug de código nem mudar comportamento de negócio. Achou → aplica, DOCUMENTA o paliativo + a dívida de infra e roda o gate de novo; mudou produto/arriscado → pergunta antes; sem paliativo → reporta impedimento. BUG de código = fix na causa raiz, nunca paliativo.

## 1.5.0 — Gate mobile (device real via USB) + regra de colaboracao dev (21/07/2026)

- **Gate mobile Flutter (`mobile/run-mobile-gate.mjs`, novo)**: prova de funcional no APARELHO REAL via adb/USB — fecha a lacuna do gate de browser (inviavel no Flutter) e do emulador. 3 camadas: flutter analyze -> flutter build apk --release (pega quebra release-only: R8/proguard/obfuscacao) -> integration_test rodando NO DEVICE (runtime real: Reverb/websocket, permissao, camera, path, render). Grava recibo `.git/qa-gate-green-mobile.json`. Sem device = AMARELO; falha no device = VERMELHO.
- **Regra COLABORACAO DEV (on-session)**: tarefa simples arrastando (mudanca componente-a-componente quando ha solucao sistemica; muitas iteracoes sem convergir; tempo alto no mesmo ponto) -> a IA PARA e PERGUNTA ao dev (que conhece o projeto) se ha abordagem melhor, antes de seguir. Se o dev indicar caminho, avalia e adota se fizer sentido.

## 1.4.0 — Anti-desperdício de agentes + governança não engata em notificação de harness (21/07/2026)

- **AGENT GUARD (`hooks/on-agent-guard.mjs`, novo — VS-AGENT-001)**: barra o disparo de SUBAGENTE (tool `Task`) pra investigar/corrigir. A ferramenta é pra REDUZIR token — abrir agentes pra investigar alvo já especificado é desperdício. Regra: alvo dado → pesquisa direto (Serena/grep/read); alvo não claro → PERGUNTA. Escape p/ feature extensa real: `.qa-gate-agents-ok` ou `"allowAgents": true` no `qa-gate.company.json`. Registrar em `PreToolUse` matcher `Task`.
- **`on-task.mjs` ignora mensagens do HARNESS**: `<task-notification>` (resultado de agente), `<system-reminder>`, saída de comando local etc. não engatam mais a governança — antes o resultado de um agente era tratado como prompt de tarefa e pedia ESCOPO/branch em cima da notificação.
- **`allowAgents: false`** no default da config de empresa.
- **FIX de registro (settings do usuário)**: `on-git-guard.mjs` (VS-GATE-001/VS-BRANCH/VS-MOBILE) não estava registrado no `PreToolUse` — o gate de commit "era ignorado" porque o hook nunca rodava. Passa a ser registrado junto do `on-commit.mjs`.

## 1.3.0 — Config de EMPRESA: padrão de branch/commit configurável no install (21/07/2026)

- **`engine/company-config.mjs` (novo)**: a empresa define seu padrão de branch/commit/doc num `qa-gate.company.json` — a governança lê daqui em vez de assumir um padrão fixo. Resolução: `env QA_GATE_COMPANY_CONFIG` → arquivo subindo a partir do repo → `~/.qa-gate/company.json` → **DEFAULT embutido** (padrão Fabiano: autor `fabiano.veloso`, escopo = número). Quem não configurar não quebra.
- **Campos**: `autor` (slug da branch), `branchPattern` (tokens `<tipo>/<autor>/<numero>/<slug>`), `commitScope` (`numero`|`modulo`|`any`), `commitScopeRegex` (ex.: chave Jira `^[A-Z]+-\d+$`), `tipos`, `doc`.
- **Hooks passam a ler a config (fim do hardcode `fabiano.veloso`)**: `on-git-guard.mjs` (nome/pattern/detecção de branch, bug-voltou, VS-BRANCH-002/005/006, VS-GIT-002/003 via `branchName`/`branchRegex`/`branchGlobsForNumber`/`patternUsesNumero`), `on-commit.mjs` (escopo do commit via `checkCommitScope`), `on-task.mjs` (nome da branch e instrução de commit conforme a empresa).
- **Docs**: `qa-gate.company.example.json` + seção no README. Testes: +3 casos (default Fabiano, escopo por módulo, pattern sem autor + regex Jira) — 16/16 verde.

## 1.2.1 — Escopo do commit = NÚMERO da tarefa (todos os projetos) (21/07/2026)

- **Commit `<tipo>(<numero>): <descrição>` obrigatório (`on-commit.mjs`, `on-task.mjs`)**: o escopo do commit passa a ser SEMPRE o **número da tarefa** (ex.: `feat(36846): termo de consentimento único`), não o módulo. Determinístico: quando há tarefa ativa (`getTask`), o `on-commit` **bloqueia** (VS-AUD-003) qualquer escopo diferente do número e mostra a correção. O ctx da tarefa (`on-task`) já instrui o formato com o número. Módulo/contexto vai na descrição. Decisão do Fabiano em 21/07 valendo pra TODOS os projetos (Velvet, sigater, Egle).

## 1.2.0 — Multi-repo, mobile acumulando e fecho do furo do gate (cd) (21/07/2026)

- **Repositórios MULTI-escolha (`branch-req.mjs`, `on-task.mjs`)**: a criação de tarefa passa a aceitar combinação de repos — `front back`, `back mobile` etc. — e cria a branch em **cada um** escolhido. `todos` = front+back+mobile. Campo `repositorios` virou **lista** canônica `[front, back, mobile]`. Novo `canonTargets()` (multi) ao lado do `canonTarget()` (único, usado pelo `alvo`).
- **Mobile ACUMULA da branch atual (`on-task.mjs`, `on-git-guard.mjs`)**: corrigida a contradição — antes o `on-task` mandava criar a branch mobile a partir de `origin/<origem>` (resetava e **perdia o acúmulo**) enquanto o `git-guard` **bloqueava** qualquer branch no mobile (VS-MOBILE-002). Agora o mobile cria a branch nova **a partir da branch ATUAL** (`git checkout -b <branch>`, sem `origin/`), carregando o trabalho anterior; commits locais, sem push até o deploy. `VS-MOBILE-002` passou a bloquear o **uso de `origin/`** no mobile; `VS-BRANCH-002` (exige `origin/`) agora **isenta** o mobile.
- **Escopo é TEXTO LIVRE, sem travar em palavra (`on-task.mjs`)**: com os 4 campos core (número/tipo/origem/repositórios) já preenchidos, a **próxima mensagem é o escopo inteiro** — não parseia mais `front/back/tela/componente` como campo de repositório (que travava e re-pedia o escopo). A descrição chega crua pra IA saber a tela/fluxo onde corrigir/implementar.
- **FURO DO GATE FECHADO — "cd fura" (`on-git-guard.mjs`)**: o hook usava `process.cwd()` (pasta da sessão) e ignorava o `cd X && git ...` / `git -C X` do comando, então um commit de front feito com `cd egle/frontend && git commit` era avaliado na pasta ERRADA (ex.: sigater) → `git diff --cached` vazio → **VS-GATE-001/VS-AUD-004 não disparavam e o commit passava sem gate verde**. Novo `resolveGitCwd()` extrai o diretório REAL do git e **todas** as checagens (execSync com `cwd`, flags de pasta, recibo do gate) passam a usar `gitCwd`. `VS-BRANCH-006` também atualizado pra `repositorios` lista.

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
