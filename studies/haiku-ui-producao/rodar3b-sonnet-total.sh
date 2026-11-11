#!/bin/bash
# Sonnet em todas as 48 telas por tarefa (autorizado pelo Caio: custo projetado < US$ 120). Teto próprio 102 porque o Haiku termina em paralelo (~US$ 8 não vistos por este processo).
cd "$(dirname "$0")"; unset EST3B
TETO=102
python executor3b.py --tarefas T4 --conds L0 L100 R --modelo sonnet --amostras 1 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
python executor3b.py --tarefas T2 --conds A0 A3 --modelo sonnet --amostras 1 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
python executor3b.py --tarefas T4 --conds K L50 --modelo sonnet --amostras 1 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
echo FIM-SONNET-TOTAL
