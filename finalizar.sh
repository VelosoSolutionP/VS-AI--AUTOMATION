#!/bin/bash
# Poe no ar tudo que foi feito hoje e CONFERE. Um comando so.
#
#   ./finalizar.sh              faz tudo e confere
#   ./finalizar.sh --conferir   so confere, nao mexe em nada
#
# Existe porque tres coisas precisam de quem esta na maquina: reiniciar o painel
# (processo carrega o codigo na subida), instalar os hooks (o que roda e a copia
# em ~/.vs-ia, nao o repo) e reconectar o MCP. As duas primeiras ficam aqui.
set -u
RAIZ="$(cd "$(dirname "$0")" && pwd)"
PORTA="${PORTA:-8787}"
PUB="${PAINEL_URL:-https://painel.velososolution.com.br}"
SO_CONFERIR=0
[ "${1:-}" = "--conferir" ] && SO_CONFERIR=1

ok=0; falhou=0
verde(){ printf '  \033[32m✔\033[0m %s\n' "$1"; ok=$((ok+1)); }
vermelho(){ printf '  \033[31m✖\033[0m %s\n' "$1"; falhou=$((falhou+1)); }
titulo(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
codigo(){ curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || echo 000; }
corpo(){ curl -s --max-time 15 "$1" 2>/dev/null; }

if [ "$SO_CONFERIR" = 0 ]; then
  titulo "1/3  Reiniciando o painel (:$PORTA)"
  if PAINEL_URL="$PUB" "$RAIZ/backend/reiniciar-painel.sh" "$PORTA"; then
    verde "painel reiniciado com o codigo de agora"
  else
    vermelho "o painel NAO subiu — veja $RAIZ/.painel.log"
    echo; echo "Parei aqui: sem painel no ar, conferir o resto nao diz nada."; exit 1
  fi

  titulo "2/3  Instalando a governanca em ~/.vs-ia"
  "$RAIZ/instalar-hooks.sh" || vermelho "a instalacao dos hooks reclamou (veja acima)"
fi

titulo "$([ "$SO_CONFERIR" = 1 ] && echo 'Conferindo' || echo '3/3  Conferindo') o que passou a responder"

# --- painel de pe ---
[ "$(codigo "http://127.0.0.1:$PORTA/crm")" = 200 ] \
  && verde "painel responde em 127.0.0.1:$PORTA" \
  || vermelho "painel NAO responde em 127.0.0.1:$PORTA"

[ "$(codigo "$PUB/crm")" = 200 ] \
  && verde "painel responde pela internet ($PUB)" \
  || vermelho "painel NAO responde pela internet — confira o cloudflared"

# --- codigo novo? o /crm/api/auth do codigo velho devolve UM campo so ---
# Este e o teste-mae: varias checagens abaixo nao tem como se provar sozinhas
# (rota autenticada responde 403 tanto por "sem sessao" quanto por "nao existe"),
# entao elas dependem DESTE. Sem isso, 403 virava falso verde.
NOVO=0
if corpo "$PUB/crm/api/auth" | grep -q 'precisaCriar'; then
  NOVO=1; verde "o painel esta com o CODIGO NOVO"
else
  vermelho "ainda e o codigo VELHO — o processo antigo nao morreu"
fi

# --- senha da tela ---
[ -f "$HOME/.qa-gate/console/acesso.json" ] \
  && verde "senha de console definida (vale junto com a do ambiente)" \
  || vermelho "sem senha de console — rode: node backend/senha-console.mjs"

# --- TikTok ---
c=$(codigo "$PUB/oauth/callback/open?error=teste")
[ "$c" != 404 ] && [ "$c" != 000 ] \
  && verde "volta do OAuth do TikTok responde ($c)" \
  || vermelho "volta do OAuth ainda da 404 — a autorizacao nao fecha"

ARQ=$(node -e "
process.env.VSTIKTOK_DIR=process.env.VSTIKTOK_DIR||'';
import('$RAIZ/engine/vstiktok/index.mjs').then(t=>{const v=t.getVerificacao();process.stdout.write(v&&v.arquivo?v.arquivo:'')}).catch(()=>{})
" 2>/dev/null)
if [ -n "$ARQ" ]; then
  [ "$(codigo "$PUB/$ARQ")" = 200 ] \
    && verde "arquivo de verificacao de dominio no ar (/$ARQ)" \
    || vermelho "arquivo de verificacao cadastrado mas NAO responde (/$ARQ)"
else
  echo "  · sem arquivo de verificacao cadastrado (so precisa se a TikTok pedir)"
fi

node -e "
import('$RAIZ/engine/vstiktok/index.mjs').then(t=>{
  const d=t.diagnostico();
  const s=d.familias.open;
  console.log(s.appConfigurado?'  \033[32m✔\033[0m credencial do TikTok gravada (app open)':'  \033[31m✖\033[0m falta a credencial do TikTok');
  console.log(s.autorizado?'  \033[32m✔\033[0m conta do TikTok JA conectada':'  · conta do TikTok ainda nao conectada — e o clique no painel');
}).catch(()=>{})" 2>/dev/null

# --- Recebimento ---
# So da pra afirmar com o codigo novo no ar: 403 sozinho nao distingue
# "existe e pediu sessao" de "nao existe".
c=$(codigo "$PUB/crm/api/pagamentos")
if [ "$NOVO" = 1 ] && { [ "$c" = 401 ] || [ "$c" = 403 ] || [ "$c" = 200 ]; }; then
  verde "tela Recebimento no ar (responde $c)"
elif [ "$NOVO" = 1 ]; then
  vermelho "tela Recebimento nao respondeu como devia ($c)"
else
  echo "  · tela Recebimento: nao da pra afirmar com o codigo velho no ar"
fi

# --- gate ---
[ -f "$RAIZ/vs-gate-config.json" ] && verde "vs-gate-config.json no lugar" || vermelho "sem vs-gate-config.json"
if [ -f "$HOME/.vs-ia/engine/core.mjs" ]; then
  grep -q 'vs-gate-config.json' "$HOME/.vs-ia/engine/core.mjs" \
    && verde "a governanca instalada ja conhece o nome novo da config" \
    || vermelho "a governanca instalada ainda procura o nome velho"
fi

titulo "Resultado: $ok ok, $falhou com problema"
cat <<'FIM'

Falta o que so voce faz, fora desta maquina:

  1. developers.tiktok.com -> seu app -> Login Kit -> Redirect URI
     troque o trycloudflare morto por:
     https://painel.velososolution.com.br/oauth/callback/open

  2. /mcp  (digitado no prompt do Claude Code, nao aqui)
     reconecta o vs-ia-dev pro qa_simulate pegar o conserto

Depois disso: abra o painel, menu "Conexoes com redes sociais",
botao "Conectar conta". A TikTok abre, voce autoriza, volta conectado.
FIM
[ "$falhou" -gt 0 ] && exit 1 || exit 0
