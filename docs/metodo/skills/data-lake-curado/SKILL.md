---
name: data-lake-curado
description: Monta e usa um mini data lake curado (documentos + cartões de decisão + índice BM25/vetor/reranker) para dar memória de projeto a um modelo pequeno como o Haiku. Use quando o modelo precisa decidir com base em documentos, decisões antigas e vigentes de um projeto, e colar tudo no prompt é caro demais.
---

# Data lake curado para modelo pequeno

Método do estudo 2 do Melo Labs (`studies/rag-data-lake-haiku`). Resultado medido em 120 perguntas de múltipla escolha com o Haiku 5.5: só a pergunta 43 acertos; lake inteiro colado 91; vetor simples 84; híbrido 88; híbrido com reranker 99; **memória curada 114**. Custo nominal por chamada: US$ 0,224 (lake colado) contra US$ 0,00088 (curada). Ressalva: as perguntas foram derivadas dos cartões, então o ganho sobre o híbrido com reranker é um teto.

## Quando NÃO usar
- O lake cabe no contexto e a pergunta muda pouco: colar tudo funciona (91/120) e é mais simples, só é mais caro.
- Não ponha um "portão de abstenção" (cortar a resposta por nota do reranker): no estudo ele piorou o acerto (78/120).

## Passos
1. **Zona bruta.** Copie os documentos como estão (docs, AGENTS.md/CLAUDE.md, trechos de código, issues/PRs, log de decisões). Gere um manifesto com hash, tamanho e estimativa de tokens (`tools/rag-lake/build_bruto.py` é o exemplo). Meça tokens de verdade antes de decidir colar qualquer coisa inteira: código e tabelas passam de caracteres/4.
2. **Zona curada: cartões de decisão.** Para cada decisão relevante escreva um cartão JSON com `id`, `decisao`, `motivo` (ou "não consta"), `vale_quando`, `status` (`vigente`, `substituida` ou `contexto`), `substitui` (ids), `tema` e `fontes` (lista de `{doc, trecho}`). O `trecho` tem de existir literalmente no documento: confira por código (`tools/rag-lake/verificar_cartoes.py`). Escreva os cartões **antes** de escrever as perguntas de teste.
3. **Índice.** Chunks de até 600 caracteres com sobreposição de 100, quebrando por linha. BM25 pelo FTS5 do SQLite; vetor com `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` via `fastembed` (ONNX, local). Fusão por rank (RRF) e reranker `BAAI/bge-reranker-v2-m3-int8` sobre os 30 melhores candidatos (`tools/rag-lake/indice.py`). A consulta é só o texto da pergunta.
4. **Montar o contexto (braço A5).** Top-10 trechos pelo reranker mais os 3 cartões mais próximos por vetor, com três regras: (a) cartão substituído traz junto o que o substitui e o vigente traz o que ele substitui; (b) cada cartão mostra estado, "vale quando" e documentos-fonte; (c) trecho que contém o trecho-fonte de um cartão leva a etiqueta do cartão e do estado (`tools/rag-lake/bracos.py`).
5. **Chamar o modelo.** `claude -p --model haiku --output-format json --setting-sources project --strict-mcp-config --no-session-persistence --tools ""`, sempre com a mesma ordem de blocos no prompt. Ofereça sempre a opção "informação insuficiente": o erro típico do Haiku é se abster, não inventar.
6. **Medir.** 5 amostras por pergunta com voto por maioria (desempate pela menor letra), McNemar exato pareado, Wilson, Holm só nas hipóteses confirmatórias.

## Dependências externas
Python 3 com `numpy` e `fastembed` (baixa os modelos para `~/.cache/fastembed`); SQLite com FTS5 (já vem no Python); Claude Code CLI.

## Parâmetros que entraram no estudo (não mude sem medir de novo)
chunk 600 / sobreposição 100; k = 10 trechos; 30 candidatos para o reranker; 3 cartões; 4 opções por pergunta com "informação insuficiente"; 5 amostras.
