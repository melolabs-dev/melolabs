---
id: estudo-rag-data-lake-haiku
title: "Estudo: Haiku com mini data lake, o que o RAG curado acerta e o que custa"
source_url: https://github.com/melolabs-dev/melolabs/tree/main/studies/rag-data-lake-haiku
kind: experimento
evidence: experimento-proprio
validated_by_author: true
publishable: true
fidelity: resultado-medido
date: 2026-11-10
tags: [rag, data-lake, haiku, custo, agentes, estudo]
---

# Estudo: Haiku com mini data lake (resultados medidos)

Experimento do Melo Labs no projeto aberto h3: lake de 109 documentos e 152 cartões de decisão, 120 perguntas de múltipla escolha (60 comuns, 30 de conflito, 30 sem resposta), 13 condições (11 Haiku 5.5, 2 Sonnet 5.5), 5 amostras por pergunta com voto, 7.200 chamadas sem erro. Pré-registro e dados congelados com tags git (`prereg-rag-data-lake-haiku`, `dados-rag-data-lake-haiku`). Dados, código e perguntas em `studies/rag-data-lake-haiku`. Sem dados de empresa.

Resultados (`dados/analise.txt`, `dados/analise-sem-piloto.txt`):
- Acertos em 120 (Haiku): A0 só a pergunta 43; A2 lake inteiro colado 91; A3 vetor 84; A4a híbrido 88; A4b híbrido com reranker 99; A5 memória curada 114; A6 curada com portão 78. Controles: ruído 31; ouro e ruído 86/90; ouro e decisões substituídas 87/90. Oráculo Haiku 86/90, Sonnet 90/90.
- Custo nominal (preço de lista a frio): A2 US$ 0,224 por chamada e US$ 0,295 por decisão correta; A5 US$ 0,00088 e US$ 0,00092. Gasto real com cache do A2: cerca de US$ 7,40 contra US$ 134 de lista; total real das 7.200 chamadas US$ 18,39.
- Hipóteses (Holm entre 6): H1 +81 pp; H2 −4,4 pp (IC −8,9 a −1,1); H3 97%; H10a e H10b apoiadas; H9 não apoiada (p = 0,08). Exploratório: o portão do A6 piorou o acerto.
- Erro típico: o Haiku se abstém ("informação insuficiente") em vez de inventar (73 de 77 erros do A0; 4 de 6 erros do A5).
- Ressalva central: as perguntas foram derivadas dos cartões que o A5 entrega (cartão de origem entre os entregues em 79 de 90); o ganho do A5 sobre o A4b é um teto. Gabarito escrito por IA da mesma família; um projeto; múltipla escolha.
