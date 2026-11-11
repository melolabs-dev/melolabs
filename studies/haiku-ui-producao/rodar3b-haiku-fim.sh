#!/bin/bash
cd "$(dirname "$0")"; unset EST3B
python executor3b.py --tarefas T4 T2 --modelo haiku --amostras 3 --saida dados/bruto/principal-haiku.jsonl --teto-usd 260 --paralelo 20
echo FIM-RODADA
