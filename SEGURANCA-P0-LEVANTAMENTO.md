# Segurança P0 — levantamento (Guardian / Escritório)

Resposta ao item 12 do spec: **primeiro o levantamento**, antes de mexer em código.
Feito lendo o código real em 23/09/2026, branch `fix/fabiano.veloso/6458`.

---

## A verdade que muda o plano inteiro

O spec pede **multi-tenant, MFA, sessões com jti, refresh token rotativo, RBAC de
5 papéis**. O sistema de hoje **não tem a fundação onde isso se encaixa:**

| O spec assume | O que existe hoje | Onde |
|---|---|---|
| Vários tenants isolados | **Instalação única** — 1 pasta de dados (`VS_HOME`), 0 ocorrências de `tenant` | `engine/casa.mjs` |
| Vários usuários com papéis | **Nenhum usuário** — só uma senha para o console inteiro | `backend/acesso.mjs` |
| Sessão com id, expiração, revogação | **A senha É o token** — sem sessão, sem expiração, sem revogar | `backend/acesso.mjs`, `crm.html:855` |
| Banco relacional, auditoria separada | **Arquivos JSON** em disco | todo o `engine/` |

Isso é o mesmo veredito da `AUDITORIA-BOLSO-CHEIO.md` (§0). **Consequência
honesta:** os itens 1, 4, 6 do spec não são "corrigir uma linha" — são **construir
a camada de identidade** (tenant → usuário → sessão → papel) que ainda não existe.
Isso é P0 **estrutural**, e vem antes de MFA, refresh token e afins, porque não há
o que proteger enquanto não há sessão nem tenant.

Então dividi em dois blocos:
- **Bloco A — corrigível já**, no sistema de hoje, em mudanças pequenas.
- **Bloco B — fundação**, que precisa ser construída antes do resto do spec.

---

## Bloco A — dá pra corrigir agora (mudanças pequenas, com teste)

| # | Risco | Sev | Arquivo | Correção proposta |
|---|---|---|---|---|
| A1 | **Segredos reais soltos, não versionados mas fora do .gitignore** — `backend/Chave` (TikTok client key), `backend/Partner` (app id + **app secret**), `backend/Tik`. Um `git add .` distraído commita a chave. | **P0** | `backend/{Chave,Partner,Tik,Me}` | Mover o conteúdo pra `~/.qa-gate/console/painel.env`, apagar os arquivos, e adicionar padrão amplo ao `.gitignore`. **Os que já rodaram em produção: considerar comprometidos e rotacionar.** |
| A2 | **A senha do console é o token de API** — vai crua no `sessionStorage`, mandada em `x-crm-token` a cada request. Não expira, não é revogável, não tem sessão. Vazou uma vez = acesso eterno até trocar a senha (que invalida todo mundo). | **P0** | `backend/acesso.mjs`, `backend/crm.html:855,889` | Emitir um **token de sessão** no login (id próprio + expiração), separado da senha. Guardar hash do token no servidor; permitir revogar. É o começo do item 1 do spec. |
| A3 | **Sem cabeçalhos de segurança** — não há HSTS, X-Content-Type-Options, X-Frame-Options nem CSP. O painel abre em iframe de terceiro (clickjacking) e aceita sniffing de tipo. | **P1** | `backend/server.mjs:121` | Adicionar os quatro headers na resposta. Mudança pequena e isolada. |
| A4 | **Erro 500 devolve `e.message` ao cliente** — em vários pontos (`:242,294,551,651`). Pode vazar caminho interno, nome de tabela/arquivo. | **P1** | `backend/server.mjs` (5+ catches) | Em produção, responder mensagem genérica + id de erro; o detalhe só no log do servidor. |
| A5 | **Login sem rate-limit dedicado** — o `LIM_CRM` (300/min) cobre tudo junto; não há bloqueio após N falhas de senha. Força bruta cabe na cota. | **P1** | `backend/server.mjs:691` | Rate-limit próprio e mais estrito na rota de senha; bloqueio temporário após várias falhas. Alimenta o item 3 do spec. |
| A6 | **Nenhum evento de segurança é registrado** — login (ok/falho), troca de senha, acesso a documento não deixam trilha. O item 2 e 10 do spec não têm nada hoje. | **P1** | novo `engine/vslog-seguranca` | Log de auditoria **append-only**, separado do log comum, que usuário do painel não apaga. |
| A7 | **CORS com origem fixa de outro domínio** (`velososolution.online`) — provavelmente sobra de outro projeto; convém confirmar e restringir ao host do console. | **P2** | `backend/server.mjs:119` | Conferir se `.online` deve mesmo receber; senão, apontar pro host real. |

