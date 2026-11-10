---
title: "Haiku com mini data lake: o que o RAG curado acerta, o que custa e o que o teste não prova"
lang: pt
date: 2026-11-10
tags: [rag, haiku, data-lake, custo, pre-registro, agentes]
sources: [estudo-rag-data-lake-haiku]
status: draft
study: rag-data-lake-haiku
---

**Resumo.** Pré-registramos seis hipóteses confirmatórias e rodamos 7.200 chamadas (120 perguntas de múltipla escolha, 5 amostras cada, voto por maioria) para medir se o Haiku 5.5, com um mini data lake de um projeto aberto, decide como um modelo maior com o contexto certo. Cinco das seis hipóteses foram apoiadas após correção de Holm; a H9 (custo e acerto contra o Sonnet com oráculo) não foi (p = 0,08). O braço com memória curada (A5) acertou 114 de 120, contra 91 do lake inteiro colado (A2) e 99 da melhor busca sem curadoria (A4b), por cerca de 1/300 do custo nominal por decisão correta do A2. A principal ameaça à validade é circular: as perguntas foram derivadas dos mesmos cartões de decisão que o A5 entrega. Para quem quer só o resumo prático, há o [guia simples](/pt/rag-data-lake-haiku-guia/).

## 1. Pergunta e decisão que o resultado informa

Fecha a H2 do [estudo 1](/pt/haiku-sdd-producao/): um modelo pequeno, com memória do projeto, decide tão bem quanto um maior? A decisão em jogo é onde investir: em modelo maior, em contexto longo ou em recuperação e curadoria.

## 2. Material

- **Lake:** 109 documentos do projeto h3 (commit `f0e17808`) e do estudo 1, com 152 cartões de decisão (107 vigentes, 38 substituídos, 7 de contexto) com decisão, motivo, quando vale, o que substitui e fontes.
- **Perguntas:** 120 de múltipla escolha, 4 opções, uma sempre "Informação insuficiente no material": 60 comuns, 30 de conflito (decisão antiga contra vigente) e 30 sem resposta. Gabarito escrito por IA, com revisão cega (118 de 120 na primeira passada, 120 depois das correções) e validação com os documentos-ouro (Haiku, 5 amostras: 86 de 90 no voto; os quatro erros foram conferidos contra as fontes e o gabarito foi mantido).
- **Calibração:** 20 perguntas extras, só para fixar o limiar do portão do A6.

## 3. Braços

A0 (só a pergunta), A1 (documentos-ouro), A2 (lake inteiro, ~224 mil tokens, no prompt de sistema com cache), A3 (10 trechos por vetor), A4a (híbrido BM25 + vetor, RRF), A4b (A4a com 30 candidatos reordenados pelo bge-reranker-v2-m3), A5 (A4b, mais 3 cartões, com a decisão substituta quando o cartão está substituído e trechos etiquetados com o estado), A6 (A5 com portão: abstém sem chamar o modelo se a nota máxima do reranker for menor que 1,05). Sonnet 5.5 em A0 e A1. Controles: N1 (10 trechos irrelevantes), N1b (N1 e depois o ouro), N2 (ouro e depois 3 trechos de decisões substituídas). Tudo via `claude -p`, sem ferramentas, 5 amostras, temperatura no padrão do harness. Parâmetros, hipóteses e critérios foram fixados antes da rodada (tag `prereg-rag-data-lake-haiku`), e os dados foram congelados depois (`dados-rag-data-lake-haiku`).

## 4. Resultados

| Braço | Acertos/120 | Comum | Conflito | Sem resposta | US$ nominal por decisão correta |
|---|---|---|---|---|---|
| A0 Haiku | 43 | 9/60 | 4/30 | 30/30 | 0,00096 |
| A1 Haiku (90) | 86/90 | 57/60 | 29/30 | n.a. | 0,00154 |
| A2 lake inteiro | 91 | 42/60 | 19/30 | 30/30 | 0,295 |
| A3 vetor | 84 | 32/60 | 22/30 | 30/30 | 0,00114 |
| A4a híbrido | 88 | 38/60 | 20/30 | 30/30 | 0,00111 |
| A4b + reranker | 99 | 44/60 | 25/30 | 30/30 | 0,00096 |
| **A5 curado** | **114** | 54/60 | 30/30 | 30/30 | **0,00092** |
| A6 com portão | 78 | 30/60 | 18/30 | 30/30 | 0,00059 |
| N1 ruído | 31 | 0/60 | 1/30 | 30/30 | 0,00292 |
| N1b ruído + ouro (90) | 86/90 | 57/60 | 29/30 | n.a. | 0,00202 |
| N2 ouro + substituídas (90) | 87/90 | 59/60 | 28/30 | n.a. | 0,00168 |
| A0 Sonnet | 62 | 22/60 | 13/30 | 27/30 | 0,0114 |
| A1 Sonnet (90) | 90/90 | 60/60 | 30/30 | n.a. | 0,0286 |

