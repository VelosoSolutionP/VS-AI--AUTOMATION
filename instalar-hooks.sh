#!/bin/bash
# Instala em ~/.vs-ia os arquivos da governanca que mudaram neste repo.
#
# Existe porque os hooks que RODAM sao os de ~/.vs-ia/hooks, nao os do repo:
# editar o repo e mudar codigo morto ate alguem copiar. Faz backup antes e
# mostra o diff de tudo que NAO vai ser tocado, pra divergencia antiga nao
# sumir calada.
set -u
RAIZ="$(cd "$(dirname "$0")" && pwd)"
DEST="${VS_IA_DIR:-$HOME/.vs-ia}"
TS="$(date +%Y%m%d-%H%M%S)"

[ -d "$DEST" ] || { echo "nao achei a instalacao em $DEST" >&2; exit 1; }

# So o que este trabalho mexeu. O resto fica quieto de proposito.
ARQUIVOS="engine/core.mjs hooks/on-qa-gate.mjs mcp/server-dev.mjs mcp/server.mjs engine/vsqa/cli.mjs"

echo "instalando em $DEST (backup .bak-$TS)"
for f in $ARQUIVOS; do
  [ -f "$RAIZ/$f" ] || { echo "  · $f — nao existe no repo, pulando"; continue; }
  if [ ! -f "$DEST/$f" ]; then echo "  · $f — nao existe no instalado, pulando"; continue; fi
  if cmp -s "$RAIZ/$f" "$DEST/$f"; then echo "  = $f — ja igual"; continue; fi
  cp -p "$DEST/$f" "$DEST/$f.bak-$TS"
  cp "$RAIZ/$f" "$DEST/$f"
  echo "  ✔ $f"
done

echo
echo "AINDA DIFERENTES (nao toquei — decida um a um):"
achou=0
for f in hooks/*.mjs engine/*.mjs; do
  [ -f "$RAIZ/$f" ] && [ -f "$DEST/$f" ] || continue
  case " $ARQUIVOS " in *" $f "*) continue;; esac
  cmp -s "$RAIZ/$f" "$DEST/$f" || { echo "  ✖ $f   (diff: diff $DEST/$f $RAIZ/$f)"; achou=1; }
done
[ "$achou" = 0 ] && echo "  (nenhum)"

echo
echo "pra voltar atras:  for b in $DEST/**/*.bak-$TS; do mv \"\$b\" \"\${b%.bak-$TS}\"; done"
