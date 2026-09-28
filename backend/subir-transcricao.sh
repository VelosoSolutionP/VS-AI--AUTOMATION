#!/usr/bin/env bash
# Sobe o servidor de TRANSCRICAO de audio (whisper.cpp, IA local e gratuita).
#
# O atendimento manda o audio do cliente pra ca e recebe o texto. So escuta em
# 127.0.0.1: nada sai da maquina. Fora do ar, o atendimento segue como antes
# (audio sem resposta) — nunca trava.
#
# Instalacao (uma vez): git clone https://github.com/ggerganov/whisper.cpp
#   em ~/.local/share/whisper.cpp, cmake -B build && cmake --build build -j,
#   bash models/download-ggml-model.sh base
# Modelo "base": ~7 s por audio neste Xeon E5-2420 (so AVX). O "small" acerta
# um pouco mais, mas leva ~30 s — lento demais pra conversa.
set -euo pipefail
W="${WHISPER_DIR:-$HOME/.local/share/whisper.cpp}"
PORTA="${TRANSCRICAO_PORTA:-8178}"
MODELO="${WHISPER_MODELO:-$W/models/ggml-base.bin}"
LOG="$W/servidor.log"

if ss -ltn | grep -q ":$PORTA "; then echo "transcricao ja esta no ar em :$PORTA"; exit 0; fi
[ -x "$W/build/bin/whisper-server" ] || { echo "whisper.cpp nao instalado em $W — veja o cabecalho deste script" >&2; exit 1; }
[ -f "$MODELO" ] || { echo "modelo nao encontrado: $MODELO" >&2; exit 1; }

cd "$W"
setsid ./build/bin/whisper-server -m "$MODELO" --host 127.0.0.1 --port "$PORTA" -l pt -t "${WHISPER_THREADS:-16}" \
  -bs 1 -bo 1 -nt --convert >> "$LOG" 2>&1 < /dev/null &
for _ in $(seq 60); do ss -ltn | grep -q ":$PORTA " && { echo "transcricao no ar em 127.0.0.1:$PORTA"; exit 0; }; sleep 0.5; done
echo "a transcricao nao subiu — veja $LOG" >&2; exit 1
