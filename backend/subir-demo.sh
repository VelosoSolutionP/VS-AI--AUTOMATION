#!/usr/bin/env bash
# Instancia de DEMONSTRACAO — a que um revisor de marketplace abre.
#
# Nao e "um login com menos permissao": este produto nao tem papeis (auditoria
# §35, RBAC MISSING), entao um segundo login veria TUDO. O que se faz aqui e
# outra instalacao: outra casa de dados, outra senha, outra porta. O que a demo
# nao mostra, ela nao mostra porque nao esta la.
set -euo pipefail

PORTA="${PORTA_DEMO:-8790}"
CASA="${VS_HOME_DEMO:-$HOME/.qa-gate-demo}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$RAIZ/.demo.log"

# Derruba a instancia anterior da demo — e SO dela: o alvo e a porta da demo,
# nunca a de producao.
PID="$(ss -ltnp 2>/dev/null | grep ":$PORTA " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | head -1 || true)"
if [ -n "${PID:-}" ]; then
  kill "$PID" 2>/dev/null || true
  sleep 1
  kill -9 "$PID" 2>/dev/null || true
fi

mkdir -p "$CASA"
chmod 700 "$CASA"

cd "$RAIZ"
# Integracoes reais DESLIGADAS de proposito. O revisor testa o produto, nao
# move dinheiro nem manda mensagem pra numero de gente.
#
# EXCECAO consciente: a credencial de TESTE do Mercado Pago entra, pra demo
# conseguir mostrar o pagamento funcionando de ponta a ponta. Ela nao cobra
# ninguem. A de PRODUCAO nunca entra aqui — nem por engano de variavel.
nohup env \
  VS_HOME="$CASA" \
  PORT="$PORTA" \
  CRM_ENABLED=1 \
  DEMO=1 \
  CONSOLE_ADMIN_EMAIL="${EMAIL_DEMO:-demo@velososolution.com.br}" \
  CONSOLE_ADMIN_EMAILS_EXTRA= \
  PAINEL_URL="${URL_DEMO:-https://demo.velososolution.com.br}" \
  WHATSAPP_PROVIDER=log \
  MP_AMBIENTE=teste \
  MP_ACCESS_TOKEN_TESTE="${MP_ACCESS_TOKEN_TESTE:-}" \
  MP_PUBLIC_KEY_TESTE="${MP_PUBLIC_KEY_TESTE:-}" \
  node backend/server.mjs > "$LOG" 2>&1 &

sleep 3
if curl -fsS -o /dev/null "http://127.0.0.1:$PORTA/health"; then
  echo "demo no ar em :$PORTA  |  casa: $CASA"
else
  echo "a demo NAO subiu — ultimas linhas:"; tail -15 "$LOG"; exit 1
fi
