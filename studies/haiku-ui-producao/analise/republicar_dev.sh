#!/bin/bash
# Repete a publicação no DEV dos posts que falharam por limite de taxa (HTTP 429), com intervalo entre eles.
cd "$(dirname "$0")/../../.."
for par in "haiku-ui-producao pt" "haiku-ui-producao en" "haiku-ui-design-guia pt" "haiku-ui-design-guia en" "haiku-ui-producao-guia pt" "haiku-ui-producao-guia en"; do
  set -- $par
  for t in 1 2 3; do
    out=$(python tools/publish/publish.py "$1" --lang "$2" --yes 2>&1)
    echo "=== $1 $2 (tentativa $t)"; echo "$out" | tail -5
    echo "$out" | grep -q "FALHOU HTTP 429" || break
    sleep 75
  done
  sleep 45
done
echo FIM-REPUBLICACAO
