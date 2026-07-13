# QA-Gate — Backend de Licenciamento

Roda na **sua VPS**. Recebe o webhook do Stripe após pagamento e **emite a licença assinada** (Ed25519). Não faz parte do pacote npm (usa a chave privada).

## Fluxo

```
Cliente compra (Stripe Payment Link)
   │
   ▼
Stripe → POST /webhook (checkout.session.completed)
   │  verifica assinatura (STRIPE_WEBHOOK_SECRET)
   ▼
issueLicense({ email, plan }) → token assinado
   │
   ▼
entrega ao cliente (email/tela)   ← cliente cola em QA_GATE_LICENSE
```

## Deploy (VPS Docker)

1. Copie `backend/.env.example` → `.env` e preencha:
   - `STRIPE_WEBHOOK_SECRET` (Stripe → Webhooks)
   - `QA_GATE_PRIVATE_KEY` (conteúdo do PEM privado — **nunca** commitar)
2. Suba: `node backend/server.mjs` (ou num container; porta `PORT`).
3. No Stripe → **Webhooks** → endpoint `https://sua-vps/webhook`, evento `checkout.session.completed`.
4. Teste local:
   ```bash
   curl -X POST localhost:8787/webhook -H "content-type: application/json" \
     -d '{"type":"checkout.session.completed","data":{"object":{"customer_details":{"email":"x@y.com"},"metadata":{"plan":"pro"}}}}'
   ```

## Planos (tiers)

O `plan` vem do `metadata.plan` do Payment Link do Stripe. Mapeado em `server.mjs`:

| plan | validade |
|---|---|
| `pro` | 365 dias |
| `mensal` | 30 dias |
| `trial` | 14 dias |

Crie um Payment Link por tier no Stripe e defina `metadata.plan` em cada um.

## Emissão manual (MVP sem webhook)

```bash
QA_GATE_PRIVATE_KEY="$(cat license/.keys/private.pem)" node license/issue.mjs cliente@email.com pro 365
```
Copie o token e envie ao cliente.
