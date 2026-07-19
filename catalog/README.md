# Catálogo de Mensagens — Orquestrar IA

Protocolo executável de governança. O documento é a **especificação**; quem **garante o comportamento** é o plugin (hooks) + o MCP. Mensagens curtas por design (economia de token).

Fonte da verdade: [`messages.json`](./messages.json) (lido por hooks e MCP).

---

## Princípio de arquitetura

| Camada | Executa | Papel | Custo |
|---|---|---|---|
| **Hook** (determinístico) | validação de requisito, gate de commit/push, carga de contexto | **triagem e bloqueio — a IA nem entra** | ~0 token |
| **MCP** (o modelo chama) | geração de doc, relatório de compliance, análise de causa raiz | trabalho **generativo** sob demanda | token só quando escala |
| **Escalation Engine** | decisão `call_ai: true/false` dentro do hook | fronteira hook↔MCP | ~0 token |

**Regra de ouro:** só chama o modelo completo em causa raiz, arquitetura, código complexo, segurança ou falha persistente. Todo o resto morre no hook.

### Mapa hook × evento Claude Code

| Intenção | Evento real | Mensagens |
|---|---|---|
| BeforeTask | `UserPromptSubmit` / `/task` | família **REQ** |
| Contexto/memory | `SessionStart` | família **CTX** |
| BeforeCommit | `PreToolUse` (git commit) | família **AUD** |
| AfterCommit | `PostToolUse` (git commit) | doc + métricas |
| BeforePush | `PreToolUse` (git push) | família **AUD** |
| Escalar IA | decisão do engine | família **AI** |
| Consentimento | opt-in (1ª execução) | família **MON** |

---

## Família REQ — triagem de requisito (implementada)

Roda no início da tarefa. Checa o **checklist de requisito** (ver `messages.json → checklist_requisito`):

**Obrigatórios:** descrição · objetivo/resultado esperado · critério de aceite
**Opcionais relevantes:** arquivo/módulo afetado · regra de negócio · origem (dev/main/hml)

| Código | Status | Quando dispara | Ação |
|---|---|---|---|
| `VS-REQ-001` | BLOCKED | falta obrigatório | **bloqueia**, lista o que falta, IA não entra |
| `VS-REQ-002` | WAITING | tarefa deixada pendente / requisito solicitado e não recebido | marca pendente, reavalia ao complementar |
| `VS-REQ-003` | PARTIAL | obrigatórios OK, opcional relevante ausente | alerta, pede confirmação, **não bloqueia** |
| `VS-REQ-004` | AMBIGUOUS | ambiguidade que é decisão de produto | bloqueia, pergunta objetiva, nunca "chuta" |
| `VS-REQ-005` | READY | tudo presente e sem ambiguidade | libera → Escalation Engine decide se precisa do modelo |

**Fluxo:**
```
/task ou prompt de tarefa
      │  (UserPromptSubmit hook — determinístico)
      ▼
checklist_requisito
   ├─ falta obrigatório ────► VS-REQ-001 BLOCKED   (IA nem entra)
   ├─ pendente ─────────────► VS-REQ-002 WAITING
   ├─ ambíguo (produto) ────► VS-REQ-004 AMBIGUOUS
   ├─ parcial ──────────────► VS-REQ-003 PARTIAL   (confirma e segue)
   └─ suficiente ───────────► VS-REQ-005 READY ───► Escalation Engine
```

---

## Próximas famílias (a desenhar)

- **AUD** — checklist de commit/push (testes, lint, diff, padrão, doc, segurança) → `VS-AUD-001 CHECKING`, `VS-AUD-002 APPROVED`, `VS-AUD-003 BLOCKED`, `VS-AUD-004 BLOCKED` (teste unitário obrigatório). **Regra absoluta:** só libera no **verde** — não há commit liberado enquanto alguém resolve o problema; se o gate não roda, a IA é delegada a resolver até ficar verde. Bloqueio que dependa de pessoas ou de regra de negócio (após esgotar tentativas) vira **impedimento** endereçado ao **tech lead ou gestor** na doc de fechamento — mesmo assim, sem verde, sem commit.
  - **Camada extra — teste unitário obrigatório (`VS-AUD-004`):** se a tarefa **tocou código de produção** (criou/alterou arquivo de código) em **backend, front ou mobile**, é obrigatório existir um **teste unitário válido correspondente** à mudança (cobre o que mudou, não placeholder vazio). **Sem teste correspondente → commit BLOQUEADO**, no mesmo nível do "só commita no verde". É responsabilidade da **IA criar** o teste — mesmo que não tenha sido pedido no escopo/alvo — antes de commitar. Vale pros 3 stacks (backend: PHPUnit/Pest; front: vitest/jest; mobile: flutter test), conforme o projeto.
- **AI** — escalação (`VS-AI-001 ESCALATED` + motivo). Decide e loga por que o modelo foi chamado.
- **OK** — aprovações (`VS-OK-001 APPROVED`).
- **CTX** — carga de contexto/memory na sessão.
- **MON** — consentimento LGPD para coleta técnica (docker/rede/desempenho). Só dados técnicos do ambiente corporativo; nunca conteúdo/navegação pessoal. Texto-base: *"Auditoria técnica do ambiente corporativo para melhoria contínua e segurança operacional."*

---

## Por que isso vira produto (não prompts)

O plugin **decide quando a IA é escalada**. Deixa de ser "conjunto de prompts" e vira **camada de orquestração inteligente do ciclo de desenvolvimento**. A Veloso Solution não vende Claude Code — vende a camada que transforma o Claude Code em **processo empresarial** auditável.
