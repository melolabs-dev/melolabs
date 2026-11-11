#!/bin/bash
# Rodada final (autorização do Caio em 11/11 01:26: sem limite de custo; foco em assertividade e prazo 7-8h). Teto de segurança 260 só contra descontrole.
cd "$(dirname "$0")"; unset EST3B
TETO=260
# Sonnet: grade completa, 2 amostras, T2 e T4 embaralhados juntos (se parar antes, o desenho fica balanceado)
python executor3b.py --tarefas T4 T2 --modelo sonnet --amostras 2 --saida dados/bruto/principal-sonnet.jsonl --teto-usd $TETO --paralelo 14 &
PS=$!
# Haiku: espera a etapa atual terminar e acrescenta a 3ª amostra
while tasklist | grep -q "^python.exe *40852 "; do sleep 20; done
python executor3b.py --tarefas T4 T2 --modelo haiku --amostras 3 --saida dados/bruto/principal-haiku.jsonl --teto-usd $TETO --paralelo 8
wait $PS
echo FIM-RODADA
