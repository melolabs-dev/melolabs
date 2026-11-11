#!/bin/bash
# Rodada principal do estudo 3b. Teto nominal 112 (US$ 120 autorizados menos ~US$ 3 do piloto e margem). Retomável.
cd "$(dirname "$0")"; unset EST3B
TETO=112
FAMS="painel listagem formulario checkout configuracoes navegacao"
IDS4=""; IDS2=""; for f in $FAMS; do for i in 1 2 3 5; do IDS4="$IDS4 T4-$f-$i"; IDS2="$IDS2 T2-$f-$i"; done; done
# etapa 1: Haiku, grade completa, 2 amostras
python executor3b.py --tarefas T4 T2 --modelo haiku --amostras 2 --saida dados/bruto/principal-haiku.jsonl --teto-usd $TETO --paralelo 8
# etapa 2: Sonnet, grade reduzida, 1 amostra
python executor3b.py --tarefas T4 --conds L0 L100 R --ids $IDS4 --modelo sonnet --amostras 1 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
python executor3b.py --tarefas T2 --conds A0 A3 --ids $IDS2 --modelo sonnet --amostras 1 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
# etapa 3: extensão do Sonnet (segunda amostra) enquanto houver orçamento
python executor3b.py --tarefas T4 --conds L0 L100 R --ids $IDS4 --modelo sonnet --amostras 2 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
python executor3b.py --tarefas T2 --conds A0 A3 --ids $IDS2 --modelo sonnet --amostras 2 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 6
echo FIM-RODADA
