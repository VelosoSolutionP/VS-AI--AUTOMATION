# Chaves (licenças) — como são criadas

Toda chave é um **token assinado (Ed25519)** com a chave privada que vive **só no backend** (`/opt/qa-gate/license/.keys/private.pem`, nunca no cliente). O cliente só **verifica** com a pública. Formato: `payload.assinatura` (base64url). Payload: `email/contato, plan, seats, iat, exp, id`.

## 3 formas de criar chave

### 1. Teste (trial) — automático no instalador
O cliente instala → o instalador chama `POST /trial` no backend → recebe uma chave **plano `trial`** (exp longo; o corte de **7 dias** é feito pela **trava por data de instalação** na máquina dele) → entregue no **WhatsApp**.
- Se o backend estiver fora, o instalador usa a **chave genérica embutida** (fallback offline).

### 2. Pago — automático via Stripe
Cliente paga no `/checkout` → Stripe chama `POST /webhook` → backend emite a chave do **plano comprado** e entrega no WhatsApp. Planos: `pequena`, `medio`, `grande` (chave **eterna**, `exp null`), `mensal` (30d).

### 3. Manual (admin) — você emite na hora
Pra dar uma chave você mesmo (venda fora do Stripe, cortesia, suporte):

**Via endpoint (de qualquer lugar):**
```bash
curl -X POST https://api.velososolution.online/issue \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"whatsapp":"5531999998888","name":"Cliente X","plan":"grande"}'
# -> {"token":"...","plan":"grande","entregue":true}  (entrega no WhatsApp)
```
Planos: `trial | mensal | pequena | medio | grande | pro`. `days` opcional (sobrepõe o padrão do plano). `"entregar": false` só devolve o token sem mandar no zap.

**Via SSH (direto no VPS):**
```bash
node /opt/qa-gate/license/issue.mjs cliente@email.com grande 3650
```

## Onde ficam os segredos
- **Chave privada**: `/opt/qa-gate/license/.keys/private.pem` (VPS) ou env `QA_GATE_PRIVATE_KEY`.
- **ADMIN_TOKEN**: env do serviço (systemd) — protege o `/issue`. Sem ele, `/issue` fica desativado (403).
- **Cliente** usa a chave em `QA_GATE_LICENSE` (env do MCP). Verificação é **offline** (só a pública).