**Já feito nesta frente** (não repetir): senha em **scrypt com sal** (nunca em texto
puro — item 1 ✓), comparação **timing-safe** (`acesso.mjs`), **path traversal
barrado** em mídia por allow-list de nome (`midia.mjs:99`), rate-limit base existe
(`server.mjs:160`), e o **registro de tomada de conta do WhatsApp** (feito hoje).

---

## Bloco B — fundação, precisa ser construída antes do resto do spec

| # | O que o spec pede | Sev | Realidade | O que exige |
|---|---|---|---|---|
| B1 | **Isolamento multi-tenant** (item 4, "CRÍTICO") | **P0** | Não há tenant nenhum | Criar o conceito de tenant, carimbar todo dado com `tenantId`, e derivar o tenant **da sessão**, nunca do frontend. Sem isso, o teste que você pediu (dois tenants, acesso cruzado) não tem o que testar ainda. |
| B2 | **RBAC — OWNER, LAWYER, EMPLOYEE, TECH_SUPPORT, BOT** (item 6) | **P0** | Não há usuário nem papel | Camada de usuário com papel; suporte Veloso vê só infra/segurança, nunca processo/conversa. |
| B3 | **MFA, refresh token rotativo, revogar sessão** (item 1) | **P0** | Não há sessão | Depende de A2 primeiro (ter sessão), depois empilha MFA e rotação. |
| B4 | **Guardian/IA nunca autoriza** (item 5) | **P0** | O bot hoje não consulta dado de cliente por IA paga; mas a regra tem de nascer com B1/B2 | O backend verifica tenant+papel **antes** de qualquer dado chegar ao modelo. Minimização: nunca mandar token/segredo ao modelo. |
| B5 | **Documentos: autorização por acesso, não por URL** (item 7) | **P1** | `vsdocumentos` guarda contrato/política; não há download de doc de cliente por link ainda | Quando existir, id não-previsível + verificação de dono + URL que expira + log de download. |

---

## O teste que vale ouro (seu acréscimo)

> Dois tenants, dois usuários, dois bots, dois conjuntos de documentos.
> Automatizar acesso cruzado. Qualquer vazamento quebra o pipeline.

**Concordo que é o teste mais importante do projeto** — e ele só pode existir
depois de B1 (tenant) e B2 (usuário/papel). Proposta: escrevê-lo **junto** com B1,
como o critério que prova B1 pronto. Enquanto o teste cruzado não passar, B1 não
está feito. É a régua certa.

Nome errado de bot dá risada; documento jurídico no tenant errado é incidente — e
hoje, sendo instalação única, **cada cliente é uma instalação separada** (pasta,
porta e número próprios, como a demo). Isso já isola fisicamente — não é
multi-tenant de verdade, mas não vaza um cliente no outro porque **não dividem
processo nem disco**. É a proteção que existe hoje, e é honesto dizer que é por
separação de instância, não por isolamento lógico.

---

## Ordem que eu recomendo

1. **A1** agora — tirar os segredos soltos e rotacionar. É o P0 mais barato e mais
   perigoso; um commit distraído já resolve contra você.
2. **A3, A4** — headers e erro genérico. Pequenos, isolados, sem risco funcional.
3. **A2 + A6** — sessão de verdade + log de segurança. É o alicerce do item 1 e 2.
4. **A5** — brute force no login.
5. Decidir o rumo: **continuar instalação-por-cliente** (isola por separação
   física, simples, é o que roda) **ou** construir o multi-tenant do Bloco B
   (B1→B2→B3), que é o produto Guardian de verdade e é obra grande.

O item 12 pede implementar P0 em passos pequenos, cada um apresentado antes do
próximo. Sugiro começar por **A1**, que eu faço na hora que você liberar (a sessão
está em modo consulta agora — não commito nada sem você abrir a tarefa).

---

## O que NÃO está no escopo (o próprio spec confirma)

Item 3, final: *"Não implementar contra-ataque, redirecionamento do atacante para
máquinas administrativas ou qualquer mecanismo de hack-back."* Está alinhado com o
que eu já tinha dito — a defesa é detectar, registrar, revogar e preservar prova.
Nada que saia atrás de ninguém.
