#!/bin/bash
cd "$(dirname "$0")"; unset EST3B
TETO=112
FAMS="painel listagem formulario checkout configuracoes navegacao"
IDS4=""; IDS2=""; for f in $FAMS; do for i in 1 2 3 5; do IDS4="$IDS4 T4-$f-$i"; IDS2="$IDS2 T2-$f-$i"; done; done
python executor3b.py --tarefas T4 --conds L0 L100 R --ids $IDS4 --modelo sonnet --amostras 1 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
python executor3b.py --tarefas T2 --conds A0 A3 --ids $IDS2 --modelo sonnet --amostras 1 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
echo FIM-SONNET1
