#!/bin/bash
# Reinicia o painel (backend/server.mjs) SEM perder a configuracao de quem ja estava
# rodando: copia o ambiente do processo atual e so acrescenta PAINEL_URL.
# Existe porque trocar codigo do painel exige reiniciar, e reiniciar "na mao" costuma
# perder o CRM_TOKEN/QG_TOKEN que foram passados por ambiente na primeira subida.
set -u
PORTA="${1:-8787}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${PAINEL_LOG:-$RAIZ/.painel.log}"

PID="$(ss -ltnp 2>/dev/null | grep -oP ":$PORTA\s.*pid=\K[0-9]+" | head -1)"
if [ -z "$PID" ]; then
  echo "nada ouvindo na porta $PORTA — subir do zero exige as variaveis de ambiente" >&2
  exit 1
fi

ENVFILE="$(mktemp)"; chmod 600 "$ENVFILE"
cp "/proc/$PID/environ" "$ENVFILE" || { echo "nao consegui ler o ambiente do pid $PID" >&2; exit 1; }

kill "$PID" 2>/dev/null
for _ in $(seq 20); do ss -ltn | grep -q ":$PORTA " || break; sleep 0.25; done

cd "$RAIZ" || exit 1
xargs -0 -a "$ENVFILE" env PAINEL_URL="${PAINEL_URL:-https://painel.velososolution.com.br}" \
  setsid node backend/server.mjs >> "$LOG" 2>&1 &
shred -u "$ENVFILE" 2>/dev/null || rm -f "$ENVFILE"

for _ in $(seq 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/crm")" = "200" ] && { echo "painel no ar em :$PORTA"; exit 0; }
  sleep 0.25
done
echo "painel nao respondeu em :$PORTA — veja $LOG" >&2
exit 1
