#!/bin/bash
# Rodada principal: Haiku -> Sonnet -> Opus, 3 amostras, esforço médio. Para em US$120 nominais acumulados (80% do teto de 150).
cd "$(dirname "$0")"
B=dados/bruto
python -u executor.py --tarefas T1 T2 T3 --conds A0 A1 A2 A3 AC --modelo haiku  --amostras 3 --paralelo 8 --teto-usd 120 --saida $B/principal-haiku.jsonl  >> $B/principal.log 2>&1
python -u executor.py --tarefas T1 T2 T3 --conds A0 A1 A2 A3    --modelo sonnet --amostras 3 --paralelo 6 --teto-usd 120 --saida $B/principal-sonnet.jsonl >> $B/principal.log 2>&1
python -u executor.py --tarefas T1 T2 T3 --conds A0 A1 A2 A3    --modelo opus   --amostras 3 --paralelo 5 --teto-usd 120 --saida $B/principal-opus.jsonl   >> $B/principal.log 2>&1
echo FIM >> $B/principal.log
