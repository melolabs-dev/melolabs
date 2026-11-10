#!/bin/bash
# emite uma linha a cada 10% das 7.200 chamadas previstas (600 A2 + 1.050 Sonnet + 5.550 Haiku)
D=/c/Users/caiog/OneDrive/Documentos/blog-tech/studies/rag-data-lake-haiku/dados
T=7200; E=$D/.decil
[ -f $E ] || echo 0 > $E
while true; do
  n=$(cat $D/bruto/*.jsonl 2>/dev/null | wc -l)
  er=$(cat $D/bruto/*.jsonl 2>/dev/null | grep -c '"erro"')
  d=$((n*10/T)); u=$(cat $E)
  if [ $d -gt $u ]; then echo $d > $E; echo "PROGRESSO $((d*10))%: $n de $T chamadas, $er erros, $(date +%H:%M)"; fi
  if [ $er -ge 20 ]; then echo "ALERTA: $er erros ($(date +%H:%M))"; sleep 600; fi
  grep -q "^FIM" $D/rodar.log && { echo "FILA CONCLUIDA: $n chamadas, $er erros"; exit 0; }
  sleep 60
done
