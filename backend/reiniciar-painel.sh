#!/bin/bash
# Reinicia o painel SEM perder a configuracao de quem ja estava rodando.
#
# Existe porque trocar codigo do painel exige reiniciar, e reiniciar "na mao"
# perde o CRM_TOKEN/QG_TOKEN que foram passados por ambiente na primeira subida.
#
# A primeira versao usava `xargs -0 -a environ env ... node server.mjs` e estava
# ERRADA: o xargs acrescenta os itens no FIM, entao as variaveis viravam
# ARGUMENTO do node em vez de ambiente — o painel subia sem CRM_ENABLED (=> /crm
# dava 404) e o token aparecia no `ps` de qualquer usuario da maquina. Agora o
# ambiente e exportado no proprio shell, antes do exec: nada vai pra linha de
# comando.
set -u
PORTA="${1:-8787}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${PAINEL_LOG:-$RAIZ/.painel.log}"

PID="$(ss -ltnp 2>/dev/null | grep -oP ":$PORTA\s.*pid=\K[0-9]+" | head -1)"
if [ -z "$PID" ]; then
  echo "nada ouvindo na porta $PORTA — subir do zero exige as variaveis de ambiente" >&2
  exit 1
fi

# Carrega o ambiente do processo atual. So nomes validos de variavel; funcoes
# exportadas pelo bash (BASH_FUNC_...) ficam de fora de proposito.
n=0
while IFS= read -r -d '' kv; do
  case "$kv" in
    BASH_FUNC_*) continue ;;
    [A-Za-z_]*=*) export "$kv" && n=$((n+1)) ;;
  esac
done < "/proc/$PID/environ"

# Recuperacao da versao quebrada: se o painel foi subido com as variaveis como
# ARGUMENTO, elas nao estao no environ — estao no cmdline. Sem isto, reiniciar
# em cima de um processo daqueles perderia o token de vez.
while IFS= read -r -d '' arg; do
  case "$arg" in
    BASH_FUNC_*) continue ;;
    [A-Za-z_]*=*) export "$arg" && n=$((n+1)) ;;
  esac
done < "/proc/$PID/cmdline"

export PAINEL_URL="${PAINEL_URL:-https://painel.velososolution.com.br}"
echo "ambiente recuperado: $n variaveis"

kill "$PID" 2>/dev/null
for _ in $(seq 40); do ss -ltn | grep -q ":$PORTA " || break; sleep 0.25; done
if ss -ltn | grep -q ":$PORTA "; then
  echo "o processo $PID nao soltou a porta $PORTA — nao vou subir outro por cima" >&2
  exit 1
fi

cd "$RAIZ" || exit 1
setsid node backend/server.mjs >> "$LOG" 2>&1 &
sleep 1

for _ in $(seq 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/crm")" = "200" ] && { echo "painel no ar em :$PORTA"; exit 0; }
  sleep 0.25
done

# /crm fora do ar mas /health de pe = subiu sem CRM_ENABLED. Dizer "nao respondeu"
# aqui mandaria procurar no lugar errado.
if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/health")" = "200" ]; then
  echo "o painel subiu mas /crm nao responde — falta CRM_ENABLED=1 no ambiente do processo antigo" >&2
else
  echo "painel nao respondeu em :$PORTA — veja $LOG" >&2
fi
exit 1