Custo nominal = tokens × preço de lista a frio medido (Haiku US$ 0,20 e 0,50 por milhão de entrada e saída, US$ 1,00 de entrada acima de 125 mil tokens; Sonnet US$ 4 e 10). O gasto real com cache aparece à parte: o A2 custou em média US$ 0,012 por chamada contra US$ 0,224 nominal. Dólar de lista não é a cobrança da assinatura.

**Hipóteses confirmatórias (bootstrap unilateral de perguntas, 10.000 réplicas, Holm entre 6):**

| | Critério | Estimativa | Resultado |
|---|---|---|---|
| H1 | A1 supera A0 em ≥ 25 pp | +81 pp (IC95 72 a 89) | apoiada |
| H2 | A1 Haiku a ≤ 10 pp do A1 Sonnet | −4,4 pp (IC95 −8,9 a −1,1) | apoiada (p Holm 0,015) |
| H3 | melhor RAG recupera ≥ 80% do ganho do oráculo | 97% | apoiada |
| H9 | melhor RAG Haiku ≥ 90% do Sonnet com oráculo, a ≤ 50% do custo por correta | acerto e custo favoráveis | **não apoiada** (p = 0,08) |
| H10a | A5 a ≤ 25% do custo por correta do A2, sem perder mais de 10 pp | A5 +19 pp e ~1/300 do custo | apoiada |
| H10b | A5 mais barato por correta que A3, IC95 abaixo de zero | −US$ 0,0002 (IC95 −0,00037 a −0,00009) | apoiada |

Sensibilidade sem as 15 perguntas do piloto: mesmas conclusões (A5 99/105; H9 p = 0,14).

**Exploratório (sem correção de múltiplos testes).** O reranker melhorou muito a recuperação (trecho-ouro entre os 10 recuperados: 79% contra 66% do RRF). O portão do A6 piorou o acerto (78 contra 114): abstém em perguntas respondíveis, e não ganha nada nas sem resposta, que já eram 30/30 sem ele.

## 5. Ameaças à validade

- **Circularidade das perguntas (construto).** As 90 perguntas respondíveis foram derivadas de cartões, e o cartão de origem estava entre os entregues pelo A5 em 79 delas (88%). O ganho do A5 sobre o A4b (+15 pontos) é, portanto, um teto, não uma estimativa para perguntas que não saíram dos cartões. O resultado do A4b e dos braços sem cartões não tem esse problema.
- **Autoria por IA.** Lake, perguntas, gabarito e revisão vieram da mesma família de modelos que roda os braços; pontos cegos comuns são possíveis.
- **"Sem resposta" é fácil sem material.** Sem material, a opção "Informação insuficiente" é a certa nas 30 perguntas sem resposta, por isso o A0 tem 30/30 nesse bloco. As comparações mais informativas usam as 90 respondíveis.
- **Um projeto, múltipla escolha, 120 perguntas.** O poder detecta cerca de 14 pp no total e 25 pp por bloco de 30.
- **Parâmetros escolhidos num piloto de 15 perguntas**, que seguem no banco (com sensibilidade acima).
- **Temperatura não controlada** e **A2 no prompt de sistema** (necessário para o cache), enquanto os outros braços usam a mensagem do usuário.
- **Peso do cache na assinatura:** a documentação não publica o peso. Depois da rodada completa, o uso semanal da assinatura estava em 21%, mas isso inclui o restante da sessão e não isola o efeito do cache.

## 6. O que isso permite concluir

Com segurança: dar ao Haiku só a pergunta é pior que o acaso nas perguntas respondíveis; colar o lake inteiro custa centenas de vezes mais que recuperar e acerta menos; reordenar os candidatos com um reranker multilíngue é o maior ganho individual na recuperação; trechos irrelevantes sozinhos são piores que nada; um portão de abstenção calibrado em 20 perguntas não se sustentou. Sem segurança: quanto da vantagem da curadoria sobrevive a perguntas que não nasceram dos cartões, e se o resultado se repete em outro projeto ou com outro modelo. O próximo passo natural é um banco de perguntas escrito por outra pessoa, sem acesso aos cartões.

## 7. Reprodutibilidade

Código em `tools/rag-lake/`, perguntas, gabarito e lake em `studies/rag-data-lake-haiku/`, dados brutos em `dados/bruto/` com manifesto de hashes. Tags `prereg-rag-data-lake-haiku` e `dados-rag-data-lake-haiku`. Comando da análise: `python tools/rag-lake/analisar.py dados/bruto/*.jsonl --replicas 10000`.
