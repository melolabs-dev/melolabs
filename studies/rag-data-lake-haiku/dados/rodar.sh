#!/bin/bash
# Rodada principal do estudo 2 (fila: A2, Sonnet, demais braços Haiku). Retomável.
cd /c/Users/caiog/OneDrive/Documentos/blog-tech
Q=$(cat studies/rag-data-lake-haiku/dados/qids.txt)
B=studies/rag-data-lake-haiku/dados/bruto
python -u tools/rag-lake/executor.py --qids $Q --bracos A2 --amostras 5 --paralelo 4 --saida $B/haiku-A2.jsonl
python -u tools/rag-lake/executor.py --qids $Q --bracos A0 A1 --amostras 5 --modelo sonnet --saida $B/sonnet.jsonl
python -u tools/rag-lake/executor.py --qids $Q --bracos A0 A1 A3:10 A4a:10 A4b:10 A5:10 A6:10 N1:10 N1b:10 N2:10 --amostras 5 --saida $B/haiku.jsonl
echo FIM
