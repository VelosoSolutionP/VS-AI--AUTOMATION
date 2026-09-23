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

# Config que PRECISA sobreviver a reboot. O /proc so tem o ambiente de um processo
# VIVO: se a maquina reiniciar, tudo que foi passado na primeira subida se perde e
# o painel nao sobe mais sozinho. Este arquivo e a fonte duravel.
#
# O que estiver nele VENCE o que veio do processo antigo — e assim que se corrige
# ou acrescenta uma variavel (um token novo, por exemplo) sem ter que derrubar o
# painel na mao e lembrar das outras 100.
ENV_FILE="${PAINEL_ENV:-$HOME/.qa-gate/console/painel.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "config carregada de $ENV_FILE"
fi

# Pasta TEMPORARIA nao pode virar casa de dado do painel.
#
# Um teste apontou VSESTOQUE_DIR pra um scratchpad em /tmp e a variavel ficou no
# ambiente do processo. Como este script herda o ambiente do processo anterior,
# ela se propagou em TODO restart seguinte — e o painel passou a ler o estoque de
# uma pasta de teste com um produto chamado "teste". Na tela do cliente isso
# apareceu como "produto indisponivel", que nao aponta pra lugar nenhum.
for var in $(env | grep -oE '^[A-Za-z_][A-Za-z0-9_]*=/tmp/claude-[^ ]*' | cut -d= -f1); do
  echo "descartada: $var apontava pra pasta temporaria (${!var})" >&2
  unset "$var"
done

export PAINEL_URL="${PAINEL_URL:-https://bolsocheio.velososolution.com.br}"
echo "ambiente recuperado: $n variaveis"

kill "$PID" 2>/dev/null
for _ in $(seq 40); do ss -ltn | grep -q ":$PORTA " || break; sleep 0.25; done

# Escalada. Ja aconteceu de o painel ficar preso segurando a porta: alguma
# dependencia registra handler de SIGTERM e nao encerra, e ai o restart falhava
# em silencio deixando a VERSAO VELHA no ar — o pior dos mundos, porque parece
# que subiu. Se nao soltou no prazo, vai de -9.
if ss -ltn | grep -q ":$PORTA "; then
  echo "processo $PID ignorou o pedido de encerrar — forcando" >&2
  kill -9 "$PID" 2>/dev/null
  for _ in $(seq 20); do ss -ltn | grep -q ":$PORTA " || break; sleep 0.25; done
fi

if ss -ltn | grep -q ":$PORTA "; then
  echo "a porta $PORTA continua ocupada por outro processo — nao vou subir outro por cima" >&2
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
