# QA-Gate

**Simulação em browser real antes de cada commit.** Injeta o bug, exige que o sistema responda com mensagem amigável no DOM real e console limpo. Só deixa commitar no verde.

> Teste unitário passa e a tela quebra mesmo assim — hidratação errada, lib JS que não subiu, mensagem de erro que não aparece no modal. QA-Gate fecha essa brecha exercendo o fluxo num Chrome de verdade, do jeito que o usuário faz.

Por [Veloso Solution](https://velososolution.online) — Consultoria em IA Aplicada.

---

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
- Uma **licença** (chave) — compre em [velososolution.online](https://velososolution.online)

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

- Compre em **[velososolution.online](https://velososolution.online)**.
- Você recebe um token. Exporte como `QA_GATE_LICENSE` (ou coloque no `.env` do CI).
- Sem chave válida, a simulação não roda.

---

## Configuração — `qa-gate.config.json`

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
    }
  ]
}
```

| Campo | Papel |
|---|---|
| `baseUrl` | URL local do app |
| `login` | rota + seletores + credencial do usuário QA (seed, **só local**) |
| `uiGlobs` | o que conta como "tocou UI" (dispara o browser) |
| `flows[].watch` | globs de arquivos que disparam este fluxo |
| `flows[].path` | rota do form/modal a exercer |
| `flows[].submitText` / `submitSelector` | como acionar o submit |
| `flows[].expectFriendlyError` | exige mensagem amigável ao injetar o bug |
| `blockOnUncovered` | se `true`, bloqueia commit de UI sem fluxo mapeado |

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
